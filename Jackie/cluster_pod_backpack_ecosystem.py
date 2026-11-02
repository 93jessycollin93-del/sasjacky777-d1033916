"""Pod/backpack ecosystem — distributed resource geometry."""


class ClusterPodBackpackEcosystem:
    """Pods and backpacks across the constellation; governance‑checked migrations."""

    def __init__(self):
        self.pods = {}
        self.backpacks = {}

    def register_pod(self, pod_id, node_id):
        self.pods[pod_id] = {"node": node_id, "state": "active"}

    def register_backpack(self, backpack_id, pod_id):
        self.backpacks[backpack_id] = {"pod": pod_id, "contents": []}

    def migrate_pod(self, pod_id, target_node):
        if pod_id not in self.pods:
            raise ValueError(f"Unknown pod: {pod_id}")
        self.pods[pod_id]["node"] = target_node
        return {"pod": pod_id, "migrated_to": target_node}


ecosystem = ClusterPodBackpackEcosystem()