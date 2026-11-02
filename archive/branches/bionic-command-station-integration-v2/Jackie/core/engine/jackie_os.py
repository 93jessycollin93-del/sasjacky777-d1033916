"""
Jackie OS — Unified Runtime Bootstrap
=====================================

This is the single entry point for the entire Jackie OS system.
It wires together:
  - AgentRegistry
  - PodBackpackManager
  - RouterClient
  - Orchestration
  - Tracing
  - (Optional) State Viewer

Usage:
    from jackie_os import JackieOS
    
    os = JackieOS(router_url="http://127.0.0.1:4000")
    
    # Single task
    result = os.run("Analysis", "Explain vector embeddings.")
    
    # Multi-task with dependencies
    graph = os.build_graph()
    graph.add_task(TaskNode(id="plan", agent="Analysis", content="Plan this out."))
    graph.add_task(TaskNode(id="code", agent="Code", content="Implement it.", depends_on=["plan"]))
    results = os.run_graph()
    
    # Introspect live state
    snapshot = os.snapshot()
"""

from agent_registry import AgentRegistry
from pod_backpack_manager import PodBackpackManager
from jackie_router_client import JackieRouterClient
from jackie_orchestrator import JackieOrchestrator, FSTaskResult
from execution_graph import ExecutionGraph, TaskNode
from tracing import setup_logging, trace


class JackieOS:
    """
    Unified Jackie OS runtime.

    Orchestrates agents, pods, backpacks, routing, and multi-agent execution.
    This is the single entry point for your sovereign AI system.
    """

    def __init__(self, router_url: str = "http://127.0.0.1:4000"):
        # Core components
        self.registry = AgentRegistry()
        self.pbm = PodBackpackManager()
        self.router = JackieRouterClient(router_url=router_url)
        self.orchestrator = JackieOrchestrator(router_url=router_url)

        # Execution graph (optional, per-run)
        self.graph: ExecutionGraph | None = None

        # Setup tracing
        setup_logging()
        trace("jackie_os_init", router_url=router_url)

    # ──────────────────────────────── Single-task execution
    # ────────────────────────────────

    def run(self, agent_name: str, content: str) -> FSTaskResult:
        """Execute a single task through the appropriate agent."""
        if not self.registry.get(agent_name):
            return FSTaskResult(
                id=f"unknown-{agent_name}",
                success=False,
                message=f"Unknown agent: {agent_name}",
            )

        result = self.orchestrator.run_task(agent_name, content)
        trace("task_executed", agent=agent_name, pod=result["pod"], backpack=result["backpack"])
        
        return FSTaskResult(
            id=f"{agent_name}-{int(time.time())}",
            success="success" in str(result),
            message="completed" if "error" not in result else str(result.get("error", "")),
            details=result,
        )

    # ──────────────────────────────── Multi-task execution graph
    # ────────────────────────────────

    def build_graph(self) -> ExecutionGraph:
        """Create a new execution graph."""
        self.graph = ExecutionGraph(self.orchestrator)
        return self.graph

    def run_graph(self) -> Dict[str, FSTaskResult]:
        """Execute the current task graph (with dependency resolution)."""
        if not self.graph:
            raise RuntimeError("No graph defined — call build_graph() first")
        
        trace("graph_start", task_count=len(self.graph.tasks))
        results = self.graph.run()
        trace("graph_complete", completed=len(results))
        return results

    # ──────────────────────────────── Introspection
    # ────────────────────────────────

    def snapshot(self) -> Dict[str, Any]:
        """Get a snapshot of the entire system state."""
        return {
            "agents": [vars(a) for a in self.registry.list_agents()],
            "pods": {name: vars(cfg) for name, cfg in self.pbm.pods.items()},
            "backpacks": {name: vars(cfg) for name, cfg in self.pbm.backpacks.items()},
        }

    # ──────────────────────────────── Convenience wrappers
    # ────────────────────────────────

    def agent(self, name: str):
        """Get an agent config by name."""
        return self.registry.get(name)

    def pod(self, name: str):
        """Get a pod config by name."""
        return self.pbm.get_pod(name)

    def backpack(self, name: str):
        """Get a backpack config by name."""
        return self.pbm.get_backpack(name)
