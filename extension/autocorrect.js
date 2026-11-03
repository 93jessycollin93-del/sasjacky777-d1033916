// Copy of src/lib/autocorrect.ts FIXES. Runs locally; sends nothing anywhere.
const FIXES = {
  teh: "the", adn: "and", taht: "that", thsi: "this", recieve: "receive",
  wich: "which", becuase: "because", beacuse: "because", definately: "definitely",
  seperate: "separate", occured: "occurred", untill: "until", wierd: "weird",
  thier: "their", freind: "friend", alot: "a lot", dont: "don't", cant: "can't",
  wont: "won't", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", im: "I'm",
  ive: "I've", youre: "you're", thats: "that's", whats: "what's", wasent: "wasn't",
  withought: "without", awnser: "answer", awnsers: "answers", knoledge: "knowledge",
  enviroment: "environment", embeded: "embedded", tahts: "that's",
  coherant: "coherent", stabelize: "stabilize", recongnize: "recognize",
  easely: "easily", efficently: "efficiently", acheive: "achieve", goverment: "government",
  neccessary: "necessary", accomodate: "accommodate", tommorow: "tomorrow",
  begining: "beginning", beleive: "believe", calender: "calendar", existance: "existence",
};
let on = true;
chrome.storage.local.get({ on: true }, (s) => { on = s.on; });
chrome.storage.onChanged.addListener((c) => { if (c.on) on = c.on.newValue; });
const SKIP = new Set(["password","email","url","number","search"]);
function fixWord(w){const f=FIXES[w.toLowerCase()];if(!f)return null;if(w.length>1&&w===w.toUpperCase())return f.toUpperCase();return w[0]===w[0].toUpperCase()?f[0].toUpperCase()+f.slice(1):f;}
document.addEventListener("input",(e)=>{
  if(!on||e.inputType!=="insertText")return;
  const el=e.target;
  if(!(el instanceof HTMLTextAreaElement||(el instanceof HTMLInputElement&&!SKIP.has(el.type))))return;
  if(el.spellcheck===false)return;
  const c=el.selectionStart??0,t=el.value,b=t[c-1];
  if(!b||!/[\s.,!?;:]/.test(b))return;
  const m=/([A-Za-z]+)$/.exec(t.slice(0,c-1));if(!m)return;
  const f=fixWord(m[1]);if(!f)return;
  const s=c-1-m[1].length;
  const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(p,"value").set.call(el,t.slice(0,s)+f+t.slice(c-1));
  const n=c+f.length-m[1].length;el.setSelectionRange(n,n);
  el.dispatchEvent(new Event("input",{bubbles:true}));
},true);

// AI layer hand-off: remember exactly what was highlighted, so the fix lands
// on that text and nowhere else.
let held = null;
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "aifix-start") {
    const el = document.activeElement;
    if ((el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.selectionEnd > el.selectionStart) {
      held = { el, s: el.selectionStart, e: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) };
    } else {
      const sel = getSelection(); const t = sel ? String(sel) : "";
      held = t && sel.rangeCount ? { range: sel.getRangeAt(0).cloneRange(), text: t } : null;
    }
    reply(held ? { text: held.text } : {});
  } else if (msg.type === "aifix-apply" && held) {
    if (held.el) {
      const { el, s, e } = held;
      if (el.value.slice(s, e) === held.text) { el.setRangeText(msg.text, s, e, "end"); el.dispatchEvent(new Event("input", { bubbles: true })); }
    } else if (held.range.commonAncestorContainer.parentElement?.isContentEditable) {
      held.range.deleteContents(); held.range.insertNode(document.createTextNode(msg.text));
    }
    held = null;
  }
});
