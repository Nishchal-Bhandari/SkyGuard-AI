import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const Sidebar = ({ collapsed, setCollapsed }) => {
  const { role, user, logout } = useAuth();
  const { currentView, setCurrentView, incidents, offlineBuffer, activeStationId } = useWeather();
  const [audioActive, setAudioActive] = useState(true);

  const toggleSidebar = (e) => {
    e?.stopPropagation();
    setCollapsed(prev => !prev);
    tacticalAudio.playClick();
  };

  const toggleAudio = () => {
    const active = tacticalAudio.toggle();
    setAudioActive(active);
  };

  const handleLogout = () => {
    tacticalAudio.playAlarm();
    logout();
  };

  const handleNavClick = (view) => {
    setCurrentView(view);
  };

  const openIncidentsCount = incidents.filter(i => i.status === 'open').length;

  return (
    <aside className={`cyber-sidebar ${collapsed ? 'collapsed' : ''}`} id="cyber-sidebar">
      {/* Sidebar Header & Brand */}
      <div className="sidebar-header" onClick={collapsed ? toggleSidebar : undefined}>
        <a className="brand-logo" href="#" onClick={(e) => { e.preventDefault(); if (collapsed) toggleSidebar(); }}>
          <div className="brand-icon">
            <i className="fa-solid fa-satellite-dish"></i>
          </div>
          <div className="brand-title-group">
            <span className="brand-text">SKYGUARD</span>
            <span className="brand-sub">TACTICAL MET-AI HUD</span>
          </div>
        </a>
        <button
          className="cyber-btn btn-sm"
          id="sidebar-toggle-btn"
          title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          onClick={toggleSidebar}
        >
          <i className={`fa-solid fa-angles-${collapsed ? 'right' : 'left'}`}></i>
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav" id="sidebar-nav">
        {role === 'admin' ? (
          <>
            <div className="nav-section-title">Central Command</div>
            <a
              className={`nav-item ${currentView === 'command-center' ? 'active' : ''}`}
              data-view="command-center"
              onClick={() => handleNavClick('command-center')}
              title="Command Center"
            >
              <i className="fa-solid fa-gauge-high"></i>
              <span>Command Center</span>
            </a>
            <a
              className={`nav-item ${currentView === 'fleet-map' ? 'active' : ''}`}
              data-view="fleet-map"
              onClick={() => handleNavClick('fleet-map')}
              title="Fleet Radar Map"
            >
              <i className="fa-solid fa-map-location-dot"></i>
              <span>Fleet Radar Map</span>
            </a>
            <a
              className={`nav-item ${currentView === 'incidents' ? 'active' : ''}`}
              data-view="incidents"
              onClick={() => handleNavClick('incidents')}
              title="Incident Triage"
            >
              <i className="fa-solid fa-triangle-exclamation"></i>
              <span>Incident Triage</span>
              {openIncidentsCount > 0 && <span className="nav-badge">{openIncidentsCount}</span>}
            </a>

            <div className="nav-section-title">Administration & Calibration</div>
            <a
              className={`nav-item ${currentView === 'credentials' ? 'active' : ''}`}
              data-view="credentials"
              onClick={() => handleNavClick('credentials')}
              title="Station Credentials"
            >
              <i className="fa-solid fa-key"></i>
              <span>Station Credentials</span>
            </a>
            <a
              className={`nav-item ${currentView === 'qc-rules' ? 'active' : ''}`}
              data-view="qc-rules"
              onClick={() => handleNavClick('qc-rules')}
              title="QC Physics Matrix"
            >
              <i className="fa-solid fa-sliders"></i>
              <span>QC Physics Matrix</span>
            </a>
            <a
              className={`nav-item ${currentView === 'fault-lab' ? 'active' : ''}`}
              data-view="fault-lab"
              onClick={() => handleNavClick('fault-lab')}
              title="Fault Injection Lab"
            >
              <i className="fa-solid fa-vial-virus"></i>
              <span>Fault Injection Lab</span>
            </a>
            <a
              className={`nav-item ${currentView === 'model-governance' ? 'active' : ''}`}
              data-view="model-governance"
              onClick={() => handleNavClick('model-governance')}
              title="Model Governance"
            >
              <i className="fa-solid fa-brain"></i>
              <span>Model Governance</span>
            </a>
            <a
              className={`nav-item ${currentView === 'station-upload' ? 'active' : ''}`}
              data-view="station-upload"
              onClick={() => handleNavClick('station-upload')}
              title="Station Training Studio"
            >
              <i className="fa-solid fa-microchip"></i>
              <span>Station Training Studio</span>
            </a>
            <a
              className={`nav-item ${currentView === 'export' ? 'active' : ''}`}
              data-view="export"
              onClick={() => handleNavClick('export')}
              title="Quality Data Export"
            >
              <i className="fa-solid fa-file-export"></i>
              <span>Quality Data Export</span>
            </a>
          </>
        ) : (
          <>
            <div className="nav-section-title">{activeStationId} Operator Terminal</div>
            <a
              className={`nav-item ${currentView === 'station-hud' ? 'active' : ''}`}
              data-view="station-hud"
              onClick={() => handleNavClick('station-hud')}
              title="Live Cockpit HUD"
            >
              <i className="fa-solid fa-desktop"></i>
              <span>Live Cockpit HUD</span>
            </a>
            <a
              className={`nav-item ${currentView === 'station-upload' ? 'active' : ''}`}
              data-view="station-upload"
              onClick={() => handleNavClick('station-upload')}
              title="Historical Data Ingest & ML Training"
            >
              <i className="fa-solid fa-file-arrow-up"></i>
              <span>Historical Ingest & ML</span>
            </a>
            <a
              className={`nav-item ${currentView === 'station-diagnostics' ? 'active' : ''}`}
              data-view="station-diagnostics"
              onClick={() => handleNavClick('station-diagnostics')}
              title="Hardware Telemetry"
            >
              <i className="fa-solid fa-microchip"></i>
              <span>Hardware Telemetry</span>
            </a>
            <a
              className={`nav-item ${currentView === 'station-checklist' ? 'active' : ''}`}
              data-view="station-checklist"
              onClick={() => handleNavClick('station-checklist')}
              title="Maintenance Checklist"
            >
              <i className="fa-solid fa-list-check"></i>
              <span>Maintenance Checklist</span>
            </a>
            <a
              className={`nav-item ${currentView === 'edge-sync' ? 'active' : ''}`}
              data-view="edge-sync"
              onClick={() => handleNavClick('edge-sync')}
              title="Edge Buffer & Sync"
            >
              <i className="fa-solid fa-cloud-arrow-up"></i>
              <span>Edge Buffer & Sync</span>
              {offlineBuffer.length > 0 && <span className="nav-badge">{offlineBuffer.length}</span>}
            </a>

            <div className="nav-section-title">Station Triage & Health</div>
            <a
              className={`nav-item ${currentView === 'incidents' ? 'active' : ''}`}
              data-view="incidents"
              onClick={() => handleNavClick('incidents')}
              title="Incident Triage"
            >
              <i className="fa-solid fa-triangle-exclamation"></i>
              <span>Incident Triage</span>
              {openIncidentsCount > 0 && <span className="nav-badge">{openIncidentsCount}</span>}
            </a>
            <a
              className={`nav-item ${currentView === 'fault-lab' ? 'active' : ''}`}
              data-view="fault-lab"
              onClick={() => handleNavClick('fault-lab')}
              title="Fault Lab"
            >
              <i className="fa-solid fa-vial-virus"></i>
              <span>Fault Lab</span>
            </a>
            <a
              className={`nav-item ${currentView === 'model-governance' ? 'active' : ''}`}
              data-view="model-governance"
              onClick={() => handleNavClick('model-governance')}
              title="Model Governance"
            >
              <i className="fa-solid fa-brain"></i>
              <span>Model Governance</span>
            </a>
            <a
              className={`nav-item ${currentView === 'fleet-map' ? 'active' : ''}`}
              data-view="fleet-map"
              onClick={() => handleNavClick('fleet-map')}
              title="Fleet Radar Map"
            >
              <i className="fa-solid fa-map-location-dot"></i>
              <span>Fleet Radar Map</span>
            </a>
          </>
        )}
      </nav>

      {/* Sidebar Footer */}
      <div className="sidebar-footer">
        <button
          className={`audio-toggle-btn ${audioActive ? 'active' : ''}`}
          id="audio-toggle-btn"
          onClick={toggleAudio}
        >
          <i className={`fa-solid fa-volume-${audioActive ? 'high' : 'xmark'}`}></i>
          <span>AUDIO: {audioActive ? 'ON' : 'MUTED'}</span>
        </button>

        <div className="operator-profile">
          <div className="operator-avatar">
            <i className="fa-solid fa-user-astronaut"></i>
          </div>
          <div className="operator-info">
            <div className="operator-name" id="operator-name-display">
              {role === 'admin' ? (user?.name || "COMMAND SUPERVISOR") : (user?.name || `${activeStationId} OPERATOR`)}
            </div>
            <div className="operator-role" id="operator-role-display">
              <span className="pulse-dot pulse-green"></span>
              {role === 'admin' ? ' CENTRAL LEAD' : ` ${activeStationId} FIELD UNIT`}
            </div>
          </div>
        </div>

        <button
          className="cyber-btn btn-sm btn-danger"
          id="logout-btn"
          style={{ width: '100%', padding: '6px 10px', fontSize: '0.7rem' }}
          title="Terminate Tactical Session"
          onClick={handleLogout}
        >
          <i className="fa-solid fa-arrow-right-from-bracket"></i> <span>LOGOUT</span>
        </button>
      </div>
    </aside>
  );
};
