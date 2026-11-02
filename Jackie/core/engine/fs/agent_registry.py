"""
Jackie OS — Agent Registry
==========================

Declarative registration of all agents, their pods, backpacks, and roles.
This is the source of truth for your sovereign multi-agent system.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class AgentConfig:
    """Configuration for a single agent."""
    name: str
    role: str
    pod: str
    backpack: str
    default_model: str = "auto"
    description: str = ""


class AgentRegistry:
    """Central registry of all agents in the Jackie OS system."""

    def __init__(self):
        self.agents: Dict[str, AgentConfig] = {}
        self._register_defaults()

    # ────────────────────────────────────────
    # Default agents (can be overridden)
    # ────────────────────────────────────────

    def _register_defaults(self) -> None:
        """Register the core set of agents."""
        self.register(AgentConfig(
            name="Jackie",
            role="orchestrator",
            pod="planning",
            backpack="long_context",
            default_model="auto",
            description="Core runtime, planner, coordinator."
        ))

        self.register(AgentConfig(
            name="Analysis",
            role="deep_reasoning",
            pod="analysis",
            backpack="reasoning",
            default_model="auto",
            description="Heavy reasoning, long-context analysis."
        ))

        self.register(AgentConfig(
            name="Code",
            role="code_generation",
            pod="code",
            backpack="python",
            default_model="auto",
            description="Code generation, debugging, architecture."
        ))

        self.register(AgentConfig(
            name="Memory",
            role="summarization",
            pod="memory",
            backpack="summaries",
            default_model="auto",
            description="Summaries, compression, memory management."
        ))

        self.register(AgentConfig(
            name="Execution",
            role="quick_action",
            pod="execution",
            backpack="commands",
            default_model="auto",
            description="Fast tasks, short responses, commands."
        ))

        self.register(AgentConfig(
            name="GPUExpert",
            role="hardware_analysis",
            pod="gpu",
            backpack="hardware",
            default_model="auto",
            description="Hardware analysis, routing optimization."
        ))

    # ────────────────────────────────────────
    # Registration API
    # ────────────────────────────────────────

    def register(self, config: AgentConfig) -> None:
        """Register a new agent."""
        self.agents[config.name] = config

    def get(self, name: str) -> Optional[AgentConfig]:
        """Retrieve an agent by name."""
        return self.agents.get(name)

    def list_agents(self) -> List[AgentConfig]:
        """List all registered agents."""
        return list(self.agents.values())
