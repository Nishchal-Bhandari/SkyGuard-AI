---
name: aws-anomaly-detection
description: Design, implement, evaluate, and explain AI/ML-based anomaly detection and quality control for automatic weather station and environmental sensor networks. Use when building AWS telemetry pipelines, sensor QC rules, temporal or spatial anomaly detectors, edge/cloud monitoring, fault injection benchmarks, operator alerts, or quality-aware weather-data APIs.
---

# AWS Anomaly Detection Skill

Use this skill to build a trustworthy, explainable anomaly-detection system for automatic weather stations. Treat the task as **data quality plus station health plus weather-event context**, not as generic outlier removal.

## Operating rules

1. Preserve the raw payload and raw value. Never overwrite or delete an observation because a detector flags it.
2. Separate `quality_state`, `anomaly_score`, `severity`, and `human_disposition`. An anomaly score is not automatically a probability.
3. Run deterministic checks before ML. Emit structured reason codes for every failed check.
4. Treat a rare extreme as potentially genuine. Seek support from related variables and trusted neighbouring stations before calling it a sensor fault.
5. Never fabricate missing observations. Keep missing values missing; put interpolations or forecasts in explicitly labelled derived fields.
6. Make every result reproducible with station profile, threshold version, feature version, model version, and evidence IDs.
7. Exclude `SUSPECT` and `REJECTED` peers from spatial baselines or down-weight them. Do not let one bad station contaminate the network reference.
8. Prefer chronological evaluation and event-level metrics over random train/test splits and point accuracy.
9. Keep thresholds station-aware, unit-aware, and configurable. Do not apply one global limit to heterogeneous instruments or climates.
10. Degrade safely: if the model or cloud is unavailable, keep ingesting, buffer at the edge, and continue rules-based QC.

## Canonical workflow

### 1. Establish context

Record station IDs, latitude, longitude, elevation, timezone, sampling cadence, sensor models, units, installation metadata, calibration history, expected variables, gateway health fields, and trusted-neighbour policy. If the official challenge statement is unavailable, label the solution assumptions explicitly and do not invent sponsor requirements.

### 2. Build the data contract

Require a stable `event_id`, `station_id`, `observed_at` in UTC, `received_at`, sequence number where available, source, raw payload hash, and a measurement map containing value, raw unit, canonical unit, and quality. Include battery, signal, uptime, firmware, and sensor-heartbeat fields when available.

Use an idempotency key derived from vendor event ID or from station ID + observed timestamp + sequence + payload hash. Duplicate deliveries must be safe and must not create duplicate observations or incidents.

### 3. Implement layered QC

Implement independent, testable functions for schema and payload integrity, timestamp/freshness, duplicate and sequence checks, finite-value and unit checks, plausible range, rate of change, flatline, missingness, accumulator/reset behaviour, internal relationships, cross-variable relationships, station health, and spatial/buddy comparison.

Use reason codes such as `RANGE_FAIL`, `RATE_FAIL`, `FLATLINE`, `COMMUNICATION_GAP`, `STALE_VALUE`, `INTERNAL_INCONSISTENCY`, `SPATIAL_OUTLIER`, `POWER_LOW`, and `GENUINE_EXTREME_CANDIDATE`. Keep the failing value, threshold, reference window, peer set, and rule version beside the code.

Useful domain relationships include dew point not exceeding air temperature, rainfall accumulations behaving monotonically except for a documented reset, valid wind-direction bounds, plausible pressure changes, and daylight-aware solar radiation. Confirm each relationship against the instrument and data definition before production use.

### 4. Create temporal and spatial features

For each station and variable, compute rolling median, MAD score, exponentially weighted residual, slope, volatility, first and second difference, flatline duration, missingness run length, time since last valid sample, time-of-day and day-of-year encodings, health signals, and rule-failure counts.

For spatial context, compute trusted-peer count, distance-weighted median, peer MAD, target-to-peer residual, recent correlation, elevation or climate-context adjustment where justified, and the fraction of peers supporting the same change. Use only temporally aligned peers and record which peers were included or excluded.

### 5. Add an ML baseline

Start with an unlabelled engineered-feature model such as Isolation Forest or a robust statistical detector. Fit on a clean or screened history, retain the training manifest, and avoid leakage from future data. Use a sequence autoencoder or LSTM autoencoder only when enough clean history exists and the team can compare it fairly against simpler baselines.

At the edge, use a compact rolling-median/MAD or z-score detector and station-health state. Keep the cloud detector heavier if necessary. A model failure must fall back to rules and mark model unavailability in the evidence.

### 6. Fuse evidence transparently

Create separate normalized components for rule severity, temporal model score, spatial disagreement, station-health risk, and weather-event coherence. Combine them with versioned policy weights or a calibrated meta-model. Add persistence, hysteresis, deduplication, cooldown, and escalation.

Use the following states as a starting vocabulary: `PRELIMINARY`, `ACCEPTED`, `SUSPECT`, `REJECTED`, `MISSING`, `DERIVED`, and `GENUINE_EXTREME_CANDIDATE`. Do not convert a state to a final disposition until policy or human review supports it.

### 7. Explain the result

Generate operator-facing text from structured templates. Show the value, comparison, threshold/reference, persistence, peer support, health evidence, and next action. Example: “Humidity stayed within 0.2 percentage points for 55 minutes, disagrees with two trusted peers, and battery voltage is low; inspect the probe and enclosure.” Never rely on unconstrained generated prose as the only explanation.

### 8. Validate with injected faults and review labels

Create a replayable fault injector for missing blocks, duplicates, flatlines, spikes, bias drift, scale/unit errors, delayed sensors, random noise, rainfall undercount, pressure offset, wind-direction wrap errors, and correlated outages. Evaluate each fault family separately and combine it with clean periods and real-weather-like coherent changes.

Report event precision, event recall, false alerts per station-day, detection delay, calibration error when probabilities are claimed, per-class confusion matrix, alert persistence, and explanation completeness. Store the random seed, input manifest, injected fault manifest, configuration, feature version, model version, and output report.

## Repository structure

Prefer a modular layout such as:

```text
src/
  contracts/       # schemas, units, validation
  adapters/        # MQTT, REST, CSV, vendor and IMD-compatible adapters
  qc/              # deterministic checks and reason codes
  features/        # temporal, spatial and station-health features
  models/          # baseline, Isolation Forest, sequence models
  fusion/          # score calibration, state policy, incident rules
  storage/         # raw, canonical, results, incidents and labels
  api/             # ingestion, query, review, export
  edge/            # local buffer and offline replay
  ui/              # operator dashboard
  evaluation/      # fault injection, replay, metrics, reports
tests/
  unit/
  integration/
  property/
configs/
  stations/
  rules/
  models/
docs/
  model_card.md
  data_dictionary.md
  threat_model.md
```

## Interfaces to enforce

A detector should expose a stable interface conceptually equivalent to:

```python
def detect(context: ObservationContext) -> DetectorResult:
    """Return score, evidence, reason codes, latency, and model version."""
```

`DetectorResult` must contain `detector_name`, `score`, `score_type`, `threshold`, `reason_codes`, `evidence`, `feature_version`, `model_version`, and `latency_ms`. A rule result must contain `rule_id`, `passed`, `observed_value`, `reference`, `reason_code`, and `rule_version`.

Use a separate `Incident` object for lifecycle fields: `open`, `acknowledged`, `assigned`, `resolved`, `dismissed`, or `reopened`. Store operator identity, time, comment, and final disposition. Human labels must not silently mutate historical detector results.

## Edge and messaging guardrails

Use MQTT with persistent sessions and QoS appropriate to the deployment; use TLS and topic ACLs outside a local demo. Write to a local append-only buffer before attempting publication. Track `pending`, `sent`, and `acknowledged` event IDs. Replay in observed-time order with bounded batches after reconnection.

Use strict payload-size, rate, and schema limits. Do not put broker passwords, API keys, or device secrets in source code. Never copy public-broker or plaintext-credential patterns from archived tutorials into a real deployment.

## Model governance

Create a model card for every detector. Include purpose, variables, station coverage, training period, normal-data selection, features, thresholding, intended use, known failure modes, evaluation splits, metrics, human-review policy, and rollback procedure. Approve model updates before deployment. Monitor score distributions, missingness, false-positive feedback, out-of-distribution indicators, and station-level drift.

When using external data such as IMD products, record endpoint, access time, response schema, license/terms status, station mapping, time zone, and alignment method. External weather data may be context, not ground truth, unless its measurement quality and temporal/spatial alignment are established.

## Definition of done

A feature is complete when it has a documented contract, unit tests, an observable reason code or metric, a replayable example, and a limitation statement. The MVP is complete when teammates can run a normal stream, inject at least five fault types, inspect the raw and quality-aware series, review an incident, export evidence, and reproduce the evaluation report.

## Research anchors

Use the NOAA MADIS staged QC model for validity, temporal, internal, spatial, and quality-state concepts.[1] Use the NOAA NWS QC material for range, temporal continuity, spatial consistency, and error-log practices.[2] Use the pypwsqc and related repositories for modular filters such as faulty-zero, high-influx, station-outlier, indicator-correlation, and peak-removal patterns.[3] [4] Use the recent meteorological autoencoder study as evidence for evaluating temporal models against expert-reviewed data, not as a transferable performance guarantee.[5]

## References

[1]: https://madis.ncep.noaa.gov/madis_RSAS_qc_notes.shtml "NOAA/NCEP MADIS RSAS Quality Control Checks"
[2]: https://training.weather.gov/nwstc/Hydrology/HYDRO/QCModule/QCConc.HTML "NOAA NWS Training Center, Quality Control Concepts"
[3]: https://github.com/OpenSenseAction/pypwsqc "OpenSenseAction/pypwsqc GitHub repository"
[4]: https://github.com/tomasfbouvier/Meteorological_Data_quality_assesment "Meteorological_Data_quality_assesment GitHub repository"
[5]: https://www.cambridge.org/core/journals/environmental-data-science/article/machine-learning-approach-using-autoencoders-to-perform-quality-control-on-meteorological-data/4576781508080877E36C0CA6612E5590 "Spohn et al. 2026, autoencoders for meteorological quality control"
