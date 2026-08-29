/**
 * SkyGuard-AI — Backend API Client
 * 
 * Handles authenticated communication with the FastAPI / SQLite backend service.
 */

const API_BASE = "/api/v1";

class ApiClient {
  constructor() {
    this.token = null;
    try {
      const savedAuth = localStorage.getItem("skyguard_auth_v2");
      if (savedAuth) {
        const parsed = JSON.parse(savedAuth);
        this.token = parsed.token || null;
      }
    } catch (e) {}
  }

  setToken(token) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...(this.token ? { "Authorization": `Bearer ${this.token}` } : {}),
      ...(options.headers || {})
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = data.detail || data.message || `Request failed with HTTP ${response.status}`;
        throw new Error(errorMsg);
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
}

export const apiClient = new ApiClient();
