/** The system only supports kg today — label it, rather than leave the unit ambiguous. */
export function formatWeight(weight: string | null | undefined): string | null {
  if (!weight) return null;
  return /ק"ג|קג|kg/i.test(weight) ? weight : `${weight} ק"ג`;
}

/** Compact "5.9, 14:30" style — used wherever the trainer needs to glance at recency. */
export function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
