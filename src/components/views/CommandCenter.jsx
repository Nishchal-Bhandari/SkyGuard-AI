import React from 'react';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const CommandCenter = () => {
  const {
    stations,
    incidents,
    setCurrentView,
    setActiveStationId,
    activeStationModels,
    liveApiStatus,
    syncLiveOpenMeteoData
  } = useWeather();

  const normalCount = stations.filter(s => s.status === 'NORMAL').length;
  const suspectCount = stations.filter(s => s.status === 'SUSPECT' || s.status === 'CRITICAL').length;
  const extremeCount = stations.filter(s => s.status === 'EXTREME').length;
  const openIncidents = incidents.filter(i => i.status === 'open').length;

  const handleViewModel = (stationId) => {
    setActiveStationId(stationId);
    setCurrentView('model-governance');
  };

  const handleSyncNow = async () => {
    tacticalAudio.playClick();
    await syncLiveOpenMeteoData();
    tacticalAudio.playSuccess();
  };

  return (
    <>
      {/* Tactical Open-Meteo Real-Time Banner */}
      <div className="cyber-card" style={{ marginBottom: '14px', borderLeft: '4px solid var(--neon-cyan)', background: 'linear-gradient(90deg, rgba(0, 240, 255, 0.05) 0%, rgba(5, 8, 17, 0.8) 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(0, 240, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0, 240, 255, 0.3)' }}>
              <i className="fa-solid fa-cloud-bolt text-cyan" style={{ fontSize: '1.2rem' }}></i>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.92rem', fontWeight: 800, color: 'var(--neon-cyan)', letterSpacing: '0.05em' }}>
                  OPEN-METEO REAL-TIME METEOROLOGICAL INGESTION
                </span>
                <span className={`cyber-badge ${liveApiStatus.isOnline ? 'badge-normal' : 'badge-suspect'}`} style={{ fontSize: '0.65rem' }}>
                  {liveApiStatus.isSyncing ? 'SYNCING API' : liveApiStatus.isOnline ? `API ONLINE (${liveApiStatus.latencyMs}ms)` : 'STANDBY'}
                </span>
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Streaming live atmospheric telemetry (temperature, humidity, surface pressure, wind vectors, precipitation) across station coordinates.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {stations.length === 0 ? (
              <button
                className="cyber-btn btn-sm btn-primary"
                onClick={() => setCurrentView('credentials')}
                style={{ padding: '7px 14px', fontSize: '0.78rem' }}
              >
                <i className="fa-solid fa-key"></i> Provision Weather Station
              </button>
            ) : (
              <>
                <button
                  className="cyber-btn btn-sm"
                  onClick={handleSyncNow}
                  disabled={liveApiStatus.isSyncing}
                  style={{ padding: '6px 12px', fontSize: '0.75rem', borderColor: 'var(--neon-cyan)' }}
                >
                  <i className={`fa-solid fa-arrows-rotate text-cyan ${liveApiStatus.isSyncing ? 'fa-spin' : ''}`}></i> Sync All Live Now
                </button>
                <button
                  className="cyber-btn btn-sm"
                  onClick={() => setCurrentView('credentials')}
                  style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                >
                  <i className="fa-solid fa-plus"></i> Add Custom Station
                </button>
              </>
            )}
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
          <div className="stat-footer"><span>Fleet Operational</span><span className="pulse-dot pulse-green"></span></div>
        </div>

        <div className="cyber-card stat-card amber-card">
          <div className="stat-header">
            <span className="stat-label">QC ANOMALIES FLAGGED</span>
            <div className="stat-icon"><i className="fa-solid fa-triangle-exclamation text-amber"></i></div>
          </div>
          <div className="stat-value text-amber" id="stat-susp-val">
            {suspectCount} <span className="stat-unit">STATIONS</span>
          </div>
          <div className="stat-footer"><span>Suspect Observations</span><span className="pulse-dot pulse-amber"></span></div>
        </div>

        <div className="cyber-card stat-card purple-card">
          <div className="stat-header">
            <span className="stat-label">GENUINE EXTREMES</span>
            <div className="stat-icon"><i className="fa-solid fa-cloud-bolt text-purple"></i></div>
          </div>
          <div className="stat-value text-purple" id="stat-ext-val">
            {extremeCount} <span className="stat-unit">EVENTS</span>
          </div>
          <div className="stat-footer"><span>Multi-Sensor Coherent</span><span className="pulse-dot pulse-green"></span></div>
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

      <div className="cyber-card" style={{ marginTop: '10px' }}>
        <div className="cyber-card-header">
          <div className="cyber-card-title"><i className="fa-solid fa-network-wired"></i> FLEET SENSOR TELEMETRY & LIVE QUALITY MATRIX</div>
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
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '520px', margin: '8px auto 16px auto' }}>
                All existing station data has been removed. Click below to provision a weather station with its geographic coordinates to begin real-time telemetry monitoring.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('credentials')}>
                  <i className="fa-solid fa-key"></i> Provision Weather Station
                </button>
              </div>
            </div>
          ) : (

            <div className="tactical-table-wrapper">
              <table className="tactical-table">
                <thead>
                  <tr>
                    <th>STATION ID</th>
                    <th>LOCATION & COORDINATES</th>
                    <th>WEATHER CONDITION</th>
                    <th>STATUS</th>
                    <th>DEDICATED MODEL</th>
                    <th>TEMPERATURE</th>
                    <th>HUMIDITY</th>
                    <th>PRESSURE</th>
                    <th>RAINFALL</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {stations.map(st => {
                    const badge = st.status === 'NORMAL' ? 'badge-normal' : st.status === 'SUSPECT' ? 'badge-suspect' : st.status === 'CRITICAL' ? 'badge-critical' : 'badge-extreme';
                    const model = activeStationModels[st.id]?.modelCard;
                    const meta = st.weather_meta;

                    return (
                      <tr key={st.id}>
                        <td style={{ fontWeight: 'bold', color: 'var(--neon-cyan)' }}>{st.id}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{st.name}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            {st.region} • {st.lat?.toFixed(2)}°N, {st.lon?.toFixed(2)}°E ({st.elevation || 0}m)
                          </div>
                        </td>
                        <td>
                          {meta ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: meta.color }}>
                              <i className={`fa-solid ${meta.icon}`}></i>
                              <span>{meta.label}</span>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Atmospheric Feed</span>
                          )}
                        </td>
                        <td>
                          <span className={`cyber-badge ${badge}`} id={`live-status-${st.id}`}>{st.status}</span>
                        </td>
                        <td>
                          {model ? (
                            <span className="cyber-badge badge-normal" style={{ fontSize: '0.68rem' }}>
                              {model.model_id}
                            </span>
                          ) : (
                            <span className="cyber-badge badge-offline" style={{ fontSize: '0.68rem' }}>
                              Rules Only
                            </span>
                          )}
                        </td>
                        <td id={`live-temp-${st.id}`} style={{ fontWeight: 600 }}>{st.sensors.temperature.value} {st.sensors.temperature.unit}</td>
                        <td id={`live-hum-${st.id}`}>{st.sensors.humidity.value} {st.sensors.humidity.unit}</td>
                        <td id={`live-pres-${st.id}`}>{st.sensors.pressure.value} {st.sensors.pressure.unit}</td>
                        <td id={`live-rain-${st.id}`}>{st.sensors.rainfall.value} {st.sensors.rainfall.unit}</td>
                        <td>
                          <button className="cyber-btn btn-sm" onClick={() => handleViewModel(st.id)}>
                            <i className="fa-solid fa-brain"></i> Model Profile
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
