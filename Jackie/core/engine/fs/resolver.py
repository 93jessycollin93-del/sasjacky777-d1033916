"""
Path Resolver
Centralized path resolution for workspace-relative and absolute paths
"""

import os
from .path_sanitizer import normalize, safe

class PathResolver:
    """
    Centralized resolver for workspace-relative and absolute paths.
    """

    def __init__(self, workspace_root: str):
        self.workspace_root = normalize(workspace_root)

    def abs(self, path: str) -> str:
        """
        Resolve a path relative to workspace_root if not absolute.
        """
        path = normalize(path)
        if os.path.isabs(path):
            return path
        return normalize(os.path.join(self.workspace_root, path))

    def safe_abs(self, path: str) -> str:
        """
        Resolve path and apply safety quoting.
        """
        return safe(self.abs(path))

    def exists(self, path: str) -> bool:
        return os.path.exists(self.abs(path))

    def ensure_dir(self, path: str) -> str:
        """
        Ensure directory exists; return absolute path.
        """
        abs_path = self.abs(path)
        os.makedirs(abs_path, exist_ok=True)
        return abs_path

    def ensure_dir_safe(self, path: str) -> str:
        """
        Ensure directory exists and return safe-quoted path.
        """
        abs_path = self.ensure_dir(path)
        return safe(abs_path)
