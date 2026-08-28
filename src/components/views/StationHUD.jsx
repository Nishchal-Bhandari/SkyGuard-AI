import React, { useEffect, useRef } from 'react';
import { useWeather } from '../../context/WeatherContext';
import { Chart } from 'chart.js/auto';

export const StationHUD = () => {
  const { stations, activeStationId, history } = useWeather();
  const station = stations.find(s => s.id === activeStationId) || stations[0] || {};

  const trendCanvasRef = useRef(null);
  const peerCanvasRef = useRef(null);
  const trendChartInstanceRef = useRef(null);
  const peerChartInstanceRef = useRef(null);

  const temp = station.sensors?.temperature?.value ?? 0;
  const hum = station.sensors?.humidity?.value ?? 0;
  const pres = station.sensors?.pressure?.value ?? 0;
  const rain = station.sensors?.rainfall?.value ?? 0;

  const badgeClass = station.status === 'NORMAL' ? 'badge-normal' : station.status === 'SUSPECT' ? 'badge-suspect' : station.status === 'CRITICAL' ? 'badge-critical' : 'badge-extreme';

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

    // Peer Chart
    if (peerCanvasRef.current) {
      const peers = stations.filter(s => (station.trusted_peers || []).includes(s.id));
      const datasets = [
        {
          label: `${station.id} (${station.name})`,
          data: temps,
          borderColor: station.status === 'SUSPECT' ? '#ffaa00' : '#00f0ff',
          borderWidth: 2.5,
          pointRadius: 2,
          tension: 0.3
        }
      ];

      peers.forEach((peer, idx) => {
        const colors = ['#a855f7', '#00ff66', '#3b82f6'];
        datasets.push({
          label: `Peer ${peer.id} (${peer.name})`,
          data: (history[peer.id] || []).map(h => h.temperature),
          borderColor: colors[idx % colors.length],
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          tension: 0.3
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
  }, [history, activeStationId, station, stations]);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(10,15,29,0.7)', padding: '12px 18px', border: '1px solid var(--border-subtle)', borderRadius: '4px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.1rem', color: 'var(--neon-cyan)', fontWeight: 'bold' }}>
            {station.id} - {station.name}
          </span>
          <span className={`cyber-badge ${badgeClass}`}>{station.status}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Coordinates: {station.lat?.toFixed(4)}°N, {station.lon?.toFixed(4)}°E | Elev: {station.elevation}m
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
    </>
  );
};
