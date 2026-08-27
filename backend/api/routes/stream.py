import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from backend.simulator.streamer import GLOBAL_STATE

router = APIRouter(prefix="/stream", tags=["stream"])

async def event_generator():
    # Initial state push
    yield f"data: {json.dumps(GLOBAL_STATE)}\n\n"
    
    while True:
        await asyncio.sleep(2.5)
        yield f"data: {json.dumps(GLOBAL_STATE)}\n\n"

@router.get("/factory")
async def stream_factory():
    """SSE endpoint for live factory state."""
    return StreamingResponse(event_generator(), media_type="text/event-stream")
