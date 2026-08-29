import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';

export const FaultLab = () => {
  const { role, assignedStationId } = useAuth();
  const { injectFault, clearFaults, stations, setCurrentView } = useWeather();

  if (!stations || stations.length === 0) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-vial-virus" style={{ fontSize: '3rem', color: 'var(--neon-amber)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-amber)', fontWeight: 800 }}>
          NO REGISTERED WEATHER STATIONS FOR FAULT INJECTION
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          All mock stations have been removed. Provision a weather station first via Station Credentials to inject synthetic faults.
        </p>
        <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('credentials')}>
          <i className="fa-solid fa-key"></i> Provision Weather Station
        </button>
      </div>
    );
  }

  const targetStation = (role === 'station_operator' && assignedStationId)
    ? assignedStationId
    : stations[0].id;

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
            <button className="cyber-btn btn-sm btn-amber" onClick={() => injectFault(targetStation, 'DRIFT')}>
              Inject Progressive Drift ({targetStation})
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
            <button className="cyber-btn btn-sm btn-primary" onClick={() => injectFault(targetStation, 'FLATLINE')}>
              Inject Flatline ({targetStation})
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
            <button className="cyber-btn btn-sm btn-danger" onClick={() => injectFault(targetStation, 'POWER')}>
              Inject Battery Drop ({targetStation})
            </button>
          </div>

          {/* Card 5: Coherent Storm Front */}
          <div className="sim-box" style={{ gridColumn: 'span 2' }}>
            <div className="sim-box-title">
              <span><i className="fa-solid fa-cloud-bolt text-purple"></i> REGIONAL MONSOON STORM FRONT</span>
              <span className="cyber-badge badge-extreme">GENUINE EXTREME</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Simulates synchronized high rainfall (&gt;30mm), wind gusts (&gt;35km/h), and pressure dip on {targetStation} to test the Multi-Sensor Weather Coherence Gate.
            </p>
            <button className="cyber-btn btn-sm btn-green" onClick={() => injectFault(targetStation, 'STORM')}>
              Trigger Severe Storm Event ({targetStation})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
