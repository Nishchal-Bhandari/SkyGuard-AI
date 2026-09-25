# SkyGuard-AI — Station-Adaptive & Fleet-Intelligent Weather Anomaly Detection

> **Smart India Hackathon 2026 — Problem Statement 073**
> AI/ML-Based Intelligent Anomaly Detection for Automatic Weather Stations

---

## The Problem

An Automatic Weather Station can produce an abnormal observation because the **sensor is malfunctioning** or because the **atmosphere is genuinely changing**. A single-station detector can identify an unusual value, but cannot reliably distinguish those causes.

Traditional fixed-threshold QC (e.g., "temperature > 45°C → anomaly") fails because 45°C is routine in Vidarbha in May and impossible in Mangaluru in July. Fixed thresholds encode neither microclimate nor sensor context.

## The Solution

SkyGuard-AI combines **Station Intelligence** with **Fleet Intelligence** to answer three questions for every observation:

1. **Is this observation trustworthy?** — data integrity, physics, temporal behaviour, station-adaptive ML
2. **If not — is the sensor broken, or is the weather genuinely doing this?** — spatial adjudication against neighbouring stations
3. **What should the operator do about it?** — explainable evidence, root-cause hypothesis, recommended action, reconstructed value

```text
     STATION HISTORY + FLEET INTELLIGENCE
                    ↓
          ANOMALY EVIDENCE FUSION
                    ↓
        SENSOR FAULT vs REGIONAL EVENT
                    ↓
            ROOT CAUSE / ACTION
                    ↓
           RECOVER / MONITOR
```

### Two layers of intelligence

| Layer | Question | Method |
|---|---|---|
| **Station Intelligence** | *"Is this reading unusual for this specific station?"* | Per-station climatology, residual z-scores, station-adaptive Isolation Forest, temporal/physics/multivariate checks |
| **Fleet Intelligence** | *"Are nearby stations experiencing the same departure?"* | Haversine peer discovery, residual-space comparison, fleet-wide anomaly correlation, regional-event detection |

> **Fleet Intelligence** is a first-class architectural layer. Spatial Intelligence (Haversine + MAD) is one subsystem within it — not the whole story.

---

## Operational Pipeline

The system implements one sequential pipeline:

```text
DETECT → CORROBORATE → EXPLAIN → RECOVER → MONITOR
```

| Stage | Responsibility |
|---|---|
| **DETECT** | Establish station-specific normality using baseline, physics/QC, residuals, temporal checks, and station-adaptive ML |
| **CORROBORATE** | Evaluate Fleet Intelligence — peer residuals, fleet correlation, regional-event evidence, peer availability |
| **EXPLAIN** | Expose evidence contributions, observed vs expected values, root-cause hypotheses, confidence, and completeness |
| **RECOVER** | Reconstruct eligible localized faults without overwriting raw telemetry |
| **MONITOR** | Maintain health, incidents, drift, readiness, auditability, and gated MLOps state |

### Detection chain

```text
raw observation
  → L1  Data Integrity        sentinels, NaN, ranges, timestamp faults
  → L2  Physics Validation     thermodynamic hard/soft checks (WMO-No. 8)
  → L3  Temporal Intelligence  spikes, steps, flatlines, drift, rate violations
  → L4  Station-Adaptive ML    Isolation Forest on residual features
  → L5  Multivariate           T↔H, T↔P, dew point, cross-variable contradictions
  → L6  Fleet Intelligence     residual-space peer comparison, regional adjudication
  → L7  Evidence Fusion        log-odds accumulation across six detectors
  → L8  Explainability         structured evidence payload
  → L9  Self-Healing           elevation-corrected residual-space IDW reconstruction
  → L10 Health & Monitoring    per-sensor SHI, drift, degradation projection
```

---

## Core Architecture

### Per-station adaptive models (zero universal models)

Every station trains its own anomaly model. There is no shared global model. A coastal station at 30 m in Mangaluru and a Western Ghats station at 900 m have different diurnal ranges, humidity floors, pressure baselines and sensor ageing profiles. A single global model would learn the average of these and flag the tails of every station's *normal* behaviour.

### Residual-first design

The model does not learn raw weather values directly. For each station:

```text
expected(t) = station_climatology(hour, day_of_year)
residual(t) = observed(t) - expected(t)
z(t)        = residual(t) / robust_sigma(hour_bucket)
```

The Isolation Forest operates on residual features — making diurnal/seasonal patterns explicit rather than implicit.

### Core parameter constraint

The anomaly detector uses **only temperature, pressure, relative humidity and the observation timestamp**. Wind, rainfall, battery voltage and RSSI are **diagnostics only** — they explain or suppress hypotheses but do not independently create PS-073 anomalies.

---

## Three-Axis Assessment Model

The old single-enum state conflates severity with causal classification. SkyGuard-AI separates them:

| Axis | Values | Question |
|---|---|---|
| **Quality State** | `VALID` · `SUSPECT` · `INVALID` | Is the data trustworthy? |
| **Severity** | `NONE` · `LOW` · `MEDIUM` · `HIGH` · `CRITICAL` | How bad is it? |
| **Classification** | `NORMAL` · `LOCALIZED_ANOMALY` · `LOCALIZED_ANOMALY_UNCONFIRMED` · `REGIONAL_EVENT` | What caused it? |

### Classification rules

| Station Intelligence | Fleet Evidence | Classification | Interpretation |
|---|---|---|---|
| **Nominal** | **Peers consistent** | `NORMAL` | Sensor aligns with both station history and peer neighbourhood |
| **Unusual** | **Peers also unusual, same direction** | `REGIONAL_EVENT` | Atmospheric excursion confirmed across multiple stations. Legitimate weather. |
| **Unusual** | **Peers normal** | `LOCALIZED_ANOMALY` | Excursion isolated to this tower. Probable sensor drift, wiring fault, or hardware defect. |
| **Unusual** | **No valid peers** | `LOCALIZED_ANOMALY_UNCONFIRMED` | No peer evidence available. Local verdict continues, confidence capped. |
| **Physical impossibility** | **Any** | `INVALID` / `CRITICAL` | Hardware limits breached. L1/L2 hard gate overrides all models. |

**Critical structural rule:** If classification is `REGIONAL_EVENT`, sensor-fault root causes (THERMAL_SPIKE, CALIBRATION_DRIFT, etc.) are **suppressed**. A genuine weather event cannot be blamed on the instrument.

---

## Station Readiness Tiers

A station must never silently use a degenerate ML model.

| Tier | Data Condition | Active Capability |
|---|---|---|
| `COLD_START` | < 72 distinct observations | Physics + QC + peer checks only |
| `BASELINE` | 72 – 720 observations | Statistical baseline + diurnal, no Isolation Forest |
| `TRAINED` | ≥ 720 observations, ≥ 14 distinct days | Full climatology + Isolation Forest |
| `MATURE` | ≥ 4380 observations, ≥ 2 seasons | Full stack + reliable seasonal monitoring |

Every assessment exposes its readiness tier.

---

## Evidence Fusion

Spatial evidence is intentionally **not** added as another anomaly weight. It is an orthogonal causal axis.

```text
Evidence vector:  z = [z_qc, z_phys, z_temp, z_ml, z_multi, z_health]

Logistic fusion:  logit = β₀ + Σ βᵢzᵢ
                  P(anomaly) = sigmoid(logit)

Then:             spatial adjudication (Fleet Intelligence)
                  → severity + persistence + confidence
```

Coefficients are fitted from the labelled fault-injection corpus. Until fitted, defaults are explicitly labelled as **priors**, not measured calibration.

### Two probabilities, deliberately

| Quantity | Question | Peer agreement |
|---|---|---|
| `anomaly_probability` | Is this station's **sensor** faulty? | Strong evidence **against** |
| `local_probability` | Is this reading **unusual** for this station? | Irrelevant |

A regional weather event is exactly *local high, anomaly suppressed by peers*. Collapsing these into one number caused genuine frontal passages to be reported as NORMAL.

---

## Self-Healing

Self-healing means **reconstruction, not overwriting**.

For a localized anomaly with sufficient peer evidence:

```text
r_hat = Σ(wⱼ rⱼ) / Σwⱼ       where wⱼ = 1/dⱼ²
x_hat = climatology_target(t) + r_hat × σ_target
```

Rules:
- Raw values are **immutable** — imputed values are stored separately
- Every imputation records: method, source peers, confidence, WMO flag, assessment reference
- **Never impute a `REGIONAL_EVENT`** — the value is real
- The UI clearly distinguishes observed from AI-estimated values

---

## Root-Cause Taxonomy

| Class | Trigger | Severity |
|---|---|---|
| `THERMAL_SPIKE` | Rapid step-change in temperature | HIGH |
| `SENSOR_FLATLINE` | Zero variance over multiple distinct readings | CRITICAL |
| `CALIBRATION_DRIFT` | Progressive bias vs spatial peers | MEDIUM |
| `SUPER_SATURATION_VIOLATION` | Dew point > temperature or RH > 100% | HIGH |
| `POWER_SAG_BROWNOUT` | Battery < 11.2V + anomalies | HIGH |
| `REGIONAL_WEATHER_FRONT` | All spatial peers show same anomaly | LOW |
| `COMMUNICATION_CORRUPTION` | −999 / 65535 ADC codes | CRITICAL |
| `MISSING_DATA` | Null/NaN observations | HIGH |
| `SENSOR_NOISE_DEGRADATION` | Variance burst without physical cause | MEDIUM |
| `NOMINAL` | Everything within bounds | NONE |

---

## Fault Injection Lab

The fault injection lab serves as both demonstration tool and calibration corpus.

| Fault | Expected Interpretation |
|---|---|
| TEMP_SPIKE | Localized thermal fault |
| TEMP_DRIFT | Calibration drift |
| FLATLINE | Sensor flatline |
| POWER_SAG | Power-induced degradation |
| RH_SUPERSAT | Physical/QC violation |
| REGIONAL_STORM | Regional weather event — must NOT trigger sensor-fault root cause |
| SENTINEL | Communication/data corruption |
| MISSING | Missing data |
| PRESSURE_OFFSET | Pressure calibration fault |
| NOISE_BURST | Sensor noise degradation |
| COMMS_DROPOUT | Communication corruption |
| SEA_BREEZE | **Hard negative** — must NOT create a sensor fault |

The sea-breeze hard negative is critical: a system that only detects injected faults can still fail by over-alerting on legitimate weather.

---

## Tech Stack

### Backend
| Component | Technology |
|---|---|
| Web Framework | FastAPI 0.110+ (async-native) |
| Server | Uvicorn |
| Database | SQLite (dev) / PostgreSQL + TimescaleDB (prod) |
| Auth | Custom HMAC-SHA256 JWT · PBKDF2-HMAC-SHA256 (100k iterations) |
| ML Engine | **Pure Python** — zero numpy, scikit-learn, or pandas |
| Weather API | Open-Meteo (free, no API key) |
| HTTP Client | httpx (async) |

### Frontend
| Component | Technology |
|---|---|
| Framework | React 18.3 + Vite 6 |
| Map | Leaflet 1.9 (ESRI Dark Gray Canvas) |
| Charts | Chart.js 4.4 |
| Styling | Vanilla CSS (cyberpunk dark theme) |
| State | Context API (AuthContext + WeatherContext) |

### ML Engines (all pure Python, zero external dependencies)
| Engine | File | Purpose |
|---|---|---|
| Isolation Forest | `ml/station_adaptive_pipeline.py` | Per-station anomaly scoring |
| Thermodynamics | `ml/thermo_engine.py` | WMO-No. 8 physics validation |
| TreeSHAP | `ml/shap_engine.py` | Feature attribution / explainability |
| Spatial | `ml/spatial_engine.py` | Haversine + MAD peer consensus |
| Imputation | `ml/imputation_engine.py` | IDW + lapse-rate self-healing |
| Sensor Health | `ml/sensor_health.py` | SHI + degradation projection |
| Root Cause | `ml/root_cause_classifier.py` | 10-class taxonomy |

---

## Dashboard (13 views)

| View | Role | Description |
|---|---|---|
| **Command Center** | Admin | Fleet health overview, live sensor readings, WMO flags, model status |
| **Fleet Radar Map** | Admin | Leaflet map with spatial neighbour lines, radius slider (25–200 km) |
| **Incident Triage** | Both | Incident queue with filter, adjudication (ACKNOWLEDGE / GENUINE / REJECT) |
| **Station Credentials** | Admin | Station provisioning, password management, activate/deactivate |
| **QC Physics Matrix** | Admin | Per-station threshold configuration |
| **Fault Injection Lab** | Admin | 6+ fault types with live injection and reset |
| **Model Governance** | Both | Model versions, rollback, model card download, training history |
| **Station Training Studio** | Both | CSV upload, Open-Meteo fetch, 8-stage training progress bar |
| **Station HUD** | Both | Live cockpit — sensors, WMO flags, thermodynamics, spatial peers, imputed toggle, evidence |
| **Station Diagnostics** | Both | Battery, RSSI, hardware health gauges |
| **Maintenance Checklist** | Operator | Inspection tasks and audit submission |
| **Edge Buffer** | Operator | Offline mode toggle, buffered frame count |
| **Quality Data Export** | Admin | JSON export with SHA-256 audit hash |

---

## Design Principles

| # | Principle | Meaning |
|---|---|---|
| **P1** | Evidence over thresholds | No single check alone produces an alert (except data integrity and physical impossibility) |
| **P2** | Station is the unit of normality | Baselines, thresholds, models are per-station. Global constants only for physical laws |
| **P3** | Separate abnormality from cause | "Is it unusual?" and "Is the sensor broken?" are deliberately separate axes |
| **P4** | Never destroy an observation | Raw values are immutable. Everything else is additive |
| **P5** | Degrade, never crash | Every external dependency has a defined fallback |

---

## Quick Start

**Requirements:** Python 3.10+ · Node.js 18+

```bash
# Install dependencies
pip install -r requirements.txt
npm install

# Start backend (http://localhost:8000, API docs at /docs)
npm run backend

# Start frontend (http://localhost:5173)
npm run dev
```

**Demo credentials:** `admin` / `sentinel2026` — demonstration only, not production credentials.

A station needs **≥ 100 clean observations** before training is permitted. This floor ensures the covariance model, hourly climatology coverage, and holdout split are all adequately supported.

---

## Controlled Evaluation Results

> **These are results on controlled synthetic fault injection.** They measure the system against its own fault model, not against real hardware failures, and are **not field-validated performance**. Real labelled hardware-failure validation remains future work.

| Metric | Value |
|---|---|
| Precision | 0.839 |
| Recall (point-level) | 0.502 |
| F1 | 0.628 |
| False Positive Rate | 0.0102 |
| Event-level recall | 35 / 36 events |
| Root-cause accuracy | 0.844 – 0.878 |
| Latency | 1.24 ms mean, 1.40 ms p95, ~805 obs/s |

---

## What This Is Not

A hackathon prototype built to be technically defensible — **not** a certified meteorological quality-control system.

Three limitations stated plainly:

1. **All metrics are synthetic.** No labelled real-data validation exists.
2. **Confidence is not yet a validated probability** — it is a model-derived score bounded between 0 and 1, not a calibrated real-world probability.
3. **Point recall (0.50) is well below event recall (0.97)** — long faults are caught but flagged intermittently.

---

## Project Structure

```
SkyGuard-AI/
├── backend/app/
│   ├── main.py                    ← FastAPI entry + DB init + weather poller
│   ├── config.py                  ← DB URL, secret key, token expiry
│   ├── api/v1/
│   │   ├── auth.py                ← Login + JWT RBAC guards
│   │   ├── stations.py            ← Station CRUD + QC
│   │   ├── telemetry.py           ← CSV/JSON upload + fleet live state
│   │   ├── models.py              ← ML training, rollback, scoring
│   │   ├── faults.py              ← Fault injection + reset
│   │   ├── incidents.py           ← Incident CRUD + adjudication
│   │   └── maintenance.py         ← Maintenance endpoints
│   ├── auth/security.py           ← PBKDF2 + HMAC JWT
│   ├── services/
│   │   ├── training_service.py    ← 8-stage training lifecycle
│   │   ├── weather_service.py     ← Async Open-Meteo poller + full scoring chain
│   │   └── model_storage.py       ← JSON artifact persistence
│   └── storage/database.py        ← All SQL (SQLite + PostgreSQL dual-mode)
├── ml/
│   ├── station_adaptive_pipeline.py ← Core Isolation Forest
│   ├── thermo_engine.py             ← WMO thermodynamic physics
│   ├── shap_engine.py               ← TreeSHAP explainability
│   ├── spatial_engine.py            ← Haversine + MAD spatial consensus
│   ├── imputation_engine.py         ← IDW self-healing reconstruction
│   ├── sensor_health.py             ← SHI + degradation projection
│   ├── root_cause_classifier.py     ← 10-class taxonomy
│   └── models/                      ← Persisted per-station model artifacts
├── src/
│   ├── components/views/ (13 views)
│   ├── components/modals/ (3+ modals)
│   ├── context/ (AuthContext + WeatherContext)
│   ├── utils/ (apiClient, mlEngine, qcEngine, spatialEngine)
│   └── styles/ (cyberpunk-theme.css, dashboard.css, components.css)
└── DOCS/
    ├── specsheet(2).md              ← Implementation specification v2.0
    └── system_design (1).md         ← Architecture source of truth
```

---

## License

Smart India Hackathon 2026 — PS-073 submission.
