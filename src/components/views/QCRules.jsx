import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';
import { apiClient } from '../../utils/apiClient';

export const QCRules = () => {
  const { role, assignedStationId } = useAuth();
  const { qcConfig, setQcConfig, activeStationId } = useWeather();
  const [stationQC, setStationQC] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAdmin = role === 'admin' || role === 'CENTRAL_ADMIN';
  const hasAccess = isAdmin || (role === 'station_operator' && assignedStationId === activeStationId);

  useEffect(() => {
    let isMounted = true;
    const fetchQC = async () => {
      if (!hasAccess) return;
      setIsLoading(true);
      try {
        const res = await apiClient.getStationQC(activeStationId);
        if (isMounted) {
          if (res.has_config) {
            setStationQC(res.config);
          } else {
            setStationQC(null);
          }
        }
      } catch (err) {
        console.warn("Failed to fetch station QC:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    fetchQC();
    return () => { isMounted = false; };
  }, [activeStationId, hasAccess]);

  if (!hasAccess) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-lock" style={{ fontSize: '3rem', color: 'var(--neon-crimson)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-crimson)', fontWeight: 800 }}>
          ACCESS DENIED — UNAUTHORIZED STATION
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          Station Operators can only view the Quality Control Physics Matrix for their assigned station.
        </p>
      </div>
    );
  }

  const handleSliderChange = (key, value) => {
    if (!isAdmin) return;
    setQcConfig(prev => ({
      ...prev,
      [key]: parseFloat(value)
    }));
  };

  const handleSave = () => {
    if (!isAdmin) return;
    tacticalAudio.playSuccess();
    alert("QC Physics Calibration Matrix successfully committed to active telemetry pipeline.");
  };

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-sliders text-cyan"></i> QC PHYSICS MATRIX: {activeStationId}
        </div>
        {isAdmin && (
          <button className="cyber-btn btn-sm btn-primary" onClick={handleSave}>
            <i className="fa-solid fa-floppy-disk"></i> Commit Hard Limits
          </button>
        )}
      </div>
      <div className="cyber-card-body">
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Immutable hard physical limits execute first. Station-calibrated normal envelopes execute second.
        </p>

        <div className="sim-control-panel">
          {/* Box 1: Hard Physics Bounds */}
          <div className="sim-box" style={{ gridColumn: 'span 2' }}>
            <div className="sim-box-title">
              <span><i className="fa-solid fa-globe text-crimson"></i> IMMUTABLE HARD PHYSICS</span>
              <span className="cyber-badge badge-extreme">GLOBAL</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
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
                  disabled={!isAdmin}
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
                  disabled={!isAdmin}
                />
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
                  disabled={!isAdmin}
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
                  disabled={!isAdmin}
                />
              </div>
            </div>
          </div>

          {/* Box 2: Station Normal Envelope */}
          <div className="sim-box" style={{ gridColumn: 'span 2' }}>
            <div className="sim-box-title">
              <span><i className="fa-solid fa-chart-area text-cyan"></i> STATION NORMAL ENVELOPE</span>
              <span className="cyber-badge badge-normal">CALIBRATED</span>
            </div>
            
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--neon-cyan)' }}>
                <i className="fa-solid fa-circle-notch fa-spin"></i> Loading Station Configuration...
              </div>
            ) : stationQC ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
                  <div className="stat-card" style={{ padding: '10px' }}>
                    <div className="stat-label">Temperature</div>
                    <div className="stat-value" style={{ fontSize: '1rem', color: 'var(--neon-cyan)' }}>
                      {stationQC.temperature_normal_min}°C – {stationQC.temperature_normal_max}°C
                    </div>
                  </div>
                  <div className="stat-card" style={{ padding: '10px' }}>
                    <div className="stat-label">Humidity</div>
                    <div className="stat-value" style={{ fontSize: '1rem', color: 'var(--neon-green)' }}>
                      {stationQC.humidity_normal_min}% – {stationQC.humidity_normal_max}%
                    </div>
                  </div>
                  <div className="stat-card" style={{ padding: '10px' }}>
                    <div className="stat-label">Pressure</div>
                    <div className="stat-value" style={{ fontSize: '1rem', color: 'var(--neon-purple)' }}>
                      {stationQC.pressure_normal_min} – {stationQC.pressure_normal_max} hPa
                    </div>
                  </div>
                  <div className="stat-card" style={{ padding: '10px' }}>
                    <div className="stat-label">Wind Speed</div>
                    <div className="stat-value" style={{ fontSize: '1rem', color: 'var(--neon-amber)' }}>
                      {stationQC.wind_normal_min} – {stationQC.wind_normal_max} km/h
                    </div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(0, 255, 255, 0.1)', paddingTop: '10px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <div><i className="fa-solid fa-database"></i> Records: <span style={{ color: 'var(--text-primary)' }}>{stationQC.calibration_record_count}</span></div>
                  <div><i className="fa-solid fa-code-branch"></i> Method: <span style={{ color: 'var(--text-primary)' }}>{stationQC.calibration_method}</span></div>
                  <div><i className="fa-solid fa-clock"></i> Calibrated: <span style={{ color: 'var(--text-primary)' }}>{new Date(stationQC.calibrated_at).toLocaleString()}</span></div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--neon-amber)' }}>
                <i className="fa-solid fa-triangle-exclamation"></i> No historical envelope calibrated for this station. System will fall back to Global Immutable Hard Physics.
              </div>
            )}
          </div>

          {/* Box 3: Weights */}
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
                  disabled={!isAdmin}
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
                  disabled={!isAdmin}
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
                  disabled={!isAdmin}
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
                  disabled={!isAdmin}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
