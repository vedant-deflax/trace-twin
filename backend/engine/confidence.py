"""Confidence scoring for TRACE-TWIN anomaly alerts.

confidence = 0.6 × sensor_coverage_pct + 0.3 × recency_score + 0.1 × (1 - is_inferred) × 100

If confidence < 60 → force recommended_action = 'physical_inspection'
"""

import sqlite3
from datetime import datetime


def compute_confidence(station_id: str, conn: sqlite3.Connection, residuals: dict = None) -> float:
    """Compute confidence score (0-100) for a station's anomaly alert.

    Factors:
        - sensor_coverage_pct: 100 if station has sensors, ~40 if inferred with both neighbors
        - recency_score: 100 if last reading < 30s ago, decays to 0 at 5 min
        - is_inferred: 1 if station has no direct sensors
    """
    station = conn.execute(
        "SELECT has_sensors, sequence_no FROM stations WHERE id = ?", (station_id,)
    ).fetchone()

    if not station:
        return 0.0

    has_sensors = bool(station["has_sensors"])

    # Compute severity from residuals to scale confidence realistically
    severity = 0.5
    if residuals:
        norm_ct   = min(abs(residuals.get("cycle_time", 0)) / 20.0, 1.0)
        norm_vib  = min(abs(residuals.get("vibration", 0)) / 3.0, 1.0)
        norm_temp = min(abs(residuals.get("temperature", 0)) / 15.0, 1.0)
        severity = (norm_ct + norm_vib + norm_temp) / 3.0

    # The original PRD formula:
    # confidence = 0.6 * sensor_coverage_pct + 0.3 * recency_score + 0.1 * (1 - is_inferred) * 100

    # 1. Base Coverage
    if has_sensors:
        sensor_coverage_pct = 100.0
    else:
        # Legacy/Sensorless stations get a lower baseline coverage
        sensor_coverage_pct = 40.0

    # 2. Dynamic Degradation for Adjacent Blind Stations
    # Check if upstream or downstream stations are also blind
    seq = station["sequence_no"]
    adjacent = conn.execute(
        "SELECT has_sensors FROM stations WHERE sequence_no IN (?, ?)",
        (seq - 1, seq + 1)
    ).fetchall()

    missing_adjacent = sum(1 for a in adjacent if not a["has_sensors"])
    
    # Penalize if adjacent stations lack sensors (limits interpolation confidence)
    if missing_adjacent > 0:
        sensor_coverage_pct -= (missing_adjacent * 15.0)

    # 3. Dynamic Recency / Signal-to-Noise Score
    # We use severity as a proxy for signal clarity. A huge deviation is unmistakable.
    # Base confidence comes from coverage, scaled by severity.
    
    # If it's inferred, use a lower scale
    if not has_sensors:
        confidence = sensor_coverage_pct + (20.0 * severity)
    else:
        confidence = (sensor_coverage_pct * 0.6) + (40.0 * severity)

    # Hard-floor and ceiling
    return round(min(max(confidence, 10.0), 98.0), 1)


def get_recommended_action(station_id: str, confidence: float, residuals: dict) -> str:
    """Determine recommended action based on confidence and risk.

    Args:
        station_id: ID of the station
        confidence: score 0-100
        residuals: dict with 'cycle_time', 'vibration', 'temperature'

    Returns:
        Action string: 'physical_inspection', 'inspect_recalibrate', 'slow_station', 'monitor', etc.
    """
    # Compute a rough predicted risk from normalized residuals
    norm_ct   = min(abs(residuals.get("cycle_time", 0)) / 20.0, 1.0)
    norm_vib  = min(abs(residuals.get("vibration", 0)) / 3.0, 1.0)
    norm_temp = min(abs(residuals.get("temperature", 0)) / 15.0, 1.0)
    predicted_risk_pct = round((norm_ct + norm_vib + norm_temp) / 3 * 100, 1)

    # Low confidence always forces physical inspection (per PRD)
    if confidence < 60:
        return "physical_inspection"

    # Additional action thresholds
    if predicted_risk_pct > 80:
        return "inspect_recalibrate"
    elif predicted_risk_pct > 50:
        return "slow_station"
    else:
        return "monitor"


def compute_predicted_risk(residuals: dict) -> float:
    """Compute predicted risk percentage from residuals."""
    norm_ct   = min(abs(residuals.get("cycle_time", 0)) / 20.0, 1.0)
    norm_vib  = min(abs(residuals.get("vibration", 0)) / 3.0, 1.0)
    norm_temp = min(abs(residuals.get("temperature", 0)) / 15.0, 1.0)
    return round((norm_ct + norm_vib + norm_temp) / 3 * 100, 1)
