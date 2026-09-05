/** The system only supports kg today — label it, rather than leave the unit ambiguous. */
export function formatWeight(weight: string | null | undefined): string | null {
  if (!weight) return null;
  return /ק"ג|קג|kg/i.test(weight) ? weight : `${weight} ק"ג`;
}
