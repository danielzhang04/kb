import type { HomeResponse, HomeUnavailableReason } from '../../server/home/contracts.ts';
import { invalidateSessionOnGovernedAuthFailure } from './authClient.ts';

export type HomeFetch = typeof fetch;

const LIFECYCLES = new Set([
  'planned', 'recovering', 'running', 'waiting-human', 'stopping', 'paused-for-deploy',
  'succeeded', 'failed', 'stopped', 'interrupted', 'archived',
]);
const OUTCOMES = new Set(['ok', 'failed', 'stopped', 'interrupted', 'abandoned']);
const UNAVAILABLE_REASONS = new Set<HomeUnavailableReason>([
  'attention-unavailable', 'inbox-unavailable', 'schedules-unavailable', 'release-unavailable', 'outcomes-unavailable',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function allowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function count(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function timestamp(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }

function runnable(value: unknown): boolean {
  const owner = record(value);
  if (!owner || !text(owner.id) || !text(owner.sourcePath)) return false;
  if (owner.type === 'agent') return exactKeys(owner, ['type', 'id', 'sourcePath']) && /^agents\/[^/]+\.md$/.test(owner.sourcePath);
  return owner.type === 'workflow' && text(owner.project)
    && exactKeys(owner, ['type', 'id', 'project', 'sourcePath'])
    && /^orgs\/[^/]+\/workflows\/[^/]+\.md$/.test(owner.sourcePath);
}

function runRow(value: unknown): boolean {
  const run = record(value);
  if (!run || !allowedKeys(run,
    ['runRef', 'title', 'owner', 'lifecycle', 'outcome', 'createdAt', 'completedAt', 'streamKind'],
    ['sessionId', 'elapsedMs', 'toolsCalled', 'lastLine', 'gateBadge'])) return false;
  return text(run.runRef) && text(run.title) && runnable(run.owner)
    && typeof run.lifecycle === 'string' && LIFECYCLES.has(run.lifecycle)
    && (run.outcome === null || typeof run.outcome === 'string' && OUTCOMES.has(run.outcome))
    && timestamp(run.createdAt) && (run.completedAt === null || timestamp(run.completedAt))
    && (run.streamKind === 'pty' || run.streamKind === 'transcript')
    && (run.sessionId === undefined || text(run.sessionId))
    && (run.elapsedMs === undefined || count(run.elapsedMs))
    && (run.toolsCalled === undefined || count(run.toolsCalled))
    && (run.lastLine === undefined || typeof run.lastLine === 'string')
    && (run.gateBadge === undefined || run.gateBadge === null || typeof run.gateBadge === 'string');
}

function unavailable(value: unknown): boolean {
  const result = record(value);
  return result !== null && exactKeys(result, ['state', 'reason']) && result.state === 'unavailable'
    && typeof result.reason === 'string' && UNAVAILABLE_REASONS.has(result.reason as HomeUnavailableReason);
}

function ready(value: unknown, section: string, validate: (data: Record<string, unknown>) => boolean): boolean {
  const result = record(value);
  const data = record(result?.data);
  return result !== null && exactKeys(result, ['state', 'data']) && result.state === 'ready'
    && data !== null && data.section === section && validate(data);
}

function validRunning(value: unknown): boolean {
  return unavailable(value) || ready(value, 'running-now', (data) =>
    exactKeys(data, ['section', 'runs']) && Array.isArray(data.runs) && data.runs.every(runRow));
}

function validAttention(value: unknown): boolean {
  return unavailable(value) || ready(value, 'attention-counts', (data) =>
    exactKeys(data, ['section', 'agents', 'workflows', 'inbox'])
    && count(data.agents) && count(data.workflows) && count(data.inbox));
}

function occurrence(value: unknown): boolean {
  const item = record(value);
  return item !== null && exactKeys(item, ['scheduleId', 'scheduledFor', 'nextAt', 'owner'])
    && text(item.scheduleId) && timestamp(item.scheduledFor) && timestamp(item.nextAt) && runnable(item.owner);
}

function validSchedules(value: unknown): boolean {
  return unavailable(value) || ready(value, 'next-schedules', (data) =>
    exactKeys(data, ['section', 'occurrences']) && Array.isArray(data.occurrences) && data.occurrences.every(occurrence));
}

function validVersion(value: unknown): boolean {
  return unavailable(value) || ready(value, 'version', (data) =>
    exactKeys(data, ['section', 'label', 'sha', 'activatedAt']) && data.label === 'VM'
    && typeof data.sha === 'string' && /^[0-9a-f]{8,64}$/.test(data.sha) && timestamp(data.activatedAt));
}

function outcome(value: unknown): boolean {
  const item = record(value);
  return item !== null && exactKeys(item, ['runRef', 'title', 'completedAt', 'outcome'])
    && text(item.runRef) && text(item.title) && timestamp(item.completedAt)
    && typeof item.outcome === 'string' && OUTCOMES.has(item.outcome);
}

function validOutcomes(value: unknown): boolean {
  return unavailable(value) || ready(value, 'recent-outcomes', (data) =>
    exactKeys(data, ['section', 'outcomes']) && Array.isArray(data.outcomes) && data.outcomes.every(outcome));
}

export function decodeHomeResponse(value: unknown): HomeResponse {
  const body = record(value);
  if (!body || !exactKeys(body, ['revision', 'sections']) || !text(body.revision)
    || !Array.isArray(body.sections) || body.sections.length !== 5
    || !validRunning(body.sections[0]) || !validAttention(body.sections[1])
    || !validSchedules(body.sections[2]) || !validVersion(body.sections[3]) || !validOutcomes(body.sections[4])) {
    throw new Error('Invalid Home response');
  }
  return body as unknown as HomeResponse;
}

export async function fetchHome(token: string, fetchImpl: HomeFetch = fetch): Promise<HomeResponse> {
  const response = await fetchImpl('/api/home', {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    await invalidateSessionOnGovernedAuthFailure(response);
    throw new Error(`GET /api/home failed: ${response.status}`);
  }
  return decodeHomeResponse(await response.json());
}
