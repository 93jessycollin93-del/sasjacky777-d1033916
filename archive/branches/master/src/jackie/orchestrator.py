"""
Jackie Core — Agent Orchestration (manages agents, their states, and task execution)
"""

import json, time


class Agent:
    def __init__(self, name, role):
        self.name = name
        self.role = role
        self.state = "idle"
        self.tasks_completed = 0

    def execute(self, task):
        self.state = "running"
        result = {"status": "success", "output": f"{self.role} executed: {task}"}
        self.tasks_completed += 1
        return result


class Orchestrator:
    def __init__(self):
        self.agents = {}

    def register(self, agent):
        self.agents[agent.name] = agent

    async def dispatch(self, task):
        # Simple round-robin selection
        for name in list(self.agents.keys()):
            agent = self.agents[name]
            if agent.state == "idle":
                result = await agent.execute(task)
                return {
                    "task": task,
                    "agent": name,
                    "result": result,
                    "status": 200
                }

        # No idle agents — return error
        return {"error": "All agents busy", "status": 503}


if __name__ == "__main__":
    orchestrator = Orchestrator()
