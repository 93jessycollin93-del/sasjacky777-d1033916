# Jackie Core — Brain Implementation

This is Jackie's brain: router, agent orchestration, memory, personality modules, and terminal assignment logic.

## Components

- `src/jackie/router.py` – Handles incoming requests and routes them to appropriate handlers  
- `src/jackie/orchestrator.py` – Manages agents, their states (idle/running), and task execution  
- `src/jackie/memory.py` – Context storage using SHA‑256 keyed hashing for retrieval  
- `src/jackie/personality.py` – Defines agent personalities with traits and behavior metadata  
- `src/jackie/terminal.py` – Maps agents to terminals, buffers input/output  

## Usage

```python
from src.jackie.router import Router
from src.jackie.orchestrator import Orchestrator
from src.jackie.memory import Memory
from src.jackie.personality import create_personality
from src.jackie.terminal import Terminal

router = Router()
orchestrator = Orchestrator()
memory = Memory()
personality = create_personality("Jackie", ["curious"], {"tone": "formal"})
terminal = Terminal()

# Register a handler for /hello
async def hello_handler(method, body, headers):
    return {"message": f"Hello from {body}"}

router.register("/hello", hello_handler)

# Dispatch a task to an idle agent
result = await orchestrator.dispatch("Run analysis on this data")
print(result["agent"], result["status"])

# Store context in memory
memory.store("user-session-123", {"name": "Alice"})

# Assign personality to Jackie
orchestrator.agents["Jackie"] = personality

# Send input to terminal
output = terminal.send_input("tty0", "ls -la")
print(output)
```

## Notes

- Router uses simple path matching; unknown routes return 404.  
- Orchestrator selects the first idle agent in round‑robin order.  
- Memory hashes keys with SHA‑256 for consistent retrieval.  

---

*End of README.*