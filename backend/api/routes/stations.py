"""Stations API routes for TRACE-TWIN."""

from fastapi import APIRouter, Query
from typing import Optional

from backend.db.connection import get_async_connection
from backend.api.models import StationResponse, ProcessEventResponse

router = APIRouter(prefix="/stations", tags=["stations"])


@router.get("", response_model=list[StationResponse])
async def list_stations():
    """List all stations with baseline and live status."""
    from backend.simulator.streamer import GLOBAL_STATE
    if GLOBAL_STATE.get("stations"):
        return [
            StationResponse(
                id=s["id"],
                name=s["name"],
                sequence_no=s["sequence_no"],
                has_sensors=s.get("has_sensors", True),
                resource_id=s.get("resource_id"),
                baseline=s.get("baseline"),
                status=s.get("status", "normal"),
            )
            for s in GLOBAL_STATE["stations"]
        ]

    conn = await get_async_connection()
    try:
        rows = await conn.execute_fetchall(
            "SELECT s.id, s.name, s.sequence_no, s.has_sensors, s.resource_id, "
            "sb.expected_cycle_time_sec, sb.expected_vibration_mm_s, sb.expected_temperature_c "
            "FROM stations s "
            "LEFT JOIN station_baselines sb ON sb.station_id = s.id "
            "ORDER BY s.sequence_no"
        )

        # Check for open anomalies
        anomalous_stations = set()
        anomaly_rows = await conn.execute_fetchall(
            "SELECT station_id FROM anomalies WHERE status = 'open'"
        )
        for ar in anomaly_rows:
            anomalous_stations.add(ar["station_id"])

        results = []
        for r in rows:
            sid = r["id"]

            # Determine status
            if sid in anomalous_stations:
                status = "anomaly"
            else:
                # Check if latest reading deviates from baseline
                latest = await conn.execute_fetchall(
                    "SELECT cycle_time_sec FROM process_events "
                    "WHERE station_id = ? ORDER BY entered_at DESC LIMIT 1",
                    (sid,),
                )
                if latest and r["expected_cycle_time_sec"]:
                    residual = abs((latest[0]["cycle_time_sec"] or 0) - r["expected_cycle_time_sec"])
                    status = "warning" if residual > 3.0 else "normal"
                else:
                    status = "normal"

            results.append(StationResponse(
                id=sid,
                name=r["name"],
                sequence_no=r["sequence_no"],
                has_sensors=bool(r["has_sensors"]),
                resource_id=r["resource_id"],
                baseline={
                    "expected_cycle_time_sec": r["expected_cycle_time_sec"],
                    "expected_vibration_mm_s": r["expected_vibration_mm_s"],
                    "expected_temperature_c": r["expected_temperature_c"],
                } if r["expected_cycle_time_sec"] else None,
                status=status,
            ))

        return results
    finally:
        await conn.close()


@router.get("/{station_id}/events", response_model=list[ProcessEventResponse])
async def get_station_events(
    station_id: str,
    since: Optional[str] = Query(None, description="ISO timestamp filter"),
    limit: int = Query(50, ge=1, le=200),
):
    """Get recent process events for a station (for residual charts)."""
    conn = await get_async_connection()
    try:
        if since:
            rows = await conn.execute_fetchall(
                "SELECT * FROM process_events "
                "WHERE station_id = ? AND entered_at >= ? "
                "ORDER BY entered_at DESC LIMIT ?",
                (station_id, since, limit),
            )
        else:
            rows = await conn.execute_fetchall(
                "SELECT * FROM process_events "
                "WHERE station_id = ? "
                "ORDER BY entered_at DESC LIMIT ?",
                (station_id, limit),
            )

        return [
            ProcessEventResponse(
                id=r["id"],
                vehicle_id=r["vehicle_id"],
                station_id=r["station_id"],
                resource_id=r["resource_id"],
                entered_at=r["entered_at"],
                exited_at=r["exited_at"],
                cycle_time_sec=r["cycle_time_sec"],
                vibration_mm_s=r["vibration_mm_s"],
                temperature_c=r["temperature_c"],
                torque_nm=r["torque_nm"],
                source_system=r["source_system"],
                is_inferred=bool(r["is_inferred"]),
            )
            for r in rows
        ]
    finally:
        await conn.close()
