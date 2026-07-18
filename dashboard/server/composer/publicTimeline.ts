import type { TimelineModel } from '../../src/lib/timelineModel.ts';

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const KNOWN_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const DASHBOARD_BEARER = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{43}\b/g;
const NAMED_SECRET = /((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\s*[:=]\s*)[^\s,'"}]+/gi;

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
