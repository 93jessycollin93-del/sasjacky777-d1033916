"""Distributed glyph OS runtime — cluster‑wide execution."""


class DistributedGlyphOS:
    """Glyph programs run on any node; routing is deterministic."""

    def __init__(self):
        self.nodes = {}

    def register_node(self, node_id):
        self.nodes[node_id] = {"glyphs": [], "status": "idle"}

    def dispatch(self, node, glyph):
        if node not in self.nodes:
            raise ValueError(f"Unknown node: {node}")
        self.nodes[node]["glyphs"].append(glyph)
        return {"node": node, "glyph": glyph, "status": "executed"}


distributed_glyph_os = DistributedGlyphOS()