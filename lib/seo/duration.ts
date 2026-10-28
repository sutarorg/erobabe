/**
 * ISO 8601 duration for VideoObject / video sitemaps (PT1H2M3S).
 *
 * Google accepts a seconds-only form (`PT3723S`) but documents the
 * hour/minute/second breakdown, which is also what rich-result testers expect.
 */
export function iso8601Duration(totalSeconds: number): string | undefined {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return undefined;
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  let value = "PT";
  if (hours) value += `${hours}H`;
  if (minutes) value += `${minutes}M`;
  if (rest || (!hours && !minutes)) value += `${rest}S`;
  return value;
}
