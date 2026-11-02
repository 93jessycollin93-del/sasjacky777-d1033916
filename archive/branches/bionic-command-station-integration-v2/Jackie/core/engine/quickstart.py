#!/usr/bin/env python3
"""
Jackie OS — Quick Start Demo
============================

This script demonstrates how to use the JackieOS runtime.

Run:
    1. Start Ollama (if not already running)
       ollama serve

    2. Pull models you want to use
       ollama pull qwen3.5:latest
       ollama pull gemma4:26b

    3. Run this script
       python quickstart.py

    4. Or start the state viewer on port 8001
       python jackie_os.py --viewer

Authorizations:
    - This is a demo — it makes real API calls to Ollama.
    - Make sure your router (router_entry.py) is running on port 4000.
"""

import sys
import json
from jackie_os import JackieOS


def main():
    print("=" * 60)
    print("Jackie OS — Quick Start Demo")
    print("=" * 60)

    # Initialize the runtime (router on port 4000)
    os = JackieOS(router_url="http://127.0.0.1:4000")

    # ────────────────────────────────────────
    # 1. Single-task execution
    # ────────────────────────────────────────
    print("\n📋 Single-Task Execution")
    print("-" * 40)
    
    result = os.run(
        agent_name="Analysis",
        content="Explain how transformers work in simple terms."
    )
    
    if "error" not in result.details:
        response = result.details["router_result"].get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"\n🤖 Response:\n{response}")

    # ────────────────────────────────────────
    # 2. Multi-task execution graph
    # ────────────────────────────────────────
    print("\n📋 Multi-Agent Execution Graph")
    print("-" * 40)
    
    graph = os.build_graph()
    graph.add_task(TaskNode(
        id="plan",
        agent="Analysis",
        content="Plan a 3-step process for improving router performance."
    ))
    graph.add_task(TaskNode(
        id="code",
        agent="Code",
        content="Write a Python function that measures GPU memory usage.",
        depends_on=["plan"]
    ))
    graph.add_task(TaskNode(
        id="review",
        agent="Analysis",
        content="Review the generated code and suggest improvements."
    ))

    results = os.run_graph()
    
    for tid, res in results.items():
        print(f"\n📌 Task {tid}:")
        if "error" not in res.details:
            response = res.details["router_result"].get("choices", [{}])[0].get("message", {}).get("content", "")[:200] + ("..." if len(response) > 200 else "")
            print(f"   → {response}")

    # ────────────────────────────────────────
    # 3. System snapshot
    # ────────────────────────────────────────
    print("\n📋 System Snapshot")
    print("-" * 40)
    
    snapshot = os.snapshot()
    print(json.dumps(snapshot, indent=2))

    print("\n✅ Quick start complete!")


if __name__ == "__main__":
    try:
        from execution_graph import TaskNode
    except ImportError as e:
        print(f"Error: {e}")
        sys.exit(1)
    
    main()
