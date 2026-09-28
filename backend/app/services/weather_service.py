"""Source adapters only; all verdicts are owned by ObservationPipeline."""
import asyncio
import datetime
import json
import logging
from typing import Dict, Any, List
import httpx
from backend.app.storage.database import get_db, fetch_historical_telemetry
from backend.app.services.observation_pipeline import observation_pipeline, timestamp, fuse
from ml.feature_engine import readiness

REGIONAL_PEER_FRESHNESS_SECONDS=1800
REGIONAL_EVENT_MAX_GAP_SECONDS=1800
logger=logging.getLogger(__name__)
normalize_source_timestamp=timestamp
fuse_anomaly_evidence=fuse

def regional_event_consensus(
    target_z: float,
    peer_z_scores: List[float],
    agreement_index: float,
    minimum_peers: int = 2,
    departure_threshold: float = 2.0,
    minimum_fraction: float = 0.5,
) -> bool:
    """Require a local departure and a same-direction majority of peer departures."""
    if len(peer_z_scores) < minimum_peers or agreement_index < 0.32 or abs(target_z) < departure_threshold:
        return False
    direction = 1 if target_z > 0 else -1
    corroborating = sum(
        1 for score in peer_z_scores
        if abs(score) >= departure_threshold and (1 if score > 0 else -1) == direction
    )
    return corroborating / len(peer_z_scores) > minimum_fraction


def is_eligible_regional_peer(peer: Dict[str, Any], target_timestamp: str) -> bool:
    """A peer must have valid data, a usable residual model and a fresh source time."""
    if peer.get("qc_flag") != "VALID":
        return False
    readiness = peer.get("readiness", {}).get("tier")
    model = peer.get("ml_model") or {}
    features = model.get("feature_vector") or []
    if readiness not in {"TRAINED", "MATURE"} or not model.get("has_model") or not features:
        return False
    try:
        target_dt = datetime.datetime.fromisoformat(target_timestamp.replace("Z", "+00:00"))
        peer_dt = datetime.datetime.fromisoformat(str(peer["source_timestamp"]).replace("Z", "+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        if target_dt.tzinfo is None:
            target_dt = target_dt.replace(tzinfo=datetime.timezone.utc)
        if peer_dt.tzinfo is None:
            peer_dt = peer_dt.replace(tzinfo=datetime.timezone.utc)
        if abs((target_dt - peer_dt).total_seconds()) > REGIONAL_PEER_FRESHNESS_SECONDS:
            return False
        return abs((now - peer_dt.astimezone(datetime.timezone.utc)).total_seconds()) <= REGIONAL_PEER_FRESHNESS_SECONDS
    except (KeyError, TypeError, ValueError):
        return False



def station_readiness(station_id):
    return readiness(fetch_historical_telemetry(station_id,limit=100000))


class WeatherService:
    def __init__(self):
        self.live_state={}
        self.esp32_latest={}
        self.esp32_history={}
        self._cached_base_readings={}
        self.is_running=False
        self.degraded_reason=None

    def _publish(self,result,esp32=False):
        state=result.get('state')
        if not state:
            return
        sid=state['station_id']
        current=self.live_state.get(sid)
        if not current or current['source_timestamp']<=state['source_timestamp']:
            self.live_state[sid]=state
        if esp32:
            state['esp32_live']=True
            if not current or current['source_timestamp']<=state['source_timestamp']:
                self.esp32_latest[sid]=state
            if result['status']=='ACCEPTED':
                self.esp32_history.setdefault(sid,[]).insert(0,state)
                self.esp32_history[sid]=self.esp32_history[sid][:30]

    def process_esp32_frame(self,payload):
        sid=str(payload.get('station_id','')).strip().upper()
        result=observation_pipeline.process(sid,payload)
        self._publish(result,True)
        assessment=result.get('state',{}).get('final_assessment',{})
        return {'success':result['acknowledged'],'acknowledged':result['acknowledged'],
            'status':result['status'],'observation_id':result['observation_id'],'station_id':sid,'seq':payload.get('seq'),
            'cloud_ml':{'status':assessment.get('classification'),'root_cause':assessment.get('root_cause'),
                'fusion_score':assessment.get('fusion',{}).get('score')},'assessment':assessment,
            'edge_ai':payload.get('edge_ai',{}),'cross_tier_verification':{'verdict':'SERVER_ASSESSMENT_AUTHORITATIVE'}}

    def reevaluate(self,stations=None):
        with get_db() as conn:
            cur=conn.cursor()
            if stations is None:
                cur.execute("SELECT * FROM stations WHERE status='ACTIVE'")
                stations=cur.fetchall()
            cur.execute('SELECT * FROM active_faults')
            faults={r['station_id']:r for r in cur.fetchall()}
        for station in stations:
            sid=station['station_id']; current=self._cached_base_readings.get(sid)
            if not current or not current.get('time'):
                continue
            row={'station_id':sid,'timestamp':current['time'],'temp':current.get('temperature_2m'),
                'hum':current.get('relative_humidity_2m'),'pres':current.get('surface_pressure'),
                'wind':current.get('wind_speed_10m'),'rain':current.get('precipitation')}
            source='OBSERVATION'
            fault=faults.get(sid)
            if fault:
                kind=fault['fault_type']; offset=float(fault.get('offset_val') or 1)
                source='SYNTHETIC_FAULT:'+kind+':'+str(fault.get('injected_at',fault.get('created_at','')))
                if kind in ('SPIKE','TEMP_SPIKE'): row['temp']=(row['temp'] or 0)+8.5
                elif kind in ('DRIFT','TEMP_DRIFT'): row['temp']=(row['temp'] or 0)+offset
                elif kind=='FLATLINE': row.update(temp=24.,hum=60.,pres=1013.2)
                elif kind in ('POWER','POWER_SAG'): row.update(battery=10.8,temp=(row['temp'] or 0)+8)
                elif kind in ('STORM','REGIONAL_STORM'): row.update(temp=(row['temp'] or 0)-6,hum=98.,pres=(row['pres'] or 1013)-8)
                elif kind=='RH_SUPERSAT': row['hum']=105.
                elif kind=='SENTINEL': row.update(temp=-999.,hum=65535.,pres=-999.)
                elif kind in ('MISSING','COMMS_DROPOUT'): row.update(temp=None,hum=None,pres=None)
                elif kind=='PRESSURE_OFFSET': row['pres']=(row['pres'] or 0)+15+offset
                elif kind=='NOISE_BURST': row.update(temp=(row['temp'] or 0)+(-1 if datetime.datetime.fromisoformat(timestamp(row['timestamp'])).minute%2 else 1)*8)
                elif kind=='SEA_BREEZE': row.update(temp=(row['temp'] or 0)-2,hum=min(100,(row['hum'] or 0)+5))
                else: raise ValueError('Unknown fault type')
            result=observation_pipeline.process(sid,row,source)
            self._publish(result)

    def get_fleet_state(self):
        # Read persistence even after restart or ingestion through another adapter.
        with get_db() as conn:
            cur=conn.cursor()
            cur.execute('SELECT o.assessment_data FROM observations o\n                JOIN station_pipeline_state s ON s.station_id=o.station_id AND s.source_timestamp=o.source_timestamp')
            states=[json.loads(r['assessment_data']) for r in cur.fetchall()]
        for state in states:
            self.live_state[state['station_id']]=state
        return list(self.live_state.values())

    async def _sync_fleet(self,client):
        with get_db() as conn:
            cur=conn.cursor(); cur.execute("SELECT * FROM stations WHERE status='ACTIVE'"); stations=cur.fetchall()
        if not stations: return
        try:
            response=await client.get('https://api.open-meteo.com/v1/forecast',params={
                'latitude':','.join(str(s['latitude']) for s in stations),'longitude':','.join(str(s['longitude']) for s in stations),
                'current':'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,precipitation','timezone':'UTC'},timeout=10)
            response.raise_for_status(); data=response.json(); data=data if isinstance(data,list) else [data]
            for station,entry in zip(stations,data): self._cached_base_readings[station['station_id']]=entry['current']
            await asyncio.to_thread(self.reevaluate,stations)
            self.degraded_reason=None
        except (httpx.HTTPError,ValueError,KeyError) as error:
            self.degraded_reason=type(error).__name__
            logger.warning('Weather source unavailable: %s',self.degraded_reason)

    async def sync_now(self):
        async with httpx.AsyncClient() as client: await self._sync_fleet(client)

    async def poll_loop(self):
        self.is_running=True
        async with httpx.AsyncClient() as client:
            while self.is_running:
                try:
                    await self._sync_fleet(client)
                except Exception as error:
                    self.degraded_reason=type(error).__name__
                    logger.exception("Weather poll failed; retrying after delay")
                await asyncio.sleep(60 if self.degraded_reason else 20)

    def stop(self): self.is_running=False


weather_service=WeatherService()
