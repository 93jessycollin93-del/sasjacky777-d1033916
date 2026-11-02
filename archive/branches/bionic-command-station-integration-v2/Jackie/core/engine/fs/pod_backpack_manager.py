"""
Jackie OS — Pod / Backpack Manager
==================================

Manages execution partitions (pods) and memory partitions (backpacks).

Pods define where work happens (execution context).
Backpacks define what knowledge is available (memory partition).
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class PodConfig:
    """Configuration for a pod (execution partition)."""
    name: str
    description: str = ""
    preferred_models: List[str] = field(default_factory=list)
    hardware_hint: Optional[str] = None  # "gpu", "cpu", "npu", or None


@dataclass
class BackpackConfig:
    """Configuration for a backpack (memory partition)."""
    name: str
    description: str = ""
    memory_partition: Optional[str] = None  # e.g. "analysis-01"


class PodBackpackManager:
    """Manages pods and backpacks for the Jackie OS system."""

    def __init__(self):
        self.pods: Dict[str, PodConfig] = {}
        self.backpacks: Dict[str, BackpackConfig] = {}
        self._register_defaults()

    # ────────────────────────────────────────
    # Default pods
    # ────────────────────────────────────────

    def _register_pods(self) -> None:
        """Register all execution partitions."""
        self.register_pod(PodConfig(
            name="analysis",
            description="Deep reasoning, long-context analysis.",
            preferred_models=["gemma4:26b", "qwen3.5:latest"],
            hardware_hint="gpu",
        ))

        self.register_pod(PodConfig(
            name="code",
            description="Code generation, debugging, architecture.",
            preferred_models=["gemma4:26b"],
            hardware_hint="gpu",
        ))

        self.register_pod(PodConfig(
            name="memory",
            description="Summaries, compression, memory operations.",
            preferred_models=["qwen3.5:latest"],
            hardware_hint="cpu",
        ))

        self.register_pod(PodConfig(
            name="execution",
            description="Fast tasks, short responses, commands.",
            preferred_models=["qwen3.5:latest"],
            hardware_hint="gpu",
        ))

        self.register_pod(PodConfig(
            name="gpu",
            description="Hardware analysis, routing optimization.",
            preferred_models=["qwen3.5:latest"],
            hardware_hint="gpu",
        ))

        self.register_pod(PodConfig(
            name="planning",
            description="High-level planning, orchestration.",
            preferred_models=["qwen3.5:latest", "gemma4:26b"],
            hardware_hint="gpu",
        ))

        self.register_pod(PodConfig(
            name="general",
            description="Default pod for uncategorized tasks.",
            preferred_models=["qwen3.5:latest"],
            hardware_hint=None,
        ))

    # ────────────────────────────────────────
    # Default backpacks
    # ────────────────────────────────────────

    def _register_backpacks(self) -> None:
        """Register all memory partitions."""
        self.register_backpack(BackpackConfig(
            name="general",
            description="General knowledge and context.",
            memory_partition="general-01",
        ))

        self.register_backpack(BackpackConfig(
            name="reasoning",
            description="Deep reasoning traces, long-form analysis.",
            memory_partition="analysis-01",
        ))

        self.register_backpack(BackpackConfig(
            name="python",
            description="Code snippets, patterns, libraries.",
            memory_partition="code-01",
        ))

        self.register_backpack(BackpackConfig(
            name="summaries",
            description="Compressed summaries of past tasks.",
            memory_partition="memory-01",
        ))

        self.register_backpack(BackpackConfig(
            name="hardware",
            description="GPU/NPU/CPU state, routing decisions.",
            memory_partition="hardware-01",
        ))

        self.register_backpack(BackpackConfig(
            name="long_context",
            description="Long-term plans, multi-step strategies.",
            memory_partition="planning-01",
        ))

        self.register_backpack(BackpackConfig(
            name="commands",
            description="Shell/PowerShell/CLI commands.",
            memory_partition="execution-01",
        ))

    # ────────────────────────────────────────
    # Registration API
    # ────────────────────────────────────────

    def register_pod(self, config: PodConfig) -> None:
        """Register a new pod."""
        self.pods[config.name] = config

    def register_backpack(self, config: BackpackConfig) -> None:
        """Register a new backpack."""
        self.backpacks[config.name] = config

    # ────────────────────────────────────────
    # Lookup helpers
    # ────────────────────────────────────────

    def get_pod(self, name: str) -> Optional[PodConfig]:
        """Get a pod by name."""
        return self.pods.get(name)

    def get_backpack(self, name: str) -> Optional[BackpackConfig]:
        """Get a backpack by name."""
        return self.backpacks.get(name)

    def preferred_models_for_pod(self, pod_name: str) -> List[str]:
        """Get the list of preferred models for a pod."""
        pod = self.get_pod(pod_name)
        return pod.preferred_models if pod else []

    def hardware_hint_for_pod(self, pod_name: str) -> Optional[str]:
        """Get the hardware hint for a pod."""
        pod = self.get_pod(pod_name)
        return pod.hardware_hint if pod else None

    def resolve_memory_partition(self, backpack_name: str) -> Optional[str]:
        """Resolve a memory partition key from a backpack name."""
        bp = self.get_backpack(backpack_name)
        return bp.memory_partition if bp else None

    # ────────────────────────────────────────
    # Discovery helpers
    # ────────────────────────────────────────

    def list_pods(self) -> List[PodConfig]:
        """List all registered pods."""
        return list(self.pods.values())

    def list_backpacks(self) -> List[BackpackConfig]:
        """List all registered backpacks."""
        return list(self.backpacks.values())


# ──────────────────────────────── Singleton (optional convenience)
# ────────────────────────────────

_default_pbm: Optional[PodBackpackManager] = None

def get_pod_backpack_manager() -> PodBackpackManager:
    """Get the default pod/backpack manager singleton."""
    global _default_pbm
    if _default_pbm is None:
        _default_pbm = PodBackpackManager()
    return _default_pbm
