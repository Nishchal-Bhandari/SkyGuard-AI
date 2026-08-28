/**
 * MONSOON SENTINEL - CYBERPUNK CHART & GRAPH CONTROLLER
 * Chart.js Neon Integration
 */

class TacticalCharts {
  constructor(state) {
    this.state = state;
    this.charts = {};
  }

  initStationCharts(stationId) {
    const history = this.state.history[stationId] || [];
    const labels = history.map(h => h.time);
    const temps = history.map(h => h.temperature);
    const hums = history.map(h => h.humidity);
    const pres = history.map(h => h.pressure);
    const rains = history.map(h => h.rainfall);

    // Main multi-sensor trend chart
    const trendCtx = document.getElementById("station-trend-chart");
    if (trendCtx && typeof Chart !== "undefined") {
      if (this.charts.stationTrend) this.charts.stationTrend.destroy();

      this.charts.stationTrend = new Chart(trendCtx, {
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
    }
  }

  initPeerComparisonChart(stationId) {
    const peerCtx = document.getElementById("peer-comparison-chart");
    if (!peerCtx || typeof Chart === "undefined") return;

    const currentStation = this.state.stations.find(s => s.id === stationId);
    if (!currentStation) return;

    const peers = this.state.stations.filter(s => currentStation.trusted_peers.includes(s.id));
    const labels = (this.state.history[stationId] || []).map(h => h.time);

    const datasets = [
      {
        label: `${currentStation.id} (${currentStation.name})`,
        data: (this.state.history[stationId] || []).map(h => h.temperature),
        borderColor: currentStation.status === 'SUSPECT' ? '#ffaa00' : '#00f0ff',
        borderWidth: 2.5,
        pointRadius: 2,
        tension: 0.3
      }
    ];

    peers.forEach((peer, idx) => {
      const colors = ['#a855f7', '#00ff66', '#3b82f6'];
      datasets.push({
        label: `Peer ${peer.id} (${peer.name})`,
        data: (this.state.history[peer.id] || []).map(h => h.temperature),
        borderColor: colors[idx % colors.length],
        borderWidth: 1.5,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0.3
      });
    });

    if (this.charts.peerChart) this.charts.peerChart.destroy();

    this.charts.peerChart = new Chart(peerCtx, {
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
  }

  updateCharts(stationId) {
    if (this.charts.stationTrend && this.state.history[stationId]) {
      const history = this.state.history[stationId];
      this.charts.stationTrend.data.labels = history.map(h => h.time);
      this.charts.stationTrend.data.datasets[0].data = history.map(h => h.temperature);
      this.charts.stationTrend.data.datasets[1].data = history.map(h => h.humidity);
      this.charts.stationTrend.data.datasets[2].data = history.map(h => h.rainfall);
      this.charts.stationTrend.update('none');
    }

    if (this.charts.peerChart && this.state.history[stationId]) {
      const currentStation = this.state.stations.find(s => s.id === stationId);
      if (currentStation) {
        this.charts.peerChart.data.labels = (this.state.history[stationId] || []).map(h => h.time);
        this.charts.peerChart.data.datasets[0].data = (this.state.history[stationId] || []).map(h => h.temperature);
        this.charts.peerChart.update('none');
      }
    }
  }
}

window.tacticalCharts = new TacticalCharts(window.appState);
