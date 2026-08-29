"""
SkyGuard AI — Feature Engineering & Scaling Service
Step 3: Feature Engineering & Step 4: Feature Scaling

Creates time features, rate-of-change features, and rolling statistics.
Applies sklearn StandardScaler to produce clean, scaled feature matrices.
"""

from typing import List, Tuple, Dict, Any
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

# Standard 15 Feature Names
FEATURE_NAMES = [
    "temperature",
    "pressure",
    "humidity",
    "hour",
    "day_of_year",
    "month",
    "temperature_change",
    "pressure_change",
    "humidity_change",
    "temperature_rolling_mean",
    "temperature_rolling_std",
    "pressure_rolling_mean",
    "pressure_rolling_std",
    "humidity_rolling_mean",
    "humidity_rolling_std",
]


def extract_features(df: pd.DataFrame, window_size: int = 3) -> Tuple[pd.DataFrame, List[str]]:
    """
    Generates temporal, delta, and rolling statistical features from cleaned weather data.
    
    Args:
        df: Cleaned pandas DataFrame containing ['timestamp', 'temperature', 'pressure', 'humidity']
        window_size: Rolling window size for moving averages and standard deviations (default: 3)
        
    Returns:
        (df_features, feature_names)
    """
    df_feat = df.copy()

    # 1. Time Features
    df_feat["hour"] = df_feat["timestamp"].dt.hour
    df_feat["day_of_year"] = df_feat["timestamp"].dt.dayofyear
    df_feat["month"] = df_feat["timestamp"].dt.month

    # 2. Change Features (Current - Previous)
    df_feat["temperature_change"] = df_feat["temperature"].diff().fillna(0.0)
    df_feat["pressure_change"] = df_feat["pressure"].diff().fillna(0.0)
    df_feat["humidity_change"] = df_feat["humidity"].diff().fillna(0.0)

    # 3. Rolling Features (Mean & Standard Deviation)
    for param in ["temperature", "pressure", "humidity"]:
        rolling_obj = df_feat[param].rolling(window=window_size, min_periods=1)
        
        mean_col = f"{param}_rolling_mean"
        std_col = f"{param}_rolling_std"

        df_feat[mean_col] = rolling_obj.mean().fillna(df_feat[param])
        df_feat[std_col] = rolling_obj.std().fillna(0.0)

    # Extract exact 15 feature columns
    df_feature_matrix = df_feat[FEATURE_NAMES].copy()

    # Fill any remaining NaNs with 0.0 for safety
    df_feature_matrix = df_feature_matrix.fillna(0.0)

    return df_feature_matrix, FEATURE_NAMES


def fit_and_scale_features(
    df_features: pd.DataFrame
) -> Tuple[np.ndarray, StandardScaler]:
    """
    Fits a new StandardScaler on historical training features and returns transformed data.
    """
    scaler = StandardScaler()
    scaled_matrix = scaler.fit_transform(df_features)
    return scaled_matrix, scaler


def scale_realtime_feature_vector(
    feature_dict: Dict[str, float],
    scaler: StandardScaler,
    feature_names: List[str] = FEATURE_NAMES
) -> np.ndarray:
    """
    Transforms a single observation feature dictionary using a pre-fitted StandardScaler.
    """
    vector = [feature_dict[name] for name in feature_names]
    array_2d = np.array(vector).reshape(1, -1)
    return scaler.transform(array_2d)
