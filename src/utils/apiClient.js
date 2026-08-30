/**
 * SkyGuard-AI — Backend API Client
 * 
 * Handles authenticated communication with the FastAPI / Cloud PostgreSQL backend service.
 */

const API_BASE = "/api/v1";

class ApiClient {
  constructor() {
    this.token = null;
    this.syncTokenFromStorage();
  }

  syncTokenFromStorage() {
    try {
      const savedAuth = localStorage.getItem("skyguard_auth_v3") || localStorage.getItem("skyguard_auth_v2");
      if (savedAuth) {
        const parsed = JSON.parse(savedAuth);
        if (parsed && parsed.token) {
          this.token = parsed.token;
          return this.token;
        }
      }
    } catch (e) {}
    return null;
  }

  getToken() {
    if (this.token) return this.token;
    return this.syncTokenFromStorage();
  }

  setToken(token) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const isFormData = options.body instanceof FormData;
    const token = this.getToken();

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
        throw new Error(errorDetail);
      }

      return data;
    } catch (err) {
      console.warn(`[ApiClient] Error on ${endpoint}:`, err.message);
      throw err;
    }
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

  async getStationTelemetryStats(stationId) {
    return await this.request(`/stations/${stationId}/telemetry/stats`);
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
}

export const apiClient = new ApiClient();
