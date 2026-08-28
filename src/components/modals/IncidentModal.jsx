import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const IncidentModal = ({ incident, onClose }) => {
  const { adjudicateIncident } = useWeather();

  if (!incident) return null;

  const handleAction = (action) => {
    adjudicateIncident(incident.id, action);
    onClose();
  };

  const badgeClass = incident.severity === 'critical' || incident.severity === 'high' ? 'badge-critical' : 'badge-suspect';
  const stateBadge = incident.quality_state === 'GENUINE_EXTREME_CANDIDATE' ? 'badge-extreme' : 'badge-suspect';

  return (
    <div className="cyber-modal-overlay active">
      <div className="cyber-modal" style={{ maxWidth: '680px' }}>
        <div className="modal-header">
          <div className="modal-title" id="modal-inc-title">
            <i className="fa-solid fa-triangle-exclamation text-crimson"></i> INCIDENT EVIDENCE: {incident.id}
          </div>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" id="modal-inc-content">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
            <span className={`cyber-badge ${badgeClass}`}>{incident.severity} SEVERITY</span>
            <span className={`cyber-badge ${stateBadge}`}>{incident.quality_state}</span>
            <span className="cyber-badge badge-offline">STATION: {incident.station_id} ({incident.station_name})</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {new Date(incident.created_at).toLocaleString()}
            </span>
          </div>

          <div className="evidence-chain">
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.75rem', color: 'var(--neon-cyan)', marginBottom: '6px' }}>
              STRUCTURED REASON CODES & EVIDENCE GRAPH:
            </div>
            {incident.reason_codes.map((rc, idx) => (
              <div className="evidence-step" key={idx}>
                <span className="cyber-badge badge-critical">{rc}</span>
                <span style={{ color: 'var(--text-primary)' }}>{incident.explanation}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '14px', background: 'rgba(5, 8, 17, 0.6)', padding: '12px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.75rem', color: 'var(--neon-cyan)', marginBottom: '6px' }}>
              RECOMMENDED OPERATOR ACTIONS:
            </div>
            <ul style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', paddingLeft: '18px' }}>
              {incident.recommended_actions.map((act, idx) => (
                <li key={idx}>{act}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button className="cyber-btn btn-sm" onClick={() => handleAction('ACKNOWLEDGE')}>
            <i className="fa-solid fa-check"></i> Acknowledge
          </button>
          <button className="cyber-btn btn-sm btn-green" onClick={() => handleAction('GENUINE')}>
            <i className="fa-solid fa-cloud-bolt"></i> Confirm Genuine Extreme
          </button>
          <button className="cyber-btn btn-sm btn-danger" onClick={() => handleAction('REJECT')}>
            <i className="fa-solid fa-ban"></i> Flag Defect / Invalidate
          </button>
        </div>
      </div>
    </div>
  );
};
