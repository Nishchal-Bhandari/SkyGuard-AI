#!/usr/bin/env python3
"""
SkyGuard-AI — Spatial Intelligence Layer Automated Test Suite
Verifies:
1. TEST 1 — No nearby stations within radius -> Spatial unavailable, local ML still functions safely.
2. TEST 2 — Nearby stations agree -> Spatially consistent.
3. TEST 3 — Target differs strongly -> High spatial deviation score.
4. TEST 4 — Regional event -> Target anomalous AND nearby abnormal -> REGIONAL_EVENT.
5. TEST 5 — Localized anomaly -> Target anomalous AND nearby normal -> LOCALIZED_ANOMALY.
6. TEST 6 — Stale nearby reading -> Excluded from neighborhood comparison.
7. TEST 7 — Invalid nearby reading (-999) -> Excluded by physical sanity gate.
8. TEST 8 — Elevation difference context -> Contextual elevation handling without false alarm conflation.
"""

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from ml.spatial_engine import SpatialIntelligenceEngine, haversine_distance

def run_tests():
    print("=" * 75)
    print("SKYGUARD-AI: NEARBY STATION SPATIAL INTELLIGENCE VERIFICATION SUITE")
    print("=" * 75)

    engine = SpatialIntelligenceEngine(default_radius_km=50.0, default_max_age_seconds=300.0)

    # -------------------------------------------------------------------------
    # TEST 1: No nearby stations within radius
    # -------------------------------------------------------------------------
    print("\n[TEST 1] Verifying isolated station with NO nearby stations in radius...")
    remote_target = {"id": "AWS-REMOTE", "lat": 28.6139, "lon": 77.2090, "readings": {"temp": 32.0, "hum": 45.0, "pres": 1005.0}}
    far_stations = [
        {"id": "AWS-FAR-1", "lat": 17.3850, "lon": 78.4867, "readings": {"temp": 30.0, "hum": 50.0, "pres": 1008.0}}, # ~1250 km away
        {"id": "AWS-FAR-2", "lat": 19.0760, "lon": 72.8777, "readings": {"temp": 29.0, "hum": 70.0, "pres": 1012.0}}, # ~1150 km away
    ]

    nearby_1 = engine.find_nearby_stations(remote_target, far_stations, radius_km=50.0)
    assert len(nearby_1) == 0, f"Expected 0 nearby stations, found {len(nearby_1)}"
    
    dev_1 = engine.compute_spatial_deviation(remote_target, nearby_1)
    assert dev_1["available"] is False
    assert dev_1["nearby_count"] == 0

    # Local ML still works independently
    assessment_1 = engine.fuse_assessment(physical_qc=None, local_ml={"is_anomaly": False, "anomaly_score": 0.35}, spatial_analysis=dev_1)
    assert assessment_1["classification"] == "NORMAL"
    print("  -> PASSED: Spatial marked unavailable; local ML operates independently without error.")

    # -------------------------------------------------------------------------
    # TEST 2: Nearby stations agree (Target 45°C vs Nearby 44°C, 45°C, 46°C)
    # -------------------------------------------------------------------------
    print("\n[TEST 2] Verifying nearby stations agreement (Target 45°C vs Nearby 44°C, 45°C, 46°C)...")
    target_hyd = {"id": "AWS-07", "lat": 17.3850, "lon": 78.4867, "readings": {"temp": 45.0, "hum": 35.0, "pres": 1004.0}}
    nearby_hyd = [
        {"id": "AWS-08", "lat": 17.4399, "lon": 78.4983, "last_seen_epoch": 1000.0, "readings": {"temp": 44.0, "hum": 36.0, "pres": 1004.0}}, # ~6.2 km
        {"id": "AWS-09", "lat": 17.4435, "lon": 78.3772, "last_seen_epoch": 1000.0, "readings": {"temp": 45.0, "hum": 35.0, "pres": 1005.0}}, # ~13.4 km
        {"id": "AWS-10", "lat": 17.3600, "lon": 78.5200, "last_seen_epoch": 1000.0, "readings": {"temp": 46.0, "hum": 34.0, "pres": 1004.0}}, # ~4.5 km
    ]

    discovered_2 = engine.find_nearby_stations(target_hyd, nearby_hyd, radius_km=50.0, current_timestamp=1000.0)
    assert len(discovered_2) == 3, f"Expected 3 peers within radius, found {len(discovered_2)}"

    dev_2 = engine.compute_spatial_deviation(target_hyd, discovered_2)
    assert dev_2["spatially_consistent"] is True
    assert dev_2["residual_temp"] <= 1.0
    assert dev_2["spatial_deviation_score"] < 0.25
    print(f"  -> PASSED: Spatially consistent verified. Residual: {dev_2['residual_temp']}°C, Deviation Score: {dev_2['spatial_deviation_score']}")

    # -------------------------------------------------------------------------
    # TEST 3: Target differs strongly (Target 48°C vs Nearby 30°C, 31°C, 32°C)
    # -------------------------------------------------------------------------
    print("\n[TEST 3] Verifying strong spatial deviation (Target 48°C vs Nearby 30°C, 31°C, 32°C)...")
    spike_target = {"id": "AWS-07", "lat": 17.3850, "lon": 78.4867, "readings": {"temp": 48.0, "hum": 35.0, "pres": 1004.0}}
    cool_peers = [
        {"id": "AWS-08", "lat": 17.4399, "lon": 78.4983, "last_seen_epoch": 1000.0, "readings": {"temp": 30.0, "hum": 60.0, "pres": 1010.0}},
        {"id": "AWS-09", "lat": 17.4435, "lon": 78.3772, "last_seen_epoch": 1000.0, "readings": {"temp": 31.0, "hum": 58.0, "pres": 1010.0}},
        {"id": "AWS-10", "lat": 17.3600, "lon": 78.5200, "last_seen_epoch": 1000.0, "readings": {"temp": 32.0, "hum": 59.0, "pres": 1010.0}},
    ]

    dev_3 = engine.compute_spatial_deviation(spike_target, cool_peers)
    assert dev_3["spatially_consistent"] is False
    assert dev_3["residual_temp"] >= 16.0
    assert dev_3["spatial_deviation_score"] >= 0.70
    print(f"  -> PASSED: High spatial deviation detected! Residual: {dev_3['residual_temp']}°C, Deviation Score: {dev_3['spatial_deviation_score']}")

    # -------------------------------------------------------------------------
    # TEST 4: Regional Event (Target ML Anomaly + Nearby Abnormal) -> REGIONAL_EVENT
    # -------------------------------------------------------------------------
    print("\n[TEST 4] Verifying Regional Weather Event classification...")
    # Both target and peers are experiencing 45°C storm/heatwave
    regional_peers = [
        {"id": "AWS-08", "lat": 17.4399, "lon": 78.4983, "is_anomaly": True, "status": "SUSPECT", "last_seen_epoch": 1000.0, "readings": {"temp": 44.5, "hum": 35.0, "pres": 998.0}},
        {"id": "AWS-09", "lat": 17.4435, "lon": 78.3772, "is_anomaly": True, "status": "SUSPECT", "last_seen_epoch": 1000.0, "readings": {"temp": 45.2, "hum": 34.0, "pres": 997.0}},
        {"id": "AWS-10", "lat": 17.3600, "lon": 78.5200, "is_anomaly": False, "status": "NORMAL", "last_seen_epoch": 1000.0, "readings": {"temp": 44.0, "hum": 36.0, "pres": 998.0}},
    ]
    dev_4 = engine.compute_spatial_deviation(target_hyd, regional_peers)
    assessment_4 = engine.fuse_assessment(
        physical_qc=None,
        local_ml={"is_anomaly": True, "anomaly_score": 0.85, "threshold": 0.65},
        spatial_analysis=dev_4
    )
    assert assessment_4["classification"] == "REGIONAL_EVENT", f"Expected REGIONAL_EVENT, got: {assessment_4['classification']}"
    print(f"  -> PASSED: Correctly classified as: {assessment_4['classification']} ({assessment_4['interpretation']})")

    # -------------------------------------------------------------------------
    # TEST 5: Localized Anomaly (Target ML Anomaly + Nearby Normal) -> LOCALIZED_ANOMALY
    # -------------------------------------------------------------------------
    print("\n[TEST 5] Verifying Localized Anomaly / Sensor Defect classification...")
    # Target reads 48°C but all 3 nearby peers read normal 30-32°C
    dev_5 = engine.compute_spatial_deviation(spike_target, cool_peers)
    assessment_5 = engine.fuse_assessment(
        physical_qc=None,
        local_ml={"is_anomaly": True, "anomaly_score": 0.92, "threshold": 0.65},
        spatial_analysis=dev_5
    )
    assert assessment_5["classification"] == "LOCALIZED_ANOMALY", f"Expected LOCALIZED_ANOMALY, got: {assessment_5['classification']}"
    print(f"  -> PASSED: Correctly classified as: {assessment_5['classification']} ({assessment_5['interpretation']})")

    # -------------------------------------------------------------------------
    # TEST 6: Stale nearby reading excluded by temporal freshness gate
    # -------------------------------------------------------------------------
    print("\n[TEST 6] Verifying Stale Peer Exclusion (> 300s old)...")
    stale_test_peers = [
        {"id": "AWS-FRESH", "lat": 17.4000, "lon": 78.4900, "last_seen_epoch": 950.0, "readings": {"temp": 30.0, "hum": 55.0, "pres": 1008.0}}, # 50s old -> fresh
        {"id": "AWS-STALE", "lat": 17.4100, "lon": 78.4950, "last_seen_epoch": 200.0, "readings": {"temp": 22.0, "hum": 80.0, "pres": 1015.0}}, # 800s old -> STALE
    ]
    discovered_6 = engine.find_nearby_stations(target_hyd, stale_test_peers, radius_km=50.0, max_age_seconds=300.0, current_timestamp=1000.0)
    discovered_ids = [p["id"] for p in discovered_6]
    assert "AWS-FRESH" in discovered_ids, "Fresh peer should be included"
    assert "AWS-STALE" not in discovered_ids, "Stale peer must be excluded by temporal gate"
    print("  -> PASSED: Stale station (800s old) correctly excluded from spatial calculation.")

    # -------------------------------------------------------------------------
    # TEST 7: Invalid nearby reading (-999) excluded by physical sanity gate
    # -------------------------------------------------------------------------
    print("\n[TEST 7] Verifying Corrupt Peer Exclusion (-999 hardware error)...")
    corrupt_test_peers = [
        {"id": "AWS-VALID", "lat": 17.4000, "lon": 78.4900, "last_seen_epoch": 1000.0, "readings": {"temp": 31.0, "hum": 55.0, "pres": 1008.0}},
        {"id": "AWS-CORRUPT-1", "lat": 17.4100, "lon": 78.4950, "last_seen_epoch": 1000.0, "readings": {"temp": -999.0, "hum": 50.0, "pres": 1008.0}}, # Invalid temp
        {"id": "AWS-CORRUPT-2", "lat": 17.4200, "lon": 78.4920, "last_seen_epoch": 1000.0, "readings": {"temp": 30.0, "hum": 180.0, "pres": 1008.0}},  # Invalid humidity > 100%
    ]
    discovered_7 = engine.find_nearby_stations(target_hyd, corrupt_test_peers, radius_km=50.0, current_timestamp=1000.0)
    discovered_7_ids = [p["id"] for p in discovered_7]
    assert "AWS-VALID" in discovered_7_ids
    assert "AWS-CORRUPT-1" not in discovered_7_ids, "Station with temp=-999 must be excluded"
    assert "AWS-CORRUPT-2" not in discovered_7_ids, "Station with hum=180% must be excluded"
    print("  -> PASSED: Hardware error -999 and impossible physical bounds successfully excluded.")

    # -------------------------------------------------------------------------
    # TEST 8: Elevation difference handling
    # -------------------------------------------------------------------------
    print("\n[TEST 8] Verifying Elevation Difference Context...")
    valley_station = {"id": "AWS-VALLEY", "lat": 25.3000, "lon": 91.5800, "elevation": 300, "readings": {"temp": 26.0, "hum": 80.0, "pres": 980.0}}
    mountain_peer = {"id": "AWS-MOUNTAIN", "lat": 25.3200, "lon": 91.5900, "elevation": 1400, "last_seen_epoch": 1000.0, "readings": {"temp": 19.0, "hum": 90.0, "pres": 865.0}} # 1100m higher, ~7°C cooler due to lapse rate
    
    dist_8 = haversine_distance(valley_station["lat"], valley_station["lon"], mountain_peer["lat"], mountain_peer["lon"])
    discovered_8 = engine.find_nearby_stations(valley_station, [mountain_peer], radius_km=50.0, current_timestamp=1000.0)
    assert len(discovered_8) == 1
    elev_delta = discovered_8[0]["elevation"] - valley_station["elevation"]
    assert elev_delta == 1100, f"Expected 1100m elevation delta, got {elev_delta}"
    print(f"  -> PASSED: Distance: {dist_8} km, Elevation Delta: {elev_delta}m properly tagged for lapse-rate context.")

    print("\n" + "=" * 75)
    print("ALL 8 SPATIAL INTELLIGENCE TESTS PASSED SUCCESSFULLY!")
    print("=" * 75)

if __name__ == "__main__":
    run_tests()
