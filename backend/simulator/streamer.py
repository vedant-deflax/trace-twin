"""Live simulation tick engine for TRACE-TWIN.

Drives the factory simulation loop at 2.5 s/tick.  On every tick:
  1. Write active vehicle process events to SQLite.
  2. Run the anomaly-detection / enrichment pipeline.
  3. Rebuild GLOBAL_STATE — the snapshot broadcast via SSE.

Station 14 "CRITICAL" override is injected directly into GLOBAL_STATE
so the conveyor bar lights red immediately, without waiting for the
pipeline's rolling-window detector to warm up.
"""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any, Dict

from backend.db.connection import get_sync_connection
from backend.simulator.dataset_generator import (
    generate_vehicle_cohort,
    ANOMALY_STATION,
    ANOMALY_START_VI,
    ANOMALY_PEAK_VI,
    ANOMALY_END_VI,
    DRIFT_CYCLE_TIME,
    DRIFT_VIBRATION,
    DRIFT_TEMPERATURE,
    BASE_TORQUE_NM,
)
from backend.engine.pipeline import run_full_pipeline

# ── Blast radius vehicle sets ────────────────────────────────────────────────
CRITICAL_VID = "VEH_4821"
WARNING_VIDS  = {
    "VEH_4817", "VEH_4818", "VEH_4819", "VEH_4820",
    "VEH_4822", "VEH_4823", "VEH_4824", "VEH_4825",
}

# Global state broadcasted via SSE
GLOBAL_STATE: Dict[str, Any] = {
    "stations": [],
    "anomalies": [],
    "vehicles":  [],
    "kpis":      {},
}


class SimulationStreamer:
    def __init__(self):
        self.tick_index = 0
        self.cohort = generate_vehicle_cohort(num_vehicles=50, start_id=4801)

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    async def start(self):
        """Wipe DB, reseed, fast-forward, then loop every 2.5 s."""
        import backend.db.init_db as init_db
        init_db.init_db()                     # always flush stale data on startup

        # Fast-forward so Station 14 anomaly vehicles are already in-flight
        for _ in range(25):
            await asyncio.to_thread(self._process_tick)

        while True:
            await asyncio.sleep(2.5)
            await asyncio.to_thread(self._process_tick)

    # ── Tick ──────────────────────────────────────────────────────────────────
    def _process_tick(self):
        conn = get_sync_connection()
        now  = datetime.now()

        active_events = []
        for vi, vehicle in enumerate(self.cohort):
            si = self.tick_index - vi
            if 0 <= si < 30:
                evt = vehicle["events"][si]
                active_events.append((vehicle, evt, vi))

                if si == 0:
                    conn.execute(
                        "INSERT OR IGNORE INTO vehicles (id, model, line_entry_ts) "
                        "VALUES (?, ?, ?)",
                        (vehicle["vehicle_id"], vehicle["model"], now.isoformat()),
                    )

                entered = now - timedelta(seconds=evt["cycle_time_sec"])
                conn.execute(
                    "INSERT INTO process_events "
                    "(vehicle_id, station_id, resource_id, "
                    " entered_at, exited_at, "
                    " cycle_time_sec, vibration_mm_s, temperature_c, torque_nm, "
                    " source_system, is_inferred) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        vehicle["vehicle_id"], evt["station_id"], evt["resource_id"],
                        entered.isoformat(), now.isoformat(),
                        evt["cycle_time_sec"], evt["vibration_mm_s"],
                        evt["temperature_c"], evt["torque_nm"],
                        "INFERRED" if evt["is_inferred"] else "MES",
                        evt["is_inferred"],
                    ),
                )

        conn.commit()

        if active_events:
            run_full_pipeline(conn)
            self._update_global_state(conn, active_events)

        conn.close()
        self.tick_index += 1

    # ── State builder ─────────────────────────────────────────────────────────
    def _update_global_state(self, conn, active_events: list):
        """Rebuild GLOBAL_STATE from DB + forced Station 14 override."""

        # ── Determine if Station 14 anomaly window is currently active ────────
        active_vi_set = {vi for (_, _, vi) in active_events}
        s14_active = any(
            ANOMALY_START_VI <= vi <= ANOMALY_END_VI for vi in active_vi_set
        )
        # Find peak intensity vehicle currently at S14 (highest intensity wins)
        s14_intensity = 0.0
        for (vehicle, evt, vi) in active_events:
            if evt["station_id"] == ANOMALY_STATION and ANOMALY_START_VI <= vi <= ANOMALY_END_VI:
                if vi <= ANOMALY_PEAK_VI:
                    intensity = (vi - ANOMALY_START_VI) / float(ANOMALY_PEAK_VI - ANOMALY_START_VI)
                else:
                    intensity = (ANOMALY_END_VI - vi) / float(ANOMALY_END_VI - ANOMALY_PEAK_VI)
                s14_intensity = max(s14_intensity, intensity)

        # ── 1. Stations ───────────────────────────────────────────────────────
        stations = []
        for row in conn.execute("SELECT * FROM stations ORDER BY sequence_no"):
            s = dict(row)
            bl_row = conn.execute(
                "SELECT * FROM station_baselines WHERE station_id = ?", (s["id"],)
            ).fetchone()
            s["baseline"] = dict(bl_row) if bl_row else {}

            # Latest telemetry from DB
            evt = conn.execute(
                "SELECT cycle_time_sec, vibration_mm_s, temperature_c, torque_nm "
                "FROM process_events WHERE station_id = ? "
                "ORDER BY exited_at DESC LIMIT 1",
                (s["id"],),
            ).fetchone()

            if evt:
                s["cycle_time"]  = evt["cycle_time_sec"]
                s["vibration"]   = evt["vibration_mm_s"]
                s["temperature"] = evt["temperature_c"]
                s["torque"]      = evt["torque_nm"]
            else:
                bl = s["baseline"]
                s["cycle_time"]  = bl.get("expected_cycle_time_sec", 0)
                s["vibration"]   = bl.get("expected_vibration_mm_s", 0)
                s["temperature"] = bl.get("expected_temperature_c", 0)
                s["torque"]      = BASE_TORQUE_NM

            # ── Force Station 14 into CRITICAL when anomaly window is active ──
            if s["id"] == ANOMALY_STATION and s14_active and s14_intensity > 0:
                bl = s["baseline"]
                noise = random.gauss(0, 0.4)
                s["cycle_time"]  = round((bl.get("expected_cycle_time_sec", 52)
                                          + DRIFT_CYCLE_TIME * s14_intensity + noise), 1)
                s["vibration"]   = round((bl.get("expected_vibration_mm_s", 2.8)
                                          + DRIFT_VIBRATION * s14_intensity
                                          + random.gauss(0, 0.05)), 2)
                s["temperature"] = round((bl.get("expected_temperature_c", 58)
                                          + DRIFT_TEMPERATURE * s14_intensity
                                          + random.gauss(0, 0.3)), 1)
                s["torque"]      = round(BASE_TORQUE_NM + 6.0 * s14_intensity
                                         + random.gauss(0, 0.5), 1)
                s["status"]          = "anomaly"
                s["confidence_score"] = round(78 + s14_intensity * 9 + random.uniform(-2, 2), 1)
                s["root_causes"]     = [
                    {"cause_label": "Tool Wear",        "probability_pct": 72},
                    {"cause_label": "Motor Degradation", "probability_pct": 19},
                    {"cause_label": "Thermal Drift",    "probability_pct": 9},
                ]
            else:
                anom = conn.execute(
                    "SELECT id, status, confidence_score FROM anomalies "
                    "WHERE station_id = ? AND status IN ('open', 'inspecting') "
                    "ORDER BY id DESC LIMIT 1",
                    (s["id"],),
                ).fetchone()
                if anom:
                    s["status"]          = "anomaly"
                    s["confidence_score"] = anom["confidence_score"]
                    rc_rows = conn.execute(
                        "SELECT cause_label, probability_pct FROM root_causes "
                        "WHERE anomaly_id = ?",
                        (anom["id"],),
                    ).fetchall()
                    s["root_causes"] = [dict(r) for r in rc_rows]
                else:
                    s["status"]          = "normal"
                    s["confidence_score"] = None
                    s["root_causes"]     = None

            stations.append(s)

        # ── 2. Anomalies ──────────────────────────────────────────────────────
        anomalies = []
        for row in conn.execute(
            "SELECT * FROM anomalies WHERE status IN ('open', 'inspecting') ORDER BY id DESC"
        ):
            a = dict(row)
            s_row = conn.execute(
                "SELECT * FROM stations WHERE id = ?", (a["station_id"],)
            ).fetchone()
            a["station"] = dict(s_row) if s_row else None
            rc_rows = conn.execute(
                "SELECT cause_label, probability_pct FROM root_causes WHERE anomaly_id = ?",
                (a["id"],),
            ).fetchall()
            a["root_causes"] = [dict(r) for r in rc_rows]
            br_rows = conn.execute(
                "SELECT vehicle_id FROM blast_radius WHERE anomaly_id = ?", (a["id"],)
            ).fetchall()
            a["blast_radius"] = [r["vehicle_id"] for r in br_rows]
            anomalies.append(a)

        # Inject a synthetic anomaly object for Station 14 if forced-active but
        # the pipeline hasn't written one yet (warm-up ticks)
        if s14_active and s14_intensity > 0 and not any(
            a.get("station_id") == ANOMALY_STATION for a in anomalies
        ):
            s14_row = conn.execute(
                "SELECT * FROM stations WHERE id = ?", (ANOMALY_STATION,)
            ).fetchone()
            anomalies.append({
                "id": -1,
                "station_id": ANOMALY_STATION,
                "station": dict(s14_row) if s14_row else {},
                "residual_cycle_time": round(DRIFT_CYCLE_TIME * s14_intensity, 1),
                "residual_vibration":  round(DRIFT_VIBRATION  * s14_intensity, 2),
                "residual_temperature": round(DRIFT_TEMPERATURE * s14_intensity, 1),
                "confidence_score": round(78 + s14_intensity * 9, 1),
                "status": "open",
                "recommended_action": "inspect_recalibrate",
                "root_causes": [
                    {"cause_label": "Tool Wear",         "probability_pct": 72},
                    {"cause_label": "Motor Degradation", "probability_pct": 19},
                    {"cause_label": "Thermal Drift",     "probability_pct":  9},
                ],
                "blast_radius": [CRITICAL_VID] + list(WARNING_VIDS),
                "what_if": [
                    {"scenario_label": "continue",           "projected_throughput_impact": 60,  "projected_defect_containment": 10,  "is_recommended": 0},
                    {"scenario_label": "slow_station",       "projected_throughput_impact": 52,  "projected_defect_containment": 45,  "is_recommended": 0},
                    {"scenario_label": "inspect_recalibrate","projected_throughput_impact": 39,  "projected_defect_containment": 100, "is_recommended": 1},
                ],
            })

        # ── 3. Vehicles ───────────────────────────────────────────────────────
        vehicles = []
        rows = conn.execute("""
            SELECT v.id, v.model, p.station_id
            FROM vehicles v
            JOIN process_events p ON v.id = p.vehicle_id
            WHERE p.exited_at = (
                SELECT MAX(exited_at) FROM process_events WHERE vehicle_id = v.id
            )
            ORDER BY p.exited_at DESC
            LIMIT 50
        """).fetchall()

        all_blast_vehicles = {vid for a in anomalies for vid in a.get("blast_radius", [])}

        for r in rows:
            v = dict(r)
            v["current_station"] = v["station_id"]

            if v["id"] == CRITICAL_VID:
                v["status"]            = "critical"
                v["is_in_blast_radius"] = True
                v["defect_risk_pct"]   = 94
                v["defect_label"]      = "Structural Torque Out-of-Spec"
            elif v["id"] in WARNING_VIDS:
                v["status"]            = "warning"
                v["is_in_blast_radius"] = True
                v["defect_risk_pct"]   = 68
                v["defect_label"]      = "Blast Radius — Containment Required"
            else:
                v["status"]            = "normal"
                v["is_in_blast_radius"] = v["id"] in all_blast_vehicles
                v["defect_risk_pct"]   = 0
                v["defect_label"]      = "Passing"

            vehicles.append(v)

        # ── 4. KPIs ───────────────────────────────────────────────────────────
        cycle_times = [s["cycle_time"] for s in stations if s["cycle_time"] > 0]
        max_ct      = max(cycle_times) if cycle_times else 60.0
        active_vel  = round(3600.0 / max_ct + random.uniform(-0.4, 0.4), 1)

        # Defect risk: 28–42% during active anomaly, 2–6% nominal
        if s14_active and s14_intensity > 0.05:
            defect_risk = round(28.0 + 14.0 * s14_intensity + random.uniform(-1.5, 1.5), 1)
        elif anomalies:
            defect_risk = round(15.0 * len(anomalies) + random.uniform(-1, 1), 1)
        else:
            defect_risk = round(2.0 + random.uniform(0, 4), 1)

        blind_stations = conn.execute(
            "SELECT COUNT(*) as c FROM stations WHERE has_sensors=0"
        ).fetchone()["c"]

        base_buffer = 14 + max(0, (60.0 - active_vel) / 5.0)
        buffer      = max(14, min(18, int(base_buffer + random.uniform(-1, 1))))

        kpis = {
            "active_line_velocity":    active_vel,
            "fleet_defect_risk_pct":   round(max(0.0, defect_risk), 1),
            "blind_stations_inferred": blind_stations,
            "total_blind_stations":    blind_stations,
            "total_units_in_buffer":   buffer,
        }

        GLOBAL_STATE["stations"] = stations
        GLOBAL_STATE["anomalies"] = anomalies
        GLOBAL_STATE["vehicles"]  = vehicles
        GLOBAL_STATE["kpis"]      = kpis


streamer = SimulationStreamer()

