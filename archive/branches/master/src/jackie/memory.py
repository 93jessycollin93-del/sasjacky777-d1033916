"""
Jackie Core — Memory (context storage and retrieval)
"""

import json, hashlib


class Memory:
    def __init__(self):
        self.contexts = {}

    def store(self, key, data):
        hash_key = hashlib.sha256(key.encode()).hexdigest()
        self.contexts[hash_key] = {
            "data": data,
            "created_at": int(__import__("time").time())
        }

    def retrieve(self, key):
        hash_key = hashlib.sha256(key.encode()).hexdigest()
        return self.contexts.get(hash_key) or None


if __name__ == "__main__":
    memory = Memory()
