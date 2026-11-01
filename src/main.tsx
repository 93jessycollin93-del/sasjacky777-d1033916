import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { bootstrapPWA } from "./pwa/register";

// After a publish, an open tab (or a cached service-worker shell) still asks
// for the previous build's page chunks, which no longer exist on the host.
// The browser reports "Importing a module script failed" and the screen goes
// blank. Reload once to fetch the new build; the session flag stops a loop if
// the chunk is genuinely broken, so that failure still surfaces.
const RELOAD_FLAG = "jacky.chunkReload.v1";
const isChunkError = (msg: string) =>
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg);
const recover = () => {
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  window.location.reload();
};
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  recover();
});
window.addEventListener("unhandledrejection", (e) => {
  if (isChunkError(String(e.reason?.message ?? e.reason))) recover();
});
window.addEventListener("error", (e) => {
  if (isChunkError(String(e.message))) recover();
});
// A load that got this far without failing clears the guard for next time.
window.setTimeout(() => sessionStorage.removeItem(RELOAD_FLAG), 10_000);

createRoot(document.getElementById("root")!).render(<App />);
bootstrapPWA();
