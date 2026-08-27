"""Synthetic factory data generator for TRACE-TWIN.

Generates realistic process_events for vehicles flowing through a 30-station
assembly line across 3 zones:
  Body Construction (1-10) | Paint (11-18) | Final Assembly (19-30)

Features:
  - Gaussian noise around station baselines
  - Semantic layer reconciliation (MES/PLC source naming → cycle_time_sec)
  - Anomaly injection at Station 14 (progressive torque drift)
  - Multi-station blind inference for sensorless stations (4, 9, 16, 22, 27)
"""

import random
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ANOMALY_STATION = "STATION_14"

# Sensorless / legacy stations — readings inferred from upstream neighbor
BLIND_STATIONS = {"STATION_04", "STATION_09", "STATION_16", "STATION_22", "STATION_27"}

# Anomaly injection: first affected vehicle index (0-based within the batch)
ANOMALY_START_INDEX = 7   # → VEH_4817 when start_id=4810
ANOMALY_END_INDEX   = 15  # → VEH_4825, 9 vehicles in blast radius

# Per-tick drift increments at the anomaly station
DRIFT_CYCLE   = 2.0   # seconds added per affected vehicle
DRIFT_VIB     = 0.3   # mm/s added per affected vehicle
DRIFT_TEMP    = 1.5   # °C added per affected vehicle
MAX_DRIFT_MULT = 9     # cap the progressive drift multiplier

NOISE_FRAC = 0.002     # Extremely low noise to prevent random anomalies
TRANSIT_MIN = 10       # seconds between stations
TRANSIT_MAX = 15
VEHICLE_INTERVAL = 120 # seconds between vehicle entries (≈ 30/hr)

MACHINE_FIXED = False

def fix_machine():
    """Globally marks the simulator machine as fixed, ending any ongoing drift."""
    global MACHINE_FIXED
    MACHINE_FIXED = True

def reset_machine():
    """Resets the simulator machine state."""
    global MACHINE_FIXED
    MACHINE_FIXED = False


class FactorySimulator:
    """Generates synthetic process_event data for the assembly line."""

    def __init__(
        self,
        conn,
        start_vehicle_id: int = 4810,
        num_vehicles: int = 16,
        base_time: Optional[datetime] = None,
    ):
        self.conn = conn
        self.start_vehicle_id = start_vehicle_id
        self.num_vehicles = num_vehicles
        self.base_time = base_time or datetime(2026, 8, 24, 8, 0, 0)

        # Load station order + baselines from DB
        self.stations = []
        rows = conn.execute(
            "SELECT s.id, s.name, s.sequence_no, s.has_sensors, s.resource_id "
            "FROM stations s ORDER BY s.sequence_no"
        ).fetchall()
        for r in rows:
            self.stations.append({
                "id": r["id"],
                "name": r["name"],
                "sequence_no": r["sequence_no"],
                "has_sensors": bool(r["has_sensors"]),
                "resource_id": r["resource_id"],
            })

        self.baselines = {}
        rows = conn.execute(
            "SELECT station_id, expected_cycle_time_sec, "
            "expected_vibration_mm_s, expected_temperature_c "
            "FROM station_baselines"
        ).fetchall()
        for r in rows:
            self.baselines[r["station_id"]] = {
                "cycle_time": r["expected_cycle_time_sec"],
                "vibration": r["expected_vibration_mm_s"],
                "temperature": r["expected_temperature_c"],
            }

        # For live mode — track state
        self._tick_vehicle_idx = 0
        self._tick_station_idx = 0
        self._tick_last_exit: dict[str, datetime] = {}

    # ------------------------------------------------------------------
    # Batch generation
    # ------------------------------------------------------------------
    def generate_batch(self) -> dict:
        """Generate all vehicles × stations in one batch. Returns summary stats."""
        rng = np.random.default_rng(42)
        events_count = 0
        inferred_count = 0

        for vi in range(self.num_vehicles):
            vehicle_id = f"VEH_{self.start_vehicle_id + vi:04d}"
            entry_ts = self.base_time + timedelta(seconds=vi * VEHICLE_INTERVAL)

            # Insert vehicle row
            self.conn.execute(
                "INSERT INTO vehicles (id, model, line_entry_ts) VALUES (?, ?, ?)",
                (vehicle_id, "Model-X", entry_ts.isoformat()),
            )

            prev_exit = entry_ts
            prev_readings: dict | None = None
            
            # Space out vehicles: #4821 (vi=11) should be at S24 (index 23)
            # So target_station_idx = 34 - vi.
            target_station_idx = 34 - vi

            for si, station in enumerate(self.stations):
                if si > target_station_idx:
                    break

                sid = station["id"]
                baseline = self.baselines[sid]

                # --- Compute entered_at ---
                if station is self.stations[0]:
                    entered_at = entry_ts
                else:
                    transit = rng.uniform(TRANSIT_MIN, TRANSIT_MAX)
                    entered_at = prev_exit + timedelta(seconds=transit)

                is_blind = sid in BLIND_STATIONS
                is_inferred = 0
                source = "MES" if rng.random() > 0.4 else "PLC"

                if is_blind and prev_readings is not None:
                    # ─── Blind / Sensorless station: infer from upstream + baseline ───
                    cycle_time  = (prev_readings["cycle_time"]  + baseline["cycle_time"])  / 2 + rng.normal(0, 1.0)
                    vibration   = (prev_readings["vibration"]   + baseline["vibration"])   / 2 + rng.normal(0, 0.05)
                    temperature = (prev_readings["temperature"] + baseline["temperature"]) / 2 + rng.normal(0, 0.5)
                    source = "INFERRED"
                    is_inferred = 1
                else:
                    # ─── Normal station with Gaussian noise ───
                    cycle_time  = baseline["cycle_time"]  + rng.normal(0, baseline["cycle_time"]  * NOISE_FRAC)
                    vibration   = baseline["vibration"]   + rng.normal(0, baseline["vibration"]   * NOISE_FRAC)
                    temperature = baseline["temperature"] + rng.normal(0, baseline["temperature"] * NOISE_FRAC)

                # Clamp to reasonable ranges
                cycle_time  = max(cycle_time, baseline["cycle_time"] * 0.8)
                vibration   = max(vibration, 0.1)
                temperature = max(temperature, 15.0)

                # ─── Anomaly injections ───
                if sid == ANOMALY_STATION and not MACHINE_FIXED:
                    if vi < ANOMALY_START_INDEX:
                        cycle_time = baseline["cycle_time"] + rng.normal(0, 0.45)
                    elif ANOMALY_START_INDEX <= vi <= ANOMALY_END_INDEX:
                        progress = (vi - ANOMALY_START_INDEX + 1) / (ANOMALY_END_INDEX - ANOMALY_START_INDEX + 1)
                        cycle_time = baseline["cycle_time"] + 18.0 * (progress ** 1.5) + rng.normal(0, 0.45)
                        drift_mult = min(vi - ANOMALY_START_INDEX + 1, MAX_DRIFT_MULT)
                        vibration   += DRIFT_VIB   * drift_mult
                        temperature += DRIFT_TEMP  * drift_mult
                    else:
                        cycle_time = 70.0 + rng.normal(0, 0.45)
                        vibration   += DRIFT_VIB   * MAX_DRIFT_MULT
                        temperature += DRIFT_TEMP  * MAX_DRIFT_MULT
                elif sid == "STATION_24" and vi >= 10:
                    cycle_time += 7.0
                    vibration += 0.8
                elif sid == "STATION_03" and vi >= 12:
                    cycle_time += 6.5
                    temperature += 6.0
                elif sid == "STATION_09" and vi >= 10:
                    cycle_time += 5.5
                elif sid == "STATION_12" and 2 <= vi <= 8:
                    cycle_time += 8.0
                    temperature -= 6.0

                exited_at = entered_at + timedelta(seconds=cycle_time)

                # ─── Insert event ───
                self.conn.execute(
                    "INSERT INTO process_events "
                    "(vehicle_id, station_id, resource_id, entered_at, exited_at, "
                    "cycle_time_sec, vibration_mm_s, temperature_c, source_system, is_inferred) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (vehicle_id, sid, station["resource_id"],
                     entered_at.isoformat(), exited_at.isoformat(),
                     round(cycle_time, 2), round(vibration, 3), round(temperature, 2),
                     source, is_inferred),
                )
                events_count += 1
                if is_inferred:
                    inferred_count += 1

                prev_exit = exited_at
                prev_readings = {
                    "cycle_time": cycle_time,
                    "vibration": vibration,
                    "temperature": temperature,
                }

        self.conn.commit()
        return {
            "vehicles": self.num_vehicles,
            "events": events_count,
            "inferred_events": inferred_count,
            "stations": len(self.stations),
        }

    # ------------------------------------------------------------------
    # Live tick generation (one event at a time)
    # ------------------------------------------------------------------
    def generate_tick(self) -> Optional[dict]:
        """Generate a single process_event. Returns the event dict or None when done."""
        if self._tick_vehicle_idx >= self.num_vehicles:
            return None

        vi = self._tick_vehicle_idx
        si = self._tick_station_idx
        vehicle_id = f"VEH_{self.start_vehicle_id + vi:04d}"
        station = self.stations[si]
        sid = station["id"]
        baseline = self.baselines[sid]
        rng = random.Random(vi * 100 + si)

        # Entry timestamp
        if si == 0 and vi == 0:
            entered_at = self.base_time
        elif si == 0:
            entered_at = self.base_time + timedelta(seconds=vi * VEHICLE_INTERVAL)
        else:
            prev_key = f"{vehicle_id}_{si - 1}"
            prev_exit = self._tick_last_exit.get(prev_key, self.base_time)
            transit = rng.uniform(TRANSIT_MIN, TRANSIT_MAX)
            entered_at = prev_exit + timedelta(seconds=transit)

        # Generate readings
        cycle_time  = baseline["cycle_time"]  + rng.gauss(0, baseline["cycle_time"]  * NOISE_FRAC)
        vibration   = baseline["vibration"]   + rng.gauss(0, baseline["vibration"]   * NOISE_FRAC)
        temperature = baseline["temperature"] + rng.gauss(0, baseline["temperature"] * NOISE_FRAC)

        is_inferred = 0
        source = "MES" if rng.random() > 0.4 else "PLC"

        if sid in BLIND_STATIONS:
            is_inferred = 1
            source = "INFERRED"

        if sid == ANOMALY_STATION and not MACHINE_FIXED:
            if vi < ANOMALY_START_INDEX:
                cycle_time = baseline["cycle_time"] + rng.gauss(0, 0.45)
            elif ANOMALY_START_INDEX <= vi <= ANOMALY_END_INDEX:
                progress = (vi - ANOMALY_START_INDEX + 1) / (ANOMALY_END_INDEX - ANOMALY_START_INDEX + 1)
                cycle_time = baseline["cycle_time"] + 18.0 * (progress ** 1.5) + rng.gauss(0, 0.45)
                drift_mult = min(vi - ANOMALY_START_INDEX + 1, MAX_DRIFT_MULT)
                vibration   += DRIFT_VIB   * drift_mult
                temperature += DRIFT_TEMP  * drift_mult
            else:
                cycle_time = 70.0 + rng.gauss(0, 0.45)
                vibration   += DRIFT_VIB   * MAX_DRIFT_MULT
                temperature += DRIFT_TEMP  * MAX_DRIFT_MULT
        elif sid == "STATION_24" and vi >= 10:
            cycle_time += 7.0
            vibration += 0.8
        elif sid == "STATION_03" and vi >= 12:
            cycle_time += 6.5
            temperature += 6.0
        elif sid == "STATION_09" and vi >= 10:
            cycle_time += 5.5
        elif sid == "STATION_12" and 2 <= vi <= 8:
            cycle_time += 8.0
            temperature -= 6.0

        cycle_time  = max(cycle_time, baseline["cycle_time"] * 0.8)
        vibration   = max(vibration, 0.1)
        temperature = max(temperature, 15.0)

        exited_at = entered_at + timedelta(seconds=cycle_time)

        # Insert vehicle if first station
        if si == 0:
            self.conn.execute(
                "INSERT OR IGNORE INTO vehicles (id, model, line_entry_ts) VALUES (?, ?, ?)",
                (vehicle_id, "Model-X", entered_at.isoformat()),
            )

        self.conn.execute(
            "INSERT INTO process_events "
            "(vehicle_id, station_id, resource_id, entered_at, exited_at, "
            "cycle_time_sec, vibration_mm_s, temperature_c, source_system, is_inferred) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (vehicle_id, sid, station["resource_id"],
             entered_at.isoformat(), exited_at.isoformat(),
             round(cycle_time, 2), round(vibration, 3), round(temperature, 2),
             source, is_inferred),
        )
        self.conn.commit()

        # Track exit for next station
        self._tick_last_exit[f"{vehicle_id}_{si}"] = exited_at

        # Advance pointer
        self._tick_station_idx += 1
        if self._tick_station_idx >= len(self.stations):
            self._tick_station_idx = 0
            self._tick_vehicle_idx += 1

        return {
            "vehicle_id": vehicle_id,
            "station_id": sid,
            "cycle_time_sec": round(cycle_time, 2),
            "vibration_mm_s": round(vibration, 3),
            "temperature_c": round(temperature, 2),
            "is_inferred": bool(is_inferred),
        }
