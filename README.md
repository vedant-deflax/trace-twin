# TRACE-TWIN: Real-Time Automotive Digital Twin & Predictive Quality Engine

[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-005571?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js 14](https://img.shields.io/badge/Next.js%2014-App%20Router-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![LightGBM & Scikit-Learn](https://img.shields.io/badge/ML-Scikit--Learn%20%7C%20LightGBM-2E7D32?style=for-the-badge&logo=scikit-learn&logoColor=white)](https://scikit-learn.org)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v3.4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)

> **TRACE-TWIN** is an autonomous cyber-physical digital twin that mirrors a 30-station automotive vehicle assembly line, synchronizing real-time non-stationary sensor telemetry (Cycle Time, Joint Torque, Thermal Excursions, and Vibration) across physical chassis in flight. Combining supervised machine learning for downstream defect classification with dynamic blast-radius cohort containment and diagnostic RAG root-cause explanations, TRACE-TWIN enables proactive scrap prevention before defects escape final assembly.

---

## Architecture Diagram

```text
+-----------------------------------------------------------------------------------------------+
|                             CONVEYOR SIMULATION ENGINE                                        |
|  - 30-Station Assembly Sequence (Body Framing, Stamping, Paint/Cure, Sealing, Final Assembly) |
|  - Non-Stationary Tool Wear Accumulation & Thermal Excursion Lifecycles                       |
|  - 1/f Pink Noise Sensor Drift & Blind Station Interpolation (Adjacent Geometric Weighted)    |
+----------------------------------------------+------------------------------------------------+
                                               |
                                               v (In-Flight Telemetry Events @ 2.5s / tick)
+-----------------------------------------------------------------------------------------------+
|                                    FASTAPI BACKEND CORE                                       |
|                                                                                               |
|   +-----------------------+   +-----------------------+   +-------------------------------+   |
|   |  SSE Streamer Server  |   |   Supervised ML Core  |   |     Diagnostic RAG Engine     |   |
|   |  (/stream/factory)    |   |  (/ml/predict-risk)   |   | (/vehicles/{id}/diagnostics)  |   |
|   |  Broadcasts 30 active |   |  Scikit-Learn Pipeline|   | 3-Sigma Variance Evaluator    |   |
|   |  chassis, anomalies,  |   |  ROC-AUC: 0.9907      |   | Failure Mode Embeddings &     |   |
|   |  and macro plant KPIs |   |  F1-Score: 0.9739     |   | Containment Prescriptions     |   |
|   +-----------+-----------+   +-----------+-----------+   +---------------+---------------+   |
|               |                           |                               |                   |
|               +---------------------------+-------------------------------+                   |
|                                           |                                                   |
|                        +------------------v-------------------+                               |
|                        |        SQLite Database (WAL)         |                               |
|                        |  vehicles, process_events, anomalies,|                               |
|                        |  blast_radius, what_if_scenarios     |                               |
|                        +------------------+-------------------+                               |
|                                           |                                                   |
|                        +------------------v-------------------+                               |
|                        |      Intervention Action Router      |                               |
|                        |      POST /api/v1/actions/execute    |                               |
|                        | Resets drift delta, resolves anomaly |                               |
|                        +------------------+-------------------+                               |
+-------------------------------------------+---------------------------------------------------+
                                            |
                                            v (Bi-Directional JSON & Server-Sent Events)
+-----------------------------------------------------------------------------------------------+
|                                 NEXT.JS 14 FRONTEND DASHBOARD                                 |
|                                                                                               |
|   +--------------------------+  +--------------------------+  +---------------------------+   |
|   |  Factory Command Center  |  |    Vehicle Deep Dive     |  |  What-If Decision Studio  |   |
|   |  - Dual Persona Toggle   |  |  - Zero-Flicker Scrubber |  |  - Scenario A: Reroute    |   |
|   |    (Supervisor / Manager)|  |  - Keyboard (<- / ->) Nav|  |  - Scenario B: Slow Speed |   |
|   |  - Active Thread Carousel|  |  - 3-Way Comparative Card|  |  - Scenario C: E-Stop     |   |
|   |  - Dynamic Blast Radius  |  |  - Causal Risk Engine    |  |  - Direct Action Execution|   |
|   |  - Shift OEE Breakdown   |  |  - AI Inspector Panel    |  |  - Real-time Green Reset  |   |
|   +--------------------------+  +--------------------------+  +---------------------------+   |
+-----------------------------------------------------------------------------------------------+
```

---

## Key Features Breakdown

### 1. 30-Station Assembly Line Digital Twin
- High-fidelity physical simulation covering the complete manufacturing workflow from **Body Framing & Stamping** (S01–S10), **Paint & Curing** (S11–S20), through **Final Fastening & QC** (S21–S30).
- Models physical degradation curves:
  - **Tool Wear Drift**: Non-stationary degradation on torque/press stations (`S01, S07, S14, S26`).
  - **Thermal Excursions**: Transient exotherms on curing ovens (`S09, S11, S17, S18`) lasting 4–8 ticks.
  - **Micro-Stoppages**: Pneumatic delays causing temporary cycle-time spikes.
  - **Sensorless Blind Stations**: Dynamically interpolated via adjacent station geometric and cycle-time weighting (`is_inferred = 1`).

### 2. Supervised ML Downstream Defect Risk Prediction
- **Trained Pipeline**: Built with `StandardScaler` and `RandomForestClassifier` with balanced class weighting, trained on 1,000 historical synthetic vehicle production runs.
- **Multi-Station Feature Vectors**: Evaluates rolling sensor metrics ($\Delta$ Cycle Time, $\Delta$ Torque, $\Delta$ Temperature, $\Delta$ Vibration, upstream cumulative wear index, thermal accumulation, and material variance).
- **Validation Metrics**:
  - **ROC-AUC**: `0.9907`
  - **F1-Score**: `0.9739`
  - **Test Recall**: `1.0000` (100% downstream defect capture rate)
  - **Top Attribution Driver**: `delta_torque_s14` (27.2% global feature importance).
- **Real-Time Integration**: Runs on every active chassis during each simulation tick, replacing static heuristics with true probabilistic inference.

### 3. Dynamic Blast Radius Tracking & Quarantine
- When Station $X$ enters critical breach ($>3\sigma$):
  - The chassis currently inside Station $X$ is tagged **CRITICAL** (Red, 94% Defect Risk).
  - The 3 chassis immediately downstream and 3 upstream are flagged **WARNING** (Amber, 65% Defect Risk) as part of the thermal/mechanical drift window.
  - The **Exposed Blast Radius Containment** panel updates live with exact vehicle IDs (`#4817, #4818...`) caught in the active exposure window.

### 4. Zero-Flicker Station Scrubber with Keyboard Navigation
- **Synchronous Metric Computation**: Station telemetry switches instantly in-memory without unmounting DOM elements or triggering loading flashes.
- **Keyboard Arrow Controls**: Use `← Left Arrow` and `→ Right Arrow` keys to scrub across all 30 stations.
- **3-Way Comparative Analysis**: Displays Car Actual Telemetry vs. Nominal Station Baseline vs. Fleet Neutral Cohort average.
- **Sticky Defect Propagation**: Vehicles carrying uncontained upstream defects maintain an elevated warning banner at downstream stations until resolved.

### 5. Dual-Persona Adaptive Dashboard
- **Floor Supervisor (Tactical)**:
  - Focuses on line velocity (veh/hr), active anomaly count, WIP buffer status, and station-level sensor variances (Torque, Vib, Temp, CT).
  - Highlights physical conveyor chassis and immediate containment queues.
- **Plant Manager (Executive)**:
  - Replaces single-station gauges with the **Macro Plant Health & OEE Panel**.
  - **Shift OEE**: `86.4%` broken down into Availability (91.0%), Operating Performance (96.0%), and First-Pass Yield Quality (98.8%).
  - **Shift Output vs. Target**: Real-time progress (`412 / 480 Chassis`, 85.8% complete).
  - **Scrap Loss Prevented**: Computes financial savings from early defect quarantine (`+$14,200`).
  - **Historical Bottleneck Ranking**: Identifies top line constraints (`STATION_14`, `STATION_09`, `STATION_26`).

### 6. Interactive What-If Decision Simulator
- Evaluates real-time mitigation trade-offs:
  - **Scenario A (Reroute)**: Buffer bypass (-6 veh/hr, 70% containment).
  - **Scenario B (Slow Line Speed)**: Line deceleration (-12 veh/hr, 85% containment).
  - **Scenario C (Emergency E-Stop & Recalibrate)**: Line interlock & tool reset (-28 veh/hr, 100% containment).
- **One-Click Execution**: Clicking "Execute & Resolve" posts to `/api/v1/actions/execute`, resetting target station wear and thermal drift back to baseline ($\Delta=0$). The line transitions from RED to GREEN within 2 ticks.

---

## Tech Stack

| Layer | Technologies | Purpose |
|---|---|---|
| **Frontend** | Next.js 14 (App Router), React 18, TypeScript | High-performance responsive digital twin UI |
| **Styling & UI** | TailwindCSS, Lucide React, Recharts | Glassmorphic dark factory dashboard, animations |
| **Backend API** | FastAPI, Starlette SSE, Uvicorn, Python 3.11+ | Asynchronous REST and Server-Sent Events engine |
| **Machine Learning** | Scikit-Learn, LightGBM, Joblib, NumPy, Pandas | Supervised defect risk classification & feature attribution |
| **Database** | SQLite (WAL Mode), aiosqlite | High-throughput concurrent event persistence |
| **Diagnostics** | Custom Diagnostic RAG Engine | 3-Sigma variance ranking & root-cause synthesis |

---

## Getting Started

### Prerequisites
- **Python**: `3.10` or higher
- **Node.js**: `18.17` or higher
- **npm**: `9.0` or higher

---

### Step 1: Backend Setup & ML Model Training

1. **Navigate to the backend directory and set up a virtual environment**:
   ```bash
   cd /Users/vedant/Desktop/trace-twin/backend
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   pip install scikit-learn joblib
   ```

3. **Generate training data and train the ML predictive model**:
   ```bash
   python ml/generate_training_data.py
   python ml/train_model.py
   ```
   *This synthesizes 1,000 historical runs and outputs the trained model pipeline to `backend/ml/models/defect_risk_model.joblib`.*

4. **Launch the FastAPI backend server**:
   ```bash
   uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   *The API will be available at `http://localhost:8000` with interactive Swagger docs at `http://localhost:8000/docs`.*

---

### Step 2: Frontend Setup & Dashboard Launch

1. **Navigate to the frontend directory**:
   ```bash
   cd /Users/vedant/Desktop/trace-twin/frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the Next.js development server**:
   ```bash
   npx next dev --webpack --port 3000
   ```
   *The dashboard will be live at `http://localhost:3000`.*

---

## Core API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/stream/factory` | Server-Sent Events (SSE) live factory telemetry stream (2.5s/tick) |
| `GET` | `/api/v1/stations` | Retrieves all 30 stations with baselines, sensors, and health statuses |
| `GET` | `/api/v1/vehicles/{id}` | Full digital thread history and sequence events for a specific chassis |
| `GET` | `/api/v1/vehicles/{id}/diagnostics` | ML diagnostic summary, 3-sigma telemetry z-scores, and RAG root cause |
| `POST` | `/api/v1/ml/predict-risk` | Evaluates vehicle telemetry features and returns predicted defect probability |
| `GET` | `/api/v1/ml/metrics` | Model training metrics, ROC-AUC, F1-score, and feature importances |
| `POST` | `/api/v1/actions/execute` | Executes What-If mitigation, resetting target station wear & resolving anomaly |
| `GET` | `/api/v1/anomalies` | Lists currently open and historically resolved line anomalies |
| `GET` | `/api/v1/kpis` | Real-time line velocity, fleet defect risk, and WIP buffer fill metrics |

---

## License

This project is licensed under the Apache-2.0 License.
