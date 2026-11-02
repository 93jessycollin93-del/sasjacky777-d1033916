import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Play, Image as ImageIcon, Film, Volume2, Brain, ExternalLink } from "lucide-react";

const FN = "jackie-xai-media";

const IMAGE_MODELS = [
  { id: "grok-imagine-image-quality", label: "Imagine · Quality" },
  { id: "grok-imagine-image-fast", label: "Imagine · Fast" },
  { id: "grok-2-image", label: "Grok 2 Image" },
];
const VOICES = ["eve", "leo", "rex", "nova", "sol"];
const REASONING_MODELS = ["grok-4.5", "grok-4-latest", "grok-3", "grok-3-mini"];

type Invoke = { data: unknown; error: string | null };

async function callXai(body: Record<string, unknown>): Promise<Invoke> {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (error) {
    const detail =
      data && typeof data === "object" && "error" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).error)
        : error.message;
    return { data: null, error: detail };
  }
  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    return { data: null, error: String((data as Record<string, unknown>).error) };
  }
  return { data, error: null };
}

function ErrorNote({ message }: { message: string }) {
  const needsKey = message.includes("XAI_API_KEY");
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
      {needsKey && (
        <a
          href="https://console.x.ai/"
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex items-center gap-1 underline"
        >
          Get an xAI key <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

export default function GrokStudio() {
  // ---- Reasoning -----------------------------------------------------------
  const [rModel, setRModel] = useState(REASONING_MODELS[0]);
  const [rSystem, setRSystem] = useState("You are Grok, a highly intelligent, helpful AI assistant.");
  const [rPrompt, setRPrompt] = useState(
    "Fix this function and explain the bug: function median(a){a.sort();return a[a.length/2]}",
  );
  const [rOut, setROut] = useState("");
  const [rBusy, setRBusy] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null);

  async function runRespond() {
    setRBusy(true);
    setRErr(null);
    setROut("");
    const input = rSystem.trim()
      ? [
          { role: "system", content: rSystem },
          { role: "user", content: rPrompt },
        ]
      : rPrompt;
    const { data, error } = await callXai({ action: "respond", model: rModel, input });
    if (error) setRErr(error);
    else setROut(extractResponseText(data));
    setRBusy(false);
  }

  // ---- Image ---------------------------------------------------------------
  const [iModel, setIModel] = useState(IMAGE_MODELS[0].id);
  const [iPrompt, setIPrompt] = useState("A collage of London landmarks in a stenciled street-art style");
  const [images, setImages] = useState<string[]>([]);
  const [iBusy, setIBusy] = useState(false);
  const [iErr, setIErr] = useState<string | null>(null);

  async function runImage() {
    setIBusy(true);
    setIErr(null);
    setImages([]);
    const { data, error } = await callXai({ action: "image", model: iModel, prompt: iPrompt });
    if (error) setIErr(error);
    else {
      const list = (data as { data?: Array<{ url?: string; b64_json?: string }> })?.data ?? [];
      setImages(
        list
          .map((d) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : ""))
          .filter(Boolean),
      );
    }
    setIBusy(false);
  }

  // ---- Video ---------------------------------------------------------------
  const [vPrompt, setVPrompt] = useState("A glowing crystal-powered rocket launching from Mars");
  const [vStatus, setVStatus] = useState<string | null>(null);
  const [vUrl, setVUrl] = useState<string | null>(null);
  const [vBusy, setVBusy] = useState(false);
  const [vErr, setVErr] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  async function runVideo() {
    setVBusy(true);
    setVErr(null);
    setVUrl(null);
    setVStatus("starting");
    const { data, error } = await callXai({ action: "video_start", prompt: vPrompt });
    if (error) {
      setVErr(error);
      setVStatus(null);
      setVBusy(false);
      return;
    }
    const requestId = (data as { request_id?: string })?.request_id;
    if (!requestId) {
      setVErr("xAI did not return a request_id");
      setVStatus(null);
      setVBusy(false);
      return;
    }
    setVStatus("queued");
    pollRef.current = window.setInterval(async () => {
      const res = await callXai({ action: "video_status", request_id: requestId });
      if (res.error) {
        setVErr(res.error);
        setVStatus(null);
        setVBusy(false);
        if (pollRef.current) window.clearInterval(pollRef.current);
        return;
      }
      const payload = res.data as { status?: string; video?: { url?: string } };
      setVStatus(payload.status ?? "pending");
      if (payload.status === "done") {
        setVUrl(payload.video?.url ?? null);
        setVBusy(false);
        if (pollRef.current) window.clearInterval(pollRef.current);
      } else if (payload.status === "failed" || payload.status === "expired") {
        setVErr(`Video ${payload.status}`);
        setVBusy(false);
        if (pollRef.current) window.clearInterval(pollRef.current);
      }
    }, 5000);
  }

  // ---- TTS -----------------------------------------------------------------
  const [tText, setTText] = useState("Hello! Welcome to the xAI Text to Speech API.");
  const [tVoice, setTVoice] = useState(VOICES[0]);
  const [tLang, setTLang] = useState("en");
  const [tUrl, setTUrl] = useState<string | null>(null);
  const [tBusy, setTBusy] = useState(false);
  const [tErr, setTErr] = useState<string | null>(null);

  async function runTts() {
    setTBusy(true);
    setTErr(null);
    setTUrl(null);
    const { data, error } = await supabase.functions.invoke(FN, {
      body: { action: "tts", text: tText, voice_id: tVoice, language: tLang },
    });
    if (error) {
      setTErr(error.message);
    } else if (data instanceof Blob) {
      setTUrl(URL.createObjectURL(data));
    } else if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
      setTErr(String((data as Record<string, unknown>).error));
    } else {
      setTErr("Unexpected TTS response");
    }
    setTBusy(false);
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/" aria-label="Back to home">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Grok Studio</h1>
            <p className="text-sm text-muted-foreground">
              Direct xAI surface — reasoning, images, video and speech. Requests are proxied
              server-side; your key never reaches the browser.
            </p>
          </div>
          <Badge variant="outline" className="ml-auto shrink-0">XAI_API_KEY</Badge>
        </div>

        <Tabs defaultValue="reason">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="reason"><Brain className="mr-1 h-4 w-4" />Reason</TabsTrigger>
            <TabsTrigger value="image"><ImageIcon className="mr-1 h-4 w-4" />Image</TabsTrigger>
            <TabsTrigger value="video"><Film className="mr-1 h-4 w-4" />Video</TabsTrigger>
            <TabsTrigger value="tts"><Volume2 className="mr-1 h-4 w-4" />Speech</TabsTrigger>
          </TabsList>

          <TabsContent value="reason">
            <Card className="space-y-3 p-4">
              <Select value={rModel} onValueChange={setRModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONING_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={rSystem} onChange={(e) => setRSystem(e.target.value)} placeholder="System instruction (optional)" />
              <Textarea rows={4} value={rPrompt} onChange={(e) => setRPrompt(e.target.value)} />
              <Button onClick={runRespond} disabled={rBusy || !rPrompt.trim()}>
                {rBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run responses API
              </Button>
              {rErr && <ErrorNote message={rErr} />}
              {rOut && (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{rOut}</pre>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="image">
            <Card className="space-y-3 p-4">
              <Select value={iModel} onValueChange={setIModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMAGE_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea rows={3} value={iPrompt} onChange={(e) => setIPrompt(e.target.value)} />
              <Button onClick={runImage} disabled={iBusy || !iPrompt.trim()}>
                {iBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                Generate image
              </Button>
              {iErr && <ErrorNote message={iErr} />}
              <div className="grid gap-3 sm:grid-cols-2">
                {images.map((src) => (
                  <img key={src} src={src} alt={iPrompt} loading="lazy" className="w-full rounded-md border" />
                ))}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="video">
            <Card className="space-y-3 p-4">
              <Textarea rows={3} value={vPrompt} onChange={(e) => setVPrompt(e.target.value)} />
              <Button onClick={runVideo} disabled={vBusy || !vPrompt.trim()}>
                {vBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}
                Generate video
              </Button>
              {vStatus && (
                <p className="text-sm text-muted-foreground">
                  Status: <span className="font-mono">{vStatus}</span> — polled every 5s.
                </p>
              )}
              {vErr && <ErrorNote message={vErr} />}
              {vUrl && <video src={vUrl} controls className="w-full rounded-md border" />}
            </Card>
          </TabsContent>

          <TabsContent value="tts">
            <Card className="space-y-3 p-4">
              <Textarea rows={3} value={tText} onChange={(e) => setTText(e.target.value)} />
              <div className="flex gap-3">
                <Select value={tVoice} onValueChange={setTVoice}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VOICES.map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input className="w-28" value={tLang} onChange={(e) => setTLang(e.target.value)} aria-label="Language code" />
              </div>
              <Button onClick={runTts} disabled={tBusy || !tText.trim()}>
                {tBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Volume2 className="mr-2 h-4 w-4" />}
                Speak
              </Button>
              {tErr && <ErrorNote message={tErr} />}
              {tUrl && <audio src={tUrl} controls className="w-full" />}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/** The responses API returns nested output items; pull out the text parts. */
function extractResponseText(data: unknown): string {
  const d = data as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };
  if (typeof d?.output_text === "string" && d.output_text) return d.output_text;
  const parts =
    d?.output?.flatMap((item) => (item.content ?? []).map((c) => c.text ?? "")).filter(Boolean) ?? [];
  return parts.length ? parts.join("\n\n") : JSON.stringify(data, null, 2);
}
