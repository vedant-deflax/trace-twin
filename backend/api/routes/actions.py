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


class EnergyOptimizeRequest(BaseModel):
    station_id: Optional[str] = None
    action_label: Optional[str] = "ML Thermal & Power Optimization"


@router.post("/optimize-energy")
async def optimize_energy(req: Optional[EnergyOptimizeRequest] = None):
    """Executes ML-recommended thermal operating setpoints, servo recalibrations,
    and idle standby optimization across target stations or the entire line.
    """
    try:
        st_id = req.station_id if req else None
        lbl = req.action_label if req else "ML Thermal & Power Optimization"
        result = streamer.optimize_energy(station_id=st_id, action_label=lbl)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

