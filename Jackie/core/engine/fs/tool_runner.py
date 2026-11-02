"""
Tool Runner
Executes tools with path-safe arguments
"""

import subprocess
from typing import List, Optional
from .path_sanitizer import safe

class ToolRunner:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run

    def run_shell(self, cmd: str, cwd: Optional[str] = None) -> int:
        if self.dry_run:
            return 0
        return subprocess.call(cmd, shell=True, cwd=cwd)

    def run_python_script(self, script_path: str, args: Optional[List[str]] = None) -> int:
        script = safe(script_path)
        arg_str = " ".join(args or [])
        cmd = f"python {script} {arg_str}".strip()
        return self.run_shell(cmd)

    def run_batch(self, batch_path: str, args: Optional[List[str]] = None) -> int:
        batch = safe(batch_path)
        arg_str = " ".join(args or [])
        cmd = f'cmd /c {batch} {arg_str}'.strip()
        return self.run_shell(cmd)

    def run_robocopy(self, source: str, dest: str, options: Optional[str] = "/MIR") -> int:
        src = safe(source)
        dst = safe(dest)
        cmd = f"robocopy {src} {dst} {options}".strip()
        return self.run_shell(cmd)
