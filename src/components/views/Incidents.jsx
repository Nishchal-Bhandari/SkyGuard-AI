import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { IncidentModal } from '../modals/IncidentModal';
import { tacticalAudio } from '../../utils/audio';

export const Incidents = () => {
  const { role, assignedStationId } = useAuth();
  const { incidents } = useWeather();
  const [selectedIncident, setSelectedIncident] = useState(null);

  const isOperator = role === 'station_operator' || role === 'STATION_OPERATOR';
  const visibleIncidents = isOperator && assignedStationId
    ? incidents.filter(i => i.station_id === assignedStationId)
    : incidents;

  const handleOpenIncident = (inc) => {
    setSelectedIncident(inc);
    tacticalAudio.playClick();
  };

  return (
    <>
      <div className="cyber-card">
        <div className="cyber-card-header">
          <div className="cyber-card-title">
            <i className="fa-solid fa-triangle-exclamation text-crimson"></i> ANOMALY INCIDENT TRIAGE & ADJUDICATION QUEUE
            {isOperator && assignedStationId && (
              <span style={{ fontSize: '0.72rem', color: 'var(--neon-cyan)', marginLeft: '10px' }}>
                ({assignedStationId} OPERATOR SCOPE)
              </span>
            )}
          </div>
          <span className="cyber-badge badge-suspect">
            {visibleIncidents.filter(i => i.status === 'open').length} OPEN ALERTS
          </span>
        </div>
        <div className="cyber-card-body" style={{ padding: 0 }}>
          <div className="tactical-table-wrapper">
            <table className="tactical-table incident-triage-table">
              <thead>
                <tr>
                  <th>INCIDENT ID</th>
                  <th>TIME</th>
                  <th>STATION</th>
                  <th>VARIABLE</th>
                  <th>QUALITY FLAG</th>
                  <th>RISK</th>
                  <th>REASON CODES</th>
                  <th>STATUS</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {visibleIncidents.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>
                      <i className="fa-solid fa-circle-check text-green" style={{ fontSize: '1.5rem', marginBottom: '8px', display: 'block' }}></i>
                      No incidents flagged. All weather station telemetry is nominal or no anomalies reported.
                    </td>
                  </tr>
                ) : (
                  visibleIncidents.map(inc => {
                  const badgeClass = inc.severity === 'critical' || inc.severity === 'high' ? 'badge-critical' : 'badge-suspect';
                  const stateBadge = inc.quality_state === 'GENUINE_EXTREME_CANDIDATE' ? 'badge-extreme' : 'badge-suspect';
                  const statusBadge = inc.status === 'open' ? 'badge-critical' : inc.status === 'acknowledged' ? 'badge-suspect' : 'badge-normal';

                  return (
                    <tr key={inc.id} className="incident-row">
                      <td style={{ fontWeight: 'bold', color: 'var(--neon-cyan)', whiteSpace: 'nowrap' }}>{inc.id}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 'bold' }}>{inc.station_id}</span>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{inc.station_name}</div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}><code>{inc.variable}</code></td>
                      <td><span className={`cyber-badge ${stateBadge}`}>{inc.quality_state}</span></td>
                      <td style={{ fontWeight: 'bold', color: inc.fault_risk >= 0.7 ? 'var(--neon-crimson)' : 'var(--neon-amber)', whiteSpace: 'nowrap' }}>
                        {inc.fault_risk}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {inc.reason_codes.map((rc, idx) => (
                            <span key={idx} className={`cyber-badge ${badgeClass}`} style={{ fontSize: '0.65rem' }}>{rc}</span>
                          ))}
                        </div>
                      </td>
                      <td><span className={`cyber-badge ${statusBadge}`}>{inc.status.toUpperCase()}</span></td>
                      <td>
                        <button className="cyber-btn btn-sm btn-primary" style={{ padding: '5px 8px', fontSize: '0.72rem', whiteSpace: 'nowrap' }} onClick={() => handleOpenIncident(inc)}>
                          <i className="fa-solid fa-microscope"></i> Review
                        </button>
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedIncident && (
        <IncidentModal
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </>
  );
};
