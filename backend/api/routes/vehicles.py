"""Vehicles API routes for TRACE-TWIN."""

from fastapi import APIRouter, HTTPException

from backend.db.connection import get_async_connection
from backend.api.models import VehicleDetailResponse, ProcessEventResponse, VehicleListResponse

router = APIRouter(prefix="/vehicles", tags=["vehicles"])

@router.get("", response_model=list[VehicleListResponse])
async def list_vehicles():
    """Get all active vehicles on the line."""
    conn = await get_async_connection()
    try:
        # Get vehicles and their latest station
        rows = await conn.execute_fetchall(
            '''
            SELECT v.id, v.model,
                   (SELECT station_id FROM process_events pe WHERE pe.vehicle_id = v.id ORDER BY entered_at DESC LIMIT 1) as current_station,
                   (SELECT COUNT(*) FROM blast_radius br WHERE br.vehicle_id = v.id) as blast_count
            FROM vehicles v
            ORDER BY v.line_entry_ts DESC
            '''
        )
        
        # We can deduce status from blast radius count or anomalies
        # For simplicity, if blast_count > 0, status is 'critical'
        results = []
        for r in rows:
            blast_count = r["blast_count"] or 0
            status = 'normal'
            if blast_count > 0:
                status = 'critical'
                
            results.append(VehicleListResponse(
                id=r["id"],
                model=r["model"],
                current_station=r["current_station"],
                status=status,
                is_in_blast_radius=(blast_count > 0)
            ))
        return results
    finally:
        await conn.close()


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
                    torque_nm=e["torque_nm"],
                    source_system=e["source_system"],
                    is_inferred=bool(e["is_inferred"]),
                )
                for e in events
            ],
        )
    finally:
        await conn.close()
