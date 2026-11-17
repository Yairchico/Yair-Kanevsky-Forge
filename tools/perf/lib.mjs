import fs from "node:fs";
import { SignJWT, importJWK } from "jose";
export const H = new URL(".", import.meta.url).pathname;
export const keys = JSON.parse(fs.readFileSync(H + "keys.json"));
export const BASE = process.env.BASE ?? "http://localhost:3100";
export const LOG = H + "requests.jsonl";
export const USERS = {
  trainer: { id: "00000000-0000-0000-0000-0000000000a1", email: "coach@x", role: "trainer", sa: "0" },
  trainee: { id: "00000000-0000-0000-0000-0000000000b1", email: "t1@x", role: "trainee", sa: "0" },
  viewer: { id: "00000000-0000-0000-0000-0000000000c1", email: "sa@x", role: "trainee", sa: "1" },
};
export const ids = Object.fromEntries(fs.readFileSync(H + "ids.txt", "utf8").trim().split(/\s+/).map((kv) => kv.split("=")));
export async function cookiesFor(name, alg = process.env.JWT_ALG ?? "HS256") {
  const u = USERS[name];
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", session_id: "s-" + name, is_anonymous: false })
    .setIssuedAt(now).setExpirationTime(now + 3600 * 6);
  const access_token = alg === "HS256"
    ? await jwt.setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(new TextEncoder().encode(keys.hsSecret))
    : await jwt.setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "local-1" }).sign(await importJWK(keys.privateJwk, "ES256"));
  const session = { access_token, refresh_token: "r-" + name, token_type: "bearer", expires_in: 3600 * 6, expires_at: now + 3600 * 6,
    user: { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const c = (n, v) => ({ name: n, value: v, domain: "localhost", path: "/" });
  const out = [c("app_role", u.role), c("app_superadmin", u.sa)];
  const MAX = 3180;
  if (value.length <= MAX) out.push(c("sb-127-auth-token", value));
  else for (let i = 0, n = 0; i < value.length; i += MAX, n++) out.push(c(`sb-127-auth-token.${n}`, value.slice(i, i + MAX)));
  return out;
}
export function readLog(from, to = Infinity) {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.start >= from && r.start <= to);
}
/** Sequential waits: the longest chain of requests where each started after the previous one ended. */
export function waves(reqs) {
  const sorted = [...reqs].sort((a, b) => a.start - b.start);
  const level = [];
  sorted.forEach((r, i) => {
    let best = 0;
    for (let j = 0; j < i; j++) if (sorted[j].end <= r.start + 3 && level[j] > best) best = level[j];
    level[i] = best + 1;
  });
  return Math.max(0, ...level);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
