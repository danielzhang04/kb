const SECRET_KEY = /^(authorization|cookie|set-cookie|assertion|ceremonyid|token)$/i;
const HEADER_SECRET = /\b(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+/gi;

export function redactText(value: string): string {
  return value.replace(HEADER_SECRET, '$1: [REDACTED]').replace(BEARER, 'Bearer [REDACTED]');
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactValue(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redactValue(item, depth + 1);
  }
  return output;
}

export type SafeLogger = (event: string, fields?: Record<string, unknown>) => void;

export function safeLog(logger: SafeLogger | undefined, event: string, fields?: Record<string, unknown>): void {
  if (!logger) return;
  logger(redactText(event), redactValue(fields ?? {}) as Record<string, unknown>);
}
