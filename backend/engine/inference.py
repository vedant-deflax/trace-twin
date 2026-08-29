"""Real-time ML Model Inference Engine for TRACE-TWIN.

Loads the trained defect risk pipeline artifact (defect_risk_model.joblib)
and evaluates in-flight vehicle telemetry features into predicted defect probabilities
and feature importance drivers.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import joblib
import numpy as np
import pandas as pd

MODEL_PATH = Path(__file__).parent.parent / "ml" / "models" / "defect_risk_model.joblib"

_ARTIFACT: Optional[Dict[str, Any]] = None


def load_model_artifact() -> Dict[str, Any]:
    global _ARTIFACT
    if _ARTIFACT is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model artifact not found at {MODEL_PATH}")
        _ARTIFACT = joblib.load(MODEL_PATH)
    return _ARTIFACT


def extract_features_from_telemetry(
    events: List[Dict[str, Any]],
    current_station_seq: int = 30,
    baselines: Optional[Dict[int, Dict[str, float]]] = None,
) -> Dict[str, float]:
    """Extract standard rolling features from in-flight vehicle process events."""
    if not events:
        return {feat: 0.0 for feat in [
            "delta_ct_mean", "delta_ct_max", "delta_ct_std",
            "delta_torque_mean", "delta_torque_max", "delta_torque_s14",
            "delta_temp_mean", "delta_temp_max", "delta_temp_s09",
            "delta_vib_mean", "delta_vib_max",
            "upstream_wear_index", "thermal_accumulation_index",
            "material_hardness_factor",
        ]}

    ct_deltas = []
    vib_deltas = []
    temp_deltas = []
    torque_deltas = []

    s14_torque_delta = 0.0
    s09_temp_delta = 0.0
    upstream_wear_acc = 0.0
    thermal_acc = 0.0

    for evt in events:
        seq = evt.get("sequence_no") or 1
        ct = evt.get("cycle_time_sec") or 65.0
        vib = evt.get("vibration_mm_s") or 1.8
        temp = evt.get("temperature_c") or 40.0
        torque = evt.get("torque_nm") or 42.0

        base_ct = 65.0 + (seq % 5) * 2.5
        base_vib = 1.4 + (seq * 0.03)
        base_temp = 36.0 + (seq * 0.4)
        base_torque = 42.0 if seq in {1, 2, 7, 8, 14, 26, 27} else 0.0

        dct = ct - base_ct
        dvib = vib - base_vib
        dtemp = temp - base_temp
        dtorque = (torque - base_torque) if base_torque > 0 else 0.0

        ct_deltas.append(dct)
        vib_deltas.append(dvib)
        temp_deltas.append(dtemp)
        if base_torque > 0:
            torque_deltas.append(dtorque)

        if seq == 14:
            s14_torque_delta = dtorque
        if seq == 9:
            s09_temp_delta = dtemp

        if seq <= 18:
            upstream_wear_acc += max(0.0, dtorque * 0.4 + dvib * 0.6)
        if seq in {9, 11, 17, 18}:
            thermal_acc += max(0.0, dtemp)

    delta_ct_mean = float(np.mean(ct_deltas)) if ct_deltas else 0.0
    delta_ct_max = float(np.max(ct_deltas)) if ct_deltas else 0.0
    delta_ct_std = float(np.std(ct_deltas)) if len(ct_deltas) > 1 else 0.0

    delta_torque_mean = float(np.mean(torque_deltas)) if torque_deltas else 0.0
    delta_torque_max = float(np.max(torque_deltas)) if torque_deltas else 0.0

    delta_temp_mean = float(np.mean(temp_deltas)) if temp_deltas else 0.0
    delta_temp_max = float(np.max(temp_deltas)) if temp_deltas else 0.0

    delta_vib_mean = float(np.mean(vib_deltas)) if vib_deltas else 0.0
    delta_vib_max = float(np.max(vib_deltas)) if vib_deltas else 0.0

    return {
        "delta_ct_mean": round(delta_ct_mean, 3),
        "delta_ct_max": round(delta_ct_max, 3),
        "delta_ct_std": round(delta_ct_std, 3),
        "delta_torque_mean": round(delta_torque_mean, 3),
        "delta_torque_max": round(delta_torque_max, 3),
        "delta_torque_s14": round(s14_torque_delta, 3),
        "delta_temp_mean": round(delta_temp_mean, 3),
        "delta_temp_max": round(delta_temp_max, 3),
        "delta_temp_s09": round(s09_temp_delta, 3),
        "delta_vib_mean": round(delta_vib_mean, 3),
        "delta_vib_max": round(delta_vib_max, 3),
        "upstream_wear_index": round(upstream_wear_acc / 18.0, 3),
        "thermal_accumulation_index": round(thermal_acc, 3),
        "material_hardness_factor": 1.01,
    }


def predict_vehicle_risk(features: Dict[str, float]) -> Dict[str, Any]:
    """Run model inference on feature vector."""
    artifact = load_model_artifact()
    pipeline = artifact["pipeline"]
    feature_names = artifact["feature_names"]

    # Align columns
    row = {feat: features.get(feat, 0.0) for feat in feature_names}
    df = pd.DataFrame([row])

    proba = float(pipeline.predict_proba(df)[0][1])
    risk_pct = round(proba * 100.0, 1)

    if proba >= 0.70:
        risk_level = "CRITICAL"
    elif proba >= 0.35:
        risk_level = "WARNING"
    else:
        risk_level = "NORMAL"

    # Driver contributions (ranked by feature importance & deviation)
    importances = artifact.get("feature_importances", {})
    drivers = []
    for feat, imp in importances.items():
        val = features.get(feat, 0.0)
        drivers.append({
            "feature": feat,
            "feature_label": feat.replace("_", " ").title(),
            "importance_pct": imp,
            "observed_value": val,
        })
    drivers.sort(key=lambda d: d["importance_pct"], reverse=True)

    return {
        "predicted_defect_probability": round(proba, 4),
        "predicted_defect_pct": risk_pct,
        "risk_level": risk_level,
        "model_feature_importances": drivers[:5],
        "model_metrics": artifact.get("metrics", {}),
        "model_trained_at": artifact.get("trained_at"),
    }
