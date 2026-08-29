import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from backend.simulator.streamer import GLOBAL_STATE

router = APIRouter(prefix="/stream", tags=["stream"])


async def event_generator():
    while True:
        try:
            payload = json.dumps(GLOBAL_STATE, default=str)
            yield f"data: {payload}\n\n"
        except Exception as e:
            print(f"SSE serialization error: {e}")
            yield f"data: {{}}\n\n"
        await asyncio.sleep(2.5)


@router.get("/factory")
async def stream_factory():
    """SSE endpoint for live factory state with resilient keep-alive."""
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
