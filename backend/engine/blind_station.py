"""Blind Station Inference for TRACE-TWIN.

For stations with has_sensors=0, estimates sensor readings by interpolating
from upstream and downstream neighbor stations.
"""

import sqlite3
import random


def infer_blind_stations(conn: sqlite3.Connection) -> int:
    """Infer readings for all sensorless stations from neighbor data.

    For each blind station, finds vehicles that have events at both the
    upstream (sequence_no - 1) and downstream (sequence_no + 1) stations
    but no event at the blind station itself, and generates an inferred
    event by averaging the neighbor readings.

    Returns:
        Number of inferred events created.
    """
    blind_stations = conn.execute(
        "SELECT id, sequence_no, resource_id FROM stations WHERE has_sensors = 0"
    ).fetchall()

    total_inferred = 0

    for bs in blind_stations:
        blind_id = bs["id"]
        seq = bs["sequence_no"]
        resource_id = bs["resource_id"]

        # Find upstream and downstream station IDs
        upstream = conn.execute(
            "SELECT id FROM stations WHERE sequence_no = ?", (seq - 1,)
        ).fetchone()
        downstream = conn.execute(
            "SELECT id FROM stations WHERE sequence_no = ?", (seq + 1,)
        ).fetchone()

        if not upstream or not downstream:
            continue

        up_id = upstream["id"]
        down_id = downstream["id"]

        # Find vehicles that have events at both neighbors but not at blind station
        vehicles = conn.execute(
            "SELECT DISTINCT pe_up.vehicle_id "
            "FROM process_events pe_up "
            "JOIN process_events pe_down ON pe_down.vehicle_id = pe_up.vehicle_id "
            "  AND pe_down.station_id = ? "
            "WHERE pe_up.station_id = ? "
            "AND pe_up.vehicle_id NOT IN ("
            "  SELECT vehicle_id FROM process_events WHERE station_id = ?"
            ")",
            (down_id, up_id, blind_id),
        ).fetchall()

        for v in vehicles:
            vid = v["vehicle_id"]

            up_event = conn.execute(
                "SELECT exited_at, cycle_time_sec, vibration_mm_s, temperature_c "
                "FROM process_events WHERE vehicle_id = ? AND station_id = ? "
                "ORDER BY entered_at DESC LIMIT 1",
                (vid, up_id),
            ).fetchone()

            down_event = conn.execute(
                "SELECT cycle_time_sec, vibration_mm_s, temperature_c "
                "FROM process_events WHERE vehicle_id = ? AND station_id = ? "
                "ORDER BY entered_at DESC LIMIT 1",
                (vid, down_id),
            ).fetchone()

            if not up_event or not down_event:
                continue

            # Interpolate readings
            inf_ct  = ((up_event["cycle_time_sec"] or 0) + (down_event["cycle_time_sec"] or 0)) / 2
            inf_vib = ((up_event["vibration_mm_s"] or 0) + (down_event["vibration_mm_s"] or 0)) / 2
            inf_tmp = ((up_event["temperature_c"] or 0) + (down_event["temperature_c"] or 0)) / 2

            # Add small noise
            inf_ct  += random.gauss(0, 1.0)
            inf_vib += random.gauss(0, 0.05)
            inf_tmp += random.gauss(0, 0.5)

            # Compute timestamps
            from datetime import datetime, timedelta
            up_exit = datetime.fromisoformat(up_event["exited_at"])
            transit = random.uniform(10, 15)
            entered_at = up_exit + timedelta(seconds=transit)
            exited_at  = entered_at + timedelta(seconds=inf_ct)

            conn.execute(
                "INSERT INTO process_events "
                "(vehicle_id, station_id, resource_id, entered_at, exited_at, "
                "cycle_time_sec, vibration_mm_s, temperature_c, source_system, is_inferred) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INFERRED', 1)",
                (vid, blind_id, resource_id,
                 entered_at.isoformat(), exited_at.isoformat(),
                 round(inf_ct, 2), round(inf_vib, 3), round(inf_tmp, 2)),
            )
            total_inferred += 1

    conn.commit()
    return total_inferred
