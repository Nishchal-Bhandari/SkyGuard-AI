import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const CommandCenter = () => {
  const {
    stations = [],
    incidents = [],
    setCurrentView,
    setActiveStationId,
    activeStationModels = {},
    syncLiveOpenMeteoData
  } = useWeather();

  const safeStations = Array.isArray(stations) ? stations : [];
  const safeIncidents = Array.isArray(incidents) ? incidents : [];

  const normalCount = safeStations.filter(s => s?.status === 'NORMAL').length;
  const suspectCount = safeStations.filter(s => s?.status === 'SUSPECT' || s?.status === 'CRITICAL' || s?.status === 'LOCALIZED_ANOMALY').length;
  const extremeCount = safeStations.filter(s => s?.status === 'REGIONAL_EVENT' || s?.status === 'EXTREME').length;
  const openIncidents = safeIncidents.filter(i => i?.status === 'open').length;

  const handleViewModel = (stationId) => {
    setActiveStationId(stationId);
    setCurrentView('station-hud');
  };

  const getWmoFlagColor = (flag) => {
    if (flag === 0) return 'var(--neon-green)';
    if (flag === 1) return 'var(--neon-amber)';
    if (flag === 2) return 'var(--neon-red)';
    if (flag === 3) return 'var(--neon-cyan)';
    return 'var(--text-muted)';
  };

  return (
    <>
      {/* Fleet Command Operational Header */}
      <div className="cyber-card" style={{ marginBottom: '14px', background: 'rgba(10, 15, 29, 0.85)', padding: '12px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'rgba(0, 240, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0, 240, 255, 0.3)' }}>
              <i className="fa-solid fa-gauge-high text-cyan"></i>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.92rem', fontWeight: 800, color: 'var(--neon-cyan)' }}>
                SKYGUARD AI — FLEET INTELLIGENCE & SENSOR HEALTH MATRIX
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Monitoring {stations.length} Automatic Weather Stations | Thermodynamic Verification & Real-Time Imputation Active
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="cyber-btn btn-sm"
              onClick={() => setCurrentView('fleet-map')}
              style={{ fontSize: '0.74rem' }}
            >
              <i className="fa-solid fa-map-location-dot"></i> Geospatial Radar
            </button>
            <button
              className="cyber-btn btn-sm btn-primary"
              onClick={() => setCurrentView('credentials')}
              style={{ fontSize: '0.74rem' }}
            >
              <i className="fa-solid fa-key"></i> Provision Station
            </button>
          </div>
        </div>
      </div>

      <div className="metrics-grid-4">
        <div className="cyber-card stat-card green-card">
          <div className="stat-header">
            <span className="stat-label">HEALTHY STATIONS</span>
            <div className="stat-icon"><i className="fa-solid fa-tower-broadcast text-green"></i></div>
          </div>
          <div className="stat-value text-green" id="stat-norm-val">
            {normalCount} <span className="stat-unit">/ {stations.length}</span>
          </div>
          <div className="stat-footer"><span>WMO Class 1 Nominal</span><span className="pulse-dot pulse-green"></span></div>
        </div>

        <div className="cyber-card stat-card amber-card">
          <div className="stat-header">
            <span className="stat-label">LOCALIZED ANOMALIES</span>
            <div className="stat-icon"><i className="fa-solid fa-triangle-exclamation text-amber"></i></div>
          </div>
          <div className="stat-value text-amber" id="stat-susp-val">
            {suspectCount} <span className="stat-unit">STATIONS</span>
          </div>
          <div className="stat-footer"><span>Sensor Drift & Spikes</span><span className="pulse-dot pulse-amber"></span></div>
        </div>

        <div className="cyber-card stat-card purple-card">
          <div className="stat-header">
            <span className="stat-label">REGIONAL WEATHER FRONTS</span>
            <div className="stat-icon"><i className="fa-solid fa-cloud-bolt text-purple"></i></div>
          </div>
          <div className="stat-value text-purple" id="stat-ext-val">
            {extremeCount} <span className="stat-unit">EVENTS</span>
          </div>
          <div className="stat-footer"><span>Peer-Corroborated</span><span className="pulse-dot pulse-green"></span></div>
        </div>

        <div className="cyber-card stat-card threat-card">
          <div className="stat-header">
            <span className="stat-label">OPEN INCIDENTS</span>
            <div className="stat-icon"><i className="fa-solid fa-bell text-crimson"></i></div>
          </div>
          <div className="stat-value text-crimson" id="stat-inc-val">
            {openIncidents} <span className="stat-unit">ACTIVE</span>
          </div>
          <div className="stat-footer"><span>Requires Triage</span><span className="pulse-dot pulse-crimson"></span></div>
        </div>
      </div>

      <div className="cyber-card" style={{ marginTop: '14px' }}>
        <div className="cyber-card-header">
          <div className="cyber-card-title"><i className="fa-solid fa-network-wired"></i> FLEET TELEMETRY, ROOT-CAUSE DIAGNOSIS & SENSOR HEALTH (SHI)</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="cyber-btn btn-sm" onClick={() => setCurrentView('fleet-map')}>
              <i className="fa-solid fa-map"></i> View Geospatial Radar
            </button>
          </div>
        </div>
        <div className="cyber-card-body" style={{ padding: 0 }}>
          {stations.length === 0 ? (
            <div style={{ padding: '36px 20px', textAlign: 'center', background: 'rgba(5,8,17,0.7)', borderRadius: '4px' }}>
              <i className="fa-solid fa-tower-broadcast" style={{ fontSize: '2.2rem', color: 'var(--neon-cyan)', marginBottom: '12px', opacity: 0.8 }}></i>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
                NO WEATHER STATIONS CONFIGURED
              </div>
            </div>
          ) : (
            <div className="tactical-table-wrapper">
              <table className="tactical-table">
                <thead>
                  <tr>
                    <th>STATION ID</th>
                    <th>LOCATION & ELEVATION</th>
                    <th>ASSESSMENT & ROOT CAUSE</th>
                    <th>SENSOR HEALTH (SHI)</th>
                    <th>WMO FLAGS (T/H/P)</th>
                    <th>AIR TEMP (°C)</th>
                    <th>HUMIDITY (%)</th>
                    <th>PRESSURE (hPa)</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {stations.map(st => {
                    const badge = st.status === 'NORMAL' ? 'badge-normal' : (st.status === 'REGIONAL_EVENT' ? 'badge-extreme' : (st.status === 'SUSPECT' ? 'badge-suspect' : 'badge-critical'));
                    const rootCause = st.root_cause_diagnosis?.root_cause || st.final_assessment?.root_cause || 'NOMINAL';
                    const shi = st.sensor_health?.overall_health_score ?? 100;
                    const tFlag = st.sensors?.temperature?.wmo_flag ?? 0;
                    const hFlag = st.sensors?.humidity?.wmo_flag ?? 0;
                    const pFlag = st.sensors?.pressure?.wmo_flag ?? 0;

                    return (
                      <tr key={st.id || st.station_id}>
                        <td style={{ fontWeight: 'bold', color: 'var(--neon-cyan)' }}>{st.id || st.station_id}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{st.name || st.station_name}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            {st.region} • {st.latitude?.toFixed(2)}°N, {st.longitude?.toFixed(2)}°E ({st.elevation || 0}m)
                          </div>
                        </td>
                        <td>
                          <span className={`cyber-badge ${badge}`} style={{ fontSize: '0.68rem', marginRight: '6px' }}>{st.status}</span>
                          <div style={{ fontSize: '0.68rem', color: rootCause === 'NOMINAL' ? 'var(--text-muted)' : 'var(--neon-amber)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                            {rootCause}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: shi >= 80 ? 'var(--neon-green)' : (shi >= 50 ? 'var(--neon-amber)' : 'var(--neon-red)') }}>
                              {shi}%
                            </span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                              ({st.sensor_health?.predictive_maintenance?.degradation_projection_days ?? 180}d projection)
                            </span>
                          </div>
                        </td>
                        <td>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', display: 'flex', gap: '4px' }}>
                            <span style={{ color: getWmoFlagColor(tFlag) }}>T:{tFlag}</span>
                            <span style={{ color: getWmoFlagColor(hFlag) }}>H:{hFlag}</span>
                            <span style={{ color: getWmoFlagColor(pFlag) }}>P:{pFlag}</span>
                          </div>
                        </td>
                        <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                          {st.sensors?.temperature?.value} {st.sensors?.temperature?.unit}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{st.sensors?.humidity?.value} {st.sensors?.humidity?.unit}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{st.sensors?.pressure?.value} {st.sensors?.pressure?.unit}</td>
                        <td>
                          <button className="cyber-btn btn-sm" onClick={() => handleViewModel(st.id || st.station_id)}>
                            <i className="fa-solid fa-radar"></i> Inspect Station
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
