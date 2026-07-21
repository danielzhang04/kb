import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TimelineModel } from '../../src/lib/timelineModel.ts';
import type { ProviderIdProtector } from './protector.ts';
import { publicTimeline, redactSensitiveText } from './publicTimeline.ts';

export type ComposerWorkspaceState = 'open' | 'archived';
export type ComposerTurnStatus = 'running' | 'complete' | 'failed' | 'stopped' | 'interrupted';

export interface PublicComposerTurn {
  turnId: string;
  prompt: string;
  state: ComposerTurnStatus;
  model: TimelineModel | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** Immutable server-validated declaration identity attached to an agent-bound workspace. */
export interface ComposerAgentBinding {
  id: string;
  path: string;
  /** SHA-256 of the exact declaration source selected by the server at creation time. */
  sourceHash: string;
}

/**
 * Server-only immutable declaration snapshot for an agent-bound workspace. This is deliberately
 * separate from {@link ComposerAgentBinding}: the public workspace API may show the selected
 * declaration identity, but every provider turn must use the exact server-read instructions that
 * were selected at creation time, even after a reload, fork, or later file edit.
 */
export interface ComposerAgentSnapshot extends ComposerAgentBinding {
  instructionMarkdown: string;
}

export interface PublicComposerWorkspace {
  composerRef: string;
  title: string;
  state: ComposerWorkspaceState;
  sourceComposerRef: string | null;
  createdAt: string;
  updatedAt: string;
  /** Null for a generic Composer session; never contains runtime/provider configuration. */
  agent?: ComposerAgentBinding | null;
  turns: PublicComposerTurn[];
}

interface StoredWorkspace extends Omit<PublicComposerWorkspace, 'agent'> {
  subject: string;
  protectedProviderId: string | null;
  agent: ComposerAgentSnapshot | null;
}

interface StoreDocument {
  version: 1;
  workspaces: StoredWorkspace[];
}

export type WorkspaceLookup<T = PublicComposerWorkspace> =
  | { ok: true; workspace: T }
  | { ok: false; reason: 'not-found' };

export type LeaseResult =
  | {
    ok: true;
    lease: string;
    workspace: PublicComposerWorkspace;
    providerId: string | null;
    /** Private server context; never return this from an HTTP route. */
    agent: ComposerAgentSnapshot | null;
  }
  | { ok: false; reason: 'not-found' | 'archived' | 'busy' };

export type ArchiveResult =
  | { ok: true; workspace: PublicComposerWorkspace }
  | { ok: false; reason: 'not-found' | 'busy' };

export type ForkResult =
  | { ok: true; workspace: PublicComposerWorkspace }
  | { ok: false; reason: 'not-found' | 'busy' };

export interface ComposerWorkspaceStore {
  list(subject: string): PublicComposerWorkspace[];
  create(subject: string, title?: string, agent?: ComposerAgentSnapshot | null): PublicComposerWorkspace;
  get(subject: string, composerRef: string): WorkspaceLookup;
  fork(subject: string, composerRef: string): ForkResult;
  archive(subject: string, composerRef: string): ArchiveResult;
  restore(subject: string, composerRef: string): WorkspaceLookup;
  acquireWriter(subject: string, composerRef: string): LeaseResult;
  beginTurn(subject: string, composerRef: string, lease: string, prompt: string): WorkspaceLookup<PublicComposerTurn>;
  updateTurn(
    subject: string,
    composerRef: string,
    lease: string,
    turnId: string,
    patch: Partial<Pick<PublicComposerTurn, 'state' | 'model' | 'error' | 'endedAt'>>,
  ): boolean;
  setProviderId(subject: string, composerRef: string, lease: string, providerId: string): boolean;
  releaseWriter(subject: string, composerRef: string, lease: string): void;
}

interface StoreOptions {
  protector: ProviderIdProtector;
  now?: () => Date;
  newId?: () => string;
}

/** Resolve local daemon state outside the repo; explicit configuration always wins. */
export function resolveDashboardStateRoot(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DASHBOARD_STATE_ROOT?.trim();
  if (configured) return configured;
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData) return join(localAppData, 'kb', 'dashboard');
  return join(homedir(), '.kb', 'dashboard');
}

function visibleModel(model: TimelineModel | null): TimelineModel | null {
  return model ? publicTimeline(model) : null;
}

function publicTurn(turn: PublicComposerTurn): PublicComposerTurn {
  return {
    turnId: turn.turnId,
    prompt: redactSensitiveText(turn.prompt),
    state: turn.state,
    model: visibleModel(turn.model),
    error: turn.error ? redactSensitiveText(turn.error) : null,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
  };
}

/** Allowlist serializer: private subject/provider fields can never cross an API boundary by spreading. */
export function publicWorkspace(workspace: StoredWorkspace): PublicComposerWorkspace {
  return {
    composerRef: workspace.composerRef,
    title: redactSensitiveText(workspace.title),
    state: workspace.state,
    sourceComposerRef: workspace.sourceComposerRef,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    agent: workspace.agent
      ? { id: workspace.agent.id, path: workspace.agent.path, sourceHash: workspace.agent.sourceHash }
      : null,
    turns: workspace.turns.map(publicTurn),
  };
}

function emptyDocument(): StoreDocument {
  return { version: 1, workspaces: [] };
}

function makeStore(
  load: () => StoreDocument,
  save: (document: StoreDocument) => void,
  options: StoreOptions,
): ComposerWorkspaceStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  // Writer ownership is intentionally process-local. A crashed daemon cannot leave a durable stale lock.
  const leases = new Map<string, { lease: string; subject: string }>();

  const find = (document: StoreDocument, subject: string, composerRef: string): StoredWorkspace | undefined =>
    document.workspaces.find((workspace) => workspace.subject === subject && workspace.composerRef === composerRef);

  const authorizedLease = (subject: string, composerRef: string, lease: string): StoredWorkspace | null => {
    const held = leases.get(composerRef);
    if (!held || held.lease !== lease || held.subject !== subject) return null;
    const document = load();
    return find(document, subject, composerRef) ?? null;
  };

  return {
    list(subject) {
      return load().workspaces
        .filter((workspace) => workspace.subject === subject)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(publicWorkspace);
    },
    create(subject, title = 'New idea', agent = null) {
      const document = load();
      const stamp = now().toISOString();
      const workspace: StoredWorkspace = {
        composerRef: newId(),
        title: title.trim().slice(0, 200) || 'New idea',
        subject,
        state: 'open',
        sourceComposerRef: null,
        protectedProviderId: null,
        createdAt: stamp,
        updatedAt: stamp,
        agent: agent ? { ...agent } : null,
        turns: [],
      };
      document.workspaces.push(workspace);
      save(document);
      return publicWorkspace(workspace);
    },
    get(subject, composerRef) {
      const workspace = find(load(), subject, composerRef);
      return workspace ? { ok: true, workspace: publicWorkspace(workspace) } : { ok: false, reason: 'not-found' };
    },
    fork(subject, composerRef) {
      const document = load();
      const source = find(document, subject, composerRef);
      if (!source) return { ok: false, reason: 'not-found' };
      if (leases.has(composerRef)) return { ok: false, reason: 'busy' };
      const stamp = now().toISOString();
      const forked: StoredWorkspace = {
        composerRef: newId(),
        title: `${source.title} (fork)`.slice(0, 200),
        subject,
        state: 'open',
        sourceComposerRef: source.composerRef,
        // A provider session is mutable. Sharing it would make concurrent forks corrupt one another.
        protectedProviderId: null,
        createdAt: stamp,
        updatedAt: stamp,
        agent: source.agent ? { ...source.agent } : null,
        turns: source.turns.map(publicTurn),
      };
      document.workspaces.push(forked);
      save(document);
      return { ok: true, workspace: publicWorkspace(forked) };
    },
    archive(subject, composerRef) {
      const document = load();
      const workspace = find(document, subject, composerRef);
      if (!workspace) return { ok: false, reason: 'not-found' };
      if (leases.has(composerRef)) return { ok: false, reason: 'busy' };
      workspace.state = 'archived';
      workspace.updatedAt = now().toISOString();
      save(document);
      return { ok: true, workspace: publicWorkspace(workspace) };
    },
    restore(subject, composerRef) {
      const document = load();
      const workspace = find(document, subject, composerRef);
      if (!workspace) return { ok: false, reason: 'not-found' };
      workspace.state = 'open';
      workspace.updatedAt = now().toISOString();
      save(document);
      return { ok: true, workspace: publicWorkspace(workspace) };
    },
    acquireWriter(subject, composerRef) {
      const document = load();
      const workspace = find(document, subject, composerRef);
      if (!workspace) return { ok: false, reason: 'not-found' };
      if (workspace.state === 'archived') return { ok: false, reason: 'archived' };
      if (leases.has(composerRef)) return { ok: false, reason: 'busy' };
      let providerId: string | null = null;
      try {
        providerId = workspace.protectedProviderId ? options.protector.open(workspace.protectedProviderId) : null;
      } catch {
        // A daemon restart may rotate the dashboard session secret. Losing that key must not make the
        // operator's visible workspace/history unusable: discard only the unreadable provider
        // capability and let the turn route rehydrate a fresh Claude session from visible text.
        workspace.protectedProviderId = null;
        workspace.updatedAt = now().toISOString();
        save(document);
      }
      // Publish the process-local lease only after every potentially-throwing durable read/repair.
      // A failed decrypt-recovery write must not leave a workspace permanently busy until restart.
      const lease = newId();
      leases.set(composerRef, { lease, subject });
      return {
        ok: true,
        lease,
        workspace: publicWorkspace(workspace),
        providerId,
        agent: workspace.agent ? { ...workspace.agent } : null,
      };
    },
    beginTurn(subject, composerRef, lease, prompt) {
      if (!authorizedLease(subject, composerRef, lease)) return { ok: false, reason: 'not-found' };
      const document = load();
      const workspace = find(document, subject, composerRef);
      const held = leases.get(composerRef);
      if (!workspace || held?.lease !== lease || held.subject !== subject) return { ok: false, reason: 'not-found' };
      const stamp = now().toISOString();
      const turn: PublicComposerTurn = {
        turnId: newId(),
        prompt,
        state: 'running',
        model: null,
        error: null,
        startedAt: stamp,
        endedAt: null,
      };
      workspace.turns.push(turn);
      workspace.updatedAt = stamp;
      save(document);
      return { ok: true, workspace: publicTurn(turn) };
    },
    updateTurn(subject, composerRef, lease, turnId, patch) {
      if (!authorizedLease(subject, composerRef, lease)) return false;
      const document = load();
      const workspace = find(document, subject, composerRef);
      const turn = workspace?.turns.find((candidate) => candidate.turnId === turnId);
      const held = leases.get(composerRef);
      if (!workspace || !turn || held?.lease !== lease || held.subject !== subject) return false;
      if (patch.state !== undefined) turn.state = patch.state;
      if (patch.model !== undefined) turn.model = patch.model;
      if (patch.error !== undefined) turn.error = patch.error;
      const stamp = now().toISOString();
      if (patch.endedAt !== undefined) turn.endedAt = patch.endedAt;
      workspace.updatedAt = stamp;
      save(document);
      return true;
    },
    setProviderId(subject, composerRef, lease, providerId) {
      if (!authorizedLease(subject, composerRef, lease)) return false;
      const document = load();
      const workspace = find(document, subject, composerRef);
      const held = leases.get(composerRef);
      if (!workspace || held?.lease !== lease || held.subject !== subject) return false;
      workspace.protectedProviderId = options.protector.seal(providerId);
      workspace.updatedAt = now().toISOString();
      save(document);
      return true;
    },
    releaseWriter(subject, composerRef, lease) {
      // Releasing a process-local lease must remain possible even when durable storage is unavailable.
      const held = leases.get(composerRef);
      if (held?.lease === lease && held.subject === subject) leases.delete(composerRef);
    },
  };
}

export function createInMemoryComposerStore(options: StoreOptions): ComposerWorkspaceStore {
  let document = emptyDocument();
  return makeStore(
    () => structuredClone(document),
    (next) => {
      document = structuredClone(next);
    },
    options,
  );
}

/** File-backed production store. Every mutation writes a sibling temp file then atomically renames it. */
export function createFileComposerStore(stateRoot: string, options: StoreOptions): ComposerWorkspaceStore {
  const path = join(stateRoot, 'composer', 'workspaces.json');
  const load = (): StoreDocument => {
    if (!existsSync(path)) return emptyDocument();
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoreDocument;
    if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) throw new Error('invalid Composer store');
    return parsed;
  };
  const save = (document: StoreDocument): void => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(document)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      renameSync(temp, path);
    } finally {
      if (existsSync(temp)) rmSync(temp, { force: true });
    }
  };
  // A daemon cannot resume request-owned streams after restart. Normalize any crash residue before
  // serving the catalog so the UI never presents a forever-running turn or blocks on a stale lease.
  const recovered = load();
  const recoveryStamp = (options.now ?? (() => new Date()))().toISOString();
  let changed = false;
  for (const workspace of recovered.workspaces) {
    for (const turn of workspace.turns) {
      if (turn.state !== 'running') continue;
      turn.state = 'interrupted';
      turn.error = 'dashboard restarted before the Composer turn completed';
      turn.endedAt = recoveryStamp;
      workspace.updatedAt = recoveryStamp;
      changed = true;
    }
  }
  if (changed) save(recovered);
  return makeStore(load, save, options);
}
