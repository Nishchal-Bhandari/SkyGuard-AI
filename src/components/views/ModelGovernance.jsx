import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const ModelGovernance = () => {
  const { modelRegistry, modelDrift, externalDataLineage, rollbackModel } = useWeather();
  const activeModel = modelRegistry[0] || {};

  const handleDownloadModelCard = (model) => {
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model-card-${model.id}-${Date.now()}.json`;
    a.click();
    tacticalAudio.playSuccess();
  };

  return (
    <>
      <div className="cyber-card">
        <div className="cyber-card-header">
          <div className="cyber-card-title">
            <i className="fa-solid fa-brain text-cyan"></i> ACTIVE PRODUCTION MODEL CARD & AUDIT REGISTER
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="cyber-btn btn-sm" onClick={() => handleDownloadModelCard(activeModel)}>
              <i className="fa-solid fa-download"></i> Download Model Card (JSON)
            </button>
            <button className="cyber-btn btn-sm btn-danger" onClick={() => rollbackModel(activeModel.id)}>
              <i className="fa-solid fa-rotate-left"></i> Emergency Rollback
            </button>
          </div>
        </div>

        <div className="cyber-card-body">
          {/* Model Identification Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px', marginBottom: '14px' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--neon-cyan)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {activeModel.name}
                <span className="cyber-badge badge-normal">{activeModel.status}</span>
                <span className="cyber-badge badge-offline">{activeModel.version}</span>
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                Approved by <strong>{activeModel.approved_by}</strong> on {activeModel.approved_at}
              </div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', background: 'rgba(5,8,17,0.7)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
              <div><strong style={{ color: 'var(--neon-cyan)' }}>DIGITAL SIGNATURE / SHA-256:</strong></div>
              <code style={{ color: 'var(--text-secondary)' }}>{activeModel.sha256}</code>
            </div>
          </div>

          {/* Core Governance Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
            {/* Box 1: Intended Use & Coverage */}
            <div style={{ background: 'rgba(10,15,29,0.6)', border: '1px solid var(--border-subtle)', padding: '14px', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-cyan)', fontWeight: 700, marginBottom: '8px' }}>
                <i className="fa-solid fa-bullseye"></i> INTENDED USE & SCOPE
              </div>
              <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {activeModel.purpose}
              </p>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <strong>Station Scope:</strong> {activeModel.station_coverage}<br />
                <strong>Variables:</strong> {activeModel.variables?.join(', ')}
              </div>
            </div>

            {/* Box 2: Chronological Evaluation Metrics */}
            <div style={{ background: 'rgba(10,15,29,0.6)', border: '1px solid var(--border-subtle)', padding: '14px', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-green)', fontWeight: 700, marginBottom: '8px' }}>
                <i className="fa-solid fa-chart-column"></i> CHRONOLOGICAL VALIDATION METRICS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                <div>Event Precision: <strong style={{ color: 'var(--neon-green)' }}>{activeModel.metrics?.event_precision}</strong></div>
                <div>Event Recall: <strong style={{ color: 'var(--neon-green)' }}>{activeModel.metrics?.event_recall}</strong></div>
                <div>False Alerts: <strong style={{ color: 'var(--neon-amber)' }}>{activeModel.metrics?.false_alerts_per_day}</strong></div>
                <div>Detection Delay: <strong style={{ color: 'var(--neon-cyan)' }}>{activeModel.metrics?.detection_delay}</strong></div>
                <div>Brier Calibration: <strong style={{ color: 'var(--text-primary)' }}>{activeModel.metrics?.calibration_brier}</strong></div>
                <div>Explanations: <strong style={{ color: 'var(--neon-cyan)' }}>{activeModel.metrics?.explanation_completeness}</strong></div>
              </div>
            </div>
          </div>

          {/* Engineered Features & Human Review Policy */}
          <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px' }}>
            <div style={{ background: 'rgba(10,15,29,0.6)', border: '1px solid var(--border-subtle)', padding: '14px', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-purple)', fontWeight: 700, marginBottom: '8px' }}>
                <i className="fa-solid fa-layer-group"></i> VERSIONED FEATURE DEFINITIONS (v1.4)
              </div>
              <ul style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', paddingLeft: '18px', fontFamily: 'var(--font-mono)' }}>
                {activeModel.features?.map((feat, idx) => (
                  <li key={idx} style={{ marginBottom: '3px' }}>{feat}</li>
                ))}
              </ul>
            </div>

            <div style={{ background: 'rgba(10,15,29,0.6)', border: '1px solid var(--border-subtle)', padding: '14px', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-amber)', fontWeight: 700, marginBottom: '8px' }}>
                <i className="fa-solid fa-user-check"></i> HUMAN-IN-THE-LOOP GOVERNANCE
              </div>
              <p style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                {activeModel.human_review_policy}
              </p>
              <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--neon-amber)' }}>
                <strong>Rollback Protocol:</strong> {activeModel.rollback_procedure}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* External Data Lineage */}
      <div className="cyber-card" style={{ marginTop: '14px' }}>
        <div className="cyber-card-header">
          <div className="cyber-card-title">
            <i className="fa-solid fa-satellite text-purple"></i> EXTERNAL METEOROLOGICAL CONTEXT LINEAGE & PROVENANCE
          </div>
          <span className="cyber-badge badge-extreme">CONTEXTUAL EVIDENCE ONLY</span>
        </div>
        <div className="cyber-card-body">
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            External radar echoes and satellite cloud-motion vectors provide contextual storm corroboration to prevent false sensor defect classifications, but are never treated as unverified ground truth.
          </p>
          <div className="tactical-table-wrapper">
            <table className="tactical-table">
              <thead>
                <tr>
                  <th>PROVIDER / PRODUCT</th>
                  <th>ENDPOINT / CADENCE</th>
                  <th>LICENSE / STATUS</th>
                  <th>ALIGNMENT METHOD</th>
                  <th>SYSTEM ROLE</th>
                </tr>
              </thead>
              <tbody>
                {externalDataLineage.map((l, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 'bold', color: 'var(--neon-purple)' }}>
                      {l.provider}
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{l.product}</div>
                    </td>
                    <td>
                      <code>{l.endpoint}</code>
                      <div style={{ fontSize: '0.68rem', color: 'var(--neon-cyan)' }}>{l.access_time}</div>
                    </td>
                    <td><span className="cyber-badge badge-normal">{l.license}</span></td>
                    <td>{l.alignment}</td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--neon-amber)' }}>{l.role_in_system}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};
