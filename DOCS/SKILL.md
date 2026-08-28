---
name: aws-anomaly-detection
description: Design, implement, evaluate, and explain AI/ML-based anomaly detection and quality control for automatic weather station and environmental sensor networks. Use when building AWS telemetry pipelines, sensor QC rules, temporal or spatial anomaly detectors, edge/cloud monitoring, fault injection benchmarks, operator alerts, or quality-aware weather-data APIs.
---

# AWS Anomaly Detection Skill

Use this skill to build a trustworthy, explainable anomaly-detection system for automatic
weather stations. Treat the task as **data quality plus station health plus weather-event
context**, not as generic outlier removal.

**In this repository**, this skill is the standing operating rule set for Monsoon Sentinel.
`system.md` says what to build, `system_design.md` says how it's wired together, and this file
says how to behave while writing any part of it — keep it loaded for the whole build, and treat
its ten operating rules as equivalent in weight to the non-negotiables in `AGENTS.md`. It is
written to generalize beyond this one hackathon project, so it's also safe to reuse as-is for a
future AWS/sensor QC system.

## Operating rules

1. Preserve the raw payload and raw value. Never overwrite or delete an observation because a
   detector flags it.
2. Separate `quality_state`, `anomaly_score`, `severity`, and `human_disposition`. An anomaly
   score is not automatically a probability.
3. Run deterministic checks before ML. Emit structured reason codes for every failed check.
4. Treat a rare extreme as potentially genuine. Seek support from related variables and trusted
   neighbouring stations before calling it a sensor fault.
5. Never fabricate missing observations. Keep missing values missing; put interpolations or
   forecasts in explicitly labelled derived fields.
6. Make every result reproducible with station profile, threshold version, feature version,
   model version, and evidence IDs.
7. Exclude `SUSPECT` and `REJECTED` peers from spatial baselines or down-weight them. Do not let
   one bad station contaminate the network reference.
8. Prefer chronological evaluation and event-level metrics over random train/test splits and
   point accuracy.
9. Keep thresholds station-aware, unit-aware, and configurable. Do not apply one global limit to
   heterogeneous instruments or climates.
10. Degrade safely: if the model or cloud is unavailable, keep ingesting, buffer at the edge, and
    continue rules-based QC.

## Canonical workflow

### 1. Establish context

Record station IDs, latitude, longitude, elevation, timezone, sampling cadence, sensor models,
units, installation metadata, calibration history, expected variables, gateway health fields, and
trusted-neighbour policy. If the official challenge statement is unavailable, label the solution
assumptions explicitly and do not invent sponsor requirements.

### 2. Build the data contract

Require a stable `event_id`, `station_id`, `observed_at` in UTC, `received_at`, sequence number
where available, source, raw payload hash, and a measurement map containing value, raw unit,
canonical unit, and quality. Include battery, signal, uptime, firmware, and sensor-heartbeat
fields when available.

Use an idempotency key derived from vendor event ID or from station ID + observed timestamp +
sequence + payload hash. Duplicate deliveries must be safe and must not create duplicate
observations or incidents.

### 3. Implement layered QC

Implement independent, testable functions for schema and payload integrity, timestamp/freshness,
duplicate and sequence checks, finite-value and unit checks, plausible range, rate of change,
flatline, missingness, accumulator/reset behaviour, internal relationships, cross-variable
relationships, station health, and spatial/buddy comparison.

Use reason codes such as `RANGE_FAIL`, `RATE_FAIL`, `FLATLINE`, `COMMUNICATION_GAP`,
`STALE_VALUE`, `INTERNAL_INCONSISTENCY`, `SPATIAL_OUTLIER`, `POWER_LOW`, and
`GENUINE_EXTREME_CANDIDATE`. Keep the failing value, threshold, reference window, peer set, and
rule version beside the code.

Useful domain relationships include dew point not exceeding air temperature, rainfall
accumulations behaving monotonically except for a documented reset, valid wind-direction bounds,
plausible pressure changes, and daylight-aware solar radiation. Confirm each relationship against
the instrument and data definition before production use.

### 4. Create temporal and spatial features

For each station and variable, compute rolling median, MAD score, exponentially weighted
residual, slope, volatility, first and second difference, flatline duration, missingness run
length, time since last valid sample, time-of-day and day-of-year encodings, health signals, and
rule-failure counts.

For spatial context, compute trusted-peer count, distance-weighted median, peer MAD,
target-to-peer residual, recent correlation, elevation or climate-context adjustment where
justified, and the fraction of peers supporting the same change. Use only temporally aligned
peers and record which peers were included or excluded.

### 5. Add an ML baseline

Start with an unlabelled engineered-feature model such as Isolation Forest or a robust
statistical detector. Fit on a clean or screened history, retain the training manifest, and avoid
leakage from future data. Use a sequence autoencoder or LSTM autoencoder only when enough clean
history exists and the team can compare it fairly against simpler baselines.

At the edge, use a compact rolling-median/MAD or z-score detector and station-health state. Keep
the cloud detector heavier if necessary. A model failure must fall back to rules and mark model
unavailability in the evidence.

### 6. Fuse evidence transparently

Create separate normalized components for rule severity, temporal model score, spatial
disagreement, station-health risk, and weather-event coherence. Combine them with versioned
policy weights or a calibrated meta-model (see `system_design.md` §9 for the starting formula).
Add persistence, hysteresis, deduplication, cooldown, and escalation.

Use the following states as a starting vocabulary: `PRELIMINARY`, `ACCEPTED`, `SUSPECT`,
`REJECTED`, `MISSING`, `DERIVED`, and `GENUINE_EXTREME_CANDIDATE`. Do not convert a state to a
final disposition until policy or human review supports it.

### 7. Explain the result

Generate operator-facing text from structured templates. Show the value, comparison,
threshold/reference, persistence, peer support, health evidence, and next action. Example:
"Humidity stayed within 0.2 percentage points for 55 minutes, disagrees with two trusted peers,
and battery voltage is low; inspect the probe and enclosure." Never rely on unconstrained
generated prose as the only explanation.

### 8. Validate with injected faults and review labels

Create a replayable fault injector for missing blocks, duplicates, flatlines, spikes, bias drift,
scale/unit errors, delayed sensors, random noise, rainfall undercount, pressure offset,
wind-direction wrap errors, and correlated outages. Evaluate each fault family separately and
combine it with clean periods and real-weather-like coherent changes.

Report event precision, event recall, false alerts per station-day, detection delay, calibration
error when probabilities are claimed, per-class confusion matrix, alert persistence, and
explanation completeness. Store the random seed, input manifest, injected fault manifest,
configuration, feature version, model version, and output report.

## Interfaces to enforce

A detector should expose a stable interface conceptually equivalent to:

```python
def detect(context: ObservationContext) -> DetectorResult:
    """Return score, evidence, reason codes, latency, and model version."""
```

`DetectorResult` must contain `detector_name`, `score`, `score_type`, `threshold`,
`reason_codes`, `evidence`, `feature_version`, `model_version`, and `latency_ms`. A rule result
must contain `rule_id`, `passed`, `observed_value`, `reference`, `reason_code`, and
`rule_version`.

Use a separate `Incident` object for lifecycle fields: `open`, `acknowledged`, `assigned`,
`resolved`, `dismissed`, or `reopened`. Store operator identity, time, comment, and final
disposition. Human labels must not silently mutate historical detector results.

## Edge and messaging guardrails

Use MQTT with persistent sessions and QoS appropriate to the deployment; use TLS and topic ACLs
outside a local demo. Write to a local append-only buffer before attempting publication. Track
`pending`, `sent`, and `acknowledged` event IDs. Replay in observed-time order with bounded
batches after reconnection.

Use strict payload-size, rate, and schema limits. Do not put broker passwords, API keys, or
device secrets in source code. Never copy public-broker or plaintext-credential patterns from
archived tutorials into a real deployment.

## Model governance

Create a model card for every detector. Include purpose, variables, station coverage, training
period, normal-data selection, features, thresholding, intended use, known failure modes,
evaluation splits, metrics, human-review policy, and rollback procedure. Approve model updates
before deployment. Monitor score distributions, missingness, false-positive feedback,
out-of-distribution indicators, and station-level drift.

When using external data such as IMD products, record endpoint, access time, response schema,
license/terms status, station mapping, time zone, and alignment method. External weather data may
be context, not ground truth, unless its measurement quality and temporal/spatial alignment are
established.

## Definition of done

A feature is complete when it has a documented contract, unit tests, an observable reason code or
metric, a replayable example, and a limitation statement. The MVP is complete when teammates can
run a normal stream, inject at least five fault types, inspect the raw and quality-aware series,
review an incident, export evidence, and reproduce the evaluation report.

## Further reading

NOAA MADIS staged QC (validity, temporal, internal, spatial, quality-state concepts); NOAA NWS QC
training material (range, temporal continuity, spatial consistency, error-log practices);
pypwsqc and related repositories (modular filters — faulty-zero, high-influx, station-outlier,
indicator-correlation, peak-removal); the meteorological-autoencoder literature (as evidence for
*how to evaluate* temporal models against expert-reviewed data, not as a transferable performance
guarantee). Full links and access notes: `docs/reference/research_notes.md`.
