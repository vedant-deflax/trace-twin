"""Live simulation tick engine for TRACE-TWIN.

Drives the factory simulation loop at 2.5 s/tick.
Implements an active, dynamic anomaly lifecycle manager across all 30 stations:
  1. Tool Wear Drift on torque/press stations (S01, S02, S07, S08, S14, S26, S27)
  2. Thermal Excursions on curing/sealing stations (S09, S11, S17, S18)
  3. Micro-Stoppages: pneumatic delays (+15s Cycle Time, turning AMBER)
  4. Dynamic Correlated Blast Radius:
     - Chassis inside breach station -> CRITICAL (Red)
     - 3 chassis immediately upstream and downstream -> WARNING (Amber)
  5. Interactive What-If Scenario Execution -> Resets station to nominal (Δ = 0)
"""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Set

from backend.db.connection import get_sync_connection
from backend.db.init_db import STATIONS, BASELINES
from backend.simulator.dataset_generator import (
    generate_vehicle_cohort,
    BASE_TORQUE_NM,
)
from backend.engine.pipeline import run_full_pipeline
from backend.engine.anomaly_detector import resolve_station_anomaly
from backend.engine.inference import (
    extract_features_from_telemetry,
    predict_vehicle_risk,
    evaluate_station_power,
)


# Station classification sets
TORQUE_STATIONS = {1, 2, 7, 8, 14, 26, 27}
CURING_STATIONS = {9, 11, 17, 18}

# Global state broadcasted via SSE
GLOBAL_STATE: Dict[str, Any] = {
    "stations": [],
    "anomalies": [],
    "vehicles": [],
    "completed_vehicles": [],
    "kpis": {},
}


class SimulationStreamer:
    def __init__(self):
        self.tick_index = 0
        self.cohort = generate_vehicle_cohort(num_vehicles=300, start_id=4800)

        # ── Anomaly Lifecycle Manager State Across All 30 Stations ────────────
        # Tool wear accumulation state (wear >= 2.2 triggers 3-sigma CRITICAL breach)
        self.station_wear_state = {s: 0.0 for s in range(1, 31)}
        # Initialize Station 14 with active tool wear drift past 3-sigma on startup
        self.station_wear_state[14] = 3.0
        self.station_wear_state[7] = 1.3
        self.station_wear_state[26] = 0.8

        # Thermal excursions: dict of seq -> {"ticks_remaining": int, "temp_spike": float}
        self.thermal_excursions: Dict[int, Dict[str, Any]] = {}

        # Micro-stoppages: dict of seq -> {"ticks_remaining": int, "delay_sec": float}
        self.micro_stoppages: Dict[int, Dict[str, Any]] = {}

        # 1/f Pink noise state & ambient drift
        self.station_thermal_drift = {s: 0.0 for s in range(1, 31)}
        self.pink_noise_state = {
            s: {"ct": 0.0, "vib": 0.0, "temp": 0.0, "torque": 0.0}
            for s in range(1, 31)
        }

    def _sample_non_stationary_noise(self, s: int) -> dict:
        """Sample non-stationary sensor noise (1/f pink noise, thermal accumulation)."""
        pn = self.pink_noise_state.setdefault(
            s, {"ct": 0.0, "vib": 0.0, "temp": 0.0, "torque": 0.0}
        )
        pn["ct"] = 0.85 * pn["ct"] + random.gauss(0, 0.25)
        pn["vib"] = 0.85 * pn["vib"] + random.gauss(0, 0.03)
        pn["temp"] = 0.90 * pn["temp"] + random.gauss(0, 0.12)
        pn["torque"] = 0.85 * pn["torque"] + random.gauss(0, 0.35)

        self.station_thermal_drift[s] = max(
            -1.2, min(5.5, self.station_thermal_drift.get(s, 0.0) + random.uniform(-0.02, 0.04))
        )

        return {
            "ct": pn["ct"],
            "vib": pn["vib"] + (self.station_wear_state.get(s, 0.0) * 0.15),
            "temp": pn["temp"] + self.station_thermal_drift[s],
            "torque": pn["torque"],
        }

    def _get_vehicle(self, vi: int) -> dict:
        """Get vehicle from cohort or generate on the fly with realistic physics."""
        while vi >= len(self.cohort):
            next_vi = len(self.cohort)
            vid = f"VEH_{4800 + next_vi}"
            events = []
            material_hardness = float(random.gauss(1.0, 0.04))
            for s in range(1, 31):
                sid = f"STATION_{s:02d}"
                res_id = f"R{s:02d}"
                has_sensors = 0 if s in {4, 9, 16, 22, 27} else 1
                base_ct = 65.0 + (s % 5) * 2.5
                base_vib = 1.4 + (s * 0.03)
                base_temp = 36.0 + (s * 0.4)
                base_torque = 42.0 if s in TORQUE_STATIONS else 0.0

                ns = self._sample_non_stationary_noise(s)
                ct = base_ct + ns["ct"]
                vib = (base_vib + ns["vib"]) * material_hardness
                temp = base_temp + ns["temp"]
                torque = (base_torque + ns["torque"]) * material_hardness if base_torque > 0 else 0.0

                events.append({
                    "vehicle_id": vid,
                    "station_id": sid,
                    "resource_id": res_id,
                    "sequence_no": s,
                    "cycle_time_sec": round(max(1.0, ct), 2),
                    "vibration_mm_s": round(max(0.01, vib), 3),
                    "temperature_c": round(max(15.0, temp), 2),
                    "torque_nm": round(max(10.0, torque), 2) if torque > 0 else BASE_TORQUE_NM,
                    "is_inferred": 1 if has_sensors == 0 else 0,
                    "has_sensors": has_sensors,
                    "is_anomaly": 0,
                    "anomaly_label": "NOMINAL",
                    "timestamp": datetime.now().isoformat(),
                })
            self.cohort.append({
                "vehicle_id": vid,
                "model": "Model-X",
                "events": events,
            })
        return self.cohort[vi]

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    async def start(self):
        """Wipe DB, reseed, fast-forward to steady state (tick 34), then loop every 2.5 s."""
        import backend.db.init_db as init_db
        init_db.init_db()

        self.tick_index = 0
        for _ in range(34):
            await asyncio.to_thread(self._process_tick)

        while True:
            await asyncio.sleep(2.5)
            await asyncio.to_thread(self._process_tick)

    # ── Interactive Intervention Execution ────────────────────────────────────
    def execute_action(
        self, station_id: str, scenario_label: str, anomaly_id: Optional[int] = None
    ) -> dict:
        """Execute what-if intervention on a target station.

        Resets accumulated tool wear, thermal drift, and active excursions back to 0.
        Transitions the station to GREEN within 2 ticks (immediately on next cycle)
        and clears the affected blast radius cohort.
        """
        try:
            seq = int(station_id.replace("STATION_", ""))
        except Exception:
            seq = 14

        # Reset station wear and thermal drift back to baseline
        self.station_wear_state[seq] = 0.0
        self.station_thermal_drift[seq] = 0.0
        self.thermal_excursions.pop(seq, None)
        self.micro_stoppages.pop(seq, None)
        self.pink_noise_state[seq] = {"ct": 0.0, "vib": 0.0, "temp": 0.0, "torque": 0.0}

        # Resolve open anomaly in SQLite
        conn = get_sync_connection()
        resolve_station_anomaly(conn, station_id)
        if anomaly_id:
            conn.execute(
                "UPDATE anomalies SET status = 'resolved', window_end = datetime('now') WHERE id = ?",
                (anomaly_id,),
            )
            conn.execute("DELETE FROM blast_radius WHERE anomaly_id = ?", (anomaly_id,))
        else:
            conn.execute(
                "DELETE FROM blast_radius WHERE anomaly_id IN "
                "(SELECT id FROM anomalies WHERE station_id = ?)",
                (station_id,),
            )
        conn.commit()

        # Immediately update global state snapshot
        self._update_global_state(conn, [])
        conn.close()

        print(f"ACTION EXECUTED: '{scenario_label}' on {station_id}. Telemetry reset to baseline (Δ=0).")
        return {
            "status": "success",
            "message": f"Action '{scenario_label}' executed at {station_id}. Station telemetry reset to baseline.",
            "station_id": station_id,
            "scenario_label": scenario_label,
        }

    def optimize_energy(self, station_id: Optional[str] = None, action_label: Optional[str] = None) -> dict:
        """Executes ML-recommended thermal operating setpoints, servo recalibrations,
        and idle standby optimization across target stations or the entire line.
        """
        conn = get_sync_connection()
        try:
            if station_id and station_id != "ALL":
                try:
                    seq = int(station_id.replace("STATION_", ""))
                except Exception:
                    seq = 14
                self.station_thermal_drift[seq] = 0.0
                self.thermal_excursions.pop(seq, None)
                self.station_wear_state[seq] = max(0.0, self.station_wear_state.get(seq, 0.0) * 0.1)
                self.pink_noise_state[seq] = {"ct": 0.0, "vib": 0.0, "temp": 0.0, "torque": 0.0}
                target_desc = f"Station {seq}"
            else:
                for s in range(1, 31):
                    self.station_thermal_drift[s] = 0.0
                    self.thermal_excursions.pop(s, None)
                    self.station_wear_state[s] = max(0.0, self.station_wear_state.get(s, 0.0) * 0.1)
                    self.pink_noise_state[s] = {"ct": 0.0, "vib": 0.0, "temp": 0.0, "torque": 0.0}
                target_desc = "All 30 Assembly Stations"

            self._update_global_state(conn, [])
            conn.close()

            lbl = action_label or "ML Thermal & Power Optimization"
            print(f"ENERGY OPTIMIZATION EXECUTED: '{lbl}' on {target_desc}.")
            return {
                "status": "success",
                "message": f"ML Energy Optimization applied: '{lbl}' on {target_desc}. Thermal setpoints aligned to optimal curve.",
                "target": station_id or "ALL",
                "action_label": lbl,
                "total_line_power_kw": GLOBAL_STATE["kpis"].get("total_line_power_kw"),
                "avoidable_waste_kw": GLOBAL_STATE["kpis"].get("avoidable_waste_kw"),
                "avoidable_energy_cost_daily": GLOBAL_STATE["kpis"].get("avoidable_energy_cost_daily"),
            }
        except Exception as e:
            if conn:
                conn.close()
            raise e

    # ── Tick ──────────────────────────────────────────────────────────────────
    def _process_tick(self):
        conn = get_sync_connection()
        now = datetime.now()

        # ── 1. Anomaly Lifecycle Progression Across All 30 Stations ───────────
        # Tool wear accumulation on torque/press stations
        for s in TORQUE_STATIONS:
            if self.station_wear_state.get(s, 0.0) > 0:
                self.station_wear_state[s] += random.uniform(0.003, 0.008)
            else:
                # Slowly accumulates after reset
                self.station_wear_state[s] += random.uniform(0.0005, 0.0015)

        # Thermal excursions countdown & stochastic spawn
        for s in list(self.thermal_excursions.keys()):
            self.thermal_excursions[s]["ticks_remaining"] -= 1
            if self.thermal_excursions[s]["ticks_remaining"] <= 0:
                del self.thermal_excursions[s]

        if len(self.thermal_excursions) == 0 and random.random() < 0.04:
            c_station = random.choice(list(CURING_STATIONS))
            self.thermal_excursions[c_station] = {
                "ticks_remaining": random.randint(5, 8),
                "temp_spike": random.uniform(8.5, 12.0),
            }

        # Micro-stoppages countdown & stochastic spawn (~0.2% per tick)
        for s in list(self.micro_stoppages.keys()):
            self.micro_stoppages[s]["ticks_remaining"] -= 1
            if self.micro_stoppages[s]["ticks_remaining"] <= 0:
                del self.micro_stoppages[s]

        if len(self.micro_stoppages) == 0 and random.random() < 0.003:
            rand_s = random.randint(1, 30)
            self.micro_stoppages[rand_s] = {
                "ticks_remaining": random.randint(2, 3),
                "delay_sec": random.uniform(14.0, 16.5),
            }

        # ── 2. Write Active Process Events to SQLite ──────────────────────────
        active_events = []
        start_vi = max(0, self.tick_index - 29)
        end_vi = self.tick_index + 1
        for vi in range(start_vi, end_vi):
            vehicle = self._get_vehicle(vi)
            si = self.tick_index - vi
            if 0 <= si < 30:
                seq = si + 1
                evt = vehicle["events"][si]
                active_events.append((vehicle, evt, vi))

                if si == 0:
                    conn.execute(
                        "INSERT OR IGNORE INTO vehicles (id, model, line_entry_ts) "
                        "VALUES (?, ?, ?)",
                        (vehicle["vehicle_id"], vehicle["model"], now.isoformat()),
                    )

                # Physical drift contributions
                wear = self.station_wear_state.get(seq, 0.0)
                wear_ct = (wear * 3.8) if wear >= 2.2 else (wear * 0.4)
                wear_vib = (wear * 0.72) if wear >= 2.2 else (wear * 0.1)
                wear_temp = (wear * 2.2) if wear >= 2.2 else (wear * 0.3)
                wear_torque = (wear * 2.0) if (wear >= 2.2 and seq in TORQUE_STATIONS) else 0.0

                excursion_temp = (
                    self.thermal_excursions[seq]["temp_spike"]
                    if seq in self.thermal_excursions
                    else 0.0
                )
                stoppage_ct = (
                    self.micro_stoppages[seq]["delay_sec"]
                    if seq in self.micro_stoppages
                    else 0.0
                )

                ns = self._sample_non_stationary_noise(seq)
                ct_val = round(max(1.0, evt["cycle_time_sec"] + wear_ct + stoppage_ct + ns["ct"] * 0.3), 2)
                vib_val = round(max(0.01, evt["vibration_mm_s"] + wear_vib + ns["vib"] * 0.3), 3)
                temp_val = round(max(15.0, evt["temperature_c"] + wear_temp + excursion_temp + ns["temp"] * 0.2), 2)
                torque_val = round(max(10.0, evt["torque_nm"] + wear_torque + ns["torque"] * 0.3), 2)

                entered = now - timedelta(seconds=ct_val)
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
                        ct_val, vib_val, temp_val, torque_val,
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
        """Rebuild GLOBAL_STATE with dynamic multi-station anomalies and correlated blast radius."""

        # ── 1. Evaluate All 30 Stations Dynamically ───────────────────────────
        stations = []
        anomalous_stations = []

        for row in conn.execute("SELECT * FROM stations ORDER BY sequence_no"):
            s = dict(row)
            sid = s["id"]
            seq = s.get("sequence_no", 1)

            bl_row = conn.execute(
                "SELECT * FROM station_baselines WHERE station_id = ?", (sid,)
            ).fetchone()
            s["baseline"] = dict(bl_row) if bl_row else {}
            bl = s["baseline"]

            base_ct = bl.get("expected_cycle_time_sec", 65.0)
            base_vib = bl.get("expected_vibration_mm_s", 1.8)
            base_temp = bl.get("expected_temperature_c", 40.0)
            base_torque = 42.0 if seq in TORQUE_STATIONS else BASE_TORQUE_NM

            wear = self.station_wear_state.get(seq, 0.0)
            wear_ct = (wear * 3.8) if wear >= 2.2 else (wear * 0.4)
            wear_vib = (wear * 0.72) if wear >= 2.2 else (wear * 0.1)
            wear_temp = (wear * 2.2) if wear >= 2.2 else (wear * 0.3)
            wear_torque = (wear * 2.0) if (wear >= 2.2 and seq in TORQUE_STATIONS) else 0.0

            excursion_temp = (
                self.thermal_excursions[seq]["temp_spike"]
                if seq in self.thermal_excursions
                else 0.0
            )
            stoppage_ct = (
                self.micro_stoppages[seq]["delay_sec"]
                if seq in self.micro_stoppages
                else 0.0
            )

            ns = self._sample_non_stationary_noise(seq)
            live_ct = round(base_ct + wear_ct + stoppage_ct + ns["ct"], 1)
            live_vib = round(max(0.08, base_vib + wear_vib + ns["vib"]), 2)
            live_temp = round(base_temp + wear_temp + excursion_temp + ns["temp"], 1)
            live_torque = round(max(10.0, base_torque + wear_torque + ns["torque"]), 1)

            # Determine dynamic station status
            is_wear_critical = (wear >= 2.2 and seq in TORQUE_STATIONS)
            is_temp_critical = (excursion_temp >= 6.0)
            is_stoppage_warning = (stoppage_ct > 0)

            if is_wear_critical or is_temp_critical:
                status = "anomaly"
            elif is_stoppage_warning or (wear >= 1.2):
                status = "warning"
            else:
                status = "normal"

            s["status"] = status
            s["cycle_time"] = live_ct
            s["vibration"] = live_vib
            s["temperature"] = live_temp
            s["torque"] = live_torque

            # Power metrics evaluation via ML power optimizer
            pwr = evaluate_station_power(
                seq=seq,
                cycle_time=live_ct,
                torque=live_torque,
                temp=live_temp,
                vib=live_vib,
            )
            s["actual_power_kw"] = pwr["actual_power_kw"]
            s["min_achievable_power_kw"] = pwr["min_achievable_power_kw"]
            s["avoidable_waste_kw"] = pwr["avoidable_waste_kw"]
            s["avoidable_energy_cost_hourly"] = pwr["avoidable_energy_cost_hourly"]
            s["optimal_plant_temp_c"] = pwr["optimal_plant_temp_c"]

            # Residuals
            s["ct_residual"] = round(live_ct - base_ct, 1)
            s["vib_residual"] = round(live_vib - base_vib, 2)
            s["temp_residual"] = round(live_temp - base_temp, 1)


            if status == "anomaly":
                s["confidence_score"] = round(88.0 + random.uniform(-1.0, 1.0), 1)
                if is_wear_critical:
                    s["root_causes"] = [
                        {"cause_label": "Tool Wear", "probability_pct": 74.0},
                        {"cause_label": "Spindle Degradation", "probability_pct": 18.0},
                        {"cause_label": "Thermal Drift", "probability_pct": 8.0},
                    ]
                else:
                    s["root_causes"] = [
                        {"cause_label": "Thermal Drift", "probability_pct": 82.0},
                        {"cause_label": "Oven Curing Imbalance", "probability_pct": 12.0},
                        {"cause_label": "Sensor Calibration", "probability_pct": 6.0},
                    ]
                anomalous_stations.append(s)
            elif status == "warning":
                s["confidence_score"] = 65.0
                s["root_causes"] = [
                    {"cause_label": "Pneumatic Pressure Drop", "probability_pct": 80.0},
                    {"cause_label": "Transit Delay", "probability_pct": 20.0},
                ]
            else:
                s["confidence_score"] = None
                s["root_causes"] = None

            stations.append(s)

        # ── 2. Correlated Multi-Station Blast Radius ──────────────────────────
        critical_vids: Set[str] = set()
        critical_vid_to_station: Dict[str, str] = {}
        warning_vids: Set[str] = set()
        warning_vid_to_station: Dict[str, str] = {}

        anomalies_list = []
        for ast in anomalous_stations:
            seq = ast["sequence_no"]
            si = seq - 1

            # Vehicle inside station X is CRITICAL (Red)
            vi_center = self.tick_index - si
            v_center = self._get_vehicle(vi_center)["vehicle_id"]
            critical_vids.add(v_center)
            critical_vid_to_station[v_center] = ast["name"]

            blast_radius_vehicles = [v_center]

            # 3 chassis immediately downstream (seq + 1, seq + 2, seq + 3)
            for k in [1, 2, 3]:
                if seq + k <= 30:
                    vi_down = self.tick_index - (seq + k - 1)
                    v_down = self._get_vehicle(vi_down)["vehicle_id"]
                    if v_down not in critical_vids:
                        warning_vids.add(v_down)
                        warning_vid_to_station[v_down] = ast["name"]
                    blast_radius_vehicles.append(v_down)

            # 3 chassis immediately upstream (seq - 1, seq - 2, seq - 3)
            for k in [1, 2, 3]:
                if seq - k >= 1:
                    vi_up = self.tick_index - (seq - k - 1)
                    v_up = self._get_vehicle(vi_up)["vehicle_id"]
                    if v_up not in critical_vids:
                        warning_vids.add(v_up)
                        warning_vid_to_station[v_up] = ast["name"]
                    blast_radius_vehicles.append(v_up)

            # Update blast radius in SQLite
            conn.execute(
                "INSERT OR IGNORE INTO anomalies "
                "(station_id, resource_id, detected_at, window_start, status, recommended_action) "
                "VALUES (?, ?, datetime('now'), datetime('now'), 'open', 'Emergency E-Stop')",
                (ast["id"], ast.get("resource_id", f"R{seq:02d}")),
            )
            anom_row = conn.execute(
                "SELECT id FROM anomalies WHERE station_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
                (ast["id"],),
            ).fetchone()
            anom_id = anom_row["id"] if anom_row else (seq * 100)

            # Persist blast radius rows
            conn.execute("DELETE FROM blast_radius WHERE anomaly_id = ?", (anom_id,))
            for vid in blast_radius_vehicles:
                conn.execute(
                    "INSERT INTO blast_radius (anomaly_id, vehicle_id) VALUES (?, ?)",
                    (anom_id, vid),
                )
            conn.commit()

            anomalies_list.append({
                "id": anom_id,
                "station_id": ast["id"],
                "station": {
                    "id": ast["id"],
                    "name": ast["name"],
                    "sequence_no": seq,
                    "has_sensors": bool(ast.get("has_sensors", 1)),
                    "resource_id": ast.get("resource_id", f"R{seq:02d}"),
                    "status": "anomaly",
                    "baseline": ast["baseline"],
                },
                "residual_cycle_time": ast["ct_residual"],
                "residual_vibration": ast["vib_residual"],
                "residual_temperature": ast["temp_residual"],
                "confidence_score": ast["confidence_score"] or 88.0,
                "status": "open",
                "recommended_action": "Emergency E-Stop",
                "root_causes": ast["root_causes"],
                "blast_radius": blast_radius_vehicles,
                "what_if": [
                    {
                        "scenario_label": "Reroute",
                        "projected_throughput_impact": -6.0,
                        "projected_defect_containment": 70.0,
                        "is_recommended": False,
                    },
                    {
                        "scenario_label": "Slow Line Speed",
                        "projected_throughput_impact": -12.0,
                        "projected_defect_containment": 85.0,
                        "is_recommended": False,
                    },
                    {
                        "scenario_label": "Emergency E-Stop",
                        "projected_throughput_impact": -28.0,
                        "projected_defect_containment": 100.0,
                        "is_recommended": True,
                    },
                ],
            })

        # ── 3. Active Conveyor Vehicles (Exactly 30 on Physical Line) ─────────
        active_vehicles = []
        for seq in range(1, 31):
            si = seq - 1
            vi = self.tick_index - si
            v_obj = self._get_vehicle(vi)
            vid = v_obj["vehicle_id"]
            station_id = f"STATION_{seq:02d}"

            # Run real ML model inference on vehicle telemetry
            events_so_far = v_obj.get("events", [])[:seq]
            ml_feats = extract_features_from_telemetry(events_so_far, current_station_seq=seq)
            ml_pred = predict_vehicle_risk(ml_feats)
            ml_prob = ml_pred["predicted_defect_probability"]
            ml_pct = ml_pred["predicted_defect_pct"]
            top_drivers = ml_pred["model_feature_importances"]

            if vid in critical_vids:
                status = "critical"
                st_name = critical_vid_to_station.get(vid, station_id)
                defect_risk_pct = max(ml_pct, 92.0)
                defect_label = f"CRITICAL ({st_name} Breach - ML Defect Risk: {defect_risk_pct:.0f}%)"
                is_blast = True
            elif vid in warning_vids:
                status = "warning"
                defect_risk_pct = max(ml_pct, 65.0)
                defect_label = f"WARNING (Blast Radius - ML Defect Risk: {defect_risk_pct:.0f}%)"
                is_blast = True
            elif ml_prob >= 0.70:
                status = "critical"
                defect_risk_pct = ml_pct
                defect_label = f"CRITICAL (ML Model Risk: {defect_risk_pct:.0f}%)"
                is_blast = True
            elif ml_prob >= 0.35 or seq in self.micro_stoppages:
                status = "warning"
                defect_risk_pct = max(ml_pct, 42.0)
                defect_label = f"WARNING (Elevated ML Risk: {defect_risk_pct:.0f}%)"
                is_blast = True
            else:
                status = "normal"
                defect_risk_pct = min(ml_pct, 5.0)
                defect_label = f"PASSING (Normal - ML Risk: {defect_risk_pct:.0f}%)"
                is_blast = False

            active_vehicles.append({
                "id": vid,
                "model": v_obj.get("model", "Model-X"),
                "current_station": station_id,
                "station_id": station_id,
                "sequence_no": seq,
                "status": status,
                "is_in_blast_radius": is_blast,
                "defect_risk_pct": defect_risk_pct,
                "defect_label": defect_label,
                "predicted_defect_probability": round(ml_prob, 4),
                "model_feature_importances": top_drivers,
                "completed": False,
            })

        # ── 4. Completed Historical Vehicles Archive (Exited S30) ────────────
        completed_vehicles = []
        max_completed_vi = self.tick_index - 30
        for vi in range(max(0, max_completed_vi - 100), max_completed_vi + 1):
            v_obj = self._get_vehicle(vi)
            vid = v_obj["vehicle_id"]
            events_all = v_obj.get("events", [])
            has_defect = any(e.get("is_anomaly", 0) > 0 for e in events_all)

            ml_feats = extract_features_from_telemetry(events_all, current_station_seq=30)
            ml_pred = predict_vehicle_risk(ml_feats)
            ml_prob = ml_pred["predicted_defect_probability"]
            ml_pct = ml_pred["predicted_defect_pct"]

            if vid in critical_vids:
                status = "critical"
                defect_risk_pct = max(ml_pct, 92.0)
                defect_label = f"CRITICAL (Defect Flagged - ML: {defect_risk_pct:.0f}%)"
                is_blast = True
            elif vid in warning_vids or has_defect:
                status = "warning"
                defect_risk_pct = max(ml_pct, 62.0)
                defect_label = f"WARNING (Blast Radius - ML: {defect_risk_pct:.0f}%)"
                is_blast = True
            else:
                status = "normal"
                defect_risk_pct = min(ml_pct, 4.0)
                defect_label = "PASSING (Normal 3-Sigma)"
                is_blast = False

            completed_vehicles.append({
                "id": vid,
                "model": v_obj.get("model", "Model-X"),
                "current_station": "STATION_30 (Completed)",
                "station_id": "STATION_30",
                "sequence_no": 30,
                "status": status,
                "is_in_blast_radius": is_blast,
                "defect_risk_pct": defect_risk_pct,
                "defect_label": defect_label,
                "completed": True,
            })

        # ── 5. KPIs ───────────────────────────────────────────────────────────
        max_ct = max([st["cycle_time"] for st in stations] or [65.0])
        active_vel = round(3600.0 / max(50.0, max_ct) + random.uniform(-0.3, 0.3), 1)

        defect_count = len(critical_vids) + len(warning_vids)
        defect_risk = round(min(98.0, (defect_count / 30.0) * 100.0), 1) if defect_count > 0 else 0.0

        blind_stations = conn.execute(
            "SELECT COUNT(*) as c FROM stations WHERE has_sensors=0"
        ).fetchone()["c"]

        total_line_power_kw = round(sum(st.get("actual_power_kw", 0.0) for st in stations), 1)
        optimal_line_power_kw = round(sum(st.get("min_achievable_power_kw", 0.0) for st in stations), 1)
        total_avoidable_waste_kw = round(max(0.0, total_line_power_kw - optimal_line_power_kw), 1)
        hourly_energy_waste_cost = round(total_avoidable_waste_kw * 0.12, 2)
        daily_energy_waste_cost = round(hourly_energy_waste_cost * 24.0, 2)

        # Top 3 Energy Drain Stations
        sorted_drain = sorted(stations, key=lambda st: st.get("avoidable_waste_kw", 0.0), reverse=True)
        top_energy_drain_stations = []
        for ds in sorted_drain[:3]:
            d_seq = ds["sequence_no"]
            waste = ds.get("avoidable_waste_kw", 0.0)
            cost_hr = ds.get("avoidable_energy_cost_hourly", 0.0)

            if d_seq in TORQUE_STATIONS and ds.get("status") in {"warning", "anomaly"}:
                rec = f"Recalibrate servo drive & joint coupling to eliminate {waste:.1f} kW friction loss"
            elif ds.get("temp_residual", 0.0) > 3.0 or ds.get("temp_residual", 0.0) < -3.0:
                rec = f"Optimize thermal insulation & chiller envelope to recover {waste:.1f} kW excess cooling draw"
            elif ds.get("ct_residual", 0.0) > 4.0:
                rec = f"Clear pneumatic throttling valve to eliminate {waste:.1f} kW idle wait draw"
            else:
                rec = f"Tune variable-frequency drive (VFD) profile to trim {waste:.1f} kW parasitic draw"

            top_energy_drain_stations.append({
                "station_id": ds["id"],
                "name": ds["name"],
                "sequence_no": d_seq,
                "actual_power_kw": ds.get("actual_power_kw", 0.0),
                "min_achievable_power_kw": ds.get("min_achievable_power_kw", 0.0),
                "avoidable_waste_kw": waste,
                "hourly_waste_cost": cost_hr,
                "recommended_action": rec,
            })

        kpis = {
            "active_line_velocity": active_vel,
            "fleet_defect_risk_pct": defect_risk,
            "blind_stations_inferred": blind_stations,
            "total_blind_stations": blind_stations,
            "total_units_in_buffer": 14,
            "total_line_power_kw": total_line_power_kw,
            "optimal_line_power_kw": optimal_line_power_kw,
            "avoidable_waste_kw": total_avoidable_waste_kw,
            "avoidable_energy_cost_hourly": hourly_energy_waste_cost,
            "avoidable_energy_cost_daily": daily_energy_waste_cost,
            "top_energy_drain_stations": top_energy_drain_stations,
        }


        GLOBAL_STATE["stations"] = stations
        GLOBAL_STATE["anomalies"] = anomalies_list
        GLOBAL_STATE["vehicles"] = active_vehicles
        GLOBAL_STATE["completed_vehicles"] = completed_vehicles
        GLOBAL_STATE["kpis"] = kpis


streamer = SimulationStreamer()
