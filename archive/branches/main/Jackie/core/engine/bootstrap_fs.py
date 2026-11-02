"""
JackieOS Engine Filesystem Bootstrap
"""

from .fs.resolver import PathResolver
from .fs.vault_router import VaultRouter, VaultConfig
from .fs.tool_runner import ToolRunner

def build_fs_layer(workspace_root: str):
    resolver = PathResolver(workspace_root)
    vaults = {
        "models_perm": VaultConfig(name="models_perm", root="E:/AI_Permanent/Models", manifest_rel="E_PERMANENT_MASTER_MANIFEST.json"),
        "workspace_docs": VaultConfig(name="workspace_docs", root="C:/Users/Eru/AI_ Workspace/docs", manifest_rel=None),
        "workspace_tools": VaultConfig(name="workspace_tools", root="C:/Users/Eru/AI_ Workspace/tools", manifest_rel=None),
    }
    router = VaultRouter(resolver, vaults)
    tools = ToolRunner(dry_run=False)
    return resolver, router, tools
