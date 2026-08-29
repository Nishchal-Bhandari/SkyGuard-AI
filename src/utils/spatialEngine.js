/**
 * SkyGuard-AI — Nearby Station Spatial Intelligence Engine
 * 
 * Provides:
 * 1. Geodetic distance computation using the Haversine formula.
 * 2. Nearby peer discovery with configurable radius and temporal freshness gating.
 * 3. Robust neighborhood statistics (Median, Median Absolute Deviation [MAD], residuals).
 * 4. Multi-signal fusion combining Station-Adaptive ML with Neighborhood Spatial Consensus
 *    to classify events into NORMAL, LOCALIZED_ANOMALY, or REGIONAL_EVENT.
 */

/**
 * Calculates great-circle distance between two geographic coordinates using Haversine formula.
 * @param {number} lat1 Latitude of point 1 in degrees
 * @param {number} lon1 Longitude of point 1 in degrees
 * @param {number} lat2 Latitude of point 2 in degrees
 * @param {number} lon2 Longitude of point 2 in degrees
 * @returns {number} Distance in kilometers
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) {
    return Infinity;
  }
  const R = 6371.0; // Earth's mean radius in km
  const toRad = (deg) => (deg * Math.PI) / 180.0;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const radLat1 = toRad(lat1);
  const radLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));

  return +(R * c).toFixed(2);
}

/**
 * Robust median calculation
 */
function getMedian(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0;
}

/**
 * Robust Median Absolute Deviation (MAD)
 */
function getMAD(arr, median) {
  if (!arr || arr.length === 0) return 0;
  const deviations = arr.map((x) => Math.abs(x - median));
  return getMedian(deviations);
}

export class SpatialIntelligenceEngine {
  constructor({ defaultRadiusKm = 50, defaultMaxAgeSeconds = 300 } = {}) {
    this.defaultRadiusKm = defaultRadiusKm;
    this.defaultMaxAgeSeconds = defaultMaxAgeSeconds;
  }

  /**
   * Discovers eligible nearby stations within radius and passing freshness/sanity gates.
   */
  findNearbyStations({ targetStation, stations, radiusKm = this.defaultRadiusKm, maxAgeSeconds = this.defaultMaxAgeSeconds }) {
    if (!targetStation || !stations || stations.length <= 1) {
      return [];
    }

    const now = Date.now();
    const nearby = [];

    for (const st of stations) {
      // Exclude self
      if (st.id === targetStation.id) continue;

      // Coordinate check
      if (st.lat === undefined || st.lon === undefined) continue;

      // Distance calculation
      const dist = haversineDistance(targetStation.lat, targetStation.lon, st.lat, st.lon);
      if (dist > radiusKm) continue;

      // Temporal Freshness Gate: exclude stale dataloggers
      if (st.last_seen) {
        const lastSeenMs = new Date(st.last_seen).getTime();
        if (!isNaN(lastSeenMs)) {
          const ageSeconds = (now - lastSeenMs) / 1000.0;
          if (ageSeconds > maxAgeSeconds) {
            continue; // Stale observation excluded
          }
        }
      }

      // Physical Sanity Gate: Exclude stations reporting hardware error codes (-999, out of bounds)
      const temp = st.sensors?.temperature?.value;
      const hum = st.sensors?.humidity?.value;
      if (temp === undefined || isNaN(temp) || temp < -40 || temp > 65 || hum < 0 || hum > 100) {
        continue; // Corrupt/broken peer excluded from baseline
      }

      nearby.push({
        id: st.id,
        name: st.name,
        region: st.region,
        distance_km: dist,
        lat: st.lat,
        lon: st.lon,
        elevation: st.elevation || 0,
        temp,
        hum: st.sensors?.humidity?.value ?? 60,
        pres: st.sensors?.pressure?.value ?? 1010,
        wind: st.sensors?.wind_speed?.value ?? 10,
        rain: st.sensors?.rainfall?.value ?? 0,
        status: st.status || 'NORMAL',
        ml_model: st.ml_model || null
      });
    }

    // Sort by proximity
    nearby.sort((a, b) => a.distance_km - b.distance_km);
    return nearby;
  }

  /**
   * Computes robust neighborhood statistics and spatial deviation score.
   */
  computeSpatialDeviation({ targetStation, nearbyStations }) {
    if (!nearbyStations || nearbyStations.length === 0) {
      return {
        available: false,
        nearby_count: 0,
        spatial_deviation_score: 0.0,
        spatially_consistent: true,
        reason: "No fresh nearby stations within radius"
      };
    }

    const targetTemp = targetStation.sensors?.temperature?.value ?? 25;
    const targetHum = targetStation.sensors?.humidity?.value ?? 60;
    const targetPres = targetStation.sensors?.pressure?.value ?? 1010;
    const targetRain = targetStation.sensors?.rainfall?.value ?? 0;

    const peerTemps = nearbyStations.map(p => p.temp);
    const peerHums = nearbyStations.map(p => p.hum);
    const peerPress = nearbyStations.map(p => p.pres);
    const peerRains = nearbyStations.map(p => p.rain);

    const medianTemp = getMedian(peerTemps);
    const madTemp = getMAD(peerTemps, medianTemp) || 1.0;
    const residualTemp = Math.abs(targetTemp - medianTemp);

    const medianHum = getMedian(peerHums);
    const residualHum = Math.abs(targetHum - medianHum);

    const medianPres = getMedian(peerPress);
    const residualPres = Math.abs(targetPres - medianPres);

    // Multi-variable normalized deviation
    const tempDev = Math.min(1.0, residualTemp / 5.0); // 5°C delta = 1.0
    const humDev = Math.min(1.0, residualHum / 25.0);  // 25% hum delta = 1.0
    const presDev = Math.min(1.0, residualPres / 6.0); // 6 hPa delta = 1.0

    // Composite spatial deviation score
    const spatialDevScore = +(0.55 * tempDev + 0.25 * humDev + 0.20 * presDev).toFixed(3);
    const spatiallyConsistent = residualTemp <= 3.0 && spatialDevScore < 0.50;

    // Check if nearby stations themselves are exhibiting anomalous weather
    const anomalousPeers = nearbyStations.filter(p => p.ml_model?.is_anomaly || p.status === 'SUSPECT' || p.status === 'EXTREME');
    const peerAnomalyRatio = +(anomalousPeers.length / nearbyStations.length).toFixed(2);

    return {
      available: true,
      nearby_count: nearbyStations.length,
      spatial_deviation_score: spatialDevScore,
      spatially_consistent: spatiallyConsistent,
      neighborhood_median_temp: +medianTemp.toFixed(1),
      neighborhood_mad_temp: +madTemp.toFixed(2),
      residual_temp: +residualTemp.toFixed(1),
      neighborhood_median_hum: +medianHum.toFixed(1),
      residual_hum: +residualHum.toFixed(1),
      peer_anomaly_ratio: peerAnomalyRatio,
      anomalous_peer_count: anomalousPeers.length,
      nearest_peer_id: nearbyStations[0]?.id || null,
      nearest_peer_distance_km: nearbyStations[0]?.distance_km || 0
    };
  }

  /**
   * Fuses Local Station ML with Spatial Neighborhood Consensus to determine final classification.
   */
  fuseAssessment({ physicalQc, localMl, spatialAnalysis }) {
    // 1. Physical Sanity Gate Always Overrides
    if (physicalQc?.fault_risk >= 0.85 && physicalQc?.reason_codes?.includes("RANGE_FAIL")) {
      return {
        classification: "PHYSICAL_SENSOR_FAILURE",
        badge_class: "badge-critical",
        confidence: "VERY_HIGH",
        interpretation: "Raw measurements breached universal physical plausibility bounds. Hardware failure suspected."
      };
    }

    // 2. Cold-start or Isolated Station with Zero Neighbors
    if (!spatialAnalysis?.available || spatialAnalysis.nearby_count === 0) {
      if (localMl?.is_anomaly) {
        return {
          classification: "LOCAL_ANOMALY_UNVERIFIED",
          badge_class: "badge-suspect",
          confidence: "MEDIUM",
          interpretation: "Station-specific model flagged anomaly; no nearby peers within radius for spatial verification."
        };
      }
      return {
        classification: "NORMAL",
        badge_class: "badge-normal",
        confidence: "HIGH",
        interpretation: "Observation nominal according to local station baseline (operating independently)."
      };
    }

    const isLocalAnomaly = !!localMl?.is_anomaly;
    const isSpatiallyConsistent = spatialAnalysis.spatially_consistent;
    const peerAnomalyRatio = spatialAnalysis.peer_anomaly_ratio || 0.0;

    // 3. Both Local Model and Spatial Neighbors Agree: NORMAL
    if (!isLocalAnomaly && isSpatiallyConsistent) {
      return {
        classification: "NORMAL",
        badge_class: "badge-normal",
        confidence: "HIGH",
        interpretation: "Readings consistent with both station historical baseline and nearby peer consensus."
      };
    }

    // 4. Local Model Flags Anomaly BUT Nearby Stations Experience Similar Conditions: REGIONAL WEATHER EVENT
    if (isLocalAnomaly && (isSpatiallyConsistent || peerAnomalyRatio >= 0.4)) {
      return {
        classification: "REGIONAL_EVENT",
        badge_class: "badge-extreme",
        confidence: "HIGH",
        interpretation: `Atmospheric excursion detected locally but corroborated by ${spatialAnalysis.nearby_count} nearby stations within radius. Consistent with regional weather event / storm.`
      };
    }

    // 5. Local Model Flags Anomaly AND Nearby Stations Are Normal: LOCALIZED ANOMALY (SENSOR DEFECT)
    if (isLocalAnomaly && !isSpatiallyConsistent) {
      return {
        classification: "LOCALIZED_ANOMALY",
        badge_class: "badge-critical",
        confidence: "HIGH",
        interpretation: `Local reading deviates ${spatialAnalysis.residual_temp}°C from peer median (${spatialAnalysis.neighborhood_median_temp}°C across ${spatialAnalysis.nearby_count} nearby stations). Likely localized sensor drift or hardware malfunction.`
      };
    }

    // 6. Local Model Normal BUT High Spatial Divergence (Microclimate gradient)
    return {
      classification: "MICROCLIMATE_GRADIENT",
      badge_class: "badge-suspect",
      confidence: "MODERATE",
      interpretation: "Station reading is normal for its own historical distribution, but diverges from nearby peers (terrain/elevation gradient)."
    };
  }

  /**
   * End-to-end neighborhood analysis for a given station.
   */
  analyzeStation({ targetStation, stations, radiusKm = this.defaultRadiusKm, maxAgeSeconds = this.defaultMaxAgeSeconds, localMl, physicalQc }) {
    const nearby = this.findNearbyStations({ targetStation, stations, radiusKm, maxAgeSeconds });
    const spatialDev = this.computeSpatialDeviation({ targetStation, nearbyStations: nearby });
    const assessment = this.fuseAssessment({ physicalQc, localMl, spatialAnalysis: spatialDev });

    return {
      search_radius_km: radiusKm,
      nearby_stations: nearby,
      spatial_analysis: spatialDev,
      final_assessment: assessment
    };
  }
}

export const spatialEngine = new SpatialIntelligenceEngine();
