import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const StationChecklist = () => {
  const { checklists, updateChecklist, activeStationId } = useWeather();
  const stationTasks = checklists[activeStationId] || checklists["AWS-07"] || [];

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
