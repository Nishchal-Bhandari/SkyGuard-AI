#!/usr/bin/env python3
"""
SkyGuard-AI — Station-Adaptive ML Pipeline (Python Engine)
Zero Universal Models Principle:
Trains, persists, and performs inference with dedicated Isolation Forest models per Station ID.
Uses strictly 3 atmospheric parameters (T, P, RH) + thermodynamic features + TreeSHAP explainability.
Pure Python zero-dependency execution.
"""

import math
import random
import json
import hashlib
import os
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional

from ml.thermo_engine import thermo_engine
from ml.shap_engine import TreeSHAPEngine


def c_factor(n: int) -> float:
    """Average path length of unsuccessful search in a Binary Search Tree (BST)."""
    if n <= 1:
        return 1.0
    if n == 2:
        return 1.0
    euler = 0.5772156649
    return 2.0 * (math.log(n - 1) + euler) - (2.0 * (n - 1)) / n


class IsolationTreeNode:
    def __init__(self, is_leaf=False, size=0, split_feature=None, split_value=None, left=None, right=None):
        self.is_leaf = is_leaf
        self.size = size
        self.split_feature = split_feature
        self.split_value = split_value
        self.left = left
        self.right = right

    def to_dict(self):
        if self.is_leaf:
            return {"is_leaf": True, "size": self.size}
        return {
            "is_leaf": False,
            "size": self.size,
            "split_feature": self.split_feature,
            "split_value": round(self.split_value, 4) if self.split_value is not None else None,
            "left": self.left.to_dict() if self.left else None,
            "right": self.right.to_dict() if self.right else None,
        }

    @classmethod
    def from_dict(cls, d):
        if not d:
            return None
        if d.get("is_leaf", False):
            return cls(is_leaf=True, size=d.get("size", 0))
        return cls(
            is_leaf=False,
            size=d.get("size", 0),
            split_feature=d.get("split_feature"),
            split_value=d.get("split_value"),
            left=cls.from_dict(d.get("left")),
            right=cls.from_dict(d.get("right")),
        )


class IsolationTree:
    def __init__(self, max_height: int):
        self.max_height = max_height
        self.root = None

    def fit(self, X, current_height=0):
        n_samples = len(X)
        if n_samples <= 1 or current_height >= self.max_height:
            return IsolationTreeNode(is_leaf=True, size=n_samples)

        n_features = len(X[0])
        valid_features = []
        for f in range(n_features):
            vals = [row[f] for row in X]
            f_min, f_max = min(vals), max(vals)
            if f_max > f_min:
                valid_features.append((f, f_min, f_max))

        if not valid_features:
            return IsolationTreeNode(is_leaf=True, size=n_samples)

        feat_idx, f_min, f_max = random.choice(valid_features)
        split_val = f_min + random.random() * (f_max - f_min)

        left_data = [row for row in X if row[feat_idx] < split_val]
        right_data = [row for row in X if row[feat_idx] >= split_val]

        left_node = self.fit(left_data, current_height + 1)
        right_node = self.fit(right_data, current_height + 1)

        return IsolationTreeNode(
            is_leaf=False,
            size=n_samples,
            split_feature=feat_idx,
            split_value=split_val,
            left=left_node,
            right=right_node,
        )

    def path_length(self, x, node, current_depth=0) -> float:
        if node is None or node.is_leaf:
            return current_depth + (c_factor(node.size) if node else 0.0)
        if x[node.split_feature] < node.split_value:
            return self.path_length(x, node.left, current_depth + 1)
        else:
            return self.path_length(x, node.right, current_depth + 1)


class IsolationForest:
    def __init__(self, n_trees=50, sub_sample_size=128, random_seed=42):
        self.n_trees = n_trees
        self.sub_sample_size = sub_sample_size
        self.random_seed = random_seed
        self.trees = []
        self.sub_sample_actual = 128
        self.threshold = 0.65

    def fit(self, X):
        random.seed(self.random_seed)
        n_samples = len(X)
        self.sub_sample_actual = min(self.sub_sample_size, n_samples)
        max_height = math.ceil(math.log2(max(self.sub_sample_actual, 2)))

        self.trees = []
        for _ in range(self.n_trees):
            sub_indices = random.sample(range(n_samples), self.sub_sample_actual)
            sub_data = [X[i] for i in sub_indices]
            tree = IsolationTree(max_height)
            tree.root = tree.fit(sub_data, 0)
            self.trees.append(tree)

        scores = [self.score_sample(row) for row in X]
        scores.sort()
        p95_idx = int(len(scores) * 0.95)
        self.threshold = round(scores[p95_idx] if p95_idx < len(scores) else 0.65, 3)
        return self

    def score_sample(self, x) -> float:
        if not self.trees:
            return 0.0
        total_path = sum(t.path_length(x, t.root, 0) for t in self.trees)
        avg_path = total_path / len(self.trees)
        c_val = c_factor(self.sub_sample_actual)
        if c_val == 0:
            return 0.0
        score = math.pow(2.0, -avg_path / c_val)
        return round(score, 3)

    def to_dict(self):
        return {
            "n_trees": self.n_trees,
            "sub_sample_actual": self.sub_sample_actual,
            "threshold": self.threshold,
            "trees": [t.root.to_dict() for t in self.trees if t.root],
        }

    @classmethod
    def from_dict(cls, d):
        inst = cls(n_trees=d.get("n_trees", 50))
        inst.sub_sample_actual = d.get("sub_sample_actual", 128)
        inst.threshold = d.get("threshold", 0.65)
        inst.trees = []
        for t_dict in d.get("trees", []):
            tree = IsolationTree(max_height=10)
            tree.root = IsolationTreeNode.from_dict(t_dict)
            inst.trees.append(tree)
        return inst


class StationAdaptiveMLPipeline:
    def __init__(self, storage_dir="ml/models"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        # Strictly 3-Parameter + Thermodynamic features:
        self.feature_names = [
            "temperature_norm",
            "humidity_norm",
            "pressure_norm",
            "vapor_pressure_deficit_norm",
            "dew_point_depr_norm",
            "temp_rate_of_change",
            "diurnal_hour_sin",
            "diurnal_hour_cos",
        ]

    def preprocess_dataset(self, rows):
        valid = []
        scrubbed = 0
        def get_val(r, *keys, default=-9999.0):
            for k in keys:
                v = r.get(k)
                if v is not None and v != "":
                    try:
                        return float(v)
                    except (ValueError, TypeError):
                        pass
            return float(default)

        for r in rows:
            temp = get_val(r, "temperature_c", "temperature", "temp", default=-9999.0)
            hum = get_val(r, "humidity_pct", "humidity", "hum", default=-9999.0)
            pres = get_val(r, "pressure_hpa", "pressure", "pres", default=-9999.0)
            hour = int(get_val(r, "hour", default=12))

            # Exclude hardware error flags and impossible physical bounds
            if temp < -50 or temp > 65 or hum < 0 or hum > 105 or pres < 700 or pres > 1150:
                scrubbed += 1
                continue

            valid.append({"temp": temp, "hum": hum, "pres": pres, "hour": hour})

        return valid, scrubbed

    def engineer_features(self, valid_rows):
        if not valid_rows:
            return [], {}

        n = len(valid_rows)
        temps = [r["temp"] for r in valid_rows]
        hums = [r["hum"] for r in valid_rows]
        press = [r["pres"] for r in valid_rows]

        t_mean = sum(temps) / n
        t_std = math.sqrt(sum((x - t_mean) ** 2 for x in temps) / n) or 1.0
        h_mean = sum(hums) / n
        h_std = math.sqrt(sum((x - h_mean) ** 2 for x in hums) / n) or 1.0
        p_mean = sum(press) / n
        p_std = math.sqrt(sum((x - p_mean) ** 2 for x in press) / n) or 1.0

        # Compute thermodynamic VPD and Dew point statistics
        vpds = [thermo_engine.vapor_pressure_deficit(r["temp"], r["hum"]) for r in valid_rows]
        vpd_mean = sum(vpds) / n
        vpd_std = math.sqrt(sum((x - vpd_mean) ** 2 for x in vpds) / n) or 1.0

        dew_deprs = [max(0.0, r["temp"] - thermo_engine.dew_point(r["temp"], r["hum"])) for r in valid_rows]
        dew_mean = sum(dew_deprs) / n
        dew_std = math.sqrt(sum((x - dew_mean) ** 2 for x in dew_deprs) / n) or 1.0

        stats = {
            "t_mean": t_mean, "t_std": t_std,
            "h_mean": h_mean, "h_std": h_std,
            "p_mean": p_mean, "p_std": p_std,
            "vpd_mean": vpd_mean, "vpd_std": vpd_std,
            "dew_mean": dew_mean, "dew_std": dew_std,
        }

        X = []
        for i, r in enumerate(valid_rows):
            prev_t = valid_rows[i - 1]["temp"] if i > 0 else r["temp"]
            temp_diff = (r["temp"] - prev_t) / t_std

            hour_rad = (2 * math.pi * r.get("hour", 12)) / 24.0
            sin_hour = math.sin(hour_rad)
            cos_hour = math.cos(hour_rad)

            vpd_val = vpds[i]
            dew_depr_val = dew_deprs[i]

            x_vec = [
                round((r["temp"] - t_mean) / t_std, 3),
                round((r["hum"] - h_mean) / h_std, 3),
                round((r["pres"] - p_mean) / p_std, 3),
                round((vpd_val - vpd_mean) / vpd_std, 3),
                round((dew_depr_val - dew_mean) / dew_std, 3),
                round(temp_diff, 3),
                round(sin_hour, 3),
                round(cos_hour, 3),
            ]
            X.append(x_vec)

        return X, stats

    def train_station_model(self, station_id: str, raw_rows: list, profile: dict = None, version="v1.0"):
        valid_rows, scrubbed = self.preprocess_dataset(raw_rows)
        if len(valid_rows) < 20:
            raise ValueError(f"Insufficient historical data for {station_id}: {len(valid_rows)} valid rows (min 20 required).")

        X, stats = self.engineer_features(valid_rows)
        iforest = IsolationForest(n_trees=40, sub_sample_size=min(128, len(valid_rows)))
        iforest.fit(X)

        model_id = f"{station_id}_IF_{version.replace('.', '_')}"
        sha_hash = hashlib.sha256(f"{station_id}_{version}_{iforest.threshold}".encode()).hexdigest()

        model_card = {
            "model_id": model_id,
            "station_id": station_id,
            "station_name": (profile or {}).get("name", station_id),
            "location": {
                "lat": (profile or {}).get("lat"),
                "lon": (profile or {}).get("lon"),
                "elevation": (profile or {}).get("elevation"),
                "region": (profile or {}).get("region", "Local"),
            },
            "algorithm": "Thermodynamic Isolation Forest with TreeSHAP",
            "version": version,
            "status": "PRODUCTION",
            "sha256": sha_hash,
            "training_summary": {
                "valid_records": len(valid_rows),
                "scrubbed_records": scrubbed,
                "dynamic_threshold": iforest.threshold,
                "features": self.feature_names,
            },
            "normalization_stats": stats,
        }

        # Persist model directory isolated per station
        station_dir = self.storage_dir / station_id
        station_dir.mkdir(parents=True, exist_ok=True)
        model_file = station_dir / f"{model_id}.json"
        
        full_artifact = {
            "model_card": model_card,
            "model_weights": iforest.to_dict(),
        }

        with open(model_file, "w") as f:
            json.dump(full_artifact, f, indent=2)

        return model_card, iforest

    def load_station_model(self, station_id: str, version="v1.0"):
        model_id = f"{station_id}_IF_{version.replace('.', '_')}"
        model_file = self.storage_dir / station_id / f"{model_id}.json"
        if not model_file.exists():
            return None, None

        with open(model_file, "r") as f:
            data = json.load(f)

        model_card = data["model_card"]
        iforest = IsolationForest.from_dict(data["model_weights"])
        return model_card, iforest

    def score_realtime(self, station_id: str, observation: dict, last_observation: dict = None, version="v1.0"):
        model_card, iforest = self.load_station_model(station_id, version)
        if not iforest:
            return {
                "station_id": station_id,
                "has_model": False,
                "status": "RULES_ONLY",
                "anomaly_score": 0.0,
                "reason": f"No active model found for {station_id}",
                "xai_explanation": None
            }

        stats = model_card["normalization_stats"]
        t = float(observation.get("temperature", observation.get("temp", stats["t_mean"])))
        h = float(observation.get("humidity", observation.get("hum", stats["h_mean"])))
        p = float(observation.get("pressure", observation.get("pres", stats["p_mean"])))
        hour = int(observation.get("hour", 12))

        prev_t = float(last_observation.get("temperature", last_observation.get("temp", t))) if last_observation else t
        t_diff = (t - prev_t) / stats["t_std"]

        # Compute thermodynamic inputs
        vpd = thermo_engine.vapor_pressure_deficit(t, h)
        td = thermo_engine.dew_point(t, h)
        dew_depr = max(0.0, t - td)

        hour_rad = (2 * math.pi * hour) / 24.0
        sin_hour = math.sin(hour_rad)
        cos_hour = math.cos(hour_rad)

        vpd_norm = (vpd - stats.get("vpd_mean", vpd)) / stats.get("vpd_std", 1.0)
        dew_depr_norm = (dew_depr - stats.get("dew_mean", dew_depr)) / stats.get("dew_std", 1.0)

        x = [
            (t - stats["t_mean"]) / stats["t_std"],
            (h - stats["h_mean"]) / stats["h_std"],
            (p - stats["p_mean"]) / stats["p_std"],
            vpd_norm,
            dew_depr_norm,
            t_diff,
            sin_hour,
            cos_hour,
        ]

        score = iforest.score_sample(x)
        threshold = model_card["training_summary"]["dynamic_threshold"]
        is_anomaly = score >= threshold

        # Execute TreeSHAP explainability on every inference call
        xai_result = TreeSHAPEngine.explain_instance(
            x_vector=x,
            trees=iforest.trees,
            sub_sample_size=iforest.sub_sample_actual,
            feature_names=self.feature_names,
            base_threshold=threshold
        )

        return {
            "station_id": station_id,
            "has_model": True,
            "model_id": model_card["model_id"],
            "anomaly_score": score,
            "threshold": threshold,
            "status": "ANOMALY" if is_anomaly else "NORMAL",
            "is_anomaly": is_anomaly,
            "xai_explanation": xai_result,
            "feature_vector": x
        }


station_adaptive_pipeline = StationAdaptiveMLPipeline()
