"""
Jackie App — UI (handles rendering and transitions)
"""

import json


class UI:
    def __init__(self):
        self.elements = {}

    def render(self, template_id):
        return {"template": template_id}

    def transition(self, from_state, to_state):
        return {"from": from_state, "to": to_state}


if __name__ == "__main__":
    ui = UI()
