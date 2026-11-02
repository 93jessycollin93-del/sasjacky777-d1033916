import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  EMBEDDING_TIERS,
  fetchRepo,
  MODEL_QUEUE,
  modelUrl,
  QUEUE_PHASES,
  queued,
} from "@/lib/microai/modelQueue";
import { DEVICE_MODELS, findDeviceModel } from "@/lib/microai/deviceModels";
import { getChatPreset } from "@/lib/jackie-preset";
import ModelQueue from "@/pages/ModelQueue";

/**
 * The owner's 180-model download queue, as the app and the rig both read it.
 *
 * One file, two readers: if the page and the downloader could name different
 * repositories for the same model, the page would describe a download the rig
 * does not do. And the chat models the On-device engine offers are the same
 * entries, so their repositories must agree with the engine's too.
 */

const FOLDERS = new Set([
  "text/tiny", "text/instruct", "text/coding", "text/reasoning", "text/classification",
  "embeddings/fast", "embeddings/balanced", "embeddings/quality",
  "audio/vad", "audio/whisper", "audio/speaker", "audio/tts", "audio/music", "audio/classification",
  "vision/classification", "vision/detection", "vision/segmentation", "vision/depth", "vision/embeddings",
  "multimodal/captioning", "multimodal/vlm", "multimodal/ocr", "multimodal/documents", "multimodal/generation",
]);

describe("the download queue", () => {
  it("has all 180 entries, numbered once and in order", () => {
    expect(MODEL_QUEUE.map((m) => m.queue)).toEqual(Array.from({ length: 180 }, (_, i) => i + 1));
  });

  it("files every model under the documented models/ layout", () => {
    for (const m of MODEL_QUEUE) expect(FOLDERS.has(m.folder), `#${m.queue} ${m.folder}`).toBe(true);
  });

  it("points every phase and embedding tier at real entries", () => {
    for (const list of [...Object.values(QUEUE_PHASES), ...Object.values(EMBEDDING_TIERS)]) {
      for (const n of list) expect(queued(n), `#${n}`).toBeDefined();
    }
  });

  it("names where to get every model published outside Hugging Face, and fetches nothing for it", () => {
    for (const m of MODEL_QUEUE.filter((m) => m.repo === null)) {
      expect(fetchRepo(m)).toBeNull();
      expect(m.source, `#${m.queue}`).toMatch(/^https:\/\//);
      expect(modelUrl(m)).toBe(m.source);
    }
  });

  it("says why for every id it corrects", () => {
    for (const m of MODEL_QUEUE.filter((m) => m.repo !== undefined)) expect(m.note, `#${m.queue}`).toBeTruthy();
  });

  it("marks a repeat as the same model as the earlier entry", () => {
    for (const m of MODEL_QUEUE.filter((m) => m.duplicateOf)) expect(queued(m.duplicateOf!)?.id).toBe(m.id);
  });
});

describe("the queue's models that run in this app", () => {
  it("are exactly the On-device engine's models, Bonsai aside", () => {
    const fromQueue = MODEL_QUEUE.filter((m) => m.device).map((m) => m.device).sort();
    const fromEngine = DEVICE_MODELS.filter((m) => m.queue).map((m) => m.id).sort();
    expect(fromQueue).toEqual(fromEngine);
  });

  it("agree with the engine on queue number, repositories and quantizations", () => {
    for (const entry of MODEL_QUEUE.filter((m) => m.device)) {
      const spec = findDeviceModel(entry.device)!;
      expect(spec.queue, entry.device).toBe(entry.queue);
      expect(entry.gguf?.repos, entry.device).toEqual(spec.repos);
      expect(entry.gguf?.quants, entry.device).toEqual(spec.quants);
    }
  });
});

describe("the /models page", () => {
  afterEach(() => localStorage.clear());

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/models"]}>
        <Routes>
          <Route path="/models" element={<ModelQueue />} />
          <Route path="/" element={<p>the chat</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("lists every entry, and filters to a phase in the queue's own order", () => {
    renderPage();
    expect(screen.getByRole("status").textContent).toBe("180 models");
    fireEvent.click(screen.getByRole("tab", { name: "Phase 1" }));
    expect(screen.getByRole("status").textContent).toBe("15 models");
    const order = screen.getAllByRole("listitem").map((li) => Number(li.getAttribute("data-queue")));
    expect(order).toEqual(QUEUE_PHASES["1"]);
  });

  it("shows what to fetch instead of an id that does not exist as written", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Search the queue"), { target: { value: "Florence-2-small" } });
    const first = screen.getAllByRole("listitem")[0];
    expect(within(first).getByText(/microsoft\/Florence-2-base/)).toBeTruthy();
  });

  it("opens the chat on a model that runs here", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Runs in this app" }));
    expect(screen.getByRole("status").textContent).toBe("6 models");
    fireEvent.click(screen.getByRole("button", { name: "Use SmolLM2 360M Instruct in the chat" }));
    expect(screen.getByText("the chat")).toBeTruthy();
    expect(getChatPreset()).toMatchObject({ engine: "device", model: "smollm2-360m-instruct" });
  });
});
