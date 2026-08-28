/**
 * MONSOON SENTINEL - REAL-TIME TELEMETRY SIMULATOR & FAULT INJECTION LAB
 */

class WeatherSimulator {
  constructor(state, qcEngine) {
    this.state = state;
    this.qcEngine = qcEngine;
    this.timer = null;
    this.activeFaults = {}; // station_id -> { type: 'SPIKE'|'DRIFT'|'FLATLINE'|'POWER'|'STORM', offset, ticksRemaining }
    this.isRunning = true;
    this.tickInterval = 3000; // 3 seconds
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), this.tickInterval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  injectFault(stationId, faultType) {
    this.activeFaults[stationId] = {
      type: faultType,
      ticksRemaining: 15,
      offset: 0
    };
    if (window.tacticalAudio) window.tacticalAudio.playAlarm();
    this.tick(); // instant update
  }

  clearFaults(stationId = null) {
    if (stationId) {
      delete this.activeFaults[stationId];
    } else {
      this.activeFaults = {};
    }
    this.state.notify();
  }

  tick() {
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    this.state.stations.forEach(station => {
      // Check if station has active fault injection
      const fault = this.activeFaults[station.id];
      let tempDelta = (Math.random() - 0.48) * 0.3;
      let humDelta = (Math.random() - 0.5) * 0.8;
      let presDelta = (Math.random() - 0.5) * 0.2;
      let windDelta = (Math.random() - 0.5) * 0.6;
      let rainDelta = Math.random() > 0.85 ? +(Math.random() * 0.4).toFixed(1) : 0;

      let battery = +(station.battery + (Math.random() - 0.5) * 0.02).toFixed(2);
      let signal = station.signal + (Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0);

      if (fault && fault.ticksRemaining > 0) {
        fault.ticksRemaining--;

        switch (fault.type) {
          case 'SPIKE':
            tempDelta += 8.5; // Instant abrupt spike
            break;
          case 'DRIFT':
            fault.offset += 0.4;
            tempDelta += fault.offset;
            break;
          case 'FLATLINE':
            tempDelta = 0; // Freeze temperature
            humDelta = 0;
            break;
          case 'POWER':
            battery = 10.8;
            signal = -98;
            break;
          case 'STORM':
            rainDelta = +(Math.random() * 25 + 15).toFixed(1);
            windDelta = 25.0;
            humDelta = 12.0;
            presDelta = -4.0;
            break;
        }

        if (fault.ticksRemaining <= 0) {
          delete this.activeFaults[station.id];
        }
      }

      // Update current sensor readings
      const newTemp = +(station.sensors.temperature.value + (fault?.type === 'FLATLINE' ? 0 : tempDelta)).toFixed(1);
      const newHum = Math.min(100, Math.max(10, +(station.sensors.humidity.value + humDelta).toFixed(1)));
      const newPres = +(station.sensors.pressure.value + presDelta).toFixed(1);
      const newWind = Math.max(0, +(station.sensors.wind_speed.value + windDelta).toFixed(1));
      const newRain = +(station.sensors.rainfall.value + rainDelta).toFixed(1);

      station.sensors.temperature.value = newTemp;
      station.sensors.humidity.value = newHum;
      station.sensors.pressure.value = newPres;
      station.sensors.wind_speed.value = newWind;
      station.sensors.rainfall.value = newRain;
      station.battery = battery;
      station.signal = signal;
      station.uptime_s += 3;
      station.last_seen = new Date().toISOString();

      // If offline mode is active for station operator, queue locally
      if (this.state.isOfflineMode && this.state.currentRole === "station_operator") {
        this.state.offlineBuffer.push({
          stationId: station.id,
          timestamp: nowStr,
          temperature: newTemp,
          humidity: newHum,
          pressure: newPres,
          wind: newWind,
          rainfall: newRain
        });
        return; // do not evaluate cloud incidents while offline
      }

      // Evaluate Quality Control
      const qcResult = this.qcEngine.evaluateObservation(
        station.id,
        station.sensors,
        { battery_v: battery, signal_dbm: signal }
      );

      // Update station quality status
      station.status = qcResult.quality_state === "SUSPECT" ? (qcResult.fault_risk >= 0.8 ? "CRITICAL" : "SUSPECT")
        : qcResult.quality_state === "GENUINE_EXTREME_CANDIDATE" ? "EXTREME" : "NORMAL";

      // Append to time-series history
      if (!this.state.history[station.id]) this.state.history[station.id] = [];
      this.state.history[station.id].push({
        time: nowStr,
        temperature: newTemp,
        humidity: newHum,
        pressure: newPres,
        wind_speed: newWind,
        rainfall: newRain
      });
      if (this.state.history[station.id].length > 25) {
        this.state.history[station.id].shift();
      }

      // Open new incident if fault risk is high and not already reported
      if (qcResult.quality_state === "SUSPECT" && qcResult.fault_risk >= 0.65) {
        const existingIncident = this.state.incidents.find(inc => inc.station_id === station.id && inc.status === "open");
        if (!existingIncident) {
          const newIncident = {
            id: `INC-AUTO-${Date.now().toString().slice(-4)}`,
            station_id: station.id,
            station_name: station.name,
            variable: "air_temperature",
            severity: qcResult.severity,
            fault_risk: qcResult.fault_risk,
            quality_state: qcResult.quality_state,
            reason_codes: qcResult.reason_codes,
            explanation: qcResult.evidence.join(". ") || "Multiple sensor quality thresholds breached.",
            recommended_actions: [
              "Inspect sensor wiring and terminal blocks",
              "Check hardware diagnostics & battery status",
              "Validate against nearby trusted buddy stations"
            ],
            evidence_ids: [`EV-GEN-${station.id}`],
            status: "open",
            created_at: new Date().toISOString(),
            assignee: "Auto-Assigned Dispatch",
            disposition_history: []
          };
          this.state.incidents.unshift(newIncident);
          if (window.tacticalAudio) window.tacticalAudio.playAlarm();
        }
      }
    });

    this.state.notify();
  }

  syncOfflineBuffer() {
    const count = this.state.offlineBuffer.length;
    this.state.offlineBuffer = [];
    this.state.isOfflineMode = false;
    if (window.tacticalAudio) window.tacticalAudio.playSuccess();
    this.state.notify();
    return count;
  }
}

window.weatherSimulator = new WeatherSimulator(window.appState, window.qcEngine);
window.weatherSimulator.start();
