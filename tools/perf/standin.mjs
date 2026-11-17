// A small local stand-in for Supabase (PostgREST subset + the two Auth
// endpoints the app's server side calls), over a local Postgres with the
// real migrations — so RLS, triggers and SQL functions are the real ones.
// Adds an artificial delay per request and records every request's
// start/end so "sequential waits" can be counted per page load.
import http from "node:http";
import fs from "node:fs";
import pg from "pg";
import { jwtVerify, importJWK, createLocalJWKSet } from "jose";

const PORT = Number(process.env.PORT ?? 54321);
const DELAY = Number(process.env.DELAY_MS ?? 100);
const LOG = process.env.REQ_LOG ?? new URL("./requests.jsonl", import.meta.url).pathname;
const keys = JSON.parse(fs.readFileSync(new URL("./keys.json", import.meta.url)));
const hsSecret = new TextEncoder().encode(keys.hsSecret);
const jwks = createLocalJWKSet({ keys: [keys.publicJwk] });

const pool = new pg.Pool({ host: process.env.PGHOST ?? "/tmp", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", database: process.env.PGDATABASE ?? "forge_dev", max: 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Object.assign(new Error("bad identifier " + s), { status: 400 });
  return '"' + s + '"';
};

async function claimsOf(req) {
  const auth = req.headers.authorization ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token === keys.anonKey) return null;
  try {
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    const { payload } = header.alg === "HS256" ? await jwtVerify(token, hsSecret) : await jwtVerify(token, jwks);
    return payload;
  } catch {
    throw Object.assign(new Error("JWT invalid"), { status: 401, code: "PGRST301" });
  }
}

function parseValue(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}
function splitList(s) {
  const out = [];
  let cur = "", q = false;
  for (const ch of s) {
    if (ch === '"') { q = !q; continue; }
    if (ch === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur !== "" || s !== "") out.push(cur);
  return out;
}
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

function whereOf(params, args) {
  const parts = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    let expr = raw, neg = false;
    if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
    const dot = expr.indexOf(".");
    const op = expr.slice(0, dot), val = expr.slice(dot + 1);
    let sql;
    if (OPS[op]) { args.push(parseValue(val)); sql = `${ident(key)} ${OPS[op]} $${args.length}`; }
    else if (op === "in") { args.push(splitList(val.slice(1, -1))); sql = `${ident(key)} = any($${args.length})`; }
    else if (op === "is") {
      if (!["null", "true", "false"].includes(val)) throw Object.assign(new Error("bad is"), { status: 400 });
      sql = `${ident(key)} is ${val}`;
    } else throw Object.assign(new Error("unsupported filter " + key + "=" + raw), { status: 400 });
    parts.push(neg ? `not (${sql})` : sql);
  }
  return parts.length ? " where " + parts.join(" and ") : "";
}
function colsOf(select) {
  if (!select || select === "*") return "*";
  if (/[(!:]/.test(select)) throw Object.assign(new Error("embedded selects are not supported by the stand-in: " + select), { status: 400 });
  return select.split(",").map((c) => ident(c.trim())).join(", ");
}
function orderOf(params) {
  const order = params.get("order");
  let sql = "";
  if (order) {
    sql += " order by " + order.split(",").map((o) => {
      const [col, ...mods] = o.split(".");
      return ident(col) + (mods.includes("desc") ? " desc" : " asc") + (mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "");
    }).join(", ");
  }
  const limit = params.get("limit");
  if (limit) sql += " limit " + Number(limit);
  return sql;
}

async function inTx(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [claims?.sub ?? "", claims ? "authenticated" : "anon"]);
    await client.query(claims ? "set local role authenticated" : "set local role anon");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function rest(req, url, body) {
  const claims = await claimsOf(req);
  const params = url.searchParams;
  const prefer = req.headers.prefer ?? "";
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const path = url.pathname.replace("/rest/v1/", "");

  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    const input = body ?? {};
    return inTx(claims, async (c) => {
      const names = Object.keys(input);
      const { rows: procs } = await c.query(
        "select p.oid, p.proretset, p.prorettype::regtype::text as ret, p.proargnames, (select array_agg(t::regtype::text order by ord) from unnest(p.proargtypes::oid[]) with ordinality as a(t, ord)) as argtypes from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
        [fn],
      );
      const proc = procs.find((p) => names.every((n) => (p.proargnames ?? []).includes(n)));
      if (!proc) throw Object.assign(new Error(`Could not find the function public.${fn}(${names.join(", ")}) in the schema cache`), { status: 404, code: "PGRST202" });
      const args = [];
      const call = names.map((n) => {
        const type = proc.argtypes[proc.proargnames.indexOf(n)];
        const v = input[n];
        args.push(v !== null && typeof v === "object" && (type === "json" || type === "jsonb" || !Array.isArray(v)) ? JSON.stringify(v) : v);
        return `${ident(n)} => $${args.length}::${type}`;
      }).join(", ");
      if (proc.ret === "void") { await c.query(`select public.${ident(fn)}(${call})`, args); return { status: 204 }; }
      if (proc.proretset) {
        const { rows } = await c.query(`select coalesce(json_agg(x), '[]'::json)::text as j from public.${ident(fn)}(${call}) x`, args);
        return { status: 200, text: rows[0].j };
      }
      const { rows } = await c.query(`select to_json(public.${ident(fn)}(${call}))::text as j`, args);
      return { status: 200, text: rows[0].j ?? "null" };
    });
  }

  const table = ident(path);
  const cols = colsOf(params.get("select"));
  const returning = prefer.includes("return=representation");
  const finish = (rowsJson, count) => {
    if (wantsObject) {
      const rows = JSON.parse(rowsJson);
      if (rows.length !== 1) return { status: 406, json: { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" } };
      return { status: 200, text: JSON.stringify(rows[0]) };
    }
    return { status: count === undefined ? 200 : 201, text: rowsJson };
  };

  return inTx(claims, async (c) => {
    const args = [];
    if (req.method === "GET" || req.method === "HEAD") {
      const where = whereOf(params, args);
      const { rows } = await c.query(`select coalesce(json_agg(t), '[]'::json)::text as j from (select ${cols} from public.${table}${where}${orderOf(params)}) t`, args);
      const result = finish(rows[0].j);
      if (prefer.includes("count=exact")) {
        const { rows: cnt } = await c.query(`select count(*)::int as n from public.${table}${where}`, args);
        result.headers = { "content-range": `${cnt[0].n ? "0-" + (cnt[0].n - 1) : "*"}/${cnt[0].n}` };
      }
      return result;
    }
    if (req.method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      const keysUsed = params.get("columns") ? params.get("columns").split(",").map((k) => k.replace(/"/g, "")) : [...new Set(list.flatMap((r) => Object.keys(r)))];
      const colList = keysUsed.map(ident).join(", ");
      args.push(JSON.stringify(list));
      let sql = `insert into public.${table} (${colList}) select ${colList} from json_populate_recordset(null::public.${table}, $1::json)`;
      const onConflict = params.get("on_conflict");
      if (prefer.includes("resolution=merge-duplicates")) {
        if (!onConflict) throw Object.assign(new Error("on_conflict required"), { status: 400 });
        const target = onConflict.split(",").map(ident);
        const updates = keysUsed.map(ident).filter((k) => !target.includes(k)).map((k) => `${k} = excluded.${k}`);
        sql += ` on conflict (${target.join(", ")}) ` + (updates.length ? `do update set ${updates.join(", ")}` : "do nothing");
      } else if (prefer.includes("resolution=ignore-duplicates")) {
        sql += ` on conflict ${onConflict ? "(" + onConflict.split(",").map(ident).join(", ") + ")" : ""} do nothing`;
      }
      if (!returning) { await c.query(sql, args); return { status: 201 }; }
      const { rows } = await c.query(`with r as (${sql} returning *) select coalesce(json_agg(t), '[]'::json)::text as j from (select ${cols} from r) t`, args);
      return finish(rows[0].j, 1);
    }
    if (req.method === "PATCH") {
      const keysUsed = Object.keys(body);
      const colList = keysUsed.map(ident).join(", ");
      args.push(JSON.stringify(body));
      const where = whereOf(params, args);
      const sql = `update public.${table} set (${colList}) = (select ${colList} from json_populate_record(null::public.${table}, $1::json))${where}`;
      if (!returning) { await c.query(sql, args); return { status: 204 }; }
      const { rows } = await c.query(`with r as (${sql} returning *) select coalesce(json_agg(t), '[]'::json)::text as j from (select ${cols} from r) t`, args);
      return finish(rows[0].j);
    }
    if (req.method === "DELETE") {
      const where = whereOf(params, args);
      const sql = `delete from public.${table}${where}`;
      if (!returning) { await c.query(sql, args); return { status: 204 }; }
      const { rows } = await c.query(`with r as (${sql} returning *) select coalesce(json_agg(t), '[]'::json)::text as j from (select ${cols} from r) t`, args);
      return finish(rows[0].j);
    }
    throw Object.assign(new Error("method"), { status: 405 });
  });
}

async function auth(req, url) {
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return { status: 200, json: { keys: [keys.publicJwk] }, headers: { "cache-control": "public, max-age=600" } };
  if (url.pathname === "/auth/v1/user") {
    const claims = await claimsOf(req);
    if (!claims) return { status: 401, json: { code: 401, error_code: "no_authorization", msg: "no bearer" } };
    return { status: 200, json: { id: claims.sub, aud: "authenticated", role: "authenticated", email: claims.email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
  }
  if (url.pathname === "/auth/v1/logout") return { status: 204 };
  return { status: 404, json: { msg: "not implemented in stand-in: " + url.pathname } };
}

let seq = 0;
http.createServer(async (req, res) => {
  const id = ++seq;
  const start = Date.now();
  const url = new URL(req.url, "http://x");
  let out;
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    await sleep(DELAY);
    out = url.pathname.startsWith("/auth/v1/") ? await auth(req, url) : url.pathname.startsWith("/rest/v1/") ? await rest(req, url, body) : { status: 404, json: { message: "not found" } };
  } catch (e) {
    const status = e.status ?? (e.code === "42501" ? 403 : e.code === "23505" ? 409 : 400);
    out = { status, json: { code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
    if (!e.code || e.status) console.error("standin error:", req.method, req.url, e.message);
  }
  const text = out.text ?? (out.json !== undefined ? JSON.stringify(out.json) : "");
  res.writeHead(out.status, { "content-type": "application/json; charset=utf-8", ...(out.headers ?? {}) });
  res.end(out.status === 204 ? undefined : text);
  fs.appendFileSync(LOG, JSON.stringify({ id, start, end: Date.now(), method: req.method, path: url.pathname, status: out.status }) + "\n");
}).listen(PORT, "127.0.0.1", () => console.log("stand-in on", PORT, "delay", DELAY));
