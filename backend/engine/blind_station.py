"""Blind Station Inference for TRACE-TWIN.

For stations with has_sensors=0, estimates sensor readings by interpolating
from upstream and downstream neighbor stations.
"""

import sqlite3
import random


def infer_blind_stations(conn: sqlite3.Connection) -> int:
    """Infer readings for all sensorless stations from nearest neighbor data.

    Dynamically finds the closest upstream and downstream sensor-equipped
    events for a vehicle, gracefully handling consecutive blind stations or
    missing data.

    Returns:
        Number of inferred events created.
    """
    blind_stations = conn.execute(
        "SELECT id, sequence_no, resource_id FROM stations WHERE has_sensors = 0"
    ).fetchall()

    if not blind_stations:
        return 0

    total_inferred = 0

    # Process per vehicle
    vehicles = conn.execute("SELECT id FROM vehicles").fetchall()

    from datetime import datetime, timedelta

    for v in vehicles:
        vid = v["id"]
        # Fetch all actual (non-inferred) events for this vehicle
        events = conn.execute(
            "SELECT s.sequence_no, pe.station_id, pe.exited_at, pe.entered_at, "
            "pe.cycle_time_sec, pe.vibration_mm_s, pe.temperature_c "
            "FROM process_events pe "
            "JOIN stations s ON s.id = pe.station_id "
            "WHERE pe.vehicle_id = ? AND pe.is_inferred = 0 "
            "ORDER BY s.sequence_no",
            (vid,)
        ).fetchall()

        if not events:
            continue

        for bs in blind_stations:
            b_id = bs["id"]
            b_seq = bs["sequence_no"]
            b_res = bs["resource_id"]

            has_event = conn.execute(
                "SELECT 1 FROM process_events WHERE vehicle_id = ? AND station_id = ?",
                (vid, b_id)
            ).fetchone()

            if has_event:
                continue

            # Find closest upstream and downstream
            up_event = None
            down_event = None

            for ev in reversed(events):
                if ev["sequence_no"] < b_seq:
                    up_event = ev
                    break

            for ev in events:
                if ev["sequence_no"] > b_seq:
                    down_event = ev
                    break

            if not up_event or not down_event:
                continue

            try:
                # Interpolate readings
                inf_ct  = ((up_event["cycle_time_sec"] or 0) + (down_event["cycle_time_sec"] or 0)) / 2
                inf_vib = ((up_event["vibration_mm_s"] or 0) + (down_event["vibration_mm_s"] or 0)) / 2
                inf_tmp = ((up_event["temperature_c"] or 0) + (down_event["temperature_c"] or 0)) / 2

                # Add realistic industrial noise
                inf_ct  += random.gauss(0, 1.0)
                inf_vib += random.gauss(0, 0.05)
                inf_tmp += random.gauss(0, 0.5)

                up_exit = datetime.fromisoformat(up_event["exited_at"])
                transit = random.uniform(10, 15)
                seq_gap = b_seq - up_event["sequence_no"]
                
                entered_at = up_exit + timedelta(seconds=transit * seq_gap)
                exited_at  = entered_at + timedelta(seconds=max(inf_ct, 0))

                conn.execute(
                    "INSERT INTO process_events "
                    "(vehicle_id, station_id, resource_id, entered_at, exited_at, "
                    "cycle_time_sec, vibration_mm_s, temperature_c, source_system, is_inferred) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INFERRED', 1)",
                    (vid, b_id, b_res,
                     entered_at.isoformat(), exited_at.isoformat(),
                     round(inf_ct, 2), round(inf_vib, 3), round(inf_tmp, 2)),
                )
                total_inferred += 1
            except Exception:
                continue

    conn.commit()
    return total_inferred
