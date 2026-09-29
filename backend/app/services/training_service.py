"""Station-isolated training, measured temporal validation and gated activation."""
import datetime as dt
import hashlib
import json
import math
import logging
import statistics
import uuid
from backend.app.storage.database import (
    get_db, fetch_historical_telemetry, create_training_job, update_training_job,
    update_training_job_stage, get_active_model_record, list_station_models,
)
from backend.app.services.model_storage import model_storage_service
from ml.feature_engine import feature_engine, instant, readiness, valid_core
from ml.climatology_engine import climatology_engine
from ml.station_adaptive_pipeline import IsolationForest, StationAdaptiveMLPipeline
from ml.shap_engine import TreeSHAPEngine


class TrainingEligibilityError(ValueError):
    def __init__(self, eligibility):
        self.eligibility = eligibility
        super().__init__('TRAINING_HISTORY_INSUFFICIENT: requires 720 clean distinct observations across 14 days')


class StationAdaptiveTrainingService:
    def __init__(self):
        self.pipeline = StationAdaptiveMLPipeline(storage_dir=model_storage_service.base_path)

    def history(self, station_id):
        rows = fetch_historical_telemetry(station_id, limit=100000)
        clean = {}
        for row in rows:
            try:
                row = dict(row)
                row['timestamp'] = instant(row['timestamp']).isoformat()
                row['hour'] = instant(row['timestamp']).hour
                if valid_core(row) and not str(row.get('grid_point', '')).startswith('synthetic:'):
                    clean[row['timestamp']] = row
            except (ValueError, TypeError):
                continue
        return sorted(clean.values(), key=lambda r: r['timestamp']), len(rows)

    def start_training(self, station_id, custom_version=None):
        sid = station_id.strip().upper()
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('SELECT station_id FROM stations WHERE station_id = ?', (sid,))
            if not cur.fetchone():
                raise ValueError('Station not found')
        rows, _ = self.history(sid)
        eligible = readiness(rows)
        if eligible['tier'] not in ('TRAINED', 'MATURE'):
            raise TrainingEligibilityError(eligible)
        version = custom_version or f'v2.{uuid.uuid4().hex[:12]}'
        model_storage_service.identifier(version)
        if any(m['model_version'] == version for m in list_station_models(sid)):
            raise ValueError('Model version already exists')
        try:
            job = create_training_job(sid, version)
        except Exception as error:
            # Distinguish a concurrent job from an infrastructure failure.
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute("SELECT id FROM training_jobs WHERE station_id = ? AND status = 'RUNNING'", (sid,))
                running = cur.fetchone()
            if running:
                raise ValueError('TRAINING_ALREADY_RUNNING') from error
            raise
        return {'success': True, 'job_id': job, 'station_id': sid, 'model_version': version,
                'valid_records': len(rows), 'training_rows': len(rows), 'readiness': eligible}

    def execute_training_job(self, job_id, station_id, target_version):
        completed = []
        def stage(name):
            completed.append(name)
            update_training_job_stage(job_id, name, completed)
        try:
            rows, raw_count = self.history(station_id)
            eligible = readiness(rows)
            if eligible['tier'] not in ('TRAINED', 'MATURE'):
                raise TrainingEligibilityError(eligible)
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute('SELECT * FROM stations WHERE station_id = ?', (station_id,))
                station = cur.fetchone()
            stage('Data Ingested')
            stage('Data Validated')
            split = int(len(rows) * .8)
            fit, holdout = rows[:split], rows[split:]
            climate = climatology_engine.train_station_climatology(fit)
            # Remove extreme residual contamination using only the fit partition.
            cleaned = [r for r in fit if max(abs(z) for z in feature_engine.residuals(r, climate)) <= 8]
            if len(cleaned) < max(72, int(.8 * len(fit))):
                raise ValueError('TRAINING_CONTAMINATION: too few clean fit observations')
            climate = climatology_engine.train_station_climatology(cleaned)
            stats = feature_engine.fit_stats(cleaned, float(station['elevation'] or 0))
            stage('Data Preprocessed')
            features = [feature_engine.transform(r, climate, stats, cleaned[max(0,i-12):i]) for i,r in enumerate(cleaned)]
            stage('Features Generated')
            forest = IsolationForest(n_trees=100, sub_sample_size=min(256, len(features)), random_seed=20260917)
            forest.fit(features)
            stage('Training Isolation Forest')
            validation = [feature_engine.transform(r, climate, stats, rows[max(0,split+i-12):split+i]) for i,r in enumerate(holdout)]
            scores = [forest.score_sample(x) for x in validation]
            rate = sum(s >= forest.threshold for s in scores) / len(scores)
            incumbent = get_active_model_record(station_id)
            incumbent_scores = []
            if incumbent:
                for i, row in enumerate(holdout):
                    result = self.score_observation(station_id, row, history=rows[max(0,split+i-12):split+i])
                    if result.get('has_model'):
                        incumbent_scores.append(result['is_anomaly'])
            agreement = sum(old == (new >= forest.threshold) for old,new in zip(incumbent_scores,scores)) / len(scores) if len(incumbent_scores) == len(scores) else None
            metrics = {'evaluation_type': 'unlabelled_temporal_holdout', 'evaluated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                'samples': len(scores), 'fit_samples': len(cleaned), 'holdout_start': holdout[0]['timestamp'], 'holdout_end': holdout[-1]['timestamp'],
                'anomaly_rate': rate, 'score_mean': statistics.mean(scores), 'score_std': statistics.pstdev(scores),
                'incumbent_agreement': agreement, 'precision': None, 'recall': None, 'f1': None,
                'limitation': 'Unlabelled observations cannot establish detection precision or recall.'}
            # Explicit initial-model policy: no incumbent comparison on first deployment.
            gate = {'readiness': True, 'holdout_anomaly_rate': rate <= .15,
                    'incumbent_agreement': incumbent is None or (agreement is not None and agreement >= .85),
                    'known_fault_validation': False}
            # Deterministic injected holdout evaluates sensor faults separately from field performance.
            faulty = []
            for x in validation:
                bad = x.copy()
                bad[0] += 8
                bad[3] += 8
                faulty.append(forest.score_sample(bad) >= forest.threshold)
            synthetic_if_recall = sum(faulty) / len(faulty)
            # The detector includes the deterministic temporal hard gate; record its result separately.
            synthetic_chain_recall = sum(hit or abs(holdout[i]['temp'] + 8 - rows[split+i-1]['temp']) >= 6 for i, hit in enumerate(faulty)) / len(faulty)
            gate['known_fault_validation'] = synthetic_chain_recall >= .8
            metrics['synthetic_if_spike_recall'] = synthetic_if_recall
            metrics['synthetic_chain_spike_recall'] = synthetic_chain_recall
            card = {'model_id': f'{station_id}_IF_{target_version}', 'station_id': station_id,
                    'version': target_version, 'algorithm': 'Isolation Forest', 'readiness_tier': eligible['tier'],
                    'training_summary': {'valid_records': len(rows), 'scrubbed_records': raw_count-len(rows)+len(fit)-len(cleaned),
                        'features': feature_engine.feature_names, 'dynamic_threshold': forest.threshold},
                    'normalization_stats': stats, 'metrics': metrics, 'gate_results': gate,
                    'training_data': {'start': rows[0]['timestamp'], 'end': rows[-1]['timestamp'],
                        'sha256': hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()},
                    'feature_space': {'version': 2, 'names': feature_engine.feature_names}, 'random_seed': 20260917,
                    'parent_version': incumbent['model_version'] if incumbent else None}
            artifact = {'schema_version': 2, 'model_card': card, 'model_weights': forest.to_dict(), 'climatology': climate}
            path = model_storage_service.save_artifact(station_id, card['model_id'], artifact)
            stage('Model Evaluation')
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute('''INSERT INTO model_registry (station_id,model_id,model_version,model_type,model_location,feature_schema,
                    training_rows,threshold,contamination_rate,sha256,status,training_started_at,training_completed_at,metrics,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (station_id,card['model_id'],target_version,'IsolationForest',path,json.dumps(feature_engine.feature_names),len(rows),
                     forest.threshold,rate,artifact['sha256'],'CANDIDATE',metrics['evaluated_at'],metrics['evaluated_at'],json.dumps(metrics),metrics['evaluated_at']))
            stage('Model Registered')
            self.activate(station_id, target_version)
            stage('Model Activated')
            update_training_job(job_id, 'COMPLETED', rows_used=len(rows), feature_count=12, current_stage='Model Activated', completed_stages=completed)
        except Exception as error:
            logging.getLogger(__name__).exception("Training job %s failed", job_id)
            update_training_job(job_id, 'FAILED', error_message=str(error), current_stage='Validation failed', completed_stages=completed)

    def activate(self, station_id, version):
        with get_db() as conn:
            cur = conn.cursor()
            if conn.is_postgres:
                cur.execute('SELECT station_id FROM stations WHERE station_id = ? FOR UPDATE', (station_id,))
            else:
                cur.execute('BEGIN IMMEDIATE')
            cur.execute('SELECT * FROM model_registry WHERE station_id = ? AND model_version = ?', (station_id,version))
            target = cur.fetchone()
            if not target:
                raise ValueError('Model version not found')
            artifact = model_storage_service.load_artifact(target['model_location'])
            if not artifact or artifact.get('sha256') != target['sha256']:
                raise ValueError('Artifact hash verification failed')
            card = artifact['model_card']
            if card.get('readiness_tier') not in ('TRAINED','MATURE') or not card.get('gate_results') or not all(card['gate_results'].values()):
                raise ValueError(f'Model promotion gates failed: {card.get("gate_results")}')
            cur.execute("SELECT id FROM incidents WHERE station_id = ? AND status = 'open' AND quality_state != 'REGIONAL_EVENT'", (station_id,))
            if cur.fetchone():
                raise ValueError('Open sensor incident prevents promotion')
            cur.execute("UPDATE model_registry SET status = 'ARCHIVED' WHERE station_id = ? AND status = 'ACTIVE'", (station_id,))
            cur.execute("UPDATE model_registry SET status = 'ACTIVE' WHERE id = ?", (target['id'],))
        return {'success': True, 'station_id': station_id, 'active_version': version, 'promoted_version': version}

    def score_observation(self, station_id, observation, last_observation=None, history=None):
        record = get_active_model_record(station_id)
        absent = {'station_id': station_id, 'has_model': False, 'status': 'MODEL_NOT_TRAINED', 'anomaly_score': None, 'is_anomaly': False}
        if not record:
            return absent
        if not valid_core(observation):
            return {**absent, 'status': 'INVALID_OBSERVATION'}
        try:
            artifact = model_storage_service.load_artifact(record['model_location'])
        except (ValueError, OSError):
            return {**absent, 'status': 'ARTIFACT_UNAVAILABLE'}
        if not artifact:
            return {**absent, 'status': 'ARTIFACT_UNAVAILABLE', 'model_id': record['model_id']}
        forest = IsolationForest.from_dict(artifact['model_weights'])
        card = artifact['model_card']
        if artifact.get('schema_version', 1) < 2:
            # Preserve legacy loading without pretending legacy features are v2.
            return {**absent, 'status': 'LEGACY_MODEL_REQUIRES_MIGRATION', 'legacy_artifact_loaded': True}
        row = dict(observation)
        row['timestamp'] = instant(row.get('timestamp') or dt.datetime.now(dt.timezone.utc).isoformat()).isoformat()
        recent = history if history is not None else ([last_observation] if last_observation and last_observation.get('timestamp') else [])
        vector = feature_engine.transform(row, artifact['climatology'], card['normalization_stats'], recent)
        score = forest.score_sample(vector)
        try:
            attribution = TreeSHAPEngine.explain_instance(vector, forest.trees, forest.sub_sample_actual, feature_engine.feature_names, forest.threshold)
        except (ValueError, ArithmeticError, IndexError) as error:
            attribution = {'available': False, 'reason': str(error)}
        return {'station_id': station_id, 'has_model': True, 'model_id': record['model_id'], 'model_version': record['model_version'],
                'status': 'ANOMALY' if score >= forest.threshold else 'NORMAL', 'anomaly_score': score, 'threshold': forest.threshold,
                'is_anomaly': score >= forest.threshold, 'feature_vector': vector, 'xai_explanation': attribution}


training_service = StationAdaptiveTrainingService()
