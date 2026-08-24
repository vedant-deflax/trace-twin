"""What-If scenario projections for TRACE-TWIN.

Generates 3 parametrized scenarios for each anomaly:
  1. Continue       — no change, minimal containment
  2. Slow Station   — reduce speed 30%, moderate containment
  3. Inspect & Recalibrate — full stop, near-total containment
"""

import sqlite3


def compute_what_if(
    anomaly_id: int,
    conn: sqlite3.Connection,
    confidence: float = 50.0,
    predicted_risk_pct: float = 50.0,
) -> list[dict]:
    """Compute what-if scenarios for an anomaly.

    Uses simple queueing math to project throughput impact and
    containment rates for each intervention scenario.

    Returns:
        List of 3 scenario dicts.
    """
    anomaly = conn.execute(
        "SELECT station_id, residual_cycle_time, residual_vibration, residual_temperature "
        "FROM anomalies WHERE id = ?",
        (anomaly_id,),
    ).fetchone()

    if not anomaly:
        return []

    station_id = anomaly["station_id"]

    # Get baseline throughput for this station
    baseline = conn.execute(
        "SELECT expected_cycle_time_sec FROM station_baselines WHERE station_id = ?",
        (station_id,),
    ).fetchone()

    if not baseline:
        return []

    expected_ct = baseline["expected_cycle_time_sec"]
    throughput_baseline = 3600 / expected_ct  # vehicles per hour

    # Severity factor: how much cycle time has drifted (fraction of baseline)
    residual_ct = abs(anomaly["residual_cycle_time"] or 0)
    severity_factor = residual_ct / expected_ct

    # Determine which scenario to recommend
    recommend_inspect = confidence < 60 or predicted_risk_pct > 80

    scenarios = [
        {
            "scenario_label": "continue",
            "projected_throughput_impact": 0.0,
            "projected_defect_containment": round(min(max(15.0, 5 * severity_factor), 30.0), 1),
            "is_recommended": False,
        },
        {
            "scenario_label": "slow_station",
            "projected_throughput_impact": -round(throughput_baseline * 0.12, 1),
            "projected_defect_containment": round(55 + 10 * min(severity_factor, 2.0), 1),
            "is_recommended": not recommend_inspect and predicted_risk_pct > 50,
        },
        {
            "scenario_label": "inspect_recalibrate",
            "projected_throughput_impact": -round(throughput_baseline * 0.30, 1),
            "projected_defect_containment": 95.0,
            "is_recommended": recommend_inspect,
        },
    ]

    # Persist to DB (idempotent)
    conn.execute("DELETE FROM what_if_scenarios WHERE anomaly_id = ?", (anomaly_id,))
    for s in scenarios:
        conn.execute(
            "INSERT INTO what_if_scenarios "
            "(anomaly_id, scenario_label, projected_throughput_impact, "
            "projected_defect_containment, is_recommended) "
            "VALUES (?, ?, ?, ?, ?)",
            (anomaly_id, s["scenario_label"], s["projected_throughput_impact"],
             s["projected_defect_containment"], int(s["is_recommended"])),
        )
    conn.commit()

    return scenarios
