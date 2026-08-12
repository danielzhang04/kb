# KB Structure Phase I Implementation Plan

**Goal:** Cut the current dashboard/VM runtime over to an immutable, recoverable, credential-free Phase I platform while adding the versioned schema and repository-registry prerequisites required by Phase II.

**Architecture:** Keep the monorepo as the only source repository, but separate the VM into a read-only versioned platform release, a data-only ops checkout, and an external state root. Coordination commits enter a durable VM outbox and are promoted by the desktop; all execution remains behind the existing lock and the two evidence-backed cutover gates. Schema compatibility and repository identity are checked at startup and proposal activation so unsupported or ambiguously targeted work fails before side effects.

**Tech stack:** Node.js 24, TypeScript, Fastify, React, Vitest, Python 3.12, pytest, Git/Git bundles, GitHub Actions, Ubuntu, systemd, and restic.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

## Global Constraints

- The monorepo remains the sole source repository.
- The platform is built on merge into an immutable, versioned VM release artifact.
- The running platform is never a live checkout that shares state with data.
- The VM has no GitHub credential.
- During a GitHub outage, reads remain live and the outbox grows visibly with bounded retry and reconciliation; new side-effecting work follows the degraded-mode policy rather than silently losing state.
- Cutover Gate 1 (read-only web) does not arm the daemon or transfer execution authority.
- The Linux canary is run with production command resolution, not the test-only `python3` substitution.
- Existing platform-specific PTY and runner behavior is either made Linux-capable or disabled outside its supported platform.
- The corrected dashboard-bridge finding does not relax the Phase I Gate 1 boundary.
- The Phase I Gate 1 boundary establishes a controlled VM execution plane; it does not change GitHub trust anchors or authorize a repository split.
- **State-root disaster recovery:** the tier-0 backup, restore test, RPO, and RTO are Phase I conditions, not documentation-only controls.
- **Worker/restart safety:** quiescent deployment is mandatory until draining, process-group kill, idempotency receipts, and restart recovery are demonstrated.
- **Isolation:** worker, daemon/writer, render, and PTY identities remain a hardening concern; cloud PTY/Vibe capabilities stay disabled or isolated until their environment boundaries hold.
- **Observability:** the dashboard must expose attempt heartbeats, queue age, worker identity, saturation, outcomes, and failure rate rather than infer liveness from historical files.
- Phase I is complete only when both cutover gates have Daniel’s evidence and approval.
- All media exile work starts after cutover under locked ruling 3.

## Source anchors and execution rules

- Plan against `main` at `a2e6e2b` plus the approved spec/evidence commit(s) already present in this planning worktree. Before every task, run `git status --short` and stop if a named target contains unrelated changes.
- Shared TypeScript tests run on Windows and Ubuntu. Linux-only release, symlink, systemd, tailnet, and restart behavior is verified by the scripted VM acceptance commands named below.
- Every implementation task begins red, goes green with the smallest change shown, and gets its own reviewer and commit. Run the task's narrow command before its broader command.
- Never add a credential value, credential document, GitHub token, deploy key, SSH agent socket, or credential-bearing remote to the VM. `credentialIdentity` is a non-secret policy label, not credential material.
- Tasks 1-8 may land independently. The explicit workflow-platform checkpoint after Task 8 blocks every later dispatch-path change.

## A. Immediate defect and prerequisite fixes

### Task 1: Route every coordination artifact through the ops transaction

Choice: keep the current closed classifier and add only the four coordination classes named by the spec; a nested `orgs/*/*/STATE.md` remains durable.

**Files**

- Modify: `dashboard/server/write/branch.ts:31-47`
- Modify: `dashboard/server/write/branch.test.ts:39-52,461-524`

**Interfaces**

- Consumes: `classifyTarget(relpath: string): 'coordination' | 'durable'`
- Consumes: `routeWrite(repoRoot: string, relpath: string, options?: RouteOptions): Promise<Target>`
- Produces: `isCoordinationPath(relpath: string): boolean`

- [ ] Add this failing behavioral test to `branch.test.ts`:

  ```ts
  it.each([
    'memory/codex-worker.md',
    'dashboards/executive.md',
    'handoffs/2026-08-11-cutover.md',
    'orgs/kb-ops/STATE.md',
  ])('publishes %s with the ops pull-rebase-push route', async (relpath) => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'ops\n';
      if (args[0] === 'diff' || args[0] === 'status') return '';
      return '';
    };
    const openPr = vi.fn();
    await expect(routeWrite('/repo', relpath, { runGit, openPr })).resolves.toBe('coordination');
    expect(calls).toContainEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(calls).toContainEqual(['push', 'origin', 'ops']);
    expect(openPr).not.toHaveBeenCalled();
  });

  it('does not classify a nested non-project STATE path as coordination', () => {
    expect(classifyTarget('orgs/kb-ops/archive/STATE.md')).toBe('durable');
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/write/branch.test.ts` and verify the four table rows fail with `expected 'durable' to be 'coordination'`.

- [ ] Replace the classifier block in `branch.ts` with:

  ```ts
  const COORDINATION_PREFIXES = [
    'queue/',
    'ledgers/',
    'traces/',
    'memory/',
    'dashboards/',
    'handoffs/',
  ] as const;
  const PROJECT_STATE = /^orgs\/[^/]+\/STATE\.md$/;

  export function isCoordinationPath(relpath: string): boolean {
    const norm = relpath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    return COORDINATION_PREFIXES.some((prefix) => norm.startsWith(prefix)) || PROJECT_STATE.test(norm);
  }

  export function classifyTarget(relpath: string): Target {
    return isCoordinationPath(relpath) ? 'coordination' : 'durable';
  }
  ```

- [ ] Run `cd dashboard; npm test -- server/write/branch.test.ts` and verify `branch.test.ts` passes, then run `npm run typecheck` and verify exit code 0.

- [ ] Commit with `git add dashboard/server/write/branch.ts dashboard/server/write/branch.test.ts; git commit -m "fix(write): route all coordination artifacts through ops"`.

### Task 2: Resolve Python once for Windows and Linux

Choice: Windows uses the existing `py -3`; every other platform uses `python3`. All embedded imports receive the immutable platform root through `PYTHONPATH`, while their working directory remains the data checkout.

**Files**

- Create: `dashboard/server/runtime/python.ts`
- Create: `dashboard/server/runtime/python.test.ts`
- Modify: `dashboard/server/write/preambleGate.ts:1-46`
- Modify: `dashboard/server/write/launch.ts:1-115`
- Modify: `dashboard/server/write/workflowRun.ts:1-20,479-492`
- Modify: `dashboard/server/stop/floor.ts:1-85`
- Modify: `dashboard/server/embeddedPython.test.ts:1-74`

**Interfaces**

- Produces: `resolvePython(platform?: NodeJS.Platform): Readonly<{ command: string; prefixArgs: readonly string[] }>`
- Produces: `runPythonSync(args: readonly string[], options: PythonRunOptions): string`
- Produces: `PythonRunOptions = { cwd: string; platformRoot?: string; input?: string; timeoutMs?: number; environment?: NodeJS.ProcessEnv }`
- Consumes: `DASHBOARD_PLATFORM_ROOT?: string`

- [ ] Create `runtime/python.test.ts` with the failing resolver contract and replace the platform substitution in `embeddedPython.test.ts` with the real resolver:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { resolvePython } from './python.ts';

  describe('resolvePython', () => {
    it('uses the Python launcher only on Windows', () => {
      expect(resolvePython('win32')).toEqual({ command: 'py', prefixArgs: ['-3'] });
    });

    it.each(['linux', 'darwin'] as const)('uses python3 on %s', (platform) => {
      expect(resolvePython(platform)).toEqual({ command: 'python3', prefixArgs: [] });
    });
  });
  ```

  ```ts
  const python = resolvePython();
  const output = execFileSync(python.command, [...python.prefixArgs, '-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: join(platformRoot, 'scripts') },
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/runtime/python.test.ts server/embeddedPython.test.ts` and verify module resolution fails for `./runtime/python.ts`.

- [ ] Create `runtime/python.ts`:

  ```ts
  import { execFileSync } from 'node:child_process';
  import { delimiter, join } from 'node:path';
  import { fileURLToPath } from 'node:url';

  export interface PythonRunOptions {
    cwd: string;
    platformRoot?: string;
    input?: string;
    timeoutMs?: number;
    environment?: NodeJS.ProcessEnv;
  }

  export function resolvePython(
    platform: NodeJS.Platform = process.platform,
  ): Readonly<{ command: string; prefixArgs: readonly string[] }> {
    return platform === 'win32'
      ? { command: 'py', prefixArgs: ['-3'] }
      : { command: 'python3', prefixArgs: [] };
  }

  export function defaultPlatformRoot(): string {
    return process.env.DASHBOARD_PLATFORM_ROOT
      ?? fileURLToPath(new URL('../../../', import.meta.url));
  }

  export function runPythonSync(args: readonly string[], options: PythonRunOptions): string {
    const python = resolvePython();
    const platformRoot = options.platformRoot ?? defaultPlatformRoot();
    return execFileSync(python.command, [...python.prefixArgs, ...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      input: options.input,
      timeout: options.timeoutMs ?? 30_000,
      windowsHide: true,
      env: {
        ...(options.environment ?? process.env),
        PYTHONPATH: [join(platformRoot, 'scripts'), (options.environment ?? process.env).PYTHONPATH].filter(Boolean).join(delimiter),
      },
    });
  }
  ```

- [ ] Replace the four production calls found by `rg -n "execFileSync\('py'" dashboard/server` with the same executor. For example, `preambleGate.ts` becomes:

  ```ts
  import { join } from 'node:path';
  import { defaultPlatformRoot, runPythonSync } from '../runtime/python.ts';

  export function defaultPreambleRunner(repoRoot: string): PreambleResult {
    const platformRoot = defaultPlatformRoot();
    try {
      const stdout = runPythonSync([join(platformRoot, 'scripts', 'preamble.py')], { cwd: repoRoot, platformRoot });
      return { exitCode: 0, stdout, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { exitCode: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? String(error) };
    }
  }
  ```

  In `launch.ts`, `workflowRun.ts`, and `floor.ts`, preserve each existing script/input/timeout and replace only the process call. Their default runners keep the current `PyRunResult` contract and use this concrete error mapping:

  ```ts
  export const defaultPyRunner: PyRunner = (repoRoot, code, jsonArg) => {
    try {
      const stdout = runPythonSync(['-c', code, jsonArg], { cwd: repoRoot });
      return { exitCode: 0, stdout, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
      return {
        exitCode: typeof failure.status === 'number' ? failure.status : 1,
        stdout: failure.stdout?.toString() ?? '',
        stderr: failure.stderr?.toString() ?? '',
      };
    }
  };
  ```

  For any site that currently merges an injected environment, pass that merged object as `environment`; no existing call site's argv, stdin, timeout, or result shape changes.

- [ ] Run `rg -n "execFileSync\('py'|process\.platform.*python|win32.*py" dashboard/server` and verify only `runtime/python.ts` contains the platform choice. Run `cd dashboard; npm test -- server/runtime/python.test.ts server/embeddedPython.test.ts server/write/launch.test.ts server/write/workflowRun.test.ts server/stop/floor.test.ts; npm run typecheck` and verify all commands pass on Windows; repeat the same test command on Ubuntu and verify the spawned executable is `python3`.

- [ ] Commit with `git add dashboard/server/runtime/python.ts dashboard/server/runtime/python.test.ts dashboard/server/write/preambleGate.ts dashboard/server/write/launch.ts dashboard/server/write/workflowRun.ts dashboard/server/stop/floor.ts dashboard/server/embeddedPython.test.ts; git commit -m "fix(runtime): resolve Python per platform"`.

## B. Versioned machine-readable schemas

### Task 3: Version cards in the authoritative Python parser

Choice: `schema-version` is an integer. Absence means transition format v0; newly created or migrated cards are v1.

**Files**

- Create: `schemas/cards/v1.schema.json`
- Create: `schemas/compatibility.json`
- Modify: `scripts/cards.py:11-164`
- Modify: `tests/test_cards.py:1-220`

**Interfaces**

- Produces: `CARD_SCHEMA_VERSION = 1`
- Produces: `SUPPORTED_CARD_SCHEMA_VERSIONS = frozenset({0, 1})`
- Produces: `card_schema_version(meta: dict) -> int`
- Produces: `migrate_card(card: Card, target_version: int = 1) -> Card`
- Consumes: card frontmatter key `schema-version?: int`

- [ ] Add these failing pytest cases to `tests/test_cards.py`:

  ```py
  def test_new_card_emits_schema_v1(tmp_path, monkeypatch):
      monkeypatch.chdir(tmp_path)
      card = cards.new_card(project="kb-ops", action="test:noop", target="phase-i", risk_tier="T1")
      assert card.meta["schema-version"] == 1


  def test_absent_schema_version_is_transition_v0():
      card = cards.parse_text("""---\nid: version-test\nproject: kb-ops\naction: test:noop\ntarget: phase-i\nrisk-tier: T1\nstate: inbox\n---\n""")
      assert cards.card_schema_version(card.meta) == 0


  @pytest.mark.parametrize("value", [2, -1, "1", True])
  def test_unsupported_card_schema_is_rejected(value):
      meta = {"id": "version-test", "project": "kb-ops", "action": "test:noop", "target": "x", "risk-tier": "T1", "state": "inbox", "schema-version": value}
      with pytest.raises(cards.ValidationError, match="schema-version"):
          cards._validate(meta)


  def test_migrate_v0_card_to_v1_without_changing_body():
      card = cards.parse_text("""---\nid: version-test\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n\n## Work order\nkeep me\n""")
      migrated = cards.migrate_card(card)
      assert migrated.meta["schema-version"] == 1
      assert migrated.body == card.body
  ```

- [ ] Run `python -m pytest tests/test_cards.py -q` and verify failures mention the missing version APIs and missing emitted field.

- [ ] Add the compatibility file and card schema:

  ```json
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "cards": { "current": 1, "supported": [0, 1] },
    "workflows": { "current": 1, "supported": [0, 1] }
  }
  ```

  ```json
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://kb.local/schemas/cards/v1.schema.json",
    "type": "object",
    "required": ["schema-version", "id", "project", "action", "target", "risk-tier", "state"],
    "properties": {
      "schema-version": { "const": 1 },
      "id": { "type": "string", "minLength": 1 },
      "project": { "oneOf": [{ "type": "string", "minLength": 1 }, { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } }] },
      "action": { "type": "string", "minLength": 1 },
      "target": { "type": "string", "minLength": 1 },
      "risk-tier": { "enum": ["T1", "T2", "T3"] },
      "state": { "enum": ["inbox", "blocked", "working", "done", "approvals", "approved", "rejected", "stop-requested", "halting", "halted", "archived"] }
    },
    "additionalProperties": true
  }
  ```

- [ ] Add the version logic to `cards.py` and include `schema-version` in `new_card` before validation:

  ```py
  CARD_SCHEMA_VERSION = 1
  SUPPORTED_CARD_SCHEMA_VERSIONS = frozenset({0, CARD_SCHEMA_VERSION})


  def card_schema_version(meta: dict) -> int:
      value = meta.get("schema-version", 0)
      if isinstance(value, bool) or not isinstance(value, int):
          raise ValidationError("schema-version must be an integer")
      if value not in SUPPORTED_CARD_SCHEMA_VERSIONS:
          raise ValidationError(f"unsupported card schema-version: {value}")
      return value


  def migrate_card(card: Card, target_version: int = CARD_SCHEMA_VERSION) -> Card:
      if target_version != CARD_SCHEMA_VERSION:
          raise ValidationError(f"unsupported card migration target: {target_version}")
      card_schema_version(card.meta)
      return Card(meta={**card.meta, "schema-version": target_version}, body=card.body)
  ```

  Call `card_schema_version(meta)` at the start of `_validate`, and construct new metadata with `"schema-version": CARD_SCHEMA_VERSION`.

- [ ] Run `python -m pytest tests/test_cards.py -q` and verify all cases pass; on Ubuntu run `python3 -m pytest tests/test_cards.py -q` and verify the same result.

- [ ] Commit with `git add schemas/cards/v1.schema.json schemas/compatibility.json scripts/cards.py tests/test_cards.py; git commit -m "feat(schema): version card documents"`.

### Task 4: Apply card-version compatibility in the dashboard reader

**Files**

- Create: `dashboard/server/schema/versions.ts`
- Create: `dashboard/server/schema/versions.test.ts`
- Modify: `dashboard/server/planeA/cards.ts:15-135`
- Modify: `dashboard/server/planeA/cards.test.ts:1-120`

**Interfaces**

- Produces: `readCompatibility(platformRoot?: string): CompatibilityMatrix`
- Produces: `assertSupportedVersion(kind: 'cards' | 'workflows', value: unknown): 0 | 1`
- Consumes: `schemas/compatibility.json`
- Produces: `CardMeta['schema-version']?: number`

- [ ] Add the following failing tests:

  ```ts
  const MINIMAL_CARD = [
    '---', 'id: version-test', 'project: kb-ops', 'action: test:noop', 'target: x',
    'risk-tier: T1', 'owner: null', 'state: inbox', '---', '', '## Work order', 'x', '',
  ].join('\n');

  it('accepts absent card schema-version as v0 and explicit v1', () => {
    expect(parseCardFrontmatter(MINIMAL_CARD).meta['schema-version']).toBeUndefined();
    expect(parseCardFrontmatter(MINIMAL_CARD.replace('---\n', '---\nschema-version: 1\n')).meta['schema-version']).toBe(1);
  });

  it.each(['schema-version: 2', 'schema-version: one'])('rejects %s', (line) => {
    expect(() => parseCardFrontmatter(MINIMAL_CARD.replace('---\n', `---\n${line}\n`))).toThrow(/schema-version/);
  });
  ```

  ```ts
  it('loads the checked-in compatibility ranges', () => {
    expect(readCompatibility()).toEqual({ cards: { current: 1, supported: [0, 1] }, workflows: { current: 1, supported: [0, 1] } });
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/schema/versions.test.ts server/planeA/cards.test.ts` and verify the new module is missing and explicit v2 is not rejected.

- [ ] Create `schema/versions.ts`:

  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { defaultPlatformRoot } from '../runtime/python.ts';

  export interface CompatibilityMatrix {
    cards: { current: 1; supported: readonly [0, 1] };
    workflows: { current: 1; supported: readonly [0, 1] };
  }

  export function readCompatibility(platformRoot: string = defaultPlatformRoot()): CompatibilityMatrix {
    const parsed = JSON.parse(readFileSync(join(platformRoot, 'schemas', 'compatibility.json'), 'utf8')) as Record<string, unknown>;
    const closed = (value: unknown): value is { current: 1; supported: [0, 1] } => {
      if (!value || typeof value !== 'object') return false;
      const item = value as { current?: unknown; supported?: unknown };
      return Object.keys(item).sort().join(',') === 'current,supported'
        && item.current === 1 && Array.isArray(item.supported)
        && item.supported.length === 2 && item.supported[0] === 0 && item.supported[1] === 1;
    };
    if (Object.keys(parsed).sort().join(',') !== 'cards,workflows' || !closed(parsed.cards) || !closed(parsed.workflows)) {
      throw new Error('unsupported platform compatibility matrix');
    }
    return parsed as unknown as CompatibilityMatrix;
  }

  export function assertSupportedVersion(
    kind: keyof CompatibilityMatrix,
    value: unknown,
    matrix: CompatibilityMatrix = readCompatibility(),
  ): 0 | 1 {
    const version = value === undefined ? 0 : value;
    if (!Number.isInteger(version) || !matrix[kind].supported.includes(version as 0 | 1)) {
      throw new Error(`unsupported ${kind} schema-version: ${String(value)}`);
    }
    return version as 0 | 1;
  }
  ```

- [ ] Add `'schema-version'?: number` to `CardMeta`; parse it as a number only when present; call `assertSupportedVersion('cards', meta['schema-version'])` before returning the parsed card.

- [ ] Run `cd dashboard; npm test -- server/schema/versions.test.ts server/planeA/cards.test.ts; npm run typecheck` and verify exit code 0 on Windows and Ubuntu.

- [ ] Commit with `git add dashboard/server/schema/versions.ts dashboard/server/schema/versions.test.ts dashboard/server/planeA/cards.ts dashboard/server/planeA/cards.test.ts; git commit -m "feat(schema): enforce card compatibility in dashboard"`.

### Task 5: Version canonical workflow definitions

Choice: workflow definitions use the existing camelCase convention, so the embedded field is `schemaVersion`; absent means v0 and serializer output is v1.

**Files**

- Create: `schemas/workflows/v1.schema.json`
- Modify: `dashboard/server/workflows/defs.ts:210-251,633-797`
- Modify: `dashboard/server/workflows/defs.test.ts:1-360`
- Modify: `dashboard/src/composer/artifactTypes.ts:625-675`
- Modify: `dashboard/src/composer/artifactTypes.test.ts:207-329`

**Interfaces**

- Produces: `WorkflowDef.schemaVersion?: number`
- Consumes: `assertSupportedVersion('workflows', value): 0 | 1`
- Changes: `toDeploy(kind: 'workflow', draft: WorkflowDraft): DeployPlan` produces content containing `schemaVersion: 1`

- [ ] Add failing parser and serializer tests:

  ```ts
  it('accepts transition v0 and explicit v1, but rejects v2', () => {
    expect(parseWorkflowDef(md(SINGLE), { knownProfiles: KNOWN })).toMatchObject({ ok: true, value: { schemaVersion: undefined } });
    expect(parseWorkflowDef(md(`schemaVersion: 1\n${SINGLE}`), { knownProfiles: KNOWN })).toMatchObject({ ok: true, value: { schemaVersion: 1 } });
    expect(parseWorkflowDef(md(`schemaVersion: 2\n${SINGLE}`), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(/schemaVersion/) });
  });
  ```

  ```ts
  it('serializes new workflow artifacts as schema v1', () => {
    const plan = toDeploy('workflow', workflow());
    expect(plan.content).toContain('---\nschemaVersion: 1\nid: "nightly"');
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/workflows/defs.test.ts src/composer/artifactTypes.test.ts` and verify the parser rejects `schemaVersion` as an unknown field and the serializer omits it.

- [ ] Create `schemas/workflows/v1.schema.json`:

  ```json
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://kb.local/schemas/workflows/v1.schema.json",
    "type": "object",
    "required": ["schemaVersion", "id", "project", "title", "profile", "stages"],
    "properties": {
      "schemaVersion": { "const": 1 },
      "id": { "type": "string", "minLength": 1 },
      "project": { "type": "string", "minLength": 1 },
      "title": { "type": "string", "minLength": 1 },
      "profile": { "type": "string", "minLength": 1 },
      "manager": { "type": "object" },
      "stages": { "type": "array", "minItems": 1 }
    },
    "additionalProperties": true
  }
  ```

- [ ] Import `assertSupportedVersion`; add `schemaVersion?: number` to `WorkflowDef`; add `schemaVersion` to the closed top-level field set; parse only an integer; call `assertSupportedVersion('workflows', schemaVersion)` and return it. Emit the version as the first frontmatter field:

  ```ts
  const content = [
    '---',
    'schemaVersion: 1',
    `id: ${JSON.stringify(id)}`,
    `project: ${JSON.stringify(draft.project)}`,
    `title: ${JSON.stringify(id)}`,
  ];
  ```

- [ ] Run `cd dashboard; npm test -- server/workflows/defs.test.ts src/composer/artifactTypes.test.ts; npm run typecheck` and verify all tests pass on Windows and Ubuntu.

- [ ] Commit with `git add schemas/workflows/v1.schema.json dashboard/server/workflows/defs.ts dashboard/server/workflows/defs.test.ts dashboard/src/composer/artifactTypes.ts dashboard/src/composer/artifactTypes.test.ts; git commit -m "feat(schema): version workflow definitions"`.

### Task 6: Provide explicit v0-to-v1 migrations

Choice: the migration command edits only absent version fields, preserves document bodies byte-for-byte, and is idempotent. It never bulk-runs at startup.

**Files**

- Create: `scripts/migrate_schema_versions.py`
- Create: `tests/test_migrate_schema_versions.py`

**Interfaces**

- Produces: `migrate_card_text(text: str) -> str`
- Produces: `migrate_workflow_text(text: str) -> str`
- Produces CLI: `python scripts/migrate_schema_versions.py {card|workflow} PATH [--check]`

- [ ] Create the failing tests:

  ```py
  from scripts.migrate_schema_versions import migrate_card_text, migrate_workflow_text


  def test_card_migration_preserves_body_and_is_idempotent():
      source = "---\nid: version-test\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n\n## Work order\nexact body\n"
      migrated = migrate_card_text(source)
      assert migrated.startswith("---\nschema-version: 1\nid: version-test\nproject:")
      assert migrated.endswith("\n## Work order\nexact body\n")
      assert migrate_card_text(migrated) == migrated


  def test_workflow_migration_inserts_inside_frontmatter():
      source = "---\nid: demo\nproject: kb-ops\ntitle: Demo\nprofile: research\nstages: []\n---\n\n# Demo\n"
      migrated = migrate_workflow_text(source)
      assert migrated.startswith("---\nschemaVersion: 1\nid: demo")
      assert migrate_workflow_text(migrated) == migrated
  ```

- [ ] Run `python -m pytest tests/test_migrate_schema_versions.py -q` and verify import collection fails because the script is absent.

- [ ] Create `scripts/migrate_schema_versions.py`:

  ```py
  from __future__ import annotations
  import argparse
  from pathlib import Path


  def migrate_card_text(text: str) -> str:
      if not text.startswith("---\n"):
          raise ValueError("card must start with YAML frontmatter")
      head, marker, body = text[4:].partition("\n---")
      if not marker:
          raise ValueError("card frontmatter is not closed")
      if any(line.startswith("schema-version:") for line in head.splitlines()):
          return text
      return f"---\nschema-version: 1\n{head}\n---{body}"


  def migrate_workflow_text(text: str) -> str:
      if not text.startswith("---\n"):
          raise ValueError("workflow must start with YAML frontmatter")
      head, marker, _body = text[4:].partition("\n---")
      if not marker:
          raise ValueError("workflow frontmatter is not closed")
      if any(line.startswith("schemaVersion:") for line in head.splitlines()):
          return text
      return "---\nschemaVersion: 1\n" + text[4:]


  def main() -> int:
      parser = argparse.ArgumentParser()
      parser.add_argument("kind", choices=("card", "workflow"))
      parser.add_argument("path", type=Path)
      parser.add_argument("--check", action="store_true")
      args = parser.parse_args()
      original = args.path.read_text(encoding="utf-8")
      migrated = migrate_card_text(original) if args.kind == "card" else migrate_workflow_text(original)
      if args.check:
          return 0 if migrated == original else 1
      args.path.write_text(migrated, encoding="utf-8", newline="")
      return 0


  if __name__ == "__main__":
      raise SystemExit(main())
  ```

- [ ] Run `python -m pytest tests/test_migrate_schema_versions.py -q`, then run the same command with `python3` on Ubuntu; verify all tests pass.

- [ ] Commit with `git add scripts/migrate_schema_versions.py tests/test_migrate_schema_versions.py; git commit -m "feat(schema): add explicit v1 migrations"`.

### Task 7: Refuse startup on unsupported repository data

Choice: startup scans queue cards and direct `orgs/*/workflows/*.md` definitions only; workflow segment README files are not canonical definitions. Malformed or unsupported data fails before `listen`.

**Files**

- Create: `dashboard/server/schema/startup.ts`
- Create: `dashboard/server/schema/startup.test.ts`
- Modify: `dashboard/server/index.ts:79-93,217-220`
- Modify: `dashboard/server/index.test.ts:1-85`

**Interfaces**

- Produces: `assertSupportedRepositoryData(repoRoot: string): void`
- Changes: `buildApp(options?: { repoRoot?: string; validateData?: boolean }): FastifyInstance`
- Changes: `start(port?: number, host?: string, options?: { repoRoot?: string }): Promise<FastifyInstance>`

- [ ] Create `startup.test.ts` with real temporary files:

  ```ts
  import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';
  import { assertSupportedRepositoryData } from './startup.ts';

  it('accepts v0 and v1, then refuses an unsupported queue card', () => {
    const root = mkdtempSync(join(tmpdir(), 'schema-startup-'));
    mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
    writeFileSync(join(root, 'queue', 'inbox', 'v0.md'), '---\nid: v0\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
    writeFileSync(join(root, 'queue', 'inbox', 'v1.md'), '---\nschema-version: 1\nid: v1\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
    expect(() => assertSupportedRepositoryData(root)).not.toThrow();
    writeFileSync(join(root, 'queue', 'inbox', 'v2.md'), '---\nschema-version: 2\nid: v2\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
    expect(() => assertSupportedRepositoryData(root)).toThrow(/v2\.md.*schema-version/s);
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/schema/startup.test.ts server/index.test.ts` and verify the startup module is missing.

- [ ] Create `startup.ts` using current authoritative parsers:

  ```ts
  import { existsSync, readFileSync, readdirSync } from 'node:fs';
  import { join } from 'node:path';
  import { parseCardFrontmatter } from '../planeA/cards.ts';
  import { workflowProfileIds } from '../control/environment.ts';
  import { parseWorkflowDef } from '../workflows/defs.ts';

  function markdownFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
    });
  }

  export function assertSupportedRepositoryData(repoRoot: string): void {
    for (const path of markdownFiles(join(repoRoot, 'queue'))) {
      try { parseCardFrontmatter(readFileSync(path, 'utf8')); }
      catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const orgs = join(repoRoot, 'orgs');
    if (!existsSync(orgs)) return;
    for (const org of readdirSync(orgs, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const workflows = join(orgs, org.name, 'workflows');
      if (!existsSync(workflows)) continue;
      for (const entry of readdirSync(workflows, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const path = join(workflows, entry.name);
        const parsed = parseWorkflowDef(readFileSync(path, 'utf8'), { knownProfiles: workflowProfileIds() });
        if (!parsed.ok) throw new Error(`${path}: ${parsed.detail}`);
      }
    }
  }
  ```

- [ ] Make `buildApp` resolve one `repoRoot`, call `assertSupportedRepositoryData(repoRoot)` before route registration unless `validateData === false`, and pass that root to all current root consumers. Make `start` call `buildApp({ repoRoot: options.repoRoot, validateData: true })`. Tests that use incomplete fixtures explicitly pass `validateData: false`.

- [ ] Run `cd dashboard; npm test -- server/schema/startup.test.ts server/index.test.ts; npm run typecheck; npm test` and verify the full Vitest suite passes on Windows and Ubuntu.

- [ ] Commit with `git add dashboard/server/schema/startup.ts dashboard/server/schema/startup.test.ts dashboard/server/index.ts dashboard/server/index.test.ts; git commit -m "feat(schema): reject unsupported data at startup"`.

## C. Server-owned repository registry

### Task 8: Load a closed project-to-repository registry

Choice: the registry hashes the checked-in symbolic root record before expanding `${DASHBOARD_REPO_ROOT}`. The identity is therefore stable across desktop and VM absolute paths, while any change to the root contract, remote, base ref, scope, or credential label changes the identity.

**Files**

- Create: `dashboard/config/repositories.json`
- Create: `dashboard/server/control/repositoryRegistry.ts`
- Create: `dashboard/server/control/repositoryRegistry.test.ts`
- Modify: `dashboard/server/control/environment.ts:8-32,142-176`
- Modify: `dashboard/server/control/environment.test.ts:1-70`

**Interfaces**

- Produces: `RepositoryRecord = { id: string; registryId: string; projects: readonly string[]; root: string; remote: string; baseRef: string; scope: readonly string[]; credentialIdentity: string; identity: string }`
- Produces: `RepositoryBinding = Readonly<{ registryId: string; identity: string }>`
- Produces: `loadRepositoryRegistry(configPath: string, variables: Readonly<{ repoRoot: string }>): RepositoryRegistry`
- Produces: `RepositoryRegistry.forProject(project: string): RepositoryRecord`
- Produces: `RepositoryRegistry.resolve(binding: RepositoryBinding): RepositoryRecord`
- Changes: `RuntimeSkillRegistry.repositories: RepositoryRegistry`

- [ ] Create a failing registry test:

  ```ts
  import { mkdtempSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { expect, it } from 'vitest';
  import { loadRepositoryRegistry } from './repositoryRegistry.ts';

  it('binds a project immutably and refuses unknown or stale identities', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo-registry-'));
    const path = join(dir, 'repositories.json');
    writeFileSync(path, JSON.stringify({ version: 1, repositories: [{ id: 'kb-ops@1', projects: ['kb-ops'], root: '${DASHBOARD_REPO_ROOT}', remote: 'origin', baseRef: 'main', scope: ['orgs/kb-ops/**'], credentialIdentity: 'desktop-promotion' }] }));
    const registry = loadRepositoryRegistry(path, { repoRoot: '/var/lib/kb/ops' });
    const record = registry.forProject('kb-ops');
    expect(record.root).toBe('/var/lib/kb/ops');
    expect(registry.resolve({ registryId: record.id, identity: record.identity })).toEqual(record);
    expect(() => registry.forProject('missing')).toThrow(/not registered/);
    expect(() => registry.resolve({ registryId: record.id, identity: '0'.repeat(64) })).toThrow(/identity/);
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/control/repositoryRegistry.test.ts server/control/environment.test.ts` and verify module resolution fails.

- [ ] Create `dashboard/config/repositories.json` with one closed record per current project:

  ```json
  {
    "version": 1,
    "repositories": [
      { "id": "kb-ops@1", "projects": ["kb-ops", "kb"], "root": "${DASHBOARD_REPO_ROOT}", "remote": "origin", "baseRef": "main", "scope": ["orgs/kb-ops/**", "queue/**", "ledgers/**", "memory/**", "dashboards/**", "handoffs/**", "_index.md"], "credentialIdentity": "desktop-promotion" },
      { "id": "atlas-prep@1", "projects": ["atlas-prep"], "root": "${DASHBOARD_REPO_ROOT}", "remote": "origin", "baseRef": "main", "scope": ["orgs/atlas-prep/**", "queue/**", "ledgers/**"], "credentialIdentity": "desktop-promotion" },
      { "id": "faceless-youtube@1", "projects": ["faceless-youtube"], "root": "${DASHBOARD_REPO_ROOT}", "remote": "origin", "baseRef": "main", "scope": ["orgs/faceless-youtube/**", "queue/**", "ledgers/**"], "credentialIdentity": "desktop-promotion" }
    ]
  }
  ```

- [ ] Implement the loader with closed keys, unique ids/projects, SHA-256 over canonical source fields, exact root-token expansion, and fail-closed lookup:

  ```ts
  import { createHash } from 'node:crypto';
  import { readFileSync } from 'node:fs';

  export interface RepositoryBinding { readonly registryId: string; readonly identity: string }
  export interface RepositoryRecord extends RepositoryBinding {
    readonly id: string;
    readonly projects: readonly string[];
    readonly root: string;
    readonly remote: string;
    readonly baseRef: string;
    readonly scope: readonly string[];
    readonly credentialIdentity: string;
  }
  export interface RepositoryRegistry {
    forProject(project: string): RepositoryRecord;
    resolve(binding: RepositoryBinding): RepositoryRecord;
  }

  export function loadRepositoryRegistry(configPath: string, variables: Readonly<{ repoRoot: string }>): RepositoryRegistry {
    const source = JSON.parse(readFileSync(configPath, 'utf8')) as { version: unknown; repositories: unknown[] };
    if (source.version !== 1 || !Array.isArray(source.repositories)) throw new Error('repository registry version 1 is required');
    const byId = new Map<string, RepositoryRecord>();
    const byProject = new Map<string, RepositoryRecord>();
    for (const raw of source.repositories as Array<Record<string, unknown>>) {
      const allowed = new Set(['id', 'projects', 'root', 'remote', 'baseRef', 'scope', 'credentialIdentity']);
      if (Object.keys(raw).length !== allowed.size || Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('repository registry fields are not the closed v1 set');
      if (typeof raw.id !== 'string' || !Array.isArray(raw.projects) || raw.projects.length === 0 || raw.projects.some((value) => typeof value !== 'string')) throw new Error('repository id/projects are invalid');
      if (raw.root !== '${DASHBOARD_REPO_ROOT}') throw new Error('Phase I repository root must use DASHBOARD_REPO_ROOT');
      if (typeof raw.remote !== 'string' || typeof raw.baseRef !== 'string' || typeof raw.credentialIdentity !== 'string') throw new Error('repository source fields are invalid');
      if (!Array.isArray(raw.scope) || raw.scope.length === 0 || raw.scope.some((value) => typeof value !== 'string')) throw new Error('repository scope is invalid');
      const canonical = JSON.stringify({ id: raw.id, projects: raw.projects, root: raw.root, remote: raw.remote, baseRef: raw.baseRef, scope: raw.scope, credentialIdentity: raw.credentialIdentity });
      const identity = createHash('sha256').update(canonical).digest('hex');
      const root = variables.repoRoot;
      const record = Object.freeze({ ...raw, id: String(raw.id), projects: Object.freeze(raw.projects as string[]), root, remote: String(raw.remote), baseRef: String(raw.baseRef), scope: Object.freeze(raw.scope as string[]), credentialIdentity: String(raw.credentialIdentity), registryId: String(raw.id), identity }) as RepositoryRecord;
      if (byId.has(record.id)) throw new Error(`duplicate repository id: ${record.id}`);
      byId.set(record.id, record);
      for (const project of record.projects) {
        if (byProject.has(project)) throw new Error(`duplicate project registration: ${project}`);
        byProject.set(project, record);
      }
    }
    return Object.freeze({
      forProject(project: string) { const record = byProject.get(project); if (!record) throw new Error(`project is not registered: ${project}`); return record; },
      resolve(binding: RepositoryBinding) { const record = byId.get(binding.registryId); if (!record || record.identity !== binding.identity) throw new Error('repository binding identity is stale or unknown'); return record; },
    });
  }
  ```

- [ ] Load the registry in `loadRuntimeSkillRegistry(repoRoot)` from `join(defaultPlatformRoot(), 'dashboard', 'config', 'repositories.json')`, return it as `repositories`, and update existing literal test registries with a closed fake implementing `forProject` and `resolve`.

- [ ] Run `cd dashboard; npm test -- server/control/repositoryRegistry.test.ts server/control/environment.test.ts; npm run typecheck` and verify exit code 0 on Windows and Ubuntu.

- [ ] Commit with `git add dashboard/config/repositories.json dashboard/server/control/repositoryRegistry.ts dashboard/server/control/repositoryRegistry.test.ts dashboard/server/control/environment.ts dashboard/server/control/environment.test.ts; git commit -m "feat(control): add server-owned repository registry"`.

## Required workflow-platform merge checkpoint — between Tasks 8 and 9

This is a blocking checkpoint, not an implementation task and not a commit. Everything below that changes proposal activation, daemon dispatch, queue admission, worker lifecycle, or the Linux end-to-end canary must wait until the unmerged `claude/workflow-platform` commit `804acec` is an ancestor of the implementation branch.

- [ ] Run `git fetch origin main claude/workflow-platform`, then `git merge-base --is-ancestor 804acec origin/main; if ($LASTEXITCODE -ne 0) { Write-Error 'workflow-platform merge has not landed on main'; exit 1 }`. Before the merge lands, expect the explicit error and exit 1; do not continue.
- [ ] After it lands, incorporate the updated `main` using the repository's normal non-destructive branch workflow and run `git merge-base --is-ancestor 804acec HEAD`; expect exit code 0.
- [ ] Re-read `dashboard/server/control/claudeWorkerAdapter.ts`, `dashboard/server/control/queueBridge.ts`, their tests, and every caller reached by `rg -n "dispatchQueueCard|buildQueueBridge|createClaudeWorkerAdapter" dashboard/server`. Record the post-merge signatures in the Task 9 reviewer notes.
- [ ] Do not make line-level edits to `claudeWorkerAdapter.ts` or `queueBridge.ts` from this plan. If their post-merge contracts invalidate a later interface, stop and amend this plan through review before implementation.

### Task 9: Bind approved proposals to the immutable registry identity

Choice: Phase I still executes only from the configured ops root. A proposal whose registry record resolves to another root is refused; routing work across multiple roots remains Phase II.

**Files**

- Modify: `dashboard/server/control/proposal.ts:47-59,152-180,213-230,656-836,1013-1020`
- Modify: `dashboard/server/control/proposal.test.ts:1-420`
- Modify: `dashboard/server/control/activation.ts:167-262,328-576`
- Modify: `dashboard/server/control/activation.test.ts:32-180,500-580`
- Modify: `dashboard/server/control/environment.ts:142-176`
- Modify: `dashboard/server/control/environment.test.ts:1-70`

**Interfaces**

- Changes: `ProposalRegistry.repositories: RepositoryRegistry`
- Produces: `PlanProposal.repository: RepositoryBinding`
- Produces: `bindProposalRepository(project: string, registry: ProposalRegistry): RepositoryBinding`
- Produces: `assertProposalRepository(proposal: PlanProposal, repositories: RepositoryRegistry, activeRepoRoot: string): RepositoryRecord`
- Consumes after checkpoint: the post-merge proposal passed into `ActivatedExecution.runAutomatic`

- [ ] Add failing proposal and activation tests:

  ```ts
  it('server-binds a browser proposal and rejects a caller-supplied binding', () => {
    const parsed = validatePlanProposal(proposal, REGISTRY);
    expect(parsed).toMatchObject({ ok: true, value: { repository: { registryId: 'kb-ops@1', identity: 'a'.repeat(64) } } });
    expect(validatePlanProposal({ ...proposal, repository: { registryId: 'evil', identity: 'b'.repeat(64) } }, REGISTRY))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/repository.*server/i) });
  });

  it('accepts the exact compiled binding and rejects stale compiled identity', () => {
    const binding = { registryId: 'kb-ops@1', identity: 'a'.repeat(64) };
    expect(validateServerCompiledPlanProposal({ ...proposal, repository: binding }, REGISTRY).ok).toBe(true);
    expect(validateServerCompiledPlanProposal({ ...proposal, repository: { ...binding, identity: '0'.repeat(64) } }, REGISTRY))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/identity/) });
  });
  ```

  ```ts
  import type { PlanProposal } from './proposal.ts';

  it('refuses activation when an approved proposal resolves outside the active ops root', () => {
    const record = { id: 'kb-ops@1', registryId: 'kb-ops@1', identity: 'a'.repeat(64), projects: ['kb-ops'], root: '/other-repo', remote: 'origin', baseRef: 'main', scope: ['orgs/kb-ops/**'], credentialIdentity: 'desktop-promotion' };
    const repositories = { forProject: () => record, resolve: () => record };
    const approved = { project: 'kb-ops', repository: { registryId: record.id, identity: record.identity } } as PlanProposal;
    expect(() => assertProposalRepository(approved, repositories, '/repo')).toThrow(/active ops root/);
  });

  it('refuses an approved proposal path outside its immutable repository scope', () => {
    const record = { id: 'kb-ops@1', registryId: 'kb-ops@1', identity: 'a'.repeat(64), projects: ['kb-ops'], root: '/repo', remote: 'origin', baseRef: 'main', scope: ['orgs/kb-ops/**'], credentialIdentity: 'desktop-promotion' };
    const repositories = { forProject: () => record, resolve: () => record };
    const approved = { project: 'kb-ops', repository: { registryId: record.id, identity: record.identity }, scope: { read: ['orgs/kb-ops/input.md'], write: ['orgs/other/output.md'] } } as PlanProposal;
    expect(() => assertProposalRepository(approved, repositories, '/repo')).toThrow(/repository scope/);
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/control/proposal.test.ts server/control/activation.test.ts` and verify the repository fields/functions are missing.

- [ ] Extend `ProposalRegistry` and `PlanProposal`, then add the closed binding helpers:

  ```ts
  import type { RepositoryBinding, RepositoryRecord, RepositoryRegistry } from './repositoryRegistry.ts';

  export interface ProposalRegistry {
    runtimes: Readonly<Record<string, readonly string[]>>;
    skills: readonly string[];
    workflowProfiles?: readonly string[];
    repositories: RepositoryRegistry;
  }

  export interface PlanProposal {
    schema: typeof PLAN_PROPOSAL_SCHEMA;
    proposalId: string;
    repository: RepositoryBinding;
    project: string;
    title: string;
    summary: string;
    manager: ProposalManager;
    scope: ProposalScope;
    governanceRefs: string[];
    stages: ProposalStage[];
    profile?: string;
    parameters?: Record<string, string>;
  }

  export function bindProposalRepository(project: string, registry: ProposalRegistry): RepositoryBinding {
    const record = registry.repositories.forProject(project);
    return Object.freeze({ registryId: record.id, identity: record.identity });
  }

  export function assertProposalRepository(
    proposal: PlanProposal,
    repositories: RepositoryRegistry,
    activeRepoRoot: string,
  ): RepositoryRecord {
    const record = repositories.resolve(proposal.repository);
    if (record.root !== activeRepoRoot) throw new Error('approved proposal repository does not match the active ops root');
    if (!record.projects.includes(proposal.project)) throw new Error('approved proposal project is outside its repository registration');
    const permits = (path: string) => {
      const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
      if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return false;
      return record.scope.some((rule) => rule.endsWith('/**')
        ? normalized === rule.slice(0, -3) || normalized.startsWith(rule.slice(0, -2))
        : normalized === rule);
    };
    if ([...proposal.scope.read, ...proposal.scope.write].some((path) => !permits(path))) {
      throw new Error('approved proposal path is outside its immutable repository scope');
    }
    return record;
  }
  ```

  In untrusted validation, reject a present `repository` key and synthesize `bindProposalRepository(project, registry)`. In server-compiled validation, require exactly `{registryId, identity}` and call `registry.repositories.resolve`. Include the binding in `canonicalProposal`, so approval hashes cover it.

- [ ] After re-reading the post-merge activation path, pass `repositories` through `BuildActivatedExecutionOptions` and call this exact guard immediately before the existing `engine.runToBoundary` invocation:

  ```ts
  assertProposalRepository(input.proposal, options.repositories, repoRoot);
  return engine.runToBoundary(input);
  ```

  Update `loadWorkflowCompileEnvironment` to expose the same `repositories` instance, so browser-authored and canonical-workflow proposals produce identical bindings.

- [ ] Run `cd dashboard; npm test -- server/control/proposal.test.ts server/control/activation.test.ts server/control/environment.test.ts; npm run typecheck; npm test` and verify the full suite passes.

- [ ] Commit with `git add dashboard/server/control/proposal.ts dashboard/server/control/proposal.test.ts dashboard/server/control/activation.ts dashboard/server/control/activation.test.ts dashboard/server/control/environment.ts dashboard/server/control/environment.test.ts; git commit -m "feat(control): bind proposals to repository identities"`.

## D. Immutable release, activation, rollback, and state recovery

### Task 10: Build a deterministic platform release on every main merge

Choice: the release name is `kb-platform-$GITHUB_SHA.tar.gz`, where `GITHUB_SHA` is the full merge commit. It contains the built UI, server sources, production Node dependencies, Python runtime modules, schemas, and registry config, but no coordination or state data.

**Files**

- Create: `scripts/build_platform_release.py`
- Create: `tests/test_build_platform_release.py`
- Create: `.github/workflows/kb-platform-release.yml`

**Interfaces**

- Produces CLI: `python scripts/build_platform_release.py --source ROOT --version SHA --output FILE`
- Produces archive members: `VERSION`, `MANIFEST.sha256`, `dashboard/dist/**`, `dashboard/server/**`, `dashboard/package.json`, `dashboard/package-lock.json`, `dashboard/node_modules/**`, `scripts/**`, `schemas/**`, `dashboard/config/repositories.json`

- [ ] Create a failing archive-boundary test:

  ```py
  import hashlib
  import tarfile
  from pathlib import Path
  from scripts.build_platform_release import build_release


  def test_release_is_versioned_and_excludes_data(tmp_path: Path):
      source = tmp_path / "source"
      for rel in ("dashboard/dist/app.js", "dashboard/server/index.ts", "dashboard/package.json", "dashboard/package-lock.json", "dashboard/node_modules/pkg/index.js", "scripts/cards.py", "schemas/compatibility.json", "dashboard/config/repositories.json"):
          path = source / rel
          path.parent.mkdir(parents=True, exist_ok=True)
          path.write_text(rel, encoding="utf-8")
      (source / "queue").mkdir()
      (source / "queue/card.md").write_text("secret data", encoding="utf-8")
      output = tmp_path / "kb-platform-a.tar.gz"
      build_release(source, "a" * 40, output)
      with tarfile.open(output, "r:gz") as archive:
          names = set(archive.getnames())
          assert "VERSION" in names
          assert "dashboard/server/index.ts" in names
          assert not any(name.startswith("queue/") for name in names)
          assert archive.extractfile("VERSION").read().decode() == "a" * 40 + "\n"
          assert "MANIFEST.sha256" in names
  ```

- [ ] Run `python -m pytest tests/test_build_platform_release.py -q` and verify import collection fails.

- [ ] Implement a deterministic allowlisted builder:

  ```py
  from __future__ import annotations
  import argparse
  import gzip
  import hashlib
  import io
  import tarfile
  from pathlib import Path

  RELEASE_ROOTS = (
      "dashboard/dist", "dashboard/server", "dashboard/node_modules",
      "dashboard/package.json", "dashboard/package-lock.json",
      "dashboard/config/repositories.json", "scripts", "schemas",
  )


  def release_files(source: Path) -> list[Path]:
      files: list[Path] = []
      for rel in RELEASE_ROOTS:
          path = source / rel
          if not path.exists():
              raise FileNotFoundError(rel)
          files.extend(sorted(item for item in ([path] if path.is_file() else path.rglob("*")) if item.is_file()))
      return sorted(files, key=lambda item: item.relative_to(source).as_posix())


  def build_release(source: Path, version: str, output: Path) -> None:
      if len(version) != 40 or any(char not in "0123456789abcdef" for char in version):
          raise ValueError("version must be a full lowercase git commit")
      files = release_files(source)
      manifest = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(source).as_posix()}\n" for path in files)
      with output.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed, tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
          for name, data in (("VERSION", version + "\n"), ("MANIFEST.sha256", manifest)):
              info = tarfile.TarInfo(name); info.size = len(data.encode()); info.mtime = 0; info.mode = 0o444
              archive.addfile(info, io.BytesIO(data.encode()))
          for path in files:
              data = path.read_bytes()
              info = tarfile.TarInfo(path.relative_to(source).as_posix()); info.size = len(data); info.mtime = 0; info.mode = 0o555 if path.stat().st_mode & 0o111 else 0o444
              archive.addfile(info, io.BytesIO(data))


  def main() -> int:
      parser = argparse.ArgumentParser()
      parser.add_argument("--source", type=Path, required=True)
      parser.add_argument("--version", required=True)
      parser.add_argument("--output", type=Path, required=True)
      args = parser.parse_args(); build_release(args.source, args.version, args.output); return 0


  if __name__ == "__main__":
      raise SystemExit(main())
  ```

- [ ] Create `.github/workflows/kb-platform-release.yml`:

  ```yaml
  name: kb-platform-release
  on:
    push:
      branches: [main]
  permissions:
    contents: read
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: {node-version: 24.18.0, cache: npm, cache-dependency-path: dashboard/package-lock.json}
        - uses: actions/setup-python@v5
          with: {python-version: '3.12'}
        - run: python -m pytest -q
        - run: npm ci
          working-directory: dashboard
        - run: npm test
          working-directory: dashboard
        - run: npm run typecheck && npm run build && npm prune --omit=dev
          working-directory: dashboard
        - run: python scripts/build_platform_release.py --source . --version "$GITHUB_SHA" --output "kb-platform-$GITHUB_SHA.tar.gz"
        - run: sha256sum "kb-platform-$GITHUB_SHA.tar.gz" > "kb-platform-$GITHUB_SHA.tar.gz.sha256"
        - uses: actions/upload-artifact@v4
          with:
            name: kb-platform-${{ github.sha }}
            path: |
              kb-platform-${{ github.sha }}.tar.gz
              kb-platform-${{ github.sha }}.tar.gz.sha256
            if-no-files-found: error
  ```

- [ ] Run `python -m pytest tests/test_build_platform_release.py -q`; then run `cd dashboard; npm ci; npm test; npm run typecheck; npm run build; npm prune --omit=dev; cd ..; python scripts/build_platform_release.py --source . --version $(git rev-parse HEAD) --output $env:TEMP\kb-platform-test.tar.gz` in PowerShell and verify the tests pass and the archive is created. On Ubuntu repeat using `python3` and `/tmp/kb-platform-test.tar.gz`.

- [ ] Commit with `git add scripts/build_platform_release.py tests/test_build_platform_release.py .github/workflows/kb-platform-release.yml; git commit -m "build(release): package immutable platform artifacts"`.

### Task 11: Expose an unauthenticated, minimal quiescence readiness probe

Choice: `/readyz` exposes only readiness booleans and counts; it contains no repository data. A release may restart only when execution is locked, the bridge is stopped, and active workers/git/PTY/Composer processes are zero.

**Files**

- Create: `dashboard/server/release/quiescence.ts`
- Create: `dashboard/server/release/quiescence.test.ts`
- Modify: `dashboard/server/http/context.ts:90-130`
- Modify: `dashboard/server/http/surface.ts:120-205,275-287`
- Modify: `dashboard/server/index.ts:86-118`
- Modify: `dashboard/server/index.test.ts:1-85`
- Modify: `dashboard/server/write/asyncGit.ts:121-138`
- Modify: `dashboard/server/write/asyncGit.test.ts:1-107`
- Modify: `dashboard/server/vibe/session.ts:70-95`
- Modify: `dashboard/server/vibe/session.test.ts:110-135`

**Interfaces**

- Produces: `QuiescenceSnapshot = { executionLocked: boolean; bridgeStopped: boolean; activeWorkers: number; activeGit: number; activePty: number; activeComposer: number }`
- Produces: `quiescence(snapshot: QuiescenceSnapshot): { ok: true; quiescent: boolean; blockers: string[] }`
- Produces: `SurfaceContext.readiness(): ReturnType<typeof quiescence>`
- Changes: `BuildAppOptions.readiness?: SurfaceContext['readiness']`
- Produces: `activeAsyncGitCount(): number`
- Produces: `activeVibeProcessCount(): number`
- Produces route: `GET /readyz`

- [ ] Add failing pure and route tests:

  ```ts
  it('is quiescent only when every side-effecting resource is idle', () => {
    expect(quiescence({ executionLocked: true, bridgeStopped: true, activeWorkers: 0, activeGit: 0, activePty: 0, activeComposer: 0 }))
      .toEqual({ ok: true, quiescent: true, blockers: [] });
    expect(quiescence({ executionLocked: false, bridgeStopped: true, activeWorkers: 1, activeGit: 0, activePty: 0, activeComposer: 0 }).blockers)
      .toEqual(['execution-unlocked', 'workers-active']);
  });
  ```

  ```ts
  it('keeps health and readiness public but readiness payload minimal', async () => {
    const app = buildApp({ validateData: false, readiness: () => ({ ok: true, quiescent: false, blockers: ['workers-active'] }) });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, quiescent: false, blockers: ['workers-active'] });
    await app.close();
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/release/quiescence.test.ts server/index.test.ts` and verify the new module and route are absent.

- [ ] Create the pure probe:

  ```ts
  export interface QuiescenceSnapshot {
    executionLocked: boolean;
    bridgeStopped: boolean;
    activeWorkers: number;
    activeGit: number;
    activePty: number;
    activeComposer: number;
  }

  export function quiescence(snapshot: QuiescenceSnapshot): { ok: true; quiescent: boolean; blockers: string[] } {
    const blockers: string[] = [];
    if (!snapshot.executionLocked) blockers.push('execution-unlocked');
    if (!snapshot.bridgeStopped) blockers.push('queue-bridge-running');
    if (snapshot.activeWorkers > 0) blockers.push('workers-active');
    if (snapshot.activeGit > 0) blockers.push('git-active');
    if (snapshot.activePty > 0) blockers.push('pty-active');
    if (snapshot.activeComposer > 0) blockers.push('composer-active');
    return { ok: true, quiescent: blockers.length === 0, blockers };
  }
  ```

- [ ] Add these read-only counters beside the existing drain functions, pin each with its current drain test, and add an injectable `readiness` function to `SurfaceContext` backed by them plus `ptySessions.size()`:

  ```ts
  export function activeAsyncGitCount(): number { return liveChildren.size; }
  export function activeVibeProcessCount(): number { return activeVibeProcesses.size; }
  ```

  Register before authenticated routes:

  ```ts
  app.get('/readyz', async () => surfaceCtx.readiness());
  ```

  Keep `/healthz` unchanged. Task 21 replaces the initial worker count with the draining registry's live count without changing this interface.

- [ ] Run `cd dashboard; npm test -- server/release/quiescence.test.ts server/index.test.ts server/write/asyncGit.test.ts server/vibe/session.test.ts; npm run typecheck` and verify all tests pass.

- [ ] Commit with `git add dashboard/server/release/quiescence.ts dashboard/server/release/quiescence.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/index.ts dashboard/server/index.test.ts dashboard/server/write/asyncGit.ts dashboard/server/write/asyncGit.test.ts dashboard/server/vibe/session.ts dashboard/server/vibe/session.test.ts; git commit -m "feat(release): expose quiescent readiness"`.

### Task 12: Install, select, validate, and roll back VM releases

Choice: a desktop command transfers an already-built artifact over SSH. The VM activator never contacts GitHub; `/opt/kb-releases/current` and `/opt/kb-releases/previous` are atomic symlinks.

**Files**

- Create: `scripts/deploy_platform_release.py`
- Create: `deploy/activate_release.py`
- Create: `deploy/bootstrap_vm.py`
- Create: `deploy/validate_vm_runtime.py`
- Create: `deploy/systemd/kb-dashboard.service`
- Create: `tests/test_deploy_release.py`
- Create: `tests/test_bootstrap_vm.py`
- Create: `tests/test_validate_vm_runtime.py`
- Modify after Task 10 creation: `scripts/build_platform_release.py:7-14`
- Modify after Task 10 creation: `tests/test_build_platform_release.py:1-60`

**Interfaces**

- Produces desktop CLI: `python scripts/deploy_platform_release.py ARCHIVE CHECKSUM --host HOST`
- Produces one-time VM CLI: `python3 deploy/bootstrap_vm.py --ops-bundle PATH`
- Produces VM CLI: `python3 /usr/local/lib/kb/activate_release.py {activate|rollback} [--archive PATH] [--checksum PATH]`
- Produces validation CLI: `python3 /usr/local/lib/kb/validate_vm_runtime.py --ops-root /var/lib/kb/ops --unit /etc/systemd/system/kb-dashboard.service`
- Consumes: `GET http://127.0.0.1:4317/readyz`

- [ ] Create failing tests for path traversal, quiescence, rollback, and credential-name rejection:

  ```py
  import io
  import tarfile


  def test_quiescence_refusal_names_blockers():
      with pytest.raises(RuntimeError, match="workers-active"):
          activate_release.require_quiescence({"ok": True, "quiescent": False, "blockers": ["workers-active"]}, "release activation")


  def test_archive_member_escape_is_rejected(tmp_path):
      archive_path = tmp_path / "malicious.tar.gz"
      with tarfile.open(archive_path, "w:gz") as archive:
          info = tarfile.TarInfo("../escape")
          info.size = 1
          archive.addfile(info, io.BytesIO(b"x"))
      with tarfile.open(archive_path, "r:gz") as archive:
          with pytest.raises(ValueError, match="unsafe archive member"):
              list(activate_release.safe_members(archive))
  ```

  ```py
  @pytest.mark.parametrize("name", ["GITHUB_TOKEN", "GH_TOKEN", "GIT_ASKPASS", "SSH_AUTH_SOCK"])
  def test_vm_validation_rejects_credential_channels(name, tmp_path):
      with pytest.raises(RuntimeError, match=name):
          validate_vm_runtime.validate_environment({name: "present"})


  def test_ops_checkout_is_data_only(tmp_path):
      (tmp_path / "scripts").mkdir()
      with pytest.raises(RuntimeError, match="platform path"):
          validate_vm_runtime.validate_ops_root(tmp_path)


  def test_dashboard_unit_must_unset_every_github_credential_channel(tmp_path):
      unit = tmp_path / "kb-dashboard.service"
      unit.write_text("[Service]\nEnvironment=GITHUB_TOKEN=forbidden\nUnsetEnvironment=GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK\n", encoding="utf-8")
      with pytest.raises(RuntimeError, match="GITHUB_TOKEN"):
          validate_vm_runtime.validate_unit(unit)


  def test_dashboard_unit_must_use_the_local_outbox(tmp_path):
      unit = tmp_path / "kb-dashboard.service"
      unit.write_text("[Service]\nUnsetEnvironment=GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK\n", encoding="utf-8")
      with pytest.raises(RuntimeError, match="outbox publication"):
          validate_vm_runtime.validate_unit(unit)
  ```

- [ ] Run `python -m pytest tests/test_deploy_release.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py -q` and verify all three imports fail.

- [ ] Implement the activator's critical path exactly as follows, with injected paths/runners around it for tests:

  ```py
  from dataclasses import dataclass

  @dataclass(frozen=True)
  class RuntimePaths:
      releases: Path = Path("/opt/kb-releases")
      current: Path = Path("/opt/kb-releases/current")
      previous: Path = Path("/opt/kb-releases/previous")
      ops_root: Path = Path("/var/lib/kb/ops")
      unit: Path = Path("/etc/systemd/system/kb-dashboard.service")

  RELEASES = Path("/opt/kb-releases")
  CURRENT = RELEASES / "current"
  PREVIOUS = RELEASES / "previous"


  def atomic_link(link: Path, target: Path) -> None:
      pending = link.with_name(link.name + ".new")
      pending.unlink(missing_ok=True)
      pending.symlink_to(target.name, target_is_directory=True)
      pending.replace(link)


  def activate(archive: Path, checksum: Path, paths: RuntimePaths = RuntimePaths()) -> str:
      expected = checksum.read_text(encoding="utf-8").split()[0]
      actual = hashlib.sha256(archive.read_bytes()).hexdigest()
      if not hmac.compare_digest(expected, actual):
          raise RuntimeError("release checksum mismatch")
      if paths.current.exists():
          require_quiescence(read_readiness(), "release activation")
      elif subprocess.run(["systemctl", "is-active", "--quiet", "kb-dashboard.service"]).returncode == 0:
          raise RuntimeError("initial activation requires the old live-checkout service to be stopped")
      version = read_version_from_archive(archive)
      destination = paths.releases / version
      extract_read_only(archive, destination)
      subprocess.run(["python3", str(destination / "deploy" / "validate_vm_runtime.py"), "--ops-root", str(paths.ops_root), "--unit", str(paths.unit)], check=True)
      old = paths.current.resolve() if paths.current.exists() else None
      if old is not None: atomic_link(paths.previous, old)
      atomic_link(paths.current, destination)
      subprocess.run(["systemctl", "restart", "kb-dashboard.service"], check=True)
      wait_healthy()
      return version


  def rollback(paths: RuntimePaths = RuntimePaths()) -> str:
      readiness = read_readiness()
      require_quiescence(readiness, "rollback")
      target = paths.previous.resolve(strict=True)
      atomic_link(paths.current, target)
      subprocess.run(["systemctl", "restart", "kb-dashboard.service"], check=True)
      wait_healthy()
      return target.name


  def require_quiescence(readiness: dict, operation: str) -> None:
      if not readiness.get("quiescent"):
          raise RuntimeError(operation + " is not quiescent: " + ",".join(readiness.get("blockers", [])))
  ```

  `safe_members` must reject absolute paths, `..` components, and symlink/hardlink members. `extract_read_only` writes a fresh version directory, verifies `MANIFEST.sha256`, and chmods files/directories to `0444/0555` before link selection.

- [ ] Implement the desktop transfer without accepting a token option or reading a token environment variable:

  ```py
  def deploy(archive: Path, checksum: Path, host: str, run=subprocess.run) -> None:
      version = archive.stem.removeprefix("kb-platform-").removesuffix(".tar")
      remote_archive = f"/var/lib/kb/state/incoming/{archive.name}"
      remote_checksum = f"/var/lib/kb/state/incoming/{checksum.name}"
      run(["scp", str(archive), str(checksum), f"{host}:/var/lib/kb/state/incoming/"], check=True)
      run(["ssh", host, "sudo", "python3", "/usr/local/lib/kb/activate_release.py", "activate", "--archive", remote_archive, "--checksum", remote_checksum], check=True)
      print(f"activated {version}")
  ```

- [ ] Implement the one-time live-checkout transition as an argv-only bootstrap:

  ```py
  DATA_PATTERNS = ("/CLAUDE.md", "/BOSS.md", "/HEARTBEAT.md", "/docs/", "/orgs/", "/queue/", "/ledgers/", "/traces/", "/memory/", "/dashboards/", "/handoffs/", "/governance/", "/agents/", "/skills/")


  def bootstrap(ops_bundle: Path, run=subprocess.run) -> None:
      run(["systemctl", "disable", "--now", "kb-dashboard.service"], check=False)
      run(["useradd", "--system", "--home-dir", "/nonexistent", "--shell", "/usr/sbin/nologin", "kb-dashboard"], check=False)
      for path in ("/opt/kb-releases", "/var/lib/kb/ops", "/var/lib/kb/state", "/var/lib/kb/state/outbox/ready", "/var/lib/kb/state/outbox/receipts", "/var/lib/kb/state/outbox/incoming", "/var/lib/kb/state/incoming"):
          run(["install", "-d", "-o", "kb-dashboard", "-g", "kb-dashboard", path], check=True)
      run(["git", "clone", "--branch", "ops", "--no-checkout", str(ops_bundle), "/var/lib/kb/ops"], check=True)
      run(["git", "-C", "/var/lib/kb/ops", "sparse-checkout", "set", "--no-cone", *DATA_PATTERNS], check=True)
      run(["git", "-C", "/var/lib/kb/ops", "checkout", "ops"], check=True)
      run(["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "origin", "disabled://desktop-promotion-only"], check=True)
      run(["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "--push", "origin", "disabled://desktop-promotion-only"], check=True)
      run(["chown", "-R", "kb-dashboard:kb-dashboard", "/var/lib/kb/ops", "/var/lib/kb/state"], check=True)
  ```

  Add a pytest command-capture assertion that the old service stops before clone, `DATA_PATTERNS` excludes `dashboard`, `scripts`, `schemas`, `deploy`, and `.github`, and both remote URLs are disabled. On the desktop create the seed with `git bundle create kb-ops-bootstrap.bundle ops`, transfer the bundle and the three deploy scripts, run bootstrap once, install the unit and activator under `/etc/systemd/system` and `/usr/local/lib/kb`, then use the normal desktop deploy command for the first release.

- [ ] Implement `validate_vm_runtime.py` so it inspects names only, never prints values, and enforces the data-only checkout and disabled push remote:

  ```py
  FORBIDDEN_ENV = frozenset({"GITHUB_TOKEN", "GH_TOKEN", "GIT_ASKPASS", "SSH_AUTH_SOCK"})


  def validate_environment(env: dict[str, str]) -> None:
      present = sorted(FORBIDDEN_ENV.intersection(env))
      if present:
          raise RuntimeError("forbidden VM credential channel: " + ",".join(present))


  def validate_ops_root(root: Path) -> None:
      for rel in ("dashboard", "scripts", "schemas", ".github"):
          if (root / rel).exists():
              raise RuntimeError(f"ops checkout contains platform path: {rel}")
      push_url = subprocess.run(["git", "remote", "get-url", "--push", "origin"], cwd=root, check=True, text=True, capture_output=True).stdout.strip()
      if push_url != "disabled://desktop-promotion-only":
          raise RuntimeError("ops push remote is not disabled")


  def validate_unit(unit: Path) -> None:
      text = unit.read_text(encoding="utf-8")
      assigned = {match.group(1) for match in re.finditer(r"(?m)^Environment=(?:\"?)([A-Za-z_][A-Za-z0-9_]*)=", text)}
      forbidden = sorted(FORBIDDEN_ENV.intersection(assigned))
      if forbidden:
          raise RuntimeError("dashboard unit assigns a forbidden credential name: " + ",".join(forbidden))
      unset = next((line.split("=", 1)[1].split() for line in text.splitlines() if line.startswith("UnsetEnvironment=")), [])
      missing = sorted(FORBIDDEN_ENV.difference(unset))
      if missing:
          raise RuntimeError("dashboard unit does not unset credential channels: " + ",".join(missing))
      if "Environment=KB_COORDINATION_PUBLICATION=outbox" not in text.splitlines():
          raise RuntimeError("dashboard unit must select local outbox publication")
  ```

  The CLI runs `validate_environment(dict(os.environ))`, `validate_ops_root(args.ops_root)`, and `validate_unit(args.unit)` in that order and exits nonzero on any refusal; it prints only the refusal text, never environment values.

- [ ] Create the systemd unit:

  ```ini
  [Unit]
  Description=kb dashboard immutable platform
  After=network-online.target

  [Service]
  Type=simple
  User=kb-dashboard
  Group=kb-dashboard
  WorkingDirectory=/opt/kb-releases/current/dashboard
  Environment=DASHBOARD_PLATFORM_ROOT=/opt/kb-releases/current
  Environment=PYTHONPATH=/opt/kb-releases/current
  Environment=DASHBOARD_REPO_ROOT=/var/lib/kb/ops
  Environment=DASHBOARD_STATE_ROOT=/var/lib/kb/state
  Environment=DASHBOARD_EXECUTION_ACTIVATED=0
  Environment=KB_COORDINATION_PUBLICATION=outbox
  Environment=KB_VM_RUNTIME=1
  Environment=GIT_CONFIG_GLOBAL=/dev/null
  UnsetEnvironment=GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK
  ExecStartPre=/usr/bin/python3 /opt/kb-releases/current/deploy/validate_vm_runtime.py --ops-root /var/lib/kb/ops --unit /etc/systemd/system/kb-dashboard.service
  ExecStart=/usr/bin/node --experimental-strip-types server/index.ts
  Restart=on-failure
  KillMode=control-group
  TimeoutStopSec=90
  NoNewPrivileges=true
  ProtectHome=true
  PrivateTmp=true
  ReadOnlyPaths=/opt/kb-releases
  ReadWritePaths=/var/lib/kb/state /var/lib/kb/ops

  [Install]
  WantedBy=multi-user.target
  ```

  Add `deploy` to Task 10's `RELEASE_ROOTS`, and add an archive assertion for `deploy/activate_release.py`, before running the full release test.

- [ ] Run `python -m pytest tests/test_deploy_release.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py -q`. On a fresh Ubuntu staging VM run the documented bundle/bootstrap transition, then deploy one artifact; run `release_version=$(cat /opt/kb-releases/current/VERSION); test "$(readlink -f /proc/$(systemctl show -p MainPID --value kb-dashboard)/cwd)" = "/opt/kb-releases/$release_version/dashboard"`; deploy a second artifact; run the rollback command and verify `readlink -f /opt/kb-releases/current` returns the first version. Preserve all command output in the Task 19/25 evidence directories.

- [ ] Commit with `git add scripts/deploy_platform_release.py deploy/activate_release.py deploy/bootstrap_vm.py deploy/validate_vm_runtime.py deploy/systemd/kb-dashboard.service tests/test_deploy_release.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py scripts/build_platform_release.py tests/test_build_platform_release.py; git commit -m "feat(deploy): activate and roll back immutable releases"`.

### Task 13: Back up and restore the release, ops checkout, and state root

Choice: restic supplies encryption and off-VM storage, with a 15-minute RPO and 60-minute RTO as the smallest explicit Phase I objectives. The code handles only paths, timestamps, manifests, and exit status; operators provision restic's ambient runtime access outside this repository.

**Files**

- Create: `deploy/state_backup.py`
- Create: `deploy/systemd/kb-state-backup.service`
- Create: `deploy/systemd/kb-state-backup.timer`
- Create: `tests/test_state_backup.py`

**Interfaces**

- Produces CLI: `python3 deploy/state_backup.py backup --rpo-minutes 15`
- Produces CLI: `python3 deploy/state_backup.py restore-drill --target PATH --rto-minutes 60`
- Consumes paths: `/opt/kb-releases`, `/var/lib/kb/ops`, `/var/lib/kb/state`
- Produces report schema: `{version: 1, operation: string, startedAt: string, finishedAt: string, durationSeconds: number, snapshot: string, paths: string[], verified: boolean}`

- [ ] Add failing tests with an injected command runner:

  ```py
  import subprocess
  from datetime import datetime, timezone

  def test_backup_covers_all_tier_zero_paths_and_checks_rpo(tmp_path):
      calls = []
      times = iter([datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc), datetime(2026, 8, 11, 12, 2, tzinfo=timezone.utc)])
      def run(argv):
          calls.append(argv)
          stdout = '[{"short_id":"snap-1","time":"2026-08-11T12:01:00Z"}]' if argv[1] == "snapshots" else ""
          return subprocess.CompletedProcess(argv, 0, stdout=stdout, stderr="")
      report = state_backup.backup(run=run, now=lambda: next(times))
      assert calls[0] == ["restic", "backup", "/opt/kb-releases", "/var/lib/kb/ops", "/var/lib/kb/state", "--tag", "kb-tier0"]
      assert report["verified"] is True
      assert report["snapshot"] == "snap-1"


  def test_restore_drill_fails_when_rto_is_exceeded(tmp_path):
      ticks = iter([0.0, 3_601.0])
      with pytest.raises(RuntimeError, match="RTO"):
          state_backup.restore_drill(
              tmp_path / "restore",
              rto_minutes=60,
              run=lambda argv: subprocess.CompletedProcess(argv, 0, stdout="", stderr=""),
              monotonic=lambda: next(ticks),
              verify=lambda _target, _paths: None,
          )
  ```

- [ ] Run `python -m pytest tests/test_state_backup.py -q` and verify the module is absent.

- [ ] Implement `backup` and `restore_drill` around an argv-only runner:

  ```py
  import uuid


  TIER_ZERO = (Path("/opt/kb-releases"), Path("/var/lib/kb/ops"), Path("/var/lib/kb/state"))


  REPORT_ROOT = Path("/var/lib/kb/backup-reports")


  def make_report(operation: str, started: datetime, finished: datetime, snapshot: str, paths, verified: bool, duration_seconds: float | None = None) -> dict:
      return {
          "version": 1, "operation": operation,
          "startedAt": started.isoformat().replace("+00:00", "Z"),
          "finishedAt": finished.isoformat().replace("+00:00", "Z"),
          "durationSeconds": duration_seconds if duration_seconds is not None else (finished - started).total_seconds(),
          "snapshot": snapshot, "paths": [str(path) for path in paths], "verified": verified,
      }


  def verify_restored_tree(target: Path, paths=TIER_ZERO) -> None:
      missing = [str(source) for source in paths if not (target / source.relative_to("/")).is_dir()]
      if missing:
          raise RuntimeError(f"restore is missing tier-zero roots: {', '.join(missing)}")
      if not (target / "opt/kb-releases/current").exists():
          raise RuntimeError("restore is missing the selected platform release")
      if not (target / "var/lib/kb/ops/.git").exists():
          raise RuntimeError("restore is missing the ops repository metadata")


  def write_report(value: dict, root: Path = REPORT_ROOT) -> Path:
      root.mkdir(parents=True, exist_ok=True)
      name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ') + '-' + value["operation"] + '.json'
      target = root / name
      temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
      with temporary.open("x", encoding="utf-8") as handle:
          json.dump(value, handle, indent=2, sort_keys=True); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
      os.replace(temporary, target)
      return target


  def backup(rpo_minutes: int = 15, run=run_command, now=utc_now) -> dict:
      started = now()
      backup_result = run(["restic", "backup", *map(str, TIER_ZERO), "--tag", "kb-tier0"])
      if backup_result.returncode != 0: raise RuntimeError("restic backup failed")
      snapshots = json.loads(run(["restic", "snapshots", "--tag", "kb-tier0", "--latest", "1", "--json"]).stdout)
      latest = snapshots[-1]
      finished = now()
      age = (finished - datetime.fromisoformat(latest["time"].replace("Z", "+00:00"))).total_seconds() / 60
      if age > rpo_minutes:
          raise RuntimeError(f"backup RPO exceeded: {age:.1f} minutes")
      return make_report("backup", started, finished, latest["short_id"], TIER_ZERO, True)


  def restore_drill(target: Path, rto_minutes: int = 60, run=run_command, monotonic=time.monotonic, verify=verify_restored_tree, now=utc_now) -> dict:
      if target.exists() or target.parent == target:
          raise RuntimeError("restore target must be a fresh child path")
      started_at = now(); started = monotonic()
      restored = run(["restic", "restore", "latest", "--tag", "kb-tier0", "--target", str(target)])
      if restored.returncode != 0: raise RuntimeError("restic restore failed")
      verify(target, TIER_ZERO)
      duration = monotonic() - started
      if duration > rto_minutes * 60:
          raise RuntimeError(f"restore RTO exceeded: {duration:.1f} seconds")
      return make_report("restore-drill", started_at, now(), "latest", TIER_ZERO, True, duration)
  ```

  The CLI calls `write_report()` only after either operation succeeds. Do not log environment contents or command output that may contain repository endpoints.

- [ ] Create the oneshot unit and timer exactly as follows; provision the dedicated `kb-backup` OS user separately and grant it read-only access to the three source roots plus write access to `/var/lib/kb/backup-reports`:

  ```ini
  [Unit]
  Description=Back up kb tier-zero state
  After=network-online.target

  [Service]
  Type=oneshot
  User=kb-backup
  PassEnvironment=RESTIC_REPOSITORY RESTIC_PASSWORD_COMMAND
  ExecStart=/usr/bin/python3 /opt/kb-releases/current/deploy/state_backup.py backup --rpo-minutes 15
  NoNewPrivileges=true
  PrivateTmp=true
  ```

  ```ini
  [Unit]
  Description=Run kb tier-zero backup every 15 minutes

  [Timer]
  OnBootSec=5min
  OnUnitActiveSec=15min
  Persistent=true
  RandomizedDelaySec=60

  [Install]
  WantedBy=timers.target
  ```

  This uses ambient `RESTIC_REPOSITORY` and `RESTIC_PASSWORD_COMMAND`, never an environment file or checked-in value.

- [ ] Run `python -m pytest tests/test_state_backup.py -q`. On Ubuntu run `drill_id=$(date -u +%Y%m%dT%H%M%SZ); python3 deploy/state_backup.py restore-drill --target "/var/lib/kb/restore-drill/$drill_id" --rto-minutes 60`; verify the restored three roots, record elapsed time below 60 minutes, and prove the latest encrypted snapshot is newer than 15 minutes with `restic snapshots --tag kb-tier0 --latest 1 --json`.

- [ ] Commit with `git add deploy/state_backup.py deploy/systemd/kb-state-backup.service deploy/systemd/kb-state-backup.timer tests/test_state_backup.py; git commit -m "feat(backup): protect tier-zero runtime state"`.

## F1. Gate-1 boundary hardening

### Task 14: Require a session on every non-health read route

Choice: `/healthz`, `/readyz`, static SPA assets, and the four session-minting ceremonies remain public. Every repository/state read, SSE stream, and WebSocket upgrade accepts the WebAuthn session through either the bearer header or an HttpOnly same-origin cookie.

**Files**

- Modify: `dashboard/server/http/middleware.ts:25-72`
- Create: `dashboard/server/http/middleware.test.ts`
- Modify: `dashboard/server/auth/routes.ts:134-178`
- Modify: `dashboard/server/auth/routes.test.ts:109-129`
- Modify: `dashboard/server/hub/index.ts:26-51`
- Modify: `dashboard/server/hub/sse.test.ts:1-84`
- Modify: `dashboard/server/hub/ws.test.ts:1-81`
- Modify: `dashboard/server/index.ts:79-166`
- Modify: `dashboard/server/index.test.ts:1-85`

**Interfaces**

- Produces: `sessionToken(req: Pick<FastifyRequest, 'headers'>): string | undefined`
- Changes: `requireSession(sessionConfig: SessionConfig)` accepts bearer or `kb_session` cookie
- Changes: successful `POST /api/auth/assert/verify` sets the minted token in `kb_session` with `Path=/; HttpOnly; SameSite=Strict`, a Max-Age derived from expiry, and `Secure` whenever the configured RP origin is HTTPS
- Changes: `registerHub(app, opts: HubOptions & { sessionConfig: SessionConfig }): EventBus`

- [ ] Add a route-matrix test and cookie extraction test:

  ```ts
  it.each([
    '/api/kb/tree', '/api/kb/file?path=docs/x.md', '/api/kb/history?path=docs/x.md',
    '/api/registry', '/api/registry/skills', '/api/registry/connections',
    '/api/index', '/api/ledgers/slices', '/api/dag', '/api/routing',
    '/api/agents', '/api/agents/system-workers', '/api/agents/example',
    '/api/panels/health', '/api/panels/usage', '/api/panels/atlas',
    '/api/workflows', '/api/workflows/profiles', '/api/workflows/example',
    '/api/human-inbox', '/api/approvals', '/api/composer/sessions', '/api/composer/sessions/example',
    '/api/control/proposals', '/api/control/execution', '/api/control/runs', '/api/control/runs/example',
    '/api/control/runs/example/events', '/api/control/retention/inventory',
    '/api/pty/sessions', '/api/pty/session-runs', '/events',
  ])('rejects unauthenticated read %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(401);
  });

  it.each(['/healthz', '/readyz', '/', '/api/auth/assert/options'])('keeps bootstrap route %s reachable', async (url) => {
    const method = url.includes('/auth/') ? 'POST' : 'GET';
    expect((await app.inject({ method, url })).statusCode).not.toBe(401);
  });
  ```

  ```ts
  it('accepts the HttpOnly session cookie but not an unrelated cookie', async () => {
    expect(sessionToken({ headers: { cookie: 'other=x; kb_session=signed.token' } } as never)).toBe('signed.token');
    expect(sessionToken({ headers: { cookie: 'other=x' } } as never)).toBeUndefined();
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/index.test.ts server/http/middleware.test.ts server/auth/routes.test.ts server/hub/sse.test.ts server/hub/ws.test.ts` and verify current read routes return 200 without a session and cookie extraction fails.

- [ ] Replace bearer-only extraction with:

  ```ts
  export function sessionToken(req: { headers: { authorization?: string | string[]; cookie?: string } }): string | undefined {
    const bearer = bearerToken(req);
    if (bearer) return bearer;
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [name, value] = part.trim().split('=', 2);
      if (name === 'kb_session' && value) {
        try { return decodeURIComponent(value); } catch { return undefined; }
      }
    }
    return undefined;
  }
  ```

  Make `requireSession` call `sessionToken`. On successful assertion verification add:

  ```ts
  const maxAge = Math.max(1, Math.floor((claims.exp - (ctx.sessionConfig.now ?? Date.now)()) / 1000));
  const secure = config.origin.startsWith('https://') ? '; Secure' : '';
  reply.header('Set-Cookie', `kb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
  return reply.code(200).send({ token, expiresAt: claims.exp });
  ```

- [ ] In `index.ts`, create `surfaceCtx` before data routes and register every read-only data module in one child scope with the existing origin hook, read rate guard, and `scope.addHook('preHandler', requireSession(surfaceCtx.sessionConfig))`. Pass the same pre-handler into `registerHub`; add it as `preValidation` before `/events` and `/ws`. Keep only health/readiness, auth ceremonies, and static assets outside that authenticated read scope, and update the stale middleware comment that currently describes approvals as pre-auth.

- [ ] Run `cd dashboard; npm test -- server/index.test.ts server/http/middleware.test.ts server/auth/routes.test.ts server/hub/sse.test.ts server/hub/ws.test.ts; npm run typecheck; npm test` and verify the entire route matrix and suite pass on Windows and Ubuntu.

- [ ] Commit with `git add dashboard/server/http/middleware.ts dashboard/server/http/middleware.test.ts dashboard/server/auth/routes.ts dashboard/server/auth/routes.test.ts dashboard/server/hub/index.ts dashboard/server/hub/sse.test.ts dashboard/server/hub/ws.test.ts dashboard/server/index.ts dashboard/server/index.test.ts; git commit -m "fix(auth): protect every non-health read route"`.

### Task 15: Confine the generic KB browser to approved data roots

Choice: the generic browser can read only `docs`, `orgs`, `queue`, `ledgers`, `memory`, `dashboards`, and `handoffs`. Platform source, `.git`, state, and arbitrary filesystem roots are not browser resources.

**Files**

- Modify: `dashboard/server/kb/browser.ts:29-135`
- Modify: `dashboard/server/kb/browser.test.ts:51-112`
- Modify: `dashboard/server/kb/routes.ts:13-61`
- Modify: `dashboard/server/kb/routes.test.ts:8-56`

**Interfaces**

- Produces: `DEFAULT_KB_READ_ROOTS: readonly string[]`
- Produces: `resolveWithinAllowedRoot(repoRoot: string, relpath: string, allowedRoots?: readonly string[]): string`
- Changes: `KbBrowserOptions.allowedRoots?: readonly string[]`

- [ ] Add failing confinement tests:

  ```ts
  it.each(['CLAUDE.md', '.git/config', 'dashboard/server/index.ts', 'scripts/cards.py'])('refuses non-data path %s', (relpath) => {
    const root = mkdtempSync(join(tmpdir(), 'kb-read-roots-'));
    const file = join(root, ...relpath.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'not browser data', 'utf8');
    expect(() => readFile(root, relpath)).toThrow(/approved KB read root/);
  });

  it.each(['docs/note.md', 'orgs/demo/STATE.md', 'queue/inbox/card.md', 'memory/agent.md'])('allows approved data path %s', (relpath) => {
    expect(() => resolveWithinAllowedRoot(REPO_A, relpath)).not.toThrow();
  });
  ```

  ```ts
  it('returns 403 for platform source even with an authenticated route scope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/kb/file?path=dashboard/server/index.ts' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'read-root-refused' });
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/kb/browser.test.ts server/kb/routes.test.ts` and verify platform source is currently readable when present.

- [ ] Add the closed roots and make all three browser operations call the new guard before filesystem/git access:

  ```ts
  export const DEFAULT_KB_READ_ROOTS = ['docs', 'orgs', 'queue', 'ledgers', 'memory', 'dashboards', 'handoffs'] as const;
  export class ReadRootError extends Error {}

  export function resolveWithinAllowedRoot(
    repoRoot: string,
    relpath: string,
    allowedRoots: readonly string[] = DEFAULT_KB_READ_ROOTS,
  ): string {
    const normalized = relpath.replace(/\\/g, '/').replace(/^\.\//, '');
    const first = normalized.split('/')[0];
    if (!first || !allowedRoots.includes(first)) throw new ReadRootError('path is outside approved KB read roots');
    return resolveWithin(repoRoot, normalized);
  }

  export function listTree(repoRoot: string, subpath = '', allowedRoots: readonly string[] = DEFAULT_KB_READ_ROOTS): TreeListing {
    const dir = subpath === '' ? resolve(repoRoot) : resolveWithinAllowedRoot(repoRoot, subpath, allowedRoots);
    const entries: TreeEntry[] = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !(entry.isDirectory() && HIDDEN.has(entry.name)))
      .filter((entry) => subpath !== '' || allowedRoots.includes(entry.name))
      .map((entry) => ({ name: entry.name, path: toPosixRel(repoRoot, join(dir, entry.name)), type: entry.isDirectory() ? 'dir' as const : 'file' as const }));
    entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
    return { path: toPosixRel(repoRoot, dir), entries };
  }
  ```

  Make `readFile` and `fileHistory` call `resolveWithinAllowedRoot`; the root tree uses the filtered `listTree` above. Map `ReadRootError` to HTTP 403 in `routes.ts`; keep traversal/malformed input at 400. Do not expose a request parameter that changes `allowedRoots`.

- [ ] Run `cd dashboard; npm test -- server/kb/browser.test.ts server/kb/routes.test.ts; npm run typecheck` and verify all tests pass.

- [ ] Commit with `git add dashboard/server/kb/browser.ts dashboard/server/kb/browser.test.ts dashboard/server/kb/routes.ts dashboard/server/kb/routes.test.ts; git commit -m "fix(reads): confine KB browser roots"`.

## E. Durable VM outbox and desktop promotion

### Task 16: Spool VM coordination commits as durable Git bundles

Choice: each locally committed coordination transaction produces one ordered incremental Git bundle plus one atomic JSON manifest. A durable local anchor records the last spooled commit, so startup replays a commit left between `git commit` and manifest publication; the desktop primes the complete ordered chain before promoting pending items. Direct publication remains the default on desktop, while `KB_COORDINATION_PUBLICATION=outbox` disables fetch/pull/push in the VM process.

**Files**

- Create: `dashboard/server/write/outbox.ts`
- Create: `dashboard/server/write/outbox.test.ts`
- Modify: `dashboard/server/write/branch.ts:144-183,249-554`
- Modify: `dashboard/server/write/branch.test.ts:130-180,461-639`
- Modify: `dashboard/server/http/context.ts:70-130`
- Modify: `dashboard/server/http/surface.ts:120-205`
- Modify after Task 12 creation: `deploy/bootstrap_vm.py:25-110`
- Modify after Task 12 creation: `tests/test_bootstrap_vm.py:1-130`
- Modify after Task 12 creation: `deploy/validate_vm_runtime.py:1-120`
- Modify after Task 12 creation: `tests/test_validate_vm_runtime.py:1-130`

**Interfaces**

- Produces: `CoordinationPublication = 'direct' | 'outbox'`
- Produces: `OutboxManifest = { schema: 'kb.ops-outbox/v1'; id: string; parent: string; commit: string; paths: string[]; createdAt: string }`
- Produces: `spoolCoordinationCommit(input: SpoolInput): Promise<OutboxManifest>`
- Produces: `RecoveryInput = Omit<SpoolInput, 'commit' | 'paths'>`
- Produces: `recoverUnspooledCoordinationCommits(input: RecoveryInput): Promise<OutboxManifest[]>`
- Produces: `resolveCoordinationPublication(env?: NodeJS.ProcessEnv): CoordinationPublication`
- Changes: `prepareCoordination(repoRoot: string, runGit?: GitRunner, publication?: CoordinationPublication, outboxRoot?: string): Promise<void>`
- Changes: `RouteOptions.outboxRoot?: string`, `RouteOptions.publication?: CoordinationPublication`

- [ ] Add failing tests for the durable local-only path:

  ```ts
  import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { expect, it } from 'vitest';
  import { prepareCoordination, type GitRunner } from './branch.ts';
  import { spoolCoordinationCommit } from './outbox.ts';

  it('spools an exact coordination commit and publishes the manifest last', async () => {
    const spoolRoot = mkdtempSync(join(tmpdir(), 'outbox-'));
    const runGit: GitRunner = async (_root, args) => {
      if (args[0] === 'rev-parse') return 'a'.repeat(40) + '\n';
      if (args[0] === 'diff-tree') return 'memory/worker.md\0';
      if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
      if (args[0] === 'update-ref') return '';
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };
    const manifest = await spoolCoordinationCommit({ repoRoot: '/repo', spoolRoot, commit: 'b'.repeat(40), paths: ['memory/worker.md'], runGit, isCoordinationPath, now: () => new Date('2026-08-11T12:00:00Z') });
    const manifests = readdirSync(join(spoolRoot, 'ready')).filter((name) => name.endsWith('.json'));
    expect(manifests).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(spoolRoot, 'ready', manifests[0]), 'utf8'))).toEqual(manifest);
    expect(existsSync(join(spoolRoot, 'ready', `${manifest.id}.bundle`))).toBe(true);
  });

  it('outbox preparation never fetches, pulls, or pushes', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'ops\n';
      if (args[0] === 'diff') return '';
      return '';
    };
    await prepareCoordination('/fake/repo', runner, 'outbox', '/spool');
    expect(calls.flat()).not.toEqual(expect.arrayContaining(['fetch', 'pull', 'push']));
  });

  it('recovers a commit left after git commit but before spool publication', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args[0] === 'show-ref') return '';
      if (args[0] === 'rev-list') return `${'b'.repeat(40)}\n`;
      if (args[0] === 'diff-tree') return 'memory/worker.md\0';
      if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
      if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
      return '';
    };
    await recoverUnspooledCoordinationCommits({ repoRoot: '/repo', spoolRoot: mkdtempSync(join(tmpdir(), 'recover-')), runGit: runner, isCoordinationPath });
    expect(calls).toContainEqual(['update-ref', 'refs/kb-outbox/spooled', 'b'.repeat(40), 'a'.repeat(40)]);
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/write/outbox.test.ts server/write/branch.test.ts` and verify the outbox module/options are absent.

- [ ] Create the spooler with exact-path validation and atomic readiness publication:

  ```ts
  import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';
  import type { GitRunner } from './branch.ts';

  export type CoordinationPublication = 'direct' | 'outbox';
  export interface OutboxManifest {
    schema: 'kb.ops-outbox/v1'; id: string; parent: string; commit: string; paths: string[]; createdAt: string;
  }
  export interface SpoolInput {
    repoRoot: string; spoolRoot: string; commit: string; paths: readonly string[]; runGit: GitRunner;
    isCoordinationPath: (path: string) => boolean; now?: () => Date;
  }
  export type RecoveryInput = Omit<SpoolInput, 'commit' | 'paths'>;

  function fsyncPath(path: string): void {
    const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  }

  function fsyncDirectory(path: string): void {
    if (process.platform !== 'win32') fsyncPath(path);
  }

  export function resolveCoordinationPublication(env: NodeJS.ProcessEnv = process.env): CoordinationPublication {
    const value = env.KB_COORDINATION_PUBLICATION ?? 'direct';
    if (value !== 'direct' && value !== 'outbox') throw new Error(`unsupported coordination publication: ${value}`);
    return value;
  }

  export async function spoolCoordinationCommit(input: SpoolInput): Promise<OutboxManifest> {
    const paths = [...new Set(input.paths.map((path) => path.replace(/\\/g, '/')))].sort();
    if (paths.length === 0 || paths.some((path) => !input.isCoordinationPath(path))) throw new Error('outbox commit contains a non-coordination path');
    const actualPaths = (await input.runGit(input.repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', input.commit])).split('\0').filter(Boolean).sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(paths)) throw new Error('outbox manifest paths do not match the commit');
    const parent = (await input.runGit(input.repoRoot, ['rev-parse', `${input.commit}^`])).trim();
    const id = input.commit;
    const ready = join(input.spoolRoot, 'ready'); mkdirSync(ready, { recursive: true });
    const published = join(ready, `${id}.json`);
    if (existsSync(published)) {
      const existing = JSON.parse(readFileSync(published, 'utf8')) as OutboxManifest;
      if (existing.commit !== input.commit || JSON.stringify(existing.paths) !== JSON.stringify(paths)) throw new Error('outbox id collision');
      return Object.freeze(existing);
    }
    const bundleTmp = join(input.spoolRoot, `${id}.bundle.tmp`);
    const manifestTmp = join(input.spoolRoot, `${id}.json.tmp`);
    const readyBundle = join(ready, `${id}.bundle`);
    for (const orphan of [bundleTmp, manifestTmp, readyBundle]) if (existsSync(orphan)) rmSync(orphan);
    const itemRef = `refs/kb-outbox/items/${id}`;
    await input.runGit(input.repoRoot, ['update-ref', itemRef, input.commit]);
    try { await input.runGit(input.repoRoot, ['bundle', 'create', bundleTmp, `${parent}..${itemRef}`]); }
    finally { await input.runGit(input.repoRoot, ['update-ref', '-d', itemRef]); }
    fsyncPath(bundleTmp);
    const createdAt = (input.now ?? (() => new Date()))().toISOString();
    const manifest: OutboxManifest = { schema: 'kb.ops-outbox/v1', id, parent, commit: input.commit, paths, createdAt };
    writeFileSync(manifestTmp, JSON.stringify(manifest) + '\n', { encoding: 'utf8', flag: 'wx' });
    fsyncPath(manifestTmp);
    renameSync(bundleTmp, readyBundle);
    renameSync(manifestTmp, join(ready, `${id}.json`));
    fsyncDirectory(ready);
    return Object.freeze(manifest);
  }
  ```

- [ ] Implement crash recovery using the exact local anchor contract:

  ```ts
  const OUTBOX_ANCHOR = 'refs/kb-outbox/spooled';

  export async function recoverUnspooledCoordinationCommits(input: RecoveryInput): Promise<OutboxManifest[]> {
    const anchor = (await input.runGit(input.repoRoot, ['rev-parse', '--verify', OUTBOX_ANCHOR])).trim();
    if (!/^[0-9a-f]{40}$/.test(anchor)) throw new Error('outbox anchor is not initialized');
    const commits = (await input.runGit(input.repoRoot, ['rev-list', '--reverse', `${anchor}..HEAD`])).trim().split(/\r?\n/).filter(Boolean);
    const manifests: OutboxManifest[] = [];
    let previous = anchor;
    for (const commit of commits) {
      const raw = await input.runGit(input.repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit]);
      const paths = raw.split('\0').filter(Boolean);
      const manifest = await spoolCoordinationCommit({ ...input, commit, paths });
      await input.runGit(input.repoRoot, ['update-ref', OUTBOX_ANCHOR, commit, previous]);
      previous = commit; manifests.push(manifest);
    }
    return manifests;
  }
  ```

  In `prepareCoordination`, keep branch/index checks in both modes, call `recoverUnspooledCoordinationCommits` before accepting another outbox write, and call `pull --rebase` only for `direct`. In both `commitPreparedCoordination` and `publishPreparedCoordinationCommit`, obtain `HEAD` after commit and either run the existing bounded push/reconcile logic or recover/spool through the new anchor; never fall through from outbox to push. Thread `publication` and `/var/lib/kb/state/outbox` (or an injected root) from `SurfaceContext` to every audit, launch, reply, settlement, and workflow coordination write. Add an `onReady` hook that performs recovery before listening for traffic.

- [ ] Extend `bootstrap_vm.py` to run `git -C /var/lib/kb/ops update-ref refs/kb-outbox/spooled HEAD` after creating the clean data checkout, and assert that exact argv in `test_bootstrap_vm.py`. For an existing staging VM, require the one-time initialization command while the service is stopped and the checkout is clean; `deploy/validate_vm_runtime.py` must refuse outbox mode if the anchor is absent.

  ```py
  def validate_outbox_anchor(root: Path, run=subprocess.run) -> None:
      result = run(["git", "show-ref", "--verify", "--quiet", "refs/kb-outbox/spooled"], cwd=root)
      if result.returncode != 0:
          raise RuntimeError("outbox anchor refs/kb-outbox/spooled is absent")
  ```

  Add `validate_outbox_anchor(args.ops_root)` after the existing root/unit checks, and add a test whose injected runner returns 1 and expects the exact refusal.

- [ ] Run `cd dashboard; npm test -- server/write/outbox.test.ts server/write/branch.test.ts server/http/surface.test.ts; npm run typecheck; npm test; cd ..; python -m pytest tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py -q` and verify all tests pass. On Ubuntu set `KB_COORDINATION_PUBLICATION=outbox`, perform one temporary coordination write, select it with `bundle=$(find /var/lib/kb/state/outbox/ready -maxdepth 1 -name '*.bundle' -print -quit)`, and verify `git bundle verify "$bundle"` succeeds while the disabled push remote receives no call. For deterministic crash recovery, stop the service, use `sudo -u kb-dashboard git -C /var/lib/kb/ops commit` to create one exact temporary `memory/` change without advancing `refs/kb-outbox/spooled`, start the service, and verify its `onReady` recovery publishes `<HEAD>.json`/`<HEAD>.bundle` before atomically advancing the anchor to `HEAD`.

- [ ] Commit with `git add dashboard/server/write/outbox.ts dashboard/server/write/outbox.test.ts dashboard/server/write/branch.ts dashboard/server/write/branch.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts deploy/bootstrap_vm.py deploy/validate_vm_runtime.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py; git commit -m "feat(outbox): spool VM coordination commits durably"`.

### Task 17: Replay and promote outbox bundles from the desktop

Choice: promotion is ordered by manifest creation/id, uses three bounded attempts, and leaves the bundle and manifest untouched until an atomic receipt exists. After all pending items are receipted, the desktop returns the reconciled ops ref as a bundle; the VM applies it only while quiescent and with no unreceipted local commit, so the data checkout converges without GitHub access.

**Files**

- Create: `scripts/promote_vm_outbox.py`
- Create: `deploy/apply_ops_reconciliation.py`
- Create: `tests/test_promote_vm_outbox.py`
- Create: `tests/test_apply_ops_reconciliation.py`

**Interfaces**

- Produces CLI: `python scripts/promote_vm_outbox.py --spool PATH --repo PATH --vm-host HOST [--max-attempts 3]`
- Produces VM CLI: `python3 deploy/apply_ops_reconciliation.py --repo /var/lib/kb/ops --spool /var/lib/kb/state/outbox --bundle PATH --receipts PATH --expected-source-head SHA`
- Produces: `PromotionReceipt = { schema: 'kb.ops-promotion/v1'; id: string; sourceCommit: string; promotedCommit: string; promotedAt: string }`
- Produces: `fetch_vm_outbox(vm_host: str, snapshot_root: Path, run=subprocess.run) -> Path`
- Consumes: Task 16 `OutboxManifest`

- [ ] Add failing replay tests:

  ```py
  import json
  import subprocess
  from pathlib import Path
  import pytest
  from scripts.promote_vm_outbox import promote_pending


  def fixture_bundle(tmp_path: Path, paths=None):
      spool = tmp_path / "spool"; ready = spool / "ready"; receipts = spool / "receipts"
      ready.mkdir(parents=True); receipts.mkdir(); repo = tmp_path / "repo"; repo.mkdir()
      manifest = {"schema": "kb.ops-outbox/v1", "id": "20260811-item", "parent": "a" * 40, "commit": "b" * 40, "paths": paths or ["memory/worker.md"], "createdAt": "2026-08-11T12:00:00Z"}
      (ready / f"{manifest['id']}.json").write_text(json.dumps(manifest), encoding="utf-8")
      (ready / f"{manifest['id']}.bundle").write_bytes(b"bundle")
      return spool, repo, manifest


  def git_succeeds(_repo: Path, args: list[str]):
      if args[0] == "diff-tree": stdout = "memory/worker.md\0"
      elif args[:2] == ["rev-parse", "HEAD"]: stdout = "c" * 40 + "\n"
      else: stdout = ""
      return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")


  def network_fails(repo: Path, args: list[str]):
      if args[0] in {"pull", "push"}:
          raise subprocess.CalledProcessError(128, args)
      return git_succeeds(repo, args)


  def must_not_run(_repo: Path, args: list[str]):
      raise AssertionError(f"promoted item replayed: {args}")


  def test_outage_leaves_item_pending_and_next_run_promotes_once(tmp_path):
      spool, repo, manifest = fixture_bundle(tmp_path)
      first = promote_pending(spool, repo, max_attempts=3, run=network_fails)
      assert first == {"promoted": 0, "pending": 1, "failed": 1}
      assert not (spool / "receipts" / f"{manifest['id']}.json").exists()
      second = promote_pending(spool, repo, max_attempts=3, run=git_succeeds)
      assert second == {"promoted": 1, "pending": 0, "failed": 0}
      third = promote_pending(spool, repo, max_attempts=3, run=must_not_run)
      assert third["promoted"] == 0


  def test_promoter_rejects_bundle_with_durable_path(tmp_path):
      spool, repo, _manifest = fixture_bundle(tmp_path, paths=["docs/design.md"])
      with pytest.raises(RuntimeError, match="non-coordination"):
          promote_pending(spool, repo, run=git_succeeds)
  ```

  ```py
  def test_vm_reconciliation_requires_quiescence_and_all_receipts(tmp_path):
      repo = tmp_path / "repo"; repo.mkdir()
      spool = tmp_path / "spool"; (spool / "ready").mkdir(parents=True); (spool / "receipts").mkdir()
      returned_receipts = tmp_path / "returned-receipts"; returned_receipts.mkdir()
      bundle = tmp_path / "ops-return.bundle"; bundle.write_bytes(b"bundle")
      with pytest.raises(RuntimeError, match="quiescent"):
          apply_reconciliation(repo, spool, bundle, returned_receipts, "b" * 40, readiness=lambda: {"quiescent": False})
      (spool / "ready" / "pending.json").write_text('{}', encoding="utf-8")
      with pytest.raises(RuntimeError, match="unreceipted"):
          apply_reconciliation(repo, spool, bundle, returned_receipts, "b" * 40, readiness=lambda: {"quiescent": True})
  ```

- [ ] Run `python -m pytest tests/test_promote_vm_outbox.py -q` and verify the module is absent.

- [ ] Implement ordered manifest validation and idempotent promotion:

  ```py
  COORDINATION = re.compile(r"^(queue|ledgers|traces|memory|dashboards|handoffs)/|^orgs/[^/]+/STATE\.md$")
  SAFE_HOST = re.compile(r"^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$")


  def fetch_vm_outbox(vm_host: str, snapshot_root: Path, run=subprocess.run) -> Path:
      if not SAFE_HOST.fullmatch(vm_host) or vm_host.startswith("-"):
          raise ValueError("vm host must be an SSH hostname with optional user")
      if snapshot_root.exists():
          raise RuntimeError("outbox snapshot root must be fresh")
      snapshot_root.mkdir(parents=True)
      run(["scp", "-r", f"{vm_host}:/var/lib/kb/state/outbox/ready", f"{vm_host}:/var/lib/kb/state/outbox/receipts", str(snapshot_root)], check=True)
      head = run(["ssh", vm_host, "git", "-C", "/var/lib/kb/ops", "rev-parse", "HEAD"], check=True, text=True, capture_output=True).stdout.strip()
      if not re.fullmatch(r"[0-9a-f]{40}", head): raise RuntimeError("VM returned an invalid source head")
      (snapshot_root / "SOURCE_HEAD").write_text(head + "\n", encoding="ascii")
      ready = snapshot_root / "ready"
      if not ready.is_dir() or not (snapshot_root / "receipts").is_dir(): raise RuntimeError("VM outbox snapshot did not contain ready/ and receipts/")
      return snapshot_root


  def pending_manifests(spool: Path) -> list[tuple[Path, dict]]:
      receipts = spool / "receipts"
      result = []
      for path in (spool / "ready").glob("*.json"):
          data = json.loads(path.read_text(encoding="utf-8"))
          if data.get("schema") != "kb.ops-outbox/v1": raise RuntimeError("unsupported outbox manifest")
          if not (receipts / path.name).exists(): result.append((path, data))
      return sorted(result, key=lambda item: (item[1]["createdAt"], item[1]["id"]))


  def prime_source_chain(spool: Path, repo: Path, run=run_git) -> None:
      manifests = [json.loads(path.read_text(encoding="utf-8")) for path in (spool / "ready").glob("*.json")]
      for manifest in sorted(manifests, key=lambda item: (item["createdAt"], item["id"])):
          bundle = spool / "ready" / f"{manifest['id']}.bundle"
          run(repo, ["bundle", "verify", str(bundle)])
          run(repo, ["fetch", str(bundle), f"refs/kb-outbox/items/{manifest['id']}:refs/kb-outbox/{manifest['id']}"])


  def promote_one(spool: Path, repo: Path, manifest: dict, run=run_git) -> dict:
      if not manifest["paths"] or any(not COORDINATION.match(path) for path in manifest["paths"]):
          raise RuntimeError("outbox item contains a non-coordination path")
      bundle = spool / "ready" / f"{manifest['id']}.bundle"
      changed = nul_paths(run(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", manifest["commit"]]).stdout)
      if sorted(changed) != sorted(manifest["paths"]): raise RuntimeError("bundle paths do not match manifest")
      run(repo, ["pull", "--rebase", "origin", "ops"])
      promoted = run(repo, ["log", "origin/ops", "--format=%H", "--fixed-strings", f"--grep=KB-Outbox-ID: {manifest['id']}", "-1"]).stdout.strip()
      if not promoted:
          run(repo, ["cherry-pick", "--no-commit", manifest["commit"]])
          run(repo, ["commit", "-m", f"chore(outbox): promote {manifest['id']}", "-m", f"KB-Outbox-ID: {manifest['id']}"])
          promoted = run(repo, ["rev-parse", "HEAD"]).stdout.strip()
          run(repo, ["push", "origin", "ops"])
      return {"schema": "kb.ops-promotion/v1", "id": manifest["id"], "sourceCommit": manifest["commit"], "promotedCommit": promoted, "promotedAt": utc_now()}
  ```

  Return immediately when `pending_manifests` is empty; otherwise call `prime_source_chain` before promoting the pending list. This lets a fresh desktop clone load every prerequisite commit even when an earlier item already has a receipt. Wrap only the pull/cherry-pick/push transaction in this bounded loop; the `KB-Outbox-ID` trailer makes a retry after “push succeeded, receipt write failed” converge without a duplicate commit:

  ```py
  for attempt in range(1, max_attempts + 1):
      before = run_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
      try:
          receipt = promote_one(spool, repo, manifest, run_git)
          write_receipt_durably(spool / "receipts" / f"{manifest['id']}.json", receipt)
          break
      except subprocess.CalledProcessError:
          run_git(repo, ["cherry-pick", "--abort"], check=False)
          run_git(repo, ["reset", "--hard", before])
          if attempt == max_attempts: failed += 1
  ```

  Write receipts with the same crash boundary as the VM spool:

  ```py
  import uuid


  def write_receipt_durably(target: Path, value: dict) -> None:
      target.parent.mkdir(parents=True, exist_ok=True)
      temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
      with temporary.open("x", encoding="utf-8") as handle:
          json.dump(value, handle, sort_keys=True, separators=(",", ":"))
          handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
      os.replace(temporary, target)
      if os.name != "nt":
          directory_fd = os.open(target.parent, os.O_RDONLY)
          try: os.fsync(directory_fd)
          finally: os.close(directory_fd)
  ```

- [ ] After all manifests have receipts, create a return bundle from the exact pushed `origin/ops`, transfer it over SSH, and invoke the VM apply command. Implement the VM guard and ref replacement as:

  ```py
  def apply_reconciliation(repo: Path, spool: Path, bundle: Path, returned_receipts: Path, expected_source_head: str, readiness=read_readiness, run=run_git) -> str:
      if not readiness().get("quiescent"):
          raise RuntimeError("ops reconciliation requires quiescent runtime")
      for source in sorted(returned_receipts.glob("*.json")):
          receipt = json.loads(source.read_text(encoding="utf-8"))
          manifest_path = spool / "ready" / source.name
          manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
          if receipt.get("schema") != "kb.ops-promotion/v1" or receipt.get("id") != manifest.get("id") or receipt.get("sourceCommit") != manifest.get("commit"):
              raise RuntimeError("returned promotion receipt does not match its manifest")
          write_receipt_durably(spool / "receipts" / source.name, receipt)
      pending = [path for path in (spool / "ready").glob("*.json") if not (spool / "receipts" / path.name).exists()]
      if pending:
          raise RuntimeError("ops reconciliation refused with unreceipted outbox items")
      if run(repo, ["status", "--porcelain"]).stdout.strip():
          raise RuntimeError("ops reconciliation requires a clean checkout")
      head = run(repo, ["rev-parse", "HEAD"]).stdout.strip()
      if head != expected_source_head:
          raise RuntimeError("ops checkout advanced after promotion snapshot")
      run(repo, ["bundle", "verify", str(bundle)])
      run(repo, ["fetch", str(bundle), "refs/kb-reconciled/ops:refs/kb-reconciled/incoming"])
      target = run(repo, ["rev-parse", "refs/kb-reconciled/incoming"]).stdout.strip()
      anchor = run(repo, ["rev-parse", "refs/kb-outbox/spooled"]).stdout.strip()
      changed = nul_paths(run(repo, ["diff", "--name-only", "-z", head, target]).stdout)
      if any(not COORDINATION.match(path) for path in changed):
          raise RuntimeError("reconciled ref contains a non-coordination path")
      run(repo, ["branch", f"kb-before-reconcile-{head[:12]}", head])
      run(repo, ["reset", "--hard", target])
      run(repo, ["update-ref", "refs/kb-outbox/spooled", target, anchor])
      return target
  ```

  The CLI first calls `fetch_vm_outbox` into a fresh child of `--spool`; it never promotes directly from a changing remote directory. After the last successful push, fetch `origin/ops`, run `git update-ref refs/kb-reconciled/ops refs/remotes/origin/ops`, create the return bundle from exactly `refs/kb-reconciled/ops`, then delete the temporary desktop ref. Copy that bundle plus a directory containing the matching receipt JSON files to a fresh `/var/lib/kb/state/outbox/incoming/<transfer-id>/` over SSH. The VM invokes the apply CLI on those paths; only the VM-side durable receipt installation above changes `/var/lib/kb/state/outbox/receipts`. The desktop deletes no source artifacts; receipts and the backup ref make the transition auditable and recoverable. Task 12's `deploy/**` release root already includes `deploy/apply_ops_reconciliation.py`.

- [ ] Run `python -m pytest tests/test_promote_vm_outbox.py tests/test_apply_ops_reconciliation.py -q`. Then run the script against a local bare remote: disconnect/rename the remote for the first run and expect one pending item; restore it and rerun, expect one pushed ops commit and one receipt; apply the returned bundle to the isolated VM clone and verify its `ops` tree equals remote `ops`; rerun again and expect zero promotion commands for that item.

- [ ] Commit with `git add scripts/promote_vm_outbox.py deploy/apply_ops_reconciliation.py tests/test_promote_vm_outbox.py tests/test_apply_ops_reconciliation.py; git commit -m "feat(outbox): promote and reconcile bundles from desktop"`.

### Task 18: Alert on spool growth and block only new side-effecting work

Choice: degraded mode starts at 100 pending items or an oldest pending age of 15 minutes. It blocks new saves, launches, reruns, workflow launches, unlocks, and bridge claims; it permits reads, health, settlement, replies, stop-card, fleet STOP, and execution lock.

**Files**

- Create: `dashboard/server/write/outboxStatus.ts`
- Create: `dashboard/server/write/outboxStatus.test.ts`
- Create: `dashboard/server/control/admission.ts`
- Create: `dashboard/server/control/admission.test.ts`
- Modify after checkpoint re-read: `dashboard/server/http/context.ts:90-130`
- Modify after checkpoint re-read: `dashboard/server/http/surface.ts:207-270`
- Modify after checkpoint re-read: `dashboard/server/control/routes.ts:271-398,580-760`
- Modify after checkpoint re-read: `dashboard/server/control/routes.test.ts:240-380,760-920`
- Modify: `dashboard/server/write/routes.ts:90-260`
- Modify: `dashboard/server/http/surface.test.ts:820-910`

**Interfaces**

- Produces: `outboxStatus(spoolRoot: string, options?: { maxPending?: number; maxAgeMs?: number; now?: () => number }): OutboxStatus`
- Produces: `OutboxStatus = { pending: number; oldestAgeMs: number; degraded: boolean; reasons: string[] }`
- Produces: `AdmissionKind = 'new-work' | 'settlement' | 'reply' | 'stop' | 'lock' | 'read'`
- Produces: `admit(kind: AdmissionKind, status: OutboxStatus): { ok: true } | { ok: false; status: 503; reason: 'outbox-degraded' }`
- Consumes in dispatch callback: `ctx.admission('new-work')`

- [ ] Add failing policy and route tests:

  ```ts
  it('degrades on count or age and blocks only new work', () => {
    const degraded = { pending: 100, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] };
    expect(admit('new-work', degraded)).toEqual({ ok: false, status: 503, reason: 'outbox-degraded' });
    for (const kind of ['settlement', 'reply', 'stop', 'lock', 'read'] as const) expect(admit(kind, degraded)).toEqual({ ok: true });
  });
  ```

  Add this case to the existing `http/surface.test.ts` `buildApp`/signed-bearer harness:

  ```ts
  it('returns 503 before a new launch when the outbox is degraded, but still accepts STOP', async () => {
    const degraded = { pending: 100, oldestAgeMs: 1_000, degraded: true, reasons: ['pending-limit'] };
    const runPy = vi.fn(okPy);
    ({ app } = buildApp({ admission: (kind) => admit(kind, degraded), runPy }));
    const launch = await app.inject({ method: 'POST', url: '/api/write/launch', headers: headers(true), payload: { project: 'kb-ops', action: 'report:self-lint', target: 'orgs/kb-ops/output', riskTier: 'T1' } });
    expect(launch.statusCode).toBe(503);
    expect(launch.json()).toMatchObject({ error: 'outbox-degraded' });
    expect(runPy).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/api/write/stop', headers: headers(true), payload: {} })).statusCode).toBe(200);
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/write/outboxStatus.test.ts server/control/admission.test.ts server/control/routes.test.ts server/http/surface.test.ts` and verify the modules are absent and launch still reaches its runner.

- [ ] Implement status from ready manifests without reading bundles:

  ```ts
  export interface OutboxStatus { pending: number; oldestAgeMs: number; degraded: boolean; reasons: string[] }

  export function outboxStatus(
    spoolRoot: string,
    options: { maxPending?: number; maxAgeMs?: number; now?: () => number } = {},
  ): OutboxStatus {
    const maxPending = options.maxPending ?? 100;
    const maxAgeMs = options.maxAgeMs ?? 15 * 60_000;
    const now = options.now ?? Date.now;
    const manifests = readPendingManifests(spoolRoot);
    const oldestAgeMs = manifests.length === 0 ? 0 : Math.max(0, now() - Math.min(...manifests.map((item) => Date.parse(item.createdAt))));
    const reasons = [
      ...(manifests.length >= maxPending ? ['pending-limit'] : []),
      ...(oldestAgeMs >= maxAgeMs ? ['oldest-age-limit'] : []),
    ];
    return { pending: manifests.length, oldestAgeMs, degraded: reasons.length > 0, reasons };
  }
  ```

  ```ts
  export function admit(kind: AdmissionKind, status: OutboxStatus): AdmissionDecision {
    return kind === 'new-work' && status.degraded
      ? { ok: false, status: 503, reason: 'outbox-degraded' }
      : { ok: true };
  }
  ```

- [ ] Thread one `ctx.admission(kind)` function into routes. Run it before each named new-work route and immediately before the post-merge queue-bridge dispatch callback claims a card. Return the exact 503 shape on refusal. Do not reject terminal result integration, ledger settlement, operator replies, stops, locks, health, or reads.

- [ ] Run `cd dashboard; npm test -- server/write/outboxStatus.test.ts server/control/admission.test.ts server/control/routes.test.ts server/http/surface.test.ts; npm run typecheck; npm test` and verify all tests pass. Simulate 100 manifests on Ubuntu and verify reads remain 200, launch/unlock return 503, STOP remains available, and removing/promoting the backlog returns admission to normal without restart.

- [ ] Commit with `git add dashboard/server/write/outboxStatus.ts dashboard/server/write/outboxStatus.test.ts dashboard/server/control/admission.ts dashboard/server/control/admission.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/control/routes.ts dashboard/server/write/routes.ts dashboard/server/control/routes.test.ts dashboard/server/http/surface.test.ts; git commit -m "feat(control): enforce visible outbox degraded mode"`.

## G1. Gate-1 evidence assembly

### Task 19: Produce the authenticated-read and tailnet boundary evidence package

Choice: the collector writes JSON plus a human-readable Markdown index outside the repository. It verifies assertions and preserves raw command output; it does not modify Tailscale configuration.

**Files**

- Create: `scripts/gates/phase1_gate1.py`
- Create: `tests/test_phase1_gate1.py`

**Interfaces**

- Produces CLI: `python3 scripts/gates/phase1_gate1.py --base-url URL --output DIR --session-env KB_GATE_SESSION --route-report FILE --acl-authorized FILE --acl-denied FILE`
- Produces: `gate1.json`, `gate1.md`, `tailscale-serve.json`, `tailscale-funnel.json`, `route-matrix.json`
- Produces: `AclProbeResult = { role: Literal['authorized', 'denied']; endpoint: str; outcome: Literal['reached', 'connection-refused', 'timeout'] }`
- Produces: `TailnetEvidence = { serveTailnetOnly: bool; funnelDisabled: bool; aclAuthorized: bool; aclDenied: bool }`
- Produces: `derive_tailnet_evidence(serve_status_json: str, funnel_status_json: str, acl_probe_results: list[AclProbeResult]) -> TailnetEvidence`
- Consumes: `tailscale serve status --json`, `tailscale funnel status --json`, authorized session supplied only through the named process environment key

- [ ] Add a failing evidence-decision test:

  ```py
  def test_gate1_passes_only_with_auth_confinement_tailnet_and_locked_execution():
      evidence = {
          "unauthenticatedReads": {path: 401 for path in REQUIRED_UNAUTH},
          "authenticatedReads": {path: 200 for path in REQUIRED_UNAUTH},
          "websocket": {"unauthenticated": 401, "authenticated": 101},
          "health": {"/healthz": 200, "/readyz": 200},
          "routeInventoryCovered": True,
          "confined": True,
          "serveTailnetOnly": True,
          "funnelDisabled": True,
          "aclAuthorized": True,
          "aclDenied": True,
          "executionLocked": True,
      }
      assert decide(evidence) == {"passed": True, "failures": []}
      evidence["funnelDisabled"] = False
      assert decide(evidence)["passed"] is False
  ```

- [ ] Add failing parser tests with documented `tailscale serve status --json` / `tailscale funnel status --json` fixtures:

  ```py
  PASSING_SERVE = json.dumps({
      "TCP": {"443": {"HTTPS": True}},
      "Web": {"kb.example.ts.net:443": {"Handlers": {
          "/": {"Proxy": "http://127.0.0.1:4317"},
      }}},
  })
  PASSING_FUNNEL = json.dumps({"AllowFunnel": {}})
  ACL_PROBES = [
      AclProbeResult(role="authorized", endpoint="https://kb.example.ts.net:4317", outcome="reached"),
      AclProbeResult(role="denied", endpoint="https://kb.example.ts.net:4317", outcome="connection-refused"),
  ]


  def test_derive_tailnet_evidence_accepts_loopback_serve_no_funnel_and_acl_probes():
      assert derive_tailnet_evidence(PASSING_SERVE, PASSING_FUNNEL, ACL_PROBES) == {
          "serveTailnetOnly": True, "funnelDisabled": True,
          "aclAuthorized": True, "aclDenied": True,
      }


  @pytest.mark.parametrize("serve, funnel, expected", [
      (json.dumps({"Web": {"kb.example.ts.net:443": {"Handlers": {"/": {"Proxy": "http://10.0.0.8:4317"}}}}}), PASSING_FUNNEL, {"serveTailnetOnly": False, "funnelDisabled": True}),
      (PASSING_SERVE, json.dumps({"AllowFunnel": {"kb.example.ts.net:443": True}}), {"serveTailnetOnly": True, "funnelDisabled": False}),
  ])
  def test_derive_tailnet_evidence_rejects_non_loopback_proxy_or_public_funnel(serve, funnel, expected):
      evidence = derive_tailnet_evidence(serve, funnel, ACL_PROBES)
      assert {key: evidence[key] for key in expected} == expected
  ```

- [ ] Run `python -m pytest tests/test_phase1_gate1.py -q` and verify the module is absent.

- [ ] Implement a closed decision function and evidence writer:

  ```py
  REQUIRED_UNAUTH = ("/api/kb/tree", "/api/registry", "/api/index", "/api/dag", "/api/routing", "/api/agents", "/api/panels/health", "/api/panels/usage", "/api/workflows", "/events")


  def decide(evidence: dict) -> dict:
      failures = []
      if any(evidence["unauthenticatedReads"].get(path) != 401 for path in REQUIRED_UNAUTH): failures.append("non-health read bypassed session auth")
      if any(evidence["authenticatedReads"].get(path) != 200 for path in REQUIRED_UNAUTH): failures.append("authenticated read failed")
      if evidence.get("websocket") != {"unauthenticated": 401, "authenticated": 101}: failures.append("websocket session auth failed")
      if evidence["health"] != {"/healthz": 200, "/readyz": 200}: failures.append("health bootstrap failed")
      for key in ("routeInventoryCovered", "confined", "serveTailnetOnly", "funnelDisabled", "aclAuthorized", "aclDenied", "executionLocked"):
          if evidence.get(key) is not True: failures.append(key)
      return {"passed": not failures, "failures": failures}


  @dataclass(frozen=True)
  class AclProbeResult:
      role: Literal["authorized", "denied"]
      endpoint: str
      outcome: Literal["reached", "connection-refused", "timeout"]


  class TailnetEvidence(TypedDict):
      serveTailnetOnly: bool
      funnelDisabled: bool
      aclAuthorized: bool
      aclDenied: bool


  def _serve_handler_proxies(config: dict) -> list[str] | None:
      # Serve status includes the local config plus any named Tailscale Services.
      scopes = [config, *config.get("Services", {}).values()]
      proxies: list[str] = []
      for scope in scopes:
          if not isinstance(scope, dict) or not isinstance(scope.get("Web", {}), dict): return None
          for web_server in scope["Web"].values():
              handlers = web_server.get("Handlers", {}) if isinstance(web_server, dict) else {}
              if not isinstance(handlers, dict): return None
              for handler in handlers.values():
                  proxy = handler.get("Proxy") if isinstance(handler, dict) else None
                  if not isinstance(proxy, str): return None
                  proxies.append(proxy)
      return proxies


  def _is_loopback_proxy(proxy: str) -> bool:
      parsed = urlsplit(proxy)
      if parsed.scheme not in {"http", "https"} or not parsed.hostname: return False
      if parsed.hostname.lower() == "localhost": return True
      try: return ipaddress.ip_address(parsed.hostname).is_loopback
      except ValueError: return False


  def _funnel_entries(config: dict) -> list[str] | None:
      scopes = [config, *config.get("Services", {}).values()]
      entries: list[str] = []
      for scope in scopes:
          if not isinstance(scope, dict): return None
          allowed = scope.get("AllowFunnel", {})
          if not isinstance(allowed, dict): return None
          entries.extend(allowed)
      return entries


  def derive_tailnet_evidence(serve_status_json: str, funnel_status_json: str, acl_probe_results: list[AclProbeResult]) -> TailnetEvidence:
      try:
          serve, funnel = json.loads(serve_status_json), json.loads(funnel_status_json)
      except json.JSONDecodeError:
          return {"serveTailnetOnly": False, "funnelDisabled": False, "aclAuthorized": False, "aclDenied": False}
      proxies = _serve_handler_proxies(serve) if isinstance(serve, dict) else None
      serve_funnel_entries = _funnel_entries(serve) if isinstance(serve, dict) else None
      funnel_entries = _funnel_entries(funnel) if isinstance(funnel, dict) else None
      authorized = [probe for probe in acl_probe_results if probe.role == "authorized"]
      denied = [probe for probe in acl_probe_results if probe.role == "denied"]
      return {
          "serveTailnetOnly": bool(proxies) and all(_is_loopback_proxy(proxy) for proxy in proxies),
          "funnelDisabled": serve_funnel_entries == [] and funnel_entries == [],
          "aclAuthorized": any(probe.endpoint.endswith(":4317") and probe.outcome == "reached" for probe in authorized),
          "aclDenied": any(probe.endpoint.endswith(":4317") and probe.outcome in {"connection-refused", "timeout"} for probe in denied),
      }


  def write_package(output: Path, evidence: dict, raw: dict[str, str]) -> int:
      output.mkdir(parents=True, exist_ok=False)
      decision = decide(evidence)
      (output / "gate1.json").write_text(json.dumps({"gate": 1, "decision": decision, "evidence": evidence}, indent=2) + "\n", encoding="utf-8")
      for name, value in raw.items(): (output / name).write_text(value, encoding="utf-8")
      rows = ["# Phase I Gate 1", "", f"Decision: {'PASS' if decision['passed'] else 'FAIL'}", "", "## Failures", ""] + [f"- {item}" for item in decision["failures"]]
      (output / "gate1.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
      return 0 if decision["passed"] else 1
  ```

  Import `dataclass`, `Literal`, `TypedDict`, `ipaddress`, and `urlsplit` for the shown types and parser. The HTTP probe sends no token first, then an `Authorization: Bearer` header whose value comes from the named environment key; it never writes the value to output. The route report is Vitest JSON from Task 14's complete route-matrix plus SSE/WebSocket tests; set `routeInventoryCovered` only when all named files and tests passed. Run `tailscale serve status --json` and `tailscale funnel status --json`, retain their raw output, parse them with `derive_tailnet_evidence`, and merge its four returned booleans into `evidence` before `decide(evidence)`. The parser accepts only documented `Web`/`Handlers`/`Proxy` Serve handlers whose targets are loopback and rejects every `AllowFunnel` entry from either status as a public listener. Parse the two operator-captured probe files into `AclProbeResult` rows, requiring an authorized `:4317` reach and a denied `:4317` connection refusal or timeout.

- [ ] Run `python -m pytest tests/test_phase1_gate1.py -q` and verify the collector tests pass.

- [ ] Commit with `git add scripts/gates/phase1_gate1.py tests/test_phase1_gate1.py; git commit -m "test(gate): assemble phase one boundary evidence"`.

- [ ] After Tasks 1-19 have merged to `main`, deploy that exact immutable artifact from the desktop while the VM is locked and quiescent: `$releaseSha = git rev-parse origin/main; New-Item -ItemType Directory -Force "artifacts/$releaseSha" | Out-Null; gh run download --name "kb-platform-$releaseSha" --dir "artifacts/$releaseSha"; python scripts/deploy_platform_release.py "artifacts/$releaseSha/kb-platform-$releaseSha.tar.gz" "artifacts/$releaseSha/kb-platform-$releaseSha.tar.gz.sha256" --host $env:KB_VM_HOST`. Verify `/opt/kb-releases/current/VERSION` equals `$releaseSha` before probing.

- [ ] Run `python -m pytest tests/test_phase1_gate1.py -q`; on Ubuntu before production pruning, run `cd dashboard; npm test -- --reporter=json --outputFile=/var/lib/kb/gates/phase1/read-auth-vitest.json server/index.test.ts server/http/middleware.test.ts server/hub/sse.test.ts server/hub/ws.test.ts server/kb/routes.test.ts`. From one ACL-authorized tailnet client save `curl -fsS "$KB_TAILNET_URL/healthz"` output as `/var/lib/kb/gates/phase1/acl-authorized.txt`; from one ACL-denied client save the failed connection transcript as `/var/lib/kb/gates/phase1/acl-denied.txt`. On the staging VM run `gate_id=$(date -u +%Y%m%dT%H%M%SZ); python3 /opt/kb-releases/current/scripts/gates/phase1_gate1.py --base-url "$KB_TAILNET_URL" --output "/var/lib/kb/gates/phase1/gate1-$gate_id" --session-env KB_GATE_SESSION --route-report /var/lib/kb/gates/phase1/read-auth-vitest.json --acl-authorized /var/lib/kb/gates/phase1/acl-authorized.txt --acl-denied /var/lib/kb/gates/phase1/acl-denied.txt`; verify exit 0, then inspect the generated `gate1.md` and confirm it shows `PASS` while `/readyz` still reports execution locked.

- [ ] Present the complete generated directory to Daniel. Record approval outside the repository as `APPROVED.txt` in that directory; do not arm execution in this task.

## F2. Gate-2 runtime hardening

### Task 20: Disable Windows-only PTY, runner, and Vibe surfaces on Linux

Choice: Phase I does not port the interactive PTY or Task Scheduler runner, and it does not expose the separate Composer/Vibe subprocess surface from the VM identity. Linux reports all three as disabled, never constructs `powershell.exe`, never invokes `schtasks.exe`, and never spawns a Composer `claude` child; governed dashboard bridge execution remains available.

**Files**

- Create: `dashboard/server/runtime/capabilities.ts`
- Create: `dashboard/server/runtime/capabilities.test.ts`
- Modify: `dashboard/server/index.ts:118-166`
- Modify: `dashboard/server/index.test.ts:1-85`
- Modify: `dashboard/server/http/context.ts:70-130`
- Modify: `dashboard/server/http/surface.ts:109-205`
- Modify: `dashboard/server/http/surface.test.ts:820-875`
- Modify: `dashboard/server/composer/routes.ts:190-340`
- Modify: `dashboard/server/composer/routes.test.ts:180-250`
- Modify: `dashboard/server/runner/trigger.test.ts:1-40`
- Modify: `dashboard/server/runner/liveness.test.ts:1-86`
- Modify: `dashboard/src/views/Terminal.tsx:1-120`
- Modify: `dashboard/src/views/Terminal.test.tsx:440-510`

**Interfaces**

- Produces: `RuntimeCapabilities = { platform: NodeJS.Platform; python: { command: string; prefixArgs: readonly string[] }; pty: boolean; runnerTrigger: boolean; vibe: boolean; dashboardBridge: true }`
- Produces: `runtimeCapabilities(platform?: NodeJS.Platform): RuntimeCapabilities`
- Produces authenticated route: `GET /api/runtime/capabilities`
- Changes: `SurfaceContext.runtimeCapabilities: RuntimeCapabilities`
- Produces: `SurfaceActivationSeam.createPtyHost?: typeof createPtyHost`

- [ ] Add failing capability and registration tests:

  ```ts
  it('disables PTY and Task Scheduler on Linux while retaining the bridge', () => {
    expect(runtimeCapabilities('linux')).toEqual({ platform: 'linux', python: { command: 'python3', prefixArgs: [] }, pty: false, runnerTrigger: false, vibe: false, dashboardBridge: true });
  });

  it('does not construct the PTY host on Linux', async () => {
    const createPty = vi.fn(() => { throw new Error('must not construct'); });
    const ctx = makeSurfaceContext({ runtimeCapabilities: runtimeCapabilities('linux') }, { createPtyHost: createPty });
    expect(createPty).not.toHaveBeenCalled();
    expect(ctx.ptyHost).toBeUndefined();
  });

  it('refuses a Linux Composer turn before constructing a Vibe child', async () => {
    const spawn = vi.fn(() => { throw new Error('must not spawn'); });
    ({ app } = buildApp({ runtimeCapabilities: runtimeCapabilities('linux'), spawn }));
    const response = await app.inject({ method: 'POST', url: '/api/composer/sessions/any/turns', headers: headers(true), payload: { prompt: 'hello' } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'capability-unavailable', capability: 'vibe' });
    expect(spawn).not.toHaveBeenCalled();
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/runtime/capabilities.test.ts server/index.test.ts server/http/surface.test.ts server/composer/routes.test.ts server/runner/trigger.test.ts server/runner/liveness.test.ts src/views/Terminal.test.tsx` and verify the capability module is absent and Linux app construction reaches the PowerShell PTY path.

- [ ] Implement capabilities from the single Python resolver:

  ```ts
  import { resolvePython } from './python.ts';

  export interface RuntimeCapabilities {
    platform: NodeJS.Platform;
    python: ReturnType<typeof resolvePython>;
    pty: boolean;
    runnerTrigger: boolean;
    vibe: boolean;
    dashboardBridge: true;
  }

  export function runtimeCapabilities(platform: NodeJS.Platform = process.platform): RuntimeCapabilities {
    const windows = platform === 'win32';
    return { platform, python: resolvePython(platform), pty: windows, runnerTrigger: windows, vibe: windows, dashboardBridge: true };
  }
  ```

- [ ] Resolve capabilities once in `makeSurfaceContext`, store them on `SurfaceContext`, and create the fleet-gated PTY only when enabled:

  ```ts
  const capabilities = overrides.runtimeCapabilities ?? runtimeCapabilities();
  const underlyingPtyHost = capabilities.pty
    ? (overrides.ptyHost ?? (activation.createPtyHost ?? createPtyHost)({ shell: 'powershell.exe' }))
    : undefined;
  const ptyHost = underlyingPtyHost
    ? fleetGatedPtyHost(underlyingPtyHost, repoRoot, overrides.runPreamble ?? defaultPreambleRunner)
    : undefined;
  ```

  Register `/api/runtime/capabilities` inside the authenticated read scope and register PTY routes only when `capabilities.pty` is true. At the top of the authenticated Composer-turn handler, before acquiring a writer or calling `spawnComposerTurn`, return `503 { error: 'capability-unavailable', capability: 'vibe' }` when `ctx.runtimeCapabilities.vibe` is false. Retain the existing non-Windows `unavailable` result in `triggerRunner` and `ownerLiveness`; pin it with tests. Render a calm “Terminal is disabled on this host” message when the UI capability is false.

- [ ] Run `cd dashboard; npm test -- server/runtime/capabilities.test.ts server/index.test.ts server/http/surface.test.ts server/composer/routes.test.ts server/runner/trigger.test.ts server/runner/liveness.test.ts src/views/Terminal.test.tsx; npm run typecheck; npm test` and verify all tests pass on Windows and Ubuntu. On Ubuntu, submit an authenticated Composer turn and require the explicit 503, then run `main_pid=$(systemctl show -p MainPID --value kb-dashboard); tr '\0' '\n' < "/proc/$main_pid/cmdline" | rg "powershell\.exe|schtasks\.exe"` and verify `rg` exits 1; use `pgrep -a -P "$main_pid"` and verify no `claude --print --output-format stream-json` child exists.

- [ ] Commit with `git add dashboard/server/runtime/capabilities.ts dashboard/server/runtime/capabilities.test.ts dashboard/server/index.ts dashboard/server/index.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/http/surface.test.ts dashboard/server/composer/routes.ts dashboard/server/composer/routes.test.ts dashboard/server/runner/trigger.test.ts dashboard/server/runner/liveness.test.ts dashboard/src/views/Terminal.tsx dashboard/src/views/Terminal.test.tsx; git commit -m "fix(runtime): disable unsafe VM subprocess surfaces"`.

### Task 21: Drain all worker processes before shutdown

Choice: shutdown stops new bridge dispatch first, sends every registered worker its existing cancellation signal, waits up to 60 seconds for deregistration, then drains broker/Composer/git/PTY. systemd's 90-second stop window leaves a 30-second safety margin before control-group termination.

**Files**

- Modify after checkpoint re-read: `dashboard/server/control/managedExecution.ts:26-52`
- Modify: `dashboard/server/control/managedExecution.test.ts:1-158`
- Modify: `dashboard/server/control/codexExecAdapter.ts:97-112,205-310`
- Modify: `dashboard/server/control/codexExecAdapter.test.ts:120-260`
- Modify after checkpoint re-read: `dashboard/server/control/activation.ts:167-262,414-570`
- Modify after checkpoint re-read: `dashboard/server/control/activation.test.ts:32-180,500-580`
- Modify: `dashboard/server/http/context.ts:90-130`
- Modify after checkpoint re-read: `dashboard/server/http/surface.ts:275-287`
- Modify: `dashboard/server/http/surface.test.ts:820-910`

**Interfaces**

- Changes: `WorkerCancellationRegistry.activeCount(): number`
- Changes: `WorkerCancellationRegistry.drain(timeoutMs: number): Promise<{ drained: boolean; remaining: string[] }>`
- Produces: `DrainResult = { drained: boolean; remaining: string[] }`
- Changes: `CodexExecAdapterOptions.registerCancellation?: (operationKey: string, cancel: () => void) => void`
- Changes: `CodexExecAdapterOptions.deregisterCancellation?: (operationKey: string) => void`
- Produces: `ActivatedExecution.drainWorkers(timeoutMs?: number): Promise<DrainResult>`
- Produces: `ActivatedExecution.activeWorkers(): number`

- [ ] Add failing drain and Codex registration tests:

  ```ts
  it('cancels every worker and resolves only after all deregister', async () => {
    const registry = createWorkerCancellationRegistry();
    const cancelled: string[] = [];
    registry.register('a', () => { cancelled.push('a'); registry.clear('a'); });
    registry.register('b', () => { cancelled.push('b'); registry.clear('b'); });
    await expect(registry.drain(100)).resolves.toEqual({ drained: true, remaining: [] });
    expect(cancelled.sort()).toEqual(['a', 'b']);
    expect(registry.activeCount()).toBe(0);
  });

  it('returns remaining operation keys at the timeout', async () => {
    vi.useFakeTimers();
    const registry = createWorkerCancellationRegistry();
    registry.register('stuck', () => undefined);
    const pending = registry.drain(50); await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual({ drained: false, remaining: ['stuck'] });
    vi.useRealTimers();
  });
  ```

  ```ts
  it('registers the Codex child kill and always deregisters after exit', async () => {
    const register = vi.fn(); const clear = vi.fn(); const fake = fakeProcess();
    const adapter = createCodexExecAdapter({ spawner: () => fake.proc, registerCancellation: register, deregisterCancellation: clear });
    const pending = adapter.execute(executeInput({ attemptRef: 'attempt-7' }));
    expect(register).toHaveBeenCalledWith('automatic-attempt:attempt-7', expect.any(Function));
    fake.emitExit(1); await pending;
    expect(clear).toHaveBeenCalledWith('automatic-attempt:attempt-7');
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/control/managedExecution.test.ts server/control/codexExecAdapter.test.ts server/control/activation.test.ts server/http/surface.test.ts` and verify the new methods/options are absent.

- [ ] Extend the registry with waiter notification:

  ```ts
  export interface WorkerCancellationRegistry {
    register(operationKey: string, cancel: () => void): void;
    cancel(operationKey: string): void;
    clear(operationKey: string): void;
    activeCount(): number;
    drain(timeoutMs: number): Promise<{ drained: boolean; remaining: string[] }>;
  }

  export function createWorkerCancellationRegistry(): WorkerCancellationRegistry {
    const cancels = new Map<string, () => void>();
    const waiters = new Set<() => void>();
    const notify = () => { if (cancels.size === 0) for (const waiter of [...waiters]) waiter(); };
    return {
      register(key, cancel) { cancels.set(key, cancel); },
      cancel(key) { cancels.get(key)?.(); },
      clear(key) { cancels.delete(key); notify(); },
      activeCount() { return cancels.size; },
      async drain(timeoutMs) {
        for (const cancel of [...cancels.values()]) cancel();
        if (cancels.size === 0) return { drained: true, remaining: [] };
        let timer: NodeJS.Timeout | undefined;
        let waiter: (() => void) | undefined;
        await Promise.race([
          new Promise<void>((resolve) => { waiter = resolve; waiters.add(resolve); }),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
        ]);
        if (timer) clearTimeout(timer);
        if (waiter) waiters.delete(waiter);
        return { drained: cancels.size === 0, remaining: [...cancels.keys()].sort() };
      },
    };
  }
  ```

- [ ] Register the Codex process kill immediately after spawn and clear it in the one settle/finally path. Pass the same registry seams to both post-merge Claude and Codex adapters in `activation.ts`; expose `drainWorkers` and `activeWorkers`. Do not edit `claudeWorkerAdapter.ts`.

- [ ] Make the surface `preClose` hook `async`: stop and clear the bridge; `await ctx.drainWorkers?.(60_000)`; then invoke the existing broker, vibe, and git drains. Feed `activeWorkers()` into Task 11 readiness. Run `cd dashboard; npm test -- server/control/managedExecution.test.ts server/control/codexExecAdapter.test.ts server/control/activation.test.ts server/http/surface.test.ts; npm run typecheck; npm test` and verify all tests pass.

- [ ] Commit with `git add dashboard/server/control/managedExecution.ts dashboard/server/control/managedExecution.test.ts dashboard/server/control/codexExecAdapter.ts dashboard/server/control/codexExecAdapter.test.ts dashboard/server/control/activation.ts dashboard/server/control/activation.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/http/surface.test.ts; git commit -m "fix(control): drain workers before daemon shutdown"`.

### Task 22: Enforce per-resource-class concurrency limits

Choice: Phase I limits control transitions to 4, general agent workers to 2, render workers to 1, live PTYs to 4, and ops-checkout Git transactions to 1. Limits are configurable by validated positive integers, but zero/unbounded is refused.

**Files**

- Create: `dashboard/server/control/resourceLimits.ts`
- Create: `dashboard/server/control/resourceLimits.test.ts`
- Modify after checkpoint re-read: `dashboard/server/control/activation.ts:225-262,328-576`
- Modify after checkpoint re-read: `dashboard/server/control/activation.test.ts:128-220,500-580`
- Modify: `dashboard/server/write/asyncGit.ts:25-63`
- Modify: `dashboard/server/write/asyncGit.test.ts:1-107`
- Modify: `dashboard/server/http/context.ts:90-130`
- Modify: `dashboard/server/http/surface.ts:120-205`
- Modify: `dashboard/server/pty/route.ts:80-85,338-412,699-704`
- Modify: `dashboard/server/pty/route.test.ts:760-850`

**Interfaces**

- Produces: `ResourceClass = 'control' | 'agents' | 'render' | 'pty' | 'git'`
- Produces: `ResourceLimiter.run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T>`
- Produces: `ResourceLimiter.snapshot(): Record<ResourceClass, { limit: number; active: number; queued: number }>`
- Produces: `ResourceLimiter.observePty(active: number): void`
- Produces: `createResourceLimiter(limits?: Partial<Record<ResourceClass, number>>): ResourceLimiter`
- Produces: `runtimeResourceLimiter: ResourceLimiter`
- Produces: `limitWorkerAdapter(adapter: WorkerAdapter, limiter: ResourceLimiter): WorkerAdapter`

- [ ] Add a failing FIFO/isolation test:

  ```ts
  it('limits each resource independently and exposes saturation', async () => {
    const limiter = createResourceLimiter({ control: 2, agents: 1, render: 1, pty: 1, git: 1 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = limiter.run('agents', () => held);
    const secondStarted = vi.fn();
    const second = limiter.run('agents', async () => { secondStarted(); });
    await Promise.resolve();
    expect(secondStarted).not.toHaveBeenCalled();
    expect(limiter.snapshot().agents).toEqual({ limit: 1, active: 1, queued: 1 });
    expect(limiter.snapshot().render).toEqual({ limit: 1, active: 0, queued: 0 });
    await limiter.run('control', async () => undefined);
    release(); await Promise.all([first, second]);
    expect(secondStarted).toHaveBeenCalledOnce();
  });

  it('routes render work separately from general agents', async () => {
    const kinds: ResourceClass[] = [];
    const limiter = { run: async (kind: ResourceClass, operation: () => Promise<unknown>) => { kinds.push(kind); return operation(); }, snapshot: () => ({}) } as unknown as ResourceLimiter;
    const adapter = { execute: vi.fn().mockResolvedValue({ state: 'succeeded', summary: 'ok', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [] }) } as WorkerAdapter;
    const limited = limitWorkerAdapter(adapter, limiter);
    await limited.execute({ action: 'build:render' } as never);
    await limited.execute({ action: 'report:self-lint' } as never);
    expect(kinds).toEqual(['render', 'agents']);
  });

  it('sets the live PTY resource ceiling to four', () => {
    expect(MAX_CONCURRENT_PTY).toBe(4);
  });
  ```

- [ ] Add this failing transaction regression test to `asyncGit.test.ts` before swapping the FIFO implementation:

  ```ts
  it('keeps Git single-concurrent while a nested transaction re-enters without deadlocking', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = withOpsTransaction(async () => {
      events.push('first:start');
      await withOpsTransaction(async () => { events.push('first:nested'); });
      await firstMayFinish;
      events.push('first:end');
    });
    const second = withOpsTransaction(async () => { events.push('second:start'); });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['first:start', 'first:nested']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:nested', 'first:end', 'second:start']);
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/control/resourceLimits.test.ts server/write/asyncGit.test.ts server/control/activation.test.ts` and verify the module is absent.

- [ ] Implement a FIFO semaphore per resource class:

  ```ts
  export type ResourceClass = 'control' | 'agents' | 'render' | 'pty' | 'git';
  export type ResourceSnapshot = Record<ResourceClass, { limit: number; active: number; queued: number }>;
  export interface ResourceLimiter {
    run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T>;
    observePty(active: number): void;
    snapshot(): ResourceSnapshot;
  }
  const DEFAULTS: Record<ResourceClass, number> = { control: 4, agents: 2, render: 1, pty: 4, git: 1 };

  export function createResourceLimiter(overrides: Partial<Record<ResourceClass, number>> = {}): ResourceLimiter {
    const limits = { ...DEFAULTS, ...overrides };
    for (const [kind, value] of Object.entries(limits)) if (!Number.isInteger(value) || value < 1) throw new Error(`${kind} concurrency must be a positive integer`);
    const state = Object.fromEntries(Object.keys(limits).map((kind) => [kind, { active: 0, queue: [] as Array<() => void> }])) as Record<ResourceClass, { active: number; queue: Array<() => void> }>;
    async function run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T> {
      const slot = state[kind];
      if (slot.active >= limits[kind]) await new Promise<void>((resolve) => slot.queue.push(resolve));
      slot.active += 1;
      try { return await operation(); }
      finally { slot.active -= 1; slot.queue.shift()?.(); }
    }
    return {
      run,
      observePty(active) { if (!Number.isInteger(active) || active < 0) throw new Error('PTY active count must be a non-negative integer'); state.pty.active = active; },
      snapshot: () => Object.fromEntries((Object.keys(limits) as ResourceClass[]).map((kind) => [kind, { limit: limits[kind], active: state[kind].active, queued: state[kind].queue.length }])) as ResourceSnapshot,
    };
  }

  export const runtimeResourceLimiter = createResourceLimiter();

  export function limitWorkerAdapter(adapter: WorkerAdapter, limiter: ResourceLimiter): WorkerAdapter {
    return { execute: (input) => limiter.run(/(?:^|:)render(?:$|:)/.test(input.action) ? 'render' : 'agents', () => adapter.execute(input)) };
  }
  ```

- [ ] Inject `runtimeResourceLimiter` into the surface context. Wrap both worker adapters without changing them, wrap each activated `runAutomatic` call in `control`, and replace the private Git FIFO's acquire/release with `runtimeResourceLimiter.run('git', ...)` while preserving `AsyncLocalStorage` reentrancy. Pass `runtimeResourceLimiter.snapshot().pty.limit` as the existing `PtyRouteContext.maxConcurrent`, and call `runtimeResourceLimiter.observePty(registry.liveCount())` before readiness/operational snapshots. Tests inject a fresh limiter; production uses the singleton so telemetry observes every class.

- [ ] Add a worker-wrapper test proving `build:render` queues under `render` while `report:self-lint` consumes `agents`, and retain the existing PTY `too-many-terminals` assertion with the new default 4. Run `cd dashboard; npm test -- server/control/resourceLimits.test.ts server/write/asyncGit.test.ts server/control/activation.test.ts server/pty/route.test.ts; npm run typecheck; npm test` and verify all tests pass. Run the same suite on Ubuntu.

- [ ] Commit with `git add dashboard/server/control/resourceLimits.ts dashboard/server/control/resourceLimits.test.ts dashboard/server/control/activation.ts dashboard/server/control/activation.test.ts dashboard/server/write/asyncGit.ts dashboard/server/write/asyncGit.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/pty/route.ts dashboard/server/pty/route.test.ts; git commit -m "feat(control): bound runtime resource concurrency"`.

### Task 23: Expose live operational telemetry in Sentinel

Choice: a single authenticated snapshot powers the panel. A wrapper appends a redacted `meta` heartbeat to the existing attempt-I/O store every 15 seconds while any worker adapter is executing; queue age is measured from `createdAt`, and failure rate covers terminal attempts in the last 24 hours.

**Files**

- Create: `dashboard/server/operations/snapshot.ts`
- Create: `dashboard/server/operations/snapshot.test.ts`
- Create: `dashboard/server/operations/heartbeat.ts`
- Create: `dashboard/server/operations/heartbeat.test.ts`
- Create: `dashboard/server/operations/routes.ts`
- Create: `dashboard/server/operations/routes.test.ts`
- Modify after checkpoint re-read: `dashboard/server/control/activation.ts:225-262,328-576`
- Modify after checkpoint re-read: `dashboard/server/control/activation.test.ts:128-220,500-580`
- Modify: `dashboard/server/index.ts:95-124`
- Modify: `dashboard/src/views/panels/Sentinel.tsx:13-165`
- Modify: `dashboard/src/views/panels/Sentinel.test.tsx:33-125`
- Modify: `dashboard/src/styles/views/panels.css:1-205`

**Interfaces**

- Produces: `OperationalSnapshot = { asOf: string; attempts: AttemptSignal[]; resources: ReturnType<ResourceLimiter['snapshot']>; outbox: OutboxStatus; failureRate24h: number }`
- Produces: `heartbeatWorkerAdapter(adapter: WorkerAdapter, attemptIo: AttemptIoSink, intervalMs?: number): WorkerAdapter`
- Produces: `buildOperationalSnapshot(store: ControlPlaneStore, subject: string, attemptIo: AttemptIoStore, resources: ResourceLimiter, outbox: OutboxStatus, now?: () => Date): OperationalSnapshot`
- Produces authenticated route: `GET /api/operations`

- [ ] Add a failing snapshot/UI test:

  ```ts
  import type { ControlPlaneStore } from '../control/store.ts';
  import type { ResourceLimiter } from '../control/resourceLimits.ts';
  import type { AttemptIoStore } from '../control/attemptIo.ts';

  const DETAIL = {
    run: { runRef: 'run-1' },
    stages: [
      { stageRef: 'stage-1', assignment: { profileId: 'worker:codex' } },
      { stageRef: 'stage-2', assignment: { profileId: 'worker:claude' } },
      { stageRef: 'stage-3', assignment: { profileId: 'worker:claude' } },
    ],
    attempts: [
      { attemptRef: 'attempt-1', runRef: 'run-1', stageRef: 'stage-1', runtime: 'codex', model: 'gpt-5.6-sol', state: 'queued', createdAt: '2026-08-11T11:59:00.000Z', updatedAt: '2026-08-11T11:59:00.000Z' },
      { attemptRef: 'attempt-2', runRef: 'run-1', stageRef: 'stage-2', runtime: 'claude', model: 'sonnet', state: 'failed', createdAt: '2026-08-11T11:57:00.000Z', updatedAt: '2026-08-11T11:58:00.000Z' },
      { attemptRef: 'attempt-3', runRef: 'run-1', stageRef: 'stage-3', runtime: 'claude', model: 'sonnet', state: 'succeeded', createdAt: '2026-08-11T11:55:00.000Z', updatedAt: '2026-08-11T11:56:00.000Z' },
    ],
  } as never;
  const STORE_WITH_ATTEMPTS = { listRuns: () => [{ runRef: 'run-1' }], getRun: () => ({ ok: true, value: DETAIL }) } as ControlPlaneStore;
  const ATTEMPT_IO = { read: (attemptRef: string) => attemptRef === 'attempt-1' ? [{ seq: 1, t: '2026-08-11T11:59:30.000Z', dir: 'meta', line: 'heartbeat' }] : [] } as unknown as AttemptIoStore;
  const LIMITER = { snapshot: () => ({ control: { limit: 4, active: 1, queued: 0 }, agents: { limit: 2, active: 2, queued: 1 }, render: { limit: 1, active: 1, queued: 0 }, pty: { limit: 4, active: 0, queued: 0 }, git: { limit: 1, active: 0, queued: 0 } }) } as unknown as ResourceLimiter;
  const OUTBOX = { pending: 100, oldestAgeMs: 900_000, degraded: true, reasons: ['pending-limit'] };

  it('reports heartbeat, queue age, worker identity, saturation, outcome, and failure rate', () => {
    const snapshot = buildOperationalSnapshot(STORE_WITH_ATTEMPTS, 'operator', ATTEMPT_IO, LIMITER, OUTBOX, () => new Date('2026-08-11T12:00:00Z'));
    expect(snapshot.attempts[0]).toMatchObject({ attemptRef: 'attempt-1', worker: 'worker:codex', heartbeatAt: '2026-08-11T11:59:30.000Z', queueAgeMs: 60_000, outcome: null });
    expect(snapshot.attempts[1]).toMatchObject({ attemptRef: 'attempt-2', outcome: 'failed' });
    expect(snapshot.resources.agents).toEqual({ limit: 2, active: 2, queued: 1 });
    expect(snapshot.failureRate24h).toBe(0.5);
    expect(snapshot.outbox.degraded).toBe(true);
  });
  ```

  ```ts
  it('emits periodic heartbeats and clears the timer after execution', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    const append = vi.fn();
    const result = { state: 'succeeded', summary: 'ok', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [] } as const;
    const adapter = heartbeatWorkerAdapter({ execute: async () => { await held; return result; } } as WorkerAdapter, { append }, 15_000);
    const pending = adapter.execute({ attemptRef: 'attempt-1' } as never);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(append).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenLastCalledWith('attempt-1', 'meta', 'heartbeat');
    finish(); await pending; await vi.advanceTimersByTimeAsync(15_000);
    expect(append).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  ```

  ```tsx
  import type { OperationalSnapshot } from '../../../server/operations/snapshot';

  function renderSentinel(panel: HealthPanel, stored?: string, operations?: OperationalSnapshot): void {
    if (stored) persistSession({ token: stored, expiresAt: Date.now() + 60_000 });
    render(<SessionProvider><Sentinel panel={panel} operations={operations} /></SessionProvider>);
  }

  const OPERATIONS: OperationalSnapshot = {
    asOf: '2026-08-11T12:00:00.000Z',
    attempts: [{ attemptRef: 'attempt-2', runRef: 'run-1', state: 'failed', outcome: 'failed', worker: 'worker:codex', heartbeatAt: '2026-08-11T11:58:00.000Z', queueAgeMs: 60_000 }],
    resources: { control: { limit: 4, active: 1, queued: 0 }, agents: { limit: 2, active: 2, queued: 1 }, render: { limit: 1, active: 1, queued: 0 }, pty: { limit: 4, active: 0, queued: 0 }, git: { limit: 1, active: 0, queued: 0 } },
    outbox: { pending: 100, oldestAgeMs: 900_000, degraded: true, reasons: ['pending-limit'] },
    failureRate24h: 0.5,
  };

  it('renders saturation, outbox alert, queue age, worker and outcome', async () => {
    renderSentinel(PANEL, 'session-token', OPERATIONS);
    expect(await screen.findByText('Outbox degraded')).toBeTruthy();
    expect(screen.getByText('2 / 2 agents')).toBeTruthy();
    expect(screen.getByText('worker:codex')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/operations/heartbeat.test.ts server/operations/snapshot.test.ts server/operations/routes.test.ts src/views/panels/Sentinel.test.tsx` and verify the modules and UI section are absent.

- [ ] Implement the adapter wrapper and apply it to both post-merge worker adapters in `activation.ts` before the Task 22 resource wrapper; do not edit `claudeWorkerAdapter.ts`:

  ```ts
  export function heartbeatWorkerAdapter(adapter: WorkerAdapter, attemptIo: AttemptIoSink, intervalMs = 15_000): WorkerAdapter {
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error('heartbeat interval must be positive');
    return {
      async execute(input) {
        const timer = setInterval(() => attemptIo.append(input.attemptRef, 'meta', 'heartbeat'), intervalMs);
        timer.unref?.();
        try { return await adapter.execute(input); }
        finally { clearInterval(timer); }
      },
    };
  }
  ```

- [ ] Build the snapshot only from the caller's `listRuns(subject)` and `getRun(subject, runRef)` results:

  ```ts
  export function buildOperationalSnapshot(
    store: ControlPlaneStore,
    subject: string,
    attemptIo: AttemptIoStore,
    resources: ResourceLimiter,
    outbox: OutboxStatus,
    now: () => Date = () => new Date(),
  ): OperationalSnapshot {
    const details = store.listRuns(subject).flatMap((run) => {
      const result = store.getRun(subject, run.runRef);
      return result.ok ? [result.value] : [];
    });
    const attempts = details.flatMap((detail) => detail.attempts.map((attempt) => {
      const stage = detail.stages.find((candidate) => candidate.stageRef === attempt.stageRef);
      const latestIo = attemptIo.read(attempt.attemptRef).at(-1);
      return { attemptRef: attempt.attemptRef, runRef: attempt.runRef, state: attempt.state, outcome: TERMINAL.has(attempt.state) ? attempt.state : null, worker: stage?.assignment?.profileId ?? `${attempt.runtime}:${attempt.model}`, heartbeatAt: latestIo?.t ?? attempt.updatedAt, queueAgeMs: attempt.state === 'queued' ? Math.max(0, now().getTime() - Date.parse(attempt.createdAt)) : 0 };
    }));
    const recent = attempts.filter((attempt) => Date.parse(attempt.heartbeatAt) >= now().getTime() - 86_400_000 && attempt.outcome !== null);
    const failures = recent.filter((attempt) => attempt.outcome === 'failed' || attempt.outcome === 'interrupted').length;
    return { asOf: now().toISOString(), attempts: attempts.sort((left, right) => Date.parse(right.heartbeatAt) - Date.parse(left.heartbeatAt)).slice(0, 20), resources: resources.snapshot(), outbox, failureRate24h: recent.length === 0 ? 0 : failures / recent.length };
  }
  ```

- [ ] Register `/api/operations` inside the authenticated read scope. In Sentinel, fetch it with the existing same-origin session cookie, render an alert when `outbox.degraded`, resource active/limit/queued values, the failure rate, and a bounded table of the 20 newest attempt signals. Do not add a mutation to the telemetry route.

- [ ] Run `cd dashboard; npm test -- server/operations/heartbeat.test.ts server/operations/snapshot.test.ts server/operations/routes.test.ts src/views/panels/Sentinel.test.tsx server/control/activation.test.ts; npm run typecheck; npm test` and verify all tests pass on Windows and Ubuntu.

- [ ] Commit with `git add dashboard/server/operations/heartbeat.ts dashboard/server/operations/heartbeat.test.ts dashboard/server/operations/snapshot.ts dashboard/server/operations/snapshot.test.ts dashboard/server/operations/routes.ts dashboard/server/operations/routes.test.ts dashboard/server/control/activation.ts dashboard/server/control/activation.test.ts dashboard/server/index.ts dashboard/src/views/panels/Sentinel.tsx dashboard/src/views/panels/Sentinel.test.tsx dashboard/src/styles/views/panels.css; git commit -m "feat(operations): expose live runtime telemetry"`.

### Task 24: Run a Linux production-path dispatch and restart canary

Choice: the canary is an explicit, watched VM command using the real `report:self-lint` scanner worker and the real service. It never runs in CI, never arms execution, and refuses without `--confirm-live` plus an already-unlocked daemon.

**Files**

- Create: `dashboard/server/acceptance/linuxDispatchCanary.ts`
- Create: `dashboard/server/acceptance/linuxDispatchCanary.test.ts`
- Modify after checkpoint re-read: `dashboard/server/control/synthetic-acceptance.ts:45-100`

**Interfaces**

- Produces: `LinuxCanaryReport = { version: 1; platformVersion: string; cardId: string; runRef: string; pythonCommand: 'python3'; states: string[]; restartObserved: boolean; recovered: boolean; integrationPath: string; ledgerSettled: boolean; passed: boolean }`
- Produces: `CanaryDeps.systemctl(args: readonly string[]): Promise<void>`
- Produces CLI: `node --experimental-strip-types server/acceptance/linuxDispatchCanary.ts --confirm-live --session-env KB_CANARY_SESSION --output PATH`
- Consumes after checkpoint: durable `sourceTurnId` written by the merged bridge and worker finalize-on-result behavior
- Consumes: Task 2 `resolvePython()`, Task 16 outbox mode, and systemd `Restart=on-failure` plus `KillMode=control-group`

- [ ] Add a failing state-machine decision test:

  ```ts
  it('passes only after card, bridge, integration, settlement, restart interruption, and recovery', () => {
    const report = decideCanary({
      platform: 'linux', platformVersion: 'a'.repeat(40), pythonCommand: 'python3', cardId: 'card-1', runRef: 'run-1',
      states: ['queued', 'starting', 'running', 'interrupted', 'recovering', 'succeeded'],
      restartObserved: true, integrationPath: 'orgs/kb-ops/output/synthetic-acceptance.md',
      integrationContent: 'SYNTHETIC-ACCEPTANCE-OK\n', triggerState: 'done', ledgerRows: 1,
    });
    expect(report).toMatchObject({ recovered: true, ledgerSettled: true, passed: true });
    expect(decideCanary({
      platform: 'linux', platformVersion: 'a'.repeat(40), pythonCommand: 'py', cardId: 'card-1', runRef: 'run-1',
      states: ['queued', 'running', 'interrupted', 'recovering', 'succeeded'],
      restartObserved: true, integrationPath: 'orgs/kb-ops/output/synthetic-acceptance.md',
      integrationContent: 'SYNTHETIC-ACCEPTANCE-OK\n', triggerState: 'done', ledgerRows: 1,
    }).passed).toBe(false);
  });

  it('refuses off Linux, without confirmation, or while execution is locked', () => {
    expect(() => assertLinuxCanaryGate('win32', ['--confirm-live'], { executionLocked: false })).toThrow(/Linux/);
    expect(() => assertLinuxCanaryGate('linux', [], { executionLocked: false })).toThrow(/confirm-live/);
    expect(() => assertLinuxCanaryGate('linux', ['--confirm-live'], { executionLocked: true })).toThrow(/locked/);
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/acceptance/linuxDispatchCanary.test.ts` and verify the module is absent.

- [ ] Export the existing `SYNTHETIC` value and card-mint script from `synthetic-acceptance.ts` without changing their contents. Implement the canary around production modules and durable state:

  ```ts
  export function decideCanary(input: CanaryObservations): LinuxCanaryReport {
    const recovered = input.states.includes('interrupted') && input.states.includes('recovering') && input.states.at(-1) === 'succeeded';
    const integrationOk = input.integrationPath === 'orgs/kb-ops/output/synthetic-acceptance.md'
      && input.integrationContent.replace(/\r\n/g, '\n') === 'SYNTHETIC-ACCEPTANCE-OK\n';
    const ledgerSettled = input.ledgerRows === 1;
    return { version: 1, platformVersion: input.platformVersion, cardId: input.cardId, runRef: input.runRef, pythonCommand: input.pythonCommand as 'python3', states: input.states, restartObserved: input.restartObserved, recovered, integrationPath: input.integrationPath, ledgerSettled, passed: /^[0-9a-f]{40}$/.test(input.platformVersion) && input.platform === 'linux' && input.pythonCommand === 'python3' && recovered && integrationOk && input.triggerState === 'done' && ledgerSettled };
  }

  export async function runLinuxCanary(deps: CanaryDeps = productionDeps()): Promise<LinuxCanaryReport> {
    const readiness = await deps.readReadiness();
    assertLinuxCanaryGate(process.platform, process.argv.slice(2), readiness);
    const capabilities = await deps.readRuntimeCapabilities();
    if (capabilities.python.command !== 'python3' || capabilities.python.prefixArgs.length !== 0) throw new Error('production Python resolver did not select python3');
    const card = await deps.saveCanaryCardViaDashboard();
    const runRef = await deps.waitForSourceTurn(card.id);
    const states = await deps.waitForAttemptState(runRef, 'running');
    const oldMainPid = await deps.mainPid('kb-dashboard.service');
    await deps.systemctl(['kill', '--kill-who=main', '--signal=SIGKILL', 'kb-dashboard.service']);
    await deps.waitForDifferentMainPid('kb-dashboard.service', oldMainPid);
    states.push(...await deps.waitForTerminalAfterRestart(runRef));
    const observations = deps.readCanonicalEvidence(card.id, runRef, states, capabilities.python.command, await deps.readPlatformVersion());
    return decideCanary(observations);
  }
  ```

  Render and submit the live card with this closed shape; `SYNTHETIC` is the unchanged exported body from `synthetic-acceptance.ts`:

  ```ts
  export function renderCanaryCard(id: string, createdAt: string): string {
    return [
      '---', 'schema-version: 1', `id: ${id}`, 'project: kb-ops',
      'action: report:self-lint', 'target: orgs/kb-ops/output', 'profile: scanner',
      'risk-tier: T1', 'state: inbox', 'owner: dashboard-engine',
      'execution-controller: dashboard', `created: ${createdAt}`, '---', '', SYNTHETIC.trimEnd(), '',
    ].join('\n');
  }

  const response = await fetch(new URL('/api/write/save', baseUrl), {
    method: 'POST', headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
    body: JSON.stringify({ relpath: `queue/inbox/${id}.md`, content: renderCanaryCard(id, now().toISOString()), message: `test(runtime): enqueue Linux canary ${id}` }),
  });
  if (!response.ok) throw new Error(`canary card save failed: ${response.status}`);
  ```

  `productionDeps` must generate a filename-safe card id; obtain `session` only from the named environment key; read `/api/runtime/capabilities` and `/opt/kb-releases/current/VERSION`; find the post-merge run by exact `sourceTurnId === card.id`; poll the external state root across process death and automatic systemd restart; record `interrupted` from boot normalization, `recovering` from the existing run-level recovery state, and terminal success from the successor attempt; invoke `systemctl` as an argv array; verify the exact canonical integration path/content, trigger `queue/done` card result, and exactly one subscription ledger settlement row; and write the report atomically to the required output path without the session value. The SIGKILL is deliberate: it exercises durable interrupted-run recovery while `Restart=on-failure` restarts the service and `KillMode=control-group` contains the child; Task 21 separately proves graceful drain. The module must not import or call `dispatchClaimedCard` directly—the live queue bridge and its production `runPythonSync` claim/reconcile path must process the card.

- [ ] Run `cd dashboard; npm test -- server/acceptance/linuxDispatchCanary.test.ts; npm run typecheck`. On the staging VM, after Gate 1 approval and a deliberate passkey unlock, run `canary_id=$(date -u +%Y%m%dT%H%M%SZ); sudo --preserve-env=KB_CANARY_SESSION node --experimental-strip-types /opt/kb-releases/current/dashboard/server/acceptance/linuxDispatchCanary.ts --confirm-live --session-env KB_CANARY_SESSION --output "/var/lib/kb/gates/phase1/canary-$canary_id.json"`; watch the real worker, verify systemd records a new main PID after the deliberate mid-run kill, and require a report whose `platformVersion` equals `/opt/kb-releases/current/VERSION`, `pythonCommand` is `python3`, full interruption/recovery sequence is present, exact integration output is present, `ledgerSettled` is true, and `passed` is true. Lock execution immediately after the canary and unset `KB_CANARY_SESSION`.

- [ ] Commit with `git add dashboard/server/acceptance/linuxDispatchCanary.ts dashboard/server/acceptance/linuxDispatchCanary.test.ts dashboard/server/control/synthetic-acceptance.ts; git commit -m "test(runtime): add Linux restart dispatch canary"`.

## G2. Gate-2 evidence assembly

### Task 25: Produce the Phase I execution-authority evidence package

Choice: Gate 2 is a pure verifier/assembler. It cannot unlock the latch, change trust anchors, edit repository configuration, or promote a physical split.

**Files**

- Create: `scripts/gates/phase1_gate2.py`
- Create: `tests/test_phase1_gate2.py`

**Interfaces**

- Produces CLI: `python scripts/gates/phase1_gate2.py --repo ROOT --gate1 DIR --canary FILE --deploy DIR --backup DIR --outbox DIR --runtime FILE --output DIR`
- Produces verification CLI: `python scripts/gates/phase1_gate2.py --verify-output DIR`
- Produces: `gate2.json`, `gate2.md`, and SHA-256 inventory `evidence.sha256`
- Consumes: Gate 1 approval, hardening test reports, canary report, quiescent deploy/rollback transcript, backup/restore report, outbox outage/replay report, credential validation report, runtime capability report

- [ ] Add a failing complete/incomplete package test:

  ```py
  def test_gate2_requires_every_cutover_proof_and_locked_posture():
      evidence = {
          "gate1Approved": True, "schemaStartupRefusal": True, "repositoryBinding": True,
          "pythonProductionResolver": True, "workerDrain": True, "killModeControlGroup": True,
          "allReadsAuthenticated": True, "resourceLimits": True, "linuxCanary": True,
          "unsupportedVmSurfacesSafe": True, "quiescentRestart": True, "rollback": True,
          "backupRpo": True, "restoreRto": True, "outboxOutageReplay": True,
          "vmGitHubCredentialAbsent": True, "executionLocked": True,
          "trustAnchorsUnchanged": True, "physicalSplitNotStarted": True,
      }
      assert decide(evidence) == {"passed": True, "failures": []}
      evidence["executionLocked"] = False
      assert decide(evidence)["failures"] == ["executionLocked"]


  def test_inventory_detects_a_changed_evidence_file(tmp_path):
      (tmp_path / "proof.json").write_text('{"passed":true}\n', encoding="utf-8")
      (tmp_path / "evidence.sha256").write_text(inventory(tmp_path), encoding="utf-8")
      assert verify_inventory(tmp_path) is True
      (tmp_path / "proof.json").write_text('{"passed":false}\n', encoding="utf-8")
      assert verify_inventory(tmp_path) is False
  ```

- [ ] Run `python -m pytest tests/test_phase1_gate2.py -q` and verify the module is absent.

- [ ] Implement a closed required-key verifier and immutable inventory:

  ```py
  REQUIRED = (
      "gate1Approved", "schemaStartupRefusal", "repositoryBinding", "pythonProductionResolver",
      "workerDrain", "killModeControlGroup", "allReadsAuthenticated", "resourceLimits", "linuxCanary",
      "unsupportedVmSurfacesSafe", "quiescentRestart", "rollback", "backupRpo", "restoreRto",
      "outboxOutageReplay", "vmGitHubCredentialAbsent", "executionLocked",
      "trustAnchorsUnchanged", "physicalSplitNotStarted",
  )


  def decide(evidence: dict) -> dict:
      failures = [key for key in REQUIRED if evidence.get(key) is not True]
      unknown = sorted(set(evidence).difference(REQUIRED))
      if unknown: failures.extend(f"unknown:{key}" for key in unknown)
      return {"passed": not failures, "failures": failures}


  def inventory(root: Path) -> str:
      rows = []
      for path in sorted(item for item in root.rglob("*") if item.is_file() and item.name != "evidence.sha256"):
          rows.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(root).as_posix()}")
      return "\n".join(rows) + "\n"


  def verify_inventory(root: Path) -> bool:
      rows = (root / "evidence.sha256").read_text(encoding="utf-8").splitlines()
      for row in rows:
          digest, relpath = row.split("  ", 1)
          if Path(relpath).is_absolute() or ".." in Path(relpath).parts: return False
          path = root / relpath
          if not path.is_file() or not hmac.compare_digest(hashlib.sha256(path.read_bytes()).hexdigest(), digest):
              return False
      return True
  ```

  Parse each named input rather than trusting command-line booleans. Run Git assertions only against `--repo` on the credential-bearing desktop. Require: Gate 1 `APPROVED.txt`; current compatibility/startup-refusal test report; registry binding tests; Ubuntu resolver report; Vitest worker-drain/read-auth/resource-limit reports; systemd `KillMode=control-group`; canary `passed`; canary `platformVersion` is an ancestor of the final selected release, with a Git path diff from that report field to the current `VERSION` containing only `scripts/gates/phase1_gate2.py` and `tests/test_phase1_gate2.py`; capabilities showing Linux PTY, runner, and Vibe false; deploy transcript showing quiescent restart and rollback; restic RPO/RTO reports; outbox failure/pending/replay/receipt sequence plus VM/remote ops tree equality after the returned reconciliation bundle; VM validator pass; current `/readyz` execution locked; `git diff --quiet a2e6e2b -- governance/ agents/ orgs/*/contract.md`; every registry root still equal to `${DASHBOARD_REPO_ROOT}`; and every project resolve to the same monorepo top level.

- [ ] Run `python -m pytest tests/test_phase1_gate2.py -q` and verify the collector tests pass.

- [ ] Commit with `git add scripts/gates/phase1_gate2.py tests/test_phase1_gate2.py; git commit -m "test(gate): assemble phase one cutover evidence"`.

- [ ] After Tasks 20-25 merge to `main`, leave execution locked and deploy that exact artifact from the desktop: `$releaseSha = git rev-parse origin/main; New-Item -ItemType Directory -Force "artifacts/$releaseSha" | Out-Null; gh run download --name "kb-platform-$releaseSha" --dir "artifacts/$releaseSha"; python scripts/deploy_platform_release.py "artifacts/$releaseSha/kb-platform-$releaseSha.tar.gz" "artifacts/$releaseSha/kb-platform-$releaseSha.tar.gz.sha256" --host $env:KB_VM_HOST`. Append the quiescence, restart, version, and rollback outputs to `/var/lib/kb/gates/phase1/deploy/`; verify the final selected `VERSION` is `$releaseSha` and `/readyz` is locked.

- [ ] On the desktop assemble the package from copied VM evidence and the local Git trust boundary: `$gate2Id = Get-Date -AsUTC -Format 'yyyyMMddTHHmmssZ'; $gateRoot = Join-Path $env:TEMP "kb-phase1-gate2-$gate2Id"; New-Item -ItemType Directory -Force $gateRoot | Out-Null; scp -r "$env:KB_VM_HOST`:/var/lib/kb/gates/phase1" $gateRoot; scp -r "$env:KB_VM_HOST`:/var/lib/kb/backup-reports" $gateRoot; $gate1 = (Get-ChildItem "$gateRoot/phase1" -Directory -Filter 'gate1-*' | Sort-Object Name | Select-Object -Last 1).FullName; $canary = (Get-ChildItem "$gateRoot/phase1" -File -Filter 'canary-*.json' | Sort-Object Name | Select-Object -Last 1).FullName; python scripts/gates/phase1_gate2.py --repo . --gate1 $gate1 --canary $canary --deploy "$gateRoot/phase1/deploy" --backup "$gateRoot/backup-reports" --outbox "$gateRoot/phase1/outbox" --runtime "$gateRoot/phase1/runtime.json" --output "$gateRoot/package"; python scripts/gates/phase1_gate2.py --verify-output "$gateRoot/package"`. Verify both commands exit 0, inspect `gate2.md`, and confirm the copied readiness evidence is locked.

- [ ] Present Gate 1 and Gate 2 packages to Daniel. Record Daniel's explicit Gate 2 approval outside the repository in the package directory. Only that separate approved operation may grant execution authority; this task itself leaves the daemon locked.

## Final self-review

### Spec coverage map

- Immutable platform artifact, live-checkout transition, symlink selection, quiescent restart, and rollback: Tasks 10-12.
- Tier-zero encrypted backup, 15-minute RPO, 60-minute RTO, and restore drill: Task 13.
- Desktop promotion, local durable outbox, bounded retry, outage replay, visible backlog, continued reads, and degraded admission: Tasks 16-18.
- No GitHub credential on the VM, enforced structurally and by validation: Tasks 8, 12, 16, 17, and Gate 2 Task 25.
- Session authentication on every non-health read, root confinement, tailnet Serve/ACL/Funnel proof, and no authority transfer at Gate 1: Tasks 14, 15, and 19.
- Production Python resolution and Linux behavior: Tasks 2 and 20.
- Worker drain and `KillMode=control-group`: Tasks 12 and 21.
- Per-resource-class control/Git/agent/render/PTY limits: Task 22.
- Heartbeats, queue age, worker identity, saturation, outcomes, failure rate, and outbox alerting in the dashboard: Tasks 18 and 23.
- Card-to-bridge-to-integration-to-ledger Linux canary with mid-run restart and recovery: Task 24.
- Versioned card/workflow schemas, v0 transition compatibility, explicit migration, and unsupported-data startup refusal: Tasks 3-7.
- Server-owned repository mapping and immutable approved-proposal binding: Tasks 8-9.
- Both evidence packages and Daniel approval boundaries: Tasks 19 and 25.
- Immediate coordination classifier defect: Task 1.

### Deliberate gaps

- Phases II and III are not implemented: no physical repository split, staging repository, GitHub App, direct VM publication, trust-anchor change, or multi-root execution.
- Media exile is not implemented and no binary asset moves before the Phase I cutover is proven.
- Linux PTY, Task Scheduler runner, and Composer/Vibe subprocess features are disabled rather than ported; dashboard bridge dispatch is the supported Linux execution path.
- Existing v0 documents are accepted in place; the migration CLI is explicit and no bulk rewrite is part of Phase I.

### Resolved ambiguities

- Release form: an Ubuntu-built tarball keyed by the full merge commit; desktop transfers it, VM only verifies and activates it.
- VM data checkout: a sparse/data-only ops checkout with platform paths absent, allowing embedded Python imports to fall through to the release `PYTHONPATH`.
- Registry identity: SHA-256 of the symbolic checked-in record before host root expansion, so identity is stable across machines and changes with any registry contract field.
- Outbox: ordered Git bundles plus atomic JSON manifests/receipts; degraded at 100 pending items or 15 minutes oldest age.
- Health exemption: only `/healthz` and minimal `/readyz` are unauthenticated data responses; static assets and auth ceremonies are bootstrap paths, not repository reads.
- Backup access: restic receives ambient service-manager access; repository code never stores, serializes, logs, or transports backup credentials.

### Mechanical audit before handoff

- [ ] Run `git diff --name-only` and verify the only planning-worktree change is `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md`.
- [ ] Run a case-sensitive scan for the four forbidden planning phrases by constructing each needle from fragments in the shell, and verify zero matches in this file.
- [ ] Compare every later `Consumes` entry with the earlier `Produces` signature named in this plan; specifically verify schema compatibility, registry binding, readiness, outbox manifest, admission, resource snapshot, canary report, and both gate-package shapes match exactly.
- [ ] Count headings matching `^### Task [0-9]+:` and verify exactly 25, with the workflow-platform checkpoint between Tasks 8 and 9.
- [ ] Re-read every `Modify` target after the workflow-platform merge and update line ranges only through plan review; never infer post-merge edits to the two protected files.
