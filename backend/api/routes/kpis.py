"""KPI API routes for TRACE-TWIN."""

from fastapi import APIRouter
from backend.db.connection import get_async_connection
from backend.api.models import FactoryKPIsResponse

router = APIRouter(prefix="/kpis", tags=["kpis"])

@router.get("", response_model=FactoryKPIsResponse)
async def get_kpis():
    """Get global factory KPIs."""
    conn = await get_async_connection()
    try:
        # 1. Active Line Velocity (veh/hr). Rough calc based on process_events
        # or just a placeholder calculation
        active_line_velocity = 60.0 

        # 2. Fleet Defect Risk
        anoms = await conn.execute_fetchall("SELECT COUNT(*) as c FROM anomalies WHERE status = 'open'")
        open_anoms = anoms[0]["c"] if anoms else 0
        fleet_defect_risk_pct = min(100.0, open_anoms * 15.0)

        # 3. Blind Stations Inferred
        blind = await conn.execute_fetchall("SELECT COUNT(*) as c FROM stations WHERE has_sensors = 0")
        total_blind = blind[0]["c"] if blind else 0
        
        # Total Units in Buffer (all vehicles)
        vehs = await conn.execute_fetchall("SELECT COUNT(*) as c FROM vehicles")
        total_vehs = vehs[0]["c"] if vehs else 0

        return FactoryKPIsResponse(
            active_line_velocity=active_line_velocity,
            fleet_defect_risk_pct=fleet_defect_risk_pct,
            blind_stations_inferred=total_blind,
            total_blind_stations=total_blind,
            total_units_in_buffer=total_vehs
        )
    finally:
        await conn.close()
