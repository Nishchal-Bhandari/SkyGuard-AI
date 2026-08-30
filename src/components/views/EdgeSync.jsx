import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const EdgeSync = () => {
  const { offlineBuffer, isOfflineMode, toggleOfflineMode, syncOfflineBuffer, activeStationId, liveApiStatus = {} } = useWeather();

  const handleSync = () => {
    tacticalAudio.playClick();
    const count = syncOfflineBuffer();
    tacticalAudio.playSuccess();
    alert(`Replayed ${count} buffered telemetry frames with idempotent deduplication.`);
  };

  const handleToggle = () => {
    tacticalAudio.playClick();
    toggleOfflineMode();
  };

  const connectionState = isOfflineMode ? 'OFFLINE' : (liveApiStatus?.isOnline ? 'ONLINE' : 'STANDBY');

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-cloud-arrow-up text-cyan"></i> EDGE BUFFER & OFFLINE RESILIENCE
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`cyber-btn btn-sm ${isOfflineMode ? 'btn-danger' : ''}`}
            onClick={handleToggle}
            style={{ fontSize: '0.72rem' }}
          >
            <i className={`fa-solid fa-${isOfflineMode ? 'satellite-dish' : 'tower-cell'}`}></i>
            {isOfflineMode ? "Simulating Outage (Offline)" : "Simulate Outage"}
          </button>
          <button
            className="cyber-btn btn-sm btn-primary"
            onClick={handleSync}
            disabled={offlineBuffer.length === 0}
            style={{ fontSize: '0.72rem' }}
          >
            <i className="fa-solid fa-arrows-rotate"></i> Sync Now ({offlineBuffer.length})
          </button>
        </div>
      </div>
      <div className="cyber-card-body">
        {/* Operational Status Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 14px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>CONNECTION</div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.15rem', color: connectionState === 'ONLINE' ? 'var(--neon-green)' : 'var(--neon-crimson)', fontWeight: 800, marginTop: '2px' }}>
              {connectionState}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Edge Gateway Link</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 14px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>BUFFERED RECORDS</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', color: offlineBuffer.length > 0 ? 'var(--neon-amber)' : 'var(--neon-cyan)', fontWeight: 800, marginTop: '2px' }}>
              {offlineBuffer.length} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>frames</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Ring Buffer Queue</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 14px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>LAST SYNC</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 700, marginTop: '3px' }}>
              {liveApiStatus?.lastSync ? new Date(liveApiStatus.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Live'}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Cloud Ingestion Ref</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 14px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>PENDING DEDUPLICATION</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', color: offlineBuffer.length > 0 ? 'var(--neon-crimson)' : 'var(--neon-green)', fontWeight: 800, marginTop: '2px' }}>
              {offlineBuffer.length} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>pending</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>SHA-256 Verifiable</div>
          </div>
        </div>

        {/* Queued Frames Table */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
            LOCAL BUFFER QUEUE ({activeStationId}):
          </div>
          <span className={`cyber-badge ${offlineBuffer.length > 0 ? 'badge-suspect' : 'badge-normal'}`} style={{ fontSize: '0.65rem' }}>
            {offlineBuffer.length} QUEUED
          </span>
        </div>

        <div className="tactical-table-wrapper" style={{ maxHeight: '280px' }}>
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
                  <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.85rem', color: 'var(--neon-green)', marginBottom: '4px' }}>
                      Buffer synchronized
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      Edge gateway is streaming directly to Central Ingestion.
                    </div>
                  </td>
                </tr>
              ) : (
                offlineBuffer.slice(-10).map((b, idx) => (
                  <tr key={idx}>
                    <td style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>{b.stationId}</td>
                    <td>{b.timestamp}</td>
                    <td>{b.temperature}°C</td>
                    <td>{b.humidity}%</td>
                    <td>{b.pressure} hPa</td>
                    <td><span className="cyber-badge badge-suspect" style={{ fontSize: '0.65rem' }}>QUEUED</span></td>
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
