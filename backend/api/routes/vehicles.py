"""Vehicles API routes for TRACE-TWIN."""

from fastapi import APIRouter, HTTPException

from backend.db.connection import get_async_connection
from backend.api.models import VehicleDetailResponse, ProcessEventResponse

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("/{vehicle_id}", response_model=VehicleDetailResponse)
async def get_vehicle(vehicle_id: str):
    """Get full digital-thread history for a vehicle (drill-down view)."""
    conn = await get_async_connection()
    try:
        # Fetch vehicle
        vehicle = await conn.execute_fetchall(
            "SELECT * FROM vehicles WHERE id = ?", (vehicle_id,)
        )
        if not vehicle:
            raise HTTPException(status_code=404, detail=f"Vehicle {vehicle_id} not found")

        v = vehicle[0]

        # Fetch all process events for this vehicle, ordered by station sequence
        events = await conn.execute_fetchall(
            "SELECT pe.*, s.sequence_no "
            "FROM process_events pe "
            "JOIN stations s ON s.id = pe.station_id "
            "WHERE pe.vehicle_id = ? "
            "ORDER BY s.sequence_no, pe.entered_at",
            (vehicle_id,),
        )

        return VehicleDetailResponse(
            id=v["id"],
            model=v["model"],
            line_entry_ts=v["line_entry_ts"],
            events=[
                ProcessEventResponse(
                    id=e["id"],
                    vehicle_id=e["vehicle_id"],
                    station_id=e["station_id"],
                    resource_id=e["resource_id"],
                    entered_at=e["entered_at"],
                    exited_at=e["exited_at"],
                    cycle_time_sec=e["cycle_time_sec"],
                    vibration_mm_s=e["vibration_mm_s"],
                    temperature_c=e["temperature_c"],
                    source_system=e["source_system"],
                    is_inferred=bool(e["is_inferred"]),
                )
                for e in events
            ],
        )
    finally:
        await conn.close()
