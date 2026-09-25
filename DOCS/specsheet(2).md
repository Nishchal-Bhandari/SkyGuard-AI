# SkyGuard-AI — Implementation Specification Sheet

**Version:** 2.0  
**Target:** Smart India Hackathon 2026 — PS-073  
**Role:** Single implementation checklist / engineering contract  
**Source basis:** Uploaded SkyGuard-AI specification, architecture and evaluation material.  
**Excluded:** Raspberry Pi gateway tier.

---

## 1. Product Definition and Operational Framing

An Automatic Weather Station can produce an abnormal observation because the sensor is malfunctioning or because the atmosphere is genuinely changing. SkyGuard-AI is an AWS quality-control platform that helps operators distinguish those cases.

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

The implementation is one operational pipeline:

```text
DETECT → CORROBORATE → EXPLAIN → RECOVER → MONITOR
```

**Problem:** Unreliable AWS observations can affect downstream weather-data use and operator decisions.  
**Decision:** Operators need to know whether an abnormal reading is a faulty sensor or a genuine atmospheric event.  
**Impact:** The system provides evidence for that decision, identifies localized sensor problems, protects genuine regional events from incorrect sensor-fault labels, preserves raw telemetry, and exposes reconstructed values separately when appropriate.

### Intelligence perspectives

- **Station Intelligence:** Is this observation unusual for this station?
- **Fleet Intelligence:** Are nearby or related stations observing the same abnormal pattern?
- **Anomaly Evidence Fusion:** Considering both evidence sources, is this likely a sensor problem or a genuine atmospheric event?

Fleet Intelligence is a first-class system layer. Spatial Intelligence is one subsystem within it.

### Core parameters

| Parameter | Unit | Role |
|---|---|---|
| Air temperature | °C | Primary |
| Atmospheric pressure | hPa | Primary |
| Relative humidity | % | Primary |

### Diagnostic context

Battery, RSSI/link quality, wind, rainfall, elevation, GPS and timestamp provide context, health and spatial metadata. They must not silently become primary ML features.

---

## 2. Functional Requirements

### FR-1 Ingestion

- [ ] CSV upload with header/column normalisation.
- [ ] JSON body/file upload.
- [ ] Unit normalisation.
- [ ] Timestamp normalisation to UTC.
- [ ] Station identity validation.
- [ ] Deduplication on `(station_id, source_timestamp)`.
- [ ] Live source-timestamp deduplication.
- [ ] Idempotent edge batch ingestion.
- [ ] Per-row quarantine for malformed batches.
- [ ] Synthetic faults tagged separately from real/source observations.

### FR-2 Detection

- [ ] Null/NaN/Inf detection.
- [ ] Sentinel detection.
- [ ] Physical range checks.
- [ ] Thermodynamic checks.
- [ ] Adaptive rate-of-change checks.
- [ ] Distinct-observation flatline detection.
- [ ] Drift detection.
- [ ] Station-specific model scoring.
- [ ] Explicit diurnal/seasonal climatology.
- [ ] Multivariate consistency.
- [ ] Residual-space spatial comparison.
- [ ] Calibrated evidence fusion.
- [ ] Localized vs regional adjudication.
- [ ] Dwell/persistence.
- [ ] Explicit no-peer uncertainty state.

### FR-FLOW Operational Stages

- [ ] **DETECT:** establish station-specific normality using baseline, physics/QC, residuals, temporal checks, and station-adaptive ML.
- [ ] **CORROBORATE:** evaluate Fleet Intelligence, peer residuals, fleet correlation, regional-event evidence, and peer availability.
- [ ] **EXPLAIN:** expose evidence contributions, observed versus expected values, root-cause hypotheses, confidence/evidence strength, and completeness.
- [ ] **RECOVER:** reconstruct eligible localized faults without overwriting raw telemetry.
- [ ] **MONITOR:** maintain health, incidents, drift, readiness, auditability, and gated MLOps state.

### FR-3 Explainability

- [ ] Every non-normal assessment contains evidence.
- [ ] ML attribution available when computation succeeds.
- [ ] Root cause includes primary + alternatives.
- [ ] Recommended action generated.
- [ ] Peer evidence visible.
- [ ] Incident lifecycle persisted.
- [ ] Operator adjudication stored.

### FR-4 Self-healing and health

- [ ] Elevation-aware/residual-space imputation.
- [ ] Raw value never overwritten.
- [ ] Imputation provenance persisted.
- [ ] Observed/estimated distinction in UI.
- [ ] Per-sensor health index.
- [ ] Degradation projection clearly labelled as heuristic.

### FR-5 Platform

- [ ] RBAC and station isolation on every endpoint.
- [ ] QC configuration persistence + audit.
- [ ] Maintenance persistence.
- [ ] Offline buffer/replay.
- [ ] Real export SHA-256.
- [ ] Model drift monitoring.
- [ ] Gated retraining.
- [ ] Time-series storage path suitable for TimescaleDB.
- [ ] Model registry/versioning/rollback/model card.
- [ ] ≥10 fault types; target 12.

---

## 3. Non-Functional Requirements

These are **engineering targets**, not measured achievements unless a benchmark records them.

| ID | Target |
|---|---|
| NFR-1 | API dashboard p95 < 200 ms at 10 stations |
| NFR-2 | Full detection chain < 150 ms/observation |
| NFR-3 | Detection-to-incident latency within observation interval + chain target |
| NFR-4 | 10k-row station training < 30 s |
| NFR-5 | ≥100 obs/s single process target |
| NFR-6 | Dashboard refresh 5 s |
| NFR-7 | Backend <512 MB RSS at 10 stations |
| NFR-8 | zero raw-value UPDATE operations |
| NFR-9 | defined degraded mode for every external dependency |
| NFR-10 | 100% non-normal evidence payload coverage |
| NFR-11 | ≥72 h offline buffer at 1 obs/min |
| NFR-12 | state-changing actions attributable to actor + timestamp |
| NFR-13 | new station receives physics/QC verdict without model |
| NFR-14 | frontend first paint <2 s on demo laptop |

---

## 4. Canonical End-to-End Flow

```text
ACQUIRE
  ↓
NORMALISE
  ↓
SOURCE-TIMESTAMP DEDUPLICATE
  ↓
IMMUTABLE TELEMETRY INSERT
  ↓
L1 DATA INTEGRITY
  ↓
L2 PHYSICS
  ↓
L3 TEMPORAL
  ↓
L4 STATION-ADAPTIVE ML
  ↓
L5 MULTIVARIATE
  ↓
L6 SPATIAL
  ↓
L7 FUSION
  ↓
L8 EXPLAIN
  ↓
L9 IMPUTE IF ELIGIBLE
  ↓
L10 HEALTH
  ↓
INCIDENT DWELL/UPSERT
  ↓
LIVE API
  ↓
RETRAINING/DRIFT MONITOR
```

---

## 5. Data Contract

### Observation

```json
{
  "station_id": "AWS-001",
  "source_timestamp": "2026-09-17T10:00:00Z",
  "temperature": 28.4,
  "humidity": 78.1,
  "pressure": 1008.2,
  "battery_v": 12.4,
  "rssi_dbm": -71
}
```

### Assessment

```json
{
  "quality_state": "SUSPECT",
  "severity": "HIGH",
  "classification": "LOCALIZED_ANOMALY",
  "legacy_state": "LOCALIZED_ANOMALY",
  "anomaly_probability": 0.91,
  "confidence": 0.78,
  "evidence_completeness": 0.83,
  "readiness": {
    "tier": "TRAINED",
    "model_version": "v1.x",
    "climatology_source": "OWN_HISTORY"
  }
}
```

---

## 6. Detection Layer Specifications

### L1 — Data Integrity

**Checks**

- null/NaN/Inf;
- sentinel values;
- encoding errors;
- timestamp validity;
- duplicate conflicts;
- ADC saturation where raw counts exist.

**Hard-failure contract**

```text
quality_state = INVALID
WMO flag = 9
skip statistical ML
retain peer/imputation and health processing where possible
```

### L2 — Physics

**Hard checks**

- temperature outside defined physical bounds;
- RH outside permitted range;
- pressure outside defined station-level bounds;
- dew point ordering;
- gross hypsometric mismatch.

**Soft checks**

- dew-point depression;
- T/RH coupling;
- pressure tendency;
- wet-bulb sanity;
- rain/humidity coherence.

### L3 — Temporal

Detect:

- spike;
- permanent step;
- flatline;
- gradual drift;
- rate violation;
- noise burst.

All temporal windows operate on **distinct source observations**.

### L4 — Station-Adaptive ML

Required v2 feature space:

```text
z_T
z_H
z_P
dz_T
dz_H
dz_P
z_dpd
p_elev_resid
var3
persist
z_T_lag1
hour_phase
```

### L5 — Multivariate

Detect contradictory relationships between core parameters and derived thermodynamic quantities.

### L6 — Spatial

Use Haversine peer discovery and compare residuals, not raw measurements.

Spatial analysis is a subsystem of Fleet Intelligence. Fleet Intelligence also owns peer consensus, fleet-wide anomaly correlation, regional-event detection, fleet health, and fleet incident awareness.

### L7 — Fusion

```text
z = [z_qc, z_phys, z_temp, z_ml, z_multi, z_health]

logit = β0 + Σβi zi
P = sigmoid(logit)
```

Coefficients must be fitted from labelled injection evidence before being presented as calibrated.

An `anomaly_probability` field is model-derived and probability-like until calibration and reliability validation are demonstrated. It must not be presented as a validated real-world probability. `confidence` represents confidence/evidence strength and is capped by evidence completeness.

### L8 — Explainability

Return:

- observation;
- expected value;
- residual;
- layer evidence;
- ML attribution;
- peer evidence;
- fusion terms;
- root cause;
- alternatives;
- action;
- imputation;
- readiness.

### L9 — Imputation

Only when:

- localized/invalid;
- anomaly probability sufficiently high or value missing;
- ≥2 valid peers;
- peer spread acceptable;
- target has sufficient climatology.

Never impute a `REGIONAL_EVENT`.

### L10 — Health

Maintain separate health trajectories for:

- temperature;
- humidity;
- pressure;
- station power/link.

Regional events do not penalise health.

---

## 7. Station Readiness

| Tier | Gate | Behaviour |
|---|---|---|
| COLD_START | <72 observations | no IF |
| BASELINE | 72–720 | statistical baseline |
| TRAINED | ≥720 + ≥14 days | full model |
| MATURE | ≥4380 + ≥2 seasons | full model + stronger drift interpretation |

A production assessment must always expose its readiness tier.

---

## 8. Fleet Intelligence Requirements and Spatial Adjudication Rules

Fleet Intelligence shall:

- [ ] **FR-FLEET-001:** identify eligible peer stations using configured spatial and data-validity criteria;
- [ ] **FR-FLEET-002:** compare target and peer residuals rather than raw values;
- [ ] **FR-FLEET-003:** distinguish isolated station deviations from coherent multi-station deviations;
- [ ] **FR-FLEET-004:** expose insufficient peer evidence rather than fabricating consensus;
- [ ] **FR-FLEET-005:** preserve regional-event protection from sensor-health penalties and sensor-fault root causes.

Peer evidence may be incomplete because there are no nearby stations, too few valid peers, stale or unavailable telemetry, heterogeneous station exposure, or large station separation. In those cases, rely on station and physics evidence where appropriate, cap confidence/evidence strength, and do not claim a regional event solely from inadequate peer evidence.

### Normal

```text
local not unusual → NORMAL
```

### Localized anomaly

```text
local unusual
+ peers normal
→ LOCALIZED_ANOMALY
```

### Regional event

```text
local unusual
+ ≥2 valid peers
+ peer agreement threshold
+ majority peers also departing
+ same direction
+ persistent departure
→ REGIONAL_EVENT
```

### No peer

```text
local unusual
+ zero valid peers
→ LOCALIZED_ANOMALY_UNCONFIRMED
```

Never interpret missing peer evidence as disagreement.

---

## 9. Assessment Schema

### Three axes

```text
quality_state:
  VALID | SUSPECT | INVALID

severity:
  NONE | LOW | MEDIUM | HIGH | CRITICAL

classification:
  NORMAL
  LOCALIZED_ANOMALY
  LOCALIZED_ANOMALY_UNCONFIRMED
  REGIONAL_EVENT
```

### Severity

Use anomaly probability, persistence and number of implicated core parameters. Hard integrity/physics failures force `CRITICAL`.

---

## 10. Root Cause

### Required taxonomy

```text
COMMUNICATION_CORRUPTION
MISSING_DATA
SUPER_SATURATION_VIOLATION
POWER_SAG_BROWNOUT
SENSOR_FLATLINE
REGIONAL_WEATHER_FRONT
THERMAL_SPIKE
CALIBRATION_DRIFT
SENSOR_NOISE_DEGRADATION
NOMINAL
```

### Structural rule

If `classification == REGIONAL_EVENT`, do not emit sensor-fault root causes such as `THERMAL_SPIKE` or `CALIBRATION_DRIFT`.

---

## 11. Model Artifact

Every model must store:

```json
{
  "schema_version": 2,
  "station_id": "...",
  "model_version": "...",
  "readiness_tier": "TRAINED",
  "algorithm": {
    "name": "IsolationForest",
    "n_trees": 100,
    "subsample": 256,
    "random_seed": 20260917
  },
  "feature_space": {
    "version": 2,
    "names": ["z_T","z_H","z_P","dz_T","dz_H","dz_P","z_dpd",
              "p_elev_resid","var3","persist","z_T_lag1","hour_phase"]
  },
  "climatology": {},
  "training_data": {},
  "calibration": {},
  "fusion_coefficients_version": "...",
  "parent_version": "..."
}
```

### Compatibility

Legacy v1 artifacts must remain loadable until all demonstration stations have migrated.

---

## 12. Training Pipeline

```text
1. ingest
2. validate/readiness gate
3. clean contaminated history
4. fit climatology
5. generate residual features
6. train Isolation Forest
7. temporal holdout evaluation
8. threshold calibration
9. shadow validation
10. promotion gate
11. register
12. activate
```

### Training hygiene

Exclude:

- integrity failures;
- hard physics violations;
- extreme residual outliers according to the specified contamination rule.

Record all cleaning counts in the model card.

---

## 13. Fusion Calibration and Validation Status

The fault injection lab is the calibration corpus.

Required procedure:

1. generate labelled clean/fault windows;
2. record six evidence terms;
3. fit constrained logistic regression;
4. validate using station-grouped folds;
5. store coefficient version and validation metrics;
6. expose `fitted` vs `default_priors` in UI/API.

Until fitted, never describe default coefficients as measured.

All reported metrics in this specification are **controlled synthetic/fault-injection evaluation** unless explicitly identified otherwise. Synthetic evaluation demonstrates system behaviour on labelled scenarios; it does not establish field performance. Real labelled hardware-failure and real-event validation remains future work when suitable AWS datasets become available.

---

## 14. Imputation Contract

Preferred reconstruction:

```text
r_hat = Σ(wj*rj)/Σwj
wj = 1/dj²

x_hat = climatology_target + r_hat*sigma_target
```

Storage fields:

- station;
- source timestamp;
- parameter;
- raw value;
- imputed value;
- method;
- peer list;
- confidence;
- WMO flag;
- assessment;
- created timestamp.

---

## 15. Health Contract

The health layer produces:

```text
shi_temperature
shi_humidity
shi_pressure
shi_station
drift_rate + uncertainty band
variance ratio
30-day localized anomaly rate
degradation projection
maintenance recommendation
```

`REGIONAL_EVENT` must not reduce sensor health.

Do not display “RUL: X days”. Use a clearly labelled degradation projection with its method and limitations.

---

## 16. Database Specification

### Existing

```text
admins
stations
telemetry
model_registry
training_jobs
incidents
active_faults
station_qc_config
auth_audit_logs
```

### Required additions

```text
assessments
station_climatology
fusion_coefficients
imputations
sensor_health
drift_metrics
retraining_candidates
config_audit
maintenance_tasks
maintenance_audit
sensor_change_events
ingest_idempotency
shadow_scores
station_neighbours
```

### Telemetry rule

No code path may overwrite raw measurement columns.

---

## 17. API Authorization Matrix

| Route family | Admin | Station operator |
|---|---:|---:|
| health | public | public |
| login | public | public |
| own station reads | yes | yes |
| other station reads | yes | no |
| own station upload | yes | yes |
| station training | yes | permitted per project policy |
| rollback | yes | no |
| QC write | yes | no |
| incident adjudication for own station | yes | yes |
| fleet health | yes | no |
| incident delete | scoped admin only | no |
| fault injection | demo mode + scoped | demo mode + scoped |

No station-scoped endpoint may rely on frontend hiding alone.

---

## 18. Frontend Contract

### Contexts

```text
AuthContext
WeatherContext
AssessmentContext
```

### Authority rule

The backend assessment is the only production verdict.

Browser engines may only:

- preview training features;
- validate QC editor input;
- draw map geometry.

### Evidence panel

Must show:

```text
classification
probability
confidence
severity
readiness
evidence completeness

physics contribution
temporal contribution
model contribution
multivariate contribution
QC contribution
health contribution

target residual
peer residuals
agreement index

root cause
alternatives
recommended action

observed value
AI-estimated value, if available
```

---

## 19. Fault Injection Specification

| Fault | Expected interpretation |
|---|---|
| TEMP_SPIKE | localized thermal fault |
| TEMP_DRIFT | calibration drift |
| FLATLINE | sensor flatline |
| POWER_SAG | power-induced degradation |
| RH_SUPERSAT | physical/QC violation |
| REGIONAL_STORM | regional weather event |
| SENTINEL | communication/data corruption |
| MISSING | missing data |
| PRESSURE_OFFSET | pressure calibration fault |
| NOISE_BURST | sensor noise degradation |
| COMMS_DROPOUT | communication corruption |
| SEA_BREEZE | hard negative; should not create a sensor fault |

Every injection must record ground truth, expected class, observed class, severity and root cause.

---

## 20. Security Acceptance

- [ ] `alg:none` rejected.
- [ ] Signature verified before payload trust.
- [ ] `exp` and `iat` enforced.
- [ ] secret comes from environment.
- [ ] no insecure secret fallback.
- [ ] no plaintext passwords.
- [ ] no plaintext station access key storage.
- [ ] CORS restricted outside debug.
- [ ] login rate limiting implemented.
- [ ] station isolation matrix passes.
- [ ] fault injection disabled outside demo mode.

---

## 21. Testing Acceptance

### Detection

- [ ] sentinel cannot reach IF;
- [ ] physics hard gates work;
- [ ] flatline uses distinct source timestamps;
- [ ] residual spatial comparison works;
- [ ] regional event persistence works;
- [ ] zero-peer state is unconfirmed;
- [ ] storm cannot become sensor-fault root cause.

### Explainability

- [ ] non-normal evidence payload is non-empty;
- [ ] fusion terms reconstruct logit;
- [ ] SHAP/additivity assertion passes;
- [ ] alternatives are always present;
- [ ] confidence cannot exceed evidence completeness.

### Integrity

- [ ] raw telemetry immutable;
- [ ] imputation stored separately;
- [ ] exports contain raw + estimated fields;
- [ ] export hash independently verifies.

### MLOps

- [ ] training reproducible;
- [ ] model card complete;
- [ ] rollback changes scoring;
- [ ] candidate cannot activate without gate;
- [ ] v1 artifacts still load.

---

## 22. Demo Acceptance

Before judging:

- [ ] ≥5 stations configured with meaningful geographic/elevation variation;
- [ ] adequate historical data seeded;
- [ ] models at appropriate readiness;
- [ ] fusion coefficients clearly labelled;
- [ ] `DEMO_MODE=true`;
- [ ] deterministic replay works;
- [ ] database backup/restore tested;
- [ ] full demo rehearsed twice;
- [ ] no live external API is required for the critical path.

### Required visual proof

**Scenario A — sensor fault**

```text
Target: +5σ from own normal
Peers: ~0σ
Classification: LOCALIZED_ANOMALY
Root cause: sensor fault hypothesis
Imputation: available if criteria pass
```

**Scenario B — regional weather**

```text
Target: +/− abnormal residual
Peers: same-direction abnormal residuals
Classification: REGIONAL_EVENT
Root cause: weather event
Imputation: disabled
Sensor health penalty: disabled
```

---

## 23. Measured Results and Honesty

The uploaded evaluation material reports controlled synthetic-fault results including:

- precision 0.839;
- point recall 0.502;
- F1 0.628;
- false positive rate 0.0102;
- event-level recall 35/36;
- root-cause accuracy 0.844–0.878;
- latency 1.24 ms mean / 1.40 ms p95;
- approximately 805 observations/s;
- 70 tests passed.

**These must be presented as controlled synthetic evaluation results, not field validation.**

The material also explicitly states that confidence is not yet a validated probability and that real labelled hardware-failure validation does not exist.

---

## 24. Implementation Priority

### P0

- [ ] Security/authorization.
- [ ] Source-timestamp correctness.
- [ ] Assessment schema.
- [ ] Evidence API.
- [ ] Evidence UI.
- [ ] Regional-event hardening.
- [ ] Fault-root-cause suppression.
- [ ] Demo replay.
- [ ] Adequate historical seed.

### P1

- [ ] Residual climatology.
- [ ] Residual-space peers.
- [ ] Readiness tiers.
- [ ] Training hygiene.
- [ ] Fusion calibration.
- [ ] Full fault ledger.
- [ ] Benchmark runner.
- [ ] Drift monitoring.
- [ ] Offline edge sync.
- [ ] Export hashing.
- [ ] Maintenance persistence.
- [ ] JS-engine demotion.
- [ ] Incident idempotency/dwell.
- [ ] Per-sensor health.

### P2 / Future

- [ ] neighbour cache;
- [ ] spatial grid;
- [ ] automated retraining;
- [ ] reference ESP32 firmware;
- [ ] production observability;
- [ ] institutional real-data integration;
- [ ] survival-model RUL after real failure data;
- [ ] federated learning only when justified by fleet scale.

---

## 25. Final Definition of Done

The implementation is ready for SIH demonstration when:

1. invalid data cannot contaminate ML;
2. every station-scoped endpoint is isolated;
3. source timestamps govern temporal logic;
4. local abnormality and regional causality are separate;
5. evidence is visible and auditable;
6. raw measurements are immutable;
7. regional weather is not blamed on sensors;
8. no-peer cases disclose uncertainty;
9. imputation is provenance-preserving;
10. model readiness is visible;
11. model promotion is gated;
12. incidents are idempotent;
13. demo replay is deterministic;
14. all displayed performance numbers are traceable to a benchmark;
15. limitations are visible and accurately described.
