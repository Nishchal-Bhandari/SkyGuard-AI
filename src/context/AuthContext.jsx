import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../utils/apiClient';

const STORAGE_KEY = "skyguard_auth_v3";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(() => {
    try {
      localStorage.removeItem("skyguard_auth_v2");
      localStorage.removeItem("skyguard_credentials_v2");
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && parsed.token) {
          apiClient.setToken(parsed.token);
          return parsed;
        }
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

  const [stationCredentials, setStationCredentials] = useState([]);
  const [isLoadingStations, setIsLoadingStations] = useState(false);

  // Synchronize session to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      if (session.token) {
        apiClient.setToken(session.token);
      } else {
        apiClient.clearToken();
      }
    } catch (e) {}
  }, [session]);

  /**
   * Fetch all registered station accounts from SQLite database (Admin only)
   */
  const refreshStationList = useCallback(async () => {
    if (session.role !== "admin" || !session.token) return;
    setIsLoadingStations(true);
    try {
      const list = await apiClient.listStations();
      const mapped = list.map(s => ({
        id: s.id,
        stationId: s.station_id,
        stationName: s.station_name,
        username: s.username,
        password: s.access_key || s.password || "sentinel2026",
        region: s.region,
        lat: s.latitude,
        lon: s.longitude,
        elevation: s.elevation,
        status: s.status,
        createdBy: s.created_by,
        created_at: s.created_at,
        last_login: s.last_login
      }));
      setStationCredentials(mapped);
    } catch (err) {
      console.warn("[AuthContext] Failed to load stations from SQLite:", err.message);
    } finally {
      setIsLoadingStations(false);
    }
  }, [session.role, session.token]);

  // Load stations on admin session mount
  useEffect(() => {
    if (session.isAuthenticated && session.role === "admin") {
      refreshStationList();
    }
  }, [session.isAuthenticated, session.role, refreshStationList]);

  /**
   * Database-Backed Authentication Login
   */
  const login = async (role, username, password) => {
    if (!username || !password) {
      return { success: false, error: "EMPTY_FIELDS", message: "Please provide both username and password." };
    }

    try {
      let res;
      if (role === "admin") {
        res = await apiClient.loginAdmin(username.trim(), password);
      } else {
        res = await apiClient.loginStation(username.trim(), password);
      }

      if (res.success && res.token) {
        const newSession = {
          isAuthenticated: true,
          user: res.user,
          role: res.role,
          assignedStationId: res.user.assignedStationId || null,
          stationName: res.user.stationName || null,
          token: res.token
        };
        setSession(newSession);
        return { success: true, role: res.role, user: res.user, token: res.token };
      }

      return { success: false, error: "AUTH_FAILED", message: res.message || "Authentication failed." };
    } catch (err) {
      return { success: false, error: "API_ERROR", message: err.message || "Authentication service unavailable." };
    }
  };

  /**
   * Logout and clear token
   */
  const logout = () => {
    apiClient.clearToken();
    setSession({
      isAuthenticated: false,
      user: null,
      role: null,
      assignedStationId: null,
      stationName: null,
      token: null
    });
    setStationCredentials([]);
  };

  /**
   * Provision New Station Account in SQLite Database
   */
  const createStationCredential = async (stationId, stationName, username, password, status = "ACTIVE", locationData = {}) => {
    if (session.role !== 'admin' && session.role !== 'CENTRAL_ADMIN') {
      return { success: false, message: "ACCESS DENIED: Only Central Admin can provision station credentials." };
    }
    try {
      const payload = {
        stationId: stationId.trim().toUpperCase(),
        stationName: stationName.trim(),
        username: username.trim().toLowerCase(),
        password,
        lat: locationData.lat !== undefined ? parseFloat(locationData.lat) : 17.3850,
        lon: locationData.lon !== undefined ? parseFloat(locationData.lon) : 78.4867,
        elevation: locationData.elevation !== undefined ? parseFloat(locationData.elevation) : 0,
        region: locationData.region || "Assigned Region",
        status
      };

      const created = await apiClient.createStation(payload);
      await refreshStationList();

      return {
        success: true,
        credential: {
          id: created.id,
          stationId: created.station_id,
          stationName: created.station_name,
          username: created.username,
          region: created.region,
          lat: created.latitude,
          lon: created.longitude,
          elevation: created.elevation,
          status: created.status
        }
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  };

  /**
   * Batch Register Presets in SQLite Database
   */
  const batchRegisterStationCredentials = async (presetList) => {
    if (session.role !== 'admin' && session.role !== 'CENTRAL_ADMIN') {
      return false;
    }
    try {
      await apiClient.batchCreatePresets(presetList);
      await refreshStationList();
      return true;
    } catch (err) {
      console.warn("[AuthContext] Batch presets error:", err.message);
      return false;
    }
  };

  /**
   * Toggle Station Terminal Access Status (ACTIVE / INACTIVE) in SQLite
   */
  const toggleStationStatus = async (stationId) => {
    if (session.role !== 'admin' && session.role !== 'CENTRAL_ADMIN') {
      return null;
    }
    const target = stationCredentials.find(s => s.stationId === stationId);
    if (!target) return "INACTIVE";
    const nextStatus = target.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    try {
      await apiClient.toggleStationStatus(stationId, nextStatus);
      setStationCredentials(prev => prev.map(s => s.stationId === stationId ? { ...s, status: nextStatus } : s));
      return nextStatus;
    } catch (err) {
      alert(`Failed to update station status: ${err.message}`);
      return target.status;
    }
  };

  /**
   * Securely Reset Station Operator Passphrase in SQLite (Stores Salted PBKDF2 Hash)
   */
  const resetStationPassword = async (stationId, newPassword) => {
    if (session.role !== 'admin' && session.role !== 'CENTRAL_ADMIN') {
      return false;
    }
    try {
      await apiClient.resetStationPassword(stationId, newPassword);
      setStationCredentials(prev => prev.map(s => s.stationId === stationId ? { ...s, password: newPassword } : s));
      return true;
    } catch (err) {
      alert(`Failed to reset password: ${err.message}`);
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{
      session,
      isAuthenticated: session.isAuthenticated,
      user: session.user,
      role: session.role,
      assignedStationId: session.assignedStationId,
      stationName: session.stationName,
      stationCredentials,
      isLoadingStations,
      refreshStationList,
      login,
      logout,
      createStationCredential,
      batchRegisterStationCredentials,
      toggleStationStatus,
      resetStationPassword
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
