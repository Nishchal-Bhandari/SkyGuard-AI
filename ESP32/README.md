# SkyGuard-AI // ESP32 Edge Node & Edge AI Subsystem

This folder contains the complete, self-contained **Tier 1 (Edge Node)** implementation for the SkyGuard-AI platform. It includes onboard Edge AI inference, an embedded sensor simulator interface, and a standalone local test receiver.

---

## Folder Contents

| File | Purpose |
|---|---|
| `skyguard_edge.h` | **Zero-allocation C++ Edge AI library.** Runs thermodynamic calculations (Magnus-Tetens Dew Point, VPD, Clausius-Clapeyron), physical sanity bounds, Welford online variance tracking, and WMO flag assignment in **< 0.05 ms** per cycle. |
| `skyguard_esp32.ino` | **Full ESP32 Arduino Firmware sketch.** Connects to Wi-Fi, hosts an embedded Web Server (port 80) with REST endpoints, accepts sensor inputs from the simulator, runs Edge AI inference, and dispatches evaluated telemetry packets via HTTP POST. |
| `sensor_simulator.html` | **Cyberpunk Tactical Web Simulator.** Allows you to simulate sensor readings (sliders & inputs for Temperature, Humidity, Pressure, Battery) and trigger one-click anomalies (Thermal Spike, Supersaturation, Drift, Flatline, Brownout). Matches the main SkyGuard-AI dashboard design. |
| `test_receiver.py` | **Zero-dependency Python receiver.** Runs on your computer to capture and display the Edge AI telemetry packets transmitted by the ESP32 over Wi-Fi. |

---

## Quickstart Guide (3 Simple Steps)

### Step 1: Flash the ESP32 Firmware
1. Open [skyguard_esp32.ino](file:///c:/Users/Nishchal%20Bhandari/Desktop/SkyGuard-AI/ESP32/skyguard_esp32.ino) in the **Arduino IDE** (or VS Code / PlatformIO).
2. Ensure you have the **ESP32 board package** installed (`Tools > Board > esp32 > ESP32 Dev Module`).
3. Update lines 28–34 with your Wi-Fi credentials and your computer's local IP address:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   
   // Your PC's Wi-Fi IP address:
   String DESTINATION_SERVER_URL = "http://172.21.11.212:5000/api/telemetry";
   ```
4. Click **Upload**.
5. Open the Serial Monitor at **115200 baud**. Note the IP address printed by the ESP32 (e.g., `http://192.168.1.50`).

### Configure the authenticated backend connection

The backend rejects unauthenticated telemetry. Use an admin session to rotate a station-specific device key:

```http
POST /api/v1/admin/stations/AWS-01/device-key
Authorization: Bearer <admin JWT>
```

Copy the returned key into a local `secrets.h` file based on `secrets.example.h`, then compile and flash the firmware. `secrets.h` is ignored by Git; never commit it. Rotating the key invalidates the previous key. The server stores only a password hash, and the device key is scoped to its station.

---

### Step 2: Start the PC Test Receiver
Open a terminal in this folder and run:
```bash
python test_receiver.py
```
* The test receiver will start listening on `http://0.0.0.0:5000/api/telemetry`.
* It will display a formatted tactical card in the terminal every time the ESP32 processes and dispatches a telemetry frame.

---

### Step 3: Open the Sensor Simulator Interface
1. Double-click [sensor_simulator.html](file:///c:/Users/Nishchal%20Bhandari/Desktop/SkyGuard-AI/ESP32/sensor_simulator.html) to open it in Chrome, Edge, or Firefox.
2. In the top connection bar, set the **ESP32 Host** to your ESP32's IP address (e.g., `http://192.168.1.50:80`) and click **PING**.
3. Adjust the sliders or click any **One-Click Preset**:
   * **Nominal Air:** Clean 24.5°C, 65% RH.
   * **Thermal Spike (+12°):** Triggers instantaneous rate-of-change violation.
   * **Supersaturation (104%):** Breaches Clausius-Clapeyron atmospheric limit.
   * **Sensor Drift:** Incremental offset drift.
   * **Sensor Flatline:** Transducer stall detection.
   * **Power Brownout:** Battery sag (< 10.5V).
4. Click **TRANSMIT SENSOR FRAME TO ESP32** (or enable **AUTO-STREAM**).
5. Watch the **Edge AI decision** appear instantly in the simulator and the packet print out in your PC terminal!

---

## What the Edge AI Computes on the ESP32

1. **Thermodynamic Law Engine:**
   * **Magnus-Tetens Dew Point ($T_d$):**
     $$\gamma(T, RH) = \frac{17.27 \cdot T}{237.7 + T} + \ln\left(\frac{RH}{100}\right)$$
     $$T_d = \frac{237.7 \cdot \gamma}{17.27 - \gamma}$$
   * **Clausius-Clapeyron Constraint:** Validates that $T_d \le T$. If $T_d > T$, thermodynamic supersaturation is flagged immediately.
   * **Vapor Pressure Deficit (VPD):** Computes atmospheric drying demand in hPa.

2. **Temporal & Physical QC:**
   * **Spike Detection:** Catches rapid unphysical steps ($|\Delta T| \ge 3.5^\circ\text{C}$ in a single cycle).
   * **Flatline Detection:** Identifies frozen transducer signals over 5+ cycles.
   * **Drift Accumulator:** Tracks directional bias creep.
   * **Power Sag:** Detects supply voltage brownouts (< 10.5V).

3. **WMO Quality Flag Standard:**
   * `WMO 0: PASS` (Good data)
   * `WMO 1: SUSPECT` (Soft margin excursion / drift / power sag)
   * `WMO 2: ERRONEOUS` (Hard physical violation, thermodynamic breach, or spike)

---

## Seamless Transition to SkyGuard Backend (Next Phase)

When you are ready to connect the ESP32 to the full SkyGuard-AI backend:
1. In [skyguard_esp32.ino](file:///c:/Users/Nishchal%20Bhandari/Desktop/SkyGuard-AI/ESP32/skyguard_esp32.ino#L34), change:
   ```cpp
   String DESTINATION_SERVER_URL = "http://<YOUR_PC_IP>:8000/api/v1/stations/AWS-01/telemetry/batch";
   ```
2. The packet format produced by the ESP32 is already structured to match the backend's telemetry schema.
