import { spatialEngine } from './spatialEngine';

export class QCEngine {
  evaluateObservation(stationId, measurements = {}, health = {}, qcConfig = {}, history = {}, stations = [], stationMlResult = null) {
    const config = qcConfig || {
      temp_min: -40,
      temp_max: 60,
      humidity_min: 0,
      humidity_max: 100,
      pressure_min: 800,
      pressure_max: 1080,
      temp_max_rate: 5.0,
      flatline_window: 6,
      extreme_coherence_threshold: 0.85,
      rule_weight: 0.35,
      model_weight: 0.35,
      spatial_weight: 0.20,
      health_weight: 0.10,
      spatial_radius_km: 50
    };
    
    const reasons = [];
    const evidence = [];
    let ruleScore = 0.0;
    let healthScore = 0.0;
    let spatialScore = 0.0;
    let coherenceScore = 0.0;

    const temp = measurements?.temperature?.value ?? measurements?.temperature ?? 25.0;
    const hum = measurements?.humidity?.value ?? measurements?.humidity ?? 60.0;
    const pres = measurements?.pressure?.value ?? measurements?.pressure ?? 1012.0;
    const rain = measurements?.rainfall?.value ?? measurements?.rainfall ?? 0.0;
    const wind = measurements?.wind_speed?.value ?? measurements?.wind_speed ?? 8.0;

    const battery = health?.battery_v ?? health?.battery ?? 12.6;
    const signal = health?.signal_dbm ?? health?.signal ?? -72;

    // 1. Deterministic Physical Range Checks
    if (temp < (config.temp_min ?? -40) || temp > (config.temp_max ?? 60)) {
      reasons.push("RANGE_FAIL");
      evidence.push(`Temperature ${temp}°C exceeds physical envelope [${config.temp_min}°C, ${config.temp_max}°C]`);
      ruleScore += 0.6;
    }

    if (hum < (config.humidity_min ?? 0) || hum > (config.humidity_max ?? 100)) {
      reasons.push("RANGE_FAIL");
      evidence.push(`Relative humidity ${hum}% outside physical limits [${config.humidity_min}%, ${config.humidity_max}%]`);
      ruleScore += 0.5;
    }

    if (pres < (config.pressure_min ?? 800) || pres > (config.pressure_max ?? 1080)) {
      reasons.push("RANGE_FAIL");
      evidence.push(`Barometric pressure ${pres} hPa outside plausible operational bounds`);
      ruleScore += 0.5;
    }

    // 2. Rate of Change Checks (against last history point)
    const stHistory = (history && history[stationId]) || [];
    if (stHistory.length > 0) {
      const lastPoint = stHistory[stHistory.length - 1];
      const deltaT = Math.abs(temp - (lastPoint?.temperature ?? temp));
      if (deltaT > (config.temp_max_rate ?? 5.0)) {
        reasons.push("RATE_FAIL");
        evidence.push(`Temperature rate-of-change ${deltaT.toFixed(1)}°C exceeds threshold ${config.temp_max_rate}°C`);
        ruleScore += 0.45;
      }
    }

    // 3. Flatline & Stuck Value Checks
    const flatWindow = config.flatline_window ?? 6;
    if (stHistory.length >= flatWindow) {
      const recentTemps = stHistory.slice(-flatWindow).map(p => p.temperature);
      const isFlat = recentTemps.every(val => Math.abs(val - temp) < 0.05);
      if (isFlat) {
        reasons.push("FLATLINE");
        evidence.push(`Temperature stuck invariant at ${temp}°C across ${flatWindow} consecutive sample cycles`);
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
    if (battery < 11.8) {
      reasons.push("POWER_LOW");
      evidence.push(`Battery voltage ${battery}V critically low (< 11.8V); ADC sensor readings untrusted`);
      healthScore += 0.8;
    } else if (battery < 12.2) {
      healthScore += 0.35;
    }

    if (signal < -95) {
      reasons.push("COMMUNICATION_GAP");
      evidence.push(`Cellular RSSI ${signal} dBm indicates high packet degradation risk`);
      healthScore += 0.4;
    }

    // 6. Nearby Station Spatial Intelligence
    const stList = Array.isArray(stations) ? stations : [];
    const station = stList.find(s => s.id === stationId);
    if (station && station.lat !== undefined && station.lon !== undefined && spatialEngine) {
      try {
        const targetObj = {
          ...station,
          sensors: {
            ...station.sensors,
            temperature: { value: temp },
            humidity: { value: hum },
            pressure: { value: pres },
            rainfall: { value: rain }
          }
        };
        const nearby = spatialEngine.findNearbyStations({
          targetStation: targetObj,
          stations: stList,
          radiusKm: config.spatial_radius_km || 50,
          maxAgeSeconds: 300
        });
        const spatialDev = spatialEngine.computeSpatialDeviation({ targetStation: targetObj, nearbyStations: nearby });

        if (spatialDev.available && spatialDev.nearby_count > 0) {
          spatialScore = spatialDev.spatial_deviation_score;
          if (!spatialDev.spatially_consistent) {
            reasons.push("SPATIAL_OUTLIER");
            evidence.push(`Station temp ${temp}°C deviates ${spatialDev.residual_temp}°C from nearby peer median (${spatialDev.neighborhood_median_temp}°C across ${spatialDev.nearby_count} stations within radius)`);
          }
        }
      } catch (err) {}
    }

    // 7. Station-Specific ML Model Inference
    let modelScore = 0.0;
    let effectiveRuleWeight = config.rule_weight ?? 0.35;
    let effectiveModelWeight = config.model_weight ?? 0.35;

    if (stationMlResult && stationMlResult.has_model) {
      modelScore = stationMlResult.anomaly_score;
      if (stationMlResult.is_anomaly) {
        reasons.push("ML_ISOLATION_OUTLIER");
        evidence.push(`Station model ${stationMlResult.model_id} flagged anomaly (score: ${modelScore.toFixed(3)} >= threshold ${stationMlResult.threshold})`);
      }
    } else {
      effectiveRuleWeight = (config.rule_weight ?? 0.35) + (config.model_weight ?? 0.35);
      effectiveModelWeight = 0.0;
    }

    // 8. Weather Event Coherence Gate
    if (rain > 30.0 && hum > 85.0 && wind > 30.0) {
      coherenceScore = 0.88;
      evidence.push(`Multi-sensor storm signature detected (Rain: ${rain}mm, Hum: ${hum}%, Wind: ${wind}km/h). Coherence validated.`);
    }

    // 9. Multi-Signal Evidence Fusion Formula
    const faultRisk = +(
      effectiveRuleWeight * Math.min(1.0, ruleScore) +
      effectiveModelWeight * modelScore +
      (config.spatial_weight ?? 0.20) * spatialScore +
      (config.health_weight ?? 0.10) * healthScore
    ).toFixed(2);

    // 10. Quality State Disposition
    let qualityState = "ACCEPTED";
    let severity = "low";

    if (coherenceScore >= (config.extreme_coherence_threshold ?? 0.85)) {
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

  // Alias method for concise calling
  evaluate(measurements, health, qcConfig, history, stations, stationMlResult = null, stationId = null) {
    const sId = stationId || (stations && stations[0]?.id) || 'AWS-DEFAULT';
    return this.evaluateObservation(sId, measurements, health, qcConfig, history, stations, stationMlResult);
  }
}

export const qcEngine = new QCEngine();
