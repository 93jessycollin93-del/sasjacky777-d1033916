"""
Jackie OS — Centralized Logging & Tracing
=========================================

All loggers, event emitters, and tracing utilities for the Jackie OS system.
Every agent, pod, backpack, and router call is traced through this layer.
"""

import logging
import time
from typing import Any, Dict, List


# ────────────────────────────────
# Central Logger Configuration
# ────────────────────────────────

logger = logging.getLogger("jackie-os")

def setup_logging(level: int = logging.INFO) -> None:
    """Configure the root logger for Jackie OS."""
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(level)


# ──────────────────────────────── Event Tracing
# ────────────────────────────────

def trace(event: str, **kwargs) -> Dict[str, Any]:
    """Emit a trace event with optional metadata."""
    payload = {
        "ts": time.time(),
        "event": event,
        **kwargs,
    }
    logger.info(payload)
    return payload


def warn(event: str, **kwargs) -> Dict[str, Any]:
    """Emit a warning trace event."""
    payload = {"ts": time.time(), "event": f"⚠️ {event}", **kwargs}
    logger.warning(payload)
    return payload


# ──────────────────────────────── Task Tracking
# ────────────────────────────────

@dataclass
class TaskTrace:
    """Track the lifecycle of a single task."""
    task_id: str
    start_time: float
    agent: str = ""
    pod: str = ""
    backpack: str = ""
    status: str = "pending"  # pending, running, success, error
    duration_ms: float = 0.0
    details: Dict[str, Any] = None

    def on_complete(self, success: bool):
        """Mark task as complete."""
        self.status = "success" if success else "error"
        self.duration_ms = (time.time() - self.start_time) * 1000


# ──────────────────────────────── Summary / Dashboard Helper
# ────────────────────────────────

def get_recent_traces(n: int = 20) -> List[Dict[str, Any]]:
    """Get the last N trace events (requires a centralized log storage)."""
    # In production, this would query a time-series database or file.
    # For now, return an empty list as a placeholder.
    logger.info(f"get_recent_traces(n={n}) — not yet implemented")
    return []
