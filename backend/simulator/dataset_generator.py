"""Cohort generator for TRACE-TWIN.

Produces a 50-vehicle matrix of deterministic-but-realistic process events
for all 30 stations. Each call uses seeded RNGs so results are reproducible
yet exhibit natural Gaussian jitter per spec:

  Cycle Time:  ± 0.6 s
  Temperature: ± 0.8 °C
  Vibration:   ± 0.12 mm/s
  Torque:      ± 1.2 Nm

Station 14 Tool-Wear Anomaly Window (progressive degradation):
  Ramp-up:  VEH_4817 → VEH_4821 (intensity 0 → 1)
  Peak:     VEH_4821 (CRITICAL)
  Recovery: VEH_4821 → VEH_4825 (intensity 1 → 0)

Peak anomaly offsets at Station 14:
  +14.2 s cycle time
  +2.6  mm/s vibration
  +9.5  °C temperature
  +6.0  Nm torque
"""

import random
from backend.db.init_db import STATIONS, BASELINES

# ─── Anomaly window ────────────────────────────────────────────────────────
ANOMALY_STATION  = "STATION_14"
ANOMALY_START_VI = 16   # VEH_4817
ANOMALY_PEAK_VI  = 20   # VEH_4821
ANOMALY_END_VI   = 24   # VEH_4825

DRIFT_CYCLE_TIME  = 14.2
DRIFT_VIBRATION   = 2.6
DRIFT_TEMPERATURE = 9.5
DRIFT_TORQUE      = 6.0

BASE_TORQUE_NM = 42.1


def generate_vehicle_cohort(num_vehicles: int = 50, start_id: int = 4801) -> list[dict]:
    """Generate a deterministic, jitter-rich vehicle cohort matrix."""
    vehicles = []

    for vi in range(num_vehicles):
        vid = f"VEH_{start_id + vi}"
        events = []

        for si, station in enumerate(STATIONS):
            sid, name, seq, has_sensors, res_id = station
            base_ct, base_vib, base_temp = BASELINES[sid]

            # Seeded RNG — reproducible but unique per (vehicle, station)
            rng = random.Random((start_id + vi) * 1000 + si)

            # ── 1. Natural Gaussian jitter (spec-mandated widths) ──────────
            ct     = base_ct   + rng.gauss(0, 0.6)
            vib    = base_vib  + rng.gauss(0, 0.12)
            temp   = base_temp + rng.gauss(0, 0.8)
            torque = BASE_TORQUE_NM + rng.gauss(0, 1.2)

            # ── 2. Station 14 progressive tool-wear anomaly ─────────────────
            if sid == ANOMALY_STATION and ANOMALY_START_VI <= vi <= ANOMALY_END_VI:
                if vi <= ANOMALY_PEAK_VI:
                    intensity = (vi - ANOMALY_START_VI) / float(ANOMALY_PEAK_VI - ANOMALY_START_VI)
                else:
                    intensity = (ANOMALY_END_VI - vi) / float(ANOMALY_END_VI - ANOMALY_PEAK_VI)

                ct     += DRIFT_CYCLE_TIME  * intensity
                vib    += DRIFT_VIBRATION   * intensity
                temp   += DRIFT_TEMPERATURE * intensity
                torque += DRIFT_TORQUE      * intensity

            # ── 3. Sensorless stations — wider inference uncertainty ────────
            is_inferred = 0
            if has_sensors == 0:
                is_inferred = 1
                ct     += rng.gauss(0, 0.8)
                vib    += rng.gauss(0, 0.15)
                temp   += rng.gauss(0, 1.0)
                torque += rng.gauss(0, 1.2)

            events.append({
                "vehicle_id":    vid,
                "station_id":    sid,
                "resource_id":   res_id,
                "cycle_time_sec":  round(max(1.0,  ct),     1),
                "vibration_mm_s":  round(max(0.01, vib),    2),
                "temperature_c":   round(max(15.0, temp),   1),
                "torque_nm":       round(max(10.0, torque), 1),
                "is_inferred":     is_inferred,
                "has_sensors":     has_sensors,
            })

        vehicles.append({
            "vehicle_id": vid,
            "model":      "Model-X",
            "events":     events,
        })

    return vehicles

