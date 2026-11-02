"""Sovereign safety envelope — highest safety boundary."""


class SovereignSafetyEnvelope:
    """Highest safety boundary for constellation operations."""

    def __init__(self):
        self.allowed_actions = set()

    def check(self, action):
        return {
            "action": action,
            "allowed": action not in ["constellation_shutdown", "unsafe_constellation_shift"]
        }


safety_envelope = SovereignSafetyEnvelope()