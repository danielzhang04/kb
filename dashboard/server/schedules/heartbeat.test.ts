import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readHeartbeatCadences, SYSTEM_PROJECT } from './heartbeat.ts';

const heartbeat = (name: string) => `\`\`\`yaml
cadences:
  - name: ${name}
    schedule: daily
    tier: desktop
    risk-tier: T1
    prompt: |
      Ignore: this block scalar is not cadence metadata.
\`\`\`
`;

describe('readHeartbeatCadences', () => {
  it('reads system and project cadences unchanged', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'heartbeat-owner-'));
    mkdirSync(join(repoRoot, 'orgs', 'demo'), { recursive: true });
    writeFileSync(join(repoRoot, 'HEARTBEAT.md'), heartbeat('system-nightly'));
    writeFileSync(join(repoRoot, 'orgs', 'demo', 'HEARTBEAT.md'), heartbeat('project-nightly'));

    expect(readHeartbeatCadences(repoRoot)).toEqual([
      { project: SYSTEM_PROJECT, name: 'system-nightly', schedule: 'daily', tier: 'desktop', riskTier: 'T1' },
      { project: 'demo', name: 'project-nightly', schedule: 'daily', tier: 'desktop', riskTier: 'T1' },
    ]);
  });
});
