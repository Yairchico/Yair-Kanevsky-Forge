// Opens every screen as each role in a real browser; reports console errors, failed requests and error pages.
import { chromium } from "playwright";
import { BASE, cookiesFor, ids, USERS, readLog, sleep } from "./lib.mjs";
const T = USERS.trainee.id, P = "10000000-0000-0000-0000-000000000001";
const trainerPages = ["/trainer", "/trainer/trainees", `/trainer/trainees/${T}`, `/trainer/trainees/${T}/programs/${P}`,
  `/trainer/trainees/${T}/blocks/${ids.dani_block}`, `/trainer/trainees/${T}/programs/new`, `/trainer/trainees/${T}/blocks/new`,
  `/trainer/trainees/${T}/blocks/convert`, "/trainer/trainees/new", "/trainer/session", `/trainer/session?trainee=${T}`, "/trainer/session?mode=free",
  "/trainer/session/20000000-0000-0000-0000-000000000001", `/trainer/session/free/${ids.free_session}`, "/trainer/session/templates",
  "/trainer/session/templates/40000000-0000-0000-0000-000000000001", "/trainer/exercises", "/trainer/exercises/new"];
const plan = { trainee: ["/trainee", "/trainee/workouts", "/trainee/history", "/trainer"], trainer: [...trainerPages, "/trainee"], viewer: [...trainerPages, "/trainee"] };
const browser = await chromium.launch();
let problems = 0;
for (const [role, pages] of Object.entries(plan)) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
  await ctx.addCookies(await cookiesFor(role));
  const page = await ctx.newPage();
  let errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 200)));
  for (const url of pages) {
    errs = [];
    const t0 = Date.now();
    const res = await page.goto(BASE + url, { waitUntil: "networkidle" });
    await sleep(150);
    const text = await page.locator("body").innerText();
    const bad = readLog(t0).filter((r) => r.status >= 400).map((r) => `${r.status} ${r.method} ${r.path}`);
    const final = new URL(page.url()).pathname + new URL(page.url()).search;
    const flags = [];
    if (res.status() >= 400) flags.push("HTTP " + res.status());
    if (/Application error|משהו השתבש|שגיאת התחברות/.test(text)) flags.push("ERROR TEXT");
    if (errs.length) flags.push("console: " + [...new Set(errs)].join(" | "));
    if (bad.length) flags.push("supabase: " + [...new Set(bad)].join(", "));
    if (flags.length) problems++;
    const ro = /צפייה בלבד/.test(text) ? " [צפייה בלבד]" : "";
    console.log(`${role.padEnd(8)} ${url.replace(/[0-9a-f-]{36}/g, "…")}${final !== url ? " → " + final.replace(/[0-9a-f-]{36}/g, "…") : ""}${ro}  ${text.replace(/\s+/g, " ").length}ch ${flags.join("  ") || "ok"}`);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${role}-${pages.indexOf(url)}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(problems ? `${problems} page(s) with problems` : "no problems");
