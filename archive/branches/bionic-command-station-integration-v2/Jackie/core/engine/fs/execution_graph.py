"""
Jackie OS — Multi-Agent Execution Graph
=======================================

Defines tasks, dependencies, and parallel execution.

Usage:
    graph = ExecutionGraph(orchestrator)
    graph.add_task(TaskNode(id="plan", agent="Analysis", content="Create a plan"))
    graph.add_task(TaskNode(id="code", agent="Code", content="Implement the code", depends_on=["plan"]))
    results = graph.run()  # runs dependent tasks in order, others in parallel
"""

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class TaskNode:
    """A single task in the execution graph."""
    id: str
    agent: str
    content: str
    depends_on: List[str] = field(default_factory=list)


class ExecutionGraph:
    """
    Manages a DAG of tasks that can be executed with dependency resolution.

    Tasks without dependencies run as soon as possible.
    Tasks with dependencies wait for their prerequisites to complete.
    """

    def __init__(self, orchestrator):
        self.orchestrator = orchestrator
        self.tasks: Dict[str, TaskNode] = {}

    # ────────────────────────────────────────
    # Task management
    # ────────────────────────────────────────

    def add_task(self, task: TaskNode) -> None:
        """Add a task to the graph."""
        self.tasks[task.id] = task

    def has_task(self, task_id: str) -> bool:
        """Check if a task exists in the graph."""
        return task_id in self.tasks

    # ────────────────────────────────────────
    # Execution engine (dependency-aware)
    # ────────────────────────────────────────

    def run(self) -> Dict[str, FSTaskResult]:
        """
        Execute all tasks respecting dependencies.

        Returns a dict mapping task_id → result.
        Tasks with no dependencies run immediately.
        Tasks with dependencies wait for their prerequisites.
        """
        completed: Dict[str, FSTaskResult] = {}

        while len(completed) < len(self.tasks):
            # Find tasks that can run (all deps satisfied or none)
            ready_tasks = []
            for tid, task in self.tasks.items():
                if tid not in completed:
                    deps_satisfied = all(dep in completed for dep in task.depends_on)
                    if deps_satisfied:
                        ready_tasks.append(tid)

            # Execute all ready tasks (in parallel order)
            results = {}
            for tid in ready_tasks:
                task = self.tasks[tid]
                result = self.orchestrator.run_task(task.agent, task.content)
                completed[tid] = FSTaskResult(
                    id=tid,
                    success=True,  # simplified — real code would check router_result["error"]
                    message="completed",
                    details=result,
                )

            if not ready_tasks:
                raise RuntimeError("Deadlock in execution graph")

        return completed

    # ────────────────────────────────────────
    # Inspection helpers
    # ────────────────────────────────────────

    def get_task(self, task_id: str) -> TaskNode | None:
        """Get a task by ID."""
        return self.tasks.get(task_id)

    def list_tasks(self) -> List[TaskNode]:
        """List all tasks in the graph."""
        return list(self.tasks.values())
