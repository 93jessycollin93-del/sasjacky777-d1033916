"""
Jackie OS — Orchestrator Layer
============================

Orchestrates multi-agent task routing with:
- Pod/backpack-aware model selection
- Error recovery / fallback agents
- Retry policies
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from agent_registry import AgentRegistry
from pod_backpack_manager import PodBackpackManager
from jackie_router_client import JackieRouterClient


@dataclass
class FSTask:
    """A single task that needs to be executed."""
    id: str
    type: str  # e.g. "mirror", "diff", "scan"
    source: Optional[str] = None
    dest: Optional[str] = None
    manifest: Optional[str] = None
    options: Optional[Dict] = None
    args: Optional[List[str]] = None
    description: Optional[str] = None


@dataclass
class FSTaskResult:
    """The result of a task execution."""
    id: str
    success: bool
    message: str
    details: Optional[Dict] = None


class JackieOrchestrator:
    """
    Orchestrates tasks across agents with pod/backpack awareness.

    This is the core dispatch layer that connects:
    - Task definition → Agent selection → Router call → Result collection
    """

    def __init__(self, router_url: str = "http://127.0.0.1:4000"):
        self.registry = AgentRegistry()
        self.pbm = PodBackpackManager()
        self.router = JackieRouterClient(router_url=router_url)

    # ────────────────────────────────────────
    # Single-task execution with recovery
    # ────────────────────────────────────────

    def run_task(self, agent_name: str, content: str) -> Dict[str, Any]:
        """Run a single task using the appropriate agent."""
        agent = self.registry.get(agent_name)
        if not agent:
            return {"error": f"Unknown agent: {agent_name}"}

        memory_partition = self.pbm.resolve_memory_partition(agent.backpack)

        result = self.router.send(
            task=agent.role,
            content=content,
            pod=agent.pod,
            backpack=agent.backpack,
            model=agent.default_model,
            agent=agent.name,
            memory_partition=memory_partition,
        )

        return {
            "agent": agent.name,
            "pod": agent.pod,
            "backpack": agent.backpack,
            "memory_partition": memory_partition,
            "router_result": result,
        }

    # ────────────────────────────────────────
    # Recovery: fallback agents on error
    # ────────────────────────────────────────

    def run_task_with_recovery(self, agent_name: str, content: str) -> Dict[str, Any]:
        """Run a task with automatic fallback to alternative agents."""
        primary = self.registry.get(agent_name)
        if not primary:
            return {"error": f"Unknown agent: {agent_name}"}

        # Fallback map (configurable per repo)
        fallback_map = {
            "Analysis": "Memory",
            "Code": "Analysis",
            "GPUExpert": "Analysis",
        }

        result = self.run_task(agent_name, content)

        if result["router_result"].get("error"):
            fb_name = fallback_map.get(agent_name)
            if not fb_name:
                return result

            # Retry with fallback agent
            fb_agent = self.registry.get(fb_name)
            if not fb_agent:
                return result

            result[agent_name] = {
                "status": "fallback",
                "from": agent_name,
                "to": fb_name,
                "error": result["router_result"]["error"],
                "result": self.run_task(fb_name, content),
            }

        return result

    # ────────────────────────────────────────
    # Batch task execution
    # ────────────────────────────────────────

    def run_tasks(self, tasks: List[Dict]) -> List[FSTaskResult]:
        """
        Run multiple tasks with optional dependency resolution.

        params:
            tasks: list of dicts like {
                "agent": "Analysis",
                "content": "...",
                "depends_on": ["previous_task_id"],  # optional
            }
        """
        completed = {}
        results = []

        for task in tasks:
            agent_name = task["agent"]
            content = task.get("content")
            depends_on = set(task.get("depends_on", []))

            # Wait for dependencies to complete
            for dep_id in depends_on:
                if dep_id not in completed:
                    raise RuntimeError(
                        f"Task {task['id']} depends on incomplete task: {dep_id}"
                    )

            result = self.run_task(agent_name, content)
            completed[task["id"]] = result
            results.append(result)

        return results


# ──────────────────────────────── Convenience Factory
# ────────────────────────────────

def create_orchestrator(router_url: str = "http://127.0.0.1:4000"):
    """Factory function to create a configured orchestrator."""
    return JackieOrchestrator(router_url=router_url)
