"""Simulation control API routes for TRACE-TWIN."""

import asyncio
from fastapi import APIRouter

from backend.db.connection import get_sync_connection
from backend.simulator.factory import FactorySimulator
from backend.engine.pipeline import run_full_pipeline
from backend.api.models import TickResponse

router = APIRouter(prefix="/simulate", tags=["simulation"])

# Module-level simulator instance (lazy init)
_simulator: FactorySimulator | None = None


def _get_simulator() -> FactorySimulator:
    """Get or create the singleton simulator for live tick mode."""
    global _simulator
    if _simulator is None:
        conn = get_sync_connection()
        _simulator = FactorySimulator(conn, start_vehicle_id=4810, num_vehicles=30)
    return _simulator


def _run_tick() -> dict:
    """Execute one simulation tick + anomaly pipeline (sync, runs in thread)."""
    sim = _get_simulator()
    event = sim.generate_tick()

    if event is None:
        return {"events_generated": 0, "anomalies_detected": 0, "message": "Simulation complete"}

    # Run anomaly detection pipeline
    conn = get_sync_connection()
    summary = run_full_pipeline(conn)
    conn.close()

    return {
        "events_generated": 1,
        "anomalies_detected": summary.get("anomalies_created", 0),
        "message": f"Tick: {event['vehicle_id']} @ {event['station_id']} "
                   f"(CT={event['cycle_time_sec']:.1f}s)",
    }


@router.post("/tick", response_model=TickResponse)
async def simulate_tick():
    """Advance the simulation one step: generate one event and run anomaly detection."""
    result = await asyncio.to_thread(_run_tick)
    return TickResponse(**result)
