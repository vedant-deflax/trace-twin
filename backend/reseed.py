from backend.db.init_db import init_db
from backend.db.connection import get_sync_connection
from backend.simulator.factory import FactorySimulator
from backend.engine.pipeline import run_full_pipeline

print("Initializing DB...")
init_db()

print("Generating spaced-out batch...")
conn = get_sync_connection()
sim = FactorySimulator(conn, start_vehicle_id=4810, num_vehicles=30)
stats = sim.generate_batch()
print("Batch stats:", stats)

print("Running pipeline to detect anomalies...")
pipeline_stats = run_full_pipeline(conn)
print("Pipeline stats:", pipeline_stats)
conn.close()
print("Done.")
