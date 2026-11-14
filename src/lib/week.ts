/**
 * Calendar-week helpers. Weeks run Sunday–Saturday (Israeli convention),
 * matching the `week_start_date` (Sunday) stored on `programs` in the DB.
 */

/** The app's one time zone: a single coach and their trainees, all in Israel. */
export const APP_TIME_ZONE = "Asia/Jerusalem";

const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * "Now" (or `instant`) as a Date whose LOCAL fields — the ones getWeekStart,
 * toDateKey and getDay read — are the wall clock in Israel, wherever the
 * code runs. Server code runs in UTC (Cloudflare Workers), where a plain
 * `new Date()` is still Saturday for the first two or three hours of an
 * Israeli Sunday: the wrong "current week", the wrong "today", a trainee
 * locked out of (or let into) the wrong week. In a browser set to Israel
 * time this is simply the same moment.
 *
 * For calendar arithmetic only. Never store or send the result: outside
 * Israel time the instant it represents is shifted by the zone offset.
 */
export function israelNow(instant: Date = new Date()): Date {
  const parts: Record<string, number> = {};
  for (const part of wallClock.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** Midnight-local Sunday that starts the week containing `date`. */
export function getWeekStart(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** 'YYYY-MM-DD', for a `date` column — always the local calendar date. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "30/8 - 5/9" */
export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const fmt = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `${fmt(weekStart)}–${fmt(end)}`;
}

/**
 * "השבוע הנוכחי" / "שבוע הבא" / "לפני N שבועות" / plain date range,
 * relative to `today` (defaults to now).
 */
export function formatWeekLabel(weekStart: Date, today: Date = israelNow()): string {
  const currentWeekStart = getWeekStart(today);
  const diffWeeks = Math.round(
    (weekStart.getTime() - currentWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );

  if (diffWeeks === 0) return "השבוע הנוכחי";
  if (diffWeeks === 1) return "השבוע הבא";
  if (diffWeeks === 2) return "בעוד שבועיים";
  if (diffWeeks === -1) return "שבוע שעבר";
  if (diffWeeks < -1) return `לפני ${Math.abs(diffWeeks)} שבועות`;
  return `בעוד ${diffWeeks} שבועות`;
}

/** 0 (Sunday) through 6 (Saturday) — matches `workouts.day_of_week`. */
export const DAY_NAMES = ["יום א׳", "יום ב׳", "יום ג׳", "יום ד׳", "יום ה׳", "יום ו׳", "שבת"];

export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? "יום לא ידוע";
}
