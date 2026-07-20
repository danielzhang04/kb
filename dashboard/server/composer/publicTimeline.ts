import type { TimelineModel } from '../../src/lib/timelineModel.ts';

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const KNOWN_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const DASHBOARD_BEARER = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{43}\b/g;
const NAMED_SECRET = /((?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret|password|passwd)\s*[:=]\s*)[^\s,'"}]+/gi;
/** Google OAuth access token (Gmail/Drive/Calendar connectors). Always `ya29.` + base64url. */
const GOOGLE_ACCESS_TOKEN = /\bya29\.[A-Za-z0-9_-]{20,}/g;
/**
 * Google OAuth refresh token. The `1//` prefix alone is far too weak to match on — it occurs in
 * ordinary prose and in URL paths — so the pattern demands a long unbroken base64url run after it
 * and refuses to start mid-token. Real refresh tokens carry well over 30 trailing characters.
 */
const GOOGLE_REFRESH_TOKEN = /(?<![A-Za-z0-9_-])1\/\/[A-Za-z0-9_-]{30,}/g;

/**
 * Redact recognized SECRETS from a string.
 *
 * SCOPE — read this before relying on it as a guard. This is a credential scrubber and nothing
 * more. It matches known secret SHAPES: private-key blocks, a fixed list of vendor-prefixed API
 * tokens, JWTs, the dashboard bearer, Google OAuth access/refresh tokens, and `name: value` pairs
 * whose name is secret-ish. It is NOT a PII scrubber and NOT a general sensitivity filter: it does
 * not and will not catch verification codes, account balances, email addresses, message bodies,
 * file contents, search queries, or anything else whose sensitivity comes from meaning rather than
 * format. Several call sites use `redactSensitiveText(x) !== x` as a reject-if-dirty gate; those
 * gates prove only "no recognized credential", never "safe to publish". Containment for
 * arbitrary sensitive content has to come from omitting the field, not from this function.
 */
export function redactSensitiveText(value: string, exactSecrets: string[] = []): string {
  let clean = value;
  for (const secret of exactSecrets) {
    if (secret.length >= 8) clean = clean.split(secret).join('[redacted]');
  }
  return clean
    .replace(PRIVATE_KEY, '[private key redacted]')
    .replace(KNOWN_TOKEN, '[token redacted]')
    .replace(JWT, '[token redacted]')
    .replace(DASHBOARD_BEARER, '[dashboard bearer redacted]')
    .replace(GOOGLE_ACCESS_TOKEN, '[token redacted]')
    .replace(GOOGLE_REFRESH_TOKEN, '[token redacted]')
    .replace(NAMED_SECRET, '$1[redacted]');
}

/**
 * Browser-safe Composer transcript. Hidden reasoning never crosses the server boundary. Tool names and
 * success/error shape remain inspectable, while arbitrary tool inputs/results stay server-local because
 * they can contain file contents, queries, paths, or ambient credentials.
 */
export function publicTimeline(model: TimelineModel, exactSecrets: string[] = []): TimelineModel {
  const redacted = JSON.parse(
    JSON.stringify(model, (_key, value: unknown) =>
      typeof value === 'string' ? redactSensitiveText(value, exactSecrets) : value),
  ) as TimelineModel;
  const sanitizeTurns = (turns: TimelineModel['turns']): TimelineModel['turns'] => turns.map((turn) => ({
    ...turn,
    steps: turn.steps
      .filter((step) => step.kind !== 'thinking')
      .map((step) => {
        if (step.kind !== 'tool_use') return step;
        return {
          ...step,
          input: step.input === undefined ? undefined : { omitted: true },
          result: step.result
            ? { ...step.result, content: '[tool result omitted from browser transcript]' }
            : step.result,
          subagent: step.subagent
            ? { ...step.subagent, turns: sanitizeTurns(step.subagent.turns) }
            : step.subagent,
        };
      }),
  }));
  return { turns: sanitizeTurns(redacted.turns) };
}

export function visibleAssistantText(model: TimelineModel | null): string {
  if (!model) return '';
  return model.turns
    .flatMap((turn) => turn.steps)
    .filter((step) => step.kind === 'text' && typeof step.text === 'string')
    .map((step) => step.text as string)
    .join('\n')
    .trim();
}
