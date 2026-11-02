import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopInput } from "@/craft/game/input";
import type { Game } from "@/craft/game/game";
import { emptyControls, type Screen } from "@/craft/game/types";
import { defaultSettings } from "@/craft/game/settings";

/**
 * The pointer-lock rules. Every one of these was a bug found by playing:
 * a screen that opened and shut in the same frame, a menu that could not be
 * clicked because the mouse was still captured under it.
 */

let lockedTo: Element | null = null;
const setLock = (el: Element | null) => {
  lockedTo = el;
  document.dispatchEvent(new Event("pointerlockchange"));
};

function fakeGame(screen: Screen | null = null) {
  return {
    screen,
    isMobile: false,
    controls: emptyControls(),
    settings: defaultSettings(),
    audio: { unlock() {} },
  };
}

describe("desktop input", () => {
  let canvas: HTMLCanvasElement;
  let input: DesktopInput | null = null;

  beforeEach(() => {
    lockedTo = null;
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => lockedTo });
    document.exitPointerLock = () => setLock(null);
    canvas = document.createElement("canvas");
    (canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = () => setLock(canvas);
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    input?.dispose();
    input = null;
    canvas.remove();
  });

  const start = (game: ReturnType<typeof fakeGame>) => {
    input = new DesktopInput(game as unknown as Game, canvas);
    return input;
  };
  const key = (code: string) => window.dispatchEvent(new KeyboardEvent("keydown", { code }));

  it("pauses when the mouse is let go with nothing open, as when the window loses focus", () => {
    const game = fakeGame();
    start(game).requestLock();
    setLock(null);
    expect(game.controls.actions).toContainEqual({ type: "pause" });
  });

  it("does not read its own release as pause, or E would open the inventory and shut it again", () => {
    const game = fakeGame();
    start(game).requestLock();
    key("KeyE");
    expect(game.controls.actions).toEqual([{ type: "inventory" }]);
    expect(lockedTo).toBeNull();
  });

  it("lets go of a lock granted after a screen opened, so the screen can be clicked", () => {
    const game = fakeGame({ kind: "inventory" });
    start(game);
    setLock(canvas);
    expect(lockedTo).toBeNull();
    expect(game.controls.actions).toEqual([]);
  });

  it("pauses on Escape when the mouse is free, and closes what is open when something is", () => {
    const game = fakeGame();
    start(game);
    key("Escape");
    expect(game.controls.actions.splice(0)).toEqual([{ type: "pause" }]);
    game.screen = { kind: "inventory" };
    key("Escape");
    expect(game.controls.actions).toEqual([{ type: "close" }]);
  });

  it("ignores game keys while a chat or search box has the keyboard", () => {
    const game = fakeGame();
    start(game);
    const box = document.createElement("input");
    document.body.appendChild(box);
    box.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", bubbles: true }));
    box.remove();
    expect(game.controls.actions).toEqual([]);
  });
});
