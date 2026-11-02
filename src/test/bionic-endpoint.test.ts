import { describe, expect, it } from "vitest";
import { bionicEndpoint } from "../../supabase/functions/_shared/bionicEndpoint";

/**
 * What the operator pastes into BIONIC_BASE_URL.
 *
 * Three shapes turn up in roughly equal proportion, and from the chat two of
 * them used to be indistinguishable from the server being down: a 404 on the
 * wrong path reads exactly like an engine that is not there.
 */
describe("the Bionic endpoint", () => {
  it("adds the version prefix to a bare host", () => {
    expect(bionicEndpoint("https://bionic.example.com")).toBe(
      "https://bionic.example.com/v1/chat/completions",
    );
  });

  it("does not add a second one when the URL already carries it", () => {
    expect(bionicEndpoint("https://bionic.example.com/v1")).toBe(
      "https://bionic.example.com/v1/chat/completions",
    );
  });

  it("leaves a complete endpoint alone", () => {
    expect(bionicEndpoint("https://bionic.example.com/v1/chat/completions")).toBe(
      "https://bionic.example.com/v1/chat/completions",
    );
  });

  it("tolerates trailing slashes and stray whitespace", () => {
    expect(bionicEndpoint("  http://localhost:11434/v1/  ")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });
});
