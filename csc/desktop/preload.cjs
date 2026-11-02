/**
 * The bridge between the desktop app and the game (csc/src/main.tsx reads it
 * as window.cscDesktop). Only these calls cross; the page gets no Node.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cscDesktop", {
  /** Starts the LAN relay (once) and says where friends can reach it. */
  lanStart: () => ipcRenderer.invoke("csc:lan-start"),
  /** Closes the app; the game calls it after its final save. */
  quit: () => ipcRenderer.send("csc:quit"),
  platform: process.platform,
});

// The window's close button: CraftApp listens for this and leaves its world (saving) before quitting.
ipcRenderer.on("csc:exit-request", () => window.dispatchEvent(new Event("csc:exit-request")));
