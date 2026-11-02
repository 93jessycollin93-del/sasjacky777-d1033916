"""
Jackie App — Terminals (handles terminal sessions and input/output)
"""

import os


class TerminalSession:
    def __init__(self, session_id):
        self.session_id = session_id
        self.input_buffer = ""
        self.output_buffer = ""

    def write(self, text):
        self.output_buffer += text + "\n"

    def read(self):
        return self.input_buffer


class Terminals:
    def __init__(self):
        self.sessions = {}

    def create(self, session_id):
        self.sessions[session_id] = TerminalSession(session_id)

    def attach(self, user_id, session_id):
        if session_id not in self.sessions:
            return {"error": "Session not found"}
        self.sessions[session_id].input_buffer += f"User {user_id} attached\n"

    def detach(self, session_id):
        if session_id not in self.sessions:
            return {"error": "Session not found"}
        del self.sessions[session_id]

    def get_output(self, session_id):
        if session_id not in self.sessions:
            return None
        output = self.sessions[session_id].output_buffer
        self.sessions[session_id].output_buffer = ""
        return output


if __name__ == "__main__":
    terminals = Terminals()
