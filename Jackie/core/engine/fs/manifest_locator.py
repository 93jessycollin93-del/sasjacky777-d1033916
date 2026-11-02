"""
Manifest Locator
Finds vault manifests with path safety
"""

import os
from typing import Optional, List
from .resolver import PathResolver

class ManifestLocator:
    """
    Knows where master manifests live for different vaults.
    """

    def __init__(self, resolver: PathResolver, manifest_candidates: List[str]):
        """
        manifest_candidates: list of relative or absolute paths to try.
        """
        self.resolver = resolver
        self.manifest_candidates = manifest_candidates

    def find_first(self) -> Optional[str]:
        """
        Return the first existing manifest path, or None.
        """
        for candidate in self.manifest_candidates:
            abs_path = self.resolver.abs(candidate)
            if os.path.isfile(abs_path):
                return abs_path
        return None

    def list_all(self) -> List[str]:
        """
        Return all existing manifest paths.
        """
        found = []
        for candidate in self.manifest_candidates:
            abs_path = self.resolver.abs(candidate)
            if os.path.isfile(abs_path):
                found.append(abs_path)
        return found
