# SkyGuard-AI — System Design

**Version:** 2.0  
**Target:** Smart India Hackathon 2026 — Problem Statement 073  
**Purpose:** Architectural source of truth for implementing, integrating, testing and demonstrating SkyGuard-AI.

> **Scope note:** This design is derived from the uploaded SkyGuard-AI specification/progress material. The optional Raspberry Pi gateway tier is intentionally excluded from this document. The station edge is represented by an ESP32-class node for acquisition, validation and buffering; the central server performs the complete anomaly-intelligence pipeline.

## Executive Summary

An Automatic Weather Station can report an abnormal value because its sensor is malfunctioning or because the atmosphere is genuinely changing. A single-station detector can identify an unusual value, but cannot reliably distinguish those causes.

SkyGuard-AI combines **Station Intelligence** with **Fleet Intelligence**. Station Intelligence asks, “Is this observation unusual for this station?” Fleet Intelligence asks, “Are nearby or related stations observing the same abnormal pattern?” Evidence from both perspectives is fused to classify the observation, explain the likely cause, reconstruct a value only when appropriate, and guide operator action.

The operational pipeline is:

```text
DETECT → CORROBORATE → EXPLAIN → RECOVER → MONITOR
```

These are sequential capabilities of one AWS anomaly-management system, not unrelated product features.

## Problem Definition and Impact

**Problem:** Unreliable AWS observations can affect downstream weather-data use and operator decisions.

**Decision:** Operators need to know whether an abnormal reading is a faulty sensor or a genuine atmospheric event.

**SkyGuard-AI:** Combines station-adaptive history with fleet corroboration and evidence fusion.

**Impact:** The system helps reduce false interpretation of sensor faults as weather events, identify localized sensor problems, protect genuine regional events from incorrect sensor-fault labels, provide actionable evidence, preserve raw telemetry, and expose reconstructed values separately when appropriate.

## Core Insight

```text
STATION HISTORY + FLEET INTELLIGENCE
    ↓
      ANOMALY EVIDENCE FUSION
    ↓
 SENSOR FAULT vs REGIONAL EVENT
    ↓
  EXPLANATION / ACTION
    ↓
  RECOVERY / MONITORING
```

Station Intelligence and Fleet Intelligence are separate architectural perspectives. Spatial Intelligence is a subsystem of Fleet Intelligence, not a replacement for it.

## System Goals and Boundaries

The system aims to provide station-adaptive AWS quality control, fleet-level corroboration, auditable explanations, provenance-preserving reconstruction, sensor-health monitoring, and secure operator workflows.

It is not a weather-forecasting system, a replacement for operational meteorological QC, a physical sensor-calibration system, or validated failure-time prediction. Controlled fault-injection results must not be presented as field validation.

---

## 1. System Purpose

SkyGuard-AI is a real-time quality-control and anomaly-intelligence platform for Automatic Weather Stations (AWS).

It is designed around one operational question:

> **When an AWS reading becomes unusual, is the observation itself wrong, or is the atmosphere genuinely changing?**

The system therefore separates two questions:

1. **Local abnormality:** Is the reading unusual for this station's own learned climate and recent behaviour?
2. **Regional corroboration:** Are nearby stations experiencing a comparable departure from their own normal behaviour?

The result is not merely an anomaly flag. The platform produces a structured assessment containing:

- data quality state;
- severity;
- local anomaly probability;
- confidence in that probability;
- regional/local classification;
- evidence from physics, temporal behaviour, multivariate consistency, station-adaptive ML and hardware health;
- peer evidence;
- root-cause hypothesis and alternatives;
- recommended operator action;
- optional reconstructed value with provenance;
- sensor-health trajectory.

The system is **not** a weather-forecasting system, a replacement for operational meteorological QC, or a physical sensor-calibration system.

---

## 2. Design Principles

### P1 — Evidence over thresholds

Hard integrity/physical impossibilities may fail deterministically. Statistical evidence must be fused before an operator-facing anomaly decision.

### P2 — Station is the unit of normality

Every station learns its own baseline, scale, threshold and model. Global constants are reserved for physical laws, encoding rules and infrastructure behaviour.

### P3 — Separate abnormality from cause

Local ML answers **“is this unusual for me?”**. Spatial intelligence answers **“are my neighbours experiencing the same departure?”**. These are deliberately separate axes.

### P4 — Never destroy an observation

Raw telemetry is immutable. Quality assessments, corrections, imputation and audit records are additive.

### P5 — Degrade, never crash

No model, peer, API, or network must make the station pipeline unusable. Missing evidence is explicitly represented rather than converted into false certainty.

---

## 3. High-Level Architecture

```text
                    ┌──────────────────────────────────────┐
                    │          AWS SENSOR NODE             │
                    │             ESP32-class               │
                    │                                      │
                    │  T / RH / Pressure acquisition       │
                    │  sanity + range checks               │
                    │  sequence + timestamp                │
                    │  local flash ring buffer             │
                    │  connectivity + retry                 │
                    └──────────────────┬───────────────────┘
                                       │ HTTPS batch
                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         SKYGUARD-AI SERVER                              │
│                                                                        │
│  Ingestion → Normalisation → Source-timestamp Deduplication            │
│                         │                                              │
│                         ▼                                              │
│              Immutable Raw Telemetry Store                             │
│                         │                                              │
│                         ▼                                              │
│  ┌─────────────── STATION INTELLIGENCE ────────────────┐              │
│  │ history, climatology, residuals, physics/QC, temporal │              │
│  │ checks, station-adaptive ML, multivariate evidence,   │              │
│  │ station health                                         │              │
│  └──────────────────────────┬───────────────────────────┘              │
│                             │                                          │
│  ┌──────────────────────────▼───────────────────────────┐              │
│  │                    FLEET INTELLIGENCE                 │              │
│  │ peer discovery, spatial relationships, residual-space  │              │
│  │ comparison, peer consensus, fleet correlation,        │              │
│  │ regional events, fleet health and incident awareness  │              │
│  └──────────────────────────┬───────────────────────────┘              │
│                             ▼                                          │
│                 ANOMALY EVIDENCE FUSION                               │
│                             ▼                                          │
│              EXPLAIN → RECOVER → MONITOR                              │
│                         │                                              │
│          ┌──────────────┼───────────────┐                              │
│          ▼              ▼               ▼                              │
│      PostgreSQL      Model Registry   Incident Store                   │
│      + TimescaleDB  + JSON artifacts  + audit                          │
│          │              │               │                              │
│          └──────────────┼───────────────┘                              │
│                         ▼                                              │
│                   FastAPI REST API                                     │
└─────────────────────────┬──────────────────────────────────────────────┘
                          │ JSON / Bearer
                          ▼
               ┌─────────────────────────┐
               │ React + Vite Dashboard  │
               │ Command Center          │
               │ Station HUD              │
               │ Evidence panel           │
               │ Fleet map                │
               │ Fault lab                │
               │ Model governance         │
               │ Diagnostics              │
               └─────────────────────────┘
```

---

## 4. Edge Architecture

The ESP32 is intentionally **not** responsible for the complete ML stack.

### 4.1 ESP32 responsibilities

- acquire temperature, relative humidity and pressure;
- perform deterministic range/sanity checks;
- reject obvious sentinel/invalid values;
- assign a monotonic sequence number;
- timestamp observations;
- buffer observations in flash when the network is unavailable;
- batch and replay observations after reconnection;
- report link/battery metadata when available.

### 4.2 What is not performed on the ESP32

- station climatology fitting;
- Isolation Forest training;
- peer discovery;
- regional adjudication;
- probabilistic fusion;
- model governance;
- fleet-wide incident management.

This keeps the embedded node lightweight and keeps the scientifically important fleet reasoning centralized.

### 4.3 Offline buffer contract

Each record contains compact fields such as sequence, epoch, temperature, humidity, pressure, battery, RSSI, flags and CRC.

The client must:

1. retain records until the server acknowledges them;
2. use a monotonic sequence number;
3. retry with exponential backoff;
4. send bounded batches;
5. delete only acknowledged records;
6. preserve order during replay.

---

## 5. Ingestion and Data Lifecycle

```text
ESP32 / CSV / JSON
       │
       ▼
Validate envelope
       │
       ▼
Normalise units + timestamps
       │
       ▼
Check station identity
       │
       ▼
Deduplicate using:
(station_id, source_timestamp)
       │
       ├── duplicate same value → skip/count
       ├── duplicate conflicting value → quarantine conflict
       └── new observation → continue
       │
       ▼
INSERT immutable telemetry
       │
       ▼
Detection chain
```

For live external demo data, the source timestamp must be used rather than server polling time. Repeated API values are not new observations.

Synthetic fault injections are explicitly marked as `SYNTHETIC_FAULT` and receive a distinct synthetic observation sequence so that the demo remains immediate without corrupting evaluation semantics.

---

## 6. Operational Pipeline

### DETECT

Station-specific baselines, physics/QC, residual anomaly detection, Isolation Forest, temporal checks, and multivariate checks establish whether an observation is locally unusual.

### CORROBORATE

Fleet Intelligence evaluates eligible peers, residual-space agreement, fleet-wide correlation, regional-event evidence, and no-peer uncertainty. It must not manufacture consensus when evidence is sparse or stale.

### EXPLAIN

The final assessment exposes observed versus expected values, layer contributions, peer evidence, root-cause hypotheses, alternatives, confidence/evidence strength, and evidence completeness.

### RECOVER

When eligibility criteria pass, the system reconstructs an estimated value and stores it separately. Raw telemetry remains immutable and the UI distinguishes observed from AI-estimated values.

### MONITOR

Sensor health, incidents, drift, model readiness, audit records, and gated MLOps provide ongoing operational monitoring.

## 7. Detection Pipeline

### 6.1 Layer contract

Every detection layer consumes the raw observation plus station context and emits normalised evidence and human-readable findings. Detection layers do not mutate raw telemetry.

| Layer | Name | Main responsibility | Output |
|---|---|---|---|
| L1 | Data Integrity | Reject malformed/sentinel data | valid/invalid + reason |
| L2 | Physics/QC | Detect impossible or physically inconsistent data | hard violations + physical evidence |
| L3 | Temporal Intelligence | Detect spikes, steps, flatlines, drift, noise | temporal evidence |
| L4 | Station-Adaptive ML | Score unusual station behaviour | ML score + attribution |
| L5 | Multivariate Consistency | Detect cross-variable contradictions | multivariate evidence |
| L6 | Fleet Intelligence | Correlate eligible stations and assess regional evidence; spatial analysis is a subsystem | peer table + agreement + fleet state |
| L7 | Fusion | Combine independent evidence | probability + confidence |
| L8 | Explainability | Assemble operator-readable evidence | evidence payload |
| L9 | Self-Healing | Reconstruct high-confidence faulty values | imputation + provenance |
| L10 | Health | Track sensor degradation | SHI + trend + maintenance signal |

### 6.2 Ordering guarantees

1. L1 hard failure prevents invalid values from reaching ML.
2. L2 hard physical violations bypass statistical judgement.
3. Spatial comparison occurs after local residual computation.
4. Imputation occurs after local/regional adjudication.
5. Regional events are never imputed.
6. Incident creation occurs after the final assessment.
7. Raw telemetry is never overwritten.

---

## 8. Station Intelligence Layer

Station Intelligence owns the station-specific view of normality. It includes historical baseline and climatology, residual calculation, physics/QC validation, temporal consistency, station-adaptive Isolation Forest, multivariate relationships, station-level evidence, and per-sensor health indicators.

## 9. Station-Adaptive ML

### 7.1 Why per-station models

A single global model would have to represent different elevations, microclimates, humidity regimes, pressure baselines and diurnal ranges.

SkyGuard-AI therefore starts without a universal production scorer. Each station obtains its own model.

### 7.2 Residual-first design

The model should not learn raw weather values directly.

For each station:

```text
expected(t) = station_climatology(hour, day_of_year)

residual(t) = observed(t) - expected(t)

z(t) = residual(t) / robust_sigma(hour_bucket)
```

The Isolation Forest then operates on residual features.

This provides three architectural benefits:

- explicit diurnal/seasonal learning;
- better station adaptation with sparse data;
- comparable residuals for cross-station spatial reasoning.

### 7.3 Climatology

The specified baseline uses harmonic regression:

```text
x_hat(t) =
    a0
  + a1 sin(2πh/24) + b1 cos(2πh/24)
  + a2 sin(4πh/24) + b2 cos(4πh/24)
  + c1 sin(2πd/365) + d1 cos(2πd/365)
  + c2 sin(4πd/365) + d2 cos(4πd/365)
```

The fitting method is robust IRLS with Huber weighting.

### 7.4 Readiness tiers

| Tier | Data condition | Active capability |
|---|---|---|
| COLD_START | <72 distinct observations | physics + peer checks |
| BASELINE | 72–720 observations | statistics + diurnal baseline, no IF |
| TRAINED | ≥720 observations and ≥14 distinct days | full climatology + IF |
| MATURE | ≥4380 observations and ≥2 seasons | full stack + reliable seasonal monitoring |

A station must never silently use a degenerate ML model.

### 7.5 Isolation Forest

Recommended v2 configuration:

- 100 trees;
- subsample `min(256, n_train)`;
- depth `ceil(log2(subsample))`;
- persisted random seed;
- explicit path-length correction for truncated branches;
- score `s(x) = 2^(-E[h(x)] / c(ψ))`.

The model artifact records feature-space version, climatology, training window, cleaning counts, threshold derivation, coefficient version and limitations.

---

## 10. Physics and Multivariate QC

### 8.1 Hard checks

Examples from the design:

- temperature outside physical/instrument bounds;
- RH outside permitted range;
- pressure outside station-level bounds;
- dew point above temperature beyond tolerance;
- gross hypsometric pressure inconsistency.

Hard violations are deterministic and can produce an immediate critical quality state.

### 8.2 Soft checks

Examples:

- dew point depression inconsistent with learned station behaviour;
- temperature/RH correlation inconsistent with station normal;
- implausible pressure tendency without contextual changes;
- wet-bulb inconsistency;
- rain/humidity contradiction.

Supporting signals such as battery, RSSI, wind and rainfall are diagnostic context. They explain or suppress hypotheses; they do not independently become PS-073 anomaly targets.

---

## 11. Fleet Intelligence Layer

Fleet Intelligence owns the fleet-level view of abnormality and causality. It includes peer discovery, station relationships, residual-space comparison, peer consensus, fleet-wide anomaly correlation, regional-event detection, fleet health, fleet incident awareness, and the fleet's model/readiness state where supported.

Fleet evidence is only as strong as the eligible peer set. No nearby stations, insufficient peer count, stale or unavailable telemetry, heterogeneous exposure, and large station separation are reported as incomplete or uncertain evidence. Local and physics evidence continue where possible, but the system does not claim a regional event from inadequate peer evidence.

### Spatial Intelligence as a Fleet Subsystem

Spatial Intelligence implements the geographic portion of Fleet Intelligence. It is not the whole fleet layer.

### 11.1 Peer discovery

A peer must:

- be active;
- be temporally fresh;
- have a valid latest assessment;
- have sufficient readiness to compute a residual.

Haversine distance determines candidate peers within the configured radius.

### 11.2 Residual-space comparison

For target station `k`:

```text
z_k       = target residual z-score
z_med     = median(peer residual z-scores)
sigma_peer = 1.4826 × MAD(peer residuals), floored

D = |z_k - z_med| / sigma_peer

A = exp(-D² / 2)
```

`A` is the agreement index.

- high `A` + local abnormality → regional event;
- low `A` + local abnormality → localized anomaly;
- no peers → unconfirmed localized anomaly.

### 11.3 Regional event confirmation

A regional event requires:

1. at least two valid peers;
2. agreement index ≥ specified threshold;
3. a majority of valid peers independently departing from their own normal;
4. same-direction departure;
5. persistence across distinct observations.

This prevents a single synchronized data artefact from becoming a regional weather event.

---

## 12. Anomaly Evidence Fusion

Spatial evidence is intentionally **not** added as another anomaly weight. It is an orthogonal causal axis.

The fusion path is:

```text
hard gates
   ↓
evidence vector
   ↓
logistic probability
   ↓
spatial adjudication
   ↓
severity + persistence + confidence
```

Evidence terms:

```text
z_qc
z_phys
z_temp
z_ml
z_multi
z_health
```

The logistic form is:

```text
logit = β0 + Σ βi zi
P(anomaly) = sigmoid(logit)
```

This value is a model-derived anomaly score or probability-like output until calibration and reliability validation are demonstrated. It must not be described as a validated probability merely because it is bounded between zero and one. Coefficients should be learned from the labelled fault-injection corpus and cross-validated by station.

Until fitted coefficients exist, defaults must be explicitly labelled as **priors**, not measured calibration.

### Missing evidence

If a term is unavailable, it is removed and the remaining coefficients are renormalised. Evidence completeness is reported and confidence is capped by it.

---

## 11. Three-Axis Assessment Model

The old single state is insufficient because severity and causal classification are different concepts.

### Axis 1 — Quality state

`VALID | SUSPECT | INVALID`

### Axis 2 — Severity

`NONE | LOW | MEDIUM | HIGH | CRITICAL`

### Axis 3 — Classification

`NORMAL | LOCALIZED_ANOMALY | LOCALIZED_ANOMALY_UNCONFIRMED | REGIONAL_EVENT`

A backward-compatible `legacy_state` may continue to be emitted until all UI views migrate.

---

## 12. Root-Cause Engine

The root-cause taxonomy includes:

- `THERMAL_SPIKE`
- `SENSOR_FLATLINE`
- `CALIBRATION_DRIFT`
- `SUPER_SATURATION_VIOLATION`
- `POWER_SAG_BROWNOUT`
- `REGIONAL_WEATHER_FRONT`
- `COMMUNICATION_CORRUPTION`
- `MISSING_DATA`
- `SENSOR_NOISE_DEGRADATION`
- `NOMINAL`

Critical structural rule:

> If the final classification is `REGIONAL_EVENT`, sensor-fault classes such as thermal spike and calibration drift are suppressed.

This is stronger than merely reducing their score and prevents a genuine weather event from being blamed on the instrument.

---

## 13. Self-Healing

Self-healing means **reconstruction, not overwriting**.

For a localized anomaly with sufficient peer evidence:

```text
r_hat = Σ(w_j r_j) / Σw_j
w_j = 1 / d_j²

x_hat = climatology_target(t) + r_hat × sigma_target
```

Preferred method:

`IDW_RESIDUAL`

Fallbacks:

- elevation-corrected IDW;
- thermodynamic reconstruction;
- climatology-only estimate with low confidence.

Every imputation stores:

- raw value;
- estimated value;
- parameter;
- source peers;
- method;
- confidence;
- WMO flag;
- assessment reference;
- timestamp.

The UI must clearly distinguish observed from AI-estimated values.

---

## 14. Sensor Health

Sensor health is a continuous indicator, not a diagnosis.

Maintain:

- per-temperature health;
- per-humidity health;
- per-pressure health;
- station-level power/link health.

Inputs include drift, variance collapse/noise, localized anomaly rate, battery and RSSI.

Regional weather observations do not reduce sensor health.

The old RUL concept is reframed as **Degradation Projection**:

> Projected time to a maintenance threshold under the current trend.

It must be labelled as a trend extrapolation, not a validated failure prediction.

---

## 15. Incident Lifecycle

```text
OPEN
  ↓
ACKNOWLEDGED
  ↓
GENUINE / REJECTED / ACCEPTED
  ↓
RESOLVED
```

Incident identity should be idempotent by:

```text
station + primary_parameter + root_cause + open_window
```

A persistent fault should update one incident rather than create one incident per observation.

Auto-resolution requires multiple consecutive distinct normal observations.

Regional events create `WEATHER_EVENT` incidents without sensor-health penalties or imputation.

---

## 16. MLOps

Training remains station-specific.

```text
ingest
  ↓
validate
  ↓
clean contaminated rows
  ↓
fit climatology
  ↓
generate residual features
  ↓
train candidate IF
  ↓
temporal validation
  ↓
shadow validation
  ↓
promotion gate
  ↓
activate
```

Promotion must require:

- readiness ≥ TRAINED;
- shadow validation pass;
- acceptable anomaly-rate change;
- sufficient agreement with incumbent;
- known-fault performance not worse than incumbent;
- valid artifact hash;
- no open sensor-fault incident.

Rollback must remain available.

---

## 17. Database Model

### Existing logical entities

- `admins`
- `stations`
- `telemetry`
- `model_registry`
- `training_jobs`
- `incidents`
- `active_faults`
- `station_qc_config`
- `auth_audit_logs`

### Required additive entities

- `assessments`
- `station_climatology`
- `fusion_coefficients`
- `imputations`
- `sensor_health`
- `drift_metrics`
- `retraining_candidates`
- `config_audit`
- `maintenance_tasks`
- `maintenance_audit`
- `sensor_change_events`
- `ingest_idempotency`
- `shadow_scores`
- `station_neighbours`

Raw telemetry remains immutable.

---

## 18. API Architecture

Representative contracts:

```text
GET  /health
POST /auth/login
GET  /auth/me

GET  /stations/{id}
GET  /stations/{id}/telemetry/stats
POST /stations/{id}/telemetry/upload
POST /stations/{id}/telemetry/batch

GET  /stations/{id}/assessments/latest
GET  /stations/{id}/assessments
GET  /assessments/{assessment_id}

POST /stations/{id}/train
GET  /stations/{id}/training-jobs
GET  /stations/{id}/models
GET  /stations/{id}/models/active
POST /stations/{id}/models/{version}/rollback

GET  /stations/{id}/health
GET  /fleet/health
GET  /stations/fleet/live

GET  /incidents
GET  /incidents/{id}
POST /incidents/{id}/adjudicate
DELETE /incidents?station_id=...

GET  /stations/{id}/drift
POST /stations/{id}/drift/compute
GET  /retraining/candidates
POST /retraining/candidates/{id}/approve
POST /retraining/candidates/{id}/reject
```

All station-scoped routes require explicit station authorization.

---

## 19. Security Architecture

### Authentication

The current design uses:

- PBKDF2-HMAC-SHA256 password derivation;
- HMAC-SHA256 JWT;
- role and station identity in the token;
- audit logging.

Hardening requirements:

- reject `alg=none`;
- verify signature before trusting payload;
- enforce `exp` and `iat`;
- use a secret from environment;
- refuse insecure defaults;
- include `jti`;
- fail closed on malformed tokens.

### Authorization

`require_station(station_id)` must enforce:

```text
admin → any permitted station
operator + own station → allowed
operator + other station → 403
no token → 401
```

Fleet responses must be filtered by role.

### Demo-only controls

Fault injection is available only when `DEMO_MODE=true`.

No production secret, plaintext station credential or wildcard CORS configuration should survive into a real deployment.

---

## 20. Frontend Architecture

Keep:

- React 18;
- Vite;
- Context API;
- Leaflet;
- Chart.js;
- existing visual identity.

Introduce:

```text
AuthContext
WeatherContext
AssessmentContext
```

`AssessmentContext` becomes the authoritative source for the focused station's complete server-generated assessment.

Browser ML/QC code is demoted:

- ML mirror → training/offline preview only;
- QC mirror → input validation only;
- spatial mirror → map drawing only.

The server remains the single production verdict authority.

### Critical UI

The Station HUD should show:

1. classification;
2. probability;
3. confidence;
4. readiness tier;
5. evidence contribution bars;
6. expected vs observed values;
7. residual z-scores;
8. peer agreement;
9. root cause + alternatives;
10. recommendation;
11. observed vs AI-estimated values.

The most important visual proof is:

```text
SINGLE-STATION FAULT
target: high residual
peers: normal residuals
→ LOCALIZED_ANOMALY

REGIONAL WEATHER
target: high residual
peers: high same-direction residuals
→ REGIONAL_EVENT
```

---

## 21. Failure and Degraded Modes

| Failure | Behaviour |
|---|---|
| Weather API unavailable | retain last state, backoff, mark degraded |
| API returns garbage | L1 rejects it |
| Database unavailable | fail request clearly; buffer where supported |
| Model missing | use lower readiness tier / physics + QC |
| Peer unavailable | local verdict continues, confidence capped |
| No peers | `LOCALIZED_ANOMALY_UNCONFIRMED` |
| SHAP fails | detection continues; attribution marked unavailable |
| Imputation insufficient | no estimate generated |
| Candidate model fails promotion | incumbent remains active |
| Artifact hash mismatch | reject candidate and retain previous model |
| Dashboard poll fails | show stale-state badge and last update time |

---

## 22. Testing Strategy

Testing must cover the architecture, not just individual functions.

### Core test groups

- data integrity;
- physics;
- temporal cadence;
- station isolation;
- Isolation Forest mathematics;
- climatology;
- residual features;
- spatial consensus;
- regional-event confirmation;
- fusion;
- explainability;
- imputation immutability;
- health;
- incident idempotency;
- JWT security;
- authorization matrix;
- offline replay;
- model promotion;
- rollback;
- chaos/degraded modes.

### Fault-injection suite

The specified evaluation corpus includes:

1. temperature spike;
2. temperature drift;
3. flatline;
4. power sag;
5. RH supersaturation;
6. regional storm;
7. sentinel;
8. missing data;
9. pressure offset;
10. noise burst;
11. communication dropout;
12. coastal sea-breeze hard negative.

The hard negative is important because a system that only detects injected faults can still fail by over-alerting on legitimate weather.

---

## 23. Demonstration Flow

### Demo thesis

> **SkyGuard-AI distinguishes an abnormal sensor from abnormal weather by combining station-adaptive evidence with spatial corroboration.**

Recommended flow:

1. show healthy fleet;
2. show independent station models;
3. show learned expectation and residual;
4. inject a temperature spike at one station;
5. show detection;
6. show the anomaly score or probability-like output separately from model-derived confidence/evidence strength;
7. show evidence contributions;
8. show peers remaining normal;
9. show `LOCALIZED_ANOMALY`;
10. show root cause and recommendation;
11. show AI-estimated replacement value while preserving raw data;
12. show sensor-health degradation;
13. adjudicate incident;
14. reset fault;
15. inject a regional storm across several stations;
16. show peer agreement and `REGIONAL_EVENT`.

The demonstration should use deterministic replay rather than depending on an external live API during judging.

---

## 24. Known Limitations

The uploaded project material explicitly identifies these limitations:

- evaluation metrics are based on controlled synthetic fault injection, not field-validated hardware failures;
- confidence is not yet a validated probability;
- point-level recall is lower than event-level recall;
- Open-Meteo is a demo data source and does not represent real AWS instrumentation;
- the current architecture must distinguish implementation targets from measured results;
- RUL cannot be presented as a validated failure prediction without actual failure-time data.

These limitations should be stated rather than hidden.

---

## 25. Implementation Order

### P0 — before judging

1. endpoint authorization and station isolation;
2. JWT secret/hardening;
3. source-timestamp deduplication;
4. QC persistence;
5. three-axis assessment;
6. assessment/evidence API;
7. Evidence Panel;
8. regional-event hardening;
9. regional-event root-cause suppression;
10. deterministic demo replay;
11. seed adequate historical data.

### P1 — credibility block

1. residual climatology;
2. residual-space peer comparison;
3. readiness tiers;
4. contamination cleaning;
5. fitted fusion coefficients;
6. full injection ledger;
7. benchmark runner;
8. degradation projection wording;
9. drift monitoring;
10. real edge batch sync;
11. export hashing;
12. maintenance persistence;
13. browser-engine demotion;
14. credential cleanup;
15. incident dwell/idempotency;
16. migration framework;
17. per-sensor health.

### P2 / future

Neighbour caching, spatial indexing, automated retraining, ESP32 reference firmware, stronger observability, real institutional data integration, federated learning, survival-model RUL and other scale features are secondary to the core SIH demonstration.

---

## 26. Definition of Done

The system is implementation-complete for the SIH target when:

- invalid/sentinel data cannot reach ML;
- station isolation is enforced on every scoped endpoint;
- source timestamps drive temporal logic;
- every assessment has explicit quality, severity and classification axes;
- evidence is auditable;
- regional weather cannot be classified as a sensor fault;
- no-peer cases explicitly report uncertainty;
- raw observations are immutable;
- imputation is separate and traceable;
- model training is reproducible;
- candidate models are validated before activation;
- incidents are idempotent;
- the demo can run without external network dependency;
- measured performance is clearly separated from engineering targets and synthetic evaluation results.
