#!/usr/bin/env python3
"""
Jackie OS — Router Entrypoint
============================

Run this as a process / Windows service.

Usage:
    python router_entry.py

Or install as a Windows service (NSSM):
    nssm install JackieOSService python.exe C:\path\to\router_entry.py
"""

import uvicorn
from router_final import app  # noqa: E402


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=4000,
        log_level="info",
    )
