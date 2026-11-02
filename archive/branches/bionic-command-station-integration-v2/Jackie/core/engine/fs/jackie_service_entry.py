#!/usr/bin/env python3
"""
Jackie OS — Service Entrypoint
==============================

This script is designed to start the Jackie OS runtime and the Router Gateway
as a persistent Windows service using NSSM.

It wires together:
  - Router (FastAPI via uvicorn) on port 4000
  - JackieOS Runtime Core
"""

import threading
import uvicorn
import os
from router_final import app as router_app
from jackie_os import JackieOS
from tracing import trace


def start_router():
    """Starts the Router Gateway."""
    trace("service_start_router")
    uvicorn.run(router_app, host="127.0.0.1", port=4000, log_level="info")


def start_jackie_os():
    """Initializes and keeps the Jackie OS runtime alive."""
    trace("service_start_jackie_os")
    # Initialize the entire OS runtime with all its components
    os = JackieOS(router_url="http://127.0.0.1:4000")
    
    # Keep the main thread alive indefinitely, allowing the FastAPI app to run in the background
    while True:
        pass  


if __name__ == "__main__":
    trace("service_entry_init")

    # Start the router in a separate thread for cleaner management
    t_router = threading.Thread(target=start_router, daemon=True)
    t_router.start()

    # Run the main OS loop in the primary thread
    start_jackie_os()