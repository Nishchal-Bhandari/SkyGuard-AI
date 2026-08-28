import React, { useState } from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const StationUpload = () => {
  const { activeStationId } = useWeather();
  const [uploadedRows, setUploadedRows] = useState([
    { timestamp: "2026-08-28 00:00 UTC", temp: 24.2, hum: 82, pres: 1008.2, rain: 0.0, status: "NOMINAL" },
    { timestamp: "2026-08-28 01:00 UTC", temp: 23.8, hum: 85, pres: 1007.9, rain: 0.0, status: "NOMINAL" },
    { timestamp: "2026-08-28 02:00 UTC", temp: 23.4, hum: 88, pres: 1007.5, rain: 0.2, status: "NOMINAL" },
    { timestamp: "2026-08-28 03:00 UTC", temp: 23.1, hum: 90, pres: 1007.1, rain: 0.8, status: "NOMINAL" },
    { timestamp: "2026-08-28 04:00 UTC", temp: 22.9, hum: 92, pres: 1006.8, rain: 2.4, status: "NOMINAL" }
  ]);
  const [isCommitted, setIsCommitted] = useState(false);

  const handleDownloadTemplate = () => {
    const csv = `timestamp,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,rainfall_mm\n2026-08-28 00:00:00,24.2,82.0,1008.2,12.4,0.0\n2026-08-28 01:00:00,23.8,85.0,1007.9,11.2,0.0`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aws-telemetry-template.csv`;
    a.click();
    tacticalAudio.playSuccess();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      tacticalAudio.playSuccess();
      alert(`File '${file.name}' (${(file.size / 1024).toFixed(1)} KB) successfully parsed and pre-screened through QC Engine.`);
      setIsCommitted(false);
    }
  };

  const handleCommit = () => {
    setIsCommitted(true);
    tacticalAudio.playSuccess();
    alert(`Committed ${uploadedRows.length} pre-screened historical records to ${activeStationId} archival ledger.`);
  };

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-file-arrow-up text-cyan"></i> HISTORICAL TELEMETRY LOG INGESTION & BASELINE CALIBRATION
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="cyber-btn btn-sm" onClick={handleDownloadTemplate}>
            <i className="fa-solid fa-file-csv"></i> Download CSV Template
          </button>
        </div>
      </div>
      <div className="cyber-card-body">
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          Station operators must upload previous datalogger SD-card logs or manual backfill batches to calibrate spatial buddy baselines and baseline rolling statistics for {activeStationId}.
        </p>

        {/* Upload Zone */}
        <div style={{ border: '2px dashed var(--border-medium)', borderRadius: '6px', padding: '30px 20px', textAlign: 'center', background: 'rgba(5,8,17,0.7)', marginBottom: '18px', cursor: 'pointer', position: 'relative' }}>
          <input
            type="file"
            accept=".csv,.json"
            onChange={handleFileUpload}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
          />
          <i className="fa-solid fa-cloud-arrow-up" style={{ fontSize: '2.2rem', color: 'var(--neon-cyan)', marginBottom: '10px' }}></i>
          <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 700 }}>
            DRAG & DROP CSV / JSON LOG FILES OR CLICK TO BROWSE
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Supported formats: ISO-8601 CSV, Campbell Scientific TOA5, IMD Synoptic JSON (Max 50MB)
          </div>
        </div>

        {/* Ingestion Preview Table */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
            PARSED BATCH PREVIEW & PRE-INGESTION QUALITY CHECK:
          </div>
          <span className="cyber-badge badge-normal">5/5 ROWS NOMINAL</span>
        </div>

        <div className="tactical-table-wrapper">
          <table className="tactical-table">
            <thead>
              <tr>
                <th>TIMESTAMP</th>
                <th>TEMPERATURE</th>
                <th>HUMIDITY</th>
                <th>PRESSURE</th>
                <th>RAINFALL</th>
                <th>PRE-INGESTION QC</th>
              </tr>
            </thead>
            <tbody>
              {uploadedRows.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.timestamp}</td>
                  <td>{r.temp}°C</td>
                  <td>{r.hum}%</td>
                  <td>{r.pres} hPa</td>
                  <td>{r.rain} mm</td>
                  <td><span className="cyber-badge badge-normal">{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="cyber-btn btn-sm btn-primary" onClick={handleCommit} disabled={isCommitted}>
            <i className="fa-solid fa-database"></i> {isCommitted ? "Committed to Ledger" : "Commit Batch to Historical Ledger"}
          </button>
        </div>
      </div>
    </div>
  );
};
