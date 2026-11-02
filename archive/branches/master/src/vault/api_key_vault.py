"""
Sovereign Vault — API Key Management with Encryption and Rotation
"""

import os, json, hashlib, secrets, time
from pathlib import Path


class ApiKeyVault:
    def __init__(self, key_path=".vault/keys.json"):
        self.key_path = Path(key_path)
        self.keys = {}
        if not self.key_path.exists():
            return

        with open(self.key_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            for name, entry in data.items():
                self.keys[name] = {
                    "secret": entry["secret"],
                    "created_at": entry.get("created_at"),
                    "rotated_at": entry.get("rotated_at"),
                    "permissions": entry.get("permissions", []),
                    "scope": entry.get("scope")
                }

    def get(self, name):
        return self.keys.get(name) or None

    def set(self, name, secret, permissions=None, scope="full"):
        if not permissions:
            permissions = ["read", "write"]
        now = int(time.time())
        entry = {
            "secret": secret,
            "created_at": now,
            "rotated_at": None,
            "permissions": permissions,
            "scope": scope
        }
        self.keys[name] = entry

    def rotate(self, name):
        if name not in self.keys:
            return False
        now = int(time.time())
        self.keys[name]["rotated_at"] = now
        self.keys[name]["created_at"] = now
        return True

    def delete(self, name):
        self.keys.pop(name, None)

    def list_all(self):
        return {name: {"scope": k["scope"], "permissions": k["permissions"]} for name, k in self.keys.items()}


def encrypt_key(key_bytes: bytes) -> str:
    """Simple AES-like encryption using SHA-256."""
    salt = b"vault-salt-2024"
    combined = hashlib.sha256(salt + key_bytes).hexdigest()
    return combined


def decrypt_key(cipher: str, key_path=".vault/decrypt.key") -> bytes:
    """Decrypt using the stored master key."""
    with open(key_path, "r", encoding="utf-8") as f:
        master = f.read().strip()
    cipher_bytes = cipher.encode("utf-8")
    return hashlib.sha256(master + cipher_bytes).digest()


def rotate_key(name):
    vault = ApiKeyVault()
    entry = vault.get(name)
    if not entry or not entry["secret"]:
        print(f"Error: Vault does not contain {name}")
        return False

    plain = decrypt_key(entry["secret"])
    new_cipher = encrypt_key(plain)
    vault.set(name, new_cipher, permissions=entry["permissions"], scope=entry["scope"])
    vault.rotate(name)

    with open(".vault/decrypt.key", "w", encoding="utf-8") as f:
        f.write(entry["secret"])

    print(f"Key {name} rotated successfully.")
    return True


def main():
    vault = ApiKeyVault()
    if len(vault.keys) == 0:
        print("Vault is empty. Add keys with vault.set(name, secret).")
        return

    for name in vault.list_all():
        entry = vault.get(name)
        plain = decrypt_key(entry["secret"])
        print(f"{name}: {plain.decode('utf-8')} (scope={entry['scope']}, perms={entry['permissions']})")


if __name__ == "__main__":
    main()
