"""Constellation identity — unified cluster identity."""


class ConstellationIdentity:
    """Defines the identity of the entire constellation."""

    def __init__(self):
        self.constellation = "sovereign"
        self.nodes = []

    def identity(self, nodes):
        self.nodes.extend(nodes)
        return {
            "constellation": self.constellation,
            "nodes": list(set(self.nodes))
        }


identity = ConstellationIdentity()