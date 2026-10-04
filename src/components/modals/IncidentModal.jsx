import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';
import { PRIORITY_BADGE, ACTION_LABELS } from '../../utils/incidentTriage';

const EFFECT_STYLE = {
  supports: { icon: 'fa-circle-exclamation', color: 'var(--crimson-alert)', label: 'Points to a fault' },
  against: { icon: 'fa-circle-check', color: 'var(--emerald-success)', label: 'Points to weather / normal' },
  missing: { icon: 'fa-circle-question', color: 'var(--text-muted)', label: 'Evidence missing' },
};

export const IncidentModal = ({ incident, onClose }) => {
  const { adjudicateIncident } = useWeather();

  if (!incident) return null;

  const reasoning = incident.reasoning || null;
  const suggestedAction = reasoning?.suggested_action;

  const handleAction = (action) => {
    if (action === 'REJECT' && suggestedAction && suggestedAction !== 'REJECT'
      && !window.confirm(`The evidence does not support invalidating this reading yet (${reasoning.suggested_action_reason}) Invalidate anyway?`)) {
      return;
    }
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
  const finalAss = evidence.final_assessment || {};
  // Pipeline incidents contain a station-state snapshot; older records use *_evidence.
  const modelPred = evidence.model_prediction || evidence.ml_model || {};
  const recordedPeers = evidence.spatial_data?.nearby_stations || finalAss.fleet_evidence?.peers || [];
  const PARAMETER_META = {
    temp: { key: 'temperature', label: 'Temperature', unit: '°C' },
    hum: { key: 'humidity', label: 'Humidity', unit: '%' },
    pres: { key: 'pressure', label: 'Pressure', unit: ' hPa' },
  };
  const PARAMETER_ORDER = ['temp', 'hum', 'pres'];
  const stationResiduals = Array.isArray(finalAss.residuals) && finalAss.residuals.length === 3 ? finalAss.residuals : null;
  const variablePrefix = String(incident.variable || '').replace('synthetic:', '').split(':')[0];
  // The flagged variable decides which measurement every evidence panel describes.
  const incidentParameter = PARAMETER_META[reasoning?.parameter]
    ? reasoning.parameter
    : PARAMETER_META[variablePrefix]
      ? variablePrefix
      : stationResiduals
        ? PARAMETER_ORDER[stationResiduals.reduce((best, v, i, all) => (Math.abs(v) > Math.abs(all[best]) ? i : best), 0)]
        : 'temp';
  const focus = PARAMETER_META[incidentParameter];
  const focusIndex = PARAMETER_ORDER.indexOf(incidentParameter);
  const observedSensor = evidence.sensors?.[focus.key] || null;
  const spatialEv = evidence.spatial_evidence || {
    closest_peer: recordedPeers[0] || null,
    eligible_peer_count: recordedPeers.length,
    spatial_result: finalAss.fleet_evidence?.fleet_evidence_state || 'UNAVAILABLE',
    agreement_index: evidence.spatial_data?.agreement_index,
  };
  const sensorQC = evidence.sensor_qc_evidence || {
    observed_value: observedSensor?.value,
    unit: observedSensor?.unit,
    qc_result: finalAss.evidence_vector?.z_qc == null ? 'UNKNOWN' : finalAss.evidence_vector.z_qc ? 'SUSPECT' : 'PASS',
    physical_qc: finalAss.evidence_vector?.z_phys == null ? 'UNKNOWN' : finalAss.evidence_vector.z_phys ? 'FAIL' : 'PASS',
    fault_state: finalAss.root_cause,
  };
  // Recorded envelopes and legacy spatial evidence describe temperature only.
  const qcIsForFocus = !evidence.sensor_qc_evidence || incidentParameter === 'temp';
  const focusUnit = incidentParameter === 'temp' && sensorQC.unit ? sensorQC.unit : focus.unit;

  const badgeClass = incident.severity === 'critical' || incident.severity === 'high' ? 'badge-critical' : 'badge-suspect';
  const stateBadge = incident.quality_state === 'LOCALIZED_ANOMALY' 
    ? 'badge-critical' 
    : (incident.quality_state === 'REGIONAL_EVENT' ? 'badge-extreme' : 'badge-suspect');

  const closestPeer = spatialEv.closest_peer;
  const rawPeerId = closestPeer ? (closestPeer.station_id || closestPeer.id) : null;
  const peerStationId = rawPeerId && rawPeerId !== incident.station_id ? rawPeerId : null;
  const peerValue = closestPeer ? (closestPeer[incidentParameter] ?? closestPeer[focus.key] ?? null) : null;
  const peerDistance = closestPeer?.distance_km;
  const targetValue = observedSensor?.value ?? (incidentParameter === 'temp' ? spatialEv.target_temperature : null);
  const targetZ = stationResiduals ? stationResiduals[focusIndex] : null;
  const peerZ = Array.isArray(closestPeer?.residuals) ? closestPeer.residuals[focusIndex] : null;
  const departureGap = targetZ != null && peerZ != null ? Math.abs(targetZ - peerZ) : null;
  const sigma = (z) => (z == null ? 'N/A' : `${z > 0 ? '+' : ''}${Number(z).toFixed(1)}σ`);
  const fmt = (v) => (v == null ? 'N/A' : `${Number(v).toFixed(1)}${focusUnit}`);
  const observedValue = qcIsForFocus ? sensorQC.observed_value : observedSensor?.value;
  // The pipeline stores the expected value and the residual in sigmas, which gives the ±3σ band used for QC.
  const expectedValue = finalAss.expected?.[incidentParameter];
  const observedForBand = finalAss.observed?.[incidentParameter];
  const learnedSigma = targetZ != null && Math.abs(targetZ) > 0.05 && expectedValue != null && observedForBand != null
    ? Math.abs((observedForBand - expectedValue) / targetZ)
    : null;
  const learnedRange = learnedSigma != null ? [expectedValue - 3 * learnedSigma, expectedValue + 3 * learnedSigma] : null;

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
      <div className="cyber-modal" style={{ maxWidth: '880px', width: '95%', padding: '24px' }}>
        <div className="modal-header">
          <div className="modal-title" id="modal-inc-title">
            <i className="fa-solid fa-triangle-exclamation text-crimson"></i> ANOMALY INCIDENT EVIDENCE: {incident.id}
          </div>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" id="modal-inc-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Status Header Strip */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`cyber-badge ${badgeClass}`}>{incident.severity?.toUpperCase()} SEVERITY</span>
            <span className={`cyber-badge ${stateBadge}`}>{incident.quality_state}</span>
            <span className="cyber-badge badge-offline">QUALITY: {finalAss.quality_state || 'SUSPECT'}</span>
            <span className="cyber-badge badge-offline">SEVERITY: {(finalAss.severity || incident.severity || 'UNKNOWN').toString().toUpperCase()}</span>
            <span className="cyber-badge badge-offline">STATION: {incident.station_id} ({incident.station_name})</span>
            <span className="cyber-badge badge-offline">FLAGGED VARIABLE: {focus.label.toUpperCase()}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
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
              padding: '16px'
            }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.75rem', color: 'var(--neon-cyan)', marginBottom: '12px', letterSpacing: '0.5px' }}>
                <i className="fa-solid fa-brain"></i> 1. MODEL PREDICTION
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', lineHeight: '1.6' }}>
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
                    {modelPred.status || (modelPred.has_model ? 'EVALUATED' : 'NOT AVAILABLE')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '4px', marginTop: '2px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Model:</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.68rem' }}>
                    {modelPred.model_id || (modelPred.status === 'ARTIFACT_UNAVAILABLE' ? 'Artifact unavailable' : 'None')}
                  </span>
                </div>
                {!modelPred.has_model && evidence.source_timestamp && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                    No model score was recorded for this observation. Incident evidence is a source-time snapshot.
                  </div>
                )}
              </div>
            </div>

            {/* 2. NEARBY STATION EVIDENCE */}
            <div style={{
              background: 'rgba(5, 8, 17, 0.75)',
              border: '1px solid var(--border-subtle)',
              borderTop: '2px solid #8b5cf6',
              borderRadius: '4px',
              padding: '16px'
            }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.75rem', color: '#a78bfa', marginBottom: '12px', letterSpacing: '0.5px' }}>
                <i className="fa-solid fa-satellite-dish"></i> 2. NEARBY STATION EVIDENCE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', lineHeight: '1.6' }}>
                {closestPeer ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Nearest Peer:</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{peerStationId || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Peer Distance:</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{peerDistance != null ? `${Number(peerDistance).toFixed(1)} km` : 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Eligible Peers:</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{spatialEv.eligible_peer_count ?? recordedPeers.length} (2 required for consensus)</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{focus.label} (Target vs Peer):</span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {fmt(targetValue)} vs {fmt(peerValue)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Departure from Normal:</span>
                      <span style={{ fontWeight: 600, color: departureGap != null && departureGap >= 2 ? 'var(--crimson-alert)' : 'var(--text-primary)' }}>
                        {sigma(targetZ)} vs {sigma(peerZ)}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Agreement Index:</span>
                      <span style={{ color: 'var(--text-primary)', fontSize: '0.68rem' }}>
                        {spatialEv.spatial_analysis?.agreement_index ?? spatialEv.agreement_index ?? 'N/A'}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '24px 0', textAlign: 'center', lineHeight: '1.5' }}>
                      No eligible source-time peer observations within 60 km.<br/>Spatial validation unavailable.
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
              padding: '16px'
            }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.75rem', color: '#facc15', marginBottom: '12px', letterSpacing: '0.5px' }}>
                <i className="fa-solid fa-microchip"></i> 3. SENSOR / QC EVIDENCE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', lineHeight: '1.6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{focus.label} Normal Range:</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {qcIsForFocus && sensorQC.station_normal_min !== null && sensorQC.station_normal_min !== undefined
                      ? `${sensorQC.station_normal_min}${focusUnit} – ${sensorQC.station_normal_max}${focusUnit}`
                      : learnedRange
                        ? `${fmt(learnedRange[0])} – ${fmt(learnedRange[1])}`
                        : evidence.sensor_qc_evidence && qcIsForFocus ? 'Not Calibrated' : 'Not recorded'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Observed Value:</span>
                  <span style={{ fontWeight: 600, color: sensorQC.qc_result === 'OUTSIDE_NORMAL_ENVELOPE' || (targetZ != null && Math.abs(targetZ) >= 3) ? 'var(--crimson-alert)' : 'var(--text-primary)' }}>
                    {observedValue != null ? `${observedValue}${focusUnit}` : 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>QC Result:</span>
                  <span style={{
                    fontWeight: 700,
                    color: !sensorQC.qc_result || sensorQC.qc_result === 'PASS' ? 'var(--emerald-success)' : 'var(--crimson-alert)'
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
            padding: '16px 20px',
            marginTop: '16px',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
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
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '5px', fontFamily: 'var(--font-mono)' }}>
                EVIDENCE COMPLETENESS: {Math.round((finalAss.evidence_completeness ?? 0) * 100)}% | READINESS: {finalAss.readiness?.tier || evidence.readiness?.tier || 'UNKNOWN'}
              </div>
              {finalAss.fusion && (
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                  FUSION SCORE: <strong style={{ color: 'var(--neon-cyan)' }}>{finalAss.fusion.score}</strong> | {finalAss.fusion.coefficient_status}
                </div>
              )}
            </div>
          </div>

          {/* Why this incident was raised */}
          {reasoning && (
            <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '12px 14px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: 'var(--neon-cyan)', marginBottom: '6px' }}>
                <i className="fa-solid fa-magnifying-glass-chart"></i> WHY THIS WAS FLAGGED
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginBottom: '10px', lineHeight: 1.45 }}>
                {reasoning.headline}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {reasoning.factors.map((factor, idx) => {
                  const style = EFFECT_STYLE[factor.effect] || EFFECT_STYLE.missing;
                  return (
                    <li key={idx} style={{ display: 'flex', gap: '8px', fontSize: '0.74rem', lineHeight: 1.4 }}>
                      <i className={`fa-solid ${style.icon}`} title={style.label} style={{ color: style.color, marginTop: '3px' }}></i>
                      <span>
                        <strong style={{ color: 'var(--text-primary)' }}>{factor.title}.</strong>{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>{factor.detail}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {reasoning.caveats.length > 0 && (
                <ul style={{ margin: '10px 0 0', paddingLeft: '18px', fontSize: '0.7rem', color: 'var(--amber-warning, #f59e0b)' }}>
                  {reasoning.caveats.map((caveat, idx) => <li key={idx}>{caveat}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* Structured Reason Codes Strip */}
          {(reasoning?.reason_codes || incident.reason_codes || []).length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                REASON CODES:
              </span>
              {(reasoning?.reason_codes || incident.reason_codes).map((rc, idx) => (
                <span className="cyber-badge badge-suspect" key={idx} style={{ fontSize: '0.68rem' }}>
                  {rc}
                </span>
              ))}
            </div>
          )}

          {/* How to handle it */}
          {reasoning ? (
            <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '12px 14px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: 'var(--neon-cyan)', marginBottom: '6px' }}>
                <i className="fa-solid fa-clipboard-list"></i> HOW TO HANDLE
                <span className={`cyber-badge ${PRIORITY_BADGE[reasoning.priority]}`}>{reasoning.priority} · {reasoning.priority_label}</span>
              </div>
              <ol style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', paddingLeft: '18px', margin: 0, lineHeight: 1.5 }}>
                {reasoning.handling_steps.map((step, idx) => (
                  <li key={idx} style={{ marginBottom: '2px' }}>{step}</li>
                ))}
              </ol>
              <div style={{ marginTop: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Suggested decision: <strong style={{ color: 'var(--neon-cyan)' }}>{ACTION_LABELS[reasoning.suggested_action]}</strong> — {reasoning.suggested_action_reason}
              </div>
            </div>
          ) : resolvedActions.length > 0 && (
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

        {/* Modal Footer */}
        <div className="modal-footer" style={{ marginTop: '24px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '20px' }}>
          {['resolved', 'closed', 'rejected'].includes(incident.status?.toLowerCase()) || incident.action_taken ? (
            <div style={{ width: '100%', textAlign: 'center', padding: '8px', background: 'rgba(0, 255, 102, 0.1)', border: '1px solid var(--emerald-success)', borderRadius: '4px', color: 'var(--emerald-success)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
              <i className="fa-solid fa-lock" style={{ marginRight: '8px' }}></i>
              INCIDENT {incident.status?.toUpperCase()} — Adjudicated {incident.action_taken ? `as ${incident.action_taken}` : ''} by {incident.adjudicated_by || 'Operator'}
            </div>
          ) : (
            <>
              <button className={`cyber-btn btn-sm ${suggestedAction === 'ACKNOWLEDGE' ? 'btn-primary' : ''}`} onClick={() => handleAction('ACKNOWLEDGE')}>
                <i className="fa-solid fa-check"></i> {ACTION_LABELS.ACKNOWLEDGE}{suggestedAction === 'ACKNOWLEDGE' ? ' (Suggested)' : ''}
              </button>
              <button className="cyber-btn btn-sm btn-green" style={suggestedAction === 'GENUINE' ? { boxShadow: '0 0 0 2px var(--emerald-success)' } : undefined} onClick={() => handleAction('GENUINE')}>
                <i className="fa-solid fa-cloud-bolt"></i> {ACTION_LABELS.GENUINE}{suggestedAction === 'GENUINE' ? ' (Suggested)' : ''}
              </button>
              <button className="cyber-btn btn-sm btn-danger" style={suggestedAction === 'REJECT' ? { boxShadow: '0 0 0 2px var(--crimson-alert)' } : undefined} onClick={() => handleAction('REJECT')}>
                <i className="fa-solid fa-ban"></i> {ACTION_LABELS.REJECT}{suggestedAction === 'REJECT' ? ' (Suggested)' : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
