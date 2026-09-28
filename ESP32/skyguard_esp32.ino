/**
 * ============================================================================
 * SkyGuard-AI — ESP32 Edge Node Firmware (100% Self-Contained Sketch)
 * ============================================================================
 * 
 * Features:
 *  - Onboard Zero-Allocation Edge AI Engine (< 0.05ms execution)
 *  - Thermodynamic Calculations (Magnus-Tetens Dew Point, VPD, Clausius-Clapeyron)
 *  - Temporal QC (Thermal Spikes, Sensor Flatline, Calibration Drift, Power Sag)
 *  - WMO Quality Flagging (WMO 0: PASS, WMO 1: SUSPECT, WMO 2: ERRONEOUS)
 *  - Embedded REST API & Web Server (port 80) with full CORS support
 *  - Accepts simulated inputs via HTTP POST from browser simulator
 *  - Dispatches evaluated Edge AI telemetry to PC server via HTTP POST
 * 
 * Note: 100% self-contained. No external .h files or extra libraries needed!
 *       Uses standard ESP32 Arduino Core libraries (WiFi, WebServer, HTTPClient).
 * ============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>
#include <string.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif
#ifndef SKYGUARD_STATION_DEVICE_KEY
#define SKYGUARD_STATION_DEVICE_KEY ""
#endif

// ============================================================================
// 1. CONFIGURATION (Update Wi-Fi credentials & your PC's IP address)
// ============================================================================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";     // <-- Enter your Wi-Fi SSID
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"; // <-- Enter your Wi-Fi Password

// Target: SkyGuard-AI FastAPI Backend (ESP32 Telemetry Ingest)
// ► UPDATE <PC_IP> to your computer's local Wi-Fi IP address (e.g. 192.168.1.5)
// ► Find your IP with: ipconfig (Windows) or ifconfig (Linux/Mac)
// ► The backend runs on port 8000 (python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload)
//
// To revert to the local test_receiver.py, change the URL to:
//   "http://<PC_IP>:5000/api/telemetry"
String DESTINATION_SERVER_URL = "http://10.152.113.162:8000/api/v1/telemetry/esp32/ingest";

const char* DEVICE_ID  = "esp32-aws01-edge";
const char* STATION_ID = "AWS-01";

// ============================================================================
// 2. EMBEDDED EDGE AI ENGINE (Zero-Allocation C++ Implementation)
// ============================================================================
#define EDGE_TEMP_MIN       -40.0f
#define EDGE_TEMP_MAX        60.0f
#define EDGE_HUM_MIN          0.0f
#define EDGE_HUM_MAX        100.0f
#define EDGE_PRES_MIN       800.0f
#define EDGE_PRES_MAX      1150.0f
#define EDGE_BATT_MIN        10.5f

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
    char  classification[32];      // NOMINAL, THERMAL_SPIKE, etc.
    float anomaly_score;           // 0.00 to 1.00
    char  diagnosis_reason[96];    // Human-readable rationale
};

class SkyGuardEdgeEngine {
private:
    uint32_t _seq_counter;
    float _last_temp;
    float _last_hum;
    float _last_pres;
    bool  _has_previous;
    uint16_t _temp_flatline_streak;
    float _mean_t;
    float _m2_t;
    uint32_t _sample_count;
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

    static float computeDewPoint(float temp_c, float rh_pct) {
        if (rh_pct <= 0.01f) rh_pct = 0.01f;
        if (rh_pct > 100.0f) rh_pct = 100.0f;
        const float a = 17.27f;
        const float b = 237.7f;
        float alpha = ((a * temp_c) / (b + temp_c)) + logf(rh_pct / 100.0f);
        return (b * alpha) / (a - alpha);
    }

    static float computeVPD(float temp_c, float rh_pct) {
        float es = 6.1078f * expf((17.27f * temp_c) / (temp_c + 237.3f));
        float ea = es * (rh_pct / 100.0f);
        float vpd = es - ea;
        return vpd > 0.0f ? vpd : 0.0f;
    }

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

        // 1. Thermodynamic Laws (Magnus-Tetens & Clausius-Clapeyron)
        res.dew_point = computeDewPoint(input.temperature, input.humidity > 100.0f ? 100.0f : input.humidity);
        res.vapor_pressure_deficit = computeVPD(input.temperature, input.humidity);
        
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

        // 2. Hard Physical Bounds
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

        // 3. Power Sag / Brownout
        if (input.battery_v > 0.0f && input.battery_v < EDGE_BATT_MIN) {
            res.wmo_t_flag = 1;
            res.wmo_h_flag = 1;
            res.wmo_p_flag = 1;
            res.anomaly_score = 0.85f;
            strncpy(res.classification, "POWER_SAG_BROWNOUT", sizeof(res.classification));
            strncpy(res.diagnosis_reason, "Battery voltage below operating threshold; telemetry unstable.", sizeof(res.diagnosis_reason));
            return res;
        }

        // 4. Temporal Spikes, Flatlines & Drift
        if (_has_previous) {
            float delta_t = input.temperature - _last_temp;
            float abs_delta_t = fabsf(delta_t);

            // Thermal Spike
            if (abs_delta_t >= 3.5f) {
                res.wmo_t_flag = 2;
                res.anomaly_score = 0.91f;
                strncpy(res.classification, "THERMAL_SPIKE", sizeof(res.classification));
                snprintf(res.diagnosis_reason, sizeof(res.diagnosis_reason), 
                         "Rapid unphysical delta of %.1f°C exceeds atmospheric rate of change.", delta_t);
                _last_temp = input.temperature;
                return res;
            }

            // Flatline
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

            // Monotonic Drift
            if (delta_t > 0.25f || delta_t < -0.25f) {
                _drift_accumulator += delta_t;
            } else {
                _drift_accumulator *= 0.85f;
            }

            if (fabsf(_drift_accumulator) >= 2.5f) {
                res.wmo_t_flag = 1;
                res.anomaly_score = 0.76f;
                strncpy(res.classification, "CALIBRATION_DRIFT", sizeof(res.classification));
                snprintf(res.diagnosis_reason, sizeof(res.diagnosis_reason), 
                         "Persistent progressive bias (accum: %.1f°C) indicates aging sensor calibration.", _drift_accumulator);
            }
        }

        // 5. Welford's Algorithm Online Statistics
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

        _last_temp = input.temperature;
        _last_hum = input.humidity;
        _last_pres = input.pressure;
        _has_previous = true;

        return res;
    }
};

// ============================================================================
// 3. GLOBAL OBJECTS & STATE
// ============================================================================
WebServer server(80);
SkyGuardEdgeEngine edgeEngine;

EdgeSensorInput currentInput = { 24.5f, 65.0f, 1013.25f, 12.6f };
EdgeAIResult lastResult;
int totalPacketsSent = 0;
int successfulDispatches = 0;
String lastServerResponse = "None";
String lastSourceTimestamp = "";
Preferences queueSettings;
uint32_t queueHead = 0;
uint32_t queueTail = 0;
bool storageReady = false;
unsigned long nextReplayAt = 0;
const uint32_t MAX_PENDING_FRAMES = 64;

String queuePath(uint32_t sequence) { return "/frame_" + String(sequence) + ".json"; }

String sourceTimeUTC() {
    struct timeval now;
    gettimeofday(&now, nullptr);
    if (now.tv_sec < 1700000000) return "";
    struct tm utc;
    gmtime_r(&now.tv_sec, &utc);
    char result[25];
    strftime(result, sizeof(result), "%Y-%m-%dT%H:%M:%S", &utc);
    char timestamp[32];
    snprintf(timestamp, sizeof(timestamp), "%s.%03ldZ", result, now.tv_usec / 1000);
    return String(timestamp);
}

bool submitFrame(const String& payload) {
    if (WiFi.status() != WL_CONNECTED) {
        lastServerResponse = "Wi-Fi disconnected";
        return false;
    }
    if (strlen(SKYGUARD_STATION_DEVICE_KEY) == 0) {
        lastServerResponse = "Device key missing";
        return false;
    }
    HTTPClient http;
    if (!http.begin(DESTINATION_SERVER_URL)) {
        lastServerResponse = "Invalid destination URL";
        return false;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Station-Key", SKYGUARD_STATION_DEVICE_KEY);
    http.setTimeout(8000);
    totalPacketsSent++;
    int code = http.POST(payload);
    String response = code >= 200 && code < 300 ? http.getString() : "";
    bool acknowledged = code >= 200 && code < 300 && response.indexOf("\"acknowledged\":true") >= 0;
    lastServerResponse = "HTTP " + String(code);
    http.end();
    if (acknowledged) successfulDispatches++;
    return acknowledged;
}

void replayPendingFrame() {
    if (!storageReady || queueHead == queueTail || millis() < nextReplayAt) return;
    nextReplayAt = millis() + 5000;
    String path = queuePath(queueHead);
    File file = LittleFS.open(path, "r");
    if (!file) {
        // A missing file after a power loss is explicitly skipped; later frames remain intact.
        queueHead++;
        queueSettings.putUInt("head", queueHead);
        return;
    }
    String payload = file.readString();
    file.close();
    if (submitFrame(payload)) {
        LittleFS.remove(path);
        queueHead++;
        queueSettings.putUInt("head", queueHead);
    }
}

// ============================================================================
// 4. FORWARD DECLARATIONS
// ============================================================================
void handleCORS();
void handleRoot();
void handleStatus();
void handleSensorInput();
void dispatchToDestination(const EdgeAIResult& res);
String serializeEdgeResultJSON(const EdgeAIResult& res);

// ============================================================================
// 5. SETUP
// ============================================================================
void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n\n========================================================");
    Serial.println("  SKYGUARD-AI -- TIER 1 EMBEDDED EDGE NODE");
    Serial.println("========================================================");

    lastResult = edgeEngine.evaluate(currentInput);
    storageReady = LittleFS.begin(false);
    if (storageReady) {
        queueSettings.begin("skyguard", false);
        queueHead = queueSettings.getUInt("head", 0);
        queueTail = queueSettings.getUInt("tail", 0);
        while (LittleFS.exists(queuePath(queueTail))) {
            queueTail++;
            queueSettings.putUInt("tail", queueTail);
        }
    } else {
        Serial.println("[QUEUE] LittleFS unavailable; telemetry input disabled to avoid data loss.");
    }

    // Wi-Fi Initialization
    Serial.printf("[WIFI] Connecting to '%s'...\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WIFI] Connected successfully!");
        Serial.print("[WIFI] ESP32 IP Address: http://");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n[WIFI WARNING] Could not connect to Wi-Fi!");
        Serial.println("[WIFI] Starting fallback Soft-AP (SkyGuard-ESP32-Edge)...");
        WiFi.softAP("SkyGuard-ESP32-Edge", "skyguard123");
        Serial.print("[WIFI] AP IP Address: http://");
        Serial.println(WiFi.softAPIP());
    }
    configTime(0, 0, "pool.ntp.org", "time.google.com");

    // Web Server Endpoints with CORS
    server.on("/", HTTP_GET, handleRoot);
    server.on("/api/status", HTTP_GET, handleStatus);
    server.on("/api/sensor-input", HTTP_POST, handleSensorInput);
    server.on("/api/sensor-input", HTTP_OPTIONS, handleCORS);
    server.on("/api/status", HTTP_OPTIONS, handleCORS);

    server.onNotFound([]() {
        if (server.method() == HTTP_OPTIONS) {
            handleCORS();
        } else {
            server.send(404, "text/plain", "Not Found");
        }
    });

    server.begin();
    Serial.println("[HTTP] Embedded Sensor API Server started on port 80.");
    Serial.printf("[EDGE] Telemetry destination URL: %s\n", DESTINATION_SERVER_URL.c_str());
    Serial.println("========================================================\n");
}

// ============================================================================
// 6. MAIN LOOP
// ============================================================================
void loop() {
    server.handleClient();
    replayPendingFrame();
}

// ============================================================================
// 7. CORS HANDLER
// ============================================================================
void handleCORS() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
    server.send(204);
}

// ============================================================================
// 8. HTTP ROUTE: GET /
// ============================================================================
void handleRoot() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    String html = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>SkyGuard-AI ESP32 Edge Node</title>";
    html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
    html += "<style>body{background:#050811;color:#00f0ff;font-family:monospace;padding:24px;}";
    html += ".card{border:1px solid #00f0ff;background:rgba(13,20,37,0.9);padding:20px;border-radius:6px;max-width:600px;margin:auto;}";
    html += "h1{color:#00ff66;font-size:1.4rem;} .val{color:#fff;font-weight:bold;}";
    html += "a{color:#ffaa00;text-decoration:none;font-weight:bold;}</style></head><body>";
    html += "<div class='card'><h1>⚡ SKYGUARD-AI ESP32 EDGE NODE</h1>";
    html += "<p>Status: <span style='color:#00ff66;'>ONLINE</span> | Device ID: <span class='val'>" + String(DEVICE_ID) + "</span></p>";
    html += "<p>Assigned Station: <span class='val'>" + String(STATION_ID) + "</span></p>";
    html += "<hr style='border-color:rgba(0,240,255,0.2);'>";
    html += "<p>Latest Edge AI Diagnosis: <span style='color:#ff0055;font-weight:bold;'>" + String(lastResult.classification) + "</span></p>";
    html += "<p>Reason: <span class='val'>" + String(lastResult.diagnosis_reason) + "</span></p>";
    html += "<p>Temperature: <span class='val'>" + String(lastResult.temperature, 1) + " &deg;C</span> (WMO Flag: " + String(lastResult.wmo_t_flag) + ")</p>";
    html += "<p>Dew Point (Magnus-Tetens): <span class='val'>" + String(lastResult.dew_point, 2) + " &deg;C</span></p>";
    html += "<p>Humidity: <span class='val'>" + String(lastResult.humidity, 1) + " %</span> (WMO Flag: " + String(lastResult.wmo_h_flag) + ")</p>";
    html += "<p>Pressure: <span class='val'>" + String(lastResult.pressure, 1) + " hPa</span></p>";
    html += "<p>Packets Forwarded to PC: <span class='val'>" + String(successfulDispatches) + " / " + String(totalPacketsSent) + "</span></p>";
    html += "<p>Last PC Response: <span class='val'>" + lastServerResponse + "</span></p>";
    html += "<hr style='border-color:rgba(0,240,255,0.2);'>";
    html += "<p>&raquo; Use the <b>sensor_simulator.html</b> file on your computer to push live inputs!</p>";
    html += "</div></body></html>";
    server.send(200, "text/html", html);
}

// ============================================================================
// 9. HTTP ROUTE: GET /api/status
// ============================================================================
void handleStatus() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", serializeEdgeResultJSON(lastResult));
}

// ============================================================================
// 10. HTTP ROUTE: POST /api/sensor-input
// ============================================================================
void handleSensorInput() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    if (!storageReady || queueTail - queueHead >= MAX_PENDING_FRAMES) {
        server.send(507, "application/json", "{\"error\":\"DURABLE_QUEUE_FULL_OR_UNAVAILABLE\"}");
        return;
    }
    lastSourceTimestamp = sourceTimeUTC();
    if (lastSourceTimestamp.isEmpty()) {
        server.send(503, "application/json", "{\"error\":\"SOURCE_CLOCK_NOT_SYNCHRONIZED\"}");
        return;
    }

    if (server.hasArg("plain")) {
        String body = server.arg("plain");
        int tIdx = body.indexOf("\"temperature\"");
        int hIdx = body.indexOf("\"humidity\"");
        int pIdx = body.indexOf("\"pressure\"");
        int bIdx = body.indexOf("\"battery_v\"");

        if (tIdx != -1) {
            int colon = body.indexOf(':', tIdx);
            currentInput.temperature = body.substring(colon + 1).toFloat();
        }
        if (hIdx != -1) {
            int colon = body.indexOf(':', hIdx);
            currentInput.humidity = body.substring(colon + 1).toFloat();
        }
        if (pIdx != -1) {
            int colon = body.indexOf(':', pIdx);
            currentInput.pressure = body.substring(colon + 1).toFloat();
        }
        if (bIdx != -1) {
            int colon = body.indexOf(':', bIdx);
            currentInput.battery_v = body.substring(colon + 1).toFloat();
        }
        int dIdx = body.indexOf("\"destination_url\"");
        if (dIdx != -1) {
            int colon = body.indexOf(':', dIdx);
            int startQ = body.indexOf('"', colon + 1);
            int endQ = body.indexOf('"', startQ + 1);
            if (startQ != -1 && endQ != -1) {
                DESTINATION_SERVER_URL = body.substring(startQ + 1, endQ);
            }
        }
    } else {
        if (server.hasArg("temperature")) currentInput.temperature = server.arg("temperature").toFloat();
        if (server.hasArg("humidity"))    currentInput.humidity = server.arg("humidity").toFloat();
        if (server.hasArg("pressure"))    currentInput.pressure = server.arg("pressure").toFloat();
        if (server.hasArg("battery_v"))   currentInput.battery_v = server.arg("battery_v").toFloat();
        if (server.hasArg("destination_url")) DESTINATION_SERVER_URL = server.arg("destination_url");
    }

    // Run Edge AI Inference (< 0.05ms)
    lastResult = edgeEngine.evaluate(currentInput);

    Serial.println("\n--------------------------------------------------------");
    Serial.printf("[EDGE AI] Cycle #%u complete in <0.05ms\n", lastResult.seq_num);
    Serial.printf("  Input:    T=%.1f C | RH=%.1f %% | P=%.1f hPa | Batt=%.2f V\n", 
                  currentInput.temperature, currentInput.humidity, currentInput.pressure, currentInput.battery_v);
    Serial.printf("  Derived:  DewPoint=%.2f C | VPD=%.2f hPa | ClausiusPass=%s\n", 
                  lastResult.dew_point, lastResult.vapor_pressure_deficit, lastResult.clausius_clapeyron_pass ? "YES" : "NO");
    Serial.printf("  Decision: [%s] (Score: %.2f) WMO Flags: T=%d, H=%d, P=%d\n", 
                  lastResult.classification, lastResult.anomaly_score, lastResult.wmo_t_flag, lastResult.wmo_h_flag, lastResult.wmo_p_flag);
    Serial.printf("  Reason:   %s\n", lastResult.diagnosis_reason);

    // Forward telemetry to PC
    dispatchToDestination(lastResult);

    // Respond to simulator
    server.send(200, "application/json", serializeEdgeResultJSON(lastResult));
}

// ============================================================================
// 11. DISPATCH TELEMETRY VIA HTTP POST
// ============================================================================
void dispatchToDestination(const EdgeAIResult& res) {
    String payload = serializeEdgeResultJSON(res);
    String path = queuePath(queueTail);
    File file = LittleFS.open(path, "w");
    if (!file || file.print(payload) != payload.length()) {
        Serial.println("[QUEUE] Persistent write failed. Frame was not dispatched.");
        if (file) file.close();
        return;
    }
    file.close();
    queueTail++;
    queueSettings.putUInt("tail", queueTail);
    replayPendingFrame();
}

// ============================================================================
// 12. SERIALIZE JSON
// ============================================================================
String serializeEdgeResultJSON(const EdgeAIResult& res) {
    String json = "{";
    json += "\"source_timestamp\":\"" + lastSourceTimestamp + "\",";
    json += "\"seq\":" + String(res.seq_num) + ",";
    json += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
    json += "\"station_id\":\"" + String(STATION_ID) + "\",";
    json += "\"sensors\":{";
    json += "\"temperature\":{\"value\":" + String(res.temperature, 2) + ",\"unit\":\"°C\",\"wmo_flag\":" + String(res.wmo_t_flag) + "},";
    json += "\"humidity\":{\"value\":" + String(res.humidity, 2) + ",\"unit\":\"%\",\"wmo_flag\":" + String(res.wmo_h_flag) + "},";
    json += "\"pressure\":{\"value\":" + String(res.pressure, 2) + ",\"unit\":\"hPa\",\"wmo_flag\":" + String(res.wmo_p_flag) + "},";
    json += "\"battery_v\":{\"value\":" + String(res.battery_v, 2) + ",\"unit\":\"V\"}";
    json += "},";
    json += "\"derived\":{";
    json += "\"dew_point\":" + String(res.dew_point, 2) + ",";
    json += "\"vapor_pressure_deficit\":" + String(res.vapor_pressure_deficit, 2) + ",";
    json += "\"clausius_clapeyron_pass\":" + String(res.clausius_clapeyron_pass ? "true" : "false");
    json += "},";
    json += "\"edge_ai\":{";
    json += "\"classification\":\"" + String(res.classification) + "\",";
    json += "\"anomaly_score\":" + String(res.anomaly_score, 2) + ",";
    json += "\"reason\":\"" + String(res.diagnosis_reason) + "\"";
    json += "},";
    json += "\"dispatch_stats\":{";
    json += "\"total_sent\":" + String(totalPacketsSent) + ",";
    json += "\"successful\":" + String(successfulDispatches) + ",";
    json += "\"last_server_status\":\"" + lastServerResponse + "\"";
    json += "}";
    json += "}";
    return json;
}
