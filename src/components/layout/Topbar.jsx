import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

const VIEW_TITLES = {
  'command-center': { title: 'FLEET COMMAND OVERVIEW', sub: 'REAL-TIME NETWORK METEOROLOGICAL ANOMALY MATRIX' },
  'fleet-map': { title: 'GEOSPATIAL RADAR MAP', sub: 'STATION LOCATIONS, SPATIAL BUDDY VECTORS & WEATHER CLUSTERS' },
  'incidents': { title: 'GLOBAL INCIDENT QUEUE', sub: 'EXPLAINABLE REASON CODES & OPERATOR ADJUDICATION WORKFLOW' },
  'credentials': { title: 'STATION CREDENTIAL MANAGEMENT', sub: 'CENTRAL OPERATOR PROVISIONING, ACCESS CONTROL & RBAC AUDIT' },
  'qc-rules': { title: 'QC PHYSICS & THRESHOLD MATRIX', sub: 'CONFIGURABLE BOUNDS, DERIVATIVES & EVIDENCE WEIGHTS' },
  'fault-lab': { title: 'FAULT INJECTION & ML LAB', sub: 'SYNTHETIC STRESS TESTING & CHRONOLOGICAL EVALUATION' },
  'model-governance': { title: 'MODEL GOVERNANCE & REGISTRY', sub: 'MODEL CARDS, VERSIONED FEATURES, DRIFT METRICS & APPROVAL WORKFLOWS' },
  'export': { title: 'QUALITY-AWARE TELEMETRY EXPORT', sub: 'CRYPTOGRAPHIC PAYLOAD AUDIT & VERIFIED MET REPOSITORIES' },
  'station-hud': { title: 'COCKPIT HUD', sub: 'HIGH-FREQUENCY SENSOR READOUTS & LIVE STREAM' },
  'station-upload': { title: 'HISTORICAL DATA INGESTION', sub: 'BATCH CSV / JSON TELEMETRY LOG UPLOADER & BASELINE BACKFILL' },
  'station-diagnostics': { title: 'HARDWARE TELEMETRY', sub: 'GATEWAY BATTERY, SOLAR CHARGE, RSSI & FIRMWARE STATUS' },
  'station-checklist': { title: 'MAINTENANCE CHECKLIST', sub: 'STEP-BY-STEP FIELD DIAGNOSTICS & AUDIT LOGS' },
  'edge-sync': { title: 'EDGE RESILIENCE & OFFLINE SYNC', sub: 'LOCAL APPEND-ONLY BUFFER & IDEMPOTENT REPLAY' }
};

export const Topbar = ({ onToggleMobileSidebar }) => {
  const { currentView, activeStationId, liveApiStatus, syncLiveOpenMeteoData, stations } = useWeather();
  const info = VIEW_TITLES[currentView] || { title: 'SKYGUARD', sub: 'TACTICAL AWS SYSTEM' };

  let displayTitle = info.title;
  let displaySub = info.sub;
  if (['station-hud', 'station-upload', 'station-diagnostics', 'station-checklist', 'edge-sync'].includes(currentView)) {
    displayTitle = `${activeStationId || 'AWS'} ${info.title}`;
    displaySub = `${activeStationId || 'AWS'} ${info.sub}`;
  }

  const handleManualSync = async () => {
    tacticalAudio.playClick();
    await syncLiveOpenMeteoData();
    tacticalAudio.playSuccess();
  };

  return (
    <header className="cyber-topbar">
      <div className="topbar-left">
        <button
          className="mobile-menu-btn"
          id="mobile-menu-toggle-btn"
          title="Open Navigation"
          onClick={onToggleMobileSidebar}
        >
          <i className="fa-solid fa-bars"></i>
        </button>
        <div className="view-heading">
          <h1 className="view-title" id="view-title-text">{displayTitle}</h1>
          <span className="view-subtitle" id="view-subtitle-text">{displaySub}</span>
        </div>
      </div>

      <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Open-Meteo Live API Status Badge */}
        <div className="telemetry-ticker">
          <div className="ticker-item" title={liveApiStatus.lastSync ? `Last synced with Open-Meteo at ${liveApiStatus.lastSync}` : 'Open-Meteo Live Data Feed'}>
            <span className={`pulse-dot ${liveApiStatus.isOnline ? 'pulse-green' : 'pulse-amber'}`}></span>
            <span style={{ color: 'var(--neon-cyan)', fontWeight: 700 }}>OPEN-METEO API:</span>
            <span id="live-stream-status" style={{ color: liveApiStatus.isOnline ? '#00ff66' : '#ffb703', fontWeight: 600 }}>
              {liveApiStatus.isSyncing ? 'SYNCING...' : liveApiStatus.isOnline ? `LIVE (${liveApiStatus.latencyMs}ms)` : 'STANDBY'}
            </span>
          </div>
          {liveApiStatus.lastSync && (
            <div className="ticker-item" style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
              <i className="fa-regular fa-clock text-cyan"></i> {liveApiStatus.lastSync}
            </div>
          )}
        </div>

        {/* Instant Sync Trigger Button */}
        {stations.length > 0 && (
          <button
            className="cyber-btn btn-sm"
            style={{ padding: '5px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '5px', borderColor: 'var(--neon-cyan)' }}
            onClick={handleManualSync}
            disabled={liveApiStatus.isSyncing}
            title="Fetch immediate real-time weather from Open-Meteo API"
          >
            <i className={`fa-solid fa-arrows-rotate text-cyan ${liveApiStatus.isSyncing ? 'fa-spin' : ''}`}></i>
            <span>{liveApiStatus.isSyncing ? 'SYNCING' : 'SYNC LIVE'}</span>
          </button>
        )}
      </div>
    </header>
  );
};
