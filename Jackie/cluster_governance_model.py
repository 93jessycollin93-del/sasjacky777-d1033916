"""Sovereign cluster governance — global safety boundaries."""


class ClusterGovernanceModel:
    """Cluster‑wide safety + policy layer; no dangerous ops without approval."""

    def __init__(self):
        self.allowed_actions = set()

    def allow(self, action):
        return action in self.allowed_actions or action not in [
            "unsafe_global_migration",
            "global_shutdown"
        ]

    def register_action(self, action):
        if action not in self.allowed_actions:
            self.allowed_actions.add(action)


governance = ClusterGovernanceModel()