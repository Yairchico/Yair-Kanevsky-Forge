// The trainee's quick-entry flow in a real browser, checked against the database:
// rows save themselves, "done" fills the rest with the target, un-done takes back only
// what "done" filled, clearing a set, removing an extra set, the whole workout as planned,
// leaving mid-typing, and no reception.
import { chromium } from "playwright";
import { BASE, cookiesFor, sleep } from "./lib.mjs";
import pg from "pg";
const db = new pg.Client({ host: process.env.PGHOST ?? "/tmp", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", database: "forge_dev" });
await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;
const T = "00000000-0000-0000-0000-0000000000b1";
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  → " + extra : ""}`); };
const weId = async (name, workout = "20000000-0000-0000-0000-000000000011") =>
  (await q(`select we.id from workout_exercises we join exercises e on e.id=we.exercise_id where we.workout_id=$1 and e.name=$2`, [workout, name]))[0].id;
const logs = async (we) => (await q(`select set_index, weight_kg::float w, reps, rpe::float rpe from set_logs where workout_exercise_id=$1 and trainee_id=$2 and status='done' order by 1`, [we, T]));
const fmt = (rows) => rows.map((r) => `${r.set_index}:${r.w ?? "-"}x${r.reps}${r.rpe != null ? "@" + r.rpe : ""}`).join(" ");
const done = async (we) => (await q(`select count(*)::int n from workout_exercise_completions where workout_exercise_id=$1`, [we]))[0].n === 1;
async function waitFor(fn, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
await ctx.addCookies(await cookiesFor("trainee"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.goto(BASE + "/trainee/workouts", { waitUntil: "networkidle" });
// Tuesday's workout (day 2): 5 exercises x 3 sets of 8-10 x 40kg
await page.getByRole("button", { name: "יום ג׳" }).click();
const open = async (name) => { await page.getByText(name, { exact: true }).first().click(); await page.getByRole("dialog").waitFor(); };
const close = async () => { await page.getByRole("button", { name: "סגור", exact: true }).last().click(); await sleep(200); };
const field = (label) => page.getByLabel(label, { exact: true });

await open("Back Extension");
check("no ✓ buttons on the trainee's rows", (await page.getByRole("button", { name: /אישור סט/ }).count()) === 0);
const BE = await weId("Back Extension");

// a. typing in one row saves it by itself; empty reps = the target
await field("משקל בסט 2").fill("45");
check("a. typed weight is saved by itself (reps = target 8)", await waitFor(async () => fmt(await logs(BE)) === "2:45x8"), fmt(await logs(BE)));
check("a. row says it was saved", await waitFor(async () => (await page.getByText("נשמר ✓").count()) === 1));

// b. two fields of the same row, quickly: the final values are what's saved
await field("חזרות בסט 3").fill("6");
await field("משקל בסט 3").fill("42.5");
check("b. both fields of a row end up saved", await waitFor(async () => fmt(await logs(BE)) === "2:45x8 3:42.5x6"), fmt(await logs(BE)));
check("b. set short of the target shows as such", await waitFor(async () => (await page.getByText("נשמר · פחות מהיעד").count()) === 1));

// c. "done" fills the rest with the target — one request
await page.getByRole("button", { name: /סמן כבוצע/ }).click();
check("c. done: untouched set 1 filled with the target, typed ones kept", await waitFor(async () => fmt(await logs(BE)) === "1:40x8 2:45x8 3:42.5x6"), fmt(await logs(BE)));
check("c. done: exercise marked done in the database", await waitFor(() => done(BE)));
check("c. done: button now offers to take it back", await waitFor(async () => (await page.getByRole("button", { name: /בוצע ✓/ }).count()) === 1));

// d. un-done takes back only what equals the target (set 1); typed ones stay
await page.getByRole("button", { name: /בוצע ✓/ }).click();
check("d. un-done: auto-filled set removed, typed sets stay", await waitFor(async () => fmt(await logs(BE)) === "2:45x8 3:42.5x6"), fmt(await logs(BE)));
check("d. un-done: done mark removed", await waitFor(async () => !(await done(BE))));

// e. clearing a saved set
await page.getByRole("button", { name: "נקה סט 2", exact: true }).click();
check("e. ✕ removes the saved set", await waitFor(async () => fmt(await logs(BE)) === "3:42.5x6"), fmt(await logs(BE)));
check("e. the row is empty again (target shown as placeholder)", await waitFor(async () => (await field("משקל בסט 2").inputValue()) === ""), await field("משקל בסט 2").inputValue());

// f. an extra set added by mistake can be removed — before and after it was saved
await page.getByRole("button", { name: "סט נוסף" }).click();
check("f. extra row appears with a remove button", await waitFor(async () => (await page.getByRole("button", { name: "הסר סט 4", exact: true }).count()) === 1));
await page.getByRole("button", { name: "הסר סט 4", exact: true }).click();
check("f. removing an empty extra row", await waitFor(async () => (await field("חזרות בסט 4").count()) === 0));
await page.getByRole("button", { name: "סט נוסף" }).click();
await field("חזרות בסט 4").fill("5");
await field("משקל בסט 4").fill("40");
check("f. extra set saved", await waitFor(async () => fmt(await logs(BE)) === "3:42.5x6 4:40x5"), fmt(await logs(BE)));
await page.getByRole("button", { name: "הסר סט 4", exact: true }).click();
check("f. removing a saved extra set deletes it and the row", await waitFor(async () => fmt(await logs(BE)) === "3:42.5x6" && (await field("חזרות בסט 4").count()) === 0), fmt(await logs(BE)));
check("f. planned rows have no remove button", (await page.getByRole("button", { name: /הסר סט [123]$/ }).count()) === 0);

// g. leaving mid-typing still saves — by the app's own back button…
await field("משקל בסט 1").fill("50");
await close();
await page.getByRole("link", { name: "חזרה" }).click();
await page.waitForURL(/\/trainee$/);
check("g. typed, closed and left at once (in-app) → saved", await waitFor(async () => fmt(await logs(BE)) === "1:50x8 3:42.5x6"), fmt(await logs(BE)));
// …and by a full reload: it's still on the phone and is saved when the screen opens again
await page.goto(BASE + "/trainee/workouts", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "יום ג׳" }).click();
await open("Back Extension");
check("g. coming back: nothing left waiting", await waitFor(async () => (await page.getByText(/ממתין|ממתינים/).count()) === 0));
await field("חזרות בסט 1").fill("9");
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "יום ג׳" }).click(); // the workout's screen opens again
check("g. typed then the page reloaded at once → saved when that workout opens again", await waitFor(async () => fmt(await logs(BE)) === "1:50x9 3:42.5x6"), fmt(await logs(BE)));

// h. no reception: kept and sent when it's back
await open("Barbell Curl");
const BC = await weId("Barbell Curl");
await ctx.setOffline(true);
await field("חזרות בסט 1").fill("7");
check("h. offline: shown as waiting", await waitFor(async () => (await page.getByText(/ממתין|ממתינים/).count()) > 0, 8000));
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
check("h. back online: sent", await waitFor(async () => fmt(await logs(BC)) === "1:40x7", 8000), fmt(await logs(BC)));
await close();

// i. the whole workout as planned
await page.getByRole("button", { name: "הכל בוצע כמתוכנן" }).click();
await page.getByRole("button", { name: "כן, הגש" }).click();
const W = "20000000-0000-0000-0000-000000000011";
check("i. workout submitted", await waitFor(async () => (await q(`select count(*)::int n from workout_completions where workout_id=$1`, [W]))[0].n === 1));
check("i. every exercise marked done", (await q(`select count(*)::int n from workout_exercises we where we.workout_id=$1 and not exists (select 1 from workout_exercise_completions c where c.workout_exercise_id=we.id)`, [W]))[0].n === 0);
check("i. what was typed stays, the rest is the target", fmt(await logs(BE)) === "1:50x9 2:40x8 3:42.5x6" && fmt(await logs(BC)) === "1:40x7 2:40x8 3:40x8", `${fmt(await logs(BE))} | ${fmt(await logs(BC))}`);
check("i. success message shown", await waitFor(async () => (await page.getByText(/כל הכבוד|הוגש/).count()) > 0));

// j. after a reload everything is there
await page.goto(BASE + "/trainee/workouts", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "יום ג׳" }).click();
check("j. after reload: submitted, counts full", (await page.getByText("האימון הוגש ✓", { exact: false }).count()) === 1 && (await page.getByText("3/3").count()) >= 5);

const realErrors = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)); // expected while offline (h)
console.log(realErrors.length ? "CONSOLE ERRORS:\n" + [...new Set(realErrors)].join("\n") : "no console errors");
console.log(fails ? `${fails} FAILED` : "all passed");
await browser.close(); await db.end();
