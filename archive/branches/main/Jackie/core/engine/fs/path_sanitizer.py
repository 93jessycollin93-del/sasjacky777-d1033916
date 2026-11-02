"""
JackieOS Engine Filesystem Path Sanitizer
Pure utility module for Windows-safe path handling
"""

import os
import sys

WINDOWS = sys.platform.startswith("win")

def normalize(path: str) -> str:
    if not path:
        return path
    path = os.path.expandvars(path)
    path = os.path.expanduser(path)
    return os.path.normpath(path)

def quote(path: str) -> str:
    if not WINDOWS:
        return path
    if not path:
        return path
    if path.startswith('"') and path.endswith('"'):
        return path
    if any(c in path for c in [' ', '(', ')', '&', '^', '%']):
        return f'"{path}"'
    return path

def safe(path: str) -> str:
    return quote(normalize(path))
