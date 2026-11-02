import { useState } from "react";
import { useLocalAIContext } from "@/providers/LocalAIProvider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LocalAITest() {
  const { run, reset, loading, error, result } = useLocalAIContext();
  const [prompt, setPrompt] = useState("Explain quantum computing in one sentence.");
  const [model, setModel] = useState("llama3.2:3b");

  return (
    <div className="min-h-screen bg-background p-6">
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Local AI Runtime Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Model</label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.2:3b" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Prompt</label>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => run(prompt, { model })} disabled={loading}>
              {loading ? "Running..." : "Run Local AI"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={loading}>
              Reset
            </Button>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {result && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>{result.model}</span>
                <span>{result.tokens} tokens</span>
              </div>
              <p className="whitespace-pre-wrap">{result.text}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
