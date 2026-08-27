# Research Notes

## Verified sources

1. **OpenSenseAction/pypwsqc GitHub repository** — https://github.com/OpenSenseAction/pypwsqc
   - Public Python package for quality control of personal weather-station data.
   - Its stated goal is a unified implementation of QC methods from PWSQC (R) and pws-pyqc (Python).
   - Repository structure includes source code, tests, documentation, CI, and a BSD-3-Clause license.
   - GitHub page showed 124 commits, 5 branches, 5 tags, and latest commit dated 19 May 2026 at the time of research.
   - Reusable lesson: implement QC as testable, modular filters instead of treating anomaly detection as one opaque model.
   - Important limitation: this is for personal weather stations, not a complete operational AWS platform; methods require adaptation, calibration, and governance for official observations.

2. **pypwsqc documentation** — https://pypwsqc.readthedocs.io/en/latest/
   - Documentation exposes examples for Faulty Zeroes Filter, High Influx Filter, Station Outlier Filter, Bias Correction, Indicator Correlation Filter, and Peak Removal Filter.
   - Reusable lesson: a practical pipeline should combine temporal persistence checks, influx/rate-of-change checks, cross-station/spatial checks, bias correction, inter-variable correlation, and peak/spike handling.

## Research implications

A credible AWS anomaly-detection system should use layered quality control: hard physical/range checks, temporal continuity and persistence checks, cross-variable consistency, spatial/neighbor comparison, and an ML detector. Every observation should retain raw value, processed value, QC flags, anomaly score, reason codes, model version, and operator disposition. The model should assist rather than silently overwrite official observations.

## Provenance note

Search snippets and page extracts were used only to identify sources; the cited repository and documentation pages were opened and read. The exact official SIH workbook was discoverable at https://www.sih.gov.in/letters/problemStatements.xlsx but returned HTTP 403 when downloaded from the sandbox, so its exact row text remains to be verified from an accessible copy or user-provided statement. Until then, documents must distinguish confirmed facts from solution assumptions.

---

## Citation key for later documents

Use these as [1] and [2] respectively:

[1]: https://github.com/OpenSenseAction/pypwsqc "OpenSenseAction/pypwsqc — Python package for quality control of personal weather-station data"
[2]: https://pypwsqc.readthedocs.io/en/latest/ "pypwsqc documentation"


## Additional verified sources

3. **NOAA/NCEP MADIS RSAS Quality Control Checks** — https://madis.ncep.noaa.gov/madis_RSAS_qc_notes.shtml
   - Validity checks constrain each observation to a set of tolerance limits.
   - Temporal consistency checks constrain the rate of change over time.
   - Internal consistency checks enforce meteorological relationships measured at one station; the page gives dew point not exceeding air temperature as an example.
   - Spatial consistency, or buddy checking, compares observations with a neighborhood analysis and can identify the target observation versus a bad neighbor.
   - The system distinguishes preliminary, coarse-pass, screened, verified, erroneous, questionable, and subjective good/bad states.
   - Reusable lesson: quality states and reason codes should be first-class outputs, and spatial checking must avoid propagating suspect neighbors.

4. **WMO Guide to Instruments and Methods of Observation landing page** — the previously indexed URL returned a 404 after the WMO site migration: https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/instruments-and-methods-observation-programme-imop/guide-instruments-and-methods-observation-wmo-no-8
   - The source is not cited for detailed claims until a current WMO URL is verified.
   - Reusable design assumption, to be validated against the current WMO guide: AWS solution quality depends on instrument metadata, siting, calibration, maintenance, and observing-system procedures in addition to ML.

## Additional citation key

[3]: https://madis.ncep.noaa.gov/madis_RSAS_qc_notes.shtml "NOAA/NCEP MADIS RSAS Quality Control Checks"
[4]: https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/instruments-and-methods-observation-programme-imop/guide-instruments-and-methods-observation-wmo-no-8 "WMO Guide to Instruments and Methods of Observation landing page (legacy URL; 404 at research time)"

## Recent ML and operational QC findings

5. **Spohn et al., Environmental Data Science (Cambridge University Press, 2026)** — https://www.cambridge.org/core/journals/environmental-data-science/article/machine-learning-approach-using-autoencoders-to-perform-quality-control-on-meteorological-data/4576781508080877E36C0CA6612E5590
   - Open-access application paper comparing autoencoder, variational autoencoder, and LSTM autoencoder for air-temperature anomaly detection.
   - The abstract reports that LSTM performed best among the compared models because it captured temporal patterns and reduced false positives; on raw data, the study reports 99.6% accuracy for identifying valid observations and replicated 79% of manual flags over one year, with five false negatives and six false positives.
   - The work used expert-quality-controlled data as ground truth, a three-day timestep, and basic QC checks in SaQC; it explicitly suggests expansion to additional variables and multi-station generalization.
   - Reusable lesson: use ML as a complement to basic QC, evaluate against expert labels, and prefer temporal models only after establishing strong baselines. Do not transfer the reported metrics directly to Indian AWS data without local validation.

6. **NOAA National Weather Service Training Center, Quality Control Concepts** — https://training.weather.gov/nwstc/Hydrology/HYDRO/QCModule/QCConc.HTML
   - Range checks test plausibility of each value independently.
   - Temporal continuity checks examine time-series behavior for discrepancies.
   - Horizontal spatial consistency checks compare nearby observations and can reveal station outliers or long-term site/equipment problems.
   - Error logs support handoffs, spotting inconsistencies, minimal-effort correction, management visibility, and investigation of recurring/intermittent issues.
   - Reusable lesson: include an operator-facing error log, not merely an alert stream, and retain the distinction between anomaly detection and correction.

## Citation key

[5]: https://www.cambridge.org/core/journals/environmental-data-science/article/machine-learning-approach-using-autoencoders-to-perform-quality-control-on-meteorological-data/4576781508080877E36C0CA6612E5590 "Spohn et al. 2026, A machine learning approach using autoencoders to perform quality control on meteorological data"
[6]: https://training.weather.gov/nwstc/Hydrology/HYDRO/QCModule/QCConc.HTML "NOAA NWS Training Center, Quality Control Concepts"

## Indian data and international standards context

7. **WMO e-Library — WMO-No. 8** — https://library.wmo.int/viewer/68695/
   - Search indexing identifies this as the current WMO-No. 8 publication page, whose contents include Automated Weather Observing System material and a chapter on measurements at automatic weather stations.
   - The page presented a human-verification slider in the browser, so detailed publication text was not extracted. Cite it for publication identity and standards context, not for unverified parameter values.

8. **India Meteorological Department API Reference** — https://api.imd.gov.in/public/api_reference.html
   - IMD publishes a public API catalog with current weather, station-wise nowcast, AWS/ARG data, rainfall, warnings, cyclone, radar, lightning, and agromet categories.
   - The current-weather field reference includes station ID/name, observation date/time in UTC, mean sea-level pressure, wind direction code, wind speed in km/h, temperature, weather code, nebulosity, humidity, and last-24-hour rainfall.
   - The API documentation also provides city/station mapping and latitude/longitude in some endpoints.
   - Reusable lesson: design adapters around station identity, UTC timestamps, units, variable metadata, and source provenance; use external products as contextual evidence or validation signals only after checking licensing, access, and temporal/spatial alignment.

## Citation key

[7]: https://library.wmo.int/viewer/68695/ "WMO e-Library, WMO-No. 8 Guide to Instruments and Methods of Observation"
[8]: https://api.imd.gov.in/public/api_reference.html "India Meteorological Department API Reference"

## Open-source comparison findings

9. **Meteorological_Data_quality_assesment** — https://github.com/tomasfbouvier/Meteorological_Data_quality_assesment
   - Open-source Python QC system under development.
   - Implements time consistency with autoregressive residuals, space consistency with buddy checks and TITANLIB/SCT-related methods, space-time consistency using cross-correlation and KDE, and a planned model-consistency test.
   - Benchmarks tests by injecting artificial outliers, calculating confusion matrices, and tuning hyperparameters with Bayesian optimization.
   - Merges multiple test results through a Bayesian update to estimate the posterior probability that an observation is bad.
   - Reusable lesson: create a synthetic-fault injector and a probabilistic evidence fusion layer; however, treat the repository as a research prototype and audit dependencies/licensing before reuse.

10. **WSWUP/agweather-qaqc** — https://github.com/WSWUP/agweather-qaqc
   - Command-line workflow for visualization, review, and QA/QC of daily agricultural weather data.
   - Supports input normalization and unit conversion through configuration, merging multiple network formats, before/after interactive visualization, manual and automatic filtering, statistics-based issue identification, and optional gap filling.
   - Reusable lesson: build a canonical schema and unit-normalization layer, provide before/after views, and keep gap filling explicitly optional and traceable. Its daily/agricultural focus is not a direct operational real-time AWS solution.

## Citation key

[9]: https://github.com/tomasfbouvier/Meteorological_Data_quality_assesment "Meteorological_Data_quality_assesment GitHub repository"
[10]: https://github.com/WSWUP/agweather-qaqc "WSWUP/agweather-qaqc GitHub repository"

## Edge and streaming architecture findings

11. **EdgeStream: Secure and Low-Latency IoT Analytics Using an Edge-Based Streaming Architecture** — https://arxiv.org/html/2606.14712v1
   - Describes an edge-plus-cloud architecture in which devices stream through MQTT to edge nodes that perform local filtering, aggregation, analytics, and lightweight anomaly detection, while the cloud handles coordination and long-term storage.
   - The paper emphasizes reducing round-trip latency, bandwidth, and energy by acting close to the source and forwarding summarized or relevant data.
   - Its example edge detector uses z-score normalization because it is computationally efficient for constrained devices.
   - Reusable lesson: for AWS, run deterministic QC and a small statistical detector at the station gateway, while using the server for fleet-level models, historical analytics, dashboards, and model lifecycle management.
   - Limitation: this is a general IoT architecture preprint, not a meteorological benchmark; any reported performance should not be claimed for AWS.

## Citation key

[11]: https://arxiv.org/html/2606.14712v1 "EdgeStream: Secure and Low-Latency IoT Analytics Using an Edge-Based Streaming Architecture"

## Practical prototype findings

12. **Cyclenerd/iot-weather-mqtt** — https://github.com/Cyclenerd/iot-weather-mqtt
   - Archived GitHub example using ESP8266, DHT22, JSON payloads, and MQTT; the README shows device, Wi-Fi, broker, topic, and LED connectivity concepts.
   - It is useful as a minimal telemetry demo but is archived, old, and not an operational AWS reference. Its public example broker and unencrypted/simple credentials pattern must not be copied into production.

13. **Sabari231024/PREDICTIVE_MAINTENANCE** — https://github.com/Sabari231024/PREDICTIVE_MAINTENANCE
   - Demonstrates environmental IoT monitoring with ESP8266/DHT11, MQTT, a Flask backend, MySQL, rolling Z-score anomaly detection, ARIMA prediction, SSE visualization, and encrypted anomaly notifications.
   - Reusable lesson: a hackathon demo can show a complete path from node to broker to backend/database/dashboard, but should keep the model and data contracts modular.
   - Critical limitations: it is a small two-commit project, uses online weather comparison and imputation shortcuts, and its README says a broker and backend must run separately. Never replace missing observations with random values or silently impute official data; mark them missing and expose any imputation as derived data.

## Citation key

[12]: https://github.com/Cyclenerd/iot-weather-mqtt "Cyclenerd/iot-weather-mqtt GitHub repository"
[13]: https://github.com/Sabari231024/PREDICTIVE_MAINTENANCE "Sabari231024/PREDICTIVE_MAINTENANCE GitHub repository"
