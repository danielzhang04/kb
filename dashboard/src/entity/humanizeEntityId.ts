const ACRONYMS = new Set([
  'api', 'cli', 'cpu', 'fyt', 'gpu', 'kb', 'mcp', 'pr', 'pty', 'ram', 'sse', 'vm', 'wsl',
]);

/** Human presentation only: callers keep the unmodified id for keys, URLs, and API values. */
export function humanizeEntityId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => {
      const normalized = word.toLowerCase();
      return ACRONYMS.has(normalized)
        ? normalized.toUpperCase()
        : `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`;
    })
    .join(' ');
}
