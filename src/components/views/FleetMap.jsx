import React, { useEffect, useRef } from 'react';
import { useWeather } from '../../context/WeatherContext';
import { haversineDistance } from '../../utils/spatialEngine';
import L from 'leaflet';

export const FleetMap = () => {
  const { stations, activeStationId, setActiveStationId, setCurrentView, neighborRadiusKm, setNeighborRadiusKm } = useWeather();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const linesRef = useRef([]);
  const circleRef = useRef(null);

  const targetStation = stations.find(s => s.id === activeStationId) || stations[0];

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [targetStation?.lat || 20.5937, targetStation?.lon || 78.9629],
        zoom: 6,
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
    if (circleRef.current) {
      map.removeLayer(circleRef.current);
      circleRef.current = null;
    }
    markersRef.current = {};
    linesRef.current = [];

    // Render station pins
    stations.forEach(st => {
      const isTarget = st.id === activeStationId;
      let pinClass = "normal";
      if (st.status === "SUSPECT") pinClass = "suspect";
      else if (st.status === "CRITICAL") pinClass = "critical";
      else if (st.status === "EXTREME") pinClass = "extreme";

      const customIcon = L.divIcon({
        className: 'custom-station-pin',
        html: `<div class="pin-ring ${pinClass}" style="${isTarget ? 'transform: scale(1.35); box-shadow: 0 0 16px #00f0ff;' : ''}"><div class="pin-center" style="${isTarget ? 'background: #00f0ff;' : ''}"></div></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker([st.lat, st.lon], { icon: customIcon }).addTo(map);

      const popupDiv = document.createElement('div');
      popupDiv.style.background = '#0a0f1d';
      popupDiv.style.color = '#fff';
      popupDiv.style.padding = '10px';
      popupDiv.style.border = isTarget ? '2px solid #00f0ff' : '1px solid var(--border-medium, #334155)';
      popupDiv.style.fontFamily = "'JetBrains Mono', monospace";
      popupDiv.style.fontSize = '11px';
      popupDiv.style.borderRadius = '4px';
      popupDiv.style.boxShadow = '0 0 15px rgba(0,240,255,0.4)';

      popupDiv.innerHTML = `
        <div style="font-weight: bold; color: #00f0ff; font-family: 'Orbitron', sans-serif; font-size: 12px; margin-bottom: 4px;">
          ${st.id} - ${st.name} ${isTarget ? '<span style="color: #ffaa00;">[SELECTED TARGET]</span>' : ''}
        </div>
        <div>Region: <strong style="color: #94a3b8;">${st.region || 'Local'}</strong></div>
        <div>Status: <span style="color: ${st.status === 'NORMAL' ? '#00ff66' : st.status === 'SUSPECT' ? '#ffaa00' : '#ff0055'}; font-weight: bold;">${st.status}</span></div>
        <div>Temp: ${st.sensors.temperature.value}°C | Hum: ${st.sensors.humidity.value}%</div>
        <div>Model: <span style="color: #a855f7;">${st.ml_model?.model_id || 'Rules Only'}</span></div>
        <div>Spatial Assessment: <span style="color: #00f0ff;">${st.final_assessment?.classification || 'NORMAL'}</span></div>
      `;

      const selectBtn = document.createElement('button');
      selectBtn.style.cssText = 'background: #00f0ff; color: #050811; border: none; padding: 4px 8px; font-weight: bold; font-size: 10px; cursor: pointer; border-radius: 2px; margin-top: 6px; margin-right: 6px;';
      selectBtn.innerText = 'Select as Radar Center';
      selectBtn.onclick = () => {
        setActiveStationId(st.id);
      };
      popupDiv.appendChild(selectBtn);

      const inspectBtn = document.createElement('button');
      inspectBtn.style.cssText = 'background: #3b82f6; color: #fff; border: none; padding: 4px 8px; font-weight: bold; font-size: 10px; cursor: pointer; border-radius: 2px; margin-top: 6px;';
      inspectBtn.innerText = 'Open HUD';
      inspectBtn.onclick = () => {
        setActiveStationId(st.id);
        setCurrentView('station-hud');
      };
      popupDiv.appendChild(inspectBtn);

      marker.bindPopup(popupDiv);
      markersRef.current[st.id] = marker;
    });

    // Draw Geodetic Radius Circle around active target station
    if (targetStation && targetStation.lat !== undefined && targetStation.lon !== undefined) {
      circleRef.current = L.circle([targetStation.lat, targetStation.lon], {
        radius: neighborRadiusKm * 1000,
        color: '#00f0ff',
        fillColor: '#00f0ff',
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: '5, 8'
      }).addTo(map);

      // Draw spatial vectors from target to all stations inside radius
      stations.forEach(other => {
        if (other.id === targetStation.id) return;
        if (other.lat === undefined || other.lon === undefined) return;

        const dist = haversineDistance(targetStation.lat, targetStation.lon, other.lat, other.lon);
        if (dist <= neighborRadiusKm) {
          const isPeerSuspect = other.status === "SUSPECT" || other.status === "CRITICAL";
          const vectorLine = L.polyline(
            [[targetStation.lat, targetStation.lon], [other.lat, other.lon]],
            {
              color: isPeerSuspect ? '#ffaa00' : '#00ff66',
              weight: 2,
              dashArray: '4, 4'
            }
          ).addTo(map);

          vectorLine.bindTooltip(`${dist} km (${other.id})`, {
            permanent: true,
            direction: 'center',
            className: 'radar-distance-tooltip'
          });

          linesRef.current.push(vectorLine);
        }
      });
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 150);
  }, [stations, activeStationId, neighborRadiusKm, targetStation]);

  return (
    <div className="cyber-card">
      <div className="cyber-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <div className="cyber-card-title">
          <i className="fa-solid fa-map-location-dot"></i> GEOSPATIAL RADAR & HAVERSINE NEIGHBORHOOD NETWORK
        </div>

        {/* Spatial Radius Control in Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            CENTER: <strong style={{ color: 'var(--neon-cyan)' }}>{targetStation?.id} ({targetStation?.name})</strong> | RADIUS: <strong style={{ color: 'var(--neon-green)' }}>{neighborRadiusKm} km</strong>
          </span>
          <input
            type="range"
            min="10"
            max="200"
            step="5"
            value={neighborRadiusKm}
            onChange={(e) => setNeighborRadiusKm(Number(e.target.value))}
            style={{ cursor: 'pointer', accentColor: 'var(--neon-cyan)', width: '100px' }}
          />
          <button className="cyber-btn btn-sm" onClick={() => setCurrentView('station-hud')} style={{ fontSize: '0.68rem' }}>
            <i className="fa-solid fa-terminal"></i> Open {targetStation?.id} HUD
          </button>
        </div>
      </div>
      <div className="cyber-card-body" style={{ padding: 0 }}>
        <div className="tactical-map-container" style={{ position: 'relative', height: '620px' }}>
          <div ref={mapContainerRef} id="tactical-map" style={{ height: '100%', width: '100%' }}></div>
          <div className="map-overlay-hud">
            <div className="map-overlay-card">
              <div style={{ fontWeight: 'bold', color: 'var(--neon-cyan)', marginBottom: '6px', fontSize: '0.75rem' }}>
                SPATIAL RADAR LEGEND
              </div>
              <div className="map-legend-item">
                <span className="pulse-dot pulse-cyan"></span>
                <span>Active Target ({targetStation?.id})</span>
              </div>
              <div className="map-legend-item">
                <span className="pulse-dot pulse-green"></span>
                <span>Peer Inside Radius (&le; {neighborRadiusKm} km)</span>
              </div>
              <div className="map-legend-item">
                <span className="pulse-dot pulse-amber"></span>
                <span>Suspect / Discrepant Peer</span>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                Click any pin to center geodetic radius circle.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
