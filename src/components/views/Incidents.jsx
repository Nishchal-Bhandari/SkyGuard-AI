import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { IncidentModal } from '../modals/IncidentModal';
import { tacticalAudio } from '../../utils/audio';
import { apiClient } from '../../utils/apiClient';

export const Incidents = () => {
  const { role, assignedStationId } = useAuth();
  const { incidents, saveIncidents, clearAllIncidents, syncLiveOpenMeteoData } = useWeather();
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const isOperator = role === 'station_operator' || role === 'STATION_OPERATOR';
  const baseIncidents = isOperator && assignedStationId
    ? (incidents || []).filter(i => String(i.station_id || '').toUpperCase() === String(assignedStationId).toUpperCase())
    : (incidents || []);

  const visibleIncidents = statusFilter === 'all'
    ? baseIncidents
    : baseIncidents.filter(i => String(i.status || '').toLowerCase() === statusFilter.toLowerCase());

  const openCount = baseIncidents.filter(i => i.status === 'open').length;
  const ackCount = baseIncidents.filter(i => i.status === 'acknowledged').length;
  const resCount = baseIncidents.filter(i => i.status === 'resolved' || i.status === 'closed').length;

  const handleOpenIncident = (inc) => {
    setSelectedIncident(inc);
    tacticalAudio.playClick();
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    tacticalAudio.playClick();
    try {
      const res = await apiClient.getIncidents();
      if (res?.success && Array.isArray(res.incidents)) {
        if (saveIncidents) saveIncidents(res.incidents);
      }
      if (syncLiveOpenMeteoData) await syncLiveOpenMeteoData();
      tacticalAudio.playSuccess();
    } catch (e) {
      console.warn("[Incidents View] Manual refresh failed:", e.message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleClearAllIncidents = async () => {
    if (!window.confirm("Are you sure you want to permanently clear the global incident queue?")) {
      return;
    }
    setIsClearing(true);
    tacticalAudio.playClick();
    try {
      if (clearAllIncidents) {
        await clearAllIncidents();
      }
      tacticalAudio.playSuccess();
    } catch (e) {
      console.error("[Incidents View] Failed to clear incidents:", e);
      tacticalAudio.playAlarm();
      window.alert(`Failed to clear incident queue: ${e.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <>
      <div className="cyber-card">
        <div className="cyber-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div className="cyber-card-title">
            <i className="fa-solid fa-triangle-exclamation text-crimson"></i> ANOMALY INCIDENT TRIAGE & ADJUDICATION QUEUE
            {isOperator && assignedStationId && (
              <span style={{ fontSize: '0.72rem', color: 'var(--neon-cyan)', marginLeft: '10px' }}>
                ({assignedStationId} OPERATOR SCOPE)
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '4px', background: 'rgba(5,8,17,0.8)', padding: '3px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
              <button
                className={`cyber-btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : ''}`}
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                onClick={() => setStatusFilter('all')}
              >
                ALL ({baseIncidents.length})
              </button>
              <button
                className={`cyber-btn btn-sm ${statusFilter === 'open' ? 'btn-danger' : ''}`}
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                onClick={() => setStatusFilter('open')}
              >
                OPEN ({openCount})
              </button>
              <button
                className={`cyber-btn btn-sm ${statusFilter === 'acknowledged' ? 'btn-primary' : ''}`}
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                onClick={() => setStatusFilter('acknowledged')}
              >
                ACK ({ackCount})
              </button>
              <button
                className={`cyber-btn btn-sm ${statusFilter === 'resolved' ? 'btn-primary' : ''}`}
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                onClick={() => setStatusFilter('resolved')}
              >
                RESOLVED ({resCount})
              </button>
            </div>

            <button
              className="cyber-btn btn-sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              style={{ padding: '5px 10px', fontSize: '0.72rem' }}
              title="Refresh Incidents from Cloud Database"
            >
              <i className={`fa-solid fa-rotate ${isRefreshing ? 'fa-spin' : ''}`}></i>
            </button>

            {!isOperator && (
              <button
                className="cyber-btn btn-sm btn-danger"
                onClick={handleClearAllIncidents}
                disabled={isClearing || baseIncidents.length === 0}
                style={{ padding: '5px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '5px' }}
                title="Permanently Clear Global Incident Queue"
              >
                <i className="fa-solid fa-trash-can"></i>
                <span>CLEAR QUEUE</span>
              </button>
            )}
          </div>
        </div>
        <div className="cyber-card-body" style={{ padding: 0 }}>
          <div className="tactical-table-wrapper">
            <table className="tactical-table incident-triage-table">
              <thead>
                <tr>
                  <th>INCIDENT ID</th>
                  <th>TIMESTAMP</th>
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
                    <td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 20px' }}>
                      <i className="fa-solid fa-circle-check text-green" style={{ fontSize: '1.8rem', marginBottom: '8px', display: 'block' }}></i>
                      {statusFilter === 'open' 
                        ? 'No active open incidents. All stations are operating within nominal thresholds.'
                        : `No incidents found matching '${statusFilter.toUpperCase()}' filter.`}
                    </td>
                  </tr>
                ) : (
                  visibleIncidents.map(inc => {
                  const badgeClass = inc.severity === 'critical' || inc.severity === 'high' ? 'badge-critical' : 'badge-suspect';
                  const stateBadge = inc.quality_state === 'GENUINE_EXTREME_CANDIDATE' || inc.quality_state === 'REGIONAL_EVENT' 
                    ? 'badge-extreme' 
                    : inc.quality_state === 'LOCALIZED_ANOMALY' 
                    ? 'badge-critical' 
                    : 'badge-suspect';
                  const statusBadge = inc.status === 'open' ? 'badge-critical' : inc.status === 'acknowledged' ? 'badge-suspect' : 'badge-normal';

                  return (
                    <tr key={inc.id} className="incident-row">
                      <td style={{ fontWeight: 'bold', color: 'var(--neon-cyan)', whiteSpace: 'nowrap' }}>{inc.id}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {new Date(inc.created_at || Date.now()).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 'bold' }}>{inc.station_id}</span>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{inc.station_name}</div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}><code>{inc.variable}</code></td>
                      <td><span className={`cyber-badge ${stateBadge}`}>{inc.quality_state}</span></td>
                      <td style={{ fontWeight: 'bold', color: (inc.fault_risk || 0) >= 0.7 ? 'var(--neon-crimson)' : 'var(--neon-amber)', whiteSpace: 'nowrap' }}>
                        {inc.fault_risk}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {(inc.reason_codes || []).map((rc, idx) => (
                            <span key={idx} className={`cyber-badge ${badgeClass}`} style={{ fontSize: '0.65rem' }}>{rc}</span>
                          ))}
                        </div>
                      </td>
                      <td><span className={`cyber-badge ${statusBadge}`}>{(inc.status || 'open').toUpperCase()}</span></td>
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

