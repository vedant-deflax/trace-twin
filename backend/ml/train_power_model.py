"""ML Power Consumption Modeling & Energy Optimization Training Script.

Models station power draw (kW) based on:
  - Base idle draw (4.5 - 12.0 kW by station category)
  - Dynamic torque and cycle time electromechanical work (P ∝ τ · ω)
  - Thermal penalty: +0.15 kW per 1°C deviation from optimal operating temperature (T_optimal)
  - Tool wear and mechanical vibration friction dissipation

Trains a regression pipeline predicting:
  1. predicted_power_kw (actual expected consumption)
  2. optimal_achievable_power_kw (theoretical minimum at ideal baseline)
  3. avoidable_waste_kw (excess power loss)

Saves artifact to: backend/ml/models/power_optimizer_model.joblib
"""

import os
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "power_optimizer_model.joblib"

TORQUE_STATIONS = {1, 2, 7, 8, 14, 26, 27}


def get_station_base_profile(seq: int):
    """Return idle draw, nominal temperature target, and optimal temp for station seq."""
    if (1 <= seq <= 10) or seq == 14:
        # Framing & Welding
        idle_kw = 9.5 + (seq % 3) * 0.8  # 9.5 - 11.1 kW
        optimal_temp_c = 34.0 + (seq * 0.3)
    elif 11 <= seq <= 18:
        # Paint & Sealing (Ovens, pumps, blowers)
        idle_kw = 8.0 + (seq % 4) * 0.9  # 8.0 - 10.7 kW
        optimal_temp_c = 48.0 if seq in {11, 12} else (60.0 if seq == 17 else 38.0)
    else:
        # Final Assembly (Robotics, tool fixtures, nutrunners)
        idle_kw = 4.8 + (seq % 4) * 0.7  # 4.8 - 6.9 kW
        optimal_temp_c = 28.0 + (seq % 3) * 1.5

    base_ct = 65.0 + (seq % 5) * 2.5
    base_vib = 1.4 + (seq * 0.03)
    base_torque = 42.0 if seq in TORQUE_STATIONS else 0.0

    return {
        "idle_kw": idle_kw,
        "optimal_temp_c": optimal_temp_c,
        "base_ct": base_ct,
        "base_vib": base_vib,
        "base_torque": base_torque,
    }


def calculate_physics_power(seq: int, ct: float, torque: float, temp: float, vib: float):
    """Compute physical power draw and optimal power draw in kW."""
    profile = get_station_base_profile(seq)
    idle = profile["idle_kw"]
    t_opt = profile["optimal_temp_c"]

    # 1. Optimal theoretical power (Baseline state with zero waste)
    opt_torque_kw = profile["base_torque"] * 0.115
    opt_ct_kw = (profile["base_ct"] / 60.0) * 1.85
    optimal_kw = round(idle + opt_torque_kw + opt_ct_kw, 2)

    # 2. Actual dynamic power draw
    torque_kw = (torque * 0.115) if seq in TORQUE_STATIONS else 0.0
    ct_kw = (ct / 60.0) * 1.85
    vib_loss_kw = max(0.0, (vib - profile["base_vib"]) * 1.35)
    thermal_penalty_kw = abs(temp - t_opt) * 0.15

    noise = np.random.normal(0, 0.08)
    actual_kw = round(idle + torque_kw + ct_kw + vib_loss_kw + thermal_penalty_kw + noise, 2)
    actual_kw = max(optimal_kw, actual_kw)  # Can't draw less than baseline physics

    waste_kw = round(max(0.0, actual_kw - optimal_kw), 2)
    return actual_kw, optimal_kw, waste_kw, t_opt


def generate_power_dataset(n_samples: int = 2500, random_seed: int = 42):
    np.random.seed(random_seed)
    records = []

    for _ in range(n_samples):
        seq = int(np.random.randint(1, 31))
        profile = get_station_base_profile(seq)

        # Operating mode: 65% nominal, 25% moderate drift, 10% severe anomaly
        mode = np.random.choice(["nominal", "drift", "anomaly"], p=[0.65, 0.25, 0.10])

        if mode == "nominal":
            ct = profile["base_ct"] + np.random.normal(0, 1.0)
            torque = profile["base_torque"] + (np.random.normal(0, 0.8) if profile["base_torque"] > 0 else 0)
            temp = profile["optimal_temp_c"] + np.random.normal(0, 0.6)
            vib = profile["base_vib"] + np.random.normal(0, 0.06)
        elif mode == "drift":
            ct = profile["base_ct"] + np.random.uniform(2.0, 8.0)
            torque = profile["base_torque"] + (np.random.uniform(2.0, 5.0) if profile["base_torque"] > 0 else 0)
            temp = profile["optimal_temp_c"] + np.random.uniform(3.0, 7.0) * np.random.choice([1, -1])
            vib = profile["base_vib"] + np.random.uniform(0.2, 0.8)
        else:
            ct = profile["base_ct"] + np.random.uniform(10.0, 24.0)
            torque = profile["base_torque"] + (np.random.uniform(6.0, 12.0) if profile["base_torque"] > 0 else 0)
            temp = profile["optimal_temp_c"] + np.random.uniform(7.0, 14.0) * np.random.choice([1, -1])
            vib = profile["base_vib"] + np.random.uniform(1.0, 2.5)

        actual_kw, optimal_kw, waste_kw, t_opt = calculate_physics_power(seq, ct, torque, temp, vib)

        records.append({
            "sequence_no": seq,
            "cycle_time_sec": round(ct, 1),
            "torque_nm": round(torque, 1),
            "temperature_c": round(temp, 1),
            "vibration_mm_s": round(vib, 2),
            "optimal_temp_c": round(t_opt, 1),
            "temp_delta_from_opt": round(abs(temp - t_opt), 1),
            "is_torque_station": 1 if seq in TORQUE_STATIONS else 0,
            "power_kw": actual_kw,
            "optimal_power_kw": optimal_kw,
            "avoidable_waste_kw": waste_kw,
        })

    return pd.DataFrame(records)


def train_power_model():
    print("Generating power consumption training dataset...")
    df = generate_power_dataset(n_samples=3000)
    print(f"Generated {len(df)} samples across 30 stations.")

    features = [
        "sequence_no",
        "cycle_time_sec",
        "torque_nm",
        "temperature_c",
        "vibration_mm_s",
        "temp_delta_from_opt",
        "is_torque_station",
    ]

    X = df[features]
    y_actual = df["power_kw"]
    y_optimal = df["optimal_power_kw"]

    X_train, X_test, y_act_train, y_act_test, y_opt_train, y_opt_test = train_test_split(
        X, y_actual, y_optimal, test_size=0.2, random_state=42
    )

    print("\nTraining Actual Power Draw Regressor (RandomForestRegressor)...")
    act_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("regressor", RandomForestRegressor(n_estimators=120, max_depth=8, random_state=42, n_jobs=-1)),
    ])
    act_pipeline.fit(X_train, y_act_train)

    act_preds = act_pipeline.predict(X_test)
    act_r2 = r2_score(y_act_test, act_preds)
    act_mae = mean_absolute_error(y_act_test, act_preds)
    act_rmse = np.sqrt(mean_squared_error(y_act_test, act_preds))

    print(f"  Actual Power Model: R² = {act_r2:.4f} | MAE = {act_mae:.3f} kW | RMSE = {act_rmse:.3f} kW")

    print("\nTraining Optimal Power Regressor...")
    opt_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("regressor", GradientBoostingRegressor(n_estimators=100, max_depth=5, random_state=42)),
    ])
    opt_pipeline.fit(X_train, y_opt_train)

    opt_preds = opt_pipeline.predict(X_test)
    opt_r2 = r2_score(y_opt_test, opt_preds)
    opt_mae = mean_absolute_error(y_opt_test, opt_preds)
    opt_rmse = np.sqrt(mean_squared_error(y_opt_test, opt_preds))

    print(f"  Optimal Power Model: R² = {opt_r2:.4f} | MAE = {opt_mae:.3f} kW | RMSE = {opt_rmse:.3f} kW")

    # Feature importances for power drivers
    rf = act_pipeline.named_steps["regressor"]
    importances = rf.feature_importances_
    sorted_idx = np.argsort(importances)[::-1]

    print("\nPower Consumption Key Drivers:")
    feature_importances = {}
    for idx in sorted_idx:
        feat = features[idx]
        imp_pct = float(importances[idx] * 100.0)
        feature_importances[feat] = round(imp_pct, 2)
        print(f"  {feat:22s}: {imp_pct:6.2f}%")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    artifact = {
        "actual_pipeline": act_pipeline,
        "optimal_pipeline": opt_pipeline,
        "features": features,
        "feature_importances": feature_importances,
        "metrics": {
            "actual_r2": round(act_r2, 4),
            "actual_mae": round(act_mae, 4),
            "optimal_r2": round(opt_r2, 4),
            "optimal_mae": round(opt_mae, 4),
        },
    }

    joblib.dump(artifact, MODEL_PATH)
    print(f"\nSuccessfully serialized ML Power Optimizer Model to: {MODEL_PATH}")
    return artifact


if __name__ == "__main__":
    train_power_model()
