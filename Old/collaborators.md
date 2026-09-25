# Team Collaborators & Responsibilities — SkyGuard-AI

## Member 1 — Station metadata, schema & data contract

The station registry must store station location, state, district, region, elevation, sensor types, sampling interval, and calibration information. Member 1 will also implement duplicate-safe event IDs and basic data validation before the data reaches the rest of the system.

**Dependencies:** The team must agree on the data contract before implementation.
**Handoff:** Share `observation_schema.json`, sample payloads, station-profile examples, and ingestion instructions.

## Member 2 — Rule-based quality control

Member 2 will implement the deterministic checks that work even when the ML model is unavailable. These include missing readings, stale timestamps, duplicate messages, invalid units, physical range failures, excessive rate of change, flatlines, rainfall-counter resets, and cross-variable checks such as temperature and humidity consistency.

Every rule must return a reason code, observed value, reference threshold or comparison, pass/fail result, and rule version. The member should write unit tests for normal values, boundary values, missing values, and faulty values.

**Dependencies:** Needs the canonical schema from Member 1.
**Handoff:** Share the QC function interface, rule configuration, reason-code list, and test results.

## Member 3 — Machine-learning model and synthetic faults

Member 3 will prepare temporal and multivariate features such as rolling median, MAD score, slope, volatility, flatline duration, missingness, and rule-failure counts. The first model should be a simple and explainable baseline such as Isolation Forest or a robust statistical detector.

This member will create artificial faults by injecting spikes, drift, flatlines, missing blocks, calibration offsets, unit errors, duplicated data, delayed messages, noise, and communication failures into real or replayed clean sequences. Synthetic faults must be used for testing and threshold tuning, not as the only source of truth.

The member will report event precision, event recall, false alerts per station-day, detection delay, and a per-fault-type confusion matrix. An optional LSTM or autoencoder can be explored only after the baseline is working.

**Dependencies:** Needs normalized data from Member 1 and rule outputs from Member 2.
**Handoff:** Share the feature pipeline, model file, inference interface, fault-injection script, and model card.

## Member 4 — Regional and nearby-station intelligence

Member 4 will implement the logic that makes the system location-aware. Stations will be grouped using coordinates, region, elevation, climate characteristics, and historical similarity. For each station, the module will select trusted nearby stations using distance, time alignment, health status, and historical correlation.

This member will also implement the station-specific baseline. A new station will initially use global and regional knowledge. As clean data accumulates, the system will learn the station’s own normal daily and seasonal behaviour.

A station marked `SUSPECT` or `REJECTED` must not be used as a trusted reference. The output should include peer count, peer median, disagreement score, included peer IDs, and excluded peer IDs.

**Dependencies:** Needs station metadata from Member 1 and quality states from Member 2 or Member 5.
**Handoff:** Share regional-grouping logic, trusted-peer selector, station-profile format, and spatial comparison API.

## Member 5 — Backend, database, and alerts

Member 5 will design the storage for raw payloads, canonical observations, rule results, model results, incidents, operator comments, and review labels. Raw observations must remain unchanged. Derived or corrected values must be stored separately.

This member will implement the evidence-fusion layer that combines rule severity, model score, spatial disagreement, station-health risk, and genuine-weather support. The backend will expose APIs for station timelines, incident details, operator acknowledgement, review, comments, and quality-aware export.

The incident workflow should support `open`, `acknowledged`, `assigned`, `resolved`, `dismissed`, and `reopened`. Alerts must be deduplicated and should not create repeated notifications for the same continuing problem.

**Dependencies:** Needs outputs from Members 1–4.
**Handoff:** Share database schema, API documentation, evidence-fusion policy, alert logic, and integration-test results.

## Member 6 — Frontend, integration, and demo

Member 6 will build the dashboard shown in the frontend mockup. The dashboard should include station health cards, an India or regional station map, priority incidents, station timelines, anomaly scores, evidence summaries, recommended actions, and review buttons.

This member will connect the frontend to the backend, verify that every alert can be opened and explained, and prepare the final demo. The demo should show a normal stream, a flatline, a spike, a spatial outlier, a genuine-extreme candidate, a network outage, and operator review.

Member 6 also owns final integration checks, screenshots, the judge journey, and the short explanation of why the system is different from a simple threshold detector.

**Dependencies:** Needs stable APIs and sample data from Members 1–5.
**Handoff:** Share the integrated dashboard, demo script, screenshots, and final bug list.

## Common responsibilities for everyone

Each member must write a short README for their module, add tests for their main functionality, use the agreed data contract, and clearly document assumptions and limitations. No member should silently change the schema or rename a reason code without informing the team.

All members should use Git branches and pull requests. A pull request should explain what changed, how it was tested, and whether another module is affected. Secrets, passwords, API keys, and private datasets must never be committed.

## Integration milestones

| Milestone | Expected result | Members involved |
| --- | --- | --- |
| M1 — Contract ready | Sample station profile and canonical observation payload are approved. | All members, led by Member 1. |
| M2 — Data flowing | Simulator or sensor publishes data and the platform stores it. | Members 1 and 5. |
| M3 — Rules working | Basic faults create explainable rule results. | Members 1 and 2. |
| M4 — Intelligence working | ML score, station baseline, and nearby-station comparison are available. | Members 3 and 4. |
| M5 — Incident workflow | Evidence is fused into an incident that can be reviewed. | Members 2–5. |
| M6 — Dashboard working | The team can see, understand, and review incidents. | Members 5 and 6. |
| M7 — Final demo | Fault injection, offline replay, evaluation, and presentation are ready. | All members. |

## Rules for equal contribution

Each member owns one production module, one documented interface, one test suite, and one part of the final demonstration. No module is considered complete until it can be run by another teammate using the written instructions.

Members should review one other person’s work so that no part of the system depends on only one person. Suggested review pairs are Member 1 with Member 2, Member 3 with Member 4, and Member 5 with Member 6. If one member finishes early, they should help with integration tests, documentation, or demo reliability rather than creating an unrelated feature.

## Final demo story

The team should present the system in this order: a station sends normal readings; one sensor develops a flatline; the platform explains the problem; another station produces a sudden unusual value; nearby trusted stations and weather context help decide whether it is a fault or a genuine event; the network is disconnected; the edge buffer continues collecting data; the network returns; data is replayed without duplicates; finally, a teammate reviews and classifies the incident.

The central message is:

> **One common platform manages many stations, while every station receives a personalized normal profile supported by shared learning, trusted nearby stations, and explainable quality checks.**
