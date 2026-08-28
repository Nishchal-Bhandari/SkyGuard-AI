import React from 'react';
import { useWeather } from '../../context/WeatherContext';

export const StationDiagnostics = () => {
  const { stations, activeStationId } = useWeather();
  const station = stations.find(s => s.id === activeStationId) || stations[0] || {};

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-microchip text-cyan"></i> HARDWARE DIAGNOSTICS & ENCLOSURE TELEMETRY
        </div>
        <span className="cyber-badge badge-normal">GATEWAY ONLINE</span>
      </div>
      <div className="cyber-card-body">
        <div className="sim-control-panel">
          {/* Card 1: Power & Battery */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-car-battery text-green"></i> POWER SUBSYSTEM</span>
              <span className={`cyber-badge ${station.battery < 11.8 ? 'badge-critical' : 'badge-normal'}`}>
                {station.battery}V
              </span>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              <div>Solar PV Output: <strong style={{ color: 'var(--neon-green)' }}>14.2V (Float Active)</strong></div>
              <div>Charging Current: <strong>1.85 A</strong></div>
              <div>Battery Health: <strong style={{ color: station.battery < 11.8 ? 'var(--neon-crimson)' : 'var(--neon-green)' }}>
                {station.battery < 11.8 ? 'LOW VOLTAGE FAULT' : '98% CAPACITY'}
              </strong></div>
            </div>
          </div>

          {/* Card 2: Cellular & Modbus */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-tower-cell text-cyan"></i> CELLULAR & MODBUS RS485</span>
              <span className="cyber-badge badge-normal">{station.signal} dBm</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              <div>Network Bearer: <strong>4G LTE Cat-M1 (Airtel IoT)</strong></div>
              <div>Modbus CRC Error Rate: <strong>0.00% (Clean)</strong></div>
              <div>MQTT Publish Latency: <strong>42ms</strong></div>
            </div>
          </div>

          {/* Card 3: Gateway Compute */}
          <div className="sim-box">
            <div className="sim-box-title">
              <span><i className="fa-solid fa-memory text-purple"></i> EDGE GATEWAY MCU</span>
              <span className="cyber-badge badge-offline">{station.firmware}</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              <div>Uptime: <strong>{Math.floor(station.uptime_s / 3600)}h {Math.floor((station.uptime_s % 3600) / 60)}m</strong></div>
              <div>Internal Flash Storage: <strong>84% Free (3.2 GB / 4 GB)</strong></div>
              <div>Enclosure Humidity: <strong>18% RH (Silica Active)</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
