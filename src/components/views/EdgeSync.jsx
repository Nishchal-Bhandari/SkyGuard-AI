import React from 'react';
import { useWeather } from '../../context/WeatherContext';

export const EdgeSync = () => {
  const { offlineBuffer, isOfflineMode, toggleOfflineMode, syncOfflineBuffer, activeStationId } = useWeather();

  const handleSync = () => {
    const count = syncOfflineBuffer();
    alert(`Replayed ${count} buffered telemetry frames with idempotent deduplication.`);
  };

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-cloud-arrow-up text-cyan"></i> EDGE BUFFER & OFFLINE RESILIENCE CATCH-UP SYNC
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`cyber-btn btn-sm ${isOfflineMode ? 'btn-danger' : 'btn-primary'}`}
            onClick={toggleOfflineMode}
          >
            <i className={`fa-solid fa-${isOfflineMode ? 'satellite-dish' : 'tower-cell'}`}></i>
            {isOfflineMode ? "Simulating Outage (Offline)" : "Simulate Network Blackout"}
          </button>
          <button
            className="cyber-btn btn-sm btn-green"
            onClick={handleSync}
            disabled={offlineBuffer.length === 0}
          >
            <i className="fa-solid fa-arrows-rotate"></i> Replay & Sync Buffer ({offlineBuffer.length})
          </button>
        </div>
      </div>
      <div className="cyber-card-body">
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          When cellular connectivity drops, the {activeStationId} edge gateway stores observations in an immutable local append-only ring buffer. Upon link recovery, frames are replayed chronologically with SHA-256 deduplication.
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
            LOCAL BUFFER QUEUE DEPTH:
          </div>
          <span className={`cyber-badge ${offlineBuffer.length > 0 ? 'badge-suspect' : 'badge-normal'}`}>
            {offlineBuffer.length} FRAMES QUEUED
          </span>
        </div>

        <div className="tactical-table-wrapper" style={{ maxHeight: '300px' }}>
          <table className="tactical-table">
            <thead>
              <tr>
                <th>STATION</th>
                <th>TIMESTAMP</th>
                <th>TEMPERATURE</th>
                <th>HUMIDITY</th>
                <th>PRESSURE</th>
                <th>QUEUE STATUS</th>
              </tr>
            </thead>
            <tbody>
              {offlineBuffer.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                    Buffer empty. Edge gateway is synchronized with Central Ingestion Pipeline.
                  </td>
                </tr>
              ) : (
                offlineBuffer.slice(-10).map((b, idx) => (
                  <tr key={idx}>
                    <td style={{ color: 'var(--neon-cyan)' }}>{b.stationId}</td>
                    <td>{b.timestamp}</td>
                    <td>{b.temperature}°C</td>
                    <td>{b.humidity}%</td>
                    <td>{b.pressure} hPa</td>
                    <td><span className="cyber-badge badge-suspect">QUEUED LOCAL</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
