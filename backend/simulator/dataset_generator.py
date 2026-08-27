import math
import random
from datetime import datetime, timedelta
from backend.db.init_db import STATIONS, BASELINES

def generate_vehicle_cohort(num_vehicles=50, start_id=4801):
    """
    Generate a deterministic matrix of vehicle process events.
    Returns: list of vehicles, each containing a list of 30 station events.
    """
    vehicles = []
    
    for vi in range(num_vehicles):
        vid = f"VEH_{start_id + vi}"
        events = []
        
        for si, station in enumerate(STATIONS):
            sid, name, seq, has_sensors, res_id = station
            base_ct, base_vib, base_temp = BASELINES[sid]
            base_torque = 42.1
            
            # Deterministic pseudo-random seed per vehicle-station
            rng = random.Random(start_id + vi * 100 + si)
            
            # 1. Natural Gaussian process noise
            ct = base_ct + rng.gauss(0, 0.4)
            vib = base_vib + rng.gauss(0, 0.08)
            temp = base_temp + rng.gauss(0, 0.5)
            torque = base_torque + rng.gauss(0, 0.6)
            
            # 2. Anomaly Drift Profiles (Station 14 Tool Wear)
            if sid == "STATION_14":
                # Start: #4817 (vi=16), Peak: #4821 (vi=20), Recover: #4825 (vi=24)
                if 16 <= vi <= 24:
                    if vi <= 20:
                        intensity = (vi - 16) / 4.0 # 0.0 to 1.0
                    else:
                        intensity = (24 - vi) / 4.0 # 1.0 to 0.0
                    
                    # Apply offsets while still keeping the baseline noise generated above
                    ct += 13.0 * intensity
                    vib += 2.7 * intensity
                    temp += 8.0 * intensity
                    torque += 5.0 * intensity # Correlated synthetic torque spike
            
            # 3. Blind Station Inference
            is_inferred = 0
            if has_sensors == 0:
                is_inferred = 1
                # Additional noise to represent uncertainty in inference
                ct += rng.gauss(0, 0.8)
                vib += rng.gauss(0, 0.15)
                temp += rng.gauss(0, 1.0)
                torque += rng.gauss(0, 1.2)
                
            events.append({
                "vehicle_id": vid,
                "station_id": sid,
                "resource_id": res_id,
                "cycle_time_sec": round(max(1.0, ct), 1),
                "vibration_mm_s": round(max(0.1, vib), 2),
                "temperature_c": round(max(15.0, temp), 1),
                "torque_nm": round(max(10.0, torque), 1),
                "is_inferred": is_inferred,
                "has_sensors": has_sensors
            })
            
        vehicles.append({
            "vehicle_id": vid,
            "model": "Model-X",
            "events": events
        })
        
    return vehicles
