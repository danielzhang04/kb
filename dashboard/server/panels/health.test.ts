/**
 * D3.5 — Sentinel (health) panel. Read-only agent liveness derived from the existing Plane-A
 * projection: the roster's ledger activity + working-card state (reused `agents/roster.ts`), the org
 * STATE `## Blocked` sections (reused `planeA/states.ts`), and the declared HEARTBEAT cadences. No new
 * write path, no fabricated signal — liveness is a pure function of last-observed ledger dates against
 * an injectable `asOf`, so the tests are deterministic.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../routing/yaml.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import { buildHealthPanel, readHeartbeatCadences, parseCadences } from './health.ts';

const POLICY = parseYaml(`version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases: { sonnet: claude-sonnet-5 }
    known_models: [claude-opus-4-8, claude-sonnet-5]
role_default: { runtime: claude, model: sonnet }
`) as PolicyDoc;

const NO_OVERRIDE: OverrideDoc = { overrides: [] };

/** Root system HEARTBEAT with a `prompt: |` block scalar (the real shape — must not choke the parser). */
const ROOT_HEARTBEAT = `# Heartbeat — kb (the system itself)

\`\`\`yaml
cadences:
  - name: nightly-review
    schedule: daily
    tier: cloud
    risk-tier: T1
    prompt: |
      1. Run: python scripts/preamble.py
      2. Something with a colon: this must not be read as a key.
  - name: weekly-audit
    schedule: weekly:sat
    tier: cloud
    risk-tier: T1
\`\`\`
`;

/** A per-org HEARTBEAT (simple form, no block scalar). */
const ORG_HEARTBEAT = `# Heartbeat — demo

\`\`\`yaml
cadences:
  - name: org-nightly
    schedule: daily
    tier: desktop
\`\`\`
`;

function state(now: string, blocked: string): string {
  return `# demo — STATE\n\n## Now\n${now}\n\n## Next\n- x\n\n## Blocked\n${blocked}\n`;
}

/** Build a temp repo with ledgers, an org STATE + HEARTBEAT, and a root HEARTBEAT. */
function tempRepo(opts: { blocked?: string; withRootHb?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'health-repo-'));
  mkdirSync(join(root, 'ledgers', 'cost'), { recursive: true });
  mkdirSync(join(root, 'ledgers', 'dispatch'), { recursive: true });
  mkdirSync(join(root, 'orgs', 'demo'), { recursive: true });
  // Recent writer (2026-07-17) and a stale writer (2026-07-01).
  writeFileSync(
    join(root, 'ledgers', 'cost', 'worker-desktop-2026-07-17.tsv'),
    'model\tstep\tusd\nclaude-sonnet-5\tbuild\t0.1\n',
  );
  writeFileSync(
    join(root, 'ledgers', 'dispatch', 'dispatcher-cloud-2026-07-01.tsv'),
    'cadence\tcard\tdate\tproject\nnightly\taaaa\t2026-07-01\tdemo\n',
  );
  writeFileSync(join(root, 'orgs', 'demo', 'STATE.md'), state('- building', opts.blocked ?? '(nothing blocked)'));
  writeFileSync(join(root, 'orgs', 'demo', 'HEARTBEAT.md'), ORG_HEARTBEAT);
  if (opts.withRootHb ?? true) writeFileSync(join(root, 'HEARTBEAT.md'), ROOT_HEARTBEAT);
  return root;
}

describe('parseCadences', () => {
  it('extracts cadence metadata and SKIPS block-scalar prompt bodies (no false keys)', () => {
    const cadences = parseCadences(ROOT_HEARTBEAT, 'system');
    expect(cadences.map((c) => c.name)).toEqual(['nightly-review', 'weekly-audit']);
    const nightly = cadences[0];
    expect(nightly).toEqual({
      project: 'system',
      name: 'nightly-review',
      schedule: 'daily',
      tier: 'cloud',
      riskTier: 'T1',
    });
    // The `2. Something with a colon:` line inside the prompt must never leak in as a cadence/field.
    expect(cadences.every((c) => c.name !== 'Something with a colon')).toBe(true);
    expect(cadences[1].schedule).toBe('weekly:sat');
  });

  it('returns [] when there is no yaml fence', () => {
    expect(parseCadences('# just prose\n', 'system')).toEqual([]);
  });
});

describe('readHeartbeatCadences', () => {
  it('reads the root system heartbeat + every org heartbeat, tagged by project', () => {
    const cadences = readHeartbeatCadences(tempRepo());
    const byProject = new Map(cadences.map((c) => [c.name, c.project]));
    expect(byProject.get('nightly-review')).toBe('system');
    expect(byProject.get('org-nightly')).toBe('demo');
  });

  it('degrades to [] when no HEARTBEAT files exist', () => {
    const bare = mkdtempSync(join(tmpdir(), 'health-bare-'));
    expect(readHeartbeatCadences(bare)).toEqual([]);
  });
});

describe('buildHealthPanel', () => {
  it('reports agent liveness from ledger recency against asOf + working-card state', () => {
    const root = tempRepo();
    const panel = buildHealthPanel(root, POLICY, NO_OVERRIDE, { asOf: '2026-07-17', stalenessDays: 2 });

    const worker = panel.agents.find((a) => a.id === 'worker-desktop')!;
    // Wrote a ledger on asOf → active (live), not working (no working card).
    expect(worker.status).toBe('active');
    expect(worker.live).toBe(true);
    expect(worker.lastActive).toBe('2026-07-17');

    const stale = panel.agents.find((a) => a.id === 'dispatcher-cloud')!;
    // Last wrote 2026-07-01, far outside the 2-day window → stale, not live.
    expect(stale.status).toBe('stale');
    expect(stale.live).toBe(false);

    expect(panel.liveCount).toBe(1);
    expect(panel.asOf).toBe('2026-07-17');
  });

  it('surfaces the declared HEARTBEAT cadences and per-org blocked flags from STATE', () => {
    const panel = buildHealthPanel(tempRepo({ blocked: '- waiting on human approval' }), POLICY, NO_OVERRIDE, {
      asOf: '2026-07-17',
    });
    // Root/system cadences are separated from per-org cadences; both are counted.
    expect(panel.systemCadences.map((c) => c.name)).toEqual(['nightly-review', 'weekly-audit']);
    const demo = panel.orgs.find((o) => o.project === 'demo')!;
    expect(demo.cadences.map((c) => c.name)).toEqual(['org-nightly']);
    // A real Blocked body flips the flag; a "(nothing blocked)" placeholder does not.
    expect(demo.blocked).toBe(true);
    expect(panel.cadenceCount).toBe(3);
  });

  it('treats a "(nothing blocked)" placeholder as NOT blocked', () => {
    const panel = buildHealthPanel(tempRepo({ blocked: '(nothing blocked)' }), POLICY, NO_OVERRIDE, { asOf: '2026-07-17' });
    expect(panel.orgs.find((o) => o.project === 'demo')!.blocked).toBe(false);
  });

  it('is empty-safe: a bare repo yields empty agents/orgs and a today default asOf', () => {
    const bare = mkdtempSync(join(tmpdir(), 'health-empty-'));
    const panel = buildHealthPanel(bare, POLICY, NO_OVERRIDE);
    expect(panel.agents).toEqual([]);
    expect(panel.orgs).toEqual([]);
    expect(panel.cadenceCount).toBe(0);
    expect(panel.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
