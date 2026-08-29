/**
 * SkyGuard-AI — System Configuration and Initial State
 * Clean slate initialization (Zero mock stations, zero mock incidents, zero mock models).
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

// Benchmark historical datasets initialized empty
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

export const INITIAL_CHECKLISTS = {};
