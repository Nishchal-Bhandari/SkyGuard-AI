#!/usr/bin/env python3
"""
SkyGuard-AI — Spatial Intelligence Engine (Python Implementation)
Provides:
1. Geodetic distance using the Haversine formula.
2. Temporal freshness and physical sanity filtering of nearby peers.
3. Robust neighborhood statistics (Median, MAD, multi-variable residuals).
4. Dual-Track Anomaly Fusion combining Station-Adaptive ML with Spatial Consensus.
"""

import math
from typing import List, Dict, Any, Optional

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two geographic coordinates in kilometers."""
    if None in (lat1, lon1, lat2, lon2):
        return float("inf")
    R = 6371.0  # Earth's mean radius in km

    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    rad_lat1 = math.radians(lat1)
    rad_lat2 = math.radians(lat2)

    a = (math.sin(d_lat / 2.0) ** 2) + math.cos(rad_lat1) * math.cos(rad_lat2) * (math.sin(d_lon / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 2)


def get_median(arr: List[float]) -> float:
    if not arr:
        return 0.0
    s = sorted(arr)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 != 0 else (s[mid - 1] + s[mid]) / 2.0


def get_mad(arr: List[float], median: float) -> float:
    if not arr:
        return 0.0
    devs = [abs(x - median) for x in arr]
    return get_median(devs)


class SpatialIntelligenceEngine:
    def __init__(self, default_radius_km: float = 50.0, default_max_age_seconds: float = 300.0):
        self.default_radius_km = default_radius_km
        self.default_max_age_seconds = default_max_age_seconds

    def find_nearby_stations(
        self,
        target_station: Dict[str, Any],
        stations: List[Dict[str, Any]],
        radius_km: Optional[float] = None,
        max_age_seconds: Optional[float] = None,
        current_timestamp: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        radius = radius_km if radius_km is not None else self.default_radius_km
        max_age = max_age_seconds if max_age_seconds is not None else self.default_max_age_seconds
        now = current_timestamp if current_timestamp is not None else 1000000.0

        t_lat = target_station.get("lat")
        t_lon = target_station.get("lon")
        t_id = target_station.get("id")

        if t_lat is None or t_lon is None:
            return []

        nearby = []
        for st in stations:
            if st.get("id") == t_id:
                continue

            s_lat = st.get("lat")
            s_lon = st.get("lon")
            if s_lat is None or s_lon is None:
                continue

            dist = haversine_distance(t_lat, t_lon, s_lat, s_lon)
            if dist > radius:
                continue

            # Temporal Freshness Check
            last_seen = st.get("last_seen_epoch", now)
            age = now - last_seen
            if age > max_age:
                continue  # Exclude stale readings

            # Physical Sanity Check
            readings = st.get("readings", st.get("sensors", {}))
            temp = readings.get("temp", readings.get("temperature", None))
            hum = readings.get("hum", readings.get("humidity", None))

            if temp is None or temp < -40.0 or temp > 65.0:
                continue  # Exclude corrupted/invalid hardware readings
            if hum is not None and (hum < 0.0 or hum > 100.0):
                continue

            nearby.append({
                "id": st.get("id"),
                "name": st.get("name", st.get("id")),
                "distance_km": dist,
                "lat": s_lat,
                "lon": s_lon,
                "elevation": st.get("elevation", 0),
                "temp": float(temp),
                "hum": float(hum) if hum is not None else 60.0,
                "pres": float(readings.get("pres", readings.get("pressure", 1010.0))),
                "status": st.get("status", "NORMAL"),
                "is_anomaly": st.get("is_anomaly", False),
            })

        nearby.sort(key=lambda x: x["distance_km"])
        return nearby

    def compute_spatial_deviation(
        self,
        target_station: Dict[str, Any],
        nearby_stations: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        if not nearby_stations:
            return {
                "available": False,
                "nearby_count": 0,
                "spatial_deviation_score": 0.0,
                "spatially_consistent": True,
                "reason": "No fresh nearby stations within radius"
            }

        readings = target_station.get("readings", target_station.get("sensors", {}))
        target_temp = float(readings.get("temp", readings.get("temperature", 25.0)))
        target_hum = float(readings.get("hum", readings.get("humidity", 60.0)))
        target_pres = float(readings.get("pres", readings.get("pressure", 1010.0)))

        peer_temps = [float(p.get("temp", p.get("readings", {}).get("temp", 25.0))) for p in nearby_stations]
        peer_hums = [float(p.get("hum", p.get("readings", {}).get("hum", 60.0))) for p in nearby_stations]
        peer_press = [float(p.get("pres", p.get("readings", {}).get("pres", 1010.0))) for p in nearby_stations]

        med_temp = get_median(peer_temps)
        mad_temp = get_mad(peer_temps, med_temp) or 1.0
        res_temp = abs(target_temp - med_temp)

        med_hum = get_median(peer_hums)
        res_hum = abs(target_hum - med_hum)

        med_pres = get_median(peer_press)
        res_pres = abs(target_pres - med_pres)

        temp_dev = min(1.0, res_temp / 5.0)
        hum_dev = min(1.0, res_hum / 25.0)
        pres_dev = min(1.0, res_pres / 6.0)

        spatial_score = round(0.55 * temp_dev + 0.25 * hum_dev + 0.20 * pres_dev, 3)
        spatially_consistent = res_temp <= 3.0 and spatial_score < 0.50

        anomalous_peers = [p for p in nearby_stations if p.get("is_anomaly") or p.get("status") in ("SUSPECT", "EXTREME")]
        peer_anomaly_ratio = round(len(anomalous_peers) / len(nearby_stations), 2)

        return {
            "available": True,
            "nearby_count": len(nearby_stations),
            "spatial_deviation_score": spatial_score,
            "spatially_consistent": spatially_consistent,
            "neighborhood_median_temp": round(med_temp, 1),
            "neighborhood_mad_temp": round(mad_temp, 2),
            "residual_temp": round(res_temp, 1),
            "neighborhood_median_hum": round(med_hum, 1),
            "residual_hum": round(res_hum, 1),
            "peer_anomaly_ratio": peer_anomaly_ratio,
            "anomalous_peer_count": len(anomalous_peers),
            "nearest_peer_id": nearby_stations[0].get("id") if nearby_stations else None,
            "nearest_peer_distance_km": nearby_stations[0].get("distance_km", 0.0) if nearby_stations else 0.0,
        }

    def fuse_assessment(
        self,
        physical_qc: Optional[Dict[str, Any]],
        local_ml: Optional[Dict[str, Any]],
        spatial_analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        # 1. Physical QC Gate Always Overrides
        if physical_qc and physical_qc.get("fault_risk", 0.0) >= 0.85 and "RANGE_FAIL" in physical_qc.get("reason_codes", []):
            return {
                "classification": "PHYSICAL_SENSOR_FAILURE",
                "confidence": "VERY_HIGH",
                "interpretation": "Raw sensor reading breached universal physical plausibility envelope."
            }

        # 2. No Peers Available (Cold Start / Remote Station)
        if not spatial_analysis.get("available") or spatial_analysis.get("nearby_count", 0) == 0:
            if local_ml and local_ml.get("is_anomaly"):
                return {
                    "classification": "LOCAL_ANOMALY_UNVERIFIED",
                    "confidence": "MEDIUM",
                    "interpretation": "Local ML flagged anomaly; no nearby peers within radius for spatial corroboration."
                }
            return {
                "classification": "NORMAL",
                "confidence": "HIGH",
                "interpretation": "Nominal according to station baseline; operating without nearby spatial peers."
            }

        is_local_anomaly = bool(local_ml and local_ml.get("is_anomaly"))
        is_spatially_consistent = spatial_analysis.get("spatially_consistent", True)
        peer_anomaly_ratio = spatial_analysis.get("peer_anomaly_ratio", 0.0)

        # 3. Both Local Model and Spatial Peers Agree Nominal
        if not is_local_anomaly and is_spatially_consistent:
            return {
                "classification": "NORMAL",
                "confidence": "HIGH",
                "interpretation": "Readings consistent with both station historical baseline and nearby peer consensus."
            }

        # 4. Local Model Flags Anomaly BUT Nearby Stations Also Experience Similar Extreme Weather
        if is_local_anomaly and (is_spatially_consistent or peer_anomaly_ratio >= 0.4):
            return {
                "classification": "REGIONAL_EVENT",
                "confidence": "HIGH",
                "interpretation": f"Atmospheric excursion detected locally but corroborated by nearby peers within {spatial_analysis.get('nearby_count')} stations. Consistent with regional storm or front."
            }

        # 5. Local Model Flags Anomaly AND Nearby Stations Are Normal (Sensor Defect)
        if is_local_anomaly and not is_spatially_consistent:
            return {
                "classification": "LOCALIZED_ANOMALY",
                "confidence": "HIGH",
                "interpretation": f"Local reading deviates {spatial_analysis.get('residual_temp')}°C from peer median ({spatial_analysis.get('neighborhood_median_temp')}°C across {spatial_analysis.get('nearby_count')} nearby stations). Likely localized sensor drift or defect."
            }

        # 6. Local Model Normal BUT High Spatial Divergence
        return {
            "classification": "MICROCLIMATE_GRADIENT",
            "confidence": "MODERATE",
            "interpretation": "Station reading is normal for its own local history, but diverges from nearby peers (terrain or elevation gradient)."
        }
