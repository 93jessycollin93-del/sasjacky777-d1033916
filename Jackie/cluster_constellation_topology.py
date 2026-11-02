"""Constellation topology — global topology definition."""


class ConstellationTopology:
    """Defines the global topology of the constellation."""

    def __init__(self):
        self.topology = "sovereign-constellation"
        self.nodes = []

    def map(self, nodes):
        self.nodes.extend(nodes)
        return {
            "topology": self.topology,
            "nodes": list(set(self.nodes))
        }


topology = ConstellationTopology()