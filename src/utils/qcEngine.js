export class QCEngine {
  evaluateObservation(stationId, measurements, health, qcConfig, history, stations) {
    const config = qcConfig;
    const reasons = [];
    const evidence = [];
    let ruleScore = 0.0;
    let healthScore = 0.0;
    let spatialScore = 0.0;
    let coherenceScore = 0.0;

    const temp = measurements.temperature.value;
    const hum = measurements.humidity.value;
    const pres = measurements.pressure.value;
    const rain = measurements.rainfall.value;
    const wind = measurements.wind_speed.value;

    // 1. Deterministic Physical Range Checks
    if (temp < config.temp_min || temp > config.temp_max) {
      reasons.push("RANGE_FAIL");
      evidence.push(`Temperature ${temp}°C exceeds physical envelope [${config.temp_min}°C, ${config.temp_max}°C]`);
      ruleScore += 0.6;
    }

    if (hum < config.humidity_min || hum > config.humidity_max) {
      reasons.push("RANGE_FAIL");
      evidence.push(`Relative humidity ${hum}% outside physical limits [${config.humidity_min}%, ${config.humidity_max}%]`);
      ruleScore += 0.5;
    }

    if (pres < config.pressure_min || pres > config.pressure_max) {
      reasons.push("RANGE_FAIL");
      evidence.push(`Barometric pressure ${pres} hPa outside plausible operational bounds`);
      ruleScore += 0.5;
    }

    // 2. Rate of Change Checks (against last history point)
    const stHistory = history[stationId] || [];
    if (stHistory.length > 0) {
      const lastPoint = stHistory[stHistory.length - 1];
      const deltaT = Math.abs(temp - lastPoint.temperature);
      if (deltaT > config.temp_max_rate) {
        reasons.push("RATE_FAIL");
        evidence.push(`Temperature rate-of-change ${deltaT.toFixed(1)}°C/10min exceeds max threshold ${config.temp_max_rate}°C/10min`);
        ruleScore += 0.45;
      }
    }

    // 3. Flatline & Stuck Value Checks
    if (stHistory.length >= config.flatline_window) {
      const recentTemps = stHistory.slice(-config.flatline_window).map(p => p.temperature);
      const isFlat = recentTemps.every(val => Math.abs(val - temp) < 0.05);
      if (isFlat) {
        reasons.push("FLATLINE");
        evidence.push(`Temperature stuck invariant at ${temp}°C across ${config.flatline_window} consecutive sample cycles`);
        ruleScore += 0.7;
      }
    }

    // 4. Cross-Variable Consistency (Dew Point Plausibility)
    const approxDewPoint = temp - ((100 - hum) / 5);
    if (approxDewPoint > temp + 0.5) {
      reasons.push("INTERNAL_INCONSISTENCY");
      evidence.push(`Computed Dew Point (${approxDewPoint.toFixed(1)}°C) exceeds Air Temperature (${temp}°C)`);
      ruleScore += 0.5;
    }

    // 5. Hardware Health Risk Assessment
    if (health.battery_v < 11.8) {
      reasons.push("POWER_LOW");
      evidence.push(`Battery voltage ${health.battery_v}V critically low (< 11.8V); ADC sensor readings untrusted`);
      healthScore += 0.8;
    } else if (health.battery_v < 12.2) {
      healthScore += 0.35;
    }

    if (health.signal_dbm < -95) {
      reasons.push("COMMUNICATION_GAP");
      evidence.push(`Cellular RSSI ${health.signal_dbm} dBm indicates high packet degradation risk`);
      healthScore += 0.4;
    }

    // 6. Spatial "Buddy" Comparison
    const station = stations.find(s => s.id === stationId);
    if (station && station.trusted_peers && station.trusted_peers.length > 0) {
      const cleanPeers = stations.filter(s => 
        station.trusted_peers.includes(s.id) && s.status !== "SUSPECT" && s.status !== "CRITICAL"
      );

      if (cleanPeers.length > 0) {
        const peerTemps = cleanPeers.map(p => p.sensors.temperature.value);
        const peerMedianTemp = peerTemps.reduce((a, b) => a + b, 0) / peerTemps.length;
        const residual = Math.abs(temp - peerMedianTemp);

        if (residual > 3.0) {
          reasons.push("SPATIAL_OUTLIER");
          evidence.push(`Station temp ${temp}°C deviates ${residual.toFixed(1)}°C from clean peer median (${peerMedianTemp.toFixed(1)}°C across ${cleanPeers.map(p=>p.id).join(', ')})`);
          spatialScore = Math.min(1.0, residual / 6.0);
        }
      }
    }

    // 7. ML Model Anomaly Score Emulator
    const modelScore = (ruleScore > 0 || spatialScore > 0.4) 
      ? Math.min(0.98, Math.max(0.65, (ruleScore + spatialScore) * 0.7 + Math.random() * 0.1))
      : +(Math.random() * 0.15).toFixed(2);

    // 8. Weather Event Coherence Gate
    if (rain > 30.0 && hum > 85.0 && wind > 30.0) {
      coherenceScore = 0.88;
      evidence.push(`Multi-sensor storm signature detected (Rain: ${rain}mm, Hum: ${hum}%, Wind: ${wind}km/h). Coherence validated.`);
    }

    // 9. Multi-Signal Evidence Fusion Formula
    const faultRisk = +(
      config.rule_weight * Math.min(1.0, ruleScore) +
      config.model_weight * modelScore +
      config.spatial_weight * spatialScore +
      config.health_weight * healthScore
    ).toFixed(2);

    // 10. Quality State Disposition
    let qualityState = "ACCEPTED";
    let severity = "low";

    if (coherenceScore >= config.extreme_coherence_threshold) {
      qualityState = "GENUINE_EXTREME_CANDIDATE";
      severity = "medium";
      reasons.unshift("GENUINE_EXTREME_CANDIDATE");
    } else if (faultRisk >= 0.80) {
      qualityState = "SUSPECT";
      severity = "critical";
    } else if (faultRisk >= 0.50) {
      qualityState = "SUSPECT";
      severity = "high";
    } else if (faultRisk >= 0.30) {
      qualityState = "ACCEPTED";
      severity = "low";
    }

    return {
      fault_risk: faultRisk,
      quality_state: qualityState,
      severity,
      reason_codes: reasons.length > 0 ? Array.from(new Set(reasons)) : ["NORMAL"],
      evidence,
      scores: {
        rule: +Math.min(1.0, ruleScore).toFixed(2),
        model: modelScore,
        spatial: +spatialScore.toFixed(2),
        health: +healthScore.toFixed(2),
        coherence: +coherenceScore.toFixed(2)
      }
    };
  }
}

export const qcEngine = new QCEngine();
