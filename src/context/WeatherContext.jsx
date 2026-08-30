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

const STATIONS_CACHE_KEY = "skyguard_stations_cache_v3";
const WeatherContext = createContext(null);

export const WeatherProvider = ({ children }) => {
  const { session, role, assignedStationId, stationCredentials } = useAuth();

  const isStationOperator = useCallback((r) => r === 'station_operator' || r === 'STATION_OPERATOR', []);
  const isCentralAdmin = useCallback((r) => r === 'admin' || r === 'CENTRAL_ADMIN', []);

  // Initialize stations from persistent localStorage cache (clean state when empty)
  const [stations, setStations] = useState(() => {
    try {
      localStorage.removeItem("skyguard_stations_cache_v2");
      const saved = localStorage.getItem(STATIONS_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });

  const [incidents, setIncidents] = useState(() => JSON.parse(JSON.stringify(SEED_INCIDENTS)));
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
    isOnline: true,
    latencyMs: 0,
    lastSync: null,
    isSyncing: false,
    error: null,
    source: "OPEN_METEO_API"
  });

  const [modelDrift, setModelDrift] = useState(() => ({ ...INITIAL_MODEL_DRIFT }));
  const [externalDataLineage] = useState(() => [...EXTERNAL_DATA_LINEAGE]);
  const [checklists, setChecklists] = useState(() => JSON.parse(JSON.stringify(INITIAL_CHECKLISTS)));
  const [offlineBuffer, setOfflineBuffer] = useState([]);
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

  // Synchronize stations state with authoritative database stationCredentials
  useEffect(() => {
    if (Array.isArray(stationCredentials)) {
      setStations(prev => {
        return stationCredentials.map(sc => {
          const existing = prev.find(p => p.id === sc.stationId);
          return {
            id: sc.stationId,
            name: sc.stationName,
            region: sc.region || "Local Microclimate",
            lat: sc.lat || 0,
            lon: sc.lon || 0,
            elevation: sc.elevation || 0,
            status: sc.status || "NORMAL",
            battery: existing?.battery ?? 12.6,
            signal: existing?.signal ?? -70,
            uptime_s: existing?.uptime_s ?? 3600,
            firmware: existing?.firmware ?? "v2.1.0",
            last_seen: existing?.last_seen ?? new Date().toISOString(),
            sensors: existing?.sensors ?? {
              temperature: { value: 25.0, unit: "°C", quality: "ACCEPTED" },
              humidity: { value: 60.0, unit: "%", quality: "ACCEPTED" },
              pressure: { value: 1012.0, unit: "hPa", quality: "ACCEPTED" },
              wind_speed: { value: 8.0, unit: "km/h", quality: "ACCEPTED" },
              wind_direction: { value: 180, unit: "deg", quality: "ACCEPTED" },
              rainfall: { value: 0.0, unit: "mm", quality: "ACCEPTED" },
              solar: { value: 500.0, unit: "W/m²", quality: "ACCEPTED" }
            },
            trusted_peers: existing?.trusted_peers ?? []
          };
        });
      });

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
  }, [stationCredentials]);

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
    if (isStationOperator(role) && assignedStationId) {
      setActiveStationId(assignedStationId);
    } else if (!activeStationId && stations.length > 0) {
      setActiveStationId(stations[0].id);
    }
  }, [stations, activeStationId, role, assignedStationId, isStationOperator]);

  // Sync active model for activeStationId from Cloud PostgreSQL backend
  const refreshActiveStationModel = useCallback(async (stId) => {
    const targetId = stId || activeStationId;
    if (!targetId) return null;
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
  }, [activeStationId]);

  useEffect(() => {
    if (activeStationId) {
      refreshActiveStationModel(activeStationId);
    }
  }, [activeStationId, refreshActiveStationModel]);

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
  const [history, setHistory] = useState(() => {
    const hist = {};
    const presetTemps = {
      'AWS-07': 29.5, 'AWS-12': 28.2, 'AWS-19': 22.4, 'AWS-01': 32.0,
      'AWS-04': 25.8, 'AWS-21': 14.5, 'AWS-15': 27.8, 'AWS-09': 30.1
    };
    OPEN_METEO_PRESET_STATIONS.forEach(st => {
      const bTemp = presetTemps[st.id] || 27.5;
      hist[st.id] = [
        ...Array.from({ length: 20 }, (_, i) => {
          const t = new Date(Date.now() - (20 - i) * 30 * 1000);
          return {
            time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            temperature: +(bTemp + Math.sin(i / 3.0) * 0.8 + (Math.sin(i) * 0.3)).toFixed(1),
            humidity: +(65 + Math.cos(i / 3.0) * 4.0).toFixed(1),
            pressure: +(1012 + Math.cos(i / 4.0) * 0.5).toFixed(1),
            wind_speed: +(8 + Math.sin(i / 2.0) * 2.0).toFixed(1),
            rainfall: (i === 12) ? 1.5 : 0
          };
        })
      ];
    });
    return hist;
  });

  // Reference for stable state access in async sync loops
  const stateRef = useRef({ stations, history, activeStationModels, activeFaults, qcConfig, neighborRadiusKm });
  useEffect(() => {
    stateRef.current = { stations, history, activeStationModels, activeFaults, qcConfig, neighborRadiusKm };
  }, [stations, history, activeStationModels, activeFaults, qcConfig, neighborRadiusKm]);

  /**
   * Sync all stations with real-world live weather data from Open-Meteo API
   */
  const syncLiveOpenMeteoData = useCallback(async (customStations = null) => {
    setLiveApiStatus(prev => ({ ...prev, isSyncing: true, error: null }));
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    try {
      const res = await apiClient.getFleetLiveState();
      
      if (res && res.success && res.stations) {
        // Map backend station schema to frontend UI schema where necessary
        const updatedStations = res.stations.map(st => ({
          ...st,
          id: st.station_id,
          name: st.station_name,
          lat: st.latitude,
          lon: st.longitude,
          active_model_id: st.ml_model?.model_id || null,
          model_status: st.ml_model ? "ACTIVE_PRODUCTION" : "PENDING_CALIBRATION"
        }));
        
        setStations(updatedStations);
        
        // Append to history
        setHistory(prevHist => {
          const nextHist = { ...prevHist };
          updatedStations.forEach(st => {
            if (!nextHist[st.id]) nextHist[st.id] = [];
            nextHist[st.id] = [...nextHist[st.id], {
              time: nowStr,
              temperature: st.sensors.temperature.value,
              humidity: st.sensors.humidity.value,
              pressure: st.sensors.pressure.value,
              wind_speed: st.sensors.wind_speed.value,
              rainfall: st.sensors.rainfall.value
            }].slice(-30);
          });
          return nextHist;
        });
        
        // Fetch Authoritative Backend Incidents
        try {
          const incRes = await apiClient.getIncidents();
          if (incRes && incRes.success && Array.isArray(incRes.incidents)) {
            setIncidents(incRes.incidents);
          }
        } catch (incErr) {
          console.warn("[WeatherContext] Incidents fetch skipped/failed:", incErr.message);
        }
        
        setLiveApiStatus({
          isOnline: true,
          latencyMs: 85,
          lastSync: new Date().toLocaleTimeString(),
          isSyncing: false,
          error: null,
          source: "BACKEND_FLEET_EVAL"
        });
      }
    } catch (err) {
      console.error("[WeatherContext] Error fetching fleet state:", err);
      setLiveApiStatus(prev => ({
        ...prev,
        isSyncing: false,
        error: "Failed to connect to backend telemetry service."
      }));
    }
  }, []);

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
            // If backend error or network fallback, find matching preset
            const preset = OPEN_METEO_PRESET_STATIONS.find(
              p => p.id.toUpperCase() === assignedStationId.toUpperCase()
            );
            if (preset) {
              stationData = {
                station_id: preset.id,
                station_name: preset.name,
                region: preset.region,
                latitude: preset.lat,
                longitude: preset.lon,
                elevation: preset.elevation
              };
            }
          }

          if (stationData) {
            const st = {
              id: stationData.station_id || assignedStationId,
              name: stationData.station_name || session.stationName || `${assignedStationId} Weather Unit`,
              region: stationData.region || "Assigned Region",
              lat: parseFloat(stationData.latitude ?? stationData.lat ?? 17.3850),
              lon: parseFloat(stationData.longitude ?? stationData.lon ?? 78.4867),
              elevation: parseFloat(stationData.elevation ?? 500),
              status: "NORMAL",
              battery: 12.6,
              signal: -72,
              uptime_s: 3600,
              firmware: "v2.1.0-OM",
              last_seen: new Date().toISOString(),
              sensors: {
                temperature: { value: 25.0, unit: "°C", quality: "ACCEPTED" },
                humidity: { value: 60.0, unit: "%", quality: "ACCEPTED" },
                pressure: { value: 1012.0, unit: "hPa", quality: "ACCEPTED" },
                wind_speed: { value: 8.0, unit: "km/h", quality: "ACCEPTED" },
                wind_direction: { value: 180, unit: "deg", quality: "ACCEPTED" },
                rainfall: { value: 0.0, unit: "mm", quality: "ACCEPTED" },
                solar: { value: 500.0, unit: "W/m²", quality: "ACCEPTED" }
              },
              trusted_peers: []
            };

            setStations(prev => {
              const others = prev.filter(s => s.id !== st.id);
              return [st, ...others];
            });
            setActiveStationId(st.id);
            syncLiveOpenMeteoData([st]);
          }
        } else if (isCentralAdmin(role)) {
          // Admin: fetch all stations from SQLite backend
          const backendStations = await apiClient.listStations();
          if (backendStations && backendStations.length > 0) {
            const formatted = backendStations.map(s => ({
              id: s.station_id,
              name: s.station_name,
              region: s.region,
              lat: parseFloat(s.latitude),
              lon: parseFloat(s.longitude),
              elevation: parseFloat(s.elevation),
              status: "NORMAL",
              battery: 12.6,
              signal: -72,
              uptime_s: 3600,
              firmware: "v2.1.0-OM",
              last_seen: new Date().toISOString(),
              sensors: {
                temperature: { value: 25.0, unit: "°C", quality: "ACCEPTED" },
                humidity: { value: 60.0, unit: "%", quality: "ACCEPTED" },
                pressure: { value: 1012.0, unit: "hPa", quality: "ACCEPTED" },
                wind_speed: { value: 8.0, unit: "km/h", quality: "ACCEPTED" },
                wind_direction: { value: 180, unit: "deg", quality: "ACCEPTED" },
                rainfall: { value: 0.0, unit: "mm", quality: "ACCEPTED" },
                solar: { value: 500.0, unit: "W/m²", quality: "ACCEPTED" }
              },
              trusted_peers: []
            }));
            setStations(formatted);
            syncLiveOpenMeteoData(formatted);
          }
        }
      } catch (err) {
        console.warn("[WeatherContext] Hydration Warning:", err.message);
      }
    };

    hydrateFromBackend();
  }, [session?.isAuthenticated, role, assignedStationId, isStationOperator, isCentralAdmin, syncLiveOpenMeteoData]);

  // (Removed redundant legacy interval and initial load sync hooks here; 
  // polling is now managed entirely by the 5-second interval below)

  /**
   * One-Click Instant Load of Real Indian AWS Fleet
   */
  const loadPresetFleet = async () => {
    if (!OPEN_METEO_PRESET_STATIONS || OPEN_METEO_PRESET_STATIONS.length === 0) return;
    const formatted = OPEN_METEO_PRESET_STATIONS.map(p => ({
      id: p.id,
      name: p.name,
      region: p.region,
      lat: p.lat,
      lon: p.lon,
      elevation: p.elevation,
      status: "NORMAL",
      battery: 12.6,
      signal: -72,
      uptime_s: 3600,
      firmware: "v2.1.0-OM",
      last_seen: new Date().toISOString(),
      sensors: {
        temperature: { value: 25.0, unit: "°C", quality: "ACCEPTED" },
        humidity: { value: 60.0, unit: "%", quality: "ACCEPTED" },
        pressure: { value: 1012.0, unit: "hPa", quality: "ACCEPTED" },
        wind_speed: { value: 8.0, unit: "km/h", quality: "ACCEPTED" },
        wind_direction: { value: 180, unit: "deg", quality: "ACCEPTED" },
        rainfall: { value: 0.0, unit: "mm", quality: "ACCEPTED" },
        solar: { value: 500.0, unit: "W/m²", quality: "ACCEPTED" }
      },
      trusted_peers: []
    }));

    setStations(formatted);
    setActiveStationId(formatted[0].id);
    batchRegisterStationCredentials(OPEN_METEO_PRESET_STATIONS);
    tacticalAudio.playSuccess();
    await syncLiveOpenMeteoData(formatted);
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

  const syncOfflineBuffer = () => {
    setOfflineBuffer([]);
    tacticalAudio.playSuccess();
  };

  const injectFault = async (stationId, faultType, offset = 0) => {
    try {
      await apiClient.injectFault(stationId, faultType, offset);
      tacticalAudio.playAlarm();
      syncLiveOpenMeteoData(); // Refresh immediately
    } catch(e) {
      console.error("[WeatherContext] Failed to inject fault:", e);
    }
  };

  const clearFaults = async (stationId) => {
    try {
      await apiClient.resetFault(stationId);
      tacticalAudio.playClick();
      syncLiveOpenMeteoData(); // Refresh immediately
    } catch(e) {
      console.error("[WeatherContext] Failed to clear fault:", e);
    }
  };

  const adjudicateIncident = async (incidentId, action) => {
    try {
      await apiClient.adjudicateIncident(incidentId, action);
      tacticalAudio.playSuccess();
      const incRes = await apiClient.getIncidents();
      if (incRes?.success && Array.isArray(incRes.incidents)) {
        setIncidents(incRes.incidents);
      }
    } catch (e) {
      console.warn("[WeatherContext] Backend adjudication error, falling back locally:", e.message);
      setIncidents(prev => prev.map(inc => {
        if (inc.id === incidentId) {
          return {
            ...inc,
            status: action === 'ACCEPT' || action === 'GENUINE' ? 'resolved' : action === 'ACKNOWLEDGE' ? 'acknowledged' : 'rejected',
            adjudicated_at: new Date().toISOString(),
            action_taken: action
          };
        }
        return inc;
      }));
      tacticalAudio.playSuccess();
    }
  };

  const updateChecklist = (stationId, itemId, completed) => {
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
  };

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
    const createdStation = {
      id: newStationData.id,
      name: newStationData.name || newStationData.id,
      region: newStationData.region || "Assigned Region",
      lat: newStationData.lat !== undefined ? parseFloat(newStationData.lat) : 17.3850,
      lon: newStationData.lon !== undefined ? parseFloat(newStationData.lon) : 78.4867,
      elevation: newStationData.elevation !== undefined ? parseFloat(newStationData.elevation) : 500,
      status: "NORMAL",
      battery: 12.6,
      signal: -75,
      uptime_s: 0,
      firmware: "v2.1.0-OM",
      last_seen: new Date().toISOString(),
      sensors: {
        temperature: { value: 28.5, unit: "°C", quality: "ACCEPTED" },
        humidity: { value: 65.0, unit: "%", quality: "ACCEPTED" },
        pressure: { value: 1008.0, unit: "hPa", quality: "ACCEPTED" },
        wind_speed: { value: 12.0, unit: "km/h", quality: "ACCEPTED" },
        wind_direction: { value: 200, unit: "deg", quality: "ACCEPTED" },
        rainfall: { value: 0.0, unit: "mm", quality: "ACCEPTED" },
        solar: { value: 450.0, unit: "W/m²", quality: "ACCEPTED" }
      },
      trusted_peers: []
    };

    setStations(prev => {
      const existing = prev.find(s => s.id === createdStation.id);
      if (existing) return prev.map(s => s.id === createdStation.id ? createdStation : s);
      return [...prev, createdStation];
    });

    if (!activeStationId) {
      setActiveStationId(createdStation.id);
    }

    setTimeout(() => {
      syncLiveOpenMeteoData([createdStation]);
    }, 300);
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
      offlineBuffer,
      isOfflineMode,
      toggleOfflineMode,
      syncOfflineBuffer,
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
      loadPresetFleet,
      fetchHistoricalTrainingDataset: openMeteoService.fetchHistoricalTrainingDataset.bind(openMeteoService)
    }}>
      {children}
    </WeatherContext.Provider>
  );
};

export const useWeather = () => useContext(WeatherContext);
