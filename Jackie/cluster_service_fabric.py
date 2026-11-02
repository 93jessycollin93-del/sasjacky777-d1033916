"""Cluster service fabric — global RPC layer."""


class ClusterServiceFabric:
    """Global service fabric for cluster‑wide RPC."""

    def __init__(self):
        self.services = {}

    def register(self, name, func):
        self.services[name] = func
        return {"service": name, "status": "registered"}

    def call(self, name, *args, **kwargs):
        if name not in self.services:
            raise ValueError(f"Unknown service: {name}")
        return self.services[name](*args, **kwargs)


fabric = ClusterServiceFabric()