/**
 * MONSOON SENTINEL - TACTICAL GEOSPATIAL MAP CONTROLLER
 * Leaflet Dark Mode with Cyberpunk Neon Station Pins and Buddy Vectors
 */

class TacticalMapController {
  constructor(state) {
    this.state = state;
    this.map = null;
    this.markers = {};
    this.buddyLines = [];
    this.radarCircle = null;
    this.initialized = false;
  }

  init(containerId = "tactical-map") {
    const el = document.getElementById(containerId);
    if (!el || typeof L === "undefined") return;

    if (this.map) {
      try {
        this.map.remove();
      } catch (e) {}
      this.map = null;
    }

    // Center map over India
    this.map = L.map(containerId, {
      center: [20.5937, 78.9629],
      zoom: 5,
      zoomControl: false,
      attributionControl: false
    });

    // Dark cyberpunk basemap tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      subdomains: 'abcd'
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    this.initialized = true;
    this.renderStations();
    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 150);
  }

  renderStations() {
    if (!this.map) return;

    // Clear existing markers & buddy lines
    Object.values(this.markers).forEach(m => this.map.removeLayer(m));
    this.buddyLines.forEach(l => this.map.removeLayer(l));
    this.markers = {};
    this.buddyLines = [];

    this.state.stations.forEach(st => {
      let pinClass = "normal";
      if (st.status === "SUSPECT") pinClass = "suspect";
      else if (st.status === "CRITICAL") pinClass = "critical";
      else if (st.status === "EXTREME") pinClass = "extreme";

      const customIcon = L.divIcon({
        className: 'custom-station-pin',
        html: `<div class="pin-ring ${pinClass}"><div class="pin-center"></div></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const marker = L.marker([st.lat, st.lon], { icon: customIcon }).addTo(this.map);

      const popupContent = `
        <div style="background: #0a0f1d; color: #fff; padding: 10px; border: 1px solid #00f0ff; font-family: 'JetBrains Mono', monospace; font-size: 11px; border-radius: 4px; box-shadow: 0 0 15px rgba(0,240,255,0.4);">
          <div style="font-weight: bold; color: #00f0ff; font-family: 'Orbitron', sans-serif; font-size: 12px; margin-bottom: 4px;">${st.id} - ${st.name}</div>
          <div>Status: <span style="color: ${st.status === 'NORMAL' ? '#00ff66' : st.status === 'SUSPECT' ? '#ffaa00' : '#ff0055'}; font-weight: bold;">${st.status}</span></div>
          <div>Temp: ${st.sensors.temperature.value}°C | Hum: ${st.sensors.humidity.value}%</div>
          <div>Pressure: ${st.sensors.pressure.value} hPa | Rain: ${st.sensors.rainfall.value} mm</div>
          <div>Battery: ${st.battery}V | RSSI: ${st.signal} dBm</div>
          <div style="margin-top: 6px;">
            <button onclick="window.appState.setRole('station_operator', '${st.id}')" style="background: #00f0ff; color: #050811; border: none; padding: 4px 8px; font-weight: bold; font-size: 10px; cursor: pointer; border-radius: 2px;">Inspect Station HUD</button>
          </div>
        </div>
      `;
      marker.bindPopup(popupContent);

      this.markers[st.id] = marker;
    });

    // Draw buddy network lines between trusted peers
    this.state.stations.forEach(st => {
      st.trusted_peers.forEach(peerId => {
        const peer = this.state.stations.find(p => p.id === peerId);
        if (peer) {
          const isSuspect = st.status === "SUSPECT" || peer.status === "SUSPECT";
          const line = L.polyline([[st.lat, st.lon], [peer.lat, peer.lon]], {
            color: isSuspect ? 'rgba(255, 170, 0, 0.4)' : 'rgba(0, 240, 255, 0.35)',
            weight: 1.5,
            dashArray: '4, 6'
          }).addTo(this.map);
          this.buddyLines.push(line);
        }
      });
    });
  }

  focusStation(stationId) {
    const st = this.state.stations.find(s => s.id === stationId);
    if (st && this.map) {
      this.map.setView([st.lat, st.lon], 9, { animate: true });
      if (this.markers[stationId]) {
        this.markers[stationId].openPopup();
      }
    }
  }
}

window.tacticalMap = new TacticalMapController(window.appState);
