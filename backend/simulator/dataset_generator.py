"""Realistic physical dataset generator for TRACE-TWIN.

Generates production telemetry with:
- Natural tool wear drift and progressive degradation
- Thermal accumulation curves across 30 assembly stations
- 6% realistic defect/delay rate across 300 vehicles (VEH_4800 to VEH_5099)
- Station 14 tool wear excursion cohort (VEH_4817 to VEH_4825)
- Downstream geometry defect propagation (Stations 21, 22, 26, 27)
- Blind station inference flags (Stations 4, 9, 16, 22, 27)
- Export to backend/data/realistic_telemetry_dataset.csv
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any

DATA_DIR = Path(__file__).parent.parent / "data"
CSV_PATH = DATA_DIR / "realistic_telemetry_dataset.csv"

# ─── Anomaly window constants ────────────────────────────────────────────────
ANOMALY_STATION = "STATION_14"
ANOMALY_START_VI = 17   # VEH_4817
ANOMALY_PEAK_VI = 21    # VEH_4821
ANOMALY_END_VI = 25     # VEH_4825

DRIFT_CYCLE_TIME = 12.0
DRIFT_VIBRATION = 2.4
DRIFT_TEMPERATURE = 6.2
DRIFT_TORQUE = 6.5
BASE_TORQUE_NM = 42.1

SENSORLESS_STATIONS = {4, 9, 16, 22, 27}


def generate_production_telemetry(num_vehicles: int = 300, num_stations: int = 30, random_seed: int = 42) -> pd.DataFrame:
    """Generate a realistic production telemetry dataset across vehicles and stations."""
    np.random.seed(random_seed)
    records = []

    # Base station profiles: [nominal_ct, nominal_torque, nominal_temp, nominal_vib]
    # S1-S10: Body Framing, S11-S20: Paint/Sealing, S21-S30: Final Assembly
    station_baselines = {}
    for s in range(1, num_stations + 1):
        station_baselines[s] = {
            "ct_mean": 65.0 + (s % 5) * 2.5,
            "ct_std": 1.2,
            "torque_mean": 42.0 if s in [1, 2, 7, 8, 14, 26, 27] else 0.0,
            "torque_std": 1.1 if s in [1, 2, 7, 8, 14, 26, 27] else 0.0,
            "temp_mean": 36.0 + (s * 0.4),
            "temp_std": 0.8,
            "vib_mean": 1.4 + (s * 0.03),
            "vib_std": 0.15
        }

    # Cumulative station wear state (tool degradation over time)
    station_wear = {s: 0.0 for s in range(1, num_stations + 1)}

    start_time = datetime.now() - timedelta(hours=8)

    for v_idx in range(num_vehicles):
        vin = f"VEH_{4800 + v_idx}"
        # Batch material thickness variance (affects weld torque & vibration)
        material_hardness_factor = float(np.random.normal(1.0, 0.04))

        # Inject intentional failure cohorts (e.g., vehicles 4817-4825 hit S14 tool wear excursion)
        is_tool_wear_cohort = (4817 <= (4800 + v_idx) <= 4825)
        is_random_excursion = bool(np.random.rand() < 0.06)  # 6% isolated defect rate
        excursion_station = int(np.random.randint(1, num_stations + 1)) if is_random_excursion else -1

        carried_geometry_defect = False

        for s in range(1, num_stations + 1):
            base = station_baselines[s]

            # 1. Progressive Wear Accumulation (Exponential degradation)
            station_wear[s] += float(np.random.exponential(0.008))
            wear = station_wear[s]

            # 2. Base Gaussian + 1/f Pink Noise component
            ct = float(np.random.normal(base["ct_mean"], base["ct_std"]))
            temp = float(np.random.normal(base["temp_mean"], base["temp_std"])) + (wear * 1.5)
            vib = float(np.random.normal(base["vib_mean"], base["vib_std"])) * material_hardness_factor + (wear * 0.4)
            torque = float(np.random.normal(base["torque_mean"], base["torque_std"])) * material_hardness_factor if base["torque_mean"] > 0 else 0.0

            # 3. Apply Anomalous Excursions
            anomaly_type = "NOMINAL"
            is_anomaly = 0

            if s == 14 and is_tool_wear_cohort:
                # Spindle calibration degradation & bearing chatter
                drift_factor = (v_idx - 17 + 1) * 0.8
                torque += 4.5 + drift_factor
                vib += 1.8 + (drift_factor * 0.2)
                temp += 6.2
                ct += 12.0
                anomaly_type = "CALIBRATION_DRIFT_S14"
                is_anomaly = 1
                carried_geometry_defect = True

            elif s == excursion_station:
                # Random micro-stoppage / pneumatic pressure drop
                ct += float(np.random.uniform(15.0, 35.0))
                temp += float(np.random.uniform(3.0, 7.0))
                anomaly_type = "MICRO_STOPPAGE_PRESSURE_DROP"
                is_anomaly = 1

            elif carried_geometry_defect and s > 14:
                # Downstream fitment resistance at assembly stations
                if s in [21, 22, 26, 27]:
                    vib += float(np.random.uniform(0.6, 1.2))
                    ct += float(np.random.uniform(3.0, 6.0))
                    anomaly_type = "DOWNSTREAM_GEOMETRY_MISALIGNMENT"
                    is_anomaly = 2  # Propagated warning

            # 4. Power consumption & thermal efficiency modeling
            if (1 <= s <= 10) or s == 14:
                idle_kw = 9.5 + (s % 3) * 0.8
                opt_temp = 34.0 + (s * 0.3)
            elif 11 <= s <= 18:
                idle_kw = 8.0 + (s % 4) * 0.9
                opt_temp = 48.0 if s in [11, 12] else (60.0 if s == 17 else 38.0)
            else:
                idle_kw = 4.8 + (s % 4) * 0.7
                opt_temp = 28.0 + (s % 3) * 1.5

            opt_torque_kw = (base["torque_mean"] * 0.115) if base["torque_mean"] > 0 else 0.0
            opt_ct_kw = (base["ct_mean"] / 60.0) * 1.85
            optimal_kw = round(idle_kw + opt_torque_kw + opt_ct_kw, 2)

            torque_kw = (torque * 0.115) if torque > 0 else 0.0
            ct_kw = (ct / 60.0) * 1.85
            thermal_penalty_kw = abs(temp - opt_temp) * 0.15
            actual_kw = round(max(optimal_kw, idle_kw + torque_kw + ct_kw + thermal_penalty_kw), 2)
            waste_kw = round(max(0.0, actual_kw - optimal_kw), 2)

            timestamp = start_time + timedelta(seconds=(v_idx * 75) + (s * 65))

            records.append({
                "vehicle_id": vin,
                "station_seq": s,
                "timestamp": timestamp.isoformat(),
                "cycle_time": round(float(ct), 2),
                "joint_torque": round(float(torque), 2) if torque > 0 else None,
                "process_temperature": round(float(temp), 2),
                "tool_vibration": round(float(vib), 3),
                "power_kw": actual_kw,
                "optimal_power_kw": optimal_kw,
                "avoidable_waste_kw": waste_kw,
                "optimal_temp_c": round(opt_temp, 1),
                "is_anomaly": is_anomaly,
                "anomaly_label": anomaly_type,
            })

    df = pd.DataFrame(records)
    return df



def save_telemetry_csv(df: pd.DataFrame, target_path: Path = CSV_PATH) -> Path:
    """Ensure parent directory exists and save DataFrame to CSV."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(str(target_path), index=False)
    return target_path


def generate_vehicle_cohort(num_vehicles: int = 300, start_id: int = 4800) -> List[Dict[str, Any]]:
    """Convert dataframe or generate live cohort list of vehicle dicts for streamer and APIs."""
    df = generate_production_telemetry(num_vehicles=num_vehicles, random_seed=42)
    save_telemetry_csv(df)

    vehicles = []
    for vin, group in df.groupby("vehicle_id", sort=False):
        events = []
        for _, row in group.iterrows():
            seq = int(row["station_seq"])
            sid = f"STATION_{seq:02d}"
            res_id = f"R{seq:02d}"
            has_sensors = 0 if seq in SENSORLESS_STATIONS else 1
            is_inferred = 1 if has_sensors == 0 else 0

            events.append({
                "vehicle_id": vin,
                "station_id": sid,
                "resource_id": res_id,
                "sequence_no": seq,
                "cycle_time_sec": float(row["cycle_time"]),
                "vibration_mm_s": float(row["tool_vibration"]),
                "temperature_c": float(row["process_temperature"]),
                "torque_nm": float(row["joint_torque"]) if pd.notna(row["joint_torque"]) and row["joint_torque"] > 0 else BASE_TORQUE_NM,
                "actual_power_kw": float(row.get("power_kw", 11.2)),
                "min_achievable_power_kw": float(row.get("optimal_power_kw", 9.8)),
                "avoidable_waste_kw": float(row.get("avoidable_waste_kw", 1.4)),
                "optimal_plant_temp_c": float(row.get("optimal_temp_c", 35.0)),
                "is_inferred": is_inferred,
                "has_sensors": has_sensors,
                "is_anomaly": int(row["is_anomaly"]),
                "anomaly_label": str(row["anomaly_label"]),

                "timestamp": str(row["timestamp"]),
            })

        vehicles.append({
            "vehicle_id": vin,
            "model": "Model-X",
            "events": events,
        })

    return vehicles


if __name__ == "__main__":
    df = generate_production_telemetry()
    csv_file = save_telemetry_csv(df)
    print(f"Generated {len(df)} records across {df['vehicle_id'].nunique()} vehicles.")
    print(f"Saved to: {csv_file}")
    print("Anomaly Distribution:\n", df["anomaly_label"].value_counts())
