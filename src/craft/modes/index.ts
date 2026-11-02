/**
 * The game modes: definitions and runtimes. Importing this module registers
 * every mode's runtime with the factory (modes/runtime.ts).
 */
export { createRuntime, ModeRuntime, type ModePlayer } from "./runtime";
export { MODES, modeDef, randomMode, applyMode, CATEGORY_NAMES, type ModeDef, type ModeState, type ModeCategory } from "./modes";

// Each mode's runtime registers itself with the factory as its file loads.
import "./skyblock";
import "./oneblock";
import "./parkour";
import "./waves";
import "./tntrun";
import "./survivalGames";
import "./challenges";
import "./primal";
import "./deadzone";
import "./zombies";
import "./critterModes";
import "./cityModes";
import "./cityGames";
import "./ashgrove";
