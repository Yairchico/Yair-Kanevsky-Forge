// Per page: number of Supabase requests, sequential waits, and time to a full response (plain GET, no browser).
import { BASE, cookiesFor, readLog, waves, ids, USERS, sleep } from "./lib.mjs";
import fs from "node:fs";
const T = USERS.trainee.id, P = "10000000-0000-0000-0000-000000000001";
const trainerPages = [
  ["/trainer", "בית המאמן"], ["/trainer/trainees", "רשימת מתאמנים"], [`/trainer/trainees/${T}`, "דף מתאמן"],
  [`/trainer/trainees/${T}/programs/${P}`, "בילדר התוכנית"], [`/trainer/trainees/${T}/blocks/${ids.dani_block}`, "דף בלוק"],
  [`/trainer/trainees/${T}/programs/new`, "תוכנית חדשה"], [`/trainer/trainees/${T}/blocks/new`, "בלוק חדש"],
  ["/trainer/session", "אימון אישי - בחירה"], ["/trainer/session/20000000-0000-0000-0000-000000000001", "אימון אישי - חי"],
  [`/trainer/session/free/${ids.free_session}`, "אימון חופשי"], ["/trainer/session/templates", "אימונים שמורים"],
  ["/trainer/session/templates/40000000-0000-0000-0000-000000000001", "עורך אימון שמור"], ["/trainer/exercises", "ספריית תרגילים"],
];
const plan = [
  ["trainee", [["/trainee", "בית המתאמן"], ["/trainee/workouts", "האימונים שלי"], ["/trainee/history", "היסטוריה"]]],
  ["trainer", trainerPages],
  ["viewer", trainerPages.filter(([u]) => !u.endsWith("/new"))],
];
const out = [];
for (const [role, pages] of plan) {
  const cookie = (await cookiesFor(role)).map((c) => `${c.name}=${c.value}`).join("; ");
  for (const [url, label] of pages) {
    let best = null;
    for (let i = 0; i < 2; i++) {
      await sleep(150);
      const t0 = Date.now();
      const res = await fetch(BASE + url, { headers: { cookie }, redirect: "manual" });
      const html = await res.text();
      const ms = Date.now() - t0;
      await sleep(50);
      const reqs = readLog(t0, t0 + ms);
      const bad = reqs.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.path}`);
      const row = { role, url: label, status: res.status, reqs: reqs.length, waves: waves(reqs), ms, bad, err: /Application error|שגיאה בטעינ/.test(html) };
      if (!best || row.ms < best.ms) best = row;
    }
    out.push(best);
    console.log(`${best.role.padEnd(8)} ${String(best.status).padEnd(4)} reqs=${String(best.reqs).padStart(3)} waves=${String(best.waves).padStart(2)} ${String(best.ms).padStart(5)}ms  ${best.url}${best.bad.length ? "  BAD: " + best.bad.join(", ") : ""}${best.err ? "  ERROR-PAGE" : ""}`);
  }
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
