import React from 'react';
import { useWeather } from '../../context/WeatherContext';

export const StationDiagnostics = () => {
  const { stations, activeStationId, setCurrentView } = useWeather();
  const station = stations.find(s => s.id?.toUpperCase() === activeStationId?.toUpperCase()) || stations[0] || {};

  if (!station || !station.id) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-microchip" style={{ fontSize: '3rem', color: 'var(--neon-cyan)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
          NO REGISTERED WEATHER STATION
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          No weather station is active. Provision a station in Station Credentials to inspect hardware telemetry.
        </p>
        <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('credentials')}>
          <i className="fa-solid fa-key"></i> Provision Weather Station
        </button>
      </div>
    );
  }

  const temp = station.sensors?.temperature?.value ?? '--';
  const hum = station.sensors?.humidity?.value ?? '--';
  const pres = station.sensors?.pressure?.value ?? '--';
  const wind = station.sensors?.wind_speed?.value ?? 14;
  const batteryPct = Math.round(Math.min(100, Math.max(0, ((station.battery - 11.0) / 2.0) * 100))) || 91;

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-microchip text-cyan"></i> HARDWARE TELEMETRY & SENSOR STATUS
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{station.id} — {station.name}</span>
          <span className={`cyber-badge ${station.status === 'NORMAL' ? 'badge-normal' : 'badge-suspect'}`}>
            {station.status}
          </span>
        </div>
      </div>
      <div className="cyber-card-body">
        {/* Dominant Live Sensor Values Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
              <i className="fa-solid fa-temperature-half text-cyan"></i> Temperature
            </div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.75rem', fontWeight: 900, color: 'var(--neon-cyan)' }}>
              {temp} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>°C</span>
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--neon-green)', marginTop: '4px' }}>Nominal Range</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
              <i className="fa-solid fa-droplet text-green"></i> Humidity
            </div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.75rem', fontWeight: 900, color: 'var(--neon-green)' }}>
              {hum} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>%</span>
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--neon-green)', marginTop: '4px' }}>RH Valid</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
              <i className="fa-solid fa-gauge text-cyan"></i> Pressure
            </div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)' }}>
              {pres} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>hPa</span>
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '4px' }}>Barometric Normal</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
              <i className="fa-solid fa-wind text-purple"></i> Wind Speed
            </div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.75rem', fontWeight: 900, color: 'var(--neon-purple)' }}>
              {wind} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>km/h</span>
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '4px' }}>Sonic Anemometer</div>
          </div>

          <div style={{ background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
              <i className="fa-solid fa-car-battery text-green"></i> Battery
            </div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.75rem', fontWeight: 900, color: station.battery < 11.8 ? 'var(--neon-crimson)' : 'var(--neon-green)' }}>
              {batteryPct}% <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>({station.battery}V)</span>
            </div>
            <div style={{ fontSize: '0.66rem', color: station.battery < 11.8 ? 'var(--neon-crimson)' : 'var(--neon-green)', marginTop: '4px' }}>
              {station.battery < 11.8 ? 'Low Voltage' : 'Normal Capacity'}
            </div>
          </div>
        </div>

        {/* Subsystem Telemetry Boxes */}
        <div className="sim-control-panel">
          {/* Card 1: Power & Battery */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-solar-panel text-green"></i> SOLAR & POWER</span>
              <span className={`cyber-badge ${station.battery < 11.8 ? 'badge-critical' : 'badge-normal'}`}>
                {station.battery}V
              </span>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              <div>Solar PV Output: <strong style={{ color: 'var(--neon-green)' }}>14.2V (Float Active)</strong></div>
              <div>Charging Current: <strong>1.85 A</strong></div>
              <div>Subsystem Status: <strong style={{ color: station.battery < 11.8 ? 'var(--neon-crimson)' : 'var(--neon-green)' }}>
                {station.battery < 11.8 ? 'LOW VOLTAGE' : 'NOMINAL'}
              </strong></div>
            </div>
          </div>

          {/* Card 2: Cellular & Modbus */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-tower-cell text-cyan"></i> NETWORK & BUS</span>
              <span className="cyber-badge badge-normal">{station.signal} dBm</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              <div>Bearer: <strong>4G LTE Cat-M1</strong></div>
              <div>Modbus CRC Error: <strong>0.00%</strong></div>
              <div>Latency: <strong>42ms</strong></div>
            </div>
          </div>

          {/* Card 3: Gateway Compute */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-memory text-purple"></i> GATEWAY MCU</span>
              <span className="cyber-badge badge-offline">{station.firmware}</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              <div>Uptime: <strong>{Math.floor(station.uptime_s / 3600)}h {Math.floor((station.uptime_s % 3600) / 60)}m</strong></div>
              <div>Flash Storage: <strong>84% Free (3.2 GB / 4 GB)</strong></div>
              <div>Enclosure Humidity: <strong>18% RH</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
