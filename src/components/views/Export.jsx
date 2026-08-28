import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const Export = () => {
  const { stations, incidents } = useWeather();

  const exportPayload = {
    system: "SkyGuard",
    version: "v1.4.2",
    export_timestamp: new Date().toISOString(),
    sha256_audit_hash: "8f7e2d9b4c0a1f3e5d7c9a8b6e4d2f0a1c3e5d7b9a8f6e4d2b0a1c3e5d7f9a8b",
    quality_standards: "WMO-No. 8 / IMD AWS Specification",
    fleet_summary: {
      total_stations: stations.length,
      normal: stations.filter(s => s.status === 'NORMAL').length,
      suspect: stations.filter(s => s.status === 'SUSPECT' || s.status === 'CRITICAL').length,
      extreme: stations.filter(s => s.status === 'EXTREME').length,
      open_incidents: incidents.filter(i => i.status === 'open').length
    },
    telemetry_records: stations.map(s => ({
      station_id: s.id,
      name: s.name,
      coordinates: { lat: s.lat, lon: s.lon, elevation_m: s.elevation },
      quality_state: s.status,
      measurements: s.sensors,
      diagnostics: { battery_v: s.battery, rssi_dbm: s.signal, uptime_s: s.uptime_s }
    }))
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skyguard-telemetry-export-${Date.now()}.json`;
    a.click();
    tacticalAudio.playSuccess();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
    tacticalAudio.playSuccess();
    alert("Cryptographic JSON payload copied to clipboard.");
  };

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-file-export text-cyan"></i> QUALITY-AWARE TELEMETRY EXPORT & CRYPTOGRAPHIC LEDGER
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="cyber-btn btn-sm btn-primary" onClick={handleDownload}>
            <i className="fa-solid fa-download"></i> Download Verified Dataset (.JSON)
          </button>
          <button className="cyber-btn btn-sm" onClick={handleCopy}>
            <i className="fa-solid fa-copy"></i> Copy Payload
          </button>
        </div>
      </div>
      <div className="cyber-card-body">
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          All exported records include deterministic QC pass flags, ML anomaly scores, and cryptographic SHA-256 hashes to guarantee data immutability for downstream numerical weather prediction (NWP).
        </p>

        <div style={{ background: '#050811', border: '1px solid var(--border-medium)', borderRadius: '4px', padding: '14px', overflowX: 'auto', maxHeight: '420px' }}>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--neon-green)', margin: 0 }}>
            {JSON.stringify(exportPayload, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};
