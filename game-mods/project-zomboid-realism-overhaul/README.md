# Realism Overhaul (Project Zomboid, Build 42.21.0)

Mod id `RealismOverhaul`. Workspace page in Jackie: `/zomboid-realism`.

## What it does today

- Loads on Build 42 using the `Contents/mods/RealismOverhaul/42/` layout.
- Sandbox options for each feature, all realism features **off** by default.
- Feature-detects every game API it uses (`Compat.lua`); a missing API means
  the feature stays off, never an error.
- Server answers only allowlisted client commands, and sends its own settings.
- Camera adapter reports `disabled`, `delegated` (pz3d active), or `blocked`.

## What it does not do

- **No first-person camera of its own.** Build 42 has no supported Lua API for
  it. First person is delegated to pz3d, which needs ZombieBuddy 2.3.4+.
- No Java, no JAR patches, no replaced original assets. Only Lua under
  `RealismOverhaul/` folders.
- Movement, lighting and audio rules are planned, not written.

## Install (local test)

Copy `Contents/mods/RealismOverhaul` to `%UserProfile%\Zomboid\mods\` and
enable it in Mods. See COMPATIBILITY.md, TEST_PLAN.md and ROLLBACK.md.
