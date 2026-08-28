import React, { useEffect, useRef } from 'react';
import { useWeather } from '../../context/WeatherContext';
import L from 'leaflet';

export const FleetMap = () => {
  const { stations, setActiveStationId, setCurrentView } = useWeather();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const linesRef = useRef([]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [20.5937, 78.9629],
        zoom: 5,
        zoomControl: false,
        attributionControl: false
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 18,
        subdomains: 'abcd'
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Clear old layers
    Object.values(markersRef.current).forEach(m => map.removeLayer(m));
    linesRef.current.forEach(l => map.removeLayer(l));
    markersRef.current = {};
    linesRef.current = [];

    // Render station pins
    stations.forEach(st => {
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

      const marker = L.marker([st.lat, st.lon], { icon: customIcon }).addTo(map);

      const popupDiv = document.createElement('div');
      popupDiv.style.background = '#0a0f1d';
      popupDiv.style.color = '#fff';
      popupDiv.style.padding = '10px';
      popupDiv.style.border = '1px solid #00f0ff';
      popupDiv.style.fontFamily = "'JetBrains Mono', monospace";
      popupDiv.style.fontSize = '11px';
      popupDiv.style.borderRadius = '4px';
      popupDiv.style.boxShadow = '0 0 15px rgba(0,240,255,0.4)';

      popupDiv.innerHTML = `
        <div style="font-weight: bold; color: #00f0ff; font-family: 'Orbitron', sans-serif; font-size: 12px; margin-bottom: 4px;">${st.id} - ${st.name}</div>
        <div>Status: <span style="color: ${st.status === 'NORMAL' ? '#00ff66' : st.status === 'SUSPECT' ? '#ffaa00' : '#ff0055'}; font-weight: bold;">${st.status}</span></div>
        <div>Temp: ${st.sensors.temperature.value}°C | Hum: ${st.sensors.humidity.value}%</div>
        <div>Pressure: ${st.sensors.pressure.value} hPa | Rain: ${st.sensors.rainfall.value} mm</div>
        <div>Battery: ${st.battery}V | RSSI: ${st.signal} dBm</div>
      `;

      const inspectBtn = document.createElement('button');
      inspectBtn.style.cssText = 'background: #00f0ff; color: #050811; border: none; padding: 4px 8px; font-weight: bold; font-size: 10px; cursor: pointer; border-radius: 2px; margin-top: 6px;';
      inspectBtn.innerText = 'Inspect Station HUD';
      inspectBtn.onclick = () => {
        setActiveStationId(st.id);
        setCurrentView('station-hud');
      };
      popupDiv.appendChild(inspectBtn);

      marker.bindPopup(popupDiv);
      markersRef.current[st.id] = marker;
    });

    // Draw buddy lines
    stations.forEach(st => {
      (st.trusted_peers || []).forEach(peerId => {
        const peer = stations.find(p => p.id === peerId);
        if (peer) {
          const isSuspect = st.status === "SUSPECT" || peer.status === "SUSPECT";
          const line = L.polyline([[st.lat, st.lon], [peer.lat, peer.lon]], {
            color: isSuspect ? 'rgba(255, 170, 0, 0.4)' : 'rgba(0, 240, 255, 0.35)',
            weight: 1.5,
            dashArray: '4, 6'
          }).addTo(map);
          linesRef.current.push(line);
        }
      });
    });

    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      // Keep map instance or clean on unmount
    };
  }, [stations]);

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-map-location-dot"></i> GEOSPATIAL RADAR & BUDDY VECTOR NETWORK
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className="cyber-badge badge-normal">LIVE MESH ACTIVE</span>
        </div>
      </div>
      <div className="cyber-card-body" style={{ padding: 0 }}>
        <div className="tactical-map-container">
          <div ref={mapContainerRef} id="tactical-map" style={{ height: '100%', width: '100%' }}></div>
          <div className="map-overlay-hud">
            <div className="map-overlay-card">
              <div style={{ fontWeight: 'bold', color: 'var(--neon-cyan)', marginBottom: '6px' }}>
                RADAR LEGEND
              </div>
              <div className="map-legend-item">
                <span className="pulse-dot pulse-green"></span>
                <span>Normal Quality</span>
              </div>
              <div className="map-legend-item">
                <span className="pulse-dot pulse-amber"></span>
                <span>Suspect Anomaly</span>
              </div>
              <div className="map-legend-item">
                <span className="pulse-dot pulse-crimson"></span>
                <span>Critical Sensor Defect</span>
              </div>
              <div className="map-legend-item">
                <span className="pulse-dot" style={{ background: 'var(--neon-purple)', boxShadow: '0 0 8px var(--neon-purple)' }}></span>
                <span>Genuine Extreme Storm</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
