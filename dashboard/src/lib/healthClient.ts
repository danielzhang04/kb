import type { HealthResponse, HealthRow, HealthSectionId, UnavailableRow } from '../../server/health/service.ts';

// The closed §3.5 Deployment state union, duplicated here (never imported at runtime) the same way
// `inboxClient.ts#DEPLOYMENT_ITEM_STATES` keeps the browser bundle free of server-only modules.
const DEPLOY_ROW_STATES = [
  'waiting-confirmation', 'requested', 'parked', 'swapping', 'resuming',
  'succeeded', 'aborted', 'failed', 'acknowledged',
] as const;

export type HealthFetch = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function string(value: unknown): value is string { return typeof value === 'string'; }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value); }
function commitSha(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value); }
function digestSha256(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }

function unavailable(value: Record<string, unknown>, section: HealthSectionId): value is UnavailableRow {
  const body = record(value.value);
  return exactKeys(value, ['kind', 'key', 'label', 'value', 'observedAt', 'source'])
    && value.kind === 'unavailable' && value.key === `error:${section}` && value.label === 'Unavailable'
    && value.source === 'error' && string(value.observedAt) && body !== null
    && exactKeys(body, ['status', 'reason']) && body.status === 'unavailable' && string(body.reason);
}

function validRow(value: unknown, section: HealthSectionId): value is HealthRow {
  const row = record(value);
  if (!row) return false;
  if (unavailable(row, section)) return true;
  if (!exactKeys(row, ['kind', 'key', 'label', 'value', 'observedAt', 'source']) || !string(row.key) || !string(row.label) || !string(row.observedAt)) return false;
  const body = record(row.value);
  if (section === 'fleet') return (row.kind === 'fleet' && row.source === 'fleet' && row.key.startsWith('agent:') && body !== null
    && exactKeys(body, ['status', 'role', 'working', 'lastActive']) && ['working', 'active', 'stale', 'idle'].includes(String(body.status))
    && (body.role === null || string(body.role)) && typeof body.working === 'boolean' && (body.lastActive === null || string(body.lastActive)))
    || (row.kind === 'integrity' && row.source === 'schedule-store' && row.key.startsWith('schedule-owner:')
      && row.label === 'Schedule owner' && body !== null && exactKeys(body, ['status', 'code', 'owner'])
      && body.status === 'error' && body.code === 'schedule-owner-unresolvable' && record(body.owner) !== null);
  if (section === 'stop') return row.kind === 'stop' && row.source === 'stop' && row.key === 'stop-file' && row.label === 'STOP' && (row.value === 'present' || row.value === 'clear');
  if (section === 'daemon-machine') {
    if (row.kind === 'machine' && row.source === 'machine') {
      if (row.key === 'daemon-platform') return row.label === 'Daemon' && (row.value === 'win32' || row.value === 'linux');
      if (row.key === 'cpu') return body !== null && exactKeys(body, ['load1', 'load5', 'load15']) && number(body.load1) && number(body.load5) && number(body.load15);
      if (row.key === 'memory' || row.key === 'disk') return body !== null && exactKeys(body, ['used', 'total', 'unit']) && number(body.used) && number(body.total) && string(body.unit);
      if (row.key === 'uptime') return body !== null && exactKeys(body, ['seconds']) && integer(body.seconds);
      return false;
    }
    if (row.kind === 'daemon') return row.source === 'daemon' && row.key === 'service' && row.label === 'Service' && body !== null
      && exactKeys(body, ['unit', 'mainPid', 'loadedRoot', 'childCount'])
      && string(body.unit) && integer(body.mainPid) && string(body.loadedRoot) && integer(body.childCount);
    if (row.kind === 'release') return row.source === 'release' && row.key === 'release' && row.label === 'Release' && body !== null
      && exactKeys(body, ['sha', 'archiveSha256', 'activatedAt', 'rollbackAvailable'])
      && commitSha(body.sha) && digestSha256(body.archiveSha256) && string(body.activatedAt) && typeof body.rollbackAvailable === 'boolean';
    if (row.kind === 'deploy') return row.source === 'deploy' && row.key.startsWith('deploy:') && row.key.length > 'deploy:'.length && row.label === 'Deployment'
      && body !== null && exactKeys(body, ['deploymentRef', 'state', 'targetCommit', 'previousCommit', 'error'])
      && string(body.deploymentRef) && DEPLOY_ROW_STATES.includes(body.state as typeof DEPLOY_ROW_STATES[number])
      && string(body.targetCommit) && string(body.previousCommit) && (body.error === null || string(body.error));
    return false;
  }
  if (section === 'mcp') return (row.kind === 'mcp' && row.source === 'mcp-config' && /^mcp:[^:]+:[^:]+$/.test(row.key) && body !== null
    && exactKeys(body, ['project', 'server', 'tools']) && string(body.project) && string(body.server) && Array.isArray(body.tools) && body.tools.every(string))
    || (row.kind === 'deferred' && row.source === 'deferred' && /^mcp:[^:]+:[^:]+:(vm|desktop)$/.test(row.key)
      && (row.label === 'VM availability' || row.label === 'Desktop availability') && row.value === 'unavailable in P1');
  return row.kind === 'usage' && row.source === 'usage'
    && ((['steps', 'dispatches', 'cards'].includes(row.key) && number(row.value))
      || (row.key.startsWith('model:') && body !== null && exactKeys(body, ['steps', 'mix']) && number(body.steps) && number(body.mix)));
}

/** At most one Release row and one Service row (each may instead surface as a closed unavailable row on
 *  read failure — never both), and at most one Deployment row (the latest, never a synthesized set). */
function validDaemonSequence(rows: unknown[]): boolean {
  const releaseCount = rows.filter((value) => record(value)?.key === 'release').length;
  const serviceCount = rows.filter((value) => record(value)?.key === 'service').length;
  const deployCount = rows.filter((value) => {
    const key = record(value)?.key;
    return typeof key === 'string' && key.startsWith('deploy:');
  }).length;
  return releaseCount <= 1 && serviceCount <= 1 && deployCount <= 1;
}

function validMcpSequence(rows: unknown[]): boolean {
  if (rows.length === 1 && unavailable(record(rows[0]) ?? {}, 'mcp')) return true;
  if (rows.length % 3 !== 0) return false;
  for (let index = 0; index < rows.length; index += 3) {
    const configured = record(rows[index]);
    const vm = record(rows[index + 1]);
    const desktop = record(rows[index + 2]);
    if (!configured || configured.kind !== 'mcp' || !string(configured.key) || !vm || !desktop) return false;
    if (vm.kind !== 'deferred' || vm.key !== `${configured.key}:vm` || vm.label !== 'VM availability') return false;
    if (desktop.kind !== 'deferred' || desktop.key !== `${configured.key}:desktop` || desktop.label !== 'Desktop availability') return false;
  }
  return true;
}

export function decodeHealthResponse(value: unknown): HealthResponse {
  const body = record(value);
  const expected: Array<[HealthSectionId, string]> = [
    ['fleet', 'Fleet'], ['stop', 'STOP'], ['daemon-machine', 'Daemon and machine'], ['mcp', 'MCP'], ['usage', 'Usage'],
  ];
  if (!body || !exactKeys(body, ['sections']) || !Array.isArray(body.sections) || body.sections.length !== expected.length) throw new Error('Invalid Health response');
  for (const [index, [id, label]] of expected.entries()) {
    const section = record(body.sections[index]);
    if (!section || !exactKeys(section, ['id', 'label', 'rows']) || section.id !== id || section.label !== label || !Array.isArray(section.rows)
      || !section.rows.every((row) => validRow(row, id))
      || (id === 'daemon-machine' && !validDaemonSequence(section.rows))
      || (id === 'mcp' && !validMcpSequence(section.rows))) {
      throw new Error('Invalid Health response');
    }
  }
  return body as unknown as HealthResponse;
}

export async function fetchHealth(fetchImpl: HealthFetch = fetch): Promise<HealthResponse> {
  const response = await fetchImpl('/api/health', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET /api/health failed: ${response.status}`);
  return decodeHealthResponse(await response.json());
}
