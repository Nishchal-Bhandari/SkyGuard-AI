# SkyGuard-AI implementation report

Date: 2026-09-28. Baseline: `specsheet(2).md` and `system_design (1).md`. This report describes the current workspace, including uncommitted changes.

## Outcome and measurement

The project is **not 100% complete against the documented definition of done**. The local implementation passes 71 collected Python tests, the production frontend build, and `git diff --check`. Eight of 15 broad acceptance items have sufficient local test evidence here, giving a **strict unweighted evidence completion of 53.3%**. This percentage measures verified acceptance items only; it does not claim that the other 46.7% of source code is missing. See [status_audit_evidence.json](status_audit_evidence.json) for the reproducible result and [PROJECT_STATUS_AUDIT.md](PROJECT_STATUS_AUDIT.md) for the status summary.

## Implemented behavior

- Station operator passwords use Argon2id. Existing PBKDF2 hashes remain readable and are upgraded on login. Legacy plaintext `access_key` values are cleared by a versioned migration and blocked by database constraints/triggers. Station and device secrets are excluded from station API responses. Production configuration requires an explicit JWT secret and an initial admin password of at least 12 characters; browser demo quick-fill follows the running backend's `DEMO_MODE` setting.
- Station-scoped reads for ESP32 frames, faults, model jobs, and assessment routes are guarded. Training-job IDs are checked against their station. Station deactivation invalidates subsequent station-token use. Fleet fault reset is admin-only and fault controls require demo mode.
- Open-Meteo, historical upload, ESP32 ingest and REST batch replay feed the same source-timestamped observation pipeline. Normalization, hard-invalid gating, immutable raw insertion, duplicate/conflict recognition, quarantine, assessment, health, imputation, and incident updates share one transaction. Repeated frames do not advance the source-time normal streak. Failed batch rows receive individual negative acknowledgements.
- The backend provides a 12-feature v2 training/inference transform, station-specific readiness, temporal train/holdout split, measured unlabelled holdout and explicitly labelled synthetic-fault metrics. Models register as candidates, and activation checks gates, station incidents and artifact content integrity. An unavailable or incompatible artifact falls back to a disclosed rules-only state.
- The ESP32 firmware now timestamps frames with synchronized UTC, stores up to 64 frames in LittleFS, and removes a stored frame only after a successful response containing an explicit acknowledgement. The browser has a separate persisted JSON upload queue and retains rejected rows. These paths still require device and browser end-to-end verification.
- CI installs Python and Node dependencies, runs backend/ML tests and the frontend build, and publishes the evidence JSON.

## Requirement matrix: specsheet section 25

“Met” below means the local automated evidence covers the core contract; “partial” means implementation exists but a complete acceptance demonstration is missing. External requirements are never marked met based only on source inspection.

| # | Definition-of-done requirement | Status | Evidence / remaining proof |
|---|---|---|---|
| 1 | Invalid data cannot contaminate ML | **Met locally** | `test_hard_gate_prevents_ml` covers missing, sentinel, NaN, Inf and extreme temperature; all ingress paths call the canonical pipeline. Field sensor encodings remain untested. |
| 2 | Every station-scoped endpoint is isolated | **Partial** | `test_station_read_matrix` covers six read routes, job ownership and fleet reset. Exhaustive route/method/role matrix and disabled-admin behavior remain. |
| 3 | Source timestamps govern temporal logic | **Met locally** | UTC normalization, future-clock rejection, duplicate/conflict and out-of-order batch tests; latest pipeline state advances only on a newer observation. |
| 4 | Local abnormality and regional causality are separate | **Partial** | Separate `local` and `regional` flags and residual-peer checks exist; no labelled multi-station acceptance corpus or complete hard-negative proof. |
| 5 | Evidence is visible and auditable | **Partial** | Persisted assessment/evidence routes and dashboard fields exist; complete browser evidence workflow and independent audit replay are unverified. |
| 6 | Raw measurements are immutable | **Met locally** | `test_replay_duplicate_and_conflict` proves one raw row and one assessment for a replay, and no overwrite for a conflicting same-identity row; conflict quarantine exists. PostgreSQL proof remains. |
| 7 | Regional weather is not blamed on sensors | **Met locally** | A five-nearby-station replay proves a sustained event changes from a local candidate to `REGIONAL_EVENT`, names the weather front, preserves health at 100 and creates no imputation. Field validation remains. |
| 8 | No-peer cases disclose uncertainty | **Met locally** | A geographically isolated station produces `LOCALIZED_ANOMALY_UNCONFIRMED`, incomplete fleet evidence and confidence capped at 0.5. |
| 9 | Imputation preserves provenance | **Met locally** | A two-peer localized fault produces only an estimated temperature, records method/peer IDs in `imputations`, and leaves the immutable raw temperature unchanged. Field reconstruction error remains unmeasured. |
| 10 | Model readiness is visible | **Met locally** | 72/720/14-day/4380/two-season tiers and insufficient-history training tests; every pipeline assessment carries readiness. |
| 11 | Model promotion is gated | **Partial** | Candidate status, temporal holdout, synthetic chain metrics, integrity hash and incident gate implemented; no field-validated false-alert/delay gate or shadow comparison. |
| 12 | Incidents are idempotent | **Met locally** | A duplicate fault frame leaves one open incident; two distinct normal observations keep it open, and the third resolves it. Cross-path and PostgreSQL lifecycle proof remains. |
| 13 | Demo replay is deterministic | **Unverified** | Existing replay assets lack a full five-nearby-station expected-versus-actual ledger and two recorded rehearsals. |
| 14 | Displayed performance traces to benchmark | **Partial** | Frontend link latency is measured; model-card holdout/synthetic metrics disclose provenance. No field benchmark or load measurement exists; a bundle-size warning remains. |
| 15 | Limitations are visible and accurate | **Partial** | This report and rules-only status disclose several limits. Screens/export/slide deck still need a complete limitations review. |

## Material constraints and next acceptance gates

1. **Production database:** Run fresh and upgrade migrations against a provisioned PostgreSQL/TimescaleDB instance, including conflict quarantine, transaction rollback, one-active-model constraints and replay. The local Docker daemon is unavailable, so SQLite tests are the only database execution evidence here.
2. **Device:** Compile with the ESP32 Arduino toolchain and test normal ingest, HTTP 4xx/5xx, disconnect, reconnect, reboot, queue-full and clock-unsynchronized cases. Arduino CLI and PlatformIO are unavailable here. Provision real station keys and secure the transport before any field deployment; the sketch still contains example Wi-Fi/server settings and a demo Soft-AP.
3. **Science:** Build a deterministic, labelled, nearby multi-station corpus spanning all twelve fault/hard-negative cases. Compare complete-chain classification, attribution, imputation error, false alerts and alert delay to declared thresholds. Validate synthetic calibration against field data before reporting probabilities as calibrated risk.
4. **Operations and product:** Exercise browser journeys by role, run load/latency benchmarks, verify export provenance and signature verification, restore a backup, rehearse the entire demo twice, and finish the six-slide submission with measured claims. Legacy v1 artifacts load but require retraining before v2 scoring.

The audit command is `python scripts/audit_status.py` from the project root after installing dependencies. On Windows, `.venv\Scripts\python.exe scripts/audit_status.py` uses the project virtual environment. The command reports local checks and deliberately retains the unverified acceptance gates above.

## Post-audit runtime corrections

The training view's running-job recovery called a `const` polling function before initialization after an early render return. It now uses a hoisted function declaration, and its visible training threshold and feature count match the backend. The login view now reads demo mode from the running backend; expected 401 login responses no longer generate an additional API-client warning. A read-only admin diagnostic is available at `scripts/diagnose_admin_login.py`. It reports whether the configured bootstrap password matches the active account without printing credentials. In this workspace, the configured PostgreSQL account exists, is active, and its hash matches that password; an earlier browser 401 therefore cannot be attributed to this configured account alone.
