/**
 * P3 closure meta-test over `shared/ptyAdversarialManifest.json` (plan section 9 [C-M9]).
 *
 * Two independent obligations:
 *  1. `gateFiles` SET-EQUALS the plan section 7 focused gate file list — literal below, plus the
 *     closure amendments the manifest itself declares and this file re-derives. A subset check would
 *     let a suite quietly leave the gate; a superset check would let the gate name a suite nobody runs.
 *  2. Every attack id in plan section 9 has an owning test: the manifest names an existing suite that
 *     is itself in the gate list, and that suite really declares a test with the exact title given.
 *
 * A suite that owns an attack may not skip, todo, or conditionally omit it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readDashboardFile = (relPath: string): string =>
  readFileSync(join(dashboardRoot, relPath), 'utf8');

/**
 * The plan is a repo file at a fixed path, so the gate list has an AUTHORITY rather than three
 * hand-copies. Parsed from the section 7 ```powershell block's `npx vitest run ...` line: everything
 * between the command and `--reporter=json`. A coordinated edit to the literal below and the manifest
 * can no longer drop a suite from the gate silently — the plan has to change too, visibly.
 */
const PLAN_PATH = resolve(dashboardRoot, '..', 'docs', 'plans', '2026-08-22-dv3-p3-plan.md');

export function parsePlanGateFiles(planMarkdown: string): string[] {
  // Normalize CRLF: checkouts with core.autocrlf carry \r\n and would break the fence and line matching.
  const normalized = planMarkdown.replace(/\r\n/g, '\n');
  const blocks = [...normalized.matchAll(/```powershell\n([\s\S]*?)```/g)].map((match) => match[1]);
  const commands = blocks
    .flatMap((block) => block.split('\n'))
    .filter((line) => line.includes('npx vitest run ') && line.includes('--reporter=json'));
  if (commands.length !== 1) {
    throw new Error(`expected exactly one section 7 gate command in the plan, found ${commands.length}`);
  }
  const [, argumentList] = /npx vitest run ([\s\S]*?)--reporter=json/.exec(commands[0]) ?? [];
  if (argumentList === undefined) throw new Error('the plan gate command has no argument list');
  return argumentList.trim().split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Plan `docs/plans/2026-08-22-dv3-p3-plan.md` section 7, the `npx vitest run ...` argument list,
 * transcribed literally and in order. Nothing may be added here without a matching plan edit.
 */
const PLAN_SECTION_7_GATE_FILES: readonly string[] = [
  'server/pty/contracts.test.ts',
  'server/pty/probe.test.ts',
  'server/pty/windowsSessionHost.test.ts',
  'server/pty/launcherProfiles.test.ts',
  'server/pty/brokerProtocol.test.ts',
  'server/pty/fdPinnedPaths.test.ts',
  'server/pty/linuxBrokerClient.test.ts',
  'server/pty/linuxBrokerServer.test.ts',
  'server/pty/brokerProbe.test.ts',
  'server/pty/sessionRecord.test.ts',
  'server/pty/sessionPersistence.test.ts',
  'server/pty/sessionMigration.test.ts',
  'server/pty/persistentSessions.test.ts',
  'server/pty/sessionRuns.test.ts',
  'server/pty/transcripts.test.ts',
  'server/pty/route.test.ts',
  'server/pty/p3AttackManifest.test.ts',
  'server/auth/browserSessionRef.test.ts',
  'server/auth/session.test.ts',
  'server/auth/routes.test.ts',
  'server/runtime/capabilities.test.ts',
  'server/runtime/capabilitiesSource.test.ts',
  'server/health/service.test.ts',
  'server/http/surface.test.ts',
  'server/index.test.ts',
  'server/agents/routes.test.ts',
  'server/write/cardRespondRoute.test.ts',
  'server/control/attemptSessionAdapter.test.ts',
  'server/control/activation.test.ts',
  'server/control/activation.boot.test.ts',
  'server/control/managedExecution.test.ts',
  'server/control/execution.test.ts',
  'server/control/claudeWorkerAdapter.test.ts',
  'server/control/codexExecAdapter.test.ts',
  'server/control/childEnv.test.ts',
  'server/control/toolPolicyWire.test.ts',
  'server/control/store.test.ts',
  'server/control/launch.test.ts',
  'server/control/adapters.test.ts',
  'server/control/canonicalResultIntegrator.test.ts',
  'server/control/paidActionWiring.test.ts',
  'server/control/spendGrantProvision.test.ts',
  'server/control/p2Contracts.test.ts',
  'server/control/providerOperationalEvents.test.ts',
  'server/control/runEventService.test.ts',
  'server/control/runEventStream.test.ts',
  'server/control/runProjection.test.ts',
  'server/control/routes.test.ts',
  'server/control/synthetic-acceptance.test.ts',
  'server/workflows/routes.test.ts',
  'server/testFixtures/p1BrowserFixture.test.ts',
  'server/testFixtures/p3AuthenticatedServer.test.ts',
  'server/testFixtures/p3FixtureLifecycle.test.ts',
  'server/testFixtures/p3ActualBrowserRunner.test.ts',
  'server/testFixtures/p3RealPtySmokeClient.test.ts',
  'src/lib/runtimeCapabilities.test.tsx',
  'src/lib/terminalClient.test.ts',
  'src/control/controlClient.test.ts',
  'src/console/ConsolePane.test.tsx',
  'src/console/sessionWorkspaceModel.test.ts',
  'src/views/TerminalSessionHeader.test.tsx',
  'src/views/TerminalSessionEmpty.test.tsx',
  'src/views/Terminal.test.tsx',
  'src/views/RunDetail.test.tsx',
  'src/views/AgentDetail.test.tsx',
  'src/views/WorkflowDetail.test.tsx',
  'src/App.test.tsx',
];

/**
 * The three closure amendments to that literal list. Two suites the plan names were deleted by the
 * W6.4 review ruling (`persistentSessions`, `transcripts` — production-dead); two suites W6.6 adds
 * carry closure proofs the gate must not run without. The manifest declares the same set; this test
 * pins the amendment set so an unexplained gate-list drift still fails.
 */
const REMOVED_BY_CLOSURE: readonly string[] = [
  'server/pty/persistentSessions.test.ts',
  'server/pty/transcripts.test.ts',
];
const ADDED_BY_CLOSURE: readonly string[] = [
  'server/pty/p3DeletionClosure.test.ts',
  'server/testFixtures/assertP3GateResults.test.ts',
];

/**
 * Enumerated allowed hits for the conditional-omission wall, each with the reason it is not a P3
 * evasion. Two are PRE-EXISTING platform gates inside the gate file set (P3 did not add them; plan
 * section 12 carries them as the last open closure debt), and one is this file, which must spell the
 * forbidden pattern out in order to detect it. Anything else fails.
 */
const CONDITIONAL_OMISSION_ALLOWED_HITS: readonly string[] = [
  // Pre-existing: two Windows-only schtasks liveness cases (green on the Windows gate, skipped on WSL).
  'server/write/cardRespondRoute.test.ts: it.skipIf(',
  'server/write/cardRespondRoute.test.ts: it.skipIf(',
  // Pre-existing: needs OS symlink creation privilege; green wherever symlinks are permitted.
  'server/control/canonicalResultIntegrator.test.ts: it.skipIf(',
];

/** Plan section 8's corrected proof-split table: the only proof layers an attack may name. */
const PROOF_LAYERS = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']);

/** Plan section 9's attack list, in order. `p3AttackManifest` fails if the manifest drifts from it. */
const PLAN_SECTION_9_ATTACK_IDS: readonly string[] = [
  'traversal',
  'denied-root static symlink',
  'cwd/executable/shim/JS/interpreter/parent swap',
  'every raw authority field',
  'arbitrary and duplicate query',
  'raw WS oversize',
  'decoded oversize',
  'high-water',
  'atomic 16-host/8-principal capacity races',
  'independent composite-principal list/attach/write/resize/close/eviction',
  'cookie CSPRNG/name/path/lifetime/renewal/collision',
  'same-pair multi-tab',
  'claim first/replay/revision/foreign mask and exact claim envelope',
  'root uid/mode refusal',
  'child uid/env deny list',
  'Unix-only listener',
  'recipe/policy/parser round-trip/refusal',
  'awaited durable mutations',
  'dashboard/broker restart, drain, zero-orphan and old-epoch exit precedence',
  'false-persistence prevention',
  'OS-derived-capability source flow',
  'retained-import/deletion closure',
  'deployment closer casts',
];

interface ManifestAmendment { path: string; change: 'added' | 'removed'; reason: string }
interface ManifestAttack { id: string; suite: string; title: string; proof: string }
interface AdversarialManifest {
  note: string;
  gateFileAmendments: ManifestAmendment[];
  gateFiles: string[];
  attacks: ManifestAttack[];
}

const manifest = JSON.parse(readDashboardFile('shared/ptyAdversarialManifest.json')) as AdversarialManifest;

/** Every `it`/`test` title a suite declares, however the title is quoted. */
const TITLE_PATTERN = /\b(?:it|test)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const declaredTitles = (source: string): string[] => {
  const titles: string[] = [];
  for (const match of source.matchAll(TITLE_PATTERN)) titles.push(match[2].replace(/\s+/g, ' ').trim());
  return titles;
};

describe('P3 adversarial manifest — focused gate file set', () => {
  it('derives the plan section 7 list from the plan itself and finds the literal identical', () => {
    // Three copies exist (plan, this literal, manifest) and the plan is the authority. Both pairs are
    // compared, and a drift in either names the missing/extra suites rather than a bare length mismatch.
    const fromPlan = parsePlanGateFiles(readFileSync(PLAN_PATH, 'utf8'));
    const diff = (left: readonly string[], right: readonly string[]) => ({
      missing: left.filter((file) => !right.includes(file)).sort(),
      extra: right.filter((file) => !left.includes(file)).sort(),
    });
    expect(diff(fromPlan, PLAN_SECTION_7_GATE_FILES)).toEqual({ missing: [], extra: [] });
    // Order and multiplicity too: a duplicated or reordered entry is a drift the sets above cannot see.
    expect(PLAN_SECTION_7_GATE_FILES).toEqual(fromPlan);

    const removed = new Set(REMOVED_BY_CLOSURE);
    const planDerivedGate = [...fromPlan.filter((file) => !removed.has(file)), ...ADDED_BY_CLOSURE];
    expect(diff(planDerivedGate, manifest.gateFiles)).toEqual({ missing: [], extra: [] });
  });

  it('refuses a plan whose gate command lost a suite', () => {
    // The parser is the load-bearing part: prove it reads the real command shape and notices a drop.
    const doctored = readFileSync(PLAN_PATH, 'utf8')
      .replace(/(npx vitest run [^\n]*?) server\/pty\/route\.test\.ts /, '$1 ');
    expect(parsePlanGateFiles(doctored)).not.toContain('server/pty/route.test.ts');
    expect(parsePlanGateFiles(doctored)).toHaveLength(PLAN_SECTION_7_GATE_FILES.length - 1);
  });

  it('set-equals the plan section 7 list with only the declared closure amendments', () => {
    const removed = new Set(REMOVED_BY_CLOSURE);
    const expected = new Set([
      ...PLAN_SECTION_7_GATE_FILES.filter((file) => !removed.has(file)),
      ...ADDED_BY_CLOSURE,
    ]);
    const actual = new Set(manifest.gateFiles);

    const missing = [...expected].filter((file) => !actual.has(file)).sort();
    const extra = [...actual].filter((file) => !expected.has(file)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    // Set equality is not enough on its own: a duplicated entry would still compare equal as a set.
    expect(manifest.gateFiles).toHaveLength(new Set(manifest.gateFiles).size);
  });

  it('declares every amendment it applies, with a reason, and applies no undeclared one', () => {
    const declared = manifest.gateFileAmendments;
    expect(declared.map((entry) => entry.path).sort())
      .toEqual([...REMOVED_BY_CLOSURE, ...ADDED_BY_CLOSURE].sort());
    for (const entry of declared) {
      const shouldBeRemoved = (REMOVED_BY_CLOSURE as readonly string[]).includes(entry.path);
      expect(entry.change).toBe(shouldBeRemoved ? 'removed' : 'added');
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(manifest.gateFiles.includes(entry.path)).toBe(!shouldBeRemoved);
    }
  });

  it('names only suites that exist on disk', () => {
    const absent = manifest.gateFiles.filter((file) => {
      try {
        readDashboardFile(file);
        return false;
      } catch {
        return true;
      }
    });
    expect(absent).toEqual([]);
  });

  it('names no suite that skips, todos, or conditionally omits its tests', () => {
    // `runIf`/`skipIf`/`describeIf`/`testIf` and the `.skip`/`.todo` modifiers are all forms of the
    // conditional omission plan section 7 forbids; a bare `.concurrent`/`.each`/`.for` is not.
    // The trailing `(` is what makes this a CALL rather than a mention: the allowance list below and
    // this pattern itself name the modifiers in prose, and prose never omits a test.
    // The modifier may sit ANYWHERE in the chain: `it.skip.each([...])`, `it.concurrent.skip(...)`,
    // `describe.each([...]).skip` all omit tests, and requiring the modifier directly after `it` missed
    // every composed form. A zero-case `each([])` is the same omission with no modifier at all: it
    // declares no test, and `assertP3GateResults` sees no skip either.
    const forbidden = new RegExp([
      '\\b(?:describe|it|test)(?:\\.\\w+)*\\.(?:skip|todo|skipIf|runIf|fails)\\s*[.(]',
      '\\b(?:describeIf|testIf|itIf)\\s*\\(',
      '\\b(?:describe|it|test)(?:\\.\\w+)*\\.(?:each|for)\\s*\\(\\s*\\[\\s*\\]\\s*\\)',
    ].join('|'), 'g');
    // Counted, not merely matched: a THIRD `it.skipIf` in an already-listed file must still fail.
    const tally = (hits: readonly string[]): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const hit of hits) counts[hit] = (counts[hit] ?? 0) + 1;
      return counts;
    };
    const found = manifest.gateFiles
      // This file is the enforcer and must spell the modifiers out to enumerate them; the gate's own
      // `assertP3GateResults --require-zero-skipped` pass is the independent wall on THIS suite.
      .filter((file) => file !== 'server/pty/p3AttackManifest.test.ts')
      .flatMap((file) => [...readDashboardFile(file).matchAll(forbidden)].map((match) => `${file}: ${match[0]}`));
    // Equality both ways: an unlisted omission fails, and so does an allowance nobody needs any more.
    expect(tally(found)).toEqual(tally(CONDITIONAL_OMISSION_ALLOWED_HITS));

    // The wall catches the composed and zero-case forms that walked straight through the old pattern.
    const caught = (source: string): boolean => new RegExp(forbidden.source).test(source);
    for (const evasion of [
      'it.skip.each([1, 2])("case %s", () => {});',
      'it.concurrent.skip("case", () => {});',
      'describe.each([])("case", () => {});',
      'it.each( [ ] )("case", () => {});',
      'it.todo("case");',
      'test.runIf(process.platform === "win32")("case", () => {});',
    ]) expect([evasion, caught(evasion)]).toEqual([evasion, true]);
    // A bare `.each`/`.concurrent`/`.for` with real cases is not an omission and must stay legal.
    for (const legal of [
      'it.each([1, 2])("case %s", () => {});',
      'it.concurrent("case", () => {});',
      'describe("skip handling", () => {});',
    ]) expect([legal, caught(legal)]).toEqual([legal, false]);
  });
});

describe('P3 adversarial manifest — attack ownership', () => {
  it('carries the plan section 9 attack ids exactly once, in order', () => {
    expect(manifest.attacks.map((attack) => attack.id)).toEqual([...PLAN_SECTION_9_ATTACK_IDS]);
  });

  it('gives every attack an owning suite inside the focused gate and a section 8 proof layer', () => {
    const gate = new Set(manifest.gateFiles);
    const problems = manifest.attacks
      .map((attack) => ({
        id: attack.id,
        outsideGate: gate.has(attack.suite) ? null : attack.suite,
        badProof: PROOF_LAYERS.has(attack.proof) ? null : attack.proof,
        emptyTitle: attack.title.trim().length > 0 ? null : attack.title,
      }))
      .filter((entry) => entry.outsideGate ?? entry.badProof ?? entry.emptyTitle);
    expect(problems).toEqual([]);
  });

  it('finds each attack title declared as a real test in its owning suite', () => {
    const unowned = manifest.attacks
      .filter((attack) => !declaredTitles(readDashboardFile(attack.suite)).includes(attack.title))
      .map((attack) => `${attack.id} -> ${attack.suite} › ${attack.title}`);
    expect(unowned).toEqual([]);
  });
});
