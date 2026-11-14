import { APP_TIME_ZONE } from "@/lib/week";

/** The system only supports kg today — label it, rather than leave the unit ambiguous. */
export function formatWeight(weight: string | null | undefined): string | null {
  if (!weight) return null;
  return /ק"ג|קג|kg/i.test(weight) ? weight : `${weight} ק"ג`;
}

// Every date/time below is formatted in Israel time explicitly. Server
// components render on Cloudflare Workers, whose clock is UTC: without the
// time zone a 19:00 workout showed as 16:00/17:00 on server-rendered pages,
// and a client component could disagree with its own server render.

/** Compact "5.9, 14:30" style — used wherever the trainer needs to glance at recency. */
export function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/** "14:30" */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/** "5.9" */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

/** "תרגיל אחד" / "4 תרגילים" — Hebrew counts read wrong as "1 תרגילים". */
export function countExercises(n: number): string {
  return n === 1 ? "תרגיל אחד" : `${n} תרגילים`;
}

/** "סט אחד" / "12 סטים" */
export function countSets(n: number): string {
  return n === 1 ? "סט אחד" : `${n} סטים`;
}
