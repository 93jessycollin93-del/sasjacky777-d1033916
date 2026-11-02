import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const python = `# router_node.py — poll for jobs and reply
import os, time, requests

BASE = "${SUPABASE_URL}/functions/v1"
ROUTER_ID = os.environ["ROUTER_ID"]
SECRET    = os.environ["ROUTER_SECRET"]

def handle(job):
    # YOUR TERRITORY: call whatever backend matches job["capability_required"].
    # Groq, Ollama, Playwright to chatgpt.com — up to you.
    return f"echo: {job['prompt']}"

while True:
    try:
        r = requests.post(f"{BASE}/router-poll",
            json={"router_id": ROUTER_ID, "secret": SECRET}, timeout=15).json()
        job = r.get("job")
        if job:
            try:
                result = handle(job)
                ack = requests.post(f"{BASE}/router-result",
                    json={"router_id": ROUTER_ID, "secret": SECRET,
                          "job_id": job["id"], "result": result})
            except Exception as e:
                ack = requests.post(f"{BASE}/router-result",
                    json={"router_id": ROUTER_ID, "secret": SECRET,
                          "job_id": job["id"], "error": str(e)})
            # 404 means the job is no longer this router's to finish. Say so:
            # dropping it quietly loses the answer you just spent the GPU on.
            if ack.status_code != 200:
                print("result rejected:", ack.status_code, ack.text)
        else:
            time.sleep(2)
    except Exception as e:
        print("poll error:", e); time.sleep(5)
`;

const node = `// router_node.mjs
const BASE = "${SUPABASE_URL}/functions/v1";
const { ROUTER_ID, ROUTER_SECRET } = process.env;

async function handle(job) {
  // YOUR TERRITORY.
  return "echo: " + job.prompt;
}

while (true) {
  try {
    const r = await fetch(BASE + "/router-poll", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ router_id: ROUTER_ID, secret: ROUTER_SECRET })
    }).then(r => r.json());
    if (r.job) {
      let ack;
      try {
        const result = await handle(r.job);
        ack = await fetch(BASE + "/router-result", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ router_id: ROUTER_ID, secret: ROUTER_SECRET, job_id: r.job.id, result })
        });
      } catch (e) {
        ack = await fetch(BASE + "/router-result", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ router_id: ROUTER_ID, secret: ROUTER_SECRET, job_id: r.job.id, error: String(e) })
        });
      }
      // 404 means the job is no longer this router's to finish. Say so:
      // dropping it quietly loses the answer you just spent the GPU on.
      if (!ack.ok) console.error("result rejected:", ack.status, await ack.text());
    } else await new Promise(r => setTimeout(r, 2000));
  } catch (e) { console.error(e); await new Promise(r => setTimeout(r, 5000)); }
}
`;

const bash = `# One-shot poll (bash + curl + jq)
curl -sX POST "${SUPABASE_URL}/functions/v1/router-poll" \\
  -H "Content-Type: application/json" \\
  -d "{\\"router_id\\":\\"$ROUTER_ID\\",\\"secret\\":\\"$ROUTER_SECRET\\"}"
`;

const Block = ({ title, code }: { title: string; code: string }) => (
  <Card className="p-4 bg-slate-900 border-slate-700">
    <div className="flex items-center justify-between mb-2">
      <h3 className="font-medium">{title}</h3>
      <button className="text-xs text-primary" onClick={() => navigator.clipboard.writeText(code)}>copy</button>
    </div>
    <pre className="text-xs overflow-auto bg-slate-950 p-3 rounded"><code>{code}</code></pre>
  </Card>
);

export default function RouterMeshDocs() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <Link to="/mesh" className="text-sm text-primary underline">← Back to mesh</Link>
          <h1 className="text-2xl font-bold mt-2">Router Mesh — Protocol</h1>
          <p className="text-sm text-slate-400">Three HTTP endpoints. Raw JSON. Build the router in any language you want.</p>
        </div>

        <Card className="p-4 bg-slate-900 border-slate-700 space-y-2 text-sm">
          <p><b>1. Register</b> (called once from the app) → returns <code>router_id</code> + <code>secret</code>.</p>
          <p><b>2. Poll</b> <code>POST /router-poll</code> body <code>{`{router_id, secret}`}</code> → returns <code>{`{job:{id,capability_required,prompt}}`}</code> or <code>{`{job:null}`}</code>.</p>
          <p><b>3. Result</b> <code>POST /router-result</code> body <code>{`{router_id, secret, job_id, result | error}`}</code>.</p>
          <p className="text-slate-400">Base URL: <code>{SUPABASE_URL}/functions/v1</code></p>
        </Card>

        <Block title="Python" code={python} />
        <Block title="Node.js" code={node} />
        <Block title="Bash / curl" code={bash} />

        <Card className="p-4 bg-slate-900 border-slate-700 text-sm space-y-2">
          <h3 className="font-medium">Notes</h3>
          <ul className="list-disc pl-5 space-y-1 text-slate-400">
            <li>Router only receives jobs whose <code>capability_required</code> is in its capability list.</li>
            <li>Secret is checked SHA-256 hashed. Store it in an env var, never in git.</li>
            <li>If you want the result pushed to your phone, have your router also POST to your Telegram bot — that's outside Lovable and 100% yours.</li>
            <li>Poll interval is your call. 2s is polite, 500ms is fine for personal use.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
