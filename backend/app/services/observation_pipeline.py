"""Authoritative ingestion and assessment transaction for every observation source."""
import datetime as dt
import hashlib
import json
import math
import statistics
import uuid
from backend.app.storage.database import get_db, fetch_historical_telemetry, insert_assessment_with_sequence_recovery
from backend.app.services.training_service import training_service
from backend.app.services.model_storage import model_storage_service
from ml.feature_engine import instant, readiness, valid_core, feature_engine, PARAMETERS
from ml.thermo_engine import thermo_engine
from ml.sensor_health import sensor_health_engine
from ml.spatial_engine import haversine_distance


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def timestamp(value):
    if value is None or str(value).strip() == '':
        raise ValueError('SOURCE_TIMESTAMP_REQUIRED')
    try:
        return instant(value).isoformat()
    except (ValueError, TypeError):
        for fmt in ('%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S', '%d-%m-%Y %H:%M', '%d-%m-%Y %H:%M:%S'):
            try:
                return dt.datetime.strptime(str(value), fmt).replace(tzinfo=dt.timezone.utc).isoformat()
            except ValueError:
                continue
    raise ValueError('INVALID_SOURCE_TIMESTAMP')


def normalize(station_id, payload, source='OBSERVATION'):
    if not isinstance(payload, dict):
        raise ValueError('Observation must be an object')
    if str(payload.get('station_id', payload.get('station', station_id))).strip().upper() != station_id:
        raise ValueError('STATION_IDENTITY_MISMATCH')
    ts = timestamp(payload.get('source_timestamp', payload.get('timestamp', payload.get('time'))))
    if instant(ts) > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
        raise ValueError('FUTURE_CLOCK_SKEW: observation exceeds five-minute tolerance')
    sensors = payload.get('sensors') or {}
    aliases = [('temp','temperature','temperature_c','t2m'), ('hum','humidity','humidity_pct','relative_humidity_pct'), ('pres','pressure','pressure_hpa','msl')]
    row = {'station_id': station_id, 'timestamp': ts, 'source': source, 'integrity_issues': []}
    for keys in aliases:
        key = next((k for k in keys if k in payload), None)
        long = keys[1]
        value = payload[key] if key else sensors.get(long, {}).get('value')
        try:
            number = float(value) if value is not None else None
            if number is not None and not math.isfinite(number):
                row['integrity_issues'].append(f'{long}:NON_FINITE:{value}')
                number = None
        except (ValueError, TypeError):
            raise ValueError(f'INVALID_NUMBER:{long}')
        if key == 't2m' and number is not None and number > 100:
            number -= 273.15
        if key == 'msl' and number is not None and number > 50000:
            number /= 100
        if number is None:
            row['integrity_issues'].append(f'{long}:MISSING')
        elif number in (-999, 65535):
            row['integrity_issues'].append(f'{long}:SENTINEL')
        row[keys[0]] = number
    for key, default in [('battery', None), ('signal', None), ('wind', None), ('rain', None)]:
        val = payload.get(key, default)
        if key == 'battery':
            val = sensors.get('battery_v', {}).get('value', payload.get('battery_v', val))
        if key == 'signal':
            val = payload.get('rssi_dbm', val)
        try:
            val = float(val) if val is not None else None
            row[key] = val if val is None or math.isfinite(val) else None
        except (ValueError, TypeError):
            raise ValueError(f'INVALID_DIAGNOSTIC:{key}')
    row['grid_point'] = str(payload.get('grid_point', ''))
    # Transport names do not change scientific observation identity.
    row['source'] = source if source.startswith('SYNTHETIC_FAULT:') else 'OBSERVATION'
    return row


def fuse(evidence, coefficients=None):
    weights = coefficients or {'intercept': -3.0, 'z_qc': 1.5, 'z_phys': 3., 'z_temp': 2.5, 'z_ml': 3., 'z_multi': 1., 'z_health': 1.}
    available = {k:v for k,v in evidence.items() if v is not None}
    total = sum(abs(v) for k,v in weights.items() if k != 'intercept')
    active = sum(abs(weights.get(k,0)) for k in available)
    scale = total / active if active else 0
    terms = {k: weights.get(k,0) * v * scale for k,v in available.items()}
    logit = weights['intercept'] + sum(terms.values())
    return {'score': 1/(1+math.exp(-max(-30,min(30,logit)))), 'logit': logit, 'intercept': weights['intercept'], 'terms': terms,
            'coefficient_status': 'FITTED_SYNTHETIC' if coefficients else 'DEFAULT_PRIORS',
            'calibration_note': 'Synthetic calibration only; not a field-validated probability.'}


class ObservationPipeline:
    def _context(self, cur, station, row):
        cur.execute('''SELECT timestamp,temperature AS temp,humidity AS hum,pressure AS pres,grid_point
            FROM telemetry WHERE station_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 5000''', (station['station_id'],row['timestamp']))
        history = list(reversed(cur.fetchall()))
        history = [r for r in history if not str(r.get('grid_point','')).startswith('synthetic:') and valid_core(r)]
        return history

    def _baseline(self, row, history, artifact=None):
        if artifact and artifact.get('climatology'):
            z = feature_engine.residuals(row, artifact['climatology'])
            expected, sigma = {}, {}
            for i,(long,short) in enumerate(PARAMETERS):
                sigma[short] = max(float(artifact['climatology'][long]['robust_sigma']), .1)
                expected[short] = row[short] - z[i]*sigma[short]
            return expected, sigma, z
        if len(history) < 72:
            return {}, {}, None
        bucket = [r for r in history if instant(r['timestamp']).hour == instant(row['timestamp']).hour]
        usable = bucket if len(bucket) >= 5 else history[-720:]
        expected, sigma, z = {}, {}, []
        for long,short in PARAMETERS:
            vals = [r[short] for r in usable]
            expected[short] = statistics.median(vals)
            floor = .5 if short != 'hum' else 2.
            sigma[short] = max(floor, 1.4826*statistics.median(abs(v-expected[short]) for v in vals))
            z.append((row[short]-expected[short])/sigma[short])
        return expected,sigma,z

    def evaluate(self, cur, station, row):
        sid, ts = station['station_id'], row['timestamp']
        history = self._context(cur, station, row)
        ready = readiness(history + ([row] if valid_core(row) else []))
        issues = list(row['integrity_issues'])
        physical = []
        hard = bool(issues) or not valid_core(row)
        if not hard:
            _, physical = thermo_engine.validate_thermodynamic_bounds(row['temp'],row['pres'],row['hum'],station['elevation'] or 0)
            # Instrument-independent core bounds are hard gates; learned deviations are soft.
            hard = any(v.get('type') != 'HYPSOMETRIC_DISCORDANCE' for v in physical)
        artifact = None
        cur.execute("SELECT * FROM model_registry WHERE station_id = ? AND status = 'ACTIVE'", (sid,))
        active = cur.fetchone()
        if active:
            try:
                artifact = model_storage_service.load_artifact(active['model_location'])
            except (ValueError,OSError) as error:
                issues.append('MODEL_UNAVAILABLE:' + str(error))
        expected, sigma, z = self._baseline(row,history,artifact) if not hard else ({},{},None)
        ml = {'has_model': False, 'is_anomaly': False, 'anomaly_score': None, 'status': 'RULES_ONLY'}
        if not hard and ready['tier'] in ('TRAINED','MATURE'):
            ml = training_service.score_observation(sid,row,history=history[-12:])
        previous = history[-1] if history else None
        flatline = len(history) >= 4 and all(all(r[p] == row[p] for p in ('temp','hum','pres')) for r in history[-4:]) and not hard
        delta = {p: abs(row[p]-previous[p]) if not hard and previous else 0. for p in ('temp','hum','pres')}
        hours = max((instant(ts)-instant(previous['timestamp'])).total_seconds()/3600, 1/60) if previous else 1
        spike = delta['temp']/hours > 6 or delta['hum']/hours > 30 or delta['pres']/hours > 10
        _, _, prior_z = self._baseline(previous, history[:-1], artifact) if previous and len(history) >= 73 else ({},{},None)
        persistent_departure = bool(z and prior_z and any(abs(a) >= 3 and abs(b) >= 2 and a*b > 0 for a,b in zip(z,prior_z)))
        # Robust residual trend detects gradual bias, not the diurnal cycle.
        drift = 0.
        if z and len(history) >= 12:
            residual_history = [self._baseline(r, history[:i], artifact)[2] for i,r in enumerate(history[-12:], start=max(0,len(history)-12))]
            values = [v[0] for v in residual_history if v]
            if len(values) >= 6:
                drift = (z[0]-statistics.median(values[:3])) / max((instant(ts)-instant(history[-12]['timestamp'])).total_seconds()/86400, 1/24)
        qc = max(abs(v) for v in z) >= 3 if z else False
        cur.execute('SELECT * FROM station_qc_config WHERE station_id = ?', (sid,))
        config = cur.fetchone() or {}
        breached = []
        for long,short in PARAMETERS:
            value = row[short]
            lo,hi = config.get(long+'_normal_min'),config.get(long+'_normal_max')
            if value is not None and ((lo is not None and value < lo) or (hi is not None and value > hi)):
                breached.append(long)
        evidence = {'z_qc': float(qc or bool(breached)), 'z_phys': float(hard),
            'z_temp': float(spike or flatline or persistent_departure or abs(drift) > 2) if previous else None,
            'z_ml': float(ml['is_anomaly']) if ml.get('has_model') else None,
            'z_multi': float(bool(physical)), 'z_health': None}
        cur.execute('SELECT coefficients FROM fusion_coefficients WHERE status = ? ORDER BY id DESC LIMIT 1', ('FITTED_SYNTHETIC',))
        fitted = cur.fetchone()
        fusion = fuse(evidence,json.loads(fitted['coefficients']) if fitted else None)
        local = hard or fusion['score'] >= .5 or flatline
        peers = []
        if z:
            cur.execute("SELECT * FROM stations WHERE status = 'ACTIVE' AND station_id != ?", (sid,))
            for peer in cur.fetchall():
                distance = haversine_distance(station['latitude'],station['longitude'],peer['latitude'],peer['longitude'])
                if distance > 60:
                    continue
                cur.execute('SELECT assessment_data FROM observations WHERE station_id = ? AND source_timestamp <= ? ORDER BY source_timestamp DESC LIMIT 1', (peer['station_id'],ts))
                latest = cur.fetchone()
                if not latest:
                    continue
                state = json.loads(latest['assessment_data'])
                a = state['final_assessment']
                age = (instant(ts)-instant(state['source_timestamp'])).total_seconds()
                peer_z = a.get('residuals')
                if age > 1800 or a['quality_state'] == 'INVALID' or not peer_z:
                    continue
                peers.append({'station_id':peer['station_id'],'id':peer['station_id'],'name':peer['station_name'],
                    'region':peer['region'],'elevation':peer['elevation'],
                    'distance_km': max(.1,distance), 'residuals':peer_z, 'temp':state['sensors']['temperature']['value'],
                    'hum':state['sensors']['humidity']['value'],'pres':state['sensors']['pressure']['value'],
                    'status':a['classification'], 'source_timestamp':state['source_timestamp']})
        peers = sorted(peers,key=lambda p:p['distance_km'])[:15]
        axis = max(range(3),key=lambda i:abs(z[i])) if z else 0
        departures = [p['residuals'][axis] for p in peers]
        agreement = None
        candidate = False
        if z and len(peers) >= 2:
            med = statistics.median(departures)
            spread = max(1.,1.4826*statistics.median(abs(v-med) for v in departures))
            agreement = math.exp(-.5*((z[axis]-med)/spread)**2)
            candidate = not hard and local and abs(z[axis])>=2 and agreement>=.6 and sum(abs(v)>=2 and v*z[axis]>0 for v in departures)>len(peers)/2
        cur.execute('SELECT assessment_data FROM observations WHERE station_id = ? AND source_timestamp < ? ORDER BY source_timestamp DESC LIMIT 1', (sid,ts))
        last = cur.fetchone()
        last_state = json.loads(last['assessment_data']) if last else None
        prior_candidate = bool(last_state and last_state['final_assessment'].get('regional_candidate') and (instant(ts)-instant(last_state['source_timestamp'])).total_seconds()<=1800)
        regional = candidate and prior_candidate
        classification = 'REGIONAL_EVENT' if regional else ('LOCALIZED_ANOMALY' if len(peers)>=2 else 'LOCALIZED_ANOMALY_UNCONFIRMED') if local else 'NORMAL'
        completeness = sum(v is not None for v in evidence.values())/6
        confidence = min(completeness, .9 if len(peers)>=2 else .5)
        root = 'NOMINAL'
        if regional:
            root = 'REGIONAL_WEATHER_FRONT'
        elif hard:
            root = 'MISSING_DATA' if any('MISSING' in v or 'NON_FINITE' in v for v in issues) else 'COMMUNICATION_CORRUPTION' if any('SENTINEL' in v for v in issues) else 'SUPER_SATURATION_VIOLATION'
        elif local:
            root = 'SENSOR_FLATLINE' if flatline else 'THERMAL_SPIKE' if spike else 'CALIBRATION_DRIFT'
        if local and not regional and row['battery'] is not None and row['battery'] < 11.2:
            root = 'POWER_SAG_BROWNOUT'
        action = 'Monitor atmospheric event; preserve observations.' if regional else 'Inspect implicated sensors and review evidence.' if local else 'Continue monitoring.'
        diagnosis = {'root_cause':root,'confidence':confidence,'specific_reason':f'{classification}: source-time physics, temporal and station evidence.',
            'recommended_action':action,'ranked_alternatives':[{'root_cause':'INSUFFICIENT_EVIDENCE' if not peers else 'REGIONAL_WEATHER_FRONT' if local and not regional else 'NOMINAL','confidence':min(.2,confidence)}]}
        health = sensor_health_engine.evaluate_station_health(sid,'REGIONAL_EVENT' if regional else 'CRITICAL' if hard else classification,
            drift_rate_c_per_day=0 if regional else drift, battery_v=row['battery'] if row['battery'] is not None else 12.6,
            signal_dbm=row['signal'] if row['signal'] is not None else -72, flatline_detected=flatline and not regional,
            qc_envelope_breached=local and not regional)
        health['diagnostics_available'] = row['battery'] is not None and row['signal'] is not None
        sensors = {}
        for long,short in PARAMETERS:
            flag = 9 if any(long in v for v in row['integrity_issues']) else 2 if hard else 1 if local and not regional else 0
            sensors[long]={'value':row[short],'unit':{'temp':'°C','hum':'%','pres':'hPa'}[short],'wmo_flag':flag,'status':'FLAG_GOOD' if flag==0 else 'FLAG_ERRONEOUS' if flag in (2,9) else 'FLAG_SUSPECT'}
        sensors['wind_speed']={'value':row['wind'],'unit':'km/h','wmo_flag':0}
        sensors['rainfall']={'value':row['rain'],'unit':'mm','wmo_flag':0}
        imputed = {}
        healthy = [p for p in peers if p['status']=='NORMAL']
        if local and not regional and len(healthy)>=2 and expected:
            for i,(long,short) in enumerate(PARAMETERS):
                if z is None or (abs(z[i]) < 2 and long not in breached):
                    continue
                residuals = [p['residuals'][i] for p in healthy]
                if statistics.pstdev(residuals)>2:
                    continue
                weights=[1/p['distance_km']**2 for p in healthy]
                estimate=expected[short]+sigma[short]*sum(w*v for w,v in zip(weights,residuals))/sum(weights)
                imputed[long]={'value':estimate,'raw_value':row[short],'method':'IDW_RESIDUAL','confidence':confidence,
                    'source_peers':[p['station_id'] for p in healthy], 'wmo_flag':3,'is_imputed':True,'unit':sensors[long]['unit']}
        assessment = {'station_id':sid,'source_timestamp':ts,'quality_state':'INVALID' if hard else 'SUSPECT' if local and not regional else 'VALID',
            'severity':'CRITICAL' if hard else 'LOW' if regional else 'HIGH' if local else 'NONE','classification':classification,'legacy_state':classification,
            'anomaly_probability':0. if regional else 1. if hard else fusion['score'],'local_probability':1. if hard else fusion['score'],
            'confidence':confidence,'evidence_completeness':completeness,'readiness':ready,'evidence_vector':evidence,'fusion':fusion,
            'root_cause':root,'root_cause_diagnosis':diagnosis,'interpretation':diagnosis['specific_reason'],'observed':{p:row[p] for p in ('temp','hum','pres')},
            'expected':expected,'residuals':z,'integrity_issues':issues,'physics_violations':physical,'regional_candidate':candidate,
            'fleet_evidence':{'eligible_peer_count':len(peers),'agreement_index':agreement,'peers':peers,'fleet_evidence_state':'AVAILABLE' if len(peers)>=2 else 'INCOMPLETE'},
            'imputation':imputed,'anomaly_score':ml.get('anomaly_score'), 'badge_class':'badge-normal' if not local else 'badge-extreme' if regional else 'badge-critical'}
        return {'station_id':sid,'station_name':station['station_name'],'latitude':station['latitude'],'longitude':station['longitude'],'elevation':station['elevation'],
            'region':station['region'],'source_timestamp':ts,'last_seen':ts,'status':classification,'sensors':sensors,'battery':row['battery'],'signal':row['signal'],
            'readiness':ready,'final_assessment':assessment,'ml_model':ml,'root_cause_diagnosis':diagnosis,'sensor_health':health,
            'thermodynamic_violations':physical,'derived_thermodynamics':thermo_engine.compute_all_thermodynamic_features(row['temp'],row['pres'],row['hum'],station['elevation'] or 0) if not hard else {},
            'spatial_data':{'nearby_stations':peers,'eligible_peer_count':len(peers),'agreement_index':agreement,'spatial_analysis':assessment['fleet_evidence']},
            'self_healing_data':{'is_healed':bool(imputed),'imputed_sensors':{**{k:dict(v,is_imputed=False) for k,v in sensors.items()},**imputed}}}

    def process(self, station_id, payload, source='OBSERVATION'):
        sid=station_id.strip().upper()
        row=normalize(sid,payload,source)
        digest=hashlib.sha256(canonical(row).encode()).hexdigest()
        oid=hashlib.sha256(f'{sid}|{row["timestamp"]}|{row["source"]}'.encode()).hexdigest()
        now=dt.datetime.now(dt.timezone.utc).isoformat()
        with get_db() as conn:
            cur=conn.cursor()
            if conn.is_postgres:
                cur.execute('SELECT * FROM stations WHERE station_id = ? FOR UPDATE',(sid,))
            else:
                cur.execute('BEGIN IMMEDIATE')
                cur.execute('SELECT * FROM stations WHERE station_id = ?',(sid,))
            station=cur.fetchone()
            if not station or station['status']!='ACTIVE':
                raise ValueError('STATION_NOT_ACTIVE')
            cur.execute('SELECT * FROM observations WHERE observation_id = ?',(oid,))
            prior=cur.fetchone()
            if prior:
                if prior['payload_hash']!=digest:
                    cur.execute('INSERT INTO observation_quarantine VALUES (?,?,?,?,?)',(uuid.uuid4().hex,sid,now,'DUPLICATE_CONFLICT',canonical(row)))
                    return {'status':'CONFLICT','observation_id':oid,'acknowledged':False}
                return {'status':'DUPLICATE','observation_id':oid,'acknowledged':True,'state':json.loads(prior['assessment_data'])}
            state=self.evaluate(cur,station,row)
            assessment=state['final_assessment']
            assessment['observation_id']=oid
            state['received_at']=now
            cur.execute('INSERT INTO observations VALUES (?,?,?,?,?,?,?,?)',(oid,sid,row['timestamp'],now,row['source'],digest,canonical(row),canonical(state)))
            grid='synthetic:'+row['source'] if row['source'].startswith('SYNTHETIC_FAULT:') else row['grid_point']
            cur.execute('''INSERT INTO telemetry(station_id,timestamp,grid_point,temperature,humidity,pressure,wind_speed,rainfall,battery,signal,raw_payload,qc_flag,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(station_id,timestamp,grid_point) DO NOTHING''',
                (sid,row['timestamp'],grid,row['temp'],row['hum'],row['pres'],row['wind'],row['rain'],row['battery'],row['signal'],canonical(row),assessment['quality_state'],now))
            insert_assessment_with_sequence_recovery(conn, cur, '''INSERT INTO assessments(station_id,source_timestamp,quality_state,severity,classification,anomaly_score,confidence,evidence_completeness,evidence_data)
                VALUES (?,?,?,?,?,?,?,?,?)''',(sid,row['timestamp'],assessment['quality_state'],assessment['severity'],assessment['classification'],assessment['anomaly_score'],str(assessment['confidence']),assessment['evidence_completeness'],canonical(assessment)))
            for parameter,estimate in assessment['imputation'].items():
                cur.execute('''INSERT INTO imputations(station_id,source_timestamp,parameter,raw_value,imputed_value,method,peer_list,confidence,assessment_id)
                    VALUES (?,?,?,?,?,?,?,?,?)''',(sid,row['timestamp'],parameter,estimate['raw_value'],estimate['value'],estimate['method'],canonical(estimate['source_peers']),estimate['confidence'],oid))
            h=state['sensor_health']
            cur.execute('''INSERT INTO sensor_health(station_id,source_timestamp,temperature_score,humidity_score,pressure_score,station_score,evidence_data)
                VALUES (?,?,?,?,?,?,?)''',(sid,row['timestamp'],*[h['sensor_scores'][p+'_sensor']['health_score'] for p in ('temperature','humidity','pressure')],h['overall_health_score'],canonical(h)))
            cur.execute('SELECT * FROM station_pipeline_state WHERE station_id = ?',(sid,))
            latest=cur.fetchone()
            if not latest or latest['source_timestamp']<row['timestamp']:
                normal=assessment['classification']=='NORMAL'
                streak=(latest['normal_streak']+1 if latest else 1) if normal else 0
                cur.execute('''INSERT INTO station_pipeline_state VALUES (?,?,?) ON CONFLICT(station_id) DO UPDATE
                    SET source_timestamp=excluded.source_timestamp, normal_streak=excluded.normal_streak''',(sid,row['timestamp'],streak))
                self._incident(cur,station,state,streak,now)
        return {'status':'ACCEPTED','observation_id':oid,'acknowledged':True,'state':state}

    def _incident(self,cur,station,state,streak,now):
        a=state['final_assessment']; sid=station['station_id']
        if a['classification']=='NORMAL':
            if streak>=3:
                cur.execute("UPDATE incidents SET status='resolved',action_taken='AUTO_RESOLVED',updated_at=? WHERE station_id=? AND status='open'",(now,sid))
            return
        param=max(a['observed'],key=lambda k:abs(a['residuals'][('temp','hum','pres').index(k)])) if a['residuals'] else 'core'
        identity=f"{param}:{a['root_cause']}"
        cur.execute("SELECT id FROM incidents WHERE station_id=? AND variable=? AND status='open'",(sid,identity))
        existing=cur.fetchone()
        if existing:
            cur.execute('UPDATE incidents SET evidence_data=?,updated_at=?,severity=?,quality_state=? WHERE id=?',
                (canonical(state),now,a['severity'].lower(),a['classification'],existing['id']))
        else:
            cur.execute('''INSERT INTO incidents(id,station_id,station_name,variable,severity,fault_risk,quality_state,reason_codes,
                explanation,recommended_actions,evidence_ids,evidence_data,status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',('INC-'+uuid.uuid4().hex,sid,station['station_name'],identity,a['severity'].lower(),a['anomaly_probability'],a['classification'],
                    canonical([a['root_cause']]),a['interpretation'],canonical([a['root_cause_diagnosis']['recommended_action']]),canonical([a['observation_id']]),canonical(state),'open',now,now))

    def batch(self,station_id,rows,source='OBSERVATION'):
        if not isinstance(rows,list) or not 1<=len(rows)<=10000:
            raise ValueError('Batch must contain 1 to 10000 observations')
        results=[]
        for index,row in sorted(enumerate(rows),key=lambda pair:str(pair[1].get('source_timestamp',pair[1].get('timestamp',''))) if isinstance(pair[1],dict) else ''):
            try:
                result=self.process(station_id,row,source)
                results.append({'index':index,**{k:v for k,v in result.items() if k!='state'}})
            except (ValueError,TypeError) as error:
                with get_db() as conn:
                    conn.cursor().execute('INSERT INTO observation_quarantine VALUES (?,?,?,?,?)',
                        (uuid.uuid4().hex,station_id,dt.datetime.now(dt.timezone.utc).isoformat(),str(error),json.dumps(row,default=str)))
                results.append({'index':index,'status':'REJECTED','acknowledged':False,'reason':str(error)})
        return {'success':all(r['acknowledged'] for r in results),'results':sorted(results,key=lambda r:r['index']),
            'accepted':sum(r['status']=='ACCEPTED' for r in results),'duplicates':sum(r['status']=='DUPLICATE' for r in results),'rejected':sum(not r['acknowledged'] for r in results)}


observation_pipeline=ObservationPipeline()
