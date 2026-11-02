/**
 * Listening, where the browser can.
 *
 * `VoiceRecorder` already exists and records audio to a blob for transcription
 * elsewhere. That is the wrong shape for a launcher: the pill needs the words
 * as they are spoken so it can match "Open Tasks" and move, and a round trip to
 * a transcription service would undo the whole point of a command list that
 * costs nothing.
 *
 * The Web Speech API gives that directly. It is genuinely available — Chrome,
 * Edge and Safari all implement it behind the `webkit` prefix or without —
 * and genuinely absent elsewhere, notably Firefox by default.
 *
 * So the one rule here: when it is absent, say so and show nothing. A dead
 * microphone button that does nothing when pressed is worse than no button,
 * because the person cannot tell whether they misheard themselves, whether
 * permission was denied, or whether the feature was never there.
 */

/** The slice of the API this uses. Declared because TS does not ship it. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function constructorFor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can listen at all. Never throws. */
export function speechSupported(): boolean {
  try {
    return constructorFor() !== null;
  } catch {
    return false;
  }
}

export interface ListenHandlers {
  /** Fired as the words firm up, so the input can fill in while speaking. */
  onPartial?: (text: string) => void;
  /** Fired once with the final transcript. */
  onFinal: (text: string) => void;
  /** A sentence a person can act on, not an error code. */
  onError: (message: string) => void;
}

export interface Listening {
  stop(): void;
}

/**
 * Starts listening. Returns a handle, or null when the browser cannot.
 *
 * Errors are translated rather than forwarded. `not-allowed` means the
 * microphone was refused and is fixed in site settings; `no-speech` means
 * nothing was heard and is fixed by speaking. Passing the raw code to a person
 * tells them neither.
 */
export function listenOnce(handlers: ListenHandlers): Listening | null {
  const Recognition = constructorFor();
  if (!Recognition) return null;

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Recognition();
  } catch {
    return null;
  }

  recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;

  let settled = false;
  // The final transcript is tracked here rather than by the caller. Web Speech
  // does not guarantee a distinct final result — in practice the last interim
  // *is* the transcript — so a caller left to remember it would have to
  // reimplement this in every place a microphone appears.
  let heard = "";

  recognition.onresult = (event) => {
    const results = Array.from({ length: event.results.length }, (_, i) => event.results[i]);
    const text = results.map((result) => result[0]?.transcript ?? "").join(" ").trim();
    if (!text) return;
    heard = text;
    handlers.onPartial?.(text);
  };

  recognition.onerror = (event) => {
    if (settled) return;
    settled = true;
    handlers.onError(describe(event.error));
  };

  recognition.onend = () => {
    if (settled) return;
    settled = true;
    if (heard) handlers.onFinal(heard);
    else handlers.onError(describe("no-speech"));
  };

  try {
    recognition.start();
  } catch {
    // Starting twice throws. Treat it as already listening rather than as a
    // failure worth telling anyone about.
    return { stop: () => recognition.abort() };
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

/** Turns a Web Speech error code into something worth reading. */
export function describe(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone was blocked. Allow it for this site and try again.";
    case "no-speech":
      return "Nothing was heard.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs a connection, and there is not one.";
    case "aborted":
      return "Stopped listening.";
    default:
      return `Could not listen: ${code}.`;
  }
}
