"""Initialize the TRACE-TWIN SQLite database with schema and seed data.

Run as:  python -m backend.db.init_db
"""

import sqlite3
from pathlib import Path

from backend.db.connection import DB_PATH

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

# ──────────────────────── 30 STATIONS ────────────────────────
# Body Construction (1-10) | Paint (11-18) | Final Assembly (19-30)
# Sensorless: 4, 9, 16, 22, 27

STATIONS = [
    # Body Construction (1-10)
    ("STATION_01", "Body - Frame Press B1",           1,  1, "R01"),
    ("STATION_02", "Body - Frame Press B2",           2,  1, "R02"),
    ("STATION_03", "Body - Side Panel Assembly B3",   3,  1, "R03"),
    ("STATION_04", "Body - Roof Assembly B4",         4,  0, "R04"),   # SENSORLESS
    ("STATION_05", "Body - Floor Pan B5",             5,  1, "R05"),
    ("STATION_06", "Body - Door Fitting B6",          6,  1, "R06"),
    ("STATION_07", "Body - Structural Weld B7",       7,  1, "R07"),
    ("STATION_08", "Body - Reinforcement B8",         8,  1, "R08"),
    ("STATION_09", "Body - Sealing B9",               9,  0, "R09"),   # SENSORLESS
    ("STATION_10", "Body - QC Inspection B10",        10, 1, "R10"),
    # Paint (11-18)
    ("STATION_11", "Paint - Pre-Treatment P11",       11, 1, "R11"),
    ("STATION_12", "Paint - E-Coat P12",              12, 1, "R12"),
    ("STATION_13", "Paint - Primer P13",              13, 1, "R13"),
    ("STATION_14", "Framing - Torque & Weld R14",     14, 1, "R14"),   # ANOMALY TARGET
    ("STATION_15", "Paint - Base Coat P15",           15, 1, "R15"),
    ("STATION_16", "Paint - Clear Coat P16",          16, 0, "R16"),   # SENSORLESS
    ("STATION_17", "Paint - Curing Oven P17",         17, 1, "R17"),
    ("STATION_18", "Paint - Polish P18",              18, 1, "R18"),
    # Final Assembly (19-30)
    ("STATION_19", "Assembly - Wiring Harness A19",   19, 1, "R19"),
    ("STATION_20", "Assembly - Dashboard A20",        20, 1, "R20"),
    ("STATION_21", "Assembly - Seats A21",            21, 1, "R21"),
    ("STATION_22", "Assembly - Windshield A22",       22, 0, "R22"),   # SENSORLESS
    ("STATION_23", "Assembly - Engine Mount A23",     23, 1, "R23"),
    ("STATION_24", "Assembly - Drivetrain A24",       24, 1, "R24"),
    ("STATION_25", "Assembly - Exhaust A25",          25, 1, "R25"),
    ("STATION_26", "Assembly - Wheels A26",           26, 1, "R26"),
    ("STATION_27", "Assembly - Fluids A27",           27, 0, "R27"),   # SENSORLESS
    ("STATION_28", "Assembly - Electronics A28",      28, 1, "R28"),
    ("STATION_29", "Assembly - Final Trim A29",       29, 1, "R29"),
    ("STATION_30", "Assembly - End of Line QC A30",   30, 1, "R30"),
]

RESOURCE_TYPES = {
    "R01": "tool",     "R02": "tool",     "R03": "robot",    "R04": "robot",
    "R05": "robot",    "R06": "tool",     "R07": "robot",    "R08": "robot",
    "R09": "tool",     "R10": "tool",
    "R11": "conveyor", "R12": "conveyor", "R13": "conveyor", "R14": "robot",
    "R15": "conveyor", "R16": "conveyor", "R17": "conveyor", "R18": "tool",
    "R19": "tool",     "R20": "tool",     "R21": "robot",    "R22": "robot",
    "R23": "robot",    "R24": "robot",    "R25": "tool",     "R26": "robot",
    "R27": "tool",     "R28": "tool",     "R29": "tool",     "R30": "tool",
}

# Expected cycle_time_sec, vibration_mm_s, temperature_c per station
BASELINES = {
    # Body Construction
    "STATION_01": (88,  2.2, 42),
    "STATION_02": (90,  2.3, 44),
    "STATION_03": (75,  2.8, 38),
    "STATION_04": (72,  2.6, 37),   # sensorless
    "STATION_05": (78,  2.9, 39),
    "STATION_06": (65,  2.0, 36),
    "STATION_07": (55,  3.2, 48),
    "STATION_08": (58,  3.0, 46),
    "STATION_09": (62,  2.4, 40),   # sensorless
    "STATION_10": (85,  1.5, 35),
    # Paint
    "STATION_11": (110, 1.3, 58),
    "STATION_12": (105, 1.0, 62),
    "STATION_13": (100, 1.2, 55),
    "STATION_14": (75,  1.4, 38),   # KEY BASELINE — anomaly target (75s CT, 1.4mm/s Vib, 38°C Temp)
    "STATION_15": (108, 1.1, 60),
    "STATION_16": (115, 0.9, 65),   # sensorless
    "STATION_17": (120, 0.8, 70),
    "STATION_18": (95,  1.4, 50),
    # Final Assembly
    "STATION_19": (68,  1.8, 33),
    "STATION_20": (72,  1.6, 31),
    "STATION_21": (60,  2.0, 34),
    "STATION_22": (65,  2.2, 32),   # sensorless
    "STATION_23": (75,  2.5, 38),
    "STATION_24": (70,  2.3, 36),
    "STATION_25": (58,  1.5, 30),
    "STATION_26": (55,  2.1, 33),
    "STATION_27": (62,  1.3, 28),   # sensorless
    "STATION_28": (68,  1.4, 30),
    "STATION_29": (70,  1.7, 32),
    "STATION_30": (90,  0.5, 25),
}


def init_db() -> None:
    """Create a fresh database with schema + seed data."""
    try:
        if DB_PATH.exists():
            conn = sqlite3.connect(str(DB_PATH), timeout=10)
            conn.execute("PRAGMA journal_mode=WAL")
            cursor = conn.cursor()
            tables = [row[0] for row in cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
            for t in tables:
                cursor.execute(f"DROP TABLE IF EXISTS {t}")
            conn.commit()
            conn.close()
            print("  Cleared existing tables.")
    except Exception as e:
        print(f"  Note during table drop: {e}")
        for p in [DB_PATH, Path(str(DB_PATH) + "-wal"), Path(str(DB_PATH) + "-shm")]:
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass

    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    ddl = SCHEMA_PATH.read_text()
    conn.executescript(ddl)
    print("  Schema created.")

    # Seed resources first (FK target for stations)
    for station_id, _name, _seq, _sens, res_id in STATIONS:
        conn.execute(
            "INSERT INTO resources (id, type, station_id) VALUES (?, ?, ?)",
            (res_id, RESOURCE_TYPES[res_id], station_id),
        )

    for sid, name, seq, sensors, res_id in STATIONS:
        conn.execute(
            "INSERT INTO stations (id, name, sequence_no, has_sensors, resource_id) VALUES (?, ?, ?, ?, ?)",
            (sid, name, seq, sensors, res_id),
        )

    for sid, (ct, vib, temp) in BASELINES.items():
        conn.execute(
            "INSERT INTO station_baselines (station_id, expected_cycle_time_sec, expected_vibration_mm_s, expected_temperature_c) VALUES (?, ?, ?, ?)",
            (sid, ct, vib, temp),
        )

    # Re-seed SQLite database with realistic telemetry dataset (300 vehicles, 9000 events)
    import pandas as pd
    from datetime import datetime, timedelta
    from backend.simulator.dataset_generator import (
        generate_production_telemetry,
        save_telemetry_csv,
        CSV_PATH,
        SENSORLESS_STATIONS,
        BASE_TORQUE_NM,
    )

    if CSV_PATH.exists():
        df = pd.read_csv(str(CSV_PATH))
    else:
        df = generate_production_telemetry(num_vehicles=300, random_seed=42)
        save_telemetry_csv(df)

    vehicle_entries = []
    for vin, group in df.groupby("vehicle_id", sort=False):
        first_ts = group["timestamp"].iloc[0]
        vehicle_entries.append((vin, "Model-X", first_ts))

    conn.executemany(
        "INSERT OR IGNORE INTO vehicles (id, model, line_entry_ts) VALUES (?, ?, ?)",
        vehicle_entries,
    )

    event_entries = []
    for _, row in df.iterrows():
        seq = int(row["station_seq"])
        sid = f"STATION_{seq:02d}"
        res_id = f"R{seq:02d}"
        is_sensorless = seq in SENSORLESS_STATIONS
        ts = datetime.fromisoformat(row["timestamp"])
        cycle_time = float(row["cycle_time"])
        exited = ts + timedelta(seconds=cycle_time)
        torque = float(row["joint_torque"]) if pd.notna(row["joint_torque"]) and row["joint_torque"] > 0 else BASE_TORQUE_NM

        event_entries.append((
            row["vehicle_id"],
            sid,
            res_id,
            ts.isoformat(),
            exited.isoformat(),
            cycle_time,
            float(row["tool_vibration"]),
            float(row["process_temperature"]),
            torque,
            "INFERRED" if is_sensorless else "MES",
            1 if is_sensorless else 0,
        ))

    conn.executemany(
        "INSERT INTO process_events "
        "(vehicle_id, station_id, resource_id, entered_at, exited_at, "
        " cycle_time_sec, vibration_mm_s, temperature_c, torque_nm, source_system, is_inferred) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        event_entries,
    )

    conn.commit()
    conn.close()

    sensorless = [s[0] for s in STATIONS if s[3] == 0]
    print(f"  Database initialized at {DB_PATH}")
    print(f"  Seeded {len(STATIONS)} stations, {len(RESOURCE_TYPES)} resources, {len(BASELINES)} baselines.")
    print(f"  Reseeded {len(vehicle_entries)} vehicles and {len(event_entries)} process events from realistic dataset.")
    print(f"  Sensorless stations: {', '.join(sensorless)}")


if __name__ == "__main__":
    print("TRACE-TWIN — Database Initialization")
    print("=" * 40)
    init_db()
