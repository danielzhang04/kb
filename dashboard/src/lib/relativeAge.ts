const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact, stable row recency. Invalid or legacy-absent timestamps fail soft as "recently". */
export function relativeAge(value: string | undefined, now: number = Date.now()): string {
  if (value === undefined) return 'recently';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'recently';
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function recencyLabel(verb: 'Arrived' | 'Updated', value: string | undefined, now: number = Date.now()): string {
  const age = relativeAge(value, now);
  // 'now' and the soft-fail 'recently' are already adverbs — appending " ago" reads wrong.
  if (age === 'now' || age === 'recently') return `${verb} ${age}`;
  return `${verb} ${age} ago`;
}
