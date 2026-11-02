# Rollback

The mod writes nothing outside its own folder and replaces no original assets,
so removal is clean.

1. Close the game.
2. Back up `%UserProfile%\Zomboid\Saves\` first (before every test session).
3. Main menu → Mods → untick Realism Overhaul. Or delete
   `%UserProfile%\Zomboid\mods\RealismOverhaul`.
4. For a save that had it on: load it once; sandbox values for
   `RealismOverhaul.*` are ignored when the mod is absent.
5. Server: remove `RealismOverhaul` from `Mods=` in `Server/<name>.ini`, keep the
   other entries, restart.
6. If anything is wrong, restore the save backup from step 2.

pz3d and ZombieBuddy are rolled back on their own, following their own docs.
