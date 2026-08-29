import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const StationUpload = () => {
  const { role, assignedStationId } = useAuth();
  const {
    activeStationId,
    stations,
    setActiveStationId,
    trainStationModel,
    activeStationModels,
    setCurrentView,
    fetchHistoricalTrainingDataset
  } = useWeather();

  const isOperator = role === 'station_operator' || role === 'STATION_OPERATOR';
  const isAdmin = role === 'admin' || role === 'CENTRAL_ADMIN';
  const isAuthorizedForStation = isOperator && assignedStationId === activeStationId;

  const currentStation = stations.find(s => s.id === activeStationId) || stations[0] || {};
  const activeModel = activeStationModels[activeStationId];

  // Dataset states: separate user-uploaded training data from Open-Meteo observation history
  const [uploadedDataset, setUploadedDataset] = useState([]);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [openMeteoHistory, setOpenMeteoHistory] = useState([]);
  const [activeTableSource, setActiveTableSource] = useState('none'); // 'uploaded' | 'openmeteo' | 'none'

  const [pipelineState, setPipelineState] = useState('IDLE'); // IDLE, TRAINING, COMPLETED, ERROR
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [trainedResult, setTrainedResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isFetchingApi, setIsFetchingApi] = useState(false);
  const [apiFeedback, setApiFeedback] = useState('');

  if (!stations || stations.length === 0) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-cloud-arrow-up" style={{ fontSize: '3rem', color: 'var(--neon-cyan)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
          NO REGISTERED WEATHER STATIONS
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          All mock stations and data have been removed. To train an Isolation Forest model, please provision a weather station first via Station Credentials.
        </p>
        <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('credentials')}>
          <i className="fa-solid fa-key"></i> Provision Weather Station
        </button>
      </div>
    );
  }

  const PIPELINE_STEPS = [
    { label: "Data Uploaded", desc: "Raw datalogger frames received" },
    { label: "Data Validated", desc: "Physical plausibility & sanity checks" },
    { label: "Data Preprocessed", desc: "Scrubbed -999 flags and null readings" },
    { label: "Features Generated", desc: "Normalized lags, diurnal cycles & dew-point" },
    { label: "Training Isolation Forest", desc: "Fitting ensemble isolation trees from scratch" },
    { label: "Model Evaluation", desc: "Calibrating dynamic threshold & contamination rate" },
    { label: "Model Deployed to Station ID", desc: "Registered as active production model" }
  ];

  const handleStationChange = (id) => {
    if (isOperator && assignedStationId && id !== assignedStationId) {
      setErrorMessage(`ACCESS DENIED: Station Operator for '${assignedStationId}' cannot switch to '${id}'.`);
      tacticalAudio.playAlarm();
      return;
    }
    setActiveStationId(id);
    setUploadedDataset([]);
    setUploadedFileName('');
    setOpenMeteoHistory([]);
    setActiveTableSource('none');
    setPipelineState('IDLE');
    setTrainedResult(null);
    setErrorMessage('');
    setApiFeedback('');
    tacticalAudio.playClick();
  };

  /**
   * Fetch 7-Day Real Hourly Historical Climatology from Open-Meteo API (Observation Only)
   */
  const handleFetchOpenMeteoHistory = async (pastDays = 7) => {
    const lat = currentStation.lat !== undefined ? currentStation.lat : 17.3850;
    const lon = currentStation.lon !== undefined ? currentStation.lon : 78.4867;
    
    setIsFetchingApi(true);
    setApiFeedback(`Connecting to Open-Meteo API for ${currentStation.name} (${lat}°N, ${lon}°E)...`);
    tacticalAudio.playClick();

    try {
      const res = await fetchHistoricalTrainingDataset(lat, lon, pastDays);
      setOpenMeteoHistory(res.rows);
      setActiveTableSource('openmeteo');
      setApiFeedback(`Successfully ingested ${res.totalRows} real hourly observations from Open-Meteo API (${pastDays} days history). Displayed for reference only (Not used for training).`);
      tacticalAudio.playSuccess();
    } catch (err) {
      setApiFeedback(`Failed to fetch from Open-Meteo: ${err.message}`);
      tacticalAudio.playAlarm();
    } finally {
      setIsFetchingApi(false);
    }
  };

  const handleFileUpload = (e) => {
    // RBAC Check 1: Central Admin cannot upload station training datasets
    if (!isOperator) {
      setErrorMessage("ACCESS DENIED: Central Admin cannot upload station training datasets. Only the authorized Station Operator may upload training data.");
      tacticalAudio.playAlarm();
      return;
    }

    // RBAC Check 2: Station Operator can only upload for their assigned station
    if (assignedStationId !== activeStationId) {
      setErrorMessage(`ACCESS DENIED: Station Operator for '${assignedStationId}' cannot upload training datasets for '${activeStationId}'.`);
      tacticalAudio.playAlarm();
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') return;

        let parsedRows = [];
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          parsedRows = Array.isArray(parsed) ? parsed : (parsed.data || [parsed]);
        } else {
          // CSV Parser
          const lines = text.trim().split('\n');
          if (lines.length < 2) throw new Error("CSV file must have a header and at least 1 data row.");
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            if (cols.length < 3) continue;
            
            const rowObj = {};
            headers.forEach((h, idx) => {
              rowObj[h] = cols[idx];
            });

            parsedRows.push({
              timestamp: rowObj.timestamp || rowObj.time || new Date().toISOString(),
              temp: parseFloat(rowObj.temperature_c ?? rowObj.temp ?? 25),
              hum: parseFloat(rowObj.humidity_pct ?? rowObj.hum ?? 60),
              pres: parseFloat(rowObj.pressure_hpa ?? rowObj.pres ?? 1010),
              wind: parseFloat(rowObj.wind_speed_kmh ?? rowObj.wind ?? 12),
              rain: parseFloat(rowObj.rainfall_mm ?? rowObj.rain ?? 0)
            });
          }
        }

        setUploadedDataset(parsedRows);
        setUploadedFileName(file.name);
        setActiveTableSource('uploaded');
        tacticalAudio.playSuccess();
        setPipelineState('IDLE');
        setTrainedResult(null);
        setErrorMessage('');
      } catch (err) {
        alert(`Error parsing file: ${err.message}`);
        tacticalAudio.playAlarm();
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const csv = `timestamp,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,rainfall_mm\n2026-08-01 00:00:00,24.2,82.0,1008.2,12.4,0.0\n2026-08-01 01:00:00,23.8,85.0,1007.9,11.2,0.0\n2026-08-01 02:00:00,23.4,88.0,1007.5,10.5,0.0`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skyguard-${activeStationId}-template.csv`;
    a.click();
    tacticalAudio.playSuccess();
  };

  const runTrainingPipeline = async () => {
    // RBAC Rule 1: Central Admin is strictly prohibited from training station models
    if (!isOperator) {
      setErrorMessage("ACCESS DENIED: Central Admin cannot train station models. Station-specific model training is restricted to the authorized Station Operator.");
      setPipelineState('ERROR');
      tacticalAudio.playAlarm();
      return;
    }

    // RBAC Rule 2: Station Operator can ONLY train their assigned station
    if (assignedStationId !== activeStationId) {
      setErrorMessage(`ACCESS DENIED: Station Operator for '${assignedStationId}' is not authorized to train model for '${activeStationId}'. Cross-station training is strictly prohibited.`);
      setPipelineState('ERROR');
      tacticalAudio.playAlarm();
      return;
    }

    // Training Data Rule 3: ONLY uploaded dataset can be trained
    if (!uploadedDataset || uploadedDataset.length === 0) {
      setErrorMessage("Training requires a user-uploaded CSV or JSON dataset. Open-Meteo observations cannot be used for training.");
      setPipelineState('ERROR');
      tacticalAudio.playAlarm();
      return;
    }

    if (uploadedDataset.length < 20) {
      setErrorMessage(`Insufficient historical records in uploaded file for ${activeStationId}. Found ${uploadedDataset.length} rows; minimum 20 required.`);
      setPipelineState('ERROR');
      tacticalAudio.playAlarm();
      return;
    }

    setPipelineState('TRAINING');
    setErrorMessage('');
    setCurrentStepIndex(0);

    // Step-by-step UI animation
    for (let step = 0; step < PIPELINE_STEPS.length; step++) {
      setCurrentStepIndex(step);
      tacticalAudio.playClick();
      await new Promise(r => setTimeout(r, 450));
    }

    const versionNum = activeModel ? `v1.${(Math.random() * 8 + 1).toFixed(0)}` : "v1.0";
    // Training strictly uses ONLY the uploaded dataset
    const res = await trainStationModel(activeStationId, uploadedDataset, versionNum);

    if (res.success) {
      setTrainedResult(res.result.modelCard);
      setPipelineState('COMPLETED');
      tacticalAudio.playSuccess();
    } else {
      setErrorMessage(res.error || "Training pipeline failed.");
      setPipelineState('ERROR');
      tacticalAudio.playAlarm();
    }
  };

  const displayedRows = activeTableSource === 'uploaded'
    ? uploadedDataset
    : activeTableSource === 'openmeteo'
    ? openMeteoHistory
    : [];

  return (
    <>
      <div className="cyber-card">
        <div className="cyber-card-header">
          <div className="cyber-card-title">
            <i className="fa-solid fa-microchip text-cyan"></i> STATION-ADAPTIVE ML TRAINING STUDIO
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>SELECT STATION:</span>
            <select
              className="cyber-input"
              value={activeStationId}
              onChange={(e) => handleStationChange(e.target.value)}
              disabled={isOperator}
              style={{ background: '#050811', padding: '4px 8px', fontSize: '0.78rem' }}
            >
              {(isOperator && assignedStationId ? stations.filter(s => s.id === assignedStationId) : stations).map(st => (
                <option key={st.id} value={st.id}>{st.id} - {st.name}</option>
              ))}
            </select>
            <button className="cyber-btn btn-sm" onClick={handleDownloadTemplate}>
              <i className="fa-solid fa-file-csv"></i> CSV Template
            </button>
          </div>
        </div>

        <div className="cyber-card-body">
          {/* Central Admin Read-Only Notice */}
          {isAdmin && (
            <div style={{ background: 'rgba(255, 170, 0, 0.08)', border: '1px solid rgba(255, 170, 0, 0.3)', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <i className="fa-solid fa-shield-halved text-amber" style={{ fontSize: '1.5rem' }}></i>
              <div>
                <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', color: 'var(--neon-amber)', fontWeight: 800 }}>
                  CENTRAL ADMIN AUDIT MODE (READ-ONLY)
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Training controls are restricted. Central Admin is not permitted to upload datasets or train station-specific ML models. Historical data ingestion and model training must be executed by the authorized Station Operator.
                </div>
              </div>
            </div>
          )}

          {/* Architecture Banner */}
          <div style={{ background: 'rgba(0,240,255,0.05)', border: '1px solid rgba(0,240,255,0.2)', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.85rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
                <i className="fa-solid fa-layer-group"></i> ZERO GLOBAL MODELS — 100% STATION-SPECIFIC CALIBRATION
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Currently configuring: <strong>{currentStation.name} ({activeStationId})</strong> | Region: <strong>{currentStation.region}</strong> | Coordinates: <strong>{currentStation.lat?.toFixed(2)}°N, {currentStation.lon?.toFixed(2)}°E</strong>
              </div>
            </div>
            <div>
              <span className={`cyber-badge ${activeModel ? 'badge-normal' : 'badge-suspect'}`}>
                {activeModel ? `ACTIVE: ${activeModel.modelCard.model_id}` : "NO MODEL (RULES ONLY)"}
              </span>
            </div>
          </div>

          {/* Ingestion & Training Action Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            {/* Open-Meteo Real Data Ingestion (Observation Reference Only) */}
            <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--neon-cyan)', borderRadius: '6px', padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
                    <i className="fa-solid fa-cloud-arrow-down"></i> FETCH LIVE HISTORICAL CLIMATOLOGY
                  </div>
                  <span className="cyber-badge badge-normal" style={{ fontSize: '0.65rem' }}>OPEN-METEO API</span>
                </div>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Directly fetch real 7-day (168-hour) historical observations from Open-Meteo for <strong>{currentStation.name}</strong>'s exact geographic coordinates ({currentStation.lat?.toFixed(2)}°N, {currentStation.lon?.toFixed(2)}°E).
                </p>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                  <i className="fa-solid fa-circle-info"></i> Fetched Open-Meteo observations are displayed for baseline review and cannot be used as training data.
                </div>
                {apiFeedback && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--neon-green)', fontFamily: 'var(--font-mono)', background: 'rgba(0,255,102,0.08)', padding: '6px 10px', borderRadius: '4px', marginBottom: '10px' }}>
                    <i className="fa-solid fa-circle-check"></i> {apiFeedback}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  className="cyber-btn btn-sm btn-primary"
                  onClick={() => handleFetchOpenMeteoHistory(7)}
                  disabled={isFetchingApi}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <i className={`fa-solid ${isFetchingApi ? 'fa-spinner fa-spin' : 'fa-bolt'}`}></i>
                  <span>{isFetchingApi ? 'Fetching Open-Meteo...' : `Fetch Real 7-Day History (168 Obs)`}</span>
                </button>
                {openMeteoHistory.length > 0 && activeTableSource !== 'openmeteo' && (
                  <button
                    className="cyber-btn btn-sm"
                    onClick={() => setActiveTableSource('openmeteo')}
                    style={{ fontSize: '0.7rem' }}
                  >
                    <i className="fa-solid fa-eye"></i> View 7-Day History
                  </button>
                )}
              </div>
            </div>

            {/* Custom CSV / JSON Upload & Training Card */}
            <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--border-medium)', borderRadius: '6px', padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', color: 'var(--neon-green)', fontWeight: 800 }}>
                    <i className="fa-solid fa-file-arrow-up"></i> UPLOAD CUSTOM CSV / JSON DATASET
                  </div>
                  <span className="cyber-badge badge-green" style={{ fontSize: '0.65rem' }}>TRAINING SOURCE</span>
                </div>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Upload station datalogger CSV or JSON records to train a dedicated Isolation Forest model for <strong>{activeStationId}</strong>.
                </p>

                {/* File Drop & Browse Area */}
                <div style={{
                  border: `2px dashed ${!isAuthorizedForStation ? 'var(--border-subtle)' : 'var(--border-medium)'}`,
                  borderRadius: '6px',
                  padding: '14px',
                  textAlign: 'center',
                  background: 'rgba(5,8,17,0.7)',
                  cursor: !isAuthorizedForStation ? 'not-allowed' : 'pointer',
                  position: 'relative',
                  marginBottom: '12px',
                  opacity: !isAuthorizedForStation ? 0.6 : 1
                }}>
                  <input
                    type="file"
                    accept=".csv,.json"
                    onChange={handleFileUpload}
                    disabled={!isAuthorizedForStation}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: !isAuthorizedForStation ? 'not-allowed' : 'pointer' }}
                  />
                  <i className={`fa-solid ${!isAuthorizedForStation ? 'fa-lock text-amber' : uploadedDataset.length > 0 ? 'fa-cloud-arrow-up text-green' : 'fa-cloud-arrow-up'}`} style={{ fontSize: '1.4rem', marginBottom: '4px' }}></i>
                  <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.76rem', color: !isAuthorizedForStation ? 'var(--neon-amber)' : 'var(--text-primary)', fontWeight: 700 }}>
                    {!isAuthorizedForStation
                      ? (isAdmin ? "DATASET UPLOAD RESTRICTED (CENTRAL ADMIN READ-ONLY)" : `DATASET UPLOAD RESTRICTED (ASSIGNED TO ${assignedStationId})`)
                      : uploadedFileName ? `FILE: ${uploadedFileName}` : 'DRAG & DROP CSV / JSON FILE HERE OR BROWSE'}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: !isAuthorizedForStation ? 'var(--text-muted)' : uploadedDataset.length > 0 ? 'var(--neon-green)' : 'var(--text-muted)', marginTop: '2px' }}>
                    {!isAuthorizedForStation
                      ? "Only the designated Station Operator can upload training data"
                      : uploadedDataset.length > 0 ? `${uploadedDataset.length} rows parsed and ready for model training` : `Minimum 20 rows required for Isolation Forest calibration`}
                  </div>
                </div>
              </div>

              {/* Train Model Action (Bound ONLY to Uploaded Dataset) */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  className="cyber-btn btn-sm btn-green"
                  onClick={runTrainingPipeline}
                  disabled={!isAuthorizedForStation || pipelineState === 'TRAINING' || !uploadedDataset || uploadedDataset.length < 20}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: !isAuthorizedForStation ? 0.5 : 1,
                    cursor: !isAuthorizedForStation ? 'not-allowed' : 'pointer'
                  }}
                >
                  <i className={`fa-solid ${!isAuthorizedForStation ? 'fa-lock' : 'fa-brain'}`}></i>
                  <span>
                    {!isOperator
                      ? "Train Model (ACCESS DENIED — Central Admin Restricted)"
                      : !isAuthorizedForStation
                      ? `Train Model (ACCESS DENIED — Assigned to ${assignedStationId})`
                      : pipelineState === 'TRAINING'
                      ? "Training Isolation Forest..."
                      : uploadedDataset.length >= 20
                      ? `Train Model (${uploadedDataset.length} Uploaded Rows)`
                      : uploadedDataset.length > 0
                      ? `Train Model (${uploadedDataset.length}/20 Rows — Min 20 Needed)`
                      : "Train Model (Upload Dataset Required)"}
                  </span>
                </button>
                {uploadedDataset.length > 0 && activeTableSource !== 'uploaded' && (
                  <button
                    className="cyber-btn btn-sm"
                    onClick={() => setActiveTableSource('uploaded')}
                    style={{ fontSize: '0.7rem' }}
                  >
                    <i className="fa-solid fa-eye"></i> View Uploaded Rows
                  </button>
                )}
              </div>
            </div>
          </div>


          {/* 7-Step Pipeline Status Tracker */}
          {(pipelineState === 'TRAINING' || pipelineState === 'COMPLETED' || pipelineState === 'ERROR') && (
            <div style={{ background: 'rgba(5,8,17,0.9)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', color: 'var(--neon-cyan)', fontWeight: 700, marginBottom: '14px' }}>
                <i className="fa-solid fa-list-check"></i> AUTOMATED MODEL CREATION PIPELINE EXECUTION:
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                {PIPELINE_STEPS.map((step, idx) => {
                  const isDone = pipelineState === 'COMPLETED' || currentStepIndex > idx;
                  const isCurrent = pipelineState === 'TRAINING' && currentStepIndex === idx;

                  let borderColor = 'var(--border-subtle)';
                  let icon = 'fa-circle';
                  let iconColor = 'var(--text-muted)';
                  let statusText = 'Pending';

                  if (isDone) {
                    borderColor = 'var(--neon-green)';
                    icon = 'fa-check-circle';
                    iconColor = 'var(--neon-green)';
                    statusText = 'Completed';
                  } else if (isCurrent) {
                    borderColor = 'var(--neon-cyan)';
                    icon = 'fa-spinner fa-spin';
                    iconColor = 'var(--neon-cyan)';
                    statusText = 'Active';
                  }

                  return (
                    <div key={idx} style={{ background: 'rgba(10,15,29,0.7)', border: `1px solid ${borderColor}`, borderRadius: '4px', padding: '10px 8px', textAlign: 'center' }}>
                      <i className={`fa-solid ${icon}`} style={{ color: iconColor, fontSize: '1rem', marginBottom: '6px' }}></i>
                      <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>
                        {step.label}
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                        {statusText}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Success Result Certificate */}
              {pipelineState === 'COMPLETED' && trainedResult && (
                <div style={{ marginTop: '16px', background: 'rgba(0,255,102,0.06)', border: '1px solid var(--neon-green)', borderRadius: '6px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.95rem', fontWeight: 800, color: 'var(--neon-green)' }}>
                      <i className="fa-solid fa-shield-check"></i> MODEL SUCCESSFULLY CREATED & BOUND TO {trainedResult.station_id}
                    </div>
                    <div style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Model ID: <strong style={{ color: 'var(--neon-cyan)' }}>{trainedResult.model_id}</strong> | Algorithm: <strong>{trainedResult.algorithm}</strong> | Dynamic Threshold: <strong>{trainedResult.training_summary?.dynamic_threshold}</strong> | SHA-256: <code>{trainedResult.sha256}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {isOperator ? (
                      <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('station-hud')}>
                        <i className="fa-solid fa-terminal"></i> Launch {trainedResult.station_id} Cockpit HUD
                      </button>
                    ) : (
                      <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('model-governance')}>
                        <i className="fa-solid fa-brain"></i> View in Model Governance
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Error Box */}
              {pipelineState === 'ERROR' && (
                <div style={{ marginTop: '16px', background: 'rgba(255,0,85,0.08)', border: '1px solid var(--neon-crimson)', borderRadius: '6px', padding: '12px', color: 'var(--neon-crimson)', fontSize: '0.78rem' }}>
                  <i className="fa-solid fa-triangle-exclamation"></i> <strong>Training Failed:</strong> {errorMessage}
                </div>
              )}
            </div>
          )}

          {/* Dataset Preview Table */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.8rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
                <i className="fa-solid fa-table"></i>{' '}
                {activeTableSource === 'uploaded'
                  ? `UPLOADED OBSERVATION FRAMES (${uploadedDataset.length} ROWS — TRAINABLE)`
                  : activeTableSource === 'openmeteo'
                  ? `OPEN-METEO 7-DAY HISTORY (${openMeteoHistory.length} ROWS — OBSERVATION ONLY, NOT TRAINABLE)`
                  : `OBSERVATION FRAMES (0 ROWS)`}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Target Feature Vector: <code>[temp, hum, pres, wind, rain, dew_point, rate_of_change]</code>
              </div>
            </div>

            <div className="tactical-table-wrapper" style={{ maxHeight: '280px', overflowY: 'auto' }}>
              <table className="tactical-table">
                <thead>
                  <tr>
                    <th>INDEX</th>
                    <th>TIMESTAMP</th>
                    <th>TEMPERATURE (°C)</th>
                    <th>HUMIDITY (%)</th>
                    <th>PRESSURE (hPa)</th>
                    <th>WIND SPEED (km/h)</th>
                    <th>RAINFALL (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                        No observation rows loaded yet. Upload a custom CSV/JSON file to train <strong>{activeStationId}</strong>, or fetch Open-Meteo 7-day history for reference.
                      </td>
                    </tr>
                  ) : (
                    displayedRows.slice(0, 100).map((row, idx) => (
                      <tr key={idx}>
                        <td style={{ color: 'var(--text-muted)' }}>#{idx + 1}</td>
                        <td>{row.timestamp}</td>
                        <td style={{ fontWeight: 600, color: 'var(--neon-cyan)' }}>{row.temp}°C</td>
                        <td>{row.hum}%</td>
                        <td>{row.pres} hPa</td>
                        <td>{row.wind} km/h</td>
                        <td>{row.rain} mm</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

