import React from 'react';
import { useWeather } from '../../context/WeatherContext';

export const FaultLab = () => {
  const { injectFault, clearFaults, stations } = useWeather();

  const targetStation = stations[0]?.id || "AWS-07";

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-vial-virus text-amber"></i> SYNTHETIC FAULT INJECTION & ADVERSARIAL STRESS LAB
        </div>
        <button className="cyber-btn btn-sm btn-danger" onClick={() => clearFaults()}>
          <i className="fa-solid fa-rotate-left"></i> Reset Fleet To Normal
        </button>
      </div>
      <div className="cyber-card-body">
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Simulate real-world hardware failures, progressive calibration drift, and severe weather phenomena in real-time to benchmark the QC Engine and Isolation Forest detector.
        </p>

        <div className="sim-control-panel">
          {/* Card 1: Abrupt Temperature Spike */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-bolt text-crimson"></i> ABRUPT SENSOR SPIKE</span>
              <span className="cyber-badge badge-critical">RATE_FAIL</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Injects instant +8.5°C thermal excursion on {targetStation}. Triggers rate-of-change and spatial buddy anomaly detection.
            </p>
            <button className="cyber-btn btn-sm btn-danger" onClick={() => injectFault(targetStation, 'SPIKE')}>
              Inject +8.5°C Spike ({targetStation})
            </button>
          </div>

          {/* Card 2: Progressive Sensor Bias Drift */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-chart-line text-amber"></i> SENSOR CALIBRATION DRIFT</span>
              <span className="cyber-badge badge-suspect">DRIFT</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Progressively biases temperature by +0.4°C per cycle to test the ML anomaly detector on slow creep failures.
            </p>
            <button className="cyber-btn btn-sm btn-amber" onClick={() => injectFault('AWS-08', 'DRIFT')}>
              Inject Progressive Drift (AWS-08)
            </button>
          </div>

          {/* Card 3: Flatline Freeze */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-snowflake text-cyan"></i> SENSOR FLATLINE FREEZE</span>
              <span className="cyber-badge badge-normal">FLATLINE</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Locks sensor output invariant to simulate frozen analog-to-digital converter (ADC) or stuck datalogger buffer.
            </p>
            <button className="cyber-btn btn-sm btn-primary" onClick={() => injectFault('AWS-09', 'FLATLINE')}>
              Inject Flatline (AWS-09)
            </button>
          </div>

          {/* Card 4: Battery & Power Drop */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-car-battery text-crimson"></i> BATTERY CRITICAL DROP</span>
              <span className="cyber-badge badge-critical">POWER_LOW</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Drops supply voltage to 10.8V and degrades cellular signal to verify hardware health risk scoring.
            </p>
            <button className="cyber-btn btn-sm btn-danger" onClick={() => injectFault('AWS-12', 'POWER')}>
              Inject Battery Drop (AWS-12)
            </button>
          </div>

          {/* Card 5: Coherent Storm Front */}
          <div className="sim-box" style={{ gridColumn: 'span 2' }}>
            <div className="sim-box-title">
              <span><i className="fa-solid fa-cloud-bolt text-purple"></i> REGIONAL MONSOON STORM FRONT</span>
              <span className="cyber-badge badge-extreme">GENUINE EXTREME</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Simulates synchronized high rainfall (&gt;30mm), wind gusts (&gt;35km/h), and pressure dip on AWS-19 to test the Multi-Sensor Weather Coherence Gate.
            </p>
            <button className="cyber-btn btn-sm btn-green" onClick={() => injectFault('AWS-19', 'STORM')}>
              Trigger Severe Storm Event (AWS-19)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
