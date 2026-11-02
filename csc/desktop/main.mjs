/**
 * The CollinSurvivalCraft desktop app: one window running the built game
 * (csc/dist, copied to ./app), plus the LAN relay for hosting friends.
 *
 * The game is served from a csc:// scheme rather than file://. Worlds live in
 * IndexedDB, which is keyed by origin, and file:// is not one Chromium will
 * treat as a stable origin for module workers and storage — a scheme of our
 * own is, and it stays the same across updates, so saved worlds survive them.
 * It is deliberately not marked secure: a secure page may not dial ws:// on
 * another machine, and that is exactly what joining a LAN game does.
 */
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startRelay } from "./relay.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.join(here, "app");
const ORIGIN = "csc://game";

protocol.registerSchemesAsPrivileged([
  { scheme: "csc", privileges: { standard: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// Two copies would fight over the same IndexedDB files; the second just brings the first forward.
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let relay = null;
let allowClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: "#000000",
    title: "CollinSurvivalCraft",
    icon: path.join(here, "build", "icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // A world keeps ticking (and a hosted world keeps serving guests) while the window is behind another.
      backgroundThrottling: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });
  // The close button asks the game to leave its world first, so the final save
  // is written; if the page does not answer (it crashed, say) the window still closes.
  win.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    win.webContents.send("csc:exit-request");
    setTimeout(() => { allowClose = true; win?.close(); }, 6000);
  });
  win.on("closed", () => { win = null; });
  void win.loadURL(`${ORIGIN}/index.html`);
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  protocol.handle("csc", (request) => {
    const { host, pathname } = new URL(request.url);
    const file = path.normalize(path.join(GAME, decodeURIComponent(pathname)));
    if (host !== "game" || !file.startsWith(GAME + path.sep)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  ipcMain.handle("csc:lan-start", async () => {
    relay ??= await startRelay();
    return { port: relay.port, addresses: relay.addresses };
  });
  ipcMain.on("csc:quit", () => {
    allowClose = true;
    app.quit();
  });

  // No menu bar on Windows and Linux (its accelerators would take the game's keys); macOS keeps its app menu for ⌘Q.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (!win) createWindow(); });
});

app.on("window-all-closed", () => {
  void relay?.close();
  relay = null;
  app.quit();
});
