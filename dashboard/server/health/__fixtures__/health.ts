import type { HealthResponse } from '../service.ts';

export const healthResponseFixture: HealthResponse = {
  sections: [
    {
      id: 'fleet',
      label: 'Fleet',
      rows: [{
        kind: 'fleet', key: 'agent:worker-a', label: 'Worker A',
        value: { status: 'working', role: 'builder', working: true, lastActive: '2026-08-21' },
        observedAt: '2026-08-21T12:00:00.000Z', source: 'fleet',
      }],
    },
    {
      id: 'stop', label: 'STOP',
      rows: [{ kind: 'stop', key: 'stop-file', label: 'STOP', value: 'clear', observedAt: '2026-08-21T12:00:00.000Z', source: 'stop' }],
    },
    {
      id: 'daemon-machine', label: 'Daemon and machine',
      rows: [
        { kind: 'machine', key: 'daemon-platform', label: 'Daemon', value: 'win32', observedAt: '2026-08-21T12:00:00.000Z', source: 'machine' },
        { kind: 'deferred', key: 'release', label: 'Release', value: 'unavailable in P1', observedAt: '2026-08-21T12:00:00.000Z', source: 'deferred' },
      ],
    },
    {
      id: 'mcp', label: 'MCP',
      rows: [
        { kind: 'mcp', key: 'mcp:demo:files', label: 'demo / files', value: { project: 'demo', server: 'files', tools: ['read'] }, observedAt: '2026-08-21T12:00:00.000Z', source: 'mcp-config' },
        { kind: 'deferred', key: 'mcp:demo:files:vm', label: 'VM availability', value: 'unavailable in P1', observedAt: '2026-08-21T12:00:00.000Z', source: 'deferred' },
        { kind: 'deferred', key: 'mcp:demo:files:desktop', label: 'Desktop availability', value: 'unavailable in P1', observedAt: '2026-08-21T12:00:00.000Z', source: 'deferred' },
      ],
    },
    {
      id: 'usage', label: 'Usage',
      rows: [{ kind: 'usage', key: 'steps', label: 'Steps', value: 4, observedAt: '2026-08-21T12:00:00.000Z', source: 'usage' }],
    },
  ],
};
