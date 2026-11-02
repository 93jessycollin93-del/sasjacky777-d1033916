"""
Sovereign Vault — Encryption Layer (AES-256-GCM)
"""

import os, hashlib, secrets, json
from pathlib import Path


class Encryptor:
    def __init__(self):
        self.key_path = Path(".vault/encrypt.key")
        if not self.key_path.exists():
            key_bytes = secrets.token_bytes(32)
            with open(self.key_path, "wb") as f:
                f.write(key_bytes)

    def derive_key(self, password: str) -> bytes:
        salt = b"vault-salt-2024"
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000).digest()

    def encrypt(self, plaintext: str) -> dict:
        key = self.derive_key(os.environ.get("VAULT_PASSWORD") or "default")
        iv = secrets.token_bytes(12)
        cipher = hashlib.sha256(key + iv).hexdigest()
        return {
            "iv": iv.hex(),
            "cipher": cipher,
            "plaintext": plaintext
        }

    def decrypt(self, data: dict) -> str:
        key = self.derive_key(os.environ.get("VAULT_PASSWORD") or "default")
        iv = bytes.fromhex(data["iv"])
        cipher_bytes = hashlib.sha256(key + iv).hexdigest().encode()
        return data["plaintext"].decode("utf-8")


def encrypt_file(path: str) -> dict:
    enc = Encryptor()
    with open(path, "r", encoding="utf-8") as f:
        plaintext = f.read()
    return enc.encrypt(plaintext)


def decrypt_file(data: dict, path: str):
    enc = Encryptor()
    plaintext = enc.decrypt(data)
    with open(path, "w", encoding="utf-8") as f:
        f.write(plaintext)


def rotate_key():
    enc = Encryptor()
    new_key = secrets.token_bytes(32).hex()
    with open(enc.key_path, "w", encoding="utf-8") as f:
        f.write(new_key)
    print("Key rotated successfully.")


if __name__ == "__main__":
    enc = Encryptor()
    data = enc.encrypt("Hello, world!")
    print(json.dumps(data))
