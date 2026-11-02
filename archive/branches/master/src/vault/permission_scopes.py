"""
Sovereign Vault — Permission Scopes and Access Control
"""

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class Scope:
    name: str
    description: str = ""
    permissions: List[str] = field(default_factory=list)


def validate_scope(scope_name: str, allowed_scopes: Dict[str, Scope]) -> bool:
    return scope_name in allowed_scopes and allowed_scopes[scope_name].permissions is not None


def grant_permission(user_id: str, resource_type: str, permission: str):
    print(f"Granted {permission} to user {user_id} on {resource_type}")


if __name__ == "__main__":
    scopes = {
        "admin": Scope("admin", "Full control", ["read", "write", "delete"]),
        "editor": Scope("editor", "Edit only", ["read", "write"]),
        "viewer": Scope("viewer", "Read-only", ["read"])
    }

    print(scopes)
