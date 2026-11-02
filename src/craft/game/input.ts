/**
 * Keyboard and mouse.
 *
 * The familiar layout: WASD, space, shift to sneak, ctrl or a double-tapped W
 * to sprint, E inventory, Q drop (ctrl+Q the stack), T or / chat, 1-9 and the
 * wheel for the hotbar, F1 hide the HUD, F2 screenshot, F3 debug, F5 camera,
 * middle click to pick a block, double-tapped space to fly in creative.
 *
 * Mouse look uses pointer lock. Losing the lock (Escape, alt-tab) opens the
 * pause menu, the way the original does, so the game never keeps running
 * with the mouse loose and the player unable to steer.
 */
import { Car } from "../engine/cars";
import type { Game } from "./game";

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight"]);

export class DesktopInput {
  private keys = new Set<string>();
  private lastW = 0;
  private lastSpace = 0;
  private sprintLatch = false;
  private sneakToggle = false;
  private disposers: (() => void)[] = [];
  locked = false;

  constructor(private game: Game, private canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | Document | HTMLElement, type: K | string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.disposers.push(() => target.removeEventListener(type, fn, opts));
    };
    on(window, "keydown", (e) => this.keyDown(e as KeyboardEvent));
    on(window, "keyup", (e) => this.keyUp(e as KeyboardEvent));
    on(window, "blur", () => this.releaseAll());
    on(canvas, "mousedown", (e) => this.mouseDown(e as MouseEvent));
    on(window, "mouseup", (e) => this.mouseUp(e as MouseEvent));
    on(document, "mousemove", (e) => this.mouseMove(e as MouseEvent));
    on(canvas, "wheel", (e) => this.wheel(e as WheelEvent), { passive: false });
    on(canvas, "contextmenu", (e) => e.preventDefault());
    on(document, "pointerlockchange", () => this.lockChanged());
  }

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  requestLock(): void {
    if (this.game.isMobile) return;
    const c = this.canvas as HTMLCanvasElement & { requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      const r = c.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === "function") {
        (r as Promise<void>).catch(() => {
          // Some platforms refuse raw input; ask again for the ordinary kind.
          try { c.requestPointerLock(); } catch { /* the pause screen explains how to resume */ }
        });
      }
    } catch {
      try { c.requestPointerLock(); } catch { /* ignore */ }
    }
  }

  /** Releases the mouse on purpose (a screen is opening), so the release is not read as "pause". */
  exitLock(): void {
    if (document.pointerLockElement !== this.canvas) return;
    this.releasing = true;
    document.exitPointerLock();
  }
  private releasing = false;

  private lockChanged(): void {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.canvas;
    // The screen that asked for the release opens a frame later than this
    // event arrives; pausing here would close the inventory E just opened.
    const deliberate = this.releasing;
    this.releasing = false;
    // A lock asked for when the last screen closed can be granted after the next one opened
    // (the inventory, a chest): a screen under a captured mouse cannot be clicked, so let go.
    if (this.locked && this.game.screen) {
      this.exitLock();
      return;
    }
    if (was && !this.locked && !deliberate && !this.game.screen && !this.game.isMobile) {
      this.releaseAll();
      this.game.controls.actions.push({ type: "pause" });
    }
  }

  private releaseAll(): void {
    this.keys.clear();
    this.apply();
    const c = this.game.controls;
    c.attack = false;
    c.use = false;
  }

  private apply(): void {
    const k = this.keys;
    const c = this.game.controls;
    c.forward = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    c.strafe = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    c.jump = k.has("Space");
    const s = this.game.settings;
    c.sneak = s.toggleSneak ? this.sneakToggle : k.has("ShiftLeft") || k.has("ShiftRight");
    if (c.forward <= 0) this.sprintLatch = false;
    c.sprint = this.sprintLatch || k.has("ControlLeft") || k.has("ControlRight");
  }

  private keyDown(e: KeyboardEvent): void {
    if (this.typing(e)) {
      // Escape still backs out of a screen from inside its search or name box; the chat box closes itself.
      if (e.code === "Escape" && this.game.screen && this.game.screen.kind !== "chat") {
        e.preventDefault();
        this.game.controls.actions.push({ type: "close" });
      }
      return;
    }
    const g = this.game;
    const a = g.controls.actions;
    g.audio.unlock();
    // Keys that work with a screen open.
    if (e.code === "Escape") {
      e.preventDefault();
      // With the mouse captured the browser eats Escape and the lock loss pauses; without it, pause here.
      a.push({ type: g.screen ? "close" : "pause" });
      return;
    }
    // In space the ship's screen has its own keys (ui/SpaceScreen.tsx); only chat is the game's.
    if (g.screen?.kind === "space") {
      if (e.code === "KeyT" || e.code === "Enter" || e.code === "Slash") { a.push({ type: "chat", text: e.code === "Slash" ? "/" : undefined }); e.preventDefault(); }
      return;
    }
    if (e.code === "KeyE" && g.screen && g.screen.kind !== "chat" && g.screen.kind !== "pause" && g.screen.kind !== "options" && g.screen.kind !== "death" && g.screen.kind !== "share") {
      a.push({ type: "inventory" });
      e.preventDefault();
      return;
    }
    if (e.code === "KeyP" && g.screen?.kind === "party") {
      a.push({ type: "party" });
      e.preventDefault();
      return;
    }
    if (e.code === "KeyM" && g.screen?.kind === "map") {
      a.push({ type: "map" });
      e.preventDefault();
      return;
    }
    if (g.screen) return;
    if (MOVE_KEYS.has(e.code) || e.code.startsWith("F") || e.code === "Tab") e.preventDefault();
    if (e.repeat && !MOVE_KEYS.has(e.code)) return;
    const now = performance.now();
    if (e.code === "KeyW" && !e.repeat) {
      if (now - this.lastW < 280) this.sprintLatch = true;
      this.lastW = now;
    }
    if (e.code === "Space" && !e.repeat) {
      if (now - this.lastSpace < 300) a.push({ type: "toggleFly" });
      this.lastSpace = now;
    }
    if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat) this.sneakToggle = !this.sneakToggle;
    this.keys.add(e.code);
    this.apply();
    switch (e.code) {
      case "KeyE": a.push({ type: "inventory" }); this.exitLock(); break;
      case "KeyM": if (g.modOn("minimap")) { a.push({ type: "map" }); this.exitLock(); } break;
      case "KeyQ": a.push({ type: "drop", all: e.ctrlKey || e.metaKey }); break;
      case "KeyR": if (g.ridden() instanceof Car) a.push({ type: "radio" }); break;
      case "KeyP": if (g.critters.on) { a.push({ type: "party" }); this.exitLock(); } break;
      case "KeyT": case "Enter": a.push({ type: "chat" }); this.exitLock(); e.preventDefault(); break;
      case "Slash": a.push({ type: "chat", text: "/" }); this.exitLock(); e.preventDefault(); break;
      case "F1": a.push({ type: "hideHud" }); break;
      case "F2": a.push({ type: "screenshot" }); break;
      case "F3": a.push({ type: "debug" }); break;
      case "F5": a.push({ type: "perspective" }); break;
      case "F11":
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => {});
        break;
    }
    if (/^Digit[1-9]$/.test(e.code)) a.push({ type: "hotbar", slot: Number(e.code.slice(5)) - 1 });
  }

  private keyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    this.apply();
  }

  private mouseDown(e: MouseEvent): void {
    const g = this.game;
    g.audio.unlock();
    if (g.screen) return;
    if (!this.locked) {
      this.requestLock();
      return;
    }
    const c = g.controls;
    if (e.button === 0) c.attack = true;
    else if (e.button === 2) c.use = true;
    else if (e.button === 1) { c.actions.push({ type: "pickBlock" }); e.preventDefault(); }
  }

  private mouseUp(e: MouseEvent): void {
    const c = this.game.controls;
    if (e.button === 0) c.attack = false;
    else if (e.button === 2) c.use = false;
  }

  private mouseMove(e: MouseEvent): void {
    if (!this.locked || this.game.screen) return;
    const s = this.game.settings;
    // Roughly the original's feel at 100% sensitivity.
    const k = 0.0022 * s.sensitivity;
    const c = this.game.controls;
    c.lookX += e.movementX * k;
    c.lookY += e.movementY * k * (s.invertY ? -1 : 1);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.game.screen || !e.deltaY) return;
    this.game.controls.actions.push({ type: "scroll", delta: e.deltaY });
  }

  dispose(): void {
    this.exitLock();
    for (const d of this.disposers) d();
  }
}
