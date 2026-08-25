/**
 * P4 W6.4 — the in-memory fixtures the isolated remote-lifecycle proof mounts around a real bare git
 * remote: a fixture control store (schedule rows + mirror watermarks), a fixture ops outbox (the
 * append-only durable coordination log), and a fake AUTHENTICATED PR registry (the `gh`-shaped surface
 * the Implementer/mirror open PRs against). None of these touch the network, the live control plane, or
 * a real GitHub — every effect is a value in this process, so the lifecycle can be replayed and every
 * refusal exercised without a credential or a live ref.
 *
 * Security shape mirrored from the production contracts this fixture stands in for:
 *  - The ops outbox is written ONLY through {@link FixtureOpsOutbox.publishAsPublisher}; a direct
 *    `append` outside the publisher is refused ({@link OpsBypassRefused}) and audited, so the §9
 *    `ops-bypass` and `direct-sweeper-writes` attacks have a real wall to hit.
 *  - The control store is CAS-guarded: a mutation pinned to a stale revision conflicts, so a replayed or
 *    racing mirror cannot double-apply (§9 `replayed-changed-intents`, `mirror-watermark-races`).
 *  - The PR registry mints a 40-hex merge commit only for a PR whose base is the fixture `main` and
 *    whose staged set the caller declares; it never merges the live feature branch or live `main`.
 *
 * W6.4b adds the REAL HTTPS loopback server ({@link startP4FixtureServer}) the §8 browser proofs run
 * against: it serves the closed P4 Inbox surface ({@link projectP4Inbox}) over these same fixture stores,
 * plus a `/readyz` readiness endpoint and an app-shell HTML page, modelled on the proven P3 pattern
 * (`p3AuthenticatedServer.ts`) — self-signed loopback TLS from `p3LoopbackTls.ts`, an SPKI pin the browser
 * runner waives certificate errors for, and nothing but loopback ever bound.
 */
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  createLoopbackTlsMaterial, publishLoopbackCertificate, revokeLoopbackCertificate,
} from './p3LoopbackTls.ts';
import { spkiSha256Base64 } from './p3ActualBrowserRunner.ts';
import {
  decodeInboxResponse, escalationSubjectKeyString, inboxItemId, prHref, prSubjectKeyString,
  type EscalationSubject, type InboxResponse, type PrSubject, type SourceState,
} from '../inbox/contracts.ts';
import { projectP4Inbox, type P4InboxSources } from '../inbox/project.ts';

/** A canonical 40-hex commit id. The PR registry mints these; the harness never accepts a short id. */
export type CommitId = string;

export function isFortyHex(value: unknown): value is CommitId {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

/** Every created/written path the fixture owns, so isolation can be asserted against the live worktree. */
export interface FixtureIdentity {
  /** The read-only clone source — expected to be the live worktree; never written. */
  readonly sourceRoot: string;
  /** The temp root under which every created path lives. */
  readonly tempRoot: string;
  /** The non-bare fixture working clone. */
  readonly fixtureRepo: string;
  /** The local BARE remote the producers push to. */
  readonly bareRemote: string;
  /** The worker worktree derived from the tagged fixture commit. */
  readonly workerWorktree: string;
  /** The fixture control store file. */
  readonly controlStore: string;
  /** The fixture ops outbox file. */
  readonly opsOutbox: string;
  /** The artifact directory for this run. */
  readonly artifactDir: string;
  /** The tagged "attested protected-main" commit the whole proof derives from. */
  readonly fixtureHead: CommitId;
  /** The tag name on {@link fixtureHead}. */
  readonly fixtureTag: string;
}

// ---------------------------------------------------------------------------------------------------
// Fixture ops outbox — the append-only durable coordination log, publisher-only.
// ---------------------------------------------------------------------------------------------------

export class OpsBypassRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsBypassRefused';
  }
}

export interface OpsEvent {
  /** Idempotency key; a replay with the same key returns the recorded receipt, never a second append. */
  readonly key: string;
  readonly purpose: 'learning-proposal' | 'learning-record-retire' | 'schedule-mirror';
  /** The ops HEAD this coordination write commits against; a stale base is refused by the caller. */
  readonly base: CommitId;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OpsReceipt {
  readonly mode: 'coordination';
  readonly branch: 'ops';
  readonly key: string;
  readonly commit: CommitId;
}

/** An audited refusal of a direct-write attempt, so the §9 attacks can assert one was recorded. */
export interface OpsAuditEntry {
  readonly kind: 'refused-direct-write' | 'refused-stale-base';
  readonly detail: string;
}

export class FixtureOpsOutbox {
  private readonly events: OpsEvent[] = [];
  private readonly receipts = new Map<string, OpsReceipt>();
  private readonly audit: OpsAuditEntry[] = [];
  private headCommit: CommitId;

  constructor(initialHead: CommitId) {
    if (!isFortyHex(initialHead)) throw new Error('ops outbox requires a 40-hex initial head');
    this.headCommit = initialHead;
  }

  head(): CommitId {
    return this.headCommit;
  }

  auditLog(): readonly OpsAuditEntry[] {
    return this.audit;
  }

  log(): readonly OpsEvent[] {
    return this.events;
  }

  /** The ONLY legal append path. Idempotent on `key`; refuses a stale base. */
  publishAsPublisher(event: OpsEvent, mintCommit: () => CommitId): OpsReceipt {
    const existing = this.receipts.get(event.key);
    if (existing) return existing;
    if (event.base !== this.headCommit) {
      this.audit.push({ kind: 'refused-stale-base', detail: `${event.key} pinned ${event.base}` });
      throw new OpsBypassRefused(`stale base for ${event.key}: expected ${this.headCommit}`);
    }
    this.events.push(event);
    const commit = mintCommit();
    this.headCommit = commit;
    const receipt: OpsReceipt = { mode: 'coordination', branch: 'ops', key: event.key, commit };
    this.receipts.set(event.key, receipt);
    return receipt;
  }

  /**
   * A direct append — the shape a Sweeper or an ops-bypass attempt would use. There is no legal direct
   * path: {@link publishAsPublisher} is the only append, and it never routes through here, so this is
   * ALWAYS refused and audited. The single unconditional throw is what satisfies the `never` return.
   */
  appendDirect(event: OpsEvent): never {
    this.audit.push({ kind: 'refused-direct-write', detail: `direct append of ${event.key}` });
    throw new OpsBypassRefused(`direct ops write refused: ${event.key}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// Fixture control store — schedule rows with mirror watermarks and CAS.
// ---------------------------------------------------------------------------------------------------

export interface ScheduleRow {
  readonly id: string;
  /** Monotonic per-row revision, bumped on each mutation. */
  readonly revision: number;
  /** The mirror revision the row was last covered by, or 0 before any mirror. */
  readonly lastMirrorRevision: number;
  /** The UTC second a covering mirror last merged, or null. */
  readonly mirroredAt: string | null;
}

export class ScheduleCasConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleCasConflict';
  }
}

export interface MirrorBatch {
  /** The collection revision this batch mirrors; frozen for the batch's life. */
  readonly targetRevision: number;
  /** The rows covered when the batch opened, by id. */
  readonly coveredRowIds: readonly string[];
  /** Each covered row's per-row revision at open time; the watermark advances to exactly these. */
  readonly coveredRevisionAtOpen: ReadonlyMap<string, number>;
}

/**
 * The fixture control store. `scheduleMirrorRevision` is the collection watermark; a pre-P4 document
 * that lacks it reads as 0 and gains it on first mirror with no version bump [P4-C37 shape].
 */
export class FixtureControlStore {
  private rows = new Map<string, ScheduleRow>();
  private collectionRevision = 0;
  private scheduleMirrorRevision = 0;
  private openBatch: MirrorBatch | null = null;

  snapshot(): { rows: readonly ScheduleRow[]; collectionRevision: number; scheduleMirrorRevision: number } {
    return {
      rows: [...this.rows.values()].sort((a, b) => a.id.localeCompare(b.id)),
      collectionRevision: this.collectionRevision,
      scheduleMirrorRevision: this.scheduleMirrorRevision,
    };
  }

  /** Create-or-mutate a row under CAS. `expectRevision` must equal the row's current revision (0 for new). */
  mutate(id: string, expectRevision: number): ScheduleRow {
    const current = this.rows.get(id);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectRevision) {
      throw new ScheduleCasConflict(`row ${id}: expected revision ${expectRevision}, have ${currentRevision}`);
    }
    this.collectionRevision += 1;
    const next: ScheduleRow = {
      id,
      revision: currentRevision + 1,
      lastMirrorRevision: current?.lastMirrorRevision ?? 0,
      mirroredAt: current?.mirroredAt ?? null,
    };
    this.rows.set(id, next);
    return next;
  }

  hasOpenBatch(): boolean {
    return this.openBatch !== null;
  }

  /**
   * Open the single mirror batch. A second open while one is live is refused (§3.5 one-open-batch).
   * A row is covered iff it has changed since its last mirror (`revision > lastMirrorRevision`); each
   * covered row's revision is frozen at open time so a mutation during the batch is not falsely mirrored.
   */
  openMirrorBatch(): MirrorBatch {
    if (this.openBatch) throw new ScheduleCasConflict('a mirror batch is already open');
    const covered = [...this.rows.values()]
      .filter((row) => row.revision > row.lastMirrorRevision)
      .sort((a, b) => a.id.localeCompare(b.id));
    this.openBatch = {
      targetRevision: this.collectionRevision,
      coveredRowIds: covered.map((row) => row.id),
      coveredRevisionAtOpen: new Map(covered.map((row) => [row.id, row.revision])),
    };
    return this.openBatch;
  }

  /**
   * Confirm the open batch merged at `mergeCommit`, advancing each covered row's watermark to exactly
   * its revision at open time and stamping `mirroredAt` on those rows (§3.5, row-bounded). A row mutated
   * during the batch stays pending for the next cycle. Returns the ids that advanced.
   */
  confirmMirrorMerge(mergeCommit: CommitId, mergedAt: string): readonly string[] {
    if (!isFortyHex(mergeCommit)) throw new Error('mirror merge requires a 40-hex commit');
    const batch = this.openBatch;
    if (!batch) throw new ScheduleCasConflict('no open mirror batch to confirm');
    const advanced: string[] = [];
    for (const id of batch.coveredRowIds) {
      const row = this.rows.get(id);
      if (!row) continue;
      const revisionAtOpen = batch.coveredRevisionAtOpen.get(id) ?? row.revision;
      this.rows.set(id, { ...row, lastMirrorRevision: revisionAtOpen, mirroredAt: mergedAt });
      advanced.push(id);
    }
    this.scheduleMirrorRevision = Math.max(this.scheduleMirrorRevision, batch.targetRevision);
    this.openBatch = null;
    return advanced.sort();
  }
}

// ---------------------------------------------------------------------------------------------------
// Fake authenticated PR registry — the `gh`-shaped surface, in memory.
// ---------------------------------------------------------------------------------------------------

export interface FakePrRecord {
  readonly id: number;
  readonly branch: string;
  readonly base: 'main';
  /** The exact set of repository-relative paths this PR stages. */
  readonly stagedSet: readonly string[];
  state: 'open' | 'merged';
  /** The 40-hex merge commit, once merged. */
  mergeCommit: CommitId | null;
  /** Whether the PR still shows in Inbox; a merged PR leaves Inbox. */
  inInbox: boolean;
}

export class FakePrRegistry {
  private readonly prs: FakePrRecord[] = [];
  private nextId = 1;

  /** Open ONE PR against fixture `main`. The base is fixed; there is no live-branch target. */
  open(branch: string, stagedSet: readonly string[]): FakePrRecord {
    const record: FakePrRecord = {
      id: this.nextId,
      branch,
      base: 'main',
      stagedSet: [...stagedSet].sort(),
      state: 'open',
      mergeCommit: null,
      inInbox: true,
    };
    this.nextId += 1;
    this.prs.push(record);
    return record;
  }

  /** Merge an open PR, minting its merge commit and dropping it from Inbox. Idempotent. */
  merge(id: number, mintCommit: () => CommitId): FakePrRecord {
    const record = this.prs.find((pr) => pr.id === id);
    if (!record) throw new Error(`no fixture PR ${id}`);
    if (record.state === 'merged') return record;
    record.state = 'merged';
    record.mergeCommit = mintCommit();
    record.inInbox = false;
    return record;
  }

  all(): readonly FakePrRecord[] {
    return this.prs;
  }

  openCount(): number {
    return this.prs.filter((pr) => pr.state === 'open').length;
  }
}

// ---------------------------------------------------------------------------------------------------
// P4 §8 fixture HTTPS server — serves the closed Inbox surface over the fixture stores.
//
// Not a stand-in for a JSON blob: the two sources are PROJECTED through the production
// `projectP4Inbox` over the real `contracts.ts` id/href/revision formulas, and the composed response
// is run back through `decodeInboxResponse` before it is ever served, so a shape drift fails HERE at
// fixture start rather than in a browser cell. The app-shell page fetches `/api/inbox` and mounts a
// `div#root > div.app-shell` marker, which is exactly what the §8 browser runner's reached-the-app
// guard asserts (shared with the P3 runner).
// ---------------------------------------------------------------------------------------------------

export type P4Scenario = 'pr-escalation-states' | 'partial-source-failure' | 'empty-inbox';
export const P4_SCENARIOS: readonly P4Scenario[] = [
  'pr-escalation-states', 'partial-source-failure', 'empty-inbox',
];

/** The composition-time pin the PR source projects against; never accepted from subject text [P4-C25]. */
const P4_PR_OWNER = 'kb-fleet';
const P4_PR_REPO = 'dashboard';
const P4_VERIFIED_AT = '2026-08-25T00:00:00.000Z';

function prSubjectFrom(record: FakePrRecord, createdAt: string, title: string): PrSubject {
  const subject = { owner: P4_PR_OWNER, repo: P4_PR_REPO, number: record.id };
  return {
    kind: 'pr',
    id: inboxItemId('pr', prSubjectKeyString(subject)),
    createdAt,
    revision: `pr-${record.id}-${record.stagedSet.length}`,
    subject,
    title,
    href: prHref(subject),
  };
}

function escalationItem(
  cardId: string, createdAt: string, title: string, reason: string,
  related: { runRef?: string; stopEvent?: string },
): EscalationSubject {
  return {
    kind: 'escalation',
    id: inboxItemId('escalation', escalationSubjectKeyString(cardId)),
    createdAt,
    revision: `esc-${cardId}`,
    subject: { cardId },
    related,
    title,
    reason,
  };
}

/** Seed the two open PRs the PR source projects when a registry is not injected. */
function seedPrRegistry(): FakePrRegistry {
  const registry = new FakePrRegistry();
  registry.open('p4/mirror-batch-a', ['agents/luna.md']);
  registry.open('p4/learning-r7', ['docs/proposals/learnings/r7.md']);
  return registry;
}

const verifiedState = (revision: string): SourceState => ({
  status: 'verified', revision, verifiedAt: P4_VERIFIED_AT,
});

/**
 * Build the two independently-read sources for a scenario. `partial-source-failure` fails the PR source
 * while KEEPING its last-good items and marking them stale, exactly the P4-C34 partial-failure shape the
 * §8 matrix exists to render; the escalation source stays healthy so the Inbox is never emptied by it.
 */
function buildSources(scenario: P4Scenario, prRegistry: FakePrRegistry): P4InboxSources {
  const openPrs = prRegistry.all().filter((pr) => pr.inInbox);
  const prItems = openPrs.map((pr, index) =>
    prSubjectFrom(pr, `2026-08-2${String(5 - index)}T0${String(index)}:00:00.000Z`, `Mirror batch PR #${pr.id}`));
  const escItems: EscalationSubject[] = [
    escalationItem(
      '6a714a06-wake', '2026-08-24T12:00:00.000Z', 'wake-me: run failed',
      'segment-b2 render stalled past the 4-min stall policy', { runRef: 'the-second-take/bricks' },
    ),
    escalationItem(
      '8acba8e7-stop', '2026-08-23T09:00:00.000Z', 'wake-me: STOP raised',
      'fleet frozen by operator; preamble halted', { stopEvent: '0'.repeat(64) },
    ),
  ];

  if (scenario === 'empty-inbox') {
    return {
      pr: { items: [], state: verifiedState('pr-empty') },
      escalation: { items: [], state: verifiedState('esc-empty') },
    };
  }
  if (scenario === 'partial-source-failure') {
    return {
      pr: {
        items: prItems,
        state: { status: 'failed', errorCode: 'unavailable', stale: true, revision: 'pr-lastgood', verifiedAt: P4_VERIFIED_AT },
      },
      escalation: { items: escItems, state: verifiedState('esc-ok') },
    };
  }
  return {
    pr: { items: prItems, state: verifiedState('pr-ok') },
    escalation: { items: escItems, state: verifiedState('esc-ok') },
  };
}

/** Compose + contract-verify the Inbox response a scenario serves. Throws if the projection is invalid. */
export function composeP4Inbox(scenario: P4Scenario, prRegistry: FakePrRegistry): InboxResponse {
  return decodeInboxResponse(projectP4Inbox(buildSources(scenario, prRegistry)));
}

/** The self-contained app-shell page: fetches `/api/inbox` and mounts `div#root > div.app-shell`. */
function renderShellHtml(scenario: P4Scenario): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>kb Inbox (P4 fixture)</title>',
    '<style>',
    ':root { color-scheme: light dark; }',
    'body { margin: 0; font-family: system-ui, sans-serif; background: #0b0b0c; color: #eaeaea; }',
    '@media (prefers-color-scheme: light) { body { background: #ffffff; color: #111111; } }',
    '.app-shell { padding: 24px; max-width: 720px; margin: 0 auto; }',
    '.inbox-item { padding: 12px 0; border-bottom: 1px solid #333; }',
    '</style>',
    '</head>',
    '<body>',
    `<div id="root" data-scenario="${scenario}"></div>`,
    '<script>',
    '(function () {',
    '  var root = document.getElementById("root");',
    '  fetch("/api/inbox", { headers: { accept: "application/json" } })',
    '    .then(function (r) { return r.json(); })',
    '    .then(function (data) {',
    '      var shell = document.createElement("div");',
    '      shell.className = "app-shell";',
    '      shell.setAttribute("data-inbox-revision", data.revision);',
    '      var head = document.createElement("h1");',
    '      head.textContent = data.items.length ? ("Inbox (" + data.items.length + ")") : "Nothing needs you";',
    '      shell.appendChild(head);',
    '      var list = document.createElement("ul");',
    '      data.items.forEach(function (item) {',
    '        var li = document.createElement("li");',
    '        li.className = "inbox-item";',
    '        li.setAttribute("data-kind", item.kind);',
    '        li.textContent = (item.kind === "pr" ? "PR: " : "Escalation: ") + item.title;',
    '        list.appendChild(li);',
    '      });',
    '      shell.appendChild(list);',
    '      var sources = document.createElement("div");',
    '      sources.className = "inbox-sources";',
    '      sources.textContent = "pr:" + data.sources.pr.status + " escalation:" + data.sources.escalation.status;',
    '      shell.appendChild(sources);',
    '      root.appendChild(shell);',
    '    })',
    '    .catch(function () {',
    '      var shell = document.createElement("div");',
    '      shell.className = "app-shell";',
    '      shell.setAttribute("data-inbox-error", "1");',
    '      shell.textContent = "inbox failed to load";',
    '      root.appendChild(shell);',
    '    });',
    '})();',
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export interface P4FixtureServerOptions {
  port?: number;
  https?: boolean;
  scenario?: P4Scenario;
  /** The PR registry the PR source projects from; defaults to a scenario-seeded registry. */
  prRegistry?: FakePrRegistry;
  /** The control store the server binds over — held so the surface is served over the real fixture stores. */
  controlStore?: FixtureControlStore;
}

export interface P4FixtureServer {
  origin: string;
  address: { host: '127.0.0.1'; port: number };
  scenario: P4Scenario;
  certificate: string | null;
  /** Base64 SHA-256 SPKI pin the browser runner waives certificate errors for, or null on plain HTTP. */
  spkiPin: string | null;
  /** The composed, contract-decoded Inbox response this server serves. */
  inbox(): InboxResponse;
  usageBanner(): string;
  close(): Promise<void>;
}

/**
 * Start the REAL loopback server. HTTPS (with a self-signed loopback certificate and a published SPKI
 * pin) when `https` is set, plain HTTP otherwise. Binds 127.0.0.1 only; `--port 0` picks a free port and
 * the real port is read back after listen. Startable + closable, exactly like the P3 authenticated server.
 */
export async function startP4FixtureServer(options: P4FixtureServerOptions = {}): Promise<P4FixtureServer> {
  const port = options.port ?? 4421;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid port: ${String(port)}`);
  const scenario = options.scenario ?? 'pr-escalation-states';
  const prRegistry = options.prRegistry ?? seedPrRegistry();
  // Bound over the real fixture control store; the schedule-mirror surface it carries is the concern of
  // the isolated remote-lifecycle proof, so here it is simply held so this server is composed over it.
  const controlStore = options.controlStore ?? new FixtureControlStore();
  void controlStore;
  const inboxResponse = composeP4Inbox(scenario, prRegistry);
  const html = renderShellHtml(scenario);
  const tls = options.https === true ? await createLoopbackTlsMaterial() : null;

  const handler = (
    request: import('node:http').IncomingMessage, reply: import('node:http').ServerResponse,
  ): void => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/readyz') {
      reply.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      reply.end(JSON.stringify({ status: 'ready', scenario }));
      return;
    }
    if (path === '/api/inbox') {
      reply.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      reply.end(JSON.stringify(inboxResponse));
      return;
    }
    if (path === '/favicon.ico') {
      // A 204 rather than a 404: a failed favicon fetch logs a network error the browser runner counts.
      reply.writeHead(204, { 'cache-control': 'no-store' });
      reply.end();
      return;
    }
    reply.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    reply.end(html);
  };

  const server = tls === null ? createServer(handler) : createSecureServer({ cert: tls.cert, key: tls.key }, handler);
  await new Promise<void>((settle, fail) => {
    const onError = (error: Error): void => fail(error);
    server.once('error', onError);
    server.listen({ host: '127.0.0.1', port }, () => {
      server.off('error', onError);
      settle();
    });
  });
  const address = server.address() as AddressInfo;
  const origin = `${tls === null ? 'http' : 'https'}://127.0.0.1:${address.port}`;
  let certificate: string | null = null;
  let spkiPin: string | null = null;
  if (tls !== null) {
    publishLoopbackCertificate(address.port, tls.cert);
    certificate = tls.cert;
    spkiPin = spkiSha256Base64(tls.cert);
  }

  let closed = false;
  return {
    origin,
    address: { host: '127.0.0.1', port: address.port },
    scenario,
    certificate,
    spkiPin,
    inbox(): InboxResponse {
      return inboxResponse;
    },
    usageBanner(): string {
      return [
        `[p4-fixture] ${origin}`,
        `[p4-fixture] scenario=${scenario} items=${inboxResponse.items.length} pr=${inboxResponse.sources.pr.status} escalation=${inboxResponse.sources.escalation.status}`,
        `[p4-fixture] spki=${spkiPin ?? '(plain http, no pin)'}`,
      ].join('\n');
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (tls !== null) revokeLoopbackCertificate(address.port);
      await new Promise<void>((settle, fail) => {
        server.close((error) => (error ? fail(error) : settle()));
        server.closeAllConnections();
      });
    },
  };
}

export function parseP4FixtureServerArgs(argv: readonly string[]): P4FixtureServerOptions {
  const options: P4FixtureServerOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const takeValue = (): string => {
      if (value === undefined) throw new Error(`p4FixtureServer: ${String(flag)} needs a value`);
      index += 1;
      return value;
    };
    switch (flag) {
      case '--port': options.port = Number.parseInt(takeValue(), 10); break;
      case '--https': options.https = true; break;
      case '--scenario': {
        const scenario = takeValue();
        if (!P4_SCENARIOS.includes(scenario as P4Scenario)) {
          throw new Error(`p4FixtureServer: unknown --scenario ${scenario}`);
        }
        options.scenario = scenario as P4Scenario;
        break;
      }
      // Accepted and ignored: the lifecycle wrapper forwards --fixture uniformly (bounded vs remote).
      case '--fixture': takeValue(); break;
      default: throw new Error(`p4FixtureServer: unknown argument ${String(flag)}`);
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startP4FixtureServer(parseP4FixtureServerArgs(process.argv.slice(2)))
    .then((server) => {
      console.log(server.usageBanner());
      const shutdown = (): void => { void server.close().finally(() => process.exit(0)); };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
