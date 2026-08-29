"""SQLite connection manager for TRACE-TWIN.

Provides sync connections (for simulator/engine scripts) and async
connections (for FastAPI request handlers).
"""

import sqlite3
from pathlib import Path

import aiosqlite

DB_PATH = Path(__file__).parent.parent / "trace_twin.db"


def get_sync_connection() -> sqlite3.Connection:
    """Return a synchronous SQLite connection with WAL mode, busy timeout, and FK enforcement."""
    conn = sqlite3.connect(str(DB_PATH), timeout=60.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=60000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


async def get_async_connection() -> aiosqlite.Connection:
    """Return an asynchronous SQLite connection with WAL mode, busy timeout, and FK enforcement."""
    conn = await aiosqlite.connect(str(DB_PATH), timeout=60.0)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA busy_timeout=60000")
    await conn.execute("PRAGMA foreign_keys=ON")
    return conn

