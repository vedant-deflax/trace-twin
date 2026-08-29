"""Model Architecture & Training Script for TRACE-TWIN ML Defect Prediction.

Trains a predictive classification pipeline using scikit-learn (Random Forest & Gradient Boosting)
on multi-station rolling sensor statistics (Delta Cycle Time, Delta Torque, Delta Temp, Delta Vib,
upstream cumulative wear index).
Evaluates with Stratified K-Fold cross validation and 80/20 train/test split.
Exports trained model artifact to backend/ml/models/defect_risk_model.joblib.
"""

import sys
from datetime import datetime
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

DATA_PATH = Path(__file__).parent.parent / "data" / "training_data_1000.csv"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "defect_risk_model.joblib"

FEATURE_COLS = [
    "delta_ct_mean",
    "delta_ct_max",
    "delta_ct_std",
    "delta_torque_mean",
    "delta_torque_max",
    "delta_torque_s14",
    "delta_temp_mean",
    "delta_temp_max",
    "delta_temp_s09",
    "delta_vib_mean",
    "delta_vib_max",
    "upstream_wear_index",
    "thermal_accumulation_index",
    "material_hardness_factor",
]

TARGET_COL = "defect_occurred"


def train_defect_model():
    if not DATA_PATH.exists():
        print(f"Dataset not found at {DATA_PATH}. Generating now...")
        from backend.ml.generate_training_data import generate_training_data
        generate_training_data()

    df = pd.read_csv(DATA_PATH)
    print(f"Loaded {len(df)} samples from {DATA_PATH}")

    X = df[FEATURE_COLS]
    y = df[TARGET_COL]

    # 80/20 Stratified Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    print(f"Train samples: {len(X_train)} ({y_train.sum()} defects)")
    print(f"Test samples:  {len(X_test)} ({y_test.sum()} defects)")

    # Stratified K-Fold Validation (5 folds)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    # Model Pipeline: StandardScaler + RandomForestClassifier
    rf_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", RandomForestClassifier(
            n_estimators=180,
            max_depth=7,
            min_samples_split=5,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1,
        )),
    ])

    scoring = ["roc_auc", "f1", "precision", "recall"]
    cv_results = cross_validate(rf_pipeline, X_train, y_train, cv=cv, scoring=scoring)

    print("\n" + "=" * 50)
    print("5-FOLD CROSS-VALIDATION RESULTS (Train Set):")
    print("=" * 50)
    print(f"  Mean ROC-AUC:   {np.mean(cv_results['test_roc_auc']):.4f} (±{np.std(cv_results['test_roc_auc']):.4f})")
    print(f"  Mean F1-Score:  {np.mean(cv_results['test_f1']):.4f} (±{np.std(cv_results['test_f1']):.4f})")
    print(f"  Mean Precision: {np.mean(cv_results['test_precision']):.4f} (±{np.std(cv_results['test_precision']):.4f})")
    print(f"  Mean Recall:    {np.mean(cv_results['test_recall']):.4f} (±{np.std(cv_results['test_recall']):.4f})")

    # Fit final pipeline on full training set
    rf_pipeline.fit(X_train, y_train)

    # Evaluate on held-out 20% test set
    y_pred = rf_pipeline.predict(X_test)
    y_prob = rf_pipeline.predict_proba(X_test)[:, 1]

    test_roc_auc = roc_auc_score(y_test, y_prob)
    test_f1 = f1_score(y_test, y_pred)
    test_prec = precision_score(y_test, y_pred)
    test_rec = recall_score(y_test, y_pred)
    cm = confusion_matrix(y_test, y_pred)

    print("\n" + "=" * 50)
    print("HELD-OUT TEST SET EVALUATION (20% Split):")
    print("=" * 50)
    print(f"  Test ROC-AUC:   {test_roc_auc:.4f}")
    print(f"  Test F1-Score:  {test_f1:.4f}")
    print(f"  Test Precision: {test_prec:.4f}")
    print(f"  Test Recall:    {test_rec:.4f}")
    print("\nConfusion Matrix:")
    print(f"  TN: {cm[0][0]:3d} | FP: {cm[0][1]:3d}")
    print(f"  FN: {cm[1][0]:3d} | TP: {cm[1][1]:3d}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, digits=4))

    # Extract Feature Importances
    clf = rf_pipeline.named_steps["classifier"]
    importances = clf.feature_importances_
    sorted_idx = np.argsort(importances)[::-1]

    feature_importances = {}
    print("=" * 50)
    print("TOP PREDICTIVE FEATURE IMPORTANCES:")
    print("=" * 50)
    for idx in sorted_idx:
        feat = FEATURE_COLS[idx]
        imp_pct = float(importances[idx] * 100.0)
        feature_importances[feat] = round(imp_pct, 2)
        print(f"  {feat:28s}: {imp_pct:6.2f}%")

    # Serialize Artifact
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    artifact = {
        "pipeline": rf_pipeline,
        "feature_names": FEATURE_COLS,
        "feature_importances": feature_importances,
        "metrics": {
            "roc_auc": round(float(test_roc_auc), 4),
            "f1_score": round(float(test_f1), 4),
            "precision": round(float(test_prec), 4),
            "recall": round(float(test_rec), 4),
        },
        "trained_at": datetime.now().isoformat(),
        "num_training_samples": len(df),
    }

    joblib.dump(artifact, MODEL_PATH)
    print(f"\nModel artifact successfully saved to: {MODEL_PATH}")
    return artifact


if __name__ == "__main__":
    train_defect_model()
