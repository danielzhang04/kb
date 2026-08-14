# KB Structure Phase I Implementation Plan

**Goal:** Cut the current dashboard/VM runtime over to an immutable, recoverable, credential-free Phase I platform while adding the versioned schema and repository-registry prerequisites required by Phase II.

**Architecture:** Keep the monorepo as the only source repository, but separate the VM into a read-only versioned platform release, a data-only ops checkout, and an external state root. Coordination commits enter a durable VM outbox and are promoted by the desktop; all execution remains behind the existing lock and the two evidence-backed cutover gates. Schema compatibility and repository identity are checked at startup and proposal activation so unsupported or ambiguously targeted work fails before side effects.

**Tech stack:** Node.js 24, TypeScript, Fastify, React, Vitest, Python 3.12, pytest, Git/Git bundles, GitHub Actions, Ubuntu, systemd, and restic.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

## Ruling log

- **Daniel, 2026-08-12 — restart authority:** no persistent secret or credential is stored on the VM, including a local dashboard HMAC key. A daemon restart drops every session and all execution authority. The restart canary observes durable files across the restart; any authenticated post-restart action requires Daniel to re-arm with his passkey. No machine-auth path, service token, bearer handoff, or replacement credential is permitted.
- **Daniel, 2026-08-12 — delivery partition:** merge-independent Phase I work ships now. Execution-plane work whose correct signatures depend on the workflow-platform merge is an explicit sub-plan gated on the merged `origin/main` tip at or after `804acec`; its acceptance criteria are fixed here, and its failing tests are written only after the merged files are re-read.

## Global Constraints

- The monorepo remains the sole source repository.
- The platform is built on merge into an immutable, versioned VM release artifact.
- The running platform is never a live checkout that shares state with data.
- The VM stores no credential of any kind. It has no GitHub, backup-store, signing, deploy, SSH-agent, dashboard-session, or other external-authority credential.
- During a GitHub outage, reads remain live and the outbox grows visibly with bounded retry and reconciliation; new side-effecting work follows the degraded-mode policy rather than silently losing state.
- Cutover Gate 1 (read-only web) does not arm the daemon or transfer execution authority.
- The Linux canary is run with production command resolution, not the test-only `python3` substitution.
- Existing platform-specific PTY and runner behavior is either made Linux-capable or disabled outside its supported platform.
- The corrected dashboard-bridge finding does not relax the Phase I Gate 1 boundary.
- The Phase I Gate 1 boundary establishes only an authenticated read plane; Gate 2 establishes the controlled VM execution plane. Neither gate changes GitHub trust anchors or authorizes a repository split.
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
- Never add a credential value, credential document, GitHub token, deploy key, signing key, backup-store key, SSH agent socket, or credential-bearing remote to the VM. `credentialIdentity` is a recorded non-secret label, not operational authority in Phase I.
- Ship-now Tasks 1-8, 10-20, and 22 may land without the workflow-platform merge, subject to their stated ordering. Task 13's recovery-canary hook, Task 18's bridge-claim admission hook, and Task 22's activation/worker wiring are deferred with Tasks 9, 21, and 23-25. The explicit workflow-platform checkpoint blocks only that deferred execution-plane sub-plan.

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

Choice: the registry hashes the checked-in symbolic root record before expanding `${DASHBOARD_REPO_ROOT}`. The identity is therefore stable across desktop and VM absolute paths, while any change to the root contract, remote, base ref, scope, or credential label changes the identity. This ship-now loader enforces root, scope, identity, and the closed Phase-I declaration `baseRef: ops`; deferred Task 9 enforces that declaration against the merged activation checkout's actual `HEAD`. `remote` and `credentialIdentity` are recorded and hash-bound but explicitly not operationally enforced until the Phase II external-repository canary; they grant no authority.

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

Choice: `/readyz` exposes only the current execution-lock state and process counts; it contains no repository data. In the ship-now Gate-1 posture, execution is locked and the current bridge has no admitted internal queue. The asynchronous `locking -> locked` coordinator that closes merged admission, cancels queued work, stops the bridge, and drains registered workers is deferred below the workflow-platform checkpoint.

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

- [ ] Add these read-only counters beside the existing drain functions, pin each with its current drain test, and add an injectable asynchronous `readiness` function to `SurfaceContext` backed by the current activation-latch snapshot, current bridge started/stopped state, an exact zero queued count for the pre-merge launch path, the counters, `ptySessions.size()`, and `serviceCgroupChildCount()`:

  ```ts
  export function activeAsyncGitCount(): number { return liveChildren.size; }
  export function activeVibeProcessCount(): number { return activeVibeProcesses.size; }
  ```

  Register before authenticated routes:

  ```ts
  app.get('/readyz', async () => await surfaceCtx.readiness());
  ```

  Keep `/healthz` unchanged. The deferred coordinator must preserve this public return shape when it replaces the initial worker/queue/bridge inputs after the merged signatures are known. If cgroup identity cannot be read, readiness fails closed with `service-cgroup-unknown` and `quiescent: false`.

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
          activate_release.copy_and_verify_upload(tmp_path, tmp_path / "stage", fake_io(events, signature_ok=False))
      assert events == ["secure-copy", "secure-copy", "secure-copy", "verify-signature"]


  def test_activation_refuses_staging_not_owned_by_root_or_not_mode_0700():
      with pytest.raises(RuntimeError, match="root:root 0700"):
          require_root_staging(SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=stat.S_IFDIR | 0o700))
      with pytest.raises(RuntimeError, match="root:root 0700"):
          require_root_staging(SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFDIR | 0o755))
  ```

  ```py
  @pytest.mark.parametrize("name", ["GITHUB_TOKEN", "GH_TOKEN", "GIT_ASKPASS", "SSH_AUTH_SOCK", "DASHBOARD_SESSION_SECRET", "KB_CANARY_SESSION", "OPENAI_API_KEY", "AWS_ACCESS_KEY_ID"])
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
  from types import SimpleNamespace
  from typing import Protocol

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


  def require_root_staging(value: os.stat_result) -> None:
      if value.st_uid != 0 or value.st_gid != 0 or not stat.S_ISDIR(value.st_mode) or stat.S_IMODE(value.st_mode) != 0o700:
          raise RuntimeError("release staging must be root:root 0700")


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
          source_stat = os.fstat(source_fd)
          if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_nlink != 1:
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


  class ActivationIo(Protocol):
      def secure_copy(self, source: Path, destination: Path) -> None: ...
      def verify_signature(self, attestation: Path, signature: Path) -> None: ...
      def run(self, argv: list[str], **kwargs) -> subprocess.CompletedProcess: ...
      def wait_healthy(self) -> None: ...


  def production_activation_io() -> ActivationIo:
      return SimpleNamespace(secure_copy=secure_copy, verify_signature=verify_signature, run=subprocess.run, wait_healthy=wait_healthy)


  def copy_and_verify_upload(upload_dir: Path, stage: Path, io: ActivationIo | None = None) -> None:
      io = io or production_activation_io()
      for name in ("release.tar.gz", "attestation.json", "attestation.json.sig"):
          io.secure_copy(upload_dir / name, stage / name)
      io.verify_signature(stage / "attestation.json", stage / "attestation.json.sig")


  def activate_from_upload(upload_dir: Path, paths: RuntimePaths = RuntimePaths(), io: ActivationIo | None = None) -> str:
      io = io or production_activation_io()
      if os.geteuid() != 0: raise RuntimeError("activation requires root")
      stage = paths.staging / secrets.token_hex(16)
      stage.mkdir(mode=0o700)
      require_root_staging(stage.stat())
      copy_and_verify_upload(upload_dir, stage, io)
      attestation = parse_attestation((stage / "attestation.json").read_bytes())
      archive = stage / "release.tar.gz"
      actual = sha256_file(archive)
      if not hmac.compare_digest(attestation["sha256"], actual): raise RuntimeError("release digest mismatch")
      if paths.current.exists():
          require_quiescence(read_readiness(), "release activation")
      elif io.run(["systemctl", "is-active", "--quiet", "kb-dashboard.service"]).returncode == 0:
          raise RuntimeError("initial activation requires the old live-checkout service to be stopped")
      version = attestation["sourceCommit"]
      destination = paths.releases / version
      extract_read_only(archive, destination)
      if (destination / "VERSION").read_text(encoding="ascii").strip() != version: raise RuntimeError("release VERSION mismatch")
      io.run(["python3", "/usr/local/lib/kb/validate_vm_runtime.py", "--ops-root", str(paths.ops_root), "--unit", "kb-dashboard.service"], check=True)
      old = paths.current.resolve() if paths.current.exists() else None
      if old is not None: atomic_link(paths.previous, old)
      atomic_link(paths.current, destination)
      io.run(["systemctl", "restart", "kb-dashboard.service"], check=True)
      io.wait_healthy()
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
  ```

  Add pytest assertions that the old service stops before clone, `DATA_PATTERNS` excludes `dashboard`, `scripts`, `schemas`, `deploy`, and `.github`, both remote URLs are disabled, staging stays root-owned, neither bootstrap nor the unit creates or reads a session-secret file, and generated validator source contains the exact supplied public key but no private key. Do not set `DASHBOARD_SESSION_SECRET`: `auth/session.ts` must retain its process-local random secret, so every daemon restart invalidates every session and restores the locked, human-re-arm-required posture. On the desktop create the seed with `git bundle create kb-ops-bootstrap.bundle ops`, derive the public key with `ssh-keygen -y -f $env:KB_RELEASE_SIGNING_KEY | Set-Content -NoNewline kb-release-signing.pub`, transfer the bundle, public key, and reviewed deploy scripts, run bootstrap once, install the unit and validators under `/etc/systemd/system` and `/usr/local/lib/kb`, delete the transferred public-key input after installation, then use the normal desktop deploy command for the first release.

- [ ] Implement `validate_vm_runtime.py` so it inspects names only, never prints values, and enforces the data-only checkout and disabled push remote:

  ```py
  FORBIDDEN_ENV = frozenset({"GITHUB_TOKEN", "GH_TOKEN", "GIT_ASKPASS", "SSH_AUTH_SOCK", "DASHBOARD_SESSION_SECRET", "KB_CANARY_SESSION"})
  CREDENTIAL_ENV_NAME = re.compile(r"(?i)(?:TOKEN|SECRET|PASSWORD|PASSKEY|CREDENTIAL|API_KEY|ACCESS_KEY|AUTH_SOCK|ASKPASS|COOKIE|SESSION)")
  EXPECTED_UNIT_ENV = {"DASHBOARD_PLATFORM_ROOT", "PYTHONPATH", "DASHBOARD_REPO_ROOT", "DASHBOARD_STATE_ROOT", "DASHBOARD_EXECUTION_ACTIVATED", "KB_COORDINATION_PUBLICATION", "KB_VM_RUNTIME", "GIT_CONFIG_GLOBAL"}


  def validate_environment(env: dict[str, str]) -> None:
      present = sorted(name for name in env if name in FORBIDDEN_ENV or CREDENTIAL_ENV_NAME.search(name))
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
      if show["EnvironmentFiles"]:
          raise RuntimeError("effective unit must not load credential-bearing environment files")
      if "/usr/bin/node" not in show["ExecStart"]:
          raise RuntimeError("effective unit executable mismatch")
      if not show["ControlGroup"].startswith("/system.slice/kb-dashboard.service"):
          raise RuntimeError("effective unit cgroup mismatch")
      assigned = {match.group(1) for match in re.finditer(r"(?m)^Environment=(?:\"?)([A-Za-z_][A-Za-z0-9_]*)=", text)}
      if assigned != EXPECTED_UNIT_ENV:
          raise RuntimeError("dashboard unit environment assignment set is not closed")
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

  The CLI runs `validate_environment(dict(os.environ))`, `validate_ops_root(args.ops_root)`, `read_effective_unit(args.unit)`, and `validate_effective_unit(show, text)` in that order and exits nonzero on any refusal. It prints only field names and refusal text, never environment values. Tests also inject a malicious drop-in via a fake `systemctl cat` result and prove refusal, and prove any nonempty `EnvironmentFiles` value is rejected.

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
  UnsetEnvironment=GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK DASHBOARD_SESSION_SECRET KB_CANARY_SESSION
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

  Add `deploy` to Task 10's `RELEASE_ROOTS` now that this task creates that directory, and assert this task's deploy files are archived. Task 13 adds the archive assertion for `deploy/export_tier0.py` when it creates that file. Root validators remain bootstrap-installed trust code and are never refreshed from the candidate archive.

- [ ] Run `python -m pytest tests/test_deploy_release.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py -q`. On a fresh Ubuntu staging VM run the documented bundle/bootstrap transition, then deploy one signed artifact; run `sudo test "$(stat -c '%U:%G:%a' /var/lib/kb-release-staging)" = 'root:root:700'; sudo test ! -e /etc/kb-dashboard/session.env; sudo systemctl show kb-dashboard.service -p FragmentPath -p DropInPaths -p User -p Group -p ExecStart -p EnvironmentFiles -p KillMode -p ControlGroup; sudo systemctl cat kb-dashboard.service; release_version=$(cat /opt/kb-releases/current/VERSION); test "$(readlink -f /proc/$(systemctl show -p MainPID --value kb-dashboard)/cwd)" = "/opt/kb-releases/$release_version/dashboard"`; require `EnvironmentFiles=` to be empty, deploy a second signed artifact, run the rollback command, and verify `readlink -f /opt/kb-releases/current` returns the first version. Preserve the redacted effective-config and rollback output for the deferred Gate-2 inventory.

- [ ] Commit with `git add scripts/deploy_platform_release.py deploy/activate_release.py deploy/bootstrap_vm.py deploy/validate_vm_runtime.py deploy/systemd/kb-dashboard.service tests/test_deploy_release.py tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py scripts/build_platform_release.py tests/test_build_platform_release.py; git commit -m "feat(deploy): activate and roll back immutable releases"`.

### Task 13: Back up and restore the release, ops checkout, and state root

Choice: the VM holds no backup-store credential. A root VM exporter acquires a filesystem maintenance lock, stops the service to eliminate writers, corroborates an empty service cgroup, creates one self-describing tier-zero archive, restarts into the locked posture, and only then gives that archive to the desktop. Service stop plus an empty cgroup is the ship-now quiescence boundary; it does not depend on the deferred launch/drain wiring. Desktop-side restic supplies encryption and off-VM storage. This task proves the 15-minute RPO and 60-minute RTO by restoring into a fresh isolated root, running full Git and state invariants, and booting a distinct locked service instance. The recovery-canary extension is explicitly deferred below the workflow-platform checkpoint.

**Files**

- Create: `deploy/export_tier0.py`
- Create: `scripts/backup_tier0.py`
- Create: `tests/test_state_backup.py`
- Modify: `tests/test_build_platform_release.py:1-80`

**Interfaces**

- Produces VM CLI: `sudo python3 /opt/kb-releases/current/deploy/export_tier0.py --output /var/tmp/kb-tier0-EXPORT_ID.tar`
- Produces desktop CLI: `python scripts/backup_tier0.py backup --host HOST --output DIR --rpo-minutes 15`
- Produces desktop CLI: `python scripts/backup_tier0.py restore-drill --target PATH --report FILE --rto-minutes 60`
- Consumes paths: `/opt/kb-releases`, `/var/lib/kb/ops`, `/var/lib/kb/state`
- Produces: `BackupReportV1 = { version: 1; operation: 'backup' | 'restore-drill'; startedAt: string; finishedAt: string; durationSeconds: number; snapshot: string; archiveSha256: string; quiescentExport: boolean; gitFsck: boolean; invariants: boolean; booted: boolean; rpoMet: boolean; rtoMet: boolean; verified: boolean }`

- [ ] Add failing tests with an injected command runner:

  ```py
  import hashlib
  import json
  import subprocess
  from datetime import datetime, timezone
  from pathlib import Path

  COMMIT = "a" * 40


  def canonical(value: dict) -> bytes:
      return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


  def valid_restored_tree(tmp_path: Path) -> Path:
      target = tmp_path / "restore"
      release = target / "opt/kb-releases" / COMMIT
      dashboard = release / "dashboard/server"
      dashboard.mkdir(parents=True)
      index = dashboard / "index.ts"; index.write_text("export {};\n", encoding="utf-8")
      (release / "VERSION").write_text(COMMIT + "\n", encoding="ascii")
      (release / "MANIFEST.sha256").write_text(
          f"{hashlib.sha256(index.read_bytes()).hexdigest()}  dashboard/server/index.ts\n", encoding="ascii",
      )
      releases = release.parent
      (releases / "current").symlink_to(COMMIT, target_is_directory=True)
      (releases / "previous").symlink_to(COMMIT, target_is_directory=True)
      ops = target / "var/lib/kb/ops"; ops.mkdir(parents=True)
      state = target / "var/lib/kb/state"
      control = state / "control"; control.mkdir(parents=True)
      control_plane = {
          "version": 1, "nextEventCursor": 1, "proposals": [],
          "runs": [{"runRef": "run-1"}],
          "stages": [{"stageRef": "stage-1", "runRef": "run-1"}],
          "attempts": [{"attemptRef": "attempt-1", "stageRef": "stage-1", "runRef": "run-1"}],
          "sessions": [], "humanRequests": [], "events": [], "quarantine": [],
      }
      (control / "control-plane.json").write_text(json.dumps(control_plane), encoding="utf-8")
      ready = state / "outbox/ready"; receipts = state / "outbox/receipts"
      ready.mkdir(parents=True); receipts.mkdir()
      bundle = ready / f"{COMMIT}.bundle"; bundle.write_bytes(b"bundle")
      manifest = {
          "schema": "kb.ops-outbox/v1", "id": COMMIT, "parent": "b" * 40, "commit": COMMIT,
          "paths": ["queue/inbox/card.md"], "createdAt": "2026-08-11T00:00:00.000Z",
          "bundleSha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
      }
      (ready / f"{COMMIT}.json").write_bytes(canonical(manifest))
      receipt = {
          "schema": "kb.ops-promotion/v1", "id": COMMIT, "sourceCommit": COMMIT,
          "promotedCommit": "c" * 40, "promotedAt": "2026-08-11T00:00:01.000Z",
      }
      (receipts / f"{COMMIT}.json").write_bytes(canonical(receipt))
      return target


  def fake_restore_runner(ops: Path, fsck: bool = True, readiness: dict | None = None):
      readiness = readiness or {"ok": True, "quiescent": True, "blockers": []}
      def run(argv, **_kwargs):
          if "fsck" in argv:
              return subprocess.CompletedProcess(argv, 0 if fsck else 1, stdout="", stderr="")
          if "symbolic-ref" in argv:
              return subprocess.CompletedProcess(argv, 0, stdout="refs/heads/ops\n", stderr="")
          if "rev-parse" in argv and "--git-path" in argv:
              return subprocess.CompletedProcess(argv, 0, stdout=str(ops / ".git" / argv[-1]) + "\n", stderr="")
          if "rev-parse" in argv:
              return subprocess.CompletedProcess(argv, 0, stdout=COMMIT + "\n", stderr="")
          if argv[0] == "curl":
              return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(readiness), stderr="")
          return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")
      return run

  def test_export_stops_all_writers_before_tar_and_restarts_locked(tmp_path):
      calls = []
      export_tier0.export(tmp_path / "tier0.tar", io=fake_export_io(calls))
      assert calls == ["lock", "systemctl:stop", "cgroup:empty", "tar", "fsync", "systemctl:start", "ready:locked"]


  def test_export_refuses_to_archive_when_the_stopped_service_cgroup_is_not_empty(tmp_path):
      with pytest.raises(RuntimeError, match="cgroup is not empty"):
          export_tier0.export(tmp_path / "tier0.tar", io=fake_export_io([], cgroup_children=1))


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
              restore=lambda _target, _run: ("snapshot-1", tmp_path / "kb-tier0.tar", "b" * 64),
              extract=lambda _archive, _target: None,
              verify=lambda _target, run=None: {"gitFsck": True, "invariants": True, "booted": True},
          )


  def test_restore_requires_fsck_invariants_and_isolated_boot(tmp_path):
      target = valid_restored_tree(tmp_path)
      result = backup_tier0.verify_restored_tree(target, run=fake_restore_runner(target / "var/lib/kb/ops", fsck=False))
      assert result == {"gitFsck": False, "invariants": True, "booted": True}
      assert backup_tier0.decide_restore(result) is False


  def test_consistent_restored_tree_passes_every_restore_validator(tmp_path):
      target = valid_restored_tree(tmp_path)
      run = fake_restore_runner(target / "var/lib/kb/ops")
      assert backup_tier0.validate_release_links(target) is True
      assert backup_tier0.validate_ops_head(target / "var/lib/kb/ops", run=run) is True
      assert backup_tier0.validate_state_json(target) is True
      assert backup_tier0.validate_outbox_manifests_receipts(target) is True
      assert backup_tier0.resolve_restored_release(target) == target / "opt/kb-releases" / COMMIT
      assert backup_tier0.wait_for_locked_readiness("http://restore/readyz", run=run, timeout_seconds=0) is True


  def test_release_link_validator_rejects_a_dangling_symlink(tmp_path):
      target = valid_restored_tree(tmp_path)
      current = target / "opt/kb-releases/current"; current.unlink(); current.symlink_to("missing", target_is_directory=True)
      assert backup_tier0.validate_release_links(target) is False


  def test_ops_head_validator_rejects_a_missing_ops_ref_object(tmp_path):
      target = valid_restored_tree(tmp_path)
      def missing_ref(argv, **_kwargs):
          if "rev-parse" in argv and argv[-1] == "refs/heads/ops^{commit}":
              return subprocess.CompletedProcess(argv, 1, stdout="", stderr="missing")
          return fake_restore_runner(target / "var/lib/kb/ops")(argv)
      assert backup_tier0.validate_ops_head(target / "var/lib/kb/ops", run=missing_ref) is False


  def test_state_validator_rejects_a_stage_that_references_an_absent_run(tmp_path):
      target = valid_restored_tree(tmp_path)
      path = target / "var/lib/kb/state/control/control-plane.json"
      value = json.loads(path.read_text(encoding="utf-8")); value["runs"] = []
      path.write_text(json.dumps(value), encoding="utf-8")
      assert backup_tier0.validate_state_json(target) is False


  def test_outbox_validator_rejects_an_orphaned_receipt(tmp_path):
      target = valid_restored_tree(tmp_path)
      orphan = {"schema": "kb.ops-promotion/v1", "id": "d" * 40, "sourceCommit": "d" * 40, "promotedCommit": "e" * 40, "promotedAt": "2026-08-11T00:00:01.000Z"}
      (target / "var/lib/kb/state/outbox/receipts" / f"{'d' * 40}.json").write_bytes(canonical(orphan))
      assert backup_tier0.validate_outbox_manifests_receipts(target) is False


  def test_restored_release_resolver_rejects_a_dangling_current_symlink(tmp_path):
      target = valid_restored_tree(tmp_path)
      current = target / "opt/kb-releases/current"; current.unlink(); current.symlink_to("missing", target_is_directory=True)
      with pytest.raises(RuntimeError, match="current"):
          backup_tier0.resolve_restored_release(target)


  def test_locked_readiness_validator_rejects_an_unlocked_instance(tmp_path):
      target = valid_restored_tree(tmp_path)
      run = fake_restore_runner(target / "var/lib/kb/ops", readiness={"ok": True, "quiescent": False, "blockers": ["execution-unlocked"]})
      assert backup_tier0.wait_for_locked_readiness("http://restore/readyz", run=run, timeout_seconds=0) is False
  ```

- [ ] Run `python -m pytest tests/test_state_backup.py tests/test_build_platform_release.py -q` and verify the backup module is absent and the release archive lacks `deploy/export_tier0.py`.

- [ ] Implement the VM export with an exclusive `flock` on `/run/lock/kb-maintenance.lock`, an argv-only runner, a `finally` restart, and no backup credential access:

  ```py
  TIER_ZERO = ("opt/kb-releases", "var/lib/kb/ops", "var/lib/kb/state")


  def export(output: Path, io: ExportIo = production_io) -> None:
      if not io.is_root() or output.exists() or output.parent != io.output_root():
          raise RuntimeError("export requires root and a fresh /var/tmp target")
      with io.exclusive_lock(Path("/run/lock/kb-maintenance.lock")):
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
  import posixpath
  import tarfile
  import time
  from datetime import datetime, timezone
  from pathlib import Path, PurePosixPath


  def backup(host: str, output: Path, rpo_minutes: int = 15, run=run_command, now=utc_now) -> dict:
      started = now()
      output.mkdir(parents=True, exist_ok=True)
      archive = output / "kb-tier0.tar"
      export_id = secrets.token_hex(16)
      remote = f"/var/tmp/kb-tier0-{export_id}.tar"
      run(["ssh", host, "sudo", "python3", "/opt/kb-releases/current/deploy/export_tier0.py", "--output", remote])
      run(["scp", f"{host}:{remote}", str(archive)])
      run(["ssh", host, "sudo", "rm", "--", remote])
      digest = sha256_file(archive)
      run(["restic", "backup", str(archive), "--tag", "kb-tier0"])
      snapshots = json.loads(run(["restic", "snapshots", "--tag", "kb-tier0", "--latest", "1", "--json"]).stdout)
      latest = snapshots[-1]
      age = (now() - parse_utc(latest["time"])).total_seconds() / 60
      finished = now()
      return make_report("backup", latest["short_id"], digest, started, finished, quiescentExport=True, rpoMet=age <= rpo_minutes)


  def safe_extract(archive_path: Path, target: Path) -> None:
      target.mkdir(parents=True, exist_ok=False)
      with tarfile.open(archive_path, "r:") as archive:
          members = archive.getmembers()
          for member in members:
              name = PurePosixPath(member.name)
              if name.is_absolute() or ".." in name.parts or member.isdev() or member.isfifo() or member.islnk():
                  raise RuntimeError("unsafe tier-zero archive member")
              if member.issym():
                  normalized = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
                  if normalized == ".." or normalized.startswith("../") or posixpath.isabs(member.linkname):
                      raise RuntimeError("tier-zero symlink escapes isolated root")
              elif not (member.isfile() or member.isdir()):
                  raise RuntimeError("unsupported tier-zero archive member")
          archive.extractall(target, members=members, filter="data")


  def restore_latest_snapshot(target: Path, run=run_command) -> tuple[str, Path, str]:
      if target.exists(): raise RuntimeError("restore target must be fresh")
      staging = target.with_name(target.name + "-restic")
      if staging.exists(): raise RuntimeError("restic staging target must be fresh")
      result = run(["restic", "snapshots", "--tag", "kb-tier0", "--latest", "1", "--json"])
      snapshots = json.loads(result.stdout)
      if len(snapshots) != 1: raise RuntimeError("one latest tier-zero snapshot is required")
      snapshot = snapshots[0]["short_id"]
      run(["restic", "restore", snapshot, "--target", str(staging)])
      archives = list(staging.rglob("kb-tier0.tar"))
      if len(archives) != 1 or archives[0].is_symlink(): raise RuntimeError("restored snapshot must contain one regular tier-zero archive")
      return snapshot, archives[0], sha256_file(archives[0])


  def restore_drill(
      target: Path, rto_minutes: int = 60, report_path: Path | None = None, run=run_command,
      monotonic=time.monotonic, restore=restore_latest_snapshot, extract=safe_extract,
      verify=None, now=utc_now,
  ) -> dict:
      verify = verify or verify_restored_tree
      started_tick = monotonic(); started_at = now()
      snapshot, archive, digest = restore(target, run)
      extract(archive, target)
      checks = verify(target, run=run)
      duration = monotonic() - started_tick; finished_at = now()
      report = make_report("restore-drill", snapshot, digest, started_at, finished_at, durationSeconds=duration, rtoMet=duration <= rto_minutes * 60, **checks)
      if report_path is not None: write_canonical_exclusive(report_path, report)
      if not report["rtoMet"]: raise RuntimeError("restore drill exceeded RTO")
      if not report["verified"]: raise RuntimeError("restore drill verification failed")
      return report


  def verify_restored_tree(target: Path, run=run_command) -> dict[str, bool]:
      ops = target / "var/lib/kb/ops"
      try: fsck = run(["git", "-C", str(ops), "fsck", "--full", "--strict", "--no-dangling"]).returncode == 0
      except OSError: fsck = False
      invariants = validate_release_links(target) and validate_ops_head(ops, run=run) and validate_state_json(target) and validate_outbox_manifests_receipts(target)
      unit = "kb-restore-drill-" + secrets.token_hex(8)
      port = "14317"
      started = False; boot = False
      try:
          release = resolve_restored_release(target)
          started = run(["systemd-run", f"--unit={unit}", f"--working-directory={release / 'dashboard'}", "--property=KillMode=control-group", "--property=NoNewPrivileges=yes", f"--setenv=DASHBOARD_PLATFORM_ROOT={release}", f"--setenv=PYTHONPATH={release}", "--setenv=DASHBOARD_EXECUTION_ACTIVATED=0", f"--setenv=DASHBOARD_REPO_ROOT={ops}", f"--setenv=DASHBOARD_STATE_ROOT={target / 'var/lib/kb/state'}", f"--setenv=PORT={port}", "/usr/bin/node", "--experimental-strip-types", str(release / "dashboard/server/index.ts")]).returncode == 0
          boot = started and wait_for_locked_readiness(f"http://127.0.0.1:{port}/readyz", run=run)
      except (OSError, RuntimeError, UnicodeError, ValueError):
          boot = False
      finally:
          if started:
              try: run(["systemctl", "stop", unit])
              except OSError: boot = False
      return {"gitFsck": fsck, "invariants": invariants, "booted": boot}


  BACKUP_REPORT_KEYS = {"version", "operation", "startedAt", "finishedAt", "durationSeconds", "snapshot", "archiveSha256", "quiescentExport", "gitFsck", "invariants", "booted", "rpoMet", "rtoMet", "verified"}


  def make_report(operation: str, snapshot: str, digest: str, started_at: datetime, finished_at: datetime, **values) -> dict:
      if operation not in {"backup", "restore-drill"} or not snapshot or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
          raise RuntimeError("backup report identity is invalid")
      duration = float(values.pop("durationSeconds", (finished_at - started_at).total_seconds()))
      checks = {
          "quiescentExport": bool(values.pop("quiescentExport", True)),
          "gitFsck": bool(values.pop("gitFsck", False)),
          "invariants": bool(values.pop("invariants", False)),
          "booted": bool(values.pop("booted", False)),
          "rpoMet": bool(values.pop("rpoMet", operation == "restore-drill")),
          "rtoMet": bool(values.pop("rtoMet", operation == "backup")),
      }
      if values: raise RuntimeError("unknown backup report field")
      verified = checks["quiescentExport"] and (checks["rpoMet"] if operation == "backup" else checks["gitFsck"] and checks["invariants"] and checks["booted"] and checks["rtoMet"])
      report = {
          "version": 1, "operation": operation,
          "startedAt": started_at.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
          "finishedAt": finished_at.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
          "durationSeconds": duration, "snapshot": snapshot, "archiveSha256": digest,
          **checks, "verified": verified,
      }
      if set(report) != BACKUP_REPORT_KEYS or duration < 0: raise RuntimeError("closed backup report required")
      return report


  def write_canonical_exclusive(path: Path, value: dict) -> None:
      if path.exists(): raise RuntimeError("backup report output already exists")
      temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
      with temporary.open("x", encoding="utf-8", newline="\n") as handle:
          json.dump(value, handle, sort_keys=True, separators=(",", ":")); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
      os.replace(temporary, path)
      if os.name != "nt":
          directory_fd = os.open(path.parent, os.O_RDONLY)
          try: os.fsync(directory_fd)
          finally: os.close(directory_fd)


  import hashlib
  import hmac

  COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
  DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
  OUTBOX_MANIFEST_KEYS = {"schema", "id", "parent", "commit", "paths", "createdAt", "bundleSha256"}
  PROMOTION_RECEIPT_KEYS = {"schema", "id", "sourceCommit", "promotedCommit", "promotedAt"}


  def _inside(root: Path, candidate: Path) -> bool:
      try:
          candidate.relative_to(root)
          return True
      except ValueError:
          return False


  def _release_link(releases: Path, name: str) -> Path:
      link = releases / name
      if not os.path.lexists(link) or not link.is_symlink():
          raise RuntimeError(f"release {name} symlink is absent")
      try:
          selected = link.resolve(strict=True)
      except OSError as error:
          raise RuntimeError(f"release {name} symlink is dangling") from error
      root = releases.resolve(strict=True)
      if not _inside(root, selected) or selected.parent != root or selected.is_symlink() or not selected.is_dir():
          raise RuntimeError(f"release {name} symlink escapes the release root")
      return selected


  def _validate_release_directory(release: Path) -> None:
      version = (release / "VERSION")
      manifest = (release / "MANIFEST.sha256")
      if not version.is_file() or version.is_symlink() or not manifest.is_file() or manifest.is_symlink():
          raise RuntimeError("release VERSION or manifest is absent")
      commit = version.read_text(encoding="ascii").strip()
      if COMMIT_RE.fullmatch(commit) is None or release.name != commit:
          raise RuntimeError("release directory name and VERSION disagree")
      rows: dict[str, str] = {}
      for row in manifest.read_text(encoding="ascii").splitlines():
          try: digest, relative = row.split("  ", 1)
          except ValueError: raise RuntimeError("release manifest row is malformed")
          path = Path(relative)
          if DIGEST_RE.fullmatch(digest) is None or not relative or path.is_absolute() or ".." in path.parts or relative in rows:
              raise RuntimeError("release manifest entry is invalid")
          rows[relative] = digest
      actual = {
          item.relative_to(release).as_posix()
          for item in release.rglob("*")
          if item.is_file() and not item.is_symlink() and item.name not in {"VERSION", "MANIFEST.sha256"}
      }
      if set(rows) != actual:
          raise RuntimeError("release manifest does not cover exactly the release files")
      for relative, digest in rows.items():
          payload = release / relative
          if not payload.is_file() or payload.is_symlink() or not hmac.compare_digest(hashlib.sha256(payload.read_bytes()).hexdigest(), digest):
              raise RuntimeError("release manifest digest mismatch")


  def resolve_restored_release(target: Path) -> Path:
      releases = target / "opt/kb-releases"
      if not releases.is_dir() or releases.is_symlink():
          raise RuntimeError("restored release root is absent")
      current = _release_link(releases, "current")
      _validate_release_directory(current)
      return current


  def validate_release_links(target: Path) -> bool:
      try:
          current = resolve_restored_release(target)
          previous = target / "opt/kb-releases/previous"
          if os.path.lexists(previous): _validate_release_directory(_release_link(previous.parent, "previous"))
          return current.is_dir()
      except (OSError, RuntimeError, UnicodeError, ValueError):
          return False


  def validate_ops_head(ops: Path, run=run_command) -> bool:
      try:
          symbolic = run(["git", "-C", str(ops), "symbolic-ref", "-q", "HEAD"])
          head = run(["git", "-C", str(ops), "rev-parse", "--verify", "HEAD^{commit}"])
          branch = run(["git", "-C", str(ops), "rev-parse", "--verify", "refs/heads/ops^{commit}"])
          if symbolic.returncode != 0 or head.returncode != 0 or branch.returncode != 0:
              return False
          if symbolic.stdout.strip() != "refs/heads/ops" or head.stdout.strip() != branch.stdout.strip() or COMMIT_RE.fullmatch(head.stdout.strip()) is None:
              return False
          for operation in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"):
              git_path = run(["git", "-C", str(ops), "rev-parse", "--git-path", operation])
              operation_path = Path(git_path.stdout.strip())
              if git_path.returncode != 0 or (operation_path if operation_path.is_absolute() else ops / operation_path).exists(): return False
          return True
      except (OSError, RuntimeError, TypeError):
          return False


  def _json_object(path: Path) -> dict:
      if not path.is_file() or path.is_symlink(): raise RuntimeError("JSON file is not a regular file")
      def reject_duplicates(pairs):
          value = {}
          for key, item in pairs:
              if key in value: raise RuntimeError("duplicate JSON key")
              value[key] = item
          return value
      value = json.loads(path.read_bytes(), object_pairs_hook=reject_duplicates)
      if type(value) is not dict: raise RuntimeError("JSON object is required")
      return value


  def validate_state_json(target: Path) -> bool:
      try:
          document = _json_object(target / "var/lib/kb/state/control/control-plane.json")
          required = {"version", "nextEventCursor", "proposals", "runs", "stages", "attempts", "sessions", "humanRequests", "events", "quarantine"}
          if document.get("version") != 1 or type(document.get("nextEventCursor")) is not int or document["nextEventCursor"] < 1 or not required.issubset(document) or any(type(document[key]) is not list for key in required - {"version", "nextEventCursor"}):
              return False
          runs = document["runs"]; stages = document["stages"]; attempts = document["attempts"]
          run_refs = {item.get("runRef") for item in runs if type(item) is dict and type(item.get("runRef")) is str}
          if len(run_refs) != len(runs) or any(not item for item in run_refs): return False
          stage_refs = {}
          for stage in stages:
              if type(stage) is not dict or type(stage.get("stageRef")) is not str or not stage["stageRef"] or stage["stageRef"] in stage_refs or stage.get("runRef") not in run_refs:
                  return False
              stage_refs[stage["stageRef"]] = stage["runRef"]
          attempt_refs = set()
          for attempt in attempts:
              if type(attempt) is not dict or type(attempt.get("attemptRef")) is not str or not attempt["attemptRef"] or attempt["attemptRef"] in attempt_refs or attempt.get("runRef") not in run_refs or attempt.get("stageRef") not in stage_refs or stage_refs[attempt["stageRef"]] != attempt["runRef"]:
                  return False
              attempt_refs.add(attempt["attemptRef"])
          return True
      except (OSError, RuntimeError, UnicodeError, json.JSONDecodeError):
          return False


  def _canonical_utc(value: object) -> bool:
      if type(value) is not str: return False
      try: parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
      except ValueError: return False
      return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") == value


  def _closed_json(path: Path, keys: set[str]) -> dict:
      value = _json_object(path)
      if set(value) != keys or path.read_bytes() != (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"):
          raise RuntimeError("closed canonical JSON is required")
      return value


  def validate_outbox_manifests_receipts(target: Path) -> bool:
      try:
          outbox = target / "var/lib/kb/state/outbox"; ready = outbox / "ready"; receipts = outbox / "receipts"
          if not ready.is_dir() or ready.is_symlink() or not receipts.is_dir() or receipts.is_symlink(): return False
          ready_entries = list(ready.iterdir())
          if any(not item.is_file() or item.is_symlink() or item.suffix not in {".json", ".bundle"} for item in ready_entries): return False
          manifest_ids = {item.stem for item in ready_entries if item.suffix == ".json"}
          bundle_ids = {item.stem for item in ready_entries if item.suffix == ".bundle"}
          if manifest_ids != bundle_ids: return False
          manifests = {}
          for identity in manifest_ids:
              manifest = _closed_json(ready / f"{identity}.json", OUTBOX_MANIFEST_KEYS)
              if any(type(manifest[key]) is not str for key in {"schema", "id", "parent", "commit", "createdAt", "bundleSha256"}): return False
              if manifest["schema"] != "kb.ops-outbox/v1" or identity != manifest["id"] or manifest["id"] != manifest["commit"] or COMMIT_RE.fullmatch(identity) is None or COMMIT_RE.fullmatch(manifest["parent"]) is None:
                  return False
              if type(manifest["paths"]) is not list or not manifest["paths"] or any(type(path) is not str for path in manifest["paths"]) or manifest["paths"] != sorted(set(manifest["paths"])) or not _canonical_utc(manifest["createdAt"]) or DIGEST_RE.fullmatch(manifest["bundleSha256"]) is None:
                  return False
              if not hmac.compare_digest(hashlib.sha256((ready / f"{identity}.bundle").read_bytes()).hexdigest(), manifest["bundleSha256"]): return False
              manifests[identity] = manifest
          receipt_entries = list(receipts.iterdir())
          if any(not item.is_file() or item.is_symlink() or item.suffix != ".json" or item.stem not in manifests for item in receipt_entries): return False
          for receipt_path in receipt_entries:
              receipt = _closed_json(receipt_path, PROMOTION_RECEIPT_KEYS); manifest = manifests[receipt_path.stem]
              if any(type(receipt[key]) is not str for key in PROMOTION_RECEIPT_KEYS): return False
              if receipt["schema"] != "kb.ops-promotion/v1" or receipt["id"] != receipt_path.stem or receipt["sourceCommit"] != manifest["commit"] or COMMIT_RE.fullmatch(receipt["promotedCommit"]) is None or not _canonical_utc(receipt["promotedAt"]): return False
          return True
      except (OSError, RuntimeError, UnicodeError, json.JSONDecodeError):
          return False


  def wait_for_locked_readiness(url: str, timeout_seconds: float = 30, interval_seconds: float = 0.25, run=run_command, monotonic=time.monotonic, sleep=time.sleep) -> bool:
      deadline = monotonic() + timeout_seconds
      while True:
          try: response = run(["curl", "--fail", "--silent", "--show-error", url])
          except OSError: return False
          try: payload = json.loads(response.stdout)
          except (TypeError, json.JSONDecodeError): payload = None
          if payload == {"ok": True, "quiescent": True, "blockers": []}: return True
          if monotonic() >= deadline: return False
          sleep(interval_seconds)
  ```

  `wait_for_locked_readiness` polls the isolated instance's `/readyz` until timeout and returns true only for `{ ok: true, quiescent: true }` with execution still locked. `validate_release_links` requires `current` and `previous`, when present, to resolve inside `opt/kb-releases`, requires the selected directory name, `VERSION`, and 40-hex commit to match, and rechecks its manifest. `validate_ops_head` requires `HEAD == refs/heads/ops` and no in-progress Git operation. `validate_state_json` parses every control-store JSON document and rejects unknown schema versions. `validate_outbox_manifests_receipts` independently parses canonical, duplicate-free `kb.ops-outbox/v1` manifests and `kb.ops-promotion/v1` receipts using their closed key sets, requires manifest filename/id/commit equality, verifies every ready bundle digest, and rejects a receipt without a matching manifest id/source commit; Tasks 16-17 later use the identical schemas. `make_report` emits canonical `BackupReportV1` atomically only when every named boolean and the applicable RPO/RTO boolean is true.

- [ ] Install no VM backup service, timer, restic binary, restic environment, or backup user. On the trusted desktop configure its existing credential manager for restic and schedule the exact command `python scripts/backup_tier0.py backup --host $env:KB_VM_HOST --output $env:KB_BACKUP_EXPORT_ROOT --rpo-minutes 15`; the scheduler's credential configuration remains outside the repo and VM. The script rejects `--repository`, `--password`, token flags, and credential-value logging.

- [ ] Run `python -m pytest tests/test_state_backup.py tests/test_build_platform_release.py -q`. On the trusted desktop run `$drillId = Get-Date -AsUTC -Format 'yyyyMMddTHHmmssZ'; python scripts/backup_tier0.py backup --host $env:KB_VM_HOST --output "$env:TEMP/kb-backup-$drillId" --rpo-minutes 15; python scripts/backup_tier0.py restore-drill --target "$env:TEMP/kb-restore-$drillId" --report "$env:TEMP/kb-restore-$drillId.json" --rto-minutes 60`; require full `git fsck`, every state/outbox invariant, locked isolated boot, RPO, and RTO to pass. Preserve the canonical v1 report for the deferred Gate-2 inventory. The deferred restore-canary hook must not alter this v1 producer in the ship-now commit.

- [ ] Commit with `git add deploy/export_tier0.py scripts/backup_tier0.py tests/test_state_backup.py tests/test_build_platform_release.py; git commit -m "feat(backup): protect tier-zero runtime state"`.

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

  it.each(['approved-root', 'intermediate', 'final-file'])('rejects a symlink at the %s component', (position) => {
    const root = mkdtempSync(join(tmpdir(), 'kb-read-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'kb-read-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'secret', 'utf8');
    if (position === 'approved-root') symlinkSync(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
    else if (position === 'intermediate') { mkdirSync(join(root, 'docs')); symlinkSync(outside, join(root, 'docs', 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
    else { mkdirSync(join(root, 'docs')); symlinkSync(outside, join(root, 'docs', 'note.md'), process.platform === 'win32' ? 'junction' : 'dir'); }
    const relpath = position === 'approved-root' ? 'docs/secret.md' : position === 'intermediate' ? 'docs/linked/secret.md' : 'docs/note.md';
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
- Produces: `promote_pending(spool: Path, operator_repo: Path, work_root: Path, trusted_ops_head: str, max_attempts: int = 3, run_git=run_git, clone_fresh=clone_fresh) -> dict[str, int]`
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
      manifest = {"schema": "kb.ops-outbox/v1", "id": commit, "parent": "a" * 40, "commit": commit, "paths": paths or ["ledgers/test.jsonl"], "createdAt": "2026-08-11T12:00:00.000Z", "bundleSha256": hashlib.sha256(bundle).hexdigest()}
      (ready / f"{commit}.json").write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
      (ready / f"{commit}.bundle").write_bytes(bundle)
      return spool, repo, manifest


  def git_succeeds(_repo: Path, args: list[str]):
      if args[0] == "diff-tree": stdout = "ledgers/test.jsonl\0"
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
      first = promote_pending(spool, repo, tmp_path / "work-first", "a" * 40, max_attempts=3, run_git=network_fails, clone_fresh=fake_clone)
      assert first == {"promoted": 0, "pending": 1, "failed": 1}
      assert not (spool / "receipts" / f"{manifest['id']}.json").exists()
      second = promote_pending(spool, repo, tmp_path / "work-second", "a" * 40, max_attempts=3, run_git=git_succeeds, clone_fresh=fake_clone)
      assert second == {"promoted": 1, "pending": 0, "failed": 0}
      third = promote_pending(spool, repo, tmp_path / "work-third", "a" * 40, max_attempts=3, run_git=must_not_run, clone_fresh=fake_clone)
      assert third["promoted"] == 0


  def test_retry_recovers_push_succeeded_response_lost_without_duplicate_commit(tmp_path):
      spool, repo, manifest = fixture_bundle(tmp_path)
      promoted = "c" * 40
      git = fake_git_with_receiptless_remote(manifest, promoted)
      result = promote_pending(spool, repo, tmp_path / "work", "a" * 40, run_git=git, clone_fresh=fake_clone)
      receipt = json.loads((spool / "receipts" / f"{manifest['id']}.json").read_text(encoding="utf-8"))
      assert result == {"promoted": 1, "pending": 0, "failed": 0}
      assert receipt["promotedCommit"] == promoted
      assert git.cherry_picks == 0


  def test_promoter_rejects_bundle_with_durable_path(tmp_path):
      spool, repo, _manifest = fixture_bundle(tmp_path, paths=["docs/design.md"])
      with pytest.raises(RuntimeError, match="non-coordination"):
          promote_pending(spool, repo, tmp_path / "work", "a" * 40, run_git=git_succeeds, clone_fresh=fake_clone)


  def test_two_item_chain_promotes_in_parent_order_and_writes_two_receipts(tmp_path):
      spool, repo, manifests = fixture_bundle_chain(tmp_path, count=2)
      result = promote_pending(spool, repo, tmp_path / "work", "a" * 40, run_git=git_succeeds, clone_fresh=fake_clone)
      assert result == {"promoted": 2, "pending": 0, "failed": 0}
      assert [path.stem for path in sorted((spool / "receipts").glob("*.json"))] == [item["id"] for item in manifests]


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


  def test_instruction_approval_accepts_valid_signature_and_rejects_mismatch(tmp_path):
      spool, repo, _ = fixture_bundle(tmp_path, paths=["queue/inbox/card.md"])
      chain = validate_quarantine_chain(spool, repo, "a" * 40, "refs/kb-quarantine/run", run=fake_git("ok"))
      approval, signature, allowed = write_exact_chain_approval(tmp_path, spool, chain)
      require_instruction_approval(chain, approval, signature, allowed, run=fake_ssh_verify(returncode=0))
      with pytest.raises(RuntimeError, match="signature failed"):
          require_instruction_approval(chain, approval, signature, allowed, run=fake_ssh_verify(returncode=1))
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


  def order_from_parent(manifests: list[dict], trusted_head: str) -> list[dict]:
      by_parent: dict[str, list[dict]] = {}
      for manifest in manifests: by_parent.setdefault(manifest["parent"], []).append(manifest)
      ordered: list[dict] = []; previous = trusted_head; seen: set[str] = set()
      while previous in by_parent:
          children = by_parent[previous]
          if len(children) != 1: raise RuntimeError("outbox chain forks from a parent")
          item = children[0]
          if item["commit"] in seen: raise RuntimeError("outbox chain contains a cycle")
          ordered.append(item); seen.add(item["commit"]); previous = item["commit"]
      if len(ordered) != len(manifests): raise RuntimeError("outbox is not one parent-topological chain from trusted ops head")
      return ordered


  def validate_quarantine_chain(spool: Path, repo: Path, trusted_head: str, quarantine_prefix: str, run=run_git) -> list[dict]:
      if re.fullmatch(r"[0-9a-f]{40}", trusted_head) is None: raise RuntimeError("trusted ops head is invalid")
      ordered = order_from_parent(validate_snapshot(spool), trusted_head)
      for manifest in ordered:
          bundle = spool / "ready" / f"{manifest['id']}.bundle"
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
      return ordered


  def promote_one(spool: Path, repo: Path, manifest: dict, quarantine_prefix: str, run=run_git) -> dict:
      source_ref = f"{quarantine_prefix}/{manifest['id']}"
      promoted = run(repo, ["log", "HEAD", "--format=%H", "--fixed-strings", f"--grep=KB-Outbox-ID: {manifest['id']}", "-1"]).stdout.strip()
      if not promoted:
          run(repo, ["cherry-pick", "--no-commit", source_ref])
          run(repo, ["commit", "-m", f"chore(outbox): promote {manifest['id']}", "-m", f"KB-Outbox-ID: {manifest['id']}"])
          promoted = run(repo, ["rev-parse", "HEAD"]).stdout.strip()
          run(repo, ["push", "origin", "ops"])
      promoted_at = utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z")
      return {"schema": "kb.ops-promotion/v1", "id": manifest["id"], "sourceCommit": manifest["commit"], "promotedCommit": promoted, "promotedAt": promoted_at}
  ```

  `parse_raw_diff` parses Git's NUL-delimited raw format without decoding paths early; it rejects malformed rows, duplicate paths, non-UTF-8, absolute paths, `..`, backslashes, and control characters and returns sorted paths. Thus modes `120000` and `160000` are rejected explicitly; only regular non-executable files and deletion are allowed. Return immediately when every manifest has a closed valid receipt; otherwise validate the entire source chain before selecting pending items. `InstructionApproval.ids` contains the ordered instruction-bearing ids, while `chainDigest` hashes every canonical manifest in the full ordered chain so its `firstParent` and `lastCommit` endpoints cannot hide intervening non-instruction commits. When any instruction path is present, verify exact closed approval bytes with `ssh-keygen -Y verify -I kb-ops-approver -n kb-ops-instructions` and the operator-supplied desktop allowed-signers file; a missing or mismatched signature leaves every ref quarantined and exits nonzero. Create a fresh clone for each bounded attempt; the `KB-Outbox-ID` trailer makes a retry after “push succeeded, receipt write failed” converge without a duplicate commit:

  ```py
  RECEIPT_KEYS = {"schema", "id", "sourceCommit", "promotedCommit", "promotedAt"}


  def read_matching_receipt(spool: Path, manifest: dict) -> dict | None:
      path = spool / "receipts" / f"{manifest['id']}.json"
      if not path.exists(): return None
      value = parse_closed_json(path, RECEIPT_KEYS)
      if value["schema"] != "kb.ops-promotion/v1" or value["id"] != manifest["id"] or value["sourceCommit"] != manifest["commit"]:
          raise RuntimeError("promotion receipt does not match its manifest")
      if re.fullmatch(r"[0-9a-f]{40}", value["promotedCommit"]) is None: raise RuntimeError("promotion receipt commit is invalid")
      parsed = datetime.strptime(value["promotedAt"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
      if parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value["promotedAt"]: raise RuntimeError("promotion time is not canonical UTC")
      return value


  def clone_fresh(operator_repo: Path, target: Path, run=subprocess.run) -> Path:
      remote = run_git(operator_repo, ["remote", "get-url", "origin"]).stdout.strip()
      target.parent.mkdir(parents=True, exist_ok=True)
      run(["git", "clone", "--no-tags", "--branch", "ops", "--single-branch", remote, str(target)], check=True)
      return target


  def recover_receiptless_remote_prefix(spool: Path, repo: Path, chain: list[dict], expected_remote: str, remote_head: str, quarantine_prefix: str, run=run_git) -> None:
      rows = run(repo, ["rev-list", "--reverse", "--parents", f"{expected_remote}..{remote_head}"]).stdout.splitlines()
      pending = [item for item in chain if read_matching_receipt(spool, item) is None]
      if len(rows) > len(pending): raise RuntimeError("origin/ops contains commits outside the pending outbox prefix")
      previous = expected_remote
      for row, manifest in zip(rows, pending):
          fields = row.split()
          if len(fields) != 2 or fields[1] != previous: raise RuntimeError("receiptless remote prefix is not single-parent")
          promoted = fields[0]
          message = run(repo, ["show", "-s", "--format=%B", promoted]).stdout.splitlines()
          if message.count(f"KB-Outbox-ID: {manifest['id']}") != 1: raise RuntimeError("receiptless remote commit has the wrong outbox trailer")
          source_ref = f"{quarantine_prefix}/{manifest['id']}"
          if run(repo, ["diff", "--quiet", source_ref, promoted]).returncode != 0: raise RuntimeError("receiptless remote commit tree differs from its source commit")
          receipt = {"schema": "kb.ops-promotion/v1", "id": manifest["id"], "sourceCommit": manifest["commit"], "promotedCommit": promoted, "promotedAt": utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z")}
          write_receipt_durably(spool / "receipts" / f"{manifest['id']}.json", receipt)
          previous = promoted
      if previous != remote_head: raise RuntimeError("receiptless remote prefix does not reach origin/ops")


  def promote_pending(
      spool: Path, operator_repo: Path, work_root: Path, trusted_ops_head: str,
      max_attempts: int = 3, run_git=run_git, clone_fresh=clone_fresh,
      approval: Path | None = None, approval_signature: Path | None = None,
      approval_allowed_signers: Path | None = None,
  ) -> dict[str, int]:
      if max_attempts < 1: raise ValueError("max_attempts must be positive")
      chain = order_from_parent(validate_snapshot(spool), trusted_ops_head)
      receipt_chain = [read_matching_receipt(spool, item) for item in chain]
      first_gap = next((index for index, receipt in enumerate(receipt_chain) if receipt is None), len(receipt_chain))
      if any(receipt is not None for receipt in receipt_chain[first_gap:]): raise RuntimeError("promotion receipts are not a parent-order prefix")
      initial_pending = chain[first_gap:]
      if not initial_pending: return {"promoted": 0, "pending": 0, "failed": 0}
      for attempt in range(1, max_attempts + 1):
          repo = clone_fresh(operator_repo, work_root / f"attempt-{attempt}-{secrets.token_hex(8)}")
          try:
              remote_head = run_git(repo, ["rev-parse", "refs/remotes/origin/ops^{commit}"]).stdout.strip()
              quarantine_prefix = f"refs/kb-quarantine/{secrets.token_hex(12)}"
              validated = validate_quarantine_chain(spool, repo, trusted_ops_head, quarantine_prefix, run_git)
              require_instruction_approval(validated, approval, approval_signature, approval_allowed_signers)
              receipts = [read_matching_receipt(spool, item) for item in validated]
              completed = [receipt for receipt in receipts if receipt is not None]
              expected_remote = completed[-1]["promotedCommit"] if completed else trusted_ops_head
              recover_receiptless_remote_prefix(spool, repo, validated, expected_remote, remote_head, quarantine_prefix, run_git)
              for manifest in validated:
                  if read_matching_receipt(spool, manifest) is not None: continue
                  receipt = promote_one(spool, repo, manifest, quarantine_prefix, run_git)
                  write_receipt_durably(spool / "receipts" / f"{manifest['id']}.json", receipt)
              remaining = sum(read_matching_receipt(spool, item) is None for item in chain)
              return {"promoted": len(initial_pending) - remaining, "pending": remaining, "failed": 0}
          except subprocess.CalledProcessError:
              run_git(repo, ["cherry-pick", "--abort"], check=False)
      remaining = sum(read_matching_receipt(spool, item) is None for item in chain)
      return {"promoted": len(initial_pending) - remaining, "pending": remaining, "failed": remaining}
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
      canonical_chain = b"".join((json.dumps(item, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8") for item in chain)
      expected = {
          "schema": "kb.ops-instruction-approval/v1", "chainDigest": hashlib.sha256(canonical_chain).hexdigest(),
          "firstParent": chain[0]["parent"], "lastCommit": chain[-1]["commit"], "ids": [item["id"] for item in instructions],
      }
      if value != expected: raise RuntimeError("trusted-desktop approval does not bind the quarantined chain")
      result = run(["ssh-keygen", "-Y", "verify", "-f", str(allowed_signers), "-I", "kb-ops-approver", "-n", "kb-ops-instructions", "-s", str(signature)], input=approval.read_bytes(), capture_output=True)
      if result.returncode != 0: raise RuntimeError("trusted-desktop approval signature failed")
  ```

  Before requesting approval, copy every canonical chain manifest beside the approval file as `<id>.manifest.json`, write the expected closed `InstructionApproval` bytes, show the operator `git diff --stat` and `git diff --no-ext-diff --binary <parent> <quarantine-ref> -- <instruction paths>`, and exit 3. The trusted desktop signs exactly with `ssh-keygen -Y sign -f $env:KB_OPS_APPROVAL_KEY -n kb-ops-instructions instruction-approval.json`; the rerun verifies it. Neither the private key nor its value is copied to the VM or repository.

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
      commits = {item["commit"] for item in manifests}
      roots = [item for item in manifests if item["parent"] not in commits]
      if len(roots) != 1: raise RuntimeError("source manifests do not have one topological root")
      source_chain = order_from_parent(manifests, roots[0]["parent"])
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

Choice: degraded mode starts at 100 pending items or an oldest pending age of 15 minutes. This ship-now task blocks new saves, launches, reruns, workflow launches, and unlocks while permitting reads, health, settlement, replies, stop-card, fleet STOP, and execution lock. The queue-bridge claim hook is deferred below because its exact claim/dispatch boundary belongs to the workflow-platform merge.

**Files**

- Create: `dashboard/server/write/outboxStatus.ts`
- Create: `dashboard/server/write/outboxStatus.test.ts`
- Create: `dashboard/server/control/admission.ts`
- Create: `dashboard/server/control/admission.test.ts`
- Modify: `dashboard/server/http/context.ts:90-130`
- Modify: `dashboard/server/http/surface.ts:207-270`
- Modify: `dashboard/server/control/routes.ts:271-398,580-760`
- Modify: `dashboard/server/control/routes.test.ts:240-380,760-920`
- Modify: `dashboard/server/write/routes.ts:90-260`
- Modify: `dashboard/server/http/surface.test.ts:820-910`

**Interfaces**

- Produces: `outboxStatus(spoolRoot: string, options?: { maxPending?: number; maxAgeMs?: number; now?: () => number }): OutboxStatus`
- Produces: `OutboxStatus = { pending: number; oldestAgeMs: number; degraded: boolean; reasons: string[] }`
- Produces: `AdmissionKind = 'new-work' | 'settlement' | 'reply' | 'stop' | 'lock' | 'read'`
- Produces: `admit(kind: AdmissionKind, status: OutboxStatus): { ok: true } | { ok: false; status: 503; reason: 'outbox-degraded' }`
- Consumes in ship-now route handlers: `ctx.admission('new-work')`

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

- [ ] Thread one `ctx.admission(kind)` function into the current HTTP routes and run it before each named ship-now new-work route. Return the exact 503 shape on refusal. Do not reject terminal result integration, ledger settlement, operator replies, stops, locks, health, or reads. Do not edit `queueBridge.ts` in this task; the deferred bridge-claim acceptance criterion below consumes this same interface after the merged dispatch path is re-read.

- [ ] Run `cd dashboard; npm test -- server/write/outboxStatus.test.ts server/control/admission.test.ts server/control/routes.test.ts server/http/surface.test.ts; npm run typecheck; npm test` and verify all tests pass. Simulate 100 manifests on Ubuntu and verify reads remain 200, launch/unlock return 503, STOP remains available, and removing/promoting the backlog returns admission to normal without restart.

- [ ] Commit with `git add dashboard/server/write/outboxStatus.ts dashboard/server/write/outboxStatus.test.ts dashboard/server/control/admission.ts dashboard/server/control/admission.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/control/routes.ts dashboard/server/write/routes.ts dashboard/server/control/routes.test.ts dashboard/server/http/surface.test.ts; git commit -m "feat(control): enforce visible outbox degraded mode"`.

## G1. Gate-1 evidence assembly

### Task 19: Produce the authenticated-read and tailnet boundary evidence package

Choice: the collector writes closed, canonical JSON evidence envelopes plus a human-readable Markdown index outside the repository. Each envelope binds the release artifact digest and commit, hashed host identity and boot id, exact redacted argv, canonical start/finish timestamps, result, and raw-output digest. VM jobs emit unsigned envelopes because the VM holds no signing key or other credential. After Daniel records approval on the trusted desktop, the desktop signs every envelope and approval, inventories every package file, recomputes that complete inventory with no extras or duplicates, and signs the final inventory digest. This is the Gate-1 implementation of the signed/versioned pattern that deferred Gate 2 must reuse. The collector does not modify Tailscale configuration.

**Files**

- Create: `scripts/gates/phase1_gate1.py`
- Create: `tests/test_phase1_gate1.py`

**Interfaces**

- Produces VM CLI: `python3 scripts/gates/phase1_gate1.py collect --base-url URL --external-serve-endpoint URL --output DIR --session-env KB_GATE_SESSION --route-report FILE --acl-authorized FILE --acl-denied FILE --release-commit SHA --artifact-sha256 SHA256`
- Produces desktop CLI: `python scripts/gates/phase1_gate1.py finalize --package DIR --approval FILE --signing-key PATH`
- Produces desktop verification CLI: `python scripts/gates/phase1_gate1.py verify --package DIR --allowed-signers FILE`
- Produces: `gate1.json`, `gate1.md`, `tailscale-serve.json`, `tailscale-funnel.json`, `route-matrix.json`, `gate1Boundary.evidence.json`, `gate1Boundary.evidence.json.sig`, `APPROVED.txt`, `APPROVED.txt.sig`, `evidence.inventory.json`, `evidence.sha256`, `evidence.sha256.sig`
- Produces: `AclProbeResult = { role: Literal['authorized', 'denied']; endpoint: str; outcome: Literal['reached', 'connection-refused', 'timeout'] }`
- Produces: `TailnetEvidence = { serveTailnetOnly: bool; funnelDisabled: bool; aclAuthorized: bool; aclDenied: bool }`
- Produces: `derive_tailnet_evidence(serve_status_json: str, funnel_status_json: str, acl_probe_results: list[AclProbeResult], external_serve_endpoint: str) -> TailnetEvidence`
- Produces: `EvidencePayload = { schema: 'kb.phase1-evidence/v1'; key: str; passed: bool; release: { commit: str; artifactSha256: str }; host: { machineIdSha256: str; bootId: str }; command: list[str]; startedAt: str; finishedAt: str; rawOutput: { file: str; sha256: str } }`
- Produces: `EvidenceInventoryV1 = { schema: 'kb.phase1-inventory/v1'; gate: 1; release: { commit: str; artifactSha256: str }; files: list[{ path: str; sha256: str }] }`
- Produces: `verify_inventory(package: Path, allowed_signers: Path, run=subprocess.run) -> EvidenceInventoryV1`
- Produces: per-envelope signatures in namespace `kb-phase1-evidence`, approval signature in `kb-phase1-approval`, and final-digest signature in `kb-phase1-inventory`
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
  EXTERNAL_SERVE_ENDPOINT = "https://kb.example.ts.net:443"


  def test_derive_tailnet_evidence_accepts_loopback_serve_no_funnel_and_acl_probes():
      assert derive_tailnet_evidence(PASSING_SERVE, PASSING_FUNNEL, ACL_PROBES, EXTERNAL_SERVE_ENDPOINT) == {
          "serveTailnetOnly": True, "funnelDisabled": True,
          "aclAuthorized": True, "aclDenied": True,
      }


  @pytest.mark.parametrize("serve, funnel, expected", [
      (json.dumps({"Web": {"kb.example.ts.net:443": {"Handlers": {"/": {"Proxy": "http://10.0.0.8:4317"}}}}}), PASSING_FUNNEL, {"serveTailnetOnly": False, "funnelDisabled": True}),
      (PASSING_SERVE, json.dumps({"AllowFunnel": {"kb.example.ts.net:443": True}}), {"serveTailnetOnly": True, "funnelDisabled": False}),
  ])
  def test_derive_tailnet_evidence_rejects_non_loopback_proxy_or_public_funnel(serve, funnel, expected):
      evidence = derive_tailnet_evidence(serve, funnel, ACL_PROBES, EXTERNAL_SERVE_ENDPOINT)
      assert {key: evidence[key] for key in expected} == expected


  def test_tailnet_evidence_binds_serve_and_acl_probes_to_the_exact_external_host():
      wrong_serve = PASSING_SERVE.replace("kb.example.ts.net:443", "other.example.ts.net:443")
      wrong_probes = [
          AclProbeResult(role="authorized", endpoint="https://other.example.ts.net:443", outcome="reached"),
          AclProbeResult(role="denied", endpoint="https://other.example.ts.net:443", outcome="timeout"),
      ]
      assert derive_tailnet_evidence(wrong_serve, PASSING_FUNNEL, wrong_probes, EXTERNAL_SERVE_ENDPOINT) == {
          "serveTailnetOnly": False, "funnelDisabled": True,
          "aclAuthorized": False, "aclDenied": False,
      }


  def test_evidence_payload_binds_release_host_command_time_and_raw_digest(tmp_path):
      raw = tmp_path / "raw.txt"; raw.write_bytes(b"ok\n")
      payload = build_evidence_payload("workerDrain", True, "a" * 40, "b" * 64, ["npm", "test"], "2026-08-11T12:00:00.000Z", "2026-08-11T12:01:00.000Z", raw, machine_id="vm-1", boot_id="11111111-1111-1111-1111-111111111111")
      assert payload["rawOutput"]["sha256"] == hashlib.sha256(b"ok\n").hexdigest()
      assert payload["host"]["machineIdSha256"] == hashlib.sha256(b"vm-1").hexdigest()
      assert set(payload) == {"schema", "key", "passed", "release", "host", "command", "startedAt", "finishedAt", "rawOutput"}


  def test_finalize_signs_envelopes_approval_and_final_inventory_digest(tmp_path):
      package, approval, key, calls = unsigned_gate1_fixture(tmp_path)
      finalize_package(package, approval, key, run=fake_ssh_signer(calls))
      namespaces = [argv[argv.index("-n") + 1] for argv in calls if argv[:3] == ["ssh-keygen", "-Y", "sign"]]
      assert namespaces.count("kb-phase1-evidence") == len(list(package.glob("*.evidence.json")))
      assert namespaces[-2:] == ["kb-phase1-approval", "kb-phase1-inventory"]
      assert (package / "evidence.sha256.sig").is_file()


  def test_verify_inventory_recomputes_the_complete_set_and_rejects_extras_or_duplicates(tmp_path):
      package, allowed = finalized_gate1_fixture(tmp_path)
      assert verify_inventory(package, allowed, run=fake_ssh_verifier).get("schema") == "kb.phase1-inventory/v1"
      (package / "unlisted.txt").write_text("extra\n", encoding="utf-8")
      with pytest.raises(RuntimeError, match="extras or missing"):
          verify_inventory(package, allowed, run=fake_ssh_verifier)
      (package / "unlisted.txt").unlink()
      inventory_path = package / "evidence.inventory.json"
      inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
      inventory["files"].append(inventory["files"][0])
      inventory_path.write_text(canonical_json(inventory), encoding="utf-8")
      with pytest.raises(RuntimeError, match="duplicate inventory path"):
          verify_inventory(package, allowed, run=fake_ssh_verifier)


  @pytest.mark.parametrize("namespace", ["kb-phase1-evidence", "kb-phase1-approval", "kb-phase1-inventory"])
  def test_verify_inventory_rejects_each_invalid_signature_class(tmp_path, namespace):
      package, allowed = finalized_gate1_fixture(tmp_path)
      with pytest.raises(RuntimeError, match="invalid"):
          verify_inventory(package, allowed, run=fake_ssh_verifier_fail_namespace(namespace))
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


  def normalize_external_serve_endpoint(value: str) -> str:
      parsed = urlsplit(value)
      if parsed.scheme.lower() != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment:
          raise RuntimeError("external Serve endpoint must be HTTPS without credentials, query, or fragment")
      if parsed.path not in {"", "/"} or not parsed.hostname or (parsed.port or 443) != 443:
          raise RuntimeError("external Serve endpoint must identify one HTTPS host on port 443")
      return f"https://{parsed.hostname.lower()}:443"


  def _serve_handler_proxies(config: dict, external_serve_endpoint: str) -> list[str] | None:
      # Serve status includes the local config plus any named Tailscale Services.
      services = config.get("Services", {})
      if not isinstance(services, dict): return None
      scopes = [config, *services.values()]
      proxies: list[str] = []
      for scope in scopes:
          if not isinstance(scope, dict) or not isinstance(scope.get("Web", {}), dict): return None
          for authority, web_server in scope["Web"].items():
              try:
                  if normalize_external_serve_endpoint("https://" + authority) != external_serve_endpoint: return None
              except (RuntimeError, ValueError):
                  return None
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
      services = config.get("Services", {})
      if not isinstance(services, dict): return None
      scopes = [config, *services.values()]
      entries: list[str] = []
      for scope in scopes:
          if not isinstance(scope, dict): return None
          allowed = scope.get("AllowFunnel", {})
          if not isinstance(allowed, dict): return None
          entries.extend(allowed)
      return entries


  def _probe_matches(probe: AclProbeResult, expected: str, outcomes: set[str]) -> bool:
      try:
          return normalize_external_serve_endpoint(probe.endpoint) == expected and probe.outcome in outcomes
      except (RuntimeError, ValueError):
          return False


  def derive_tailnet_evidence(serve_status_json: str, funnel_status_json: str, acl_probe_results: list[AclProbeResult], external_serve_endpoint: str) -> TailnetEvidence:
      try:
          serve, funnel = json.loads(serve_status_json), json.loads(funnel_status_json)
          expected = normalize_external_serve_endpoint(external_serve_endpoint)
      except (json.JSONDecodeError, RuntimeError, ValueError):
          return {"serveTailnetOnly": False, "funnelDisabled": False, "aclAuthorized": False, "aclDenied": False}
      proxies = _serve_handler_proxies(serve, expected) if isinstance(serve, dict) else None
      serve_funnel_entries = _funnel_entries(serve) if isinstance(serve, dict) else None
      funnel_entries = _funnel_entries(funnel) if isinstance(funnel, dict) else None
      authorized = [probe for probe in acl_probe_results if probe.role == "authorized"]
      denied = [probe for probe in acl_probe_results if probe.role == "denied"]
      return {
          "serveTailnetOnly": bool(proxies) and all(_is_loopback_proxy(proxy) for proxy in proxies),
          "funnelDisabled": serve_funnel_entries == [] and funnel_entries == [],
          "aclAuthorized": any(_probe_matches(probe, expected, {"reached"}) for probe in authorized),
          "aclDenied": any(_probe_matches(probe, expected, {"connection-refused", "timeout"}) for probe in denied),
      }


  def write_package(output: Path, evidence: dict, raw: dict[str, str]) -> int:
      output.mkdir(parents=True, exist_ok=False)
      decision = decide(evidence)
      (output / "gate1.json").write_text(json.dumps({"gate": 1, "decision": decision, "evidence": evidence}, indent=2) + "\n", encoding="utf-8")
      for name, value in raw.items(): (output / name).write_text(value, encoding="utf-8")
      rows = ["# Phase I Gate 1", "", f"Decision: {'PASS' if decision['passed'] else 'FAIL'}", "", "## Failures", ""] + [f"- {item}" for item in decision["failures"]]
      (output / "gate1.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
      return 0 if decision["passed"] else 1


  def write_gate1_envelope(output: Path, evidence: dict, release_commit: str, artifact_sha256: str, command: list[str], started_at: str, finished_at: str, machine_id: str, boot_id: str) -> Path:
      raw_file = output / "gate1.json"
      payload = build_evidence_payload(
          "gate1Boundary", decide(evidence)["passed"], release_commit, artifact_sha256,
          command, started_at, finished_at, raw_file, machine_id, boot_id,
      )
      target = output / "gate1Boundary.evidence.json"
      target.write_text(canonical_json(payload), encoding="utf-8", newline="\n")
      return target
  ```

- [ ] Add the shared closed evidence writer and desktop signer. `canonical_utc` accepts only exact millisecond UTC text and rejects reversed time. `safe_command` rejects empty argv, control characters, authorization-header values, private-key material, and credential assignments matching `token|secret|password|session` case-insensitively; it permits the literal `--session-env KB_GATE_SESSION` selector because the bearer value is absent from argv and output:

  ```py
  EVIDENCE_KEYS = {"schema", "key", "passed", "release", "host", "command", "startedAt", "finishedAt", "rawOutput"}
  RELEASE_KEYS = {"commit", "artifactSha256"}
  HOST_KEYS = {"machineIdSha256", "bootId"}
  RAW_OUTPUT_KEYS = {"file", "sha256"}


  def sha256_file(path: Path) -> str:
      digest = hashlib.sha256()
      with path.open("rb") as handle:
          for chunk in iter(lambda: handle.read(1024 * 1024), b""): digest.update(chunk)
      return digest.hexdigest()


  def canonical_utc(value: str) -> datetime:
      if type(value) is not str or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value) is None:
          raise RuntimeError("timestamp must be canonical millisecond UTC")
      return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


  def safe_command(command: list[str]) -> list[str]:
      if type(command) is not list or not command or any(type(arg) is not str or not arg for arg in command):
          raise RuntimeError("evidence command must be nonempty argv")
      for arg in command:
          if re.search(r"[\x00-\x1f\x7f]", arg): raise RuntimeError("control character in evidence command")
          if re.fullmatch(r"(?i)--?(?:token|secret|password|passkey|credential|api-key|access-key|authorization)(?:=.*)?", arg) or re.search(r"(?i)(authorization\s*:|-----BEGIN .*PRIVATE KEY-----|(?:token|secret|password|session)[A-Za-z0-9_]*=)", arg):
              raise RuntimeError("credential value in evidence command")
      return list(command)


  def require_uuid(value: str) -> str:
      parsed = uuid.UUID(value)
      if str(parsed) != value: raise RuntimeError("boot id must be canonical UUID")
      return value


  def parse_closed_evidence(raw: bytes, expected_keys: set[str] = EVIDENCE_KEYS) -> dict:
      value = load_json_without_duplicates(raw)
      if type(value) is not dict or set(value) != expected_keys or canonical_json(value).encode() != raw:
          raise RuntimeError("closed canonical evidence required")
      if value.get("schema") != "kb.phase1-evidence/v1" or type(value.get("passed")) is not bool:
          raise RuntimeError("unsupported evidence payload")
      if type(value["release"]) is not dict or set(value["release"]) != RELEASE_KEYS:
          raise RuntimeError("closed release evidence required")
      if type(value["host"]) is not dict or set(value["host"]) != HOST_KEYS:
          raise RuntimeError("closed host evidence required")
      if type(value["rawOutput"]) is not dict or set(value["rawOutput"]) != RAW_OUTPUT_KEYS:
          raise RuntimeError("closed raw-output evidence required")
      scalar_strings = [value["key"], value["startedAt"], value["finishedAt"], value["release"]["commit"], value["release"]["artifactSha256"], value["host"]["machineIdSha256"], value["host"]["bootId"], value["rawOutput"]["file"], value["rawOutput"]["sha256"]]
      if any(type(item) is not str for item in scalar_strings): raise RuntimeError("evidence scalar types are invalid")
      start, finish = canonical_utc(value["startedAt"]), canonical_utc(value["finishedAt"])
      if finish < start or re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", value["key"]) is None: raise RuntimeError("invalid evidence identity or time range")
      if re.fullmatch(r"[0-9a-f]{40}", value["release"]["commit"]) is None or re.fullmatch(r"[0-9a-f]{64}", value["release"]["artifactSha256"]) is None:
          raise RuntimeError("invalid release evidence")
      safe_command(value["command"]); require_uuid(value["host"]["bootId"])
      if Path(value["rawOutput"]["file"]).name != value["rawOutput"]["file"]:
          raise RuntimeError("raw-output filename must be package-local")
      if re.fullmatch(r"[0-9a-f]{64}", value["host"]["machineIdSha256"]) is None or re.fullmatch(r"[0-9a-f]{64}", value["rawOutput"]["sha256"]) is None:
          raise RuntimeError("invalid evidence digest")
      return value


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


  INVENTORY_KEYS = {"schema", "gate", "release", "files"}
  INVENTORY_ROW_KEYS = {"path", "sha256"}
  FINAL_CONTROL_FILES = {"evidence.inventory.json", "evidence.sha256", "evidence.sha256.sig"}
  UNSIGNED_GATE1_FILES = {"gate1.json", "gate1.md", "tailscale-serve.json", "tailscale-funnel.json", "route-matrix.json", "gate1Boundary.evidence.json"}


  def canonical_json(value: object) -> str:
      return json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"


  def load_json_without_duplicates(raw: bytes) -> object:
      def closed_pairs(pairs: list[tuple[str, object]]) -> dict:
          result = {}
          for key, value in pairs:
              if key in result: raise RuntimeError(f"duplicate JSON key: {key}")
              result[key] = value
          return result
      return json.loads(raw, object_pairs_hook=closed_pairs)


  def sign_file(path: Path, signing_key: Path, namespace: str, run=subprocess.run) -> Path:
      signature = path.with_suffix(path.suffix + ".sig")
      signature.unlink(missing_ok=True)
      run(["ssh-keygen", "-Y", "sign", "-f", str(signing_key), "-n", namespace, str(path)], check=True)
      if not signature.is_file(): raise RuntimeError(f"{namespace} signature was not produced")
      return signature


  def finalize_package(package: Path, approval: Path, signing_key: Path, run=subprocess.run) -> dict:
      initial = {path.name for path in package.iterdir() if path.is_file() and not path.is_symlink()}
      if initial != UNSIGNED_GATE1_FILES or any(not path.is_file() or path.is_symlink() for path in package.iterdir()):
          raise RuntimeError("unsigned Gate-1 package has extras, missing files, or non-regular entries")
      envelopes = sorted(package.glob("*.evidence.json"))
      if not envelopes: raise RuntimeError("Gate-1 package has no evidence envelopes")
      release = None
      for envelope in envelopes:
          value = parse_closed_evidence(envelope.read_bytes(), EVIDENCE_KEYS)
          raw_path = package / value["rawOutput"]["file"]
          if raw_path.parent != package or not raw_path.is_file() or raw_path.is_symlink(): raise RuntimeError("evidence raw file is not a regular package file")
          if sha256_file(raw_path) != value["rawOutput"]["sha256"]: raise RuntimeError("evidence raw digest mismatch")
          release = value["release"] if release is None else release
          if value["release"] != release: raise RuntimeError("evidence release identities differ")
          sign_evidence(envelope, signing_key, run=run)
      approval_text = approval.read_text(encoding="utf-8")
      expected = re.fullmatch(r"APPROVED gate=1 release=([0-9a-f]{40}) by=Daniel at=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\n", approval_text)
      if expected is None or expected.group(1) != release["commit"]: raise RuntimeError("approval does not bind Gate 1 and the release commit")
      canonical_utc(expected.group(2))
      approval_target = package / "APPROVED.txt"
      approval_target.write_text(approval_text, encoding="utf-8", newline="\n")
      sign_file(approval_target, signing_key, "kb-phase1-approval", run=run)
      rows = []
      for path in sorted(package.iterdir(), key=lambda item: item.name):
          if path.name in FINAL_CONTROL_FILES: continue
          if not path.is_file() or path.is_symlink(): raise RuntimeError("Gate-1 package contains a non-regular entry")
          rows.append({"path": path.name, "sha256": sha256_file(path)})
      inventory = {"schema": "kb.phase1-inventory/v1", "gate": 1, "release": release, "files": rows}
      inventory_path = package / "evidence.inventory.json"
      inventory_path.write_text(canonical_json(inventory), encoding="utf-8", newline="\n")
      digest_path = package / "evidence.sha256"
      digest_path.write_text(f"{sha256_file(inventory_path)}  evidence.inventory.json\n", encoding="ascii", newline="\n")
      sign_file(digest_path, signing_key, "kb-phase1-inventory", run=run)
      return inventory


  def verify_ssh_signature(path: Path, signature: Path, allowed_signers: Path, namespace: str, run=subprocess.run) -> None:
      result = run(["ssh-keygen", "-Y", "verify", "-f", str(allowed_signers), "-I", "kb-phase1", "-n", namespace, "-s", str(signature)], input=path.read_bytes(), capture_output=True)
      if result.returncode != 0: raise RuntimeError(f"invalid {namespace} signature")


  def verify_inventory(package: Path, allowed_signers: Path, run=subprocess.run) -> dict:
      inventory_path = package / "evidence.inventory.json"
      raw_inventory = inventory_path.read_bytes()
      inventory = load_json_without_duplicates(raw_inventory)
      if type(inventory) is not dict or set(inventory) != INVENTORY_KEYS or canonical_json(inventory).encode() != raw_inventory:
          raise RuntimeError("closed canonical inventory required")
      if inventory["schema"] != "kb.phase1-inventory/v1" or inventory["gate"] != 1 or type(inventory["files"]) is not list:
          raise RuntimeError("unsupported Gate-1 inventory")
      if type(inventory["release"]) is not dict or set(inventory["release"]) != RELEASE_KEYS or any(type(inventory["release"].get(key)) is not str for key in RELEASE_KEYS):
          raise RuntimeError("closed inventory release identity required")
      if re.fullmatch(r"[0-9a-f]{40}", inventory["release"]["commit"]) is None or re.fullmatch(r"[0-9a-f]{64}", inventory["release"]["artifactSha256"]) is None:
          raise RuntimeError("closed inventory release identity required")
      listed: dict[str, str] = {}
      for row in inventory["files"]:
          if type(row) is not dict or set(row) != INVENTORY_ROW_KEYS or type(row["path"]) is not str or type(row["sha256"]) is not str:
              raise RuntimeError("closed inventory row required")
          if row["path"] in listed: raise RuntimeError("duplicate inventory path")
          if Path(row["path"]).name != row["path"] or re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) is None:
              raise RuntimeError("unsafe inventory row")
          listed[row["path"]] = row["sha256"]
      if list(listed) != sorted(listed): raise RuntimeError("inventory rows must be path-sorted")
      actual = {path.name for path in package.iterdir() if path.is_file() and not path.is_symlink()}
      if actual != set(listed) | FINAL_CONTROL_FILES: raise RuntimeError("inventory has extras or missing files")
      if any(not path.is_file() or path.is_symlink() for path in package.iterdir()): raise RuntimeError("package contains a non-regular entry")
      for name, digest in listed.items():
          if sha256_file(package / name) != digest: raise RuntimeError(f"inventory digest mismatch: {name}")
      expected_digest = f"{hashlib.sha256(raw_inventory).hexdigest()}  evidence.inventory.json\n".encode("ascii")
      digest_path = package / "evidence.sha256"
      if digest_path.read_bytes() != expected_digest: raise RuntimeError("final inventory digest mismatch")
      envelopes = sorted(package.glob("*.evidence.json"))
      if [path.name for path in envelopes] != ["gate1Boundary.evidence.json"]:
          raise RuntimeError("Gate-1 inventory must contain exactly the boundary envelope")
      for envelope in envelopes:
          value = parse_closed_evidence(envelope.read_bytes(), EVIDENCE_KEYS)
          if value["release"] != inventory["release"]: raise RuntimeError("envelope release differs from inventory")
          raw_file = package / value["rawOutput"]["file"]
          if sha256_file(raw_file) != value["rawOutput"]["sha256"]: raise RuntimeError("envelope raw-output digest mismatch")
          verify_ssh_signature(envelope, envelope.with_suffix(envelope.suffix + ".sig"), allowed_signers, "kb-phase1-evidence", run=run)
      approval_text = (package / "APPROVED.txt").read_text(encoding="utf-8")
      approval = re.fullmatch(r"APPROVED gate=1 release=([0-9a-f]{40}) by=Daniel at=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\n", approval_text)
      if approval is None or approval.group(1) != inventory["release"]["commit"]: raise RuntimeError("approval does not bind the inventoried release")
      canonical_utc(approval.group(2))
      verify_ssh_signature(package / "APPROVED.txt", package / "APPROVED.txt.sig", allowed_signers, "kb-phase1-approval", run=run)
      verify_ssh_signature(digest_path, package / "evidence.sha256.sig", allowed_signers, "kb-phase1-inventory", run=run)
      return inventory
  ```

  Import `dataclass`, `datetime`, `timezone`, `Literal`, `TypedDict`, `uuid`, `ipaddress`, and `urlsplit` for the shown types and parser. The HTTP probe sends no token first, then an `Authorization: Bearer` header whose value comes from the named environment key; it never writes the value to output. The route report is Vitest JSON from Task 14's complete route-matrix plus SSE/WebSocket tests; set `routeInventoryCovered` only when all named files and tests passed. Run `tailscale serve status --json` and `tailscale funnel status --json`, retain their raw output, parse them with `derive_tailnet_evidence`, and merge its four returned booleans into `evidence` before `decide(evidence)`. Pass the CLI's normalized `--external-serve-endpoint` into that parser and into both ACL comparisons: every accepted `Web` authority and both probe endpoints must equal that one host on HTTPS port 443. The parser accepts only documented `Web`/`Handlers`/`Proxy` Serve handlers whose targets are loopback and rejects every `AllowFunnel` entry from either status as a public listener. Port `4317` is only the loopback proxy target and is never an ACL probe endpoint. After `write_package`, call `write_gate1_envelope` with the exact redacted collector argv, `/etc/machine-id`, `/proc/sys/kernel/random/boot_id`, the deployed release commit, and the verified archive digest; the unsigned VM directory contains exactly one Gate-1 envelope and its bound raw files. Signing and inventory finalization run only after that directory is copied to the trusted desktop.

- [ ] Run `python -m pytest tests/test_phase1_gate1.py -q` and verify the collector tests pass.

- [ ] Commit with `git add scripts/gates/phase1_gate1.py tests/test_phase1_gate1.py; git commit -m "test(gate): assemble phase one boundary evidence"`.

- [ ] After ship-now Tasks 1-8 and 10-19 have merged to `main`, deploy that exact immutable artifact from the desktop while the VM is locked and quiescent: `$releaseSha = git rev-parse origin/main; New-Item -ItemType Directory -Force "artifacts/$releaseSha" | Out-Null; gh run download --name "kb-platform-$releaseSha" --dir "artifacts/$releaseSha"; python scripts/deploy_platform_release.py "artifacts/$releaseSha/kb-platform-$releaseSha.tar.gz" "artifacts/$releaseSha/kb-platform-$releaseSha.attestation.json" --signing-key $env:KB_RELEASE_SIGNING_KEY --host $env:KB_VM_HOST`. Verify `/opt/kb-releases/current/VERSION` equals `$releaseSha` before probing.

- [ ] Run `python -m pytest tests/test_phase1_gate1.py -q`; on Ubuntu before production pruning, run `cd dashboard; npm test -- --reporter=json --outputFile=/var/lib/kb/gates/phase1/read-auth-vitest.json server/index.test.ts server/http/middleware.test.ts server/hub/sse.test.ts server/hub/ws.test.ts server/kb/routes.test.ts`. From one ACL-authorized tailnet client save `curl -fsS "$KB_TAILNET_URL/healthz"` output as `/var/lib/kb/gates/phase1/acl-authorized.txt`; from one ACL-denied client save the failed connection transcript as `/var/lib/kb/gates/phase1/acl-denied.txt`. With `KB_GATE_SESSION` freshly armed by Daniel for this run and `KB_RELEASE_ARTIFACT_SHA256` copied from the desktop-verified Task 10 attestation, run `gate_id=$(date -u +%Y%m%dT%H%M%SZ); release_commit=$(cat /opt/kb-releases/current/VERSION); python3 /opt/kb-releases/current/scripts/gates/phase1_gate1.py collect --base-url "$KB_TAILNET_URL" --external-serve-endpoint "$KB_TAILNET_URL" --output "/var/lib/kb/gates/phase1/gate1-$gate_id" --session-env KB_GATE_SESSION --route-report /var/lib/kb/gates/phase1/read-auth-vitest.json --acl-authorized /var/lib/kb/gates/phase1/acl-authorized.txt --acl-denied /var/lib/kb/gates/phase1/acl-denied.txt --release-commit "$release_commit" --artifact-sha256 "$KB_RELEASE_ARTIFACT_SHA256"`; verify exit 0, confirm `gate1.md` shows `PASS`, and confirm `/readyz` still reports execution locked. Unset `KB_GATE_SESSION` immediately after collection; it is a human-session bearer for this one live shell, not a persisted VM credential.

- [ ] Copy the unsigned directory to the trusted desktop and present its raw files, `gate1.md`, and `gate1Boundary.evidence.json` to Daniel. After he approves, set `$package` to the copied directory and run `$approvalPath = "${package}.approval.txt"; $allowedSignersPath = "${package}.allowed-signers"; $approvedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); $releaseSha = (Get-Content "$package/gate1Boundary.evidence.json" -Raw | ConvertFrom-Json).release.commit; "APPROVED gate=1 release=$releaseSha by=Daniel at=$approvedAt" | Set-Content -Encoding ascii $approvalPath; python scripts/gates/phase1_gate1.py finalize --package "$package" --approval $approvalPath --signing-key $env:KB_EVIDENCE_SIGNING_KEY; $public = ssh-keygen -y -f $env:KB_EVIDENCE_SIGNING_KEY; "kb-phase1 $public" | Set-Content -Encoding ascii $allowedSignersPath; python scripts/gates/phase1_gate1.py verify --package "$package" --allowed-signers $allowedSignersPath`. Require verification exit 0, then present the exact final inventory digest and its signature. Neither sibling input is part of the package inventory. Do not arm execution in this task.

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

- [ ] Run `cd dashboard; npm test -- server/runtime/capabilities.test.ts server/runtime/evidence.test.ts server/index.test.ts server/http/surface.test.ts server/composer/routes.test.ts server/runner/trigger.test.ts server/runner/liveness.test.ts src/views/Terminal.test.tsx; npm run typecheck; npm test` and verify all tests pass on Windows and Ubuntu. On Ubuntu set `release_commit=$(cat /opt/kb-releases/current/VERSION)` and set `artifact_sha256=$KB_RELEASE_ARTIFACT_SHA256`, where the environment value was copied from the desktop-verified Task 10 attestation and is not a credential. Emit `pythonProductionResolver.json` with the exact argv `npm test -- server/runtime/capabilities.test.ts server/runtime/evidence.test.ts`; emit `unsupportedVmSurfacesSafe.json` with the argv-only `probe-unsupported-surfaces` subcommand in `evidence.ts`, which authenticates a Composer request with a freshly human-armed session, checks its 503, scans `/proc/$MainPID/cmdline` for `powershell.exe`/`schtasks.exe`, and scans descendants for the Composer child. Run each as `node --experimental-strip-types server/runtime/evidence.ts --key KEY --release-commit "$release_commit" --artifact-sha256 "$artifact_sha256" --raw "/var/lib/kb/gates/phase1/KEY.raw.json" --report "/var/lib/kb/gates/phase1/KEY.json" -- COMMAND ARGS`; require both report `passed` values true and preserve the files for the deferred Gate-2 inventory.

- [ ] Commit with `git add dashboard/server/runtime/capabilities.ts dashboard/server/runtime/capabilities.test.ts dashboard/server/runtime/evidence.ts dashboard/server/runtime/evidence.test.ts dashboard/server/index.ts dashboard/server/index.test.ts dashboard/server/http/context.ts dashboard/server/http/surface.ts dashboard/server/http/surface.test.ts dashboard/server/composer/routes.ts dashboard/server/composer/routes.test.ts dashboard/server/runner/trigger.test.ts dashboard/server/runner/liveness.test.ts dashboard/src/views/Terminal.tsx dashboard/src/views/Terminal.test.tsx; git commit -m "fix(runtime): disable unsafe VM subprocess surfaces"`.

### Task 22: Enforce per-resource-class concurrency limits

Choice: this ship-now task defines and tests the standalone limiter before any execution-plane consumer. It enforces resource defaults of control 4, agents 2, render 1, PTY 4, and Git 1; closes admission, rejects new work, cancels queued promises with a typed error, and refuses zero or unbounded limits. Only the merge-independent Git transaction integration lands now. Worker-adapter, activation, PTY-observation, readiness, close-on-lock, and reopen-on-unlock wiring is deferred below the workflow-platform checkpoint.

**Files**

- Create: `dashboard/server/control/resourceLimits.ts`
- Create: `dashboard/server/control/resourceLimits.test.ts`
- Modify: `dashboard/server/write/asyncGit.ts:25-63`
- Modify: `dashboard/server/write/asyncGit.test.ts:1-107`

**Interfaces**

- Produces: `ResourceClass = 'control' | 'agents' | 'render' | 'pty' | 'git'`
- Produces: `ResourceLimiter.run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T>`
- Produces: `ResourceLimiter.snapshot(): Record<ResourceClass, { limit: number; active: number; queued: number }>`
- Produces: `ResourceLimiter.closeAndCancel(reason: string): number`
- Produces: `ResourceLimiter.open(): void`
- Produces: `ResourceLimiter.queuedCount(): number`
- Produces: `ResourceLimiter.accepting(): boolean`
- Produces: `createResourceLimiter(limits?: Partial<Record<ResourceClass, number>>): ResourceLimiter`
- Produces: `runtimeResourceLimiter: ResourceLimiter`
- Produces report: `resourceLimits.json` plus its named raw-output file
- Consumes: Task 20 `runEvidenceCommand()`

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

  it('keeps render and agent queues independent', async () => {
    const limiter = createResourceLimiter({ agents: 1, render: 1 });
    const events: string[] = [];
    let release!: () => void;
    const held = limiter.run('agents', () => new Promise<void>((resolve) => { release = resolve; }));
    await limiter.run('render', async () => { events.push('render'); });
    expect(events).toEqual(['render']);
    release(); await held;
  });

  it('reserves a released slot for the FIFO waiter before a new caller can enter', async () => {
    const limiter = createResourceLimiter({ agents: 1 });
    const events: string[] = [];
    let release!: () => void;
    const first = limiter.run('agents', () => new Promise<void>((resolve) => { release = resolve; }));
    const second = limiter.run('agents', async () => { events.push('second'); });
    await Promise.resolve(); release();
    const third = limiter.run('agents', async () => { events.push('third'); });
    await Promise.all([first, second, third]);
    expect(events).toEqual(['second', 'third']);
  });

  it('sets the PTY resource ceiling to four', () => {
    expect(createResourceLimiter().snapshot().pty.limit).toBe(4);
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

- [ ] Run `cd dashboard; npm test -- server/control/resourceLimits.test.ts server/write/asyncGit.test.ts` and verify the limiter module is absent.

- [ ] Implement a FIFO semaphore per resource class:

  ```ts
  export type ResourceClass = 'control' | 'agents' | 'render' | 'pty' | 'git';
  export type ResourceSnapshot = Record<ResourceClass, { limit: number; active: number; queued: number }>;
  export interface ResourceLimiter {
    run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T>;
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
    async function acquire(kind: ResourceClass): Promise<void> {
      if (!admission.accepting) throw new ExecutionAdmissionClosedError(admission.reason);
      const slot = state[kind];
      if (slot.active < limits[kind]) { slot.active += 1; return; }
      await new Promise<void>((resolve, reject) => slot.queue.push({ resolve, reject }));
    }
    function release(kind: ResourceClass): void {
      const slot = state[kind];
      const next = admission.accepting ? slot.queue.shift() : undefined;
      if (next) next.resolve();
      else slot.active -= 1;
    }
    async function run<T>(kind: ResourceClass, operation: () => Promise<T>): Promise<T> {
      await acquire(kind);
      try {
        if (!admission.accepting) throw new ExecutionAdmissionClosedError(admission.reason);
        return await operation();
      } finally { release(kind); }
    }
    return {
      run,
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

  const opsTransactionContext = new AsyncLocalStorage<boolean>();

  export async function withOpsTransaction<T>(operation: () => Promise<T>): Promise<T> {
    if (opsTransactionContext.getStore() === true) return operation();
    return runtimeResourceLimiter.run('git', () => opsTransactionContext.run(true, operation));
  }
  ```

- [ ] Replace the private Git FIFO's outermost acquire/release with `runtimeResourceLimiter.run('git', ...)`. Keep the existing `AsyncLocalStorage` guard: when `withOpsTransaction` sees its transaction context it invokes the nested operation directly; only the outermost call enters the limiter. Do not edit activation, worker-adapter, queue-bridge, readiness, surface, or PTY files in this ship-now task.

- [ ] Run `cd dashboard; npm test -- server/control/resourceLimits.test.ts server/write/asyncGit.test.ts; npm run typecheck; npm test` on Windows and Ubuntu. On Ubuntu emit Task 20's closed report with `node --experimental-strip-types server/runtime/evidence.ts --key resourceLimits --release-commit "$release_commit" --artifact-sha256 "$artifact_sha256" --raw /var/lib/kb/gates/phase1/resourceLimits.raw.json --report /var/lib/kb/gates/phase1/resourceLimits.json -- npm test -- server/control/resourceLimits.test.ts server/write/asyncGit.test.ts`; require `passed: true` and preserve both files for the deferred Gate-2 inventory.

- [ ] Commit with `git add dashboard/server/control/resourceLimits.ts dashboard/server/control/resourceLimits.test.ts dashboard/server/write/asyncGit.ts dashboard/server/write/asyncGit.test.ts; git commit -m "feat(control): bound runtime resource concurrency"`.

## Required workflow-platform merge checkpoint — before deferred execution-plane tasks

This is a blocking checkpoint, not an implementation task and not a commit. The workflow-platform has merged to `main`; every re-read targets the merged `origin/main` tip, and that merged tip must be at or after `804acec`.

- [ ] Run `git fetch origin main claude/workflow-platform; $mergedTip = git merge-base origin/main origin/claude/workflow-platform; git merge-base --is-ancestor 804acec $mergedTip; if ($LASTEXITCODE -ne 0) { Write-Error 'merged workflow-platform tip predates 804acec'; exit 1 }; git merge-base --is-ancestor $mergedTip origin/main; if ($LASTEXITCODE -ne 0) { Write-Error 'workflow-platform merged tip is not on main'; exit 1 }; Write-Output $mergedTip`. Require both ancestry checks to exit 0 and record `$mergedTip`; branch-tip commits newer than `$mergedTip` are not implementation inputs until they also merge.
- [ ] Incorporate the updated `origin/main` using the repository's normal non-destructive branch workflow and run `git merge-base --is-ancestor $mergedTip HEAD`; require exit code 0.
- [ ] Run `rg -n "dispatchQueueCard|buildQueueBridge|createQueueBridge|createClaudeWorkerAdapter|buildActivatedExecution|executeApprovedLaunch|runAutomatic|executionLatch|\.lock\(" dashboard/server` at the merged tip. Record every definition and caller in the deferred-task reviewer notes before writing tests or changing an interface.
- [ ] If the merged contracts cannot meet any acceptance criterion below without changing its authority boundary, stop and amend this plan through review. Do not infer a compatibility shim from the pre-merge signatures.

## DEFERRED: execution-plane tasks — specify after workflow-platform merges

The five tasks below retain their Phase-I scope and task numbers, but they are not commit-ready in the ship-now sequence. Their post-merge pass starts with failing tests against the re-read signatures; this section fixes the required behavior and files to inspect without guessing implementation code.

### Task 9: Bind approved proposals to the immutable registry identity

**Why deferred**

The proposal accepted by `ActivatedExecution.runAutomatic` and the construction seam in `buildActivatedExecution` are workflow-platform contracts. The post-merge code must decide where the Task 8 `RepositoryBinding` enters the canonical proposal and where the active checkout/base commit is resolved; specifying calls against the current signatures would be stale.

**Files to re-read post-merge**

- `dashboard/server/control/proposal.ts` and `dashboard/server/control/proposal.test.ts`
- `dashboard/server/control/activation.ts` and `dashboard/server/control/activation.test.ts`
- `dashboard/server/control/environment.ts` and `dashboard/server/control/environment.test.ts`
- `dashboard/server/control/repositoryRegistry.ts` and `dashboard/server/control/repositoryRegistry.test.ts`
- Every merged caller returned by `rg -n "validatePlanProposal|validateServerCompiledPlanProposal|buildActivatedExecution|runAutomatic|baseCommit" dashboard/server`

**Interface intent**

- Preserve Task 8 `RepositoryBinding = Readonly<{ registryId: string; identity: string }>` and `RepositoryRegistry.resolve(binding)`.
- Add a server-owned binding to the canonical proposal; untrusted input cannot supply or override it.
- Resolve `baseRef: ops` to an immutable commit and require it to equal the active checkout `HEAD` before execution.

**Acceptance criteria**

- Browser-authored and canonical-workflow proposals receive the same server-computed binding, and approval hashing covers it.
- Activation rejects an unknown/stale identity, a project outside the record, a path outside the closed scope, a record rooted outside the active ops checkout, and `baseRef` or resolved commit drift.
- `remote` and `credentialIdentity` remain hash-bound, recorded-not-enforced-until-Phase-II fields and grant no authority.
- The post-merge pass adds the failing proposal/activation/environment tests first, updates every caller of each changed signature, and runs their narrow tests, typecheck, and the full dashboard suite.

### Task 21: Make lock and shutdown drain every admitted execution

**Why deferred**

The real current synchronous owner is `ExecutionLatch.lock(input): ExecutionLatchState` in `activation.ts`; `ActivatedExecution` has no `lock`. The bridge tick/stop contract, worker registration race, route unlock path, and launch/activation dispatch path are all workflow-platform merge targets, so the coordinator must be designed against their merged shapes.

**Files to re-read post-merge**

- `dashboard/server/control/activation.ts` and `dashboard/server/control/activation.test.ts`
- `dashboard/server/control/queueBridge.ts` and `dashboard/server/control/queueBridge.test.ts`
- `dashboard/server/control/claudeWorkerAdapter.ts` and `dashboard/server/control/claudeWorkerAdapter.test.ts`
- `dashboard/server/control/launch.ts` and `dashboard/server/control/launch.test.ts`
- `dashboard/server/control/routes.ts` and `dashboard/server/control/routes.test.ts`
- `dashboard/server/http/context.ts`, `dashboard/server/http/surface.ts`, and their tests
- `dashboard/server/index.ts`, `dashboard/server/release/quiescence.ts`, and their tests
- `dashboard/server/write/asyncGit.ts`, `dashboard/server/vibe/session.ts`, `dashboard/server/pty/route.ts`, and their drain/count tests

**Interface intent**

- Keep `ExecutionLatch.lock` as the synchronous state owner; add an asynchronous coordinator around that owner rather than inventing `ActivatedExecution.lock`.
- Consume the shipped Task 22 `ResourceLimiter` for close/cancel/reopen and queue counts.
- Preserve the existing public `tick(): Promise<QueueBridgeTickResult>` contract while adding a reviewed bridge stop-and-drain operation.
- Add a draining cancellation registry around merged worker launches without editing away the adapter's real spawn/registration lifecycle.

**Acceptance criteria**

- Lock transitions are exactly `unlocked -> locking -> locked`: admission closes atomically, every queued limiter promise rejects with `ExecutionAdmissionClosedError`, the bridge stops claiming, admitted bridge work drains, registered workers/Git/PTY/Composer children drain or are contained, and only then does readiness report locked/quiescent.
- Startup is locked. Only a successful human-approved unlock reopens the limiter; a failed unlock never reopens it.
- The draining registry preserves same-key registration-wins semantics: install the replacement before canceling the displaced callback, and an unregister closure deletes only if its callback is still current. Bulk cancellation removes each entry before invoking its callback so reentrant cancellation cannot delete a replacement.
- Shutdown covers the post-spawn/pre-registration race visible in the merged `claudeWorkerAdapter.ts` and corroborates zero descendants through the service cgroup.
- Task 18's deferred hook calls `ctx.admission('new-work')` immediately before the merged queue bridge claims a card; degraded mode never blocks settlement, replies, stops, locks, health, or reads.
- Task 22's deferred wiring wraps the merged control and worker execution seams, maps render actions to `render` and other agent actions to `agents`, observes PTY count, and feeds total queued count to Task 11 without changing Task 11's public response.
- The post-merge pass writes failing state-order, reentrancy, overwrite, delete-before-cancel, spawn-race, route, bridge-contract, and cgroup-drain tests before implementation and runs the complete dashboard suite on Windows and Ubuntu.

### Task 23: Expose live operational telemetry in Sentinel

**Why deferred**

Heartbeats, queue age, worker identity, saturation, outcomes, and failure rate must be derived from the merged attempt/worker/bridge lifecycle. Binding telemetry now would either count the pre-merge lifecycle or create a second source of truth.

**Files to re-read post-merge**

- `dashboard/server/control/store.ts`, `dashboard/server/control/execution.ts`, and their tests
- `dashboard/server/control/activation.ts`, `dashboard/server/control/queueBridge.ts`, `dashboard/server/control/claudeWorkerAdapter.ts`, and their tests
- `dashboard/server/control/resourceLimits.ts` and `dashboard/server/write/outboxStatus.ts`
- `dashboard/server/index.ts` and `dashboard/server/http/context.ts`
- `dashboard/src/views/panels/Sentinel.tsx`, its tests, and `dashboard/src/styles/views/panels.css`

**Interface intent**

- Produce one read-only operational snapshot from durable run/attempt state plus live merged worker/bridge state, Task 22 limiter snapshots, and Task 18 outbox status.
- Expose the snapshot only through the authenticated read scope; telemetry must not unlock, claim, retry, settle, or otherwise mutate execution.

**Acceptance criteria**

- Snapshot and Sentinel show attempt heartbeat age, queue age, stable worker identity, active/queued/limit counts for every resource class, terminal outcomes, rolling failure rate, bridge state, execution-lock state, and outbox degradation reasons.
- Unknown, stale, malformed, or unavailable inputs render explicit unknown/degraded values rather than healthy zeroes.
- Tests pin time deterministically, prove auth coverage, prove no mutation calls, and prove the UI distinguishes idle, saturated, stale-heartbeat, degraded-outbox, and failed states.

### Task 24: Run a Linux production-path dispatch and restart canary

**Why deferred**

The current `executeApprovedLaunch` calls `void runAutomatic(...)` before returning `runRef`, while `queueBridge.ts` synthesizes definition id `bridge-${card.id}` and source turn id `bridge:${mapped.def.id}`. Therefore the bridge cannot durably record a correct card-to-run receipt before execution starts, and `sourceTurnId === card.id` is false. The durable linkage and recovery claim must use the merged launch/activation contract.

**Files to re-read post-merge**

- `dashboard/server/control/launch.ts` and `dashboard/server/control/launch.test.ts`
- `dashboard/server/control/queueBridge.ts` and `dashboard/server/control/queueBridge.test.ts`
- `dashboard/server/control/activation.ts` and `dashboard/server/control/activation.test.ts`
- `dashboard/server/control/claudeWorkerAdapter.ts` and its tests
- `dashboard/server/control/store.ts`, `dashboard/server/control/execution.ts`, and their recovery tests
- `dashboard/server/control/canonicalResultIntegrator.ts` and `dashboard/server/control/synthetic-acceptance.ts`
- `dashboard/server/write/workflowRun.ts`, `dashboard/server/runtime/python.ts`, and their tests
- `scripts/cards.py` and its tests
- `deploy/systemd/kb-dashboard.service`, `deploy/validate_vm_runtime.py`, and their tests

**Interface intent**

- Produce a closed `CardRunReceiptV1` in the durable control-plane store that binds card id, synthesized bridge definition id, run ref, attempt ref, approved grant digest, dispatch time, and boot id.
- Produce an exclusive durable `RecoveryClaimV1` that binds the interrupted attempt, successor attempt, old/new boot ids, and claim time.
- Produce one closed `LinuxCanaryReportV2`; the deferred Gate-2 collector consumes exactly v2.

**Acceptance criteria**

- The merged launch seam exposes the real `runRef` early enough to persist `CardRunReceiptV1` atomically before `runAutomatic` can begin, or provides an equivalent store transaction with that ordering. No receipt is reconstructed from `sourceTurnId` text.
- On boot, existing crash normalization durably records `interrupted`; a supervisor scans only approved interrupted receipts, fences the old process identity, takes one exclusive recovery claim, creates one successor attempt, records `recovering`, and reaches the original terminal settlement exactly once. Missing receipt, grant mismatch, non-interrupted state, terminal state, duplicate claim, or unfenced old process refuses recovery.
- The watched canary uses the human-passkey-armed session only for authenticated actions before restart. It carries no cookie, bearer, capability, or credential through `sudo`, the environment, stdin, a file, or any machine-auth path.
- Restart invalidates every dashboard session and returns admission of new execution authority to locked until Daniel performs a fresh passkey re-arm; only the already-approved interrupted receipt may complete through the recovery supervisor. The canary performs no authenticated post-restart action; if one becomes necessary, it pauses for that fresh human ceremony.
- A privileged filesystem observer records `interrupted -> recovering -> succeeded` from `${DASHBOARD_STATE_ROOT}/control/control-plane.json`, verifies the exact canonical integration record in `${DASHBOARD_STATE_ROOT}/control/canonical-integration.json`, reads `orgs/kb-ops/output/synthetic-acceptance.md` from the run's worktree under `${DASHBOARD_STATE_ROOT}/control/integration`, and verifies exactly one `billing:subscription` settlement row under `/var/lib/kb/ops/ledgers/cost`. HTTP polling is not used across restart.
- `LinuxCanaryReportV2` binds the deployed commit/artifact digest, card/receipt/run/claim identities, old/new boot ids, observed state sequence, exact integration path/content digest, ledger-row digest/count, restart observation, and pass decision. Its producer and every consumer use version 2.
- The restore-drill hook upgrades the producer to `BackupReportV2`: it contains every `BackupReportV1` field, sets `version` to exactly `2`, and adds `recoveryCanary: boolean` plus `recoveryCanaryReportSha256: string`. It runs the same filesystem-only recovery observation against the isolated restored root and makes `verified` require that canary. Gate 2 consumes exactly this v2 file.

### Task 25: Produce the Phase I execution-authority evidence package

**Why deferred**

Gate 2 depends on Task 21 drain wiring, Task 23 merged telemetry, Task 24 recovery/canary producers, and the restore-canary extension. Its inventory cannot be closed until those exact producer files and versions exist. Gate-1 evidence assembly already ships in Task 19.

**Files to re-read post-merge**

- `scripts/gates/phase1_gate1.py` and `tests/test_phase1_gate1.py`
- `dashboard/server/runtime/evidence.ts` and `dashboard/server/control/resourceLimits.ts`
- `scripts/backup_tier0.py` and `tests/test_state_backup.py`
- `scripts/promote_vm_outbox.py`, `deploy/apply_ops_reconciliation.py`, and their tests
- The Task 21, 23, and 24 files listed above
- `scripts/deploy_platform_release.py`, `deploy/validate_vm_runtime.py`, and their tests
- `docs/superpowers/specs/2026-08-11-kb-structure-design.md`

**Interface intent**

- Reuse Task 19 `EvidencePayload`, per-envelope SSH signatures, closed canonical inventory, full-set `verify_inventory`, signed Daniel approval, and signed final digest.
- Accept every report through an explicit CLI file argument; do not scan lexicographically latest files or implicit `backup-reports`/`runtime.json` directories.
- Consume `LinuxCanaryReportV2` and `BackupReportV2` exactly, plus closed Task 20/22 reports and the reviewed Task 21/23 producers.

**Acceptance criteria**

- Every required Gate-2 assertion has one versioned producer, one explicit input path, a raw-output digest, a signed evidence envelope, and a producer/consumer version test. No boolean comes from a command-line claim or free-form transcript.
- Verification rejects an absent, extra, duplicate, stale-release, cross-host, cross-boot, bad-signature, bad-raw-digest, unapproved, or differently versioned file and recomputes the complete inventory before verifying the desktop-signed final digest.
- Deployment in the Gate-2 run uses Task 12's exact interface: `python scripts/deploy_platform_release.py ARCHIVE ATTESTATION --signing-key PATH --host HOST`. No checksum-only deploy call exists.
- The package consumes the explicit Task 20/22 report paths, Task 23 telemetry report, Task 21 drain report, Task 24 `LinuxCanaryReportV2`, Task 13 `BackupReportV2`, Task 17 outage/replay/reconciliation report, Task 12 effective-config/rollback report, and the signed Task 19 Gate-1 package. Each named file has a producer in the post-merge plan before Gate-2 tests are written.
- Daniel reviews and signs approval on the trusted desktop. No signing key, passkey material, bearer, service token, backup credential, deploy credential, or other credential is stored on the VM.
- Gate 2 finishes with execution locked and sessions invalidated by a final daemon restart; any later authenticated action requires a new human passkey ceremony.

## Final self-review

### Spec coverage map

- Immutable platform artifact, live-checkout transition, symlink selection, quiescent restart, and rollback: Tasks 10-12.
- Tier-zero encrypted backup, 15-minute RPO, 60-minute RTO, fsck/invariants, and locked isolated boot: ship-now Task 13; its recovery-canary extension is deferred with Task 24.
- Desktop promotion, local durable outbox, bounded retry, outage replay, visible backlog, continued reads, and degraded admission: Tasks 16-18.
- No persistent secret or external-authority credential of any kind on the VM, enforced structurally and by validation: Tasks 8, 12, 16, and 17; deferred Tasks 24-25 must preserve it.
- Session authentication on every non-health read, root confinement, tailnet Serve/ACL/Funnel proof, and no authority transfer at Gate 1: Tasks 14, 15, and 19.
- Production Python resolution and Linux behavior: Tasks 2 and 20.
- `KillMode=control-group` and effective-unit validation: ship-now Task 12; merged worker/bridge drain: deferred Task 21.
- Standalone resource limiter and reentrant Git integration: ship-now Task 22; worker/activation/PTY/readiness wiring: deferred Task 21.
- Outbox alerting: ship-now Task 18; merged heartbeats, queue age, worker identity, saturation, outcomes, and failure rate: deferred Task 23.
- Card-to-bridge-to-integration-to-ledger Linux canary with mid-run recovery and filesystem-only restart observation: deferred Task 24.
- Versioned card/workflow schemas, v0 transition compatibility, explicit migration, and unsupported-data startup refusal: Tasks 3-7.
- Server-owned repository mapping and honest recorded-only fields: ship-now Task 8; merged immutable approved-proposal binding: deferred Task 9.
- Signed Gate-1 evidence, full inventory verification, and final digest signature: ship-now Task 19; Gate-2 assembly: deferred Task 25.
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
- Backup access: restic runs only on the trusted desktop through its existing credential manager; repository code never stores, serializes, logs, or transports backup credentials.

### Mechanical audit before handoff

- [ ] Run `git diff --name-only` and verify the only planning-worktree change is `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md`.
- [ ] Run a case-sensitive scan for the four forbidden planning phrases by constructing each needle from fragments in the shell, and verify zero matches in this file.
- [ ] Compare every ship-now `Consumes` entry with the earlier ship-now `Produces` signature named in this plan; specifically verify schema compatibility, readiness, outbox manifest, admission, resource snapshot, and Gate-1 package shapes match exactly. No ship-now task may require a deferred producer.
- [ ] Count headings matching `^### Task [0-9]+:` and verify exactly 25. Verify the ship-now headings are Tasks 1-8, 10-20, and 22; verify the checkpoint immediately precedes the deferred section containing Tasks 9, 21, and 23-25.
- [ ] After the workflow-platform merge, re-read every file listed under each deferred task at the merged tip `>= 804acec` before writing its failing tests; never infer merged edits to the dispatch path.
