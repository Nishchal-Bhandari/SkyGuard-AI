# SkyGuard-AI — Implementation Specification Sheet

**Document type:** Single source of truth for completing SkyGuard-AI
**Target:** Smart India Hackathon 2026 — Problem Statement 073
**Derived from:** `PROGRESS.md` v2.1.0 (generated 2026-09-16, 745 lines)
**Spec version:** 1.0
**Status of this document:** Implementation blueprint. Not a status report.

---

## 0. How To Use This Document

### 0.1 Reading order for the implementing agent

1. Read §3 (Current Project State) and §3.5 (Verification Protocol) **before writing any code**.
2. Run the verification protocol in §3.5. It takes ~30 minutes and prevents the single largest failure mode: re-implementing something that already works, or building on top of something that does not.
3. Read §5 (Architecture Principles). Every later decision in this document follows from those five principles.
4. Then work strictly in priority order from §35 (P0 → P1 → P2).

### 0.2 Evidence labels used throughout

Every claim in this specification carries one of the following labels. They are not decorative — they tell you what you may rely on.

| Label | Meaning |
|---|---|
| `[IMPLEMENTED]` | `PROGRESS.md` states this exists. **Not independently verified** — this specification had no repository access. |
| `[VERIFY]` | Claimed to exist but must be confirmed against source before it is relied upon. Verification steps given in §3.5. |
| `[GAP]` | `PROGRESS.md` explicitly states this is missing or incomplete. |
| `[DEFECT]` | A bug, security hole, or architectural weakness identified by analysis of `PROGRESS.md`. Some are listed in the report; some are **new findings** from this analysis and are marked `[DEFECT — NEW]`. |
| `[SPEC]` | New design defined by this document. Must be built. |
| `[PROPOSED]` | Recommended but optional. Justification given; skipping it is a legitimate choice. |
| `[FUTURE]` | Explicitly out of scope for SIH. Do not build now. Recorded so it is not lost. |

### 0.3 Verification status — read this with `VERIFICATION.md`

**Update, 2026-09-16:** the repository has since been inspected directly and the §3.5 protocol executed. Results are in the companion document **`VERIFICATION.md`**, which supersedes this specification wherever the two disagree. It records twelve protocol outcomes, three false claims in `PROGRESS.md`, six new defects (four P0, one of them a complete authentication bypass), a revised P0 list, and seven items in this specification that are now cancelled or reduced because the code proved better than assumed.

**Read `VERIFICATION.md` first.** In particular, four small defects (N11–N14) mean the detection pipeline is currently partly decorative; they must be fixed before any of the ML work in §10 is worth doing.

The original caveat below still explains how the labels in this document were assigned.

This document was produced from `PROGRESS.md` only. **The repository was not available for inspection at the time of writing.** `PROGRESS.md` is described as auto-generated from a full source inspection, which makes it a strong source of truth for *what files exist and what they are named*, and a weaker source of truth for *whether a thing labelled WORKING actually works end to end*.

Therefore:

- No status label in `PROGRESS.md` is treated as verified in this document.
- Where `PROGRESS.md` says WORKING, this document says `[IMPLEMENTED]` and, if the claim is load-bearing for the demo, `[VERIFY]`.
- **No performance number, accuracy figure, latency measurement, or model quality claim appears anywhere in this document as fact.** Where numbers appear they are either (a) engineering targets, explicitly labelled as such, or (b) configuration defaults to be tuned.

---

## 1. Executive Summary

### 1.1 What SkyGuard-AI is

SkyGuard-AI is a real-time quality-control and anomaly-intelligence platform for a network of Automatic Weather Stations. It ingests temperature, atmospheric pressure and relative humidity (plus supporting engineering telemetry), and for every observation answers three questions in order:

1. **Is this observation trustworthy?** (data integrity, physics, temporal behaviour, station-adaptive ML)
2. **If not — is the sensor broken, or is the weather genuinely doing this?** (spatial adjudication against neighbouring stations)
3. **What should the operator do about it?** (explainable evidence, root-cause hypothesis, recommended action, optional reconstructed value, sensor health trajectory)

Question 2 is the project's central technical claim and the thing the SIH demonstration must prove.

### 1.2 The central architectural idea: station-adaptive models

Every station trains its own anomaly model. There is no shared global model. A coastal station at 30 m elevation in Mangaluru and a Western Ghats station at 900 m have different diurnal ranges, different humidity floors, different pressure baselines and different sensor ageing. A single global model would learn the average of these and flag the tails of every station's *normal* behaviour.

This principle is **preserved and strengthened** by this specification. It is extended in one important way (§10.4): the ML layer is moved from raw values to **residuals against each station's own learned climatology**, which makes the per-station idea explicit in the feature space rather than implicit in the training data.

### 1.3 What already exists

Substantial working implementation `[IMPLEMENTED]`: FastAPI backend with ~30 endpoints, dual-role authentication with RBAC, SQLite/PostgreSQL dual-mode storage, a pure-Python Isolation Forest with an 8-stage training lifecycle and versioned model registry with rollback, thermodynamic validation, TreeSHAP explainability, Haversine + MAD spatial consensus, IDW imputation, sensor health indexing, an 8-class root-cause classifier, a 6-type fault injection lab, incident creation and adjudication, an Open-Meteo background poller, and a 13-view React dashboard.

**This must not be rewritten.** See §3.4.

### 1.4 What this specification changes

> **Superseded in part by `VERIFICATION.md` §4**, which adds six further defects found by direct code inspection — including N10, a hardcoded JWT secret committed to the public repository that permits forging admin tokens for any deployment. The nine issues below were inferred from `PROGRESS.md`; of them, N1, N2, N3, N7 and N8 are confirmed by inspection, N4 is confirmed and worse, N5 is confirmed but harmless (the JS engines are dead code), and N6 and N9 stand as written.

Eight gaps are named in `PROGRESS.md` and are fully specified here (§28). Beyond those, this analysis identifies **nine additional issues** that `PROGRESS.md` does not flag, four of which are P0:

| # | Finding | Severity | Section |
|---|---|---|---|
| N1 | `DELETE /incidents` and `GET /incidents` carry *Optional* auth — unauthenticated fleet-wide incident deletion | **P0 — security** | §27.4 |
| N2 | Nine endpoints carry *Optional* auth, contradicting the "operators strictly isolated" claim. Station isolation is not actually enforced on read paths | **P0 — security** | §27.4 |
| N3 | The proposed fix for the QC 401 bug (make the endpoint public) is the wrong fix and would widen N2 | **P0** | §28.8 |
| N4 | Open-Meteo updates hourly but the poller runs every 20 s — the same value is re-observed ~180×. Any flatline/variance logic that counts poll ticks instead of distinct source timestamps is measuring the API, not the sensor | **P0 — correctness** | §12.4 |
| N5 | Business logic is duplicated in Python (`ml/`) and JavaScript (`src/utils/mlEngine.js`, `qcEngine.js`, `spatialEngine.js`) with no contract test. Divergence is silent and will surface during the demo | **P1** | §26.3 |
| N6 | Fusion weights (35/35/20/10 in `qcEngine.js`) are unjustified constants. The fault-injection lab is the obvious calibration set and is not being used as one | **P1** | §14 |
| N7 | Spatial consensus compares **raw values** between stations of differing elevation and microclimate. Peers at different elevations can never agree on raw temperature; comparison must be in residual space | **P1 — correctness** | §13.4 |
| N8 | Minimum 20 records to train is far too few for a model whose features include diurnal phase. A model trained on <1 day of data cannot have learned a diurnal cycle | **P1 — correctness** | §10.7 |
| N9 | RUL is extrapolated from a health index by exponential decay and presented in days. This is a heuristic, not a prediction, and must be labelled as one | **P1 — honesty** | §18.5 |

### 1.5 The one-sentence quality bar

> A senior engineer opening this repository with this document should be able to finish SkyGuard-AI without making a single architectural guess.

---

## 2. Problem Statement and Scope

### 2.1 Official problem context (PS-073)

Automatic Weather Stations continuously monitor atmospheric parameters and feed weather forecasting, climate monitoring, disaster management, aviation, agriculture and scientific research. Their observations can be corrupted by sensor malfunction, communication failure, calibration drift, power fluctuation, harsh environmental exposure, and data corruption. Erroneous observations propagate into forecasts and decisions. Fixed-threshold quality control cannot catch complex or hidden anomalies.

### 2.2 Required solution

An AI/ML system that identifies abnormal, inconsistent or faulty AWS observations in real time from **temperature, atmospheric pressure and relative humidity**, distinguishes genuine meteorological events from sensor and data anomalies, minimises false alarms, and scales across a large observation network.

### 2.3 The grand challenge, translated into engineering

> *"Can AI build a self-aware and self-healing weather observation network capable of delivering trustworthy atmospheric data under all environmental conditions?"*

This is not treated as a slogan. It decomposes into four testable capabilities:

| Slogan term | Concrete technical requirement | Where specified | How it is proven |
|---|---|---|---|
| **Self-aware** | Every station maintains a health state derived from measured drift, variance collapse, power and link quality, and its own anomaly history — and the system reports *how confident it is in its own judgement*, including when it has no peers to check against | §18, §14.6 | Health index visibly degrades under injected `POWER` and `DRIFT` faults; `UNCONFIRMED` state appears when peers are unavailable |
| **Self-healing** | Flagged observations receive a reconstructed estimate from spatial neighbours with elevation correction, stored alongside — never over — the raw value, with method and confidence recorded | §17 | Imputed value appears in HUD under a distinct WMO flag 3; raw value remains retrievable via API |
| **Trustworthy data** | Every published observation carries a quality flag, an anomaly probability, a calibrated confidence, and a full evidence chain | §15 | Explainability payload is non-empty for 100% of non-NORMAL assessments |
| **Under all conditions** | Every external dependency has a defined degraded mode; no single failure crashes a station's pipeline | §33.7 (reliability matrix) | Chaos tests in §29.6 |

### 2.4 Parameter scope

**Core PS-073 parameters** — these drive detection, classification and all headline claims:

| Parameter | Unit | Role |
|---|---|---|
| Air temperature | °C | Primary |
| Atmospheric pressure | hPa | Primary |
| Relative humidity | % | Primary |

**Supporting contextual telemetry** — already present in the implementation. It is **retained**, but it is scoped as *diagnostic evidence*, never as a primary detection target:

| Signal | Diagnostic contribution |
|---|---|
| Battery voltage | Distinguishes a sensor fault from a power-induced fault (`POWER_SAG_BROWNOUT`). A brownout explains simultaneous multi-sensor degradation that would otherwise look like three independent failures |
| RSSI / link quality | Distinguishes corrupted transmission from bad measurement. Low RSSI + impossible value ⇒ `COMMUNICATION_CORRUPTION`, not sensor failure |
| Wind speed | Physical context: strong wind suppresses nocturnal inversion, which explains temperature behaviour that would otherwise look anomalous |
| Rainfall | Physical context: rain onset causes legitimate simultaneous temperature drop + humidity spike. Without it, a genuine squall looks like a correlated two-sensor fault |
| Elevation | Required for hypsometric pressure validation and for lapse-rate-corrected peer comparison and imputation |
| GPS coordinates | Required for peer discovery |
| Timestamp | Required for every temporal and idempotency mechanism |

**Rule:** supporting telemetry may *explain*, *confirm* or *suppress* a core-parameter finding. It may not, on its own, create a PS-073 anomaly. A flat battery is a maintenance event, not a data anomaly — though it is a strong prior that one is coming.

### 2.5 Explicit non-goals

- Weather **forecasting**. SkyGuard-AI judges observations; it does not predict weather.
- Replacing IMD operational QC. This is a decision-support and pre-screening layer.
- Physical sensor calibration. The system detects drift; it does not correct the hardware.
- Running the full detection stack on an ESP32. See §23.1 for what actually runs where.

---

## 3. Current Project State

### 3.1 Summary of what exists

Derived from `PROGRESS.md`. All entries `[IMPLEMENTED]` unless marked.

**Backend** — FastAPI + Uvicorn, Python. Modules: `main.py` (entry, DB init, weather poller), `config.py`, `api/v1/{auth,stations,telemetry,models,faults,incidents}.py`, `auth/security.py`, `services/{training_service,weather_service,model_storage}.py`, `storage/database.py` (64 KB, all SQL, SQLite + PostgreSQL dual mode).

**ML** — `ml/station_adaptive_pipeline.py` (Isolation Forest), `thermo_engine.py`, `shap_engine.py`, `spatial_engine.py`, `imputation_engine.py`, `sensor_health.py`, `root_cause_classifier.py`, `models/` (JSON artifacts). Zero external ML libraries — no numpy, pandas or scikit-learn.

**Frontend** — React 18.3 + Vite 6, 13 views, 3 modals, Context API (`AuthContext`, `WeatherContext`), Leaflet 1.9 map, Chart.js 4.4, vanilla CSS cyberpunk theme, plus JS mirrors of the ML/QC/spatial engines.

**Database** — 9 SQLite tables: `admins`, `stations`, `telemetry`, `model_registry`, `training_jobs`, `incidents`, `active_faults`, `station_qc_config`, `auth_audit_logs`.

**Auth** — hand-rolled HMAC-SHA256 JWT, PBKDF2-HMAC-SHA256 at 100 000 iterations, 24-hour expiry, two roles (admin, station operator), audit log table.

**Live data** — Open-Meteo polled every 20 s in a batched multi-station request; per-station fault injection applied to the fetched values; full scoring chain run per station; incidents created and auto-resolved; in-memory `live_state` served at `/stations/fleet/live`.

### 3.2 What is explicitly incomplete (from `PROGRESS.md` §15–16)

| # | Gap | Stated impact | Spec |
|---|---|---|---|
| G1 | QC rule editing not persisted; no `PUT /stations/{id}/qc` | Medium | §28.1 |
| G2 | Maintenance checklist in React memory only | Low | §28.2 |
| G3 | Edge sync is an `alert()` simulation | Low | §28.3 |
| G4 | Export SHA-256 hash is a hardcoded string | Low | §28.4 |
| G5 | No drift detection logic (only a seed constant) | Medium | §28.5 |
| G6 | No automated retraining trigger | Medium | §28.6 |
| G7 | Telemetry is a plain table even in PostgreSQL mode | Low now, High at scale | §28.7 |
| G8 | `GET /stations/{id}/qc` returns 401 in HUD | Medium | §28.8 |
| G9 | CORS `allow_origins=["*"]` | Medium | §27.5 |
| G10 | `psycopg2-binary` required even in SQLite mode | Low | §28.9 |
| G11 | `alert()` / `prompt()` used instead of modals | Low | §26.6 |

### 3.3 New findings — issues `PROGRESS.md` does not flag

These emerged from analysing the endpoint table, the fusion weights, the data source cadence and the ML configuration against each other. Each is specified in full later; this is the index.

**N1 — Unauthenticated incident destruction `[DEFECT — NEW] [P0]`**
`DELETE /incidents` is listed with `Optional` auth. If `Optional` means "no token required", any unauthenticated caller can wipe the entire fleet's incident history — including live during a demo. Same exposure on `GET /incidents` (fleet-wide anomaly data disclosure). → §27.4

**N2 — Station isolation is not enforced on read paths `[DEFECT — NEW] [P0]`**
Nine endpoints are marked `Optional`: `GET /stations/{id}`, `/stations/{id}/telemetry/stats`, `/stations/fleet/live`, `/stations/{id}/training-jobs/{job_id}/status`, `/stations/{id}/training-jobs`, `/stations/{id}/models`, `/stations/{id}/models/active`, `GET /incidents`, `GET /incidents/{id}`. `PROGRESS.md` §14 simultaneously asserts "Station operators strictly isolated to their own station." Both cannot be true. Most likely the frontend never requests another station's data, so isolation is *presentational*, not enforced. An operator changing a station ID in a URL or calling the API directly defeats it. → §27.4

**N3 — The proposed QC auth fix is wrong `[DEFECT — NEW] [P0]`**
`PROGRESS.md` recommends changing `get_current_user` → `get_optional_user` on the QC endpoint. That converts a 401 bug into a tenth unauthenticated endpoint. The real root cause is a missing or mistimed token on the HUD's request path. → §28.8

**N4 — Poll cadence vs source cadence mismatch `[DEFECT — NEW] [P0]`**
Open-Meteo publishes hourly values. The poller runs every 20 s — roughly 180 polls per distinct source observation. Two consequences:
 (a) Any variance/flatline/rate-of-change computation that operates on poll ticks is measuring API repetition, not sensor behaviour. A perfectly healthy station will look frozen.
 (b) Incident dwell logic and anomaly-rate statistics computed per poll tick are inflated ~180×.
The fix is mandatory and cheap: deduplicate on the **source observation timestamp**, and run all temporal logic on the distinct-observation series. → §12.4

**N5 — Dual implementation without a contract test `[DEFECT — NEW] [P1]`**
`mlEngine.js`, `qcEngine.js` and `spatialEngine.js` reimplement Python logic in the browser. Two engines drifting apart is a matter of when. The demo risk is specific: the HUD shows one assessment, the incident record shows another, and a judge notices. → §26.3

**N6 — Unjustified fusion weights `[DEFECT — NEW] [P1]`**
`qcEngine.js` uses rule 35% / model 35% / spatial 20% / health 10%. No derivation. The brief explicitly forbids arbitrary weights. Worse, treating spatial as a linear +20% is structurally wrong: peer agreement should *change the classification* (sensor fault vs weather event), not nudge a score. → §14

**N7 — Spatial consensus on raw values `[DEFECT — NEW] [P1]`**
Comparing a 30 m coastal station's raw temperature to a 900 m ghat station's raw temperature with median + MAD will show permanent disagreement of several °C, because the lapse rate alone accounts for ~5.9 °C. Either the radius is small enough that this never bites (fragile), or `LOCALIZED_ANOMALY` is being produced by geography. Comparison must be in **anomaly-residual space**. → §13.4

**N8 — 20-record training minimum `[DEFECT — NEW] [P1]`**
Feature vector includes diurnal sine/cosine. 20 hourly records is under one day. A model fit on that has seen one value of each diurnal phase and has learned nothing about the cycle; worse, it will treat night-time temperatures as anomalous if trained on a daytime window. → §10.7

**N9 — RUL presented as a prediction `[DEFECT — NEW] [P1]`**
"Estimates RUL from SHI using exponential decay" is a monotone transform of a heuristic index into a number of days. It has no survival model, no failure data, and no validation. Presenting it as *remaining useful life in days* is the kind of claim the brief explicitly forbids. → §18.5

### 3.4 What must NOT be rewritten

Hard rule. Touching any of these without an explicit written justification is a spec violation.

| Component | Why it stays |
|---|---|
| FastAPI backend | Async-native, fits the poller and the ingest path, already integrated with the frontend contract |
| React + Vite frontend, 13 views | Substantial, working, and the visual identity is an evaluation asset |
| Pure-Python ML stack (no numpy/sklearn) | This is a genuine deployability advantage — it installs anywhere, runs in constrained environments, and removes a large dependency surface. It also makes the "edge-adjacent gateway" story credible. Do not swap it for scikit-learn |
| Per-station Isolation Forest | The core differentiator. Improve the features and thresholds; do not replace the paradigm |
| SQLite + PostgreSQL dual mode | Correct: zero-setup local demo, real scaling path |
| Custom HMAC-SHA256 JWT | Keep, but harden per §27.3. Adding PyJWT is optional, not required |
| Cyberpunk visual identity | Keep. Improve information hierarchy only (§26.5) |
| Model registry, versioning, rollback | Already the right design |
| 8-stage training lifecycle | Excellent for demonstration; extend it (§22), do not replace it |
| Fault injection lab | Becomes the evaluation and weight-calibration backbone (§14.5, §30) |

### 3.5 Verification Protocol — run this first `[VERIFY] [P0]`

> **Executed 2026-09-16. Results in `VERIFICATION.md` §1.** V1, V3, V6, V10, V11 passed; V2 and V7 partially passed; V4, V5, V8 and V12 failed. The table below is retained as the method; `VERIFICATION.md` has the findings.

**Timebox: 30 minutes.** Record results in `VERIFICATION.md` at repo root. Do not begin implementation until this is complete; several tasks below change scope depending on the outcome.

| # | Claim to verify | Method | If it fails |
|---|---|---|---|
| V1 | Does the ML anomaly score actually reach the UI, or does the HUD compute its own via `mlEngine.js`? | In `StationHUD.jsx`, trace the source of the displayed anomaly score. Grep for `mlEngine` imports in views | This is the single most important verification. If the UI scores locally, the backend ML is decorative → §26.3 becomes P0 |
| V2 | Does fault injection reach the *scoring* path or only the *display* path? | Inject a SPIKE via API, then read `/stations/{id}/score` and the `incidents` table directly in SQLite | If it only affects `live_state`, the entire demo narrative is theatre → P0 rewrite of the injection hook |
| V3 | Are incidents created from real evidence? | After V2, inspect `incidents.evidence_data` JSON. Confirm it contains actual computed scores, not templated text | If templated → P0, §19 |
| V4 | What does `Optional` auth actually do? | Read `get_optional_user`. Then `curl -X DELETE localhost:8000/api/v1/incidents` with **no** Authorization header | If it succeeds → N1 confirmed, fix immediately |
| V5 | Does the poller deduplicate by source timestamp? | Read `weather_service.py`; check whether the Open-Meteo response timestamp is compared against the last stored one | If not → N4 confirmed → §12.4 |
| V6 | Is the Isolation Forest scoring formula the standard one? | Read `station_adaptive_pipeline.py`; look for the path-length normalisation `c(n) = 2H(n−1) − 2(n−1)/n` and `s = 2^(−E[h(x)]/c(n))` | If ad-hoc → §10.5 |
| V7 | Does SHAP run on the real trees or return static weights? | Read `shap_engine.py`; confirm it traverses the fitted trees | If static → §15.4 |
| V8 | Is spatial comparison on raw values? | Read `spatial_engine.py`; check whether elevation/climatology correction is applied before the MAD test | If raw → N7 confirmed → §13.4 |
| V9 | Do the Python and JS engines agree? | Run one fixed observation vector through both, compare scores | Divergence → N5 confirmed → §26.3 |
| V10 | Does `calibrate_station_qc()` run on raw or QC-filtered history? | Read the function | If raw, envelopes are contaminated by the anomalies they must catch → §11.5 |
| V11 | Do the existing tests pass? | `pytest backend/tests ml/` | Fix before adding features |
| V12 | Does the minimum-20-record gate actually block, or warn? | Read training stage 2 | Informs §10.7 |


---

## 4. Existing Architecture

### 4.1 Component map

```
                        ┌──────────────────────────────┐
                        │  Open-Meteo API (hourly)     │
                        └──────────────┬───────────────┘
                                       │ batched, polled 20s  [N4: cadence mismatch]
                                       ▼
┌──────────────┐        ┌──────────────────────────────────────────────┐
│ CSV / JSON   │───────▶│  weather_service.py  (async background task) │
│ upload       │        │  fetch → fault inject → QC → ML → thermo →   │
└──────────────┘        │  spatial → health → impute → root cause →    │
                        │  incident upsert → live_state                │
                        └──────┬───────────────────────────┬───────────┘
                               │                           │
                     ┌─────────▼─────────┐      ┌──────────▼──────────┐
                     │  ml/  engines     │      │ storage/database.py │
                     │  IF · thermo ·    │      │ SQLite | PostgreSQL │
                     │  SHAP · spatial · │      │ 9 tables            │
                     │  impute · health ·│      └──────────┬──────────┘
                     │  root cause       │                 │
                     └───────────────────┘                 │
                               ▲                           │
                     ┌─────────┴───────────────────────────▼──────────┐
                     │  FastAPI  /api/v1/*   (auth · RBAC guards)     │
                     └─────────────────────┬──────────────────────────┘
                                           │ JSON + Bearer
                     ┌─────────────────────▼──────────────────────────┐
                     │  React 18 + Vite                               │
                     │  AuthContext · WeatherContext (5s poll)        │
                     │  13 views · 3 modals · Leaflet · Chart.js      │
                     │  + JS mirrors: mlEngine / qcEngine / spatial   │  [N5: duplication]
                     └────────────────────────────────────────────────┘
```

### 4.2 Existing ML engine inventory

| Engine | File | What it does per `PROGRESS.md` | Spec action |
|---|---|---|---|
| Isolation Forest | `ml/station_adaptive_pipeline.py` | Per-station ensemble, 8D features (T, H, P, lag-1, rate-of-change, dew point, diurnal sin/cos), pure Python | **Improve** — §10: residual features, readiness tiers, robust contamination, calibrated threshold |
| Thermodynamics | `ml/thermo_engine.py` | Magnus-Tetens saturation vapour pressure, dew point, hypsometric correction, LCL, wet bulb (Stull), MALR | **Keep** — §11. Split hard vs soft violations |
| SHAP | `ml/shap_engine.py` | TreeSHAP feature attribution | **Keep, verify** (V7) — §15 |
| Spatial | `ml/spatial_engine.py` | Haversine, ≤50 km peer discovery, median + MAD, dual-track fusion | **Fix** — §13.4 residual-space comparison |
| Imputation | `ml/imputation_engine.py` | IDW + 6.5 °C/km lapse rate, hypsometric pressure compensation, thermo fallback, WMO flag 3 | **Keep, extend** — §17 provenance record |
| Sensor health | `ml/sensor_health.py` | SHI 0–100 from battery/RSSI/drift/flatline penalties; RUL by exponential decay | **Keep SHI, relabel RUL** — §18.5 |
| Root cause | `ml/root_cause_classifier.py` | 8-class taxonomy | **Keep, formalise** — §16 |

### 4.3 Existing detection semantics

Current output states: `NORMAL`, `SUSPECT`, `CRITICAL`, `LOCALIZED_ANOMALY`, `REGIONAL_EVENT`, plus `EXTREME` on the Command Center.

`[DEFECT — NEW]` These five values conflate **two independent axes**. `CRITICAL` is a severity; `REGIONAL_EVENT` is a causal attribution. A regional cyclone can be both `CRITICAL` and `REGIONAL_EVENT`, but the current single-enum model forces a choice. §14.7 separates them into `quality_state` × `severity` × `classification` while retaining a derived backward-compatible single field.

---

## 5. Architecture Principles

These five principles resolve every design dispute in this document. When a later section seems ambiguous, apply them in order.

### P1 — Evidence over thresholds
No single check may, on its own, produce an operator-facing alert — with exactly two exceptions: **data-integrity failure** and **physical impossibility**, which are deterministic facts and not statistical judgements. Everything else must survive evidence fusion (§14).
*Why:* "temperature > 45 °C ⇒ anomaly" is precisely the traditional QC that PS-073 says is insufficient. 45 °C is routine in Vidarbha in May and impossible in Mangaluru in July. Fixed thresholds encode neither.

### P2 — The station is the unit of normality
Baselines, thresholds, models, contamination estimates and drift references are per station. Global constants are permitted only for physical laws and encoding validity.
*Why:* this is the project's differentiator and the honest answer to microclimate variance.

### P3 — Separate "is it unusual?" from "is the sensor broken?"
Layers 1–5 answer the first question using only the station's own data. Layer 6 (spatial) answers the second by asking whether the region agrees. They must remain separable in code, in the data model and in the UI.
*Why:* this is the central innovation; if the two are entangled in one score, it cannot be demonstrated and cannot be debugged.

### P4 — Never destroy an observation
Raw values are immutable. Quality flags, anomaly assessments, corrections and audits are additive records referencing the raw observation.
*Why:* meteorological archives are scientific records. A system that silently overwrites is unusable by any real met service, and an auditable trail is a genuine differentiator in judging.

### P5 — Degrade, never crash
Every external dependency (weather API, peer stations, model artifact, database, network) has a defined fallback that preserves partial function. A station with no trained model still gets physics + QC. A station with no peers still gets a verdict, marked `UNCONFIRMED`.
*Why:* "trustworthy under all environmental conditions" is the grand challenge. A pipeline that throws on a missing model has failed it.

### 5.6 Anti-principles (explicitly rejected)

- ❌ Replace the pure-Python ML with scikit-learn "because it's standard". The dependency-free property is an asset; the IF algorithm is ~200 lines.
- ❌ Introduce Kafka / Spark / Airflow / Kubernetes for a fleet of demo stations. §32 shows the scaling path without them.
- ❌ Deep learning (LSTM/Transformer autoencoders) for anomaly detection here. With sparse per-station history and a requirement for explainability and CPU-cheap inference, they are strictly worse. Noted as `[FUTURE]` in §38 with the conditions under which they'd become justified.
- ❌ A universal cross-station model. Permitted only as an optional *prior* for cold-start stations (§10.7), never as the production scorer.

---

## 6. Functional Requirements

Requirement IDs are referenced by tests in §29 and acceptance criteria in §36.

### 6.1 Ingestion

| ID | Requirement | Status |
|---|---|---|
| FR-1.1 | Accept CSV upload with automatic column detection across header variants | `[IMPLEMENTED]` |
| FR-1.2 | Accept JSON upload (body or file) | `[IMPLEMENTED]` |
| FR-1.3 | Normalise units: K→°C, Pa→hPa, dew point→RH via Magnus-Tetens | `[IMPLEMENTED]` |
| FR-1.4 | Parse multiple timestamp formats; store UTC | `[IMPLEMENTED]` |
| FR-1.5 | Reject rows whose `station_id` does not match the target station | `[IMPLEMENTED]` |
| FR-1.6 | Deduplicate on `(station_id, source_timestamp)` | `[IMPLEMENTED]` `[VERIFY]` |
| FR-1.7 | Ingest live observations, deduplicating by **source** timestamp, not poll time | `[SPEC]` §12.4 |
| FR-1.8 | Accept batched offline-buffered uploads idempotently | `[SPEC]` §23.4 |
| FR-1.9 | A malformed row must not abort the batch; it is quarantined with a reason | `[SPEC]` §33.7 |

### 6.2 Detection

| ID | Requirement | Status |
|---|---|---|
| FR-2.1 | Detect missing, NaN, sentinel (−999, 65535) and impossible encodings | `[IMPLEMENTED]` |
| FR-2.2 | Validate physical ranges per parameter, station-adaptive | `[IMPLEMENTED]` |
| FR-2.3 | Validate thermodynamic consistency (dew point ≤ T, RH ≤ 100, hypsometric pressure) | `[IMPLEMENTED]` |
| FR-2.4 | Detect spikes / rate-of-change violations | `[IMPLEMENTED]` |
| FR-2.5 | Detect flatlines on **distinct source observations** | `[SPEC]` §12.4 |
| FR-2.6 | Detect gradual calibration drift over days | `[IMPLEMENTED]` `[VERIFY]` |
| FR-2.7 | Score against a station-specific trained model | `[IMPLEMENTED]` |
| FR-2.8 | Learn diurnal and seasonal normal patterns explicitly | `[SPEC]` §12.2 |
| FR-2.9 | Detect multivariate inconsistency (T↔H, T↔P, H↔dew point, P↔elevation) | `[IMPLEMENTED]` partial → §11.4 |
| FR-2.10 | Compare against geographic peers in residual space | `[SPEC]` §13.4 |
| FR-2.11 | Fuse all evidence into one calibrated probability | `[SPEC]` §14 |
| FR-2.12 | Distinguish `LOCALIZED_ANOMALY` from `REGIONAL_EVENT` | `[IMPLEMENTED]` → hardened §13.5 |
| FR-2.13 | Require persistence (dwell) before non-critical alerting | `[SPEC]` §14.8 |
| FR-2.14 | Produce a verdict even with zero peers, marked `UNCONFIRMED` | `[SPEC]` §13.6 |

### 6.3 Explanation and action

| ID | Requirement | Status |
|---|---|---|
| FR-3.1 | Every non-NORMAL assessment carries a complete evidence payload | `[SPEC]` §15.2 |
| FR-3.2 | Feature-level attribution for the ML contribution | `[IMPLEMENTED]` `[VERIFY]` |
| FR-3.3 | Root-cause hypothesis with confidence and a ranked alternative | `[IMPLEMENTED]` → §16 |
| FR-3.4 | Human-readable recommended action | `[IMPLEMENTED]` |
| FR-3.5 | Peer evidence shown explicitly, including disagreement magnitude | `[IMPLEMENTED]` |
| FR-3.6 | Incident lifecycle: open → acknowledged → adjudicated → resolved | `[IMPLEMENTED]` |
| FR-3.7 | Operator adjudication is recorded and feeds evaluation | `[IMPLEMENTED]` → §30.6 |

### 6.4 Self-healing and health

| ID | Requirement | Status |
|---|---|---|
| FR-4.1 | Reconstruct flagged values by elevation-corrected IDW | `[IMPLEMENTED]` |
| FR-4.2 | Store reconstruction beside the raw value, never replacing it | `[SPEC]` §17.3 |
| FR-4.3 | Record method, source peers, confidence, timestamp for every imputation | `[SPEC]` §17.3 |
| FR-4.4 | UI must make observed vs estimated unmistakable | `[SPEC]` §17.5 |
| FR-4.5 | Maintain a per-sensor health index from measured signals | `[IMPLEMENTED]` |
| FR-4.6 | Report degradation trajectory honestly as a heuristic | `[SPEC]` §18.5 |

### 6.5 Platform

| ID | Requirement | Status |
|---|---|---|
| FR-5.1 | Two roles with enforced station isolation on **every** endpoint | `[DEFECT]` → §27.4 |
| FR-5.2 | Persist per-station QC rule edits with audit | `[GAP]` → §28.1 |
| FR-5.3 | Persist maintenance checklist state | `[GAP]` → §28.2 |
| FR-5.4 | Real offline buffering and replay | `[GAP]` → §28.3 |
| FR-5.5 | Real integrity hash on exports | `[GAP]` → §28.4 |
| FR-5.6 | Detect model drift per station | `[GAP]` → §28.5 |
| FR-5.7 | Gated automated retraining with validation before activation | `[GAP]` → §28.6 |
| FR-5.8 | TimescaleDB hypertable in PostgreSQL mode, SQLite unaffected | `[GAP]` → §28.7 |
| FR-5.9 | Model versioning, rollback, downloadable model card | `[IMPLEMENTED]` |
| FR-5.10 | Fault injection across ≥10 fault types | `[IMPLEMENTED]` 6 → §30.2 |

---

## 7. Non-Functional Requirements

> **All numeric values in this section are engineering targets for the SIH build, not measured results.** §31 defines how to measure them. Do not quote any of these as achieved performance without a measurement recorded in `BENCHMARKS.md`.

| ID | Property | Target | Measurement |
|---|---|---|---|
| NFR-1 | API p95 read latency (dashboard endpoints), 10 stations, SQLite | < 200 ms | §31.2 |
| NFR-2 | Full detection chain per observation (all 10 layers) | < 150 ms single-threaded | §31.2 |
| NFR-3 | Detection latency: source observation → incident row | < 1 polling interval + NFR-2 | §31.3 |
| NFR-4 | Model training, 1 station, ~10 000 records | < 30 s | §31.2 |
| NFR-5 | Fleet scoring throughput | ≥ 100 observations/s single process | §31.4 |
| NFR-6 | Dashboard live refresh | 5 s (current) | — |
| NFR-7 | Memory, backend, 10 stations | < 512 MB RSS | §31.5 |
| NFR-8 | Raw observation immutability | 100% — zero UPDATE statements against raw value columns | §29.4 static check |
| NFR-9 | Graceful degradation | Every failure mode in §33.7 has a tested fallback | §29.6 |
| NFR-10 | Explainability coverage | 100% of non-NORMAL assessments carry a non-empty evidence payload | §29.3 |
| NFR-11 | Offline buffer retention | ≥ 72 h at 1 obs/min on 4 MB flash | §23.3 |
| NFR-12 | Auditability | Every state-changing action attributable to an actor and timestamp | §29.4 |
| NFR-13 | Cold start | New station produces physics+QC verdicts within one cycle, no model needed | §29.6 |
| NFR-14 | Frontend first paint after login | < 2 s on the demo laptop | §31.6 |

---

## 8. End-to-End Data Flow

### 8.1 The canonical path

```
[1] ACQUIRE        Open-Meteo poll │ CSV/JSON upload │ edge batch replay
                          │
[2] NORMALISE      units → SI/°C/hPa/%; timestamps → UTC; station id bound
                          │
[3] DEDUPLICATE    key = (station_id, source_timestamp)   ← N4 fix, §12.4
                          │  new observation only
[4] PERSIST RAW    INSERT into telemetry. IMMUTABLE from here.  (P4)
                          │
┌─────────────────────────▼──────────────────────────────────────────┐
│  DETECTION CHAIN — all layers read raw, none mutate it             │
│                                                                    │
│  L1 Data integrity ──┐ hard gate → INVALID, stop ML                │
│  L2 Physics ─────────┤ hard gate → CRITICAL                        │
│  L3 Temporal ────────┤                                             │
│  L4 Station ML ──────┼──▶ evidence vector z = (z_qc, z_phys,       │
│  L5 Multivariate ────┤          z_temp, z_ml, z_multi, z_health)   │
│  L6 Spatial ─────────┤          + peer agreement index A           │
│  L10 Health prior ───┘                                             │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
[5] FUSE           P(anomaly) = σ(β₀ + Σ βᵢzᵢ)   calibrated, §14
                          │
[6] ADJUDICATE     A high → REGIONAL_EVENT (data trusted)
                   A low  → LOCALIZED_ANOMALY (sensor suspect)
                   no peers → *_UNCONFIRMED
                          │
[7] CLASSIFY       root cause (8 classes) + severity + confidence
                          │
[8] EXPLAIN        assemble evidence payload, §15.2
                          │
[9] HEAL           if LOCALIZED && P ≥ τ_impute && ≥2 peers:
                       compute estimate, write imputations row (never UPDATE raw)
                          │
[10] HEALTH        update SHI, drift accumulator, anomaly-rate counters
                          │
[11] INCIDENT      dwell satisfied? → upsert incident (idempotent on
                       station + parameter + root cause + open window)
                          │
[12] PUBLISH       live_state → /stations/fleet/live → WeatherContext (5 s)
                          │
[13] MONITOR       drift metrics → retraining candidate queue, §21–22
```

### 8.2 What each stage is allowed to do

| Stage | May read | May write | Must never |
|---|---|---|---|
| 1–3 | external | staging | mutate history |
| 4 | staging | `telemetry` INSERT | UPDATE `telemetry` value columns |
| L1–L10 | `telemetry`, models, QC config, peers | nothing | write to `telemetry` |
| 5–8 | evidence | `assessments` | alter raw |
| 9 | assessment, peers | `imputations` | touch raw |
| 10 | history | `sensor_health` | — |
| 11 | assessment | `incidents` | duplicate open incidents |
| 12 | live state | in-memory | block on DB |
| 13 | rolling stats | `drift_metrics`, `retraining_candidates` | auto-activate a model (§22) |

### 8.3 Ordering guarantees

1. **Hard gates short-circuit.** A sentinel value must not be fed to the Isolation Forest — −999 will dominate any distance-like computation and poison the score. L1 failure ⇒ stop, emit `INVALID`.
2. **Spatial runs after ML, never before.** Peer agreement is only meaningful against a station's own anomaly residual (P3).
3. **Imputation runs after adjudication.** Never impute during a `REGIONAL_EVENT` — the value is real; replacing a genuine storm reading with a peer-smoothed estimate destroys the very signal a met service needs.
4. **Incident creation runs last.** It requires the final classification, not an intermediate one.


---

## 9. Detection Pipeline — Layer Specification

Ten layers. Each has a fixed contract: it consumes the raw observation plus station context, and emits a normalised evidence score in [0, 1] plus a list of human-readable findings. No layer writes to `telemetry`. No layer alone raises an alert except L1 and L2.

| Layer | Name | Type | Output | Can it alone alert? |
|---|---|---|---|---|
| L1 | Data integrity | Deterministic gate | `valid` / `invalid` + reason | **Yes** — `INVALID` |
| L2 | Physics validation | Deterministic gate + soft score | hard violations list, `z_phys` | **Yes** — hard violations only |
| L3 | Temporal intelligence | Statistical | `z_temp` + findings | No |
| L4 | Station-adaptive ML | Model | `z_ml` + SHAP attributions | No |
| L5 | Multivariate consistency | Statistical/physical | `z_multi` | No |
| L6 | Spatial intelligence | Comparative | agreement index `A`, peer table | No — it *adjudicates* |
| L7 | Fusion | Probabilistic | `P(anomaly)`, confidence | — |
| L8 | Explainability | Assembly | evidence payload | — |
| L9 | Self-healing | Reconstruction | imputed estimate + provenance | — |
| L10 | Health & maintenance | Accumulative | SHI, drift, RUL-heuristic | No — feeds prior |

### 9.1 L1 — Data Integrity `[IMPLEMENTED, formalise]`

**Purpose:** reject observations that are not measurements at all, before they contaminate anything downstream.

**Checks (all deterministic, no station tuning):**

| Check | Rule | Emitted finding |
|---|---|---|
| Null/NaN | value is null, NaN, or ±Inf | `MISSING_VALUE` |
| Sentinel | value ∈ {−999, −9999, 999.9, 6999, 65535, 32767, −32768} | `SENTINEL_VALUE` |
| ADC saturation | raw counts at 0 or full-scale when raw counts are available | `ADC_SATURATION` |
| Encoding | non-finite float, string in numeric field, sign-flip artefacts | `ENCODING_ERROR` |
| Timestamp validity | unparseable; > 5 min in the future; older than station commissioning date | `INVALID_TIMESTAMP` |
| Duplicate | `(station_id, source_timestamp)` already stored with a different value | `DUPLICATE_CONFLICT` |
| Repeat | same key, same value | silently dropped, counted (this is the N4 case) |

**Contract:** on any hard failure → `quality_state = INVALID`, WMO flag 9, **skip L3–L5 entirely**, still run L6 (peers can supply an imputation) and L10 (integrity failures are health signals). Root cause defaults to `COMMUNICATION_CORRUPTION` when sentinel/encoding, `MISSING_DATA` when null.

**Why skipping ML matters:** feeding −999 into the Isolation Forest produces an extreme but *meaningless* score and pollutes the SHAP attribution with a garbage feature. `[VERIFY]` that the current implementation short-circuits here.

### 9.2 L2 — Physics Validation `[IMPLEMENTED]` → see §11
### 9.3 L3 — Temporal Intelligence `[IMPLEMENTED, extend]` → see §12
### 9.4 L4 — Station-Adaptive ML `[IMPLEMENTED, improve]` → see §10
### 9.5 L5 — Multivariate Consistency → see §11.4
### 9.6 L6 — Spatial Intelligence `[IMPLEMENTED, fix]` → see §13
### 9.7 L7 — Fusion `[SPEC]` → see §14
### 9.8 L8 — Explainability `[IMPLEMENTED, formalise]` → see §15
### 9.9 L9 — Self-Healing `[IMPLEMENTED, extend]` → see §17
### 9.10 L10 — Health & Maintenance `[IMPLEMENTED, relabel]` → see §18

---

## 10. Station-Adaptive ML Architecture

### 10.1 Critical review of the current implementation

Assessed against the brief's five questions, from `PROGRESS.md` §8.1.

| Question | Assessment |
|---|---|
| Mathematically sound? | **Conditionally.** Isolation Forest is a correct choice for this problem. Whether *this* implementation is correct depends on V6 — specifically whether the path-length normalisation `c(n)` and the `2^(−E[h(x)]/c(n))` score are present. Hand-rolled IFs commonly omit the external-path-length adjustment for truncated branches, which silently breaks score comparability across trees. |
| Computationally practical? | **Yes, clearly.** Pure Python, 8D, per-station. Training is O(t · ψ log ψ), scoring O(t · log ψ). This is the right complexity class and the zero-dependency property is a real deployment advantage. |
| Appropriate for station-level detection? | **Yes** for the "unusual for this station" question. IF is unsupervised, needs no labels, handles mixed scales tolerably, and is naturally explainable through path lengths. |
| Suitable for small historical datasets? | **No, as configured.** A 20-record minimum with diurnal features is unsound (N8). IF's subsample ψ is normally 256; with n < 256 the ensemble degenerates toward memorising the training set. |
| Robust against contamination? | **Unverified and probably not.** If `fetch_historical_telemetry()` returns raw history including real faults, the model learns faults as normal. This is the classic unsupervised-QC trap. §10.6. |
| Reproducible? | **Unverified.** Requires a fixed RNG seed persisted in the model card. §10.9. |

**Verdict: keep Isolation Forest. Fix the feature space, the data hygiene, the readiness gating and the threshold calibration.** Do not replace it with a heavier model — none of the identified problems is solved by a bigger model, and every one of them is solved by better inputs.

### 10.2 The core improvement: model residuals, not raw values `[SPEC] [P1]`

**Problem with raw-value features.** If the feature vector is `(T, H, P, lag, rate, dewpoint, sin h, cos h)`, the Isolation Forest must learn the entire diurnal manifold *implicitly* from data density. With sparse data it will isolate legitimate pre-dawn minima as anomalies, because few training points live there. It will also flag every seasonal transition.

**Fix.** Build an explicit per-station climatology, then let the ML work on *departures from it*:

```
expected(t)  =  climatology(station, hour_of_day(t), day_of_year(t))
residual(t)  =  observed(t) − expected(t)
z(t)         =  residual(t) / robust_sigma(station, hour_of_day(t))
```

The Isolation Forest then scores `z`, not `T`. Consequences:

- Diurnal and seasonal structure is removed **before** the model, so it no longer has to be learned from density — directly satisfying FR-2.8 with far less data.
- Residuals are approximately stationary, which is what IF implicitly assumes.
- Residual space is **comparable across stations**, which is exactly what §13.4 needs to fix the spatial bug (N7). One change fixes two problems.
- Interpretation improves: "temperature is 4.2 σ above what this station does at 03:00 in September" is a sentence a judge understands instantly.

### 10.3 Climatology model `[SPEC]`

Per station, per core parameter. Pure Python, no dependencies.

**Form — harmonic regression:**

```
x̂(t) = a₀
     + a₁·sin(2πh/24)  + b₁·cos(2πh/24)      ← diurnal fundamental
     + a₂·sin(4πh/24)  + b₂·cos(4πh/24)      ← diurnal 2nd harmonic (morning/evening asymmetry)
     + c₁·sin(2πd/365) + d₁·cos(2πd/365)     ← annual
     + c₂·sin(4πd/365) + d₂·cos(4πd/365)     ← semi-annual (monsoon/post-monsoon in India)
```

where `h` = hour of day (fractional, UTC→IST-aware), `d` = day of year. **10 coefficients per parameter per station.**

**Why harmonics rather than an hour×month lookup table:** a 24×12 grid needs 288 cells filled per parameter. With a few weeks of data most cells are empty. Ten coefficients fit robustly from a few hundred points and interpolate smoothly. This is the single design choice that makes "learns seasonal patterns" honest on a small dataset.

**Fitting:** iteratively reweighted least squares with Huber weights (5 iterations, δ = 1.345·σ̂). Ordinary least squares would let the anomalies you are trying to detect drag the baseline toward themselves.

**Scale estimate:** `robust_sigma(hour_bucket)` = 1.4826 × MAD of residuals within each of 8 three-hour buckets, floored at a per-parameter minimum (T: 0.3 °C, H: 1.5 %, P: 0.15 hPa) so a quiet period cannot produce a near-zero denominator and manufacture 50 σ events.

**Fallback ladder (P5):**
1. ≥ 30 days history → full harmonic fit.
2. 7–30 days → diurnal terms only, annual terms zeroed.
3. < 7 days → constant baseline = robust median; σ = MAD of first differences × 1.4826.
4. No history → regional prior from the nearest ≥3 trained peers (§10.7); mark `climatology_source = REGIONAL_PRIOR` in the assessment. **This is the only place a cross-station model is permitted, and it is a bootstrap, not the scorer.**

**Storage:** new table `station_climatology` (§24.3). Refit nightly or on retraining, versioned alongside the model.

### 10.4 Feature vector `[SPEC]`

Replace the 8D raw vector with this 12D residual vector. Order is fixed and recorded in the model card.

| # | Feature | Definition | Detects |
|---|---|---|---|
| 1 | `z_T` | temperature residual z-score | thermal spikes, offset faults |
| 2 | `z_H` | humidity residual z-score | RH sensor faults |
| 3 | `z_P` | pressure residual z-score | pressure faults, synoptic events |
| 4 | `dz_T` | Δ`z_T` over one observation interval | step changes |
| 5 | `dz_H` | Δ`z_H` | RH step changes |
| 6 | `dz_P` | Δ`z_P` | pressure jumps |
| 7 | `z_dpd` | dew point depression (T − Td) residual z | joint T/H inconsistency |
| 8 | `p_elev_resid` | observed P − hypsometric expected P at station elevation, in hPa | pressure calibration offset |
| 9 | `var3` | rolling std of `z_T` over last 3 distinct observations, sign-inverted and normalised | flatlines (low variance ⇒ high value) |
| 10 | `persist` | count of consecutive observations with \|`z_T`\| > 2, capped at 12, /12 | sustained drift vs transient spike |
| 11 | `z_T_lag1` | previous `z_T` | temporal context |
| 12 | `hour_phase` | cos(2πh/24) | retained so the model can still learn residual heteroscedasticity by time of day |

**Notes.**
- Features 1–8 are approximately unit-variance by construction, which means IF's axis-parallel splits are not dominated by whichever raw variable happened to have the largest range (pressure, ~1000 hPa vs temperature, ~30 °C). **This alone is a significant correctness improvement over the raw 8D vector.** No explicit scaler is then needed — but `[VERIFY]` whether the current implementation scales at all; if it feeds raw T/H/P to IF unscaled, pressure dominates every split and the model is effectively a pressure detector.
- Wind, rainfall, battery and RSSI are deliberately **not** ML features. They enter as fusion evidence and root-cause context (§2.4). Adding them to a 12D IF trained on a few thousand points adds variance without adding signal.

### 10.5 Isolation Forest configuration `[SPEC]`

| Parameter | Value | Justification |
|---|---|---|
| `n_trees` (t) | 100 | Standard; score variance is negligible beyond ~100 for this dimensionality |
| `subsample` (ψ) | `min(256, n_train)` | 256 is the canonical value. Below it, use all data and record the degradation in the model card |
| `max_depth` | `ceil(log₂ ψ)` | Standard height limit |
| `random_seed` | stored per model version | Reproducibility, §10.9 |

**Scoring — the formula that must be present (V6):**

```
H(i)   = ln(i) + 0.5772156649          (Euler–Mascheroni)
c(n)   = 2·H(n−1) − 2(n−1)/n           for n > 2;  c(2) = 1;  c(n≤1) = 0
h(x)   = path length to the isolating node
         + c(size of node) when the branch was truncated at max_depth
s(x)   = 2^( − E[h(x)] / c(ψ) )        s ∈ (0,1), higher = more anomalous
```

The `+ c(size)` term for truncated branches is the most commonly omitted part of hand-written implementations. Without it, deep-but-truncated paths are scored as if fully isolated and the score distribution compresses. **Check for it explicitly.**

### 10.6 Training data hygiene `[SPEC] [P1]`

Contamination handling, inserted as a new sub-stage in the existing 8-stage pipeline (stage 3, "Data Preprocessed").

```
1. Drop L1 failures (sentinels, nulls, malformed).
2. Drop hard-physics violations (L2 §11.3) — RH > 105 %, Td > T + 0.5, T outside [−90, 60].
3. Fit climatology by robust IRLS (§10.3) — inherently anomaly-resistant.
4. Compute residual z-scores.
5. Trim |z| > 6 for any core parameter. These are almost certainly faults, not weather.
   Record the trim count.
6. Fit Isolation Forest on the surviving set.
```

**Do not trim aggressively (e.g. |z| > 3).** That would remove genuine extreme weather from the training distribution and cause the model to alarm on every real monsoon event. 6 σ on a robustly-scaled residual is a defensible boundary between "extreme weather" and "broken instrument", and the boundary itself must be recorded in the model card as a tunable.

**Contamination estimate** (used for threshold selection, §10.8):
```
contamination = clamp( (rows_dropped_in_steps_1,2,5) / rows_total , 0.005 , 0.05 )
```
Derived from the data, not guessed. If the current implementation hardcodes a contamination constant, replace it with this and record both values in the model card during transition.

### 10.7 Model readiness tiers `[SPEC] [P0 — fixes N8]`

Replace the single 20-record gate with four explicit tiers. The tier is stored on the model record and **rendered in the UI**, because "this station does not yet have enough data to have an opinion" is an honest and impressive thing for a system to say.

| Tier | Condition | Active detection layers | UI label |
|---|---|---|---|
| `COLD_START` | < 72 distinct observations (< ~3 days hourly) | L1, L2, L6 (spatial vs peers using regional-prior climatology) | "COLD START — physics + peer checks only" |
| `BASELINE` | 72 – 720 observations | L1, L2, L3, L5, L6 with diurnal-only climatology. **No IF.** | "BASELINE — statistical, model pending" |
| `TRAINED` | ≥ 720 distinct observations (~30 days) spanning ≥ 14 distinct days | All layers, full harmonic climatology, IF active | "TRAINED v1.x" |
| `MATURE` | ≥ 4 380 observations (~6 months) covering ≥ 2 seasons | All layers, annual harmonics meaningful, drift monitoring fully reliable | "MATURE v1.x" |

**Demo implication and how to handle it honestly.** A 30-day minimum cannot be met by a station provisioned during the demo. This is a feature, not a problem: seed the demo fleet by bulk-loading ≥ 90 days of Open-Meteo *historical* hourly data per station during setup (the Training Studio already supports "Fetch historical data from Open-Meteo"). The demo then shows genuinely trained models **and** shows the readiness gate working when a brand-new station is provisioned live. That contrast is a stronger demonstration than pretending 20 records is enough.

**Never** let a `COLD_START` station silently fall back to producing IF scores from a degenerate model. Emit the tier in every assessment.

### 10.8 Threshold calibration `[SPEC]`

Current: "calibrates dynamic anomaly threshold + contamination factor" at stage 6 `[VERIFY how]`.

**Required method:**
1. Hold out the most recent 20 % of the cleaned training set as a validation window (temporal split, never random — random splitting leaks future information through lag features).
2. Score the validation window.
3. `τ_station = quantile(scores, 1 − contamination)`.
4. Apply floors and ceilings: `τ ∈ [0.55, 0.75]`. IF scores near 0.5 mean "average path length" — a threshold below 0.55 will flag half the data.
5. Store `τ_station`, the score distribution deciles, and the validation window bounds in the model card.

**Normalised ML evidence for fusion:**
```
z_ml = clamp( (s − τ) / (1 − τ) , 0 , 1 )
```
This maps "exactly at threshold" → 0 and "maximally anomalous" → 1, and makes the ML evidence comparable across stations with different thresholds. Without this normalisation, a station with τ = 0.72 and one with τ = 0.57 contribute incomparable numbers to the fusion.

### 10.9 Model artifact and reproducibility `[SPEC]`

Extend the existing JSON artifact (`ml/models/`) and the model card. Additive fields only — do not break `ModelGovernance.jsx`.

```jsonc
{
  "schema_version": 2,
  "station_id": "AWS-MNG-001",
  "model_version": "v1.3",
  "created_at": "2026-09-16T04:10:00Z",
  "readiness_tier": "TRAINED",
  "algorithm": { "name": "IsolationForest", "n_trees": 100, "subsample": 256,
                 "max_depth": 8, "random_seed": 20260916 },
  "feature_space": { "version": 2, "names": ["z_T","z_H","z_P","dz_T","dz_H","dz_P",
                     "z_dpd","p_elev_resid","var3","persist","z_T_lag1","hour_phase"] },
  "climatology": { "version": 3, "fit_method": "IRLS_huber",
                   "coefficients": { "temperature": [/* 10 */], "humidity": [/* 10 */],
                                     "pressure": [/* 10 */] },
                   "sigma_by_bucket": { "temperature": [/* 8 */] },
                   "source": "OWN_HISTORY" },
  "training_data": { "rows_total": 2160, "rows_after_cleaning": 2104,
                     "rows_dropped": { "integrity": 12, "physics": 7, "trim_6sigma": 37 },
                     "window": ["2026-06-18T00:00Z","2026-09-15T23:00Z"],
                     "distinct_days": 90 },
  "calibration": { "contamination": 0.026, "threshold": 0.641,
                   "score_deciles": [/* 10 */], "validation_rows": 421 },
  "fusion_coefficients_version": "fc-2026-09-10",
  "parent_version": "v1.2",
  "training_job_id": 481
}
```

**Reproducibility contract:** re-running training with the same `random_seed`, the same data window and the same `feature_space.version` must reproduce byte-identical trees. Add a test (§29.2, T-ML-06).

**Backward compatibility:** the loader must accept `schema_version: 1` artifacts and treat them as `feature_space.version: 1`, routing them through the legacy 8D feature builder. Existing trained models keep working; new training produces v2. Do not delete the v1 path until every demo station has been retrained.

---

## 11. Physics / QC Engine

### 11.1 Purpose and position

L2 is the only layer that can assert an observation is wrong *without reference to any history, model or peer*. Physical law does not need training data. It is therefore the most trustworthy evidence in the system and the fastest to compute — and it is what makes the system useful on day one for a brand-new station (NFR-13).

### 11.2 Three classes of check

| Class | Semantics | Effect |
|---|---|---|
| **Hard impossibility** | Violates physics or instrument range. Cannot be weather. | Immediate `CRITICAL`, bypasses fusion, deterministic root cause |
| **Soft inconsistency** | Physically possible but improbable given the other parameters | Contributes `z_phys` to fusion |
| **Station envelope** | Outside the station's own calibrated historical range | Contributes to `z_qc`; **never** alone sufficient (P1) |

### 11.3 Hard checks `[IMPLEMENTED, formalise]`

Global constants. Not station-tunable. Sourced from WMO-No. 8 measurement ranges and physical bounds.

| Check | Condition | Root cause |
|---|---|---|
| Temperature bound | T < −90 °C or T > 60 °C | `SENSOR_OUT_OF_RANGE` |
| Humidity bound | RH < 0 % or RH > 105 % (5 % tolerance for supersaturation/calibration) | `SUPER_SATURATION_VIOLATION` |
| Pressure bound | P < 500 hPa or P > 1100 hPa (station-level) | `SENSOR_OUT_OF_RANGE` |
| Dew point ordering | Td > T + 0.5 °C | `SUPER_SATURATION_VIOLATION` |
| Hypsometric gross | \|P_obs − P_expected(elevation)\| > 60 hPa | `PRESSURE_CALIBRATION_FAULT` |

Where `P_expected(z) = P₀ · (1 − 0.0065z / 288.15)^5.255`, `P₀` = 1013.25 hPa, `z` = station elevation in metres.

### 11.4 Soft multivariate checks (L5) `[SPEC, partially implemented]`

These are where multivariate consistency actually lives, and they are the cheapest strong defence against single-sensor faults.

| Check | Rule | Physical reasoning | Evidence |
|---|---|---|---|
| Dew point depression | T − Td below the station's 1st percentile for that hour while rainfall = 0 and RH < 99 % | Saturation without precipitation or fog is unusual; a wet RH sensor produces exactly this | `z_dpd` |
| T↔RH anti-correlation | Rolling 6-observation correlation between `z_T` and `z_H` flips sign from the station's learned norm | T and RH are strongly anti-correlated in normal diurnal cycling. A T sensor drifting while RH tracks reality breaks this | `z_multi` component |
| Pressure tendency plausibility | \|dP/dt\| > 3 hPa/h without a corresponding wind or rainfall change | Real synoptic pressure changes are accompanied by wind field changes | `z_multi` component |
| Wet-bulb sanity | Computed Tw > T | Thermodynamically impossible; indicates a bad T or RH input | hard-adjacent, severity HIGH |
| Rain–humidity coherence | Rainfall > 0.5 mm while RH < 70 % | Rain with dry air at the same station is implausible; one of the two sensors is wrong | `z_multi` component |

**Design note:** the existing `thermo_engine.py` already computes dew point, wet bulb, LCL and MALR. This section mostly requires *wiring those outputs into evidence scores*, not new physics. Check V-list item: confirm whether LCL and MALR are currently consumed by anything or merely displayed. If merely displayed, either wire them in here or accept them as informational — do not leave ambiguous.

### 11.5 Station QC envelopes `[IMPLEMENTED — fix calibration input]`

`calibrate_station_qc()` auto-computes envelopes from historical telemetry.

`[DEFECT — NEW]` If it computes envelopes from **raw** history (V10), then a station whose sensor spent a week reading +8 °C too high will have its envelope widened to include the fault. The QC layer then certifies the very fault it exists to catch.

**Required:** envelope calibration must run on the *cleaned* training set from §10.6 (post integrity, physics and 6 σ trim), and must use robust percentiles, not min/max:

```
temp_min = P0.1(cleaned)  −  3 · robust_sigma
temp_max = P99.9(cleaned) +  3 · robust_sigma
```

Min/max is unusable: one spike defines the envelope forever.

**Recalibration policy:** recompute on every successful retraining, and on demand via the admin UI. Store `calibrated_at`, `source_rows`, `method_version` on `station_qc_config` so an operator can see whether an envelope is stale. Manual edits (§28.1) must set `source = MANUAL` and must survive subsequent auto-calibration unless explicitly reset — an operator who corrected a threshold should not have it silently overwritten by the next nightly job.

---

## 12. Temporal Intelligence

### 12.1 What L3 must detect

| Phenomenon | Signature | Distinguishing feature vs real weather |
|---|---|---|
| Spike | single-observation step, immediate return | Real weather rarely steps and instantly reverts; peers show nothing |
| Step offset | permanent jump, normal variance afterwards | Classic recalibration event or sensor swap; residual mean shifts, residual variance does not |
| Flatline | variance ≈ 0 across distinct observations | Real atmospheric variance is never exactly zero at 1-hour resolution |
| Drift | slow monotone residual trend over days | Real climate signals move together with peers; drift does not |
| Rate violation | \|dx/dt\| beyond physical plausibility | Convective events exist but are bounded and peer-visible |
| Noise burst | residual variance inflation without mean shift | Failing analog front end |

### 12.2 Diurnal and seasonal learning `[SPEC]` — the PS-073 "temporal patterns" requirement

This requirement is satisfied by the climatology model of §10.3, not by an additional component. To be explicit about the mapping:

| PS-073 wording | Implementation |
|---|---|
| "hourly patterns" | diurnal fundamental + 2nd harmonic, fitted per station |
| "diurnal cycles" | same; `robust_sigma` also varies by 3-hour bucket, so a 2 °C swing at 14:00 is normal while the same swing at 03:00 is not |
| "seasonal behaviour" | annual + semi-annual harmonics; semi-annual is what captures the Indian monsoon/post-monsoon structure |
| "rolling baselines" | `robust_sigma` refit nightly; climatology refit on retraining |
| "local station climate" | the whole point — coefficients are per station |
| "weekday/weekend" | **not implemented, and correctly so.** Atmospheric parameters at a rural AWS have no weekday signal. Documented as deliberately excluded so a judge's question has an answer |

### 12.3 Rate-of-change thresholds `[IMPLEMENTED, make adaptive]`

Current: fixed `temp_max_rate` in `station_qc_config`.

**Required:** keep the fixed threshold as a hard backstop, but make the primary temporal evidence adaptive:

```
z_rate = |Δx / Δt| / robust_sigma_rate(station, hour_bucket)
```
where `robust_sigma_rate` is 1.4826 × MAD of first differences within the bucket, from cleaned history.

This matters concretely: a 4 °C/hour drop at a coastal station at 16:00 is a sea breeze and routine. The same drop at 02:00 is not. A single fixed `temp_max_rate` cannot express that; an hour-bucketed adaptive one can, with no new infrastructure.

### 12.4 The observation-cadence fix `[SPEC] [P0 — N4]`

**Problem.** Open-Meteo serves hourly values. The poller runs at 20 s. Between hourly updates the API returns the *same* value. Therefore:

- A naive flatline detector counting consecutive equal readings sees 180 identical values every hour on a perfectly healthy station.
- Rolling variance computed over poll ticks is ~0 almost always.
- Anomaly rate per hour is inflated by ~180×, which will wreck the drift monitor of §21 before it is even written.
- Incident dwell counted in poll ticks means "3 consecutive readings" is 60 seconds of the same hourly value — no dwell at all.

**Required implementation:**

1. The poller extracts the **source observation timestamp** from the Open-Meteo response (its `time` field), not `datetime.utcnow()`.
2. Maintain `last_source_ts[station_id]` in `live_state`.
3. If `source_ts == last_source_ts` → this is a **repeat**, not an observation:
   - do **not** insert into `telemetry`
   - do **not** advance any temporal series
   - do **not** re-evaluate dwell counters
   - **do** refresh `live_state` so the dashboard stays responsive
   - **do** re-apply active fault injection, so a fault injected mid-hour appears immediately (see below)
4. If `source_ts > last_source_ts` → genuine new observation → run the full chain.
5. All L3 windows (`var3`, `persist`, rate-of-change), dwell counters and anomaly-rate statistics are indexed on **distinct source observations**.

**Fault injection interaction — important for the demo.** Injected faults are applied to the value *after* retrieval. An injected fault must be treated as producing a **new synthetic observation** even within the same source hour, otherwise the demo would require waiting up to an hour for a response. Implement as: when `active_faults` changes for a station, stamp a synthetic source timestamp `source_ts + injection_sequence` and process it as a distinct observation. Record `observation_source = 'SYNTHETIC_FAULT'` on the telemetry row so evaluation can separate injected from real data (§30.5). This keeps the demo instant and keeps the evaluation dataset honest.

**Wider point for the SIH answer.** A real AWS reports at 1–10 minute intervals. Open-Meteo at 1 hour is a demo stand-in. State this openly in the demo script (§33.6) and configure `observation_interval_seconds` per station so the same code serves both. Judges reward knowing the limits of your own data source far more than they punish having one.


---

## 13. Spatial Intelligence

### 13.1 The question this layer answers

Layers 1–5 answer: *"Is this observation unusual for this station?"*
Layer 6 answers: *"Is it unusual for this region?"*

The cross-product of those two answers is the entire innovation:

| Unusual for station? | Region agrees? | Conclusion |
|---|---|---|
| No | — | `NORMAL` |
| Yes | Yes — peers show the same departure | `REGIONAL_EVENT` — the data is **correct**, the weather is unusual |
| Yes | No — peers are at their own normal | `LOCALIZED_ANOMALY` — the **sensor** is suspect |
| Yes | No peers available | `LOCALIZED_ANOMALY_UNCONFIRMED` — suspect, but we cannot prove it |

### 13.2 Peer discovery `[IMPLEMENTED]`

Haversine great-circle distance, configurable radius (default 50 km, UI slider 25–200 km). Peers must additionally satisfy:

- `status = ACTIVE`
- has an observation within the last `2 × observation_interval`
- its own latest assessment is not `INVALID` (a broken sensor cannot vouch for another)
- readiness tier ≥ `BASELINE` (needs a climatology to produce a residual)

**Elevation gating:** exclude peers whose elevation differs by more than 500 m unless residual-space comparison is in use (§13.4). With residual comparison, elevation difference matters far less, which is another reason to make that change.

### 13.3 Robust peer statistics `[IMPLEMENTED]`

Median and MAD, not mean and standard deviation. Correct choice — with 3–6 peers, one broken peer would drag a mean badly. Keep. `robust_sigma_peers = 1.4826 × MAD`, floored as in §10.3 to avoid division by a near-zero spread when peers happen to be tightly clustered.

### 13.4 Residual-space comparison `[SPEC] [P1 — fixes N7]`

**The defect.** Comparing raw values between stations is invalid whenever stations differ in elevation or microclimate. The dry adiabatic lapse rate alone puts ~6.5 °C between a 30 m coastal station and a 900 m ghat station. On the Dakshina Kannada belt this is not hypothetical — the coast-to-ghat gradient is exactly the terrain being modelled. A raw-value MAD test there reports permanent disagreement, which means either:
- the 50 km radius is quietly excluding the interesting peers, or
- every ghat station is permanently classified `LOCALIZED_ANOMALY`.

Both are bad, and the second would be visible to a judge who clicks the wrong station.

**The fix.** Compare **residuals**, not values. Each station already produces `z_T`, `z_H`, `z_P` against its own climatology (§10.2). A residual says "how far is this station from *its own* normal right now", which is directly comparable across terrain.

```
For target station k and peers j ∈ P:
    z_k        = target residual z-score for the parameter
    z_med      = median{ z_j }
    σ_peer     = 1.4826 · MAD{ z_j }   (floored at 0.5)

    disagreement  D = | z_k − z_med | / σ_peer

    agreement index  A = exp( −D² / 2 )        A ∈ (0, 1]
```

`A → 1` means the station is departing from its own normal by the same amount, in the same direction, as its neighbours are from theirs — a regional event. `A → 0` means it is departing alone — a sensor fault.

**Why the Gaussian kernel rather than a hard threshold:** it produces a smooth, bounded quantity suitable for the fusion of §14 and for display as a percentage, and it degrades gracefully as `D` grows instead of flipping at an arbitrary cut point.

**Direction matters.** Also record `sign_match = sign(z_k) == sign(z_med)`. A station reading 4 σ hot while peers read 4 σ cold has `|z_k − z_med|` large *and* opposite sign — that is a much stronger sensor-fault indicator than a magnitude mismatch alone, and it should raise root-cause confidence for `CALIBRATION_DRIFT`.

**Migration note:** implement `compare_residual()` alongside the existing raw comparator, gate it behind `SPATIAL_MODE = residual|raw` in config, default `residual`, and keep `raw` available so the difference can be demonstrated side by side. That side-by-side is itself a good demo moment.

### 13.5 Regional event confirmation `[SPEC]` — hardening

The current rule per `PROGRESS.md` is *"ML anomaly + ALL peers agree ⇒ REGIONAL_EVENT"*. "ALL" is brittle: one stale or broken peer blocks correct classification of a genuine storm, which is the exact failure the demo's step 16 is designed to avoid.

**Required rule:**

```
REGIONAL_EVENT requires ALL of:
  1. n_valid_peers ≥ 2
  2. A ≥ 0.6                                  (agreement index)
  3. ≥ 60 % of valid peers individually have |z_j| ≥ 1.5   (peers are themselves departing)
  4. sign_match == true
  5. the departure persists ≥ 2 distinct observations at ≥ 50 % of peers
```

Condition 3 is essential and easy to miss: if peers are all sitting calmly at their own normal (`z_j ≈ 0`) and the target is also near normal, `A` is high — but that is agreement on *nothing happening*, not a regional event. Condition 3 requires that something is actually happening region-wide.

Condition 5 prevents a single synchronised API artefact from being read as a weather front.

### 13.6 No-peer handling `[SPEC]` (P5)

Isolated stations are the norm in real AWS networks, not an edge case.

| Peers available | Behaviour |
|---|---|
| ≥ 2 valid | full adjudication as above |
| 1 valid | adjudicate, but cap classification confidence at 0.6 and label `SINGLE_PEER` |
| 0 valid | classification = `LOCALIZED_ANOMALY_UNCONFIRMED`, `spatial_evidence.status = "NO_PEERS"`, `A` = null (**not** 0 — absent evidence is not evidence of disagreement), fusion drops the spatial term and renormalises (§14.4) |

**UI requirement:** when `UNCONFIRMED`, the HUD and incident modal must say *"No neighbouring stations available — cannot distinguish sensor fault from local weather."* Saying this plainly is more credible than asserting a verdict.

### 13.7 Efficiency

Current implementation presumably computes Haversine across all stations per evaluation — O(n²) per cycle. Fine at 10 stations; at 1 000 it is 10⁶ distance computations every cycle.

`[P2]` Precompute a static neighbour table `station_neighbours(station_id, peer_id, distance_km, elev_delta_m)` on station create/edit. Stations do not move. Refresh only on coordinate change. This reduces per-cycle cost to a single indexed lookup and is a ten-line change with a large scaling payoff. Details in §32.4.

---

## 14. Anomaly Fusion

### 14.1 Why the current approach must change `[DEFECT — N6]`

`qcEngine.js` uses: rule 35 % + model 35 % + spatial 20 % + health 10 %. Two problems.

**First, the weights are unjustified.** The brief forbids exactly this. There is no derivation, no sensitivity analysis and no way to answer a judge who asks "why 35?".

**Second, and more seriously, the structure is wrong.** Spatial evidence as a linear +20 % term implies that peer disagreement makes an observation *more anomalous*. It does not. Peer disagreement does not change whether the reading is unusual — it changes **what is causing it**. Adding it to the anomaly score conflates the two axes that P3 requires be kept separate.

### 14.2 Required structure: gates → evidence → probability → adjudication

```
   ┌──────────────────────────────────────────────────────┐
   │ STAGE 0 — DETERMINISTIC GATES                        │
   │   L1 integrity failure  → INVALID,  stop             │
   │   L2 hard physics       → CRITICAL, fixed root cause │
   └──────────────────────┬───────────────────────────────┘
                          │ passes
   ┌──────────────────────▼───────────────────────────────┐
   │ STAGE 1 — EVIDENCE VECTOR  z ∈ [0,1]⁶                │
   │   z_qc  z_phys  z_temp  z_ml  z_multi  z_health      │
   └──────────────────────┬───────────────────────────────┘
                          │
   ┌──────────────────────▼───────────────────────────────┐
   │ STAGE 2 — PROBABILITY                                │
   │   logit = β₀ + Σ βᵢ·zᵢ ;  P = σ(logit)               │
   │   βᵢ FITTED on fault-injection labels (§14.5)        │
   └──────────────────────┬───────────────────────────────┘
                          │
   ┌──────────────────────▼───────────────────────────────┐
   │ STAGE 3 — SPATIAL ADJUDICATION (orthogonal axis)     │
   │   A high → REGIONAL_EVENT   A low → LOCALIZED        │
   └──────────────────────┬───────────────────────────────┘
                          │
   ┌──────────────────────▼───────────────────────────────┐
   │ STAGE 4 — SEVERITY, DWELL, CONFIDENCE                │
   └──────────────────────────────────────────────────────┘
```

### 14.3 Evidence definitions

Each term is bounded [0, 1] and each has a documented derivation. This is what makes the fusion defensible.

| Term | Definition | Notes |
|---|---|---|
| `z_qc` | `min(1, Σ wᵣ · fired(r) )` over station-envelope rules r, with `w_range = 0.5`, `w_rate = 0.5`, `w_flatline = 1.0` | Envelope breaches are weak evidence by design (P1) |
| `z_phys` | `min(1, soft_violations / 3)` from §11.4 | Hard violations never reach here — they gate at Stage 0 |
| `z_temp` | `min(1, max(z_rate, z_persist) / 6)` | 6 σ saturates |
| `z_ml` | `clamp((s − τ)/(1 − τ), 0, 1)` from §10.8 | 0 when no model (tier < TRAINED) — and `β_ml` term is then dropped, §14.4 |
| `z_multi` | `min(1, multivariate_violations / 3)` from §11.4 | |
| `z_health` | `1 − SHI/100` | A degraded sensor is a **prior**, not proof |

### 14.4 Missing-evidence handling `[SPEC]`

Terms go missing constantly: no model on a cold-start station, no battery telemetry from an Open-Meteo-backed station, no peers.

**Rule:** drop the term and renormalise the remaining coefficients so the achievable logit range is preserved:

```
available = { i : zᵢ is not null }
scale     = Σ_{all i} |βᵢ|  /  Σ_{i ∈ available} |βᵢ|
logit     = β₀ + scale · Σ_{i ∈ available} βᵢ · zᵢ
```

Also emit `evidence_completeness = |available| / 6` into the payload, and **cap final confidence at `evidence_completeness`** (§14.6). A verdict based on two of six evidence sources should not report 95 % confidence. This single rule does more for honest confidence reporting than any calibration technique.

### 14.5 Learning the coefficients from the fault injection lab `[SPEC] [P1]`

This is the answer to "do not choose arbitrary weights", and it turns an existing demo feature into a scientific instrument.

**Procedure:**

1. **Generate a labelled corpus.** Run the standardised injection suite (§30.2) across the fleet: for every injection, the injected window is labelled `1` (anomalous) and the surrounding clean windows `0`. Include the `REGIONAL_EVENT` (STORM) injections labelled `0` for *sensor fault* — critically important, because these are the hard negatives that teach the model not to over-flag real weather.
2. **Record the evidence vector** `z` for every observation in the corpus, with no fusion applied.
3. **Fit** a logistic regression by gradient descent — ~40 lines of pure Python, no dependency:
   ```
   minimise  Σ −[ y·log σ(βᵀz) + (1−y)·log(1 − σ(βᵀz)) ]  +  λ‖β‖²
   λ = 0.1,  lr = 0.05,  1000 epochs,  L2 on all but β₀
   constraint: βᵢ ≥ 0 for i ≥ 1  (clip after each step)
   ```
   The non-negativity constraint is essential: more evidence of a problem must never *reduce* the anomaly probability. Without it, correlated evidence terms produce negative coefficients that are statistically fine and operationally absurd — and impossible to explain to a judge.
4. **Validate** with 5-fold cross-validation grouped by *station* (never by row — rows within an injection window are not independent). Report AUC-PR, Brier score and a reliability diagram.
5. **Version and store** as `fusion_coefficients` (§24.3) with `fitted_at`, corpus description and validation metrics. The model card references the version.
6. **Ship defaults.** Until the corpus exists, use the priors below — **and mark them as priors in the API response and the UI**, not as fitted values.

**Default priors (to be replaced by fitted values):**

| Coefficient | Default | Rationale for the ordering |
|---|---|---|
| `β₀` | −4.0 | Base rate: anomalies are rare; a zero-evidence observation must have low probability |
| `β_phys` | 3.5 | Physics is the most trustworthy non-deterministic evidence |
| `β_ml` | 3.0 | Station-adaptive and data-driven, but sensitive to training quality |
| `β_temp` | 2.5 | Strong, but genuine weather also produces fast changes |
| `β_multi` | 2.0 | Strong when it fires; fires rarely |
| `β_qc` | 1.5 | Deliberately the weakest — this is the traditional thresholding PS-073 calls insufficient |
| `β_health` | 1.0 | A prior on plausibility, not evidence about this observation |

Sanity check of the priors: all six at 1.0 gives logit = 9.5, P ≈ 0.99993. QC alone at 1.0 gives logit = −2.5, P ≈ 0.076 — correctly refusing to alert on a threshold breach alone. **That second number is the numerical expression of principle P1**, and it is worth putting on a slide.

### 14.6 Confidence — distinct from probability `[SPEC]`

`P(anomaly)` is *how likely something is wrong*. Confidence is *how much we trust that estimate*. They are routinely conflated; keeping them apart is a differentiator.

```
confidence = evidence_completeness
           × data_quality_factor        (1.0 clean; 0.7 if any input imputed)
           × model_readiness_factor     (MATURE 1.0, TRAINED 0.9, BASELINE 0.7, COLD_START 0.5)
           × spatial_factor             (≥2 peers 1.0, 1 peer 0.8, none 0.6)
           × calibration_factor         (1.0 if fusion coefficients fitted, 0.8 if defaults)
```

Bounded [0.1, 1.0]. Reported alongside every assessment. A `COLD_START` station with no peers and default coefficients reports confidence ≈ 0.5·0.6·0.8 = 0.24 — and the UI should say so.

### 14.7 Three-axis output `[SPEC]` — fixes the conflated enum of §4.3

| Axis | Values | Determined by |
|---|---|---|
| `quality_state` | `VALID`, `SUSPECT`, `INVALID` | Gates + `P` vs thresholds |
| `severity` | `NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` | `P` × persistence × parameter criticality |
| `classification` | `NORMAL`, `LOCALIZED_ANOMALY`, `LOCALIZED_ANOMALY_UNCONFIRMED`, `REGIONAL_EVENT` | Spatial adjudication |

**Backward compatibility (mandatory).** The existing frontend reads a single state field. Keep emitting `legacy_state` derived as:

```
INVALID                                   → "CRITICAL"
classification = REGIONAL_EVENT           → "REGIONAL_EVENT"
severity ∈ {HIGH, CRITICAL}               → "CRITICAL"
classification = LOCALIZED_ANOMALY*       → "LOCALIZED_ANOMALY"
severity ∈ {LOW, MEDIUM}                  → "SUSPECT"
otherwise                                 → "NORMAL"
```

Ship the three new fields **additively**. Migrate views one at a time. Delete `legacy_state` only after all 13 views are migrated, and record that as a separate task.

**Severity mapping:**

| `P` | Base severity | Escalation |
|---|---|---|
| < 0.30 | `NONE` | — |
| 0.30–0.55 | `LOW` | +1 level if persisting ≥ 3 distinct observations |
| 0.55–0.75 | `MEDIUM` | +1 if ≥ 2 core parameters implicated |
| 0.75–0.90 | `HIGH` | +1 if SHI < 40 |
| > 0.90 | `CRITICAL` | — |
| any | `CRITICAL` | forced on L1/L2 hard gate |

**Suppression rule:** when `classification = REGIONAL_EVENT`, severity describes the *meteorological* event and the incident type is `WEATHER_EVENT`, not `SENSOR_FAULT`. No maintenance action is recommended, no imputation is performed, and sensor health is **not** penalised. Getting this right is the difference between a system that cries wolf every monsoon and one a met office would actually run.

### 14.8 Dwell / persistence `[SPEC]`

The cheapest false-alarm reduction available.

| Path | Dwell required |
|---|---|
| L1/L2 hard gate | none — immediate |
| `severity = CRITICAL` | none |
| `HIGH` | 2 consecutive distinct observations |
| `MEDIUM` | 3 |
| `LOW` | 4, and only logged, never alerted |

Counted on **distinct source observations** (§12.4). While dwell is accumulating, the state is visible in the HUD as `PENDING` but no incident row is created. This prevents the incident table filling with single-tick blips and makes the open-incident badge meaningful.

---

## 15. Explainability

### 15.1 Requirement

Every non-NORMAL assessment must let an operator answer, without reading code: what is wrong, how sure are we, which sensor, what does physics say, what do neighbours say, what do we think caused it, and what should I do.

### 15.2 The evidence payload `[SPEC]`

This is the contract between backend and every UI surface. It is stored in `assessments.evidence_json` and `incidents.evidence_data`.

```jsonc
{
  "schema_version": 2,
  "station_id": "AWS-MNG-001",
  "source_timestamp": "2026-09-16T04:00:00Z",
  "assessed_at": "2026-09-16T04:00:01.143Z",

  "verdict": {
    "quality_state": "SUSPECT",
    "severity": "HIGH",
    "classification": "LOCALIZED_ANOMALY",
    "legacy_state": "LOCALIZED_ANOMALY",
    "anomaly_probability": 0.91,
    "confidence": 0.78,
    "evidence_completeness": 0.83,
    "primary_parameter": "temperature",
    "affected_parameters": ["temperature"],
    "dwell_observations": 2
  },

  "readiness": { "tier": "TRAINED", "model_version": "v1.3",
                 "climatology_source": "OWN_HISTORY",
                 "fusion_coefficients": "fc-2026-09-10", "coefficients_fitted": true },

  "observation": {
    "temperature": { "raw": 39.4, "expected": 27.1, "residual_z": 5.8, "wmo_flag": 2 },
    "humidity":    { "raw": 78.0, "expected": 79.4, "residual_z": -0.3, "wmo_flag": 0 },
    "pressure":    { "raw": 1007.2, "expected": 1007.5, "residual_z": -0.2, "wmo_flag": 0 }
  },

  "evidence": {
    "integrity": { "score": 0.0, "findings": [] },
    "physics":   { "score": 0.33, "findings": [
                     { "rule": "DEW_POINT_DEPRESSION_HIGH", "severity": "SOFT",
                       "detail": "T−Td = 13.2 °C, above this station's 99th percentile for 04:00 UTC (8.1 °C)" } ] },
    "temporal":  { "score": 0.72, "findings": [
                     { "rule": "RATE_OF_CHANGE", "severity": "SOFT",
                       "detail": "+8.6 °C in one hour; station hour-bucket σ_rate = 0.9 °C/h ⇒ 9.6 σ" } ] },
    "model":     { "score": 0.83, "isolation_score": 0.94, "threshold": 0.641,
                   "attributions": [
                     { "feature": "z_T",   "contribution": 0.61, "value": 5.8 },
                     { "feature": "dz_T",  "contribution": 0.22, "value": 5.9 },
                     { "feature": "z_dpd", "contribution": 0.09, "value": 2.4 } ] },
    "multivariate": { "score": 0.33, "findings": [
                     { "rule": "T_RH_DECORRELATION",
                       "detail": "6-observation T↔RH correlation +0.38; station norm −0.71" } ] },
    "spatial":   { "status": "OK", "peer_count": 3, "radius_km": 50,
                   "agreement_index": 0.04, "sign_match": false,
                   "target_residual_z": 5.8, "peer_median_residual_z": 0.2, "peer_sigma": 0.6,
                   "peers": [
                     { "station_id": "AWS-MNG-002", "distance_km": 12.4, "elevation_delta_m": 15,
                       "raw": 27.3, "residual_z": 0.3 },
                     { "station_id": "AWS-BNT-001", "distance_km": 31.8, "elevation_delta_m": 120,
                       "raw": 26.1, "residual_z": 0.1 },
                     { "station_id": "AWS-PTR-004", "distance_km": 44.2, "elevation_delta_m": -8,
                       "raw": 27.9, "residual_z": 0.2 } ] },
    "hardware":  { "score": 0.12, "shi": 88, "battery_v": 12.6, "rssi_dbm": -71,
                   "findings": [] }
  },

  "fusion": {
    "method": "logistic",
    "terms": [ { "name": "physics", "z": 0.33, "beta": 3.5, "contribution": 1.16 },
               { "name": "temporal", "z": 0.72, "beta": 2.5, "contribution": 1.80 },
               { "name": "model", "z": 0.83, "beta": 3.0, "contribution": 2.49 },
               { "name": "multivariate", "z": 0.33, "beta": 2.0, "contribution": 0.66 },
               { "name": "qc", "z": 1.0, "beta": 1.5, "contribution": 1.50 },
               { "name": "hardware", "z": 0.12, "beta": 1.0, "contribution": 0.12 } ],
    "intercept": -4.0, "logit": 3.73, "probability": 0.977
  },

  "root_cause": {
    "primary": { "class": "THERMAL_SPIKE", "confidence": 0.81 },
    "alternatives": [ { "class": "CALIBRATION_DRIFT", "confidence": 0.11 },
                      { "class": "POWER_SAG_BROWNOUT", "confidence": 0.05 } ],
    "reasoning": "Step change isolated to temperature; humidity and pressure nominal; three peers within 50 km show no departure; battery and link nominal, excluding power and comms causes."
  },

  "recommendation": {
    "action": "INSPECT_SENSOR",
    "text": "Inspect the temperature probe and radiation shield at AWS-MNG-001. Verify shield ventilation and check for direct solar loading or a loose probe connection.",
    "urgency": "WITHIN_24H",
    "auto_actions_taken": ["VALUE_FLAGGED_WMO_2", "IMPUTED_ESTIMATE_GENERATED"]
  },

  "imputation": {
    "available": true, "parameter": "temperature", "value": 27.4,
    "method": "IDW_ELEVATION_CORRECTED", "source_peers": ["AWS-MNG-002","AWS-BNT-001","AWS-PTR-004"],
    "confidence": 0.86, "wmo_flag": 3,
    "note": "AI-estimated value. Raw observation 39.4 °C is preserved and unchanged."
  }
}
```

**Non-negotiable properties of this payload:**
- `fusion.terms` makes the arithmetic auditable. An operator or a judge can add the contributions and get the logit. Very few student projects can show this; it is cheap to provide and disproportionately convincing.
- `observation.*.expected` shows *what the system thought should happen*, which is what makes residual reasoning legible.
- `imputation.note` states in plain language that the raw value survives (P4).
- Every numeric claim in the payload is computed, never templated.

### 15.3 Explanation for `NORMAL` observations

Emit a reduced payload: verdict, readiness, observation block with residual z-scores, spatial agreement index. Skip the evidence detail. Cost is small and it gives the HUD something meaningful to display continuously rather than only during faults — which matters because ~95 % of the demo's runtime is normal operation.

### 15.4 SHAP `[IMPLEMENTED — verify V7]`

TreeSHAP over an Isolation Forest is well-defined: attribute the deviation of the expected path length from the ensemble mean across features, following the split path. Requirements:

- Attributions must sum (within floating-point tolerance) to `isolation_score − expected_score`. **Add this as an assertion in a test** (T-ML-04) — it is the single check that distinguishes real SHAP from plausible-looking weights.
- Attributions are in the v2 feature space (§10.4), so labels must be human-mapped: `z_T` → "Temperature vs station norm", `dz_T` → "Hourly temperature change", `p_elev_resid` → "Pressure vs elevation expectation". Ship a `FEATURE_LABELS` map used by both backend and frontend.
- Report the top 3–5 only; a 12-term bar chart is noise on a dashboard.
- If SHAP computation fails, emit `attributions: []` with `attribution_status: "UNAVAILABLE"` and continue (P5). Never let explainability failure block detection.

---

## 16. Root-Cause Classification

### 16.1 Current taxonomy `[IMPLEMENTED]`

Eight classes: `THERMAL_SPIKE`, `SENSOR_FLATLINE`, `CALIBRATION_DRIFT`, `SUPER_SATURATION_VIOLATION`, `POWER_SAG_BROWNOUT`, `REGIONAL_WEATHER_FRONT`, `COMMUNICATION_CORRUPTION`, `NOMINAL`.

The taxonomy is good and maps well to real AWS failure modes. Keep it. Two additions are recommended `[P2]`: `MISSING_DATA` (distinct from corruption — a gap is not a wrong value) and `SENSOR_NOISE_DEGRADATION` (variance inflation without mean shift, an early failure signature that currently has nowhere to go).

### 16.2 Formal decision structure `[SPEC]`

Replace any if/elif cascade with an explicit scored rule table, evaluated in priority order. Each class carries preconditions (must hold) and indicators (contribute confidence).

| Priority | Class | Preconditions | Indicators (weight) |
|---|---|---|---|
| 1 | `COMMUNICATION_CORRUPTION` | L1 sentinel/encoding failure | RSSI < −95 dBm (0.3); multiple parameters simultaneously invalid (0.4); prior comms incidents in 24 h (0.3) |
| 2 | `MISSING_DATA` | L1 null/absent | gap > 2 intervals (0.5); station offline (0.5) |
| 3 | `SUPER_SATURATION_VIOLATION` | RH > 105 % or Td > T + 0.5 | persists ≥ 2 obs (0.4); rainfall = 0 (0.3); peers normal (0.3) |
| 4 | `POWER_SAG_BROWNOUT` | battery < 11.2 V | ≥ 2 parameters anomalous simultaneously (0.4); anomaly onset within 3 obs of voltage drop (0.4); recovers when voltage recovers (0.2) |
| 5 | `SENSOR_FLATLINE` | variance ≈ 0 over ≥ 3 **distinct** observations | exactly-repeated bit pattern (0.4); other parameters still varying (0.4); duration (0.2) |
| 6 | `REGIONAL_WEATHER_FRONT` | `classification = REGIONAL_EVENT` | ≥ 3 peers agree (0.3); pressure tendency consistent across peers (0.4); wind/rain corroborate (0.3) |
| 7 | `THERMAL_SPIKE` | \|dz\| step with return, single parameter | peers disagree (0.4); shape is step-not-ramp (0.3); SHAP dominated by `dz_T` (0.3) |
| 8 | `CALIBRATION_DRIFT` | monotone residual trend ≥ 3 days, peers stable | sign-consistent peer offset growth (0.4); variance unchanged (0.3); magnitude > 2× σ (0.3) |
| 9 | `SENSOR_NOISE_DEGRADATION` | residual variance ≥ 3× baseline, mean unchanged | trend over ≥ 7 days (0.5); SHI declining (0.5) |
| 10 | `NOMINAL` | nothing above fired | — |

`confidence = Σ(fired indicator weights)`, clamped to [0.3, 0.95]. Never report 1.0 — the classifier is heuristic and should say so. Always emit the top-3 as `alternatives`, because the second hypothesis is often what the field technician actually finds.

### 16.3 Critical rule: `REGIONAL_EVENT` blocks sensor-fault classes

If `classification = REGIONAL_EVENT`, classes 7 and 8 (`THERMAL_SPIKE`, `CALIBRATION_DRIFT`) are **suppressed entirely** — not down-weighted. A regional front produces exactly the temperature step that looks like a thermal spike, and misfiring here is the precise failure the whole project exists to avoid. It must be structurally impossible, not statistically unlikely.

Add an explicit regression test (T-INT-09) asserting that a STORM injection never produces a `THERMAL_SPIKE` root cause at any station.


---

## 17. Self-Healing / Imputation

### 17.1 Position and constraints

Imputation is the last thing in the chain and the most dangerous. A weather archive that quietly contains model estimates presented as measurements is worse than one with gaps, because the corruption is undetectable downstream. Principle P4 is absolute here.

### 17.2 When imputation runs `[SPEC]`

**All** of the following must hold:

1. `classification` ∈ {`LOCALIZED_ANOMALY`, `INVALID`} — **never** `REGIONAL_EVENT` (§14.7)
2. `P(anomaly) ≥ 0.75` or the observation is missing entirely
3. ≥ 2 valid peers within radius with the parameter present and their own `quality_state = VALID`
4. Peer spread is tight: `robust_sigma_peers ≤ 2.0` in residual units
5. Target station has a climatology (tier ≥ `BASELINE`) so the residual can be converted back to an absolute value

If any fails → `imputation.available = false` with `reason`. Never guess. A stated "cannot reconstruct: only one valid neighbour" is a better answer than a fabricated number.

### 17.3 Method `[IMPLEMENTED, extend]`

Current: spatial IDW with 6.5 °C/km lapse-rate correction plus hypsometric pressure compensation, thermodynamic fallback for isolated stations, WMO flag 3.

**Required change — impute in residual space, then reconstruct:**

```
1. r̂_k = Σⱼ wⱼ · rⱼ  /  Σⱼ wⱼ         where wⱼ = 1 / dⱼ^p , p = 2
        (rⱼ = peer j's residual; dⱼ = Haversine distance km)
2. x̂_k = climatology_k(t) + r̂_k · σ_k
```

**Why this is better than raw IDW with a lapse-rate patch:** interpolating residuals automatically carries each peer's own baseline and elevation, so the lapse-rate correction stops being an approximate bolt-on and becomes implicit. It also handles microclimate (coastal vs inland at the same elevation), which a lapse rate cannot.

Keep the existing raw+lapse path as the fallback when the target has no climatology (`COLD_START`), and record which path was used in `method`.

**Method values:** `IDW_RESIDUAL` (preferred), `IDW_ELEVATION_CORRECTED` (legacy fallback), `THERMODYNAMIC` (derive one parameter from the other two — e.g. RH from T and a peer-supplied dew point), `CLIMATOLOGY_ONLY` (no peers; returns the expected value with confidence capped at 0.4 and a prominent warning).

**Imputation confidence:**
```
conf = peer_agreement_factor × distance_factor × count_factor × method_factor
  peer_agreement_factor = exp(−robust_sigma_peers² / 8)
  distance_factor       = exp(−mean_distance_km / 100)
  count_factor          = min(1, n_peers / 3)
  method_factor         = { IDW_RESIDUAL 1.0, IDW_ELEV 0.9, THERMODYNAMIC 0.7, CLIMATOLOGY_ONLY 0.4 }
```

### 17.4 Storage `[SPEC]` — new table, never an UPDATE

```sql
CREATE TABLE imputations (
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL,
  source_timestamp TIMESTAMP NOT NULL,     -- FK-by-value to telemetry
  parameter TEXT NOT NULL,                 -- temperature | humidity | pressure
  raw_value REAL,                          -- copied for audit; NULL if missing
  imputed_value REAL NOT NULL,
  method TEXT NOT NULL,
  source_peers TEXT NOT NULL,              -- JSON array of station ids
  confidence REAL NOT NULL,
  wmo_flag INTEGER NOT NULL DEFAULT 3,
  assessment_id INTEGER,                   -- FK → assessments
  created_at TIMESTAMP NOT NULL,
  superseded_by INTEGER,                   -- self-FK if re-imputed later
  UNIQUE(station_id, source_timestamp, parameter, created_at)
);
CREATE INDEX idx_imp_station_ts ON imputations(station_id, source_timestamp DESC);
```

**There is no UPDATE path to `telemetry` anywhere in this design.** Add a static check to CI (§29.4) that greps for `UPDATE telemetry` and fails the build if a value column appears in the SET clause. Quality-flag columns may be updated; value columns may not.

### 17.5 UI contract `[SPEC]`

- Imputed values render in a **visually distinct** style: the violet accent already reserved for ML (`--neon-violet`), dashed border, and an explicit `AI-ESTIMATED` chip. Never the same treatment as an observed value.
- The HUD "imputed toggle" already exists `[IMPLEMENTED]`. It must default to **OFF** (observed values shown) and, when ON, display a persistent banner: *"Showing AI-estimated values where sensors are flagged. Raw observations preserved."*
- Any chart plotting imputed points must use a dashed line segment, and the legend must distinguish the two.
- Exports (§28.4) must include both `raw_value` and `imputed_value` as separate columns with the flag. Never a single merged column — that is precisely how corrupted archives are created.

---

## 18. Sensor Health and Predictive Maintenance

### 18.1 Sensor Health Index `[IMPLEMENTED, keep]`

SHI 0–100 from battery, RSSI, drift rate and flatline penalties. This is a reasonable composite health indicator and should be kept.

**Required refinements:**
- Publish the penalty function explicitly in the model/health card so the number is auditable rather than magic.
- Make penalties continuous, not step functions. A battery at 11.81 V and one at 11.79 V should not produce a visible cliff in the dashboard.
- Compute per **sensor**, not only per station: `shi_temperature`, `shi_humidity`, `shi_pressure`, plus `shi_station` for power/comms. A failing RH sensor should not drag the temperature sensor's health down — and per-sensor health is what makes the maintenance recommendation actionable ("replace the RH probe", not "the station is unwell").

**Recommended composition:**

```
shi_sensor = 100 × Π (1 − penaltyₖ)
  drift_penalty     = clamp( |drift_°C_per_day| / 0.5 , 0, 0.6 )
  variance_penalty  = clamp( 1 − var_ratio_vs_baseline , 0, 0.5 )   (flatline)
  noise_penalty     = clamp( (var_ratio − 3) / 6 , 0, 0.4 )         (degradation)
  anomaly_penalty   = clamp( localized_anomaly_rate_30d / 0.10 , 0, 0.4 )
shi_station = 100 × Π (1 − power_penalty) × (1 − link_penalty)
  power_penalty = clamp( (12.4 − V) / 1.4 , 0, 0.7 )
  link_penalty  = clamp( (−80 − RSSI) / 25 , 0, 0.5 )
```

Multiplicative composition is deliberate: two moderate problems compound, which matches how hardware actually fails, and it keeps the index bounded without clipping artefacts.

**Crucial exclusion:** `anomaly_penalty` counts only `LOCALIZED_ANOMALY`. `REGIONAL_EVENT` observations must never reduce sensor health. A station that correctly reported a cyclone is not a sick station.

### 18.2 Drift estimation `[IMPLEMENTED, formalise]`

```
drift_rate = Theil–Sen slope of ( residual_k(t) − peer_median_residual(t) )  over 14 days
```

Theil–Sen (median of pairwise slopes) rather than least squares: it is robust to the spikes that will certainly be present, and it is ~15 lines of pure Python. Requires ≥ 2 valid peers and ≥ 7 days; otherwise emit `drift_rate = null, reason = INSUFFICIENT_PEER_HISTORY` rather than a meaningless number from a single station's own trend — which would be indistinguishable from seasonal change.

Report with an uncertainty band (bootstrap over pairwise slopes, 100 resamples, report 10th–90th percentile). "Drift 0.21 °C/day (0.14–0.29)" is a defensible statement; "0.21 °C/day" alone is not.

### 18.3 Maintenance recommendation

| Condition | Recommendation | Urgency |
|---|---|---|
| `shi_sensor < 40` | Replace or recalibrate sensor | `WITHIN_7D` |
| `drift_rate` band entirely above 0.2 °C/day | Recalibrate | `WITHIN_14D` |
| flatline confirmed ≥ 6 distinct observations | Physical inspection | `IMMEDIATE` |
| battery < 11.2 V | Power system service | `WITHIN_48H` |
| RSSI < −95 dBm sustained 24 h | Antenna / link inspection | `WITHIN_7D` |
| noise penalty > 0.25 for 7 days | Schedule pre-emptive replacement | `WITHIN_30D` |

### 18.4 `[DEFECT — N9]` The RUL problem

`PROGRESS.md`: *"Estimates RUL from SHI using exponential decay model."*

This is a deterministic transform of a heuristic index into a number denominated in days. It contains no survival analysis, no failure-time data, no censoring treatment and no validation, because no station in this project has ever failed. Publishing it as "Remaining Useful Life: 47 days" asserts predictive accuracy that does not exist — exactly the fabrication the brief prohibits.

### 18.5 Required replacement `[SPEC] [P1]`

**Do not delete the feature. Relabel and reframe it so it is both honest and more useful.**

Replace "RUL (days)" with **Degradation Projection**:

```
Given the Theil–Sen trend of shi_sensor over the last 30 days:
  slope_shi  = Theil–Sen slope (SHI points per day), with bootstrap band
  if slope_shi >= -0.05:  projection = "STABLE"    (no crossing projected)
  else:
     days_to_40 = (shi_now − 40) / |slope_shi|
     band       = same computation at the 10th and 90th percentile slopes
```

**Display as:** `"Projected to reach maintenance threshold (SHI 40) in 38–71 days at current trend."`
**Never as:** `"RUL: 54 days."`

Accompany it in the UI with a one-line disclosure: *"Linear extrapolation of the current health trend. Not a validated failure prediction — no failure data exists for this fleet."*

Keep an internal field `rul_heuristic_days` for backward compatibility with any existing UI binding, but rename the **label** everywhere it is displayed and add `method: "TREND_EXTRAPOLATION"` and `validated: false` to the payload.

**Why this is the right call for SIH.** Judges who know statistics will ask how RUL was validated. "It is an honest trend extrapolation with a confidence band and we have labelled it as such because we have no failure data" is a stronger answer than any number. It also sets up a genuinely good `[FUTURE]` item: once real failure events accumulate, fit a Weibull survival model — and you can say exactly that.

---

## 19. Incident Management

### 19.1 Lifecycle `[IMPLEMENTED]`

`OPEN → ACKNOWLEDGED → {GENUINE | REJECTED | ACCEPTED} → RESOLVED`, with auto-resolution when a station returns to NORMAL.

### 19.2 Identity and idempotency `[SPEC]` — hardening

`create_or_update_incident()` is described as an idempotent upsert `[VERIFY]`. Make the key explicit:

```
incident_key = (station_id, primary_parameter, root_cause_primary, open_window)
```
where `open_window` means "there is an existing incident with this key whose status ∉ {RESOLVED, REJECTED}".

On match → update the existing row: bump `occurrence_count`, extend `last_seen_at`, replace `evidence_data` with the latest, escalate `severity` if higher (never de-escalate an open incident — an operator may already have acted on the higher severity).
On no match → insert.

Without this, a 6-hour fault at hourly cadence produces 6 incidents for one physical problem, and the triage queue becomes unusable exactly when it matters.

### 19.3 Auto-resolution `[SPEC]`

Require **3 consecutive distinct observations** at `NORMAL` before auto-resolving, not one. Set `disposition = AUTO_RESOLVED`, `resolved_at`, and preserve the full evidence history. A fault that flickers must not produce a resolve/reopen storm.

### 19.4 Schema additions

Additive columns on `incidents`: `classification`, `severity`, `anomaly_probability`, `confidence`, `occurrence_count`, `first_seen_at`, `last_seen_at`, `auto_resolved`, `incident_type` (`SENSOR_FAULT` | `WEATHER_EVENT` | `DATA_QUALITY` | `MAINTENANCE`). Defaults must preserve current frontend behaviour.

### 19.5 `WEATHER_EVENT` incidents `[SPEC]`

A `REGIONAL_EVENT` still creates an incident — but of type `WEATHER_EVENT`, shown in a separate tab, with no maintenance recommendation and no sensor-health penalty. This is valuable: it demonstrates that the system *noticed* the storm and *correctly declined to blame the hardware*. Silence would be indistinguishable from a missed detection.

### 19.6 Adjudication feeds evaluation `[SPEC]`

Operator dispositions are ground-truth labels. Persist them and surface a running confusion summary in Model Governance:

| Disposition | Meaning | Evaluation role |
|---|---|---|
| `GENUINE` | real sensor fault | True positive |
| `REJECTED` | false alarm | False positive |
| `ACCEPTED` | real weather, correctly classified | True negative for sensor fault |
| `ACKNOWLEDGED` | seen, undecided | Excluded |

Display precision from real adjudications alongside precision from injected faults. Two independent evidence streams for the same metric is a strong thing to show.

---

## 20. MLOps

### 20.1 Current state `[IMPLEMENTED]`

8-stage training lifecycle with live progress polling, model registry with versions and status, JSON artifacts on disk, admin-only rollback, downloadable model cards, training job history.

This is genuinely good and is a differentiator relative to typical hackathon projects. Extend, do not restructure.

### 20.2 Extended lifecycle `[SPEC]`

Add three stages, keeping the existing eight (the UI polls on stage names — add, do not renumber destructively; bump a `pipeline_version` field so the frontend can render either).

| # | Stage | Change |
|---|---|---|
| 1 | Data Ingested | unchanged |
| 2 | Data Validated | **changed** — readiness tier gate (§10.7) replaces the 20-record check |
| 3 | Data Preprocessed | **extended** — contamination cleaning per §10.6 |
| **3b** | **Climatology Fitted** | **new** — IRLS harmonic fit, §10.3 |
| 4 | Features Generated | **changed** — v2 12D residual space |
| 5 | Training Isolation Forest | unchanged |
| 6 | Model Evaluation | **extended** — held-out temporal split, threshold quantile, score deciles |
| **6b** | **Shadow Validation** | **new** — score the last 7 days with the candidate; compare anomaly rate and agreement against the incumbent, §22.3 |
| 7 | Model Registered | **extended** — v2 artifact schema |
| **7b** | **Promotion Gate** | **new** — pass/fail against §22.4 criteria |
| 8 | Model Activated | **changed** — only on gate pass, or explicit admin override |

### 20.3 Model storage

Keep JSON artifacts on disk with a DB pointer. Add: SHA-256 of the artifact stored in `model_registry`, verified on load. A silently corrupted model that still parses is a nasty failure mode; the hash makes it loud. On mismatch → refuse to activate, log, fall back to the previous active version (P5).

### 20.4 The model card

Already downloadable `[IMPLEMENTED]`. Extend with §10.9 fields plus: readiness tier, climatology summary, cleaning counts, threshold derivation, fusion coefficient version, and an explicit **Limitations** section listing training window, seasons covered, peer availability at training time, and whether fusion coefficients were fitted or default. A model card that states its own limitations is exactly what "technically defensible" means.

---

## 21. Model Drift Monitoring

### 21.1 Requirement `[GAP G5]`

`INITIAL_MODEL_DRIFT` exists as a seed constant; no detection logic exists. Build it.

### 21.2 The seasonal confounder — read before implementing

The naive design is PSI between the training distribution of `T`, `H`, `P` and a recent window. **In India this will fire on every monsoon onset and withdrawal**, producing two guaranteed false drift alarms per year, exactly at the moments when the model is most needed.

**Solution:** monitor drift in **residual space**, not raw space. The climatology (§10.3) already removes seasonal and diurnal structure. A stable sensor with a correct model produces residuals that are approximately zero-mean and unit-variance *in every season*. A shift in the residual distribution therefore means the sensor or the model changed — not that the season did.

This is the second architectural payoff of the residual design, after the spatial fix.

### 21.3 Metrics `[SPEC]`

Computed nightly per station over a 14-day rolling window versus the model's training-time reference distribution.

| Metric | Computation | Interpretation | Thresholds |
|---|---|---|---|
| **PSI** on residuals | 10 fixed bins from training deciles; `PSI = Σ (p_cur − p_ref)·ln(p_cur/p_ref)` | Distribution shape change | < 0.10 stable · 0.10–0.25 moderate · > 0.25 significant |
| **Residual mean shift** | \|mean(z_cur)\| | Bias — the classic calibration drift signature | < 0.3 ok · 0.3–0.7 warn · > 0.7 alert |
| **Residual variance ratio** | var(z_cur)/var(z_ref) | Noise degradation (>1) or flatlining (<1) | 0.5–2.0 ok |
| **Anomaly rate** | fraction flagged per distinct observation, 14 d vs training contamination | Model/reality mismatch | > 3× contamination ⇒ alert |
| **Score distribution shift** | KS statistic between current and training IF score deciles | Model behaviour change | D > 0.2 warn |
| **Feature availability** | fraction of observations with complete evidence | Upstream decay | < 0.8 warn |

All are pure-Python arithmetic over stored deciles. No new dependency. KS is computed against the **stored training deciles**, not the raw training set, so the training data need not be retained in memory.

### 21.4 Severity and action

```
drift_severity = max over metrics of their individual severity
  NONE     → nothing
  LOW      → record only
  MODERATE → record + dashboard badge + queue retraining candidate (priority LOW)
  HIGH     → record + incident of type DATA_QUALITY + queue candidate (priority HIGH)
             + reduce confidence multiplier for this station to 0.8 (§14.6)
```

That last clause matters: a station with known drift should report lower confidence in its own verdicts until retrained. That is "self-aware" in a concrete, implementable sense.

### 21.5 Storage and UI

Table `drift_metrics` (§24.3). UI: a drift panel in Model Governance with a sparkline of PSI and residual mean over 90 days, current severity badge, and a "Queue Retraining" button that creates a candidate (never trains inline — nightly jobs should not be triggered from a click during a demo).

---

## 22. Automated Retraining

### 22.1 Principle

Automated **training** is safe. Automated **activation** is not. A model retrained on a window containing an undetected fault will learn that fault as normal and go permanently blind to it — the worst possible failure for a QC system, and a silent one.

Therefore: `trigger → train candidate → shadow validate → gate → activate`, with the gate being the only path to production and an admin override the only bypass.

### 22.2 Triggers `[SPEC]`

| Trigger | Condition | Priority |
|---|---|---|
| Drift | `drift_severity ≥ MODERATE` sustained 3 days | HIGH |
| Volume | +50 % distinct observations since last training | MEDIUM |
| Tier promotion | crosses `BASELINE→TRAINED` or `TRAINED→MATURE` | HIGH |
| Schedule | 30 days since last successful training | LOW |
| Season | entering a season with < 14 days of representation in the training window | MEDIUM |
| Manual | admin/operator request | HIGH |
| Post-maintenance | operator marks a sensor replaced/recalibrated — **history before that point must be excluded** | HIGH |

That last one is subtle and important: after a sensor swap, pre-swap history describes a different instrument. Training across the boundary teaches the model that a step change is normal. Add `sensor_change_events` (§24.3); training windows must start after the most recent event for the affected parameter.

Rate limit: at most one automated training per station per 24 h. Jobs run in the existing background task infrastructure, serialised, never during a demo window (`DEMO_MODE=true` disables automated triggers entirely — make this a config flag and use it).

### 22.3 Shadow validation `[SPEC]`

Before any promotion, the candidate scores the most recent 7 days in parallel with the incumbent, writing to `shadow_scores` rather than to assessments. Compare:

| Comparison | Requirement |
|---|---|
| Anomaly rate | within [0.5×, 2.0×] of incumbent |
| Agreement | ≥ 80 % identical NORMAL/non-NORMAL verdicts |
| Known-fault recall | detects ≥ incumbent's detections on injected faults in the window |
| Score stability | no NaN/inf; deciles monotone |
| Training hygiene | cleaning dropped < 15 % of rows (a higher rate means the window itself is suspect) |

### 22.4 Promotion gate `[SPEC]`

```
PROMOTE automatically iff:
  shadow validation passes all five checks
  AND readiness tier >= TRAINED
  AND candidate trained on >= incumbent's row count
  AND station has no OPEN incident of type SENSOR_FAULT
  AND artifact SHA-256 verifies
ELSE  -> status = PENDING_APPROVAL, admin notified, incumbent stays active
```

The "no open sensor-fault incident" condition prevents the system from retraining a station *while it is broken* and thereby normalising the fault. This is the single most important line in this section.

**Rollback stays.** Every promotion records `parent_version`. One-click rollback (already implemented) must continue to work across the new pipeline. An automatic rollback is triggered if, within 24 h of promotion, the new model's anomaly rate exceeds 5× the incumbent's — logged as an incident, not performed silently.

### 22.5 UI

Model Governance gains a "Candidates" section: candidate version, trigger reason, shadow validation results per criterion, gate outcome, Approve / Reject / View Diff. Rendering the *reason a model was not promoted* is a strong demonstration of MLOps maturity and takes ten minutes to build once the data exists.


---

## 23. Edge / Offline Architecture

### 23.1 What actually runs where — the honest split

The problem statement references edge deployment on low-power hardware such as ESP32. An ESP32 has ~320 KB usable RAM and no Python runtime capable of hosting FastAPI, SQLite and an Isolation Forest ensemble. Claiming "Edge AI" for the full stack would be false and a judge with embedded experience will catch it in one question.

**Three-tier split:**

```
┌─ TIER 1 — STATION NODE (ESP32 / ESP32-S3, C/MicroPython) ─────────────┐
│ • Sensor acquisition (BME280 / SHT31 / BMP390 class)                  │
│ • Range + sanity check against hard constants (§11.3) — ~20 lines     │
│ • Sentinel and NaN rejection at source                                │
│ • Monotonic sequence numbering + RTC timestamping                     │
│ • Ring buffer in LittleFS flash (§23.3)                               │
│ • Connectivity detection, batched upload, exponential backoff         │
│ • Optional: 1-bit "obviously wrong" prefilter (fixed bounds only)     │
│ NO ML. NO climatology. NO peer comparison. Stated plainly.            │
└────────────────────────────┬──────────────────────────────────────────┘
                             │ HTTPS batch, idempotent
┌─ TIER 2 — GATEWAY (optional; Raspberry Pi class, full Python) ────────┐
│ • Aggregates several nodes over LoRa/WiFi                             │
│ • Runs the SAME pure-Python detection stack — this is where the       │
│   zero-dependency ML choice pays off; it installs on a Pi with        │
│   `python3` and nothing else                                          │
│ • Local buffering when the uplink is down                             │
│ • Genuine local inference → this tier is where "edge AI" is true      │
└────────────────────────────┬──────────────────────────────────────────┘
                             │
┌─ TIER 3 — SERVER ─────────────────────────────────────────────────────┐
│ • Full stack: training, spatial intelligence, fusion, incidents,      │
│   drift, retraining, dashboard                                        │
│ • Spatial intelligence CANNOT be pushed down — it needs the fleet     │
└───────────────────────────────────────────────────────────────────────┘
```

**Say exactly this in the demo.** "Detection runs at Tier 2; Tier 1 does acquisition and buffering; spatial intelligence is inherently central because it needs neighbours." That sentence is worth more than an Edge AI label.

### 23.2 What to build for SIH

Tier 2 already exists — it is the existing backend, which runs unmodified on a Raspberry Pi *because* it has no numpy/scikit-learn dependency. The deliverable is therefore:

1. `[P1]` Replace the simulated `EdgeSync.jsx` with a real buffer-and-replay implementation (§28.3).
2. `[P2]` A reference Tier-1 firmware sketch (`edge/esp32_reference/`) — ~200 lines, not flashed to hardware for the demo but present, compilable and documented. Its existence makes the architecture credible; its absence makes the diagram a claim.
3. `[P2]` A documented measurement of the backend running on a Pi-class device, if hardware is available. If not available, **say so** rather than estimating.

### 23.3 Tier-1 buffer design `[SPEC]`

| Aspect | Design |
|---|---|
| Storage | LittleFS ring buffer, fixed 32-byte records |
| Record | `seq:u32, epoch:u32, T:i16(×100), H:u16(×100), P:u32(×10), batt:u16, rssi:i8, flags:u8, crc16` |
| Capacity | 4 MB ≈ 131 000 records ≈ 91 days at 1/min — meets NFR-11 |
| Overflow | Oldest-first eviction, `records_dropped` counter reported on next sync |
| Ordering | Strictly monotonic `seq`, never reused. Survives reboot via a persisted counter |
| Clock | RTC + NTP on connect. If time was never set, mark `time_unsynced` and store an uptime offset; the server reconstructs absolute time from the sync point. **Never** invent a timestamp — a wrong timestamp corrupts every temporal computation downstream |
| Integrity | CRC16 per record; failing records discarded and counted |

### 23.4 Sync protocol `[SPEC]`

```
POST /api/v1/stations/{station_id}/telemetry/batch
Authorization: Bearer <station token>
Idempotency-Key: <sha256 of the batch body>

{ "device_id": "esp32-mng001-a",
  "firmware": "1.2.0",
  "time_synced": true,
  "records_dropped_since_last_sync": 0,
  "records": [ { "seq": 10442, "ts": "2026-09-16T03:00:00Z",
                 "temperature": 27.1, "humidity": 79, "pressure": 1007.4,
                 "battery_v": 12.6, "rssi_dbm": -71 } ] }
```

**Server behaviour:**
1. Look up `Idempotency-Key` in `ingest_idempotency` (TTL 7 days). Hit → return the stored response with `replayed: true`, do nothing else. This is what makes retry-after-timeout safe, which is the whole point.
2. Per record, dedupe on `(station_id, source_timestamp)`. Existing identical → skip. Existing different → store as a conflict for review, **never** overwrite (P4).
3. Insert survivors, run the detection chain on each in timestamp order.
4. Respond with `{ accepted, skipped_duplicate, conflicts, rejected, high_water_seq }`.

**Client behaviour:**
5. Purge only records with `seq ≤ high_water_seq`. Server-acknowledged deletion, never optimistic.
6. Backoff on failure: 1 s, 2 s, 4 s … capped at 300 s, with ±20 % jitter so a fleet recovering from a regional outage does not synchronise into a thundering herd.
7. Batch size ≤ 200 records; chunk larger backlogs.

**Ordering:** a replayed backlog arrives out of real-time order. The detection chain must process it in `source_timestamp` order and must **not** create live incidents for observations older than 6 hours — it records the assessment for the archive and flags the period as `BACKFILLED`. Waking an operator at 2 a.m. for a fault that self-resolved yesterday is a real operational failure.

### 23.5 Connectivity state machine

`ONLINE → DEGRADED (≥2 consecutive failures) → OFFLINE (≥5) → SYNCING → ONLINE`

Surfaced in the HUD and in `/stations/fleet/live` as `link_state`, with buffered record count and last successful sync. This turns the existing simulated Edge Buffer view into a real one with the same visual design — a small change with a large credibility gain.

---

## 24. Database Architecture

### 24.1 Existing tables `[IMPLEMENTED]`

`admins`, `stations`, `telemetry`, `model_registry`, `training_jobs`, `incidents`, `active_faults`, `station_qc_config`, `auth_audit_logs`.

### 24.2 Additive changes to existing tables

Every column below is nullable or has a default, so existing rows and existing queries keep working.

**`telemetry`**
| Column | Type | Purpose |
|---|---|---|
| `source_timestamp` | TIMESTAMP | The observation's own time, distinct from ingest time (§12.4). Backfill = existing `timestamp` |
| `ingested_at` | TIMESTAMP | Server receipt time |
| `observation_source` | TEXT | `OPEN_METEO` \| `UPLOAD` \| `EDGE_BATCH` \| `SYNTHETIC_FAULT` |
| `sequence_no` | INTEGER | Edge monotonic sequence, null otherwise |
| `is_backfilled` | INTEGER | 0/1 |

**`incidents`** — see §19.4.

**`model_registry`** — `readiness_tier`, `artifact_sha256`, `parent_version`, `feature_space_version`, `promotion_status` (`ACTIVE`/`ARCHIVED`/`PENDING_APPROVAL`/`REJECTED`), `promotion_reason`.

**`station_qc_config`** — `source` (`AUTO`/`MANUAL`), `calibrated_at`, `calibrated_from_rows`, `updated_by`, `method_version`.

**`stations`** — `observation_interval_seconds` (default 3600), `commissioned_at`, `link_state`, `last_sync_at`.

### 24.3 New tables `[SPEC]`

```sql
-- Per-observation assessment. The audit record of every judgement made.
CREATE TABLE assessments (
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL,
  source_timestamp TIMESTAMP NOT NULL,
  assessed_at TIMESTAMP NOT NULL,
  quality_state TEXT NOT NULL,
  severity TEXT NOT NULL,
  classification TEXT NOT NULL,
  legacy_state TEXT NOT NULL,
  anomaly_probability REAL,
  confidence REAL,
  evidence_completeness REAL,
  primary_parameter TEXT,
  root_cause TEXT,
  root_cause_confidence REAL,
  model_version TEXT,
  fusion_coefficients_version TEXT,
  evidence_json TEXT NOT NULL,
  UNIQUE(station_id, source_timestamp)
);
CREATE INDEX idx_assess_station_ts ON assessments(station_id, source_timestamp DESC);
CREATE INDEX idx_assess_class ON assessments(classification, assessed_at DESC);

-- Learned per-station diurnal/seasonal baseline.
CREATE TABLE station_climatology (
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL,
  parameter TEXT NOT NULL,
  version INTEGER NOT NULL,
  coefficients TEXT NOT NULL,      -- JSON: 10 harmonic coefficients
  sigma_by_bucket TEXT NOT NULL,   -- JSON: 8 robust sigmas
  fit_method TEXT NOT NULL,
  source TEXT NOT NULL,            -- OWN_HISTORY | REGIONAL_PRIOR
  fitted_from_rows INTEGER,
  fitted_at TIMESTAMP NOT NULL,
  is_active INTEGER DEFAULT 1,
  UNIQUE(station_id, parameter, version)
);

-- Fitted fusion coefficients (§14.5). Global, versioned.
CREATE TABLE fusion_coefficients (
  version TEXT PRIMARY KEY,
  coefficients TEXT NOT NULL,      -- JSON {intercept, qc, phys, temp, ml, multi, health}
  fitted_at TIMESTAMP,
  corpus_description TEXT,
  corpus_rows INTEGER,
  validation_metrics TEXT,         -- JSON {auc_pr, brier, folds}
  is_default INTEGER DEFAULT 0,    -- 1 = shipped priors, not fitted
  is_active INTEGER DEFAULT 0
);

CREATE TABLE imputations ( /* §17.4 */ );

CREATE TABLE sensor_health (
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL,
  parameter TEXT,                  -- NULL = station-level (power/link)
  computed_at TIMESTAMP NOT NULL,
  shi REAL NOT NULL,
  drift_rate REAL, drift_ci_low REAL, drift_ci_high REAL,
  variance_ratio REAL,
  anomaly_rate_30d REAL,
  projection_days_low REAL, projection_days_high REAL,
  projection_status TEXT,          -- STABLE | DEGRADING | INSUFFICIENT_DATA
  penalties_json TEXT
);
CREATE INDEX idx_health_station ON sensor_health(station_id, computed_at DESC);

CREATE TABLE drift_metrics (
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL,
  computed_at TIMESTAMP NOT NULL,
  model_version TEXT,
  window_days INTEGER,
  psi_temperature REAL, psi_humidity REAL, psi_pressure REAL,
  residual_mean_shift REAL, residual_variance_ratio REAL,
  anomaly_rate REAL, anomaly_rate_reference REAL,
  ks_statistic REAL, feature_availability REAL,
  severity TEXT NOT NULL,
  triggered_candidate INTEGER DEFAULT 0
);

CREATE TABLE retraining_candidates (
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  priority TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL,            -- QUEUED|TRAINING|SHADOW|PENDING_APPROVAL|PROMOTED|REJECTED|FAILED
  candidate_version TEXT,
  shadow_results TEXT,             -- JSON per-criterion
  gate_outcome TEXT, gate_reason TEXT,
  decided_by TEXT, decided_at TIMESTAMP
);

CREATE TABLE maintenance_tasks (         -- §28.2
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL,                -- e.g. '2026-W38'
  completed INTEGER DEFAULT 0,
  completed_by TEXT, completed_at TIMESTAMP,
  notes TEXT,
  UNIQUE(station_id, task_key, cycle_id)
);

CREATE TABLE maintenance_audit (
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL, cycle_id TEXT NOT NULL,
  submitted_by TEXT NOT NULL, submitted_at TIMESTAMP NOT NULL,
  tasks_snapshot TEXT NOT NULL, signature_hash TEXT NOT NULL
);

CREATE TABLE sensor_change_events (      -- §22.2
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL, parameter TEXT NOT NULL,
  event_type TEXT NOT NULL,              -- REPLACED | RECALIBRATED | REPAIRED
  occurred_at TIMESTAMP NOT NULL,
  recorded_by TEXT NOT NULL, notes TEXT
);

CREATE TABLE config_audit (              -- §28.1
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,             -- QC_CONFIG | STATION | MODEL
  entity_id TEXT NOT NULL,
  changed_by TEXT NOT NULL, changed_at TIMESTAMP NOT NULL,
  before_json TEXT, after_json TEXT, reason TEXT
);

CREATE TABLE ingest_idempotency (        -- §23.4
  idempotency_key TEXT PRIMARY KEY,
  station_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE station_neighbours (        -- §13.7, cached
  station_id TEXT NOT NULL, peer_id TEXT NOT NULL,
  distance_km REAL NOT NULL, elevation_delta_m REAL,
  PRIMARY KEY (station_id, peer_id)
);

CREATE TABLE shadow_scores (             -- §22.3
  id INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL, candidate_version TEXT NOT NULL,
  source_timestamp TIMESTAMP NOT NULL,
  candidate_score REAL, incumbent_score REAL,
  candidate_verdict TEXT, incumbent_verdict TEXT
);
```

### 24.4 Indexes to add on existing tables

```sql
CREATE INDEX IF NOT EXISTS idx_telemetry_station_source_ts
  ON telemetry(station_id, source_timestamp DESC);          -- the hot path
CREATE INDEX IF NOT EXISTS idx_incidents_station_status
  ON incidents(station_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_registry_active
  ON model_registry(station_id, promotion_status);
CREATE INDEX IF NOT EXISTS idx_auth_audit_time
  ON auth_audit_logs(created_at DESC);
```

`idx_telemetry_station_source_ts` is the important one: every detection cycle, every chart and every training run reads "last N observations for station X". Without it, SQLite scans.

### 24.5 Migration framework `[SPEC]`

`database.py` is 64 KB and holds all SQL. Do not rewrite it. Add beside it:

```
backend/app/storage/
  database.py          (unchanged)
  migrations/
    __init__.py        runner
    m001_add_source_timestamp.py
    m002_create_assessments.py
    ...
  dialect.py           SQLite/PostgreSQL SQL differences
```

Runner rules:
- Table `schema_migrations(version, applied_at, checksum)`.
- Sequential, idempotent, forward-only. Each migration declares `sqlite_sql` and `postgres_sql`; identical DDL may be shared.
- Runs automatically at startup, before the weather poller starts.
- A failed migration aborts startup loudly. Do not run a half-migrated schema.

**Dialect differences to centralise in `dialect.py`:** `INTEGER PRIMARY KEY` vs `SERIAL`/`BIGSERIAL`; `INSERT OR IGNORE` vs `ON CONFLICT DO NOTHING`; `TIMESTAMP` vs `TIMESTAMPTZ`; `?` vs `%s` placeholders; JSON as `TEXT` vs `JSONB`; `strftime` vs `date_trunc`.

### 24.6 TimescaleDB `[GAP G7]` → §28.7

### 24.7 Retention `[SPEC]`

| Data | Retention | Rationale |
|---|---|---|
| `telemetry` raw | indefinite (compressed after 30 d in Timescale) | Scientific record |
| `assessments` | 2 years, then keep only non-NORMAL | Normal verdicts are re-derivable; anomalies are the audit trail |
| `shadow_scores` | 30 days after the decision | Transient |
| `drift_metrics` | 2 years | Long-horizon trend |
| `auth_audit_logs` | 1 year | Security |
| `ingest_idempotency` | 7 days | Replay window |

---

## 25. API Specification

### 25.1 Conventions

- Base `/api/v1`. Never break a v1 contract; add fields additively.
- Auth: `Authorization: Bearer <token>` on everything except `/health` and the two login endpoints.
- Errors: FastAPI `{ "detail": "..." }`, preserved because `apiClient.js` already extracts that field.
- Codes: 400 validation · 401 missing/invalid token · 403 authenticated but not permitted · 404 · 409 conflict · 422 schema · 429 rate limit · 500.
- Timestamps ISO-8601 UTC with `Z`.

### 25.2 Authorisation model — applies to every endpoint

```
require_admin        : role == "admin"
require_station(sid) : role == "admin"  OR  (role == "operator" AND token.station_id == sid)
require_auth         : any valid token
```

**`require_station` replaces every current `Optional` on a station-scoped path.** This is the N2 fix and it is mandatory. Full endpoint-by-endpoint table in §27.4.

### 25.3 New endpoints

#### QC rule persistence `[GAP G1]`

```
GET /api/v1/stations/{station_id}/qc          auth: require_station
PUT /api/v1/stations/{station_id}/qc          auth: require_admin

PUT request:
{ "temp_min": -5.0, "temp_max": 48.0, "hum_min": 5.0, "hum_max": 100.0,
  "pres_min": 950.0, "pres_max": 1050.0, "wind_max": 55.0, "rain_max": 120.0,
  "temp_max_rate": 4.5, "flatline_window": 6, "reason": "Post-monsoon recalibration" }

Validation:
  every *_min < corresponding *_max
  temp  ∈ [-90, 60]     hum ∈ [0, 105]     pres ∈ [500, 1100]
  temp_max_rate ∈ (0, 20]    flatline_window ∈ [2, 48]
  envelope must not exclude > 5 % of the station's last 30 days of VALID observations
    → 409 { "detail": "Envelope would flag 23% of recent valid data", "preview": {...} }

Response 200:
{ "station_id": "...", "config": {...}, "source": "MANUAL",
  "updated_by": "admin", "updated_at": "...", "audit_id": 91 }
```

Side effects: write `station_qc_config` with `source='MANUAL'`; write `config_audit` before/after; invalidate the in-memory QC cache for that station; **do not** retrain.

```
POST /api/v1/stations/{station_id}/qc/recalibrate   auth: require_admin
  → recompute from cleaned history (§11.5), sets source='AUTO'
GET  /api/v1/stations/{station_id}/qc/history       auth: require_station
  → config_audit entries for this station
```

#### Maintenance checklist `[GAP G2]`

```
GET   /api/v1/stations/{id}/maintenance/tasks?cycle_id=2026-W38   require_station
PATCH /api/v1/stations/{id}/maintenance/tasks/{task_key}          require_station
        { "completed": true, "notes": "Shield cleaned, no corrosion" }
POST  /api/v1/stations/{id}/maintenance/submit                    require_station
        { "cycle_id": "2026-W38", "signature": "operator_name" }
        → snapshot + SHA-256 signature_hash into maintenance_audit
GET   /api/v1/stations/{id}/maintenance/history                   require_station
POST  /api/v1/stations/{id}/sensor-change                         require_station
        { "parameter": "temperature", "event_type": "RECALIBRATED",
          "occurred_at": "...", "notes": "..." }        → feeds §22.2
```

#### Edge batch ingest `[GAP G3]`

```
POST /api/v1/stations/{id}/telemetry/batch    require_station
     header Idempotency-Key: <sha256>
     → 200 { accepted, skipped_duplicate, conflicts, rejected,
             high_water_seq, replayed:false }
GET  /api/v1/stations/{id}/sync-status        require_station
     → { link_state, buffered_estimate, last_sync_at, high_water_seq }
```

#### Export integrity `[GAP G4]`

```
POST /api/v1/export/telemetry                  require_admin
     { "station_ids": [...], "from": "...", "to": "...",
       "include_imputed": true, "format": "json" }
     → { export_id, generated_at, record_count, sha256,
         canonicalization: "JCS/RFC8785, UTF-8, no trailing newline",
         download_url }
POST /api/v1/export/verify                     require_auth
     { "export_id": "...", "sha256": "..." }  → { valid, generated_at, generated_by }
```

#### Drift and retraining `[GAP G5, G6]`

```
GET  /api/v1/stations/{id}/drift?days=90                require_station
GET  /api/v1/stations/{id}/drift/latest                 require_station
POST /api/v1/stations/{id}/drift/compute                require_admin   (on-demand)
GET  /api/v1/retraining/candidates?status=PENDING_APPROVAL   require_admin
POST /api/v1/retraining/candidates/{id}/approve         require_admin
POST /api/v1/retraining/candidates/{id}/reject          require_admin  { "reason": "..." }
GET  /api/v1/retraining/candidates/{id}/shadow-diff     require_admin
```

#### Assessments and explainability

```
GET /api/v1/stations/{id}/assessments/latest            require_station
    → full evidence payload (§15.2) for the most recent observation
GET /api/v1/stations/{id}/assessments?from=&to=&classification=   require_station
GET /api/v1/assessments/{assessment_id}                 require_station (via owning station)
```

This endpoint is what lets the HUD stop computing its own verdict in JavaScript (§26.3).

#### Health

```
GET /api/v1/stations/{id}/health                        require_station
    → per-sensor SHI, drift with CI, projection band, penalties, recommendations
GET /api/v1/fleet/health                                require_admin
```

### 25.4 Modified endpoints

| Endpoint | Change | Compatibility |
|---|---|---|
| `GET /stations/fleet/live` | add `classification`, `severity`, `anomaly_probability`, `confidence`, `readiness_tier`, `link_state`; keep `state` as `legacy_state` | Additive — safe |
| `POST /stations/{id}/score` | return the full §15.2 payload; keep existing top-level fields | Additive |
| `GET /stations/{id}/models/active` | add readiness tier, climatology summary, threshold derivation, artifact hash | Additive |
| `GET /incidents` | **auth change** Optional → `require_auth`, operator filtered to own station | **Breaking for unauthenticated callers — intended.** Verify frontend always sends the token |
| `DELETE /incidents` | **auth change** Optional → `require_admin`; add `?station_id=` scope; **never** allow unscoped delete-all in production mode | Breaking — intended (N1) |
| `GET /stations/{id}/qc` | Optional/Bearer → `require_station` (§28.8) | Fix the caller, not the guard |
| All `Optional` station paths | → `require_station` | §27.4 |

### 25.5 Rate limiting `[P2]`

In-memory token bucket keyed by `(token_subject, endpoint_class)`: auth 10/min, writes 60/min, reads 600/min, training 5/hour. Returns 429 with `Retry-After`. Not required for the demo; required before any deployment.


---

## 26. Frontend Architecture

### 26.1 Keep

React 18.3 + Vite 6, Context API, Leaflet, Chart.js, vanilla CSS cyberpunk theme, 13 views, 3 modals, tactical audio. No framework changes. No component library. No state-management library — Context is sufficient at this scale and adding Redux now would be churn without benefit.

### 26.2 State model `[SPEC]` — clarify, do not replace

| Context | Owns | Refresh |
|---|---|---|
| `AuthContext` | token, role, `station_id`, session validity | on login; verify on mount |
| `WeatherContext` | fleet live state, incidents, models, QC config | 5 s poll |
| `AssessmentContext` **(new)** | latest full evidence payload for the focused station | on station focus + 5 s |

`AssessmentContext` exists so the HUD and the incident modal read **one** server-computed verdict instead of each deriving their own. It is the vehicle for the N5 fix.

### 26.3 `[DEFECT — N5]` Resolving the dual-engine problem `[P1]`

`mlEngine.js` (440 lines), `qcEngine.js` (210), `spatialEngine.js` (289) reimplement backend logic in the browser. Left alone, they will diverge; the failure appears as the HUD and the incident modal disagreeing, in front of judges.

**Decision: the backend is the sole authority. The JS engines are demoted, not deleted.**

| Engine | New role |
|---|---|
| `mlEngine.js` | **Demoted to offline-preview only.** Used solely by the Training Studio to preview what features would be generated, and by the edge-offline view. Never renders a production verdict. Any output shown carries a `LOCAL PREVIEW — NOT AUTHORITATIVE` chip |
| `qcEngine.js` | **Demoted to client-side input validation** in the QC rule editor (instant feedback before PUT). Not a verdict producer |
| `spatialEngine.js` | **Kept for map rendering only** — drawing neighbour lines within the radius slider. Distance computation for display is legitimately a client concern |

**Migration steps (in order):**
1. Build `GET /stations/{id}/assessments/latest` (§25.3).
2. Add `AssessmentContext`.
3. Change `StationHUD.jsx` to render from the context. Delete its local scoring calls.
4. Same for `CommandCenter.jsx` and `IncidentModal.jsx`.
5. Add a contract test (T-INT-11): one fixed observation fixture, run through Python and through the remaining JS helpers, assert agreement within 1e-6 for any shared computation (Haversine, dew point).
6. Delete unreachable JS scoring code only after step 5 passes.

**Why demote rather than delete:** the JS mirror is a genuine asset for the offline story and for the Training Studio preview. The problem is not that it exists; it is that two authorities exist. One authority, one mirror, clearly labelled.

### 26.4 New and changed views

| View | Change | Priority |
|---|---|---|
| `QCRules.jsx` | Wire Save → `PUT /qc`; add validation preview, audit history panel, `AUTO`/`MANUAL` badge, Recalibrate button | P0 |
| `StationChecklist.jsx` | Wire to the maintenance API; add cycle selector, notes, submit-with-signature, history | P1 |
| `EdgeSync.jsx` | Real buffer/replay against the batch endpoint; live `link_state`; remove the `alert()` | P1 |
| `Export.jsx` | Server-side export with real hash; verify dialog | P1 |
| `ModelGovernance.jsx` | Drift panel; Candidates section with shadow results and Approve/Reject; readiness tier badge | P1 |
| `StationHUD.jsx` | Render from `AssessmentContext`; new "Evidence" panel (§26.5); residual-vs-expected chart overlay; readiness tier chip; `UNCONFIRMED` banner | P0 |
| `IncidentModal.jsx` | Render `fusion.terms` breakdown; alternatives; evidence completeness; imputation provenance | P0 |
| `CommandCenter.jsx` | Three-axis columns (state / severity / classification); drift and readiness indicators | P1 |
| `StationDiagnostics.jsx` | Per-sensor SHI; degradation projection band with the honesty disclaimer (§18.5) | P1 |
| `FleetMap.jsx` | Colour by classification; draw peer-agreement lines during a regional event | P2 |

### 26.5 The Evidence panel — the most important new UI `[SPEC] [P0]`

A single panel in the HUD and the incident modal that makes the verdict legible at a glance. Layout, in the existing cyberpunk idiom:

```
┌─ ASSESSMENT ────────────────────────── AWS-MNG-001 · 04:00Z ─┐
│  LOCALIZED ANOMALY          P(anomaly) 0.91   confidence 0.78│
│  severity HIGH · evidence 5/6 · model v1.3 TRAINED           │
├──────────────────────────────────────────────────────────────┤
│  EVIDENCE CONTRIBUTIONS         (logit 3.73 → P 0.977)       │
│   model        ████████████████████░░  2.49                  │
│   temporal     ██████████████░░░░░░░░  1.80                  │
│   qc           ████████████░░░░░░░░░░  1.50                  │
│   physics      █████████░░░░░░░░░░░░░  1.16                  │
│   multivariate █████░░░░░░░░░░░░░░░░░  0.66                  │
│   hardware     █░░░░░░░░░░░░░░░░░░░░░  0.12                  │
│   baseline                            −4.00                  │
├──────────────────────────────────────────────────────────────┤
│  PEER CONSENSUS        agreement 0.04  ·  3 peers ≤ 50 km    │
│   this station   +5.8 σ   ███████████████████                │
│   MNG-002 12 km  +0.3 σ   █                                  │
│   BNT-001 32 km  +0.1 σ   ▍                                  │
│   PTR-004 44 km  +0.2 σ   ▊                                  │
│   → Neighbours are at their own normal. Sensor suspected.    │
├──────────────────────────────────────────────────────────────┤
│  ROOT CAUSE  THERMAL_SPIKE (0.81)                            │
│   alt: CALIBRATION_DRIFT 0.11 · POWER_SAG 0.05               │
│  ACTION  Inspect temperature probe and radiation shield      │
└──────────────────────────────────────────────────────────────┘
```

Two properties make this worth building: the contribution bars turn the fusion arithmetic into something a judge grasps in three seconds, and the peer bars make the central innovation **visible** rather than asserted. During the STORM injection the peer bars all rise together and the verdict flips to `REGIONAL_EVENT` — that single visual is the demonstration of the entire project.

### 26.6 `[GAP G11]` Replace `alert()` / `prompt()` `[P2]`

Add `ConfirmModal.jsx` and `PromptModal.jsx` in the existing modal style, plus a lightweight toast. Replace call sites in `StationCredentials.jsx` (password reset), `EdgeSync.jsx`, `Export.jsx`, `StationChecklist.jsx`. Cosmetic, but native dialogs break the visual identity at exactly the moments a judge is watching an interaction.

### 26.7 Frontend failure handling (P5)

| Failure | Behaviour |
|---|---|
| API 401 | clear session, redirect to login, toast "Session expired" |
| API 403 | inline "Not authorised for this station" — never a blank screen |
| API 5xx / timeout | keep last known state, show a stale-data badge with age, retry with backoff |
| Poll fails 3× | banner "Live connection lost — showing data from HH:MM" |
| Malformed payload | `ErrorBoundary` already exists; ensure it is per-view, not only at root, so one broken panel does not blank the dashboard |
| Missing evidence field | render "—", never `undefined` or a crash |

---

## 27. Authentication and Security

### 27.1 Threat model for this project

Two contexts, explicitly separated as the brief requires.

**SIH demo:** localhost, trusted network, judges watching. Threats are accidental data loss during the demo and anything a judge can trivially expose by asking "what if I call this endpoint directly?".

**Production (IMD-class deployment):** untrusted networks, real stations, multi-tenant operators, data that feeds forecasting. Threats are cross-station data access, tampering with QC configs, model poisoning, credential theft.

Items below are labelled `[DEMO]` (fix before SIH) or `[PROD]` (document, do not necessarily build).

### 27.2 Current state `[IMPLEMENTED]`

PBKDF2-HMAC-SHA256 at 100 000 iterations with 16-byte random salt `[good]`; `hmac.compare_digest` constant-time comparison `[good]`; custom HMAC-SHA256 JWT `[acceptable — see 27.3]`; 24-hour expiry; role and `station_id` embedded in the token; `auth_audit_logs`; deactivated stations rejected with 403.

This is a reasonable baseline and better than most projects at this level.

### 27.3 Hand-rolled JWT — required hardening `[DEMO]`

Keeping the custom implementation is fine; it must pass this checklist. Each item is a real attack on naive implementations.

| # | Check | Why |
|---|---|---|
| 1 | Reject `alg` ≠ `HS256`, explicitly reject `none` | The classic JWT bypass. If the verifier reads `alg` from the token and trusts it, `{"alg":"none"}` forges any identity |
| 2 | Verify signature **before** parsing the payload | Parsing untrusted JSON first widens the attack surface |
| 3 | `hmac.compare_digest` on the signature | Timing oracle |
| 4 | Enforce `exp`; require `iat`; reject `iat` more than 60 s in the future | Clock-skew abuse |
| 5 | Fail closed on malformed tokens — three segments, valid base64url, valid JSON | |
| 6 | Secret from env var with **no insecure default**. Refuse to start if `SECRET_KEY` is unset in non-debug mode | A hardcoded fallback secret in a public repo is game over |
| 7 | Include `sub`, `role`, `station_id`, `iat`, `exp`, `jti` | `jti` enables revocation later |

Add `test_jwt_security.py` covering forged `alg:none`, tampered payload, expired token, wrong secret, truncated token. Five tests, high value — and a good answer when a judge asks about security testing.

### 27.4 `[DEFECT — N1, N2]` Authorisation matrix `[P0] [DEMO]`

The single most important security fix. Every endpoint gets an explicit guard; `Optional` is eliminated from station-scoped and incident paths.

| Endpoint | Current | **Required** | Notes |
|---|---|---|---|
| `GET /health` | None | None | fine |
| `POST /auth/*/login` | None | None + rate limit | |
| `GET /auth/me` | Bearer | `require_auth` | |
| `GET /admin/stations` | Admin | `require_admin` | |
| `POST /admin/stations` | Admin | `require_admin` | |
| `POST /admin/stations/batch-presets` | Admin | `require_admin` | |
| `PUT /admin/stations/{id}` | Admin | `require_admin` | |
| `PATCH /admin/stations/{id}/status` | Admin | `require_admin` | |
| `POST /admin/stations/{id}/reset-password` | Admin | `require_admin` | |
| `GET /stations/{id}` | **Optional** | `require_station` | N2 |
| `GET /stations/{id}/qc` | Bearer (401 bug) | `require_station` | N3 — §28.8 |
| `PUT /stations/{id}/qc` | — | `require_admin` | new |
| `POST /stations/{id}/telemetry/upload` | Bearer | `require_station` | verify it checks the path id, not just the token |
| `POST /stations/{id}/telemetry/batch` | — | `require_station` | new |
| `GET /stations/{id}/telemetry/stats` | **Optional** | `require_station` | N2 |
| `GET /stations/fleet/live` | **Optional** | `require_auth`, **response filtered by role** | Operators receive only their own station's entry. This is a data-scoping change, not only a guard |
| `POST /stations/{id}/train` | Bearer | `require_station` | |
| `GET /stations/{id}/training-jobs*` | **Optional** | `require_station` | N2 |
| `GET /stations/{id}/models*` | **Optional** | `require_station` | N2 |
| `POST /stations/{id}/models/{v}/rollback` | Admin | `require_admin` | |
| `POST /stations/{id}/score` | Bearer | `require_station` | |
| `POST /stations/{id}/faults/*` | Bearer | `require_station` + `DEMO_MODE` guard | see 27.6 |
| `GET /incidents` | **Optional** | `require_auth` + role filter | **N1/N2 — fleet data disclosure** |
| `GET /incidents/{id}` | **Optional** | `require_auth` + ownership check | N2 |
| `POST /incidents/{id}/adjudicate` | Bearer | `require_station` via the incident's station | |
| `DELETE /incidents` | **Optional** | `require_admin` + `?station_id` scope + confirm token | **N1 — unauthenticated mass deletion** |

**Implementation:** one FastAPI dependency factory.

```python
def require_station(station_id: str = Path(...), user = Depends(get_current_user)):
    if user.role == "admin":
        return user
    if user.role == "operator" and user.station_id == station_id:
        return user
    raise HTTPException(403, "Not authorised for this station")
```

Then add `test_station_isolation_matrix.py`: for every station-scoped endpoint, assert operator-A→station-B is 403, operator-A→station-A is 200, admin→any is 200, no-token is 401. Parameterise over the endpoint list so new endpoints cannot silently skip the check. **This test is the acceptance criterion for FR-5.1.**

### 27.5 Other fixes

| Item | Severity | Fix | Label |
|---|---|---|---|
| CORS `allow_origins=["*"]` `[G9]` | Medium | Read from `ALLOWED_ORIGINS` env; default `http://localhost:5173`; wildcard only when `DEBUG=true` | `[DEMO]` |
| Plaintext `access_key` beside the hash | **High** | See below | `[DEMO]` |
| Token in `localStorage` | Medium | Accept for demo; document httpOnly cookie + CSRF as the production path | `[PROD]` |
| No rate limit on login | Medium | 10/min per IP; lock 15 min after 10 failures | `[DEMO]`, cheap |
| No HTTPS | High | Out of scope locally; deployment must terminate TLS | `[PROD]` |
| Upload validation | Medium | Cap file size (10 MB), row count (100 000), enforce content type, reject non-UTF-8 | `[DEMO]` |
| Secrets in repo | High | `.env.example` only; verify no committed secret; add a pre-commit grep | `[DEMO]` |

**On the plaintext access key.** Storing the recoverable password so the admin panel can reveal it defeats the PBKDF2 hashing entirely — the hash protects nothing if the plaintext sits in the next column. It is also the kind of thing a judge will spot in a schema screenshot.

*Minimum fix for the demo (small, keeps the UX):* show the generated passphrase **once**, at creation and at reset, from the in-memory value in the response — never persisted. Replace the credentials-panel "reveal" with "Reset password", which generates a new one and shows it once. Delete the `access_key` column. This takes under an hour and turns a visible weakness into a talking point about credential handling.

### 27.6 Fault injection safety `[SPEC]`

Fault injection writes synthetic data into a scientific archive. Guard it:
- Only permitted when `DEMO_MODE=true` (env). In production mode the endpoints return 403.
- Every injected observation is tagged `observation_source='SYNTHETIC_FAULT'` (§24.2) and is excluded by default from exports and from training windows.
- Active faults auto-expire after a configurable TTL (default 30 min) so a forgotten injection cannot poison a long run.
- `POST /faults/reset` clears state **and** marks the affected rows.

---

## 28. Missing Features — Implementation Plan

Each subsection follows the required template: Purpose · Architecture · Data flow · API · Database · Backend · Frontend · Security · Failure handling · Testing · Acceptance.

### 28.1 QC Rule Persistence `[GAP G1] [P0]`

**Purpose.** Operators must be able to correct a station's QC envelope when auto-calibration produces a poor one, and that correction must survive a restart and be auditable. Today the edit is discarded, which is worse than not offering it — it silently misleads.

**Architecture.** `QCRules.jsx` → `apiClient.updateQCConfig()` → `PUT /stations/{id}/qc` → validation service → `station_qc_config` + `config_audit` → QC cache invalidation → next detection cycle uses the new envelope.

**Data flow.** In: edited threshold set + reason. Out: persisted config, audit row, invalidated cache. Side effect: subsequent assessments use the new envelope. No retraining.

**API.** §25.3 (`GET`, `PUT`, `POST /recalibrate`, `GET /history`).

**Database.** `station_qc_config` + `source`, `calibrated_at`, `calibrated_from_rows`, `updated_by`, `method_version`. New `config_audit`.

**Backend.**
- `services/qc_config_service.py`: `get_config`, `validate_config`, `update_config`, `recalibrate_from_history`, `invalidate_cache`.
- Validation per §25.3, including the ≤ 5 % historical-exclusion check — the guard that stops an operator from accidentally silencing a station.
- Auto-calibration must never overwrite `source='MANUAL'` unless `force=true`.

**Frontend.** Editable fields with inline validation via `qcEngine.js`; Save disabled until dirty and valid; 409 renders the preview of how much data would be excluded; `AUTO`/`MANUAL` badge with `calibrated_at`; "Recalibrate from history" (admin); audit history panel. Optimistic update with rollback on failure and a toast.

**Security.** `PUT` and `recalibrate` are admin-only — a QC envelope is a detection-sensitivity control and an operator widening their own envelope could hide a fault. `GET` and history are `require_station`.

**Failure handling.** Validation → 400 with the offending field. Exclusion check → 409 with preview. DB failure → 500, no partial write (single transaction covering config + audit). Concurrent edit → last-write-wins, both rows in audit.

**Testing.** T-QC-01 round-trip persistence · 02 min>max rejected · 03 physically-impossible rejected · 04 over-restrictive → 409 · 05 operator PUT → 403 · 06 audit row content · 07 next assessment uses new envelope · 08 recalibrate does not clobber MANUAL.

**Acceptance.** Edit → save → hard refresh → values persist. Audit shows before/after/actor/reason. A deliberately narrow envelope is rejected with an explanatory preview. Operator PUT is 403. New envelope demonstrably changes the next assessment.

---

### 28.2 Maintenance Checklist Persistence `[GAP G2] [P1]`

**Purpose.** Maintenance records are compliance artefacts. In-memory state means a technician's completed inspection vanishes on refresh — and the system has no record of when the station was last serviced, which §22.2 needs to exclude pre-service history from training.

**Architecture.** `StationChecklist.jsx` → maintenance API → `maintenance_tasks` (per cycle) + `maintenance_audit` (signed submissions) + `sensor_change_events` (feeds retraining).

**Data flow.** Task toggle → PATCH → row upsert. Submit → snapshot serialised, SHA-256 signed, audit row written, cycle closed. A `RECALIBRATED` entry creates a `sensor_change_events` row that bounds future training windows.

**API.** §25.3.

**Database.** `maintenance_tasks`, `maintenance_audit`, `sensor_change_events`.

**Backend.** `services/maintenance_service.py`: `get_cycle_tasks` (seeds defaults from `seedData` task keys on first access), `toggle_task`, `submit_cycle`, `get_history`, `record_sensor_change`. Cycle id = ISO week (`2026-W38`) by default, configurable to monthly.

**Frontend.** Cycle selector (current + last 8); checkboxes calling PATCH with optimistic update; per-task notes; progress bar from server state; Submit opens `ConfirmModal` requesting the operator name, then displays the signature hash; history table of past cycles; a "Record sensor change" form.

**Security.** `require_station`. `completed_by` comes from the **token**, never the request body — otherwise the audit trail is self-asserted and worthless.

**Failure handling.** PATCH failure → revert the optimistic toggle + toast. Double submit → 409 (cycle already submitted). Unknown `task_key` → 400.

**Testing.** T-MNT-01 toggle survives refresh · 02 cycle isolation · 03 signature is deterministic over the snapshot · 04 cross-station PATCH → 403 · 05 `completed_by` from token, body value ignored · 06 sensor-change event bounds the next training window.

**Acceptance.** Check three tasks → refresh → still checked. Submit → audit row with a verifiable hash. Previous cycles readable. Recalibration event visibly shortens the next training window in the training job log.

---

### 28.3 Real Edge / Offline Synchronisation `[GAP G3] [P1]`

**Purpose.** Replace an `alert()` with a working store-and-forward path. AWS stations lose connectivity routinely; a QC platform that silently drops observations during an outage is not deployable.

**Architecture.** §23. Browser-side buffer in IndexedDB (demo stand-in for device flash) → batch POST with idempotency → server dedupe → ordered replay through the detection chain, flagged `BACKFILLED`.

**Data flow.** Offline: observations accumulate locally with monotonic `seq`. Online: batches of ≤ 200 POSTed with `Idempotency-Key`; server returns `high_water_seq`; client purges only acknowledged records.

**API.** `POST /telemetry/batch`, `GET /sync-status` (§25.3).

**Database.** `ingest_idempotency`; `telemetry` gains `sequence_no`, `observation_source`, `is_backfilled`; `stations` gains `link_state`, `last_sync_at`.

**Backend.** `services/edge_sync_service.py`: `check_idempotency`, `ingest_batch` (dedupe, conflict detection, ordered insert), `replay_assessments` (chronological, suppressing incidents for observations older than 6 h), `compute_high_water`. Reuse the existing telemetry upload normalisation — do not duplicate it.

**Frontend.** `EdgeSync.jsx`: real online/offline toggle; IndexedDB buffer with live count and estimated age; Sync Now → real batch POST with a progress bar; result summary (accepted / duplicate / conflict); `link_state` badge; **remove the `alert()`**.

**Security.** `require_station`. Cap batch at 200 records and 1 MB. Reject records whose `station_id` differs from the path. Reject timestamps more than 5 minutes in the future.

**Failure handling.** Network failure mid-batch → nothing purged, retry with the same key returns `replayed: true`. Partial DB failure → whole batch in one transaction. `time_unsynced` device → reconstruct from the sync point and flag. Buffer overflow → oldest evicted, `records_dropped` reported and surfaced in the UI.

**Testing.** T-EDG-01 offline accumulate, online replay, all present · 02 same key twice → one insert, `replayed:true` · 03 out-of-order batch stored in timestamp order · 04 conflicting value stored as conflict, raw unchanged · 05 backfilled >6 h creates no live incident · 06 partial failure leaves no partial batch · 07 `high_water_seq` governs purge.

**Acceptance.** Toggle offline, watch the buffer grow, toggle online, all observations appear in the DB exactly once with correct timestamps, and re-clicking Sync inserts nothing further.

---

### 28.4 Real Export Hashing `[GAP G4] [P1]`

**Purpose.** An export of QC'd meteorological data is a scientific artefact; a hardcoded hash is a false integrity claim. A real one enables verification by a recipient.

**Architecture.** Move export generation server-side (the client cannot hash data it does not fully hold), canonicalise deterministically, hash, store, offer verification.

**Data flow.** Request → server assembles the bundle → canonical JSON (RFC 8785 / JCS: sorted keys, no insignificant whitespace, canonical number form, UTF-8, no trailing newline) → SHA-256 → persist `{export_id, sha256, generated_at, generated_by, parameters}` → return the payload and hash.

**API.** `POST /export/telemetry`, `POST /export/verify` (§25.3).

**Database.** `exports(export_id, station_ids, from_ts, to_ts, record_count, sha256, canonicalization, generated_by, generated_at, parameters_json)`.

**Backend.** `services/export_service.py`: `build_bundle`, `canonicalize` (**must be exactly reproducible — float formatting is the usual trap; use `repr`-stable formatting and document it**), `compute_hash`, `verify`. The bundle includes raw values, imputed values as separate fields, quality flags, assessment summaries and provenance metadata.

**Frontend.** `Export.jsx`: station/date-range selection; include-imputed toggle; download; display the real hash with a copy button; "Verify a file" dialog that re-hashes a re-uploaded file client-side and compares.

**Security.** Admin-only. Cap range and record count. Hash covers the data, not the filename.

**Failure handling.** Empty result → 200 with `record_count: 0` and a hash over the empty canonical form (not an error). Oversized → 413 with a suggested narrower range. Verify on unknown `export_id` → 404.

**Testing.** T-EXP-01 same request twice → identical hash · 02 one changed byte → different hash · 03 hash matches an independent `sha256sum` of the downloaded file · 04 verify accepts the real hash, rejects a modified one · 05 raw and imputed remain separate columns · 06 float formatting is stable across platforms.

**Acceptance.** Download an export, run `sha256sum` in a terminal, and the value matches what the UI displayed. Doing exactly this in front of judges is a 20-second, high-credibility demonstration.

---

### 28.5 Model Drift Monitoring `[GAP G5] [P1]`

**Purpose.** §21. Detect when a station's behaviour has moved away from what its model learned, before the model starts silently mis-scoring.

**Architecture.** Nightly job → `drift_metrics` → severity → dashboard badge + retraining candidate + confidence reduction.

**Data flow.** Reference deciles from the model card + last 14 days of residuals → six metrics → severity → storage → optional candidate.

**API.** `GET /stations/{id}/drift`, `/drift/latest`, `POST /drift/compute` (§25.3).

**Database.** `drift_metrics`.

**Backend.** `ml/drift_engine.py` — pure Python: `compute_psi(ref_deciles, cur_values)`, `residual_stats`, `ks_statistic_from_deciles`, `anomaly_rate`, `severity`. Scheduled via the existing async background task pattern (an `asyncio` task with a nightly tick — no new scheduler dependency). **Drift is computed on residuals, not raw values** (§21.2).

**Frontend.** Drift panel in `ModelGovernance.jsx`: current severity badge, per-metric table with thresholds, 90-day sparklines of PSI and residual mean, "Queue Retraining" button. Drift chip on the Command Center station rows.

**Security.** Read `require_station`; on-demand compute admin-only (it is CPU work).

**Failure handling.** < 7 days of data → `severity = INSUFFICIENT_DATA`, not `NONE` (absence of evidence again). Missing model card deciles (v1 artifacts) → skip PSI/KS, compute the rest, mark partial. Job crash → logged, retried next night, never blocks the poller.

**Testing.** T-DRF-01 known-shifted synthetic distribution yields PSI in the expected band · 02 seasonal-only change produces **no** drift in residual space (this is the key test — it validates §21.2) · 03 injected calibration drift raises residual mean shift above threshold · 04 severity mapping · 05 HIGH severity queues a candidate and reduces station confidence.

**Acceptance.** Inject a slow DRIFT fault for a simulated week; drift severity rises to at least MODERATE; a candidate is queued; the station's reported confidence drops. Run a synthetic seasonal transition; no drift is reported.

---

### 28.6 Automated Retraining `[GAP G6] [P1]`

**Purpose.** §22. Keep models current without ever letting an unvalidated model reach production.

**Architecture.** Triggers → `retraining_candidates` queue → existing training pipeline → shadow validation → promotion gate → activate or hold for approval.

**Data flow.** Trigger → candidate row → training job (existing service) → candidate model registered as `PENDING_APPROVAL` → shadow scoring over 7 days → gate evaluation → promote or await admin.

**API.** `GET/POST /retraining/candidates/*` (§25.3).

**Database.** `retraining_candidates`, `shadow_scores`, `model_registry.promotion_status`/`promotion_reason`.

**Backend.** `services/retraining_service.py`: `evaluate_triggers` (nightly), `enqueue_candidate` (dedupe per station), `run_candidate` (reuses `training_service`, marks the result `PENDING_APPROVAL`), `shadow_validate`, `evaluate_gate`, `promote`, `auto_rollback_check`. Serialised execution; at most one candidate per station per 24 h; disabled entirely when `DEMO_MODE=true`.

**Frontend.** Candidates section in `ModelGovernance.jsx`: table of candidates with trigger reason, status, shadow results per criterion, gate outcome and reason; Approve / Reject with a reason; shadow-diff view showing where the two models disagree.

**Security.** Approve/reject admin-only. Triggers are system-initiated; manual trigger is `require_station`.

**Failure handling.** Training failure → candidate `FAILED` with the error, incumbent untouched. Shadow validation failure → `PENDING_APPROVAL` with the failing criteria listed. Artifact hash mismatch → reject and alert. Post-promotion anomaly-rate explosion → automatic rollback **with an incident**, never silent.

**Testing.** T-RTR-01 drift trigger enqueues once, not repeatedly · 02 candidate never auto-activates when shadow fails · 03 open SENSOR_FAULT incident blocks promotion · 04 promotion sets `parent_version` and rollback restores · 05 `DEMO_MODE` disables triggers · 06 post-promotion rate spike triggers rollback + incident.

**Acceptance.** A drift event produces a candidate; the candidate trains; the gate result is visible with per-criterion detail; a deliberately bad candidate (trained on a window containing an injected fault) is **held**, not promoted — and the UI states exactly why.

---

### 28.7 PostgreSQL / TimescaleDB Optimisation `[GAP G7] [P1 for the scaling story, P2 for the demo]`

**Purpose.** The telemetry table is the only object that grows without bound: 1 000 stations at 1-minute cadence is ~525 M rows/year. A plain table cannot serve "last 24 h for station X" at that size without pain. It also makes the scalability claim concrete rather than aspirational.

**Architecture.** Dialect-aware migration. SQLite path unchanged. PostgreSQL path creates a hypertable, compression and retention policies.

**Data flow.** Unchanged at the application layer. This is purely a storage-engine change — `insert_telemetry_batch()` and `fetch_historical_telemetry()` keep their signatures.

**Database.**
```sql
-- PostgreSQL only, migration m0NN
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('telemetry', 'source_timestamp',
                         migrate_data => true,
                         chunk_time_interval => INTERVAL '7 days',
                         if_not_exists => true);

CREATE INDEX IF NOT EXISTS idx_telemetry_station_time
  ON telemetry (station_id, source_timestamp DESC);

ALTER TABLE telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'station_id',
  timescaledb.compress_orderby   = 'source_timestamp DESC'
);
SELECT add_compression_policy('telemetry', INTERVAL '30 days');
SELECT add_retention_policy('telemetry', INTERVAL '5 years');

-- Continuous aggregate for dashboard charts
CREATE MATERIALIZED VIEW telemetry_hourly
WITH (timescaledb.continuous) AS
SELECT station_id,
       time_bucket('1 hour', source_timestamp) AS bucket,
       avg(temperature) AS temp_avg, min(temperature) AS temp_min,
       max(temperature) AS temp_max, avg(humidity) AS hum_avg,
       avg(pressure) AS pres_avg, count(*) AS n
FROM telemetry GROUP BY station_id, bucket;
SELECT add_continuous_aggregate_policy('telemetry_hourly',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');
```

**Important:** `create_hypertable` partitions on the time column, so it must be part of any unique constraint. If a `UNIQUE(station_id, timestamp)` constraint exists, recreate it as `UNIQUE(station_id, source_timestamp)` **before** conversion, or the call fails. Sequence the migration accordingly: add `source_timestamp` → backfill → swap the unique constraint → convert.

**Backend.** `dialect.py` gates all of the above behind `IS_POSTGRES` and a `timescaledb` availability probe. If the extension is absent, log a warning, create the plain table with the composite index, and continue — PostgreSQL without Timescale must still work (P5). Chart queries prefer `telemetry_hourly` when the requested range exceeds 7 days and the dialect supports it; otherwise they use the base table.

**Frontend.** No change.

**Failure handling.** Extension unavailable → degrade as above. Conversion failure on a non-empty table → abort the migration, leave the plain table, log clearly.

**Testing.** T-DB-01 full suite passes on SQLite · 02 full suite passes on PostgreSQL without Timescale · 03 full suite passes with Timescale · 04 hypertable exists and chunks are created after inserting across a chunk boundary · 05 `fetch_historical_telemetry` returns identical results across all three backends for the same fixture.

**Acceptance.** `DATABASE_URL` pointed at a Timescale instance → migrations run → `SELECT * FROM timescaledb_information.hypertables` shows `telemetry` → the application behaves identically. SQLite development is untouched.

---

### 28.8 QC Endpoint Authentication Bug `[GAP G8] [DEFECT N3] [P0]`

**Purpose.** Fix a 401 without opening a hole.

**Root cause analysis.** `GET /stations/{id}/qc` requires a Bearer token; the HUD sometimes calls it without one. The realistic causes, in order of likelihood:
1. The HUD fires the QC fetch during initial mount, before `AuthContext` has rehydrated the token from `localStorage` — a race, not an auth design problem.
2. `apiClient.js` does not inject the header on this particular call path (e.g. it is called directly rather than through the client).
3. The token expired and no 401 interceptor refreshes or redirects, so the stale call surfaces as a broken panel.

Determine which by adding a request log line with `Authorization` presence and reproducing. **Do not fix before knowing which.**

**Why the proposed fix is wrong.** `PROGRESS.md` recommends `get_current_user → get_optional_user`. That makes every station's QC envelope — which reveals detection thresholds and operational configuration — publicly readable, and it adds a tenth unauthenticated endpoint at exactly the moment §27.4 is removing the other nine. It converts a visible bug into an invisible vulnerability.

**Correct fix.**
1. Backend: `GET /stations/{id}/qc` uses `require_station`. Admin → any station; operator → own station; otherwise 403; no token → 401.
2. Frontend, cause 1: gate all authenticated fetches on `AuthContext.isReady`. Add an `isReady` flag set after rehydration; `WeatherContext` and view effects must not fire until it is true. **This fixes a whole class of races, not just this endpoint.**
3. Frontend, cause 2: route the call through `apiClient`.
4. Frontend, cause 3: add a global 401 interceptor in `apiClient` → clear session → redirect to login with a toast.
5. Cache the QC config in `WeatherContext` — it changes rarely; refetching per render is wasteful anyway.

**Security.** Unauthenticated QC access is eliminated, not preserved.

**Failure handling.** Missing QC config for a station (never calibrated) → 200 with `{"config": null, "status": "NOT_CALIBRATED"}` rather than 404. The HUD renders "QC envelope not yet calibrated" instead of an error. **This may in fact be the real user-visible symptom** — a missing config surfacing as an error state — so check for it while investigating.

**Testing.** T-AUTH-09 no token → 401 · 10 operator own station → 200 · 11 operator other station → 403 · 12 admin any → 200 · 13 HUD mount with a cold cache issues no unauthenticated request (assert via a request spy) · 14 uncalibrated station returns `NOT_CALIBRATED`, not 404.

**Acceptance.** Hard-refresh the HUD 20 times with a cold cache: zero 401s, zero error panels. Operator cannot read another station's QC config by any route.

---

### 28.9 Dependency hygiene `[GAP G10] [P2]`

Split `requirements.txt`:
- `requirements.txt` — core: fastapi, uvicorn, httpx, python-multipart
- `requirements-postgres.txt` — psycopg2-binary (or `psycopg[binary]`)
- `requirements-dev.txt` — pytest, pytest-asyncio, httpx test client

Document: SQLite development needs only the core file. This also reinforces the "no heavy dependencies" claim, which is a genuine selling point — `pip install -r requirements.txt` finishing in seconds on a Raspberry Pi is a demonstrable fact, and the shorter the file, the stronger the claim.


---

## 29. Testing Strategy

### 29.1 Existing tests `[IMPLEMENTED]`

`backend/tests/test_auth_system.py`, `test_telemetry_pipeline.py`; `ml/test_enhanced_engines.py`, `test_spatial_intelligence.py`, `test_station_isolation.py`; plus ~11 root-level utility scripts.

**First action: run them (V11).** A failing existing suite must be fixed before new features are added.

**Second action: clean up.** Root-level scripts named `test_*.py` (`test_http_upload.py`, `test_pipeline_progression.py`, `test_weather.py`) will be collected by pytest and are not unit tests. Move them to `scripts/` and rename to `check_*.py`, or the suite will be noisy and unreliable.

### 29.2 Unit tests to add — ML

| ID | Test | Asserts |
|---|---|---|
| T-ML-01 | `c(n)` harmonic normalisation | matches `2H(n−1) − 2(n−1)/n` for n = 2, 10, 256 |
| T-ML-02 | IF score bounds | s ∈ (0,1) for all inputs; monotone in path length |
| T-ML-03 | Truncated-branch adjustment present | a truncated path scores lower than a fully isolated one at the same depth |
| T-ML-04 | **SHAP additivity** | Σ attributions ≈ score − expected, tol 1e-6 |
| T-ML-05 | Climatology recovers a known signal | synthetic diurnal+annual sine ⇒ coefficients within 5 % |
| T-ML-06 | **Reproducibility** | same seed + data ⇒ byte-identical artifact |
| T-ML-07 | Robust fit resists contamination | 10 % injected outliers shift coefficients < 10 % vs clean |
| T-ML-08 | Contamination estimate | derived from cleaning counts, clamped to [0.005, 0.05] |
| T-ML-09 | Threshold calibration | flagged fraction on held-out data ≈ contamination ± 50 % |
| T-ML-10 | Readiness gating | 50 records ⇒ `BASELINE`, no IF produced |
| T-ML-11 | Residual z-scores | zero-mean, unit-variance on clean synthetic data |
| T-ML-12 | Sentinel never reaches IF | −999 input short-circuits at L1 |
| T-ML-13 | Theil–Sen slope | matches a hand-computed value on a fixture |
| T-ML-14 | v1 artifact still loads | legacy 8D path produces a score |

### 29.3 Unit tests — fusion, physics, spatial

| ID | Test | Asserts |
|---|---|---|
| T-FUS-01 | QC evidence alone | P < 0.15 — **the numerical statement of principle P1** |
| T-FUS-02 | All evidence high | P > 0.95 |
| T-FUS-03 | Missing-term renormalisation | dropping `z_ml` does not lower P for otherwise identical evidence |
| T-FUS-04 | Confidence capped by completeness | 3/6 evidence ⇒ confidence ≤ 0.5 |
| T-FUS-05 | Coefficient fitting | on synthetic labels, recovers the planted ordering |
| T-FUS-06 | Non-negativity constraint | no fitted βᵢ < 0 |
| T-FUS-07 | Severity mapping | table-driven |
| T-FUS-08 | Dwell suppression | a single-observation MEDIUM creates no incident |
| T-PHY-01 | Hard bounds | each hard rule fires exactly on its boundary |
| T-PHY-02 | Magnus-Tetens | dew point matches reference values within 0.1 °C |
| T-PHY-03 | Hypsometric | expected pressure at 0/500/1000 m matches reference |
| T-PHY-04 | Wet bulb ≤ dry bulb | property test over the valid domain |
| T-SPA-01 | Haversine | known city pairs within 0.5 % |
| T-SPA-02 | Residual comparison | stations 900 m apart in elevation with normal readings ⇒ A > 0.8 (**this is the N7 regression test**) |
| T-SPA-03 | Raw comparison fails the same case | documents why the change was made |
| T-SPA-04 | Agreement on nothing | all peers at z≈0 and target at z≈0 ⇒ not a REGIONAL_EVENT (condition 3, §13.5) |
| T-SPA-05 | Sign mismatch | opposite-sign departures lower A sharply |
| T-SPA-06 | Zero peers | `UNCONFIRMED`, A = null, not 0 |

### 29.4 Integration tests

| ID | Test |
|---|---|
| T-INT-01 | Upload CSV → train → score → assessment row written with a complete payload |
| T-INT-02 | Injected SPIKE → detected within one observation → incident created with real evidence |
| T-INT-03 | Injected STORM across ≥3 stations → all classified `REGIONAL_EVENT`, **no** sensor-fault incidents |
| T-INT-04 | Injected FLATLINE → detected on distinct observations, not poll ticks (**the N4 regression test**) |
| T-INT-05 | Imputation writes to `imputations`; `telemetry` row is byte-identical before and after |
| T-INT-06 | Incident idempotency: 6 hours of continuous fault ⇒ one incident with `occurrence_count = 6` |
| T-INT-07 | Auto-resolution requires 3 consecutive NORMAL observations |
| T-INT-08 | Model rollback restores the previous version and scoring changes accordingly |
| T-INT-09 | **STORM never yields a `THERMAL_SPIKE` root cause** (§16.3) |
| T-INT-10 | Full station-isolation matrix (§27.4) — parameterised over every station-scoped endpoint |
| T-INT-11 | Python/JS contract: shared computations agree within 1e-6 |
| T-INT-12 | Static check: no `UPDATE telemetry SET <value column>` anywhere in the codebase |
| T-INT-13 | Every state-changing endpoint writes an audit row |

### 29.5 End-to-end (Playwright or manual script)

| ID | Flow |
|---|---|
| T-E2E-01 | Admin login → Command Center → all stations render |
| T-E2E-02 | Operator login → sees only own station → cannot navigate to admin views |
| T-E2E-03 | The full §33 demo script, start to finish, without manual intervention |
| T-E2E-04 | QC edit → save → refresh → persists |
| T-E2E-05 | Checklist → complete → submit → refresh → persists |
| T-E2E-06 | Offline → buffer → online → sync → data present exactly once |
| T-E2E-07 | Export → hash displayed matches `sha256sum` of the downloaded file |

### 29.6 Chaos / degraded-mode tests

| ID | Fault | Expected |
|---|---|---|
| T-CHA-01 | Open-Meteo returns 500 | Poller logs, retains last state, retries with backoff; no corrupt rows |
| T-CHA-02 | Open-Meteo times out | Same; `link_state` reflects it |
| T-CHA-03 | Model artifact deleted from disk | Station degrades to physics+QC, emits `MODEL_UNAVAILABLE`, does not crash |
| T-CHA-04 | Model artifact corrupted | Hash mismatch → refuse to load → fall back to previous version |
| T-CHA-05 | DB locked (SQLite) | Retry with backoff; request fails cleanly with 503, poller survives |
| T-CHA-06 | All peers offline | `UNCONFIRMED` verdict, no crash, no imputation |
| T-CHA-07 | Malformed CSV (bad rows mid-file) | Good rows ingested, bad rows quarantined with reasons, no abort |
| T-CHA-08 | Station with zero history | `COLD_START`, physics verdicts only, no exception |
| T-CHA-09 | Clock skew: observation 2 h in the future | Rejected with `INVALID_TIMESTAMP` |
| T-CHA-10 | Two concurrent training jobs for one station | Second rejected with 409 |

### 29.7 Coverage targets

Not a percentage mandate. Required: **100 % of the ten detection layers, the fusion function, the authorisation matrix, and every migration have at least one test.** Those are the parts where a silent regression is invisible until the demo.

---

## 30. Fault Injection Evaluation

### 30.1 Role

The fault injection lab is promoted from a demo toy to the project's primary scientific instrument. It supplies:
1. Ground-truth labels for measuring detection quality (§31).
2. The training corpus for the fusion coefficients (§14.5).
3. Regression protection for the sensor-vs-weather distinction.
4. The demo narrative.

### 30.2 Standardised injection suite `[SPEC]`

Extend the current 6 types to 12. Each is defined by its parameters and its **expected** system response — so a failure to meet the expectation is a test failure, not a judgement call.

| # | Fault | Injection | Expected detector | Expected severity | Expected root cause | Expected spatial | Expected recovery |
|---|---|---|---|---|---|---|---|
| 1 | `TEMP_SPIKE` | +8.5 °C step, 1 obs | L3 rate, L4 ML | HIGH | `THERMAL_SPIKE` | `LOCALIZED` | resolves 3 obs after reset |
| 2 | `TEMP_DRIFT` | +0.4 °C/obs cumulative | L4 ML, L10 drift | MEDIUM→HIGH | `CALIBRATION_DRIFT` | `LOCALIZED` | drift metric rises |
| 3 | `FLATLINE` | value locked | L3 variance | CRITICAL | `SENSOR_FLATLINE` | `LOCALIZED` | immediate on reset |
| 4 | `POWER_SAG` | battery 10.8 V + multi-param noise | L10 health, L2 | HIGH | `POWER_SAG_BROWNOUT` | `LOCALIZED` | SHI recovers |
| 5 | `RH_SUPERSAT` | RH 112 % | L2 hard | CRITICAL | `SUPER_SATURATION_VIOLATION` | n/a — hard gate | immediate |
| 6 | `REGIONAL_STORM` | −6 °C, −12 hPa across ≥3 stations | L3, L4 at all | MEDIUM | `REGIONAL_WEATHER_FRONT` | **`REGIONAL_EVENT`** | resolves together |
| 7 | `SENTINEL` | value = −999 | L1 | CRITICAL | `COMMUNICATION_CORRUPTION` | n/a | immediate |
| 8 | `MISSING` | value = null for 3 obs | L1 | MEDIUM | `MISSING_DATA` | n/a | immediate |
| 9 | `PRESSURE_OFFSET` | +25 hPa constant | L2 hypsometric, L4 | HIGH | `PRESSURE_CALIBRATION_FAULT` | `LOCALIZED` | immediate |
| 10 | `NOISE_BURST` | ×4 residual variance, mean unchanged | L3 variance ratio | MEDIUM | `SENSOR_NOISE_DEGRADATION` | `LOCALIZED` | over ~7 obs |
| 11 | `COMMS_DROPOUT` | RSSI −98 dBm + intermittent nulls | L1, L10 | HIGH | `COMMUNICATION_CORRUPTION` | n/a | on link restore |
| 12 | `SEA_BREEZE` *(hard negative)* | −3 °C over 2 h at **coastal stations only**, physically plausible | should **not** alert | `NONE` | `NOMINAL` | `NORMAL` or `REGIONAL_EVENT` | n/a |

**Fault 12 is the most valuable one in the table.** A suite containing only positives measures sensitivity and nothing else. A realistic hard negative — a genuine local meteorological phenomenon affecting a *subset* of stations — is the case that separates a real system from a threshold detector, and it is the case a sharp judge will ask about. Add at least two more hard negatives if time allows: nocturnal inversion (rapid clear-sky cooling at inland stations) and monsoon onset (large simultaneous regional change).

### 30.3 Injection ledger `[SPEC]`

Every injection writes a ground-truth record:

```sql
CREATE TABLE injection_ledger (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  station_ids TEXT NOT NULL,            -- JSON array
  fault_type TEXT NOT NULL,
  parameters TEXT NOT NULL,             -- JSON
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  expected_classification TEXT,
  expected_root_cause TEXT,
  expected_severity TEXT,
  is_hard_negative INTEGER DEFAULT 0,
  injected_by TEXT NOT NULL
);
```

This table is what makes evaluation possible. Without it, "did we detect it?" is answered by memory.

### 30.4 Scoring rules `[SPEC]`

| Concept | Definition |
|---|---|
| Detection window | `[started_at, ended_at + 2 observation intervals]` |
| True positive | ≥1 non-NORMAL assessment inside the window for an injected station, **with the expected classification** |
| False negative | no such assessment |
| False positive | non-NORMAL assessment outside any window, or on a non-injected station, or a hard negative that alerted |
| Classification error | detected but classified `LOCALIZED` when `REGIONAL` was expected, or vice versa — **tracked separately from detection error**, because it is the project's distinguishing capability and deserves its own number |
| Root-cause accuracy | fraction where `root_cause.primary` matches the expectation |
| Detection latency | first non-NORMAL assessment timestamp − `started_at`, in observations and in seconds |

**Report point-wise metrics, not point-adjusted.** Point-adjustment (counting an entire anomalous segment as detected if any single point within it is flagged) is common in the time-series anomaly literature and inflates scores dramatically — a random detector can score highly under it. Report point-wise as the headline. If point-adjusted numbers are reported at all, label them explicitly and never quote them alone.

### 30.5 Keeping evaluation honest

- Injected observations are tagged `observation_source='SYNTHETIC_FAULT'` (§27.6) and are **excluded from training windows**. A model trained on its own test injections would produce meaningless metrics.
- The evaluation run must include a substantial clean period (≥ 48 h of unaltered observations across the fleet) so the false-positive rate has a real denominator. A precision figure computed over a window containing nothing but injections is uninterpretable.
- Record the software version, model versions, fusion coefficient version and fleet configuration with every evaluation run.

### 30.6 Two independent evidence streams

Report detection quality from both the injection ledger (controlled, labelled) and from operator adjudications (§19.6, real, unlabelled-until-judged). Agreement between the two is strong evidence; disagreement is informative. Presenting both is more convincing than either.

### 30.7 Runner

`scripts/run_evaluation.py`: loads a scenario YAML/JSON, executes injections on schedule against a running instance, waits for the observation cadence, collects assessments, computes all metrics, writes `evaluation_runs/<run_id>/report.md` + `metrics.json`. Must be reproducible from the scenario file alone, and must refuse to run against an instance where `DEMO_MODE` is false.

---

## 31. Performance Evaluation

> **Nothing in this section has been measured.** These are the procedures for obtaining numbers. Populate `BENCHMARKS.md` with results, hardware and date. Never quote a target as a result.

### 31.1 Reporting discipline

Every number recorded must carry: hardware (CPU model, RAM), Python version, database backend, fleet size, dataset size, date, commit SHA. A latency figure without a machine attached is not a measurement.

### 31.2 Latency

```
scripts/bench_latency.py
  - 1000 observations through the full chain, single process
  - report p50 / p95 / p99 per layer and end to end
  - separately: cold (model load) vs warm
  - API latency via 200 sequential requests per endpoint
```
Report per-layer so the bottleneck is identifiable. The likely hot spots are spatial peer lookup (O(n²) until §13.7) and SHAP.

### 31.3 Detection latency
From `injection_ledger.started_at` to the first matching assessment, in observations and seconds, per fault type, over ≥ 20 injections. Report the distribution, not the mean — a mean hides the tail that matters.

### 31.4 Throughput
Batch-submit N observations across M stations; measure sustained observations/second at M = 10, 50, 100, 500. Plot the curve and identify where it bends. The bend location is the useful finding, not the peak number.

### 31.5 Resource use
`resource.getrusage` sampling + `tracemalloc`: peak RSS over a 1-hour run at each fleet size; CPU time per observation; model artifact size on disk and in memory; database growth per station-day.

### 31.6 Frontend
Lighthouse on the built bundle; bundle size; time-to-interactive after login; poll payload size at each fleet size. The `/fleet/live` payload growing linearly with fleet size is a real scaling limit — measure it and note the pagination threshold.

### 31.7 Self-healing accuracy
The cleanest measurable result available, and worth doing:
1. Take clean historical observations with good peer coverage.
2. Mask a value; impute it; compare with the truth.
3. Report MAE and RMSE per parameter, plus error vs peer count and vs distance.
4. Report the **calibration** of imputation confidence: bucket by predicted confidence and show observed error per bucket. A confidence that correlates with actual error is a genuine, defensible, honest result — and it is far more impressive than an unvalidated accuracy claim.

### 31.8 Confidence calibration
Same approach for the anomaly probability: bucket assessments by predicted `P`, compare with adjudicated outcomes, plot a reliability diagram, report the Brier score. Do this once the adjudication corpus is large enough (≥ 100 adjudicated incidents). If it is not large enough, **say so** rather than reporting a diagram built on 12 points.

---

## 32. Scalability

### 32.1 From 2 stations to 1 000

| Dimension | 2–10 (now) | 100 | 1 000 |
|---|---|---|---|
| Database | SQLite WAL | PostgreSQL | PostgreSQL + TimescaleDB hypertable, compression |
| Detection | inline in the poller | async task pool | worker processes, station-sharded |
| Models | JSON on disk, all loadable | LRU cache, ~100 resident | LRU + lazy load; ~50–200 KB each |
| Spatial | O(n²) per cycle | cached neighbour table | cached + spatial grid index |
| Live state | in-memory dict | in-memory + pagination | Redis or per-shard state; paginated API |
| Polling | 1 batched API call | batched by region | ingest push from stations rather than pull |
| Training | inline background task | job queue, serialised | dedicated worker, nightly schedule |
| Dashboard | full fleet | paginated + filtered | map clustering + server-side aggregation |

### 32.2 What must change first

In order of when it bites:

1. **Neighbour cache (§13.7)** — bites at ~50 stations. Trivial to implement.
2. **`/fleet/live` pagination** — bites at ~100. The payload is currently the whole fleet every 5 s.
3. **Model LRU cache** — bites at ~200 if every model is held resident.
4. **Hypertable (§28.7)** — bites at ~100 stations × months of data.
5. **Worker processes** — bites when detection time per cycle exceeds the observation interval. With NFR-2 at 150 ms, one process handles ~400 stations per minute-cadence cycle; below that, do not add complexity.

### 32.3 What must NOT change

Per-station models scale *better* than a global model, not worse: training is embarrassingly parallel and independent, a station's retraining touches nothing else, and inference is O(trees × depth) regardless of fleet size. Storage is ~100 KB × n. At 1 000 stations that is 100 MB — trivial. **Say this explicitly when a judge asks whether per-station models scale.** The intuition that "one model is more scalable than a thousand" is wrong here, and being able to explain why is a strong moment.

### 32.4 Spatial indexing `[P2]`

Beyond the cached neighbour table, a lat/lon grid bucket (0.5° cells, peers found by scanning the 9 surrounding cells) reduces candidate generation from O(n) to O(1) amortised. ~40 lines, no dependency. Only needed past ~1 000 stations; document it, build it if time allows.

---

## 33. SIH Demonstration Workflow

### 33.1 The thesis the demo must prove

> **The system knows the difference between a faulty sensor and real weather.**

Every step below either sets up that contrast or delivers it. Anything that does neither should be cut for time.

### 33.2 Prerequisites (complete the day before, not on the morning)

- [ ] ≥ 5 stations provisioned across the Dakshina Kannada belt with **real elevation differences** (coastal ~30 m, inland ~100 m, ghat ~900 m). The elevation spread is what makes the residual-space spatial work visible.
- [ ] ≥ 90 days of historical data loaded per station; all models at `TRAINED` or `MATURE`.
- [ ] Fusion coefficients fitted from an injection corpus, so the UI says `fitted`, not `default priors`.
- [ ] `DEMO_MODE=true`; automated retraining disabled.
- [ ] Database backed up; a one-command restore script tested.
- [ ] Full run-through completed twice end to end, timed.
- [ ] Offline fallback: screen recording of the full demo, plus screenshots of each key screen, on the presenting laptop.
- [ ] Open-Meteo dependency removed from the critical path — see 33.6.

### 33.3 The 16-step script (target 7–8 minutes)

| # | Step | Screen | Say | Time |
|---|---|---|---|---|
| 1 | Healthy fleet | Command Center | "Five AWS stations, live. Every one green." | 20 s |
| 2 | Per-station models | Model Governance | "No shared model. Each station has its own, trained on its own climate. Here's the model card — training window, seasons covered, its own threshold." | 40 s |
| 3 | Normal readings + expectation | Station HUD | "Not just the reading — what the station's own learned climatology *expected*, and the departure in sigma." | 30 s |
| 4 | **Inject TEMP_SPIKE** on one station | Fault Lab | "Simulating a temperature sensor fault." | 15 s |
| 5 | Detection | HUD flips | "Detected on the next observation." | 15 s |
| 6 | Probability + confidence | Evidence panel | "91 % probability. But confidence 0.78 — we report how sure we are of our own judgement." | 25 s |
| 7 | **Evidence contributions** | Evidence panel | "Here is the arithmetic. Six evidence sources, weights **fitted from labelled injections**, not chosen by us. Note QC alone would give 7 %." | 45 s |
| 8 | **Peer comparison** | Peer bars | "Three neighbours within 50 km. All at their own normal. This station is alone." | 30 s |
| 9 | Classification | Verdict | "`LOCALIZED_ANOMALY` — the sensor, not the weather." | 15 s |
| 10 | Incident + root cause | Incident modal | "`THERMAL_SPIKE`, 0.81. Alternatives listed. Recommended action: inspect the probe and shield." | 30 s |
| 11 | **Self-healing** | HUD toggle | "Estimated value from neighbours, flagged WMO 3. The raw 39.4 is preserved — we never overwrite a measurement." | 30 s |
| 12 | Health impact | Diagnostics | "Sensor health dropped. Projection band, not a prediction — we have no failure data and we say so." | 25 s |
| 13 | Acknowledge | Incident modal | "Operator adjudicates. That becomes a label we measure ourselves against." | 20 s |
| 14 | Reset | Fault Lab | "Fault cleared." | 10 s |
| 15 | **Inject REGIONAL_STORM** across 3 stations | Fault Lab | "Now real weather — a front across three stations." | 20 s |
| 16 | **The payoff** | Command Center + HUD | "All three flag. Peers now *agree*. Classification: `REGIONAL_EVENT`. No sensor fault. No maintenance ticket. No imputation — because the data is correct. **That is the difference.**" | 50 s |

### 33.4 Optional extensions if time permits

- QC envelope edit → save → persists (10 s, answers "is it real or hardcoded?")
- Export → `sha256sum` in a terminal → matches (20 s, very high credibility per second)
- Provision a new station live → `COLD_START` badge → "the system says it doesn't know yet" (30 s, demonstrates honesty)
- Sea-breeze hard negative → no alarm (30 s, the best answer to "how do you avoid false alarms?")

### 33.5 Judge questions to prepare — with the answers this spec supplies

| Question | Answer | Section |
|---|---|---|
| "Why not one model for everything?" | Microclimate variance; per-station models also parallelise better and cost 100 KB each | §5 P2, §32.3 |
| "How did you pick those weights?" | Logistic regression fitted on the labelled injection corpus, non-negativity constrained, cross-validated by station | §14.5 |
| "What if the neighbours are also broken?" | Median + MAD is robust to a minority; with zero valid peers we return `UNCONFIRMED` and say we cannot tell | §13.3, §13.6 |
| "Is this real AWS data?" | No — Open-Meteo stands in. Here are the specific limitations and here is the interface a real AWS feeds | §12.4, §33.6 |
| "How accurate is it?" | Here are point-wise precision/recall from N labelled injections on this hardware, on this date. We do not report point-adjusted numbers because they inflate | §30.4, §31 |
| "How did you validate RUL?" | We did not, so we do not call it RUL. It is a labelled trend extrapolation with a band | §18.5 |
| "Does this run on an ESP32?" | No. Acquisition and buffering run there; detection runs at the gateway; spatial reasoning is inherently central | §23.1 |
| "What happens at 1 000 stations?" | Hypertable, neighbour cache, paginated live state, worker processes — here is the order in which each becomes necessary | §32.2 |
| "Isn't this just thresholding?" | QC evidence at maximum, alone, gives 7 % probability. Here is that number on screen | §14.5, T-FUS-01 |

### 33.6 The Open-Meteo honesty point

Open-Meteo is a modelled reanalysis/forecast product on an hourly grid, not AWS sensor output. Two consequences to state openly:

1. Neighbouring "stations" drawn from a gridded model are more mutually consistent than real instruments would be, which makes spatial consensus look slightly better than it would in the field.
2. The hourly cadence is 10–60× slower than a real AWS.

**Mitigation for the demo:** pre-load historical data and drive the demo from a deterministic replay of stored observations rather than a live API call. This removes network dependency from the demo entirely (a live API failure mid-presentation is a catastrophic and entirely avoidable risk), makes the run reproducible, and lets you compress an hour of weather into seconds. Build `scripts/demo_replay.py` that feeds stored observations at a configurable speed through the normal ingest path. **This is a P0 demo-safety item.**

Stating limitation (1) yourself, before a judge finds it, converts a weakness into evidence of rigour.

### 33.7 Reliability and degraded-mode matrix

Required behaviour for every failure mode. Each row is testable (§29.6) and each is also a demo contingency.

| Failure | Required behaviour | Test |
|---|---|---|
| Weather API unavailable | Retain last state, backoff retry, `link_state = DEGRADED`, no writes, no corrupt rows | T-CHA-01/02 |
| Weather API returns garbage | L1 rejects; observation not stored; logged | T-CHA-07 |
| Database unavailable | API returns 503 with a clear message; poller buffers in memory up to a cap then drops with a counter; no crash | T-CHA-05 |
| Model file missing | Station degrades to `BASELINE` behaviour, `MODEL_UNAVAILABLE` in the payload, incident of type `DATA_QUALITY` | T-CHA-03 |
| Model corrupted | Hash mismatch → refuse → load previous active version → alert | T-CHA-04 |
| Insufficient history | `COLD_START` tier, physics+QC only, stated in the UI | T-CHA-08 |
| Malformed CSV | Good rows ingested, bad rows quarantined with per-row reasons, summary returned | T-CHA-07 |
| Station offline | `link_state = OFFLINE`, excluded from peer sets, no false anomalies generated for the gap | T-CHA-06 |
| Network timeout on ingest | Idempotency key makes retry safe | T-EDG-02 |
| All peers unavailable | `UNCONFIRMED`, A = null, no imputation | T-SPA-06 |
| Imputation impossible | `available: false` with a reason; never a fabricated value | §17.2 |
| SHAP failure | `attributions: []`, `attribution_status: UNAVAILABLE`, detection unaffected | §15.4 |
| Training crash | Job marked FAILED with the error; incumbent model untouched | T-RTR-01 |
| Two concurrent trainings | Second returns 409 | T-CHA-10 |
| Clock skew | Future timestamps rejected | T-CHA-09 |

---

## 34. SIH Evaluation-Criteria Mapping

Format: **Feature → technical value → why it scores → how it is evidenced in the demo.**

### Innovation and novelty
| Feature | Technical value | Evaluation relevance | Evidence |
|---|---|---|---|
| Residual-space spatial adjudication (§13.4) | Makes cross-terrain peer comparison valid; the sensor-vs-weather decision becomes mathematically sound rather than heuristic | Most projects compare raw values and break on elevation. This is a correctness argument a technical judge can verify | Step 8/16; T-SPA-02 vs T-SPA-03 side by side |
| Fusion weights fitted from injections (§14.5) | Turns arbitrary constants into a supervised, cross-validated calibration | Directly answers "why those numbers?", which is the most common fatal question | Step 7; coefficient card in Model Governance |
| Per-station harmonic climatology (§10.3) | Learns diurnal + seasonal normality from ~10 coefficients, viable on small data | Addresses PS-073's temporal/seasonal requirement with a method that actually works on limited AWS history | Step 3 (expected vs observed overlay) |
| Three-axis verdict (§14.7) | Separates quality, severity and causal attribution | Shows conceptual clarity most projects lack | Evidence panel |

### Detection accuracy
| Feature | Value | Relevance | Evidence |
|---|---|---|---|
| 10-layer fusion with dwell (§14) | No single threshold can alarm | Directly targets the PS-073 false-alarm requirement | T-FUS-01 shown on screen: QC alone = 7 % |
| Hard negatives in the suite (§30.2 #12) | Measures specificity, not only sensitivity | Very few projects test what should *not* alarm | Sea-breeze extension, §33.4 |
| Point-wise metrics (§30.4) | Refuses the inflated metric the literature commonly uses | Methodological rigour | `BENCHMARKS.md` |

### Real-time capability
| Feature | Value | Relevance | Evidence |
|---|---|---|---|
| Pure-Python, no numpy | Fast cold start, no BLAS, runs on constrained hardware | Supports the edge story credibly | Per-layer latency in `BENCHMARKS.md` |
| Cadence-correct temporal logic (§12.4) | Detection tied to real observations, not poll ticks | Correctness under real-world data rates | T-INT-04 |

### Explainability
| Feature | Value | Relevance | Evidence |
|---|---|---|---|
| `fusion.terms` breakdown (§15.2) | The probability is reconstructable by hand | Rare and immediately convincing | Evidence panel, step 7 |
| SHAP with an additivity test (§29.2 T-ML-04) | Proves the attributions are real | Distinguishes real SHAP from plausible weights | Test output |
| Confidence separate from probability (§14.6) | The system reports the limits of its own knowledge | Mature and unusual | Step 6 |

### Scalability
§32 table; per-station models parallelise (§32.3); hypertable path (§28.7).

### Practical deployability
Dual-mode DB, no ML dependencies, tiered edge architecture, degraded-mode matrix, migration framework, honest ESP32 positioning.

### Visualisation / UI
Existing cyberpunk command-centre identity, plus the Evidence panel (§26.5) which makes the peer comparison *visible* rather than described.

### Energy efficiency
| Feature | Value | Evidence |
|---|---|---|
| No numpy/BLAS | Lower memory footprint and no vectorised power spikes | Measured RSS, §31.5 |
| Tier-1 does only acquisition + buffering | The ESP32 stays in deep sleep between reads; no inference cost at the node | §23.1 architecture; firmware duty-cycle estimate — **label as estimated unless measured on hardware** |
| Batched uploads | Radio is the dominant power cost; batching amortises it | §23.4 |

---

## 35. Prioritisation

> **Superseded by `VERIFICATION.md` §6**, which reorders P0 by dependency after direct inspection and adds the secret-key fix, live telemetry persistence, the `hour` derivation, the `last_observation` fix and the fault-echo removal. Use that list; the one below remains valid as rationale.

### P0 — must be complete before the SIH demo

| # | Task | Section | Why |
|---|---|---|---|
| P0-1 | Run the verification protocol | §3.5 | Everything else depends on knowing what is real |
| P0-2 | Fix `DELETE /incidents` and `GET /incidents` auth | §27.4 | Unauthenticated destruction of demo state |
| P0-3 | Authorisation matrix across all endpoints + isolation test | §27.4 | The isolation claim is currently unenforced |
| P0-4 | QC endpoint 401 — correct fix, plus `AuthContext.isReady` | §28.8 | Visible broken panel |
| P0-5 | Observation-cadence deduplication | §12.4 | Temporal logic is otherwise measuring the API |
| P0-6 | QC rule persistence | §28.1 | Named gap; visible in the demo |
| P0-7 | Three-axis verdict + `legacy_state` compatibility | §14.7 | Prerequisite for the Evidence panel |
| P0-8 | Evidence payload v2 + `/assessments/latest` | §15.2, §25.3 | The demo's core artefact |
| P0-9 | Evidence panel UI | §26.5 | This *is* the demonstration |
| P0-10 | Regional-event confirmation hardening | §13.5 | Step 16 must not fail |
| P0-11 | `REGIONAL_EVENT` suppresses sensor-fault root causes + test | §16.3 | The thesis must be structurally guaranteed |
| P0-12 | Demo replay script | §33.6 | Removes live-API risk from the presentation |
| P0-13 | Seed ≥ 90 days of history; all models `TRAINED` | §10.7, §33.2 | Otherwise the models are not credible |

### P1 — strongly recommended

| # | Task | Section |
|---|---|---|
| P1-1 | Residual-space features + climatology | §10.2–10.4 |
| P1-2 | Residual-space spatial comparison | §13.4 |
| P1-3 | Readiness tiers | §10.7 |
| P1-4 | Training data hygiene + contamination estimate | §10.6 |
| P1-5 | Fusion coefficient fitting from injections | §14.5 |
| P1-6 | Extended injection suite incl. hard negatives + ledger | §30.2–30.3 |
| P1-7 | Evaluation runner + `BENCHMARKS.md` | §30.7, §31 |
| P1-8 | RUL → degradation projection relabel | §18.5 |
| P1-9 | Drift monitoring | §28.5 |
| P1-10 | Real edge sync | §28.3 |
| P1-11 | Export hashing | §28.4 |
| P1-12 | Maintenance persistence | §28.2 |
| P1-13 | Demote JS engines + contract test | §26.3 |
| P1-14 | Plaintext access key removal | §27.5 |
| P1-15 | CORS tightening, JWT hardening, login rate limit | §27.3, §27.5 |
| P1-16 | Incident idempotency + dwell | §19.2, §14.8 |
| P1-17 | Migration framework | §24.5 |
| P1-18 | Per-sensor SHI | §18.1 |

### P2 — optional enhancement

Automated retraining (§28.6) · TimescaleDB hypertable (§28.7) · neighbour cache (§13.7) · modal replacement for `alert()` (§26.6) · dependency split (§28.9) · ESP32 reference firmware (§23.2) · rate limiting (§25.5) · fleet map classification colouring · spatial grid index (§32.4).

### FUTURE — do not build now

Federated learning across stations · survival-model RUL once failure data exists · deep-learning detectors if per-station history reaches multiple years · multi-tenant organisations · real IMD data-feed integration · mobile operator app · Grafana/Prometheus observability · Kubernetes deployment.

### Suggested sequencing

```
Week 1  P0-1 → P0-5   (verify, then security and correctness)
Week 2  P0-6 → P0-13  (demo-critical features and data)
Week 3  P1-1 → P1-7   (ML quality and evaluation — the credibility block)
Week 4  P1-8 → P1-18  (honesty, persistence, hardening)
Week 5  Rehearsal, benchmarks, P2 as time allows
```

---

## 36. Acceptance Criteria

The project is complete when every line below is demonstrable.

### Detection
- [ ] A sentinel value never reaches the Isolation Forest (T-ML-12)
- [ ] QC evidence alone yields P < 0.15 (T-FUS-01)
- [ ] All 12 injection types produce their expected classification, severity and root cause (§30.2)
- [ ] The hard negative does **not** alarm
- [ ] A STORM injection never produces a sensor-fault root cause at any station (T-INT-09)
- [ ] A station with zero peers returns `UNCONFIRMED`, never a confident verdict
- [ ] Flatline detection operates on distinct source observations (T-INT-04)

### Explainability
- [ ] 100 % of non-NORMAL assessments carry a non-empty evidence payload
- [ ] `fusion.terms` contributions sum to the reported logit
- [ ] SHAP attributions satisfy additivity to 1e-6
- [ ] Root cause always includes ranked alternatives
- [ ] Confidence never exceeds evidence completeness

### Data integrity
- [ ] No code path issues `UPDATE telemetry SET <value column>` (T-INT-12)
- [ ] Imputed values are separate records with method, peers and confidence
- [ ] The UI makes observed vs estimated unmistakable
- [ ] Exports contain raw and imputed as distinct fields
- [ ] Export hash matches an independent `sha256sum`

### Security
- [ ] Every station-scoped endpoint passes the isolation matrix (T-INT-10)
- [ ] No endpoint other than `/health` and login is reachable without a token
- [ ] `DELETE /incidents` requires admin and a station scope
- [ ] JWT hardening checklist fully passes (§27.3)
- [ ] No plaintext passwords stored
- [ ] CORS restricted outside debug mode

### Persistence
- [ ] QC edits survive a restart, with audit
- [ ] Checklist state survives a refresh, with a signed submission
- [ ] Offline buffer replays exactly once
- [ ] Drift metrics recorded nightly

### MLOps
- [ ] Training reproducible from a seed (T-ML-06)
- [ ] Model card contains training window, cleaning counts, threshold derivation and limitations
- [ ] Rollback restores the previous version and changes scoring
- [ ] No candidate model activates without passing the gate
- [ ] Legacy v1 artifacts still load

### Honesty
- [ ] No unmeasured performance number appears in the UI, README, slides or model card
- [ ] RUL is labelled as a trend extrapolation with a band, never as a prediction
- [ ] Readiness tier shown wherever a model verdict is shown
- [ ] Fusion coefficients marked `fitted` or `default priors`
- [ ] `BENCHMARKS.md` records hardware, date and commit for every number

### Demo
- [ ] The 16-step script runs end to end without manual database intervention
- [ ] It runs from replay with no external network dependency
- [ ] Step 16 reliably yields `REGIONAL_EVENT` at all affected stations
- [ ] Two consecutive clean rehearsals completed

---

## 37. Deployment Architecture

### 37.1 Local development / demo
```
SQLite (WAL) · uvicorn --reload · vite dev · DEMO_MODE=true
Prerequisites: Python 3.11+, Node 20+. No database server, no ML libraries.
One-command start; document it in README.
```

### 37.2 Single-node production
```
nginx (TLS termination, static frontend, reverse proxy)
  └─ uvicorn (2–4 workers) — NOTE: the background poller must run in exactly ONE
                             process, or it will duplicate work and race on
                             live_state. Run it as a separate single-instance
                             process, or gate it on a worker-id/advisory lock.
       └─ PostgreSQL 16 + TimescaleDB
       └─ model artifacts on a persistent volume
```

That poller caveat is easy to miss and produces confusing duplicate incidents under multi-worker deployment. Specify it explicitly in the deployment README.

### 37.3 Scaled deployment
```
Load balancer → N stateless API instances (no poller)
              → 1 ingest/scoring worker per station shard
              → 1 scheduler (drift, retraining, aggregates)
              → PostgreSQL + TimescaleDB (primary + replica)
              → Redis for live state and model cache
              → object storage for model artifacts
```

### 37.4 Configuration

All via environment, no hardcoded defaults for anything security-relevant:

`DATABASE_URL` · `SECRET_KEY` (**no default; refuse to start without it in non-debug**) · `ACCESS_TOKEN_EXPIRE_MINUTES` · `ALLOWED_ORIGINS` · `DEMO_MODE` · `DEBUG` · `WEATHER_POLL_INTERVAL_SECONDS` · `OBSERVATION_SOURCE` (`open_meteo` | `replay` | `push`) · `SPATIAL_RADIUS_KM` · `SPATIAL_MODE` (`residual` | `raw`) · `MODEL_STORAGE_PATH` · `ENABLE_AUTO_RETRAINING` · `LOG_LEVEL`

Ship `.env.example` with every variable documented. Never commit `.env`.

### 37.5 Operations

Structured JSON logs with `station_id` and `request_id` on every line. `/api/v1/health` extended to report DB connectivity, poller last-tick age, model cache size and migration version. Backup: nightly `pg_dump` (or SQLite file copy) plus the model artifact directory — **artifacts and database must be backed up together**, since a registry row pointing at a missing artifact is a broken station.

---

## 38. Future Roadmap

| Item | Trigger that would justify it | Note |
|---|---|---|
| Federated learning across stations | > 100 stations with ≥ 1 year of history | Learn shared priors for cold start without a universal scorer; must not replace per-station models |
| Survival-model RUL (Weibull) | ≥ 30 observed sensor failures with dates | The honest successor to §18.5. Until then, the trend extrapolation stands |
| Deep-learning detectors | ≥ 2 years per station + a GPU deployment target + relaxed explainability | Currently strictly worse on every axis that matters here |
| Real IMD data feed | Institutional access | Replaces Open-Meteo; ingest layer already abstracted |
| Multi-tenant organisations | Multiple met agencies | Requires a tenancy layer above stations |
| Prometheus + Grafana | Production operation | Replace ad-hoc health endpoint metrics |
| Mobile operator app | Field technician workflow | The maintenance API (§28.2) is already the backend for it |
| Satellite/radar cross-validation | Data access | A third independent evidence source for regional events — the strongest possible version of §13 |
| Kubernetes | > 1 000 stations | §32 shows single-node viability well past the SIH scale |

---

## 39. Final Implementation Checklist

Work top to bottom. Each item references its section.

**Phase 0 — Verify (do not skip)**
- [ ] V1–V12 complete; `VERIFICATION.md` written (§3.5)
- [ ] Existing test suite green
- [ ] Root-level `test_*.py` scripts moved out of pytest collection

**Phase 1 — Security and correctness (P0)**
- [ ] `require_station` dependency implemented (§27.4)
- [ ] Every endpoint in the §27.4 table carries its required guard
- [ ] `test_station_isolation_matrix.py` passes for all endpoints
- [ ] `DELETE /incidents` admin + scoped
- [ ] `/fleet/live` response filtered by role
- [ ] JWT hardening checklist (§27.3) + `test_jwt_security.py`
- [ ] `SECRET_KEY` has no insecure default
- [ ] CORS from env
- [ ] Source-timestamp deduplication (§12.4)
- [ ] All temporal windows indexed on distinct observations
- [ ] Synthetic fault observations produce distinct source timestamps

**Phase 2 — Demo-critical (P0)**
- [ ] Migration framework + `schema_migrations` (§24.5)
- [ ] `assessments` table + three-axis verdict + `legacy_state` (§14.7, §24.3)
- [ ] Evidence payload v2 (§15.2)
- [ ] `GET /assessments/latest` (§25.3)
- [ ] `AssessmentContext` (§26.2)
- [ ] Evidence panel in HUD and incident modal (§26.5)
- [ ] Regional-event confirmation conditions 1–5 (§13.5)
- [ ] `REGIONAL_EVENT` suppresses sensor-fault root causes + T-INT-09
- [ ] QC persistence: `PUT`, audit, validation, UI (§28.1)
- [ ] QC 401 correct fix + `AuthContext.isReady` + 401 interceptor (§28.8)
- [ ] `demo_replay.py` (§33.6)
- [ ] 90 days of history seeded; all demo stations `TRAINED`

**Phase 3 — ML quality (P1)**
- [ ] `station_climatology` table + IRLS harmonic fit (§10.3)
- [ ] v2 12D residual feature space (§10.4)
- [ ] Verify/fix `c(n)` and the truncated-branch adjustment (§10.5)
- [ ] Training data hygiene + data-driven contamination (§10.6)
- [ ] Readiness tiers enforced and displayed (§10.7)
- [ ] Threshold calibration on a temporal held-out split (§10.8)
- [ ] Model artifact v2 + SHA-256 + v1 compatibility (§10.9, §20.3)
- [ ] Residual-space spatial comparison + T-SPA-02 (§13.4)
- [ ] `UNCONFIRMED` handling (§13.6)
- [ ] Fusion engine with logistic combination (§14)
- [ ] Missing-evidence renormalisation + completeness cap (§14.4, §14.6)
- [ ] Dwell logic (§14.8)
- [ ] Root-cause scored rule table (§16.2)

**Phase 4 — Evaluation (P1)**
- [ ] 12-type injection suite incl. hard negatives (§30.2)
- [ ] `injection_ledger` (§30.3)
- [ ] `run_evaluation.py` + point-wise metrics (§30.4, §30.7)
- [ ] Fusion coefficients fitted, cross-validated, versioned (§14.5)
- [ ] `BENCHMARKS.md` with hardware and dates (§31)
- [ ] Imputation MAE/RMSE + confidence calibration (§31.7)

**Phase 5 — Persistence and honesty (P1)**
- [ ] Maintenance tables + API + UI + signature (§28.2)
- [ ] Edge batch ingest + idempotency + real `EdgeSync.jsx` (§28.3)
- [ ] Server-side export + real hash + verify (§28.4)
- [ ] Drift engine + table + UI panel (§28.5)
- [ ] Per-sensor SHI (§18.1)
- [ ] Theil–Sen drift with bootstrap band (§18.2)
- [ ] RUL relabelled to degradation projection everywhere it is displayed (§18.5)
- [ ] Incident idempotency + 3-observation auto-resolution (§19.2–19.3)
- [ ] `WEATHER_EVENT` incident type (§19.5)
- [ ] JS engines demoted + contract test (§26.3)
- [ ] Plaintext `access_key` removed (§27.5)

**Phase 6 — Optional (P2)**
- [ ] Retraining pipeline with promotion gate (§28.6)
- [ ] TimescaleDB hypertable + continuous aggregate (§28.7)
- [ ] Neighbour cache (§13.7)
- [ ] Modal replacements (§26.6)
- [ ] Requirements split (§28.9)
- [ ] ESP32 reference firmware (§23.2)

**Phase 7 — Demo readiness**
- [ ] Full 16-step run-through twice, timed under 8 minutes
- [ ] Offline fallback recording and screenshots on the laptop
- [ ] Judge-question answers rehearsed (§33.5)
- [ ] Database backup + one-command restore tested
- [ ] `DEMO_MODE=true`, auto-retraining disabled
- [ ] Every claim on every slide traceable to a section of this document or to `BENCHMARKS.md`

---

## Appendix A — Consistency Audit

Verification that this specification meets the 18 checks required before finalisation.

| # | Check | Result |
|---|---|---|
| 1 | Every incomplete feature in `PROGRESS.md` addressed | ✅ G1–G11 → §28.1–28.9, §26.6, §27.5 |
| 2 | Every known bug has an explicit resolution | ✅ All six from §16 of the report, plus nine new findings |
| 3 | No existing major feature omitted | ✅ All 13 views, all 7 ML engines, all 9 tables, all ~30 endpoints carried forward |
| 4 | PS-073 scope respected | ✅ §2.4 — core three primary, supporting telemetry scoped as diagnostic |
| 5 | T, P, RH remain the core inputs | ✅ Feature space §10.4 is built from exactly these |
| 6 | Weather events distinguishable from sensor anomalies | ✅ §13.4–13.5, §14.7, §16.3, T-INT-09, demo step 16 |
| 7 | Station-adaptive learning remains central | ✅ P2; strengthened by per-station climatology §10.3 |
| 8 | Explainability present | ✅ §15, payload schema, Evidence panel, additivity test |
| 9 | Self-healing auditable | ✅ §17.4 separate table, no UPDATE path, static check T-INT-12 |
| 10 | Offline operation technically credible | ✅ §23 three-tier split with honest ESP32 positioning |
| 11 | Model drift addressed | ✅ §21, including the seasonal-confounder solution |
| 12 | Retraining controlled | ✅ §22 candidate → shadow → gate → approve |
| 13 | Database supports scaling | ✅ §24, §28.7, §32 with ordered bottleneck list |
| 14 | RBAC enforced | ✅ §27.4 — and the existing unenforced claim identified and fixed |
| 15 | Existing contracts preserved | ✅ `legacy_state`, additive columns, v1 artifact loader, no endpoint removed |
| 16 | Testing covers the full anomaly lifecycle | ✅ §29 unit → integration → E2E → chaos |
| 17 | Demo shows the central innovation | ✅ §33.3 steps 8, 9, 16; Evidence panel peer bars |
| 18 | No unsupported performance claims | ✅ §7 and §31 labelled as targets/procedures; §1.4 and §18.5 explicitly remove the two existing unsupported claims |

## Appendix B — Document Conventions

- Section numbers are stable and referenced from code comments as `SPEC §N`.
- Test IDs (`T-XXX-NN`) are stable identifiers; use them as test function names.
- `[SPEC]` items are requirements; `[PROPOSED]` items are recommendations.
- Any deviation from this document must be recorded in `DECISIONS.md` with a rationale, so the next agent understands why the code and the spec differ.

---

*End of specification.*
