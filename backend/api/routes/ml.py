"""FastAPI ML Inference routes for TRACE-TWIN defect prediction."""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.db.connection import get_sync_connection
from backend.engine.inference import (
    extract_features_from_telemetry,
    load_model_artifact,
    predict_vehicle_risk,
)

router = APIRouter(prefix="/ml", tags=["Machine Learning"])


class PredictRiskRequest(BaseModel):
    vehicle_id: Optional[str] = None
    features: Optional[Dict[str, float]] = None
    events: Optional[List[Dict[str, Any]]] = None


class PredictRiskResponse(BaseModel):
    vehicle_id: Optional[str] = None
    predicted_defect_probability: float
    predicted_defect_pct: float
    risk_level: str
    model_feature_importances: List[Dict[str, Any]]
    model_metrics: Dict[str, float]
    model_trained_at: Optional[str] = None


@router.post("/predict-risk", response_model=PredictRiskResponse)
def predict_risk(req: PredictRiskRequest):
    """Predict vehicle defect risk using the trained defect_risk_model pipeline."""
    try:
        # Case 1: Pre-computed features provided directly
        if req.features:
            feats = req.features
        # Case 2: Events provided directly in request body
        elif req.events:
            feats = extract_features_from_telemetry(req.events)
        # Case 3: Fetch vehicle events from SQLite
        elif req.vehicle_id:
            conn = get_sync_connection()
            rows = conn.execute(
                "SELECT * FROM process_events WHERE vehicle_id = ? ORDER BY entered_at ASC",
                (req.vehicle_id,),
            ).fetchall()
            conn.close()

            if not rows:
                # If vehicle not yet in DB, return nominal baseline
                feats = extract_features_from_telemetry([])
            else:
                events = [dict(r) for r in rows]
                feats = extract_features_from_telemetry(events)
        else:
            raise HTTPException(
                status_code=400,
                detail="Must provide vehicle_id, features dictionary, or events list",
            )

        res = predict_vehicle_risk(feats)
        return PredictRiskResponse(
            vehicle_id=req.vehicle_id,
            predicted_defect_probability=res["predicted_defect_probability"],
            predicted_defect_pct=res["predicted_defect_pct"],
            risk_level=res["risk_level"],
            model_feature_importances=res["model_feature_importances"],
            model_metrics=res["model_metrics"],
            model_trained_at=res.get("model_trained_at"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ML Inference error: {str(e)}")


@router.get("/metrics")
def get_model_metadata():
    """Retrieve model training metrics, evaluation scores, and top feature importances."""
    try:
        artifact = load_model_artifact()
        return {
            "model_type": "RandomForestClassifier Pipeline (StandardScaler)",
            "metrics": artifact.get("metrics", {}),
            "feature_importances": artifact.get("feature_importances", {}),
            "num_training_samples": artifact.get("num_training_samples", 1000),
            "trained_at": artifact.get("trained_at"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading model artifact: {str(e)}")
