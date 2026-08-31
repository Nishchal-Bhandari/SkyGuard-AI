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

  let evidence = incident.evidence_data || {};
  if (typeof evidence === 'string') {
    try {
      evidence = JSON.parse(evidence);
    } catch (e) {
      evidence = {};
    }
  }
  const modelPred = evidence.model_prediction || {};
  const spatialEv = evidence.spatial_evidence || {};
  const sensorQC = evidence.sensor_qc_evidence || {};
  const finalAss = evidence.final_assessment || {};

  const badgeClass = incident.severity === 'critical' || incident.severity === 'high' ? 'badge-critical' : 'badge-suspect';
  const stateBadge = incident.quality_state === 'LOCALIZED_ANOMALY' 
    ? 'badge-critical' 
    : (incident.quality_state === 'REGIONAL_EVENT' ? 'badge-extreme' : 'badge-suspect');

  const closestPeer = spatialEv.closest_peer;
  const rawPeerId = closestPeer ? (closestPeer.station_id || closestPeer.id) : null;
  const peerStationId = rawPeerId && rawPeerId !== incident.station_id ? rawPeerId : null;
  const peerTemp = closestPeer ? (closestPeer.temperature !== undefined ? closestPeer.temperature : (closestPeer.temp !== undefined ? closestPeer.temp : null)) : null;

  const resolvedActions = (incident.recommended_actions || []).map(act => {
    if (typeof act === 'string' && act.includes('nearest spatial peer network')) {
      if (peerStationId) {
        return `Validate reading against nearest spatial peer network (${peerStationId})`;
      }
      return 'Validate reading against regional peer network';
    }
    return act;
  });

  return (
    <div className="cyber-modal-overlay active">
      <div className="cyber-modal" style={{ maxWidth: '780px', width: '95%' }}>
        <div className="modal-header">
          <div className="modal-title" id="modal-inc-title">
            <i className="fa-solid fa-triangle-exclamation text-crimson"></i> ANOMALY INCIDENT EVIDENCE: {incident.id}
          </div>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" id="modal-inc-content" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Status Header Strip */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`cyber-badge ${badgeClass}`}>{incident.severity?.toUpperCase()} SEVERITY</span>
            <span className={`cyber-badge ${stateBadge}`}>{incident.quality_state}</span>
            <span className="cyber-badge badge-offline">STATION: {incident.station_id} ({incident.station_name})</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {new Date(incident.created_at).toLocaleString()}
            </span>
          </div>

          {/* Three Evidence Factors Panel */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '10px'
          }}>
            {/* 1. MODEL PREDICTION */}
            <div style={{
              background: 'rgba(5, 8, 17, 0.75)',
              border: '1px solid var(--border-subtle)',
              borderTop: '2px solid var(--neon-cyan)',
              borderRadius: '4px',
              padding: '10px 12px'
            }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: 'var(--neon-cyan)', marginBottom: '8px', letterSpacing: '0.5px' }}>
                <i className="fa-solid fa-brain"></i> 1. MODEL PREDICTION
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.74rem', fontFamily: 'var(--font-mono)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Anomaly Score:</span>
                  <span style={{ fontWeight: 600, color: modelPred.is_anomaly ? 'var(--crimson-alert)' : 'var(--text-primary)' }}>
                    {modelPred.anomaly_score !== null && modelPred.anomaly_score !== undefined ? modelPred.anomaly_score : 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Threshold:</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {modelPred.threshold !== null && modelPred.threshold !== undefined ? modelPred.threshold : 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>ML Result:</span>
                  <span style={{
                    fontWeight: 700,
                    color: modelPred.status === 'ANOMALY' 
                      ? 'var(--crimson-alert)' 
                      : (modelPred.status === 'NORMAL' ? 'var(--emerald-success)' : 'var(--text-muted)')
                  }}>
                    {modelPred.status || (modelPred.has_model ? 'EVALUATED' : 'UNTRAINED')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '4px', marginTop: '2px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Model:</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.68rem' }}>
                    {modelPred.model_id || 'None'}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. NEARBY STATION EVIDENCE */}
            <div style={{
              background: 'rgba(5, 8, 17, 0.75)',
              border: '1px solid var(--border-subtle)',
              borderTop: '2px solid #8b5cf6',
              borderRadius: '4px',
              padding: '10px 12px'
            }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: '#a78bfa', marginBottom: '8px', letterSpacing: '0.5px' }}>
                <i className="fa-solid fa-satellite-dish"></i> 2. NEARBY STATION EVIDENCE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.74rem', fontFamily: 'var(--font-mono)' }}>
                {closestPeer ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Nearest Peer:</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{peerStationId || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Peer Distance:</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{closestPeer.distance_km} km</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Target vs Peer:</span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {spatialEv.target_temperature !== undefined ? `${spatialEv.target_temperature}${sensorQC.unit || '°C'}` : 'N/A'} vs {peerTemp !== null ? `${peerTemp}${sensorQC.unit || '°C'}` : 'N/A'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Spatial Deviation:</span>
                      <span style={{ fontWeight: 600, color: spatialEv.spatial_deviation > 3.0 ? 'var(--crimson-alert)' : 'var(--text-primary)' }}>
                        {spatialEv.spatial_deviation}{sensorQC.unit || '°C'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '4px', marginTop: '2px' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Spatial Result:</span>
                      <span style={{
                        fontWeight: 700,
                        fontSize: '0.7rem',
                        color: spatialEv.spatial_result === 'CONTRADICTED' ? 'var(--crimson-alert)' : (spatialEv.spatial_result === 'CONSISTENT' ? 'var(--emerald-success)' : 'var(--text-muted)')
                      }}>
                        {spatialEv.spatial_result}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', padding: '4px 0' }}>
                      No eligible stations within 60 km radius. Spatial validation unavailable.
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '4px', marginTop: '2px' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Spatial Result:</span>
                      <span style={{
                        fontWeight: 700,
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)'
                      }}>
                        {spatialEv.spatial_result || 'UNAVAILABLE'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 3. SENSOR / QC EVIDENCE */}
            <div style={{
              background: 'rgba(5, 8, 17, 0.75)',
              border: '1px solid var(--border-subtle)',
              borderTop: '2px solid #eab308',
              borderRadius: '4px',
              padding: '10px 12px'
            }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: '#facc15', marginBottom: '8px', letterSpacing: '0.5px' }}>
                <i className="fa-solid fa-microchip"></i> 3. SENSOR / QC EVIDENCE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.74rem', fontFamily: 'var(--font-mono)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Normal Envelope:</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {sensorQC.station_normal_min !== null && sensorQC.station_normal_min !== undefined
                      ? `${sensorQC.station_normal_min}${sensorQC.unit || '°C'} – ${sensorQC.station_normal_max}${sensorQC.unit || '°C'}`
                      : 'Not Calibrated'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Observed Value:</span>
                  <span style={{ fontWeight: 600, color: sensorQC.qc_result === 'OUTSIDE_NORMAL_ENVELOPE' ? 'var(--crimson-alert)' : 'var(--text-primary)' }}>
                    {sensorQC.observed_value !== undefined ? `${sensorQC.observed_value}${sensorQC.unit || '°C'}` : 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>QC Result:</span>
                  <span style={{
                    fontWeight: 700,
                    color: sensorQC.qc_result === 'OUTSIDE_NORMAL_ENVELOPE' ? 'var(--crimson-alert)' : 'var(--emerald-success)'
                  }}>
                    {sensorQC.qc_result ? sensorQC.qc_result.replace(/_/g, ' ') : 'PASS'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Physical Limits:</span>
                  <span style={{ color: sensorQC.physical_qc === 'PASS' ? 'var(--emerald-success)' : 'var(--crimson-alert)' }}>
                    {sensorQC.physical_qc || 'PASS'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '4px', marginTop: '2px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Fault State:</span>
                  <span style={{
                    fontWeight: 600,
                    fontSize: '0.68rem',
                    color: sensorQC.fault_state && sensorQC.fault_state !== 'NONE_DETECTED' ? 'var(--amber-warning, #f59e0b)' : 'var(--text-muted)'
                  }}>
                    {sensorQC.fault_state || 'NONE_DETECTED'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Evidence Fusion & Final Assessment */}
          <div style={{
            background: 'rgba(5, 8, 17, 0.85)',
            border: '1px solid var(--neon-cyan)',
            borderRadius: '4px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            flexWrap: 'wrap'
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
                FINAL EVIDENCE FUSION ASSESSMENT:
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <span className={`cyber-badge ${finalAss.badge_class || stateBadge}`} style={{ fontSize: '0.82rem', padding: '3px 10px' }}>
                  {finalAss.classification || incident.quality_state}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  CONFIDENCE: <strong style={{ color: 'var(--neon-cyan)' }}>{finalAss.confidence || 'HIGH'}</strong>
                </span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: '220px', borderLeft: '1px solid var(--border-subtle)', paddingLeft: '14px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                SYSTEM INTERPRETATION:
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', marginTop: '2px', fontStyle: 'italic' }}>
                "{finalAss.interpretation || incident.explanation}"
              </div>
            </div>
          </div>

          {/* Structured Reason Codes Strip */}
          {incident.reason_codes && incident.reason_codes.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                REASON CODES:
              </span>
              {incident.reason_codes.map((rc, idx) => (
                <span className="cyber-badge badge-suspect" key={idx} style={{ fontSize: '0.68rem' }}>
                  {rc}
                </span>
              ))}
            </div>
          )}

          {/* Recommended Operator Actions */}
          {resolvedActions && resolvedActions.length > 0 && (
            <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px 14px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: 'var(--neon-cyan)', marginBottom: '4px' }}>
                RECOMMENDED OPERATOR ACTIONS:
              </div>
              <ul style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', paddingLeft: '18px', margin: 0 }}>
                {resolvedActions.map((act, idx) => (
                  <li key={idx} style={{ marginBottom: '2px' }}>{act}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Modal Footer — EXACT EXISTING 3 OPERATOR ACTIONS */}
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
