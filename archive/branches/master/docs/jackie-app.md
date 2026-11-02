# Jackie App — Workstation Implementation

This is your workstation: UI, terminals, background transitions, Wayland integration, and sovereign environment shell.

## Components

- `src/jackie_app/ui.py` – Handles rendering and state transitions  
- `src/jackie_app/terminals.py` – Manages terminal sessions with input/output buffering  
- `src/jackie_app/background.py` – Smooth visual and state change animations  
- `src/jackie_app/way_integration.py` – Wayland protocol surface creation and output management  
- `src/jackie_app/shell.py` – Command-line interface with help, status, run subcommands  

## Usage

```python
from src.jackie_app.ui import UI
from src.jackie_app.terminals import Terminals
from src.jackie_app.background import Transition
from src.jackie_app.way_integration import WaylandIntegration
from src.jackie_app.shell import Shell

ui = UI()
terminals = Terminals()
transition = Transition()
wayland = WaylandIntegration()
shell = Shell()

# Create a terminal session
session_id = terminals.create("tty0")

# Attach user to the session
terminals.attach("user123", session_id)

# Run a command via shell
result = shell.execute({"cmd": "ls -la"})
print(result)

# Trigger a background transition
transition.animate("idle", "loading")
```

## Notes

- Terminals buffer input/output; call `get_output` to retrieve and clear buffers.  
- Background transitions are stateful — they remember the current visual state.  

---

*End of README.*