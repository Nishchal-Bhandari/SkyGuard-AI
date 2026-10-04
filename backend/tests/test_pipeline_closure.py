import datetime as dt
import json
import math
import uuid
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.auth.security import create_access_token
from backend.app.storage.database import init_db, get_db, insert_telemetry_batch
from backend.app.services.observation_pipeline import observation_pipeline, timestamp
from ml.sensor_health import sensor_health_engine
from ml.feature_engine import readiness


@pytest.fixture
def station():
    import uuid
    init_db()
    sid = 'PIPE-' + uuid.uuid4().hex[:8].upper()
    client = TestClient(app)
    headers = {'Authorization': 'Bearer ' + create_access_token({'sub':'admin','role':'admin'})}
    assert client.post('/api/v1/admin/stations',headers=headers,json={
        'station_id':sid,'station_name':sid,'username':sid.lower(),'password':'test-password',
        'latitude':12.,'longitude':77.,'elevation':0.,
    }).status_code == 201
    return sid, client, headers


def frame(ts='2026-08-01T00:00:00Z', **values):
    return {'timestamp':ts,'temp':25.,'hum':60.,'pres':1013.25,**values}


def test_source_time_and_station_context(station):
    sid,client,headers=station
    result=observation_pipeline.process(sid,frame('2026-08-01T05:30:00+05:30'))
    state=result['state']; a=state['final_assessment']
    assert a['station_id']==sid
    assert a['source_timestamp']=='2026-08-01T00:00:00+00:00'
    assert a['readiness']==state['readiness']
    stored=client.get(f'/api/v1/stations/{sid}/assessments/latest',headers=headers).json()['assessment']
    assert stored['source_timestamp']==a['source_timestamp']


@pytest.mark.parametrize('value', [None,-999,65535,float('nan'),float('inf'),80.])
def test_hard_gate_prevents_ml(station,value):
    sid,_,_=station
    with patch('backend.app.services.observation_pipeline.training_service.score_observation') as scorer:
        result=observation_pipeline.process(sid,frame(temp=value))
    assert not scorer.called
    a=result['state']['final_assessment']
    assert a['quality_state']=='INVALID'
    assert a['severity']=='CRITICAL'
    assert a['confidence']<=a['evidence_completeness']
    assert a['root_cause_diagnosis']['ranked_alternatives']


def test_replay_duplicate_and_conflict(station):
    sid,_,_=station
    a=observation_pipeline.process(sid,frame())
    b=observation_pipeline.process(sid,frame())
    c=observation_pipeline.process(sid,frame(temp=27))
    assert (a['status'],b['status'],c['status'])==('ACCEPTED','DUPLICATE','CONFLICT')
    with get_db() as conn:
        cur=conn.cursor()
        for table in ('telemetry','assessments','sensor_health'):
            cur.execute(f'SELECT COUNT(*) AS n FROM {table} WHERE station_id=?',(sid,))
            assert cur.fetchone()['n']==1
        cur.execute('SELECT normal_streak FROM station_pipeline_state WHERE station_id=?',(sid,))
        assert cur.fetchone()['normal_streak']==1
        cur.execute('SELECT temperature FROM telemetry WHERE station_id=?',(sid,))
        assert cur.fetchone()['temperature']==25.


def test_esp32_and_rest_share_assessment(station):
    sid,client,headers=station
    row=frame(); row['station_id']=sid
    rest=client.post(f'/api/v1/stations/{sid}/telemetry/batch',headers=headers,json=[row])
    assert rest.status_code==200,rest.text
    edge={'station_id':sid,'timestamp':row['timestamp'],'sensors':{
        'temperature':{'value':25.},'humidity':{'value':60.},'pressure':{'value':1013.25}}}
    esp=client.post('/api/v1/telemetry/esp32/ingest',headers=headers,json=edge)
    assert esp.status_code==200,esp.text
    assert esp.json()['status']=='DUPLICATE'
    assert esp.json()['observation_id']==rest.json()['results'][0]['observation_id']
    assert esp.json()['assessment']['station_id']==sid


def test_esp32_conflict_is_not_acknowledged(station):
    sid, client, headers = station
    row = frame(); row['station_id'] = sid
    first = client.post(f'/api/v1/stations/{sid}/telemetry/batch', headers=headers, json=[row])
    assert first.status_code == 200
    edge = {'station_id': sid, 'timestamp': row['timestamp'], 'sensors': {
        'temperature': {'value': 27.}, 'humidity': {'value': 60.}, 'pressure': {'value': 1013.25}}}
    conflict = client.post('/api/v1/telemetry/esp32/ingest', headers=headers, json=edge)
    assert conflict.status_code == 409
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) AS n FROM observation_quarantine WHERE station_id=?', (sid,))
        assert cur.fetchone()['n'] == 1


def test_batch_partial_ack_and_original_time(station):
    sid,client,headers=station
    rows=[frame('2026-08-01T02:00:00Z'),frame('not-a-time'),frame('2026-08-01T01:00:00Z')]
    result=client.post(f'/api/v1/stations/{sid}/telemetry/batch',headers=headers,json=rows).json()
    assert result['accepted']==2 and result['rejected']==1
    assert [r['acknowledged'] for r in result['results']]==[True,False,True]
    with get_db() as conn:
        cur=conn.cursor(); cur.execute('SELECT source_timestamp FROM station_pipeline_state WHERE station_id=?',(sid,))
        assert cur.fetchone()['source_timestamp']=='2026-08-01T02:00:00+00:00'


def test_regional_event_does_not_penalize_sensor_health():
    result=sensor_health_engine.evaluate_station_health('A','REGIONAL_EVENT',qc_envelope_breached=True,flatline_detected=True,drift_rate_c_per_day=2)
    assert result['overall_health_score']==100
    faulty=sensor_health_engine.evaluate_station_health('A','LOCALIZED_ANOMALY',flatline_detected=True)
    assert faulty['overall_health_score']<100


def test_impossible_or_missing_timestamp_is_not_replaced(station):
    sid,_,_=station
    for value in (None,'not-a-time','2999-01-01T00:00:00Z'):
        with pytest.raises(ValueError):
            observation_pipeline.process(sid,frame(value))


def test_mature_tier_keeps_fourteen_day_gate():
    start = dt.datetime(2026, 3, 31, 12, tzinfo=dt.timezone.utc)
    rows = [{'timestamp': (start + dt.timedelta(seconds=i * 20)).isoformat()} for i in range(4380)]
    assert readiness(rows)['seasons'] == 2
    assert readiness(rows)['tier'] == 'BASELINE'


def test_five_station_regional_persistence(station):
    _, client, headers = station
    prefix = 'REG-' + uuid.uuid4().hex[:5].upper()
    ids = [f'{prefix}-{i}' for i in range(5)]
    start = dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc)
    for i, sid in enumerate(ids):
        created = client.post('/api/v1/admin/stations', headers=headers, json={
            'station_id': sid, 'station_name': sid, 'username': sid.lower(),
            'password': 'test-password', 'latitude': 12., 'longitude': 77. + i * .03, 'elevation': 0.})
        assert created.status_code == 201
        rows = []
        for hour in range(72):
            phase = 2 * math.pi * (hour % 24) / 24
            rows.append({'timestamp': (start + dt.timedelta(hours=hour)).isoformat(),
                'temp': 25 + 2 * math.sin(phase) + i * .05,
                'hum': 60 + 3 * math.cos(phase), 'pres': 1013 + .5 * math.sin(phase),
                'wind': 4., 'rain': 0.})
        assert insert_telemetry_batch(sid, rows)[0] == 72
    t1 = (start + dt.timedelta(hours=72)).isoformat()
    t2 = (start + dt.timedelta(hours=72, minutes=10)).isoformat()
    for timestamp in (t1, t2):
        for i, sid in enumerate(ids):
            state = observation_pipeline.process(sid, frame(timestamp, temp=33 + i * .05))['state']
            if sid == ids[-1]:
                last = state['final_assessment']
                if timestamp == t1:
                    # Peers agree but persistence is unproven: held, with no sensor-fault attribution or health penalty.
                    assert last['classification'] == 'LOCALIZED_ANOMALY_UNCONFIRMED'
                    assert last['regional_candidate']
                    assert last['root_cause'] == 'REGIONAL_WEATHER_FRONT'
                    assert last['severity'] == 'MEDIUM'
                    assert last['imputation'] == {}
                    assert state['sensor_health']['overall_health_score'] == 100
    assert last['classification'] == 'REGIONAL_EVENT'
    assert last['fleet_evidence']['eligible_peer_count'] >= 2
    assert last['root_cause'] == 'REGIONAL_WEATHER_FRONT'
    assert last['imputation'] == {}
    assert state['sensor_health']['overall_health_score'] == 100


def test_isolated_station_exposes_peer_uncertainty(station):
    sid, _, _ = station
    with get_db() as conn:
        conn.cursor().execute('UPDATE stations SET latitude=?, longitude=? WHERE station_id=?', (50., -120., sid))
    start = dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc)
    rows = []
    for hour in range(72):
        phase = 2 * math.pi * (hour % 24) / 24
        rows.append({'timestamp': (start + dt.timedelta(hours=hour)).isoformat(),
            'temp': 25 + 2 * math.sin(phase), 'hum': 60 + 3 * math.cos(phase),
            'pres': 1013 + .5 * math.sin(phase), 'wind': 4., 'rain': 0.})
    assert insert_telemetry_batch(sid, rows)[0] == 72
    state = observation_pipeline.process(sid, frame((start + dt.timedelta(hours=72)).isoformat(), temp=33))['state']
    assessment = state['final_assessment']
    assert assessment['classification'] == 'LOCALIZED_ANOMALY_UNCONFIRMED'
    assert assessment['fleet_evidence']['fleet_evidence_state'] == 'INCOMPLETE'
    assert assessment['confidence'] <= .5


def test_incident_replay_and_three_new_normal_observations(station):
    sid, _, _ = station
    with get_db() as conn:
        conn.cursor().execute('UPDATE stations SET latitude=?, longitude=? WHERE station_id=?', (50., -120., sid))
    start = dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc)
    rows = []
    for hour in range(72):
        phase = 2 * math.pi * (hour % 24) / 24
        rows.append({'timestamp': (start + dt.timedelta(hours=hour)).isoformat(),
            'temp': 25 + 2 * math.sin(phase), 'hum': 60 + 3 * math.cos(phase),
            'pres': 1013 + .5 * math.sin(phase), 'wind': 4., 'rain': 0.})
    assert insert_telemetry_batch(sid, rows)[0] == 72
    fault = frame((start + dt.timedelta(hours=72)).isoformat(), temp=33)
    assert observation_pipeline.process(sid, fault)['status'] == 'ACCEPTED'
    assert observation_pipeline.process(sid, fault)['status'] == 'DUPLICATE'
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status FROM incidents WHERE station_id=?", (sid,))
        assert [r['status'] for r in cur.fetchall()] == ['open']
    for hours in (75, 78):
        observation_pipeline.process(sid, frame((start + dt.timedelta(hours=hours)).isoformat()))
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status FROM incidents WHERE station_id=?", (sid,))
        assert [r['status'] for r in cur.fetchall()] == ['open']
    observation_pipeline.process(sid, frame((start + dt.timedelta(hours=81)).isoformat()))
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status, action_taken FROM incidents WHERE station_id=?", (sid,))
        assert [(r['status'], r['action_taken']) for r in cur.fetchall()] == [('resolved', 'AUTO_RESOLVED')]


def test_local_fault_imputation_preserves_raw_and_peer_provenance(station):
    target, client, headers = station
    prefix = 'HEAL-' + uuid.uuid4().hex[:5].upper()
    peers = [f'{prefix}-{i}' for i in range(2)]
    with get_db() as conn:
        conn.cursor().execute('UPDATE stations SET latitude=?, longitude=? WHERE station_id=?', (40., -100., target))
    start = dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc)
    for i, sid in enumerate([target, *peers]):
        if sid != target:
            created = client.post('/api/v1/admin/stations', headers=headers, json={
                'station_id': sid, 'station_name': sid, 'username': sid.lower(),
                'password': 'test-password', 'latitude': 40., 'longitude': -100. + i * .03, 'elevation': 0.})
            assert created.status_code == 201
        rows = []
        for hour in range(72):
            phase = 2 * math.pi * (hour % 24) / 24
            rows.append({'timestamp': (start + dt.timedelta(hours=hour)).isoformat(),
                'temp': 25 + 2 * math.sin(phase), 'hum': 60 + 3 * math.cos(phase),
                'pres': 1013 + .5 * math.sin(phase), 'wind': 4., 'rain': 0.})
        assert insert_telemetry_batch(sid, rows)[0] == 72
    timestamp = (start + dt.timedelta(hours=72)).isoformat()
    for sid in peers:
        peer = observation_pipeline.process(sid, frame(timestamp))['state']
        assert peer['final_assessment']['classification'] == 'NORMAL'
    result = observation_pipeline.process(target, frame(timestamp, temp=33))['state']
    assessment = result['final_assessment']
    estimate = assessment['imputation']['temperature']
    assert assessment['classification'] == 'LOCALIZED_ANOMALY'
    assert set(estimate['source_peers']) == set(peers)
    assert estimate['method'] == 'IDW_RESIDUAL'
    assert estimate['raw_value'] == 33
    assert 22 <= estimate['value'] <= 28
    assert set(assessment['imputation']) == {'temperature'}
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute('SELECT temperature FROM telemetry WHERE station_id=? AND timestamp=?', (target, timestamp))
        assert cur.fetchone()['temperature'] == 33
        cur.execute('SELECT parameter, raw_value, imputed_value, peer_list FROM imputations WHERE station_id=?', (target,))
        stored = cur.fetchone()
        assert stored['parameter'] == 'temperature' and stored['raw_value'] == 33
        assert set(json.loads(stored['peer_list'])) == set(peers)

def test_extreme_single_channel_departure_is_not_vetoed(station):
    sid, _, _ = station
    start = dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc)
    rows = []
    for hour in range(72):
        phase = 2 * math.pi * (hour % 24) / 24
        rows.append({'timestamp': (start + dt.timedelta(hours=hour)).isoformat(),
            'temp': 25 + 2 * math.sin(phase), 'hum': 60 + 3 * math.cos(phase),
            'pres': 1013 + .5 * math.sin(phase), 'wind': 4., 'rain': 0.})
    assert insert_telemetry_batch(sid, rows)[0] == 72
    phase = 2 * math.pi * (72 % 24) / 24
    # A 20-point humidity bias is gradual enough to avoid the temporal-step rule and no model is trained.
    state = observation_pipeline.process(sid, frame((start + dt.timedelta(hours=72)).isoformat(), temp=25 + 2 * math.sin(phase),
        hum=80 + 3 * math.cos(phase), pres=1013 + .5 * math.sin(phase)))['state']
    assessment = state['final_assessment']
    assert assessment['evidence_vector']['z_qc'] == 1.0 and not assessment['evidence_vector']['z_temp']
    assert assessment['classification'] in ('LOCALIZED_ANOMALY', 'LOCALIZED_ANOMALY_UNCONFIRMED')
    assert assessment['root_cause'] not in ('NOMINAL', 'REGIONAL_WEATHER_FRONT')
