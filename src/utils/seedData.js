export const SEED_STATIONS = [
  {
    id: "AWS-07",
    name: "Hyderabad Central Met",
    region: "Telangana South",
    lat: 17.3850,
    lon: 78.4867,
    elevation: 542,
    status: "NORMAL", // NORMAL, SUSPECT, CRITICAL, OFFLINE, EXTREME
    battery: 12.6,
    signal: -76,
    uptime_s: 245920,
    firmware: "v1.4.2",
    last_seen: new Date().toISOString(),
    sensors: {
      temperature: { value: 29.4, unit: "°C", quality: "ACCEPTED" },
      humidity: { value: 68.5, unit: "%", quality: "ACCEPTED" },
      pressure: { value: 1004.8, unit: "hPa", quality: "ACCEPTED" },
      wind_speed: { value: 14.2, unit: "km/h", quality: "ACCEPTED" },
      wind_direction: { value: 225, unit: "deg", quality: "ACCEPTED" },
      rainfall: { value: 0.0, unit: "mm", quality: "ACCEPTED" },
      solar: { value: 480.0, unit: "W/m²", quality: "ACCEPTED" }
    },
    trusted_peers: ["AWS-08", "AWS-09", "AWS-15"]
  },
  {
    id: "AWS-08",
    name: "Secunderabad Cantonment",
    region: "Telangana South",
    lat: 17.4399,
    lon: 78.4983,
    elevation: 535,
    status: "NORMAL",
    battery: 12.4,
    signal: -72,
    uptime_s: 312000,
    firmware: "v1.4.2",
    last_seen: new Date().toISOString(),
    sensors: {
      temperature: { value: 29.1, unit: "°C", quality: "ACCEPTED" },
      humidity: { value: 70.1, unit: "%", quality: "ACCEPTED" },
      pressure: { value: 1005.1, unit: "hPa", quality: "ACCEPTED" },
      wind_speed: { value: 12.8, unit: "km/h", quality: "ACCEPTED" },
      wind_direction: { value: 220, unit: "deg", quality: "ACCEPTED" },
      rainfall: { value: 0.0, unit: "mm", quality: "ACCEPTED" },
      solar: { value: 465.0, unit: "W/m²", quality: "ACCEPTED" }
    },
    trusted_peers: ["AWS-07", "AWS-09"]
  },
  {
    id: "AWS-09",
    name: "Cyberabad Hitech City",
    region: "Telangana South",
    lat: 17.4435,
    lon: 78.3772,
    elevation: 580,
    status: "SUSPECT",
    battery: 11.2,
    signal: -89,
    uptime_s: 14500,
    firmware: "v1.3.9",
    last_seen: new Date().toISOString(),
    sensors: {
      temperature: { value: 33.8, unit: "°C", quality: "SUSPECT" },
      humidity: { value: 42.0, unit: "%", quality: "ACCEPTED" },
      pressure: { value: 1003.9, unit: "hPa", quality: "ACCEPTED" },
      wind_speed: { value: 8.5, unit: "km/h", quality: "ACCEPTED" },
      wind_direction: { value: 210, unit: "deg", quality: "ACCEPTED" },
      rainfall: { value: 0.0, unit: "mm", quality: "ACCEPTED" },
      solar: { value: 510.0, unit: "W/m²", quality: "ACCEPTED" }
    },
    trusted_peers: ["AWS-07", "AWS-08"]
  },
  {
    id: "AWS-12",
    name: "Mumbai Coastal Colaba",
    region: "Maharashtra West",
    lat: 18.9067,
    lon: 72.8147,
    elevation: 12,
    status: "NORMAL",
    battery: 12.8,
    signal: -65,
    uptime_s: 592000,
    firmware: "v1.4.2",
    last_seen: new Date().toISOString(),
    sensors: {
      temperature: { value: 28.2, unit: "°C", quality: "ACCEPTED" },
      humidity: { value: 88.0, unit: "%", quality: "ACCEPTED" },
      pressure: { value: 1012.3, unit: "hPa", quality: "ACCEPTED" },
      wind_speed: { value: 24.5, unit: "km/h", quality: "ACCEPTED" },
      wind_direction: { value: 260, unit: "deg", quality: "ACCEPTED" },
      rainfall: { value: 12.4, unit: "mm", quality: "ACCEPTED" },
      solar: { value: 220.0, unit: "W/m²", quality: "ACCEPTED" }
    },
    trusted_peers: ["AWS-13", "AWS-14"]
  },
  {
    id: "AWS-13",
    name: "Santacruz Airport Met",
    region: "Maharashtra West",
    lat: 19.0896,
    lon: 72.8656,
    elevation: 19,
    status: "NORMAL",
    battery: 12.7,
    signal: -68,
    uptime_s: 820000,
    firmware: "v1.4.2",
    last_seen: new Date().toISOString(),
    sensors: {
      temperature: { value: 27.9, unit: "°C", quality: "ACCEPTED" },
      humidity: { value: 91.2, unit: "%", quality: "ACCEPTED" },
      pressure: { value: 1011.8, unit: "hPa", quality: "ACCEPTED" },
      wind_speed: { value: 22.0, unit: "km/h", quality: "ACCEPTED" },
      wind_direction: { value: 255, unit: "deg", quality: "ACCEPTED" },
      rainfall: { value: 14.8, unit: "mm", quality: "ACCEPTED" },
      solar: { value: 195.0, unit: "W/m²", quality: "ACCEPTED" }
    },
    trusted_peers: ["AWS-12"]
  },
  {
    id: "AWS-19",
    name: "Cherrapunji Hills Eco",
    region: "Meghalaya East",
    lat: 25.2986,
    lon: 91.7300,
    elevation: 1484,
    status: "EXTREME",
    battery: 12.5,
    signal: -82,
    uptime_s: 419000,
    firmware: "v1.4.1",
    last_seen: new Date().toISOString(),
    sensors: {
      temperature: { value: 19.5, unit: "°C", quality: "GENUINE_EXTREME_CANDIDATE" },
      humidity: { value: 99.4, unit: "%", quality: "GENUINE_EXTREME_CANDIDATE" },
      pressure: { value: 855.2, unit: "hPa", quality: "GENUINE_EXTREME_CANDIDATE" },
      wind_speed: { value: 45.8, unit: "km/h", quality: "GENUINE_EXTREME_CANDIDATE" },
      wind_direction: { value: 190, unit: "deg", quality: "GENUINE_EXTREME_CANDIDATE" },
      rainfall: { value: 84.6, unit: "mm", quality: "GENUINE_EXTREME_CANDIDATE" },
      solar: { value: 65.0, unit: "W/m²", quality: "GENUINE_EXTREME_CANDIDATE" }
    },
    trusted_peers: ["AWS-20"]
  }
];

export const SEED_INCIDENTS = [
  {
    id: "INC-20260828-001",
    station_id: "AWS-09",
    station_name: "Cyberabad Hitech City",
    variable: "air_temperature",
    severity: "high", // low, medium, high, critical
    fault_risk: 0.84,
    quality_state: "SUSPECT",
    reason_codes: ["SPATIAL_OUTLIER", "RATE_FAIL"],
    explanation: "Temperature jumped +4.4°C in 10 mins and deviates 4.7°C from trusted peers AWS-07 & AWS-08 without radiation support.",
    recommended_actions: [
      "Inspect thermal radiation shield",
      "Check ADC circuit grounding",
      "Compare with field reference instrument"
    ],
    evidence_ids: ["EV-09-T1", "EV-09-SP3"],
    status: "open", // open, acknowledged, assigned, resolved
    created_at: new Date(Date.now() - 18 * 60000).toISOString(),
    assignee: "Field Tech Unit 4",
    disposition_history: []
  },
  {
    id: "INC-20260828-002",
    station_id: "AWS-19",
    station_name: "Cherrapunji Hills Eco",
    variable: "rainfall",
    severity: "medium",
    fault_risk: 0.32,
    quality_state: "GENUINE_EXTREME_CANDIDATE",
    reason_codes: ["GENUINE_EXTREME_CANDIDATE", "MULTI_SENSOR_COHERENCE"],
    explanation: "Monsoon torrential downpour: 84.6mm rain supported by 99% humidity, 45km/h gusts, and regional radar echo coherence.",
    recommended_actions: [
      "Route for specialist meteorological confirmation",
      "Do NOT discard raw observations",
      "Maintain alert notification for civil defense"
    ],
    evidence_ids: ["EV-19-RADAR", "EV-19-COH1"],
    status: "acknowledged",
    created_at: new Date(Date.now() - 42 * 60000).toISOString(),
    assignee: "Central Met Officer",
    disposition_history: [
      { operator: "Dr. A. Sharma (Lead)", action: "Acknowledged as genuine storm", timestamp: new Date(Date.now() - 30 * 60000).toISOString() }
    ]
  }
];

export const INITIAL_QC_CONFIG = {
  temp_min: -20,
  temp_max: 55,
  temp_max_rate: 3.5, // °C per 10 min
  humidity_min: 5,
  humidity_max: 100,
  pressure_min: 800,
  pressure_max: 1080,
  flatline_window: 6, // consecutive identical readings
  spatial_weight: 0.25,
  rule_weight: 0.35,
  model_weight: 0.25,
  health_weight: 0.15,
  extreme_coherence_threshold: 0.75
};

export const INITIAL_MODEL_REGISTRY = [
  {
    id: "iforest-v1.4",
    name: "Isolation Forest Baseline v1.4",
    type: "Unsupervised Tree Ensemble",
    status: "APPROVED & ACTIVE",
    version: "v1.4.0",
    approved_at: "2026-08-20 14:30 UTC",
    approved_by: "Dr. A. Sharma (Lead ML Met)",
    sha256: "a9f87c2b1e4d081290bb34e89921ef45aa879c2311456d8120eef91104523bb8",
    purpose: "Unsupervised multi-variable telemetry anomaly detector optimized for rapid physical excursions, stuck values, and progressive sensor calibration drift without discarding legitimate severe storms.",
    variables: ["Air Temperature (°C)", "Relative Humidity (%)", "Barometric Pressure (hPa)", "Wind Speed (km/h)", "Rainfall Accumulator (mm)"],
    station_coverage: "Fleet-wide (6/6 AWS Units)",
    training_period: "2025-06-01 to 2026-06-30 (12-Month Screened Historical Baseline)",
    normal_data_selection: "Pre-screened with deterministic physical envelopes and expert labels; known hardware failure runs and network outage intervals scrubbed.",
    features: [
      "10-min rolling median deviation",
      "Median Absolute Deviation (MAD) score",
      "Exponentially weighted residual (alpha=0.3)",
      "1st & 2nd difference derivative",
      "Distance-weighted clean peer residual",
      "Dew-point cross-variable discrepancy index"
    ],
    thresholding: "Station-aware dynamic threshold versioned at 99.2th empirical percentile on screened validation splits.",
    intended_use: "Production real-time inference in Central Cloud Ingestion Pipeline.",
    known_failure_modes: [
      "Localized dry microbursts may produce temporary spike alerts prior to spatial neighbor reconciliation.",
      "Severe nocturnal radiation inversions in mountain basins (handled via spatial elevation adjustment)."
    ],
    eval_splits: "Chronological 70% Train / 15% Validation / 15% Holdout Test (No random leakage)",
    metrics: {
      event_precision: "94.8%",
      event_recall: "97.2%",
      false_alerts_per_day: "0.11 / station-day",
      detection_delay: "1.2 cycles (3.6 min)",
      calibration_brier: "0.038",
      explanation_completeness: "100% (Structured reason codes)"
    },
    human_review_policy: "Observations with composite fault_risk >= 0.65 require operator disposition. Adjudications are automatically written to the immutable evaluation label store.",
    rollback_procedure: "One-click hot rollback to v1.3.8 checksum artifact if false-positive review rate exceeds 5.0% threshold."
  },
  {
    id: "buddy-meta-v2.1",
    name: "Spatial Buddy Consensus Meta-Model v2.1",
    type: "Distance-Weighted Robust Estimator",
    status: "APPROVED & ACTIVE",
    version: "v2.1.2",
    approved_at: "2026-08-22 09:15 UTC",
    approved_by: "Fleet Operations Lead",
    sha256: "c48209bb8f1a23450912389fedcba901238910452390aef891230194820bcfea",
    purpose: "Dynamic peer weighting and suspect-peer exclusion engine ensuring bad stations cannot contaminate the fleet reference baseline.",
    variables: ["Temperature", "Pressure", "Rainfall Rate"],
    station_coverage: "Cluster-based (Peninsular India, Coastal West, Eastern Hills)",
    training_period: "Continuous 30-day sliding correlation matrix",
    normal_data_selection: "Excludes SUSPECT and REJECTED peers from baseline dynamically.",
    features: ["Inverse-distance weight", "Elevation lapse-rate adjustment", "Historical 30-day inter-station Pearson correlation"],
    thresholding: "3.0 MAD spatial peer deviation gate",
    intended_use: "Secondary spatial evidence component in Evidence Fusion Formula.",
    known_failure_modes: ["Sparse network regions with >100km inter-station gaps (fallback to temporal QC)."],
    eval_splits: "Cross-validation across station holdouts",
    metrics: {
      event_precision: "96.1%",
      event_recall: "95.4%",
      false_alerts_per_day: "0.08 / station-day",
      detection_delay: "1.0 cycles (3.0 min)",
      calibration_brier: "0.029",
      explanation_completeness: "100%"
    },
    human_review_policy: "Spatial outliers route to Data Quality Analyst queue.",
    rollback_procedure: "Fallback to equal-weighted nearest-neighbor median."
  },
  {
    id: "lstm-autoenc-v0.9",
    name: "Temporal LSTM Autoencoder v0.9 (Experimental)",
    type: "Deep Sequence Autoencoder",
    status: "STAGING / EVALUATION",
    version: "v0.9.4",
    approved_at: "Pending Validation",
    approved_by: "ML Research Lab",
    sha256: "77a810f29c018239019284710293847192837401928374019283740192837401",
    purpose: "Learns complex diurnal micro-climate sequences; evaluated locally offline against simpler baselines.",
    variables: ["All 7 Standard Meteorological Channels"],
    station_coverage: "Pilot AWS-07 & AWS-12 only",
    training_period: "2024-01-01 to 2025-12-31",
    normal_data_selection: "Heavily screened clean seasonal periods.",
    features: ["24-step sequence windows (120 minutes) with sinusoidal solar zenith encoding"],
    thresholding: "Reconstruction Mean Squared Error (MSE) > 0.045",
    intended_use: "Offline evaluation only (Not yet deployed to edge/cloud pipeline).",
    known_failure_modes: ["Higher compute footprint; sensitive to missing sequence intervals."],
    eval_splits: "Chronological holdout",
    metrics: {
      event_precision: "91.5%",
      event_recall: "94.0%",
      false_alerts_per_day: "0.24 / station-day",
      detection_delay: "2.0 cycles (6.0 min)",
      calibration_brier: "0.062",
      explanation_completeness: "78% (Requires integrated gradients)"
    },
    human_review_policy: "Subject to offline fault-injection benchmark pass criteria.",
    rollback_procedure: "N/A - Non-production"
  }
];

export const INITIAL_MODEL_DRIFT = {
  drift_score: 2.1,
  drift_status: "NOMINAL",
  ood_sensor_flags: 0,
  false_positive_feedback_rate: 1.8,
  score_distribution: [
    { bin: "0.0 - 0.2 (Normal)", count: 842 },
    { bin: "0.2 - 0.4 (Low Risk)", count: 114 },
    { bin: "0.4 - 0.6 (Moderate)", count: 28 },
    { bin: "0.6 - 0.8 (Suspect)", count: 12 },
    { bin: "0.8 - 1.0 (Critical)", count: 4 }
  ]
};

export const EXTERNAL_DATA_LINEAGE = [
  {
    provider: "India Meteorological Department (IMD)",
    product: "Doppler Weather Radar (DWR) Mosaic Reflectivity",
    endpoint: "https://api.imd.gov.in/v2/radar/doppler-mosaic",
    access_time: "Real-time 10-min sync (Last: 2026-08-28 16:50 UTC)",
    response_schema: "GeoJSON Grid / HDF5 (dBZ > 35 indicates deep convective storm)",
    license: "Official Met Agency Inter-Service Research MoA #IMD-2026-073",
    station_mapping: "Spatial radius 25km bounding box around AWS nodes",
    alignment: "Bilinear spatial interpolation to WGS84 + UTC timestamp synchronization",
    role_in_system: "SECONDARY CONTEXT ONLY (Not treated as unverified ground truth; supports GENUINE_EXTREME_CANDIDATE classification)"
  },
  {
    provider: "ISRO / MOSDAC Telemetry",
    product: "INSAT-3DR Rapid-Scan Half-Hourly Cloud Motion Vectors",
    endpoint: "https://mosdac.gov.in/api/v1/insat3dr/cmv",
    access_time: "30-min cadence",
    response_schema: "NetCDF4 / GeoTIFF",
    license: "Open Data Portal for National Met Networks",
    station_mapping: "Continental India regional overlay",
    alignment: "Gridded nearest-neighbor projection",
    role_in_system: "SYNOPTIC WEATHER CONTEXT (Used for regional front validation)"
  }
];

export const INITIAL_CHECKLISTS = {
  "AWS-07": [
    { id: "c1", title: "Clean Tipping Bucket Rain Gauge", desc: "Clear funnel debris, check siphon filter, and verify magnetic reed switch tick.", done: true, timestamp: "2026-08-27 10:15" },
    { id: "c2", title: "Inspect Ultrasonic Wind Sensor", desc: "Check alignment northward and ensure transducer heads are free of spiderwebs/moisture.", done: true, timestamp: "2026-08-27 10:30" },
    { id: "c3", title: "Verify Battery Terminal Voltage & Solar Panel", desc: "Confirm float voltage ≥ 12.4V and clean PV surface.", done: false, timestamp: null },
    { id: "c4", title: "Test Edge Gateway Enclosure Humidity Pack", desc: "Ensure silica gel is active and desiccant has not saturated.", done: false, timestamp: null }
  ],
  "AWS-09": [
    { id: "c1", title: "Inspect PT100 Temperature Probe & Radiation Shield", desc: "Check for thermal shield blockage, wasp nests, or cable shielding breakdown.", done: false, timestamp: null },
    { id: "c2", title: "Calibrate Battery Charge Controller", desc: "Resolve low battery voltage flag (11.2V observed).", done: false, timestamp: null }
  ]
};
