import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
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
import { tacticalAudio } from '../utils/audio';
import { useAuth } from './AuthContext';

const WeatherContext = createContext(null);

export const WeatherProvider = ({ children }) => {
  const { session, role, assignedStationId } = useAuth();
  
  const [stations, setStations] = useState(() => JSON.parse(JSON.stringify(SEED_STATIONS)));
  const [incidents, setIncidents] = useState(() => JSON.parse(JSON.stringify(SEED_INCIDENTS)));
  const [qcConfig, setQcConfig] = useState(() => ({ ...INITIAL_QC_CONFIG }));
  const [modelRegistry, setModelRegistry] = useState(() => [...INITIAL_MODEL_REGISTRY]);
  
  // Station-Adaptive Model Registry: Map<stationId, Array<Model>>
  const [stationModels, setStationModels] = useState({});
  // Active production model per station: Map<stationId, Model>
  const [activeStationModels, setActiveStationModels] = useState({});

  // Configurable spatial neighbor search radius (km)
  const [neighborRadiusKm, setNeighborRadiusKm] = useState(50);

  const [modelDrift, setModelDrift] = useState(() => ({ ...INITIAL_MODEL_DRIFT }));
  const [externalDataLineage] = useState(() => [...EXTERNAL_DATA_LINEAGE]);
  const [checklists, setChecklists] = useState(() => JSON.parse(JSON.stringify(INITIAL_CHECKLISTS)));
  const [offlineBuffer, setOfflineBuffer] = useState([]);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [activeFaults, setActiveFaults] = useState({}); // stationId -> { type, ticksRemaining, offset }

  const [activeStationId, setActiveStationId] = useState(() => {
    if (role === 'station_operator' && assignedStationId) return assignedStationId;
    return null;
  });

  const [currentView, setCurrentView] = useState(() => {
    if (role === 'station_operator') return 'station-hud';
    return 'command-center';
  });

  // Sync role/station view when session changes
  useEffect(() => {
    if (role === 'station_operator') {
      if (assignedStationId) setActiveStationId(assignedStationId);
      const adminOnlyViews = ['command-center', 'fleet-map', 'incidents', 'qc-rules', 'fault-lab', 'model-governance', 'credentials', 'export'];
      if (adminOnlyViews.includes(currentView)) {
        setCurrentView('station-hud');
      }
    } else if (role === 'admin') {
      const stationOnlyViews = ['station-hud', 'station-upload', 'station-diagnostics', 'station-checklist', 'edge-sync'];
      if (stationOnlyViews.includes(currentView)) {
        setCurrentView('command-center');
      }
    }
  }, [role, assignedStationId]);

  // Automatically select first station if none selected
  useEffect(() => {
    if (!activeStationId && stations.length > 0) {
      setActiveStationId(stations[0].id);
    }
  }, [stations, activeStationId]);

  // Generate initial history
  const [history, setHistory] = useState(() => {
    const hist = {};
    const now = Date.now();
    SEED_STATIONS.forEach(st => {
      hist[st.id] = [];
      for (let i = 20; i >= 0; i--) {
        const time = new Date(now - i * 60000 * 5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const noise = (Math.random() - 0.5) * 0.4;
        hist[st.id].push({
          time,
          temperature: +(st.sensors.temperature.value + noise * 1.5).toFixed(1),
          humidity: Math.min(100, Math.max(10, +(st.sensors.humidity.value + noise * 3).toFixed(1))),
          pressure: +(st.sensors.pressure.value + noise * 0.8).toFixed(1),
          wind_speed: Math.max(0, +(st.sensors.wind_speed.value + noise * 2).toFixed(1)),
          rainfall: +(st.sensors.rainfall.value + (Math.random() > 0.8 ? Math.random() * 0.5 : 0)).toFixed(1)
        });
      }
    });
    return hist;
  });

  // Simulator interval
  useEffect(() => {
    const interval = setInterval(() => {
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      setStations(prevStations => {
        const updatedStations = prevStations.map(station => {
          const fault = activeFaults[station.id];
          let tempDelta = (Math.random() - 0.48) * 0.3;
          let humDelta = (Math.random() - 0.5) * 0.8;
          let presDelta = (Math.random() - 0.5) * 0.2;
          let windDelta = (Math.random() - 0.5) * 0.6;
          let rainDelta = Math.random() > 0.85 ? +(Math.random() * 0.4).toFixed(1) : 0;

          let battery = +(station.battery + (Math.random() - 0.5) * 0.02).toFixed(2);
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

          const newTemp = +(station.sensors.temperature.value + (fault?.type === 'FLATLINE' ? 0 : tempDelta)).toFixed(1);
          const newHum = Math.min(100, Math.max(10, +(station.sensors.humidity.value + humDelta).toFixed(1)));
          const newPres = +(station.sensors.pressure.value + presDelta).toFixed(1);
          const newWind = Math.max(0, +(station.sensors.wind_speed.value + windDelta).toFixed(1));
          const newRain = +(station.sensors.rainfall.value + rainDelta).toFixed(1);

          if (isOfflineMode && role === 'station_operator') {
            setOfflineBuffer(buf => [...buf, {
              stationId: station.id,
              timestamp: nowStr,
              temperature: newTemp,
              humidity: newHum,
              pressure: newPres,
              wind: newWind,
              rainfall: newRain
            }]);
          }

          const activeModel = activeStationModels[station.id];
          const stHist = history[station.id] || [];
          const lastObs = stHist[stHist.length - 1];

          const mlResult = mlPipeline.scoreRealtimeObservation({
            model: activeModel,
            observation: { temperature: newTemp, humidity: newHum, pressure: newPres, wind_speed: newWind, rainfall: newRain },
            lastObservation: lastObs
          });

          const currentReadingStation = {
            ...station,
            sensors: {
              ...station.sensors,
              temperature: { ...station.sensors.temperature, value: newTemp },
              humidity: { ...station.sensors.humidity, value: newHum },
              pressure: { ...station.sensors.pressure, value: newPres },
              wind_speed: { ...station.sensors.wind_speed, value: newWind },
              rainfall: { ...station.sensors.rainfall, value: newRain }
            }
          };

          // Nearby Station Spatial Intelligence Layer
          const spatialAnalysis = spatialEngine.analyzeStation({
            targetStation: currentReadingStation,
            stations: prevStations,
            radiusKm: neighborRadiusKm,
            maxAgeSeconds: 300,
            localMl: mlResult,
            physicalQc: null
          });

          const qcResult = qcEngine.evaluateObservation(
            station.id,
            {
              temperature: { value: newTemp },
              humidity: { value: newHum },
              pressure: { value: newPres },
              rainfall: { value: newRain },
              wind_speed: { value: newWind }
            },
            { battery_v: battery, signal_dbm: signal },
            qcConfig,
            history,
            prevStations,
            mlResult
          );

          // Update final assessment with physical QC context
          const finalAssessment = spatialEngine.fuseAssessment({
            physicalQc: qcResult,
            localMl: mlResult,
            spatialAnalysis: spatialAnalysis.spatial_analysis
          });

          const status = qcResult.quality_state === "SUSPECT" ? (qcResult.fault_risk >= 0.8 ? "CRITICAL" : "SUSPECT")
            : qcResult.quality_state === "GENUINE_EXTREME_CANDIDATE" ? "EXTREME" : "NORMAL";

          if (qcResult.quality_state === "SUSPECT" && qcResult.fault_risk >= 0.65) {
            setIncidents(prevInc => {
              const existing = prevInc.find(i => i.station_id === station.id && i.status === 'open');
              if (!existing) {
                const newInc = {
                  id: `INC-AUTO-${Date.now().toString().slice(-4)}`,
                  station_id: station.id,
                  station_name: station.name,
                  variable: "air_temperature",
                  severity: qcResult.severity,
                  fault_risk: qcResult.fault_risk,
                  quality_state: qcResult.quality_state,
                  reason_codes: qcResult.reason_codes,
                  explanation: qcResult.evidence.join(". ") || "Multiple sensor quality thresholds breached.",
                  recommended_actions: [
                    "Inspect sensor wiring and terminal blocks",
                    "Check hardware diagnostics & battery status",
                    "Validate against nearby trusted buddy stations"
                  ],
                  evidence_ids: [`EV-GEN-${station.id}`],
                  status: "open",
                  created_at: new Date().toISOString(),
                  assignee: "Auto-Assigned Dispatch",
                  disposition_history: []
                };
                tacticalAudio.playAlarm();
                return [newInc, ...prevInc];
              }
              return prevInc;
            });
          }

          return {
            ...station,
            status,
            battery,
            signal,
            uptime_s: station.uptime_s + 3,
            last_seen: new Date().toISOString(),
            ml_model: mlResult,
            model_status: activeModel ? "ACTIVE_PRODUCTION" : "PENDING_CALIBRATION",
            active_model_id: activeModel ? activeModel.modelCard.model_id : null,
            spatial_data: spatialAnalysis,
            final_assessment: finalAssessment,
            sensors: currentReadingStation.sensors
          };
        });

        // Update history
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
            }].slice(-25);
          });
          return nextHist;
        });

        // Update active faults countdown
        setActiveFaults(prevFaults => {
          const next = {};
          Object.keys(prevFaults).forEach(k => {
            const f = prevFaults[k];
            if (f.ticksRemaining > 1) {
              next[k] = { ...f, ticksRemaining: f.ticksRemaining - 1, offset: (f.offset || 0) + 0.4 };
            }
          });
          return next;
        });

        return updatedStations;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [qcConfig, activeFaults, isOfflineMode, role, activeStationModels, neighborRadiusKm]);

  const injectFault = (stationId, faultType) => {
    setActiveFaults(prev => ({
      ...prev,
      [stationId]: {
        type: faultType,
        ticksRemaining: 15,
        offset: 0
      }
    }));
    tacticalAudio.playAlarm();
  };

  const clearFaults = (stationId = null) => {
    if (stationId) {
      setActiveFaults(prev => {
        const next = { ...prev };
        delete next[stationId];
        return next;
      });
    } else {
      setActiveFaults({});
    }
  };

  const toggleOfflineMode = () => {
    setIsOfflineMode(prev => !prev);
    tacticalAudio.playSwitch();
  };

  const syncOfflineBuffer = () => {
    const count = offlineBuffer.length;
    setOfflineBuffer([]);
    setIsOfflineMode(false);
    tacticalAudio.playSuccess();
    return count;
  };

  const adjudicateIncident = (id, action) => {
    const operator = role === 'admin' ? 'Chief Lead' : `${activeStationId} Operator`;
    setIncidents(prev => prev.map(inc => {
      if (inc.id === id) {
        let updatedQuality = inc.quality_state;
        let updatedStatus = inc.status;
        let actionDesc = "";

        if (action === "ACKNOWLEDGE") {
          updatedStatus = "acknowledged";
          actionDesc = "Acknowledged Incident";
        } else if (action === "GENUINE") {
          updatedQuality = "GENUINE_EXTREME_CONFIRMED";
          updatedStatus = "resolved";
          actionDesc = "Confirmed Genuine Weather Phenomenon";
        } else if (action === "REJECT") {
          updatedQuality = "REJECTED";
          updatedStatus = "resolved";
          actionDesc = "Flagged Invalid / Sensor Defect";
        }

        return {
          ...inc,
          quality_state: updatedQuality,
          status: updatedStatus,
          disposition_history: [
            ...inc.disposition_history,
            { operator, action: actionDesc, timestamp: new Date().toISOString() }
          ]
        };
      }
      return inc;
    }));
    tacticalAudio.playSuccess();
  };

  const updateChecklist = (stationId, itemId, done) => {
    setChecklists(prev => ({
      ...prev,
      [stationId]: (prev[stationId] || []).map(item => {
        if (item.id === itemId) {
          return {
            ...item,
            done,
            timestamp: done ? new Date().toLocaleString() : null
          };
        }
        return item;
      })
    }));
    tacticalAudio.playClick();
  };

  const trainStationModel = async (stationId, rawDataset, version = "v1.0") => {
    const stationProfile = stations.find(s => s.id === stationId) || { id: stationId, name: stationId };
    try {
      const result = await mlPipeline.trainStationModel({
        stationId,
        stationProfile,
        rawDataset,
        version
      });

      // Update stationModels history for this station
      setStationModels(prev => ({
        ...prev,
        [stationId]: [result, ...(prev[stationId] || [])]
      }));

      // Set active production model
      setActiveStationModels(prev => ({
        ...prev,
        [stationId]: result
      }));

      // Update modelRegistry state with new model card
      setModelRegistry(prev => {
        const filtered = prev.filter(m => m.model_id !== result.modelCard.model_id);
        return [result.modelCard, ...filtered];
      });

      // Update station profile status to NORMAL and link active model
      setStations(prev => prev.map(s => {
        if (s.id === stationId) {
          return {
            ...s,
            status: "NORMAL",
            model_status: "ACTIVE_PRODUCTION",
            active_model_id: result.modelCard.model_id
          };
        }
        return s;
      }));

      tacticalAudio.playSuccess();
      return { success: true, result };
    } catch (err) {
      tacticalAudio.playAlarm();
      return { success: false, error: err.message };
    }
  };

  const rollbackModel = (stationId, targetModelId = null) => {
    const historyList = stationModels[stationId] || [];
    if (historyList.length > 1) {
      const fallback = historyList[1];
      setActiveStationModels(prev => ({
        ...prev,
        [stationId]: fallback
      }));
      tacticalAudio.playAlarm();
      alert(`Model for station ${stationId} rolled back to ${fallback.modelCard.model_id}.`);
    } else {
      // Revert to zero model state (rules only)
      setActiveStationModels(prev => {
        const next = { ...prev };
        delete next[stationId];
        return next;
      });
      tacticalAudio.playAlarm();
      alert(`Model for station ${stationId} unassigned. Station is running in Rules-Only mode.`);
    }
  };

  const registerStation = (newStationData) => {
    setStations(prev => {
      const existing = prev.find(s => s.id === newStationData.id);
      if (existing) return prev;
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
        firmware: "v1.4.2",
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
      if (!activeStationId) {
        setActiveStationId(createdStation.id);
      }
      return [...prev, createdStation];
    });
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
      setActiveStationId,
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
      spatialEngine
    }}>
      {children}
    </WeatherContext.Provider>
  );
};

export const useWeather = () => useContext(WeatherContext);
