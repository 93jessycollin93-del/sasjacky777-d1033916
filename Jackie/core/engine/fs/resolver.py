"""
Path Resolver
"""
import os
from .path_sanitizer import normalize, safe

class PathResolver:
    def __init__(self, workspace_root: str):
        self.workspace_root = normalize(workspace_root)
    def abs(self, path: str) -> str:
        path = normalize(path)
        if os.path.isabs(path):
            return path
        return normalize(os.path.join(self.workspace_root, path))
