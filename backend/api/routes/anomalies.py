"""Anomalies API routes for TRACE-TWIN."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from backend.db.connection import get_async_connection
from backend.engine.confidence import compute_predicted_risk
from backend.api.models import (
    AnomalyListResponse,
    AnomalyDetailResponse,
    BlastRadiusResponse,
    WhatIfScenarioResponse,
    RootCauseResponse,
    StationBrief,
    ApproveRequest,
)

router = APIRouter(prefix="/anomalies", tags=["anomalies"])


@router.get("", response_model=list[AnomalyListResponse])
async def list_anomalies(
    status: Optional[str] = Query(None, description="Filter by status: open, inspecting, resolved"),
    limit: int = Query(50, ge=1, le=200),
):
    """List active/resolved anomalies (alert feed)."""
    conn = await get_async_connection()
    try:
        if status:
            rows = await conn.execute_fetchall(
                "SELECT a.*, s.name as station_name "
                "FROM anomalies a "
                "JOIN stations s ON s.id = a.station_id "
                "WHERE a.status = ? "
                "ORDER BY a.detected_at DESC LIMIT ?",
                (status, limit),
            )
        else:
            rows = await conn.execute_fetchall(
                "SELECT a.*, s.name as station_name "
                "FROM anomalies a "
                "JOIN stations s ON s.id = a.station_id "
                "ORDER BY a.detected_at DESC LIMIT ?",
                (limit,),
            )

        return [
            AnomalyListResponse(
                id=r["id"],
                station=StationBrief(id=r["station_id"], name=r["station_name"]),
                detected_at=r["detected_at"],
                status=r["status"],
                confidence_score=r["confidence_score"],
                recommended_action=r["recommended_action"],
            )
            for r in rows
        ]
    finally:
        await conn.close()


@router.get("/{anomaly_id}", response_model=AnomalyDetailResponse)
async def get_anomaly(anomaly_id: int):
    """Get full anomaly detail: residuals, root causes, confidence, blast radius, what-if."""
    conn = await get_async_connection()
    try:
        # Fetch anomaly
        rows = await conn.execute_fetchall(
            "SELECT a.*, s.name as station_name "
            "FROM anomalies a "
            "JOIN stations s ON s.id = a.station_id "
            "WHERE a.id = ?",
            (anomaly_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"Anomaly {anomaly_id} not found")

        a = rows[0]

        # Root causes
        rc_rows = await conn.execute_fetchall(
            "SELECT cause_label, probability_pct FROM root_causes "
            "WHERE anomaly_id = ? ORDER BY probability_pct DESC",
            (anomaly_id,),
        )

        # Blast radius
        br_rows = await conn.execute_fetchall(
            "SELECT vehicle_id FROM blast_radius WHERE anomaly_id = ? ORDER BY id",
            (anomaly_id,),
        )

        # What-if scenarios
        wif_rows = await conn.execute_fetchall(
            "SELECT * FROM what_if_scenarios WHERE anomaly_id = ?",
            (anomaly_id,),
        )

        residuals = {
            "cycle_time_sec": a["residual_cycle_time"],
            "vibration_mm_s": a["residual_vibration"],
            "temperature_c": a["residual_temperature"],
        }

        risk = compute_predicted_risk({
            "cycle_time": a["residual_cycle_time"] or 0,
            "vibration": a["residual_vibration"] or 0,
            "temperature": a["residual_temperature"] or 0,
        })

        return AnomalyDetailResponse(
            id=a["id"],
            station=StationBrief(id=a["station_id"], name=a["station_name"]),
            detected_at=a["detected_at"],
            residuals=residuals,
            root_causes=[
                RootCauseResponse(
                    cause_label=rc["cause_label"],
                    probability_pct=rc["probability_pct"],
                )
                for rc in rc_rows
            ],
            confidence_score=a["confidence_score"],
            predicted_risk_pct=risk,
            recommended_action=a["recommended_action"],
            blast_radius=[br["vehicle_id"] for br in br_rows],
            what_if=[
                WhatIfScenarioResponse(
                    scenario_label=w["scenario_label"],
                    projected_throughput_impact=w["projected_throughput_impact"],
                    projected_defect_containment=w["projected_defect_containment"],
                    is_recommended=bool(w["is_recommended"]),
                )
                for w in wif_rows
            ],
            status=a["status"],
            window_start=a["window_start"],
            window_end=a["window_end"],
        )
    finally:
        await conn.close()


@router.get("/{anomaly_id}/blast-radius", response_model=BlastRadiusResponse)
async def get_blast_radius(anomaly_id: int):
    """Get the bounded vehicle ID list affected by an anomaly."""
    conn = await get_async_connection()
    try:
        anomaly = await conn.execute_fetchall(
            "SELECT window_start, window_end FROM anomalies WHERE id = ?",
            (anomaly_id,),
        )
        if not anomaly:
            raise HTTPException(status_code=404, detail=f"Anomaly {anomaly_id} not found")

        br_rows = await conn.execute_fetchall(
            "SELECT vehicle_id FROM blast_radius WHERE anomaly_id = ? ORDER BY id",
            (anomaly_id,),
        )

        vehicle_ids = [br["vehicle_id"] for br in br_rows]

        return BlastRadiusResponse(
            anomaly_id=anomaly_id,
            vehicle_ids=vehicle_ids,
            count=len(vehicle_ids),
            window_start=anomaly[0]["window_start"],
            window_end=anomaly[0]["window_end"],
        )
    finally:
        await conn.close()


@router.get("/{anomaly_id}/what-if", response_model=list[WhatIfScenarioResponse])
async def get_what_if(anomaly_id: int):
    """Get the 3 scenario projections for an anomaly."""
    conn = await get_async_connection()
    try:
        rows = await conn.execute_fetchall(
            "SELECT * FROM what_if_scenarios WHERE anomaly_id = ?",
            (anomaly_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"No scenarios for anomaly {anomaly_id}")

        return [
            WhatIfScenarioResponse(
                scenario_label=w["scenario_label"],
                projected_throughput_impact=w["projected_throughput_impact"],
                projected_defect_containment=w["projected_defect_containment"],
                is_recommended=bool(w["is_recommended"]),
            )
            for w in rows
        ]
    finally:
        await conn.close()


@router.post("/{anomaly_id}/approve")
async def approve_anomaly(anomaly_id: int, body: ApproveRequest = ApproveRequest()):
    """Human-in-the-loop approval: sets anomaly status to 'inspecting'."""
    conn = await get_async_connection()
    try:
        anomaly = await conn.execute_fetchall(
            "SELECT * FROM anomalies WHERE id = ?", (anomaly_id,)
        )
        if not anomaly:
            raise HTTPException(status_code=404, detail=f"Anomaly {anomaly_id} not found")

        update_action = body.action or anomaly[0]["recommended_action"]
        await conn.execute(
            "UPDATE anomalies SET status = 'inspecting', recommended_action = ? WHERE id = ?",
            (update_action, anomaly_id),
        )
        await conn.commit()

        return {
            "id": anomaly_id,
            "status": "inspecting",
            "recommended_action": update_action,
            "message": f"Anomaly {anomaly_id} approved for action: {update_action}",
        }
    finally:
        await conn.close()
