"""TRACE-TWIN FastAPI Application.

Run with:
    uvicorn backend.api.main:app --reload --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import stations, vehicles, anomalies, simulate, kpis, stream, actions, ml
from backend.simulator.streamer import streamer
from backend.engine.inference import load_model_artifact
import asyncio

app = FastAPI(
    title="TRACE-TWIN API",
    description="Causal, Context-Aware Risk Intelligence for Vehicle Assembly Lines",
    version="1.0.0",
)

# CORS — allow all origins for hackathon
# CORS — restrict to known frontend origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://your-production-frontend.example.com",  # replace with real deployed URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    # Warm up ML pipeline
    try:
        art = load_model_artifact()
        print(f"ML Model Pipeline loaded at startup. Test ROC-AUC: {art.get('metrics', {}).get('roc_auc')}")
    except Exception as e:
        print(f"Warning: Could not preload ML model: {e}")

    asyncio.create_task(streamer.start())

# Mount routers
app.include_router(stations.router, prefix="/api/v1")
app.include_router(vehicles.router, prefix="/api/v1")
app.include_router(anomalies.router, prefix="/api/v1")
app.include_router(simulate.router, prefix="/api/v1")
app.include_router(kpis.router, prefix="/api/v1")
app.include_router(stream.router, prefix="/api/v1")
app.include_router(actions.router, prefix="/api/v1")
app.include_router(ml.router, prefix="/api/v1")



@app.get("/")
async def root():
    return {
        "status": "ok",
        "name": "TRACE-TWIN API",
        "version": "1.0.0",
        "docs": "/docs",
    }
