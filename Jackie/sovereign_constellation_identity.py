"""Sovereign constellation identity — unified OS identity."""


class SovereignConstellationIdentity:
    """Defines the identity of the entire sovereign constellation OS."""

    def __init__(self):
        self.constellation = "sovereign"
        self.nodes = []

    def identity(self, nodes):
        self.nodes.extend(nodes)
        return {
            "constellation": self.constellation,
            "nodes": list(set(self.nodes))
        }


identity = SovereignConstellationIdentity()