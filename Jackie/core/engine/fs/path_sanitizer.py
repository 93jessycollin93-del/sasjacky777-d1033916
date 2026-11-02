"""
JackieOS Engine Filesystem Path Sanitizer
Pure utility module for Windows-safe path handling
"""

import os
import sys

WINDOWS = sys.platform.startswith("win")

def normalize(path: str) -> str:
    """
    Normalize slashes, resolve environment variables, and collapse .. segments.
    """
    if not path:
        return path
    path = os.path.expandvars(path)
    path = os.path.expanduser(path)
    return os.path.normpath(path)

def quote(path: str) -> str:
    """
    Windows-safe quoting for paths with spaces or special characters.
    On non-Windows, returns unchanged.
    """
    if not WINDOWS:
        return path
    if not path:
        return path
    # If already quoted, leave it.
    if path.startswith('"') and path.endswith('"'):
        return path
    if any(c in path for c in [' ', '(', ')', '&', '^', '%']):
        return f'"{path}"'
    return path

def safe(path: str) -> str:
    """
    Full pipeline: normalize → quote (Windows only).
    """
    return quote(normalize(path))


def safe_batch_var(path: str) -> str:
    """
    Format path for batch file SET commands.
    """
    normalized = normalize(path)
    # Batch files use double quotes around values
    return f'"{normalized}"'


def safe_shell_cmd(path: str) -> str:
    """
    Format path for shell command execution.
    """
    safe_path = safe(path)
    # For shell execution, ensure proper quoting
    if WINDOWS and ' ' in path and not path.startswith('"'):
        return f'"{path}"'
    return safe_path
