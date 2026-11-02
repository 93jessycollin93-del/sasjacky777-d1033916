"""
Jackie App — Wayland Integration (handles Wayland protocol interactions)
"""

import json


class WaylandIntegration:
    def __init__(self):
        self.surface = None
        self.output = None

    def create_surface(self, app_id):
        return {"surface": f"wl_surface_{app_id}"}

    def set_output(self, output_name):
        return {"output": output_name}


if __name__ == "__main__":
    wayland = WaylandIntegration()
