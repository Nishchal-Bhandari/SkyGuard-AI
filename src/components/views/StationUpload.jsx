import React, { useState } from 'react';
import { useWeather } from '../../context/WeatherContext';
import { BENCHMARK_HISTORICAL_DATA } from '../../utils/seedData';
import { tacticalAudio } from '../../utils/audio';

export const StationUpload = () => {
  const { activeStationId, stations, setActiveStationId, trainStationModel, activeStationModels, setCurrentView } = useWeather();
  const currentStation = stations.find(s => s.id === activeStationId) || stations[0] || {};
  const activeModel = activeStationModels[activeStationId];

  // Default dataset initialized from benchmark or custom rows
  const [datasetRows, setDatasetRows] = useState(() => {
    return BENCHMARK_HISTORICAL_DATA[activeStationId] || BENCHMARK_HISTORICAL_DATA["AWS-07"] || [];
  });

  const [pipelineState, setPipelineState] = useState('IDLE'); // IDLE, TRAINING, COMPLETED, ERROR
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [trainedResult, setTrainedResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

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
    setActiveStationId(id);
    setDatasetRows(BENCHMARK_HISTORICAL_DATA[id] || BENCHMARK_HISTORICAL_DATA["AWS-07"] || []);
    setPipelineState('IDLE');
    setTrainedResult(null);
    tacticalAudio.playClick();
  };

  const handleLoadBenchmark = () => {
    const data = BENCHMARK_HISTORICAL_DATA[activeStationId] || BENCHMARK_HISTORICAL_DATA["AWS-07"];
    setDatasetRows([...data]);
    setPipelineState('IDLE');
    setTrainedResult(null);
    tacticalAudio.playSuccess();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') return;

        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          const rows = Array.isArray(parsed) ? parsed : (parsed.data || [parsed]);
          setDatasetRows(rows);
        } else {
          // CSV Parser
          const lines = text.trim().split('\n');
          if (lines.length < 2) throw new Error("CSV file must have a header and at least 1 data row.");
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          
          const parsedRows = [];
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
          setDatasetRows(parsedRows);
        }

        tacticalAudio.playSuccess();
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
    if (datasetRows.length < 20) {
      setErrorMessage(`Insufficient historical records for ${activeStationId}. Found ${datasetRows.length} rows; minimum 20 required.`);
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
    const res = await trainStationModel(activeStationId, datasetRows, versionNum);

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
              style={{ background: '#050811', padding: '4px 8px', fontSize: '0.78rem' }}
            >
              {stations.map(st => (
                <option key={st.id} value={st.id}>{st.id} - {st.name}</option>
              ))}
            </select>
            <button className="cyber-btn btn-sm" onClick={handleDownloadTemplate}>
              <i className="fa-solid fa-file-csv"></i> CSV Template
            </button>
          </div>
        </div>

        <div className="cyber-card-body">
          {/* Architecture Banner */}
          <div style={{ background: 'rgba(0,240,255,0.05)', border: '1px solid rgba(0,240,255,0.2)', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.85rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
                <i className="fa-solid fa-layer-group"></i> ZERO GLOBAL MODELS — 100% STATION-SPECIFIC CALIBRATION
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Currently configuring: <strong>{currentStation.name} ({activeStationId})</strong> | Region: <strong>{currentStation.region}</strong> | Elevation: <strong>{currentStation.elevation || 500}m</strong>
              </div>
            </div>
            <div>
              <span className={`cyber-badge ${activeModel ? 'badge-normal' : 'badge-suspect'}`}>
                {activeModel ? `ACTIVE: ${activeModel.modelCard.model_id}` : "NO MODEL (RULES ONLY)"}
              </span>
            </div>
          </div>

          {/* Upload and Ingestion Action Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            {/* File Drop Area */}
            <div style={{ border: '2px dashed var(--border-medium)', borderRadius: '6px', padding: '24px 20px', textAlign: 'center', background: 'rgba(5,8,17,0.7)', cursor: 'pointer', position: 'relative' }}>
              <input
                type="file"
                accept=".csv,.json"
                onChange={handleFileUpload}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
              />
              <i className="fa-solid fa-cloud-arrow-up" style={{ fontSize: '2rem', color: 'var(--neon-cyan)', marginBottom: '8px' }}></i>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                DROP HISTORICAL CSV / JSON LOGS HERE
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Upload datalogger observations to train {activeStationId}'s dedicated model
              </div>
            </div>

            {/* Quick Benchmark Loader */}
            <div style={{ background: 'rgba(10,15,29,0.6)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.8rem', color: 'var(--neon-green)', fontWeight: 700, marginBottom: '6px' }}>
                  <i className="fa-solid fa-database"></i> LOAD BENCHMARK CLIMATOLOGY
                </div>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Load real pre-screened microclimate observations ({datasetRows.length} frames ready) specifically calibrated for <strong>{currentStation.region}</strong> terrain.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button className="cyber-btn btn-sm btn-green" onClick={handleLoadBenchmark}>
                  <i className="fa-solid fa-bolt"></i> Reload {activeStationId} Benchmark
                </button>
                <button
                  className="cyber-btn btn-sm btn-primary"
                  onClick={runTrainingPipeline}
                  disabled={pipelineState === 'TRAINING'}
                >
                  <i className="fa-solid fa-brain"></i> {pipelineState === 'TRAINING' ? "Training in Progress..." : `Train Model for ${activeStationId}`}
                </button>
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
                  const isPending = pipelineState === 'TRAINING' && currentStepIndex < idx;

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
                    <button className="cyber-btn btn-sm btn-primary" onClick={() => setCurrentView('station-hud')}>
                      <i className="fa-solid fa-gauge-high"></i> View in Station HUD
                    </button>
                    <button className="cyber-btn btn-sm" onClick={() => setCurrentView('model-governance')}>
                      <i className="fa-solid fa-brain"></i> Model Governance
                    </button>
                  </div>
                </div>
              )}

              {pipelineState === 'ERROR' && (
                <div style={{ marginTop: '14px', background: 'rgba(255,0,85,0.1)', border: '1px solid var(--neon-red)', borderRadius: '6px', padding: '12px', color: 'var(--neon-red)', fontSize: '0.75rem' }}>
                  <i className="fa-solid fa-triangle-exclamation"></i> {errorMessage}
                </div>
              )}
            </div>
          )}

          {/* Parsed Batch Data Preview */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.78rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
              LOADED OBSERVATIONS FOR CALIBRATION ({datasetRows.length} ROWS):
            </div>
            <span className="cyber-badge badge-normal">
              {datasetRows.length >= 20 ? `${datasetRows.length} RECORDS READY` : "INSUFFICIENT DATA (< 20 ROWS)"}
            </span>
          </div>

          <div className="tactical-table-wrapper" style={{ maxHeight: '250px' }}>
            <table className="tactical-table">
              <thead>
                <tr>
                  <th>TIMESTAMP</th>
                  <th>TEMPERATURE</th>
                  <th>HUMIDITY</th>
                  <th>PRESSURE</th>
                  <th>WIND SPEED</th>
                  <th>RAINFALL</th>
                  <th>PRE-SCREEN QC</th>
                </tr>
              </thead>
              <tbody>
                {datasetRows.slice(0, 15).map((r, idx) => {
                  const isOut = (r.temp < -30 || r.temp > 60 || r.hum < 0 || r.hum > 100);
                  return (
                    <tr key={idx}>
                      <td>{r.timestamp}</td>
                      <td style={{ color: isOut ? 'var(--neon-red)' : 'inherit' }}>{r.temp}°C</td>
                      <td style={{ color: isOut ? 'var(--neon-red)' : 'inherit' }}>{r.hum}%</td>
                      <td>{r.pres} hPa</td>
                      <td>{r.wind ?? 10} km/h</td>
                      <td>{r.rain ?? 0} mm</td>
                      <td>
                        <span className={`cyber-badge ${isOut ? 'badge-critical' : 'badge-normal'}`}>
                          {isOut ? "OUT OF BOUNDS (SCRUBBED)" : "NOMINAL"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {datasetRows.length > 15 && (
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '6px' }}>
              Showing first 15 of {datasetRows.length} historical records. All valid rows will be fed to feature engineering.
            </div>
          )}
        </div>
      </div>
    </>
  );
};
