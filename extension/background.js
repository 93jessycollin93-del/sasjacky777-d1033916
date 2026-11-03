// AI layer: only runs when you ask (Alt+J or right-click), never on its own,
// and only talks to models on this computer — LM Studio or Ollama.
const ENGINES = [
  { name: "LM Studio", url: "http://127.0.0.1:1234/v1/chat/completions" },
  { name: "Ollama", url: "http://localhost:11434/v1/chat/completions" },
];
const PROMPT = "Fix only spelling and obvious typos. Keep every word, meaning and punctuation otherwise. Reply with the corrected text only.";

async function aiFix(text) {
  const { model = "bonsai" } = await chrome.storage.local.get("model");
  const tried = [];
  for (const e of ENGINES) {
    try {
      const r = await fetch(e.url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0, max_tokens: Math.min(2048, text.length * 2 + 32),
          messages: [{ role: "system", content: PROMPT }, { role: "user", content: text }] }) });
      if (!r.ok) { tried.push(`${e.name}: HTTP ${r.status}`); continue; }
      const out = (await r.json())?.choices?.[0]?.message?.content?.trim();
      if (!out) { tried.push(`${e.name}: empty reply`); continue; }
      // A typo fix never changes length much; a rewrite or a chatty reply is refused.
      if (out.length > text.length * 1.3 + 10 || out.length < text.length * 0.7 - 10)
        { tried.push(`${e.name}: reply rewrote the text, refused`); continue; }
      return { ok: true, text: out, engine: e.name };
    } catch { tried.push(`${e.name}: not running`); }
  }
  return { ok: false, error: `No local model fixed it — ${tried.join("; ")}` };
}

async function run(tabId) {
  await chrome.action.setBadgeText({ tabId, text: "…" });
  const res = await chrome.tabs.sendMessage(tabId, { type: "aifix-start" }).catch(() => null);
  if (!res?.text) return chrome.action.setBadgeText({ tabId, text: "" });
  const fix = await aiFix(res.text);
  await chrome.storage.local.set({ last: fix.ok ? `Fixed by ${fix.engine}` : fix.error });
  if (fix.ok) await chrome.tabs.sendMessage(tabId, { type: "aifix-apply", text: fix.text });
  chrome.action.setBadgeText({ tabId, text: fix.ok ? "" : "!" });
}

chrome.runtime.onInstalled.addListener(() =>
  chrome.contextMenus.create({ id: "ai-fix", title: "Fix with Bonsai", contexts: ["selection", "editable"] }));
chrome.contextMenus.onClicked.addListener((_, tab) => tab?.id && run(tab.id));
chrome.commands.onCommand.addListener(async (c) => {
  if (c !== "ai-fix") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) run(tab.id);
});
