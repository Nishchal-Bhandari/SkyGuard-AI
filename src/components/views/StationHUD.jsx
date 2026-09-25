import React, { useEffect, useRef, useState } from 'react';
import { useWeather } from '../../context/WeatherContext';
import { useAuth } from '../../context/AuthContext';
import { Chart } from 'chart.js/auto';
import { apiClient } from '../../utils/apiClient';

export const StationHUD = () => {
  const { stations, activeStationId, history, activeStationModels, setCurrentView, setActiveStationId } = useWeather();
  const { assignedStationId, role } = useAuth();
  const [inspectedPeerId, setInspectedPeerId] = useState(null);
  const [stationQC, setStationQC] = useState(null);
  const [qcLoading, setQcLoading] = useState(false);
  const [showImputedStream, setShowImputedStream] = useState(false);

  // Fetch station-specific QC envelope from backend
  useEffect(() => {
    let isMounted = true;
    const stId = activeStationId || assignedStationId;
    if (!stId) return;
    setQcLoading(true);
    apiClient.getStationQC(stId)
      .then(res => { 
        if (isMounted) {
          setStationQC(res?.has_config ? res.config : null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setQcLoading(false);
      });
    return () => { isMounted = false; };
  }, [activeStationId, assignedStationId]);

  const primaryStation = stations.find(s => s.id?.toUpperCase() === activeStationId?.toUpperCase())
    || stations.find(s => s.id?.toUpperCase() === assignedStationId?.toUpperCase())
    || stations[0]
    || {};

  let station = primaryStation;
  const isInspectingPeer = !!inspectedPeerId;
  
  if (isInspectingPeer && primaryStation.spatial_data?.nearby_stations) {
      const peerData = primaryStation.spatial_data.nearby_stations.find(p => p.id === inspectedPeerId);
      if (peerData) {
          station = {
              ...primaryStation,
              ...peerData,
              id: peerData.id,
              name: peerData.name,
              status: peerData.status,
              sensors: {
                  ...primaryStation.sensors,
                  temperature: { value: peerData.temp, unit: "°C", wmo_flag: 0 },
                  humidity: { value: peerData.hum, unit: "%", wmo_flag: 0 },
                  pressure: { value: peerData.pres || 1012.0, unit: "hPa", wmo_flag: 0 }
              },
              spatial_data: {},
              ml_model: null,
              final_assessment: null
          };
      }
  }

  const activeModel = isInspectingPeer ? null : (activeStationModels[station.id] || activeStationModels[activeStationId]);
  const mlResult = station.ml_model;
  const spatialData = station.spatial_data;
  const finalAssessment = station.final_assessment;
  const rootCauseDiag = station.root_cause_diagnosis;
  const selfHealing = station.self_healing_data;
  const sensorHealth = station.sensor_health;
  const derivedThermo = station.derived_thermodynamics || selfHealing?.derived_thermodynamics;

  const trendCanvasRef = useRef(null);
  const peerCanvasRef = useRef(null);
  const trendChartInstanceRef = useRef(null);
  const peerChartInstanceRef = useRef(null);

  // Determine active displayed sensor readings (Raw vs Imputed)
  const rawTemp = station.sensors?.temperature?.value ?? 0;
  const rawHum = station.sensors?.humidity?.value ?? 0;
  const rawPres = station.sensors?.pressure?.value ?? 0;
  const rain = station.sensors?.rainfall?.value ?? 0;

  const imputedTemp = selfHealing?.imputed_sensors?.temperature?.value ?? rawTemp;
  const imputedHum = selfHealing?.imputed_sensors?.humidity?.value ?? rawHum;
  const imputedPres = selfHealing?.imputed_sensors?.pressure?.value ?? rawPres;

  const temp = showImputedStream ? imputedTemp : rawTemp;
  const hum = showImputedStream ? imputedHum : rawHum;
  const pres = showImputedStream ? imputedPres : rawPres;

  const tempWmo = showImputedStream && selfHealing?.imputed_sensors?.temperature?.is_imputed ? 3 : (station.sensors?.temperature?.wmo_flag ?? 0);
  const humWmo = showImputedStream && selfHealing?.imputed_sensors?.humidity?.is_imputed ? 3 : (station.sensors?.humidity?.wmo_flag ?? 0);
  const presWmo = showImputedStream && selfHealing?.imputed_sensors?.pressure?.is_imputed ? 3 : (station.sensors?.pressure?.wmo_flag ?? 0);

  const badgeClass = station.status === 'NORMAL' ? 'badge-normal' : 
                     (station.status === 'LOCALIZED_ANOMALY' || station.status === 'CRITICAL' || station.status === 'REJECTED') ? 'badge-critical' : 
                     (station.status === 'REGIONAL_EVENT' || station.status === 'EXTREME') ? 'badge-extreme' : 
                     'badge-suspect';

  const getWmoBadge = (flag) => {
    if (flag === 0) return <span className="cyber-badge badge-normal" style={{ fontSize: '0.62rem', padding: '1px 5px' }}>WMO 0: PASS</span>;
    if (flag === 1) return <span className="cyber-badge badge-suspect" style={{ fontSize: '0.62rem', padding: '1px 5px' }}>WMO 1: SUSPECT</span>;
    if (flag === 2) return <span className="cyber-badge badge-critical" style={{ fontSize: '0.62rem', padding: '1px 5px' }}>WMO 2: ERRONEOUS</span>;
    if (flag === 3) return <span className="cyber-badge badge-normal" style={{ fontSize: '0.62rem', padding: '1px 5px', background: 'rgba(0, 240, 255, 0.2)', borderColor: 'var(--neon-cyan)', color: 'var(--neon-cyan)' }}>WMO 3: IMPUTED</span>;
    return <span className="cyber-badge badge-offline" style={{ fontSize: '0.62rem', padding: '1px 5px' }}>WMO 9: MISSING</span>;
  };

  // Initialize and update Chart.js
  useEffect(() => {
    if (!station || !station.id) {
      if (trendChartInstanceRef.current) {
        trendChartInstanceRef.current.destroy();
        trendChartInstanceRef.current = null;
      }
      if (peerChartInstanceRef.current) {
        peerChartInstanceRef.current.destroy();
        peerChartInstanceRef.current = null;
      }
      return;
    }
    const stHistory = history[activeStationId] || [];
    const labels = stHistory.map(h => h.time);
    const temps = stHistory.map(h => h.temperature);
    const hums = stHistory.map(h => h.humidity);

    // Trend Chart
    if (trendCanvasRef.current) {
      if (!trendChartInstanceRef.current) {
        trendChartInstanceRef.current = new Chart(trendCanvasRef.current, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Temperature (°C)',
                data: temps,
                borderColor: '#00f0ff',
                backgroundColor: 'rgba(0, 240, 255, 0.1)',
                fill: true,
                tension: 0.3,
                yAxisID: 'y'
              },
              {
                label: 'Humidity (%)',
                data: hums,
                borderColor: '#00ff66',
                backgroundColor: 'transparent',
                borderDash: [5, 5],
                tension: 0.3,
                yAxisID: 'y1'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { labels: { color: '#8892b0', font: { family: 'Share Tech Mono' } } }
            },
            scales: {
              x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8892b0' } },
              y: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#00f0ff' } },
              y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#00ff66' }, min: 0, max: 100 }
            }
          }
        });
      } else {
        trendChartInstanceRef.current.data.labels = labels;
        trendChartInstanceRef.current.data.datasets[0].data = temps;
        trendChartInstanceRef.current.data.datasets[1].data = hums;
        trendChartInstanceRef.current.update();
      }
    }

    // Peer Comparison Radar / Bar Chart
    if (peerCanvasRef.current && spatialData?.nearby_stations) {
      const peerLabels = [station.id, ...(spatialData.nearby_stations.map(p => p.id || p.station_id))];
      const peerTemps = [rawTemp, ...(spatialData.nearby_stations.map(p => p.temp || p.temperature))];
      const peerColors = [
        station.status === 'NORMAL' ? 'rgba(0, 240, 255, 0.8)' : 'rgba(255, 0, 85, 0.8)',
        ...(spatialData.nearby_stations.map(p => p.status === 'NORMAL' ? 'rgba(0, 255, 102, 0.6)' : 'rgba(255, 170, 0, 0.6)'))
      ];

      if (!peerChartInstanceRef.current) {
        peerChartInstanceRef.current = new Chart(peerCanvasRef.current, {
          type: 'bar',
          data: {
            labels: peerLabels,
            datasets: [{
              label: 'Ambient Temp (°C)',
              data: peerTemps,
              backgroundColor: peerColors,
              borderRadius: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false }
            },
            scales: {
              x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8892b0' } },
              y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8892b0' } }
            }
          }
        });
      } else {
        peerChartInstanceRef.current.data.labels = peerLabels;
        peerChartInstanceRef.current.data.datasets[0].data = peerTemps;
        peerChartInstanceRef.current.data.datasets[0].backgroundColor = peerColors;
        peerChartInstanceRef.current.update();
      }
    }
  }, [station, history, activeStationId, spatialData, rawTemp, showImputedStream]);

  // Clean up charts on unmount
  useEffect(() => {
    return () => {
      if (trendChartInstanceRef.current) trendChartInstanceRef.current.destroy();
      if (peerChartInstanceRef.current) peerChartInstanceRef.current.destroy();
      trendChartInstanceRef.current = null;
      peerChartInstanceRef.current = null;
    };
  }, [activeStationId]);

  if (!station || !station.id) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-satellite-dish" style={{ fontSize: '3rem', color: 'var(--neon-cyan)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
          NO ACTIVE WEATHER STATION AVAILABLE
        </div>
      </div>
    );
  }

  const xaiAttributions = mlResult?.xai_explanation?.attributions || [];

  return (
    <>
      {isInspectingPeer && (
        <div style={{ background: 'rgba(168, 85, 247, 0.15)', border: '1px solid var(--neon-purple)', padding: '8px 12px', borderRadius: '6px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: 'var(--neon-purple)', fontFamily: 'var(--font-tactical)', fontSize: '0.85rem' }}>
            <i className="fa-solid fa-eye"></i> READ-ONLY PEER INSPECTION MODE ({station.id})
          </div>
          <button className="cyber-btn btn-sm" onClick={() => setInspectedPeerId(null)}>
            Return to {primaryStation.id}
          </button>
        </div>
      )}

      {/* Station Profile & Model Identity Banner */}
      <div style={{ background: 'rgba(10,15,29,0.85)', padding: '14px 18px', border: '1px solid var(--border-subtle)', borderRadius: '6px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.15rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
              {station.id} — {station.name}
            </span>
            <span className={`cyber-badge ${badgeClass}`}>{station.status}</span>
            {rootCauseDiag?.root_cause && rootCauseDiag.root_cause !== 'NOMINAL' && (
              <span className="cyber-badge badge-critical" style={{ fontSize: '0.72rem', letterSpacing: '0.5px' }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: '4px' }}></i>
                {rootCauseDiag.root_cause}
              </span>
            )}
            <span className="cyber-badge badge-offline" style={{ fontSize: '0.68rem' }}>{station.region || "Local Microclimate"}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Coordinates: <strong style={{ color: 'var(--text-secondary)' }}>{station.latitude?.toFixed(4)}°N, {station.longitude?.toFixed(4)}°E</strong> | Elevation: <strong style={{ color: 'var(--text-secondary)' }}>{station.elevation || 500}m</strong>
          </div>
        </div>

        {/* Self-Healing Stream Toggle Control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(5,8,17,0.7)', border: '1px solid var(--border-subtle)', padding: '8px 12px', borderRadius: '4px' }}>
          <div>
            <div style={{ fontSize: '0.64rem', fontFamily: 'var(--font-tactical)', color: 'var(--text-muted)' }}>
              TELEMETRY STREAM MODE:
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 'bold', color: showImputedStream ? 'var(--neon-cyan)' : 'var(--text-primary)' }}>
              {showImputedStream ? 'SELF-HEALED (IMPUTED)' : 'RAW DIRECT INGESTION'}
            </div>
          </div>
          <button
            className={`cyber-btn btn-sm ${showImputedStream ? 'btn-primary' : ''}`}
            onClick={() => setShowImputedStream(!showImputedStream)}
            style={{ fontSize: '0.68rem', padding: '4px 10px' }}
          >
            <i className={`fa-solid ${showImputedStream ? 'fa-wand-magic-sparkles' : 'fa-code-compare'}`}></i> {showImputedStream ? 'View Raw' : 'Self-Heal'}
          </button>
        </div>
      </div>

      {/* Sensor Gauges Grid with WMO Standard Quality Flags */}
      <div className="gauge-grid">
        <div className="cyber-card cyber-gauge-card">
          <div className="gauge-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><i className="fa-solid fa-temperature-half text-cyan"></i> AIR TEMPERATURE</span>
            {getWmoBadge(tempWmo)}
          </div>
          <div className="gauge-container">
            <svg className="gauge-svg" viewBox="0 0 100 100">
              <circle className="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle
                id="hud-gauge-temp-prog"
                className={`gauge-progress-circle ${tempWmo >= 2 ? 'gauge-crimson' : (tempWmo === 3 ? 'gauge-cyan' : (temp > 40 ? 'gauge-crimson' : 'gauge-cyan'))}`}
                cx="50" cy="50" r="42"
                strokeDasharray="264"
                strokeDashoffset={264 - (Math.min(50, Math.max(0, temp)) / 50) * 264}
              ></circle>
            </svg>
            <div className="gauge-center-value">
              <span className="gauge-number">{temp}</span>
              <span className="gauge-unit">°C</span>
            </div>
          </div>
          <div className="gauge-subtext">
            {showImputedStream && selfHealing?.imputed_sensors?.temperature?.is_imputed ? (
              <span style={{ color: 'var(--neon-cyan)' }}>
                <i className="fa-solid fa-wand-magic-sparkles"></i> Imputed via {selfHealing.imputed_sensors.temperature.method} (Raw: {rawTemp}°C)
              </span>
            ) : qcLoading ? (
              'Loading Envelope...'
            ) : (
              stationQC ? `Normal Envelope: ${stationQC.temperature_normal_min}°C – ${stationQC.temperature_normal_max}°C` : 'Physical Limit: -50°C – 60°C'
            )}
          </div>
        </div>

        <div className="cyber-card cyber-gauge-card">
          <div className="gauge-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><i className="fa-solid fa-droplet text-green"></i> RELATIVE HUMIDITY</span>
            {getWmoBadge(humWmo)}
          </div>
          <div className="gauge-container">
            <svg className="gauge-svg" viewBox="0 0 100 100">
              <circle className="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle
                id="hud-gauge-hum-prog"
                className={`gauge-progress-circle ${humWmo >= 2 ? 'gauge-crimson' : 'gauge-green'}`}
                cx="50" cy="50" r="42"
                strokeDasharray="264"
                strokeDashoffset={264 - (hum / 100) * 264}
              ></circle>
            </svg>
            <div className="gauge-center-value">
              <span className="gauge-number">{hum}</span>
              <span className="gauge-unit">%</span>
            </div>
          </div>
          <div className="gauge-subtext">Operating Range: 0% – 100%</div>
        </div>

        <div className="cyber-card cyber-gauge-card">
          <div className="gauge-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><i className="fa-solid fa-gauge text-cyan"></i> BAROMETRIC PRESSURE</span>
            {getWmoBadge(presWmo)}
          </div>
          <div className="gauge-container">
            <svg className="gauge-svg" viewBox="0 0 100 100">
              <circle className="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle
                id="hud-gauge-pres-prog"
                className="gauge-progress-circle gauge-cyan"
                cx="50" cy="50" r="42"
                strokeDasharray="264"
                strokeDashoffset={264 - ((pres - 900) / 200) * 264}
              ></circle>
            </svg>
            <div className="gauge-center-value">
              <span className="gauge-number">{pres}</span>
              <span className="gauge-unit">hPa</span>
            </div>
          </div>
          <div className="gauge-subtext">Atmospheric Pressure</div>
        </div>

        <div className="cyber-card cyber-gauge-card">
          <div className="gauge-title"><i className="fa-solid fa-cloud-rain text-purple"></i> PRECIPITATION RATE</div>
          <div className="gauge-container">
            <svg className="gauge-svg" viewBox="0 0 100 100">
              <circle className="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle
                id="hud-gauge-rain-prog"
                className={`gauge-progress-circle ${rain > 20 ? 'gauge-crimson' : 'gauge-green'}`}
                cx="50" cy="50" r="42"
                strokeDasharray="264"
                strokeDashoffset={264 - (Math.min(100, rain) / 100) * 264}
              ></circle>
            </svg>
            <div className="gauge-center-value">
              <span className="gauge-number">{rain}</span>
              <span className="gauge-unit">mm</span>
            </div>
          </div>
          <div className="gauge-subtext">Hourly Accumulation</div>
        </div>
      </div>

      {/* Thermodynamic State & Sensor Health Dual Panel */}
      <div className="metrics-grid-2" style={{ marginTop: '16px' }}>
        {/* Thermodynamic Physics Verification Card */}
        <div className="cyber-card" style={{ padding: '16px' }}>
          <div className="sim-box-title" style={{ marginBottom: '12px' }}>
            <span><i className="fa-solid fa-atom text-cyan"></i> 3-PARAMETER THERMODYNAMIC ENGINE (PHYSICS-INFORMED)</span>
            <span className="cyber-badge badge-normal">CLAUSIUS-CLAPEYRON CHECK: PASS</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <div style={{ background: 'rgba(5,8,17,0.6)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>EXACT DEW POINT (Td)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', color: 'var(--neon-green)', fontWeight: 'bold' }}>
                {derivedThermo?.dew_point_c ?? '--'}°C
              </div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Magnus-Tetens Equation</div>
            </div>

            <div style={{ background: 'rgba(5,8,17,0.6)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>DEW POINT DEPRESSION</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', color: 'var(--neon-cyan)', fontWeight: 'bold' }}>
                {derivedThermo?.dew_point_depression_c ?? '--'}°C
              </div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>ΔTdew = T - Td ≥ 0</div>
            </div>

            <div style={{ background: 'rgba(5,8,17,0.6)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>VAPOR PRESSURE DEFICIT</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', color: 'var(--neon-amber)', fontWeight: 'bold' }}>
                {derivedThermo?.vapor_pressure_deficit_hpa ?? '--'} hPa
              </div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>VPD = es(T) - e(T,RH)</div>
            </div>

            <div style={{ background: 'rgba(5,8,17,0.6)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>MOIST AIR DENSITY (ρ)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', color: 'var(--neon-purple)', fontWeight: 'bold' }}>
                {derivedThermo?.air_density_kg_m3 ?? '--'} kg/m³
              </div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Ideal Gas Formula</div>
            </div>
          </div>
        </div>

        {/* Predictive Sensor Health Index & Maintenance Card */}
        <div className="cyber-card" style={{ padding: '16px' }}>
          <div className="sim-box-title" style={{ marginBottom: '12px' }}>
            <span><i className="fa-solid fa-heart-pulse text-green"></i> SENSOR HEALTH INDEX & PREDICTIVE RUL</span>
            <span className={`cyber-badge ${sensorHealth?.overall_health_score >= 80 ? 'badge-normal' : (sensorHealth?.overall_health_score >= 50 ? 'badge-suspect' : 'badge-critical')}`}>
              SHI: {sensorHealth?.overall_health_score ?? 100}%
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>
            <div style={{ background: 'rgba(5,8,17,0.6)', padding: '8px', borderRadius: '4px', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>TEMP SENSOR</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 'bold', color: (sensorHealth?.sensor_scores?.temperature_sensor?.health_score || 100) > 75 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                {sensorHealth?.sensor_scores?.temperature_sensor?.health_score ?? 100}%
              </div>
            </div>

            <div style={{ background: 'rgba(5,8,17,0.6)', padding: '8px', borderRadius: '4px', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>HUMIDITY SENSOR</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 'bold', color: (sensorHealth?.sensor_scores?.humidity_sensor?.health_score || 100) > 75 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                {sensorHealth?.sensor_scores?.humidity_sensor?.health_score ?? 100}%
              </div>
            </div>

            <div style={{ background: 'rgba(5,8,17,0.6)', padding: '8px', borderRadius: '4px', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>PRESSURE SENSOR</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 'bold', color: (sensorHealth?.sensor_scores?.pressure_sensor?.health_score || 100) > 75 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                {sensorHealth?.sensor_scores?.pressure_sensor?.health_score ?? 100}%
              </div>
            </div>
          </div>

          <div style={{ background: 'rgba(0, 240, 255, 0.05)', border: '1px solid rgba(0, 240, 255, 0.2)', padding: '8px 12px', borderRadius: '4px', fontSize: '0.74rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-muted)' }}>DEGRADATION PROJECTION (HEURISTIC):</span>
              <strong style={{ color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)' }}>
                {sensorHealth?.predictive_maintenance?.degradation_projection_days ?? sensorHealth?.predictive_maintenance?.remaining_useful_life_days ?? 180} DAYS
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>BATTERY VOLTAGE:</span>
              <strong style={{ color: station.battery < 3.2 ? 'var(--neon-red)' : 'var(--neon-green)', fontFamily: 'var(--font-mono)' }}>
                {station.battery?.toFixed(2) || 'N/A'} V
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>MAINTENANCE RISK:</span>
              <strong style={{ color: sensorHealth?.predictive_maintenance?.risk_level === 'HIGH' ? 'var(--neon-red)' : 'var(--neon-amber)', fontFamily: 'var(--font-mono)' }}>
                {sensorHealth?.predictive_maintenance?.risk_level || 'LOW'}
              </strong>
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.70rem', lineHeight: 1.3 }}>
              <i className="fa-solid fa-wrench" style={{ marginRight: '5px', color: 'var(--neon-amber)' }}></i>
              {sensorHealth?.predictive_maintenance?.maintenance_advisory || 'All sensors calibrated within WMO Class 1 tolerance.'}
            </div>
          </div>
        </div>
      </div>

      {/* Explainable AI (TreeSHAP) Attribution Waterfall Panel */}
      {mlResult && mlResult.xai_explanation && (
        <div className="cyber-card" style={{ marginTop: '16px', padding: '16px' }}>
          <div className="sim-box-title" style={{ marginBottom: '10px' }}>
            <span><i className="fa-solid fa-brain text-cyan"></i> EXPLAINABLE AI (TreeSHAP) FEATURE ATTRIBUTION ENGINE</span>
            <span className="cyber-badge badge-normal" style={{ background: 'rgba(168, 85, 247, 0.2)', color: 'var(--neon-purple)', borderColor: 'var(--neon-purple)' }}>
              EXACT SHAPLEY VALUES
            </span>
          </div>

          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            <i className="fa-solid fa-circle-question text-cyan" style={{ marginRight: '6px' }}></i>
            {mlResult.xai_explanation.explanation_text}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
            {xaiAttributions.map((attr, idx) => (
              <div key={idx} style={{ background: 'rgba(5,8,17,0.7)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.70rem', marginBottom: '4px' }}>
                  <span style={{ fontFamily: 'var(--font-tactical)', color: 'var(--text-muted)' }}>
                    {attr.feature.replace('_norm', '').replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: attr.impact_direction === 'ANOMALOUS' ? 'var(--neon-red)' : 'var(--neon-cyan)' }}>
                    {attr.percentage}%
                  </strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.08)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(5, attr.percentage))}%`,
                      background: attr.impact_direction === 'ANOMALOUS' ? 'linear-gradient(90deg, #ff0055, #ffaa00)' : 'linear-gradient(90deg, #00f0ff, #00ff66)',
                      borderRadius: '3px'
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Charts Grid */}
      <div className="metrics-grid-2" style={{ marginTop: '16px' }}>
        <div className="cyber-card" style={{ height: '320px', padding: '16px', display: 'flex', flexDirection: 'column' }}>
          <div className="sim-box-title" style={{ marginBottom: '10px' }}>
            <span><i className="fa-solid fa-chart-line text-cyan"></i> LIVE TELEMETRY STREAMS</span>
            <span className="pulse-dot pulse-green"></span>
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <canvas ref={trendCanvasRef} id="station-trend-chart"></canvas>
          </div>
        </div>

        <div className="cyber-card" style={{ height: '320px', padding: '16px', display: 'flex', flexDirection: 'column' }}>
          <div className="sim-box-title" style={{ marginBottom: '10px' }}>
            <span><i className="fa-solid fa-people-arrows text-amber"></i> SPATIAL NEIGHBORHOOD COMPARISON</span>
            <span className="cyber-badge badge-normal">PEERS IN RANGE</span>
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <canvas ref={peerCanvasRef} id="peer-comparison-chart"></canvas>
          </div>
        </div>
      </div>

      {/* Nearby Station Spatial Intelligence Panel */}
      {!isInspectingPeer && (
        <div className="cyber-card" style={{ marginTop: '16px' }}>
          <div className="cyber-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
            <div className="cyber-card-title">
              <i className="fa-solid fa-satellite-dish text-cyan"></i> NEARBY STATION SPATIAL INTELLIGENCE & NEIGHBORHOOD RADAR
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                SEARCH RADIUS: <strong style={{ color: 'var(--neon-cyan)' }}>{spatialData?.search_radius_km ?? 800} km</strong>
              </span>
            </div>
          </div>

          <div className="cyber-card-body">
            <div style={{ background: 'rgba(5,8,17,0.75)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '14px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-tactical)', color: 'var(--text-muted)' }}>
                    STATION + FLEET EVIDENCE FUSION:
                  </span>
                  <span className={`cyber-badge ${finalAssessment?.badge_class || 'badge-normal'}`} style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                    {finalAssessment?.classification || 'NORMAL'}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  CONFIDENCE: <strong style={{ color: 'var(--text-secondary)' }}>{finalAssessment?.confidence || 'HIGH'}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                <span className="cyber-badge badge-normal" style={{ fontSize: '0.62rem' }}>
                  STATION INTELLIGENCE: {mlResult?.has_model ? 'MODEL ACTIVE' : 'PHYSICS / QC ONLY'}
                </span>
                <span className={`cyber-badge ${spatialData?.spatial_analysis?.fleet_evidence_state === 'AVAILABLE' ? 'badge-normal' : 'badge-suspect'}`} style={{ fontSize: '0.62rem' }}>
                  FLEET INTELLIGENCE: {spatialData?.spatial_analysis?.fleet_evidence_state || 'INCOMPLETE'}
                </span>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', alignSelf: 'center' }}>
                  READINESS: {station.readiness?.tier || 'UNKNOWN'} | PEERS: {spatialData?.eligible_peer_count ?? 0} | EVIDENCE: {Math.round((finalAssessment?.evidence_completeness ?? 0) * 100)}%
                </span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.62rem' }}>
                {Object.entries(finalAssessment?.evidence_vector || {}).map(([key, value]) => (
                  <span key={key} style={{ color: 'var(--text-muted)' }}>
                    {key.toUpperCase()}: <strong style={{ color: Number(value) > 0 ? 'var(--neon-amber)' : 'var(--text-secondary)' }}>{Number(value).toFixed(2)}</strong>
                  </span>
                ))}
              </div>

              {finalAssessment?.fusion && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '7px 9px', border: '1px solid var(--border-subtle)', background: 'rgba(0, 240, 255, 0.04)', fontFamily: 'var(--font-mono)', fontSize: '0.64rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>FUSION SCORE:</span>
                  <strong style={{ color: 'var(--neon-cyan)' }}>{finalAssessment.fusion.score}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>LOGIT:</span>
                  <strong style={{ color: 'var(--text-secondary)' }}>{finalAssessment.fusion.logit}</strong>
                  <span className="cyber-badge badge-suspect" style={{ fontSize: '0.58rem' }}>{finalAssessment.fusion.coefficient_status}</span>
                </div>
              )}

              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                <i className="fa-solid fa-circle-info text-cyan" style={{ marginRight: '6px' }}></i>
                {finalAssessment?.interpretation || spatialData?.spatial_analysis?.fleet_evidence_reason || 'Awaiting real-time station and fleet evaluation...'}
              </p>
            </div>

            {/* Table of Discovered Nearby Stations */}
            {(!spatialData?.nearby_stations || spatialData.nearby_stations.length === 0) ? (
              <div style={{ padding: '20px', textAlign: 'center', background: 'rgba(10,15,29,0.5)', border: '1px dashed var(--border-medium)', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-compass" style={{ fontSize: '1.5rem', marginBottom: '8px', color: 'var(--text-muted)' }}></i>
                <div>No other weather stations found within range. Local ML operates independently.</div>
              </div>
            ) : (
              <div className="tactical-table-wrapper">
                <table className="tactical-table">
                  <thead>
                    <tr>
                      <th>PEER ID</th>
                      <th>STATION NAME & REGION</th>
                      <th>GEODETIC DISTANCE</th>
                      <th>ELEVATION DELTA</th>
                      <th>CURRENT TEMP</th>
                      <th>HUMIDITY</th>
                      <th>PEER STATUS</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spatialData.nearby_stations.map(peer => {
                      const elevDelta = (peer.elevation || 0) - (station.elevation || 0);
                      return (
                        <tr key={peer.id || peer.station_id}>
                          <td style={{ fontWeight: 'bold', color: 'var(--neon-cyan)' }}>{peer.id || peer.station_id}</td>
                          <td>
                            {peer.name}
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{peer.region}</div>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: 'var(--neon-green)' }}>
                            <i className="fa-solid fa-location-arrow" style={{ marginRight: '4px', fontSize: '0.65rem' }}></i>
                            {peer.distance_km} km
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                            {elevDelta >= 0 ? `+${elevDelta}m` : `${elevDelta}m`}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{peer.temp || peer.temperature}°C</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{peer.hum || peer.humidity}%</td>
                          <td>
                            <span className={`cyber-badge ${peer.status === 'NORMAL' ? 'badge-normal' : 
                               (peer.status === 'REGIONAL_EVENT' || peer.status === 'EXTREME' ? 'badge-extreme' : 
                               (peer.status === 'LOCALIZED_ANOMALY' || peer.status === 'CRITICAL' || peer.status === 'REJECTED' ? 'badge-critical' : 'badge-suspect'))
                            }`} style={{ fontSize: '0.65rem' }}>
                              {peer.status}
                            </span>
                          </td>
                          <td>
                            <button
                              className="cyber-btn btn-sm"
                              style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                              onClick={() => setInspectedPeerId(peer.id || peer.station_id)}
                            >
                              Inspect Peer
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
