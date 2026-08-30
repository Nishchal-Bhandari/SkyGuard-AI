import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

const FAULT_TYPES = [
  {
    id: 'SPIKE',
    name: 'Sensor Spike',
    icon: 'fa-bolt',
    color: 'var(--neon-crimson)',
    badge: 'RATE_FAIL',
    badgeClass: 'badge-critical',
    desc: 'Instant +8.5°C thermal excursion to test rate-of-change QC.',
    param: '+8.5°C instant offset'
  },
  {
    id: 'DRIFT',
    name: 'Thermal Drift',
    icon: 'fa-chart-line',
    color: 'var(--neon-amber)',
    badge: 'DRIFT',
    badgeClass: 'badge-suspect',
    desc: 'Progressive +0.4°C per cycle bias to evaluate ML anomaly creep.',
    param: '+0.4°C / cycle creep'
  },
  {
    id: 'FLATLINE',
    name: 'Sensor Flatline',
    icon: 'fa-snowflake',
    color: 'var(--neon-cyan)',
    badge: 'FLATLINE',
    badgeClass: 'badge-normal',
    desc: 'Locks sensor output invariant to simulate frozen ADC buffer.',
    param: 'Variance = 0.00'
  },
  {
    id: 'POWER',
    name: 'Low Battery',
    icon: 'fa-car-battery',
    color: 'var(--neon-crimson)',
    badge: 'POWER_LOW',
    badgeClass: 'badge-critical',
    desc: 'Drops supply voltage to 10.8V to trigger hardware risk gates.',
    param: '10.8V supply fault'
  },
  {
    id: 'STORM',
    name: 'Regional Event',
    icon: 'fa-cloud-bolt',
    color: 'var(--neon-purple)',
    badge: 'GENUINE EXTREME',
    badgeClass: 'badge-extreme',
    desc: 'Synchronized rainfall (>30mm) & wind (>35km/h) for coherence testing.',
    param: '>30mm rain, >35km/h wind'
  }
];

export const FaultLab = () => {
  const { role, assignedStationId } = useAuth();
  const { injectFault, clearFaults, stations, setCurrentView } = useWeather();
  const [selectedStation, setSelectedStation] = useState(
    (role === 'station_operator' && assignedStationId) ? assignedStationId : (stations[0]?.id || 'AWS-07')
  );
  const [selectedFault, setSelectedFault] = useState('SPIKE');
  const [lastInjected, setLastInjected] = useState(null);

  const isOperator = role === 'station_operator' || role === 'STATION_OPERATOR';

  if (!stations || stations.length === 0) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-vial-virus" style={{ fontSize: '3rem', color: 'var(--neon-amber)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-amber)', fontWeight: 800 }}>
          NO REGISTERED WEATHER STATIONS
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          Provision a weather station first via Station Credentials to inject synthetic stress faults.
        </p>
        <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('credentials')}>
          <i className="fa-solid fa-key"></i> Provision Weather Station
        </button>
      </div>
    );
  }

  const handleInject = () => {
    tacticalAudio.playAlarm();
    injectFault(selectedStation, selectedFault);
    setLastInjected({ station: selectedStation, fault: selectedFault, time: new Date().toLocaleTimeString() });
  };

  const handleReset = () => {
    tacticalAudio.playClick();
    clearFaults(selectedStation);
    setLastInjected(null);
    tacticalAudio.playSuccess();
  };

  return (
    <div className="cyber-card">
      <div className="cyber-card-header">
        <div className="cyber-card-title">
          <i className="fa-solid fa-vial-virus text-amber"></i> SYNTHETIC FAULT INJECTION LAB
        </div>
        <button className="cyber-btn btn-sm btn-danger" onClick={handleReset}>
          <i className="fa-solid fa-rotate-left"></i> Reset Fleet To Normal
        </button>
      </div>
      <div className="cyber-card-body">
        {/* Step 1: Select Station */}
        <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              1. TARGET WEATHER STATION:
            </span>
            <select
              className="cyber-input"
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              disabled={isOperator}
              style={{ background: '#050811', padding: '4px 8px', fontSize: '0.8rem', minWidth: '180px' }}
            >
              {(isOperator && assignedStationId ? stations.filter(s => s.id === assignedStationId) : stations).map(st => (
                <option key={st.id} value={st.id}>{st.id} — {st.name}</option>
              ))}
            </select>
          </div>

          {lastInjected && (
            <div style={{ fontSize: '0.72rem', color: 'var(--neon-crimson)', fontFamily: 'var(--font-mono)' }}>
              <i className="fa-solid fa-triangle-exclamation"></i> Active: <strong>{lastInjected.fault}</strong> on <strong>{lastInjected.station}</strong> at {lastInjected.time}
            </div>
          )}
        </div>

        {/* Step 2: Choose Fault */}
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
          2. SELECT SYNTHETIC FAULT PATTERN:
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          {FAULT_TYPES.map(f => {
            const isSelected = selectedFault === f.id;
            return (
              <div
                key={f.id}
                onClick={() => { setSelectedFault(f.id); tacticalAudio.playClick(); }}
                style={{
                  background: isSelected ? 'rgba(0,240,255,0.06)' : 'rgba(10,15,29,0.7)',
                  border: `1px solid ${isSelected ? 'var(--neon-cyan)' : 'var(--border-subtle)'}`,
                  borderRadius: '6px',
                  padding: '14px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className={`fa-solid ${f.icon}`} style={{ color: f.color, fontSize: '1rem' }}></i>
                    <span style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', fontWeight: 700, color: isSelected ? 'var(--neon-cyan)' : 'var(--text-primary)' }}>
                      {f.name}
                    </span>
                  </div>
                  <span className={`cyber-badge ${f.badgeClass}`} style={{ fontSize: '0.62rem' }}>
                    {f.badge}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '8px', minHeight: '34px' }}>
                  {f.desc}
                </div>
                <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  Param: <strong style={{ color: 'var(--text-primary)' }}>{f.param}</strong>
                </div>
              </div>
            );
          })}
        </div>

        {/* Step 3: Action */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', background: 'rgba(5,8,17,0.7)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '12px 16px' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-cyan)' }}>
              READY TO INJECT: {FAULT_TYPES.find(f => f.id === selectedFault)?.name} → {selectedStation}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Triggers real-time pipeline inference, QC reason coding, and incident queue flagging.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="cyber-btn btn-sm btn-danger" onClick={handleInject} style={{ padding: '7px 16px', fontSize: '0.78rem' }}>
              <i className="fa-solid fa-play"></i> Inject Fault on {selectedStation}
            </button>
            <button className="cyber-btn btn-sm" onClick={() => setCurrentView('incidents')} style={{ fontSize: '0.78rem' }}>
              <i className="fa-solid fa-triangle-exclamation"></i> View Incident Queue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
