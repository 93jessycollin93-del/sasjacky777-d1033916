/**
 * The game's look: bevelled stone buttons, dark translucent panels, slot
 * wells, bold monospace text with a drop shadow. Scoped under .bc-root so
 * none of it leaks into the rest of the app, and sized from one variable
 * (--u, a "GUI pixel") so GUI scale is a single number.
 */
export const THEME_CSS = `
.bc-root {
  --u: 2px;
  --slot: calc(var(--u) * 18);
  position: fixed; inset: 0; z-index: 100; overflow: hidden;
  background: #000; color: #fff;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  font-weight: 700; letter-spacing: 0.02em;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  touch-action: none; overscroll-behavior: none;
}
.bc-root * { box-sizing: border-box; }
.bc-shadow { text-shadow: calc(var(--u) * 0.6) calc(var(--u) * 0.6) 0 #3f3f3f; }
.bc-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; image-rendering: pixelated; }
.bc-btn {
  display: flex; align-items: center; justify-content: center; gap: 0.5em;
  min-height: calc(var(--u) * 20); padding: 0 calc(var(--u) * 6);
  color: #e0e0e0; font: inherit; font-size: calc(var(--u) * 7.5);
  background: linear-gradient(#8b8b8b, #6f6f6f);
  border: calc(var(--u) * 1) solid #000;
  box-shadow: inset calc(var(--u) * 1) calc(var(--u) * 1) 0 #aaa, inset calc(var(--u) * -1) calc(var(--u) * -1) 0 #555;
  text-shadow: calc(var(--u) * 0.6) calc(var(--u) * 0.6) 0 #383838;
  cursor: pointer; touch-action: manipulation;
}
.bc-btn:hover:not(:disabled), .bc-btn:focus-visible { background: linear-gradient(#7d8fc9, #5c6ea8); color: #ffffa0; outline: none; }
.bc-btn:active:not(:disabled) { transform: translateY(1px); }
.bc-btn:disabled { color: #a0a0a0; background: #4a4a4a; cursor: default; box-shadow: none; }
.bc-btn.bc-danger:hover:not(:disabled) { background: linear-gradient(#c96b6b, #a85252); }
.bc-panel {
  background: #c6c6c6; color: #3f3f3f;
  border: calc(var(--u) * 1) solid #000;
  box-shadow: inset calc(var(--u) * 1.5) calc(var(--u) * 1.5) 0 #fff, inset calc(var(--u) * -1.5) calc(var(--u) * -1.5) 0 #555;
  border-radius: calc(var(--u) * 1.5);
  padding: calc(var(--u) * 6);
}
.bc-panel .bc-label { color: #3f3f3f; font-size: calc(var(--u) * 6.5); text-shadow: none; }
.bc-dark { background: rgba(0,0,0,0.55); }
.bc-dim { position: absolute; inset: 0; background: rgba(16,16,24,0.62); }
.bc-slot {
  position: relative; width: var(--slot); height: var(--slot); flex: none;
  background: #8b8b8b;
  box-shadow: inset calc(var(--u) * 1) calc(var(--u) * 1) 0 #373737, inset calc(var(--u) * -1) calc(var(--u) * -1) 0 #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.bc-slot:hover { background: #a8a8a8; }
.bc-slot img, .bc-icon { width: calc(var(--u) * 16); height: calc(var(--u) * 16); image-rendering: pixelated; pointer-events: none; }
.bc-count {
  position: absolute; right: calc(var(--u) * 0.5); bottom: calc(var(--u) * -0.5);
  font-size: calc(var(--u) * 7); color: #fff; text-shadow: calc(var(--u) * 0.6) calc(var(--u) * 0.6) 0 #3f3f3f; pointer-events: none;
}
.bc-dura { position: absolute; left: calc(var(--u) * 2); right: calc(var(--u) * 2); bottom: calc(var(--u) * 2); height: calc(var(--u) * 1.5); background: #000; pointer-events: none; }
.bc-dura > div { height: 100%; }
.bc-input {
  width: 100%; min-height: calc(var(--u) * 20); padding: 0 calc(var(--u) * 4);
  background: #000; color: #e0e0e0; font: inherit; font-size: calc(var(--u) * 7);
  border: calc(var(--u) * 1) solid #a0a0a0; outline: none;
}
.bc-input:focus { border-color: #fff; }
.bc-title { font-size: calc(var(--u) * 10); color: #fff; }
.bc-sub { font-size: calc(var(--u) * 6); color: #a0a0a0; }
.bc-hotbar { display: flex; padding: calc(var(--u) * 1); background: rgba(0,0,0,0.45); border: calc(var(--u) * 1) solid #111; }
.bc-hotbar .bc-hslot { position: relative; width: calc(var(--u) * 20); height: calc(var(--u) * 20); display: flex; align-items: center; justify-content: center; border: calc(var(--u) * 1) solid rgba(100,100,100,0.7); }
.bc-hotbar .bc-hslot.sel { outline: calc(var(--u) * 1.5) solid #fff; outline-offset: calc(var(--u) * -0.5); z-index: 1; box-shadow: 0 0 0 calc(var(--u) * 1) #000; }
.bc-glyph { width: calc(var(--u) * 8); height: calc(var(--u) * 8); image-rendering: pixelated; }
.bc-tooltip {
  position: fixed; z-index: 200; pointer-events: none; padding: calc(var(--u) * 3) calc(var(--u) * 4);
  background: rgba(16,0,16,0.94); border: calc(var(--u) * 1) solid #2a0a5a; color: #fff; font-size: calc(var(--u) * 6.5);
}
.bc-scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
.bc-scroll::-webkit-scrollbar { width: calc(var(--u) * 4); }
.bc-scroll::-webkit-scrollbar-thumb { background: #6f6f6f; }
.bc-list-item { display: flex; gap: calc(var(--u) * 4); align-items: center; padding: calc(var(--u) * 3); border: calc(var(--u) * 1) solid transparent; cursor: pointer; }
.bc-list-item.sel { border-color: #fff; background: rgba(0,0,0,0.35); }
.bc-list-item:hover { background: rgba(255,255,255,0.06); }
.bc-toggle { display: flex; justify-content: space-between; }
.bc-touch-btn {
  position: absolute; display: flex; align-items: center; justify-content: center;
  background: rgba(40,40,40,0.55); border: 2px solid rgba(255,255,255,0.35); border-radius: 10px;
  color: #fff; font-size: 14px; touch-action: none;
}
.bc-touch-btn.on { background: rgba(120,160,255,0.55); }
@keyframes bc-toast { 0% { transform: translateX(110%) } 8% { transform: translateX(0) } 88% { transform: translateX(0) } 100% { transform: translateX(110%) } }
@keyframes bc-fadeout { 0% { opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }
@keyframes bc-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.12) } }
@keyframes bc-blink { 0%, 100% { opacity: 0.3 } 50% { opacity: 0.95 } }
.bc-glint {
  position: absolute; width: calc(var(--u) * 16); height: calc(var(--u) * 16); pointer-events: none;
  background:
    linear-gradient(115deg, transparent 30%, rgba(200,140,255,0.85) 45%, rgba(140,80,255,0.25) 55%, transparent 70%),
    linear-gradient(rgba(128,64,255,0.22), rgba(128,64,255,0.22));
  background-size: 300% 300%, 100% 100%; animation: bc-glint 3.2s linear infinite; mix-blend-mode: screen;
  -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
}
@keyframes bc-glint { from { background-position: 150% 0, 0 0 } to { background-position: -150% 0, 0 0 } }
.bc-offer {
  display: flex; align-items: center; gap: calc(var(--u) * 4); width: calc(var(--u) * 108); min-height: calc(var(--u) * 19);
  padding: 0 calc(var(--u) * 3); background: #8d6e63; border: calc(var(--u) * 1) solid #3a2a24; color: #e8d8b0; cursor: pointer;
  font-size: calc(var(--u) * 5.5); text-align: left;
}
.bc-offer:hover:not(:disabled) { background: #a1887f; }
.bc-offer:disabled { background: #5d4a44; color: #7a6a60; cursor: default; }
.bc-offer .lvl { color: #80ff20; font-size: calc(var(--u) * 7); min-width: calc(var(--u) * 12); text-align: right; }
.bc-offer:disabled .lvl { color: #407010; }
.bc-rune { font-family: serif; letter-spacing: 0.08em; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
`;
