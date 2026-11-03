// Quiet autocorrect: fixes only unambiguous misspellings, the moment a word
// ends. No pop-ups, no underlines — nothing appears over a tap target. The
// word list is the automatic layer; AI is a later, opt-in layer on top.
// extension/autocorrect.js carries a copy of FIXES; keep them in step.

export const FIXES: Record<string, string> = {
  teh: "the", adn: "and", taht: "that", thsi: "this", recieve: "receive",
  wich: "which", becuase: "because", beacuse: "because", definately: "definitely",
  seperate: "separate", occured: "occurred", untill: "until", wierd: "weird",
  thier: "their", freind: "friend", alot: "a lot", dont: "don't", cant: "can't",
  wont: "won't", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", im: "I'm",
  ive: "I've", youre: "you're", thats: "that's", whats: "what's", wasent: "wasn't",
  withought: "without", awnser: "answer", awnsers: "answers", knoledge: "knowledge",
  enviroment: "environment", embeded: "embedded", untill_: "until", tahts: "that's",
  coherant: "coherent", stabelize: "stabilize", recongnize: "recognize",
  easely: "easily", efficently: "efficiently", acheive: "achieve", goverment: "government",
  neccessary: "necessary", accomodate: "accommodate", tommorow: "tomorrow",
  begining: "beginning", beleive: "believe", calender: "calendar", existance: "existence",
};

const KEY = "jackie.autocorrect.on";
export const isAutocorrectOn = () => {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
};
export const setAutocorrectOn = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
};

/** Keeps the typist's capitalisation: "Teh" -> "The". */
export function correctWord(word: string): string | null {
  const fix = FIXES[word.toLowerCase()];
  if (!fix) return null;
  if (word === word.toUpperCase() && word.length > 1) return fix.toUpperCase();
  if (word[0] === word[0].toUpperCase()) return fix[0].toUpperCase() + fix.slice(1);
  return fix;
}

/** Corrects the word that ends right before `caret`, if a boundary was just typed. */
export function correctBeforeCaret(text: string, caret: number): { text: string; caret: number } | null {
  const boundary = text[caret - 1];
  if (!boundary || !/[\s.,!?;:]/.test(boundary)) return null;
  const m = /([A-Za-z]+)$/.exec(text.slice(0, caret - 1));
  if (!m) return null;
  const fix = correctWord(m[1]);
  if (!fix) return null;
  const start = caret - 1 - m[1].length;
  const out = text.slice(0, start) + fix + text.slice(caret - 1);
  return { text: out, caret: caret + fix.length - m[1].length };
}
