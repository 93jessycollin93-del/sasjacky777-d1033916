/**
 * Turning whatever the operator pasted into a chat-completions URL.
 *
 * People paste three different things into a "base URL" box in roughly equal
 * proportion — the host, the host with `/v1`, and the whole endpoint — and two
 * of those three would be a 404 that reads, from the chat, exactly like the
 * server being down. So the shapes are normalized rather than assumed, and it
 * lives here on its own so `src/test/bionic-endpoint.test.ts` can import it
 * without a Deno runtime.
 */
export function bionicEndpoint(raw: string): string {
  const base = raw.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}
