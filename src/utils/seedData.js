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

// Benchmark historical datasets simulating distinct station microclimates
// Used for one-click testing of the Station-Adaptive ML Pipeline
export const BENCHMARK_HISTORICAL_DATA = {
  "AWS-07": [
    // Hyderabad: Semi-arid, higher diurnal temp range, moderate winds, dry season baseline
    { timestamp: "2026-08-01 00:00:00", temp: 24.2, hum: 78, pres: 1008.2, wind: 10.2, rain: 0.0 },
    { timestamp: "2026-08-01 02:00:00", temp: 23.5, hum: 81, pres: 1007.8, wind: 9.4, rain: 0.0 },
    { timestamp: "2026-08-01 04:00:00", temp: 22.8, hum: 84, pres: 1007.4, wind: 8.5, rain: 0.0 },
    { timestamp: "2026-08-01 06:00:00", temp: 25.1, hum: 76, pres: 1008.5, wind: 11.0, rain: 0.0 },
    { timestamp: "2026-08-01 08:00:00", temp: 29.4, hum: 62, pres: 1009.2, wind: 14.5, rain: 0.0 },
    { timestamp: "2026-08-01 10:00:00", temp: 33.2, hum: 48, pres: 1007.9, wind: 16.2, rain: 0.0 },
    { timestamp: "2026-08-01 12:00:00", temp: 34.8, hum: 42, pres: 1005.8, wind: 18.0, rain: 0.0 },
    { timestamp: "2026-08-01 14:00:00", temp: 34.2, hum: 44, pres: 1004.9, wind: 16.5, rain: 0.0 },
    { timestamp: "2026-08-01 16:00:00", temp: 31.9, hum: 55, pres: 1005.7, wind: 14.2, rain: 0.0 },
    { timestamp: "2026-08-01 18:00:00", temp: 28.5, hum: 66, pres: 1007.1, wind: 12.0, rain: 0.0 },
    { timestamp: "2026-08-01 20:00:00", temp: 26.3, hum: 72, pres: 1008.0, wind: 10.8, rain: 0.0 },
    { timestamp: "2026-08-01 22:00:00", temp: 25.0, hum: 75, pres: 1008.4, wind: 9.8, rain: 0.0 },
    { timestamp: "2026-08-02 00:00:00", temp: 24.0, hum: 79, pres: 1008.1, wind: 9.1, rain: 0.0 },
    { timestamp: "2026-08-02 02:00:00", temp: 23.2, hum: 82, pres: 1007.5, wind: 8.6, rain: 0.0 },
    { timestamp: "2026-08-02 04:00:00", temp: 22.5, hum: 85, pres: 1007.1, wind: 8.2, rain: 0.0 },
    { timestamp: "2026-08-02 06:00:00", temp: 25.0, hum: 75, pres: 1008.3, wind: 10.5, rain: 0.0 },
    { timestamp: "2026-08-02 08:00:00", temp: 29.8, hum: 60, pres: 1009.0, wind: 14.2, rain: 0.0 },
    { timestamp: "2026-08-02 10:00:00", temp: 33.6, hum: 46, pres: 1007.6, wind: 16.8, rain: 0.0 },
    { timestamp: "2026-08-02 12:00:00", temp: 35.1, hum: 40, pres: 1005.5, wind: 18.5, rain: 0.0 },
    { timestamp: "2026-08-02 14:00:00", temp: 34.5, hum: 42, pres: 1004.8, wind: 17.0, rain: 0.0 },
    { timestamp: "2026-08-02 16:00:00", temp: 32.1, hum: 52, pres: 1005.4, wind: 14.8, rain: 0.0 },
    { timestamp: "2026-08-02 18:00:00", temp: 28.7, hum: 64, pres: 1006.8, wind: 12.3, rain: 0.0 },
    { timestamp: "2026-08-02 20:00:00", temp: 26.5, hum: 70, pres: 1007.8, wind: 11.0, rain: 0.0 },
    { timestamp: "2026-08-02 22:00:00", temp: 25.1, hum: 74, pres: 1008.2, wind: 10.0, rain: 0.0 },
    // A corrupted hardware reading to test scrubber
    { timestamp: "2026-08-02 23:00:00", temp: -999.0, hum: 150, pres: 200.0, wind: -5.0, rain: 0.0 }
  ],
  "AWS-12": [
    // Mumbai Coastal: High humidity maritime air, compressed diurnal temp swing, coastal breeze
    { timestamp: "2026-08-01 00:00:00", temp: 27.8, hum: 89, pres: 1012.0, wind: 18.2, rain: 2.5 },
    { timestamp: "2026-08-01 02:00:00", temp: 27.4, hum: 91, pres: 1011.5, wind: 16.8, rain: 1.0 },
    { timestamp: "2026-08-01 04:00:00", temp: 27.1, hum: 92, pres: 1011.0, wind: 15.4, rain: 0.5 },
    { timestamp: "2026-08-01 06:00:00", temp: 27.9, hum: 90, pres: 1011.8, wind: 17.5, rain: 1.2 },
    { timestamp: "2026-08-01 08:00:00", temp: 29.2, hum: 84, pres: 1012.5, wind: 22.0, rain: 0.0 },
    { timestamp: "2026-08-01 10:00:00", temp: 30.5, hum: 80, pres: 1011.8, wind: 24.5, rain: 0.0 },
    { timestamp: "2026-08-01 12:00:00", temp: 31.0, hum: 78, pres: 1010.2, wind: 26.0, rain: 0.0 },
    { timestamp: "2026-08-01 14:00:00", temp: 30.8, hum: 79, pres: 1009.6, wind: 25.2, rain: 0.0 },
    { timestamp: "2026-08-01 16:00:00", temp: 29.9, hum: 82, pres: 1010.4, wind: 23.0, rain: 0.5 },
    { timestamp: "2026-08-01 18:00:00", temp: 28.8, hum: 86, pres: 1011.2, wind: 20.4, rain: 1.5 },
    { timestamp: "2026-08-01 20:00:00", temp: 28.2, hum: 88, pres: 1011.9, wind: 19.0, rain: 2.0 },
    { timestamp: "2026-08-01 22:00:00", temp: 28.0, hum: 89, pres: 1012.2, wind: 18.5, rain: 1.0 },
    { timestamp: "2026-08-02 00:00:00", temp: 27.7, hum: 90, pres: 1011.8, wind: 18.0, rain: 1.8 },
    { timestamp: "2026-08-02 02:00:00", temp: 27.3, hum: 92, pres: 1011.3, wind: 16.5, rain: 2.2 },
    { timestamp: "2026-08-02 04:00:00", temp: 27.0, hum: 93, pres: 1010.8, wind: 15.0, rain: 3.5 },
    { timestamp: "2026-08-02 06:00:00", temp: 27.8, hum: 91, pres: 1011.6, wind: 17.2, rain: 1.0 },
    { timestamp: "2026-08-02 08:00:00", temp: 29.1, hum: 85, pres: 1012.3, wind: 21.8, rain: 0.2 },
    { timestamp: "2026-08-02 10:00:00", temp: 30.4, hum: 81, pres: 1011.6, wind: 24.1, rain: 0.0 },
    { timestamp: "2026-08-02 12:00:00", temp: 30.9, hum: 79, pres: 1010.0, wind: 25.8, rain: 0.0 },
    { timestamp: "2026-08-02 14:00:00", temp: 30.6, hum: 80, pres: 1009.4, wind: 25.0, rain: 0.0 },
    { timestamp: "2026-08-02 16:00:00", temp: 29.7, hum: 83, pres: 1010.2, wind: 22.8, rain: 1.0 },
    { timestamp: "2026-08-02 18:00:00", temp: 28.7, hum: 87, pres: 1011.0, wind: 20.1, rain: 2.5 },
    { timestamp: "2026-08-02 20:00:00", temp: 28.1, hum: 89, pres: 1011.7, wind: 18.8, rain: 1.8 },
    { timestamp: "2026-08-02 22:00:00", temp: 27.9, hum: 90, pres: 1012.0, wind: 18.2, rain: 0.8 }
  ],
  "AWS-19": [
    // Cherrapunji Hills: High elevation (1313m), heavy orographic rain, lower pressure (870 hPa)
    { timestamp: "2026-08-01 00:00:00", temp: 19.2, hum: 98, pres: 871.2, wind: 22.5, rain: 24.5 },
    { timestamp: "2026-08-01 02:00:00", temp: 18.9, hum: 99, pres: 870.8, wind: 24.0, rain: 35.0 },
    { timestamp: "2026-08-01 04:00:00", temp: 18.5, hum: 99, pres: 870.4, wind: 26.5, rain: 42.0 },
    { timestamp: "2026-08-01 06:00:00", temp: 19.8, hum: 97, pres: 871.0, wind: 25.0, rain: 28.0 },
    { timestamp: "2026-08-01 08:00:00", temp: 21.4, hum: 94, pres: 871.8, wind: 20.0, rain: 15.0 },
    { timestamp: "2026-08-01 10:00:00", temp: 22.8, hum: 90, pres: 871.2, wind: 18.5, rain: 8.5 },
    { timestamp: "2026-08-01 12:00:00", temp: 23.5, hum: 88, pres: 870.1, wind: 17.0, rain: 6.0 },
    { timestamp: "2026-08-01 14:00:00", temp: 23.0, hum: 89, pres: 869.5, wind: 19.0, rain: 12.0 },
    { timestamp: "2026-08-01 16:00:00", temp: 21.8, hum: 93, pres: 870.2, wind: 22.0, rain: 20.0 },
    { timestamp: "2026-08-01 18:00:00", temp: 20.5, hum: 96, pres: 871.0, wind: 25.0, rain: 38.0 },
    { timestamp: "2026-08-01 20:00:00", temp: 19.8, hum: 98, pres: 871.5, wind: 28.0, rain: 45.0 },
    { timestamp: "2026-08-01 22:00:00", temp: 19.4, hum: 99, pres: 871.8, wind: 26.0, rain: 32.0 },
    { timestamp: "2026-08-02 00:00:00", temp: 19.1, hum: 98, pres: 871.4, wind: 23.0, rain: 22.0 },
    { timestamp: "2026-08-02 02:00:00", temp: 18.8, hum: 99, pres: 871.0, wind: 25.0, rain: 38.0 },
    { timestamp: "2026-08-02 04:00:00", temp: 18.4, hum: 99, pres: 870.5, wind: 27.5, rain: 50.0 },
    { timestamp: "2026-08-02 06:00:00", temp: 19.6, hum: 97, pres: 871.2, wind: 24.5, rain: 30.0 },
    { timestamp: "2026-08-02 08:00:00", temp: 21.2, hum: 95, pres: 871.9, wind: 21.0, rain: 18.0 },
    { timestamp: "2026-08-02 10:00:00", temp: 22.6, hum: 91, pres: 871.3, wind: 19.0, rain: 10.0 },
    { timestamp: "2026-08-02 12:00:00", temp: 23.3, hum: 89, pres: 870.3, wind: 17.5, rain: 7.5 },
    { timestamp: "2026-08-02 14:00:00", temp: 22.9, hum: 90, pres: 869.7, wind: 20.0, rain: 15.0 },
    { timestamp: "2026-08-02 16:00:00", temp: 21.6, hum: 94, pres: 870.4, wind: 23.5, rain: 25.0 },
    { timestamp: "2026-08-02 18:00:00", temp: 20.3, hum: 97, pres: 871.1, wind: 26.5, rain: 40.0 },
    { timestamp: "2026-08-02 20:00:00", temp: 19.7, hum: 98, pres: 871.6, wind: 29.0, rain: 48.0 },
    { timestamp: "2026-08-02 22:00:00", temp: 19.3, hum: 99, pres: 871.9, wind: 25.5, rain: 34.0 }
  ]
};

// Initial state has ZERO pre-trained models.
// Models are created, trained, and deployed on-demand when stations upload historical data.
export const INITIAL_MODEL_REGISTRY = [];


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
