import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const QCRules = () => {
  const { qcConfig, setQcConfig } = useWeather();

  const handleSliderChange = (key, value) => {
    setQcConfig(prev => ({
      ...prev,
      [key]: parseFloat(value)
    }));
  };

  const handleSave = () => {
    tacticalAudio.playSuccess();
    alert("QC Physics Calibration Matrix successfully committed to active telemetry pipeline.");
  };

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-sliders text-cyan"></i> CONFIGURABLE QUALITY CONTROL & PHYSICS THRESHOLD MATRIX
        </div>
        <button className="cyber-btn btn-sm btn-primary" onClick={handleSave}>
          <i className="fa-solid fa-floppy-disk"></i> Commit Thresholds
        </button>
      </div>
      <div className="cyber-card-body">
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Deterministic bounds execute prior to ML anomaly inference. Breaches automatically assign structured reason codes and weight into the final evidence fusion formula.
        </p>

        <div className="sim-control-panel">
          {/* Box 1: Thermal Physical Bounds */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-temperature-half text-cyan"></i> TEMPERATURE BOUNDS</span>
              <span className="cyber-badge badge-normal">STAGE 1 QC</span>
            </div>
            <div className="sim-slider-group">
              <div className="sim-slider-label">
                <span>Maximum Allowable Temp:</span>
                <span style={{ color: 'var(--neon-cyan)', fontWeight: 'bold' }}>{qcConfig.temp_max}°C</span>
              </div>
              <input
                type="range"
                className="cyber-slider"
                min="40"
                max="65"
                step="1"
                value={qcConfig.temp_max}
                onChange={(e) => handleSliderChange('temp_max', e.target.value)}
              />
            </div>
            <div className="sim-slider-group">
              <div className="sim-slider-label">
                <span>Max 10-min Delta (Rate-of-Change):</span>
                <span style={{ color: 'var(--neon-amber)', fontWeight: 'bold' }}>{qcConfig.temp_max_rate}°C</span>
              </div>
              <input
                type="range"
                className="cyber-slider"
                min="1.0"
                max="8.0"
                step="0.5"
                value={qcConfig.temp_max_rate}
                onChange={(e) => handleSliderChange('temp_max_rate', e.target.value)}
              />
            </div>
          </div>

          {/* Box 2: Humidity & Pressure */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-droplet text-green"></i> HUMIDITY & STUCK VALUES</span>
              <span className="cyber-badge badge-normal">STAGE 1 QC</span>
            </div>
            <div className="sim-slider-group">
              <div className="sim-slider-label">
                <span>Minimum Plausible Humidity:</span>
                <span style={{ color: 'var(--neon-green)', fontWeight: 'bold' }}>{qcConfig.humidity_min}%</span>
              </div>
              <input
                type="range"
                className="cyber-slider"
                min="1"
                max="20"
                step="1"
                value={qcConfig.humidity_min}
                onChange={(e) => handleSliderChange('humidity_min', e.target.value)}
              />
            </div>
            <div className="sim-slider-group">
              <div className="sim-slider-label">
                <span>Flatline Invariance Window:</span>
                <span style={{ color: 'var(--neon-purple)', fontWeight: 'bold' }}>{qcConfig.flatline_window} cycles</span>
              </div>
              <input
                type="range"
                className="cyber-slider"
                min="3"
                max="12"
                step="1"
                value={qcConfig.flatline_window}
                onChange={(e) => handleSliderChange('flatline_window', e.target.value)}
              />
            </div>
          </div>

          {/* Box 3: Multi-Signal Evidence Fusion Formula Weights */}
          <div className="sim-box" style={{ gridColumn: 'span 2' }}>
            <div className="sim-box-title">
              <span><i className="fa-solid fa-atom text-purple"></i> EVIDENCE FUSION WEIGHT MATRIX</span>
              <span className="cyber-badge badge-extreme">STAGE 4 FUSION</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
              <div className="sim-slider-group">
                <div className="sim-slider-label">
                  <span>Rule Weight:</span>
                  <span style={{ color: 'var(--neon-cyan)' }}>{qcConfig.rule_weight}</span>
                </div>
                <input
                  type="range"
                  className="cyber-slider"
                  min="0.1"
                  max="0.6"
                  step="0.05"
                  value={qcConfig.rule_weight}
                  onChange={(e) => handleSliderChange('rule_weight', e.target.value)}
                />
              </div>
              <div className="sim-slider-group">
                <div className="sim-slider-label">
                  <span>ML Model:</span>
                  <span style={{ color: 'var(--neon-purple)' }}>{qcConfig.model_weight}</span>
                </div>
                <input
                  type="range"
                  className="cyber-slider"
                  min="0.1"
                  max="0.6"
                  step="0.05"
                  value={qcConfig.model_weight}
                  onChange={(e) => handleSliderChange('model_weight', e.target.value)}
                />
              </div>
              <div className="sim-slider-group">
                <div className="sim-slider-label">
                  <span>Spatial Buddy:</span>
                  <span style={{ color: 'var(--neon-amber)' }}>{qcConfig.spatial_weight}</span>
                </div>
                <input
                  type="range"
                  className="cyber-slider"
                  min="0.1"
                  max="0.6"
                  step="0.05"
                  value={qcConfig.spatial_weight}
                  onChange={(e) => handleSliderChange('spatial_weight', e.target.value)}
                />
              </div>
              <div className="sim-slider-group">
                <div className="sim-slider-label">
                  <span>Hardware Health:</span>
                  <span style={{ color: 'var(--neon-crimson)' }}>{qcConfig.health_weight}</span>
                </div>
                <input
                  type="range"
                  className="cyber-slider"
                  min="0.05"
                  max="0.4"
                  step="0.05"
                  value={qcConfig.health_weight}
                  onChange={(e) => handleSliderChange('health_weight', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
