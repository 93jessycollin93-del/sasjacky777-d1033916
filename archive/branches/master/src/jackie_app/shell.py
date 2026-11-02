"""
Jackie App — Shell (provides a command-line interface with various subcommands)
"""

import subprocess, json


class Shell:
    def __init__(self):
        self.commands = {
            "help": lambda args: {"message": "Available commands: help, status, run"},
            "status": lambda args: {"system": "running", "uptime": 42},
            "run": lambda args: subprocess.run(args.get("cmd"), shell=True).returncode
        }

    def execute(self, command):
        if command not in self.commands:
            return {"error": f"Unknown command: {command}"}
        result = self.commands[command](command)
        return result


if __name__ == "__main__":
    shell = Shell()
