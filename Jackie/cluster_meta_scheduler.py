"""Meta‑scheduler — schedules cluster‑wide ops with governance weighting."""


class MetaScheduler:
    """Cluster‑wide scheduling; stability > load, governance > optimization."""

    def __init__(self):
        self.nodes = {}

    def register_node(self, node_id, state):
        self.nodes[node_id] = {"stability": 1.0, "load": 0}

    def schedule(self):
        nodes = list(self.nodes.items())
        return sorted(nodes, key=lambda n: (n[1]["stability"], n[1]["load"]))


meta_scheduler = MetaScheduler()