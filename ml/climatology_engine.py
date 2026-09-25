#!/usr/bin/env python3
"""
SkyGuard-AI — Climatology Engine
Implements harmonic regression for diurnal and seasonal baselines.
Uses robust Iteratively Reweighted Least Squares (IRLS) with Huber weighting
to fit temperature, humidity, and pressure baselines independent of anomalies.
"""

import math
import datetime
from typing import Dict, Any, List, Tuple

class ClimatologyEngine:
    def __init__(self):
        # Huber loss tuning constant (1.345 is standard for 95% efficiency on normal data)
        self.huber_c = 1.345

    def _build_design_matrix(self, hours: List[float], days: List[float]) -> List[List[float]]:
        """
        Builds the harmonic design matrix:
        [1, sin(2pi*h/24), cos(2pi*h/24), sin(4pi*h/24), cos(4pi*h/24),
            sin(2pi*d/365), cos(2pi*d/365), sin(4pi*d/365), cos(4pi*d/365)]
        """
        X = []
        for h, d in zip(hours, days):
            h_rad = 2 * math.pi * h / 24.0
            d_rad = 2 * math.pi * d / 365.25
            row = [
                1.0,
                math.sin(h_rad), math.cos(h_rad),
                math.sin(2 * h_rad), math.cos(2 * h_rad),
                math.sin(d_rad), math.cos(d_rad),
                math.sin(2 * d_rad), math.cos(2 * d_rad)
            ]
            X.append(row)
        return X

    def _matrix_multiply(self, A: List[List[float]], B: List[List[float]]) -> List[List[float]]:
        rows_A, cols_A = len(A), len(A[0])
        rows_B, cols_B = len(B), len(B[0])
        if cols_A != rows_B:
            raise ValueError("Matrix dimensions mismatch for multiplication")
        
        C = [[0.0 for _ in range(cols_B)] for _ in range(rows_A)]
        for i in range(rows_A):
            for j in range(cols_B):
                for k in range(cols_A):
                    C[i][j] += A[i][k] * B[k][j]
        return C

    def _matrix_transpose(self, A: List[List[float]]) -> List[List[float]]:
        return [[A[j][i] for j in range(len(A))] for i in range(len(A[0]))]
        
    def _matrix_inverse_9x9(self, A: List[List[float]]) -> List[List[float]]:
        # Gauss-Jordan elimination for 9x9
        n = len(A)
        # Augment A with identity
        M = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(A)]
        
        for i in range(n):
            # Find pivot
            pivot_row = max(range(i, n), key=lambda r: abs(M[r][i]))
            if abs(M[pivot_row][i]) < 1e-10:
                # Add ridge regularization if singular
                for r in range(n):
                    M[r][r] += 1e-6
                pivot_row = max(range(i, n), key=lambda r: abs(M[r][i]))
                if abs(M[pivot_row][i]) < 1e-10:
                    raise ValueError("Matrix is singular, cannot invert")
                    
            # Swap
            M[i], M[pivot_row] = M[pivot_row], M[i]
            
            # Scale
            pivot = M[i][i]
            for j in range(2 * n):
                M[i][j] /= pivot
                
            # Eliminate
            for k in range(n):
                if k != i:
                    factor = M[k][i]
                    for j in range(2 * n):
                        M[k][j] -= factor * M[i][j]
                        
        return [row[n:] for row in M]

    def _huber_weight(self, residual: float, sigma: float) -> float:
        if sigma < 1e-6:
            return 1.0
        scaled_res = abs(residual) / sigma
        if scaled_res <= self.huber_c:
            return 1.0
        return self.huber_c / scaled_res

    def _median_absolute_deviation(self, data: List[float]) -> float:
        if not data:
            return 1e-6
        median = sorted(data)[len(data) // 2]
        abs_devs = [abs(x - median) for x in data]
        mad = sorted(abs_devs)[len(abs_devs) // 2]
        # 1.4826 converts MAD to standard deviation for normal distribution
        return max(1.4826 * mad, 1e-6)

    def fit_irls(self, hours: List[float], days: List[float], y: List[float], max_iter=10) -> Tuple[List[float], float]:
        """
        Fits a harmonic regression model using Iteratively Reweighted Least Squares (IRLS).
        Returns the fitted coefficients and the robust scale (sigma).
        """
        if not y:
            return [0.0]*9, 1.0
            
        n = len(y)
        if n < 20: # Not enough data for 9 parameters, return mean
            mean_y = sum(y) / n
            return [mean_y] + [0.0]*8, 1.0
            
        X = self._build_design_matrix(hours, days)
        X_T = self._matrix_transpose(X)
        
        # Initial OLS fit
        try:
            # (X^T * X)^-1 * X^T * Y
            XT_X = self._matrix_multiply(X_T, X)
            XT_X_inv = self._matrix_inverse_9x9(XT_X)
            XT_Y = self._matrix_multiply(X_T, [[v] for v in y])
            beta = [v[0] for v in self._matrix_multiply(XT_X_inv, XT_Y)]
        except Exception:
             # Fallback to mean if singular
             mean_y = sum(y) / n
             return [mean_y] + [0.0]*8, 1.0

        sigma = 1.0
        
        for _ in range(max_iter):
            # Compute residuals
            y_pred = [sum(X[i][j] * beta[j] for j in range(9)) for i in range(n)]
            residuals = [y[i] - y_pred[i] for i in range(n)]
            
            # Update robust scale (sigma)
            sigma = self._median_absolute_deviation(residuals)
            
            # Compute weights
            W = [self._huber_weight(r, sigma) for r in residuals]
            
            # Weighted Least Squares
            XW = [[X[i][j] * math.sqrt(W[i]) for j in range(9)] for i in range(n)]
            yw = [[y[i] * math.sqrt(W[i])] for i in range(n)]
            XW_T = self._matrix_transpose(XW)
            
            try:
                XWT_XW = self._matrix_multiply(XW_T, XW)
                XWT_XW_inv = self._matrix_inverse_9x9(XWT_XW)
                XWT_YW = self._matrix_multiply(XW_T, yw)
                beta = [v[0] for v in self._matrix_multiply(XWT_XW_inv, XWT_YW)]
            except Exception:
                break # Keep previous beta if singular

        return beta, sigma

    def train_station_climatology(self, observations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Trains climatology models for temperature, humidity, and pressure.
        """
        if not observations:
             return {}
             
        hours = []
        days = []
        temps = []
        hums = []
        press = []
        
        for obs in observations:
             # Try to extract timestamp to day of year, fallback to 0
             ts = str(obs.get("timestamp", ""))
             try:
                 dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                 day_of_year = dt.timetuple().tm_yday
             except Exception:
                 day_of_year = 1.0
             
             hour = float(obs.get("hour", 12))
             
             hours.append(hour)
             days.append(day_of_year)
             temps.append(float(obs.get("temp", obs.get("temperature", 25.0))))
             hums.append(float(obs.get("hum", obs.get("humidity", 60.0))))
             press.append(float(obs.get("pres", obs.get("pressure", 1010.0))))
             
        t_beta, t_sigma = self.fit_irls(hours, days, temps)
        h_beta, h_sigma = self.fit_irls(hours, days, hums)
        p_beta, p_sigma = self.fit_irls(hours, days, press)
        
        return {
             "temperature": {"coefficients": t_beta, "robust_sigma": t_sigma},
             "humidity": {"coefficients": h_beta, "robust_sigma": h_sigma},
             "pressure": {"coefficients": p_beta, "robust_sigma": p_sigma},
             "observation_count": len(observations)
        }

    def compute_expected(self, coeffs: List[float], hour: float, day_of_year: float) -> float:
        """Computes expected value from coefficients."""
        if not coeffs or len(coeffs) != 9:
            return 0.0
        X = self._build_design_matrix([hour], [day_of_year])[0]
        return sum(X[i] * coeffs[i] for i in range(9))

climatology_engine = ClimatologyEngine()
