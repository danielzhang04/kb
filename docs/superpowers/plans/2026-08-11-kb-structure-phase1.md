# KB Structure Phase I Implementation Plan

**Goal:** Cut the current dashboard/VM runtime over to an immutable, recoverable, credential-free Phase I platform while adding the versioned schema and repository-registry prerequisites required by Phase II.

**Architecture:** Keep the monorepo as the only source repository, but separate the VM into a read-only versioned platform release, a data-only ops checkout, and an external state root. Coordination commits enter a durable VM outbox and are promoted by the desktop; all execution remains behind the existing lock and the two evidence-backed cutover gates. Schema compatibility and repository identity are checked at startup and proposal activation so unsupported or ambiguously targeted work fails before side effects.

**Tech stack:** Node.js 24, TypeScript, Fastify, React, Vitest, Python 3.12, pytest, Git/Git bundles, GitHub Actions, Ubuntu, systemd, and restic.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

## Global Constraints

- The monorepo remains the sole source repository.
- The platform is built on merge into an immutable, versioned VM release artifact.
- The running platform is never a live checkout that shares state with data.
- The VM has no GitHub, backup-store, signing, deploy, SSH-agent, or other external-authority credential. The only persistent secret permitted on the VM is the dashboard's local HMAC session key required by Task 24's restart test; bootstrap generates it locally into a root-owned `0600` file outside the repository, and no code, report, command line, log, or evidence package reads or prints its value.
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
- Never add a credential value, credential document, GitHub token, deploy key, signing key, backup-store key, SSH agent socket, or credential-bearing remote to the VM. `credentialIdentity` is a recorded non-secret label, not operational authority in Phase I. The Task 24 local HMAC session key is generated on the VM, remains in `/etc/kb-dashboard/session.env`, and authenticates only this dashboard; it grants no external-system authority.
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
- Modify: `dashboard/server/control/authorizedFailedRunReconciliation.test.ts:1-720`

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

- [ ] Replace every literal `execFileSync('python', ...)`, `spawnSync('python', ...)`, and equivalent command variable in `authorizedFailedRunReconciliation.test.ts` with the shared resolver, including the `seedCards`, `readCard`, integration, dump, and path-confinement helpers:

  ```ts
  import { resolvePython } from '../runtime/python.ts';

  const python = resolvePython();
  const pythonArgs = (args: readonly string[]): string[] => [...python.prefixArgs, ...args];

  execFileSync(python.command, pythonArgs(['-c', script, JSON.stringify(cardSpecs(workflow))]), {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  const result = spawnSync(python.command, pythonArgs(['-c', script, payload]), {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  ```

  Run `rg -n "execFileSync\('python'|spawnSync\('python'|command:\s*'python'" dashboard/server/control/authorizedFailedRunReconciliation.test.ts` and require exit 1.

- [ ] Run `rg -n "execFileSync\('py'|execFileSync\('python'|spawnSync\('python'|process\.platform.*python|win32.*py" dashboard/server` and verify only deliberate resolver tests contain literal command names. Run `cd dashboard; npm test -- server/runtime/python.test.ts server/embeddedPython.test.ts server/write/launch.test.ts server/write/workflowRun.test.ts server/stop/floor.test.ts server/control/authorizedFailedRunReconciliation.test.ts; npm run typecheck` and verify all commands pass on Windows; repeat the same test command on Ubuntu and verify every spawned interpreter is `python3`.

- [ ] Commit with `git add dashboard/server/runtime/python.ts dashboard/server/runtime/python.test.ts dashboard/server/write/preambleGate.ts dashboard/server/write/launch.ts dashboard/server/write/workflowRun.ts dashboard/server/stop/floor.ts dashboard/server/embeddedPython.test.ts dashboard/server/control/authorizedFailedRunReconciliation.test.ts; git commit -m "fix(runtime): resolve Python per platform"`.

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
      "project": { "oneOf": [{ "type": "string", "minLength": 1 }, { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "minLength": 1 } }] },
      "action": { "type": "string", "minLength": 1 },
      "target": { "type": "string", "minLength": 1 },
      "risk-tier": { "enum": ["T1", "T2", "T3"] },
      "owner": { "type": ["string", "null"] },
      "claim-token": { "type": ["string", "null"] },
      "state": { "enum": ["inbox", "blocked", "working", "done", "approvals", "approved", "rejected", "stop-requested", "halting", "halted", "archived"] },
      "approval": { "type": ["string", "null"] },
      "workflow": { "type": ["string", "null"] },
      "depends-on": { "type": "array", "uniqueItems": true, "items": { "type": "string", "minLength": 1 } },
      "variant-group": { "type": ["string", "null"] },
      "role": { "enum": ["scout", "manage", "work", "inspect", "consolidate"] },
      "session-id": { "type": ["string", "null"] },
      "runtime": { "enum": ["claude", "codex", null] },
      "model": { "type": ["string", "null"] },
      "execution-controller": { "enum": ["dashboard", "terminal", null] },
      "profile": { "type": "string", "minLength": 1 },
      "autonomy": { "enum": ["acts-alone", "queues-for-me"] },
      "assurance_class": { "enum": ["acts-alone", "possession-eligible", "T3-novel", "T3-established", "signed-only"] },
      "workflow-def": { "type": "string", "minLength": 1 },
      "parameters": { "type": "object", "additionalProperties": { "type": "string" } },
      "created": { "type": "string", "minLength": 1 }
    },
    "additionalProperties": false
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
- Modify: `dashboard/package.json`
- Modify: `dashboard/package-lock.json`

**Interfaces**

- Produces: `readCompatibility(platformRoot?: string): CompatibilityMatrix`
- Produces: `assertSupportedVersion(kind: 'cards' | 'workflows', value: unknown): 0 | 1`
- Produces: `assertCardSchema(meta: Record<string, unknown>, version: 0 | 1, platformRoot?: string): void`
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

  it.each([
    MINIMAL_CARD.replace('action: test:noop\n', ''),
    MINIMAL_CARD.replace('action: test:noop', 'action: [test:noop]'),
    MINIMAL_CARD.replace('state: inbox', 'state: invented'),
    MINIMAL_CARD.replace('risk-tier: T1', 'risk-tier: T4'),
    MINIMAL_CARD.replace('owner: null', 'owner: null\nunknown-field: value'),
  ])('rejects a card outside the closed machine schema', (source) => {
    expect(() => parseCardFrontmatter(source)).toThrow(/card schema/);
  });
  ```

  ```ts
  it('loads the checked-in compatibility ranges', () => {
    expect(readCompatibility()).toEqual({ cards: { current: 1, supported: [0, 1] }, workflows: { current: 1, supported: [0, 1] } });
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/schema/versions.test.ts server/planeA/cards.test.ts` and verify the new module is missing and explicit v2 is not rejected.

- [ ] Run `cd dashboard; npm install --save-dev --save-exact ajv@8.20.0`; verify `ajv` is a direct dev dependency and the lockfile changes contain no other package upgrade.

- [ ] Create `schema/versions.ts`:

  ```ts
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import Ajv2020 from 'ajv/dist/2020.js';
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

  export function assertCardSchema(
    meta: Record<string, unknown>,
    version: 0 | 1,
    platformRoot: string = defaultPlatformRoot(),
  ): void {
    const schema = JSON.parse(readFileSync(join(platformRoot, 'schemas', 'cards', 'v1.schema.json'), 'utf8')) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const candidate = version === 0 ? { ...meta, 'schema-version': 1 } : meta;
    if (!validate(candidate)) {
      const detail = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ') ?? 'is invalid';
      throw new Error(`card schema validation failed: ${detail}`);
    }
  }
  ```

- [ ] Add `'schema-version'?: number` to `CardMeta`; reject duplicate frontmatter keys; reject a line without `:` instead of skipping it; parse `schema-version` as a base-10 integer only when present. After the narrow YAML-shape parser finishes, call `const version = assertSupportedVersion('cards', meta['schema-version'])` and then `assertCardSchema(meta, version)` before the only `as CardMeta` cast and return. The cast is a representation step after schema enforcement, never the validator.

- [ ] Run `cd dashboard; npm test -- server/schema/versions.test.ts server/planeA/cards.test.ts; npm run typecheck` and verify exit code 0 on Windows and Ubuntu.

- [ ] Commit with `git add dashboard/server/schema/versions.ts dashboard/server/schema/versions.test.ts dashboard/server/planeA/cards.ts dashboard/server/planeA/cards.test.ts dashboard/package.json dashboard/package-lock.json; git commit -m "feat(schema): enforce card compatibility in dashboard"`.

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

  it.each([
    ['missing-action.md', '---\nid: bad\nproject: kb-ops\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n'],
    ['list-action.md', '---\nid: bad\nproject: kb-ops\naction: [test:noop]\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n'],
    ['bad-state.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: invented\n---\n'],
    ['bad-tier.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T4\nstate: inbox\n---\n'],
    ['bad-list.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\ndepends-on:\n  - nested\n---\n'],
    ['unknown.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\nunknown-field: value\n---\n'],
  ])('refuses malformed card %s before listen', (name, source) => {
    const root = mkdtempSync(join(tmpdir(), 'schema-startup-bad-'));
    mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
    writeFileSync(join(root, 'queue', 'inbox', name), source);
    expect(() => assertSupportedRepositoryData(root)).toThrow(new RegExp(`${name}.*card schema|${name}.*frontmatter`, 's'));
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

- [ ] Make `buildApp` resolve one `repoRoot`, call `assertSupportedRepositoryData(repoRoot)` before route registration unless `validateData === false`, and pass that root to all current root consumers. `parseCardFrontmatter` now applies Task 4's closed machine-readable schema, so missing required fields, wrong scalar/list types, unknown fields, invalid state, invalid action, and invalid risk tier all refuse startup. Make `start` call `buildApp({ repoRoot: options.repoRoot, validateData: true })`. Tests that use incomplete fixtures explicitly pass `validateData: false`.

- [ ] Run `cd dashboard; npm test -- server/schema/startup.test.ts server/index.test.ts; npm run typecheck; npm test` and verify the full Vitest suite passes on Windows and Ubuntu.

- [ ] Commit with `git add dashboard/server/schema/startup.ts dashboard/server/schema/startup.test.ts dashboard/server/index.ts dashboard/server/index.test.ts; git commit -m "feat(schema): reject unsupported data at startup"`.

## C. Server-owned repository registry

### Task 8: Load a closed project-to-repository registry

Choice: the registry hashes the checked-in symbolic root record before expanding `${DASHBOARD_REPO_ROOT}`. The identity is therefore stable across desktop and VM absolute paths, while any change to the root contract, remote, base ref, scope, or credential label changes the identity. Phase I enforces root, scope, identity, and the cheap `baseRef` consistency check. `remote` and `credentialIdentity` are recorded and hash-bound but explicitly not operationally enforced until the Phase II external-repository canary; they grant no authority.

**Files**

- Create: `dashboard/config/repositories.json`
- Create: `dashboard/server/control/repositoryRegistry.ts`
- Create: `dashboard/server/control/repositoryRegistry.test.ts`
- Modify: `dashboard/server/control/environment.ts:8-32,142-176`
- Modify: `dashboard/server/control/environment.test.ts:1-70`

**Interfaces**

- Produces: `RepositoryRecord = { id: string; registryId: string; projects: readonly string[]; root: string; remote: string; baseRef: string; scope: readonly string[]; credentialIdentity: string; identity: string }`, where `remote` and `credentialIdentity` are recorded-not-enforced-until-Phase-II fields
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
    writeFileSync(path, JSON.stringify({ version: 1, repositories: [{ id: 'kb-ops@1', projects: ['kb-ops'], root: '${DASHBOARD_REPO_ROOT}', remote: 'origin', baseRef: 'ops', scope: ['orgs/kb-ops/**'], credentialIdentity: 'desktop-promotion' }] }));
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
      { "id": "kb-ops@1", "projects": ["kb-ops", "kb"], "root": "${DASHBOARD_REPO_ROOT}", "remote": "origin", "baseRef": "ops", "scope": ["orgs/kb-ops/**", "queue/**", "ledgers/**", "memory/**", "dashboards/**", "handoffs/**", "_index.md"], "credentialIdentity": "desktop-promotion" },
      { "id": "atlas-prep@1", "projects": ["atlas-prep"], "root": "${DASHBOARD_REPO_ROOT}", "remote": "origin", "baseRef": "ops", "scope": ["orgs/atlas-prep/**", "queue/**", "ledgers/**"], "credentialIdentity": "desktop-promotion" },
      { "id": "faceless-youtube@1", "projects": ["faceless-youtube"], "root": "${DASHBOARD_REPO_ROOT}", "remote": "origin", "baseRef": "ops", "scope": ["orgs/faceless-youtube/**", "queue/**", "ledgers/**"], "credentialIdentity": "desktop-promotion" }
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
      if (typeof raw.remote !== 'string' || raw.remote.length === 0 || raw.baseRef !== 'ops' || typeof raw.credentialIdentity !== 'string' || raw.credentialIdentity.length === 0) throw new Error('Phase I repository source fields require recorded remote/credential labels and baseRef ops');
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

This is a blocking checkpoint, not an implementation task and not a commit. The workflow-platform branch has merged to `main`; its branch tip may continue advancing, so every re-read and implementation target is the tip actually merged into `origin/main`, and that merged tip must be at or after `804acec`.

- [ ] Run `git fetch origin main claude/workflow-platform; $mergedTip = git merge-base origin/main origin/claude/workflow-platform; git merge-base --is-ancestor 804acec $mergedTip; if ($LASTEXITCODE -ne 0) { Write-Error 'merged workflow-platform tip predates 804acec'; exit 1 }; git merge-base --is-ancestor $mergedTip origin/main; if ($LASTEXITCODE -ne 0) { Write-Error 'workflow-platform merged tip is not on main'; exit 1 }; Write-Output $mergedTip`. Require both ancestry checks to exit 0 and record `$mergedTip`; branch-tip commits newer than `$mergedTip` are not implementation inputs until they also merge.
- [ ] Incorporate the updated `origin/main` using the repository's normal non-destructive branch workflow and run `git merge-base --is-ancestor $mergedTip HEAD`; require exit code 0.
- [ ] Re-read `dashboard/server/control/claudeWorkerAdapter.ts`, `dashboard/server/control/queueBridge.ts`, `dashboard/server/control/activation.ts`, `dashboard/server/control/routes.ts`, `dashboard/server/http/context.ts`, `dashboard/server/http/surface.ts`, their tests, and every caller reached by `rg -n "dispatchQueueCard|buildQueueBridge|createQueueBridge|createClaudeWorkerAdapter|buildActivatedExecution|executionLatch|\.lock\(" dashboard/server`. Record the merged-tip signatures in the Task 9 reviewer notes.
- [ ] Do not edit `claudeWorkerAdapter.ts`; Task 21's draining registry handles its post-spawn registration race. Edits to `queueBridge.ts` are limited to Task 21's reviewed `stopAndDrain()` change and Task 24's durable card→run receipt. If the merged-tip contracts invalidate either named edit or any later interface, stop and amend this plan through review before implementation.

### Task 9: Bind approved proposals to the immutable registry identity

Choice: Phase I still executes only from the configured ops root. A proposal whose registry record resolves to another root is refused; routing work across multiple roots remains Phase II. Activation resolves the declared `baseRef: ops`, requires that ref to equal checkout `HEAD`, and fails loud on a mismatch. `remote` and `credentialIdentity` remain recorded-not-enforced-until-Phase-II fields.

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
- Produces: `ActivatedRepositoryBase = Readonly<{ ref: string; commit: string }>`
- Produces: `resolveActivatedRepositoryBase(repoRoot: string, baseRef: string): ActivatedRepositoryBase`
- Produces: `assertProposalRepository(proposal: PlanProposal, repositories: RepositoryRegistry, activeRepoRoot: string, activatedBase: ActivatedRepositoryBase): RepositoryRecord`
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
    const record = { id: 'kb-ops@1', registryId: 'kb-ops@1', identity: 'a'.repeat(64), projects: ['kb-ops'], root: '/other-repo', remote: 'origin', baseRef: 'ops', scope: ['orgs/kb-ops/**'], credentialIdentity: 'desktop-promotion' };
    const repositories = { forProject: () => record, resolve: () => record };
    const approved = { project: 'kb-ops', repository: { registryId: record.id, identity: record.identity } } as PlanProposal;
    expect(() => assertProposalRepository(approved, repositories, '/repo', { ref: 'ops', commit: 'b'.repeat(40) })).toThrow(/active ops root/);
  });

  it('refuses an approved proposal path outside its immutable repository scope', () => {
    const record = { id: 'kb-ops@1', registryId: 'kb-ops@1', identity: 'a'.repeat(64), projects: ['kb-ops'], root: '/repo', remote: 'origin', baseRef: 'ops', scope: ['orgs/kb-ops/**'], credentialIdentity: 'desktop-promotion' };
    const repositories = { forProject: () => record, resolve: () => record };
    const approved = { project: 'kb-ops', repository: { registryId: record.id, identity: record.identity }, scope: { read: ['orgs/kb-ops/input.md'], write: ['orgs/other/output.md'] } } as PlanProposal;
    expect(() => assertProposalRepository(approved, repositories, '/repo', { ref: 'ops', commit: 'b'.repeat(40) })).toThrow(/repository scope/);
  });

  it('refuses a declared base ref that is not the ref activation resolved', () => {
    const record = { id: 'kb-ops@1', registryId: 'kb-ops@1', identity: 'a'.repeat(64), projects: ['kb-ops'], root: '/repo', remote: 'origin', baseRef: 'ops', scope: ['orgs/kb-ops/**'], credentialIdentity: 'desktop-promotion' };
    const repositories = { forProject: () => record, resolve: () => record };
    const approved = { project: 'kb-ops', repository: { registryId: record.id, identity: record.identity }, scope: { read: ['orgs/kb-ops/input.md'], write: [] } } as PlanProposal;
    expect(() => assertProposalRepository(approved, repositories, '/repo', { ref: 'main', commit: 'b'.repeat(40) })).toThrow(/baseRef/);
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

  export interface ActivatedRepositoryBase { readonly ref: string; readonly commit: string }

  export function resolveActivatedRepositoryBase(repoRoot: string, baseRef: string): ActivatedRepositoryBase {
    if (baseRef !== 'ops') throw new Error(`Phase I activation requires baseRef ops, received ${baseRef}`);
    const declared = execFileSync('git', ['rev-parse', '--verify', `refs/heads/${baseRef}^{commit}`], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (!/^[0-9a-f]{40}$/.test(declared) || !/^[0-9a-f]{40}$/.test(head) || declared !== head) {
      throw new Error(`declared repository baseRef ${baseRef} does not equal the checkout HEAD activation would resolve`);
    }
    return Object.freeze({ ref: baseRef, commit: head });
  }

  export function assertProposalRepository(
    proposal: PlanProposal,
    repositories: RepositoryRegistry,
    activeRepoRoot: string,
    activatedBase: ActivatedRepositoryBase,
  ): RepositoryRecord {
    const record = repositories.resolve(proposal.repository);
    if (record.root !== activeRepoRoot) throw new Error('approved proposal repository does not match the active ops root');
    if (record.baseRef !== activatedBase.ref) throw new Error('approved proposal repository baseRef does not match the activated baseRef');
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

  Import `execFileSync` in `activation.ts`, place `ActivatedRepositoryBase` and `resolveActivatedRepositoryBase` there, and import the type into `proposal.ts` for `assertProposalRepository`. In untrusted validation, reject a present `repository` key and synthesize `bindProposalRepository(project, registry)`. In server-compiled validation, require exactly `{registryId, identity}` and call `registry.repositories.resolve`. Include the binding in `canonicalProposal`, so approval hashes cover it. Document on `RepositoryRecord.remote` and `.credentialIdentity` that they are recorded and identity-hashed but not enforcement inputs until Phase II.

- [ ] After re-reading the merged activation path, pass `repositories` through `BuildActivatedExecutionOptions`. Resolve the registry record for the held project during activation construction, call `resolveActivatedRepositoryBase(repoRoot, heldRecord.baseRef)`, and use its `commit` as the engine's `baseCommit` instead of the old unqualified `git rev-parse HEAD` result. Call this exact guard immediately before the existing `engine.runToBoundary` invocation:

  ```ts
  assertProposalRepository(input.proposal, options.repositories, repoRoot, activatedBase);
  return engine.runToBoundary(input);
  ```

  Update `loadWorkflowCompileEnvironment` to expose the same `repositories` instance, so browser-authored and canonical-workflow proposals produce identical bindings.

- [ ] Run `cd dashboard; npm test -- server/control/proposal.test.ts server/control/activation.test.ts server/control/environment.test.ts; npm run typecheck; npm test` and verify the full suite passes.

- [ ] Commit with `git add dashboard/server/control/proposal.ts dashboard/server/control/proposal.test.ts dashboard/server/control/activation.ts dashboard/server/control/activation.test.ts dashboard/server/control/environment.ts dashboard/server/control/environment.test.ts; git commit -m "feat(control): bind proposals to repository identities"`.

## D. Immutable release, activation, rollback, and state recovery

### Task 10: Build a deterministic platform release on every main merge

Choice: the release name is `kb-platform-$GITHUB_SHA.tar.gz`, where `GITHUB_SHA` is the full merge commit. It contains the built UI, server sources, production Node dependencies, Python runtime modules, schemas, and registry config, but no coordination or state data. CI also emits a closed unsigned attestation binding workflow id, source commit, archive filename, and archive digest; Task 12 signs those exact bytes on the trusted desktop, so no signing key or external credential reaches the VM.

**Files**

- Create: `scripts/build_platform_release.py`
- Create: `tests/test_build_platform_release.py`
- Create: `.github/workflows/kb-platform-release.yml`

**Interfaces**

- Produces CLI: `python scripts/build_platform_release.py --source ROOT --version SHA --output FILE --attestation FILE`
- Produces archive members: `VERSION`, `MANIFEST.sha256`, `dashboard/dist/**`, `dashboard/server/**`, `dashboard/package.json`, `dashboard/package-lock.json`, `dashboard/node_modules/**`, `scripts/**`, `schemas/**`, `dashboard/config/repositories.json`
- Produces: `ReleaseAttestation = { schema: 'kb.release-attestation/v1'; workflow: 'kb-platform-release'; sourceCommit: string; archive: string; sha256: string }`

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
      output = tmp_path / f"kb-platform-{'a' * 40}.tar.gz"
      attestation = tmp_path / f"kb-platform-{'a' * 40}.attestation.json"
      build_release(source, "a" * 40, output, attestation)
      with tarfile.open(output, "r:gz") as archive:
          names = set(archive.getnames())
          assert "VERSION" in names
          assert "dashboard/server/index.ts" in names
          assert not any(name.startswith("queue/") for name in names)
          assert archive.extractfile("VERSION").read().decode() == "a" * 40 + "\n"
          assert "MANIFEST.sha256" in names
      assert json.loads(attestation.read_text(encoding="utf-8")) == {
          "archive": output.name,
          "schema": "kb.release-attestation/v1",
          "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
          "sourceCommit": "a" * 40,
          "workflow": "kb-platform-release",
      }
      assert attestation.read_bytes().endswith(b"\n")
  ```

- [ ] Run `python -m pytest tests/test_build_platform_release.py -q` and verify import collection fails.

- [ ] Implement a deterministic allowlisted builder:

  ```py
  from __future__ import annotations
  import argparse
  import gzip
  import hashlib
  import io
  import json
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


  def build_release(source: Path, version: str, output: Path, attestation: Path) -> None:
      if len(version) != 40 or any(char not in "0123456789abcdef" for char in version):
          raise ValueError("version must be a full lowercase git commit")
      expected_name = f"kb-platform-{version}.tar.gz"
      if output.name != expected_name:
          raise ValueError(f"release archive must be named {expected_name}")
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
      statement = {
          "archive": output.name,
          "schema": "kb.release-attestation/v1",
          "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
          "sourceCommit": version,
          "workflow": "kb-platform-release",
      }
      attestation.write_text(json.dumps(statement, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8", newline="")


  def main() -> int:
      parser = argparse.ArgumentParser()
      parser.add_argument("--source", type=Path, required=True)
      parser.add_argument("--version", required=True)
      parser.add_argument("--output", type=Path, required=True)
      parser.add_argument("--attestation", type=Path, required=True)
      args = parser.parse_args(); build_release(args.source, args.version, args.output, args.attestation); return 0


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
        - run: python scripts/build_platform_release.py --source . --version "$GITHUB_SHA" --output "kb-platform-$GITHUB_SHA.tar.gz" --attestation "kb-platform-$GITHUB_SHA.attestation.json"
        - uses: actions/upload-artifact@v4
          with:
            name: kb-platform-${{ github.sha }}
            path: |
              kb-platform-${{ github.sha }}.tar.gz
              kb-platform-${{ github.sha }}.attestation.json
            if-no-files-found: error
  ```

- [ ] Run `python -m pytest tests/test_build_platform_release.py -q`; then run `cd dashboard; npm ci; npm test; npm run typecheck; npm run build; npm prune --omit=dev; cd ..; $releaseSha = git rev-parse HEAD; $archive = Join-Path $env:TEMP "kb-platform-$releaseSha.tar.gz"; $attestation = Join-Path $env:TEMP "kb-platform-$releaseSha.attestation.json"; python scripts/build_platform_release.py --source . --version $releaseSha --output $archive --attestation $attestation` in PowerShell and verify the tests pass, the two files exist, and the attested digest equals `Get-FileHash -Algorithm SHA256 $archive`. On Ubuntu repeat with `python3`, `/tmp/kb-platform-$releaseSha.tar.gz`, and `/tmp/kb-platform-$releaseSha.attestation.json`.

- [ ] Commit with `git add scripts/build_platform_release.py tests/test_build_platform_release.py .github/workflows/kb-platform-release.yml; git commit -m "build(release): package immutable platform artifacts"`.

### Task 11: Expose an unauthenticated, minimal quiescence readiness probe

Choice: `/readyz` exposes only a transition state and counts; it contains no repository data. A release may restart only after the asynchronous `locking -> locked` transition has closed admission, cancelled queued work, stopped and drained the bridge, drained every registered worker/Git/PTY/Composer process, and corroborated that the service cgroup has no child processes.

**Files**

- Create: `dashboard/server/release/quiescence.ts`
- Create: `dashboard/server/release/quiescence.test.ts`
- Create: `dashboard/server/release/serviceCgroup.ts`
- Create: `dashboard/server/release/serviceCgroup.test.ts`
- Modify: `dashboard/server/http/context.ts:90-130`
- Modify: `dashboard/server/http/surface.ts:120-205,275-287`
- Modify: `dashboard/server/index.ts:86-118`
- Modify: `dashboard/server/index.test.ts:1-85`
- Modify: `dashboard/server/write/asyncGit.ts:121-138`
- Modify: `dashboard/server/write/asyncGit.test.ts:1-107`
- Modify: `dashboard/server/vibe/session.ts:70-95`
- Modify: `dashboard/server/vibe/session.test.ts:110-135`

**Interfaces**

- Produces: `ExecutionLockState = 'unlocked' | 'locking' | 'locked'`
- Produces: `QuiescenceSnapshot = { executionState: ExecutionLockState; bridgeStopped: boolean; queuedWork: number; activeWorkers: number; activeGit: number; activePty: number; activeComposer: number; serviceCgroupChildren: number }`
- Produces: `quiescence(snapshot: QuiescenceSnapshot): { ok: true; quiescent: boolean; blockers: string[] }`
- Produces: `serviceCgroupChildCount(unit?: string, roots?: readonly string[]): number`
- Produces: `SurfaceContext.readiness(): Promise<ReturnType<typeof quiescence>>`
- Changes: `BuildAppOptions.readiness?: SurfaceContext['readiness']`
- Produces: `activeAsyncGitCount(): number`
- Produces: `activeVibeProcessCount(): number`
- Produces route: `GET /readyz`

- [ ] Add failing pure and route tests:

  ```ts
  it('is quiescent only when every side-effecting resource is idle', () => {
    expect(quiescence({ executionState: 'locked', bridgeStopped: true, queuedWork: 0, activeWorkers: 0, activeGit: 0, activePty: 0, activeComposer: 0, serviceCgroupChildren: 0 }))
      .toEqual({ ok: true, quiescent: true, blockers: [] });
    expect(quiescence({ executionState: 'locking', bridgeStopped: false, queuedWork: 2, activeWorkers: 1, activeGit: 0, activePty: 0, activeComposer: 0, serviceCgroupChildren: 1 }).blockers)
      .toEqual(['execution-locking', 'queue-bridge-running', 'work-queued', 'workers-active', 'service-cgroup-active']);
  });

  it('counts every descendant cgroup process except the service main pid', () => {
    expect(serviceCgroupChildCount('kb-dashboard.service', ['/sys/fs/cgroup'], fakeIo({
      controlGroup: '/system.slice/kb-dashboard.service', mainPid: 41,
      procs: { '/sys/fs/cgroup/system.slice/kb-dashboard.service/cgroup.procs': '41\n42\n', '/sys/fs/cgroup/system.slice/kb-dashboard.service/worker/cgroup.procs': '43\n' },
    }))).toBe(2);
  });
  ```

  ```ts
  it('keeps health and readiness public but readiness payload minimal', async () => {
    const app = buildApp({ validateData: false, readiness: async () => ({ ok: true, quiescent: false, blockers: ['workers-active'] }) });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, quiescent: false, blockers: ['workers-active'] });
    await app.close();
  });
  ```

- [ ] Run `cd dashboard; npm test -- server/release/quiescence.test.ts server/release/serviceCgroup.test.ts server/index.test.ts` and verify the new modules and route are absent.

- [ ] Create the pure probe:

  ```ts
  export type ExecutionLockState = 'unlocked' | 'locking' | 'locked';

  export interface QuiescenceSnapshot {
    executionState: ExecutionLockState;
    bridgeStopped: boolean;
    queuedWork: number;
    activeWorkers: number;
    activeGit: number;
    activePty: number;
    activeComposer: number;
    serviceCgroupChildren: number;
  }

  export function quiescence(snapshot: QuiescenceSnapshot): { ok: true; quiescent: boolean; blockers: string[] } {
    const blockers: string[] = [];
    if (snapshot.executionState !== 'locked') blockers.push(`execution-${snapshot.executionState}`);
    if (!snapshot.bridgeStopped) blockers.push('queue-bridge-running');
    if (snapshot.queuedWork > 0) blockers.push('work-queued');
    if (snapshot.activeWorkers > 0) blockers.push('workers-active');
    if (snapshot.activeGit > 0) blockers.push('git-active');
    if (snapshot.activePty > 0) blockers.push('pty-active');
    if (snapshot.activeComposer > 0) blockers.push('composer-active');
    if (snapshot.serviceCgroupChildren > 0) blockers.push('service-cgroup-active');
    return { ok: true, quiescent: blockers.length === 0, blockers };
  }
  ```

- [ ] Implement cgroup corroboration without a shell. Resolve `ControlGroup` and `MainPID` with separate argv-only `systemctl show` calls, reject a relative or root cgroup, recursively read `cgroup.procs`, and count unique positive PIDs other than `MainPID`:

  ```ts
  export function serviceCgroupChildCount(
    unit = 'kb-dashboard.service',
    roots: readonly string[] = ['/sys/fs/cgroup'],
    io: CgroupIo = productionCgroupIo,
  ): number {
    const group = io.systemctl(['show', '--property=ControlGroup', '--value', unit]).trim();
    const mainPid = Number.parseInt(io.systemctl(['show', '--property=MainPID', '--value', unit]).trim(), 10);
    if (!group.startsWith('/') || group === '/' || !Number.isInteger(mainPid) || mainPid <= 0) throw new Error('invalid service cgroup identity');
    const root = path.resolve(roots[0], `.${group}`);
    if (path.relative(path.resolve(roots[0]), root).startsWith('..')) throw new Error('service cgroup escapes root');
    const pids = new Set<number>();
    for (const file of io.walk(root).filter((name) => path.basename(name) === 'cgroup.procs')) {
      for (const row of io.readFile(file).split(/\s+/)) {
        const pid = Number.parseInt(row, 10);
        if (Number.isInteger(pid) && pid > 0 && pid !== mainPid) pids.add(pid);
      }
    }
    return pids.size;
  }
  ```

- [ ] Add these read-only counters beside the existing drain functions, pin each with its current drain test, and add an injectable asynchronous `readiness` function to `SurfaceContext` backed by the activation lock state, bridge state, Task 22 queued count (zero until that task lands), the counters, `ptySessions.size()`, and `serviceCgroupChildCount()`:

  ```ts
  export function activeAsyncGitCount(): number { return liveChildren.size; }
  export function activeVibeProcessCount(): number { return activeVibeProcesses.size; }
  ```

  Register before authenticated routes:

  ```ts
  app.get('/readyz', async () => await surfaceCtx.readiness());
  ```

  Keep `/healthz` unchanged. Task 21 replaces the initial worker count with the draining registry's live count and supplies the asynchronous lock/bridge state; Task 22 supplies the limiter queue count without changing this interface. If cgroup identity cannot be read, readiness fails closed with `service-cgroup-unknown` and `quiescent: false`.

- [ ] Run `cd dashboard; npm test -- server/release/quiescence.test.ts server/release/serviceCgroup.test.ts server/index.test.ts server/write/asyncGit.test.ts server/vibe/session.test.ts; npm run typecheck` and verify all tests pass.

- [ ] Commit with `git add dashboard/server/release/quiescence.ts dashboard/server/release/quiescence.test.ts dashboard/server/release/serviceCgroup.ts dashboard/server/release/serviceCgroup.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/index.ts dashboard/server/index.test.ts dashboard/server/write/asyncGit.ts dashboard/server/write/asyncGit.test.ts dashboard/server/vibe/session.ts dashboard/server/vibe/session.test.ts; git commit -m "feat(release): expose quiescent readiness"`.

### Task 12: Install, select, validate, and roll back VM releases

Choice: the trusted desktop signs Task 10's closed attestation with an offline SSH signing key, then transfers the archive, attestation, and signature into a unique untrusted upload directory. A fixed root-owned activator copies them by file descriptor into root-owned `0700` staging, verifies the signature with a public key baked into that validator, checks the closed attestation and archive digest, and only then extracts. No private key, signing capability, or external credential reaches the VM; `/opt/kb-releases/current` and `/opt/kb-releases/previous` remain atomic symlinks.

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

- Produces desktop CLI: `python scripts/deploy_platform_release.py ARCHIVE ATTESTATION --signing-key PATH --host HOST`
- Produces one-time VM CLI: `sudo python3 deploy/bootstrap_vm.py --ops-bundle PATH --release-public-key PATH`
- Produces VM CLI: `sudo python3 /usr/local/lib/kb/activate_release.py {activate|rollback} [--upload-dir PATH]`
- Produces validation CLI: `sudo python3 /usr/local/lib/kb/validate_vm_runtime.py --ops-root /var/lib/kb/ops --unit kb-dashboard.service`
- Consumes: `GET http://127.0.0.1:4317/readyz`

- [ ] Create failing tests for path traversal, quiescence, attestation closure, signature order, secure staging, effective-unit validation, rollback, and credential-name rejection:

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


  def test_attestation_is_closed_and_binds_full_commit_filename():
      raw = b'{"archive":"kb-platform-' + b'a' * 40 + b'.tar.gz","schema":"kb.release-attestation/v1","sha256":"' + b'b' * 64 + b'","sourceCommit":"' + b'a' * 40 + b'","workflow":"kb-platform-release"}\n'
      assert activate_release.parse_attestation(raw)["sourceCommit"] == "a" * 40
      with pytest.raises(RuntimeError, match="closed canonical attestation"):
          activate_release.parse_attestation(raw[:-2] + b',"extra":true}\n')


  def test_candidate_code_is_not_touched_before_root_validator_accepts(tmp_path):
      events = []
      with pytest.raises(RuntimeError, match="signature"):
          activate_release.activate_from_upload(tmp_path, fake_paths(tmp_path), fake_io(events, signature_ok=False))
      assert events == ["secure-copy", "verify-signature"]
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


  def test_effective_unit_rejects_dropins_and_wrong_kill_mode():
      show = valid_effective_unit()
      show["DropInPaths"] = "/etc/systemd/system/kb-dashboard.service.d/override.conf"
      with pytest.raises(RuntimeError, match="drop-ins"):
          validate_vm_runtime.validate_effective_unit(show, VALID_UNIT_TEXT)
      show = valid_effective_unit(); show["KillMode"] = "process"
      with pytest.raises(RuntimeError, match="KillMode"):
          validate_vm_runtime.validate_effective_unit(show, VALID_UNIT_TEXT)


  def test_effective_unit_must_use_the_local_outbox():
      show = valid_effective_unit()
      with pytest.raises(RuntimeError, match="outbox publication"):
          validate_vm_runtime.validate_effective_unit(show, VALID_UNIT_TEXT.replace("KB_COORDINATION_PUBLICATION=outbox", "KB_COORDINATION_PUBLICATION=github"))
  ```

- [ ] Run `python -m pytest tests/test_deploy_release.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py -q` and verify all three imports fail.

- [ ] Implement the root-owned activator's trust boundary exactly as follows. `bootstrap_vm.py` installs this file and the validator as `root:root 0555`; activation never imports or executes `deploy/**` from a candidate release:

  ```py
  from dataclasses import dataclass

  @dataclass(frozen=True)
  class RuntimePaths:
      releases: Path = Path("/opt/kb-releases")
      current: Path = Path("/opt/kb-releases/current")
      previous: Path = Path("/opt/kb-releases/previous")
      ops_root: Path = Path("/var/lib/kb/ops")
      staging: Path = Path("/var/lib/kb-release-staging")

  RELEASES = Path("/opt/kb-releases")
  CURRENT = RELEASES / "current"
  PREVIOUS = RELEASES / "previous"


  def atomic_link(link: Path, target: Path) -> None:
      pending = link.with_name(link.name + ".new")
      pending.unlink(missing_ok=True)
      pending.symlink_to(target.name, target_is_directory=True)
      pending.replace(link)


  ATTESTATION_KEYS = {"archive", "schema", "sha256", "sourceCommit", "workflow"}
  from release_signing_public import RELEASE_PUBLIC_KEY


  def parse_attestation(raw: bytes) -> dict[str, str]:
      value = json.loads(raw)
      if type(value) is not dict or set(value) != ATTESTATION_KEYS or any(type(value[key]) is not str for key in ATTESTATION_KEYS):
          raise RuntimeError("closed canonical attestation required")
      canonical = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
      if raw != canonical or value["schema"] != "kb.release-attestation/v1" or value["workflow"] != "kb-platform-release":
          raise RuntimeError("closed canonical attestation required")
      commit = value["sourceCommit"]
      if re.fullmatch(r"[0-9a-f]{40}", commit) is None or value["archive"] != f"kb-platform-{commit}.tar.gz" or re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is None:
          raise RuntimeError("attestation identity mismatch")
      return value


  def secure_copy(source: Path, destination: Path) -> None:
      source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
      try:
          stat = os.fstat(source_fd)
          if not stat.S_ISREG(stat.st_mode) or stat.st_nlink != 1:
              raise RuntimeError("upload must be one regular file")
          destination_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
          try:
              while chunk := os.read(source_fd, 1024 * 1024): os.write(destination_fd, chunk)
              os.fsync(destination_fd)
          finally:
              os.close(destination_fd)
      finally:
          os.close(source_fd)


  def verify_signature(attestation: Path, signature: Path, run=subprocess.run) -> None:
      allowed = Path("/run/kb-release-allowed-signers")
      allowed.write_text(f"kb-release {RELEASE_PUBLIC_KEY}\n", encoding="ascii")
      allowed.chmod(0o400)
      result = run(["ssh-keygen", "-Y", "verify", "-f", str(allowed), "-I", "kb-release", "-n", "kb-release", "-s", str(signature)], input=attestation.read_bytes(), capture_output=True)
      allowed.unlink(missing_ok=True)
      if result.returncode != 0: raise RuntimeError("release signature verification failed")


  def activate_from_upload(upload_dir: Path, paths: RuntimePaths = RuntimePaths()) -> str:
      if os.geteuid() != 0: raise RuntimeError("activation requires root")
      stage = paths.staging / secrets.token_hex(16)
      stage.mkdir(mode=0o700)
      for name in ("release.tar.gz", "attestation.json", "attestation.json.sig"):
          secure_copy(upload_dir / name, stage / name)
      verify_signature(stage / "attestation.json", stage / "attestation.json.sig")
      attestation = parse_attestation((stage / "attestation.json").read_bytes())
      archive = stage / "release.tar.gz"
      actual = sha256_file(archive)
      if not hmac.compare_digest(attestation["sha256"], actual): raise RuntimeError("release digest mismatch")
      if paths.current.exists():
          require_quiescence(read_readiness(), "release activation")
      elif subprocess.run(["systemctl", "is-active", "--quiet", "kb-dashboard.service"]).returncode == 0:
          raise RuntimeError("initial activation requires the old live-checkout service to be stopped")
      version = attestation["sourceCommit"]
      destination = paths.releases / version
      extract_read_only(archive, destination)
      if (destination / "VERSION").read_text(encoding="ascii").strip() != version: raise RuntimeError("release VERSION mismatch")
      subprocess.run(["python3", "/usr/local/lib/kb/validate_vm_runtime.py", "--ops-root", str(paths.ops_root), "--unit", "kb-dashboard.service"], check=True)
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

  Bootstrap generates `/usr/local/lib/kb/release_signing_public.py` from the exact single-line public key supplied by the trusted desktop by writing `RELEASE_PUBLIC_KEY = ` followed by `repr(validated_public_key)`. It rejects private-key markers, whitespace beyond the single separator required by the OpenSSH public-key grammar, and any key type other than `ssh-ed25519`, then installs the generated module `root:root 0444` without printing the key. `safe_members` rejects absolute paths, `..`, devices, FIFOs, sockets, symlinks, and hardlinks. `extract_read_only` opens the root-owned archive, writes a fresh version directory, verifies every and only `MANIFEST.sha256` entry, and chmods files/directories to `0444/0555` before link selection.

- [ ] Implement desktop signing and transfer without accepting a token option or reading a token environment variable. The private key path is desktop-only, passed as argv, and never copied:

  ```py
  def deploy(archive: Path, attestation: Path, signing_key: Path, host: str, run=subprocess.run) -> None:
      signed = parse_local_attestation(attestation, archive)
      signature = attestation.with_suffix(attestation.suffix + ".sig")
      signature.unlink(missing_ok=True)
      run(["ssh-keygen", "-Y", "sign", "-f", str(signing_key), "-n", "kb-release", str(attestation)], check=True)
      upload_id = secrets.token_hex(16)
      remote = f"/var/tmp/kb-release-upload/{upload_id}"
      run(["ssh", host, "install", "-d", "-m", "0700", remote], check=True)
      run(["scp", str(archive), str(attestation), str(signature), f"{host}:{remote}/"], check=True)
      run(["ssh", host, "mv", f"{remote}/{archive.name}", f"{remote}/release.tar.gz"], check=True)
      run(["ssh", host, "mv", f"{remote}/{attestation.name}", f"{remote}/attestation.json"], check=True)
      run(["ssh", host, "mv", f"{remote}/{signature.name}", f"{remote}/attestation.json.sig"], check=True)
      run(["ssh", host, "sudo", "python3", "/usr/local/lib/kb/activate_release.py", "activate", "--upload-dir", remote], check=True)
      version = signed["sourceCommit"]
      print(f"activated {version}")
  ```

- [ ] Implement the one-time live-checkout transition as an argv-only bootstrap:

  ```py
  DATA_PATTERNS = ("/CLAUDE.md", "/BOSS.md", "/HEARTBEAT.md", "/docs/", "/orgs/", "/queue/", "/ledgers/", "/traces/", "/memory/", "/dashboards/", "/handoffs/", "/governance/", "/agents/", "/skills/")


  def bootstrap(ops_bundle: Path, release_public_key: Path, run=subprocess.run) -> None:
      run(["systemctl", "disable", "--now", "kb-dashboard.service"], check=False)
      run(["useradd", "--system", "--home-dir", "/nonexistent", "--shell", "/usr/sbin/nologin", "kb-dashboard"], check=False)
      for path in ("/opt/kb-releases", "/var/lib/kb/ops", "/var/lib/kb/state", "/var/lib/kb/state/outbox/ready", "/var/lib/kb/state/outbox/receipts", "/var/lib/kb/state/outbox/incoming"):
          run(["install", "-d", "-o", "kb-dashboard", "-g", "kb-dashboard", path], check=True)
      run(["install", "-d", "-o", "root", "-g", "root", "-m", "0700", "/var/lib/kb-release-staging"], check=True)
      run(["git", "clone", "--branch", "ops", "--no-checkout", str(ops_bundle), "/var/lib/kb/ops"], check=True)
      run(["git", "-C", "/var/lib/kb/ops", "sparse-checkout", "set", "--no-cone", *DATA_PATTERNS], check=True)
      run(["git", "-C", "/var/lib/kb/ops", "checkout", "ops"], check=True)
      run(["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "origin", "disabled://desktop-promotion-only"], check=True)
      run(["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "--push", "origin", "disabled://desktop-promotion-only"], check=True)
      run(["chown", "-R", "kb-dashboard:kb-dashboard", "/var/lib/kb/ops", "/var/lib/kb/state"], check=True)
      install_root_validators(release_public_key)
      secret = secrets.token_hex(32)
      Path("/etc/kb-dashboard").mkdir(mode=0o700, exist_ok=True)
      fd = os.open("/etc/kb-dashboard/session.env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
      try: os.write(fd, f"DASHBOARD_SESSION_SECRET={secret}\n".encode("ascii"))
      finally: os.close(fd)
  ```

  Add pytest assertions that the old service stops before clone, `DATA_PATTERNS` excludes `dashboard`, `scripts`, `schemas`, `deploy`, and `.github`, both remote URLs are disabled, staging stays root-owned, the session env file is `root:root 0600`, its value is never logged, and generated validator source contains the exact supplied public key but no private key. On the desktop create the seed with `git bundle create kb-ops-bootstrap.bundle ops`, derive the public key with `ssh-keygen -y -f $env:KB_RELEASE_SIGNING_KEY | Set-Content -NoNewline kb-release-signing.pub`, transfer the bundle, public key, and reviewed deploy scripts, run bootstrap once, install the unit and validators under `/etc/systemd/system` and `/usr/local/lib/kb`, delete the transferred public-key input after installation, then use the normal desktop deploy command for the first release.

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


  REQUIRED_SHOW = {"FragmentPath", "DropInPaths", "User", "Group", "ExecStart", "WorkingDirectory", "EnvironmentFiles", "UnsetEnvironment", "KillMode", "ControlGroup", "ReadOnlyPaths", "ReadWritePaths"}


  def read_effective_unit(unit: str, run=subprocess.run) -> tuple[dict[str, str], str]:
      show: dict[str, str] = {}
      for name in sorted(REQUIRED_SHOW):
          result = run(["systemctl", "show", f"--property={name}", "--value", unit], check=True, text=True, capture_output=True)
          show[name] = result.stdout.strip()
      text = run(["systemctl", "cat", unit], check=True, text=True, capture_output=True).stdout
      return show, text


  def validate_effective_unit(show: dict[str, str], text: str) -> None:
      if set(show) != REQUIRED_SHOW: raise RuntimeError("effective unit fields are incomplete")
      if show["FragmentPath"] != "/etc/systemd/system/kb-dashboard.service" or show["DropInPaths"]:
          raise RuntimeError("dashboard unit fragment or drop-ins are untrusted")
      expected = {"User": "kb-dashboard", "Group": "kb-dashboard", "WorkingDirectory": "/opt/kb-releases/current/dashboard", "KillMode": "control-group"}
      for name, value in expected.items():
          if show[name] != value: raise RuntimeError(f"effective unit {name} mismatch")
      if "/etc/kb-dashboard/session.env" not in show["EnvironmentFiles"] or "/usr/bin/node" not in show["ExecStart"]:
          raise RuntimeError("effective unit executable or environment file mismatch")
      if not show["ControlGroup"].startswith("/system.slice/kb-dashboard.service"):
          raise RuntimeError("effective unit cgroup mismatch")
      assigned = {match.group(1) for match in re.finditer(r"(?m)^Environment=(?:\"?)([A-Za-z_][A-Za-z0-9_]*)=", text)}
      forbidden = sorted(FORBIDDEN_ENV.intersection(assigned))
      if forbidden:
          raise RuntimeError("dashboard unit assigns a forbidden credential name: " + ",".join(forbidden))
      unset = set(show["UnsetEnvironment"].split())
      missing = sorted(FORBIDDEN_ENV.difference(unset))
      if missing:
          raise RuntimeError("dashboard unit does not unset credential channels: " + ",".join(missing))
      if "Environment=KB_COORDINATION_PUBLICATION=outbox" not in text.splitlines():
          raise RuntimeError("dashboard unit must select local outbox publication")
      if show["ReadOnlyPaths"] != "/opt/kb-releases" or set(show["ReadWritePaths"].split()) != {"/var/lib/kb/ops", "/var/lib/kb/state"}:
          raise RuntimeError("effective unit filesystem policy mismatch")
  ```

  The CLI runs `validate_environment(dict(os.environ))`, `validate_ops_root(args.ops_root)`, `read_effective_unit(args.unit)`, and `validate_effective_unit(show, text)` in that order and exits nonzero on any refusal. It prints only field names and refusal text, never environment values or the contents of the session env file. Tests also inject a malicious drop-in via a fake `systemctl cat` result and prove refusal.

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
  EnvironmentFile=/etc/kb-dashboard/session.env
  UnsetEnvironment=GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK
  ExecStartPre=/usr/bin/python3 /usr/local/lib/kb/validate_vm_runtime.py --ops-root /var/lib/kb/ops --unit kb-dashboard.service
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

  Add `deploy` to Task 10's `RELEASE_ROOTS`, and add an archive assertion for the Task 13 restore utility. Root validators remain bootstrap-installed trust code and are never refreshed from the candidate archive.

- [ ] Run `python -m pytest tests/test_deploy_release.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py -q`. On a fresh Ubuntu staging VM run the documented bundle/bootstrap transition, then deploy one signed artifact; run `sudo test "$(stat -c '%U:%G:%a' /var/lib/kb-release-staging)" = 'root:root:700'; sudo test "$(stat -c '%U:%G:%a' /etc/kb-dashboard/session.env)" = 'root:root:600'; sudo systemctl show kb-dashboard.service -p FragmentPath -p DropInPaths -p User -p Group -p ExecStart -p EnvironmentFiles -p KillMode -p ControlGroup; sudo systemctl cat kb-dashboard.service; release_version=$(cat /opt/kb-releases/current/VERSION); test "$(readlink -f /proc/$(systemctl show -p MainPID --value kb-dashboard)/cwd)" = "/opt/kb-releases/$release_version/dashboard"`; deploy a second signed artifact; run the rollback command and verify `readlink -f /opt/kb-releases/current` returns the first version. Preserve redacted output that contains names/paths but no secret value in the Task 19/25 evidence directories.

- [ ] Commit with `git add scripts/deploy_platform_release.py deploy/activate_release.py deploy/bootstrap_vm.py deploy/validate_vm_runtime.py deploy/systemd/kb-dashboard.service tests/test_deploy_release.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py scripts/build_platform_release.py tests/test_build_platform_release.py; git commit -m "feat(deploy): activate and roll back immutable releases"`.

### Task 13: Back up and restore the release, ops checkout, and state root

Choice: the VM holds no backup-store credential. A root VM exporter first acquires the maintenance lock, requires Task 11 readiness, stops the service to eliminate writers, corroborates an empty service cgroup, creates one self-describing tier-zero archive, restarts into the locked posture, and only then gives that archive to the desktop. Desktop-side restic supplies encryption and off-VM storage. The 15-minute RPO and 60-minute RTO are proven by restoring into a fresh isolated root, running full Git and state invariants, booting a distinct service instance, and running Task 24's recovery canary against it.

**Files**

- Create: `deploy/export_tier0.py`
- Create: `scripts/backup_tier0.py`
- Create: `tests/test_state_backup.py`

**Interfaces**

- Produces VM CLI: `sudo python3 /opt/kb-releases/current/deploy/export_tier0.py --output /var/tmp/kb-tier0-EXPORT_ID.tar --readiness http://127.0.0.1:4317/readyz`
- Produces desktop CLI: `python scripts/backup_tier0.py backup --host HOST --output DIR --rpo-minutes 15`
- Produces desktop CLI: `python scripts/backup_tier0.py restore-drill --target PATH --report FILE --rto-minutes 60`
- Consumes paths: `/opt/kb-releases`, `/var/lib/kb/ops`, `/var/lib/kb/state`
- Consumes after Task 24: `linuxDispatchCanary.ts --restore-drill --base-url URL --state-root PATH --capability-fd 0 --output FILE`
- Produces: `BackupReport = { version: 2; operation: 'backup' | 'restore-drill'; startedAt: string; finishedAt: string; durationSeconds: number; snapshot: string; archiveSha256: string; quiescentExport: boolean; gitFsck: boolean; invariants: boolean; booted: boolean; recoveryCanary: boolean; rpoMet: boolean; rtoMet: boolean; verified: boolean }`

- [ ] Add failing tests with an injected command runner:

  ```py
  import subprocess
  from datetime import datetime, timezone

  def test_export_stops_all_writers_before_tar_and_restarts_locked(tmp_path):
      calls = []
      export_tier0.export(tmp_path / "tier0.tar", io=fake_export_io(calls))
      assert calls == ["lock", "ready:quiescent", "systemctl:stop", "cgroup:empty", "tar", "fsync", "systemctl:start", "ready:locked"]


  def test_export_refuses_queued_work_even_when_worker_count_is_zero(tmp_path):
      with pytest.raises(RuntimeError, match="work-queued"):
          export_tier0.export(tmp_path / "tier0.tar", io=fake_export_io([], readiness={"ok": True, "quiescent": False, "blockers": ["work-queued"]}))


  def test_backup_runs_restic_only_on_desktop_copy(tmp_path):
      calls = []
      backup_tier0.backup("kb-vm", tmp_path, run=fake_desktop_runner(calls))
      assert calls[-2][:3] == ["restic", "backup", str(tmp_path / "kb-tier0.tar")]
      assert calls[-1][:2] == ["restic", "snapshots"]


  def test_restore_drill_fails_when_rto_is_exceeded(tmp_path):
      ticks = iter([0.0, 3_601.0])
      with pytest.raises(RuntimeError, match="RTO"):
          backup_tier0.restore_drill(
              tmp_path / "restore",
              rto_minutes=60,
              run=lambda argv: subprocess.CompletedProcess(argv, 0, stdout="", stderr=""),
              monotonic=lambda: next(ticks),
              verify=lambda _target: {"gitFsck": True, "invariants": True, "booted": True, "recoveryCanary": True},
          )


  def test_restore_requires_fsck_invariants_boot_and_recovery(tmp_path):
      result = backup_tier0.verify_restored_tree(tmp_path, run=fake_restore_runner(fsck=False))
      assert result == {"gitFsck": False, "invariants": True, "booted": True, "recoveryCanary": True}
      assert backup_tier0.decide_restore(result) is False
  ```

- [ ] Run `python -m pytest tests/test_state_backup.py -q` and verify the module is absent.

- [ ] Implement the VM export with an exclusive `flock` on `/run/lock/kb-maintenance.lock`, an argv-only runner, a `finally` restart, and no backup credential access:

  ```py
  TIER_ZERO = ("opt/kb-releases", "var/lib/kb/ops", "var/lib/kb/state")


  def export(output: Path, io: ExportIo = production_io) -> None:
      if os.geteuid() != 0 or output.exists() or output.parent != Path("/var/tmp"):
          raise RuntimeError("export requires root and a fresh /var/tmp target")
      with io.exclusive_lock(Path("/run/lock/kb-maintenance.lock")):
          io.require_quiescence(io.read_readiness(), "tier-zero export")
          io.run(["systemctl", "stop", "kb-dashboard.service"])
          try:
              if io.service_cgroup_children("kb-dashboard.service") != 0: raise RuntimeError("service cgroup is not empty")
              io.run(["tar", "--acls", "--xattrs", "--numeric-owner", "--format=pax", "-C", "/", "-cf", str(output), *TIER_ZERO])
              io.fsync_file_and_parent(output)
          finally:
              io.run(["systemctl", "start", "kb-dashboard.service"])
              locked = io.wait_readiness()
              if not locked.get("quiescent") or "execution-unlocked" in locked.get("blockers", []): raise RuntimeError("service did not restart locked")
  ```

- [ ] Implement desktop backup, isolated restore, and the closed verifier. `safe_extract` rejects absolute/`..` names, devices, hardlinks, and symlinks whose normalized target escapes the isolated root. Every command is argv-only:

  ```py
  def backup(host: str, output: Path, rpo_minutes: int = 15, run=run_command, now=utc_now) -> dict:
      output.mkdir(parents=True, exist_ok=True)
      archive = output / "kb-tier0.tar"
      export_id = secrets.token_hex(16)
      remote = f"/var/tmp/kb-tier0-{export_id}.tar"
      run(["ssh", host, "sudo", "python3", "/opt/kb-releases/current/deploy/export_tier0.py", "--output", remote, "--readiness", "http://127.0.0.1:4317/readyz"])
      run(["scp", f"{host}:{remote}", str(archive)])
      run(["ssh", host, "sudo", "rm", "--", remote])
      digest = sha256_file(archive)
      run(["restic", "backup", str(archive), "--tag", "kb-tier0"])
      snapshots = json.loads(run(["restic", "snapshots", "--tag", "kb-tier0", "--latest", "1", "--json"]).stdout)
      latest = snapshots[-1]
      age = (now() - parse_utc(latest["time"])).total_seconds() / 60
      return make_report("backup", latest["short_id"], digest, quiescentExport=True, rpoMet=age <= rpo_minutes)


  def verify_restored_tree(target: Path, run=run_command) -> dict[str, bool]:
      ops = target / "var/lib/kb/ops"
      fsck = run(["git", "-C", str(ops), "fsck", "--full", "--strict", "--no-dangling"]).returncode == 0
      invariants = validate_release_links(target) and validate_ops_head(ops) and validate_state_json(target) and validate_outbox_manifests_receipts(target)
      unit = "kb-restore-drill-" + secrets.token_hex(8)
      port = "14317"
      boot = run(["systemd-run", f"--unit={unit}", "--property=KillMode=control-group", "--property=NoNewPrivileges=yes", "--setenv=DASHBOARD_EXECUTION_ACTIVATED=0", f"--setenv=DASHBOARD_REPO_ROOT={ops}", f"--setenv=DASHBOARD_STATE_ROOT={target / 'var/lib/kb/state'}", f"--setenv=PORT={port}", "/usr/bin/node", "--experimental-strip-types", str(resolve_restored_release(target) / "dashboard/server/index.ts")]).returncode == 0
      capability = json.dumps({"schema": "kb.restore-capability/v1", "authority": "recover-approved-interrupted-only", "stateRoot": str(target / "var/lib/kb/state")}).encode()
      canary = run(["node", "--experimental-strip-types", str(resolve_restored_release(target) / "dashboard/server/acceptance/linuxDispatchCanary.ts"), "--restore-drill", "--base-url", f"http://127.0.0.1:{port}", "--state-root", str(target / "var/lib/kb/state"), "--capability-fd", "0", "--output", str(target / "recovery-canary.json")], input=capability).returncode == 0
      run(["systemctl", "stop", unit])
      return {"gitFsck": fsck, "invariants": invariants, "booted": boot, "recoveryCanary": canary}
  ```

  `validate_release_links` requires `current` and `previous`, when present, to resolve inside `opt/kb-releases`, requires the selected directory name, `VERSION`, and 40-hex commit to match, and rechecks its manifest. `validate_ops_head` requires `HEAD == refs/heads/ops` and no in-progress Git operation. `validate_state_json` parses every control-store JSON document and rejects unknown schema versions. `validate_outbox_manifests_receipts` calls the closed Task 16/17 validators, requires every ready bundle digest to match, and rejects a receipt without a corresponding manifest id. `make_report` emits `BackupReport` atomically only when every named boolean and the applicable RPO/RTO boolean is true.

- [ ] Install no VM backup service, timer, restic binary, restic environment, or backup user. On the trusted desktop configure its existing credential manager for restic and schedule the exact command `python scripts/backup_tier0.py backup --host $env:KB_VM_HOST --output $env:KB_BACKUP_EXPORT_ROOT --rpo-minutes 15`; the scheduler's credential configuration remains outside the repo and VM. The script rejects `--repository`, `--password`, token flags, and credential-value logging.

- [ ] Run `python -m pytest tests/test_state_backup.py -q`. After Task 24 lands, on the trusted desktop run `$drillId = Get-Date -AsUTC -Format 'yyyyMMddTHHmmssZ'; python scripts/backup_tier0.py backup --host $env:KB_VM_HOST --output "$env:TEMP/kb-backup-$drillId" --rpo-minutes 15; python scripts/backup_tier0.py restore-drill --target "$env:TEMP/kb-restore-$drillId" --report "$env:TEMP/kb-restore-$drillId.json" --rto-minutes 60`; require full `git fsck`, all invariant booleans, isolated boot, recovery canary, RPO, and RTO to pass. Preserve the report for Task 25.

- [ ] Commit with `git add deploy/export_tier0.py scripts/backup_tier0.py tests/test_state_backup.py; git commit -m "feat(backup): protect tier-zero runtime state"`.

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
- Produces: `assertNoSymlinkComponents(repoRoot: string, target: string): void`
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

  it.each(['approved-root', 'intermediate'])('rejects a symlink at the %s component', (position) => {
    const root = mkdtempSync(join(tmpdir(), 'kb-read-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'kb-read-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'secret', 'utf8');
    if (position === 'approved-root') symlinkSync(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
    else { mkdirSync(join(root, 'docs')); symlinkSync(outside, join(root, 'docs', 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
    const relpath = position === 'approved-root' ? 'docs/secret.md' : 'docs/linked/secret.md';
    expect(() => resolveWithinAllowedRoot(root, relpath)).toThrow(/symlink component/);
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

  export function assertNoSymlinkComponents(repoRoot: string, target: string): void {
    const root = resolve(repoRoot);
    const relative = relativePath(root, target);
    if (relative === '..' || relative.startsWith(`..${sep}`) || isAbsolute(relative)) throw new ReadRootError('path is outside repository');
    let cursor = root;
    for (const part of ['', ...relative.split(sep).filter(Boolean)]) {
      if (part) cursor = join(cursor, part);
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new ReadRootError(`symlink component refused: ${cursor}`);
    }
  }

  export function resolveWithinAllowedRoot(
    repoRoot: string,
    relpath: string,
    allowedRoots: readonly string[] = DEFAULT_KB_READ_ROOTS,
  ): string {
    const normalized = relpath.replace(/\\/g, '/').replace(/^\.\//, '');
    const first = normalized.split('/')[0];
    if (!first || !allowedRoots.includes(first)) throw new ReadRootError('path is outside approved KB read roots');
    const target = resolveWithin(repoRoot, normalized);
    assertNoSymlinkComponents(repoRoot, target);
    return target;
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

  Alias Node's imported `relative` as `relativePath` to avoid colliding with locals. Make `readFile`, `fileHistory`, and every directory descent in `listTree` call `resolveWithinAllowedRoot`; reject symlinks and Windows junctions at the approved-root, intermediate-directory, and final-file components before filesystem or Git access. The root listing uses the filtered `listTree` above and refuses an approved root entry whose `Dirent.isSymbolicLink()` is true. Map `ReadRootError` to HTTP 403 in `routes.ts`; keep traversal/malformed input at 400. Do not expose a request parameter that changes `allowedRoots`.

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
- Produces: `OutboxManifest = { schema: 'kb.ops-outbox/v1'; id: string; parent: string; commit: string; paths: string[]; createdAt: string; bundleSha256: string }`
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
    expect(manifest.id).toBe(manifest.commit);
    expect(manifest.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a merge commit and a non-canonical timestamp', async () => {
    await expect(spoolCoordinationCommit(fixtureSpool({ parents: `${'a'.repeat(40)} ${'c'.repeat(40)}` }))).rejects.toThrow(/single parent/);
    await expect(spoolCoordinationCommit(fixtureSpool({ now: () => new Date(Number.NaN) }))).rejects.toThrow(/timestamp/);
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
    schema: 'kb.ops-outbox/v1'; id: string; parent: string; commit: string; paths: string[]; createdAt: string; bundleSha256: string;
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
    if (!/^[0-9a-f]{40}$/.test(input.commit)) throw new Error('outbox commit is not a full object id');
    const parentRow = (await input.runGit(input.repoRoot, ['rev-list', '--parents', '-n', '1', input.commit])).trim().split(/\s+/);
    if (parentRow.length !== 2 || parentRow[0] !== input.commit) throw new Error('outbox commit must have a single parent');
    const parent = parentRow[1];
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
    const instant = (input.now ?? (() => new Date()))();
    if (!Number.isFinite(instant.getTime())) throw new Error('outbox timestamp is invalid');
    const createdAt = instant.toISOString();
    const bundleSha256 = createHash('sha256').update(readFileSync(bundleTmp)).digest('hex');
    const manifest: OutboxManifest = { schema: 'kb.ops-outbox/v1', id, parent, commit: input.commit, paths, createdAt, bundleSha256 };
    writeFileSync(manifestTmp, JSON.stringify(manifest, Object.keys(manifest).sort()) + '\n', { encoding: 'utf8', flag: 'wx' });
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

Choice: promotion is a fail-closed trust validator, not a bundle replay shortcut. It snapshots the spool, validates a closed manifest whose filename stem, id, and commit are identical, fetches each bundle into a run-scoped quarantine ref, proves exact ref equality, a single-parent chain from the last trusted `origin/ops`, safe changed-object modes, bundle digest, path equality, canonical time, and parent-topological order. Any instruction-bearing change (`queue/`, `memory/`, `handoffs/`, `dashboards/`, or `orgs/*/STATE.md`) remains quarantined until a trusted-desktop SSH signature approves the exact chain digest. Promotion uses a dedicated fresh clone for every attempt and never checks out, resets, cleans, or rebases the operator's checkout.

**Files**

- Create: `scripts/promote_vm_outbox.py`
- Create: `deploy/apply_ops_reconciliation.py`
- Create: `tests/test_promote_vm_outbox.py`
- Create: `tests/test_apply_ops_reconciliation.py`

**Interfaces**

- Produces CLI: `python scripts/promote_vm_outbox.py --spool PATH --repo PATH --work-root PATH --vm-host HOST --trusted-ops-head SHA [--approval FILE --approval-signature FILE --approval-allowed-signers FILE] [--max-attempts 3]`
- Produces VM CLI: `sudo python3 /usr/local/lib/kb/apply_ops_reconciliation.py --repo /var/lib/kb/ops --spool /var/lib/kb/state/outbox --bundle PATH --receipts PATH --expected-source-head SHA --expected-target-head SHA`
- Produces: `PromotionReceipt = { schema: 'kb.ops-promotion/v1'; id: string; sourceCommit: string; promotedCommit: string; promotedAt: string }`
- Produces: `InstructionApproval = { schema: 'kb.ops-instruction-approval/v1'; chainDigest: string; firstParent: string; lastCommit: string; ids: string[] }`
- Produces: `fetch_vm_outbox(vm_host: str, snapshot_root: Path, run=subprocess.run) -> Path`
- Produces: `validate_quarantine_chain(spool: Path, repo: Path, trusted_head: str, quarantine_prefix: str, run=run_git) -> list[dict]`
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
      commit = "b" * 40
      bundle = b"bundle"
      manifest = {"schema": "kb.ops-outbox/v1", "id": commit, "parent": "a" * 40, "commit": commit, "paths": paths or ["memory/worker.md"], "createdAt": "2026-08-11T12:00:00.000Z", "bundleSha256": hashlib.sha256(bundle).hexdigest()}
      (ready / f"{commit}.json").write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
      (ready / f"{commit}.bundle").write_bytes(bundle)
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


  @pytest.mark.parametrize("mutation,match", [
      (lambda ready, manifest: (ready / f"{'c' * 40}.json").write_text((ready / f"{manifest['id']}.json").read_text(), encoding="utf-8"), "filename"),
      (lambda ready, manifest: rewrite_manifest(ready, manifest, {"id": "c" * 40}), "identity"),
      (lambda ready, manifest: rewrite_manifest(ready, manifest, {"extra": True}), "closed"),
      (lambda ready, manifest: rewrite_manifest(ready, manifest, {"createdAt": "not-a-time"}), "timestamp"),
  ])
  def test_manifest_validation_fails_closed(tmp_path, mutation, match):
      spool, _repo, manifest = fixture_bundle(tmp_path)
      mutation(spool / "ready", manifest)
      with pytest.raises(RuntimeError, match=match): validate_snapshot(spool)


  def test_quarantine_rejects_wrong_ref_merge_symlink_gitlink_and_broken_parent_chain(tmp_path):
      for defect in ("wrong-ref", "merge", "symlink", "gitlink", "broken-parent"):
          spool, repo, _ = fixture_bundle(tmp_path / defect)
          with pytest.raises(RuntimeError):
              validate_quarantine_chain(spool, repo, "a" * 40, "refs/kb-quarantine/run", run=fake_git(defect))


  def test_instruction_path_requires_exact_signed_chain_approval(tmp_path):
      spool, repo, _ = fixture_bundle(tmp_path, paths=["queue/inbox/card.md"])
      chain = validate_quarantine_chain(spool, repo, "a" * 40, "refs/kb-quarantine/run", run=fake_git("ok"))
      with pytest.raises(RuntimeError, match="trusted-desktop approval"):
          require_instruction_approval(chain, None, None, None)
  ```

  ```py
  def test_vm_reconciliation_requires_quiescence_and_all_receipts(tmp_path):
      repo = tmp_path / "repo"; repo.mkdir()
      spool = tmp_path / "spool"; (spool / "ready").mkdir(parents=True); (spool / "receipts").mkdir()
      returned_receipts = tmp_path / "returned-receipts"; returned_receipts.mkdir()
      bundle = tmp_path / "ops-return.bundle"; bundle.write_bytes(b"bundle")
      with pytest.raises(RuntimeError, match="quiescent"):
          apply_reconciliation(repo, spool, bundle, returned_receipts, "b" * 40, "c" * 40, readiness=lambda: {"quiescent": False})
      (spool / "ready" / "pending.json").write_text('{}', encoding="utf-8")
      with pytest.raises(RuntimeError, match="unreceipted"):
          apply_reconciliation(repo, spool, bundle, returned_receipts, "b" * 40, "c" * 40, readiness=lambda: {"quiescent": True, "blockers": []})
  ```

- [ ] Run `python -m pytest tests/test_promote_vm_outbox.py -q` and verify the module is absent.

- [ ] Implement closed snapshot parsing, topological quarantine validation, and idempotent promotion:

  ```py
  COORDINATION = re.compile(r"^(?:queue|ledgers|traces|memory|dashboards|handoffs)/.+$|^orgs/[^/]+/STATE\.md$")
  INSTRUCTION = re.compile(r"^(?:queue|memory|dashboards|handoffs)/.+$|^orgs/[^/]+/STATE\.md$")
  SAFE_HOST = re.compile(r"^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$")
  MANIFEST_KEYS = {"schema", "id", "parent", "commit", "paths", "createdAt", "bundleSha256"}
  SAFE_CHANGED_MODES = {"000000", "100644"}


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


  def parse_closed_json(path: Path, keys: set[str]) -> dict:
      def closed_pairs(pairs):
          value = {}
          for key, item in pairs:
              if key in value: raise RuntimeError(f"duplicate JSON key: {key}")
              value[key] = item
          return value
      raw = path.read_bytes()
      value = json.loads(raw, object_pairs_hook=closed_pairs)
      if type(value) is not dict or set(value) != keys: raise RuntimeError("closed manifest schema required")
      if raw != (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(): raise RuntimeError("canonical manifest encoding required")
      return value


  def validate_snapshot(spool: Path) -> list[dict]:
      ready = spool / "ready"; receipts = spool / "receipts"
      if not ready.is_dir() or not receipts.is_dir(): raise RuntimeError("snapshot directories are absent")
      files = [item for item in ready.iterdir() if item.is_file()]
      if any(item.suffix not in {".json", ".bundle"} for item in files): raise RuntimeError("unknown ready artifact")
      json_stems = {item.stem for item in files if item.suffix == ".json"}
      bundle_stems = {item.stem for item in files if item.suffix == ".bundle"}
      if json_stems != bundle_stems: raise RuntimeError("manifest and bundle filenames differ")
      manifests = []
      for stem in sorted(json_stems):
          value = parse_closed_json(ready / f"{stem}.json", MANIFEST_KEYS)
          if value["schema"] != "kb.ops-outbox/v1" or stem != value["id"] or value["id"] != value["commit"] or re.fullmatch(r"[0-9a-f]{40}", stem) is None:
              raise RuntimeError("manifest filename/id/commit identity mismatch")
          if re.fullmatch(r"[0-9a-f]{40}", value["parent"]) is None or type(value["paths"]) is not list or not value["paths"] or value["paths"] != sorted(set(value["paths"])):
              raise RuntimeError("manifest parent or paths are invalid")
          try: instant = datetime.strptime(value["createdAt"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
          except (TypeError, ValueError): raise RuntimeError("manifest timestamp is malformed")
          if instant.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value["createdAt"]: raise RuntimeError("manifest timestamp is not canonical UTC")
          if not hmac.compare_digest(sha256_file(ready / f"{stem}.bundle"), value["bundleSha256"]): raise RuntimeError("bundle digest mismatch")
          manifests.append(value)
      receipt_names = {item.name for item in receipts.iterdir() if item.is_file()}
      if any(name not in {f"{stem}.json" for stem in json_stems} for name in receipt_names): raise RuntimeError("orphan or extra receipt")
      return manifests


  def validate_quarantine_chain(spool: Path, repo: Path, trusted_head: str, quarantine_prefix: str, run=run_git) -> list[dict]:
      if re.fullmatch(r"[0-9a-f]{40}", trusted_head) is None: raise RuntimeError("trusted ops head is invalid")
      remaining = {item["commit"]: item for item in validate_snapshot(spool)}
      ordered = []; previous = trusted_head
      while remaining:
          children = [item for item in remaining.values() if item["parent"] == previous]
          if len(children) != 1: raise RuntimeError("outbox is not one parent-topological chain from trusted ops head")
          manifest = children[0]; bundle = spool / "ready" / f"{manifest['id']}.bundle"
          ref = f"{quarantine_prefix}/{manifest['id']}"
          run(repo, ["bundle", "verify", str(bundle)])
          heads = run(repo, ["bundle", "list-heads", str(bundle)]).stdout.splitlines()
          if len(heads) != 1 or heads[0].split()[0] != manifest["commit"]: raise RuntimeError("bundle advertised ref mismatch")
          run(repo, ["fetch", "--no-tags", str(bundle), f"{manifest['commit']}:{ref}"])
          if run(repo, ["rev-parse", f"{ref}^{{commit}}"] ).stdout.strip() != manifest["commit"]: raise RuntimeError("quarantine ref does not equal manifest commit")
          parents = run(repo, ["rev-list", "--parents", "-n", "1", ref]).stdout.strip().split()
          if parents != [manifest["commit"], manifest["parent"]]: raise RuntimeError("source commit is not the declared single-parent commit")
          raw = run(repo, ["diff-tree", "--no-commit-id", "--raw", "-r", "-z", manifest["parent"], ref]).stdout
          modes, changed = parse_raw_diff(raw)
          if any(old not in SAFE_CHANGED_MODES or new not in SAFE_CHANGED_MODES for old, new in modes): raise RuntimeError("symlink, gitlink, executable, or unsafe object mode")
          if changed != manifest["paths"] or any(COORDINATION.fullmatch(path) is None for path in changed): raise RuntimeError("quarantined paths do not equal closed manifest")
          ordered.append(manifest); previous = manifest["commit"]; del remaining[manifest["commit"]]
      return ordered


  def promote_one(spool: Path, repo: Path, manifest: dict, quarantine_prefix: str, run=run_git) -> dict:
      source_ref = f"{quarantine_prefix}/{manifest['id']}"
      promoted = run(repo, ["log", "origin/ops", "--format=%H", "--fixed-strings", f"--grep=KB-Outbox-ID: {manifest['id']}", "-1"]).stdout.strip()
      if not promoted:
          run(repo, ["cherry-pick", "--no-commit", source_ref])
          run(repo, ["commit", "-m", f"chore(outbox): promote {manifest['id']}", "-m", f"KB-Outbox-ID: {manifest['id']}"])
          promoted = run(repo, ["rev-parse", "HEAD"]).stdout.strip()
          run(repo, ["push", "origin", "ops"])
      promoted_at = utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z")
      return {"schema": "kb.ops-promotion/v1", "id": manifest["id"], "sourceCommit": manifest["commit"], "promotedCommit": promoted, "promotedAt": promoted_at}
  ```

  `parse_raw_diff` parses Git's NUL-delimited raw format without decoding paths early; it rejects malformed rows, duplicate paths, non-UTF-8, absolute paths, `..`, backslashes, and control characters and returns sorted paths. Thus modes `120000` and `160000` are rejected explicitly; only regular non-executable files and deletion are allowed. Return immediately when every manifest has a closed valid receipt; otherwise validate the entire source chain before selecting pending items. Compute `InstructionApproval` from the ordered instruction-bearing ids and SHA-256 of their canonical manifests. When that list is nonempty, verify exact closed approval bytes with `ssh-keygen -Y verify -I kb-ops-approver -n kb-ops-instructions` and the operator-supplied desktop allowed-signers file; a missing or mismatched signature leaves every ref quarantined and exits nonzero. Create a fresh clone for each bounded attempt; the `KB-Outbox-ID` trailer makes a retry after “push succeeded, receipt write failed” converge without a duplicate commit:

  ```py
  remote = run_git(operator_repo, ["remote", "get-url", "origin"]).stdout.strip()
  for attempt in range(1, max_attempts + 1):
      repo = work_root / f"attempt-{attempt}-{secrets.token_hex(8)}"
      run_process(["git", "clone", "--no-tags", "--branch", "ops", "--single-branch", remote, str(repo)])
      try:
          trusted = run_git(repo, ["rev-parse", "refs/remotes/origin/ops^{commit}"]).stdout.strip()
          if trusted != trusted_ops_head: raise RuntimeError("origin/ops does not equal the last trusted head")
          quarantine_prefix = f"refs/kb-quarantine/{run_id}"
          chain = validate_quarantine_chain(spool, repo, trusted, quarantine_prefix, run_git)
          require_instruction_approval(chain, approval, approval_signature, approval_allowed_signers)
          receipt = promote_one(spool, repo, manifest, quarantine_prefix, run_git)
          write_receipt_durably(spool / "receipts" / f"{manifest['id']}.json", receipt)
          break
      except subprocess.CalledProcessError:
          run_git(repo, ["cherry-pick", "--abort"], check=False)
          if attempt == max_attempts: failed += 1
  ```

  The operator checkout is queried only for `remote get-url origin`; tests snapshot its `HEAD`, index, worktree, refs, and reflog before promotion and require byte-for-byte equality afterward. Failed attempt clones are retained under `--work-root` for inspection. A later operator cleanup is separate from this CLI.

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

- [ ] Implement exact trusted-desktop approval verification before any instruction-bearing cherry-pick:

  ```py
  APPROVAL_KEYS = {"schema", "chainDigest", "firstParent", "lastCommit", "ids"}


  def require_instruction_approval(chain: list[dict], approval: Path | None, signature: Path | None, allowed_signers: Path | None, run=subprocess.run) -> None:
      instructions = [item for item in chain if any(INSTRUCTION.fullmatch(path) for path in item["paths"])]
      if not instructions: return
      if approval is None or signature is None or allowed_signers is None: raise RuntimeError("trusted-desktop approval is required for instruction-bearing paths")
      value = parse_closed_json(approval, APPROVAL_KEYS)
      canonical_manifests = b"".join((approval.parent / f"{item['id']}.manifest.json").read_bytes() for item in instructions)
      expected = {
          "schema": "kb.ops-instruction-approval/v1", "chainDigest": hashlib.sha256(canonical_manifests).hexdigest(),
          "firstParent": chain[0]["parent"], "lastCommit": chain[-1]["commit"], "ids": [item["id"] for item in instructions],
      }
      if value != expected: raise RuntimeError("trusted-desktop approval does not bind the quarantined chain")
      result = run(["ssh-keygen", "-Y", "verify", "-f", str(allowed_signers), "-I", "kb-ops-approver", "-n", "kb-ops-instructions", "-s", str(signature)], input=approval.read_bytes(), capture_output=True)
      if result.returncode != 0: raise RuntimeError("trusted-desktop approval signature failed")
  ```

  Before requesting approval, copy each canonical instruction manifest beside the approval file as `<id>.manifest.json`, write the expected closed `InstructionApproval` bytes, show the operator `git diff --stat` and `git diff --no-ext-diff --binary <parent> <quarantine-ref> -- <instruction paths>`, and exit 3. The trusted desktop signs exactly with `ssh-keygen -Y sign -f $env:KB_OPS_APPROVAL_KEY -n kb-ops-instructions instruction-approval.json`; the rerun verifies it. Neither the private key nor its value is copied to the VM or repository.

- [ ] After all manifests have receipts, create a return bundle from the exact pushed `origin/ops`, transfer it over SSH, and invoke the VM apply command. Implement the VM guard and ref replacement as:

  ```py
  def apply_reconciliation(repo: Path, spool: Path, bundle: Path, returned_receipts: Path, expected_source_head: str, expected_target_head: str, readiness=read_readiness, run=run_git) -> str:
      ready = readiness()
      if not ready.get("quiescent") or ready.get("blockers"):
          raise RuntimeError("ops reconciliation requires quiescent runtime")
      for source in sorted(returned_receipts.glob("*.json")):
          receipt = parse_closed_json(source, {"schema", "id", "sourceCommit", "promotedCommit", "promotedAt"})
          manifest_path = spool / "ready" / source.name
          manifest = parse_closed_json(manifest_path, MANIFEST_KEYS)
          if receipt.get("schema") != "kb.ops-promotion/v1" or receipt.get("id") != manifest.get("id") or receipt.get("sourceCommit") != manifest.get("commit"):
              raise RuntimeError("returned promotion receipt does not match its manifest")
          try: parsed = datetime.strptime(receipt["promotedAt"], "%Y-%m-%dT%H:%M:%S.%fZ")
          except (TypeError, ValueError): raise RuntimeError("promotion time is malformed")
          write_receipt_durably(spool / "receipts" / source.name, receipt)
      pending = [path for path in (spool / "ready").glob("*.json") if not (spool / "receipts" / path.name).exists()]
      if pending:
          raise RuntimeError("ops reconciliation refused with unreceipted outbox items")
      if run(repo, ["status", "--porcelain"]).stdout.strip():
          raise RuntimeError("ops reconciliation requires a clean checkout")
      head = run(repo, ["rev-parse", "HEAD"]).stdout.strip()
      if head != expected_source_head:
          raise RuntimeError("ops checkout advanced after promotion snapshot")
      manifests = validate_snapshot(spool)
      source_chain = order_from_parent(manifests, manifests[0]["parent"])
      if source_chain[-1]["commit"] != head: raise RuntimeError("source head is not the validated manifest-chain tip")
      trusted_base = source_chain[0]["parent"]
      run(repo, ["bundle", "verify", str(bundle)])
      run(repo, ["fetch", str(bundle), "refs/kb-reconciled/ops:refs/kb-reconciled/incoming"])
      target = run(repo, ["rev-parse", "refs/kb-reconciled/incoming"]).stdout.strip()
      if target != expected_target_head: raise RuntimeError("returned ref does not equal the trusted desktop target")
      anchor = run(repo, ["rev-parse", "refs/kb-outbox/spooled"]).stdout.strip()
      chain = run(repo, ["rev-list", "--reverse", "--parents", f"{trusted_base}..{target}"]).stdout.splitlines()
      previous = trusted_base
      for row in chain:
          fields = row.split()
          if len(fields) != 2 or fields[1] != previous: raise RuntimeError("reconciled ops history is not a single-parent chain")
          previous = fields[0]
      if previous != target: raise RuntimeError("reconciled target is not descended from source head")
      changed = nul_paths(run(repo, ["diff", "--name-only", "-z", trusted_base, target]).stdout)
      modes, raw_changed = parse_raw_diff(run(repo, ["diff", "--raw", "-z", trusted_base, target]).stdout)
      if raw_changed != sorted(changed) or any(old not in SAFE_CHANGED_MODES or new not in SAFE_CHANGED_MODES for old, new in modes):
          raise RuntimeError("reconciled ref contains an unsafe object mode")
      if any(COORDINATION.fullmatch(path) is None for path in changed):
          raise RuntimeError("reconciled ref contains a non-coordination path")
      if run(repo, ["diff", "--quiet", head, target]).returncode != 0: raise RuntimeError("promoted target tree differs from VM source chain")
      run(repo, ["branch", f"kb-before-reconcile-{head[:12]}", head])
      run(repo, ["reset", "--hard", target])
      run(repo, ["update-ref", "refs/kb-outbox/spooled", target, anchor])
      return target
  ```

  The CLI first calls `fetch_vm_outbox` into a fresh child of `--spool`; it never promotes directly from a changing remote directory. It compares `SOURCE_HEAD` to the last manifest commit and requires the first manifest parent to equal `--trusted-ops-head`. After the last successful push, fetch `origin/ops`, require `rev-parse refs/remotes/origin/ops` to equal the just-pushed target, run `git update-ref refs/kb-reconciled/ops refs/remotes/origin/ops`, create the return bundle from exactly that ref, and verify `git bundle list-heads` advertises exactly the expected target. Copy that bundle plus matching closed receipt JSON files to a fresh upload directory over SSH. The VM invokes the fixed root-owned apply CLI while holding `/run/lock/kb-maintenance.lock`; it secure-copies inputs by `O_NOFOLLOW` file descriptor into root-owned staging before the checks above. Only the VM-side durable receipt installation changes `/var/lib/kb/state/outbox/receipts`. The desktop deletes no source artifact or failed clone; receipts, quarantine refs, and the VM backup ref make the transition auditable and recoverable. Task 12 bootstrap installs the reviewed apply CLI under `/usr/local/lib/kb`; candidate release code is not the trust validator.

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

  it.each(['not-a-time', '2026-08-11', '2026-08-11T12:00:00+01:00'])('fails closed on malformed/noncanonical createdAt %s', (createdAt) => {
    const spool = fixtureManifest({ createdAt });
    expect(outboxStatus(spool)).toMatchObject({ degraded: true, reasons: ['manifest-invalid'] });
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
    const scan = readPendingManifestTimes(spoolRoot);
    const oldestAgeMs = scan.times.length === 0 ? 0 : Math.max(0, now() - Math.min(...scan.times));
    const reasons = [
      ...(scan.invalid ? ['manifest-invalid'] : []),
      ...(scan.pending >= maxPending ? ['pending-limit'] : []),
      ...(oldestAgeMs >= maxAgeMs ? ['oldest-age-limit'] : []),
    ];
    return { pending: scan.pending, oldestAgeMs, degraded: reasons.length > 0, reasons };
  }
  ```

  `readPendingManifestTimes` opens every unreceipted `*.json`, applies Task 16's exact closed key set, filename/id/commit equality, duplicate-key rejection, and canonical JSON check, and accepts `createdAt` only when `new Date(value).toISOString() === value`. It catches any I/O, JSON, schema, duplicate, non-finite time, or canonicalization failure and returns `{ pending: observedJsonCount, times: validEpochMilliseconds, invalid: true }`; it never converts malformed time to `NaN` or a healthy status.

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

Choice: the collector writes JSON plus a human-readable Markdown index outside the repository. It also establishes the one closed evidence payload used by every Gate 2 key: release artifact digest and commit, hashed host identity and boot id, exact redacted argv, canonical start/finish timestamps, result, and raw-output digest. VM jobs emit unsigned payloads because the VM holds no signing key; the trusted desktop verifies and signs each exact payload before Task 25 accepts it. The collector does not modify Tailscale configuration.

**Files**

- Create: `scripts/gates/phase1_gate1.py`
- Create: `tests/test_phase1_gate1.py`

**Interfaces**

- Produces CLI: `python3 scripts/gates/phase1_gate1.py --base-url URL --output DIR --session-env KB_GATE_SESSION --route-report FILE --acl-authorized FILE --acl-denied FILE`
- Produces: `gate1.json`, `gate1.md`, `tailscale-serve.json`, `tailscale-funnel.json`, `route-matrix.json`
- Produces: `AclProbeResult = { role: Literal['authorized', 'denied']; endpoint: str; outcome: Literal['reached', 'connection-refused', 'timeout'] }`
- Produces: `TailnetEvidence = { serveTailnetOnly: bool; funnelDisabled: bool; aclAuthorized: bool; aclDenied: bool }`
- Produces: `derive_tailnet_evidence(serve_status_json: str, funnel_status_json: str, acl_probe_results: list[AclProbeResult]) -> TailnetEvidence`
- Produces: `EvidencePayload = { schema: 'kb.phase1-evidence/v1'; key: str; passed: bool; release: { commit: str; artifactSha256: str }; host: { machineIdSha256: str; bootId: str }; command: list[str]; startedAt: str; finishedAt: str; rawOutput: { file: str; sha256: str } }`
- Produces desktop CLI: `python scripts/gates/phase1_gate1.py --sign-evidence FILE --signing-key PATH`
- Produces: `FILE.sig` via SSH signature namespace `kb-phase1-evidence`
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
      AclProbeResult(role="authorized", endpoint="https://kb.example.ts.net:443", outcome="reached"),
      AclProbeResult(role="denied", endpoint="https://kb.example.ts.net:443", outcome="connection-refused"),
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


  def test_evidence_payload_binds_release_host_command_time_and_raw_digest(tmp_path):
      raw = tmp_path / "raw.txt"; raw.write_bytes(b"ok\n")
      payload = build_evidence_payload("workerDrain", True, "a" * 40, "b" * 64, ["npm", "test"], "2026-08-11T12:00:00.000Z", "2026-08-11T12:01:00.000Z", raw, machine_id="vm-1", boot_id="11111111-1111-1111-1111-111111111111")
      assert payload["rawOutput"]["sha256"] == hashlib.sha256(b"ok\n").hexdigest()
      assert payload["host"]["machineIdSha256"] == hashlib.sha256(b"vm-1").hexdigest()
      assert set(payload) == {"schema", "key", "passed", "release", "host", "command", "startedAt", "finishedAt", "rawOutput"}
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
          "aclAuthorized": any(urlsplit(probe.endpoint).scheme == "https" and urlsplit(probe.endpoint).port == 443 and probe.outcome == "reached" for probe in authorized),
          "aclDenied": any(urlsplit(probe.endpoint).scheme == "https" and urlsplit(probe.endpoint).port == 443 and probe.outcome in {"connection-refused", "timeout"} for probe in denied),
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

- [ ] Add the shared closed evidence writer and desktop signer. `canonical_utc` accepts only exact millisecond UTC text and rejects reversed time; `safe_command` rejects empty argv, control characters, and any argument whose name matches `token|secret|password|session` case-insensitively:

  ```py
  EVIDENCE_KEYS = {"schema", "key", "passed", "release", "host", "command", "startedAt", "finishedAt", "rawOutput"}


  def build_evidence_payload(key: str, passed: bool, commit: str, artifact_sha256: str, command: list[str], started_at: str, finished_at: str, raw_file: Path, machine_id: str, boot_id: str) -> dict:
      start = canonical_utc(started_at); finish = canonical_utc(finished_at)
      if finish < start or re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", key) is None or type(passed) is not bool: raise RuntimeError("invalid evidence identity or time range")
      if re.fullmatch(r"[0-9a-f]{40}", commit) is None or re.fullmatch(r"[0-9a-f]{64}", artifact_sha256) is None: raise RuntimeError("invalid release evidence")
      argv = safe_command(command)
      return {
          "schema": "kb.phase1-evidence/v1", "key": key, "passed": passed,
          "release": {"commit": commit, "artifactSha256": artifact_sha256},
          "host": {"machineIdSha256": hashlib.sha256(machine_id.encode()).hexdigest(), "bootId": require_uuid(boot_id)},
          "command": argv, "startedAt": started_at, "finishedAt": finished_at,
          "rawOutput": {"file": raw_file.name, "sha256": sha256_file(raw_file)},
      }


  def sign_evidence(report: Path, signing_key: Path, run=subprocess.run) -> Path:
      value = parse_closed_evidence(report.read_bytes(), EVIDENCE_KEYS)
      signature = report.with_suffix(report.suffix + ".sig")
      signature.unlink(missing_ok=True)
      run(["ssh-keygen", "-Y", "sign", "-f", str(signing_key), "-n", "kb-phase1-evidence", str(report)], check=True)
      if not signature.is_file() or value["schema"] != "kb.phase1-evidence/v1": raise RuntimeError("evidence signing failed")
      return signature
  ```

  Import `dataclass`, `Literal`, `TypedDict`, `ipaddress`, and `urlsplit` for the shown types and parser. The HTTP probe sends no token first, then an `Authorization: Bearer` header whose value comes from the named environment key; it never writes the value to output. The route report is Vitest JSON from Task 14's complete route-matrix plus SSE/WebSocket tests; set `routeInventoryCovered` only when all named files and tests passed. Run `tailscale serve status --json` and `tailscale funnel status --json`, retain their raw output, parse them with `derive_tailnet_evidence`, and merge its four returned booleans into `evidence` before `decide(evidence)`. The parser accepts only documented `Web`/`Handlers`/`Proxy` Serve handlers whose targets are loopback and rejects every `AllowFunnel` entry from either status as a public listener. Parse the two operator-captured probe files into `AclProbeResult` rows, requiring the normalized external Serve endpoint `https://<tailnet-name>:443`: authorized reaches it and denied gets connection refusal or timeout. Port `4317` is only the loopback proxy target and is never an ACL probe endpoint.

- [ ] Run `python -m pytest tests/test_phase1_gate1.py -q` and verify the collector tests pass.

- [ ] Commit with `git add scripts/gates/phase1_gate1.py tests/test_phase1_gate1.py; git commit -m "test(gate): assemble phase one boundary evidence"`.

- [ ] After Tasks 1-19 have merged to `main`, deploy that exact immutable artifact from the desktop while the VM is locked and quiescent: `$releaseSha = git rev-parse origin/main; New-Item -ItemType Directory -Force "artifacts/$releaseSha" | Out-Null; gh run download --name "kb-platform-$releaseSha" --dir "artifacts/$releaseSha"; python scripts/deploy_platform_release.py "artifacts/$releaseSha/kb-platform-$releaseSha.tar.gz" "artifacts/$releaseSha/kb-platform-$releaseSha.attestation.json" --signing-key $env:KB_RELEASE_SIGNING_KEY --host $env:KB_VM_HOST`. Verify `/opt/kb-releases/current/VERSION` equals `$releaseSha` before probing.

- [ ] Run `python -m pytest tests/test_phase1_gate1.py -q`; on Ubuntu before production pruning, run `cd dashboard; npm test -- --reporter=json --outputFile=/var/lib/kb/gates/phase1/read-auth-vitest.json server/index.test.ts server/http/middleware.test.ts server/hub/sse.test.ts server/hub/ws.test.ts server/kb/routes.test.ts`. From one ACL-authorized tailnet client save `curl -fsS "$KB_TAILNET_URL/healthz"` output as `/var/lib/kb/gates/phase1/acl-authorized.txt`; from one ACL-denied client save the failed connection transcript as `/var/lib/kb/gates/phase1/acl-denied.txt`. On the staging VM run `gate_id=$(date -u +%Y%m%dT%H%M%SZ); python3 /opt/kb-releases/current/scripts/gates/phase1_gate1.py --base-url "$KB_TAILNET_URL" --output "/var/lib/kb/gates/phase1/gate1-$gate_id" --session-env KB_GATE_SESSION --route-report /var/lib/kb/gates/phase1/read-auth-vitest.json --acl-authorized /var/lib/kb/gates/phase1/acl-authorized.txt --acl-denied /var/lib/kb/gates/phase1/acl-denied.txt`; verify exit 0, then inspect the generated `gate1.md` and confirm it shows `PASS` while `/readyz` still reports execution locked.

- [ ] Present the complete generated directory to Daniel. Record approval outside the repository as `APPROVED.txt` in that directory; do not arm execution in this task.

## F2. Gate-2 runtime hardening

### Task 20: Disable Windows-only PTY, runner, and Vibe surfaces on Linux

Choice: Phase I does not port the interactive PTY or Task Scheduler runner, and it does not expose the separate Composer/Vibe subprocess surface from the VM identity. Linux reports all three as disabled, never constructs `powershell.exe`, never invokes `schtasks.exe`, and never spawns a Composer `claude` child; governed dashboard bridge execution remains available.

**Files**

- Create: `dashboard/server/runtime/capabilities.ts`
- Create: `dashboard/server/runtime/capabilities.test.ts`
- Create: `dashboard/server/runtime/evidence.ts`
- Create: `dashboard/server/runtime/evidence.test.ts`
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
- Produces: `RuntimeIdentity = { node: { realpath: string; version: string }; python: { command: string; realpath: string; version: string } }`
- Produces: `runEvidenceCommand(input: EvidenceCommand, io?: EvidenceIo): Promise<EvidencePayload>`
- Produces CLI: `node --experimental-strip-types server/runtime/evidence.ts --key KEY --release-commit SHA --artifact-sha256 SHA256 --raw FILE --report FILE -- COMMAND ARGS`
- Produces reports: `pythonProductionResolver.json`, `unsupportedVmSurfacesSafe.json`, and their named raw-output files
- Consumes: Task 19 `EvidencePayload`

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

  it('records executable paths and versions and derives pass only from the child exit', async () => {
    const result = await runEvidenceCommand(fixtureEvidenceCommand('pythonProductionResolver'), fakeEvidenceIo({ exitCode: 0, nodeRealpath: '/usr/bin/node', nodeVersion: 'v24.1.0', pythonRealpath: '/usr/bin/python3.13', pythonVersion: '3.13.5' }));
    expect(result.passed).toBe(true);
    expect(JSON.parse(readFileSync(result.rawOutput.file, 'utf8')).runtime).toEqual({ node: { realpath: '/usr/bin/node', version: 'v24.1.0' }, python: { command: 'python3', realpath: '/usr/bin/python3.13', version: '3.13.5' } });
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

- [ ] Implement the evidence runner so the report's `passed` value comes only from the spawned argv's exit code. It captures stdout/stderr to the named raw file, appends runtime identity obtained without a shell, and delegates canonical payload creation to a TypeScript port of Task 19's closed checks:

  ```ts
  export async function runEvidenceCommand(input: EvidenceCommand, io: EvidenceIo = productionEvidenceIo): Promise<EvidencePayload> {
    const startedAt = io.now().toISOString();
    const child = await io.run(input.command, input.cwd);
    const python = resolvePython('linux');
    const pythonIdentity = await io.run([python.command, ...python.prefixArgs, '-c', 'import os,sys;print(os.path.realpath(sys.executable));print(sys.version.split()[0])'], input.cwd);
    const runtime: RuntimeIdentity = {
      node: { realpath: io.realpath(process.execPath), version: process.version },
      python: { command: python.command, realpath: pythonIdentity.stdout.split(/\r?\n/)[0], version: pythonIdentity.stdout.split(/\r?\n/)[1] },
    };
    const raw = JSON.stringify({ commandExitCode: child.exitCode, stdout: child.stdout, stderr: child.stderr, runtime }, null, 2) + '\n';
    io.writeExclusiveAndFsync(input.rawFile, raw);
    const payload = buildEvidencePayload({ ...input, passed: child.exitCode === 0 && pythonIdentity.exitCode === 0, startedAt, finishedAt: io.now().toISOString(), rawSha256: sha256(raw), machineId: io.machineId(), bootId: io.bootId() });
    io.writeCanonicalExclusiveAndFsync(input.reportFile, payload);
    return payload;
  }
  ```

  `buildEvidencePayload` rejects unknown keys, a command containing a secret-bearing flag/value, noncanonical time, a report/raw path outside the requested evidence directory, and an existing output. The JSON `rawOutput.file` is the raw file's basename, never an absolute path. The test verifies the payload against Task 19's Python parser to prevent schema drift.

- [ ] Run `cd dashboard; npm test -- server/runtime/capabilities.test.ts server/runtime/evidence.test.ts server/index.test.ts server/http/surface.test.ts server/composer/routes.test.ts server/runner/trigger.test.ts server/runner/liveness.test.ts src/views/Terminal.test.tsx; npm run typecheck; npm test` and verify all tests pass on Windows and Ubuntu. On Ubuntu set `release_commit=$(cat /opt/kb-releases/current/VERSION)` and read `artifact_sha256` from the root-staged attestation through the root validator's digest-only CLI. Emit `pythonProductionResolver.json` with the exact argv `npm test -- server/runtime/capabilities.test.ts server/runtime/evidence.test.ts`; emit `unsupportedVmSurfacesSafe.json` with the argv-only `probe-unsupported-surfaces` subcommand in `evidence.ts`, which authenticates a Composer request, checks its 503, scans `/proc/$MainPID/cmdline` for `powershell.exe`/`schtasks.exe`, and scans descendants for the Composer child. Run each as `node --experimental-strip-types server/runtime/evidence.ts --key KEY --release-commit "$release_commit" --artifact-sha256 "$artifact_sha256" --raw "/var/lib/kb/gates/phase1/KEY.raw.json" --report "/var/lib/kb/gates/phase1/KEY.json" -- COMMAND ARGS`; require both report `passed` values true and preserve the files for Task 25.

- [ ] Commit with `git add dashboard/server/runtime/capabilities.ts dashboard/server/runtime/capabilities.test.ts dashboard/server/runtime/evidence.ts dashboard/server/runtime/evidence.test.ts dashboard/server/index.ts dashboard/server/index.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/http/surface.test.ts dashboard/server/composer/routes.ts dashboard/server/composer/routes.test.ts dashboard/server/runner/trigger.test.ts dashboard/server/runner/liveness.test.ts dashboard/src/views/Terminal.tsx dashboard/src/views/Terminal.test.tsx; git commit -m "fix(runtime): disable unsafe VM subprocess surfaces"`.

### Task 21: Make lock and shutdown drain every admitted execution

Choice: both activation lock and shutdown are asynchronous `unlocked -> locking -> locked` transitions. They close Task 22 limiter admission, cancel queued work, await the merged bridge's in-flight tick through `stopAndDrain()`, cancel and drain every registered worker (including a child that registers after draining begins), and then drain broker/Composer/Git/PTY. The state becomes `locked` only after every count is zero; systemd's 90-second stop window leaves a 30-second margin before cgroup termination.

**Files**

- Modify after checkpoint re-read: `dashboard/server/control/managedExecution.ts:26-52`
- Modify: `dashboard/server/control/managedExecution.test.ts:1-158`
- Modify: `dashboard/server/control/codexExecAdapter.ts:97-112,205-310`
- Modify: `dashboard/server/control/codexExecAdapter.test.ts:120-260`
- Modify after checkpoint re-read: `dashboard/server/control/activation.ts:167-262,414-570`
- Modify after checkpoint re-read: `dashboard/server/control/activation.test.ts:32-180,500-580`
- Modify after checkpoint re-read: `dashboard/server/control/queueBridge.ts:350-470,610-690`
- Modify after checkpoint re-read: `dashboard/server/control/queueBridge.test.ts:1-220`
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
- Changes: `ActivatedExecution.lock(timeoutMs?: number): Promise<LockDrainResult>`
- Produces: `LockDrainResult = { drained: boolean; queuedCancelled: number; remaining: string[] }`
- Produces: `QueueBridge.stopAndDrain(): Promise<void>`
- Changes: `SurfaceContext.lockExecution(): Promise<LockDrainResult>`
- Changes: every lock route/fleet STOP caller awaits `lockExecution()` and returns 503 while state is `locking`
- Produces report: `workerDrain.json` plus its named raw-output file
- Consumes: Task 11 `ExecutionLockState`, `QuiescenceSnapshot`; Task 20 `runEvidenceCommand()`

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

  it('immediately cancels a worker registered after drain begins and counts it until clear', async () => {
    const registry = createWorkerCancellationRegistry();
    registry.register('stuck', () => undefined);
    const pending = registry.drain(100);
    const lateCancel = vi.fn(); registry.register('late', lateCancel);
    expect(lateCancel).toHaveBeenCalledOnce();
    expect(registry.activeCount()).toBe(2);
    registry.clear('stuck'); registry.clear('late');
    await expect(pending).resolves.toEqual({ drained: true, remaining: [] });
  });

  it('does not report locked until queued work, bridge tick, and live worker drain', async () => {
    const h = lockHarness({ queued: ['q1'], bridgeTickHeld: true, workerHeld: true });
    const pending = h.lock();
    expect(h.state()).toBe('locking');
    expect(h.cancelledQueued()).toEqual(['q1']);
    h.releaseBridge(); await Promise.resolve(); expect(h.state()).toBe('locking');
    h.releaseWorker(); await pending; expect(h.state()).toBe('locked');
  });

  it('stopAndDrain waits for the current tick and prevents another tick', async () => {
    const h = bridgeHarnessWithHeldTick();
    const pending = h.bridge.stopAndDrain();
    expect(h.drained).toBe(false); h.releaseTick(); await pending;
    await h.advancePollInterval(); expect(h.tickCount()).toBe(1);
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
    reopen(): void;
  }

  export function createWorkerCancellationRegistry(): WorkerCancellationRegistry {
    const cancels = new Map<string, () => void>();
    const waiters = new Set<() => void>();
    let draining = false;
    const notify = () => { if (cancels.size === 0) for (const waiter of [...waiters]) waiter(); };
    return {
      register(key, cancel) { cancels.set(key, cancel); if (draining) cancel(); },
      cancel(key) { cancels.get(key)?.(); },
      clear(key) { cancels.delete(key); notify(); },
      activeCount() { return cancels.size; },
      async drain(timeoutMs) {
        draining = true;
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
      reopen() { if (cancels.size !== 0) throw new Error('cannot reopen worker admission before drain'); draining = false; },
    };
  }
  ```

- [ ] Register the Codex process kill immediately after spawn and clear it in the one settle/finally path. Pass the same registry seams to both post-merge Claude and Codex adapters in `activation.ts`; expose `drainWorkers` and `activeWorkers`. Do not edit `claudeWorkerAdapter.ts`.

- [ ] Amend the merged bridge with one explicit in-flight promise; `tick()` owns it until its `finally`, and stop is idempotent:

  ```ts
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  async function runTick(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = tick().finally(() => { inFlight = undefined; });
    await inFlight;
  }
  async function stopAndDrain(): Promise<void> {
    stopped = true;
    if (timer) { clearInterval(timer); timer = undefined; }
    await inFlight;
  }
  ```

  The existing synchronous `stop()` becomes a private timer-closing helper; every production caller uses and awaits `stopAndDrain()`. A later `start()` is allowed only after an approved unlock and creates one new timer.

- [ ] Replace the activation boolean setter with one coordinator used by the lock route, fleet STOP, startup-locked path, and surface `preClose`:

  ```ts
  async function lockExecution(timeoutMs = 60_000): Promise<LockDrainResult> {
    if (executionState === 'locked') return { drained: true, queuedCancelled: 0, remaining: [] };
    if (lockPromise) return await lockPromise;
    executionState = 'locking';
    lockPromise = (async () => {
      const queuedCancelled = resourceAdmission.closeAndCancel('execution-lock');
      await bridge.stopAndDrain();
      broker.drain();
      const workers = await activatedExecution.drainWorkers(timeoutMs);
      await Promise.all([drainAsyncGit(), drainVibeProcesses(), ptyHost?.drain() ?? Promise.resolve()]);
      const remaining = [...workers.remaining, ...liveResourceKeys()].sort();
      if (!workers.drained || remaining.length > 0 || resourceAdmission.queuedCount() > 0) return { drained: false, queuedCancelled, remaining };
      executionState = 'locked';
      return { drained: true, queuedCancelled, remaining: [] };
    })().finally(() => { lockPromise = undefined; });
    return await lockPromise;
  }
  ```

  On timeout, remain `locking`, return/raise a 503 `execution-drain-incomplete`, and let systemd cgroup termination be the final shutdown fence; never report quiescent. Unlock refuses from `locking`; from `locked`, it calls `workerRegistry.reopen()`, reopens Task 22 admission, and starts the bridge only after the existing approval checks succeed. Feed `executionState`, `bridge.stopped`, `resourceAdmission.queuedCount()`, and `activeWorkers()` into Task 11 readiness.

- [ ] Run `cd dashboard; npm test -- server/control/managedExecution.test.ts server/control/codexExecAdapter.test.ts server/control/activation.test.ts server/control/queueBridge.test.ts server/http/surface.test.ts; npm run typecheck; npm test` and verify all tests pass. On Ubuntu emit Task 20's closed report with `node --experimental-strip-types server/runtime/evidence.ts --key workerDrain --release-commit "$release_commit" --artifact-sha256 "$artifact_sha256" --raw /var/lib/kb/gates/phase1/workerDrain.raw.json --report /var/lib/kb/gates/phase1/workerDrain.json -- npm test -- server/control/managedExecution.test.ts server/control/codexExecAdapter.test.ts server/control/activation.test.ts server/control/queueBridge.test.ts server/http/surface.test.ts`; require `passed: true` and preserve both files for Task 25.

- [ ] Commit with `git add dashboard/server/control/managedExecution.ts dashboard/server/control/managedExecution.test.ts dashboard/server/control/codexExecAdapter.ts dashboard/server/control/codexExecAdapter.test.ts dashboard/server/control/activation.ts dashboard/server/control/activation.test.ts dashboard/server/control/queueBridge.ts dashboard/server/control/queueBridge.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/http/surface.test.ts; git commit -m "fix(control): drain workers before daemon shutdown"`.

### Task 22: Enforce per-resource-class concurrency limits

Choice: Phase I limits control transitions to 4, general agent workers to 2, render workers to 1, live PTYs to 4, and ops-checkout Git transactions to 1. The limiter is also Task 21's admission fence: lock atomically closes every class, rejects new work, cancels every queued promise with a typed error, exposes a total queued count to readiness, and reopens only after an approved unlock. Limits are configurable positive integers; zero/unbounded is refused.

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
- Produces: `ResourceLimiter.closeAndCancel(reason: string): number`
- Produces: `ResourceLimiter.open(): void`
- Produces: `ResourceLimiter.queuedCount(): number`
- Produces: `ResourceLimiter.accepting(): boolean`
- Produces: `createResourceLimiter(limits?: Partial<Record<ResourceClass, number>>): ResourceLimiter`
- Produces: `runtimeResourceLimiter: ResourceLimiter`
- Produces: `limitWorkerAdapter(adapter: WorkerAdapter, limiter: ResourceLimiter): WorkerAdapter`
- Produces report: `resourceLimits.json` plus its named raw-output file
- Consumes: Task 20 `runEvidenceCommand()`; Task 21 activation-lock coordinator

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

  it('closes admission and rejects all queued work before lock can drain', async () => {
    const limiter = createResourceLimiter({ agents: 1 });
    let release!: () => void;
    const active = limiter.run('agents', () => new Promise<void>((resolve) => { release = resolve; }));
    const queued = limiter.run('agents', async () => undefined);
    await Promise.resolve();
    expect(limiter.closeAndCancel('execution-lock')).toBe(1);
    await expect(queued).rejects.toMatchObject({ name: 'ExecutionAdmissionClosedError', reason: 'execution-lock' });
    await expect(limiter.run('control', async () => undefined)).rejects.toMatchObject({ name: 'ExecutionAdmissionClosedError' });
    expect(limiter.queuedCount()).toBe(0); release(); await active;
    limiter.open(); await expect(limiter.run('control', async () => undefined)).resolves.toBeUndefined();
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
    closeAndCancel(reason: string): number;
    open(): void;
    queuedCount(): number;
    accepting(): boolean;
  }
  const DEFAULTS: Record<ResourceClass, number> = { control: 4, agents: 2, render: 1, pty: 4, git: 1 };

  export function createResourceLimiter(overrides: Partial<Record<ResourceClass, number>> = {}): ResourceLimiter {
    const limits = { ...DEFAULTS, ...overrides };
    for (const [kind, value] of Object.entries(limits)) if (!Number.isInteger(value) || value < 1) throw new Error(`${kind} concurrency must be a positive integer`);
    type Waiter = { resolve: () => void; reject: (error: Error) => void };
    const state = Object.fromEntries(Object.keys(limits).map((kind) => [kind, { active: 0, queue: [] as Waiter[] }])) as Record<ResourceClass, { active: number; queue: Waiter[] }>;
    let admission: { accepting: true } | { accepting: false; reason: string } = { accepting: true };
    async function run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T> {
      if (!admission.accepting) throw new ExecutionAdmissionClosedError(admission.reason);
      const slot = state[kind];
      if (slot.active >= limits[kind]) await new Promise<void>((resolve, reject) => slot.queue.push({ resolve, reject }));
      if (!admission.accepting) throw new ExecutionAdmissionClosedError(admission.reason);
      slot.active += 1;
      try { return await operation(); }
      finally { slot.active -= 1; slot.queue.shift()?.resolve(); }
    }
    return {
      run,
      observePty(active) { if (!Number.isInteger(active) || active < 0) throw new Error('PTY active count must be a non-negative integer'); state.pty.active = active; },
      snapshot: () => Object.fromEntries((Object.keys(limits) as ResourceClass[]).map((kind) => [kind, { limit: limits[kind], active: state[kind].active, queued: state[kind].queue.length }])) as ResourceSnapshot,
      closeAndCancel(reason) {
        if (!reason || /[\r\n]/.test(reason)) throw new Error('admission close reason is invalid');
        admission = { accepting: false, reason };
        let cancelled = 0;
        for (const slot of Object.values(state)) while (slot.queue.length) { slot.queue.shift()!.reject(new ExecutionAdmissionClosedError(reason)); cancelled += 1; }
        return cancelled;
      },
      open() { if (Object.values(state).some((slot) => slot.active || slot.queue.length)) throw new Error('cannot reopen a non-drained limiter'); admission = { accepting: true }; },
      queuedCount: () => Object.values(state).reduce((total, slot) => total + slot.queue.length, 0),
      accepting: () => admission.accepting,
    };
  }

  export const runtimeResourceLimiter = createResourceLimiter();

  export class ExecutionAdmissionClosedError extends Error {
    readonly name = 'ExecutionAdmissionClosedError';
    constructor(readonly reason: string) { super(`execution admission is closed: ${reason}`); }
  }

  export function limitWorkerAdapter(adapter: WorkerAdapter, limiter: ResourceLimiter): WorkerAdapter {
    return { execute: (input) => limiter.run(/(?:^|:)render(?:$|:)/.test(input.action) ? 'render' : 'agents', () => adapter.execute(input)) };
  }
  ```

- [ ] Inject `runtimeResourceLimiter` into the surface context. Wrap both worker adapters without changing them, wrap each activated `runAutomatic` call in `control`, and replace the private Git FIFO's acquire/release with `runtimeResourceLimiter.run('git', ...)` while preserving `AsyncLocalStorage` reentrancy. Pass `runtimeResourceLimiter.snapshot().pty.limit` as the existing `PtyRouteContext.maxConcurrent`, and call `runtimeResourceLimiter.observePty(registry.liveCount())` before readiness/operational snapshots. Wire `closeAndCancel`, `queuedCount`, and `open` into Task 21's activation-lock coordinator; startup calls `closeAndCancel('startup-locked')`, and only successful approved unlock calls `open()`. Feed `queuedCount()` to Task 11. Tests inject a fresh limiter; production uses the singleton so telemetry observes every class.

- [ ] Add a worker-wrapper test proving `build:render` queues under `render` while `report:self-lint` consumes `agents`, retain the existing PTY `too-many-terminals` assertion with default 4, and prove startup/lock/unlock close-cancel-reopen order in `activation.test.ts`. Run `cd dashboard; npm test -- server/control/resourceLimits.test.ts server/write/asyncGit.test.ts server/control/activation.test.ts server/pty/route.test.ts; npm run typecheck; npm test` on Windows and Ubuntu. On Ubuntu emit Task 20's closed report with `node --experimental-strip-types server/runtime/evidence.ts --key resourceLimits --release-commit "$release_commit" --artifact-sha256 "$artifact_sha256" --raw /var/lib/kb/gates/phase1/resourceLimits.raw.json --report /var/lib/kb/gates/phase1/resourceLimits.json -- npm test -- server/control/resourceLimits.test.ts server/write/asyncGit.test.ts server/control/activation.test.ts server/pty/route.test.ts`; require `passed: true` and preserve both files for Task 25.

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

Choice: the canary is an explicit, watched VM command using the real `report:self-lint` scanner worker and service. This task also implements the boot recovery supervisor (folded here rather than a new Task 24a): the bridge durably records the real card-to-run mapping and the dispatch's already-approved authority before execution; after a crash, a supervisor may claim and resume only that interrupted run, after fencing its old process identity. It cannot unlock execution, claim another card, or create fresh authority. The canary never runs in CI or arms execution and accepts its restart-surviving session capability only from an inherited file descriptor/stdin.

**Files**

- Create: `dashboard/server/acceptance/linuxDispatchCanary.ts`
- Create: `dashboard/server/acceptance/linuxDispatchCanary.test.ts`
- Create: `dashboard/server/control/recoverySupervisor.ts`
- Create: `dashboard/server/control/recoverySupervisor.test.ts`
- Modify after checkpoint re-read: `dashboard/server/control/synthetic-acceptance.ts:45-100`
- Modify after checkpoint re-read: `dashboard/server/control/queueBridge.ts:420-470,620-680`
- Modify after checkpoint re-read: `dashboard/server/control/queueBridge.test.ts:1-220`
- Modify after checkpoint re-read: `dashboard/server/control/activation.ts:414-570`
- Modify after checkpoint re-read: `dashboard/server/control/activation.test.ts:500-620`
- Modify: `dashboard/server/http/surface.ts:120-205`
- Modify: `dashboard/server/http/surface.test.ts:820-940`
- Modify: `dashboard/server/auth/session.test.ts:1-180`

**Interfaces**

- Produces: `CardRunReceipt = { schema: 'kb.card-run-receipt/v1'; cardId: string; bridgeDefinitionId: string; runRef: string; attemptRef: string; authority: { kind: 'approved-interrupted-run'; grantDigest: string; approvedAt: string }; dispatchedAt: string; bootId: string }`
- Produces: `RecoveryClaim = { schema: 'kb.recovery-claim/v1'; runRef: string; previousAttemptRef: string; successorAttemptRef: string; fromBootId: string; claimedByBootId: string; claimedAt: string }`
- Produces: `LinuxCanaryReport = { version: 2; platformVersion: string; cardId: string; runReceiptSha256: string; runRef: string; recoveryClaimSha256: string; pythonCommand: 'python3'; states: string[]; restartObserved: boolean; recovered: boolean; integrationPath: string; ledgerSettled: boolean; passed: boolean }`
- Produces: `writeCardRunReceipt(stateRoot: string, receipt: CardRunReceipt): void`
- Produces: `recoverApprovedInterruptedRuns(deps: RecoveryDeps): Promise<RecoveryClaim[]>`
- Produces: `CanaryDeps.systemctl(args: readonly string[]): Promise<void>`
- Produces CLI: `node --experimental-strip-types server/acceptance/linuxDispatchCanary.ts --confirm-live --capability-fd 0 --output PATH`
- Produces restore CLI: `node --experimental-strip-types server/acceptance/linuxDispatchCanary.ts --restore-drill --base-url URL --state-root PATH --capability-fd 0 --output PATH`
- Consumes after checkpoint: bridge definition synthesis `bridge-${cardId}`, durable `CardRunReceipt`, run/attempt boot normalization, and worker finalize-on-result behavior
- Consumes: Task 2 `resolvePython()`, Task 16 outbox mode, and systemd `Restart=on-failure` plus `KillMode=control-group`
- Consumes: Task 12 root-owned persistent `/etc/kb-dashboard/session.env`; Task 20 `EvidencePayload`

- [ ] Add a failing state-machine decision test:

  ```ts
  it('passes only after card, bridge, integration, settlement, restart interruption, and recovery', () => {
    const report = decideCanary({
      platform: 'linux', platformVersion: 'a'.repeat(40), pythonCommand: 'python3', cardId: 'card-1', runRef: 'run-1',
      runReceiptSha256: 'b'.repeat(64), recoveryClaimSha256: 'c'.repeat(64),
      states: ['queued', 'starting', 'running', 'interrupted', 'recovering', 'succeeded'],
      restartObserved: true, integrationPath: 'orgs/kb-ops/output/synthetic-acceptance.md',
      integrationContent: 'SYNTHETIC-ACCEPTANCE-OK\n', triggerState: 'done', ledgerRows: 1,
    });
    expect(report).toMatchObject({ recovered: true, ledgerSettled: true, passed: true });
    expect(decideCanary({
      platform: 'linux', platformVersion: 'a'.repeat(40), pythonCommand: 'py', cardId: 'card-1', runRef: 'run-1',
      runReceiptSha256: 'b'.repeat(64), recoveryClaimSha256: 'c'.repeat(64),
      states: ['queued', 'running', 'interrupted', 'recovering', 'succeeded'],
      restartObserved: true, integrationPath: 'orgs/kb-ops/output/synthetic-acceptance.md',
      integrationContent: 'SYNTHETIC-ACCEPTANCE-OK\n', triggerState: 'done', ledgerRows: 1,
    }).passed).toBe(false);
  });

  it('refuses off Linux, without confirmation, or while execution is locked', () => {
    expect(() => assertLinuxCanaryGate('win32', ['--confirm-live'], { executionState: 'unlocked' })).toThrow(/Linux/);
    expect(() => assertLinuxCanaryGate('linux', [], { executionState: 'unlocked' })).toThrow(/confirm-live/);
    expect(() => assertLinuxCanaryGate('linux', ['--confirm-live'], { executionState: 'locked' })).toThrow(/locked/);
  });

  it('maps a card through the durable receipt even though the bridge definition id is synthesized', async () => {
    const h = queueBridgeReceiptHarness({ cardId: 'card-1', definitionId: 'bridge-card-1', runRef: 'run-9', attemptRef: 'attempt-9' });
    await h.tick();
    expect(h.readReceipt('card-1')).toMatchObject({ cardId: 'card-1', bridgeDefinitionId: 'bridge-card-1', runRef: 'run-9', attemptRef: 'attempt-9' });
    expect(await h.canary.waitForCardRun('card-1')).toBe('run-9');
  });

  it('recovers only an interrupted run with a durable approved receipt and one exclusive claim', async () => {
    const h = recoveryHarness({ receipt: 'approved', runState: 'interrupted', oldProcess: 'gone' });
    await expect(recoverApprovedInterruptedRuns(h.deps)).resolves.toHaveLength(1);
    await expect(recoverApprovedInterruptedRuns(h.deps)).resolves.toHaveLength(0);
    expect(h.startedFreshRuns).toBe(0); expect(h.successorAttempts).toBe(1);
  });

  it.each(['missing-receipt', 'grant-mismatch', 'running', 'terminal', 'old-process-unfenced'])('refuses recovery for %s', async (defect) => {
    const h = recoveryHarness({ defect });
    await expect(recoverApprovedInterruptedRuns(h.deps)).rejects.toThrow();
    expect(h.successorAttempts).toBe(0);
  });

  it('keeps a session capability valid across process restart with the persistent secret file', async () => {
    const secretFile = rootOwnedSessionFixture('d'.repeat(64));
    const token = issueSessionFromFile(secretFile);
    expect(validateSessionFromFile(secretFile, token, { processId: 1 })).toBe(true);
    expect(validateSessionFromFile(secretFile, token, { processId: 2 })).toBe(true);
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
