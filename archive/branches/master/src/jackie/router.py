"""
Jackie Core — Router (handles requests and routes them appropriately)
"""

import json, time


class Router:
    def __init__(self):
        self.routes = {}

    def register(self, path, handler):
        self.routes[path] = handler

    async def handle(self, request):
        method = request.get("method", "GET")
        path = request.get("path", "/")
        body = request.get("body") or ""
        headers = request.get("headers") or {}

        if path in self.routes:
            handler = self.routes[path]
            result = await handler(method, body, headers)
            return {
                "status": 200,
                "result": result,
                "path": path,
                "method": method
            }

        # Default fallback
        return {
            "status": 404,
            "result": {"error": f"Route not found: {path}"},
            "path": path,
            "method": method
        }


async def router_handler(method, body, headers):
    """Default handler for unknown routes."""
    return {"message": f"{method} request to unknown route"}


if __name__ == "__main__":
    router = Router()
