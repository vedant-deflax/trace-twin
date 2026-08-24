"""Blast radius computation for TRACE-TWIN.

Given an anomaly at a station during a time window, returns the bounded
set of vehicle IDs that passed through while the anomaly was active.
"""

import sqlite3
from datetime import datetime


def compute_blast_radius(anomaly_id: int, conn: sqlite3.Connection) -> list[str]:
    """Compute the blast radius for an anomaly.

    Queries all vehicles that passed through the anomaly station during the
    anomaly window [window_start, window_end]. If window_end is NULL
    (anomaly still active), uses current time as the end boundary.

    Returns:
        Ordered list of affected vehicle IDs.
    """
    anomaly = conn.execute(
        "SELECT station_id, window_start, window_end FROM anomalies WHERE id = ?",
        (anomaly_id,),
    ).fetchone()

    if not anomaly:
        return []

    station_id = anomaly["station_id"]
    window_start = anomaly["window_start"]
    window_end = anomaly["window_end"] or datetime.utcnow().isoformat()

    # Query vehicles that were at this station during the anomaly window
    rows = conn.execute(
        "SELECT DISTINCT pe.vehicle_id "
        "FROM process_events pe "
        "WHERE pe.station_id = ? "
        "AND pe.entered_at >= ? "
        "AND pe.entered_at <= ? "
        "ORDER BY pe.entered_at",
        (station_id, window_start, window_end),
    ).fetchall()

    vehicle_ids = [row["vehicle_id"] for row in rows]

    # Persist to blast_radius table (idempotent: delete + reinsert)
    conn.execute("DELETE FROM blast_radius WHERE anomaly_id = ?", (anomaly_id,))
    for vid in vehicle_ids:
        conn.execute(
            "INSERT INTO blast_radius (anomaly_id, vehicle_id) VALUES (?, ?)",
            (anomaly_id, vid),
        )
    conn.commit()

    return vehicle_ids
