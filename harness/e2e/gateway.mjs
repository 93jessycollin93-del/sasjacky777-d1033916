// A stand-in for the Supabase project's front door, for the end-to-end run.
//
// Real Supabase puts Auth, PostgREST and the edge functions behind one host.
// This does the same on localhost so the app's real code runs unmodified:
//
//   /auth/v1/.well-known/*   the issuer's OAuth/OIDC metadata and JWKS
//   /rest/v1/*               PostgREST, over the real migrated schema
//   /functions/v1/<name>/*   the real edge function, run under Deno
//
// Only what the run needs is here — no sign-in, no token endpoint. Tokens are
// minted by keys.mjs, which is the part a real OAuth login would do.
//
//   GATEWAY_PORT=54321 POSTGREST=http://127.0.0.1:3000 \
//   FUNCTIONS='{"mcp":8101,"jackie-bionic":8102}' JWKS_FILE=… node gateway.mjs
import http from "node:http";
import { readFileSync } from "node:fs";

const port = Number(process.env.GATEWAY_PORT ?? 54321);
const origin = `http://localhost:${port}`;
const issuer = `${origin}/auth/v1`;
const postgrest = new URL(process.env.POSTGREST ?? "http://127.0.0.1:3000");
const functions = JSON.parse(process.env.FUNCTIONS ?? "{}");
const jwks = readFileSync(process.env.JWKS_FILE, "utf8");

const metadata = JSON.stringify({
  issuer,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint: `${issuer}/oauth/token`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  id_token_signing_alg_values_supported: ["ES256"],
  subject_types_supported: ["public"],
});

function forward(req, res, target, path) {
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, method: req.method, path, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `gateway: ${target.host} unreachable: ${e.message}` }));
  });
  req.pipe(upstream);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    const p = url.pathname;

    if (p === "/auth/v1/.well-known/jwks.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(jwks);
    }
    if (
      p === "/auth/v1/.well-known/openid-configuration" ||
      p === "/auth/v1/.well-known/oauth-authorization-server" ||
      p === "/.well-known/oauth-authorization-server/auth/v1" ||
      p === "/.well-known/openid-configuration/auth/v1"
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(metadata);
    }
    if (p.startsWith("/rest/v1/")) {
      return forward(req, res, postgrest, p.slice("/rest/v1".length) + url.search);
    }
    const fn = /^\/functions\/v1\/([^/]+)/.exec(p);
    if (fn && functions[fn[1]]) {
      // The path is kept whole: Supabase hands a function its full mount path,
      // and the MCP SDK dispatches on the suffix after it.
      return forward(req, res, new URL(`http://127.0.0.1:${functions[fn[1]]}`), p + url.search);
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `gateway: no route for ${p}` }));
  })
  .listen(port, "127.0.0.1", () => console.log(`gateway on ${origin}`));
