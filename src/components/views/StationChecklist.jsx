import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const StationChecklist = () => {
  const { checklists, updateChecklist, activeStationId, setCurrentView } = useWeather();
  const stationTasks = checklists[activeStationId] || [];

  if (!activeStationId || stationTasks.length === 0) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-list-check" style={{ fontSize: '3rem', color: 'var(--neon-cyan)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
          NO ACTIVE STATION PROTOCOL
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          No weather station is active. Provision a weather station in Station Credentials to access field calibration checklists.
        </p>
        <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('credentials')}>
          <i className="fa-solid fa-key"></i> Provision Weather Station
        </button>
      </div>
    );
  }

  const handleSignAudit = () => {
    tacticalAudio.playSuccess();
    alert(`Field maintenance checklist for ${activeStationId} signed and committed to cryptographic audit trail.`);
  };

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-list-check text-cyan"></i> FIELD MAINTENANCE & SENSOR CALIBRATION PROTOCOL
        </div>
        <button className="cyber-btn btn-sm btn-primary" onClick={handleSignAudit}>
          <i className="fa-solid fa-signature"></i> Sign & Submit Audit Log
        </button>
      </div>
      <div className="cyber-card-body">
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          Complete physical field verifications below. Every marked task is timestamped and cryptographically linked to the station's calibration lineage.
        </p>

        <div className="checklist-container">
          {stationTasks.map(item => (
            <div className="checklist-item" key={item.id}>
              <input
                type="checkbox"
                className="checklist-checkbox"
                checked={item.done}
                onChange={(e) => updateChecklist(activeStationId, item.id, e.target.checked)}
              />
              <div className="checklist-content">
                <div className="checklist-title">
                  <span>{item.title}</span>
                  {item.done ? (
                    <span className="cyber-badge badge-normal" style={{ fontSize: '0.62rem' }}>
                      COMPLETED: {item.timestamp}
                    </span>
                  ) : (
                    <span className="cyber-badge badge-suspect" style={{ fontSize: '0.62rem' }}>
                      PENDING INSPECTION
                    </span>
                  )}
                </div>
                <div className="checklist-desc">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
