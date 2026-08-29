#!/usr/bin/env python3
"""
SkyGuard-AI — Station-Adaptive ML Pipeline (Python Engine)
Zero Universal Models Principle:
Trains, persists, and performs inference with dedicated Isolation Forest models per Station ID.
Uses standard Python library (math, random, json, hashlib, pathlib) for 100% portable zero-dependency execution.
"""

import math
import random
import json
import hashlib
import os
from pathlib import Path

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
        self.feature_names = [
            "temperature_norm",
            "humidity_norm",
            "pressure_norm",
            "wind_speed_norm",
            "temp_diff_lag",
            "diurnal_hour_sin",
            "diurnal_hour_cos",
            "dew_point_depr_norm",
        ]

    def preprocess_dataset(self, rows):
        valid = []
        scrubbed = 0
        for r in rows:
            temp = float(r.get("temperature_c", r.get("temp", -9999)))
            hum = float(r.get("humidity_pct", r.get("hum", -9999)))
            pres = float(r.get("pressure_hpa", r.get("pres", -9999)))
            wind = float(r.get("wind_speed_kmh", r.get("wind", 10.0)))
            rain = float(r.get("rainfall_mm", r.get("rain", 0.0)))

            # Exclude hardware error flags and impossible physical bounds
            if temp < -40 or temp > 65 or hum < 0 or hum > 100 or pres < 750 or pres > 1100 or wind < 0 or wind > 250:
                scrubbed += 1
                continue

            valid.append({"temp": temp, "hum": hum, "pres": pres, "wind": wind, "rain": rain, "hour": 12})

        return valid, scrubbed

    def engineer_features(self, valid_rows):
        if not valid_rows:
            return [], {}

        n = len(valid_rows)
        temps = [r["temp"] for r in valid_rows]
        hums = [r["hum"] for r in valid_rows]
        press = [r["pres"] for r in valid_rows]
        winds = [r["wind"] for r in valid_rows]

        t_mean = sum(temps) / n
        t_std = math.sqrt(sum((x - t_mean) ** 2 for x in temps) / n) or 1.0
        h_mean = sum(hums) / n
        h_std = math.sqrt(sum((x - h_mean) ** 2 for x in hums) / n) or 1.0
        p_mean = sum(press) / n
        p_std = math.sqrt(sum((x - p_mean) ** 2 for x in press) / n) or 1.0
        w_mean = sum(winds) / n
        w_std = math.sqrt(sum((x - w_mean) ** 2 for x in winds) / n) or 1.0

        stats = {
            "t_mean": t_mean, "t_std": t_std,
            "h_mean": h_mean, "h_std": h_std,
            "p_mean": p_mean, "p_std": p_std,
            "w_mean": w_mean, "w_std": w_std,
        }

        X = []
        for i, r in enumerate(valid_rows):
            prev_t = valid_rows[i - 1]["temp"] if i > 0 else r["temp"]
            temp_diff = (r["temp"] - prev_t) / t_std

            hour_rad = (2 * math.pi * r["hour"]) / 24.0
            sin_hour = math.sin(hour_rad)
            cos_hour = math.cos(hour_rad)

            dew_approx = r["temp"] - ((100.0 - r["hum"]) / 5.0)
            dew_depr = max(0.0, r["temp"] - dew_approx) / 10.0

            x_vec = [
                round((r["temp"] - t_mean) / t_std, 3),
                round((r["hum"] - h_mean) / h_std, 3),
                round((r["pres"] - p_mean) / p_std, 3),
                round((r["wind"] - w_mean) / w_std, 3),
                round(temp_diff, 3),
                round(sin_hour, 3),
                round(cos_hour, 3),
                round(dew_depr, 3),
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
            "algorithm": "Isolation Forest",
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
            }

        stats = model_card["normalization_stats"]
        t = float(observation.get("temperature", observation.get("temp", stats["t_mean"])))
        h = float(observation.get("humidity", observation.get("hum", stats["h_mean"])))
        p = float(observation.get("pressure", observation.get("pres", stats["p_mean"])))
        w = float(observation.get("wind_speed", observation.get("wind", stats["w_mean"])))

        prev_t = float(last_observation.get("temperature", t)) if last_observation else t
        t_diff = (t - prev_t) / stats["t_std"]

        dew_approx = t - ((100.0 - h) / 5.0)
        dew_depr = max(0.0, t - dew_approx) / 10.0

        x = [
            (t - stats["t_mean"]) / stats["t_std"],
            (h - stats["h_mean"]) / stats["h_std"],
            (p - stats["p_mean"]) / stats["p_std"],
            (w - stats["w_mean"]) / stats["w_std"],
            t_diff,
            0.0, 1.0,  # noon solar encoding
            dew_depr,
        ]

        score = iforest.score_sample(x)
        threshold = model_card["training_summary"]["dynamic_threshold"]
        is_anomaly = score >= threshold

        return {
            "station_id": station_id,
            "has_model": True,
            "model_id": model_card["model_id"],
            "anomaly_score": score,
            "threshold": threshold,
            "status": "ANOMALY" if is_anomaly else "NORMAL",
            "is_anomaly": is_anomaly,
        }
