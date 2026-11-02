# Test plan

Run each on a **copied** save. Check `%UserProfile%\Zomboid\console.txt` after each.

1. **Load without pz3d.** Enable only Realism Overhaul. New game. Expect
   `[RealismOverhaul] 0.1.0 on singleplayer · camera: blocked`. No errors.
2. **Load with pz3d.** ZombieBuddy 2.3.4+, pz3d 0.7.1, then Realism Overhaul.
   Expect `camera: delegated`. Press Insert; pz3d's camera must work exactly as
   it does without this mod.
3. **Toggle off.** Sandbox → Realism Overhaul → camera status off. Expect
   `camera: disabled`.
4. **Save / quit / reload.** No new errors.
5. **Dedicated server (experimental).** Two clients. Each logs settings from the
   server. A forged `sendClientCommand(p, "RealismOverhaul", "anything", {})`
   logs `refused unknown client command` on the server and changes nothing.
6. **Performance.** FPS in Muldraugh at noon and midnight, mod on vs off.

Automated: `npx vitest run src/test/pz-realism-mod.test.ts` checks the folder
layout, mod.info, that there is no Java, and that the server has an allowlist.
