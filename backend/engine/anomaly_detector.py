"""Rolling residual-based anomaly detection for TRACE-TWIN.

Scans process_events for each station, computes residuals against baselines,
and flags anomalies when deviations exceed thresholds.
"""

import sqlite3
from datetime import datetime


# Detection thresholds (absolute residuals).
# Jitter widths: CT ±0.6 s, VIB ±0.12 mm/s, TEMP ±0.8 °C  →  thresholds well above noise floor.
# Station 14 peak drift: +14.2 s / +2.6 mm/s / +9.5 °C  →  guaranteed breach.
CYCLE_TIME_THRESHOLD  = 4.0    # seconds  (well above 0.6 σ noise)
VIBRATION_THRESHOLD   = 0.8    # mm/s     (well above 0.12 σ noise)
TEMPERATURE_THRESHOLD = 4.0    # °C       (well above 0.8 σ noise)

# Consecutive normal events required before auto-resolving an anomaly
RESOLVE_STREAK = 2


def detect_anomalies(conn: sqlite3.Connection) -> list[dict]:
    """Scan all stations for anomalies. Returns list of created/updated anomaly dicts."""
    stations = conn.execute(
        "SELECT s.id, s.resource_id, sb.expected_cycle_time_sec, "
        "sb.expected_vibration_mm_s, sb.expected_temperature_c "
        "FROM stations s "
        "JOIN station_baselines sb ON sb.station_id = s.id"
    ).fetchall()

    results = []
    for station in stations:
        sid = station["id"]
        baseline_ct  = station["expected_cycle_time_sec"]
        baseline_vib = station["expected_vibration_mm_s"]
        baseline_tmp = station["expected_temperature_c"]
        resource_id  = station["resource_id"]

        # Fetch recent events for this station (oldest first for streak analysis)
        events = conn.execute(
            "SELECT id, vehicle_id, entered_at, cycle_time_sec, vibration_mm_s, temperature_c "
            "FROM process_events "
            "WHERE station_id = ? "
            "ORDER BY entered_at DESC LIMIT 20",
            (sid,),
        ).fetchall()

        if len(events) < 3:
            continue

        # Compute residuals for all events (most recent first)
        residuals = []
        for ev in events:
            r_ct  = (ev["cycle_time_sec"] or 0) - baseline_ct
            r_vib = (ev["vibration_mm_s"] or 0) - baseline_vib
            r_tmp = (ev["temperature_c"] or 0)   - baseline_tmp
            residuals.append({
                "entered_at": ev["entered_at"],
                "vehicle_id": ev["vehicle_id"],
                "cycle_time": r_ct,
                "vibration": r_vib,
                "temperature": r_tmp,
            })

        # Check latest residuals against thresholds
        latest = residuals[0]
        is_anomalous = (
            abs(latest["cycle_time"]) > CYCLE_TIME_THRESHOLD
            or abs(latest["vibration"]) > VIBRATION_THRESHOLD
            or abs(latest["temperature"]) > TEMPERATURE_THRESHOLD
        )

        # Check for existing open anomaly
        existing = conn.execute(
            "SELECT id, window_start FROM anomalies "
            "WHERE station_id = ? AND status = 'open' "
            "ORDER BY detected_at DESC LIMIT 1",
            (sid,),
        ).fetchone()

        if is_anomalous:
            if existing:
                # Update existing anomaly with latest residuals
                conn.execute(
                    "UPDATE anomalies SET "
                    "residual_cycle_time = ?, residual_vibration = ?, "
                    "residual_temperature = ?, window_end = NULL "
                    "WHERE id = ?",
                    (round(latest["cycle_time"], 2),
                     round(latest["vibration"], 3),
                     round(latest["temperature"], 2),
                     existing["id"]),
                )
                results.append({
                    "id": existing["id"],
                    "station_id": sid,
                    "resource_id": resource_id,
                    "action": "updated",
                    "residuals": latest,
                })
            else:
                # Find window_start: first anomalous event in this streak
                window_start = latest["entered_at"]
                for r in residuals:
                    if (abs(r["cycle_time"]) > CYCLE_TIME_THRESHOLD
                            or abs(r["vibration"]) > VIBRATION_THRESHOLD
                            or abs(r["temperature"]) > TEMPERATURE_THRESHOLD):
                        window_start = r["entered_at"]
                    else:
                        break

                cursor = conn.execute(
                    "INSERT INTO anomalies "
                    "(station_id, resource_id, detected_at, window_start, "
                    "residual_cycle_time, residual_vibration, residual_temperature, "
                    "status, recommended_action) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'monitor')",
                    (sid, resource_id, datetime.utcnow().isoformat(),
                     window_start,
                     round(latest["cycle_time"], 2),
                     round(latest["vibration"], 3),
                     round(latest["temperature"], 2)),
                )
                anomaly_id = cursor.lastrowid
                results.append({
                    "id": anomaly_id,
                    "station_id": sid,
                    "resource_id": resource_id,
                    "action": "created",
                    "residuals": latest,
                })
        else:
            # Check if we should resolve an existing anomaly
            if existing:
                normal_streak = 0
                for r in residuals:
                    if (abs(r["cycle_time"]) <= CYCLE_TIME_THRESHOLD
                            and abs(r["vibration"]) <= VIBRATION_THRESHOLD
                            and abs(r["temperature"]) <= TEMPERATURE_THRESHOLD):
                        normal_streak += 1
                    else:
                        break

                if normal_streak >= RESOLVE_STREAK:
                    conn.execute(
                        "UPDATE anomalies SET status = 'resolved', "
                        "window_end = ? WHERE id = ?",
                        (latest["entered_at"], existing["id"]),
                    )
                    results.append({
                        "id": existing["id"],
                        "station_id": sid,
                        "resource_id": resource_id,
                        "action": "resolved",
                        "residuals": latest,
                    })

    conn.commit()
    return results


def resolve_station_anomaly(conn: sqlite3.Connection, station_id: str) -> None:
    """Explicitly resolve any open anomaly for a station (called on intervention)."""
    conn.execute(
        "UPDATE anomalies SET status = 'resolved', window_end = datetime('now') "
        "WHERE station_id = ? AND status = 'open'",
        (station_id,),
    )
    conn.commit()
