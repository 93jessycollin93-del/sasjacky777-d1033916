"""
Vault Router
Maps logical vaults to physical paths with path safety
"""

from dataclasses import dataclass
from typing import Dict, Optional
from .resolver import PathResolver
from .path_sanitizer import safe

@dataclass
class VaultConfig:
    name: str
    root: str  # relative or absolute
    manifest_rel: Optional[str] = None  # relative to root

class VaultRouter:
    """
    Routes logical vault names to physical paths and manifests.
    """

    def __init__(self, resolver: PathResolver, vaults: Dict[str, VaultConfig]):
        self.resolver = resolver
        self.vaults = vaults

    def get_root(self, name: str) -> Optional[str]:
        cfg = self.vaults.get(name)
        if not cfg:
            return None
        return self.resolver.abs(cfg.root)

    def get_manifest(self, name: str) -> Optional[str]:
        cfg = self.vaults.get(name)
        if not cfg or not cfg.manifest_rel:
            return None
        root = self.get_root(name)
        if not root:
            return None
        return self.resolver.abs(f"{root}/{cfg.manifest_rel}")

    def safe_root(self, name: str) -> Optional[str]:
        root = self.get_root(name)
        return safe(root) if root else None

    def safe_manifest(self, name: str) -> Optional[str]:
        manifest = self.get_manifest(name)
        return safe(manifest) if manifest else None

    def list_vaults(self) -> list:
        return list(self.vaults.keys())
