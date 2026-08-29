# System Spec — Monsoon Sentinel

Product and requirements reference for coding agents. For source citations and provenance, see
`docs/reference/research_notes.md`. For architecture and implementation detail, see
`system_design.md`. For the domain operating rules, see `skill.md`.

**Target:** Smart India Hackathon 2026, Problem Statement 073 (working interpretation — see
`AGENTS.md`).

## 1. What this is

Monsoon Sentinel finds abnormal, missing, drifting, or inconsistent Automatic Weather Station
(AWS) observations, decides whether the cause is a real weather event or an equipment/data
problem, explains the decision as structured evidence, and hands the case to an operator. It
never silently replaces a raw observation.

Design stance: keep **observation plausibility**, **instrument health**, and **weather-event
context** as separate signals. Collapsing them into one score is the main way naive anomaly
detectors fail on meteorological data — they flag real storms as broken sensors.

## 2. Non-goals for the MVP

Not a replacement for a national met agency's calibration lab, siting program, or forecast
pipeline. No WMO-compliance claims. No automatic discard of rare-but-real extremes. No
unlabelled deep model presented with an accuracy number and no fault-injection protocol behind
it.

## 3. Users and jobs-to-be-done

| User | Needs | Capability |
| --- | --- | --- |
| Field technician | Which station/sensor needs attention, and why | Prioritized incidents, likely cause, checklist, heartbeat/battery/signal state |
| Data-quality analyst | Approve or reject suspicious observations | Timeline, peer evidence, rule + model scores, raw/processed values, disposition workflow |
| Network supervisor | Fleet health at a glance | Station map, anomaly heatmap, outage clusters, recurring-fault ranking |
| Data consumer | Trustworthy exports | API/export with QC state, reason codes, confidence, provenance |
| ML engineer | Improve models without breaking trust | Label store, versioned features, fault injection, drift monitoring, model registry |

Primary flow: a station reports every 5–10 minutes → the gateway validates the envelope and
timestamp, stores it durably, runs fast checks, and forwards a compact event → the cloud enriches
it with station and neighbor context, runs the fleet detector, and opens an incident only once
evidence clears a persistence/severity policy → an operator acknowledges, confirms genuine
weather, confirms a fault, or defers.

## 4. Functional requirements

| ID | Requirement | MVP acceptance criterion |
| --- | --- | --- |
| F-01 | Ingest via CSV, REST, MQTT, or simulator adapters | Common schema covers temperature, humidity, pressure, wind, rainfall, timestamp, station ID, lat/lon |
| F-02 | Normalize units and timestamps | Every record keeps original unit, canonical unit, source timestamp, UTC timestamp, conversion status |
| F-03 | Preserve raw observations | Raw payload is immutable and linked to every derived record |
| F-04 | Run deterministic QC | Range, missingness, duplicate, freshness, rate-of-change, flatline, and internal-consistency rules each emit a reason code |
| F-05 | Run station-adaptive anomaly models | Zero global models; dedicated Isolation Forest per station trained on historical upload; deterministic rules fallback until calibrated |
| F-06 | Nearby station spatial intelligence | Haversine geodetic distance <= radius_km; robust Median & MAD; filters stale/corrupt peers; dual-track anomaly fusion |
| F-07 | Fuse evidence | Rule + model output produce a calibrated severity, confidence, explanation, and recommended action |
| F-08 | Support human review | Operator can acknowledge, assign, comment, accept-as-genuine, mark-bad, or reopen |
| F-09 | Alert responsibly | Dashboard + email/SMS/webhook, with dedup, cooldown, escalation |
| F-10 | Export quality-aware data | API/CSV export carries raw value, QC state, anomaly score, reasons, model version, disposition |
| F-11 | Monitor the detector itself | Dashboard reports alert volume, false-positive feedback, missingness, latency, drift, station health |
| F-12 | Work offline at the edge | Gateway buffers and runs core rules during an outage, replays without duplication on reconnect |

## 5. Detection pipeline (ordered — cheap and interpretable first)

1. **Data-contract checks** — schema, station identity, timestamp, units, duplicate ID, payload
   integrity, freshness.
2. **Physical/domain rules** — per-station/variable plausible ranges, max credible rate of
   change, stuck-value duration, impossible accumulations, cross-variable relationships (e.g.
   dew point ≤ air temperature).
3. **Robust temporal features** — rolling-median deviation, MAD score, exponentially-weighted
   residual, slope, volatility, missingness run length, daily-cycle residual. Use median/MAD, not
   mean/stddev — the series may already contain outliers.
4. **Cross-variable checks** — humidity–temperature coupling, pressure–altitude plausibility,
   rainfall-accumulator continuity, daylight-aware solar radiation, wind speed/direction sensor
   activity.
5. **Spatial ("buddy") checks** — reference set chosen by distance, elevation, climate zone,
   historical correlation, and current trust state; a suspect neighbor is excluded or
   down-weighted so it can't contaminate the fleet baseline.
6. **ML detector** — Isolation Forest on engineered windows first (works on unlabeled data,
   explainable via feature contribution). A sequence autoencoder/LSTM is a second-stage
   experiment only once enough clean history exists, evaluated locally — don't import an
   external benchmark number as a promise.

## 6. Anomaly taxonomy (reason codes)

| Code | Meaning | Typical evidence | First operator action |
| --- | --- | --- | --- |
| `COMMUNICATION_GAP` | No observation/heartbeat within expected interval | Missing sequence, stale last-seen, offline gateway | Check power/network/SIM/gateway/broker |
| `STALE_VALUE` | Repeated old timestamp or unchanged payload | Timestamp lag, identical message ID | Inspect logger clock/time sync |
| `FLATLINE` | Value constant beyond a context-aware duration | Low variance, repeated identical value | Inspect stuck probe/cable/ADC/frozen process |
| `SPIKE` | Isolated abrupt excursion that returns | High robust residual, quick return | Check interference/lightning/gust/wiring |
| `DRIFT` | Gradual bias vs. peers/calibration reference | Persistent, slowly growing deviation | Schedule calibration/cleaning |
| `RANGE_FAIL` | Outside configured physical/operational envelope | Deterministic bound failure | Verify units/sensor/wiring; check for a true extreme |
| `RATE_FAIL` | Implausible change over the interval | Excessive derivative | Check timestamp/sampling/transient/event context |
| `INTERNAL_INCONSISTENCY` | Known relationship violated | e.g. dew point > temperature | Inspect involved sensors/derived calcs |
| `SPATIAL_OUTLIER` | Disagrees with trusted neighbors | Buddy residual, peer consensus | Inspect station or validate local micro-weather |
| `NETWORK_EVENT` | Multiple stations fail together | Shared provider/region/time cluster | Check broker/power grid/gateway release/weather |
| `GENUINE_EXTREME_CANDIDATE` | Rare, physically coherent event | Multiple variables + neighbors agree | Do not discard — route for expert confirmation |

## 7. Quality states and evidence

States: `PRELIMINARY`, `ACCEPTED`, `SUSPECT`, `REJECTED`, `MISSING`, `DERIVED`. State is separate
from the numeric score — a high score can stay `SUSPECT` until reviewed, a deterministic range
failure can be `REJECTED` by policy, and a reviewed extreme becomes `ACCEPTED`.

Every decision carries a reason list: check ID, input values, threshold/reference, result,
detector version, timestamp. Operator-facing explanations are generated from these structured
reasons via templates — never from unconstrained free-text generation — so every explanation
traces back to a value, threshold, peer, or feature.

## 8. Innovation portfolio

- **Weather Event Context Gate** — coherent multi-variable, multi-station change reclassifies
  "probable fault" → `GENUINE_EXTREME_CANDIDATE`.
- **Station fingerprint** — learned per-station normal diurnal pattern, response lag, noise
  level, missingness pattern, calibration bias, and peer relationships; supports predictive
  maintenance without a labeled fault dataset.
- **Evidence graph** — observation → failed checks → affected variables → station-health signals
  → neighbor evidence → probable cause → recommended action, instead of a flat alert.
- **Offline-first edge** — gateway buffers and runs rules during an outage, replays without
  duplicates.
- Future path (explicitly not MVP): federated/privacy-preserving fleet learning; counterfactual
  operator assistance showing "reported / quality-controlled / estimated" as separate labeled
  series.

## 9. Data and evaluation strategy

Assemble a canonical dataset from available AWS/ARG samples plus a transparent fault simulator —
don't wait on external data access to start. Inject one fault at a time and in combination:
missing blocks, duplicated timestamps, flatlines, spikes, bias drift, scale/unit errors, sensor
swap, delayed sensor, random noise, rainfall undercount, pressure offset, wind-direction wrap,
correlated network outages.

Evaluate with **chronological splits only**. Report event-level precision/recall, false alerts
per station-day, median detection delay, mean time to acknowledge, calibration error, percent of
alerts with an accepted explanation, and a per-fault-type confusion matrix. A detector that flags
everything is not a success.

## 10. Key risks

| Risk | Mitigation |
| --- | --- |
| No labelled faults | Normal-data models + expert review + fault injection with stated limits |
| Extreme weather looks anomalous | Multi-variable coherence + neighbor corroboration |
| Sparse network weakens spatial checks | Lean on temporal/contextual evidence, station-specific confidence |
| Sensor heterogeneity | Per-station config, no global threshold |
| Concept drift | Versioned rolling retraining with approval and drift metrics |
| Network outage | Edge buffering, local rules, replay-safe IDs |
| Alert fatigue | Persistence windows, dedup, severity policy, feedback loop |
| Overclaiming standards | Say "standards-informed," never "certified" |

## 11. Definition of done

See `AGENTS.md`.
