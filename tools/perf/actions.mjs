// Per action, in a real browser: Supabase requests, sequential waits, time until the UI shows "saved",
// and time until everything the click caused has finished.
import { chromium } from "playwright";
import { BASE, cookiesFor, readLog, waves, sleep, USERS } from "./lib.mjs";
import fs from "node:fs";
const out = [];
const errors = [];
async function open(role, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
  await ctx.addCookies(await cookiesFor(role));
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${url}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${url}: ${e.message}`));
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  return page;
}
async function quiet(since) {
  // until the stand-in has seen nothing new for 600ms
  let last = Date.now();
  let n = readLog(since).length;
  while (Date.now() - last < 600) {
    await sleep(50);
    const m = readLog(since).length;
    if (m !== n) { n = m; last = Date.now(); }
  }
}
async function measure(label, act, saved) {
  await sleep(700);
  const t0 = Date.now();
  await act();
  await saved();
  const savedMs = Date.now() - t0;
  await quiet(t0);
  const reqs = readLog(t0);
  const totalMs = Math.max(...reqs.map((r) => r.end), t0) - t0;
  const bad = reqs.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.path}`);
  // anything that happens later, in the background (the delayed sync)
  const t1 = Date.now();
  await sleep(3300);
  await quiet(t1);
  const later = readLog(t1);
  const row = { action: label, reqs: reqs.length, waves: waves(reqs), savedMs, totalMs, bad, bgReqs: later.length, bgWaves: waves(later) };
  out.push(row);
  console.log(`reqs=${String(row.reqs).padStart(3)} waves=${String(row.waves).padStart(2)} saved=${String(savedMs).padStart(5)}ms all-done=${String(totalMs).padStart(5)}ms bg(reqs=${later.length},waves=${waves(later)})  ${label}${bad.length ? "  BAD: " + bad.join(", ") : ""}`);
}
// Playwright's own waitFor backs off to 500ms between looks, which hides fast responses — poll tightly instead.
async function seen(locator) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await locator.count()) return;
    await sleep(15);
  }
  throw new Error("never appeared");
}
const browser = await chromium.launch();

// ---- trainee: confirm sets in a block week
{
  const page = await open("trainee", "/trainee/workouts");
  await page.getByText("Ab Wheel Rollout").first().click();
  const confirm = (i) => page.getByRole("button", { name: `אישור סט ${i}`, exact: true });
  const undo = (i) => page.getByRole("button", { name: `ביטול סט ${i}`, exact: true });
  await confirm(1).waitFor();
  await measure("מתאמן: אישור סט (בתוך בלוק)", () => confirm(1).click(), () => seen(undo(1)));
  await measure("מתאמן: 2 סטים ברצף מהיר (האחרון משלים תרגיל)", async () => { await confirm(2).click(); await confirm(3).click(); }, async () => { await seen(undo(2)); await seen(undo(3)); });
  await measure("מתאמן: ביטול סט", () => undo(3).click(), () => seen(confirm(3)));
  await page.close();
}
// ---- trainer-led session on the same workout
{
  const page = await open("trainer", "/trainer/session/20000000-0000-0000-0000-000000000001");
  const confirm = (i) => page.getByRole("button", { name: `אישור סט ${i}`, exact: true });
  const undo = (i) => page.getByRole("button", { name: `ביטול סט ${i}`, exact: true });
  await confirm(1).first().waitFor();
  await measure("מאמן באימון אישי: אישור סט", () => confirm(1).first().click(), () => seen(undo(1).first()));
  await measure("מאמן באימון אישי: ביטול סט", () => undo(1).first().click(), () => seen(confirm(1).first()));
  await page.close();
}
// ---- program builder: change a target
{
  const page = await open("trainer", `/trainer/trainees/${USERS.trainee.id}/programs/10000000-0000-0000-0000-000000000001`);
  const reps = page.getByLabel("חזרות בסט 1").first();
  await reps.waitFor();
  const before = await reps.inputValue();
  await measure("בילדר: שינוי חזרות בסט", async () => { await reps.fill(before === "6" ? "5" : "6"); await reps.blur(); }, () => sleep(50));
  await page.close();
}
await browser.close();
if (errors.length) console.log("CONSOLE ERRORS:\n" + [...new Set(errors)].join("\n"));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
