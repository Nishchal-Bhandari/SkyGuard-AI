/**
 * SkyGuard-AI — Backend API Client
 * 
 * Handles authenticated communication with the FastAPI / Cloud PostgreSQL backend service.
 */

const API_ROOT = import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '') : '';
const API_BASE = `${API_ROOT}/api/v1`;

export function isTokenExpired(token) {
  try {
    const parts = token?.split('.');
    if (parts?.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const now = Math.floor(Date.now() / 1000);
    return !Number.isInteger(payload.exp) || payload.exp <= now ||
      !Number.isInteger(payload.iat) || payload.iat > now + 60 || payload.iat < now - 7 * 24 * 3600;
  } catch {
    return true;
  }
}

class ApiClient {
  constructor() {
    this.token = null;
    this.tokenInvalidated = false;
    this.syncTokenFromStorage();
  }

  syncTokenFromStorage() {
    if (this.tokenInvalidated) return null;
    try {
      const savedAuth = localStorage.getItem("skyguard_auth_v3") || localStorage.getItem("skyguard_auth_v2");
      if (savedAuth) {
        const parsed = JSON.parse(savedAuth);
        if (parsed && parsed.token && !isTokenExpired(parsed.token)) {
          this.token = parsed.token;
          return this.token;
        }
      }
    } catch (e) {}
    return null;
  }

  getToken() {
    if (this.tokenInvalidated) return null;
    if (this.token) return this.token;
    return this.syncTokenFromStorage();
  }

  setToken(token) {
    this.token = token;
    this.tokenInvalidated = false;
  }

  clearToken() {
    this.token = null;
    this.tokenInvalidated = true;
  }

  async request(endpoint, options = {}) {
    const cleanEndpoint = endpoint.startsWith('/api/v1') ? endpoint.slice(7) : endpoint;
    const url = `${API_BASE}${cleanEndpoint.startsWith('/') ? '' : '/'}${cleanEndpoint}`;
    const isFormData = options.body instanceof FormData;
    const token = this.getToken();
    const isPublicEndpoint = ['/health', '/auth/admin/login', '/auth/station/login'].includes(cleanEndpoint);

    if (!token && !isPublicEndpoint) {
      const error = new Error('Please sign in to continue.');
      error.status = 401;
      error.isAuthenticationError = true;
      window.dispatchEvent(new CustomEvent('skyguard:session-expired', { detail: { endpoint } }));
      throw error;
    }

    const headers = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorDetail = typeof data.detail === 'object' ? JSON.stringify(data.detail) : (data.detail || data.message || `Request failed with HTTP ${response.status}`);
        // A 401 on any authenticated route means the session is dead (missing/expired/invalid
        // token). Login endpoints return 401 for bad credentials, which is a normal flow the
        // login screen already handles, so they must not trigger a forced session reset.
        if (response.status === 401 && !endpoint.startsWith("/auth/")) {
          this.clearToken();
          window.dispatchEvent(new CustomEvent("skyguard:session-expired", { detail: { endpoint } }));
        }
        const error = new Error(errorDetail);
        error.status = response.status;
        error.isAuthenticationError = response.status === 401;
        throw error;
      }

      return data;
    } catch (err) {
      // Invalid login is an expected user-facing response, not a client fault.
      if (!(endpoint.startsWith('/auth/') && err.status === 401)) {
        console.warn(`[ApiClient] Error on ${endpoint}:`, err.message);
      }
      throw err;
    }
  }

  async get(endpoint, options = {}) {
    return await this.request(endpoint, { ...options, method: "GET" });
  }

  async post(endpoint, body, options = {}) {
    return await this.request(endpoint, {
      ...options,
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  }

  async getFleetLiveState() {
    return await this.request("/stations/fleet/live");
  }

  async getBackendHealth() {
    return this.get('/health');
  }

  async getEsp32Latest(stationId = "AWS-01") {
    return await this.request(`/telemetry/esp32/latest?station_id=${encodeURIComponent(stationId)}`);
  }

  // -------------------------------------------------------------------------
  // Auth Endpoints
  // -------------------------------------------------------------------------

  async loginAdmin(username, password) {
    const res = await this.request("/auth/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    if (res.token) this.setToken(res.token);
    return res;
  }

  async loginStation(username, password) {
    const res = await this.request("/auth/station/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    if (res.token) this.setToken(res.token);
    return res;
  }

  async verifySession() {
    if (!this.token) return { authenticated: false };
    try {
      return await this.request("/auth/me");
    } catch (err) {
      this.clearToken();
      return { authenticated: false, error: err.message };
    }
  }

  // -------------------------------------------------------------------------
  // Station Management Endpoints
  // -------------------------------------------------------------------------

  async listStations() {
    return await this.request("/admin/stations");
  }

  async createStation(stationData) {
    return await this.request("/admin/stations", {
      method: "POST",
      body: JSON.stringify({
        station_id: stationData.stationId || stationData.station_id,
        station_name: stationData.stationName || stationData.station_name,
        username: stationData.username,
        password: stationData.password,
        latitude: parseFloat(stationData.lat ?? stationData.latitude ?? 17.3850),
        longitude: parseFloat(stationData.lon ?? stationData.longitude ?? 78.4867),
        elevation: parseFloat(stationData.elevation ?? 0),
        region: stationData.region || "Assigned Region",
        status: stationData.status || "ACTIVE"
      })
    });
  }

  async batchCreatePresets(presets) {
    return await this.request("/admin/stations/batch-presets", {
      method: "POST",
      body: JSON.stringify(presets)
    });
  }

  async getStationProfile(stationId) {
    return await this.request(`/stations/${stationId}`);
  }

  async updateStation(stationId, updateData) {
    return await this.request(`/admin/stations/${stationId}`, {
      method: "PUT",
      body: JSON.stringify(updateData)
    });
  }

  async toggleStationStatus(stationId, newStatus) {
    return await this.request(`/admin/stations/${stationId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus })
    });
  }

  async resetStationPassword(stationId, newPassword) {
    return await this.request(`/admin/stations/${stationId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ new_password: newPassword })
    });
  }

  // -------------------------------------------------------------------------
  // Cloud PostgreSQL Telemetry Pipeline Endpoints
  // -------------------------------------------------------------------------

  async uploadStationTelemetry(stationId, fileOrList) {
    if (fileOrList instanceof File) {
      const formData = new FormData();
      formData.append("file", fileOrList);
      return await this.request(`/stations/${stationId}/telemetry/upload`, {
        method: "POST",
        body: formData
      });
    } else if (Array.isArray(fileOrList)) {
      return await this.request(`/stations/${stationId}/telemetry/upload`, {
        method: "POST",
        body: JSON.stringify(fileOrList)
      });
    } else {
      throw new Error("Invalid payload: Expected File object or array of telemetry records");
    }
  }

  async replayTelemetryBatch(stationId, rows) {
    return this.post(`/stations/${encodeURIComponent(stationId)}/telemetry/batch`, rows);
  }

  async getStationTelemetryStats(stationId) {
    return await this.request(`/stations/${stationId}/telemetry/stats`);
  }

  async getLatestStationAssessment(stationId) {
    return await this.request(`/stations/${stationId}/assessments/latest`);
  }

  async getStationAssessmentHistory(stationId, limit = 100) {
    return await this.request(`/stations/${stationId}/assessments?limit=${encodeURIComponent(limit)}`);
  }

  async getFleetLiveState() {
    return await this.request(`/stations/fleet/live`);
  }

  // -------------------------------------------------------------------------
  // Fault Injection Endpoints
  // -------------------------------------------------------------------------

  async injectFault(stationId, faultType, offsetVal = null) {
    return await this.request(`/stations/${stationId}/faults/inject`, {
      method: "POST",
      body: JSON.stringify({ fault_type: faultType, offset_val: offsetVal })
    });
  }

  async resetFault(stationId) {
    return await this.request(`/stations/${stationId}/faults/reset`, {
      method: "POST"
    });
  }

  async resetFleet() {
    return await this.request('/stations/fleet/faults/reset', {
      method: 'POST'
    });
  }

  // -------------------------------------------------------------------------
  // Anomaly Incident Triage & Adjudication Endpoints
  // -------------------------------------------------------------------------

  async getIncidents(stationId = null, status = null) {
    let query = [];
    if (stationId) query.push(`station_id=${encodeURIComponent(stationId)}`);
    if (status) query.push(`status=${encodeURIComponent(status)}`);
    const qs = query.length > 0 ? `?${query.join('&')}` : '';
    return await this.request(`/incidents${qs}`);
  }

  async adjudicateIncident(incidentId, action) {
    return await this.request(`/incidents/${encodeURIComponent(incidentId)}/adjudicate`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
  }

  async clearAllIncidents(stationId = null) {
    const qs = stationId ? `?station_id=${encodeURIComponent(stationId)}` : '';
    return await this.request(`/incidents${qs}`, {
      method: "DELETE"
    });
  }

  // -------------------------------------------------------------------------
  // MLOps Pipeline Endpoints
  // -------------------------------------------------------------------------

  async trainStationModel(stationId, options = {}) {
    return await this.request(`/stations/${stationId}/train`, {
      method: "POST",
      body: JSON.stringify(options)
    });
  }

  async getStationTrainingJobs(stationId) {
    return await this.request(`/stations/${stationId}/training-jobs`);
  }

  async getTrainingJobStatus(stationId, jobId) {
    return await this.request(`/stations/${stationId}/training-jobs/${jobId}/status?_t=${Date.now()}`);
  }

  async getStationModels(stationId) {
    return await this.request(`/stations/${stationId}/models`);
  }

  async getStationActiveModel(stationId) {
    return await this.request(`/stations/${stationId}/models/active`);
  }

  async rollbackStationModel(stationId, modelVersion) {
    return await this.request(`/stations/${stationId}/models/${modelVersion}/rollback`, {
      method: "POST"
    });
  }

  async scoreRealtimeTelemetry(stationId, observation, lastObservation = null) {
    return await this.request(`/stations/${stationId}/score`, {
      method: "POST",
      body: JSON.stringify({ observation, last_observation: lastObservation })
    });
  }
  async getStationQC(stationId) {
    return await this.request(`/stations/${stationId}/qc`);
  }

  // -------------------------------------------------------------------------
  // Field Maintenance & Sensor Calibration Endpoints
  // -------------------------------------------------------------------------

  async getMaintenanceTasks(stationId) {
    return await this.request(`/stations/${stationId}/maintenance/tasks`);
  }

  async updateMaintenanceTask(stationId, taskKey, done) {
    return await this.request(`/stations/${stationId}/maintenance/tasks/${encodeURIComponent(taskKey)}`, {
      method: "PATCH",
      body: JSON.stringify({ done })
    });
  }

  async submitMaintenanceAudit(stationId) {
    return await this.request(`/stations/${stationId}/maintenance/submit`, {
      method: "POST"
    });
  }

  async getMaintenanceHistory(stationId, limit = 50) {
    return await this.request(`/stations/${stationId}/maintenance/history?limit=${encodeURIComponent(limit)}`);
  }
}

export const apiClient = new ApiClient();
