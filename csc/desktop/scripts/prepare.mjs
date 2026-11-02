/**
 * Copies the built game (csc/dist) into ./app, where main.mjs serves it from
 * and electron-builder packs it. The game is built by Vite at the repository
 * root — this package holds only Electron — so a missing build is named, with
 * the command that makes it, rather than packaging an empty window.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const app = path.resolve(here, "../app");

if (!existsSync(path.join(dist, "index.html"))) {
  console.error(`No built game at ${dist}.\nBuild it first, from the repository root:  npm run csc:build`);
  process.exit(1);
}
rmSync(app, { recursive: true, force: true });
cpSync(dist, app, { recursive: true });
console.log(`Copied the game from ${dist} into ${app}.`);
