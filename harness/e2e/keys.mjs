// Signing keys and tokens for the local end-to-end stack.
//
// Supabase signs access tokens with an asymmetric key and publishes it as a
// JWKS; the MCP server, PostgREST and the edge functions' auth gate all verify
// against that. This makes one ES256 key, writes the JWKS, and mints the three
// tokens the stack needs — an anon key, a service-role key, and a signed-in
// user's OAuth access token (with a `client_id`, which the MCP SDK requires so a
// copied browser session cannot pass for a delegated agent).
//
//   node harness/e2e/keys.mjs <out-dir> <issuer> <user-id>
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outDir, issuer, userId] = process.argv.slice(2);
if (!outDir || !issuer || !userId) {
  console.error("usage: node keys.mjs <out-dir> <issuer> <user-id>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const kid = randomUUID();
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
const jwks = { keys: [jwk] };

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function sign(claims) {
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const payload = b64url(JSON.stringify(claims));
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  // JOSE wants the raw r||s form, not DER.
  const sig = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

const now = Math.floor(Date.now() / 1000);
const day = 24 * 3600;
const tokens = {
  anon: sign({ iss: issuer, role: "anon", iat: now, exp: now + day }),
  service: sign({ iss: issuer, role: "service_role", iat: now, exp: now + day }),
  user: sign({
    iss: issuer,
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "owner@example.test",
    client_id: "e2e-harness",
    iat: now,
    exp: now + day,
  }),
  // A plain app-session token: no client_id. The MCP server must refuse it.
  session: sign({ iss: issuer, sub: userId, aud: "authenticated", role: "authenticated", iat: now, exp: now + day }),
};

writeFileSync(join(outDir, "jwks.json"), JSON.stringify(jwks));
writeFileSync(join(outDir, "tokens.json"), JSON.stringify(tokens, null, 2));
console.log(`keys written to ${outDir} (kid ${kid})`);
