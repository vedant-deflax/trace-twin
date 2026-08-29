"""Action execution route for human-in-the-loop and automated interventions."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.simulator.streamer import streamer

router = APIRouter(prefix="/actions", tags=["actions"])


class ActionExecuteRequest(BaseModel):
    station_id: str
    scenario_label: str
    anomaly_id: Optional[int] = None


@router.post("/execute")
async def execute_action(req: ActionExecuteRequest):
    """Execute a what-if intervention on a target station.

    Resets accumulated tool wear, thermal drift, and active excursions back
    to nominal baseline (Δ = 0), immediately resolving the anomaly and
    clearing the affected blast radius cohort.
    """
    try:
        result = streamer.execute_action(
            station_id=req.station_id,
            scenario_label=req.scenario_label,
            anomaly_id=req.anomaly_id,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
