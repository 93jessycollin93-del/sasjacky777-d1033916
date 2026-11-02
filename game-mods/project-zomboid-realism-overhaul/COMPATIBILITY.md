# Compatibility

Docs read on 2026-10-12. Nothing below has been verified in-game yet.

| Component | What its source says | Verified here | Risk |
| --- | --- | --- | --- |
| Project Zomboid 42.21.0 (Windows, Steam) | Target build | not yet | medium |
| pz3d 0.7.1 | Earlier notes targeted 42.20.4 single-player; the server guide now names 42.21.0 | not yet | high |
| pz3d multiplayer | Described as experimental since 0.7.0 | not yet | high |
| ZombieBuddy 2.3.4+ | pz3d docs: required loader; pz3d no longer ships its own | not yet | medium |
| pz3d-loader | Superseded by ZombieBuddy | not pinned | — |

Rules:

- Do not claim 42.21 or multiplayer works until TEST_PLAN.md passes on it.
- pz3d is optional. Without it, the camera adapter reports `blocked`.
- Sources: https://pz3d.dev/install/ · https://pz3d.dev/install/about.html ·
  https://github.com/zed-0xff/ZombieBuddy/releases
