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
    root: str
    manifest_rel: Optional[str] = None

class VaultRouter:
    def __init__(self, resolver: PathResolver, vaults: Dict[str, VaultConfig]):
        self.resolver = resolver
        self.vaults = vaults

    def get_root(self, name: str) -> Optional[str]:
        cfg = self.vaults.get(name)
        return self.resolver.abs(cfg.root) if cfg else None

    def get_manifest(self, name: str) -> Optional[str]:
        cfg = self.vaults.get(name)
        if not cfg or not cfg.manifest_rel:
            return None
        root = self.get_root(name)
        return self.resolver.abs(f"{root}/{cfg.manifest_rel}") if root else None

    def safe_root(self, name: str) -> Optional[str]:
        root = self.get_root(name)
        return safe(root) if root else None

    def safe_manifest(self, name: str) -> Optional[str]:
        manifest = self.get_manifest(name)
        return safe(manifest) if manifest else None
