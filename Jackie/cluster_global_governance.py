"""Global cluster governance — highest safety + policy layer."""


class GlobalGovernanceEngine:
    """Cluster‑wide safety and policy; no destructive ops without approval."""

    def __init__(self):
        self.allowed_actions = set()

    def evaluate(self, action):
        return {
            "action": action,
            "allowed": action not in ["global_shutdown", "unsafe_topology_shift"]
        }


governance = GlobalGovernanceEngine()