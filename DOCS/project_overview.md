# SkyGuard-AI — Project Technical Dossier & Architecture Specification

> **Platform Name:** SkyGuard-AI  
> **Domain:** AI/ML-Based Intelligent Anomaly Detection for Automatic Weather Stations (AWS)  
> **Target Deployment:** Surface Meteorological Observation Networks, Environmental Monitoring, Agro-Climatic Sensor Grids  
> **Document Version:** 2.0.0 (Post-Audit Verified)  

---

## 1. Executive Summary & Core Value Proposition

**SkyGuard-AI** is a station-adaptive and spatially intelligent telemetry validation platform designed for Automatic Weather Stations (AWS). It solves the fundamental dilemma in surface meteorological observation: **distinguishing genuine extreme weather events (such as convective squall lines, cloudbursts, and heatwaves) from localized hardware malfunctions (sensor drift, flatlining, power degradation, or calibration offset).**

### The Core Operating Hypothesis
```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           CURRENT TELEMETRY                             │
│                      (Temperature, Humidity, Pressure,                 │
│                       Wind Speed, Rainfall, Battery)                   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
    [Track 1: Station-Adaptive ML]           [Track 2: Spatial Intelligence]
        "Is this observation                    "Is this observation
      unusual for THIS station's             consistent with peer stations
        historical microclimate?"               within geographic radius?"
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     ▼
                      [Track 3: Physical QC Guardrails]
                         "Does it breach thermodynamic
                           and hardware constraints?"
                                     │
                                     ▼
                    [Multi-Signal Evidence Fusion Engine]
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
      NORMAL                  REGIONAL EVENT             LOCALIZED ANOMALY
(Aligned with history       (Atmospheric excursion       (Excursion isolated to
 and spatial peers)        confirmed across peers)       this station: SENSOR FAULT)
```

Traditional anomaly detection systems typically commit one of two fatal architectural errors:
1. **Universal Model Trap:** Training a single "global" model across all stations, causing mountain stations (low pressure, high rain) to constantly flag false positives, while desensitizing lowland stations to severe anomalies.
2. **Context-Blind Outlier Detection:** Flagging every statistical outlier as a defect, which inadvertently discards the most scientifically valuable data points—genuine extreme weather phenomena.

SkyGuard-AI resolves both issues by enforcing **Station Model Isolation** paired with a **Geodetic Spatial Consensus Layer**.

---

## 2. Why Station-Adaptive ML + Spatial Intelligence?

India and global landmasses encompass radically diverse microclimates within single administrative zones:
* **High Altitude / Rainforest (e.g., Cherrapunji):** Elevation $\sim 1,313\,\text{m}$, nominal barometric pressure $\sim 870\,\text{hPa}$, sustained monsoon humidity $>95\%$, and torrential rain $>50\,\text{mm/hr}$.
* **Coastal Maritime (e.g., Mumbai, Udupi):** High sea breeze, compressed diurnal temperature swings, and sustained marine salinity.
* **Semi-Arid Continental (e.g., Belagavi, Hyderabad):** Sharp $15^\circ\text{C}$ diurnal temperature oscillations, lower humidity, and sudden pre-monsoon convective squalls.

### The "Zero Universal Models" Principle
SkyGuard-AI operates on the principle that **no single universal machine learning model can accurately govern diverse geographical nodes**.
* The platform initializes in a clean cold-start state.
* Each station provisions its own dedicated machine learning instance trained exclusively on its localized historical baseline.
* Station $A$ never performs inference using the model weights, normalizations, or dynamic thresholds of Station $B$.

### The Spatial Consensus Hypothesis
A station-specific model alone cannot determine if a sudden $8^\circ\text{C}$ temperature drop is an instrument thermistor failure or a severe thunderstorm gust front. SkyGuard-AI queries fresh telemetry from neighboring stations within a configurable geodetic radius ($10-200\,\text{km}$) using the Haversine formula and Median Absolute Deviation (MAD).
* If nearby stations **concur** with the drop $\rightarrow$ **Regional Weather Event**.
* If nearby stations **remain nominal** $\rightarrow$ **Localized Sensor Malfunction**.

---

## 3. System Architecture & Tri-Track Detection Engine

SkyGuard-AI processes incoming meteorological telemetry through three concurrent validation tracks before reaching final adjudication:

```text
                               RAW SENSOR INGESTION
                                        │
    ┌───────────────────────────────────┼───────────────────────────────────┐
    ▼                                   ▼                                   ▼
[TRACK 1: PHYSICAL QC]        [TRACK 2: STATION ML]              [TRACK 3: SPATIAL CONSENSUS]
• Hard Physical Bounds         • Station Model Dispatch           • Haversine Distance (R=6371km)
• 10-Min Rate of Change        • Feature Engineering (8-D)        • Freshness Gating (<= 300s)
• Stuck / Flatline Detector    • Unsupervised Isolation Trees     • Sanity Filtering (-999 drop)
• Psychrometric Dew Point      • Dynamic 95th %ile Threshold      • Robust Median & MAD Residuals
• Battery ADC Health Check     • Anomaly Score Calibration        • Peer Anomaly Ratio
    │                                   │                                   │
    └───────────────────────────────────┼───────────────────────────────────┘
                                        ▼
                      [MULTI-SIGNAL EVIDENCE FUSION FORMULA]
          FaultRisk = 0.35*(Rule) + 0.25*(ML) + 0.25*(Spatial) + 0.15*(Health)
                                        │
                                        ▼
                      [SEVERE STORM COHERENCE BYPASS GATE]
                       (Rain > 30mm & Hum > 85% & Wind > 30km/h)
                                        │
                                        ▼
                         [FINAL QUALITY STATE & ACTION]
                 ACCEPTED │ GENUINE EXTREME │ SUSPECT │ CRITICAL
```

### Track 1: Deterministic Physical & Health Guardrails
Deterministic thermodynamic equations and physical envelope rules act as an immutable barrier:
1. **Range Envelope:** Verifies physical boundaries ($T \in [-20, 55]^\circ\text{C}$, $\text{RH} \in [5, 100]\%$, $P \in [800, 1080]\,\text{hPa}$).
2. **Rate of Change (Step Test):** Flags single-cycle excursions exceeding physical acceleration limits ($\Delta T > 3.5^\circ\text{C} / 10\,\text{min}$).
3. **Flatline / Stuck ADC:** Flags frozen sensors where readings remain identical across $\ge 6$ consecutive observation cycles.
4. **Cross-Sensor Psychrometric Consistency:** Verifies that dry-bulb temperature exceeds the computed dew point ($T \ge T_d$). Computed via the Magnus-Tetens approximation:
   $$T_d \approx T - \frac{100 - \text{RH}}{5}$$
5. **Datalogger Power Health:** Evaluates supply voltage ($V_{\text{bat}} < 11.8\,\text{V}$ indicates analog-to-digital converter signal degradation) and cellular signal ($RSSI < -95\,\text{dBm}$).

### Track 2: Station-Adaptive Machine Learning Pipeline
* **Algorithm:** Unsupervised Isolation Forest Ensemble ($40-50$ isolation trees, subsample size $128$).
* **Mathematical Basis:** Measures anomaly score via average binary search path depth:
  $$c(n) = 2 \left(\ln(n - 1) + 0.5772156649\right) - \frac{2(n - 1)}{n}$$
  $$\text{Score}(x) = 2^{-\frac{\mathbb{E}(h(x))}{c(n)}}$$
* **Feature Vector (8 Dimensions):**
  1. `temperature_norm`: Normalized local temperature $(T - \mu_T) / \sigma_T$
  2. `humidity_norm`: Normalized local relative humidity $(H - \mu_H) / \sigma_H$
  3. `pressure_norm`: Normalized local barometric pressure $(P - \mu_P) / \sigma_P$
  4. `wind_speed_norm`: Normalized local wind speed $(W - \mu_W) / \sigma_W$
  5. `temp_diff_lag`: Rate-of-change delta $(T_t - T_{t-1}) / \sigma_T$
  6. `diurnal_hour_sin`: Solar cycle diurnal representation $\sin(2\pi \cdot \text{hour} / 24)$
  7. `diurnal_hour_cos`: Solar cycle diurnal representation $\cos(2\pi \cdot \text{hour} / 24)$
  8. `dew_point_depr_norm`: Psychrometric dew point depression $(T - T_d) / 10.0$
* **Dynamic Calibration:** Rather than using arbitrary thresholds, each station sets its threshold $\theta$ to the **95th percentile score** of its validated historical baseline.

### Track 3: Geodetic Spatial Peer Consensus
1. **Great-Circle Distance:** Calculates distances using the Haversine formula across Earth's mean radius ($R = 6,371\,\text{km}$):
   $$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)$$
   $$d = 2R \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$
2. **Temporal Freshness Screening:** Excludes stations whose last transmission is older than 300 seconds.
3. **Corrupted Peer Screening:** Removes neighbor stations reporting error flags (e.g., $-999$) to prevent outlier poisoning.
4. **Robust Statistics:** Replaces vulnerable parametric metrics (mean/variance) with Median and Median Absolute Deviation (MAD):
   $$\text{MAD} = \text{median}\left(|x_i - \text{median}(X)|\right)$$
5. **Spatial Deviation Score:** Computes normalized residuals:
   $$\text{SpatialScore} = 0.55 \cdot \min\left(1.0, \frac{|T - \text{Med}_T|}{5.0}\right) + 0.25 \cdot \min\left(1.0, \frac{|H - \text{Med}_H|}{25.0}\right) + 0.20 \cdot \min\left(1.0, \frac{|P - \text{Med}_P|}{6.0}\right)$$

---

## 4. Multi-Signal Evidence Fusion Matrix

The system aggregates all three tracks into a composite **Fault Risk Score** and maps it through a deterministic policy engine:

$$\text{FaultRisk} = 0.35 \cdot \text{RuleScore} + 0.25 \cdot \text{ModelScore} + 0.25 \cdot \text{SpatialScore} + 0.15 \cdot \text{HealthScore}$$

### Operational Decision Matrix

| Physical QC | Local Station ML | Peer Consensus (Spatial) | Final Classification | Quality State | Operational Interpretation |
| :---: | :---: | :---: | :---: | :---: | :--- |
| **Range Breach** | Any | Any | `PHYSICAL_SENSOR_FAILURE` | **SUSPECT (Critical)** | Raw value breached physical thermodynamic limits. Sensor dead or wire shorted. |
| **Nominal** | **Nominal** ($s < \theta$) | **Consistent** ($\text{res} \le 3^\circ\text{C}$) | `NORMAL` | **ACCEPTED** | Sensor reading aligns with both station history and peer neighborhood. |
| **Nominal** | **Anomaly** ($s \ge \theta$) | **Consistent** or Peers Abnormal | `REGIONAL_EVENT` | **GENUINE_EXTREME** | Local excursion corroborated by peer stations. Valid storm, squall, or front. |
| **Nominal** | **Anomaly** ($s \ge \theta$) | **Divergent** (Peers Normal) | `LOCALIZED_ANOMALY` | **SUSPECT (High)** | Excursion isolated to this station. Probable sensor drift, solar shield defect, or debris. |
| **Nominal** | **Nominal** ($s < \theta$) | **Divergent** | `MICROCLIMATE_GRADIENT` | **ACCEPTED (Review)** | Station is normal for its history, but diverges from peers (elevation / valley effect). |
| **Nominal** | Any | **Zero Peers in Radius** | `LOCAL_ML_ONLY` | **ACCEPTED / SUSPECT** | Remote or isolated station. Operates autonomously without spatial corroboration. |

---

## 5. Software & Interface Implementation

SkyGuard-AI is implemented across two technical tiers:

### 1. Python Algorithmic & Test Engine (`ml/`)
* **`station_adaptive_pipeline.py`:** Pure-Python implementation of the station-adaptive Isolation Forest, feature transformer, model serializer, and real-time scorer. Requires zero third-party dependencies for maximum portability on field hardware.
* **`spatial_engine.py`:** Haversine neighborhood discovery, temporal gating, MAD statistical calculator, and multi-signal fusion classifier.
* **`test_spatial_intelligence.py`:** 8-scenario automated test suite verifying cold start, peer consensus, localized spikes, regional storm validation, stale peer rejection, corrupt peer rejection, and elevation context.
* **`test_station_isolation.py`:** 6-scenario automated test suite verifying cold-start safety gates, sample-size barriers ($<20$ rows blocked), and mathematical isolation between distinct microclimate models.

### 2. Tactical Operations Command Center (`src/`)
Built with React 18 and Vite, featuring a Cyberpunk Tactical Cockpit design:
* **Command Center (`CommandCenter.jsx`):** Fleet-wide operational status, open incidents, and network-level health metrics.
* **Fleet Radar Map (`FleetMap.jsx`):** Interactive GIS Leaflet map displaying stations, real-time status rings, configurable geodetic neighbor radii ($10-200\,\text{km}$), and dynamic distance vectors to peer stations.
* **Station HUD Cockpit (`StationHUD.jsx`):** Real-time animated gauges, dual-axis telemetry trend charts (Chart.js), dedicated model fingerprint badges, live spatial residual breakdowns, and audio alert dispatches.
* **Station Training Studio (`StationUpload.jsx`):** In-browser dataset ingestion, sanity scrubbing, feature generation, Isolation Forest training, and instant model deployment.
* **MLOps Model Governance (`ModelGovernance.jsx`):** Model cards with training summaries, normalization baselines, version history, hot model rollback, and JSON export.
* **Fault Injection Lab (`FaultLab.jsx`):** Real-time synthetic fault injection (sensor spikes, gradual drift, frozen flatlines, power degradation, and severe multi-sensor storm signatures) for live verification.
* **Incident Adjudication (`Incidents.jsx`):** Queue of flagged anomalies with human-readable evidence summaries, recommended field maintenance actions, and operator adjudication logs (`CONFIRM GENUINE` vs `REJECT SENSOR`).
* **Station Credentials & RBAC (`StationCredentials.jsx`):** Role-based access control separating Central Fleet Administrators from Local Station Field Operators.

---

## 6. Dataset Capabilities & Real-World Weather Archives

The project workspace includes 20 regional historical climate archives in `Datasets/` covering critical meteorological districts in Karnataka, India:
* **Districts:** Bengaluru Urban, Belagavi, Dakshina Kannada (Mangalore coastal), Mysore, and Udupi.
* **Coverage:** 2024 through 2025 across seasonal transitions (Jan–June, July–Dec monsoon cycles).
* **Format:** High-resolution NetCDF (`.nc`) gridded reanalysis / observation streams capturing instantaneous and accumulated atmospheric parameters.

---

## 7. Technical Verification & Test Results

The underlying core logic has been strictly validated via automated test executions:

```text
===========================================================================
SKYGUARD-AI: NEARBY STATION SPATIAL INTELLIGENCE VERIFICATION SUITE
===========================================================================
[TEST 1] Isolated station with NO nearby peers      -> PASSED (Safe autonomous operation)
[TEST 2] Nearby stations agree (45°C vs 44-46°C)     -> PASSED (Residual: 0.0°C, Consistent)
[TEST 3] Target differs strongly (48°C vs 30-32°C)   -> PASSED (Residual: 17.0°C, Dev: 0.99)
[TEST 4] Regional Weather Event (Heatwave/Storm)     -> PASSED (Classified: REGIONAL_EVENT)
[TEST 5] Localized Anomaly (Isolated spike)          -> PASSED (Classified: LOCALIZED_ANOMALY)
[TEST 6] Stale peer exclusion (> 300s old)           -> PASSED (Stale datalogger excluded)
[TEST 7] Corrupt peer exclusion (-999 hardware flag) -> PASSED (Corrupt peer purged)
[TEST 8] Elevation Difference Context (Lapse delta)  -> PASSED (Altitude tagged for context)
===========================================================================
ALL 8 SPATIAL INTELLIGENCE TESTS PASSED (100% SUCCESS)
===========================================================================
```

```text
===========================================================================
SKYGUARD-AI: STATION-ADAPTIVE MODEL ISOLATION VERIFICATION SUITE
===========================================================================
[TEST 1] Zero Pre-Trained Model Cold-Start          -> PASSED (Defaults to RULES_ONLY)
[TEST 2] Insufficient Data Rejection Gatekeeper     -> PASSED (< 20 rows blocked)
[TEST 3] Station A Training (Hyderabad Semi-Arid)   -> PASSED (Model A created)
[TEST 4] Station B Training (Cherrapunji Mountain)  -> PASSED (Model B created)
[TEST 5] Model Isolation Proof (Model A != Model B) -> PASSED (Unique weights & splits)
[TEST 6] Microclimate Discrimination & Scoring      -> PASSED (Isolated scoring validated)
===========================================================================
ALL 6 ISOLATION TESTS PASSED (100% SUCCESS)
===========================================================================
```

---

## 8. Production Evolution Roadmap

To transition from the current hackathon verification prototype to an enterprise-grade meteorological deployment, the target production roadmap is defined as follows:

```text
PROTOTYPE STATE                          TARGET PRODUCTION ARCHITECTURE
┌─────────────────────────┐              ┌─────────────────────────┐
│ In-Memory Client State  │              │ FastAPI Backend Service │
│ (React Context / Vite)  │              │ (Asynchronous REST API) │
└───────────┬─────────────┘              └───────────┬─────────────┘
            │                                        │
            ▼                                        ▼
┌─────────────────────────┐              ┌─────────────────────────┐
│ Browser Simulation Loop │   ───────►   │ PostgreSQL / TimescaleDB│
│ (JavaScript Math Engine)│              │ (Persistent Time-Series)│
└───────────┬─────────────┘              └───────────┬─────────────┘
            │                                        │
            ▼                                        ▼
┌─────────────────────────┐              ┌─────────────────────────┐
│ Standalone Python CLI   │              │ Redis / Celery Workers  │
│ (Verification Scripts)  │              │ (Real-Time Ingest Queue)│
└─────────────────────────┘              └─────────────────────────┘
```

1. **Backend Service Layer:** Deploy a FastAPI service wrapping the existing `ml/station_adaptive_pipeline.py` and `ml/spatial_engine.py` modules.
2. **Persistent Time-Series Storage:** Integrate PostgreSQL with the TimescaleDB extension for raw telemetry, canonical observations, model cards, and incident audit logs.
3. **Automated NetCDF Converter:** Implement an automated `xarray` preprocessing pipeline to convert the 20 regional NetCDF datasets in `Datasets/` into canonical station CSV baselines.
4. **Elevation Pressure Normalization:** Apply the international barometric formula to reduce surface pressures to Mean Sea Level ($P_{\text{MSL}}$) prior to spatial peer residual calculation.
5. **Edge Datalogger Micro-Client:** Package the zero-dependency Python ML pipeline for direct on-device execution on Campbell Scientific, Raspberry Pi, or Linux-based remote dataloggers.
