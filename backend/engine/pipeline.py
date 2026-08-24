"""Full anomaly detection pipeline orchestrator for TRACE-TWIN.

Ties together: anomaly detection → root cause ranking → confidence scoring →
blast radius → what-if projections.

Run as:  python -m backend.engine.pipeline
"""

import sqlite3

from backend.db.connection import get_sync_connection
from backend.engine.anomaly_detector import detect_anomalies
from backend.engine.root_cause import rank_root_causes
from backend.engine.confidence import (
    compute_confidence,
    get_recommended_action,
    compute_predicted_risk,
)
from backend.engine.blast_radius import compute_blast_radius
from backend.engine.what_if import compute_what_if
from backend.engine.blind_station import infer_blind_stations


def run_full_pipeline(conn: sqlite3.Connection = None) -> dict:
    """Execute the complete anomaly detection and analysis pipeline.

    Steps:
        1. Ensure blind station data exists
        2. Detect anomalies across all stations
        3. For each anomaly: compute root causes, blast radius, confidence,
           recommended action, and what-if scenarios

    Returns:
        Summary dict with counts.
    """
    if conn is None:
        conn = get_sync_connection()

    # Step 1: Infer blind station readings (idempotent)
    inferred = infer_blind_stations(conn)
    print(f"  Blind station inference: {inferred} new events")

    # Step 2: Run anomaly detection
    anomaly_results = detect_anomalies(conn)
    created = [a for a in anomaly_results if a["action"] == "created"]
    updated = [a for a in anomaly_results if a["action"] == "updated"]
    resolved = [a for a in anomaly_results if a["action"] == "resolved"]
    print(f"  Anomalies: {len(created)} new, {len(updated)} updated, {len(resolved)} resolved")

    # Step 3: Enrich each anomaly
    all_anomalies = conn.execute(
        "SELECT id, station_id, resource_id, status, "
        "residual_cycle_time, residual_vibration, residual_temperature "
        "FROM anomalies"
    ).fetchall()

    for anomaly in all_anomalies:
        anomaly_id = anomaly["id"]
        station_id = anomaly["station_id"]
        residuals = {
            "cycle_time":  anomaly["residual_cycle_time"] or 0,
            "vibration":   anomaly["residual_vibration"] or 0,
            "temperature": anomaly["residual_temperature"] or 0,
        }

        # Root cause ranking
        causes = rank_root_causes(anomaly_id, residuals, conn, station_id=station_id)

        # Confidence scoring
        confidence = compute_confidence(station_id, conn, residuals)
        action = get_recommended_action(station_id, confidence, residuals)
        risk = compute_predicted_risk(residuals)

        # Update anomaly record
        conn.execute(
            "UPDATE anomalies SET confidence_score = ?, recommended_action = ? "
            "WHERE id = ?",
            (confidence, action, anomaly_id),
        )
        conn.commit()

        # Blast radius
        blast = compute_blast_radius(anomaly_id, conn)

        # What-if scenarios
        scenarios = compute_what_if(anomaly_id, conn, confidence, risk)

        print(f"\n  Anomaly #{anomaly_id} @ {station_id}:")
        print(f"    Residuals: CT={residuals['cycle_time']:.1f}s, "
              f"VIB={residuals['vibration']:.2f}mm/s, "
              f"TEMP={residuals['temperature']:.1f}°C")
        print(f"    Root causes: {', '.join(f'{c['cause_label']}={c['probability_pct']:.0f}%' for c in causes)}")
        print(f"    Confidence: {confidence:.0f}%  |  Risk: {risk:.0f}%  |  Action: {action}")
        print(f"    Blast radius: {len(blast)} vehicles ({', '.join(blast[:5])}{'...' if len(blast) > 5 else ''})")
        print(f"    What-if: {', '.join(f'{s['scenario_label']}(rec={s['is_recommended']})' for s in scenarios)}")

    return {
        "anomalies_created": len(created),
        "anomalies_updated": len(updated),
        "anomalies_resolved": len(resolved),
        "anomalies_enriched": len(all_anomalies),
        "blind_inferred": inferred,
    }


if __name__ == "__main__":
    print("TRACE-TWIN — Anomaly Detection Pipeline")
    print("=" * 45)
    summary = run_full_pipeline()
    print(f"\nPipeline complete: {summary}")
