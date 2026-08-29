import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  SEED_STATIONS,
  SEED_INCIDENTS,
  INITIAL_QC_CONFIG,
  INITIAL_MODEL_REGISTRY,
  INITIAL_MODEL_DRIFT,
  EXTERNAL_DATA_LINEAGE,
  INITIAL_CHECKLISTS
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
  const { session, role, assignedStationId, batchRegisterStationCredentials } = useAuth();

  const isStationOperator = useCallback((r) => r === 'station_operator' || r === 'STATION_OPERATOR', []);
  const isCentralAdmin = useCallback((r) => r === 'admin' || r === 'CENTRAL_ADMIN', []);

  // Initialize stations from persistent localStorage cache
  const [stations, setStations] = useState(() => {
    try {
      const saved = localStorage.getItem(STATIONS_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    // If no cache, initialize from Indian AWS fleet presets
    return OPEN_METEO_PRESET_STATIONS.map(p => ({
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
    return "AWS-07";
  });

  const [currentView, setCurrentView] = useState(() => {
    if (isStationOperator(role)) return 'station-hud';
    return 'command-center';
  });

  // Save stations cache to localStorage
  useEffect(() => {
    try {
      if (stations && stations.length > 0) {
        localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify(stations));
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
    const targetStations = customStations || stateRef.current.stations;
    if (!targetStations || targetStations.length === 0) return;

    setLiveApiStatus(prev => ({ ...prev, isSyncing: true, error: null }));
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    try {
      const batchResult = await openMeteoService.fetchBatchRealtime(targetStations);
      const latency = openMeteoService.lastLatencyMs;

      setStations(prevStations => {
        const updatedStations = prevStations.map(station => {
          const liveObs = batchResult[station.id];
          if (!liveObs) return station;

          const fault = stateRef.current.activeFaults[station.id];
          let temp = liveObs.temperature;
          let hum = liveObs.humidity;
          let pres = liveObs.pressure;
          let wind = liveObs.wind_speed;
          let rain = liveObs.rainfall;
          let solar = liveObs.solar;

          let battery = +(station.battery + (Math.random() - 0.5) * 0.01).toFixed(2);
          let signal = station.signal + (Math.random() > 0.8 ? (Math.random() > 0.5 ? 1 : -1) : 0);

          // Apply active injected synthetic faults for testing
          if (fault && fault.ticksRemaining > 0) {
            switch (fault.type) {
              case 'SPIKE':
                temp += 8.5;
                break;
              case 'DRIFT':
                temp += (fault.offset || 0.4);
                break;
              case 'FLATLINE':
                break;
              case 'POWER':
                battery = 10.8;
                signal = -98;
                break;
              case 'STORM':
                rain += 25.0;
                wind += 30.0;
                hum = 98.0;
                pres -= 8.0;
                break;
            }
          }

          const currentReadingStation = {
            ...station,
            sensors: {
              temperature: { value: +temp.toFixed(1), unit: "°C", quality: liveObs.qc_flag || "ACCEPTED" },
              humidity: { value: +hum.toFixed(1), unit: "%", quality: liveObs.qc_flag || "ACCEPTED" },
              pressure: { value: +pres.toFixed(1), unit: "hPa", quality: liveObs.qc_flag || "ACCEPTED" },
              wind_speed: { value: +wind.toFixed(1), unit: "km/h", quality: "ACCEPTED" },
              wind_direction: { value: liveObs.wind_direction, unit: "deg", quality: "ACCEPTED" },
              rainfall: { value: +rain.toFixed(1), unit: "mm", quality: "ACCEPTED" },
              solar: { value: +solar.toFixed(0), unit: "W/m²", quality: "ACCEPTED" }
            },
            weather_meta: {
              weatherCode: liveObs.weatherCode,
              description: liveObs.description,
              icon: liveObs.icon,
              isDay: liveObs.isDay
            }
          };

          // 1. Station-Adaptive Machine Learning Inference
          const activeModel = stateRef.current.activeStationModels[station.id];
          let mlResult = null;
          if (activeModel) {
            mlResult = mlPipeline.evaluateModel(activeModel, currentReadingStation);
          } else {
            mlResult = {
              decision: "RULES_ONLY",
              score: 0,
              threshold: 0,
              dynamic_threshold: 0,
              is_anomaly: false,
              model_type: "NONE"
            };
          }

          // 2. Physical & Climatological Rules Check
          const qcResult = qcEngine.evaluate(
            {
              temperature: { value: temp },
              humidity: { value: hum },
              pressure: { value: pres },
              rainfall: { value: rain },
              wind_speed: { value: wind }
            },
            { battery_v: battery, signal_dbm: signal },
            stateRef.current.qcConfig,
            stateRef.current.history,
            prevStations,
            mlResult
          );

          // 3. Spatial Cross-Station Consistency & Fusion
          let spatialAnalysis = null;
          let finalAssessment = null;
          try {
            if (spatialEngine && typeof spatialEngine.analyzeStation === 'function') {
              spatialAnalysis = spatialEngine.analyzeStation({
                targetStation: currentReadingStation,
                stations: prevStations,
                radiusKm: stateRef.current.neighborRadiusKm,
                localMl: mlResult,
                physicalQc: qcResult
              });
              finalAssessment = spatialAnalysis?.final_assessment || null;
            }
          } catch (err) {
            console.warn("[SpatialEngine] Evaluation skipped:", err.message);
          }

          const status = qcResult.quality_state === "SUSPECT" ? (qcResult.fault_risk >= 0.8 ? "CRITICAL" : "SUSPECT")
            : qcResult.quality_state === "GENUINE_EXTREME_CANDIDATE" ? "EXTREME" : "NORMAL";

          return {
            ...station,
            status,
            battery,
            signal,
            uptime_s: (station.uptime_s || 0) + 15,
            last_seen: new Date().toISOString(),
            ml_model: mlResult,
            model_status: activeModel ? "ACTIVE_PRODUCTION" : "PENDING_CALIBRATION",
            active_model_id: activeModel ? activeModel.modelCard.model_id : null,
            spatial_data: spatialAnalysis,
            final_assessment: finalAssessment,
            sensors: currentReadingStation.sensors,
            weather_meta: currentReadingStation.weather_meta
          };
        });

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

        return updatedStations;
      });

      setLiveApiStatus({
        isOnline: true,
        latencyMs: latency,
        lastSync: new Date().toLocaleTimeString(),
        isSyncing: false,
        error: null,
        source: "OPEN_METEO_API"
      });
    } catch (err) {
      console.warn("Open-Meteo Live Sync Warning:", err.message);
      setLiveApiStatus(prev => ({
        ...prev,
        isOnline: false,
        isSyncing: false,
        error: err.message
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

  // Trigger live sync on initial load
  useEffect(() => {
    if (stations.length > 0) {
      syncLiveOpenMeteoData();
    }
  }, []);

  // Periodic Live Sync Loop (Every 20s)
  useEffect(() => {
    const liveInterval = setInterval(() => {
      if (isLiveApiMode && !isOfflineMode) {
        syncLiveOpenMeteoData();
      }
    }, 20000);
    return () => clearInterval(liveInterval);
  }, [isLiveApiMode, isOfflineMode, syncLiveOpenMeteoData]);

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

  /**
   * High-Frequency Simulation & Micro-Drift Interval (Every 3s)
   */
  useEffect(() => {
    const interval = setInterval(() => {
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      setStations(prevStations => {
        if (!prevStations || prevStations.length === 0) return prevStations;

        const updatedStations = prevStations.map(station => {
          const fault = activeFaults[station.id];
          let tempDelta = (Math.random() - 0.49) * 0.15;
          let humDelta = (Math.random() - 0.5) * 0.4;
          let presDelta = (Math.random() - 0.5) * 0.1;
          let windDelta = (Math.random() - 0.5) * 0.3;
          let rainDelta = Math.random() > 0.92 ? +(Math.random() * 0.2).toFixed(1) : 0;

          let battery = +(station.battery + (Math.random() - 0.5) * 0.01).toFixed(2);
          let signal = station.signal + (Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0);

          if (fault && fault.ticksRemaining > 0) {
            switch (fault.type) {
              case 'SPIKE':
                tempDelta += 8.5;
                break;
              case 'DRIFT':
                tempDelta += (fault.offset || 0.4);
                break;
              case 'FLATLINE':
                tempDelta = 0;
                humDelta = 0;
                break;
              case 'POWER':
                battery = 10.8;
                signal = -98;
                break;
              case 'STORM':
                rainDelta = +(Math.random() * 25 + 15).toFixed(1);
                windDelta = 25.0;
                humDelta = 12.0;
                presDelta = -4.0;
                break;
            }
          }

          const currentTemp = station.sensors?.temperature?.value ?? 25.0;
          const currentHum = station.sensors?.humidity?.value ?? 60.0;
          const currentPres = station.sensors?.pressure?.value ?? 1012.0;
          const currentWind = station.sensors?.wind_speed?.value ?? 8.0;
          const currentRain = station.sensors?.rainfall?.value ?? 0.0;
          const currentSolar = station.sensors?.solar?.value ?? 500.0;

          const updatedSensors = {
            temperature: {
              value: +(currentTemp + tempDelta).toFixed(1),
              unit: "°C",
              quality: station.sensors?.temperature?.quality || "ACCEPTED"
            },
            humidity: {
              value: Math.min(100, Math.max(10, +(currentHum + humDelta).toFixed(1))),
              unit: "%",
              quality: station.sensors?.humidity?.quality || "ACCEPTED"
            },
            pressure: {
              value: +(currentPres + presDelta).toFixed(1),
              unit: "hPa",
              quality: station.sensors?.pressure?.quality || "ACCEPTED"
            },
            wind_speed: {
              value: Math.max(0, +(currentWind + windDelta).toFixed(1)),
              unit: "km/h",
              quality: "ACCEPTED"
            },
            wind_direction: station.sensors?.wind_direction || { value: 180, unit: "deg", quality: "ACCEPTED" },
            rainfall: {
              value: +(currentRain + rainDelta).toFixed(1),
              unit: "mm",
              quality: "ACCEPTED"
            },
            solar: {
              value: currentSolar,
              unit: "W/m²",
              quality: "ACCEPTED"
            }
          };

          return {
            ...station,
            battery,
            signal,
            sensors: updatedSensors
          };
        });

        // Continuously update rolling time-series history
        setHistory(prevHist => {
          const nextHist = { ...prevHist };
          updatedStations.forEach(st => {
            if (!nextHist[st.id]) nextHist[st.id] = [];
            const lastEntry = nextHist[st.id][nextHist[st.id].length - 1];
            if (!lastEntry || lastEntry.time !== nowStr) {
              nextHist[st.id] = [...nextHist[st.id], {
                time: nowStr,
                temperature: st.sensors.temperature.value,
                humidity: st.sensors.humidity.value,
                pressure: st.sensors.pressure.value,
                wind_speed: st.sensors.wind_speed.value,
                rainfall: st.sensors.rainfall.value
              }].slice(-30);
            }
          });
          return nextHist;
        });

        return updatedStations;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [activeFaults]);

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

  const injectFault = (stationId, faultType, offset = 0) => {
    setActiveFaults(prev => ({
      ...prev,
      [stationId]: { type: faultType, ticksRemaining: 15, offset }
    }));
    tacticalAudio.playAlarm();
  };

  const clearFaults = (stationId) => {
    setActiveFaults(prev => {
      const next = { ...prev };
      delete next[stationId];
      return next;
    });
    tacticalAudio.playClick();
  };

  const adjudicateIncident = (incidentId, action) => {
    setIncidents(prev => prev.map(inc => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          status: action === 'ACCEPT' ? 'closed' : 'rejected',
          adjudicated_at: new Date().toISOString(),
          action_taken: action
        };
      }
      return inc;
    }));
    tacticalAudio.playSuccess();
  };

  const updateChecklist = (stationId, itemId, completed) => {
    setChecklists(prev => {
      const currentList = prev[stationId] || [];
      const updatedList = currentList.map(item =>
        item.id === itemId ? { ...item, completed, timestamp: new Date().toISOString() } : item
      );
      return { ...prev, [stationId]: updatedList };
    });
  };

  const trainStationModel = async (stationId, config, dataset) => {
    try {
      const result = await mlPipeline.trainStationModel(stationId, config, dataset);
      setStationModels(prev => ({
        ...prev,
        [stationId]: [result, ...(prev[stationId] || [])]
      }));
      setActiveStationModels(prev => ({
        ...prev,
        [stationId]: result
      }));
      tacticalAudio.playSuccess();
      return { success: true, result };
    } catch (err) {
      tacticalAudio.playAlarm();
      return { success: false, error: err.message };
    }
  };

  const rollbackModel = (stationId) => {
    if (!isCentralAdmin(role)) {
      tacticalAudio.playAlarm();
      return { success: false, error: "ACCESS_DENIED: Model rollback is restricted to Central Admin." };
    }
    setActiveStationModels(prev => {
      const next = { ...prev };
      delete next[stationId];
      return next;
    });
    tacticalAudio.playAlarm();
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
