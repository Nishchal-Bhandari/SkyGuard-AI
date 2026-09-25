# SkyGuard-AI — Full Project Progress Report

> Generated: September 16, 2026 | Version 2.1.0
> Frontend: http://localhost:5173 | Backend: http://localhost:8000

---

## 1. What is SkyGuard-AI?

SkyGuard-AI is a **Tactical Automatic Weather Station (AWS) Monitoring and ML Governance Platform**. It monitors a fleet of IoT weather stations (temperature, humidity, pressure, wind, rainfall) in real time, detects sensor anomalies using a per-station trained Isolation Forest ML model, performs spatial cross-validation with neighboring stations, and raises incident alerts for operator triage.

**Core principle**: Every station gets its own dedicated ML model — "Zero Universal Models". No shared models between stations.

**Real-world context**: Modelled after India's IMD AWS networks, specifically the Dakshina Kannada / Karnataka coastal belt region.

---

## 2. Tech Stack

### Backend
| Component | Technology |
|-----------|-----------|
| Web Framework | FastAPI 0.110+ |
| ASGI Server | Uvicorn (with hot-reload) |
| Database (local dev) | SQLite 3 (WAL mode) |
| Database (production) | PostgreSQL / TimescaleDB (via DATABASE_URL env var) |
| Auth Tokens | Custom HMAC-SHA256 signed JWT (no PyJWT library) |
| Password Hashing | PBKDF2-HMAC-SHA256, 100,000 iterations |
| HTTP Client | httpx (async) |
| ML Engine | Pure Python (zero external ML dependencies) |
| Weather API | Open-Meteo (free, no API key) |

### Frontend
| Component | Technology |
|-----------|-----------|
| Framework | React 18.3 |
| Build Tool | Vite 6 |
| Map Library | Leaflet 1.9 (ESRI Dark Gray Canvas tiles) |
| Charts | Chart.js 4.4 |
| Styling | Pure vanilla CSS (cyberpunk dark theme) |
| Icons | Font Awesome 6 (CDN) |
| Fonts | Google Fonts (Orbitron, Share Tech Mono) |
| State Management | React Context API (AuthContext + WeatherContext) |

> **Zero ML libraries** — no scikit-learn, numpy, or pandas. The entire Isolation Forest is hand-coded in pure Python.

---

## 3. Project Structure

```
SkyGuard-AI/
+-- backend/app/
|   +-- main.py                  <- FastAPI entry + DB init + weather poller
|   +-- config.py                <- DB URL, secret key, token expiry
|   +-- api/v1/
|   |   +-- auth.py              <- Login + JWT RBAC guards
|   |   +-- stations.py          <- Station CRUD + QC fetch
|   |   +-- telemetry.py         <- CSV/JSON upload + fleet live state
|   |   +-- models.py            <- ML training, job polling, rollback, scoring
|   |   +-- faults.py            <- Fault injection + reset
|   |   +-- incidents.py         <- Incident CRUD + adjudication
|   +-- auth/security.py         <- PBKDF2 hashing + HMAC JWT
|   +-- services/
|   |   +-- training_service.py  <- 8-stage training lifecycle orchestrator
|   |   +-- weather_service.py   <- Async Open-Meteo poller + ML evaluation
|   |   +-- model_storage.py     <- JSON artifact persistence
|   +-- storage/database.py      <- All SQL (SQLite + PostgreSQL dual-mode, 64KB)
+-- ml/
|   +-- station_adaptive_pipeline.py <- Core Isolation Forest
|   +-- thermo_engine.py             <- WMO thermodynamic physics validator
|   +-- shap_engine.py               <- TreeSHAP explainability
|   +-- spatial_engine.py            <- Haversine + MAD spatial consensus
|   +-- imputation_engine.py         <- IDW self-healing data reconstruction
|   +-- sensor_health.py             <- SHI + RUL predictive maintenance
|   +-- root_cause_classifier.py     <- 8-class root-cause taxonomy
|   +-- models/                      <- Persisted per-station model JSON artifacts
+-- src/
|   +-- main.jsx                 <- React entry + ErrorBoundary
|   +-- App.jsx                  <- Route switcher (13 views)
|   +-- context/
|   |   +-- AuthContext.jsx      <- Session, RBAC, station credentials
|   |   +-- WeatherContext.jsx   <- Fleet state, incidents, models, QC
|   +-- components/
|   |   +-- auth/LoginScreen.jsx     <- Dual-role login form
|   |   +-- layout/Sidebar.jsx       <- Role-adaptive navigation
|   |   +-- layout/Topbar.jsx        <- Live clock + status strip
|   |   +-- views/ (13 views)        <- All main application pages
|   |   +-- modals/ (3 modals)       <- Dialogs for credentials, incidents, editing
|   +-- utils/
|   |   +-- apiClient.js         <- HTTP client for all 20+ backend endpoints
|   |   +-- mlEngine.js          <- In-browser Isolation Forest mirror
|   |   +-- qcEngine.js          <- Frontend QC rule evaluator
|   |   +-- spatialEngine.js     <- Frontend Haversine + spatial consensus
|   |   +-- openMeteoService.js  <- Frontend Open-Meteo API caller
|   |   +-- audio.js             <- Tactical sound feedback (Web Audio API)
|   |   +-- seedData.js          <- Default QC config, checklists, model registry seeds
|   +-- styles/
|       +-- cyberpunk-theme.css  <- CSS variables, dark theme, neon colors (10KB)
|       +-- dashboard.css        <- Card layouts, grids, tables (13KB)
|       +-- components.css       <- Buttons, badges, modals, sidebar (10KB)
|       +-- login.css            <- Login screen animations (8KB)
```

---

## 4. User Roles and Access Control

Two roles exist. Role is baked into the JWT token at login time and cannot be changed without re-authentication.

### Role 1: Central Admin
Default credentials: `admin` / `sentinel2026`

| Capability | Status |
|-----------|--------|
| View entire fleet (Command Center) | WORKING |
| View fleet radar map with all stations | WORKING |
| Provision new weather stations | WORKING |
| Edit station details (name, coords, region) | WORKING |
| Activate / deactivate station accounts | WORKING |
| Reset station operator passwords | WORKING |
| View all stations credentials (masked) | WORKING |
| Configure QC physics rules per station | WORKING |
| Inject synthetic faults on any station | WORKING |
| View and adjudicate incidents (all stations) | WORKING |
| Train ML model for any station | WORKING |
| Rollback ML model version (any station) | WORKING |
| Download model cards (JSON) | WORKING |
| Export fleet telemetry data (JSON) | WORKING |

### Role 2: Station Operator
Default credentials: station `username` / `sentinel2026`

| Capability | Status |
|-----------|--------|
| Login with station username or station ID | WORKING |
| View own station Live Cockpit HUD only | WORKING |
| Upload historical telemetry for own station | WORKING |
| Train ML model for own station only | WORKING |
| View hardware telemetry / diagnostics | WORKING |
| View maintenance checklist | WORKING |
| View incidents for own station only | WORKING |
| Adjudicate own stations incidents | WORKING |
| View QC rules for own station | WORKING |
| Inspect nearby peer stations (read-only) | WORKING |
| Edge buffer / offline mode | WORKING |
| BLOCKED: Access other stations data | ENFORCED |
| BLOCKED: Access admin panels | ENFORCED |

### RBAC Enforcement
- JWT token embeds `role` and `station_id`
- Frontend sidebar renders different navigation menus per role
- Backend uses `require_admin` / `get_current_user` dependency guards
- Any cross-station access attempt returns HTTP 403 Forbidden

---

## 5. Authentication System

### What is Built
- Dual-role login screen with tabs for Central Admin and Station Operator
- `POST /api/v1/auth/admin/login` — Admin login endpoint
- `POST /api/v1/auth/station/login` — Station operator login (accepts username OR station_id)
- `GET /api/v1/auth/me` — Session verification endpoint
- Token stored in localStorage key `skyguard_auth_v3`
- Auth Audit Log table in SQLite (`auth_audit_logs`) — logs every login attempt
- Custom HMAC-SHA256 JWT: no PyJWT library. Format: header.payload.signature
- PBKDF2-HMAC-SHA256: 100,000 iterations per password hash, 16-byte random salt
- Token expiry: 24 hours (configurable via ACCESS_TOKEN_EXPIRE_MINUTES env var)
- `last_login` timestamp updated on every successful authentication
- Error boundary in main.jsx — catches React crashes with "Clear Cache and Reload" button

### Security Notes
- Password hashes use constant-time comparison (`hmac.compare_digest`) to prevent timing attacks
- CORS is fully open (`allow_origins=["*"]`) — appropriate for local dev, needs tightening for production
- Access key (plaintext) stored alongside hash in DB — used to display password in credentials panel
- Deactivated stations get HTTP 403 even with correct password

---

## 6. Backend API — Every Endpoint

All endpoints under `/api/v1/`. FastAPI auto-docs: http://localhost:8000/docs

### Health Check
| Method | Endpoint | Auth |
|--------|---------|------|
| GET | /api/v1/health | None |

### Authentication
| Method | Endpoint | Auth |
|--------|---------|------|
| POST | /auth/admin/login | None |
| POST | /auth/station/login | None |
| GET | /auth/me | Bearer |

### Station Management
| Method | Endpoint | Auth | Notes |
|--------|---------|------|-------|
| GET | /admin/stations | Admin | List all stations |
| POST | /admin/stations | Admin | Create new station |
| POST | /admin/stations/batch-presets | Admin | Bulk provision preset stations |
| GET | /stations/{id} | Optional | Get station profile |
| PUT | /admin/stations/{id} | Admin | Edit station metadata |
| PATCH | /admin/stations/{id}/status | Admin | Activate/deactivate |
| POST | /admin/stations/{id}/reset-password | Admin | Change passphrase |
| GET | /stations/{id}/qc | Bearer | Fetch QC calibration config |

### Telemetry
| Method | Endpoint | Auth | Notes |
|--------|---------|------|-------|
| POST | /stations/{id}/telemetry/upload | Bearer | CSV/JSON file upload |
| GET | /stations/{id}/telemetry/stats | Optional | Total records, date range |
| GET | /stations/fleet/live | Optional | Real-time fleet state |

### MLOps
| Method | Endpoint | Auth | Notes |
|--------|---------|------|-------|
| POST | /stations/{id}/train | Bearer | Start 8-stage training job |
| GET | /stations/{id}/training-jobs/{job_id}/status | Optional | Poll training progress |
| GET | /stations/{id}/training-jobs | Optional | Full training job history |
| GET | /stations/{id}/models | Optional | All model versions |
| GET | /stations/{id}/models/active | Optional | Active model card |
| POST | /stations/{id}/models/{version}/rollback | Admin only | Rollback model version |
| POST | /stations/{id}/score | Bearer | Real-time anomaly score |

### Fault Injection
| Method | Endpoint | Auth |
|--------|---------|------|
| POST | /stations/{id}/faults/inject | Bearer |
| POST | /stations/{id}/faults/reset | Bearer |
| GET | /stations/{id}/faults | Bearer |

### Incidents
| Method | Endpoint | Auth |
|--------|---------|------|
| GET | /incidents | Optional |
| GET | /incidents/{id} | Optional |
| POST | /incidents/{id}/adjudicate | Bearer |
| DELETE | /incidents | Optional |

---

## 7. Database Layer

File: `backend/app/storage/database.py` (64KB — largest single file in the project)

### SQLite Tables (auto-created on first run)

| Table | Purpose |
|-------|---------|
| admins | Admin accounts |
| stations | Weather station accounts (station_id, username, password_hash, access_key, lat, lon, elevation, region, status) |
| telemetry | Uploaded historical records (station_id, timestamp, temp, hum, pres, wind, rain, battery, signal, qc_flag) |
| model_registry | Trained model versions (station_id, model_version, status, model_location, trained_at) |
| training_jobs | Training job audit log (station_id, model_version, status, current_stage, completed_stages) |
| incidents | Anomaly incident queue (id, station_id, severity, quality_state, evidence_data, status, disposition) |
| active_faults | Live fault injections (station_id, fault_type, offset_val, injected_at) |
| station_qc_config | Calibrated QC envelopes (station_id, temp_min/max, hum_min/max, pres_min/max, etc.) |
| auth_audit_logs | Login/event audit trail |

### Key DB Functions
- `init_db()` — Schema creation + default admin seed on first run
- `insert_telemetry_batch()` — Bulk insert with deduplication on (station_id, timestamp, grid_point)
- `fetch_historical_telemetry()` — Pulls training data for a station
- `create_training_job()` / `update_training_job_stage()` — Training lifecycle tracking
- `register_trained_model()` / `get_active_model_record()` — Model registry management
- `calibrate_station_qc()` — Auto-computes QC envelopes from historical telemetry stats
- `create_or_update_incident()` — Upsert incident records (idempotent)
- `adjudicate_incident()` — Updates status + disposition + operator name

---

## 8. ML / AI Engine Layer

All ML code in `/ml/`. Zero external dependencies.

### 8.1 Isolation Forest (Station-Adaptive Pipeline)
Files: `ml/station_adaptive_pipeline.py` + `backend/app/services/training_service.py`

**8-Stage Training Pipeline** (tracked in real-time in the UI):
1. Data Ingested — Fetch historical telemetry from SQLite for this station only
2. Data Validated — Minimum 20 records required; rejects inadequate data
3. Data Preprocessed — Scrubs -999 sentinel values, NaN, sensor saturation codes
4. Features Generated — 8D vector: Temp, Humidity, Pressure, lag-1, rate-of-change, dew point, diurnal sine/cosine
5. Training Isolation Forest — Fits ensemble of isolation trees (pure Python)
6. Model Evaluation — Calibrates dynamic anomaly threshold + contamination factor
7. Model Registered — Saves versioned JSON artifact + updates model_registry in SQLite
8. Model Activated — Sets model as production-active for real-time scoring

Model versioning: v1.0, v1.1, v1.2 ... auto-incremented per station.

### 8.2 Thermodynamic Engine
File: `ml/thermo_engine.py`

Pure physics validator (WMO-No. 8 standard). Computes:
- Saturation vapor pressure (Magnus-Tetens)
- Dew point temperature
- Hypsometric pressure correction (elevation-based)
- Lifted Condensation Level (LCL)
- Wet Bulb temperature (Stull formula)
- Moist Adiabatic Lapse Rate

### 8.3 SHAP Explainability Engine
File: `ml/shap_engine.py`

TreeSHAP pure Python. Computes feature contribution scores for each anomaly, telling operators which sensor parameter drove the anomaly score.

### 8.4 Spatial Intelligence Engine
Files: `ml/spatial_engine.py` + `src/utils/spatialEngine.js`

- Haversine formula — great-circle distance
- Nearby peer discovery — finds all stations within configurable radius (default 50km)
- Robust statistics — Median + MAD (Median Absolute Deviation)
- Dual-track fusion:
  - ML anomaly + ALL peers agree -> REGIONAL_EVENT (weather front)
  - ML anomaly + peers disagree -> LOCALIZED_ANOMALY (sensor fault)
  - ML normal -> NORMAL

### 8.5 Imputation Engine
File: `ml/imputation_engine.py`

Self-healing data reconstruction:
- Spatial IDW (Inverse Distance Weighting) with elevation correction (6.5 C/1000m lapse rate)
- Hypsometric barometric compensation
- Thermodynamic fallback for isolated stations
- Flags imputed values with WMO Standard Flag 3

### 8.6 Sensor Health Engine
File: `ml/sensor_health.py`

Computes Sensor Health Index (SHI) (0-100%) and Remaining Useful Life (RUL) in days:
- Battery voltage penalty (< 11.8V triggers degradation)
- RF signal penalty (< -90 dBm)
- Drift rate penalty (> 0.2 C/day is critical)
- Flatline penalty (zero variance detected)
- Estimates RUL from SHI using exponential decay model

### 8.7 Root Cause Classifier
File: `ml/root_cause_classifier.py`

| Class | Trigger | Severity |
|-------|---------|---------|
| THERMAL_SPIKE | Rapid step-change in temperature | HIGH |
| SENSOR_FLATLINE | Zero variance over multiple readings | CRITICAL |
| CALIBRATION_DRIFT | Progressive bias vs spatial peers | MEDIUM |
| SUPER_SATURATION_VIOLATION | Dew point > temperature or RH > 100% | HIGH |
| POWER_SAG_BROWNOUT | Battery < 11.2V + anomalies | HIGH |
| REGIONAL_WEATHER_FRONT | All spatial peers show same anomaly | LOW |
| COMMUNICATION_CORRUPTION | -999 / 65535 ADC codes | CRITICAL |
| NOMINAL | Everything within bounds | NONE |

### 8.8 Frontend ML Mirror (JavaScript)
Files: `src/utils/mlEngine.js`, `src/utils/spatialEngine.js`, `src/utils/qcEngine.js`

Full JavaScript re-implementation for client-side fallback and live scoring without backend round-trips.

---

## 9. Frontend — Every View

### Admin Sidebar Navigation
Command Center -> Fleet Map -> Incident Triage -> Station Credentials -> QC Physics Matrix -> Fault Injection Lab -> Model Governance -> Station Training Studio -> Quality Data Export

### Operator Sidebar Navigation
Live Cockpit HUD -> Historical Ingest and ML -> Hardware Telemetry -> Maintenance Checklist -> Incident Triage -> Edge Buffer

---

### 9.1 Command Center (CommandCenter.jsx) — Admin Only — WORKING
- Fleet health counts: NORMAL / SUSPECT / CRITICAL / REGIONAL_EVENT / EXTREME
- Open incident count badge
- Full station table with live sensor readings (T, H, P, Wind, Rain)
- WMO flag color indicators per sensor (0=good, 1=suspect, 2=bad, 3=imputed)
- Battery voltage + RSSI per station
- Model status badge (ACTIVE MODEL / COLD START / TRAINING)
- Click-through to individual Station HUD
- Sync live Open-Meteo data button

### 9.2 Fleet Radar Map (FleetMap.jsx) — Admin Only — WORKING
- ESRI Dark Gray Canvas tiles (no API key required, Leaflet 1.9)
- Custom SVG markers per station with color-coded status
- Draws spatial neighbor lines (configurable radius slider: 25-200km)
- Click popup: station name, status, coordinates, temperature
- Click marker -> navigates to Station HUD

### 9.3 Incident Triage (Incidents.jsx) — WORKING
- Live incident queue from backend API
- Filter by status: All / Open / Acknowledged / Resolved
- Admin sees all fleet; operator sees only own station incidents
- Click incident -> opens IncidentModal
- Clear All Incidents button

#### Incident Modal (IncidentModal.jsx) — WORKING
- Station ID, severity badge, quality state badge
- ML anomaly score, Isolation Forest confidence
- Spatial evidence: nearest peer station, peer temperature, peer agreement
- Sensor QC evidence: which rules fired (RANGE_FAIL, RATE_FAIL, FLATLINE, etc.)
- Thermodynamic violations detected
- Root cause classification (primary + secondary)
- Recommended actions (with peer station ID resolved into human text)
- Adjudication buttons: ACKNOWLEDGE / GENUINE / REJECT / ACCEPT
- Real-time API call to POST /incidents/{id}/adjudicate

### 9.4 Station Credentials (StationCredentials.jsx) — Admin Only — WORKING
- Lists all provisioned stations with masked passwords (eye toggle to reveal)
- Copy passphrase to clipboard
- Activate / Deactivate station toggle
- Reset password (via prompt dialog -> API call)
- Create New Station button -> opens CredentialModal
- Edit Station button -> opens EditStationModal

#### Credential Modal (CredentialModal.jsx) — WORKING
- Fields: Station ID, Name, Username, Password, Latitude, Longitude, Elevation, Region, Status
- Posts to POST /admin/stations
- Supports preset station loading (Karnataka AWS presets)

#### Edit Station Modal (EditStationModal.jsx) — WORKING
- Fields: Station Name, Region, Latitude, Longitude, Elevation
- Calls PUT /admin/stations/{station_id}
- Prepopulates from existing station data

### 9.5 QC Physics Matrix (QCRules.jsx) — PARTIALLY WORKING
- Fetches station QC config from GET /stations/{id}/qc
- Shows thresholds: temp_min/max, humidity_min/max, pressure_min/max, wind_max, rainfall_max, temp_max_rate, flatline_window
- Editing thresholds is UI-only — NOT persisted to backend (no PUT endpoint yet)

### 9.6 Fault Injection Lab (FaultLab.jsx) — WORKING
| Fault | Effect | Detection Target |
|-------|-------|-----------------|
| SPIKE | +8.5 C instant offset | Rate-of-change QC |
| DRIFT | +0.4 C per cycle creep | ML anomaly detection |
| FLATLINE | Zero variance lock | Flatline QC rule |
| POWER | 10.8V battery voltage | Hardware risk gate |
| STORM | Regional weather event | Spatial consensus test |
| HUMIDITY | RH > 100% injection | Thermodynamic violation |

### 9.7 Model Governance (ModelGovernance.jsx) — WORKING
- Station selector (admin sees all; operator locked to own)
- Active model card: version, trained_at, training rows, contamination rate, threshold, SHAP features
- Training history table
- All model versions list (ACTIVE + ARCHIVED)
- Model rollback (Admin only)
- Download model card as JSON

### 9.8 Station Training Studio (StationUpload.jsx) — WORKING (780 lines, 39KB)
- CSV drag-and-drop upload -> POST /stations/{id}/telemetry/upload
- Fetch historical data from Open-Meteo API
- Preview uploaded data table
- Cloud DB stats: total records, date range
- 8-stage progress bar with real-time polling
- Error state handling with rollback option
- Training history table

### 9.9 Station HUD / Live Cockpit (StationHUD.jsx) — WORKING (664 lines, 36KB)
- Live sensor values: Temperature, Humidity, Pressure, Wind, Rain
- WMO quality flags per sensor with color coding
- Thermodynamic computed values: Dew point, Vapor pressure, Expected pressure
- Spatial data: Nearby peer stations table (distance, temp, status)
- "Inspect Peer" button — shows peer station readings within same HUD
- Imputed data toggle — shows self-healed values when sensors are flagged
- Station QC envelope display
- ML model status panel (active version, anomaly score)
- Real-time Chart.js line chart (temperature/humidity history)
- Final assessment badge: NORMAL / LOCALIZED_ANOMALY / REGIONAL_EVENT / CRITICAL

### 9.10 Station Diagnostics (StationDiagnostics.jsx) — WORKING
- Temperature, Humidity, Pressure, Wind readings
- Battery percentage gauge (calculated from voltage)
- RSSI signal strength
- Sensor health status indicators

### 9.11 Station Checklist (StationChecklist.jsx) — WORKING (frontend-only, not persisted)
- Default tasks: sensor calibration, housing inspection, battery check, comms test, data validation, log submission
- Checkboxes, progress bar
- "Sign and Submit Audit Log" button (alert only, not persisted)

### 9.12 Edge Buffer (EdgeSync.jsx) — SIMULATED ONLY
- Toggle online/offline mode
- Buffered telemetry frame count
- "Sync Now" button (shows alert, does not actually replay)

### 9.13 Quality Data Export (Export.jsx) — Admin Only — WORKING (client-side)
- JSON export bundle: fleet summary, station telemetry, hardware diagnostics
- SHA256 audit hash (currently hardcoded placeholder)
- Download as .json file via browser

---

## 10. Frontend Utilities

### apiClient.js — HTTP Client
All 20+ backend API methods with auto-inject Bearer token, JSON/FormData support, error extraction from FastAPI detail field.

### mlEngine.js — In-Browser Isolation Forest (440 lines, 14KB)
- IsolationTree.fit() — builds isolation trees
- IsolationForest.score() — computes anomaly scores
- Feature engineering: lags, rate-of-change, dew point, diurnal sine/cosine

### qcEngine.js — Quality Control Rules (210 lines)
- Physical range checks, rate-of-change, flatline detection, hardware checks
- Weighted scoring: rule (35%) + model (35%) + spatial (20%) + health (10%)
- Output: NORMAL / SUSPECT / CRITICAL / LOCALIZED_ANOMALY / REGIONAL_EVENT

### spatialEngine.js — Spatial Consensus (289 lines)
- Haversine distance, peer discovery, MAD-based outlier detection, multi-signal fusion

### openMeteoService.js — Weather API Client
- Fetches real-time and historical weather from api.open-meteo.com
- Parameters: temperature, humidity, surface pressure, wind, precipitation, weather code, is_day

### audio.js — Tactical Audio (Web Audio API)
- playClick(), playSuccess(), playAlarm(), toggle()

### seedData.js — Default State Seeds
- Initial QC config, model registry, maintenance checklist tasks, data lineage metadata

---

## 11. Weather Data Integration

### Backend: Open-Meteo Poller (weather_service.py, 551 lines, 26KB)
Background async task that runs every 20 seconds:
1. Fetches all active stations from SQLite
2. Calls Open-Meteo API with all station GPS coordinates in a single batch request
3. For each station: applies fault injection, runs QC rules, ML scoring, thermodynamic checks, spatial consensus, sensor health, imputation, root cause classification
4. Creates/updates incidents in SQLite if anomaly detected
5. Resolves open incidents if station returns to NORMAL
6. Updates in-memory live_state dict (served via /stations/fleet/live)

### Frontend: Open-Meteo Service
- openMeteoService.js fetches historical hourly data (used in Training Studio)
- WeatherContext.jsx polls /stations/fleet/live every 5 seconds

---

## 12. Styling and UI Design System

Theme: Cyberpunk dark mode with neon accents.

### CSS Variables
| Variable | Value | Use |
|----------|-------|-----|
| --bg-primary | #050811 | Near-black background |
| --bg-secondary | #080d1a | Card backgrounds |
| --neon-cyan | #00f0ff | Primary accent, borders, titles |
| --neon-green | #00ff88 | NORMAL status |
| --neon-amber | #ffaa00 | SUSPECT / warning |
| --neon-crimson | #ff0055 | CRITICAL / error |
| --neon-violet | #a855f7 | Model/ML features |
| --font-tactical | Orbitron | Headings, status labels |
| --font-mono | Share Tech Mono | Values, codes |

### Component Classes
- `.cyber-card` — glassmorphism card with neon border
- `.cyber-btn` — button variants (.btn-primary, .btn-danger, .btn-sm)
- `.cyber-badge` — status chips (.badge-normal, .badge-suspect, .badge-critical, .badge-extreme)
- `.cyber-sidebar` — collapsible left nav with .collapsed mode
- `.cyber-modal-overlay` — full-screen modal backdrop
- `.cyber-table` — dark-themed data table

---

## 13. Tests and Scripts

### Backend Tests (backend/tests/)
| File | Coverage |
|------|---------|
| test_auth_system.py | Login, RBAC, JWT validation, password hashing |
| test_telemetry_pipeline.py | CSV upload, JSON upload, station isolation, QC calibration |

### ML Tests (ml/)
| File | Coverage |
|------|---------|
| test_enhanced_engines.py | Thermo engine, SHAP, sensor health, root cause |
| test_spatial_intelligence.py | Haversine, MAD, peer discovery, dual-track fusion |
| test_station_isolation.py | Full Isolation Forest fit + score cycle |

### Root-Level Utility Scripts
| Script | Purpose |
|--------|---------|
| purge_all.py | Clear all telemetry + incidents |
| purge_all_databases.py | Nuclear reset of all DB tables |
| audit_system.py | Print audit log to console |
| verify_training.py | Verify a station trained model artifacts exist |
| test_http_upload.py | HTTP test for telemetry upload endpoint |
| test_pipeline_progression.py | Full pipeline E2E test |
| test_weather.py | Test Open-Meteo API connectivity |
| query.py | Quick SQLite query runner |
| cleanup.py | Remove stale model artifacts |
| scratch_update_weather.py | Populate weather history |
| scratch_verify_qc.py | Verify QC calibration |

---

## 14. What Is Working

### Infrastructure
- Both servers start cleanly (npm run dev + npm run backend)
- SQLite database auto-initializes with schema and admin seed on first run
- PostgreSQL/TimescaleDB supported via DATABASE_URL env var
- React ErrorBoundary catches runtime crashes gracefully

### Authentication
- Admin and station operator login / logout
- JWT tokens with 24-hour expiry, session persists across browser refresh
- Role-based sidebar navigation changes completely per role
- All sensitive endpoints protected with JWT Bearer auth
- Station operators strictly isolated to their own station

### Data Pipeline
- CSV upload with automatic column detection (many header name variants)
- JSON upload (body or file)
- Kelvin to Celsius, Pascal to hPa conversions
- Magnus-Tetens RH computation from dew point columns
- Multiple timestamp format parsing
- Station ID cross-validation per uploaded row
- Background QC calibration triggered after upload

### ML Pipeline
- Per-station Isolation Forest training (pure Python)
- Real-time 8-stage training progress polling
- Model versioning and rollback (admin only)
- Real-time anomaly scoring on live weather observations
- TreeSHAP feature attribution
- Thermodynamic physics validation (WMO-No. 8)
- Spatial peer consensus (Haversine + MAD)
- Self-healing imputation (IDW + lapse rate correction)
- Sensor Health Index (SHI) + Remaining Useful Life (RUL)
- Root cause classification (8 classes)
- Dual-track fusion: NORMAL / LOCALIZED_ANOMALY / REGIONAL_EVENT

### Weather Service
- Background Open-Meteo poller (every 20 seconds)
- Batch multi-station API calls
- Fault injection applies to live weather readings
- Incident auto-creation and auto-resolution

### Frontend
- All 13 views rendered and navigable
- Login screen, collapsible cyberpunk sidebar, live UTC clock topbar
- Command Center, Fleet Map, Incident Triage, Station Credentials
- Fault Injection Lab (6 fault types)
- Model Governance (view, rollback, download model card)
- Training Studio (upload + train + progress polling)
- Station HUD (live charts, peer inspection, imputed toggle)
- Hardware diagnostics, maintenance checklist, edge buffer, JSON export
- Tactical audio feedback on all interactions
- Open incident count badge in sidebar

---

## 15. What Is Not Working or Incomplete

### QC Rules Editing Not Persisted (Medium Impact)
- QCRules.jsx allows UI-only editing that is never saved to the backend
- Missing: PUT /stations/{station_id}/qc endpoint

### Maintenance Checklist Not Persisted (Low Impact)
- StationChecklist.jsx task checkboxes are React in-memory only
- Missing: No backend endpoint or SQLite table for checklist state
- Refreshing the page resets all tasks to unchecked

### Edge Sync / Offline Buffer Is Simulated (Low Impact)
- EdgeSync.jsx "Sync Now" shows an alert() but does not replay buffered observations through the backend
- It is a demonstration/simulation feature only

### Export SHA256 Hash Is Hardcoded (Low Impact)
- Export.jsx shows a fake hardcoded SHA256 hash string

### Model Drift Monitoring (Medium Impact)
- Model drift tracking is mentioned in seed data (INITIAL_MODEL_DRIFT) but no drift detection logic is implemented

### No Automated Retraining Trigger (Medium for Production)
- Model retraining is manual — no scheduled or drift-triggered automatic retraining

### PostgreSQL Timescale Hypertables (Low for Current Scale)
- The telemetry table is a plain table even in PostgreSQL mode
- Missing: SELECT create_hypertable('telemetry', 'timestamp') for time-series optimization

### QC Endpoint Auth Bug (Medium)
- GET /stations/{station_id}/qc requires mandatory Bearer token
- Returns 401 in some edge cases in the HUD view
- Should use get_optional_user instead of get_current_user

---

## 16. Known Issues and Bugs

| Issue | Severity | File | Notes |
|-------|---------|------|-------|
| QC endpoint returns 401 for HUD | Medium | stations.py L386 | get_current_user vs get_optional_user |
| Checklist state lost on refresh | Low | StationChecklist.jsx | No persistence backend |
| Export SHA256 hash is fake | Low | Export.jsx L29 | Hardcoded string |
| psycopg2-binary needed even for SQLite | Low | requirements.txt | Installed but unused in dev |
| Alert dialogs instead of modals | Low | Multiple views | alert(), prompt() used |
| CORS is fully open | Medium | main.py L51 | allow_origins=["*"] — needs tightening for production |

---

## 17. Feature Status Summary Table

| Feature | Backend | Frontend | Integrated | Notes |
|---------|---------|---------|-----------|-------|
| Admin login | YES | YES | YES | Full RBAC |
| Station operator login | YES | YES | YES | Identity enforcement |
| Session persistence | YES | YES | YES | localStorage v3 key |
| Station provisioning | YES | YES | YES | Full CRUD |
| Station editing | YES | YES | YES | EditStationModal |
| Station deactivation | YES | YES | YES | Toggle status |
| Password reset | YES | YES | YES | PBKDF2 re-hash |
| CSV telemetry upload | YES | YES | YES | Multi-format |
| JSON telemetry upload | YES | YES | YES | Direct or file |
| Open-Meteo data fetch | YES | YES | YES | Both sides |
| Station isolation ML | YES | YES | YES | Per-station model |
| ML training 8-stage | YES | YES | YES | With progress poll |
| Model versioning | YES | YES | YES | v1.0, v1.1... |
| Model rollback | YES | YES | YES | Admin only |
| Real-time anomaly scoring | YES | YES | YES | From active model |
| SHAP explainability | YES | YES | YES | Feature attributions |
| Thermodynamic validation | YES | YES | YES | WMO physics |
| Spatial consensus | YES | YES | YES | Haversine + MAD |
| Self-healing imputation | YES | YES | YES | IDW + lapse rate |
| Sensor health SHI RUL | YES | YES | YES | Predictive maintenance |
| Root cause classification | YES | YES | YES | 8-class taxonomy |
| Fault injection | YES | YES | YES | 6 fault types |
| Incident creation | YES | YES | YES | Auto from weather service |
| Incident adjudication | YES | YES | YES | 4 action types |
| Fleet map | N/A | YES | YES | Leaflet, ESRI tiles |
| Live fleet state | YES | YES | YES | Polled every 5 seconds |
| QC rules view | YES | YES | YES | Display only |
| QC rules edit | NO | PARTIAL | NO | UI only, not saved |
| Maintenance checklist | NO | YES | NO | Not persisted |
| Edge sync | N/A | PARTIAL | NO | Simulated only |
| Data export | N/A | YES | YES | JSON download |
| Auth audit log | YES | N/A | YES | DB-level only |
| Model drift tracking | NO | NO | NO | Not implemented |
| Auto-retraining | NO | NO | NO | Manual only |
| TimescaleDB hypertables | NO | N/A | NO | Plain table |

---

*Auto-generated by Antigravity IDE on September 16, 2026.*
*Source: complete inspection of all 60+ source files across backend/, ml/, and src/ directories.*
