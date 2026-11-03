import { describe, it, expect } from "vitest";
import { correctBeforeCaret, correctWord } from "@/lib/autocorrect";
import { readFileSync } from "node:fs";

describe("quiet autocorrect", () => {
  it("fixes a known misspelling the moment the word ends", () => {
    expect(correctBeforeCaret("teh ", 4)).toEqual({ text: "the ", caret: 4 });
  });
  it("leaves a word alone while it is still being typed", () => {
    expect(correctBeforeCaret("teh", 3)).toBeNull();
  });
  it("never touches a word it is not sure about", () => {
    expect(correctBeforeCaret("jacky ", 6)).toBeNull();
  });
  it("keeps the typist's capitalisation", () => {
    expect(correctWord("Teh")).toBe("The");
  });
  it("the extension carries every fix the app does", () => {
    const ext = readFileSync("extension/autocorrect.js", "utf8");
    expect(ext).toContain('wasent: "wasn\'t"');
    expect(ext).toContain('teh: "the"');
  });
});
