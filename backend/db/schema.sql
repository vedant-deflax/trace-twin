-- TRACE-TWIN Database Schema (SQLite)
-- Digital Thread: Product (Vehicle) ↔ Process (Station) ↔ Resource

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============= CORE ENTITIES =============

CREATE TABLE IF NOT EXISTS resources (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,        -- 'robot' | 'tool' | 'conveyor'
    station_id    TEXT
);

CREATE TABLE IF NOT EXISTS stations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    sequence_no   INTEGER NOT NULL,
    has_sensors   INTEGER DEFAULT 1,   -- 0 = blind station (triggers inference)
    resource_id   TEXT REFERENCES resources(id)
);

CREATE TABLE IF NOT EXISTS vehicles (
    id            TEXT PRIMARY KEY,
    model         TEXT,
    line_entry_ts TEXT NOT NULL         -- ISO 8601 timestamp
);

-- ============= DIGITAL THREAD (event ledger) =============
-- Every row = one Product × Process(Station) × Resource event.

CREATE TABLE IF NOT EXISTS process_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id      TEXT REFERENCES vehicles(id),
    station_id      TEXT REFERENCES stations(id),
    resource_id     TEXT REFERENCES resources(id),
    entered_at      TEXT NOT NULL,
    exited_at       TEXT,
    -- SEMANTIC LAYER: normalized fields regardless of source naming
    cycle_time_sec  REAL,
    vibration_mm_s  REAL,
    temperature_c   REAL,
    torque_nm       REAL,
    source_system   TEXT,              -- 'MES' | 'PLC' | 'QUALITY' | 'INFERRED'
    is_inferred     INTEGER DEFAULT 0  -- 1 when Blind Station Inference used
);

-- ============= BASELINES (for residual calculation) =============

CREATE TABLE IF NOT EXISTS station_baselines (
    station_id              TEXT PRIMARY KEY REFERENCES stations(id),
    expected_cycle_time_sec REAL,
    expected_vibration_mm_s REAL,
    expected_temperature_c  REAL
);

-- ============= ANOMALIES / ALERTS =============

CREATE TABLE IF NOT EXISTS anomalies (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id            TEXT REFERENCES stations(id),
    resource_id           TEXT REFERENCES resources(id),
    detected_at           TEXT NOT NULL DEFAULT (datetime('now')),
    window_start          TEXT NOT NULL,
    window_end            TEXT,
    residual_cycle_time   REAL,
    residual_vibration    REAL,
    residual_temperature  REAL,
    confidence_score      REAL,        -- 0-100
    status                TEXT DEFAULT 'open',   -- 'open'|'inspecting'|'resolved'
    recommended_action    TEXT
);

CREATE TABLE IF NOT EXISTS root_causes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    anomaly_id      INTEGER REFERENCES anomalies(id),
    cause_label     TEXT,              -- 'tool_wear' | 'motor_degradation' | 'thermal_drift'
    probability_pct REAL
);

CREATE TABLE IF NOT EXISTS blast_radius (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    anomaly_id  INTEGER REFERENCES anomalies(id),
    vehicle_id  TEXT REFERENCES vehicles(id)
);

CREATE TABLE IF NOT EXISTS what_if_scenarios (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    anomaly_id                    INTEGER REFERENCES anomalies(id),
    scenario_label                TEXT,   -- 'continue' | 'slow_station' | 'inspect_recalibrate'
    projected_throughput_impact   REAL,
    projected_defect_containment  REAL,
    is_recommended                INTEGER DEFAULT 0
);

-- ============= INDEXES =============

CREATE INDEX IF NOT EXISTS idx_pe_vehicle     ON process_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_pe_station     ON process_events(station_id);
CREATE INDEX IF NOT EXISTS idx_pe_entered     ON process_events(entered_at);
CREATE INDEX IF NOT EXISTS idx_anomaly_station ON anomalies(station_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_status  ON anomalies(status);
CREATE INDEX IF NOT EXISTS idx_br_anomaly     ON blast_radius(anomaly_id);
CREATE INDEX IF NOT EXISTS idx_rc_anomaly     ON root_causes(anomaly_id);
CREATE INDEX IF NOT EXISTS idx_wif_anomaly    ON what_if_scenarios(anomaly_id);
CREATE INDEX IF NOT EXISTS idx_pe_station_entered ON process_events(station_id, entered_at);
