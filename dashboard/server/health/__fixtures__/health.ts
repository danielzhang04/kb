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
        { kind: 'machine', key: 'cpu', label: 'CPU', value: { load1: 0.42, load5: 0.31, load15: 0.28 }, observedAt: '2026-08-21T12:00:00.000Z', source: 'machine' },
        { kind: 'machine', key: 'memory', label: 'Memory', value: { used: 4_000_000_000, total: 16_000_000_000, unit: 'bytes' }, observedAt: '2026-08-21T12:00:00.000Z', source: 'machine' },
        { kind: 'machine', key: 'disk', label: 'Disk', value: { used: 100_000_000_000, total: 500_000_000_000, unit: 'bytes' }, observedAt: '2026-08-21T12:00:00.000Z', source: 'machine' },
        { kind: 'machine', key: 'uptime', label: 'Uptime', value: { seconds: 86_400 }, observedAt: '2026-08-21T12:00:00.000Z', source: 'machine' },
        {
          kind: 'daemon', key: 'service', label: 'Service',
          value: { unit: 'kb-dashboard.service', mainPid: 4242, loadedRoot: '/opt/kb-releases/current', childCount: 3 },
          observedAt: '2026-08-21T12:00:00.000Z', source: 'daemon',
        },
        {
          kind: 'release', key: 'release', label: 'Release',
          value: { sha: '64fb3d02' + 'a'.repeat(32), archiveSha256: 'b'.repeat(64), activatedAt: '2026-08-21T10:00:00.000Z', rollbackAvailable: true },
          observedAt: '2026-08-21T12:00:00.000Z', source: 'release',
        },
        {
          kind: 'deploy', key: 'deploy:deployment:1', label: 'Deployment',
          value: { deploymentRef: 'deployment:1', state: 'succeeded', targetCommit: 'c'.repeat(40), previousCommit: 'd'.repeat(40), error: null },
          observedAt: '2026-08-21T12:00:00.000Z', source: 'deploy',
        },
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
