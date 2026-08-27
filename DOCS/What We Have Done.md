# What We Have Done
## Smart India Hackathon 2026 — Problem Statement 073

### One-sentence explanation

We designed **Monsoon Sentinel**, a system that watches Automatic Weather Station data, finds suspicious readings or station failures, explains why they are suspicious, and helps a human decide what to do next.

## Why this problem is harder than it looks

A weather reading can be unusual for two very different reasons. It may be a broken sensor, bad wiring, a power problem, a communication delay, or calibration drift. Or it may be a real event such as a storm, heavy rain, strong wind, or sudden pressure change. If we simply delete every unusual value, we may delete the most important weather information.

Our solution therefore asks three questions at the same time: **Does the value look physically possible? Does it fit the station’s recent behaviour and nearby stations? Does the overall pattern look like real weather?** This is why our design combines fixed quality checks, machine learning, neighbouring-station comparison, and human review.

## What files are included

| File | Simple meaning |
| --- | --- |
| `system.md` | The complete product idea: users, problem, features, anomaly types, innovation, MVP, risks, and hackathon plan. |
| `system_design.md` | The engineering blueprint: components, data format, processing flow, database fields, APIs, models, security, testing, and deployment. |
| `skill.md` | A reusable developer guide that tells the team how to build this kind of AWS anomaly-detection system safely and consistently. |
| `what_we_did.md` | This easy-to-read explanation for teammates. |
| `research_notes.md` | The research trail: sources checked, important findings, limitations, and citation links. |
| `skill_validation.txt` | Result of checking that the reusable skill file follows the required structure. |

## The solution in simple words

A station or simulator sends weather readings such as temperature, humidity, pressure, wind, and rainfall. The edge gateway receives the data and can continue working even when the internet is temporarily unavailable. It stores a local copy, runs quick checks, and forwards the reading through MQTT when the connection is available.

The central system stores the original reading safely, converts it into a common format, runs more checks, calculates machine-learning features, compares the station with trusted neighbours, and creates an incident if the evidence is strong enough. The dashboard shows the station, the suspicious variable, the original value, the reason, the confidence or anomaly score, the nearby-station evidence, and the recommended action.

The most important rule is: **we never silently overwrite the original weather observation**. If we estimate a missing or faulty value, that estimate is shown separately as derived data.

## What kinds of problems we detect

| Problem | Example | What the operator may do |
| --- | --- | --- |
| Communication gap | No reading arrives for 20 minutes | Check power, network, SIM, gateway, or broker. |
| Stale value | The timestamp is old or the same message repeats | Check logger clock and duplicate delivery. |
| Flatline | Temperature remains exactly the same for a long time | Inspect stuck sensor, wire, ADC, or frozen software. |
| Spike | One reading jumps and immediately returns | Check interference, lightning, wiring, or a real gust. |
| Drift | A sensor slowly becomes different from nearby trusted stations | Plan cleaning or calibration. |
| Range failure | A value is outside the configured safe range | Check units, sensor, wiring, and whether it is a genuine extreme. |
| Rate failure | A variable changes too quickly for the sensor | Check timestamp, sampling, sensor transient, or event. |
| Internal contradiction | Humidity/temperature relationships do not make sense | Inspect the affected sensors and calculations. |
| Spatial outlier | One station disagrees with trusted nearby stations | Inspect station, but also consider local micro-weather. |
| Genuine extreme candidate | Many variables and nearby stations support a sudden event | Do not delete it; send it for expert confirmation. |

## How the AI/ML part works

The AI is not the only decision-maker. First, normal software checks detect obvious errors. Then we calculate useful features such as recent median, variation, slope, flatline duration, missingness, battery status, and disagreement with nearby stations.

For the first model, we recommend an unlabelled model such as Isolation Forest because it can learn unusual combinations from mostly normal data. If we later obtain enough clean time-series data, we can compare it with a sequence autoencoder or LSTM autoencoder. The final answer is produced by combining rule evidence, temporal model evidence, spatial evidence, station-health evidence, and support for a genuine weather event.

The word **score** is important. Unless we calibrate it properly with reviewed examples, we should call it an anomaly score, not a probability. This avoids making a scientific claim that our data cannot support.

## What is innovative about our idea

The first innovation is the **Weather Event Context Gate**. If several related variables change together and nearby trusted stations see a similar change, the system says “possible genuine weather event” instead of immediately saying “sensor failure.” This protects rare events from being incorrectly removed.

The second innovation is a **station fingerprint**. Each station gradually learns its normal daily pattern, noise level, response behaviour, missingness pattern, peer relationships, and possible bias. This lets us detect gradual degradation rather than only sudden failures.

The third innovation is an **evidence graph**. Instead of showing only a red alert, the system links the alert to failed checks, affected variables, battery or signal data, peer evidence, the likely cause, and the suggested field action.

The fourth innovation is **offline-first operation**. The station gateway can buffer data and run important checks when the internet is down. It synchronizes later without creating duplicate records.

## What the demo should show

The best demo does not rely on a complicated slide. It should be live and visual:

1. Start with a normal stream from a simulator or sensor node.
2. Show the dashboard with healthy station data.
3. Inject a flatline fault into humidity and show the alert.
4. Inject a sudden spike and show the spike explanation.
5. Make one station disagree with its neighbours and show the spatial evidence.
6. Create a coherent storm-like change across several variables and stations; show that it becomes a genuine-extreme candidate instead of an automatic rejection.
7. Disconnect the network, continue publishing locally, reconnect, and show replay without duplicates.
8. Open an incident, acknowledge it, add a technician comment, and export the quality-aware record.

The judges should be able to understand the complete path: **sensor → gateway → QC → ML → explanation → operator action → trustworthy export**.

## Suggested team division

| Team member role | Main responsibility |
| --- | --- |
| Data/ML developer | Feature engineering, Isolation Forest baseline, optional autoencoder experiment, evaluation metrics, model card. |
| Backend developer | Canonical schema, ingestion API, rule engine, evidence fusion, incident lifecycle, storage. |
| Edge/IoT developer | MQTT publisher, gateway buffer, offline replay, device-health fields, fault injection controls. |
| Frontend developer | Station map/list, charts, incident detail, evidence display, review actions, export screen. |
| Product/demo lead | User journey, problem statement alignment, pitch, judge script, screenshots, limitations, and final documentation. |

One person can hold more than one role. The important thing is to define interfaces early so everyone can work in parallel without changing the data contract every day.

## Immediate build order

Start with the common JSON observation format and a simulator. Do not start with the LSTM model. Build the raw storage and deterministic checks next. Then add a timeline chart and a fault-injection switch. After that, add temporal features, trusted-neighbour comparison, Isolation Forest, and evidence fusion. Finish with the review workflow, offline buffer, evaluation report, and pitch.

The MVP should be small but complete. A working end-to-end demo with five clear fault types is more valuable than a large model that cannot be explained or reproduced.

## Important warnings

Do not use random numbers to replace missing weather observations. Do not silently fill gaps. Do not use one threshold for every station. Do not treat every extreme as a bad reading. Do not claim official WMO compliance unless the relevant authority and procedures have been checked. Do not copy public MQTT credentials or archived-broker examples into a real system.

The exact official text of PS 073 should be added to the repository when the team obtains the official SIH workbook. The current documents deliberately identify the title and challenge interpretation as a working basis rather than pretending that an inaccessible workbook row was verified.

## Research basis in plain language

We checked operational QC guidance from NOAA. It separates value validity, time behaviour, relationships between variables, and nearby-station comparison.[1] We checked NOAA training material that explains range, temporal continuity, spatial consistency, and error logs.[2] We checked open-source projects that implement weather-station QC filters, format conversion, before/after review, autoregressive tests, spatial tests, synthetic outlier injection, and evidence fusion.[3] [4] [5] [6] We also checked the public IMD API reference for Indian weather-data categories and fields that may help with context or validation, subject to access and terms.[7]

A recent 2026 study compared autoencoders and reported that an LSTM autoencoder captured temporal patterns well on one expert-reviewed temperature dataset.[8] We use that as a reason to run an experiment, not as a promise that our system will achieve the same result. A recent edge-IoT paper supports the idea of local processing, MQTT, lightweight detection, and cloud coordination, but it is general IoT research rather than AWS-specific proof.[9]

## Final message for the team

Our strongest idea is not “we added AI to weather sensors.” Our strongest idea is: **we make weather observations trustworthy by combining meteorological knowledge, adaptive machine learning, neighbouring-station context, offline resilience, and human-auditable decisions.**

## References

[1]: https://madis.ncep.noaa.gov/madis_RSAS_qc_notes.shtml "NOAA/NCEP MADIS RSAS Quality Control Checks"
[2]: https://training.weather.gov/nwstc/Hydrology/HYDRO/QCModule/QCConc.HTML "NOAA NWS Training Center, Quality Control Concepts"
[3]: https://github.com/OpenSenseAction/pypwsqc "OpenSenseAction/pypwsqc GitHub repository"
[4]: https://pypwsqc.readthedocs.io/en/latest/ "pypwsqc documentation"
[5]: https://github.com/tomasfbouvier/Meteorological_Data_quality_assesment "Meteorological_Data_quality_assesment GitHub repository"
[6]: https://github.com/WSWUP/agweather-qaqc "WSWUP/agweather-qaqc GitHub repository"
[7]: https://api.imd.gov.in/public/api_reference.html "India Meteorological Department API Reference"
[8]: https://www.cambridge.org/core/journals/environmental-data-science/article/machine-learning-approach-using-autoencoders-to-perform-quality-control-on-meteorological-data/4576781508080877E36C0CA6612E5590 "Spohn et al. 2026, autoencoders for meteorological quality control"
[9]: https://arxiv.org/html/2606.14712v1 "EdgeStream: Secure and Low-Latency IoT Analytics Using an Edge-Based Streaming Architecture"
