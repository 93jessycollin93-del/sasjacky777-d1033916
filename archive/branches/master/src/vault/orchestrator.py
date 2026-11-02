"""
Sovereign Vault — Orchestrator (ties together all vault components)
"""

import os, json, hashlib, secrets, time
from pathlib import Path


class VaultOrchestrator:
    def __init__(self):
        self.vault_path = Path(".vault")
        self.vault_path.mkdir(exist_ok=True)
        self.keys_file = self.vault_path / "keys.json"
        self.encryptor = None
        self.lock = None

    def init(self):
        if not self.keys_file.exists():
            return False
        with open(self.keys_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            for name, entry in data.items():
                secret = entry["secret"]
                cipher = hashlib.sha256(secret.encode()).hexdigest()
                self.encryptor.set(name, cipher, permissions=entry.get("permissions", []), scope=entry.get("scope"))
        return True

    def get(self, name):
        if not self.keys_file.exists():
            return None
        with open(self.keys_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            entry = data.get(name)
            if not entry or not entry["secret"]:
                return None
            cipher = hashlib.sha256(entry["secret"].encode()).hexdigest()
            self.encryptor.set(name, cipher, permissions=entry.get("permissions", []), scope=entry.get("scope"))
            return {
                "name": name,
                "cipher": cipher,
                "permissions": entry.get("permissions", []),
                "scope": entry.get("scope")
            }

    def set(self, name, secret, permissions=None, scope="full"):
        if not self.keys_file.exists():
            return False
        with open(self.keys_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        entry = {
            "secret": hashlib.sha256(secret.encode()).hexdigest(),
            "created_at": int(time.time()),
            "rotated_at": None,
            "permissions": permissions or [],
            "scope": scope
        }
        data[name] = entry
        with open(self.keys_file, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return True

    def rotate(self, name):
        if not self.keys_file.exists():
            return False
        with open(self.keys_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        entry = data.get(name)
        if not entry or not entry["secret"]:
            return False
        cipher = hashlib.sha256(entry["secret"].encode()).hexdigest()
        self.encryptor.set(name, cipher, permissions=entry.get("permissions", []), scope=entry.get("scope"))
        now = int(time.time())
        data[name]["rotated_at"] = now
        with open(self.keys_file, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return True

    def delete(self, name):
        if not self.keys_file.exists():
            return False
        with open(self.keys_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.pop(name, None)
        with open(self.keys_file, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return True

    def list_all(self):
        if not self.keys_file.exists():
            return []
        with open(self.keys_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return [{"name": name, "scope": entry["scope"], "permissions": entry.get("permissions", [])} for name, entry in data.items()]


if __name__ == "__main__":
    vault = VaultOrchestrator()
    vault.init()
