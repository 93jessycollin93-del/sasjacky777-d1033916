"""
Jackie Core — Personality Modules (defines agent personalities and their behaviors)
"""

from dataclasses import dataclass


@dataclass
class Personality:
    name: str
    traits: list[str] = None
    behavior: dict = None

    def __post_init__(self):
        self.traits = self.traits or []
        self.behavior = self.behavior or {}


def create_personality(name, traits=None, behavior=None):
    return Personality(name=name, traits=traits, behavior=behavior)


if __name__ == "__main__":
    personalities = [
        create_personality("Jackie", ["curious", "analytical"], {"tone": "formal"}),
        create_personality("Analysis", ["deep", "methodical"]),
        create_personality("Code", ["precise", "verbose"])
    ]
