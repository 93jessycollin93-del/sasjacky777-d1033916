"""
Sovereign Vault — Lock-in Mechanisms (Vault locking, recovery keys, audit logs)
"""

import os, json, hashlib, secrets, time
from pathlib import Path


class VaultLock:
    def __init__(self):
        self.lock_path = Path(".vault/lock.json")
        self.locked = False
        if not self.lock_path.exists():
            return

        with open(self.lock_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.locked = data.get("locked", False)
            self.lock_time = data.get("lock_time")
            self.recovery_key = data.get("recovery_key")

    def lock(self, recovery_key=None):
        if self.locked:
            return False
        now = int(time.time())
        self.locked = True
        self.lock_time = now
        self.recovery_key = recovery_key or secrets.token_hex(32)
        with open(self.lock_path, "w", encoding="utf-8") as f:
            json.dump({"locked": self.locked, "lock_time": self.lock_time, "recovery_key": self.recovery_key}, f)
        return True

    def unlock(self):
        if not self.locked:
            return False
        now = int(time.time())
        self.locked = False
        with open(self.lock_path, "w", encoding="utf-8") as f:
            json.dump({"locked": self.locked, "lock_time": None, "recovery_key": None}, f)
        return True

    def recover(self):
        if not self.recovery_key:
            return False
        now = int(time.time())
        with open(self.lock_path, "w", encoding="utf-8") as f:
            json.dump({"locked": False, "lock_time": None, "recovery_key": None}, f)
        print(f"Vault recovered using key {self.recovery_key}")
        return True


def audit_log(action: str, details: dict):
    log_path = Path(".vault/audit.log")
    entry = json.dumps({"timestamp": int(time.time()), "action": action, **details}) + "\n"
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(entry)


if __name__ == "__main__":
    vault = VaultLock()
    print(f"Locked: {vault.locked}")
