# Sovereign Vault Foundation — Security Fortress

This is your security fortress: API key vault, encryption, key rotation, permission scopes, and lock‑in mechanisms.

## Components

- `src/vault/api_key_vault.py` – Manages encrypted keys with creation, retrieval, rotation, deletion  
- `src/vault/encryption.py` – AES‑256‑GCM style encryption using a master key stored in `.vault/encrypt.key`  
- `src/vault/permission_scopes.py` – Defines scopes (admin/editor/viewer) and validates access  
- `src/vault/lock_in_mechanisms.py` – Vault locking, recovery keys, audit logging  
- `src/vault/orchestrator.py` – Orchestrates all vault operations  

## Usage

```python
from src.vault.orchestrator import VaultOrchestrator

vault = VaultOrchestrator()
vault.init()  # load existing keys from .vault/keys.json

# Store a new key
vault.set("my-api-key", "secret123456", permissions=["read","write"], scope="full")

# Retrieve it (returns cipher + metadata)
entry = vault.get("my-api-key")

# Rotate the key in place
vault.rotate("my-api-key")

# Delete a key
vault.delete("old-key")

# List all keys with their scopes and permissions
for k in vault.list_all():
    print(k["name"], k["scope"], k["permissions"])
```

## Security Notes

- Keys are encrypted at rest using SHA‑256 derived from the master key.  
- Rotation updates both the cipher and metadata atomically.  
- Locking prevents accidental deletion; recovery requires the stored key.  

---

*End of README.*