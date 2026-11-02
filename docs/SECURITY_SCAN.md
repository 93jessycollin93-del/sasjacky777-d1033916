# Credential scan

Prompted by an answer of Jackie's that carried an **EXPOSED CREDENTIAL**
banner (October 2026). This records what that banner meant, what a scan of
the whole repository found, and what keeps it clean.

## The banner was a false alarm

The banner came from `src/lib/jackie-security.ts`, which matched *phrases*,
not credentials. Asked about "the system that defines her", Jackie
paraphrased her persona, which says she "warns about security risks, weak
architecture, bad dependencies, exposed secrets, and reckless decisions"
(`supabase/functions/_shared/persona.ts`). "exposed secrets" matched, and the
answer was labelled EXPOSED CREDENTIAL. Nothing was exposed. The same matcher
would have said nothing about an answer that really contained a key.

Now the alarm (⚠, accent colour) is raised only for a credential-shaped value
in the answer itself, named by kind and never echoed; an answer that only
discusses security gets a quiet "Discusses …" label (ⓘ, muted). Labels saved
before the fix, the old banner included, are shown as the discussions they
always were. `src/test/jackie-security.test.ts` holds both cases.

## What was scanned

Every version of every file reachable from any ref: all 27 branches, plus the
35 pull-request heads GitHub keeps after a branch is deleted — 1,253 commits,
31,762 distinct text files. The scan matched the formats real keys take:
private keys; Anthropic, OpenAI, DeepSeek, OpenRouter, Groq, xAI, Google,
Hugging Face, Replicate, Perplexity, ElevenLabs, NVIDIA, Cerebras and
Fireworks API keys; GitHub, Slack, npm, PyPI, Netlify and Vercel tokens;
Stripe, AWS, SendGrid, Mailgun, Telegram and Discord credentials; Supabase
secret keys, access tokens and JWTs (decoded, so a public `anon` key is told
apart from a `service_role` key); database URLs with passwords; and
`NAME_KEY=value`-style assignments. The 8,988 binary files were checked by
type: none of this repository's own is a database, archive or key store.

The scan printed only kinds, redacted previews and fingerprints, so no value
was copied anywhere while looking.

## What it found

| Where | What | Verdict |
|-------|------|---------|
| `.env` (every version) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, and the anon / `sb_publishable_` key | Public by design: every browser receives them; row-level security is what protects the data (`scripts/db-authz-test.sh`) |
| `public/pc-os/assets/index-*.js` | A Firebase web config for Google project `gen-lang-client-0404792141` (`apiKey: "AIzaSyC1…"`) | Public by design, but see below |
| `public/pc-os/assets/index-*.js` | `sk-proj-…secretkeythatshouldnotbehere`, `mongodb://admin:pass1234@localhost`, AWS `AKIAIOSFODNN7EXAMPLE` | Fake values a TermStudio demo plants for its code reviewer to find; the AWS one is Amazon's documentation key |
| `Jackie/knowledge/notes/2026-03-28_fastapi_security_fixes.md` | `postgresql://user:pass@host:5432/dbname` | A textbook placeholder |
| `third_party/` | Two Android keystores (Bright Nights' deliberately public PR debug key; Luanti's, locked by passwords that are not in the repository) | Upstream's own, not credentials of this project |

**No service-role key, no provider API key, no private key and no password
has ever been committed** — not on any branch, and not in any pull request.

## The one thing to do

The Firebase key is not a secret in the usual sense — Firebase web keys
identify a project and ship to every visitor — but `gen-lang-client-…` is a
Google AI Studio project, where the Gemini API is enabled. If the key is
unrestricted, anyone can copy it from `/pc-os/` and spend that project's
Gemini quota or billing. In Google Cloud Console → *APIs & Services* →
*Credentials*, open the key starting `AIzaSyC1`:

- **Application restrictions:** websites, limited to the app's own domains.
- **API restrictions:** only the Firebase APIs the PC-OS app uses (for
  example Identity Toolkit and Cloud Firestore) — not the Generative Language
  API.

This cannot be checked or changed from the repository.

## What keeps it clean

`src/test/no-credentials.test.ts` runs the same shapes over every tracked file
of this repository's own on every test run and fails on any credential it does
not already know by fingerprint; a planted Anthropic-format key fails it. If
it ever fires, rotate the credential first: deleting the file leaves it in
history.
