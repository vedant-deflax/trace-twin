"""Standalone Inference Verification & Audit Script for TRACE-TWIN ML Model.

Loads backend/ml/models/defect_risk_model.joblib and tests:
  - Test Case A: Healthy/Nominal Telemetry (Expected < 15% defect probability)
  - Test Case B: Severe S14 Drift Telemetry (Expected > 80% defect probability)
"""

import sys
from pathlib import Path
import joblib
import pandas as pd

MODEL_PATH = Path(__file__).parent / "models" / "defect_risk_model.joblib"


def run_tests():
    print(f"Loading model artifact from: {MODEL_PATH}")
    if not MODEL_PATH.exists():
        print(f"ERROR: Model artifact not found at {MODEL_PATH}")
        sys.exit(1)

    artifact = joblib.load(MODEL_PATH)
    pipeline = artifact["pipeline"]
    feature_names = artifact["feature_names"]
    metrics = artifact.get("metrics", {})
    importances = artifact.get("feature_importances", {})

    print("\n" + "=" * 60)
    print("MODEL METRICS AT TRAINING TIME:")
    print("=" * 60)
    for k, v in metrics.items():
        print(f"  {k:15s}: {v}")

    print("\n" + "=" * 60)
    print("TOP 5 GLOBAL FEATURE IMPORTANCES:")
    print("=" * 60)
    sorted_imp = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:5]
    for feat, imp in sorted_imp:
        print(f"  {feat:25s}: {imp:6.2f}%")

    # ──────────────────────────────────────────────────────────────────────────
    # Test Case A: Healthy / Nominal Telemetry
    # ──────────────────────────────────────────────────────────────────────────
    healthy_telemetry = {
        "delta_ct_mean": 0.12,
        "delta_ct_max": 0.45,
        "delta_ct_std": 0.18,
        "delta_torque_mean": 0.08,
        "delta_torque_max": 0.35,
        "delta_torque_s14": 0.10,
        "delta_temp_mean": 0.15,
        "delta_temp_max": 0.60,
        "delta_temp_s09": 0.20,
        "delta_vib_mean": 0.02,
        "delta_vib_max": 0.05,
        "upstream_wear_index": 0.15,
        "thermal_accumulation_index": 0.10,
        "material_hardness_factor": 1.00,
    }

    df_healthy = pd.DataFrame([healthy_telemetry])[feature_names]
    prob_healthy = float(pipeline.predict_proba(df_healthy)[0][1])
    class_healthy = int(pipeline.predict(df_healthy)[0])

    print("\n" + "=" * 60)
    print("TEST CASE A: HEALTHY / NOMINAL TELEMETRY")
    print("=" * 60)
    print(f"  Input: Baseline variances <= 0.5 sigma (Nominal 3-Sigma limits)")
    print(f"  Predicted Defect Probability: {prob_healthy * 100.0:.2f}% (P={prob_healthy:.4f})")
    print(f"  Predicted Class:              {class_healthy} ({'DEFECT' if class_healthy == 1 else 'PASSING'})")
    assert prob_healthy < 0.15, f"Expected probability < 15%, got {prob_healthy * 100:.2f}%"
    print("  Status: [PASSED] (Meets < 15% threshold)")

    # ──────────────────────────────────────────────────────────────────────────
    # Test Case B: Severe S14 Drift Telemetry
    # (CT: 88s vs 65s nominal, Torque: 49Nm vs 42Nm, Vib: 3.9mm/s vs 1.82mm/s)
    # ──────────────────────────────────────────────────────────────────────────
    severe_s14_telemetry = {
        "delta_ct_mean": 5.80,
        "delta_ct_max": 23.00,       # CT: 88s (+23s drift)
        "delta_ct_std": 6.20,
        "delta_torque_mean": 4.10,
        "delta_torque_max": 7.00,      # Torque: 49Nm (+7.0Nm drift)
        "delta_torque_s14": 7.00,      # Station 14 tool wear breach
        "delta_temp_mean": 4.20,
        "delta_temp_max": 8.50,
        "delta_temp_s09": 3.10,
        "delta_vib_mean": 0.95,
        "delta_vib_max": 2.08,         # Vib: 3.9mm/s (+2.08mm/s drift)
        "upstream_wear_index": 2.85,   # Wear index > 2.2 threshold
        "thermal_accumulation_index": 5.40,
        "material_hardness_factor": 1.04,
    }

    df_severe = pd.DataFrame([severe_s14_telemetry])[feature_names]
    prob_severe = float(pipeline.predict_proba(df_severe)[0][1])
    class_severe = int(pipeline.predict(df_severe)[0])

    print("\n" + "=" * 60)
    print("TEST CASE B: SEVERE S14 DRIFT TELEMETRY")
    print("=" * 60)
    print(f"  Input: CT: 88s (+23s), Torque: 49Nm (+7.0Nm @ S14), Vib: 3.9mm/s (+2.08mm/s)")
    print(f"  Predicted Defect Probability: {prob_severe * 100.0:.2f}% (P={prob_severe:.4f})")
    print(f"  Predicted Class:              {class_severe} ({'DEFECT' if class_severe == 1 else 'PASSING'})")
    assert prob_severe > 0.80, f"Expected probability > 80%, got {prob_severe * 100:.2f}%"
    print("  Status: [PASSED] (Meets > 80% threshold)")

    print("\n" + "=" * 60)
    print("ALL STANDALONE INFERENCE AUDIT TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    run_tests()
