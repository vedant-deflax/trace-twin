"""Historical Training Dataset Generator for TRACE-TWIN ML Defect Prediction.

Synthesizes 1,000 historical vehicle runs across 30 assembly stations using
realistic non-stationary tool wear, thermal accumulation, material variance,
and causal downstream defect propagation.
Target label: defect_occurred (1 if quality defect occurred at S20-S30, 0 if passing).
"""

import os
import random
import numpy as np
import pandas as pd
from pathlib import Path

# Station groupings
TORQUE_STATIONS = {1, 2, 7, 8, 14, 26, 27}
CURING_STATIONS = {9, 11, 17, 18}
DOWNSTREAM_STATIONS = set(range(20, 31))

DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_CSV = DATA_DIR / "training_data_1000.csv"


def generate_training_data(num_vehicles: int = 1000, random_seed: int = 42) -> pd.DataFrame:
    random.seed(random_seed)
    np.random.seed(random_seed)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Base nominal baselines per station
    station_baselines = {}
    for s in range(1, 31):
        station_baselines[s] = {
            "ct_nominal": 65.0 + (s % 5) * 2.5,
            "vib_nominal": 1.4 + (s * 0.03),
            "temp_nominal": 36.0 + (s * 0.4),
            "torque_nominal": 42.0 if s in TORQUE_STATIONS else 0.0,
        }

    # Station cumulative wear state across vehicle production stream
    station_wear = {s: 0.0 for s in range(1, 31)}
    thermal_drift = {s: 0.0 for s in range(1, 31)}

    records = []

    for v_idx in range(1, num_vehicles + 1):
        vehicle_id = f"HIST_{v_idx:04d}"
        material_hardness = float(np.random.normal(1.0, 0.04))

        # Evolve wear and thermal drift across line
        for s in TORQUE_STATIONS:
            # Simulate periodic maintenance / tool change every ~120 vehicles
            if v_idx % 140 == 0:
                station_wear[s] = 0.0
            else:
                station_wear[s] += random.uniform(0.015, 0.035)

        for s in CURING_STATIONS:
            thermal_drift[s] = max(
                -0.5, min(8.0, thermal_drift[s] + random.uniform(-0.1, 0.15))
            )
            # Occasional thermal excursion burst
            if random.random() < 0.03:
                thermal_drift[s] += random.uniform(4.0, 7.5)
            elif thermal_drift[s] > 4.0 and random.random() < 0.35:
                thermal_drift[s] *= 0.5  # Cooling recovery

        # Per-station deltas for this vehicle
        ct_deltas = []
        vib_deltas = []
        temp_deltas = []
        torque_deltas = []

        s14_torque_delta = 0.0
        s09_temp_delta = 0.0

        for s in range(1, 31):
            bl = station_baselines[s]
            wear = station_wear.get(s, 0.0)

            # Sensor readings with noise and drift
            wear_ct = wear * 2.5 if wear >= 2.0 else wear * 0.4
            wear_vib = wear * 0.45 if wear >= 2.0 else wear * 0.08
            wear_temp = wear * 1.8 if wear >= 2.0 else wear * 0.2
            wear_torque = wear * 1.8 if (wear >= 2.0 and s in TORQUE_STATIONS) else 0.0

            t_drift = thermal_drift.get(s, 0.0)

            # Random micro-stoppage
            stoppage = 15.0 if random.random() < 0.02 else 0.0

            ct = bl["ct_nominal"] + wear_ct + stoppage + np.random.normal(0, 0.8)
            vib = (bl["vib_nominal"] + wear_vib + np.random.normal(0, 0.05)) * material_hardness
            temp = bl["temp_nominal"] + wear_temp + t_drift + np.random.normal(0, 0.4)
            torque = (bl["torque_nominal"] + wear_torque + np.random.normal(0, 0.6)) * material_hardness if bl["torque_nominal"] > 0 else 0.0

            delta_ct = ct - bl["ct_nominal"]
            delta_vib = vib - bl["vib_nominal"]
            delta_temp = temp - bl["temp_nominal"]
            delta_torque = (torque - bl["torque_nominal"]) if bl["torque_nominal"] > 0 else 0.0

            ct_deltas.append(delta_ct)
            vib_deltas.append(delta_vib)
            temp_deltas.append(delta_temp)
            if bl["torque_nominal"] > 0:
                torque_deltas.append(delta_torque)

            if s == 14:
                s14_torque_delta = delta_torque
            if s == 9:
                s09_temp_delta = delta_temp

        # Feature aggregates across the vehicle's manufacturing run
        delta_ct_mean = float(np.mean(ct_deltas))
        delta_ct_max = float(np.max(ct_deltas))
        delta_ct_std = float(np.std(ct_deltas))

        delta_torque_mean = float(np.mean(torque_deltas)) if torque_deltas else 0.0
        delta_torque_max = float(np.max(torque_deltas)) if torque_deltas else 0.0

        delta_temp_mean = float(np.mean(temp_deltas))
        delta_temp_max = float(np.max(temp_deltas))

        delta_vib_mean = float(np.mean(vib_deltas))
        delta_vib_max = float(np.max(vib_deltas))

        upstream_wear_index = float(sum(station_wear[s] for s in range(1, 19)) / 18.0)
        thermal_accumulation_index = float(sum(max(0.0, thermal_drift[s]) for s in CURING_STATIONS))

        # Causal defect generation ground truth
        # 1. S14 torque drift crosses critical tolerance (+4.5 Nm or wear index > 2.2)
        torque_breach = (s14_torque_delta > 4.2) or (delta_torque_max > 5.5)
        # 2. Severe thermal curing spike
        thermal_breach = (s09_temp_delta > 6.0) or (thermal_accumulation_index > 14.0)
        # 3. Structural cumulative fitment stress
        vibration_wear_breach = (upstream_wear_index > 2.1 and material_hardness > 1.03)

        # Defect risk latent score
        latent_risk = (
            (1.0 if torque_breach else 0.0) * 0.55 +
            (1.0 if thermal_breach else 0.0) * 0.25 +
            (1.0 if vibration_wear_breach else 0.0) * 0.20 +
            np.random.normal(0, 0.08)
        )

        # Binary label with realistic ~10% defect rate
        defect_occurred = 1 if latent_risk > 0.45 else 0

        records.append({
            "vehicle_id": vehicle_id,
            "delta_ct_mean": round(delta_ct_mean, 3),
            "delta_ct_max": round(delta_ct_max, 3),
            "delta_ct_std": round(delta_ct_std, 3),
            "delta_torque_mean": round(delta_torque_mean, 3),
            "delta_torque_max": round(delta_torque_max, 3),
            "delta_torque_s14": round(s14_torque_delta, 3),
            "delta_temp_mean": round(delta_temp_mean, 3),
            "delta_temp_max": round(delta_temp_max, 3),
            "delta_temp_s09": round(s09_temp_delta, 3),
            "delta_vib_mean": round(delta_vib_mean, 3),
            "delta_vib_max": round(delta_vib_max, 3),
            "upstream_wear_index": round(upstream_wear_index, 3),
            "thermal_accumulation_index": round(thermal_accumulation_index, 3),
            "material_hardness_factor": round(material_hardness, 3),
            "defect_occurred": defect_occurred,
        })

    df = pd.DataFrame(records)
    df.to_csv(OUTPUT_CSV, index=False)
    defect_rate = df["defect_occurred"].mean() * 100.0
    print(f"Generated {len(df)} historical records.")
    print(f"Defect rate: {defect_rate:.1f}% ({df['defect_occurred'].sum()} positive defects).")
    print(f"Saved to: {OUTPUT_CSV}")
    return df


if __name__ == "__main__":
    generate_training_data()
