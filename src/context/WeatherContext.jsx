import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  SEED_STATIONS,
  SEED_INCIDENTS,
  INITIAL_QC_CONFIG,
  INITIAL_MODEL_REGISTRY,
  INITIAL_MODEL_DRIFT,
  EXTERNAL_DATA_LINEAGE,
  INITIAL_CHECKLISTS,
  DEFAULT_MAINTENANCE_CHECKLIST
} from '../utils/seedData';
import { qcEngine } from '../utils/qcEngine';
import { mlPipeline } from '../utils/mlEngine';
import { spatialEngine } from '../utils/spatialEngine';
import { openMeteoService, OPEN_METEO_PRESET_STATIONS } from '../utils/openMeteoService';
import { tacticalAudio } from '../utils/audio';
import { useAuth } from './AuthContext';
import { apiClient } from '../utils/apiClient';
import { reconcileStationRoster, mergeLiveAssessments } from '../utils/stationState';

const STATIONS_CACHE_KEY = "skyguard_stations_cache_v5";
const INCIDENTS_CACHE_KEY = "skyguard_incidents_cache_v5";
const WeatherContext = createContext(null);

export const WeatherProvider = ({ children }) => {
  const { session, role, assignedStationId, stationCredentials, stationCredentialsLoaded, batchRegisterStationCredentials } = useAuth();

  const isStationOperator = useCallback((r) => r === 'station_operator' || r === 'STATION_OPERATOR', []);
  const isCentralAdmin = useCallback((r) => r === 'admin' || r === 'CENTRAL_ADMIN', []);

  // Initialize stations from persistent localStorage cache (clean state when empty)
  const [stations, setStations] = useState(() => {
    try {
      localStorage.removeItem("skyguard_stations_cache_v4");
      localStorage.removeItem("skyguard_stations_cache_v3");
      localStorage.removeItem("skyguard_stations_cache_v2");
      const saved = localStorage.getItem(STATIONS_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return isStationOperator(role) && assignedStationId
            ? parsed.filter(station => station.id === assignedStationId)
            : parsed;
        }
      }
    } catch (e) {}
    return [];
  });

  // Initialize incidents from persistent localStorage cache (default empty)
  const [incidents, setIncidents] = useState(() => {
    try {
      localStorage.removeItem("skyguard_incidents_cache_v4");
      localStorage.removeItem("skyguard_incidents_cache_v3");
      localStorage.removeItem("skyguard_incidents_cache_v2");
      const saved = localStorage.getItem(INCIDENTS_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });

  const saveIncidents = useCallback((newIncidents) => {
    setIncidents(newIncidents);
    try {
      if (Array.isArray(newIncidents)) {
        localStorage.setItem(INCIDENTS_CACHE_KEY, JSON.stringify(newIncidents));
      }
    } catch (e) {}
  }, []);

  // Deletes incidents from the authoritative database first; local/cache state is only
  // cleared once the backend confirms the deletion, so failures never masquerade as success.
  const clearAllIncidents = useCallback(async (stationId = null) => {
    const res = await apiClient.clearAllIncidents(stationId);
    try {
      const incRes = await apiClient.getIncidents();
      saveIncidents(incRes?.success && Array.isArray(incRes.incidents) ? incRes.incidents : []);
    } catch (e) {
      saveIncidents([]);
    }
    return res;
  }, [saveIncidents]);

  const [qcConfig, setQcConfig] = useState(() => ({ ...INITIAL_QC_CONFIG }));
  const [modelRegistry, setModelRegistry] = useState(() => [...INITIAL_MODEL_REGISTRY]);
  
  // Station-Adaptive Model Registry: Map<stationId, Array<Model>>
  const [stationModels, setStationModels] = useState({});
  // Active production model per station: Map<stationId, Model>
  const [activeStationModels, setActiveStationModels] = useState({});

  // Configurable spatial neighbor search radius (km)
  const [neighborRadiusKm, setNeighborRadiusKm] = useState(50);

  // Live Open-Meteo API Streaming State
  const [isLiveApiMode, setIsLiveApiMode] = useState(true);
  const [liveApiStatus, setLiveApiStatus] = useState({
    isOnline: false,
    latencyMs: 0,
    lastSync: null,
    isSyncing: false,
    error: null,
    source: "OPEN_METEO_API"
  });
  const fleetSyncInFlight = useRef(false);

  const [modelDrift, setModelDrift] = useState(() => ({ ...INITIAL_MODEL_DRIFT }));
  const [externalDataLineage] = useState(() => [...EXTERNAL_DATA_LINEAGE]);
  const [checklists, setChecklists] = useState(() => JSON.parse(JSON.stringify(INITIAL_CHECKLISTS)));
  const [offlineBuffer, setOfflineBuffer] = useState(() => {
    try {
      const rows = JSON.parse(localStorage.getItem('skyguard_offline_queue_v1') || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  });
  useEffect(() => {
    localStorage.setItem('skyguard_offline_queue_v1', JSON.stringify(offlineBuffer));
  }, [offlineBuffer]);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [activeFaults, setActiveFaults] = useState({}); // stationId -> { type, ticksRemaining, offset }

  const [activeStationId, setActiveStationId] = useState(() => {
    if (isStationOperator(role) && assignedStationId) return assignedStationId;
    return null;
  });

  const [currentView, setCurrentView] = useState(() => {
    if (isStationOperator(role)) return 'station-hud';
    return 'command-center';
  });

  // Do not treat the initial empty credential array as an empty server roster.
  useEffect(() => {
    if (session?.isAuthenticated && isCentralAdmin(role) && stationCredentialsLoaded) {
      setStations(prev => reconcileStationRoster(prev, stationCredentials));

      // Ensure every provisioned station has its own station-specific maintenance checklist
      setChecklists(prev => {
        const next = { ...(prev || {}) };
        stationCredentials.forEach(sc => {
          const sId = sc.stationId;
          if (!next[sId] || !Array.isArray(next[sId]) || next[sId].length === 0) {
            next[sId] = JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST));
          }
        });
        return next;
      });
    }
  }, [session?.isAuthenticated, role, stationCredentialsLoaded, stationCredentials, isCentralAdmin]);

  // Save stations cache to localStorage
  useEffect(() => {
    try {
      if (stations && stations.length > 0) {
        localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify(stations));
      } else {
        localStorage.removeItem(STATIONS_CACHE_KEY);
      }
    } catch (e) {}
  }, [stations]);

  // Sync role/station view when session changes
  useEffect(() => {
    if (isStationOperator(role)) {
      if (assignedStationId) setActiveStationId(assignedStationId);
      const adminOnlyViews = ['command-center', 'credentials', 'qc-rules', 'export'];
      if (adminOnlyViews.includes(currentView)) {
        setCurrentView('station-hud');
      }
    } else if (isCentralAdmin(role)) {
      const operatorOnlyViews = ['station-hud', 'station-diagnostics', 'station-checklist', 'edge-sync'];
      if (operatorOnlyViews.includes(currentView)) {
        setCurrentView('command-center');
      }
    }
  }, [role, assignedStationId, currentView, isStationOperator, isCentralAdmin]);

  // Restrict activeStationId switching for Station Operator
  const handleSetActiveStationId = useCallback((id) => {
    if (isStationOperator(role) && assignedStationId && id !== assignedStationId) {
      console.warn(`ACCESS DENIED: Station Operator for ${assignedStationId} cannot switch active station to ${id}`);
      return;
    }
    setActiveStationId(id);
  }, [role, assignedStationId, isStationOperator]);

  // Automatically select assigned station or first available station
  useEffect(() => {
    if (isStationOperator(role)) {
      if (assignedStationId) {
        setActiveStationId(assignedStationId);
      }
    } else if (stations.length > 0 && !stations.some(station => station.id === activeStationId)) {
      setActiveStationId(stations[0].id);
    } else if (stationCredentialsLoaded && stations.length === 0 && activeStationId) {
      setActiveStationId(null);
    }
  }, [stations, activeStationId, role, assignedStationId, stationCredentialsLoaded, isStationOperator]);

  // Sync active model for activeStationId from Cloud PostgreSQL backend
  const refreshActiveStationModel = useCallback(async (stId) => {
    const targetId = stId || activeStationId;
    if (!session?.isAuthenticated || !targetId) return null;
    if (isCentralAdmin(role) && (!stationCredentialsLoaded || !stationCredentials.some(station => station.stationId === targetId))) return null;
    if (isStationOperator(role) && assignedStationId !== targetId) return null;
    try {
      const res = await apiClient.getStationActiveModel(targetId);
      if (res?.has_active_model && res?.model_card) {
        const modelEntry = {
          modelCard: res.model_card,
          threshold: res.model_card.training_summary?.dynamic_threshold || 0.65
        };
        setActiveStationModels(prev => ({
          ...prev,
          [targetId]: modelEntry
        }));
        return modelEntry;
      }
    } catch (e) {
      console.warn("[WeatherContext] Could not fetch active model:", e.message);
    }
    return null;
  }, [activeStationId, session?.isAuthenticated, role, stationCredentialsLoaded, stationCredentials, assignedStationId, isCentralAdmin, isStationOperator]);

  useEffect(() => {
    if (session?.isAuthenticated && activeStationId) {
      refreshActiveStationModel(activeStationId);
    }
  }, [activeStationId, refreshActiveStationModel, session?.isAuthenticated]);

  // Helper function to generate realistic undulating historical telemetry
  const createStationHistory = useCallback((baseTemp = 27.5, baseHum = 70, basePres = 1012, baseWind = 8) => {
    const points = [];
    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      const t = new Date(now - i * 30 * 1000);
      const timeStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const tempWave = Math.sin(i / 3.5) * 0.9 + (Math.sin(i * 1.5) * 0.4);
      const humWave = -Math.sin(i / 3.5) * 3.0 + (Math.cos(i * 1.2) * 1.5);
      const presWave = Math.cos(i / 4.0) * 0.6;
      const rainVal = (i === 6 || i === 7) ? +(Math.random() * 2.0 + 1.2).toFixed(1) : 0;

      points.push({
        time: timeStr,
        temperature: +(baseTemp + tempWave).toFixed(1),
        humidity: +Math.min(100, Math.max(20, baseHum + humWave)).toFixed(1),
        pressure: +(basePres + presWave).toFixed(1),
        wind_speed: +Math.max(0, baseWind + Math.sin(i) * 2.5).toFixed(1),
        rainfall: rainVal
      });
    }
    return points;
  }, []);

  // Telemetry History state (Map<stationId, Array<Obs>>)
  const [history, setHistory] = useState({});

  // Reference for stable state access in async sync loops
  const stateRef = useRef({ stations, history, activeStationModels, activeFaults, qcConfig, neighborRadiusKm });
  useEffect(() => {
    stateRef.current = { stations, history, activeStationModels, activeFaults, qcConfig, neighborRadiusKm };
  }, [stations, history, activeStationModels, activeFaults, qcConfig, neighborRadiusKm]);

  /**
   * Sync all stations with real-world live weather data from Open-Meteo API
   */
  const syncLiveOpenMeteoData = useCallback(async (customStations = null) => {
    if (fleetSyncInFlight.current) return false;
    fleetSyncInFlight.current = true;
    setLiveApiStatus(prev => ({ ...prev, isSyncing: true, error: null }));
    const started = performance.now();

    try {
      const res = await apiClient.getFleetLiveState();
      
      if (res?.success !== true || !Array.isArray(res.stations)) {
        throw new Error('Backend returned an invalid fleet response.');
      }
        // Map backend station schema to frontend UI schema where necessary
        const authoritativeRoster = isCentralAdmin(role) && stationCredentialsLoaded ? stationCredentials : null;
        const allowedStationIds = authoritativeRoster && new Set(authoritativeRoster.map(station => station.stationId));
        const updatedStations = res.stations.filter(st => !allowedStationIds || allowedStationIds.has(st.station_id)).map(st => ({
          ...st,
          id: st.station_id,
          name: st.station_name,
          lat: st.latitude,
          lon: st.longitude,
          active_model_id: st.ml_model?.model_id || null,
          model_status: st.ml_model ? "ACTIVE_PRODUCTION" : "PENDING_CALIBRATION"
        }));
        
        setStations(prev => mergeLiveAssessments(prev, updatedStations, authoritativeRoster));
        
        // Append to history
        setHistory(prevHist => {
          const nextHist = allowedStationIds
            ? Object.fromEntries(Object.entries(prevHist).filter(([id]) => allowedStationIds.has(id)))
            : { ...prevHist };
          updatedStations.forEach(st => {
            if (!nextHist[st.id]) nextHist[st.id] = [];
            if (!st.source_timestamp || nextHist[st.id].some(point => point.source_timestamp === st.source_timestamp)) return;
            nextHist[st.id] = [...nextHist[st.id], {
              time: new Date(st.source_timestamp).toLocaleTimeString(),
              source_timestamp: st.source_timestamp,
              temperature: st.sensors?.temperature?.value ?? null,
              humidity: st.sensors?.humidity?.value ?? null,
              pressure: st.sensors?.pressure?.value ?? null,
              wind_speed: st.sensors?.wind_speed?.value ?? null,
              rainfall: st.sensors?.rainfall?.value ?? null
            }].slice(-30);
          });
          return nextHist;
        });
        
        // Fetch Authoritative Backend Incidents
        try {
          const incRes = await apiClient.getIncidents();
          if (incRes && incRes.success && Array.isArray(incRes.incidents)) {
            saveIncidents(incRes.incidents);
          }
        } catch (incErr) {
          console.warn("[WeatherContext] Incidents fetch skipped/failed:", incErr.message);
        }

        
        setLiveApiStatus({
          isOnline: true,
          hasObservations: updatedStations.some(st => Boolean(st.source_timestamp)),
          latencyMs: Math.round(performance.now() - started),
          lastSync: new Date().toLocaleTimeString(),
          isSyncing: false,
          error: null,
          source: "BACKEND_FLEET_EVAL"
        });
        return true;
    } catch (err) {
      console.error("[WeatherContext] Error fetching fleet state:", err);
      setLiveApiStatus(prev => ({
        ...prev,
        isOnline: false,
        isSyncing: false,
        error: err.message || "Failed to connect to backend telemetry service."
      }));
      return false;
    } finally {
      fleetSyncInFlight.current = false;
    }
  }, [role, stationCredentialsLoaded, stationCredentials, isCentralAdmin, saveIncidents]);

  /**
   * Hydrate Stations from SQLite Backend on Authentication / Mount
   */
  useEffect(() => {
    const hydrateFromBackend = async () => {
      if (!session?.isAuthenticated) return;

      try {
        if (isStationOperator(role) && assignedStationId) {
          // Fetch station operator's profile from SQLite backend
          let stationData = null;
          try {
            stationData = await apiClient.getStationProfile(assignedStationId);
          } catch (err) {
            console.warn('[WeatherContext] Station profile unavailable:', err.message);
          }

          if (stationData) {
            const id = stationData.station_id || assignedStationId;
            setStations(prev => reconcileStationRoster(prev.filter(st => st.id === id), [{
              stationId: id,
              stationName: stationData.station_name || session.stationName || (id + ' Weather Unit'),
              region: stationData.region,
              lat: stationData.latitude ?? stationData.lat,
              lon: stationData.longitude ?? stationData.lon,
              elevation: stationData.elevation,
              status: stationData.status
            }]));
            setActiveStationId(id);
            syncLiveOpenMeteoData();
          }
        }
        // Immediately hydrate authoritative incidents on mount/reload
        try {
          const incRes = await apiClient.getIncidents();
          if (incRes && incRes.success && Array.isArray(incRes.incidents)) {
            saveIncidents(incRes.incidents);
          }
        } catch (incErr) {
          console.warn("[WeatherContext] Mount incident hydration warning:", incErr.message);
        }
      } catch (err) {
        console.warn("[WeatherContext] Hydration Warning:", err.message);
      }
    };

    hydrateFromBackend();
  }, [session?.isAuthenticated, role, assignedStationId, isStationOperator, isCentralAdmin, syncLiveOpenMeteoData, saveIncidents]);


  // (Removed redundant legacy interval and initial load sync hooks here; 
  // polling is now managed entirely by the 5-second interval below)

  /**
   * One-Click Instant Load of Real Indian AWS Fleet
   */
  const loadPresetFleet = async () => {
    if (!OPEN_METEO_PRESET_STATIONS?.length) return false;
    const registered = await batchRegisterStationCredentials(OPEN_METEO_PRESET_STATIONS);
    if (!registered) return false;

    setActiveStationId(OPEN_METEO_PRESET_STATIONS[0].id);
    tacticalAudio.playSuccess();
    await syncLiveOpenMeteoData();
    return true;
  };

  // Fetch from backend every 5 seconds only when authenticated
  useEffect(() => {
    if (!session?.isAuthenticated) return;
    
    syncLiveOpenMeteoData(); // initial fetch
    const interval = setInterval(() => {
      syncLiveOpenMeteoData();
    }, 5000);
    return () => clearInterval(interval);
  }, [syncLiveOpenMeteoData, session?.isAuthenticated]);


  const toggleOfflineMode = () => {
    setIsOfflineMode(prev => {
      const next = !prev;
      tacticalAudio.playSwitch();
      return next;
    });
  };

  const queueOfflineRecords = (records) => {
    if (!Array.isArray(records) || !records.length || records.length > 200) {
      throw new Error('Choose a JSON array containing 1 to 200 observations.');
    }
    const normalized = records.map(row => {
      if (!row || typeof row !== 'object' || !(row.stationId || row.station_id || activeStationId)) {
        throw new Error('Select a station and provide object observations.');
      }
      const stationId = String(row.stationId || row.station_id || activeStationId).toUpperCase();
      if (isStationOperator(role) && stationId !== assignedStationId) throw new Error('Observation belongs to another station.');
      if (!row.timestamp && !row.source_timestamp && !row.time) throw new Error('Every observation needs its source timestamp.');
      return { ...row, stationId };
    });
    if (offlineBuffer.length + normalized.length > 500) throw new Error('Browser queue limit is 500 records.');
    setOfflineBuffer(current => [...current, ...normalized]);
    return normalized.length;
  };

  const syncOfflineBuffer = async () => {
    if (isOfflineMode) throw new Error('Gateway is offline. Reconnect before replay.');
    const snapshot = offlineBuffer;
    let acknowledged = 0;
    const remaining = [];
    for (const stationId of [...new Set(snapshot.map(row => row.stationId))]) {
      const rows = snapshot.filter(row => row.stationId === stationId);
      try {
        const result = await apiClient.replayTelemetryBatch(stationId, rows.map(({ stationId: ignored, ...row }) => row));
        result.results.forEach((ack, index) => {
          if (ack.acknowledged) acknowledged++;
          else remaining.push(rows[index]);
        });
      } catch (error) {
        remaining.push(...rows);
        setLiveApiStatus(prev => ({ ...prev, error: `Replay failed: ${error.message}` }));
      }
    }
    setOfflineBuffer(current => [...remaining, ...current.filter(row => !snapshot.includes(row))]);
    if (acknowledged) tacticalAudio.playSuccess();
    return { acknowledged, pending: remaining.length };
  };

  const injectFault = async (stationId, faultType, offset = 0) => {
    try {
      await apiClient.injectFault(stationId, faultType, offset);
      tacticalAudio.playAlarm();
      
      // Instantly query updated incidents and live fleet state
      try {
        const incRes = await apiClient.getIncidents();
        if (incRes?.success && Array.isArray(incRes.incidents)) {
          saveIncidents(incRes.incidents);
        }
      } catch (e) {}
      
      syncLiveOpenMeteoData();
    } catch(e) {
      console.error("[WeatherContext] Failed to inject fault:", e);
    }
  };

  const clearFaults = async (stationId = null) => {
    try {
      if (stationId) {
        await apiClient.resetFault(stationId);
      } else {
        await apiClient.resetFleet();
      }
      tacticalAudio.playClick();
      
      try {
        const incRes = await apiClient.getIncidents();
        if (incRes?.success && Array.isArray(incRes.incidents)) {
          saveIncidents(incRes.incidents);
        }
      } catch (e) {}
      
      await syncLiveOpenMeteoData();
      return { success: true };
    } catch(e) {
      console.error("[WeatherContext] Failed to clear fault:", e);
      return { success: false, error: e.message };
    }
  };

  const adjudicateIncident = async (incidentId, action) => {
    try {
      await apiClient.adjudicateIncident(incidentId, action);
      tacticalAudio.playSuccess();
      const incRes = await apiClient.getIncidents();
      if (incRes?.success && Array.isArray(incRes.incidents)) {
        saveIncidents(incRes.incidents);
      }
    } catch (e) {
      console.warn("[WeatherContext] Backend adjudication error, falling back locally:", e.message);
      setIncidents(prev => {
        const next = prev.map(inc => {
          if (inc.id === incidentId) {
            return {
              ...inc,
              status: action === 'ACCEPT' || action === 'GENUINE' ? 'resolved' : action === 'ACKNOWLEDGE' ? 'acknowledged' : 'rejected',
              adjudicated_at: new Date().toISOString(),
              action_taken: action
            };
          }
          return inc;
        });
        try {
          localStorage.setItem(INCIDENTS_CACHE_KEY, JSON.stringify(next));
        } catch (err) {}
        return next;
      });
      tacticalAudio.playSuccess();
    }
  };


  const mapMaintenanceTaskFromBackend = useCallback((t) => ({
    id: t.task_key,
    title: t.title,
    desc: t.description,
    done: !!t.done,
    completed: !!t.done,
    timestamp: t.completed_at ? new Date(t.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
    completed_by: t.completed_by || null
  }), []);

  const refreshStationChecklist = useCallback(async (stId) => {
    const targetId = stId || activeStationId;
    if (!session?.isAuthenticated || !targetId) return;
    if (isCentralAdmin(role) && (!stationCredentialsLoaded || !stationCredentials.some(station => station.stationId === targetId))) return;
    if (isStationOperator(role) && assignedStationId !== targetId) return;
    try {
      const res = await apiClient.getMaintenanceTasks(targetId);
      if (res?.success && Array.isArray(res.tasks)) {
        setChecklists(prev => ({ ...prev, [targetId]: res.tasks.map(mapMaintenanceTaskFromBackend) }));
      }
    } catch (e) {
      console.warn("[WeatherContext] Could not fetch maintenance tasks:", e.message);
    }
  }, [activeStationId, mapMaintenanceTaskFromBackend, session?.isAuthenticated, role, stationCredentialsLoaded, stationCredentials, assignedStationId, isCentralAdmin, isStationOperator]);

  useEffect(() => {
    if (session?.isAuthenticated && activeStationId) {
      refreshStationChecklist(activeStationId);
    }
  }, [activeStationId, refreshStationChecklist, session?.isAuthenticated]);

  // Persists checklist completion to the backend (survives reload / other operators).
  const updateChecklist = useCallback(async (stationId, itemId, completed) => {
    if (!stationId) return;

    setChecklists(prev => {
      const currentList = (prev && prev[stationId] && prev[stationId].length > 0)
        ? prev[stationId]
        : JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST));

      const updatedList = currentList.map(item =>
        item.id === itemId
          ? {
              ...item,
              done: !!completed,
              completed: !!completed,
              timestamp: completed ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
            }
          : item
      );
      return { ...prev, [stationId]: updatedList };
    });

    try {
      const res = await apiClient.updateMaintenanceTask(stationId, itemId, !!completed);
      if (res?.success && Array.isArray(res.tasks)) {
        setChecklists(prev => ({ ...prev, [stationId]: res.tasks.map(mapMaintenanceTaskFromBackend) }));
      }
    } catch (e) {
      console.error("[WeatherContext] Failed to persist maintenance task state:", e.message);
    }
  }, [mapMaintenanceTaskFromBackend]);

  const submitMaintenanceAudit = useCallback(async (stationId) => {
    if (!stationId) return { success: false, error: "No active station." };
    try {
      const res = await apiClient.submitMaintenanceAudit(stationId);
      tacticalAudio.playSuccess();
      return { success: true, audit: res.audit };
    } catch (e) {
      tacticalAudio.playAlarm();
      return { success: false, error: e.message };
    }
  }, []);

  const trainStationModel = async (stationId, version = null) => {
    try {
      let backendRes = null;
      try {
        backendRes = await apiClient.trainStationModel(stationId, { version });
      } catch (backendErr) {
        // Surface backend errors directly — no silent fallback to in-browser ML.
        // Training must use Cloud PostgreSQL data, not browser-side preview rows.
        console.error("[WeatherContext] Backend training call failed:", backendErr.message);
        throw backendErr;
      }

      if (backendRes && backendRes.success) {
        const modelCard = backendRes.model_card || backendRes.modelCard || backendRes.result?.modelCard;
        const dynamicThreshold = modelCard?.training_summary?.dynamic_threshold || backendRes.threshold || 0.65;
        const modelEntry = {
          modelCard: modelCard || {
            model_id: backendRes.model_id || `${stationId}_IF_v1_0`,
            station_id: stationId,
            version: backendRes.model_version || "v1.0",
            status: backendRes.status || "ACTIVE",
            training_summary: { dynamic_threshold: dynamicThreshold }
          },
          threshold: dynamicThreshold,
          modelInstance: backendRes.result?.modelInstance || null
        };

        setStationModels(prev => ({
          ...prev,
          [stationId]: [modelEntry, ...(prev[stationId] || [])]
        }));
        setActiveStationModels(prev => ({
          ...prev,
          [stationId]: modelEntry
        }));
        tacticalAudio.playSuccess();
        return { success: true, result: backendRes, modelEntry };
      }
      throw new Error(backendRes?.error || "Training failed");
    } catch (err) {
      tacticalAudio.playAlarm();
      return { success: false, error: err.message };
    }
  };

  const rollbackModel = async (stationId, targetVersion = null) => {
    if (!isCentralAdmin(role)) {
      tacticalAudio.playAlarm();
      return { success: false, error: "ACCESS_DENIED: Model rollback is restricted to Central Admin." };
    }
    try {
      if (targetVersion) {
        await apiClient.rollbackStationModel(stationId, targetVersion);
        const activeRes = await apiClient.getStationActiveModel(stationId);
        if (activeRes?.has_active_model && activeRes?.model_card) {
          setActiveStationModels(prev => ({
            ...prev,
            [stationId]: {
              modelCard: activeRes.model_card,
              threshold: activeRes.model_card.training_summary?.dynamic_threshold || 0.65
            }
          }));
        }
      } else {
        setActiveStationModels(prev => {
          const next = { ...prev };
          delete next[stationId];
          return next;
        });
      }
      tacticalAudio.playSuccess();
      return { success: true };
    } catch (err) {
      tacticalAudio.playAlarm();
      return { success: false, error: err.message };
    }
  };

  const registerStation = (newStationData) => {
    const credential = {
      stationId: newStationData.id,
      stationName: newStationData.name || newStationData.id,
      region: newStationData.region,
      lat: newStationData.lat,
      lon: newStationData.lon,
      elevation: newStationData.elevation,
      status: newStationData.status || 'ACTIVE'
    };
    setStations(prev => {
      const existing = prev.find(station => station.id === newStationData.id);
      const updated = reconcileStationRoster(existing ? [existing] : [], [credential])[0];
      return existing
        ? prev.map(station => station.id === updated.id ? updated : station)
        : [...prev, updated];
    });
    if (!activeStationId) setActiveStationId(newStationData.id);
    syncLiveOpenMeteoData();
  };

  const deleteStation = (stationId) => {
    setStations(prev => prev.filter(s => s.id !== stationId));
    if (activeStationId === stationId) {
      setActiveStationId(null);
    }
  };

  return (
    <WeatherContext.Provider value={{
      stations,
      incidents,
      history,
      activeStationId,
      setActiveStationId: handleSetActiveStationId,
      currentView,
      setCurrentView: (view) => {
        setCurrentView(view);
        tacticalAudio.playSwitch();
      },
      qcConfig,
      setQcConfig,
      modelRegistry,
      modelDrift,
      externalDataLineage,
      checklists,
      updateChecklist,
      refreshStationChecklist,
      submitMaintenanceAudit,
      offlineBuffer,
      isOfflineMode,
      toggleOfflineMode,
      syncOfflineBuffer,
      queueOfflineRecords,
      injectFault,
      clearFaults,
      adjudicateIncident,
      rollbackModel,
      stationModels,
      activeStationModels,
      refreshActiveStationModel,
      trainStationModel,
      registerStation,
      deleteStation,
      neighborRadiusKm,
      setNeighborRadiusKm,
      spatialEngine,
      // Open-Meteo Real-Time Integration
      isLiveApiMode,
      setIsLiveApiMode,
      liveApiStatus,
      syncLiveOpenMeteoData,
      clearAllIncidents,
      saveIncidents,
      loadPresetFleet,
      fetchHistoricalTrainingDataset: openMeteoService.fetchHistoricalTrainingDataset.bind(openMeteoService)
    }}>
      {children}
    </WeatherContext.Provider>
  );
};

export const useWeather = () => useContext(WeatherContext);
