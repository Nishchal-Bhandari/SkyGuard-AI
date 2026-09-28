"""Shared, causal 12-feature contract for training and live inference."""
import datetime as dt
import math
import statistics
from ml.climatology_engine import climatology_engine
from ml.thermo_engine import thermo_engine

PARAMETERS = (("temperature", "temp"), ("humidity", "hum"), ("pressure", "pres"))


def instant(value):
    parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed.astimezone(dt.timezone.utc)


def readiness(rows):
    times = sorted({instant(r["timestamp"]) for r in rows if r.get("timestamp")})
    days = {t.date() for t in times}
    seasons = {(t.year, (t.month - 1) // 3) for t in times}
    tier = "COLD_START"
    if len(times) >= 72:
        tier = "BASELINE"
    if len(times) >= 720 and len(days) >= 14:
        tier = "TRAINED"
    if len(times) >= 4380 and len(days) >= 14 and len(seasons) >= 2:
        tier = "MATURE"
    return {"tier": tier, "observation_count": len(times), "distinct_days": len(days), "seasons": len(seasons)}


def valid_core(row):
    bounds = ((-50, 60), (0, 100), (300, 1200))
    try:
        values = [float(row.get(short, row.get(long))) for long, short in PARAMETERS]
        return all(math.isfinite(v) and lo <= v <= hi for v, (lo, hi) in zip(values, bounds))
    except (TypeError, ValueError):
        return False


class FeatureEngine:
    feature_names = ["z_T", "z_H", "z_P", "dz_T", "dz_H", "dz_P", "z_dpd", "p_elev_resid", "var3", "persist", "z_T_lag1", "hour_phase"]

    def residuals(self, row, climate):
        when = instant(row["timestamp"])
        hour = when.hour + when.minute / 60
        out = []
        for long, short in PARAMETERS:
            c = climate[long]
            expected = climatology_engine.compute_expected(c["coefficients"], hour, when.timetuple().tm_yday)
            out.append((float(row.get(short, row.get(long))) - expected) / max(float(c["robust_sigma"]), 0.1))
        return out

    def fit_stats(self, rows, elevation):
        dpd = [r["temp"] - thermo_engine.dew_point(r["temp"], r["hum"]) for r in rows]
        pressure = [r["pres"] - thermo_engine.expected_hypsometric_pressure(elevation) for r in rows]
        return {"feature_space_version": 2, "feature_names": self.feature_names, "dpd_mean": statistics.mean(dpd),
                "dpd_std": max(statistics.pstdev(dpd), 0.1), "p_elev_mean": statistics.mean(pressure),
                "p_elev_std": max(statistics.pstdev(pressure), 0.1), "elevation": elevation}

    def transform(self, row, climate, stats, history=()):
        z = self.residuals(row, climate)
        previous = [r for r in history if r["timestamp"] < row["timestamp"] and valid_core(r)][-12:]
        prior_z = [self.residuals(r, climate) for r in previous]
        prev = prior_z[-1] if prior_z else z
        window = [v[0] for v in prior_z[-2:]] + [z[0]]
        persistence = 0
        for vector in reversed(prior_z + [z]):
            if max(abs(v) for v in vector) < 2:
                break
            persistence += 1
        temp, hum, pres = [float(row.get(short, row.get(long))) for long, short in PARAMETERS]
        dpd = temp - thermo_engine.dew_point(temp, hum)
        pe = pres - thermo_engine.expected_hypsometric_pressure(stats["elevation"])
        when = instant(row["timestamp"])
        return z + [z[i] - prev[i] for i in range(3)] + [
            (dpd - stats["dpd_mean"]) / stats["dpd_std"],
            (pe - stats["p_elev_mean"]) / stats["p_elev_std"], statistics.pvariance(window),
            float(persistence), prev[0], math.sin(2 * math.pi * (when.hour + when.minute / 60) / 24),
        ]

    def engineer_features_v2(self, valid_rows, climatology_results, target_elev=0.0):
        if not valid_rows:
            return [], {}
        stats = self.fit_stats(valid_rows, target_elev)
        return [self.transform(r, climatology_results, stats, valid_rows[max(0, i-12):i]) for i, r in enumerate(valid_rows)], stats


feature_engine = FeatureEngine()
