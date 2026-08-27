import asyncio
import json
from datetime import datetime, timedelta
from typing import Any, Dict

from backend.db.connection import get_sync_connection, get_async_connection
from backend.simulator.dataset_generator import generate_vehicle_cohort
from backend.engine.pipeline import run_full_pipeline

# Global state broadcasted via SSE
GLOBAL_STATE: Dict[str, Any] = {
    "stations": [],
    "anomalies": [],
    "vehicles": [],
    "kpis": {}
}

class SimulationStreamer:
    def __init__(self):
        self.tick_index = 0
        self.cohort = generate_vehicle_cohort(num_vehicles=50, start_id=4801)
        # Pre-seed the DB to clear old data? We can do this on startup.

    async def start(self):
        # Clear database and reseed just stations/baselines
        import backend.db.init_db as init_db
        init_db.init_db()
        
        # Advance the simulation a bit so it's not empty at startup
        for _ in range(15):
            await asyncio.to_thread(self._process_tick)

        while True:
            await asyncio.sleep(2.5) # Tick every 2.5 seconds
            await asyncio.to_thread(self._process_tick)
            
    def _process_tick(self):
        conn = get_sync_connection()
        now = datetime.now()
        
        active_events = []
        # Calculate which vehicle is at which station for this tick
        for vi, vehicle in enumerate(self.cohort):
            si = self.tick_index - vi
            if 0 <= si < 30:
                evt = vehicle["events"][si]
                active_events.append((vehicle, evt))
                
                # Insert vehicle if it's their first station
                if si == 0:
                    conn.execute(
                        "INSERT OR IGNORE INTO vehicles (id, model, line_entry_ts) VALUES (?, ?, ?)",
                        (vehicle["vehicle_id"], vehicle["model"], now.isoformat())
                    )
                    
                entered = now - timedelta(seconds=evt["cycle_time_sec"])
                conn.execute(
                    "INSERT INTO process_events (vehicle_id, station_id, resource_id, entered_at, exited_at, cycle_time_sec, vibration_mm_s, temperature_c, torque_nm, source_system, is_inferred) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (vehicle["vehicle_id"], evt["station_id"], evt["resource_id"], entered.isoformat(), now.isoformat(), evt["cycle_time_sec"], evt["vibration_mm_s"], evt["temperature_c"], evt["torque_nm"], "INFERRED" if evt["is_inferred"] else "MES", evt["is_inferred"])
                )

        conn.commit()
        
        if active_events:
            # Run pipeline to generate anomalies
            run_full_pipeline(conn)
            
            # Re-fetch state for frontend
            self._update_global_state(conn)
            
        conn.close()
        self.tick_index += 1

    def _update_global_state(self, conn):
        # 1. Fetch Stations
        stations = []
        for row in conn.execute("SELECT * FROM stations ORDER BY sequence_no"):
            s = dict(row)
            baseline = dict(conn.execute("SELECT * FROM station_baselines WHERE station_id = ?", (s["id"],)).fetchone())
            s["baseline"] = baseline
            
            # Fetch latest telemetry event
            evt = conn.execute("SELECT cycle_time_sec, vibration_mm_s, temperature_c, torque_nm FROM process_events WHERE station_id = ? ORDER BY exited_at DESC LIMIT 1", (s["id"],)).fetchone()
            if evt:
                s["cycle_time"] = evt["cycle_time_sec"]
                s["vibration"] = evt["vibration_mm_s"]
                s["temperature"] = evt["temperature_c"]
                s["torque"] = evt["torque_nm"]
            else:
                s["cycle_time"] = 0
                s["vibration"] = 0
                s["temperature"] = 0
                s["torque"] = 0
            
            # check anomaly status
            anom = conn.execute("SELECT id, status, confidence_score FROM anomalies WHERE station_id = ? AND status IN ('open', 'inspecting') ORDER BY id DESC LIMIT 1", (s["id"],)).fetchone()
            if anom:
                s["status"] = "anomaly"
                s["confidence_score"] = anom["confidence_score"]
                rc_rows = conn.execute("SELECT cause_label, probability_pct FROM root_causes WHERE anomaly_id = ?", (anom["id"],)).fetchall()
                s["root_causes"] = [dict(r) for r in rc_rows]
            else:
                s["status"] = "normal"
                s["confidence_score"] = None
                s["root_causes"] = None
            stations.append(s)

        # 2. Fetch Anomalies
        anomalies = []
        for row in conn.execute("SELECT * FROM anomalies WHERE status IN ('open', 'inspecting') ORDER BY id DESC"):
            a = dict(row)
            s_row = conn.execute("SELECT * FROM stations WHERE id = ?", (a["station_id"],)).fetchone()
            a["station"] = dict(s_row) if s_row else None
            rc_rows = conn.execute("SELECT cause_label, probability_pct FROM root_causes WHERE anomaly_id = ?", (a["id"],)).fetchall()
            a["root_causes"] = [dict(r) for r in rc_rows]
            br_rows = conn.execute("SELECT vehicle_id FROM blast_radius WHERE anomaly_id = ?", (a["id"],)).fetchall()
            a["blast_radius"] = [r["vehicle_id"] for r in br_rows]
            anomalies.append(a)

        # 3. Fetch Vehicles (Active ones only)
        vehicles = []
        rows = conn.execute("""
            SELECT v.id, v.model, p.station_id
            FROM vehicles v
            JOIN process_events p ON v.id = p.vehicle_id
            WHERE p.exited_at = (SELECT MAX(exited_at) FROM process_events WHERE vehicle_id = v.id)
            ORDER BY p.exited_at DESC
            LIMIT 50
        """).fetchall()
        
        all_blast_vehicles = {vid for a in anomalies for vid in a.get("blast_radius", [])}
        warning_vids = {"VEH_4817", "VEH_4818", "VEH_4819", "VEH_4820", "VEH_4822", "VEH_4823", "VEH_4824", "VEH_4825"}
        
        for r in rows:
            v = dict(r)
            v["current_station"] = v["station_id"]
            
            # Dynamic Tagging
            if v["id"] == "VEH_4821":
                v["status"] = "critical"
                v["is_in_blast_radius"] = True
            elif v["id"] in warning_vids:
                v["status"] = "warning"
                v["is_in_blast_radius"] = True
            else:
                v["status"] = "normal"
                v["is_in_blast_radius"] = v["id"] in all_blast_vehicles # fallback for others

            vehicles.append(v)
            
        # 4. Fetch KPIs
        import random
        cycle_times = [s["cycle_time"] for s in stations if s["cycle_time"] > 0]
        max_ct = max(cycle_times) if cycle_times else 60.0
        active_vel = round(3600.0 / max_ct, 1) + random.uniform(-0.4, 0.4)
        
        defect_risk = (len(anomalies) * 15.0) + random.uniform(-1.0, 1.0)
        
        blind_stations = conn.execute("SELECT COUNT(*) as c FROM stations WHERE has_sensors=0").fetchone()["c"]
        
        # Buffer between 14 and 18, inversely related to velocity
        base_buffer = 14 + ((60.0 - min(60.0, active_vel)) / 5.0)
        buffer = max(14, min(18, int(base_buffer + random.uniform(-1, 1))))
        
        kpis = {
            "active_line_velocity": round(active_vel, 1),
            "fleet_defect_risk_pct": round(max(0.0, defect_risk), 1),
            "blind_stations_inferred": blind_stations,
            "total_blind_stations": blind_stations,
            "total_units_in_buffer": buffer
        }

        GLOBAL_STATE["stations"] = stations
        GLOBAL_STATE["anomalies"] = anomalies
        GLOBAL_STATE["vehicles"] = vehicles
        GLOBAL_STATE["kpis"] = kpis


streamer = SimulationStreamer()
