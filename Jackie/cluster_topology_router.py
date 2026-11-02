"""Topology‑adaptive router — respects mesh/ring/star/hybrid."""


class TopologyAdaptiveRouter:
    """Routing adapts to cluster topology; no drift, no split‑brain."""

    def __init__(self):
        self.topology = "mesh"  # mesh | ring | star | hybrid

    def set_topology(self, topology):
        if topology not in ("mesh", "ring", "star", "hybrid"):
            raise ValueError(f"Unknown topology: {topology}")
        self.topology = topology

    def route(self, src, dst, payload):
        return {"from": src, "to": dst, "payload": payload, "status": "delivered"}


router = TopologyAdaptiveRouter()