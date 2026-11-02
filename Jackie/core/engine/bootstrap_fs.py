"""
JackieOS Engine Filesystem Bootstrap
Initialize FS layer with path safety
"""

from .fs.resolver import PathResolver
from .fs.vault_router import VaultRouter, VaultConfig
from .fs.tool_runner import ToolRunner

def build_fs_layer(workspace_root: str):
    """
    Build the complete filesystem layer with path safety.
    """
    resolver = PathResolver(workspace_root)

    vaults = {
        "models_perm": VaultConfig(
            name="models_perm",
            root="E:/AI_Permanent/Models",
            manifest_rel="E_PERMANENT_MASTER_MANIFEST.json",
        ),
        "workspace_docs": VaultConfig(
            name="workspace_docs",
            root="C:/Users/Eru/AI_ Workspace/docs",
            manifest_rel=None,
        ),
        "workspace_tools": VaultConfig(
            name="workspace_tools",
            root="C:/Users/Eru/AI_ Workspace/tools",
            manifest_rel=None,
        ),
    }

    router = VaultRouter(resolver, vaults)
    tools = ToolRunner(dry_run=False)

    return resolver, router, tools


# Example usage
if __name__ == "__main__":
    workspace_root = "C:/Users/Eru/AI_ Workspace"
    resolver, router, tools = build_fs_layer(workspace_root)
    
    # Get safe paths
    perm_root = router.safe_root("models_perm")
    workspace_docs = router.safe_root("workspace_docs")
    
    print(f"Permanent models: {perm_root}")
    print(f"Workspace docs: {workspace_docs}")
    
    # Run robocopy with safe paths
    # tools.run_robocopy(
    #     source=workspace_docs,
    #     dest=perm_root,
    #     options="/MIR"
    # )
