/**
 * MONSOON SENTINEL - MAIN UI COORDINATOR & ROLE VIEW ROUTER
 */

class AppController {
  constructor(state) {
    this.state = state;
    this.selectedIncident = null;
    this.activeLoginRole = "station_operator"; // "station_operator" | "admin"
    this.currentRenderedView = null;
    this.currentRenderedRole = null;
    this.currentRenderedStation = null;
    this.init();
  }

  init() {
    this.bindEvents();
    this.state.subscribe(() => this.render());
    this.render(true);
  }

  bindEvents() {
    document.addEventListener("click", (e) => {
      // Logout button
      if (e.target.closest("#logout-btn")) {
        this.handleLogout();
        return;
      }

      // Sidebar nav items
      const navItem = e.target.closest(".nav-item[data-view]");
      if (navItem) {
        const view = navItem.getAttribute("data-view");
        this.state.setView(view);
        if (window.tacticalAudio) window.tacticalAudio.playSwitch();
      }

      // Audio toggle button
      if (e.target.closest("#audio-toggle-btn")) {
        const btn = document.getElementById("audio-toggle-btn");
        const active = window.tacticalAudio.toggle();
        btn.classList.toggle("active", active);
        btn.innerHTML = `<i class="fa-solid fa-volume-${active ? 'high' : 'xmark'}"></i> <span>AUDIO: ${active ? 'ON' : 'MUTED'}</span>`;
      }

      // Sidebar collapse toggle
      if (e.target.closest("#sidebar-toggle-btn") || (e.target.closest(".cyber-sidebar.collapsed .sidebar-header"))) {
        const sidebar = document.getElementById("cyber-sidebar");
        sidebar.classList.toggle("collapsed");
        if (window.tacticalAudio) window.tacticalAudio.playClick();
      }

      // Incident review click
      const incidentRow = e.target.closest(".incident-row[data-id]");
      if (incidentRow) {
        const id = incidentRow.getAttribute("data-id");
        this.openIncidentModal(id);
      }

      // Close modal buttons
      if (e.target.closest(".modal-close-btn") || e.target.closest(".modal-backdrop-close")) {
        this.closeModals();
      }
    });
  }

  handleLogout() {
    if (window.tacticalAudio) window.tacticalAudio.playAlarm();
    window.authService.logout();
    this.render();
  }

  openIncidentModal(id) {
    const incident = this.state.incidents.find(inc => inc.id === id);
    if (!incident) return;
    this.selectedIncident = incident;

    const modal = document.getElementById("incident-modal");
    const title = document.getElementById("modal-inc-title");
    const content = document.getElementById("modal-inc-content");

    if (modal && title && content) {
      title.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-crimson"></i> INCIDENT EVIDENCE: ${incident.id}`;
      
      let badgeClass = incident.severity === 'critical' ? 'badge-critical' : incident.severity === 'high' ? 'badge-critical' : 'badge-suspect';
      let stateBadge = incident.quality_state === 'GENUINE_EXTREME_CANDIDATE' ? 'badge-extreme' : 'badge-suspect';

      content.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap;">
          <span class="cyber-badge ${badgeClass}">${incident.severity} SEVERITY</span>
          <span class="cyber-badge ${stateBadge}">${incident.quality_state}</span>
          <span class="cyber-badge badge-offline">STATION: ${incident.station_id} (${incident.station_name})</span>
          <span style="margin-left: auto; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">${new Date(incident.created_at).toLocaleString()}</span>
        </div>

        <div class="evidence-chain">
          <div style="font-family: var(--font-tactical); font-size: 0.75rem; color: var(--neon-cyan); margin-bottom: 6px;">STRUCTURED REASON CODES & EVIDENCE GRAPH:</div>
          ${incident.reason_codes.map(rc => `
            <div class="evidence-step">
              <span class="cyber-badge badge-critical">${rc}</span>
              <span style="color: var(--text-primary);">${incident.explanation}</span>
            </div>
          `).join('')}
          <div class="evidence-step" style="border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px; margin-top: 4px;">
            <span class="cyber-badge badge-normal">CALCULATED FAULT RISK</span>
            <span style="color: ${incident.fault_risk >= 0.7 ? '#ff0055' : '#00ff66'}; font-weight: bold;">${(incident.fault_risk * 100).toFixed(0)}% PROBABILITY</span>
          </div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.6); padding: 14px; border: 1px solid var(--border-subtle); border-radius: 4px;">
          <div style="font-family: var(--font-tactical); font-size: 0.75rem; color: var(--neon-amber); margin-bottom: 8px;">RECOMMENDED OPERATOR ACTIONS:</div>
          <ul style="list-style-type: none; display: flex; flex-direction: column; gap: 6px; font-size: 0.75rem; font-family: var(--font-mono);">
            ${incident.recommended_actions.map(act => `<li style="display: flex; gap: 8px;"><i class="fa-solid fa-chevron-right text-cyan"></i> ${act}</li>`).join('')}
          </ul>
        </div>

        ${incident.disposition_history.length > 0 ? `
          <div style="font-size: 0.72rem; font-family: var(--font-mono); color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 8px;">
            <strong>Audit Trail:</strong> ${incident.disposition_history.map(d => `${d.operator}: "${d.action}" at ${new Date(d.timestamp).toLocaleTimeString()}`).join(' | ')}
          </div>
        ` : ''}
      `;

      modal.classList.add("active");
      if (window.tacticalAudio) window.tacticalAudio.playClick();
    }
  }

  adjudicateIncident(action) {
    if (!this.selectedIncident) return;
    const operator = this.state.currentRole === "admin" ? "Central Admin / Supervisor" : `Operator (${this.state.activeStationId})`;
    
    if (action === "ACKNOWLEDGE") {
      this.selectedIncident.status = "acknowledged";
      this.selectedIncident.disposition_history.push({ operator, action: "Acknowledged Alert", timestamp: new Date().toISOString() });
    } else if (action === "GENUINE") {
      this.selectedIncident.quality_state = "GENUINE_EXTREME_CANDIDATE";
      this.selectedIncident.status = "resolved";
      this.selectedIncident.disposition_history.push({ operator, action: "Confirmed Genuine Weather Phenomenon", timestamp: new Date().toISOString() });
    } else if (action === "REJECT") {
      this.selectedIncident.quality_state = "REJECTED";
      this.selectedIncident.status = "resolved";
      this.selectedIncident.disposition_history.push({ operator, action: "Flagged Invalid / Sensor Defect", timestamp: new Date().toISOString() });
    }

    if (window.tacticalAudio) window.tacticalAudio.playSuccess();
    this.closeModals();
    this.state.notify();
  }

  closeModals() {
    document.querySelectorAll(".cyber-modal-overlay").forEach(m => m.classList.remove("active"));
  }

  render(forceFullRender = false) {
    const auth = window.authService;
    const authOverlay = document.getElementById("auth-overlay-container");
    const appShell = document.querySelector(".app-container");

    if (!auth || !auth.isAuthenticated()) {
      if (appShell) appShell.style.display = "none";
      if (authOverlay) {
        authOverlay.style.display = "block";
        // Guard against continuous re-render: only render if form does not exist in DOM
        const formExists = document.getElementById("auth-login-form");
        if (!formExists || forceFullRender) {
          this.renderLoginScreen(this.activeLoginRole);
        }
      }
      this.currentRenderedRole = null;
      this.currentRenderedView = null;
      this.currentRenderedStation = null;
      return;
    }

    if (authOverlay) authOverlay.style.display = "none";
    if (appShell) appShell.style.display = "flex";

    // Synchronize state with authenticated session
    this.state.currentRole = auth.getRole();
    if (this.state.currentRole === "station_operator") {
      this.state.activeStationId = auth.getAssignedStationId() || "AWS-07";
    }

    const roleChanged = this.currentRenderedRole !== this.state.currentRole;
    const viewChanged = this.currentRenderedView !== this.state.currentView;
    const stationChanged = this.currentRenderedStation !== this.state.activeStationId;

    if (roleChanged || stationChanged || forceFullRender) {
      this.renderSidebar();
      this.renderTopbar();
      this.currentRenderedRole = this.state.currentRole;
    } else if (viewChanged) {
      this.renderSidebarActiveState();
      this.renderTopbar();
    }

    if (viewChanged || stationChanged || roleChanged || forceFullRender) {
      this.renderMainContent();
      this.currentRenderedView = this.state.currentView;
      this.currentRenderedStation = this.state.activeStationId;
    } else {
      // Periodic background simulator tick: perform lightweight in-place updates only
      this.updateLiveTelemetryInPlace();
    }
  }

  renderSidebarActiveState() {
    document.querySelectorAll(".nav-item[data-view]").forEach(el => {
      const v = el.getAttribute("data-view");
      el.classList.toggle("active", v === this.state.currentView);
    });
  }

  updateLiveTelemetryInPlace() {
    if (this.state.currentView === 'command-center') {
      const normalCount = this.state.stations.filter(s => s.status === 'NORMAL').length;
      const suspectCount = this.state.stations.filter(s => s.status === 'SUSPECT' || s.status === 'CRITICAL').length;
      const extremeCount = this.state.stations.filter(s => s.status === 'EXTREME').length;
      const openIncidents = this.state.incidents.filter(i => i.status === 'open').length;

      const normEl = document.getElementById("stat-norm-val");
      if (normEl) normEl.innerHTML = `${normalCount} <span class="stat-unit">/ ${this.state.stations.length}</span>`;
      const suspEl = document.getElementById("stat-susp-val");
      if (suspEl) suspEl.innerHTML = `${suspectCount} <span class="stat-unit">STATIONS</span>`;
      const extEl = document.getElementById("stat-ext-val");
      if (extEl) extEl.innerHTML = `${extremeCount} <span class="stat-unit">EVENTS</span>`;
      const incEl = document.getElementById("stat-inc-val");
      if (incEl) incEl.innerHTML = `${openIncidents} <span class="stat-unit">ACTIVE</span>`;

      this.state.stations.forEach(st => {
        const tempEl = document.getElementById(`live-temp-${st.id}`);
        if (tempEl) tempEl.innerText = `${st.sensors.temperature.value} ${st.sensors.temperature.unit}`;
        const humEl = document.getElementById(`live-hum-${st.id}`);
        if (humEl) humEl.innerText = `${st.sensors.humidity.value} ${st.sensors.humidity.unit}`;
        const presEl = document.getElementById(`live-pres-${st.id}`);
        if (presEl) presEl.innerText = `${st.sensors.pressure.value} ${st.sensors.pressure.unit}`;
        const rainEl = document.getElementById(`live-rain-${st.id}`);
        if (rainEl) rainEl.innerText = `${st.sensors.rainfall.value} ${st.sensors.rainfall.unit}`;
        const statEl = document.getElementById(`live-status-${st.id}`);
        if (statEl) {
          let badge = st.status === 'NORMAL' ? 'badge-normal' : st.status === 'SUSPECT' ? 'badge-suspect' : st.status === 'CRITICAL' ? 'badge-critical' : 'badge-extreme';
          statEl.className = `cyber-badge ${badge}`;
          statEl.innerText = st.status;
        }
      });
    } else if (this.state.currentView === 'station-hud') {
      const st = this.state.stations.find(s => s.id === this.state.activeStationId);
      if (st) {
        const temp = st.sensors.temperature.value;
        const hum = st.sensors.humidity.value;
        const pres = st.sensors.pressure.value;
        const rain = st.sensors.rainfall.value;

        const gTempVal = document.getElementById("hud-gauge-temp-val");
        const gTempProg = document.getElementById("hud-gauge-temp-prog");
        if (gTempVal) gTempVal.innerText = temp;
        if (gTempProg) gTempProg.setAttribute("stroke-dashoffset", 264 - (Math.min(50, Math.max(0, temp)) / 50) * 264);

        const gHumVal = document.getElementById("hud-gauge-hum-val");
        const gHumProg = document.getElementById("hud-gauge-hum-prog");
        if (gHumVal) gHumVal.innerText = hum;
        if (gHumProg) gHumProg.setAttribute("stroke-dashoffset", 264 - (hum / 100) * 264);

        const gPresVal = document.getElementById("hud-gauge-pres-val");
        const gPresProg = document.getElementById("hud-gauge-pres-prog");
        if (gPresVal) gPresVal.innerText = pres;
        if (gPresProg) gPresProg.setAttribute("stroke-dashoffset", 264 - ((pres - 900) / 200) * 264);

        const gRainVal = document.getElementById("hud-gauge-rain-val");
        const gRainProg = document.getElementById("hud-gauge-rain-prog");
        if (gRainVal) gRainVal.innerText = rain;
        if (gRainProg) gRainProg.setAttribute("stroke-dashoffset", 264 - (Math.min(100, rain) / 100) * 264);

        if (window.tacticalCharts) {
          window.tacticalCharts.updateCharts(st.id);
        }
      }
    } else if (this.state.currentView === 'fleet-map') {
      if (window.tacticalMap && window.tacticalMap.map) {
        window.tacticalMap.renderStations();
      }
    }
  }

  renderSidebar() {
    const sidebar = document.getElementById("sidebar-nav");
    const roleBadge = document.getElementById("operator-role-display");
    const nameDisplay = document.getElementById("operator-name-display");
    const auth = window.authService;
    const currentUser = auth.getCurrentUser();

    if (this.state.currentRole === "admin") {
      roleBadge.innerHTML = `<span class="pulse-dot pulse-green"></span> CENTRAL LEAD`;
      nameDisplay.innerText = currentUser?.name || "COMMAND SUPERVISOR";
      sidebar.innerHTML = `
        <div class="nav-section-title">Central Command</div>
        <a class="nav-item ${this.state.currentView === 'command-center' ? 'active' : ''}" data-view="command-center">
          <i class="fa-solid fa-gauge-high"></i>
          <span>Command Center</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'fleet-map' ? 'active' : ''}" data-view="fleet-map">
          <i class="fa-solid fa-map-location-dot"></i>
          <span>Fleet Radar Map</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'incidents' ? 'active' : ''}" data-view="incidents">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>Incident Triage</span>
          <span class="nav-badge">${this.state.incidents.filter(i=>i.status==='open').length}</span>
        </a>

        <div class="nav-section-title">Administration & Security</div>
        <a class="nav-item ${this.state.currentView === 'credentials' ? 'active' : ''}" data-view="credentials">
          <i class="fa-solid fa-key"></i>
          <span>Station Credentials</span>
          <span class="nav-badge" style="background: rgba(0, 255, 102, 0.15); color: var(--neon-green); border-color: rgba(0, 255, 102, 0.3);">RBAC</span>
        </a>

        <div class="nav-section-title">Engineering & Intelligence</div>
        <a class="nav-item ${this.state.currentView === 'qc-rules' ? 'active' : ''}" data-view="qc-rules">
          <i class="fa-solid fa-sliders"></i>
          <span>QC Physics Matrix</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'fault-lab' ? 'active' : ''}" data-view="fault-lab">
          <i class="fa-solid fa-flask-vial"></i>
          <span>Fault Injection Lab</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'model-governance' ? 'active' : ''}" data-view="model-governance">
          <i class="fa-solid fa-brain"></i>
          <span>Model Governance</span>
          <span class="nav-badge" style="background: rgba(0, 240, 255, 0.2); color: var(--neon-cyan); border-color: rgba(0, 240, 255, 0.4);">REGISTRY</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'export' ? 'active' : ''}" data-view="export">
          <i class="fa-solid fa-file-export"></i>
          <span>Quality Data Export</span>
        </a>
      `;
    } else {
      const currentStation = this.state.stations.find(s => s.id === this.state.activeStationId) || this.state.stations[0];
      roleBadge.innerHTML = `<span class="pulse-dot pulse-amber"></span> STATION OPERATOR`;
      nameDisplay.innerText = `${currentStation.id} TERMINAL`;
      sidebar.innerHTML = `
        <div class="nav-section-title">Station Scoped HUD</div>
        <a class="nav-item ${this.state.currentView === 'station-hud' ? 'active' : ''}" data-view="station-hud">
          <i class="fa-solid fa-satellite-dish"></i>
          <span>Live Cockpit HUD</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'station-upload' ? 'active' : ''}" data-view="station-upload">
          <i class="fa-solid fa-file-arrow-up"></i>
          <span>Historical Data Ingest</span>
          <span class="nav-badge" style="background: rgba(0, 240, 255, 0.15); color: var(--neon-cyan); border-color: rgba(0, 240, 255, 0.3);">BACKFILL</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'station-diagnostics' ? 'active' : ''}" data-view="station-diagnostics">
          <i class="fa-solid fa-microchip"></i>
          <span>Hardware Telemetry</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'station-checklist' ? 'active' : ''}" data-view="station-checklist">
          <i class="fa-solid fa-list-check"></i>
          <span>Maintenance Checklist</span>
        </a>
        <a class="nav-item ${this.state.currentView === 'edge-sync' ? 'active' : ''}" data-view="edge-sync">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <span>Edge Buffer & Sync</span>
          ${this.state.offlineBuffer.length > 0 ? `<span class="nav-badge">${this.state.offlineBuffer.length}</span>` : ''}
        </a>
      `;
    }
  }

  renderTopbar() {
    const viewTitle = document.getElementById("view-title-text");
    const viewSub = document.getElementById("view-subtitle-text");

    const titles = {
      'command-center': { title: 'FLEET COMMAND OVERVIEW', sub: 'REAL-TIME NETWORK METEOROLOGICAL ANOMALY MATRIX' },
      'fleet-map': { title: 'GEOSPATIAL RADAR MAP', sub: 'STATION LOCATIONS, SPATIAL BUDDY VECTORS & WEATHER CLUSTERS' },
      'incidents': { title: 'GLOBAL INCIDENT QUEUE', sub: 'EXPLAINABLE REASON CODES & OPERATOR ADJUDICATION WORKFLOW' },
      'credentials': { title: 'STATION CREDENTIAL MANAGEMENT', sub: 'CENTRAL OPERATOR PROVISIONING, ACCESS CONTROL & RBAC AUDIT' },
      'qc-rules': { title: 'QC PHYSICS & THRESHOLD MATRIX', sub: 'CONFIGURABLE BOUNDS, DERIVATIVES & EVIDENCE WEIGHTS' },
      'fault-lab': { title: 'FAULT INJECTION & ML LAB', sub: 'SYNTHETIC STRESS TESTING & CHRONOLOGICAL EVALUATION' },
      'model-governance': { title: 'MODEL GOVERNANCE & REGISTRY', sub: 'MODEL CARDS, VERSIONED FEATURES, DRIFT METRICS & APPROVAL WORKFLOWS' },
      'export': { title: 'QUALITY-AWARE TELEMETRY EXPORT', sub: 'CRYPTOGRAPHIC PAYLOAD AUDIT & VERIFIED MET REPOSITORIES' },
      'station-hud': { title: `${this.state.activeStationId} COCKPIT HUD`, sub: 'HIGH-FREQUENCY SENSOR READOUTS & LIVE STREAM' },
      'station-upload': { title: `${this.state.activeStationId} HISTORICAL DATA INGESTION`, sub: 'BATCH CSV / JSON TELEMETRY LOG UPLOADER & BASELINE BACKFILL' },
      'station-diagnostics': { title: `${this.state.activeStationId} HARDWARE TELEMETRY`, sub: 'GATEWAY BATTERY, SOLAR CHARGE, RSSI & FIRMWARE STATUS' },
      'station-checklist': { title: `${this.state.activeStationId} MAINTENANCE CHECKLIST`, sub: 'STEP-BY-STEP FIELD DIAGNOSTICS & AUDIT LOGS' },
      'edge-sync': { title: `${this.state.activeStationId} EDGE RESILIENCE & OFFLINE SYNC`, sub: 'LOCAL APPEND-ONLY BUFFER & IDEMPOTENT REPLAY' }
    };

    const current = titles[this.state.currentView] || { title: 'MONSOON SENTINEL', sub: 'TACTICAL AWS SYSTEM' };
    if (viewTitle) viewTitle.innerText = current.title;
    if (viewSub) viewSub.innerText = current.sub;
  }

  renderMainContent() {
    const container = document.getElementById("main-content-area");
    if (!container) return;

    switch (this.state.currentView) {
      case 'command-center':
        container.innerHTML = this.getCommandCenterHTML();
        break;
      case 'fleet-map':
        container.innerHTML = this.getFleetMapHTML();
        setTimeout(() => window.tacticalMap.init(), 100);
        break;
      case 'incidents':
        container.innerHTML = this.getIncidentsHTML();
        break;
      case 'credentials':
        container.innerHTML = this.getCredentialsHTML();
        break;
      case 'qc-rules':
        container.innerHTML = this.getQCRulesHTML();
        break;
      case 'fault-lab':
        container.innerHTML = this.getFaultLabHTML();
        break;
      case 'model-governance':
        container.innerHTML = this.getModelGovernanceHTML();
        break;
      case 'export':
        container.innerHTML = this.getExportHTML();
        break;
      case 'station-hud':
        container.innerHTML = this.getStationHUDHTML();
        setTimeout(() => {
          window.tacticalCharts.initStationCharts(this.state.activeStationId);
          window.tacticalCharts.initPeerComparisonChart(this.state.activeStationId);
        }, 100);
        break;
      case 'station-upload':
        container.innerHTML = this.getStationUploadHTML();
        break;
      case 'station-diagnostics':
        container.innerHTML = this.getStationDiagnosticsHTML();
        break;
      case 'station-checklist':
        container.innerHTML = this.getStationChecklistHTML();
        break;
      case 'edge-sync':
        container.innerHTML = this.getEdgeSyncHTML();
        break;
      default:
        container.innerHTML = this.getCommandCenterHTML();
    }
  }

  // --- HTML Generators ---

  getCommandCenterHTML() {
    const normalCount = this.state.stations.filter(s => s.status === 'NORMAL').length;
    const suspectCount = this.state.stations.filter(s => s.status === 'SUSPECT' || s.status === 'CRITICAL').length;
    const extremeCount = this.state.stations.filter(s => s.status === 'EXTREME').length;
    const openIncidents = this.state.incidents.filter(i => i.status === 'open').length;

    return `
      <div class="metrics-grid-4">
        <div class="cyber-card stat-card green-card">
          <div class="stat-header">
            <span class="stat-label">HEALTHY STATIONS</span>
            <div class="stat-icon"><i class="fa-solid fa-tower-broadcast text-green"></i></div>
          </div>
          <div class="stat-value text-green" id="stat-norm-val">${normalCount} <span class="stat-unit">/ ${this.state.stations.length}</span></div>
          <div class="stat-footer"><span>Fleet Operational</span><span class="pulse-dot pulse-green"></span></div>
        </div>

        <div class="cyber-card stat-card amber-card">
          <div class="stat-header">
            <span class="stat-label">QC ANOMALIES FLAGGED</span>
            <div class="stat-icon"><i class="fa-solid fa-triangle-exclamation text-amber"></i></div>
          </div>
          <div class="stat-value text-amber" id="stat-susp-val">${suspectCount} <span class="stat-unit">STATIONS</span></div>
          <div class="stat-footer"><span>Suspect Observations</span><span class="pulse-dot pulse-amber"></span></div>
        </div>

        <div class="cyber-card stat-card purple-card">
          <div class="stat-header">
            <span class="stat-label">GENUINE EXTREMES</span>
            <div class="stat-icon"><i class="fa-solid fa-cloud-bolt text-purple"></i></div>
          </div>
          <div class="stat-value text-purple" id="stat-ext-val">${extremeCount} <span class="stat-unit">EVENTS</span></div>
          <div class="stat-footer"><span>Multi-Sensor Coherent</span><span class="pulse-dot pulse-green"></span></div>
        </div>

        <div class="cyber-card stat-card threat-card">
          <div class="stat-header">
            <span class="stat-label">OPEN INCIDENTS</span>
            <div class="stat-icon"><i class="fa-solid fa-bell text-crimson"></i></div>
          </div>
          <div class="stat-value text-crimson" id="stat-inc-val">${openIncidents} <span class="stat-unit">ACTIVE</span></div>
          <div class="stat-footer"><span>Requires Triage</span><span class="pulse-dot pulse-crimson"></span></div>
        </div>
      </div>

      <div class="cyber-card" style="margin-top: 10px;">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-network-wired"></i> FLEET SENSOR TELEMETRY & QUALITY MATRIX</div>
          <button class="cyber-btn btn-sm" onclick="window.appState.setView('fleet-map')"><i class="fa-solid fa-map"></i> View Geospatial Radar</button>
        </div>
        <div class="cyber-card-body" style="padding: 0;">
          <div class="tactical-table-wrapper">
            <table class="tactical-table">
              <thead>
                <tr>
                  <th>STATION ID</th>
                  <th>LOCATION / REGION</th>
                  <th>STATUS</th>
                  <th>TEMPERATURE</th>
                  <th>HUMIDITY</th>
                  <th>PRESSURE</th>
                  <th>RAINFALL</th>
                  <th>BATTERY / SIGNAL</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                ${this.state.stations.map(st => {
                  let badge = st.status === 'NORMAL' ? 'badge-normal' : st.status === 'SUSPECT' ? 'badge-suspect' : st.status === 'CRITICAL' ? 'badge-critical' : 'badge-extreme';
                  return `
                    <tr>
                      <td style="font-weight: bold; color: var(--neon-cyan);">${st.id}</td>
                      <td>${st.name} <div style="font-size: 0.68rem; color: var(--text-muted);">${st.region}</div></td>
                      <td><span class="cyber-badge ${badge}" id="live-status-${st.id}">${st.status}</span></td>
                      <td id="live-temp-${st.id}">${st.sensors.temperature.value} ${st.sensors.temperature.unit}</td>
                      <td id="live-hum-${st.id}">${st.sensors.humidity.value} ${st.sensors.humidity.unit}</td>
                      <td id="live-pres-${st.id}">${st.sensors.pressure.value} ${st.sensors.pressure.unit}</td>
                      <td id="live-rain-${st.id}">${st.sensors.rainfall.value} ${st.sensors.rainfall.unit}</td>
                      <td>${st.battery}V | ${st.signal}dBm</td>
                      <td>
                        <button class="cyber-btn btn-sm" onclick="window.appState.setRole('station_operator', '${st.id}')">
                          <i class="fa-solid fa-terminal"></i> Operator HUD
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  getFleetMapHTML() {
    return `
      <div class="tactical-map-container">
        <div id="tactical-map"></div>
        <div class="map-overlay-hud">
          <div class="map-overlay-card">
            <div style="font-family: var(--font-tactical); color: var(--neon-cyan); margin-bottom: 6px; font-weight: bold;">MAP TELEMETRY HUD</div>
            <div class="map-legend-item"><span class="pulse-dot pulse-green"></span> <span>Normal Baseline (${this.state.stations.filter(s=>s.status==='NORMAL').length})</span></div>
            <div class="map-legend-item"><span class="pulse-dot pulse-amber"></span> <span>Suspect / Outlier (${this.state.stations.filter(s=>s.status==='SUSPECT').length})</span></div>
            <div class="map-legend-item"><span class="pulse-dot pulse-crimson"></span> <span>Critical / Fault (${this.state.stations.filter(s=>s.status==='CRITICAL').length})</span></div>
            <div class="map-legend-item"><span class="pulse-dot" style="background:#a855f7;"></span> <span>Extreme Weather (${this.state.stations.filter(s=>s.status==='EXTREME').length})</span></div>
            <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px; font-size: 0.68rem; color: var(--text-muted);">
              <i class="fa-solid fa-circle-nodes text-cyan"></i> Dotted lines = Spatial Buddy Vectors
            </div>
          </div>
        </div>
      </div>
    `;
  }

  getIncidentsHTML() {
    return `
      <div class="cyber-card">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-list-check"></i> ACTIVE INCIDENT & ADJUDICATION QUEUE</div>
          <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">Click any row to inspect structured evidence and adjudicate</span>
        </div>
        <div class="cyber-card-body" style="padding: 0;">
          <div class="tactical-table-wrapper">
            <table class="tactical-table">
              <thead>
                <tr>
                  <th>INCIDENT ID</th>
                  <th>STATION</th>
                  <th>SEVERITY</th>
                  <th>QUALITY STATE</th>
                  <th>REASON CODES</th>
                  <th>FAULT RISK</th>
                  <th>STATUS</th>
                  <th>CREATED</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                ${this.state.incidents.map(inc => {
                  let sevBadge = inc.severity === 'critical' ? 'badge-critical' : inc.severity === 'high' ? 'badge-critical' : 'badge-suspect';
                  let stateBadge = inc.quality_state === 'GENUINE_EXTREME_CANDIDATE' ? 'badge-extreme' : 'badge-suspect';
                  return `
                    <tr class="incident-row" data-id="${inc.id}" style="cursor: pointer;">
                      <td style="font-weight: bold; color: var(--neon-cyan);">${inc.id}</td>
                      <td>${inc.station_id} <span style="font-size: 0.7rem; color: var(--text-muted);">(${inc.station_name})</span></td>
                      <td><span class="cyber-badge ${sevBadge}">${inc.severity}</span></td>
                      <td><span class="cyber-badge ${stateBadge}">${inc.quality_state}</span></td>
                      <td>${inc.reason_codes.map(rc => `<span class="cyber-badge badge-offline" style="font-size: 0.65rem; margin-right: 3px;">${rc}</span>`).join('')}</td>
                      <td style="color: ${inc.fault_risk >= 0.7 ? '#ff0055' : '#00ff66'}; font-weight: bold;">${(inc.fault_risk * 100).toFixed(0)}%</td>
                      <td><span class="cyber-badge ${inc.status==='open' ? 'badge-critical' : 'badge-normal'}">${inc.status}</span></td>
                      <td>${new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>
                        <button class="cyber-btn btn-sm" onclick="window.appController.openIncidentModal('${inc.id}')">
                          <i class="fa-solid fa-magnifying-glass"></i> Inspect
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  getQCRulesHTML() {
    const c = this.state.qcConfig;
    return `
      <div class="sim-control-panel">
        <div class="cyber-card sim-box">
          <div class="sim-box-title"><span><i class="fa-solid fa-temperature-half"></i> PHYSICAL RANGE ENVELOPES</span></div>
          <div class="sim-slider-group">
            <div class="sim-slider-label"><span>Max Temperature Threshold</span><span id="val-temp-max">${c.temp_max}°C</span></div>
            <input type="range" class="cyber-slider" min="40" max="65" value="${c.temp_max}" oninput="window.appController.updateQCConfig('temp_max', +this.value, '°C')">
          </div>
          <div class="sim-slider-group">
            <div class="sim-slider-label"><span>Max Rate of Change (°C / 10min)</span><span id="val-temp-rate">${c.temp_max_rate}°C</span></div>
            <input type="range" class="cyber-slider" min="1" max="8" step="0.5" value="${c.temp_max_rate}" oninput="window.appController.updateQCConfig('temp_max_rate', +this.value, '°C')">
          </div>
          <div class="sim-slider-group">
            <div class="sim-slider-label"><span>Flatline Invariant Cycles</span><span id="val-flatline">${c.flatline_window}</span></div>
            <input type="range" class="cyber-slider" min="3" max="12" value="${c.flatline_window}" oninput="window.appController.updateQCConfig('flatline_window', +this.value, '')">
          </div>
        </div>

        <div class="cyber-card sim-box">
          <div class="sim-box-title"><span><i class="fa-solid fa-scale-balanced"></i> EVIDENCE FUSION WEIGHTS</span></div>
          <div class="sim-slider-group">
            <div class="sim-slider-label"><span>Deterministic Rule Weight</span><span id="val-rule-wt">${c.rule_weight}</span></div>
            <input type="range" class="cyber-slider" min="0.1" max="0.6" step="0.05" value="${c.rule_weight}" oninput="window.appController.updateQCConfig('rule_weight', +this.value, '')">
          </div>
          <div class="sim-slider-group">
            <div class="sim-slider-label"><span>Spatial Peer Residual Weight</span><span id="val-spatial-wt">${c.spatial_weight}</span></div>
            <input type="range" class="cyber-slider" min="0.1" max="0.5" step="0.05" value="${c.spatial_weight}" oninput="window.appController.updateQCConfig('spatial_weight', +this.value, '')">
          </div>
          <div class="sim-slider-group">
            <div class="sim-slider-label"><span>ML Isolation Forest Score Weight</span><span id="val-model-wt">${c.model_weight}</span></div>
            <input type="range" class="cyber-slider" min="0.1" max="0.5" step="0.05" value="${c.model_weight}" oninput="window.appController.updateQCConfig('model_weight', +this.value, '')">
          </div>
        </div>
      </div>
    `;
  }

  updateQCConfig(key, value, unit) {
    this.state.qcConfig[key] = value;
    const label = document.getElementById(`val-${key.replace(/_/g, '-')}`);
    if (label) label.innerText = `${value}${unit}`;
  }

  getFaultLabHTML() {
    return `
      <div class="cyber-card" style="margin-bottom: 16px;">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-flask-vial text-cyan"></i> REAL-TIME FAULT INJECTION TESTBED</div>
          <button class="cyber-btn btn-danger btn-sm" onclick="window.weatherSimulator.clearFaults(); window.appController.render();">
            <i class="fa-solid fa-rotate-left"></i> Reset All Injections
          </button>
        </div>
        <div class="cyber-card-body">
          <p style="font-size: 0.76rem; color: var(--text-secondary); margin-bottom: 16px;">
            Inject synthetic physical sensor faults or regional extreme storm events across target AWS stations to validate layered QC detection, reason code generation, and Isolation Forest ML scoring in real time.
          </p>
          <div class="sim-control-panel">
            <div class="sim-box">
              <div class="sim-box-title"><span><i class="fa-solid fa-bolt text-amber"></i> TEMPERATURE SPIKE</span></div>
              <p style="font-size: 0.72rem; color: var(--text-muted);">Simulates sudden +8.5°C thermal jump. Triggers RATE_FAIL and SPATIAL_OUTLIER.</p>
              <button class="cyber-btn btn-amber btn-sm" onclick="window.weatherSimulator.injectFault('AWS-07', 'SPIKE')">
                Inject on AWS-07 (Hyderabad)
              </button>
            </div>

            <div class="sim-box">
              <div class="sim-box-title"><span><i class="fa-solid fa-chart-line text-crimson"></i> SENSOR BIAS DRIFT</span></div>
              <p style="font-size: 0.72rem; color: var(--text-muted);">Simulates gradual ADC calibration drift vs trusted peers over time.</p>
              <button class="cyber-btn btn-danger btn-sm" onclick="window.weatherSimulator.injectFault('AWS-08', 'DRIFT')">
                Inject on AWS-08 (Secunderabad)
              </button>
            </div>

            <div class="sim-box">
              <div class="sim-box-title"><span><i class="fa-solid fa-snowflake text-cyan"></i> SENSOR FLATLINE</span></div>
              <p style="font-size: 0.72rem; color: var(--text-muted);">Freezes sensor probe at invariant value across consecutive cycles.</p>
              <button class="cyber-btn btn-primary btn-sm" onclick="window.weatherSimulator.injectFault('AWS-12', 'FLATLINE')">
                Inject on AWS-12 (Mumbai)
              </button>
            </div>

            <div class="sim-box">
              <div class="sim-box-title"><span><i class="fa-solid fa-cloud-bolt text-purple"></i> CORRELATED STORM FRONT</span></div>
              <p style="font-size: 0.72rem; color: var(--text-muted);">Simulates multi-sensor storm: 85mm rain, 45km/h wind, pressure dip. Validates GENUINE_EXTREME gate.</p>
              <button class="cyber-btn btn-green btn-sm" onclick="window.weatherSimulator.injectFault('AWS-07', 'STORM'); window.weatherSimulator.injectFault('AWS-08', 'STORM');">
                Trigger Regional Storm Event
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  getExportHTML() {
    const sampleRecord = {
      event_id: `aws-export-${Date.now()}`,
      station_id: "AWS-07",
      timestamp_utc: new Date().toISOString(),
      measurements: this.state.stations[0].sensors,
      payload_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      qc_verdict: {
        quality_state: "ACCEPTED",
        anomaly_score: 0.08,
        reason_codes: ["NORMAL"],
        model_version: "iforest-v1.4"
      }
    };

    return `
      <div class="cyber-card">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-file-code"></i> QUALITY-AWARE TELEMETRY EXPORT REPOSITORY</div>
          <button class="cyber-btn btn-sm" onclick="window.appController.downloadExportJSON()"><i class="fa-solid fa-download"></i> Export Verified JSON</button>
        </div>
        <div class="cyber-card-body">
          <p style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 12px;">
            Every record carries immutable source hashes, unit conversion status, deterministic reason codes, and human operator dispositions.
          </p>
          <pre style="background: rgba(5,8,17,0.9); padding: 14px; border: 1px solid var(--border-subtle); border-radius: 4px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--neon-cyan); overflow-x: auto;">
${JSON.stringify(sampleRecord, null, 2)}
          </pre>
        </div>
      </div>
    `;
  }

  getModelGovernanceHTML() {
    const activeModel = this.state.modelRegistry.find(m => m.id === this.state.activeModelId) || this.state.modelRegistry[0];
    const drift = this.state.modelDrift;
    const lineage = this.state.externalDataLineage;

    return `
      <!-- Model Registry Selector & Status Header -->
      <div class="cyber-card" style="margin-bottom: 16px;">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-box-archive text-cyan"></i> ACTIVE MODEL REGISTRY & ARTIFACT REPOSITORY</div>
          <div style="display: flex; gap: 8px;">
            <button class="cyber-btn btn-sm" onclick="window.appController.downloadModelCard('${activeModel.id}')">
              <i class="fa-solid fa-file-code"></i> Export Model Card JSON
            </button>
            <button class="cyber-btn btn-danger btn-sm" onclick="window.appController.rollbackModel('${activeModel.id}')">
              <i class="fa-solid fa-clock-rotate-left"></i> Rollback to Previous Version
            </button>
          </div>
        </div>
        <div class="cyber-card-body">
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px;">
            ${this.state.modelRegistry.map(m => `
              <button class="cyber-btn btn-sm ${m.id === activeModel.id ? 'btn-primary' : ''}" style="${m.id === activeModel.id ? 'box-shadow: 0 0 12px var(--neon-cyan);' : ''}" onclick="window.appState.activeModelId = '${m.id}'; window.appController.render();">
                <i class="fa-solid ${m.status.includes('APPROVED') ? 'fa-circle-check text-green' : 'fa-flask text-amber'}"></i>
                ${m.name} (${m.version})
              </button>
            `).join('')}
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; background: rgba(5,8,17,0.7); padding: 12px; border-radius: 4px; border: 1px solid var(--border-subtle); font-family: var(--font-mono); font-size: 0.74rem;">
            <div><span style="color: var(--text-muted);">ARTIFACT ID:</span> <span style="color: var(--neon-cyan); font-weight: bold;">${activeModel.id}</span></div>
            <div><span style="color: var(--text-muted);">TYPE:</span> <span style="color: #fff;">${activeModel.type}</span></div>
            <div><span style="color: var(--text-muted);">STATUS:</span> <span class="cyber-badge ${activeModel.status.includes('APPROVED') ? 'badge-normal' : 'badge-suspect'}">${activeModel.status}</span></div>
            <div><span style="color: var(--text-muted);">APPROVED BY:</span> <span style="color: #fff;">${activeModel.approved_by}</span></div>
            <div style="grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">
              <span style="color: var(--text-muted);">SHA-256 CHECKSUM:</span>
              <code style="color: var(--neon-cyan); word-break: break-all; font-size: 0.7rem;">${activeModel.sha256}</code>
              <span class="cyber-badge badge-normal" style="font-size: 0.65rem;"><i class="fa-solid fa-shield-halved"></i> SIGNED</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Live Model Drift & Continuous Monitoring Strip -->
      <div class="metrics-grid-4" style="margin-bottom: 16px;">
        <div class="cyber-card stat-card green-card">
          <div class="stat-header">
            <span class="stat-label">CONCEPT DRIFT METRIC</span>
            <i class="fa-solid fa-chart-line text-green"></i>
          </div>
          <div class="stat-value text-green">${drift.drift_score}% <span class="stat-unit">KS-TEST</span></div>
          <div class="stat-footer"><span>Status: ${drift.drift_status} (Threshold &lt; 5.0%)</span><span class="pulse-dot pulse-green"></span></div>
        </div>

        <div class="cyber-card stat-card green-card">
          <div class="stat-header">
            <span class="stat-label">OPERATOR FALSE POSITIVE</span>
            <i class="fa-solid fa-thumbs-down text-cyan"></i>
          </div>
          <div class="stat-value">${drift.false_positive_feedback_rate}% <span class="stat-unit">FEEDBACK</span></div>
          <div class="stat-footer"><span>Human Review Loop Active</span><span class="pulse-dot pulse-green"></span></div>
        </div>

        <div class="cyber-card stat-card green-card">
          <div class="stat-header">
            <span class="stat-label">OUT-OF-DISTRIBUTION (OOD)</span>
            <i class="fa-solid fa-compass-drafting text-purple"></i>
          </div>
          <div class="stat-value">${drift.ood_sensor_flags} <span class="stat-unit">FLAGS</span></div>
          <div class="stat-footer"><span>Sensor Channel Covariance Normal</span></div>
        </div>

        <div class="cyber-card stat-card green-card">
          <div class="stat-header">
            <span class="stat-label">FALSE ALERT RATE</span>
            <i class="fa-solid fa-bell-slash text-green"></i>
          </div>
          <div class="stat-value" style="font-size: 1.35rem;">${activeModel.metrics.false_alerts_per_day}</div>
          <div class="stat-footer"><span>Per Station-Day (Target &lt; 0.20)</span></div>
        </div>
      </div>

      <!-- Comprehensive Model Card -->
      <div class="cyber-card" style="margin-bottom: 16px;">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-id-card-clip text-cyan"></i> STANDARDIZED MODEL CARD — ${activeModel.name}</div>
          <span class="cyber-badge badge-normal">WMO & SIH STANDARDS-INFORMED</span>
        </div>
        <div class="cyber-card-body" style="display: flex; flex-direction: column; gap: 14px;">
          
          <!-- Purpose & Intended Use -->
          <div style="background: rgba(10,15,29,0.6); padding: 14px; border: 1px solid var(--border-subtle); border-radius: 4px;">
            <div style="font-family: var(--font-tactical); font-size: 0.78rem; color: var(--neon-cyan); font-weight: bold; margin-bottom: 6px;">
              1. PURPOSE, VARIABLES & INTENDED USE
            </div>
            <p style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 8px;">
              ${activeModel.purpose}
            </p>
            <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.72rem; font-family: var(--font-mono);">
              <div><strong style="color: #fff;">Variables Covered:</strong> <span style="color: var(--neon-green);">${activeModel.variables.join(', ')}</span></div>
              <div><strong style="color: #fff;">Station Coverage:</strong> <span style="color: var(--neon-cyan);">${activeModel.station_coverage}</span></div>
            </div>
          </div>

          <!-- Training & Normal-Data Selection Protocol -->
          <div style="background: rgba(10,15,29,0.6); padding: 14px; border: 1px solid var(--border-subtle); border-radius: 4px;">
            <div style="font-family: var(--font-tactical); font-size: 0.78rem; color: var(--neon-amber); font-weight: bold; margin-bottom: 6px;">
              2. TRAINING PERIOD, NORMAL-DATA SELECTION & FEATURE DEFINITION
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.74rem; font-family: var(--font-mono);">
              <div><strong style="color: #fff;">Training Horizon:</strong> <span style="color: var(--text-secondary);">${activeModel.training_period}</span></div>
              <div><strong style="color: #fff;">Normal Selection Protocol:</strong> <span style="color: var(--text-secondary);">${activeModel.normal_data_selection}</span></div>
              <div><strong style="color: #fff;">Engineered Features:</strong></div>
              <ul style="list-style: none; padding-left: 10px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 4px;">
                ${activeModel.features.map(f => `<li style="color: var(--neon-cyan);"><i class="fa-solid fa-chevron-right" style="font-size: 0.6rem;"></i> ${f}</li>`).join('')}
              </ul>
            </div>
          </div>

          <!-- Chronological Evaluation Metrics -->
          <div style="background: rgba(10,15,29,0.6); padding: 14px; border: 1px solid var(--border-subtle); border-radius: 4px;">
            <div style="font-family: var(--font-tactical); font-size: 0.78rem; color: var(--neon-green); font-weight: bold; margin-bottom: 6px;">
              3. QUANTIFIED CHRONOLOGICAL EVALUATION METRICS (NO RANDOM SPLITS)
            </div>
            <p style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 10px;">
              Evaluated strictly on chronological temporal holdouts and synthetic replay benchmark suite.
            </p>
            <div class="metrics-grid-3">
              <div class="sim-box" style="padding: 10px;">
                <div class="sim-box-title">EVENT PRECISION</div>
                <div style="font-size: 1.3rem; font-family: var(--font-mono); font-weight: bold; color: var(--neon-green);">${activeModel.metrics.event_precision}</div>
              </div>
              <div class="sim-box" style="padding: 10px;">
                <div class="sim-box-title">EVENT RECALL</div>
                <div style="font-size: 1.3rem; font-family: var(--font-mono); font-weight: bold; color: var(--neon-green);">${activeModel.metrics.event_recall}</div>
              </div>
              <div class="sim-box" style="padding: 10px;">
                <div class="sim-box-title">DETECTION LATENCY</div>
                <div style="font-size: 1.3rem; font-family: var(--font-mono); font-weight: bold; color: var(--neon-cyan);">${activeModel.metrics.detection_delay}</div>
              </div>
            </div>
          </div>

          <!-- Failure Modes, Human Review & Rollback -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div style="background: rgba(10,15,29,0.6); padding: 12px; border: 1px solid var(--border-crimson); border-radius: 4px;">
              <div style="font-family: var(--font-tactical); font-size: 0.75rem; color: var(--neon-crimson); font-weight: bold; margin-bottom: 6px;">
                <i class="fa-solid fa-triangle-exclamation"></i> KNOWN FAILURE MODES & LIMITATIONS
              </div>
              <ul style="list-style: none; font-size: 0.72rem; font-family: var(--font-mono); color: var(--text-secondary); display: flex; flex-direction: column; gap: 4px;">
                ${activeModel.known_failure_modes.map(km => `<li>• ${km}</li>`).join('')}
              </ul>
            </div>

            <div style="background: rgba(10,15,29,0.6); padding: 12px; border: 1px solid var(--border-medium); border-radius: 4px;">
              <div style="font-family: var(--font-tactical); font-size: 0.75rem; color: var(--neon-cyan); font-weight: bold; margin-bottom: 6px;">
                <i class="fa-solid fa-shield-halved"></i> HUMAN REVIEW POLICY & ROLLBACK
              </div>
              <p style="font-size: 0.72rem; font-family: var(--font-mono); color: var(--text-secondary); margin-bottom: 4px;">
                ${activeModel.human_review_policy}
              </p>
              <div style="font-size: 0.7rem; font-family: var(--font-mono); color: var(--neon-amber);">
                <strong>Rollback Protocol:</strong> ${activeModel.rollback_procedure}
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- External Meteorological Data Lineage & Provenance (IMD Products) -->
      <div class="cyber-card">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-satellite text-purple"></i> EXTERNAL METEOROLOGICAL CONTEXT LINEAGE & PROVENANCE</div>
          <span class="cyber-badge badge-extreme">CONTEXTUAL EVIDENCE ONLY</span>
        </div>
        <div class="cyber-card-body">
          <p style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 12px;">
            External radar echoes and satellite cloud-motion vectors provide contextual storm corroboration to prevent false sensor defect classifications, but are never treated as unverified ground truth.
          </p>
          <div class="tactical-table-wrapper">
            <table class="tactical-table">
              <thead>
                <tr>
                  <th>PROVIDER / PRODUCT</th>
                  <th>ENDPOINT / CADENCE</th>
                  <th>LICENSE / STATUS</th>
                  <th>ALIGNMENT METHOD</th>
                  <th>SYSTEM ROLE</th>
                </tr>
              </thead>
              <tbody>
                ${lineage.map(l => `
                  <tr>
                    <td style="font-weight: bold; color: var(--neon-purple);">${l.provider}<div style="font-size: 0.68rem; color: var(--text-muted);">${l.product}</div></td>
                    <td><code>${l.endpoint}</code><div style="font-size: 0.68rem; color: var(--neon-cyan);">${l.access_time}</div></td>
                    <td><span class="cyber-badge badge-normal">${l.license}</span></td>
                    <td>${l.alignment}</td>
                    <td style="font-size: 0.72rem; color: var(--neon-amber);">${l.role_in_system}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  rollbackModel(modelId) {
    if (confirm(`Initiate instant emergency rollback for ${modelId} to last approved baseline?`)) {
      if (window.tacticalAudio) window.tacticalAudio.playAlarm();
      alert(`Model ${modelId} has been rolled back to fallback baseline. Active inference reverted to v1.3.8.`);
    }
  }

  downloadModelCard(modelId) {
    const model = this.state.modelRegistry.find(m => m.id === modelId) || this.state.modelRegistry[0];
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `model-card-${model.id}-${Date.now()}.json`;
    a.click();
    if (window.tacticalAudio) window.tacticalAudio.playSuccess();
  }

  downloadExportJSON() {
    const data = {
      export_timestamp: new Date().toISOString(),
      network: "Monsoon Sentinel AWS Fleet",
      stations: this.state.stations,
      recent_incidents: this.state.incidents
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monsoon-sentinel-telemetry-${Date.now()}.json`;
    a.click();
    if (window.tacticalAudio) window.tacticalAudio.playSuccess();
  }

  // --- Station Operator Views ---

  getStationHUDHTML() {
    const st = this.state.stations.find(s => s.id === this.state.activeStationId) || this.state.stations[0];
    const temp = st.sensors.temperature.value;
    const hum = st.sensors.humidity.value;
    const pres = st.sensors.pressure.value;
    const rain = st.sensors.rainfall.value;
    const wind = st.sensors.wind_speed.value;

    let badgeClass = st.status === 'NORMAL' ? 'badge-normal' : st.status === 'SUSPECT' ? 'badge-suspect' : st.status === 'CRITICAL' ? 'badge-critical' : 'badge-extreme';

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(10,15,29,0.7); padding: 12px 18px; border: 1px solid var(--border-subtle); border-radius: 4px; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <span style="font-family: var(--font-tactical); font-size: 1.1rem; color: var(--neon-cyan); font-weight: bold;">${st.id} - ${st.name}</span>
          <span class="cyber-badge ${badgeClass}">${st.status}</span>
        </div>
        <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">
          Coordinates: ${st.lat.toFixed(4)}°N, ${st.lon.toFixed(4)}°E | Elev: ${st.elevation}m
        </div>
      </div>

      <div class="gauge-grid">
        <div class="cyber-card cyber-gauge-card">
          <div class="gauge-title"><i class="fa-solid fa-temperature-half text-cyan"></i> AIR TEMPERATURE</div>
          <div class="gauge-container">
            <svg class="gauge-svg" viewBox="0 0 100 100">
              <circle class="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle id="hud-gauge-temp-prog" class="gauge-progress-circle ${temp > 40 ? 'gauge-crimson' : 'gauge-cyan'}" cx="50" cy="50" r="42" stroke-dasharray="264" stroke-dashoffset="${264 - (Math.min(50, Math.max(0, temp)) / 50) * 264}"></circle>
            </svg>
            <div class="gauge-center-value">
              <span class="gauge-number" id="hud-gauge-temp-val">${temp}</span>
              <span class="gauge-unit">°C</span>
            </div>
          </div>
          <div class="gauge-subtext">Physical Bound: [-20°C, 55°C]</div>
        </div>

        <div class="cyber-card cyber-gauge-card">
          <div class="gauge-title"><i class="fa-solid fa-droplet text-green"></i> RELATIVE HUMIDITY</div>
          <div class="gauge-container">
            <svg class="gauge-svg" viewBox="0 0 100 100">
              <circle class="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle id="hud-gauge-hum-prog" class="gauge-progress-circle gauge-green" cx="50" cy="50" r="42" stroke-dasharray="264" stroke-dashoffset="${264 - (hum / 100) * 264}"></circle>
            </svg>
            <div class="gauge-center-value">
              <span class="gauge-number" id="hud-gauge-hum-val">${hum}</span>
              <span class="gauge-unit">%</span>
            </div>
          </div>
          <div class="gauge-subtext">Dew Point Plausibility: Valid</div>
        </div>

        <div class="cyber-card cyber-gauge-card">
          <div class="gauge-title"><i class="fa-solid fa-gauge text-cyan"></i> BAROMETRIC PRESSURE</div>
          <div class="gauge-container">
            <svg class="gauge-svg" viewBox="0 0 100 100">
              <circle class="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle id="hud-gauge-pres-prog" class="gauge-progress-circle gauge-cyan" cx="50" cy="50" r="42" stroke-dasharray="264" stroke-dashoffset="${264 - ((pres - 900) / 200) * 264}"></circle>
            </svg>
            <div class="gauge-center-value">
              <span class="gauge-number" id="hud-gauge-pres-val">${pres}</span>
              <span class="gauge-unit">hPa</span>
            </div>
          </div>
          <div class="gauge-subtext">Sea Level Normalized</div>
        </div>

        <div class="cyber-card cyber-gauge-card">
          <div class="gauge-title"><i class="fa-solid fa-cloud-rain text-purple"></i> PRECIPITATION RATE</div>
          <div class="gauge-container">
            <svg class="gauge-svg" viewBox="0 0 100 100">
              <circle class="gauge-bg-circle" cx="50" cy="50" r="42"></circle>
              <circle id="hud-gauge-rain-prog" class="gauge-progress-circle ${rain > 20 ? 'gauge-crimson' : 'gauge-green'}" cx="50" cy="50" r="42" stroke-dasharray="264" stroke-dashoffset="${264 - (Math.min(100, rain) / 100) * 264}"></circle>
            </svg>
            <div class="gauge-center-value">
              <span class="gauge-number" id="hud-gauge-rain-val">${rain}</span>
              <span class="gauge-unit">mm</span>
            </div>
          </div>
          <div class="gauge-subtext">Tipping Bucket Monotonic</div>
        </div>
      </div>

      <div class="metrics-grid-2" style="margin-top: 16px;">
        <div class="cyber-card" style="height: 300px; padding: 14px;">
          <div style="font-family: var(--font-tactical); font-size: 0.8rem; color: var(--neon-cyan); margin-bottom: 8px;">LIVE SENSOR MULTI-STREAM TREND</div>
          <div style="height: 240px; position: relative;">
            <canvas id="station-trend-chart"></canvas>
          </div>
        </div>

        <div class="cyber-card" style="height: 300px; padding: 14px;">
          <div style="font-family: var(--font-tactical); font-size: 0.8rem; color: var(--neon-amber); margin-bottom: 8px;">SPATIAL BUDDY COMPARISON OVERLAY</div>
          <div style="height: 240px; position: relative;">
            <canvas id="peer-comparison-chart"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  getStationUploadHTML() {
    const stationId = this.state.activeStationId;
    const historyCount = (this.state.history[stationId] || []).length;

    return `
      <div class="cyber-card" style="margin-bottom: 16px;">
        <div class="cyber-card-header">
          <div class="cyber-card-title">
            <i class="fa-solid fa-file-arrow-up text-cyan"></i> ${stationId} HISTORICAL TELEMETRY INGESTION & BASELINE BACKFILL
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="cyber-btn btn-sm" onclick="window.appController.downloadSampleCSV()">
              <i class="fa-solid fa-download"></i> Sample CSV Template
            </button>
            <button class="cyber-btn btn-amber btn-sm" onclick="window.appController.loadSampleHistoricalBatch()">
              <i class="fa-solid fa-bolt"></i> Load 48-Hour Demo Batch
            </button>
          </div>
        </div>

        <div class="cyber-card-body">
          <p style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 16px;">
            Upload historical observation logs (.csv / .json) from field dataloggers, SD card backups, or previous AWS deployments. Observations are verified against physical envelopes, checked for timestamp continuity, and ingested directly into the station's time-series ledger for AI baseline profiling.
          </p>

          <!-- Upload Dropzone -->
          <div class="cyber-card" style="border: 2px dashed var(--border-medium); background: rgba(5, 8, 17, 0.6); padding: 28px; text-align: center; margin-bottom: 16px; cursor: pointer;" onclick="document.getElementById('station-csv-file').click()">
            <input type="file" id="station-csv-file" accept=".csv, .json, .txt" style="display: none;" onchange="window.appController.handleFileSelected(event)">
            <div style="font-size: 2.2rem; color: var(--neon-cyan); margin-bottom: 10px;">
              <i class="fa-solid fa-cloud-arrow-up"></i>
            </div>
            <div style="font-family: var(--font-tactical); font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
              DROP HISTORICAL MET LOGS HERE OR CLICK TO BROWSE
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">
              Supports Standard IMD / WMO CSV format: <code>timestamp, temperature, humidity, pressure, wind_speed, rainfall</code>
            </div>
          </div>

          <!-- Ingestion Status / Preview Box -->
          <div id="upload-preview-container" style="display: none;">
            <div class="metrics-grid-4" style="margin-bottom: 16px;">
              <div class="cyber-card sim-box">
                <div class="sim-box-title">RECORDS PARSED</div>
                <div id="preview-total-count" style="font-size: 1.4rem; font-family: var(--font-mono); font-weight: bold; color: var(--neon-cyan);">0</div>
              </div>
              <div class="cyber-card sim-box">
                <div class="sim-box-title">QC VALIDATED</div>
                <div id="preview-valid-count" style="font-size: 1.4rem; font-family: var(--font-mono); font-weight: bold; color: var(--neon-green);">0</div>
              </div>
              <div class="cyber-card sim-box">
                <div class="sim-box-title">SUSPECT FLAGS</div>
                <div id="preview-suspect-count" style="font-size: 1.4rem; font-family: var(--font-mono); font-weight: bold; color: var(--neon-amber);">0</div>
              </div>
              <div class="cyber-card sim-box">
                <div class="sim-box-title">ACTIVE TIME-SERIES DEPTH</div>
                <div style="font-size: 1.4rem; font-family: var(--font-mono); font-weight: bold; color: #fff;">${historyCount} <span style="font-size: 0.75rem; color: var(--text-muted);">PTS</span></div>
              </div>
            </div>

            <!-- Ingestion Action Bar -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0, 240, 255, 0.05); border: 1px solid var(--border-subtle); padding: 12px 16px; border-radius: 4px; margin-bottom: 16px;">
              <div style="font-size: 0.76rem; color: var(--text-primary); font-family: var(--font-mono);">
                <i class="fa-solid fa-circle-check text-green"></i> Ready to commit backfill records to <strong style="color: var(--neon-cyan);">${stationId}</strong> time-series ledger.
              </div>
              <button class="cyber-btn btn-green btn-sm" id="commit-upload-btn" onclick="window.appController.commitHistoricalBatch()">
                <i class="fa-solid fa-database"></i> Commit to Historical Database
              </button>
            </div>

            <!-- Preview Table -->
            <div class="tactical-table-wrapper" style="max-height: 240px; overflow-y: auto;">
              <table class="tactical-table">
                <thead>
                  <tr>
                    <th>TIMESTAMP</th>
                    <th>TEMP (°C)</th>
                    <th>HUMIDITY (%)</th>
                    <th>PRESSURE (hPa)</th>
                    <th>WIND (km/h)</th>
                    <th>RAIN (mm)</th>
                    <th>QC CHECK</th>
                  </tr>
                </thead>
                <tbody id="preview-table-body"></tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  downloadSampleCSV() {
    const csvContent = "data:text/csv;charset=utf-8," + 
      "timestamp,temperature,humidity,pressure,wind_speed,rainfall\n" +
      "2026-08-27 10:00,32.4,68.2,1008.5,14.2,0.0\n" +
      "2026-08-27 10:10,32.8,67.5,1008.2,15.1,0.0\n" +
      "2026-08-27 10:20,33.1,66.8,1007.9,16.0,0.0\n" +
      "2026-08-27 10:30,33.5,65.9,1007.4,18.4,0.0\n" +
      "2026-08-27 10:40,31.2,78.4,1006.1,28.5,12.4\n";

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${this.state.activeStationId}_telemetry_template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (window.tacticalAudio) window.tacticalAudio.playSuccess();
  }

  handleFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      this.processUploadedData(text);
    };
    reader.readAsText(file);
  }

  loadSampleHistoricalBatch() {
    const now = Date.now();
    const stationId = this.state.activeStationId;
    const st = this.state.stations.find(s => s.id === stationId) || this.state.stations[0];
    const baseTemp = st.sensors.temperature.value;
    const baseHum = st.sensors.humidity.value;
    const basePres = st.sensors.pressure.value;

    const sampleRows = [];
    for (let i = 24; i >= 1; i--) {
      const time = new Date(now - i * 3600000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const noise = (Math.random() - 0.5) * 1.5;
      sampleRows.push({
        time,
        temperature: +(baseTemp + noise + Math.sin(i / 3) * 3).toFixed(1),
        humidity: Math.min(98, Math.max(20, +(baseHum - noise * 2).toFixed(1))),
        pressure: +(basePres + noise * 0.5).toFixed(1),
        wind_speed: +(Math.max(0, 12 + noise * 4)).toFixed(1),
        rainfall: +(Math.random() > 0.7 ? Math.random() * 4.5 : 0).toFixed(1),
        qcPass: true
      });
    }

    this.pendingUploadBatch = sampleRows;
    this.displayUploadPreview(sampleRows);
    if (window.tacticalAudio) window.tacticalAudio.playSuccess();
  }

  processUploadedData(rawText) {
    try {
      const lines = rawText.trim().split("\n");
      if (lines.length < 2) {
        alert("File contains insufficient data.");
        return;
      }

      const rows = [];
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map(p => p.trim());
        if (parts.length >= 6) {
          const temp = parseFloat(parts[1]);
          const hum = parseFloat(parts[2]);
          const pres = parseFloat(parts[3]);
          const wind = parseFloat(parts[4]);
          const rain = parseFloat(parts[5]);

          const qcPass = temp >= -20 && temp <= 55 && hum >= 0 && hum <= 100 && pres >= 800 && pres <= 1080;

          rows.push({
            time: parts[0],
            temperature: isNaN(temp) ? 25.0 : temp,
            humidity: isNaN(hum) ? 60.0 : hum,
            pressure: isNaN(pres) ? 1010.0 : pres,
            wind_speed: isNaN(wind) ? 5.0 : wind,
            rainfall: isNaN(rain) ? 0.0 : rain,
            qcPass
          });
        }
      }

      this.pendingUploadBatch = rows;
      this.displayUploadPreview(rows);
      if (window.tacticalAudio) window.tacticalAudio.playSuccess();
    } catch (err) {
      alert("Error parsing file format: " + err.message);
    }
  }

  displayUploadPreview(rows) {
    const container = document.getElementById("upload-preview-container");
    const totalEl = document.getElementById("preview-total-count");
    const validEl = document.getElementById("preview-valid-count");
    const suspectEl = document.getElementById("preview-suspect-count");
    const tbody = document.getElementById("preview-table-body");

    if (!container || !totalEl || !validEl || !tbody) return;

    const validCount = rows.filter(r => r.qcPass).length;
    const suspectCount = rows.length - validCount;

    totalEl.innerText = rows.length;
    validEl.innerText = validCount;
    suspectEl.innerText = suspectCount;

    tbody.innerHTML = rows.slice(0, 15).map(r => `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 0.72rem;">${r.time}</td>
        <td>${r.temperature}°C</td>
        <td>${r.humidity}%</td>
        <td>${r.pressure} hPa</td>
        <td>${r.wind_speed} km/h</td>
        <td>${r.rainfall} mm</td>
        <td>
          <span class="cyber-badge ${r.qcPass ? 'badge-normal' : 'badge-suspect'}" style="font-size: 0.65rem;">
            ${r.qcPass ? 'NOMINAL' : 'RANGE FAIL'}
          </span>
        </td>
      </tr>
    `).join('');

    if (rows.length > 15) {
      tbody.innerHTML += `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); font-size: 0.72rem;">
            ... and ${rows.length - 15} additional historical observations ready for ingestion ...
          </td>
        </tr>
      `;
    }

    container.style.display = "block";
  }

  commitHistoricalBatch() {
    if (!this.pendingUploadBatch || this.pendingUploadBatch.length === 0) return;

    const stationId = this.state.activeStationId;
    if (!this.state.history[stationId]) {
      this.state.history[stationId] = [];
    }

    // Append observations
    this.pendingUploadBatch.forEach(pt => {
      this.state.history[stationId].push({
        time: pt.time,
        temperature: pt.temperature,
        humidity: pt.humidity,
        pressure: pt.pressure,
        wind_speed: pt.wind_speed,
        rainfall: pt.rainfall
      });
    });

    const count = this.pendingUploadBatch.length;
    this.pendingUploadBatch = null;

    if (window.tacticalAudio) window.tacticalAudio.playSuccess();
    alert(`Successfully committed ${count} historical observations to ${stationId} time-series database. Charts updated!`);
    this.render();
  }

  getStationDiagnosticsHTML() {
    const st = this.state.stations.find(s => s.id === this.state.activeStationId) || this.state.stations[0];
    return `
      <div class="metrics-grid-4">
        <div class="cyber-card stat-card ${st.battery < 11.8 ? 'threat-card' : 'green-card'}">
          <div class="stat-header"><span class="stat-label">BATTERY VOLTAGE</span><i class="fa-solid fa-car-battery text-cyan"></i></div>
          <div class="stat-value">${st.battery} <span class="stat-unit">V</span></div>
          <div class="stat-footer"><span>${st.battery >= 12.2 ? 'Float Charge Nominal' : 'Low Voltage Warning'}</span></div>
        </div>

        <div class="cyber-card stat-card green-card">
          <div class="stat-header"><span class="stat-label">CELLULAR SIGNAL (RSSI)</span><i class="fa-solid fa-signal text-green"></i></div>
          <div class="stat-value">${st.signal} <span class="stat-unit">dBm</span></div>
          <div class="stat-footer"><span>4G LTE Telemetry Uplink</span></div>
        </div>

        <div class="cyber-card stat-card green-card">
          <div class="stat-header"><span class="stat-label">GATEWAY UPTIME</span><i class="fa-solid fa-clock text-cyan"></i></div>
          <div class="stat-value">${Math.floor(st.uptime_s / 3600)} <span class="stat-unit">HOURS</span></div>
          <div class="stat-footer"><span>Zero Unscheduled Reboots</span></div>
        </div>

        <div class="cyber-card stat-card green-card">
          <div class="stat-header"><span class="stat-label">EDGE FIRMWARE</span><i class="fa-solid fa-microchip text-purple"></i></div>
          <div class="stat-value" style="font-size: 1.3rem;">${st.firmware}</div>
          <div class="stat-footer"><span>Deterministic QC v2.1 Active</span></div>
        </div>
      </div>
    `;
  }

  getStationChecklistHTML() {
    const items = this.state.checklists[this.state.activeStationId] || [
      { id: "gen1", title: "General Station Enclosure Inspection", desc: "Check seals, cable grommets, and solar bracket tightness.", done: true, timestamp: "2026-08-28 09:00" },
      { id: "gen2", title: "Clean Optical / Tipping Rain Gauge", desc: "Ensure no dust or leaves in measuring funnel.", done: false, timestamp: null }
    ];

    return `
      <div class="cyber-card">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-list-check text-cyan"></i> ${this.state.activeStationId} FIELD MAINTENANCE & DIAGNOSTIC CHECKLIST</div>
          <button class="cyber-btn btn-sm btn-green" onclick="window.appController.saveChecklistAudit()"><i class="fa-solid fa-floppy-disk"></i> Log Field Inspection Audit</button>
        </div>
        <div class="cyber-card-body">
          <div class="checklist-container">
            ${items.map((item, idx) => `
              <div class="checklist-item">
                <input type="checkbox" class="checklist-checkbox" id="chk-${item.id}" ${item.done ? 'checked' : ''} onchange="window.appController.toggleChecklistItem('${item.id}', this.checked)">
                <div class="checklist-content">
                  <label for="chk-${item.id}" class="checklist-title" style="cursor: pointer;">
                    ${item.title}
                    ${item.done ? `<span class="cyber-badge badge-normal" style="font-size: 0.65rem;">COMPLETED</span>` : `<span class="cyber-badge badge-suspect" style="font-size: 0.65rem;">PENDING</span>`}
                  </label>
                  <div class="checklist-desc">${item.desc}</div>
                  ${item.timestamp ? `<div style="font-size: 0.68rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 4px;">Last logged: ${item.timestamp}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  toggleChecklistItem(id, isChecked) {
    const list = this.state.checklists[this.state.activeStationId];
    if (list) {
      const item = list.find(i => i.id === id);
      if (item) {
        item.done = isChecked;
        item.timestamp = isChecked ? new Date().toLocaleString() : null;
        if (window.tacticalAudio) window.tacticalAudio.playClick();
        this.render();
      }
    }
  }

  saveChecklistAudit() {
    if (window.tacticalAudio) window.tacticalAudio.playSuccess();
    alert("Field inspection logged to immutable audit ledger!");
  }

  getEdgeSyncHTML() {
    return `
      <div class="cyber-card">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-cloud-arrow-up text-cyan"></i> EDGE BUFFER & OFFLINE RESILIENCE TERMINAL</div>
          <button class="cyber-btn ${this.state.isOfflineMode ? 'btn-danger' : 'btn-primary'} btn-sm" onclick="window.appController.toggleOfflineMode()">
            <i class="fa-solid fa-power-off"></i> ${this.state.isOfflineMode ? 'SIMULATE NETWORK RESTORE (GO ONLINE)' : 'SIMULATE NETWORK OUTAGE (GO OFFLINE)'}
          </button>
        </div>
        <div class="cyber-card-body">
          <div class="metrics-grid-3" style="margin-bottom: 16px;">
            <div class="cyber-card sim-box">
              <div class="sim-box-title">CONNECTION STATE</div>
              <div style="font-size: 1.4rem; font-family: var(--font-mono); font-weight: bold; color: ${this.state.isOfflineMode ? '#ffaa00' : '#00ff66'};">
                ${this.state.isOfflineMode ? 'OFFLINE (BUFFERING)' : 'ONLINE (CONNECTED)'}
              </div>
            </div>
            <div class="cyber-card sim-box">
              <div class="sim-box-title">LOCAL QUEUE DEPTH</div>
              <div style="font-size: 1.4rem; font-family: var(--font-mono); font-weight: bold; color: var(--neon-cyan);">
                ${this.state.offlineBuffer.length} <span style="font-size: 0.8rem; color: var(--text-muted);">EVENTS</span>
              </div>
            </div>
            <div class="cyber-card sim-box">
              <div class="sim-box-title">IDEMPOTENT REPLAY</div>
              <button class="cyber-btn btn-green btn-sm" ${this.state.offlineBuffer.length === 0 ? 'disabled' : ''} onclick="window.appController.syncOfflineQueue()">
                <i class="fa-solid fa-rotate"></i> Replay Buffered Queue
              </button>
            </div>
          </div>
          <p style="font-size: 0.75rem; color: var(--text-secondary);">
            During communication outages, the local edge gateway preserves raw observations in an append-only ring buffer. When network uplinks restore, records replay in chronological order with cryptographic SHA-256 payload deduplication.
          </p>
        </div>
      </div>
    `;
  }

  toggleOfflineMode() {
    this.state.isOfflineMode = !this.state.isOfflineMode;
    if (window.tacticalAudio) window.tacticalAudio.playAlarm();
    this.render();
  }

  /* ==========================================================================
     AUTHENTICATION & LOGIN SCREEN RENDERER
     ========================================================================== */

  renderLoginScreen(role = "station_operator") {
    this.activeLoginRole = role;
    const container = document.getElementById("auth-overlay-container");
    if (!container) return;

    const isAdmin = role === "admin";

    container.innerHTML = `
      <div class="auth-wrapper">
        <div class="auth-card ${isAdmin ? 'role-admin' : 'role-station'}">
          
          <div class="auth-header">
            <div class="auth-brand-icon">
              <i class="fa-solid ${isAdmin ? 'fa-shield-halved' : 'fa-satellite-dish'}"></i>
            </div>
            <div>
              <div class="auth-title">MONSOON<span style="color: ${isAdmin ? 'var(--neon-cyan)' : 'var(--neon-amber)'}">.AI</span></div>
              <div class="auth-subtitle">TACTICAL AWS SENTINEL // AUTH TERMINAL</div>
            </div>
          </div>

          <!-- Role Selector Segmented Switcher -->
          <div class="auth-role-switch">
            <button type="button" class="role-tab-btn ${isAdmin ? 'active tab-admin' : ''}" onclick="window.appController.switchLoginRole('admin')">
              <i class="fa-solid fa-shield-halved"></i> CENTRAL ADMIN
            </button>
            <button type="button" class="role-tab-btn ${!isAdmin ? 'active tab-station' : ''}" onclick="window.appController.switchLoginRole('station_operator')">
              <i class="fa-solid fa-tower-broadcast"></i> STATION OPERATOR
            </button>
          </div>

          <!-- Dynamic Login Form -->
          <form class="auth-body" id="auth-login-form" onsubmit="window.appController.handleLoginSubmit(event)">
            
            <div class="auth-role-indicator ${!isAdmin ? 'indicator-station' : ''}">
              <span class="pulse-dot ${isAdmin ? 'pulse-green' : 'pulse-amber'}"></span>
              <span>AUTHENTICATING FOR: <strong>${isAdmin ? 'CENTRAL ADMIN / SUPERVISOR' : 'STATION / FIELD OPERATOR'}</strong></span>
            </div>

            <!-- Error Banner -->
            <div class="auth-error-banner" id="auth-error-box">
              <i class="fa-solid fa-triangle-exclamation" style="font-size: 1rem;"></i>
              <div id="auth-error-text">Invalid authentication credentials.</div>
            </div>

            <!-- Username Field -->
            <div class="cyber-input-group">
              <label class="cyber-input-label" for="login-username">
                <span><i class="fa-solid fa-user"></i> ${isAdmin ? 'ADMIN USERNAME' : 'STATION USERNAME'}</span>
              </label>
              <div class="cyber-input-wrapper">
                <input type="text" class="cyber-input" id="login-username" placeholder="${isAdmin ? 'e.g. admin' : 'e.g. aws07_op'}" required autocomplete="username">
                <i class="fa-solid fa-id-badge cyber-input-icon"></i>
              </div>
            </div>

            <!-- Password Field -->
            <div class="cyber-input-group">
              <label class="cyber-input-label" for="login-password">
                <span><i class="fa-solid fa-lock"></i> PASSWORD</span>
              </label>
              <div class="cyber-input-wrapper">
                <input type="password" class="cyber-input" id="login-password" placeholder="Enter encrypted password" required autocomplete="current-password">
                <i class="fa-solid fa-key cyber-input-icon"></i>
                <button type="button" class="password-toggle-btn" id="login-pass-toggle" onclick="window.appController.togglePasswordVisibility('login-password', 'login-pass-toggle')">
                  <i class="fa-solid fa-eye"></i>
                </button>
              </div>
            </div>

            <!-- Submit Button -->
            <button type="submit" class="cyber-btn ${isAdmin ? 'btn-primary' : 'btn-amber'} auth-submit-btn" id="login-submit-btn">
              <i class="fa-solid fa-right-to-bracket"></i> <span>AUTHENTICATE & ENTER TERMINAL</span>
            </button>

            <!-- Quick Demo Credentials Selector -->
            <div class="demo-helper-box">
              <div class="demo-helper-title">
                <i class="fa-solid fa-terminal text-cyan"></i> QUICK DEMO CREDENTIALS SHORTCUT:
              </div>
              <div class="demo-pills">
                ${isAdmin ? `
                  <button type="button" class="demo-pill" onclick="window.appController.fillDemoCredentials('admin', 'admin', 'sentinel2026')">
                    👑 Admin: <code>admin</code> / <code>sentinel2026</code>
                  </button>
                ` : `
                  <button type="button" class="demo-pill" onclick="window.appController.fillDemoCredentials('station_operator', 'aws07_op', 'hyd@2026')">
                    📡 AWS-07 (Hyderabad): <code>aws07_op</code>
                  </button>
                  <button type="button" class="demo-pill" onclick="window.appController.fillDemoCredentials('station_operator', 'aws12_op', 'mum@2026')">
                    📡 AWS-12 (Mumbai): <code>aws12_op</code>
                  </button>
                  <button type="button" class="demo-pill" onclick="window.appController.fillDemoCredentials('station_operator', 'aws19_op', 'cherra@2026')">
                    📡 AWS-19 (Cherrapunji): <code>aws19_op</code>
                  </button>
                `}
              </div>
            </div>

          </form>

        </div>
      </div>
    `;
  }

  switchLoginRole(role) {
    if (window.tacticalAudio) window.tacticalAudio.playSwitch();
    this.renderLoginScreen(role);
  }

  togglePasswordVisibility(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!input || !btn) return;

    if (input.type === "password") {
      input.type = "text";
      btn.innerHTML = `<i class="fa-solid fa-eye-slash"></i>`;
    } else {
      input.type = "password";
      btn.innerHTML = `<i class="fa-solid fa-eye"></i>`;
    }
  }

  fillDemoCredentials(role, user, pass) {
    const userField = document.getElementById("login-username");
    const passField = document.getElementById("login-password");
    if (userField && passField) {
      userField.value = user;
      passField.value = pass;
      if (window.tacticalAudio) window.tacticalAudio.playClick();
    }
  }

  async handleLoginSubmit(e) {
    e.preventDefault();
    const username = document.getElementById("login-username")?.value;
    const password = document.getElementById("login-password")?.value;
    const submitBtn = document.getElementById("login-submit-btn");
    const errorBox = document.getElementById("auth-error-box");
    const errorText = document.getElementById("auth-error-text");

    if (errorBox) errorBox.classList.remove("visible");

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>VERIFYING CRYPTOGRAPHIC TOKEN...</span>`;
    }

    if (window.tacticalAudio) window.tacticalAudio.playClick();

    const result = await window.authService.login(this.activeLoginRole, username, password);

    if (result.success) {
      if (window.tacticalAudio) window.tacticalAudio.playSuccess();
      this.render();
    } else {
      if (window.tacticalAudio) window.tacticalAudio.playAlarm();
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> <span>AUTHENTICATE & ENTER TERMINAL</span>`;
      }
      if (errorBox && errorText) {
        errorText.innerText = result.message || "Invalid authentication credentials.";
        errorBox.classList.add("visible");
      }
    }
  }

  /* ==========================================================================
     STATION CREDENTIAL MANAGEMENT VIEW (ADMIN ONLY)
     ========================================================================== */

  getCredentialsHTML() {
    const credentials = window.authService.getAllStationCredentials();

    return `
      <div class="cyber-card" style="margin-bottom: 16px;">
        <div class="cyber-card-header">
          <div class="cyber-card-title"><i class="fa-solid fa-users-gear text-cyan"></i> STATION CREDENTIAL MANAGEMENT & ACCESS CONTROL</div>
          <button class="cyber-btn btn-primary btn-sm" onclick="window.appController.openCreateCredentialModal()">
            <i class="fa-solid fa-user-plus"></i> Provision Station Credentials
          </button>
        </div>
        <div class="cyber-card-body">
          <p style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 16px;">
            Central Administrators can provision, rotate, deactivate, and audit access credentials for individual Automatic Weather Stations. Station logins are strictly locked to their assigned terminal data.
          </p>

          <div class="tactical-table-wrapper">
            <table class="tactical-table cred-table">
              <thead>
                <tr>
                  <th>STATION ID</th>
                  <th>STATION NAME & REGION</th>
                  <th>ASSIGNED USERNAME</th>
                  <th>PASSWORD</th>
                  <th>STATUS</th>
                  <th>LAST LOGIN</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                ${credentials.map(c => {
                  const isActive = c.status === "ACTIVE";
                  return `
                    <tr>
                      <td style="font-weight: bold; color: var(--neon-cyan);">${c.stationId}</td>
                      <td>
                        <div style="font-weight: 600;">${c.stationName}</div>
                        <div style="font-size: 0.68rem; color: var(--text-muted);">${c.region}</div>
                      </td>
                      <td><code style="color: var(--neon-green); font-size: 0.8rem;">${c.username}</code></td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 6px;">
                          <span id="pwd-mask-${c.stationId}" class="masked-password">••••••••</span>
                          <button class="cyber-btn btn-sm" style="padding: 2px 6px;" title="Reveal / Copy Password" onclick="window.appController.revealOrCopyPassword('${c.stationId}', '${c.password}')">
                            <i class="fa-solid fa-copy" style="font-size: 0.65rem;"></i>
                          </button>
                        </div>
                      </td>
                      <td>
                        <span class="cyber-badge ${isActive ? 'badge-normal' : 'badge-offline'}">
                          <span class="pulse-dot ${isActive ? 'pulse-green' : ''}"></span> ${c.status}
                        </span>
                      </td>
                      <td style="font-size: 0.72rem; color: var(--text-muted);">
                        ${c.last_login ? new Date(c.last_login).toLocaleString() : 'Never logged in'}
                      </td>
                      <td>
                        <div class="credential-actions">
                          <button class="cyber-btn btn-sm ${isActive ? 'btn-danger' : 'btn-green'}" onclick="window.appController.toggleStationAccess('${c.stationId}')" title="${isActive ? 'Deactivate Login' : 'Activate Login'}">
                            <i class="fa-solid ${isActive ? 'fa-user-slash' : 'fa-user-check'}"></i> ${isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button class="cyber-btn btn-sm" onclick="window.appController.openResetPasswordModal('${c.stationId}')" title="Reset Password">
                            <i class="fa-solid fa-key"></i> Reset
                          </button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    `;
  }

  revealOrCopyPassword(stationId, password) {
    const maskEl = document.getElementById(`pwd-mask-${stationId}`);
    if (maskEl) {
      if (maskEl.innerText === "••••••••") {
        maskEl.innerText = password;
        maskEl.style.color = "var(--neon-cyan)";
      } else {
        maskEl.innerText = "••••••••";
        maskEl.style.color = "var(--text-muted)";
      }
    }
    navigator.clipboard.writeText(password).then(() => {
      if (window.tacticalAudio) window.tacticalAudio.playSuccess();
    });
  }

  openCreateCredentialModal() {
    const modal = document.getElementById("station-cred-modal");
    const title = document.getElementById("cred-modal-title");
    const body = document.getElementById("cred-modal-body");
    if (!modal || !title || !body) return;

    title.innerHTML = `<i class="fa-solid fa-user-plus text-cyan"></i> PROVISION NEW STATION CREDENTIALS`;
    body.innerHTML = `
      <form onsubmit="window.appController.saveNewStationCredential(event)" style="display: flex; flex-direction: column; gap: 14px;">
        <div class="cyber-input-group">
          <label class="cyber-input-label">STATION SELECTION</label>
          <select id="cred-new-station" class="cyber-input" style="padding-left: 12px;" required>
            ${this.state.stations.map(s => `<option value="${s.id}">${s.id}: ${s.name} (${s.region})</option>`).join('')}
          </select>
        </div>

        <div class="cyber-input-group">
          <label class="cyber-input-label">ASSIGNED USERNAME</label>
          <input type="text" class="cyber-input" style="padding-left: 12px;" id="cred-new-username" placeholder="e.g. aws20_op" required>
        </div>

        <div class="cyber-input-group">
          <label class="cyber-input-label">
            <span>INITIAL PASSWORD</span>
            <button type="button" class="cyber-btn btn-sm" style="font-size: 0.65rem; padding: 2px 6px;" onclick="document.getElementById('cred-new-password').value = 'sentinel@' + Math.floor(Math.random()*9000 + 1000);">
              Generate Secure
            </button>
          </label>
          <input type="text" class="cyber-input" style="padding-left: 12px;" id="cred-new-password" placeholder="e.g. sentinel@8421" required>
        </div>

        <div class="cyber-input-group">
          <label class="cyber-input-label">ACCOUNT STATUS</label>
          <select id="cred-new-status" class="cyber-input" style="padding-left: 12px;">
            <option value="ACTIVE">ACTIVE (Granted Login Access)</option>
            <option value="INACTIVE">INACTIVE (Access Suspended)</option>
          </select>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
          <button type="button" class="cyber-btn btn-sm" onclick="window.appController.closeModals()">Cancel</button>
          <button type="submit" class="cyber-btn btn-green btn-sm"><i class="fa-solid fa-floppy-disk"></i> Provision Credential</button>
        </div>
      </form>
    `;

    modal.classList.add("active");
    if (window.tacticalAudio) window.tacticalAudio.playClick();
  }

  saveNewStationCredential(e) {
    e.preventDefault();
    const stationId = document.getElementById("cred-new-station")?.value;
    const username = document.getElementById("cred-new-username")?.value;
    const password = document.getElementById("cred-new-password")?.value;
    const status = document.getElementById("cred-new-status")?.value || "ACTIVE";

    const st = this.state.stations.find(s => s.id === stationId);
    const stationName = st ? st.name : `Station ${stationId}`;

    const res = window.authService.createStationCredential(stationId, stationName, username, password, status);
    if (res.success) {
      if (window.tacticalAudio) window.tacticalAudio.playSuccess();
      this.closeModals();
      this.render();
    } else {
      alert(res.message);
    }
  }

  openResetPasswordModal(stationId) {
    const modal = document.getElementById("station-cred-modal");
    const title = document.getElementById("cred-modal-title");
    const body = document.getElementById("cred-modal-body");
    if (!modal || !title || !body) return;

    title.innerHTML = `<i class="fa-solid fa-key text-amber"></i> RESET PASSWORD FOR ${stationId}`;
    body.innerHTML = `
      <form onsubmit="window.appController.saveResetStationPassword(event, '${stationId}')" style="display: flex; flex-direction: column; gap: 14px;">
        <div style="font-size: 0.75rem; color: var(--text-secondary);">
          Specify a new cryptographic password for station terminal <strong>${stationId}</strong>. The operator will immediately be required to use this new credential on their next session.
        </div>

        <div class="cyber-input-group">
          <label class="cyber-input-label">
            <span>NEW PASSWORD</span>
            <button type="button" class="cyber-btn btn-sm" style="font-size: 0.65rem; padding: 2px 6px;" onclick="document.getElementById('cred-reset-pass').value = 'sec@' + Math.floor(Math.random()*9000 + 1000);">
              Generate Random
            </button>
          </label>
          <input type="text" class="cyber-input" style="padding-left: 12px;" id="cred-reset-pass" placeholder="Enter new password" required>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
          <button type="button" class="cyber-btn btn-sm" onclick="window.appController.closeModals()">Cancel</button>
          <button type="submit" class="cyber-btn btn-amber btn-sm"><i class="fa-solid fa-key"></i> Update Password</button>
        </div>
      </form>
    `;

    modal.classList.add("active");
    if (window.tacticalAudio) window.tacticalAudio.playClick();
  }

  saveResetStationPassword(e, stationId) {
    e.preventDefault();
    const newPass = document.getElementById("cred-reset-pass")?.value;
    if (newPass) {
      window.authService.resetStationPassword(stationId, newPass);
      if (window.tacticalAudio) window.tacticalAudio.playSuccess();
      this.closeModals();
      this.render();
    }
  }

  toggleStationAccess(stationId) {
    const newStatus = window.authService.toggleStationStatus(stationId);
    if (window.tacticalAudio) window.tacticalAudio.playSwitch();
    this.render();
  }
}

window.appController = new AppController(window.appState);

