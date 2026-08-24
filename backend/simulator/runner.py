"""CLI runner for the TRACE-TWIN synthetic factory simulator.

Usage:
    python -m backend.simulator.runner --batch          # full batch (default)
    python -m backend.simulator.runner --live            # one tick every 2s
    python -m backend.simulator.runner --batch --vehicles 50 --start-id 4800
"""

import argparse
import time

from backend.db.init_db import init_db
from backend.db.connection import get_sync_connection
from backend.simulator.factory import FactorySimulator


def main():
    parser = argparse.ArgumentParser(description="TRACE-TWIN Factory Simulator")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--batch", action="store_true", default=True,
                       help="Generate full batch of data (default)")
    mode.add_argument("--live", action="store_true",
                       help="Generate events one at a time with delay")
    parser.add_argument("--vehicles", type=int, default=16,
                         help="Number of vehicles to simulate (default: 16)")
    parser.add_argument("--start-id", type=int, default=4810,
                         help="Starting vehicle ID number (default: 4810)")
    parser.add_argument("--interval", type=float, default=2.0,
                         help="Seconds between ticks in live mode (default: 2.0)")
    parser.add_argument("--skip-init", action="store_true",
                         help="Skip database initialization")
    args = parser.parse_args()

    print("TRACE-TWIN — Synthetic Factory Simulator")
    print("=" * 45)

    # Initialize database
    if not args.skip_init:
        print("\n[1/2] Initializing database...")
        init_db()
    else:
        print("\n[1/2] Skipping database init (--skip-init)")

    conn = get_sync_connection()
    sim = FactorySimulator(
        conn,
        start_vehicle_id=args.start_id,
        num_vehicles=args.vehicles,
    )

    if args.live:
        print(f"\n[2/2] Live simulation ({args.vehicles} vehicles, {args.interval}s interval)...")
        tick_count = 0
        while True:
            event = sim.generate_tick()
            if event is None:
                break
            tick_count += 1
            inferred_tag = " [INFERRED]" if event["is_inferred"] else ""
            print(f"  Tick {tick_count:4d} | {event['vehicle_id']} @ {event['station_id']} | "
                  f"CT={event['cycle_time_sec']:.1f}s  VIB={event['vibration_mm_s']:.2f}  "
                  f"TEMP={event['temperature_c']:.1f}°C{inferred_tag}")
            time.sleep(args.interval)
        print(f"\n  Live simulation complete. {tick_count} events generated.")
    else:
        print(f"\n[2/2] Batch simulation")
        print("  Generating batch data tick-by-tick to trigger pipeline...")
        from backend.engine.pipeline import run_full_pipeline
        for _ in range(args.vehicles * len(sim.stations)):
            res = sim.generate_tick()
            if res and res["station_id"] == "STATION_30":
                # Run pipeline once per vehicle completion to simulate real-time
                run_full_pipeline(conn)
        stats = {"vehicles": args.vehicles, "events": None, "inferred_events": None} # Placeholder for reporting
        print(f"\n  Batch complete.")

    # Print verification counts
    print("\n  Database verification:")
    for table in ["vehicles", "process_events", "stations", "station_baselines"]:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"    {table:20s} → {count} rows")

    # Check anomaly-affected events at Station 14
    anomalous = conn.execute(
        "SELECT pe.vehicle_id, pe.cycle_time_sec, sb.expected_cycle_time_sec, "
        "(pe.cycle_time_sec - sb.expected_cycle_time_sec) as residual "
        "FROM process_events pe "
        "JOIN station_baselines sb ON sb.station_id = pe.station_id "
        "WHERE pe.station_id = 'STATION_14' "
        "AND (pe.cycle_time_sec - sb.expected_cycle_time_sec) > 3 "
        "ORDER BY pe.entered_at",
    ).fetchall()
    if anomalous:
        print(f"\n  Station 14 anomalous readings ({len(anomalous)} vehicles):")
        for row in anomalous:
            print(f"    {row['vehicle_id']}: CT={row['cycle_time_sec']:.1f}s "
                  f"(expected={row['expected_cycle_time_sec']:.0f}s, residual=+{row['residual']:.1f}s)")

    inferred = conn.execute(
        "SELECT COUNT(*) FROM process_events WHERE is_inferred = 1"
    ).fetchone()[0]
    print(f"\n  Blind station inferred events: {inferred}")

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
