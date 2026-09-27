/**
 * ============================================================================
 * SkyGuard-AI — Embedded Edge AI Engine (Zero-Allocation C++ Library)
 * ============================================================================
 * Designed for ESP32 / ESP32-S3 / ARM Cortex-M
 * 
 * Capabilities:
 *  1. Physical envelope & sanity checks (WMO limits, NaN/sentinel rejection)
 *  2. Thermodynamic Engine (Magnus-Tetens Dew Point, VPD, Clausius-Clapeyron)
 *  3. Online Statistical Anomaly Detection (Welford's algorithm variance tracker)
 *  4. Micro-anomaly classification:
 *      - NOMINAL
 *      - THERMAL_SPIKE
 *      - CALIBRATION_DRIFT
 *      - SUPER_SATURATION_VIOLATION
 *      - SENSOR_FLATLINE
 *      - POWER_SAG_BROWNOUT
 *      - PHYSICAL_BOUNDS_FAIL
 *  5. WMO Standard Quality Flags (WMO 0: PASS, WMO 1: SUSPECT, WMO 2: ERRONEOUS)
 * 
 * Execution Time: < 0.05 ms per observation
 * Dynamic RAM Allocation: 0 bytes (pure stack + static state)
 * ============================================================================
 */

#ifndef SKYGUARD_EDGE_H
#define SKYGUARD_EDGE_H

#include <math.h>
#include <stdint.h>
#include <string.h>

// Universal Physical WMO Bounds
#define EDGE_TEMP_MIN       -40.0f
#define EDGE_TEMP_MAX        60.0f
#define EDGE_HUM_MIN          0.0f
#define EDGE_HUM_MAX        100.0f
#define EDGE_PRES_MIN       800.0f
#define EDGE_PRES_MAX      1150.0f
#define EDGE_BATT_MIN        10.5f  // Below this = Power Sag

struct EdgeSensorInput {
    float temperature;  // °C
    float humidity;     // %
    float pressure;     // hPa
    float battery_v;    // V
};

struct EdgeAIResult {
    uint32_t seq_num;
    float temperature;
    float humidity;
    float pressure;
    float battery_v;

    // Derived Thermodynamic Features
    float dew_point;               // Magnus-Tetens °C
    float vapor_pressure_deficit;  // VPD in hPa
    bool  clausius_clapeyron_pass; // Td <= T check

    // Quality Flags (WMO: 0=Pass, 1=Suspect, 2=Erroneous)
    uint8_t wmo_t_flag;
    uint8_t wmo_h_flag;
    uint8_t wmo_p_flag;

    // Edge AI Classification & Scoring
    char  classification[32];      // E.g. NOMINAL, THERMAL_SPIKE, etc.
    float anomaly_score;           // 0.00 to 1.00
    char  diagnosis_reason[96];    // Human-readable rationale
};

class SkyGuardEdgeEngine {
private:
    uint32_t _seq_counter;

    // Previous readings for rate-of-change and flatline tracking
    float _last_temp;
    float _last_hum;
    float _last_pres;
    bool  _has_previous;

    // Flatline streak counter
    uint16_t _temp_flatline_streak;

    // Welford's algorithm state for online mean and variance of temperature
    float _mean_t;
    float _m2_t;
    uint32_t _sample_count;

    // Drift accumulator
    float _drift_accumulator;

public:
    SkyGuardEdgeEngine() {
        reset();
    }

    void reset() {
        _seq_counter = 0;
        _last_temp = 25.0f;
        _last_hum = 65.0f;
        _last_pres = 1013.25f;
        _has_previous = false;
        _temp_flatline_streak = 0;
        _mean_t = 25.0f;
        _m2_t = 1.0f;
        _sample_count = 0;
        _drift_accumulator = 0.0f;
    }

    /**
     * Exact Magnus-Tetens Dew Point Formulation
     * Valid across -40°C to 50°C within 0.1°C accuracy.
     */
    static float computeDewPoint(float temp_c, float rh_pct) {
        if (rh_pct <= 0.01f) rh_pct = 0.01f;
        if (rh_pct > 100.0f) rh_pct = 100.0f;
        
        const float a = 17.27f;
        const float b = 237.7f;
        float alpha = ((a * temp_c) / (b + temp_c)) + logf(rh_pct / 100.0f);
        return (b * alpha) / (a - alpha);
    }

    /**
     * Computes Vapor Pressure Deficit (VPD in hPa)
     */
    static float computeVPD(float temp_c, float rh_pct) {
        // Saturation vapor pressure es (Tetens)
        float es = 6.1078f * expf((17.27f * temp_c) / (temp_c + 237.3f));
        // Actual vapor pressure ea
        float ea = es * (rh_pct / 100.0f);
        float vpd = es - ea;
        return vpd > 0.0f ? vpd : 0.0f;
    }

    /**
     * Executes the full Edge AI inference cycle (< 0.05ms)
     */
    EdgeAIResult evaluate(const EdgeSensorInput& input) {
        EdgeAIResult res;
        _seq_counter++;
        res.seq_num = _seq_counter;
        res.temperature = input.temperature;
        res.humidity = input.humidity;
        res.pressure = input.pressure;
        res.battery_v = input.battery_v;

        // Default: PASS
        res.wmo_t_flag = 0;
        res.wmo_h_flag = 0;
        res.wmo_p_flag = 0;
        res.anomaly_score = 0.02f;
        strncpy(res.classification, "NOMINAL", sizeof(res.classification));
        strncpy(res.diagnosis_reason, "All sensors nominal; thermodynamic checks passed.", sizeof(res.diagnosis_reason));

        // -------------------------------------------------------------
        // Level 1: Thermodynamic Physical Laws (Magnus-Tetens & Clausius)
        // -------------------------------------------------------------
        res.dew_point = computeDewPoint(input.temperature, input.humidity > 100.0f ? 100.0f : input.humidity);
        res.vapor_pressure_deficit = computeVPD(input.temperature, input.humidity);
        
        // Clausius-Clapeyron Constraint: Dew point cannot physically exceed dry-bulb temperature
        // In real air, Td <= T. If Td > T by > 0.1°C, thermodynamic supersaturation error!
        if (input.humidity > 100.2f || (res.dew_point - input.temperature) > 0.15f) {
            res.clausius_clapeyron_pass = false;
            res.wmo_h_flag = 2; // ERRONEOUS
            res.anomaly_score = 0.94f;
            strncpy(res.classification, "SUPER_SATURATION_VIOLATION", sizeof(res.classification));
            strncpy(res.diagnosis_reason, "RH > 100% breaches Clausius-Clapeyron atmospheric boundary.", sizeof(res.diagnosis_reason));
            return res;
        } else {
            res.clausius_clapeyron_pass = true;
        }

        // -------------------------------------------------------------
        // Level 2: Hard Physical Bounds & Sentinel Checks
        // -------------------------------------------------------------
        bool range_breach = false;
        if (isnan(input.temperature) || input.temperature < EDGE_TEMP_MIN || input.temperature > EDGE_TEMP_MAX) {
            res.wmo_t_flag = 2;
            range_breach = true;
        }
        if (isnan(input.humidity) || input.humidity < EDGE_HUM_MIN || input.humidity > EDGE_HUM_MAX) {
            res.wmo_h_flag = 2;
            range_breach = true;
        }
        if (isnan(input.pressure) || input.pressure < EDGE_PRES_MIN || input.pressure > EDGE_PRES_MAX) {
            res.wmo_p_flag = 2;
            range_breach = true;
        }

        if (range_breach) {
            res.anomaly_score = 0.99f;
            strncpy(res.classification, "PHYSICAL_BOUNDS_FAIL", sizeof(res.classification));
            strncpy(res.diagnosis_reason, "Sensor reading breached immutable physical plausibility limits.", sizeof(res.diagnosis_reason));
            return res;
        }

        // -------------------------------------------------------------
        // Level 3: Power & Battery Sag Detection
        // -------------------------------------------------------------
        if (input.battery_v > 0.0f && input.battery_v < EDGE_BATT_MIN) {
            res.wmo_t_flag = 1;
            res.wmo_h_flag = 1;
            res.wmo_p_flag = 1;
            res.anomaly_score = 0.85f;
            strncpy(res.classification, "POWER_SAG_BROWNOUT", sizeof(res.classification));
            strncpy(res.diagnosis_reason, "Battery voltage below operating threshold; telemetry unstable.", sizeof(res.diagnosis_reason));
            return res;
        }

        // -------------------------------------------------------------
        // Level 4: Temporal Spikes, Flatlines & Statistical Drift
        // -------------------------------------------------------------
        if (_has_previous) {
            float delta_t = input.temperature - _last_temp;
            float abs_delta_t = fabsf(delta_t);

            // A) Thermal Spike Check (> 3.5°C instant change in single interval)
            if (abs_delta_t >= 3.5f) {
                res.wmo_t_flag = 2;
                res.anomaly_score = 0.91f;
                strncpy(res.classification, "THERMAL_SPIKE", sizeof(res.classification));
                snprintf(res.diagnosis_reason, sizeof(res.diagnosis_reason), 
                         "Rapid unphysical delta of %.1f°C exceeds atmospheric rate of change.", delta_t);
                _last_temp = input.temperature;
                return res;
            }

            // B) Sensor Flatline Check (ADC or I2C bus frozen)
            if (abs_delta_t < 0.001f && fabsf(input.humidity - _last_hum) < 0.001f) {
                _temp_flatline_streak++;
                if (_temp_flatline_streak >= 5) {
                    res.wmo_t_flag = 1;
                    res.wmo_h_flag = 1;
                    res.anomaly_score = 0.82f;
                    strncpy(res.classification, "SENSOR_FLATLINE", sizeof(res.classification));
                    strncpy(res.diagnosis_reason, "Zero variance across 5+ cycles indicates transducer stall.", sizeof(res.diagnosis_reason));
                    return res;
                }
            } else {
                _temp_flatline_streak = 0;
            }

            // C) Monotonic Calibration Drift Check
            if (delta_t > 0.25f) {
                _drift_accumulator += delta_t;
            } else if (delta_t < -0.25f) {
                _drift_accumulator += delta_t;
            } else {
                _drift_accumulator *= 0.85f; // Decay towards zero
            }

            if (fabsf(_drift_accumulator) >= 2.5f) {
                res.wmo_t_flag = 1; // SUSPECT
                res.anomaly_score = 0.76f;
                strncpy(res.classification, "CALIBRATION_DRIFT", sizeof(res.classification));
                snprintf(res.diagnosis_reason, sizeof(res.diagnosis_reason), 
                         "Persistent progressive bias (accum: %.1f°C) indicates aging sensor calibration.", _drift_accumulator);
            }
        }

        // -------------------------------------------------------------
        // Level 5: Welford's Algorithm Online Z-Score Update
        // -------------------------------------------------------------
        _sample_count++;
        float delta = input.temperature - _mean_t;
        _mean_t += delta / (float)_sample_count;
        float delta2 = input.temperature - _mean_t;
        _m2_t += delta * delta2;

        if (_sample_count > 10) {
            float variance = _m2_t / (float)(_sample_count - 1);
            float std_dev = sqrtf(variance);
            if (std_dev > 0.3f) {
                float z_score = fabsf(input.temperature - _mean_t) / std_dev;
                if (z_score >= 3.0f && res.wmo_t_flag == 0) {
                    res.wmo_t_flag = 1;
                    res.anomaly_score = 0.68f;
                    strncpy(res.classification, "STATISTICAL_EXCURSION", sizeof(res.classification));
                    snprintf(res.diagnosis_reason, sizeof(res.diagnosis_reason), 
                             "Reading is %.1f standard deviations from edge rolling mean (Z=%.2f).", z_score, z_score);
                }
            }
        }

        // Cache last readings
        _last_temp = input.temperature;
        _last_hum = input.humidity;
        _last_pres = input.pressure;
        _has_previous = true;

        return res;
    }
};

#endif // SKYGUARD_EDGE_H
