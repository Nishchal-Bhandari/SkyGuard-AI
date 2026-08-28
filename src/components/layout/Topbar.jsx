import React from 'react';
import { useWeather } from '../../context/WeatherContext';

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
  const { currentView, activeStationId } = useWeather();
  const info = VIEW_TITLES[currentView] || { title: 'SKYGUARD', sub: 'TACTICAL AWS SYSTEM' };

  let displayTitle = info.title;
  let displaySub = info.sub;
  if (['station-hud', 'station-upload', 'station-diagnostics', 'station-checklist', 'edge-sync'].includes(currentView)) {
    displayTitle = `${activeStationId} ${info.title}`;
    displaySub = `${activeStationId} ${info.sub}`;
  }

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

      <div className="topbar-right">
        {/* Live Telemetry Clock & Ticker */}
        <div className="telemetry-ticker">
          <div className="ticker-item">
            <span className="pulse-dot pulse-green"></span>
            <span style={{ color: 'var(--neon-cyan)' }}>LIVE TELEMETRY:</span>
            <span id="live-stream-status" style={{ color: '#fff' }}>ACTIVE (QoS 1)</span>
          </div>
          <div className="ticker-item" style={{ color: 'var(--text-muted)' }}>
            <i className="fa-solid fa-microchip text-purple"></i> ISOLATION FOREST v1.4
          </div>
        </div>
      </div>
    </header>
  );
};
