/**
 * MONSOON SENTINEL - AUTHENTICATION & CREDENTIAL MANAGEMENT SERVICE
 * Manages user sessions, role-based authorization, and station credential database.
 */

const SEED_CREDENTIALS = {
  admin: [
    {
      id: "admin-01",
      username: "admin",
      passwordHash: "sentinel2026", // In production: Argon2/Bcrypt hash
      name: "Chief Supervisor",
      role: "admin",
      status: "ACTIVE",
      created_at: "2026-08-01T00:00:00Z",
      last_login: new Date().toISOString()
    }
  ],
  stations: [
    {
      stationId: "AWS-07",
      stationName: "Hyderabad Central Met",
      region: "Telangana South",
      username: "aws07_op",
      password: "hyd@2026",
      status: "ACTIVE", // ACTIVE | INACTIVE
      created_at: "2026-08-10T10:00:00Z",
      last_login: "2026-08-28T14:22:10Z"
    },
    {
      stationId: "AWS-08",
      stationName: "Secunderabad Cantonment",
      region: "Telangana South",
      username: "aws08_op",
      password: "sec@2026",
      status: "ACTIVE",
      created_at: "2026-08-10T10:00:00Z",
      last_login: "2026-08-28T12:05:40Z"
    },
    {
      stationId: "AWS-09",
      stationName: "Cyberabad Hitech City",
      region: "Telangana South",
      username: "aws09_op",
      password: "cyber@2026",
      status: "ACTIVE",
      created_at: "2026-08-10T10:00:00Z",
      last_login: "2026-08-28T09:18:15Z"
    },
    {
      stationId: "AWS-12",
      stationName: "Mumbai Coastal Colaba",
      region: "Maharashtra West",
      username: "aws12_op",
      password: "mum@2026",
      status: "ACTIVE",
      created_at: "2026-08-12T11:30:00Z",
      last_login: "2026-08-27T18:40:00Z"
    },
    {
      stationId: "AWS-13",
      stationName: "Santacruz Airport Met",
      region: "Maharashtra West",
      username: "aws13_op",
      password: "santa@2026",
      status: "ACTIVE",
      created_at: "2026-08-12T11:30:00Z",
      last_login: "2026-08-28T08:15:30Z"
    },
    {
      stationId: "AWS-19",
      stationName: "Cherrapunji Hills Eco",
      region: "Meghalaya East",
      username: "aws19_op",
      password: "cherra@2026",
      status: "ACTIVE",
      created_at: "2026-08-15T14:00:00Z",
      last_login: "2026-08-28T15:45:00Z"
    }
  ]
};

class AuthService {
  constructor() {
    this.storageKey = "monsoon_sentinel_auth";
    this.credentialsKey = "monsoon_sentinel_credentials";
    this.session = this.loadSession();
    this.credentials = this.loadCredentials();
  }

  loadSession() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {}
    return {
      isAuthenticated: false,
      user: null,
      role: null, // "admin" | "station_operator"
      assignedStationId: null,
      token: null
    };
  }

  saveSession() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.session));
    } catch (e) {}
  }

  loadCredentials() {
    try {
      const data = localStorage.getItem(this.credentialsKey);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(SEED_CREDENTIALS));
  }

  saveCredentials() {
    try {
      localStorage.setItem(this.credentialsKey, JSON.stringify(this.credentials));
    } catch (e) {}
  }

  isAuthenticated() {
    return this.session && this.session.isAuthenticated;
  }

  getCurrentUser() {
    return this.session ? this.session.user : null;
  }

  getRole() {
    return this.session ? this.session.role : null;
  }

  getAssignedStationId() {
    return this.session ? this.session.assignedStationId : null;
  }

  /**
   * Authenticate user with role-aware credential matching
   */
  async login(role, username, password) {
    // Artificial latency for tactical authenticating state
    await new Promise(resolve => setTimeout(resolve, 600));

    if (!username || !password) {
      return { success: false, error: "EMPTY_FIELDS", message: "Please provide both username and password." };
    }

    const cleanUser = username.trim().toLowerCase();

    if (role === "admin") {
      const adminUser = this.credentials.admin.find(
        a => a.username.toLowerCase() === cleanUser && a.passwordHash === password
      );

      if (!adminUser) {
        return { success: false, error: "INVALID_CREDENTIALS", message: "Invalid Central Admin username or password." };
      }

      if (adminUser.status !== "ACTIVE") {
        return { success: false, error: "ACCOUNT_DEACTIVATED", message: "This Admin account has been deactivated." };
      }

      adminUser.last_login = new Date().toISOString();
      this.saveCredentials();

      this.session = {
        isAuthenticated: true,
        user: { id: adminUser.id, username: adminUser.username, name: adminUser.name },
        role: "admin",
        assignedStationId: null,
        token: `jwt-admin-${Date.now()}`
      };
      this.saveSession();

      return { success: true, role: "admin", user: this.session.user };
    } else if (role === "station_operator") {
      const stationCred = this.credentials.stations.find(
        s => s.username.toLowerCase() === cleanUser && s.password === password
      );

      if (!stationCred) {
        return { success: false, error: "INVALID_CREDENTIALS", message: "Invalid Station Operator username or password." };
      }

      if (stationCred.status !== "ACTIVE") {
        return { success: false, error: "STATION_DEACTIVATED", message: `Access for station ${stationCred.stationId} is currently deactivated by Central Admin.` };
      }

      stationCred.last_login = new Date().toISOString();
      this.saveCredentials();

      this.session = {
        isAuthenticated: true,
        user: { username: stationCred.username, name: `${stationCred.stationId} Operator` },
        role: "station_operator",
        assignedStationId: stationCred.stationId,
        stationName: stationCred.stationName,
        token: `jwt-station-${stationCred.stationId}-${Date.now()}`
      };
      this.saveSession();

      return { success: true, role: "station_operator", stationId: stationCred.stationId, user: this.session.user };
    }

    return { success: false, error: "INVALID_ROLE", message: "Invalid authentication role specified." };
  }

  logout() {
    this.session = {
      isAuthenticated: false,
      user: null,
      role: null,
      assignedStationId: null,
      token: null
    };
    this.saveSession();
  }

  /* ==========================================================================
     Station Credential Management (Admin Only)
     ========================================================================== */

  getAllStationCredentials() {
    return this.credentials.stations;
  }

  createStationCredential(stationId, stationName, username, password, status = "ACTIVE") {
    if (!this.session.role === "admin") throw new Error("Unauthorized");
    
    // Check if station or username already exists
    const existing = this.credentials.stations.find(
      s => s.stationId === stationId || s.username.toLowerCase() === username.toLowerCase().trim()
    );
    if (existing) {
      return { success: false, message: `Credential already exists for station ${stationId} or username '${username}'.` };
    }

    const newCred = {
      stationId,
      stationName,
      region: "Assigned Region",
      username: username.trim(),
      password,
      status,
      created_at: new Date().toISOString(),
      last_login: null
    };

    this.credentials.stations.push(newCred);
    this.saveCredentials();
    return { success: true, credential: newCred };
  }

  updateStationCredential(stationId, updates) {
    if (!this.session.role === "admin") throw new Error("Unauthorized");

    const cred = this.credentials.stations.find(s => s.stationId === stationId);
    if (!cred) return { success: false, message: "Station credential not found." };

    if (updates.username) cred.username = updates.username.trim();
    if (updates.password) cred.password = updates.password;
    if (updates.status) cred.status = updates.status;

    this.saveCredentials();
    return { success: true, credential: cred };
  }

  toggleStationStatus(stationId) {
    if (!this.session.role === "admin") throw new Error("Unauthorized");
    const cred = this.credentials.stations.find(s => s.stationId === stationId);
    if (!cred) return false;
    cred.status = cred.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    this.saveCredentials();
    return cred.status;
  }

  resetStationPassword(stationId, newPassword) {
    if (!this.session.role === "admin") throw new Error("Unauthorized");
    const cred = this.credentials.stations.find(s => s.stationId === stationId);
    if (!cred) return false;
    cred.password = newPassword;
    this.saveCredentials();
    return true;
  }
}

window.authService = new AuthService();
