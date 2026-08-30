import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { apiClient } from '../../utils/apiClient';
import { tacticalAudio } from '../../utils/audio';

const PIPELINE_STEPS = [
  { label: "Data Ingested", desc: "Cloud PostgreSQL telemetry verified" },
  { label: "Data Validated", desc: "Physical plausibility & sanity checks" },
  { label: "Data Preprocessed", desc: "Scrubbed -999 flags & sensor errors" },
  { label: "Features Generated", desc: "8-D vector: lags, diurnal sine/cos & dew-point" },
  { label: "Training Isolation Forest", desc: "Fitting ensemble isolation trees from scratch" },
  { label: "Model Evaluation", desc: "Calibrating dynamic threshold & contamination" },
  { label: "Model Registered", desc: "Activated in PostgreSQL model_registry" },
  { label: "Model Activated", desc: "Ready for live real-time scoring" }
];

export const StationUpload = () => {
  const { role, assignedStationId } = useAuth();
  const {
    activeStationId,
    stations,
    setActiveStationId,
    trainStationModel,
    activeStationModels,
    refreshActiveStationModel,
    setCurrentView,
    fetchHistoricalTrainingDataset
  } = useWeather();

  const isOperator = role === 'station_operator' || role === 'STATION_OPERATOR';
  const isAdmin = role === 'admin' || role === 'CENTRAL_ADMIN';
  
  // Either Central Admin or the authorized Station Operator can manage station data
  const isAuthorizedForStation = isAdmin || (isOperator && assignedStationId === activeStationId);

  const currentStation = stations.find(s => s.id === activeStationId) || stations[0] || {};
  const activeModel = activeStationModels[activeStationId];

  // Telemetry & Dataset states
  const [uploadedDataset, setUploadedDataset] = useState([]);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [openMeteoHistory, setOpenMeteoHistory] = useState([]);
  const [activeTableSource, setActiveTableSource] = useState('none'); // 'uploaded' | 'openmeteo' | 'none'
  const [dbStats, setDbStats] = useState({ total_records: 0, earliest_timestamp: null, latest_timestamp: null });
  const [trainingJobs, setTrainingJobs] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const [pipelineState, setPipelineState] = useState('IDLE'); // IDLE, TRAINING, COMPLETED, ERROR
  const [activeJobState, setActiveJobState] = useState(null);
  const [trainedResult, setTrainedResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadFeedback, setUploadFeedback] = useState(null);
  const [isFetchingApi, setIsFetchingApi] = useState(false);
  const [apiFeedback, setApiFeedback] = useState('');
  const activePollId = React.useRef(null);

  // Fetch Cloud PostgreSQL telemetry statistics and training jobs on station change
  const refreshStationStats = async (stId) => {
    try {
      const stats = await apiClient.getStationTelemetryStats(stId);
      if (stats.success) {
        setDbStats(stats);
      }
    } catch (e) {
      console.warn("[StationUpload] Could not fetch DB stats:", e.message);
    }

    try {
      const jobsRes = await apiClient.getStationTrainingJobs(stId);
      if (jobsRes && jobsRes.success) {
        const jobs = jobsRes.jobs || [];
        setTrainingJobs(jobs);
        
        // Recover running job if applicable
        const runningJob = jobs.find(j => j.status === 'RUNNING');
        if (runningJob) {
          setPipelineState('TRAINING');
          const completed = Array.isArray(runningJob.completed_stages)
            ? runningJob.completed_stages
            : (typeof runningJob.completed_stages === 'string' ? JSON.parse(runningJob.completed_stages || '[]') : []);
          setActiveJobState({
            job_id: runningJob.id,
            status: 'RUNNING',
            current_stage: runningJob.current_stage,
            completed_stages: completed
          });
          pollTrainingJob(stId, runningJob.id);
        } else if (jobs.length > 0) {
          const latestJob = jobs[0];
          if (latestJob.status === 'COMPLETED') {
            setPipelineState('COMPLETED');
            const completed = Array.isArray(latestJob.completed_stages)
              ? latestJob.completed_stages
              : (typeof latestJob.completed_stages === 'string' ? JSON.parse(latestJob.completed_stages || '[]') : []);
            setActiveJobState({
              job_id: latestJob.id,
              status: 'COMPLETED',
              current_stage: 'Model Activated',
              completed_stages: completed.length === 8 ? completed : PIPELINE_STEPS.map(s => s.label)
            });
            try {
              const activeRes = await apiClient.getStationActiveModel(stId);
              if (activeRes && activeRes.success && activeRes.has_active_model) {
                setTrainedResult(activeRes.model_card);
              }
            } catch (err) {
              console.warn("Failed to fetch active model for completed job:", err);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[StationUpload] Could not fetch training jobs:", e.message);
    }
  };

  useEffect(() => {
    if (activeStationId) {
      refreshStationStats(activeStationId);
    }
    return () => {
      activePollId.current = null;
    };
  }, [activeStationId]);

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


  const handleStationChange = (id) => {
    if (isOperator && assignedStationId && id !== assignedStationId) {
      setErrorMessage(`ACCESS DENIED: Station Operator for '${assignedStationId}' cannot switch to '${id}'.`);
      tacticalAudio.playAlarm();
      return;
    }
    activePollId.current = null;
    setActiveStationId(id);
    setUploadedDataset([]);
    setUploadedFileName('');
    setOpenMeteoHistory([]);
    setActiveTableSource('none');
    setPipelineState('IDLE');
    setActiveJobState(null);
    setTrainedResult(null);
    setErrorMessage('');
    setUploadFeedback(null);
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
      setApiFeedback(`Successfully ingested ${res.totalRows} real hourly observations from Open-Meteo API (${pastDays} days history). Displayed for reference.`);
      tacticalAudio.playSuccess();
    } catch (err) {
      setApiFeedback(`Failed to fetch from Open-Meteo: ${err.message}`);
      tacticalAudio.playAlarm();
    } finally {
      setIsFetchingApi(false);
    }
  };

  const handleFileUpload = async (e) => {
    if (!isAuthorizedForStation) {
      setErrorMessage(`ACCESS DENIED: You are not authorized to upload datasets for '${activeStationId}'.`);
      tacticalAudio.playAlarm();
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage('');
    setUploadFeedback(null);

    // 1. Read preview in browser
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') return;

        let parsedRows = [];
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          parsedRows = Array.isArray(parsed) ? parsed : (parsed.data || [parsed]);
        } else {
          // CSV Parser for UI preview
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

        // 2. Ingest to Cloud PostgreSQL via Backend API
        try {
          const uploadRes = await apiClient.uploadStationTelemetry(activeStationId, file);
          setUploadFeedback({
            success: true,
            rows_uploaded: uploadRes.rows_uploaded,
            rows_rejected: uploadRes.rows_rejected,
            warnings: uploadRes.validation_warnings || [],
            message: uploadRes.message
          });
          tacticalAudio.playSuccess();
          if (uploadRes.total_records !== undefined) {
            setDbStats(prev => ({
              ...prev,
              total_records: uploadRes.total_records
            }));
          }
          await refreshStationStats(activeStationId);
        } catch (apiErr) {
          console.warn("[StationUpload] Cloud DB upload warning:", apiErr.message);
          setUploadFeedback({
            success: false,
            message: `Cloud PostgreSQL Ingestion Notice: ${apiErr.message}. Local preview available.`
          });
          tacticalAudio.playAlarm();
        }

        setPipelineState('IDLE');
        setTrainedResult(null);
      } catch (err) {
        alert(`Error parsing file: ${err.message}`);
        tacticalAudio.playAlarm();
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const csv = `timestamp,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,rainfall_mm\n2026-08-01 00:00:00,24.2,82.0,1008.2,12.4,0.0\n2026-08-01 01:00:00,23.8,85.0,1007.9,11.2,0.0\n2026-08-01 02:00:00,23.4,88.0,1007.5,10.5,0.0\n2026-08-01 03:00:00,23.0,90.0,1007.2,9.8,0.0\n2026-08-01 04:00:00,22.6,92.0,1006.8,8.5,0.0\n2026-08-01 05:00:00,22.2,94.0,1006.5,7.2,0.0\n2026-08-01 06:00:00,23.5,88.0,1007.0,8.0,0.0\n2026-08-01 07:00:00,25.0,78.0,1007.8,9.5,0.0\n2026-08-01 08:00:00,26.8,70.0,1008.4,11.0,0.0\n2026-08-01 09:00:00,28.2,62.0,1008.9,12.5,0.0\n2026-08-01 10:00:00,29.5,55.0,1009.2,13.8,0.0\n2026-08-01 11:00:00,30.8,48.0,1009.0,14.2,0.0\n2026-08-01 12:00:00,31.5,45.0,1008.5,15.0,0.0\n2026-08-01 13:00:00,32.0,42.0,1007.9,15.5,0.0\n2026-08-01 14:00:00,31.8,44.0,1007.4,14.8,0.0\n2026-08-01 15:00:00,31.0,47.0,1007.0,14.0,0.0\n2026-08-01 16:00:00,29.8,52.0,1007.2,12.8,0.0\n2026-08-01 17:00:00,28.5,58.0,1007.5,11.5,0.0\n2026-08-01 18:00:00,27.0,65.0,1008.0,10.2,0.0\n2026-08-01 19:00:00,26.0,72.0,1008.3,9.5,0.0\n2026-08-01 20:00:00,25.2,78.0,1008.5,9.0,0.0\n2026-08-01 21:00:00,24.8,80.0,1008.6,8.8,0.0\n2026-08-01 22:00:00,24.5,82.0,1008.4,8.5,0.0\n2026-08-01 23:00:00,24.2,83.0,1008.2,8.0,0.0`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skyguard-${activeStationId}-template.csv`;
    a.click();
    tacticalAudio.playSuccess();
  };

  const pollTrainingJob = async (stationId, jobId) => {
    const currentPollId = Date.now();
    activePollId.current = currentPollId;
    
    let jobStatus = "RUNNING";
    
    while (jobStatus === "RUNNING" && activePollId.current === currentPollId) {
      try {
        const statusRes = await apiClient.getTrainingJobStatus(stationId, jobId);
        if (activePollId.current !== currentPollId) return; // Superseded by another loop or unmounted
        
        if (statusRes && (statusRes.success || statusRes.status)) {
          jobStatus = statusRes.status;
          const completed = Array.isArray(statusRes.completed_stages)
            ? statusRes.completed_stages
            : (typeof statusRes.completed_stages === 'string' ? JSON.parse(statusRes.completed_stages || '[]') : []);

          setActiveJobState({
            job_id: statusRes.job_id || jobId,
            status: jobStatus,
            current_stage: statusRes.current_stage,
            completed_stages: completed,
            progress: statusRes.progress,
            error_message: statusRes.error_message
          });

          if (jobStatus === "COMPLETED") {
            setPipelineState('COMPLETED');
            tacticalAudio.playSuccess();

            try {
              const activeRes = await apiClient.getStationActiveModel(stationId);
              if (activeRes && activeRes.success && activeRes.has_active_model) {
                setTrainedResult(activeRes.model_card);
              }
            } catch (err) {
              console.warn("Failed to fetch active model for completed job:", err);
            }

            await refreshStationStats(stationId);
            if (refreshActiveStationModel) {
              await refreshActiveStationModel(stationId);
            }
            break; // Stop polling on backend completion
          }

          if (jobStatus === "FAILED") {
            setPipelineState('ERROR');
            setErrorMessage(statusRes.error_message || "Training job failed on backend.");
            tacticalAudio.playAlarm();
            break; // Stop polling on backend failure
          }
        }
      } catch (e) {
        console.warn("[StationUpload] Polling error:", e.message);
      }
      
      if (jobStatus === "RUNNING" && activePollId.current === currentPollId) {
        await new Promise(r => setTimeout(r, 600));
      }
    }
  };

  const runTrainingPipeline = async () => {
    if (!isAuthorizedForStation) {
      setErrorMessage(`ACCESS DENIED: You are not authorized to trigger model training for '${activeStationId}'.`);
      setPipelineState('ERROR');
      tacticalAudio.playAlarm();
      return;
    }

    const availableRecords = Math.max(dbStats.total_records || 0, uploadedDataset.length);
    if (availableRecords < 20) {
      setErrorMessage(`Insufficient historical telemetry records for ${activeStationId}. Found ${availableRecords} records; minimum 20 required.`);
      setPipelineState('ERROR');
      tacticalAudio.playAlarm();
      return;
    }

    setPipelineState('TRAINING');
    setErrorMessage('');
    // Initialize state properly, don't wipe immediately if already rendering
    setActiveJobState(prev => ({ status: "RUNNING", current_stage: "Data Ingested", completed_stages: [] }));

    try {
      // Call Backend API directly to start the background training job
      const res = await apiClient.trainStationModel(activeStationId);
      
      if (!res || !res.success || !res.job_id) {
         throw new Error(res?.error || "Failed to start training job on backend.");
      }
      
      pollTrainingJob(activeStationId, res.job_id);
    } catch (err) {
      setErrorMessage(err.message || "Training pipeline execution failed.");
      setPipelineState('ERROR');
      tacticalAudio.playAlarm();
    }
  };

  const displayedRows = activeTableSource === 'uploaded'
    ? uploadedDataset
    : activeTableSource === 'openmeteo'
    ? openMeteoHistory
    : [];

  const availableHistoricalCount = Math.max(dbStats.total_records || 0, uploadedDataset.length);

  return (
    <>
      <div className="cyber-card">
        <div className="cyber-card-header">
          <div className="cyber-card-title">
            <i className="fa-solid fa-microchip text-cyan"></i> STATION-ADAPTIVE ML TRAINING STUDIO & CLOUD PIPELINE
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
            <button className="cyber-btn btn-sm" onClick={() => setShowHistory(!showHistory)}>
              <i className="fa-solid fa-clock-rotate-left"></i> {showHistory ? "Hide Jobs" : "Training History"}
            </button>
          </div>
        </div>

        <div className="cyber-card-body">
          {/* Station Overview & PostgreSQL Telemetry Status Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '14px' }}>
            <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 14px' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <i className="fa-solid fa-satellite-dish text-cyan"></i> Station
              </div>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1rem', color: 'var(--neon-cyan)', fontWeight: 800, marginTop: '2px' }}>
                {activeStationId}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                {currentStation.name || activeStationId}
              </div>
            </div>

            <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 14px' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <i className="fa-solid fa-database text-green"></i> Cloud Records
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', color: 'var(--neon-green)', fontWeight: 800, marginTop: '2px' }}>
                {(dbStats.total_records || 0).toLocaleString()}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                {dbStats.latest_timestamp ? `Synced: ${new Date(dbStats.latest_timestamp).toLocaleDateString()}` : "PostgreSQL"}
              </div>
            </div>

            <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 14px' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <i className="fa-solid fa-brain text-purple"></i> Active Model
              </div>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.9rem', color: (activeModel || (pipelineState === 'COMPLETED' && trainedResult)) ? 'var(--neon-green)' : 'var(--neon-amber)', fontWeight: 800, marginTop: '2px' }}>
                {activeModel
                  ? `MODEL ${activeModel.modelCard?.version || activeModel.modelCard?.model_version || activeModel.modelCard?.model_id?.split('_').pop() || 'v1.0'}`
                  : (pipelineState === 'COMPLETED' && trainedResult)
                  ? `MODEL ${trainedResult.version || trainedResult.model_version || 'v1.0'}`
                  : "NOT TRAINED"}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                {(activeModel || (pipelineState === 'COMPLETED' && trainedResult)) ? "Active" : "Physical QC Active"}
              </div>
            </div>

            <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '10px 14px' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <i className="fa-solid fa-sliders text-amber"></i> Training Status
              </div>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1rem', color: pipelineState === 'COMPLETED' ? 'var(--neon-green)' : pipelineState === 'TRAINING' ? 'var(--neon-cyan)' : pipelineState === 'ERROR' ? 'var(--neon-crimson)' : 'var(--text-primary)', fontWeight: 800, marginTop: '2px' }}>
                {pipelineState === 'TRAINING' ? 'TRAINING...' : pipelineState === 'COMPLETED' ? 'COMPLETED' : pipelineState === 'ERROR' ? 'FAILED' : availableHistoricalCount >= 20 ? 'READY' : 'DATA NEEDED'}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                8-D Isolation Forest
              </div>
            </div>
          </div>

          {/* Ingestion & Training Action Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px', marginBottom: '14px' }}>
            
            {/* Primary Action Card: Ingest & Train */}
            <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--border-medium)', borderRadius: '6px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', color: 'var(--neon-green)', fontWeight: 800 }}>
                    <i className="fa-solid fa-file-arrow-up"></i> UPLOAD HISTORICAL TELEMETRY
                  </div>
                  <span className="cyber-badge badge-green" style={{ fontSize: '0.62rem' }}>POSTGRESQL</span>
                </div>

                {/* File Drop & Browse Area */}
                <div style={{
                  border: `2px dashed ${!isAuthorizedForStation ? 'var(--border-subtle)' : 'var(--border-medium)'}`,
                  borderRadius: '6px',
                  padding: '12px',
                  textAlign: 'center',
                  background: 'rgba(5,8,17,0.7)',
                  cursor: !isAuthorizedForStation ? 'not-allowed' : 'pointer',
                  position: 'relative',
                  marginBottom: '10px',
                  opacity: !isAuthorizedForStation ? 0.6 : 1
                }}>
                  <input
                    type="file"
                    accept=".csv,.json"
                    onChange={handleFileUpload}
                    disabled={!isAuthorizedForStation}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: !isAuthorizedForStation ? 'not-allowed' : 'pointer' }}
                  />
                  <i className={`fa-solid ${!isAuthorizedForStation ? 'fa-lock text-amber' : uploadedDataset.length > 0 ? 'fa-cloud-arrow-up text-green' : 'fa-cloud-arrow-up'}`} style={{ fontSize: '1.3rem', marginBottom: '4px' }}></i>
                  <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.74rem', color: !isAuthorizedForStation ? 'var(--neon-amber)' : 'var(--text-primary)', fontWeight: 700 }}>
                    {!isAuthorizedForStation
                      ? `RESTRICTED (ASSIGNED TO ${assignedStationId})`
                      : uploadedFileName ? `FILE: ${uploadedFileName}` : 'SELECT OR DROP CSV / JSON FILE'}
                  </div>
                  <div style={{ fontSize: '0.66rem', color: !isAuthorizedForStation ? 'var(--text-muted)' : uploadedDataset.length > 0 ? 'var(--neon-green)' : 'var(--text-muted)', marginTop: '2px' }}>
                    {uploadedDataset.length > 0 ? `${uploadedDataset.length} rows loaded` : `Requires: timestamp, temperature, humidity, pressure, wind`}
                  </div>
                </div>

                {uploadFeedback && (
                  <div style={{
                    fontSize: '0.7rem',
                    fontFamily: 'var(--font-mono)',
                    background: uploadFeedback.success ? 'rgba(0,255,102,0.08)' : 'rgba(255,0,85,0.08)',
                    border: `1px solid ${uploadFeedback.success ? 'var(--neon-green)' : 'var(--neon-crimson)'}`,
                    color: uploadFeedback.success ? 'var(--neon-green)' : 'var(--neon-crimson)',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    marginBottom: '10px'
                  }}>
                    <i className={`fa-solid ${uploadFeedback.success ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i> {uploadFeedback.message}
                  </div>
                )}
              </div>

              {/* Primary Action Button */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  className="cyber-btn btn-sm btn-green"
                  onClick={runTrainingPipeline}
                  disabled={!isAuthorizedForStation || pipelineState === 'TRAINING' || availableHistoricalCount < 20}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: !isAuthorizedForStation ? 0.5 : 1,
                    cursor: !isAuthorizedForStation ? 'not-allowed' : 'pointer'
                  }}
                >
                  <i className={`fa-solid ${pipelineState === 'TRAINING' ? 'fa-spinner fa-spin' : 'fa-brain'}`}></i>
                  <span>
                    {pipelineState === 'TRAINING'
                      ? "Training Isolation Forest..."
                      : `Train Model (${availableHistoricalCount.toLocaleString()} Records)`}
                  </span>
                </button>
                {uploadedDataset.length > 0 && activeTableSource !== 'uploaded' && (
                  <button
                    className="cyber-btn btn-sm"
                    onClick={() => setActiveTableSource('uploaded')}
                    style={{ fontSize: '0.7rem' }}
                  >
                    <i className="fa-solid fa-eye"></i> View Rows
                  </button>
                )}
              </div>
            </div>

            {/* Secondary Action Card: Climatology Baseline */}
            <div style={{ background: 'rgba(10,15,29,0.8)', border: '1px solid var(--neon-cyan)', borderRadius: '6px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
                    <i className="fa-solid fa-cloud-arrow-down"></i> CLIMATOLOGY BASELINE
                  </div>
                  <span className="cyber-badge badge-normal" style={{ fontSize: '0.62rem' }}>OPEN-METEO API</span>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Fetch 7-day hourly observations for <strong>{currentStation.name}</strong> ({currentStation.lat?.toFixed(2)}°N, {currentStation.lon?.toFixed(2)}°E) for microclimate reference.
                </p>
                {apiFeedback && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--neon-green)', fontFamily: 'var(--font-mono)', background: 'rgba(0,255,102,0.08)', padding: '6px 10px', borderRadius: '4px', marginBottom: '10px' }}>
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
                  <span>{isFetchingApi ? 'Fetching...' : 'Fetch 7-Day Baseline (168 Obs)'}</span>
                </button>
                {openMeteoHistory.length > 0 && activeTableSource !== 'openmeteo' && (
                  <button
                    className="cyber-btn btn-sm"
                    onClick={() => setActiveTableSource('openmeteo')}
                    style={{ fontSize: '0.7rem' }}
                  >
                    <i className="fa-solid fa-eye"></i> View Baseline
                  </button>
                )}
              </div>
            </div>
          </div>


          {/* 7-Step Pipeline Status Tracker */}
          {(pipelineState === 'TRAINING' || pipelineState === 'COMPLETED' || pipelineState === 'ERROR') && (
            <div style={{ background: 'rgba(5,8,17,0.9)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', color: 'var(--neon-cyan)', fontWeight: 700, marginBottom: '14px' }}>
                <i className="fa-solid fa-list-check"></i> STATION-ADAPTIVE TRAINING PIPELINE EXECUTION ({activeStationId}):
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                {PIPELINE_STEPS.map((step, idx) => {
                  const completedStages = activeJobState?.completed_stages || [];
                  const isDone = completedStages.includes(step.label);
                  const isCurrent = activeJobState?.status === 'RUNNING' && activeJobState?.current_stage === step.label;

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

                  if (activeJobState?.status === 'FAILED' && activeJobState?.current_stage === step.label && !isDone) {
                     borderColor = 'var(--neon-crimson)';
                     icon = 'fa-triangle-exclamation';
                     iconColor = 'var(--neon-crimson)';
                     statusText = 'Failed';
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
                      <i className="fa-solid fa-shield-check"></i> SUCCESS — {trainedResult.station_id} MODEL {trainedResult.version || "ACTIVE"} TRAINED & ACTIVATED
                    </div>
                    <div style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {trainedResult.training_summary?.valid_records || availableHistoricalCount} historical records processed | 8 features generated | Dynamic Threshold: <strong style={{ color: 'var(--neon-cyan)' }}>{trainedResult.training_summary?.dynamic_threshold || trainedResult.threshold}</strong> | Model ID: <strong style={{ color: 'var(--neon-cyan)' }}>{trainedResult.model_id}</strong>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('station-hud')}>
                      <i className="fa-solid fa-terminal"></i> Cockpit HUD
                    </button>
                    <button className="cyber-btn btn-sm" onClick={() => setCurrentView('model-governance')}>
                      <i className="fa-solid fa-brain"></i> Model Registry
                    </button>
                  </div>
                </div>
              )}

              {/* Error Box */}
              {pipelineState === 'ERROR' && (
                <div style={{ marginTop: '16px', background: 'rgba(255,0,85,0.08)', border: '1px solid var(--neon-crimson)', borderRadius: '6px', padding: '12px', color: 'var(--neon-crimson)', fontSize: '0.78rem' }}>
                  <i className="fa-solid fa-triangle-exclamation"></i> <strong>Training Execution Blocked:</strong> {errorMessage}
                </div>
              )}
            </div>
          )}

          {/* Historical Training Jobs Audit Table */}
          {showHistory && (
            <div style={{ marginBottom: '16px', background: 'rgba(5,8,17,0.85)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '14px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.8rem', color: 'var(--neon-purple)', fontWeight: 800, marginBottom: '10px' }}>
                <i className="fa-solid fa-clock-rotate-left"></i> TRAINING AUDIT LEDGER FOR {activeStationId}
              </div>
              <div className="tactical-table-wrapper" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                <table className="tactical-table">
                  <thead>
                    <tr>
                      <th>JOB ID</th>
                      <th>VERSION</th>
                      <th>STATUS</th>
                      <th>ROWS USED</th>
                      <th>STARTED</th>
                      <th>COMPLETED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trainingJobs.length === 0 ? (
                      <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No training jobs recorded yet for {activeStationId}.</td></tr>
                    ) : (
                      trainingJobs.map(job => (
                        <tr key={job.id}>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--neon-cyan)' }}>#{job.id}</td>
                          <td>{job.model_version || "v1.0"}</td>
                          <td>
                            <span className={`cyber-badge ${job.status === 'COMPLETED' ? 'badge-normal' : job.status === 'RUNNING' ? 'badge-suspect' : 'badge-critical'}`}>
                              {job.status}
                            </span>
                          </td>
                          <td>{job.rows_used || 0}</td>
                          <td style={{ fontSize: '0.7rem' }}>{job.started_at ? new Date(job.started_at).toLocaleTimeString() : "-"}</td>
                          <td style={{ fontSize: '0.7rem' }}>{job.completed_at ? new Date(job.completed_at).toLocaleTimeString() : "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dataset Preview Table */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.8rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
                <i className="fa-solid fa-table"></i>{' '}
                {activeTableSource === 'uploaded'
                  ? `UPLOADED OBSERVATION FRAMES (${uploadedDataset.length} ROWS — INGESTED)`
                  : activeTableSource === 'openmeteo'
                  ? `OPEN-METEO 7-DAY HISTORY (${openMeteoHistory.length} ROWS — CLIMATOLOGY BASELINE)`
                  : `CLOUD POSTGRESQL TELEMETRY REPOSITORY (${(dbStats.total_records || 0).toLocaleString()} RECORDS AVAILABLE)`}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Target Feature Vector (8-D): <code>[temp, hum, pres, wind, lag_diff, sin_hr, cos_hr, dew_pt]</code>
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
                      <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>
                        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.85rem', color: 'var(--neon-cyan)', marginBottom: '4px' }}>
                          No telemetry data
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          Upload historical data to begin.
                        </div>
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
