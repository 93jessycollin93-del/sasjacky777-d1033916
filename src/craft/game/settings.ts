/**
 * Player options, kept in this browser.
 *
 * Defaults depend on the device: a phone starts with a shorter render
 * distance, a capped pixel ratio and touch controls, because the first
 * impression on a phone that overheats in two minutes is the only impression.
 * Everything can be changed in Options, and "auto" controls re-detect on each
 * launch so a tablet with a keyboard attached gets the keyboard.
 */
export type ControlScheme = "auto" | "desktop" | "mobile";

export interface Settings {
  renderDistance: number;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  graphics: "fancy" | "fast";
  smoothLighting: boolean;
  clouds: boolean;
  particles: "all" | "decreased" | "minimal";
  viewBobbing: boolean;
  brightness: number;
  guiScale: number;
  maxPixelRatio: number;
  masterVolume: number;
  musicVolume: number;
  soundVolume: number;
  controls: ControlScheme;
  /** Touch: "buttons" = crosshair with attack/use buttons; "tap" = tap where you want to act. */
  touchMode: "buttons" | "tap";
  autoJump: boolean;
  touchOpacity: number;
  touchScale: number;
  showCoordinates: boolean;
  showFps: boolean;
  playerName: string;
  skin: number;
  toggleSprint: boolean;
  toggleSneak: boolean;
}

const KEY = "blockcraft.settings.v1";

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const fine = window.matchMedia?.("(pointer: fine)").matches ?? false;
  return (coarse && !fine) || (("ontouchstart" in window || navigator.maxTouchPoints > 0) && !fine);
}

export function defaultSettings(): Settings {
  const touch = isTouchDevice();
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return {
    renderDistance: touch ? 4 : cores >= 8 ? 8 : 6,
    fov: 70,
    sensitivity: 1,
    invertY: false,
    graphics: touch ? "fast" : "fancy",
    smoothLighting: true,
    clouds: true,
    particles: touch ? "decreased" : "all",
    viewBobbing: true,
    brightness: 0.35,
    guiScale: 0,
    maxPixelRatio: touch ? 1.5 : 2,
    masterVolume: 0.8,
    musicVolume: 0.5,
    soundVolume: 1,
    controls: "auto",
    touchMode: "buttons",
    autoJump: touch,
    touchOpacity: 0.55,
    touchScale: 1,
    showCoordinates: true,
    showFps: false,
    playerName: "",
    skin: Math.floor(Math.random() * 32),
    toggleSprint: false,
    toggleSneak: false,
  };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      const merged = { ...base };
      for (const k of Object.keys(base) as (keyof Settings)[]) {
        if (saved[k] !== undefined && typeof saved[k] === typeof base[k]) (merged as Record<string, unknown>)[k] = saved[k];
      }
      merged.renderDistance = Math.max(2, Math.min(16, merged.renderDistance));
      return merged;
    }
  } catch {
    /* corrupt or blocked storage: use defaults */
  }
  return base;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

/** Resolves "auto" to what this device actually is. */
export function effectiveControls(s: Settings): "desktop" | "mobile" {
  if (s.controls !== "auto") return s.controls;
  return isTouchDevice() ? "mobile" : "desktop";
}
