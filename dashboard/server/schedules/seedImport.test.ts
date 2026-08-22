import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import type { RunnableRef } from '../control/p2Contracts.ts';
import { openAttestedScheduleSource } from './attestedSource.ts';
import type { ScheduleStorePort } from './contracts.ts';
import {
  EXPECTED_SEED_OWNER_BY_CADENCE,
  importHeartbeatScheduleSeedsV1,
  migratePausedCadenceMarkersToScheduleArmedV1,
  seedScheduleId,
  type DevelopmentScheduleSeedSource,
} from './seedImport.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const DV3_FIXTURES = resolve(import.meta.dirname, '../control/__fixtures__/dv3');
const PAUSE_FIXTURE = readdirSync(DV3_FIXTURES).map((name) => {
  try { return JSON.parse(readFileSync(resolve(DV3_FIXTURES, name), 'utf8')) as Record<string, unknown>; } catch { return {}; }
}).find((value) => Array.isArray(value.markers));
const PAUSE_GOLDEN = (PAUSE_FIXTURE?.markers as Array<{ marker: string; scheduleId: string; digest: string }>)[0];
const HEARTBEAT_PATHS = ['HEARTBEAT.md', 'orgs/atlas-prep/HEARTBEAT.md', 'orgs/kb-ops/HEARTBEAT.md'] as const;
const AGENT_IDS = [...new Set(Object.values(EXPECTED_SEED_OWNER_BY_CADENCE))].sort();
const NEW_SYSTEM_AGENT_IDS = [
  'context-lifecycle', 'dispatcher-cloud', 'grader', 'hygiene', 'learnings-implementer',
  'lessons-miner', 'model-audit', 'system-sweeper',
] as const;

function developmentSource(): DevelopmentScheduleSeedSource {
  return {
    heartbeatFiles: HEARTBEAT_PATHS.map((path) => ({ path, bytes: readFileSync(resolve(REPO, path), 'utf8') })),
    agentFiles: AGENT_IDS.map((id) => ({ path: `agents/${id}.md`, bytes: readFileSync(resolve(REPO, `agents/${id}.md`), 'utf8') })),
  };
}

function fixtureRelease(
  sourceCommit = 'a'.repeat(40),
  mutate?: (root: string) => void,
): string {
  const root = mkdtempSync(join(tmpdir(), 'schedule-seed-release-'));
  for (const file of [...developmentSource().heartbeatFiles, ...developmentSource().agentFiles]) {
    const target = resolve(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
  }
  writeFileSync(resolve(root, 'VERSION'), `${sourceCommit}\n`);
  writeFileSync(resolve(root, 'attestation.json'), JSON.stringify({
    workflow: 'kb-platform-release', sourceCommit, sha256: 'b'.repeat(64),
  }));
  mutate?.(root);
  return root;
}

describe('importHeartbeatScheduleSeedsV1', () => {
  it('reads the fixture release tree cadence and declaration bytes through attestation and derives arming', async () => {
    const root = fixtureRelease();
    const source = await openAttestedScheduleSource({ currentPath: root });
    const commit = vi.fn(async () => undefined);
    const result = await importHeartbeatScheduleSeedsV1({ source }, commit);
    expect(result.ok).toBe(true);
    if (!result.ok || result.replayed) throw new Error('expected seed plan');
    expect(result.plan.marker.releaseSha).toBe('a'.repeat(40));
    expect(result.plan.seeds).toHaveLength(13);
    expect(Object.fromEntries(result.plan.seeds.map((seed) => [seed.name, seed.owner.id]))).toEqual(EXPECTED_SEED_OWNER_BY_CADENCE);
    for (const seed of result.plan.seeds) expect(seed.id).toBe(seedScheduleId(seed.path, seed.name));
    expect(result.plan.seeds.find((seed) => seed.name === 'research-draft-gate')).toMatchObject({
      armed: false, disarmedReason: 'seed-cadence-unsupported',
    });
    expect(result.plan.seeds.filter((seed) => seed.name !== 'research-draft-gate').every((seed) => seed.armed)).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('imports worktree development bytes disarmed because authorization is never caller-supplied', async () => {
    const source = await openAttestedScheduleSource({ currentPath: resolve(tmpdir(), 'absent-kb-release') });
    const commit = vi.fn(async () => undefined);
    const result = await importHeartbeatScheduleSeedsV1({ source, development: developmentSource() }, commit);
    expect(result.ok).toBe(true);
    if (!result.ok || result.replayed) throw new Error('expected dev seed plan');
    expect(result.plan.marker.releaseSha).toBeNull();
    expect(result.plan.seeds.every((seed) => !seed.armed)).toBe(true);
    expect(result.plan.seeds.filter((seed) => seed.name !== 'research-draft-gate')
      .every((seed) => seed.disarmedReason === 'seed-not-on-protected-main')).toBe(true);
    const implementation = readFileSync(resolve(import.meta.dirname, 'seedImport.ts'), 'utf8');
    expect(implementation).not.toMatch(/\.attested\b|input\.releaseSha/);
  });

  it('treats duplicate seed import as a permanent later-boot no-op for every valid version-1 marker', async () => {
    const firstCommit = vi.fn(async () => undefined);
    const first = await importHeartbeatScheduleSeedsV1({
      source: await openAttestedScheduleSource({ currentPath: fixtureRelease('a'.repeat(40)) }),
    }, firstCommit);
    if (!first.ok || first.replayed) throw new Error('expected first import');

    const laterCommit = vi.fn(async () => undefined);
    const laterRoot = fixtureRelease('c'.repeat(40), (root) => {
      const heartbeat = resolve(root, 'HEARTBEAT.md');
      writeFileSync(heartbeat, `${readFileSync(heartbeat, 'utf8')}\n<!-- changed digest -->\n`);
    });
    const later = await importHeartbeatScheduleSeedsV1({
      source: await openAttestedScheduleSource({ currentPath: laterRoot }),
      existingMarker: first.plan.marker,
    }, laterCommit);
    expect(later).toEqual({ ok: true, replayed: true, marker: first.plan.marker });
    expect(laterCommit).not.toHaveBeenCalled();
  });

  it('atomically aborts unknown or duplicate packed owners with the bounded migration code', async () => {
    const commit = vi.fn(async () => undefined);
    const unknownRoot = fixtureRelease('a'.repeat(40), (root) => {
      writeFileSync(resolve(root, 'agents/hygiene.md'), '---\nid: not-hygiene\ngroup: system\n---\n');
    });
    const unknown = await importHeartbeatScheduleSeedsV1({
      source: await openAttestedScheduleSource({ currentPath: unknownRoot }),
    }, commit);
    expect(unknown).toMatchObject({ ok: false, code: 'schedule-owner-migration-required', report: { total: 13, imported: 0 } });
    if (unknown.ok) throw new Error('expected unknown owner failure');
    expect(unknown.report.errors.some((error) => error.owner === 'hygiene' && error.reason === 'unknown-owner')).toBe(true);

    const duplicateRoot = fixtureRelease('a'.repeat(40), (root) => {
      writeFileSync(resolve(root, 'agents/model-audit.md'), '---\nid: hygiene\ngroup: system\n---\n');
    });
    const duplicate = await importHeartbeatScheduleSeedsV1({
      source: await openAttestedScheduleSource({ currentPath: duplicateRoot }),
    }, commit);
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error('expected duplicate owner failure');
    expect(duplicate.report.errors.some((error) => error.owner === 'hygiene' && error.reason === 'duplicate-owner')).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps all eight new System declarations compatible with the existing roster parser', () => {
    const parsed = readDeclaredAgentDetails(REPO);
    for (const id of NEW_SYSTEM_AGENT_IDS) {
      expect(parsed.get(id)?.source).toBe(`agents/${id}.md`);
      expect(readFileSync(resolve(REPO, `agents/${id}.md`), 'utf8')).toMatch(/^group: system$/m);
    }
  });

  it('persists pause store/publisher phases so a crash resumes without a second disarm', async () => {
    const owner: RunnableRef = { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' };
    const schedule = {
      id: 'a'.repeat(64), owner, cadence: { source: '15 3 * * 0', words: 'Sun \u00b7 3:15 AM' },
      nextAt: null, lastOutcome: null, armed: true, origin: 'seed' as const, mirroredAt: null,
      mirrorPath: 'HEARTBEAT.md' as const, version: 4,
    };
    const setScheduleArmed = vi.fn(async () => ({ schedule: { ...schedule, armed: false, version: 5 }, collectionRevision: 9, replayed: false }));
    const store = {
      readScheduleSnapshot: async () => ({ collectionRevision: 8, schedules: [schedule] }),
      setScheduleArmed,
      createSchedule: async () => { throw new Error('unused'); },
      deleteSchedule: async () => { throw new Error('unused'); },
      claimScheduleOccurrence: async () => { throw new Error('unused'); },
      completeScheduleOccurrence: async () => { throw new Error('unused'); },
    } satisfies ScheduleStorePort;
    const saved = new Map<string, { marker: string; scheduleId: string; digest: string; storePhase: boolean; publisherPhase: boolean }>();
    const receipts = {
      read: async (marker: string) => saved.get(marker) ?? null,
      write: async (receipt: { marker: string; scheduleId: string; digest: string; storePhase: boolean; publisherPhase: boolean }) => { saved.set(receipt.marker, receipt); },
    };
    let crashed = false;
    const publishRemoval = vi.fn(async () => { if (!crashed) { crashed = true; throw new Error('publisher crash'); } });
    const input = { markers: [{ ...PAUSE_GOLDEN, scheduleId: schedule.id }], store, receipts, publishRemoval };
    await expect(migratePausedCadenceMarkersToScheduleArmedV1(input)).rejects.toThrow('publisher crash');
    expect(saved.get(PAUSE_GOLDEN.marker)).toMatchObject({ storePhase: true, publisherPhase: false });
    await expect(migratePausedCadenceMarkersToScheduleArmedV1(input)).resolves.toEqual([
      { ...PAUSE_GOLDEN, scheduleId: schedule.id, storePhase: true, publisherPhase: true },
    ]);
    expect(setScheduleArmed).toHaveBeenCalledTimes(1);
    expect(publishRemoval).toHaveBeenCalledTimes(2);
  });
});
