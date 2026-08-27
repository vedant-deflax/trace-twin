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
            
            # Deterministic pseudo-random seed per vehicle-station
            rng = random.Random(start_id + vi * 100 + si)
            
            # Normal noise
            ct = base_ct + rng.gauss(0, base_ct * 0.05)
            vib = base_vib + rng.gauss(0, base_vib * 0.05)
            temp = base_temp + rng.gauss(0, base_temp * 0.05)
            
            # Anomaly injection for Station 14 (Tool Wear)
            if sid == "STATION_14":
                # Start: #4817 (vi=16), Peak: #4821 (vi=20), Recover: #4825 (vi=24)
                if 16 <= vi <= 24:
                    if vi <= 20:
                        intensity = (vi - 16) / 4.0 # 0.0 to 1.0
                    else:
                        intensity = (24 - vi) / 4.0 # 1.0 to 0.0
                    
                    ct += 18.0 * intensity + rng.gauss(0, 1.0)
                    vib += 2.7 * intensity + rng.gauss(0, 0.2)
                    temp += 13.4 * intensity + rng.gauss(0, 0.5)
            
            # Blind Station Inference
            is_inferred = 0
            if has_sensors == 0:
                is_inferred = 1
                # Add "confidence" estimation artifact by adding slightly more noise
                # representing interpolation from upstream/downstream
                ct += rng.gauss(0, 2.0)
                vib += rng.gauss(0, 0.5)
                temp += rng.gauss(0, 1.0)
                
            events.append({
                "vehicle_id": vid,
                "station_id": sid,
                "resource_id": res_id,
                "cycle_time_sec": round(max(1.0, ct), 2),
                "vibration_mm_s": round(max(0.1, vib), 3),
                "temperature_c": round(max(15.0, temp), 2),
                "is_inferred": is_inferred,
                "has_sensors": has_sensors
            })
            
        vehicles.append({
            "vehicle_id": vid,
            "model": "Model-X",
            "events": events
        })
        
    return vehicles
