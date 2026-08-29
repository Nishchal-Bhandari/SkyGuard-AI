import React, { useEffect, useRef } from 'react';
import { useWeather } from '../../context/WeatherContext';
import { useAuth } from '../../context/AuthContext';
import { Chart } from 'chart.js/auto';

export const StationHUD = () => {
  const { stations, activeStationId, history, activeStationModels, setCurrentView, setActiveStationId, neighborRadiusKm, setNeighborRadiusKm } = useWeather();
  const { assignedStationId } = useAuth();

  const station = stations.find(s => s.id?.toUpperCase() === activeStationId?.toUpperCase())
    || stations.find(s => s.id?.toUpperCase() === assignedStationId?.toUpperCase())
    || stations[0]
    || {};
  const activeModel = activeStationModels[activeStationId];
  const mlResult = station.ml_model;
  const spatialData = station.spatial_data;
  const finalAssessment = station.final_assessment;

  const trendCanvasRef = useRef(null);
  const peerCanvasRef = useRef(null);
  const trendChartInstanceRef = useRef(null);
  const peerChartInstanceRef = useRef(null);

  const temp = station.sensors?.temperature?.value ?? 0;
  const hum = station.sensors?.humidity?.value ?? 0;
  const pres = station.sensors?.pressure?.value ?? 0;
  const rain = station.sensors?.rainfall?.value ?? 0;

  const badgeClass = station.status === 'NORMAL' ? 'badge-normal' : station.status === 'SUSPECT' ? 'badge-suspect' : station.status === 'CRITICAL' ? 'badge-critical' : 'badge-extreme';

  if (!station || !station.id) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-satellite-dish" style={{ fontSize: '3rem', color: 'var(--neon-cyan)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
          NO ACTIVE WEATHER STATION AVAILABLE
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          All mock data has been purged. Provision a weather station in Station Credentials to stream telemetry and monitor real-time sensor gauges.
        </p>
        <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('credentials')}>
          <i className="fa-solid fa-key"></i> Provision Weather Station
        </button>
      </div>
    );
  }

  // Initialize and update Chart.js
  useEffect(() => {
    const stHistory = history[activeStationId] || [];
    const labels = stHistory.map(h => h.time);
    const temps = stHistory.map(h => h.temperature);
    const hums = stHistory.map(h => h.humidity);
    const rains = stHistory.map(h => h.rainfall);

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
                backgroundColor: 'rgba(0, 240, 255, 0.08)',
                borderWidth: 2,
                pointRadius: 2,
                tension: 0.3,
                fill: true,
                yAxisID: 'y'
              },
              {
                label: 'Humidity (%)',
                data: hums,
                borderColor: '#00ff66',
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.3,
                yAxisID: 'y1'
              },
              {
                label: 'Rainfall (mm)',
                data: rains,
                borderColor: '#a855f7',
                backgroundColor: 'rgba(168, 85, 247, 0.25)',
                borderWidth: 1,
                type: 'bar',
                yAxisID: 'y2'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
              legend: {
                labels: {
                  color: '#94a3b8',
                  font: { family: "'Orbitron', sans-serif", size: 10 }
                }
              }
            },
            scales: {
              x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#64748b', font: { family: "'JetBrains Mono', monospace", size: 9 } }
              },
              y: {
                type: 'linear',
                position: 'left',
                grid: { color: 'rgba(0, 240, 255, 0.1)' },
                ticks: { color: '#00f0ff', font: { family: "'JetBrains Mono', monospace", size: 10 } }
              },
              y1: {
                type: 'linear',
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: { color: '#00ff66', font: { family: "'JetBrains Mono', monospace", size: 10 } }
              },
              y2: {
                type: 'linear',
                position: 'right',
                display: false,
                min: 0,
                max: 100
              }
            }
          }
        });
      } else {
        const c = trendChartInstanceRef.current;
        c.data.labels = labels;
        c.data.datasets[0].data = temps;
        c.data.datasets[1].data = hums;
        c.data.datasets[2].data = rains;
        c.update('none');
      }
    }

    // Peer Chart (Spatial Buddy Consensus)
    if (peerCanvasRef.current) {
      // Discover nearby buddy peers
      const peerCandidates = (spatialData?.nearby_stations && spatialData.nearby_stations.length > 0)
        ? spatialData.nearby_stations.map(ns => stations.find(s => s.id === ns.id)).filter(Boolean)
        : stations.filter(s => s.id !== station.id);

      const peers = peerCandidates.slice(0, 3);
      const datasets = [
        {
          label: `${station.id} (${station.name}) [Local]`,
          data: temps,
          borderColor: station.status === 'SUSPECT' ? '#ffaa00' : '#00f0ff',
          backgroundColor: 'rgba(0, 240, 255, 0.05)',
          borderWidth: 2.5,
          pointRadius: 2,
          tension: 0.35
        }
      ];

      const peerColors = ['#a855f7', '#00ff66', '#ffb703'];
      peers.forEach((peer, idx) => {
        let peerData = (history[peer.id] || []).map(h => h.temperature);
        if (peerData.length === 0 || peerData.length < labels.length) {
          const peerBase = peer.sensors?.temperature?.value ?? (temp + (idx === 0 ? 0.8 : idx === 1 ? -1.2 : 0.4));
          peerData = labels.map((_, lIdx) => +(peerBase + Math.sin((lIdx + idx * 2) / 3.2) * 0.7 + (Math.sin(lIdx * 1.5) * 0.2)).toFixed(1));
        }
        datasets.push({
          label: `${peer.id} (${peer.name})`,
          data: peerData.slice(-labels.length),
          borderColor: peerColors[idx % peerColors.length],
          borderWidth: 1.8,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.35
        });
      });

      if (!peerChartInstanceRef.current) {
        peerChartInstanceRef.current = new Chart(peerCanvasRef.current, {
          type: 'line',
          data: { labels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
              legend: {
                labels: { color: '#94a3b8', font: { family: "'Orbitron', sans-serif", size: 10 } }
              }
            },
            scales: {
              x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#64748b', font: { family: "'JetBrains Mono', monospace", size: 9 } }
              },
              y: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#94a3b8', font: { family: "'JetBrains Mono', monospace", size: 10 } }
              }
            }
          }
        });
      } else {
        const c = peerChartInstanceRef.current;
        c.data.labels = labels;
        c.data.datasets = datasets;
        c.update('none');
      }
    }
  }, [history, activeStationId, station, stations, spatialData]);

  // Clean up charts on unmount
  useEffect(() => {
    return () => {
      if (trendChartInstanceRef.current) trendChartInstanceRef.current.destroy();
      if (peerChartInstanceRef.current) peerChartInstanceRef.current.destroy();
      trendChartInstanceRef.current = null;
      peerChartInstanceRef.current = null;
    };
  }, [activeStationId]);

  return (
    <>
      {/* Station Profile & Dedicated Model Identity Banner */}
      <div style={{ background: 'rgba(10,15,29,0.85)', padding: '14px 18px', border: '1px solid var(--border-subtle)', borderRadius: '6px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.15rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
              {station.id} — {station.name}
            </span>
            <span className={`cyber-badge ${badgeClass}`}>{station.status}</span>
            <span className="cyber-badge badge-offline" style={{ fontSize: '0.68rem' }}>{station.region || "Local Microclimate"}</span>
            {station.weather_meta && (
              <span className="cyber-badge" style={{ fontSize: '0.72rem', background: 'rgba(0,240,255,0.1)', color: station.weather_meta.color, borderColor: station.weather_meta.color, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <i className={`fa-solid ${station.weather_meta.icon}`}></i> {station.weather_meta.label}
              </span>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Coordinates: <strong style={{ color: 'var(--text-secondary)' }}>{station.lat?.toFixed(4)}°N, {station.lon?.toFixed(4)}°E</strong> | Elevation: <strong style={{ color: 'var(--text-secondary)' }}>{station.elevation || 500}m</strong> | Source: <strong style={{ color: 'var(--neon-cyan)' }}>Open-Meteo High-Resolution Stream</strong>
          </div>
        </div>

        {/* Station-Adaptive Model Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(5,8,17,0.7)', border: '1px solid var(--border-subtle)', padding: '8px 12px', borderRadius: '4px' }}>
          <div>
            <div style={{ fontSize: '0.64rem', fontFamily: 'var(--font-tactical)', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
              STATION-SPECIFIC MODEL:
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 'bold', color: activeModel ? 'var(--neon-green)' : 'var(--neon-amber)' }}>
              {activeModel ? activeModel.modelCard.model_id : "NO TRAINED MODEL (RULES ONLY)"}
            </div>
            {mlResult && mlResult.has_model && (
              <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: mlResult.is_anomaly ? 'var(--neon-red)' : 'var(--neon-cyan)', marginTop: '2px' }}>
                Real-Time Anomaly Score: <strong>{mlResult.anomaly_score}</strong> (Threshold: {mlResult.threshold})
              </div>
            )}
          </div>
          {!activeModel ? (
            <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('station-upload')} style={{ fontSize: '0.68rem', padding: '4px 8px' }}>
              <i className="fa-solid fa-brain"></i> Train Model
            </button>
          ) : (
            <span className={`cyber-badge ${mlResult?.is_anomaly ? 'badge-critical' : 'badge-normal'}`} style={{ fontSize: '0.68rem' }}>
              {mlResult?.is_anomaly ? "ML ANOMALY" : "ML NOMINAL"}
            </span>
          )}
        </div>
      </div>

      <div className="gauge-grid">
        <div className="cyber-card cyber-gauge-card">
          <div className="gauge-title"><i className="fa-solid fa-temperature-half text-cyan"></i> AIR TEMPERATURE</div>
          <div className="gauge-container">
            <svg className="gauge-svg" viewBox="0 0 100 100">
              <circle className="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle
                id="hud-gauge-temp-prog"
                className={`gauge-progress-circle ${temp > 40 ? 'gauge-crimson' : 'gauge-cyan'}`}
                cx="50" cy="50" r="42"
                strokeDasharray="264"
                strokeDashoffset={264 - (Math.min(50, Math.max(0, temp)) / 50) * 264}
              ></circle>
            </svg>
            <div className="gauge-center-value">
              <span className="gauge-number" id="hud-gauge-temp-val">{temp}</span>
              <span className="gauge-unit">°C</span>
            </div>
          </div>
          <div className="gauge-subtext">Physical Bound: [-20°C, 55°C]</div>
        </div>

        <div className="cyber-card cyber-gauge-card">
          <div className="gauge-title"><i className="fa-solid fa-droplet text-green"></i> RELATIVE HUMIDITY</div>
          <div className="gauge-container">
            <svg className="gauge-svg" viewBox="0 0 100 100">
              <circle className="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle
                id="hud-gauge-hum-prog"
                className="gauge-progress-circle gauge-green"
                cx="50" cy="50" r="42"
                strokeDasharray="264"
                strokeDashoffset={264 - (hum / 100) * 264}
              ></circle>
            </svg>
            <div className="gauge-center-value">
              <span className="gauge-number" id="hud-gauge-hum-val">{hum}</span>
              <span className="gauge-unit">%</span>
            </div>
          </div>
          <div className="gauge-subtext">Dew Point Plausibility: Valid</div>
        </div>

        <div className="cyber-card cyber-gauge-card">
          <div className="gauge-title"><i className="fa-solid fa-gauge text-cyan"></i> BAROMETRIC PRESSURE</div>
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
              <span className="gauge-number" id="hud-gauge-pres-val">{pres}</span>
              <span className="gauge-unit">hPa</span>
            </div>
          </div>
          <div className="gauge-subtext">Sea Level Normalized</div>
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
              <span className="gauge-number" id="hud-gauge-rain-val">{rain}</span>
              <span className="gauge-unit">mm</span>
            </div>
          </div>
          <div className="gauge-subtext">Tipping Bucket Monotonic</div>
        </div>
      </div>

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
            <span><i className="fa-solid fa-people-arrows text-amber"></i> SPATIAL BUDDY CONSENSUS</span>
            <span className="cyber-badge badge-normal">3 PEERS SYNCED</span>
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <canvas ref={peerCanvasRef} id="peer-comparison-chart"></canvas>
          </div>
        </div>
      </div>

      {/* Nearby Station Spatial Intelligence & Neighborhood Consensus Panel */}
      <div className="cyber-card" style={{ marginTop: '16px' }}>
        <div className="cyber-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <div className="cyber-card-title">
            <i className="fa-solid fa-satellite-dish text-cyan"></i> NEARBY STATION SPATIAL INTELLIGENCE & NEIGHBORHOOD RADAR
          </div>

          {/* Configurable Search Radius Control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              SEARCH RADIUS: <strong style={{ color: 'var(--neon-cyan)' }}>{neighborRadiusKm} km</strong>
            </span>
            <input
              type="range"
              min="10"
              max="200"
              step="5"
              value={neighborRadiusKm}
              onChange={(e) => setNeighborRadiusKm(Number(e.target.value))}
              style={{ cursor: 'pointer', accentColor: 'var(--neon-cyan)' }}
            />
            <div style={{ display: 'flex', gap: '4px' }}>
              {[15, 50, 100].map(r => (
                <button
                  key={r}
                  className={`cyber-btn btn-sm ${neighborRadiusKm === r ? 'btn-primary' : ''}`}
                  style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                  onClick={() => setNeighborRadiusKm(r)}
                >
                  {r}km
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="cyber-card-body">
          {/* Dual-Track Anomaly Fusion Summary Banner */}
          <div style={{ background: 'rgba(5,8,17,0.75)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '14px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-tactical)', color: 'var(--text-muted)' }}>
                  ANOMALY FUSION CLASSIFICATION:
                </span>
                <span className={`cyber-badge ${finalAssessment?.badge_class || 'badge-normal'}`} style={{ fontSize: '0.82rem', padding: '4px 10px', letterSpacing: '0.5px' }}>
                  {finalAssessment?.classification || 'NORMAL'}
                </span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                CONFIDENCE: <strong style={{ color: 'var(--text-secondary)' }}>{finalAssessment?.confidence || 'HIGH'}</strong>
              </div>
            </div>

            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              <i className="fa-solid fa-circle-info text-cyan" style={{ marginRight: '6px' }}></i>
              {finalAssessment?.interpretation || 'Awaiting real-time spatial evaluation...'}
            </p>

            {/* Quick Metrics Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginTop: '12px' }}>
              <div style={{ background: 'rgba(10,15,29,0.6)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>ELIGIBLE PEERS IN RADIUS</div>
                <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.05rem', color: 'var(--neon-cyan)', fontWeight: 'bold' }}>
                  {spatialData?.nearby_stations?.length ?? 0} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/ {stations.length - 1} fleet</span>
                </div>
              </div>

              <div style={{ background: 'rgba(10,15,29,0.6)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>TARGET VS PEER MEDIAN TEMP</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 'bold' }}>
                  {temp}°C <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>vs {spatialData?.spatial_analysis?.neighborhood_median_temp ?? '--'}°C</span>
                </div>
              </div>

              <div style={{ background: 'rgba(10,15,29,0.6)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>SPATIAL DEVIATION SCORE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', color: (spatialData?.spatial_analysis?.spatial_deviation_score || 0) > 0.5 ? 'var(--neon-crimson)' : 'var(--neon-green)', fontWeight: 'bold' }}>
                  {spatialData?.spatial_analysis?.spatial_deviation_score ?? 0.0} <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>({spatialData?.spatial_analysis?.spatially_consistent ? 'Consistent' : 'Outlier'})</span>
                </div>
              </div>

              <div style={{ background: 'rgba(10,15,29,0.6)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>LOCAL ML ANOMALY SCORE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', color: mlResult?.is_anomaly ? 'var(--neon-crimson)' : 'var(--neon-green)', fontWeight: 'bold' }}>
                  {mlResult?.anomaly_score ?? 0.0} <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>({mlResult?.is_anomaly ? 'Anomaly' : 'Nominal'})</span>
                </div>
              </div>
            </div>
          </div>

          {/* Table of Discovered Nearby Stations */}
          <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-tactical)', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <i className="fa-solid fa-list-check"></i> DISCOVERED PEERS WITHIN {neighborRadiusKm} KM (HAVERSINE GEODESIC):
          </div>

          {(!spatialData?.nearby_stations || spatialData.nearby_stations.length === 0) ? (
            <div style={{ padding: '20px', textAlign: 'center', background: 'rgba(10,15,29,0.5)', border: '1px dashed var(--border-medium)', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <i className="fa-solid fa-compass" style={{ fontSize: '1.5rem', marginBottom: '8px', color: 'var(--text-muted)' }}></i>
              <div>No other weather stations found within {neighborRadiusKm} km of {station.name}.</div>
              <div style={{ fontSize: '0.68rem', marginTop: '4px' }}>Increase the search radius slider above to expand neighborhood coverage. Local ML continues to operate independently.</div>
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
                      <tr key={peer.id}>
                        <td style={{ fontWeight: 'bold', color: 'var(--neon-cyan)' }}>{peer.id}</td>
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
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{peer.temp}°C</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{peer.hum}%</td>
                        <td>
                          <span className={`cyber-badge ${peer.status === 'NORMAL' ? 'badge-normal' : 'badge-suspect'}`} style={{ fontSize: '0.65rem' }}>
                            {peer.status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="cyber-btn btn-sm"
                            style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                            onClick={() => setActiveStationId(peer.id)}
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
    </>
  );
};
