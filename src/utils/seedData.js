/**
 * SkyGuard-AI — System Configuration and Initial State
 */

export const SEED_STATIONS = [];

export const SEED_INCIDENTS = [];

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
  extreme_coherence_threshold: 0.75,
  spatial_radius_km: 50
};

// Benchmark historical datasets
export const BENCHMARK_HISTORICAL_DATA = {};

// Clean Model Registry initialized empty
export const INITIAL_MODEL_REGISTRY = [];

export const INITIAL_MODEL_DRIFT = {
  baseline_f1: 0.0,
  current_f1: 0.0,
  drift_detected: false,
  psi_score: 0.0,
  last_evaluated: null,
  distributions: []
};

export const EXTERNAL_DATA_LINEAGE = [];

// Standard Field Maintenance & Sensor Calibration Protocol
export const DEFAULT_MAINTENANCE_CHECKLIST = [
  {
    id: "chk-1",
    title: "Clean Multi-Plate Radiation Shield",
    desc: "Remove dirt, algae, insect nests, and debris from the aspirated temperature & humidity sensor housing.",
    done: false,
    timestamp: null
  },
  {
    id: "chk-2",
    title: "Inspect Tipping Bucket Rain Gauge",
    desc: "Clear funnel filter of silt, verify tipping bucket pivot balance, and test reed switch closure.",
    done: false,
    timestamp: null
  },
  {
    id: "chk-3",
    title: "Check Solar PV Panel & Float Battery Voltage",
    desc: "Clean photovoltaic glass surface, inspect charge controller terminals, and verify float voltage (>12.4V).",
    done: false,
    timestamp: null
  },
  {
    id: "chk-4",
    title: "Inspect Barometric Pressure Static Port",
    desc: "Verify Gore-Tex microporous vent filter is free from moisture condensation and atmospheric dust.",
    done: false,
    timestamp: null
  },
  {
    id: "chk-5",
    title: "Verify Ultrasonic / Mechanical Anemometer Alignment",
    desc: "Check mast level, confirm true Geographic North offset orientation, and check bearing friction.",
    done: false,
    timestamp: null
  },
  {
    id: "chk-6",
    title: "Verify 4G/GSM Cellular Antenna & RSSI",
    desc: "Inspect antenna coaxial water-tight sealing, check signal strength (RSSI > -85 dBm), and test uplink.",
    done: false,
    timestamp: null
  }
];

export const INITIAL_CHECKLISTS = {
  "AWS-07": JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST)),
  "AWS-12": JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST)),
  "AWS-19": JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST)),
  "AWS-01": JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST)),
  "AWS-04": JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST)),
  "AWS-21": JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST)),
  "AWS-15": JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST)),
  "AWS-09": JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_CHECKLIST))
};
