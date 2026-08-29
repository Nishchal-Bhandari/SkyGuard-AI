# SkyGuard-AI — Station-Adaptive & Spatially Intelligent Weather Anomaly Detection

> **Smart India Hackathon 2026**  
> **Theme:** AI/ML-Based Intelligent Anomaly Detection for Automatic Weather Stations (AWS)

---

## 1. Executive Summary & Core Product Definition

> **SkyGuard-AI is a station-adaptive and spatially intelligent weather anomaly detection platform that learns each station's individual normal behavior while using geographically nearby stations as contextual evidence to distinguish localized sensor anomalies from broader regional weather events.**

The platform combines two complementary layers of intelligence:
1. **Station-Adaptive ML:** *"Is this reading unusual for this specific station's historical microclimate?"*
2. **Nearby Station Spatial Intelligence:** *"Is this reading unusual in comparison to fresh observations from neighboring stations within a geographic radius?"*

```text
                                 CURRENT TELEMETRY
                                        │
                                        ▼
                                 Station ID AWS-07
                                        │
                           ┌────────────┴────────────┐
                           ▼                         ▼
                   Station-Adaptive ML       Spatial Intelligence
                           │                         │
                           ▼                         ▼
                  "Unusual for me?"          "Unusual nearby?"
                  (Local Anomaly Score)      (Find Nearby Peers via Haversine)
                           │                         │
                           └────────────┬────────────┘
                                        ▼
                                 Anomaly Fusion
                                        │
                                        ▼
                               Final Classification
                                        │
                          ┌─────────────┼─────────────┐
                          ▼             ▼             ▼
                       NORMAL       LOCALIZED      REGIONAL
                                     ANOMALY         EVENT
                                 (Sensor Defect) (Storm / Front)
```

---

## 2. Why Station-Adaptive ML + Spatial Intelligence?

In meteorology, normal weather varies drastically across microclimates:
* **Cherrapunji (`AWS-19`):** Mountain rainforest at $1313\,\text{m}$ elevation. Torrential rains $>50\,\text{mm/hr}$ and sustained $98\%$ humidity are normal monsoon weather.
* **Mumbai Coastal (`AWS-12`):** Maritime microclimate at sea level with compressed diurnal swings and high sea breeze.
* **Hyderabad (`AWS-07`):** Semi-arid Deccan plateau at $542\,\text{m}$ with sharp $15^\circ\text{C}$ diurnal swings.

Imposing a single global pre-trained model desensitizes one station while flooding another with false alarms. Therefore, **SkyGuard-AI initially contains zero pre-trained models**, training a dedicated Isolation Forest for each station.

However, a station-specific model alone cannot determine if a sudden $10^\circ\text{C}$ temperature drop is:
* A **faulty thermistor** (isolated to that single tower), or
* A **genuine severe squall line** (hitting all nearby stations in the valley).

The **Spatial Intelligence Layer** solves this by calculating geodetic distances (Haversine formula), filtering for temporal freshness ($\le 300\,\text{s}$), and computing robust neighborhood statistics (Median and Median Absolute Deviation [MAD]).

---

## 3. Separation of Concerns: Shared vs. Station-Specific vs. Spatial

| SHARED ML & SPATIAL PLATFORM | STATION-SPECIFIC INSTANCES | SPATIAL INTELLIGENCE LAYER |
| :--- | :--- | :--- |
| Preprocessing & sanitization rules | Dedicated historical dataset | Haversine geodetic distance |
| Feature engineering logic | Local normalization ($\mu, \sigma$) | Configurable neighbor radius ($10-200\,\text{km}$) |
| Isolation Forest algorithm | Trained tree splits & weights | Temporal freshness gate ($\le 300\,\text{s}$) |
| Dynamic threshold calibrator | Dedicated Model ID (`AWS-07_IF_v1`) | Robust neighborhood Median & MAD |
| Evidence fusion decision matrix | Real-time local anomaly score | Multi-signal classification (`NORMAL`, `LOCALIZED_ANOMALY`, `REGIONAL_EVENT`) |

---

## 4. Final Assessment Classification Matrix

| Local Station ML | Nearby Peer Consensus | Final Classification | Operational Interpretation |
| :--- | :--- | :--- | :--- |
| **Nominal** ($s < \theta$) | **Consistent** ($\text{res} \le 3^\circ\text{C}$) | `NORMAL` | Sensor reading aligns with both station history and peer neighborhood. |
| **Anomaly** ($s \ge \theta$) | **Consistent** or Peers Abnormal | `REGIONAL_EVENT` | Atmospheric excursion confirmed across multiple nearby stations. Legitimate storm or weather front. |
| **Anomaly** ($s \ge \theta$) | **Divergent** (Peers Normal) | `LOCALIZED_ANOMALY` | Excursion isolated to this tower only. Probable sensor drift, wiring fault, or hardware defect. |
| **Any** | **Zero Peers in Radius** | `LOCAL_ML_ONLY` | Remote or isolated station. Local ML operates safely without peer corroboration. |
| **Physical Out of Bounds** | **Any** | `PHYSICAL_SENSOR_FAILURE` | Hardware limits breached (e.g. Temp $= 150^\circ\text{C}$). Physical QC gate overrides all models. |

---

## 5. Verification & Test Suites

The codebase includes two independent automated verification suites in Python (`ml/`):

### A. Spatial Intelligence Test Suite (8 Scenarios)
```powershell
python ml/test_spatial_intelligence.py
```
* **Test 1:** Isolated station with no nearby peers $\rightarrow$ Spatial marked unavailable, local ML operates normally.
* **Test 2:** Nearby stations agree ($45^\circ\text{C}$ vs $44^\circ, 45^\circ, 46^\circ$) $\rightarrow$ Spatially consistent.
* **Test 3:** Target differs strongly ($48^\circ\text{C}$ vs $30^\circ, 31^\circ, 32^\circ$) $\rightarrow$ High spatial deviation score ($0.99$).
* **Test 4:** Regional event ($45^\circ\text{C}$ heatwave across all peers) $\rightarrow$ `REGIONAL_EVENT`.
* **Test 5:** Localized anomaly ($48^\circ\text{C}$ spike while peers are $30-32^\circ\text{C}$) $\rightarrow$ `LOCALIZED_ANOMALY`.
* **Test 6:** Stale reading exclusion ($> 300\,\text{s}$ old) $\rightarrow$ Excluded from neighborhood comparison.
* **Test 7:** Corrupt reading exclusion ($-999$ hardware error) $\rightarrow$ Excluded by sanity check.
* **Test 8:** Elevation difference context $\rightarrow$ Logged with altitude delta ($+1100\,\text{m}$) for lapse-rate awareness.

### B. Station-Adaptive Model Isolation Test Suite (6 Scenarios)
```powershell
python ml/test_station_isolation.py
```
* Verifies zero pre-trained model cold start, sample size gatekeepers, and proves $\text{Model A} \neq \text{Model B}$.

### C. Tactical Web Interface
```powershell
npm run dev
# or compile production bundle
npm run build
```
* **Station HUD (`StationHUD.jsx`):** Integrated Spatial Intelligence panel with interactive radius slider ($10-200\,\text{km}$), peer distance table, and live Anomaly Fusion classification.
* **Geospatial Radar (`FleetMap.jsx`):** Renders geodetic radius circle around active station with distance vector tooltips to all peers in range.
