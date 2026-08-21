import type { HealthResponse, HealthRow, HealthSectionId, UnavailableRow } from '../../server/health/service.ts';

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
  if (section === 'fleet') return row.kind === 'fleet' && row.source === 'fleet' && row.key.startsWith('agent:') && body !== null
    && exactKeys(body, ['status', 'role', 'working', 'lastActive']) && ['working', 'active', 'stale', 'idle'].includes(String(body.status))
    && (body.role === null || string(body.role)) && typeof body.working === 'boolean' && (body.lastActive === null || string(body.lastActive));
  if (section === 'stop') return row.kind === 'stop' && row.source === 'stop' && row.key === 'stop-file' && row.label === 'STOP' && (row.value === 'present' || row.value === 'clear');
  if (section === 'daemon-machine') return (row.kind === 'machine' && row.source === 'machine' && row.key === 'daemon-platform' && row.label === 'Daemon' && (row.value === 'win32' || row.value === 'linux'))
    || (row.kind === 'deferred' && row.source === 'deferred' && row.key === 'release' && row.label === 'Release' && row.value === 'unavailable in P1');
  if (section === 'mcp') return (row.kind === 'mcp' && row.source === 'mcp-config' && /^mcp:[^:]+:[^:]+$/.test(row.key) && body !== null
    && exactKeys(body, ['project', 'server', 'tools']) && string(body.project) && string(body.server) && Array.isArray(body.tools) && body.tools.every(string))
    || (row.kind === 'deferred' && row.source === 'deferred' && /^mcp:[^:]+:[^:]+:(vm|desktop)$/.test(row.key)
      && (row.label === 'VM availability' || row.label === 'Desktop availability') && row.value === 'unavailable in P1');
  return row.kind === 'usage' && row.source === 'usage'
    && ((['steps', 'dispatches', 'cards'].includes(row.key) && number(row.value))
      || (row.key.startsWith('model:') && body !== null && exactKeys(body, ['steps', 'mix']) && number(body.steps) && number(body.mix)));
}

export function decodeHealthResponse(value: unknown): HealthResponse {
  const body = record(value);
  const expected: Array<[HealthSectionId, string]> = [
    ['fleet', 'Fleet'], ['stop', 'STOP'], ['daemon-machine', 'Daemon and machine'], ['mcp', 'MCP'], ['usage', 'Usage'],
  ];
  if (!body || !exactKeys(body, ['sections']) || !Array.isArray(body.sections) || body.sections.length !== expected.length) throw new Error('Invalid Health response');
  for (const [index, [id, label]] of expected.entries()) {
    const section = record(body.sections[index]);
    if (!section || !exactKeys(section, ['id', 'label', 'rows']) || section.id !== id || section.label !== label || !Array.isArray(section.rows) || !section.rows.every((row) => validRow(row, id))) {
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
