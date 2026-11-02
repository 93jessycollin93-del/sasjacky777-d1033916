"""
Jackie Core — Terminal Assignment Logic (maps agents to terminals, handles input/output)
"""

import os


class Terminal:
    def __init__(self):
        self.terminals = {}

    def assign(self, agent_name, terminal_id):
        self.terminals[terminal_id] = {
            "agent": agent_name,
            "input_buffer": "",
            "output_buffer": ""
        }

    def send_input(self, terminal_id, text):
        if terminal_id not in self.terminals:
            return {"error": f"Terminal {terminal_id} not assigned"}
        self.terminals[terminal_id]["input_buffer"] += text
        return {"status": "ok", "buffer": self.terminals[terminal_id]["output_buffer"]}

    def get_output(self, terminal_id):
        if terminal_id not in self.terminals:
            return None
        output = self.terminals[terminal_id]["output_buffer"]
        self.terminals[terminal_id]["output_buffer"] = ""
        return output


if __name__ == "__main__":
    terminal = Terminal()
