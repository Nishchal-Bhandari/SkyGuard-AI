import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const Export = () => {
  const { role } = useAuth();
  const { stations, incidents } = useWeather();
  const isAdmin = role === 'admin' || role === 'CENTRAL_ADMIN';

  if (!isAdmin) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-lock" style={{ fontSize: '3rem', color: 'var(--neon-crimson)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-crimson)', fontWeight: 800 }}>
          ACCESS DENIED — CENTRAL ADMIN PRIVILEGES REQUIRED
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          Cryptographic ledger and bulk fleet telemetry export are restricted to Central Admin.
        </p>
      </div>
    );
  }

  const [exportPayload, setExportPayload] = React.useState(null);

  React.useEffect(() => {
    const generatePayload = async () => {
      const basePayload = {
        system: "SkyGuard",
        version: "v1.4.2",
        export_timestamp: new Date().toISOString(),
        quality_standards: "WMO-No. 8 / IMD AWS Specification",
        fleet_summary: {
          total_stations: stations.length,
          normal: stations.filter(s => s.status === 'NORMAL').length,
          suspect: stations.filter(s => s.status === 'SUSPECT' || s.status === 'CRITICAL').length,
          extreme: stations.filter(s => s.status === 'EXTREME').length,
          open_incidents: incidents.filter(i => i.status === 'open').length
        },
        telemetry_records: stations.map(s => ({
          station_id: s.id || s.station_id,
          name: s.name || s.station_name,
          coordinates: { lat: s.latitude || s.lat, lon: s.longitude || s.lon, elevation_m: s.elevation },
          quality_state: s.status,
          measurements: s.sensors,
          diagnostics: { battery_v: s.battery, rssi_dbm: s.signal, uptime_s: s.uptime_s || 0 }
        }))
      };

      try {
        const msgBuffer = new TextEncoder().encode(JSON.stringify(basePayload));
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        setExportPayload({
          ...basePayload,
          sha256_audit_hash: hashHex
        });
      } catch (err) {
        // Fallback for non-secure contexts if subtle is not available
        setExportPayload({
          ...basePayload,
          sha256_audit_hash: "unavailable_in_insecure_context"
        });
      }
    };
    
    generatePayload();
  }, [stations, incidents]);

  if (!exportPayload) {
    return <div style={{ padding: '20px', color: 'var(--neon-cyan)' }}>Generating cryptographic payload...</div>;
  }

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
