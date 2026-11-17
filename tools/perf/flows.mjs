import { chromium } from "playwright";
import { BASE, cookiesFor, ids, sleep } from "./lib.mjs";
import pg from "pg";
const db = new pg.Client({ host: process.env.PGHOST ?? "/tmp", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", database: "forge_dev" });
await db.connect();
const q = async (sql) => (await db.query(sql)).rows;
const browser = await chromium.launch();
const errors = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); };
async function open(role, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
  await ctx.addCookies(await cookiesFor(role));
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  return page;
}
const btn = (page, name) => page.getByRole("button", { name, exact: true });

// ---------- trainee
{
  const page = await open("trainee", "/trainee");
  const homeBefore = await page.locator("body").innerText();
  await page.getByRole("link", { name: /לצפייה בתוכנית|האימונים/ }).first().click();
  await page.waitForURL(/\/trainee\/workouts/);
  await page.getByText("Ab Wheel Rollout").first().click();
  await btn(page, "אישור סט 1").click();
  await btn(page, "ביטול סט 1").waitFor();
  check("trainee: set 1 shows as saved", true);
  check("trainee: set 1 is in the database", (await q("select count(*)::int n from set_logs l join workout_exercises we on we.id=l.workout_exercise_id join exercises e on e.id=we.exercise_id where e.name='Ab Wheel Rollout' and l.set_index=1 and l.source='trainee'"))[0].n === 1);
  // leave right away (before the delayed sync), then come back with the browser's Back button
  await page.goBack();
  await page.waitForURL(/\/trainee$/);
  await sleep(1500);
  await page.goForward();
  await page.waitForURL(/\/trainee\/workouts/);
  await sleep(1500);
  await page.getByText("Ab Wheel Rollout").first().click();
  check("trainee: after leaving at once and coming back (Back/Forward), set 1 is still shown as saved", (await btn(page, "ביטול סט 1").count()) === 1);
  // finish the exercise: sets 2,3 quickly
  await btn(page, "אישור סט 2").click();
  await btn(page, "אישור סט 3").click();
  await btn(page, "ביטול סט 3").waitFor();
  await sleep(4000); // the delayed sync has run
  check("trainee: all three still shown as saved after the background sync", (await btn(page, "ביטול סט 1").count()) + (await btn(page, "ביטול סט 2").count()) + (await btn(page, "ביטול סט 3").count()) === 3);
  check("trainee: exercise was marked done in the database", (await q("select count(*)::int n from workout_exercise_completions c join workout_exercises we on we.id=c.workout_exercise_id join exercises e on e.id=we.exercise_id where e.name='Ab Wheel Rollout'"))[0].n >= 1);
  check("block: next week's target moved after logging (engine ran)", (await q("select count(*)::int n from workout_exercises where progression_info is not null"))[0].n > 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Ab Wheel Rollout").first().click();
  check("trainee: after a full reload the sets are there", (await btn(page, "ביטול סט 2").count()) === 1);
  // home reflects the finished exercise (Back button → page restored from the client cache must be fresh)
  await page.keyboard.press("Escape");
  await page.goto(BASE + "/trainee", { waitUntil: "networkidle" });
  const homeAfter = await page.locator("body").innerText();
  check("trainee: home screen changed after the exercise was done", homeBefore !== homeAfter);
  await page.close();
}
// ---------- trainer: live session on the same workout shows what the trainee logged; free session logging
{
  const page = await open("trainer", "/trainer/session/20000000-0000-0000-0000-000000000001");
  await page.getByText("2 · Ab Wheel Rollout").click();
  await sleep(300);
  check("trainer session: sees the trainee's saved sets", (await btn(page, "ביטול סט 1").count()) >= 1);
  await page.close();
  const free = await open("trainer", `/trainer/session/free/${ids.free_session}`);
  await btn(free, "אישור סט 1").first().click();
  await btn(free, "ביטול סט 1").first().waitFor();
  check("free session: set saved", (await q("select count(*)::int n from free_session_sets where logged_at is not null"))[0].n === 1);
  await sleep(3500);
  check("free session: still shown as saved after the background sync", (await btn(free, "ביטול סט 1").count()) >= 1);
  await btn(free, "ביטול סט 1").first().click();
  await btn(free, "אישור סט 1").first().waitFor();
  check("free session: set un-confirmed", (await q("select count(*)::int n from free_session_sets where logged_at is not null"))[0].n === 0);
  await free.close();
}
// ---------- read-only viewer: no way to confirm a set
{
  const page = await open("viewer", `/trainer/session/free/${ids.free_session}`);
  check("viewer: no confirm button on a free session", (await page.getByRole("button", { name: /אישור סט/ }).count()) === 0);
  await page.close();
}
await browser.close();
await db.end();
console.log(errors.length ? "CONSOLE ERRORS:\n" + [...new Set(errors)].join("\n") : "no console errors");
console.log(fails ? `${fails} FAILED` : "all passed");
