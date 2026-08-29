import React, { createContext, useContext, useState, useEffect } from 'react';

const SEED_CREDENTIALS = {
  admin: [
    {
      id: "admin-01",
      username: "admin",
      passwordHash: "sentinel2026",
      name: "Chief Supervisor",
      role: "admin",
      status: "ACTIVE",
      created_at: "2026-08-01T00:00:00Z",
      last_login: new Date().toISOString()
    }
  ],
  stations: []
};

const STORAGE_KEY = "skyguard_auth_v3";
const CREDENTIALS_KEY = "skyguard_credentials_v3";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(() => {
    try {
      localStorage.removeItem("skyguard_auth_v2");
      localStorage.removeItem("skyguard_credentials_v2");
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && parsed.role === 'admin') return parsed;
      }
    } catch (e) {}
    return {
      isAuthenticated: false,
      user: null,
      role: null,
      assignedStationId: null,
      stationName: null,
      token: null
    };
  });

  const [credentials, setCredentials] = useState(() => {
    try {
      const data = localStorage.getItem(CREDENTIALS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          admin: parsed.admin && parsed.admin.length > 0 ? parsed.admin : SEED_CREDENTIALS.admin,
          stations: []
        };
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(SEED_CREDENTIALS));
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (e) {}
  }, [session]);

  useEffect(() => {
    try {
      localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
    } catch (e) {}
  }, [credentials]);

  const login = async (role, username, password) => {
    await new Promise(resolve => setTimeout(resolve, 400));

    if (!username || !password) {
      return { success: false, error: "EMPTY_FIELDS", message: "Please provide both username and password." };
    }

    const cleanUser = username.trim().toLowerCase();

    if (role === "admin") {
      const adminUser = credentials.admin.find(
        a => a.username.toLowerCase() === cleanUser && a.passwordHash === password
      );

      if (!adminUser) {
        return { success: false, error: "INVALID_CREDENTIALS", message: "Invalid Central Admin username or password." };
      }

      if (adminUser.status !== "ACTIVE") {
        return { success: false, error: "ACCOUNT_DEACTIVATED", message: "This Admin account has been deactivated." };
      }

      const updatedCreds = { ...credentials };
      const matched = updatedCreds.admin.find(a => a.id === adminUser.id);
      if (matched) matched.last_login = new Date().toISOString();
      setCredentials(updatedCreds);

      const newSession = {
        isAuthenticated: true,
        user: { id: adminUser.id, username: adminUser.username, name: adminUser.name },
        role: "admin",
        assignedStationId: null,
        stationName: null,
        token: `jwt-admin-${Date.now()}`
      };
      setSession(newSession);

      return { success: true, role: "admin", user: newSession.user };
    } else if (role === "station_operator") {
      const stationCred = credentials.stations.find(
        s => s.username.toLowerCase() === cleanUser && s.password === password
      );

      if (!stationCred) {
        return { success: false, error: "INVALID_CREDENTIALS", message: "Invalid Station Operator username or password." };
      }

      if (stationCred.status !== "ACTIVE") {
        return { success: false, error: "STATION_DEACTIVATED", message: `Access for station ${stationCred.stationId} is currently deactivated by Central Admin.` };
      }

      const updatedCreds = { ...credentials };
      const matched = updatedCreds.stations.find(s => s.stationId === stationCred.stationId);
      if (matched) matched.last_login = new Date().toISOString();
      setCredentials(updatedCreds);

      const newSession = {
        isAuthenticated: true,
        user: { username: stationCred.username, name: `${stationCred.stationId} Operator` },
        role: "station_operator",
        assignedStationId: stationCred.stationId,
        stationName: stationCred.stationName,
        token: `jwt-station-${stationCred.stationId}-${Date.now()}`
      };
      setSession(newSession);

      return { success: true, role: "station_operator", stationId: stationCred.stationId, user: newSession.user };
    }

    return { success: false, error: "INVALID_ROLE", message: "Invalid authentication role specified." };
  };

  const logout = () => {
    setSession({
      isAuthenticated: false,
      user: null,
      role: null,
      assignedStationId: null,
      stationName: null,
      token: null
    });
  };

  const createStationCredential = (stationId, stationName, username, password, status = "ACTIVE", locationData = {}) => {
    if (session.role !== 'admin' && session.role !== 'CENTRAL_ADMIN') {
      return { success: false, message: "ACCESS DENIED: Only Central Admin can provision station credentials." };
    }

    const existing = credentials.stations.find(
      s => s.stationId === stationId || s.username.toLowerCase() === username.toLowerCase().trim()
    );
    if (existing) {
      return { success: false, message: `Credential already exists for station ${stationId} or username '${username}'.` };
    }

    const newCred = {
      stationId,
      stationName,
      region: locationData.region || "Assigned Region",
      lat: locationData.lat !== undefined ? parseFloat(locationData.lat) : 18.0,
      lon: locationData.lon !== undefined ? parseFloat(locationData.lon) : 78.0,
      elevation: locationData.elevation !== undefined ? parseFloat(locationData.elevation) : 500,
      username: username.trim(),
      password,
      status,
      created_at: new Date().toISOString(),
      last_login: null
    };

    setCredentials(prev => ({
      ...prev,
      stations: [...prev.stations, newCred]
    }));
    return { success: true, credential: newCred };
  };

  const updateStationCredential = (stationId, updates) => {
    if (session.role !== 'admin' && session.role !== 'CENTRAL_ADMIN') {
      return { success: false, message: "ACCESS DENIED: Only Central Admin can update station credentials." };
    }

    setCredentials(prev => ({
      ...prev,
      stations: prev.stations.map(s => {
        if (s.stationId === stationId) {
          return {
            ...s,
            ...(updates.username ? { username: updates.username.trim() } : {}),
            ...(updates.password ? { password: updates.password } : {}),
            ...(updates.status ? { status: updates.status } : {})
          };
        }
        return s;
      })
    }));
    return { success: true };
  };

  const toggleStationStatus = (stationId) => {
    if (session.role !== 'admin' && session.role !== 'CENTRAL_ADMIN') {
      return null;
    }

    let newStatus = "ACTIVE";
    setCredentials(prev => ({
      ...prev,
      stations: prev.stations.map(s => {
        if (s.stationId === stationId) {
          newStatus = s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
          return { ...s, status: newStatus };
        }
        return s;
      })
    }));
    return newStatus;
  };

  const resetStationPassword = (stationId, newPassword) => {
    if (session.role !== 'admin' && session.role !== 'CENTRAL_ADMIN') {
      return false;
    }

    setCredentials(prev => ({
      ...prev,
      stations: prev.stations.map(s => {
        if (s.stationId === stationId) {
          return { ...s, password: newPassword };
        }
        return s;
      })
    }));
    return true;
  };

  const batchRegisterStationCredentials = (presetList) => {
    setCredentials(prev => {
      const existingIds = new Set(prev.stations.map(s => s.stationId));
      const newItems = presetList
        .filter(p => !existingIds.has(p.id || p.stationId))
        .map(p => ({
          stationId: p.id || p.stationId,
          stationName: p.name || p.stationName,
          region: p.region || "Assigned Region",
          lat: p.lat !== undefined ? parseFloat(p.lat) : 18.0,
          lon: p.lon !== undefined ? parseFloat(p.lon) : 78.0,
          elevation: p.elevation !== undefined ? parseFloat(p.elevation) : 500,
          username: (p.username || `operator_${(p.id || 'aws').toLowerCase()}`).trim(),
          password: p.password || "sentinel2026",
          status: p.status || "ACTIVE",
          created_at: new Date().toISOString(),
          last_login: null
        }));
      return {
        ...prev,
        stations: [...prev.stations, ...newItems]
      };
    });
    return true;
  };

  return (
    <AuthContext.Provider value={{
      session,
      isAuthenticated: session.isAuthenticated,
      user: session.user,
      role: session.role,
      assignedStationId: session.assignedStationId,
      stationName: session.stationName,
      stationCredentials: credentials.stations,
      login,
      logout,
      createStationCredential,
      batchRegisterStationCredentials,
      updateStationCredential,
      toggleStationStatus,
      resetStationPassword
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
