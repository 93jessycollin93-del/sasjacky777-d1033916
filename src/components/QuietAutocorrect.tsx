import { useEffect } from "react";
import { correctBeforeCaret, isAutocorrectOn } from "@/lib/autocorrect";

// One listener for the whole app. Passwords, emails, URLs and code fields are
// left alone — "fixing" those would break them.
const SKIP = new Set(["password", "email", "url", "number", "search"]);

export function QuietAutocorrect() {
  useEffect(() => {
    const onInput = (e: Event) => {
      const ie = e as InputEvent;
      if (!isAutocorrectOn() || ie.inputType !== "insertText") return;
      const el = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (!(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !SKIP.has(el.type)))) return;
      if (el.spellcheck === false || el.closest("[data-no-autocorrect]")) return;
      const caret = el.selectionStart ?? 0;
      const r = correctBeforeCaret(el.value, caret);
      if (!r) return;
      // Native setter so React's controlled inputs see the change.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, r.text);
      el.setSelectionRange(r.caret, r.caret);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);
  return null;
}
