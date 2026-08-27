# Monsoon Sentinel
## AI/ML-Based Intelligent Anomaly Detection for Automatic Weather Stations

**Document type:** System specification and product blueprint  
**Prepared by:** Manus AI  
**Research date:** 27 August 2026  
**Target:** Smart India Hackathon 2026, problem statement 073 as described by the team

> **Working interpretation.** This document treats the challenge as an operational system that detects abnormal, missing, drifting, inconsistent, or suspicious observations from Automatic Weather Stations (AWS), explains the likely cause, alerts the responsible operator, and preserves a trustworthy data trail. The exact official row for PS 073 should be pasted into the project repository when the team obtains the official workbook; the official workbook URL was discoverable but blocked for direct retrieval during research.

## 1. Executive concept

**Monsoon Sentinel** is a hybrid edge–cloud quality intelligence platform for AWS networks. It does not blindly replace observations with model outputs. Instead, it preserves the raw observation, runs deterministic meteorological checks, applies temporal and spatial machine-learning detectors, combines the evidence into a calibrated confidence score, and presents a human-readable incident to an operator. The result is an auditable decision: **accepted, suspect, rejected, missing, or awaiting review**.

The system is designed around a simple principle: an anomalous number is not always a bad number. A sudden pressure fall, high wind speed, intense rainfall, or sharp temperature change may be a real event. Therefore, the platform separates **observation plausibility** from **instrument health** and **weather-event context**. It should increase trust in the data without suppressing rare but genuine Indian weather phenomena.

This layered approach follows operational meteorological quality-control practice. NOAA’s MADIS documentation describes validity checks, temporal-rate checks, internal consistency checks, and spatial “buddy” checks, with explicit states such as preliminary, screened, verified, erroneous, and questionable.[3] The NOAA National Weather Service training material similarly distinguishes range, temporal continuity, spatial consistency, and manual error-log review.[6] Recent work on meteorological autoencoders shows that temporal models can complement basic QC, but performance must be evaluated against expert-quality-controlled data rather than assumed from generic benchmarks.[5]

## 2. Problem definition

AWS networks generate repeated measurements from sensors such as air temperature, relative humidity, atmospheric pressure, wind speed, wind direction, rainfall, solar radiation, visibility, and station-health channels. The observations can become unreliable because of sensor fouling, calibration drift, stuck or flatlined probes, loose wiring, power instability, communication loss, timestamp errors, unit mismatches, incorrect installation, condensation, blocked rain gauges, anemometer faults, or genuine local extremes.

The operational challenge is not only to find statistical outliers. The system must answer five questions quickly:

| Question | Required system answer |
| --- | --- |
| What happened? | Identify the station, variable, timestamp, observed value, and anomaly type. |
| Is it a real weather event or a sensor/data problem? | Compare rules, time history, related variables, neighbors, external context, and station health. |
| How confident are we? | Produce a calibrated severity and confidence score, not an unexplained binary label. |
| What should an operator do? | Recommend inspect, recalibrate, clean, verify connectivity, accept as genuine event, or leave under review. |
| Can we prove what happened later? | Preserve raw data, features, model version, rule results, alert history, and human disposition. |

## 3. Goals and non-goals

### 3.1 Goals

The first goal is to detect common AWS data-quality and equipment-health problems in near real time, including missing data, stale data, flatlines, spikes, impossible values, excessive rates of change, cross-variable contradictions, station outliers, network-wide communication failures, and gradual sensor drift.

The second goal is to make every alert explainable. An operator should see statements such as “relative humidity is 22 percentage points above the station’s learned normal range and disagrees with neighboring stations; temperature–dew-point relationship is invalid,” rather than “model score = 0.97.”

The third goal is to operate in poor-connectivity environments. A gateway should be able to buffer observations, run lightweight checks locally, generate an emergency alert locally, and synchronize later. Edge processing is consistent with published IoT architecture patterns in which MQTT carries data to an edge node, local processing reduces latency and bandwidth, and the cloud performs long-term storage and coordination.[11]

The fourth goal is safe adoption. The platform should flag and annotate observations before it attempts any correction. Gap filling, smoothing, or imputation must remain a separate derived-data operation with explicit provenance. This is aligned with open-source weather QA/QC workflows that normalize formats, visualize before/after processing, and make filtering and gap filling visible rather than silent.[10]

### 3.2 Non-goals for the hackathon MVP

The MVP is not a replacement for a national meteorological agency’s official validation process, calibration laboratory, observing-station siting program, or forecast-production system. It will not claim WMO compliance merely because it implements a few plausibility checks. It will not automatically discard extreme weather observations solely because they are rare. It will not train an opaque deep model on a tiny unlabelled dataset and present accuracy without a fault-injection protocol or expert review.

## 4. Users and operating scenarios

| User | Need | Monsoon Sentinel capability |
| --- | --- | --- |
| AWS field technician | Know which station or sensor needs attention | Prioritized incidents, likely root cause, maintenance checklist, last-seen heartbeat, battery and signal status. |
| Data-quality analyst | Review suspicious observations and approve or reject them | Timeline, neighboring stations, rule evidence, model score, raw/processed values, and disposition workflow. |
| Network supervisor | Understand fleet health | Station map, anomaly heatmap, outage clusters, recurring-fault ranking, and SLA trends. |
| Data consumer | Obtain trustworthy observations | API/export with QC state, reason codes, confidence, provenance, and optional derived values. |
| ML engineer | Improve models safely | Label store, versioned features, fault injection, offline evaluation, drift monitoring, and model registry. |

The primary scenario is a station reporting every five or ten minutes. The gateway receives a reading, validates its envelope and timestamp, stores it durably, executes fast checks, and forwards a compact event to the cloud. The cloud enriches it with station context and neighbor data, runs the fleet detector, and creates an incident only when the evidence crosses a persistence and severity policy. An operator can acknowledge the incident, mark it as genuine weather, confirm a sensor fault, or defer the decision.

## 5. Functional requirements

| ID | Requirement | Acceptance criterion for MVP |
| --- | --- | --- |
| F-01 | Ingest observations from CSV, REST, MQTT, or simulator adapters. | A common schema accepts at least temperature, humidity, pressure, wind, rainfall, timestamp, station ID, latitude, and longitude. |
| F-02 | Normalize units and timestamps. | Every record stores original unit, canonical unit, source timestamp, UTC timestamp, and conversion status. |
| F-03 | Preserve raw observations. | Raw payload is immutable and linked to all derived records. |
| F-04 | Run deterministic QC. | Range, missingness, duplicate, freshness, rate-of-change, flatline, and internal-consistency rules produce reason codes. |
| F-05 | Run anomaly models. | MVP includes rolling robust statistics and Isolation Forest or equivalent; an optional LSTM/autoencoder path is evaluated offline. |
| F-06 | Detect spatial anomalies. | The detector compares a station with trusted nearby or correlated peers and excludes suspect peers from the reference set. |
| F-07 | Fuse evidence. | Rule results and model scores produce a calibrated severity, confidence, explanation, and recommended action. |
| F-08 | Support human review. | An operator can acknowledge, assign, comment, accept as genuine, mark bad, or reopen an incident. |
| F-09 | Alert responsibly. | Alerts support dashboard, email/SMS/webhook adapters, deduplication, cooldowns, and escalation. |
| F-10 | Export quality-aware data. | API and CSV export include raw value, QC state, anomaly score, reasons, model version, and review disposition. |
| F-11 | Monitor the detector. | The dashboard reports alert volume, false-positive feedback, missingness, latency, model drift, and station health. |
| F-12 | Work offline at the edge. | Gateway buffers messages and runs core rules during a network outage, then replays them without duplication. |

## 6. Detection philosophy

The detector is a **hybrid ensemble**, not a single algorithm. The sequence is deliberately ordered from inexpensive and interpretable checks to more adaptive models.

First, the system performs data-contract checks: schema, station identity, timestamp, units, duplicate message ID, payload integrity, and freshness. Second, it applies physical and domain rules. These include plausible ranges configured per variable and station, maximum credible rate of change, minimum sensor resolution, stuck-value duration, negative or impossible accumulations, and relationships such as dew point not exceeding air temperature. NOAA MADIS uses this kind of internal consistency logic and documents that a failed relationship can flag one or both related observations depending on the check.[3]

Third, it computes robust temporal features. Examples include rolling median deviation, median absolute deviation score, exponentially weighted residual, slope, volatility, missingness run length, daily-cycle residual, and forecast residual. A rolling median and MAD are preferable to a mean and standard deviation when the series may already contain outliers. Fourth, it performs cross-variable checks, such as humidity–temperature coupling, pressure–altitude plausibility, rainfall–tipping-bucket continuity, solar-radiation daylight consistency, and wind-speed/wind-direction sensor activity.

Fifth, it performs spatial or “buddy” checks. The reference set is chosen using distance, elevation, climate zone, historical correlation, and current trust state. A station should not be accused solely because it differs from a distant coastal or mountainous station. A suspect neighbor must be excluded or down-weighted so that one bad station does not contaminate the fleet baseline. This principle is explicit in the MADIS spatial-QC description.[3]

Finally, the system applies an ML detector. The MVP should start with Isolation Forest on engineered window features because it is easy to train, fast to explain through feature contributions, and suitable for limited labels. A sequence autoencoder or LSTM autoencoder should be treated as a second-stage experiment for stations with adequate normal-history coverage. A 2026 meteorological study found an LSTM autoencoder useful for temporal patterns, but its reported metrics came from one study, one variable, and expert-labelled data; the team must reproduce evaluation locally before making any performance claim.[5]

## 7. Recommended anomaly taxonomy

| Code | Meaning | Typical evidence | Recommended first action |
| --- | --- | --- | --- |
| `COMMUNICATION_GAP` | No observation or heartbeat within expected interval | Missing sequence, stale last-seen, gateway offline | Check power, network, SIM, gateway, and broker. |
| `STALE_VALUE` | Repeated old timestamp or unchanged payload | Timestamp lag, identical message ID, unchanged sequence | Inspect logger and time synchronization. |
| `FLATLINE` | Sensor value remains constant beyond a context-aware duration | Low variance and repeated identical value | Inspect stuck probe, cable, ADC, or frozen process. |
| `SPIKE` | Isolated abrupt excursion | High robust residual and quick return | Review lightning, gust, rain, interference, or cable noise. |
| `DRIFT` | Gradual bias or increasing residual | Persistent deviation against peers or calibration reference | Schedule calibration or cleaning. |
| `RANGE_FAIL` | Value outside configured physical/operational envelope | Deterministic range failure | Verify units, sensor, wiring, and true extreme event. |
| `RATE_FAIL` | Implausible change over interval | Excessive derivative | Check timestamp, sampling, sensor transient, or event context. |
| `INTERNAL_INCONSISTENCY` | Variables violate a known relationship | Dew point above temperature, invalid accumulation, etc. | Review involved sensors and derived calculations. |
| `SPATIAL_OUTLIER` | Station disagrees with trusted neighbors | Buddy residual, peer consensus | Inspect station or validate local micro-weather. |
| `NETWORK_EVENT` | Multiple stations fail together | Shared provider, region, or time cluster | Check broker, power grid, gateway release, or weather event. |
| `GENUINE_EXTREME_CANDIDATE` | Rare but physically coherent event | Multiple variables and neighbors support event | Do not discard; request expert confirmation. |

## 8. Quality states and evidence model

Each observation receives a machine-readable state. The proposed states are `PRELIMINARY`, `ACCEPTED`, `SUSPECT`, `REJECTED`, `MISSING`, and `DERIVED`. The state is separate from the numerical anomaly score. An observation can have a high score but remain `SUSPECT` until reviewed; a deterministic range failure can be `REJECTED` by policy; a genuine extreme can be `ACCEPTED` after review.

Every decision must carry a reason list. A reason contains the check ID, input values, threshold or reference, result, detector version, and timestamp. The operator-facing explanation is generated from these structured reasons using templates, not from unconstrained language generation. This keeps explanations reproducible and auditable.

A confidence score should be calibrated on a validation set containing clean observations and injected faults. The system should report a score such as “0.86 probability of data-quality problem under the current calibration” only when the calibration procedure supports that interpretation. Otherwise, call it an **anomaly score** and avoid presenting it as a probability.

## 9. Innovation portfolio

### 9.1 Weather-aware false-positive suppression

The system introduces a **Weather Event Context Gate**. When multiple physically related variables change coherently and nearby trusted stations show a similar signal, the alert changes from “probable sensor fault” to “genuine extreme candidate.” This directly addresses the central danger of anomaly detection in meteorology: real extremes are rare by definition and can look like outliers.

### 9.2 Sensor fingerprint and self-health profile

Each station receives a learned fingerprint containing normal diurnal behavior, response lag, noise level, missingness pattern, calibration bias, and peer relationships. A temperature sensor with a slowly rising bias is different from a sensor that suddenly flatlines. The fingerprint supports predictive maintenance without requiring a fully labelled fault dataset.

### 9.3 Evidence graph for root-cause reasoning

Instead of a flat alert, the platform maintains an evidence graph: observation → failed checks → affected variables → station-health signals → neighboring evidence → probable cause → recommended action. For example, “humidity high” may be connected to “temperature sensor flatline,” “dew-point relationship failed,” “battery voltage low,” and “no peer support.” This graph is more useful to a field technician than a generic anomaly label.

### 9.4 Federated or privacy-preserving fleet learning as a future path

Stations can learn local normality at the edge, while the cloud aggregates model statistics rather than raw high-frequency data when bandwidth or governance requires it. This is a future-stage innovation, not a claim that federated learning is required for the MVP. The MVP should first prove reliable local inference, evidence logging, and model update controls.

### 9.5 Counterfactual operator assistance

For a confirmed faulty sensor, the system may show a **derived estimate** based on peer interpolation or a local temporal model, but it must label it as derived and never overwrite the raw observation. The operator can compare “reported,” “quality-controlled,” and “estimated” series separately.

## 10. Data and model strategy

The team should begin with a canonical dataset assembled from available AWS/ARG samples, IMD-accessible context data where permitted, and a transparent simulator that injects physically motivated faults into clean sequences. IMD’s API catalogue includes current weather, station-wise nowcast, AWS/ARG, rainfall, warnings, cyclone, radar, and lightning categories; its field reference also documents station identity, UTC observation time, pressure, wind, temperature, humidity, and rainfall fields.[8] Access terms and endpoint behaviour must be verified before using the service in a submission demo.

The synthetic-fault generator should inject one fault at a time and combinations of faults: missing blocks, duplicated timestamps, flatlines, spikes, bias drift, scale/unit errors, sensor swap, delayed sensor, random noise, rainfall undercount, pressure offset, wind-direction wrap errors, and correlated network outages. The open-source meteorological assessment project demonstrates the value of injecting artificial outliers and evaluating confusion matrices, while also exploring Bayesian evidence fusion.[9]

Evaluation must use chronological splits to prevent leakage. The proposed metrics are event-level recall, event-level precision, false alerts per station-day, median detection delay, mean time to acknowledge, calibration error, and percentage of alerts with an accepted explanation. A model that catches every fault by flagging every observation is not successful. The team should publish a per-fault-type confusion matrix and a station-level breakdown.

## 11. Deployment and MVP boundaries

The recommended hackathon demonstration has three layers. A small device or simulator publishes AWS-like JSON over MQTT. An edge service validates, buffers, and runs low-cost checks. A cloud or local server stores time-series observations and incidents, runs the fleet detector, and serves a dashboard. The demo should include a switch that injects faults and a replay mode that lets judges see the system detect a flatline, drift, spatial disagreement, and a coherent genuine extreme candidate.

The preferred MVP stack is Python for detection and APIs, PostgreSQL with a time-series extension or a time-series database for observations, Redis or a message queue for transient jobs, MQTT for telemetry, and a React dashboard for review. The stack can be simplified to SQLite plus a local MQTT broker if setup time is limited. Architecture quality matters more than infrastructure brand names.

## 12. Security, safety, and governance

Device identity must be authenticated. MQTT traffic should use TLS in a real deployment, with per-device credentials or certificates, topic-level authorization, replay protection, payload-size limits, and rate limits. Raw data and operator actions should be append-only or versioned. Secrets must not be committed to the repository. The dashboard must distinguish “automated flag” from “human verified.”

The system should adopt a fail-safe data policy: when the detector is unavailable, raw observations are still stored and marked `PRELIMINARY`; when an input is malformed, it is quarantined with the payload and error; when the model is out of distribution, the system lowers confidence and requests review rather than silently extrapolating.

## 13. Hackathon delivery plan

| Stage | Deliverable | Demonstrable outcome |
| --- | --- | --- |
| Stage 1 | Canonical schema and replayable telemetry simulator | A stream of normal and faulty AWS observations. |
| Stage 2 | Deterministic QC engine | Immediate, explainable flags for missing, range, rate, flatline, and internal consistency issues. |
| Stage 3 | Temporal and spatial features | Per-station baselines and trusted-neighbor comparison. |
| Stage 4 | ML detector and evidence fusion | Anomaly score, confidence band, reason codes, and severity. |
| Stage 5 | Operator dashboard | Map/list of stations, timelines, evidence graph, acknowledge/review workflow. |
| Stage 6 | Evaluation and demo story | Fault-injection report, latency/false-alert metrics, and a resilient offline replay. |

The final pitch should not be “we used deep learning.” It should be: **we protect weather data by combining meteorological rules, adaptive ML, edge resilience, spatial context, and human-auditable decisions.**

## 14. Risks and mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| No labelled faults | Supervised accuracy is unreliable | Use normal-data models, expert review, and fault injection with clear limitations. |
| Extreme weather appears anomalous | The detector may suppress important events | Add multi-variable coherence and neighbor corroboration; route to genuine-extreme review. |
| Sparse station network | Spatial checks become weak | Use station-specific confidence and temporal/contextual evidence. |
| Sensor heterogeneity | One threshold does not fit all stations | Store per-station metadata and configurable profiles. |
| Concept drift | Climate/season/device behaviour changes | Rolling retraining with approval, drift metrics, and model versioning. |
| Network outage | Cloud-only architecture misses incidents | Edge buffering, local rules, replay-safe message IDs, and outage alerts. |
| Alert fatigue | Operators ignore noisy systems | Persistence windows, deduplication, severity policy, and feedback loop. |
| Overclaiming standards | Judges may challenge unsupported compliance | State that the prototype is standards-informed, not certified. |

## 15. Definition of done

The MVP is complete when a judge can start the system, publish a normal station stream, inject at least five fault classes, observe low-latency evidence-based alerts, inspect the raw and derived series, acknowledge and classify an incident, export the quality-aware record, and view an evaluation report. The repository must include setup instructions, a data dictionary, a threat model, a model card, a fault-injection catalogue, and a limitations section.

## References

[1]: https://github.com/OpenSenseAction/pypwsqc "OpenSenseAction/pypwsqc — Python package for quality control of personal weather-station data"
[2]: https://pypwsqc.readthedocs.io/en/latest/ "pypwsqc documentation"
[3]: https://madis.ncep.noaa.gov/madis_RSAS_qc_notes.shtml "NOAA/NCEP MADIS RSAS Quality Control Checks"
[4]: https://library.wmo.int/viewer/68695/ "WMO e-Library, WMO-No. 8 Guide to Instruments and Methods of Observation"
[5]: https://www.cambridge.org/core/journals/environmental-data-science/article/machine-learning-approach-using-autoencoders-to-perform-quality-control-on-meteorological-data/4576781508080877E36C0CA6612E5590 "Spohn et al. 2026, A machine learning approach using autoencoders to perform quality control on meteorological data"
[6]: https://training.weather.gov/nwstc/Hydrology/HYDRO/QCModule/QCConc.HTML "NOAA NWS Training Center, Quality Control Concepts"
[7]: https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/instruments-and-methods-observation-programme-imop/guide-instruments-and-methods-observation-wmo-no-8 "WMO Guide to Instruments and Methods of Observation legacy page"
[8]: https://api.imd.gov.in/public/api_reference.html "India Meteorological Department API Reference"
[9]: https://github.com/tomasfbouvier/Meteorological_Data_quality_assesment "Meteorological_Data_quality_assesment GitHub repository"
[10]: https://github.com/WSWUP/agweather-qaqc "WSWUP/agweather-qaqc GitHub repository"
[11]: https://arxiv.org/html/2606.14712v1 "EdgeStream: Secure and Low-Latency IoT Analytics Using an Edge-Based Streaming Architecture"
[12]: https://github.com/Cyclenerd/iot-weather-mqtt "Cyclenerd/iot-weather-mqtt GitHub repository"
[13]: https://github.com/Sabari231024/PREDICTIVE_MAINTENANCE "Sabari231024/PREDICTIVE_MAINTENANCE GitHub repository"
