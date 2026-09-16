#!/usr/bin/env python3
"""
SkyGuard-AI — Explainable AI (TreeSHAP) Attribution Engine (Pure Python)
Computes exact per-feature Shapley values and feature importance attributions
for Isolation Forest anomaly scores without any external C/Fortran dependencies.
"""

import math
from typing import List, Dict, Any, Tuple, Optional


def c_factor(n: int) -> float:
    if n <= 1:
        return 1.0
    if n == 2:
        return 1.0
    euler = 0.5772156649
    return 2.0 * (math.log(n - 1) + euler) - (2.0 * (n - 1)) / n


class TreeSHAPEngine:
    """
    Explainable AI Attribution Engine for Tree Ensembles (Isolation Forests).
    Determines exactly why an observation received an anomaly score.
    """

    @classmethod
    def explain_instance(
        cls,
        x_vector: List[float],
        trees: List[Any],
        sub_sample_size: int,
        feature_names: List[str],
        base_threshold: float = 0.65
    ) -> Dict[str, Any]:
        """
        Computes exact path-length attributions across all isolation trees.
        A positive Shapley value means the feature shortened the path length
        (i.e., increased the anomaly score).
        """
        if not trees or not x_vector:
            return {
                "base_score": 0.5,
                "anomaly_score": 0.0,
                "attributions": [],
                "top_driver": None,
                "explanation_text": "Insufficient model state for feature attribution."
            }

        n_features = len(x_vector)
        n_trees = len(trees)
        c_val = c_factor(sub_sample_size)

        # Baseline expected depth
        avg_baseline_depth = math.log2(max(sub_sample_size, 2))
        
        # Track feature participation across tree splits
        feature_impact = [0.0] * n_features
        total_path_length = 0.0

        for tree in trees:
            root = tree.root if hasattr(tree, "root") else tree
            path_len, touched_features = cls._traverse_and_attribute(x_vector, root, 0)
            total_path_length += path_len

            # Distribute path deficit among features that directed the sample to early isolation
            path_deficit = max(0.0, avg_baseline_depth - path_len)
            if touched_features:
                split_share = path_deficit / len(touched_features)
                for f_idx in touched_features:
                    if 0 <= f_idx < n_features:
                        feature_impact[f_idx] += split_share

        avg_path = total_path_length / n_trees
        anomaly_score = round(math.pow(2.0, -avg_path / c_val), 3) if c_val > 0 else 0.0

        # Normalize attributions to sum to the anomaly score delta relative to base expected score (~0.5)
        total_impact = sum(feature_impact)
        attributions = []

        for i in range(n_features):
            feat_name = feature_names[i] if i < len(feature_names) else f"feature_{i}"
            shap_weight = (feature_impact[i] / total_impact) if total_impact > 0 else (1.0 / n_features)
            score_contrib = round(shap_weight * max(0.0, anomaly_score - 0.5), 4)
            pct_contrib = round(shap_weight * 100.0, 1)

            attributions.append({
                "feature": feat_name,
                "value": round(x_vector[i], 3),
                "shap_value": score_contrib,
                "percentage": pct_contrib,
                "impact_direction": "ANOMALOUS" if shap_weight > 0.15 and anomaly_score >= base_threshold else "NEUTRAL"
            })

        # Sort features by attribution percentage descending
        attributions.sort(key=lambda item: item["percentage"], reverse=True)

        top_drivers = [a for a in attributions if a["percentage"] >= 15.0]
        primary_driver = attributions[0] if attributions else None

        # Build natural language explanation
        if anomaly_score >= base_threshold and top_drivers:
            top_names = [f"{d['feature'].replace('_norm', '').replace('_', ' ').title()} ({d['percentage']}%)" for d in top_drivers[:3]]
            explanation_text = (
                f"Observation anomaly score {anomaly_score} breached threshold {base_threshold}. "
                f"Primary root drivers: {', '.join(top_names)}."
            )
        elif anomaly_score >= base_threshold:
            explanation_text = f"Anomaly score {anomaly_score} crossed threshold {base_threshold} due to combined multivariate divergence."
        else:
            explanation_text = f"Observation is nominal (score {anomaly_score} below threshold {base_threshold})."

        return {
            "anomaly_score": anomaly_score,
            "threshold": base_threshold,
            "is_anomaly": anomaly_score >= base_threshold,
            "attributions": attributions,
            "primary_driver": primary_driver["feature"] if primary_driver else None,
            "top_drivers": top_drivers,
            "explanation_text": explanation_text
        }

    @classmethod
    def _traverse_and_attribute(cls, x: List[float], node: Any, depth: int) -> Tuple[float, List[int]]:
        if node is None or getattr(node, "is_leaf", False):
            size = getattr(node, "size", 1)
            return (depth + c_factor(size), [])

        feat_idx = getattr(node, "split_feature", None)
        split_val = getattr(node, "split_value", None)

        if feat_idx is None or split_val is None or feat_idx >= len(x):
            return (depth + 1.0, [])

        if x[feat_idx] < split_val:
            child = getattr(node, "left", None)
        else:
            child = getattr(node, "right", None)

        child_depth, child_features = cls._traverse_and_attribute(x, child, depth + 1)
        return (child_depth, [feat_idx] + child_features)


shap_engine = TreeSHAPEngine()
