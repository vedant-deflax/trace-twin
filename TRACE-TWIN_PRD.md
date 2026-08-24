# TRACE-TWIN — Product Requirements Document (Hackathon MVP)
**PS4: DigitalTwin.ai — Causal, Context-Aware Risk Intelligence for Vehicle Assembly Lines**
Timebox: 24–48 hours

---

## 0. MVP Scope Cut (What We're Actually Building)

The full pitch has five pillars: Semantic Layer, Digital Thread, Blind Station Inference, What-If Simulator, Confidence Scoring — plus a "Ask the Twin" GenAI copilot and a Federated Supply-Chain Twin on the roadmap. In 24–48 hours we cannot build real OPC UA/MQTT ingestion or a physics-based simulator, so the MVP **simulates the factory** and focuses on proving the *reasoning loop*, not real hardware integration.

### In scope (core demo path)
1. **Synthetic data generator** — simulates N stations × M vehicles moving down a line, emitting cycle time / vibration / temperature readings, with an injected anomaly (Robot R14-style torque drift).
2. **Digital Thread (DB schema)** — Product ↔ Process ↔ Resource relationships, queryable.
3. **Semantic Layer (lite)** — a single normalized `readings` table that reconciles two mock upstream naming conventions (`cycle_time` vs `operation_duration`) into one field, done at ingestion.
4. **Pattern Recognition / Anomaly Detection** — rolling z-score / residual-based deviation detector on cycle time, vibration, temperature vs. an expected baseline.
5. **Root-Cause Ranking** — simple rule-based/weighted scoring over residual patterns (tool wear vs motor degradation vs thermal drift), mirroring the "ranked probable root causes" box in the deck.
6. **Blast Radius Query** — given a flagged station + time window, return the bounded set of vehicle IDs that passed through it while the anomaly was active.
7. **Blind Station Inference (lite)** — for a station with no direct sensor, infer state from upstream/downstream cycle-time deltas.
8. **What-If Simulator (lite)** — precomputed/parametrized scenario projection (Continue / Slow Down / Inspect) showing projected downstream impact using simple queueing math, not a full DES engine.
9. **Confidence Scoring** — heuristic combining sensor coverage % + data recency into a 0–100 score attached to every alert; low confidence forces an "Inspect" recommendation.
10. **Dashboard UI** — line overview, alert feed, vehicle drill-down (#4821 use case), blast-radius view, what-if comparison panel.

### Explicitly out of scope for the hackathon (roadmap only)
- Real OPC UA/MQTT/PLC integration
- "Ask the Twin" natural-language copilot (stretch goal only, see Milestone 6)
- Federated supply-chain twin
- Production-grade auth, multi-tenant plant support
- Real physics/discrete-event simulation

### Stretch goal (only if core path is done early)
- "Ask the Twin" — a thin LLM layer that takes a natural-language question, converts it to a query over the digital-thread schema (function-calling / text-to-SQL), and answers from real data. This is cheap to bolt on **once the schema and API below exist**, which is why the schema is designed to be LLM-friendly (clear names, FK relationships, no cryptic codes).

---

## 1. System Architecture & Tech Stack

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│        Frontend (Web)        │  REST  │          Backend API          │
│  Next.js 14 (App Router)     │◄──────►│  FastAPI (Python)              │
│  Tailwind CSS + shadcn/ui    │  WS/SSE│  - ingestion + anomaly engine  │
│  Recharts (timelines/charts) │◄──────►│  - blast-radius query service  │
└───────────────┬───────────────┘        │  - what-if simulator           │
                │                        │  - confidence scoring          │
                │                        └───────────────┬────────────────┘
                │                                        │
                ▼                                        ▼
       Vercel (frontend hosting)              Supabase Postgres (DB)
                                               + Supabase Realtime (live feed)
                                               + a background "simulator" script
                                               that inserts synthetic sensor rows
                                               on a timer (cron / asyncio loop)
```

**Why this stack for a hackathon:**
- **Next.js + Tailwind**: fastest path to a polished, demo-able dashboard; App Router lets us colocate API routes if FastAPI setup stalls (fallback plan).
- **FastAPI**: anomaly detection / root-cause ranking / what-if math are easiest to express in Python (pandas/numpy), and FastAPI gives free OpenAPI docs for the judging demo.
- **Supabase (Postgres)**: managed DB + built-in Realtime (Postgres logical replication → websocket) means the "live shop floor" feed to the dashboard is close to free — no need to hand-roll WebSocket infra.
- **Recharts**: quick residual/timeline charts matching the deck's "Expected vs Actual vs Residual" visualization.
- **Deployment**: Vercel (frontend) + Railway or Render (FastAPI) + Supabase (DB) — all have generous free tiers and near-zero DevOps for a 48h window.

**Fallback if time-constrained:** drop FastAPI entirely and do anomaly detection / blast radius / what-if logic as Next.js API routes + Supabase Edge Functions (SQL/PLpgSQL for the blast-radius query). This removes a whole service and a deployment target. Decide by end of Milestone 2 (see below) based on remaining time.

---

## 2. Database Schema (Supabase / Postgres)

Designed so the **Digital Thread** (Product ↔ Process ↔ Resource) is a first-class relationship, not an afterthought — every anomaly/alert row can be traced in both directions (root cause → affected vehicles, and vehicle → history of what happened to it).

```sql
-- ============= CORE ENTITIES =============

create table stations (
  id            text primary key,        -- e.g. 'STATION_14'
  name          text not null,           -- 'Welding - Robot R14'
  sequence_no   int not null,            -- position on the line, for blast-radius ordering
  has_sensors   boolean default true,    -- false => triggers Blind Station Inference
  resource_id   text references resources(id)
);

create table resources (
  id            text primary key,        -- e.g. 'R14'
  type          text not null,           -- 'robot' | 'tool' | 'conveyor'
  station_id    text references stations(id)
);

create table vehicles (
  id            text primary key,        -- e.g. 'VEH_4821'
  model         text,
  line_entry_ts timestamptz not null
);

-- ============= DIGITAL THREAD (event ledger) =============
-- Every row = one Product x Process(Station) x Resource event.
-- This table IS the digital thread.

create table process_events (
  id                bigserial primary key,
  vehicle_id        text references vehicles(id),
  station_id        text references stations(id),
  resource_id       text references resources(id),
  entered_at        timestamptz not null,
  exited_at         timestamptz,
  -- SEMANTIC LAYER: normalized fields, regardless of source-system naming
  cycle_time_sec    numeric,     -- reconciled from cycle_time OR operation_duration
  vibration_mm_s    numeric,
  temperature_c     numeric,
  source_system     text,        -- 'MES' | 'PLC' | 'QUALITY' | 'INFERRED'
  is_inferred       boolean default false   -- true when Blind Station Inference used
);

-- ============= BASELINES (for residual calc) =============

create table station_baselines (
  station_id        text references stations(id) primary key,
  expected_cycle_time_sec  numeric,
  expected_vibration_mm_s  numeric,
  expected_temperature_c   numeric
);

-- ============= ANOMALIES / ALERTS =============

create table anomalies (
  id                bigserial primary key,
  station_id        text references stations(id),
  resource_id       text references resources(id),
  detected_at       timestamptz not null default now(),
  window_start      timestamptz not null,   -- for blast-radius query
  window_end        timestamptz,
  residual_cycle_time   numeric,
  residual_vibration    numeric,
  residual_temperature  numeric,
  confidence_score  numeric,     -- 0-100, see Section 2.4
  status            text default 'open',   -- 'open'|'inspecting'|'resolved'
  recommended_action text        -- e.g. 'inspect_r14'
);

create table root_causes (
  id                bigserial primary key,
  anomaly_id        bigint references anomalies(id),
  cause_label       text,        -- 'tool_wear' | 'motor_degradation' | 'thermal_drift'
  probability_pct   numeric
);

create table blast_radius (
  id                bigserial primary key,
  anomaly_id        bigint references anomalies(id),
  vehicle_id        text references vehicles(id)
);

create table what_if_scenarios (
  id                bigserial primary key,
  anomaly_id        bigint references anomalies(id),
  scenario_label    text,        -- 'continue' | 'slow_station' | 'inspect_recalibrate'
  projected_throughput_impact  numeric,   -- vehicles/hr delta
  projected_defect_containment numeric,   -- % vehicles caught
  is_recommended    boolean default false
);
```

### 2.1 Key derived query — "Blast Radius" (the vehicle #4821 use case)
```sql
select v.id
from process_events pe
join vehicles v on v.id = pe.vehicle_id
where pe.station_id = 'STATION_14'
  and pe.entered_at between :window_start and :window_end
order by pe.entered_at;
-- returns the bounded set, e.g. VEH_4817..VEH_4825
```

### 2.2 Confidence Score (heuristic, MVP)
```
confidence = 0.6 * sensor_coverage_pct(station)
           + 0.3 * recency_score(last_reading_age)
           + 0.1 * (1 - is_inferred)
```
If `confidence < 60` → `recommended_action` is forced to `physical_inspection` regardless of predicted risk %, matching the deck's "87% risk / 54% confidence → recommend human inspection" example.

---

## 3. API Contract (FastAPI)

Base URL: `/api/v1`

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/simulate/tick` | Advances the synthetic simulation one step; inserts `process_events` rows (used by background scheduler, or manually for demo control) |
| `GET`  | `/stations` | List stations with current baseline + live status |
| `GET`  | `/stations/{id}/events?since=` | Recent process events for a station (for the residual chart) |
| `GET`  | `/vehicles/{id}` | Full digital-thread history for one vehicle (drill-down view) |
| `GET`  | `/anomalies` | List active/resolved anomalies (alert feed) |
| `GET`  | `/anomalies/{id}` | Anomaly detail: residuals, root-cause ranking, confidence, blast radius |
| `GET`  | `/anomalies/{id}/blast-radius` | Returns bounded vehicle ID list |
| `GET`  | `/anomalies/{id}/what-if` | Returns the 3 scenario projections (Continue / Slow / Inspect) |
| `POST` | `/anomalies/{id}/approve` | Plant-manager approves a recommended action (human-in-the-loop, sets status='inspecting') |
| `POST` | `/ask` *(stretch)* | NL question → structured answer over the schema above |

**Example response — `GET /anomalies/{id}`:**
```json
{
  "id": 101,
  "station": { "id": "STATION_14", "name": "Welding - Robot R14" },
  "detected_at": "2026-08-24T10:15:00Z",
  "residuals": { "cycle_time_sec": 13, "vibration_mm_s": 2.7, "temperature_c": 8 },
  "root_causes": [
    { "cause_label": "tool_wear", "probability_pct": 72 },
    { "cause_label": "motor_degradation", "probability_pct": 19 },
    { "cause_label": "thermal_drift", "probability_pct": 9 }
  ],
  "confidence_score": 54,
  "predicted_risk_pct": 87,
  "recommended_action": "physical_inspection",
  "blast_radius": ["VEH_4817","VEH_4818","VEH_4819","VEH_4820","VEH_4821","VEH_4822","VEH_4823","VEH_4824","VEH_4825"],
  "what_if": [
    { "scenario_label": "continue", "projected_throughput_impact": 0, "projected_defect_containment": 15 },
    { "scenario_label": "slow_station", "projected_throughput_impact": -8, "projected_defect_containment": 55 },
    { "scenario_label": "inspect_recalibrate", "projected_throughput_impact": -20, "projected_defect_containment": 95, "is_recommended": true }
  ]
}
```

---

## 4. Implementation Milestones (24–48h)

### Hour 0–4 — Foundation
- Spin up Supabase project, run schema DDL from Section 2.
- Scaffold Next.js app (Tailwind + shadcn/ui) and FastAPI service; connect both to Supabase.
- Write the **synthetic data generator**: 15–20 stations, one designated "legacy/no-sensor" station (for Blind Station Inference demo), ~30 vehicles/hr baseline flow, one scripted anomaly injection at Station 14 mirroring the #4821 story from the deck.
- **Decision point:** confirm FastAPI vs. Next.js-API-routes-only based on setup friction so far.

### Hour 4–10 — Digital Thread + Semantic Layer
- Implement ingestion endpoint/job that writes `process_events`, reconciling mock field-name variants (`cycle_time` vs `operation_duration`) into `cycle_time_sec` — this is the "Semantic Layer" deliverable.
- Build `/vehicles/{id}` and `/stations/{id}/events` endpoints.
- Frontend: line overview page (stations in sequence, live status dots via Supabase Realtime subscription).

### Hour 10–18 — Pattern Recognition + Root Cause + Confidence
- Implement rolling baseline vs. residual calculation (z-score or simple `(actual-expected)` threshold) → writes to `anomalies` table when residuals cross threshold.
- Implement weighted root-cause ranking (rule-based scoring against residual signature combinations) → `root_causes` table.
- Implement confidence score formula (Section 2.2).
- Implement Blind Station Inference: for `has_sensors=false` stations, estimate `cycle_time_sec` from upstream/downstream station deltas instead of a direct reading; flag `is_inferred=true`.
- Frontend: alert feed + anomaly detail page with residual chart (Expected/Actual/Residual, matching deck visual).

### Hour 18–28 — Blast Radius + What-If Simulator
- Implement `/anomalies/{id}/blast-radius` (SQL from Section 2.1).
- Implement `/anomalies/{id}/what-if`: simple queueing-delay model for "slow station" (throughput = 1/cycle_time, propagate delay to downstream stations) and containment-rate heuristic for "inspect" vs "continue" scenarios.
- Frontend: blast-radius vehicle list view + what-if comparison cards with an "Approve" button (`POST /anomalies/{id}/approve`) — this is the "AI as oversight copilot, human approves" beat from the deck.

### Hour 28–36 — Polish + End-to-End Demo Script
- Wire the full #4821 narrative as a scripted demo: trigger anomaly → show detection → show blast radius (9 vehicles) → show what-if comparison → plant manager approves inspection.
- Empty/loading states, responsive layout, confidence-score color coding (red/amber/green).
- Seed a second scenario (bottleneck ripple effect) to show breadth beyond the single defect-propagation story.

### Hour 36–44 — Stretch: "Ask the Twin"
- Only if core path is solid: add `/ask` endpoint using an LLM with function-calling against the schema (e.g., "which vehicles were near Station 14 in the last hour?" → calls the blast-radius query). Simple chat UI panel on the dashboard.

### Hour 44–48 — Buffer / Deploy / Rehearse
- Deploy frontend (Vercel) + backend (Railway/Render), verify with production URLs.
- Rehearse the 3–5 minute demo against the Problem → Solution → Impact structure of the original deck.

---

## 5. Demo Success Criteria (what judges should see)

1. Live-looking shop floor with a "Vehicle #4821" style anomaly firing in real time.
2. A precise, bounded blast radius (single digits) instead of a vague "check everything."
3. A visible confidence score that changes the recommended action (proves Confidence Scoring pillar).
4. At least one inferred (sensorless) station reading (proves Blind Station Inference pillar).
5. A side-by-side what-if comparison with a clearly recommended scenario, requiring human approval before "acting" (proves Adaptive Fidelity + human-in-the-loop framing).
