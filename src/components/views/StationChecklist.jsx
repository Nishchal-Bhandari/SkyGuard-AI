import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { DEFAULT_MAINTENANCE_CHECKLIST } from '../../utils/seedData';
import { tacticalAudio } from '../../utils/audio';

export const StationChecklist = () => {
  const { checklists, updateChecklist, activeStationId, stations, incidents, setCurrentView } = useWeather();
  const station = stations.find(s => s.id?.toUpperCase() === activeStationId?.toUpperCase()) || stations[0] || {};
  const stationTasks = checklists[activeStationId] || DEFAULT_MAINTENANCE_CHECKLIST;

  if (!activeStationId) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-list-check" style={{ fontSize: '3rem', color: 'var(--neon-cyan)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
          NO ACTIVE STATION PROTOCOL
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          No weather station is active. Provision a weather station in Station Credentials to access field checklists.
        </p>
        <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('credentials')}>
          <i className="fa-solid fa-key"></i> Provision Weather Station
        </button>
      </div>
    );
  }

  const stationIncidents = incidents.filter(i => i.station_id === activeStationId);
  const completedCount = stationTasks.filter(t => t.done).length;

  const handleSignAudit = () => {
    tacticalAudio.playSuccess();
    alert(`Maintenance protocol for ${activeStationId} signed and submitted to audit log.`);
  };

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-list-check text-cyan"></i> FIELD MAINTENANCE & SENSOR CALIBRATION
        </div>
        <button className="cyber-btn btn-sm btn-primary" onClick={handleSignAudit}>
          <i className="fa-solid fa-signature"></i> Sign & Submit Audit Log
        </button>
      </div>
      <div className="cyber-card-body">
        {/* Maintenance Priority Summary Card */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>STATION</div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.05rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
              {station.id}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{station.name}</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>HARDWARE STATUS</div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.05rem', color: station.status === 'NORMAL' ? 'var(--neon-green)' : 'var(--neon-amber)', fontWeight: 800 }}>
              {station.status}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Signal: {station.signal || -68} dBm</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>BATTERY VOLTAGE</div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.05rem', color: (station.battery || 12.6) < 11.8 ? 'var(--neon-crimson)' : 'var(--neon-green)', fontWeight: 800 }}>
              {station.battery || 12.6}V
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Solar Float Active</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>RECOMMENDATION</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 700, marginTop: '3px' }}>
              {station.status === 'NORMAL' ? 'Routine Inspection' : 'Calibrate Tipping Bucket'}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {stationIncidents.length} Prior Incidents
            </div>
          </div>
        </div>

        {/* Inspection Tasks Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
            PHYSICAL VERIFICATION CHECKLIST:
          </div>
          <span className="cyber-badge badge-normal" style={{ fontSize: '0.68rem' }}>
            {completedCount} / {stationTasks.length} VERIFIED
          </span>
        </div>

        {/* Checklist Container */}
        <div className="checklist-container">
          {stationTasks.map(item => {
            const isDone = !!(item.done || item.completed);
            return (
              <div
                className="checklist-item"
                key={item.id}
                onClick={() => {
                  tacticalAudio.playClick();
                  updateChecklist(activeStationId, item.id, !isDone);
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <input
                  type="checkbox"
                  className="checklist-checkbox"
                  checked={isDone}
                  onChange={(e) => {
                    e.stopPropagation();
                    tacticalAudio.playClick();
                    updateChecklist(activeStationId, item.id, e.target.checked);
                  }}
                />
                <div className="checklist-content">
                  <div className="checklist-title">
                    <span>{item.title}</span>
                    {isDone ? (
                      <span className="cyber-badge badge-normal" style={{ fontSize: '0.62rem' }}>
                        COMPLETED: {item.timestamp || 'Verified'}
                      </span>
                    ) : (
                      <span className="cyber-badge badge-suspect" style={{ fontSize: '0.62rem' }}>
                        PENDING
                      </span>
                    )}
                  </div>
                  <div className="checklist-desc">{item.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
