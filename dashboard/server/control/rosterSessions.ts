/**
 * Run-roster pty sessions + gated work-order delivery (FYT gated-pipeline, Task 4).
 *
 * WHAT THIS IS. The design's execution substrate is a small roster of PERSISTENT, INTERACTIVE Claude
 * terminals — one per distinct agent id in the compiled workflow — spawned when a run is activated and
 * retired when it ships. Stages do not spawn anything: a stage executes by having its work order
 * DELIVERED into the owning agent's live session, and completes when that session prints the run-scoped
 * completion marker its order file names.
 *
 * WHY NOT `claudeSessionAdapter.ts` (the reuse evaluation the spec mandates). That adapter is a
 * ONE-SHOT headless transport: it spawns `claude` with `--output-format stream-json`, writes exactly one
 * approved prompt to stdin and then calls `endStdin()`, parses the transcript, and reports `onExit`. It
 * has no input channel after the first turn, no tty, and its lifetime is one prompt — the three
 * properties a persistent interactive roster session is defined by. Extending it would mean deleting the
 * stdin close, replacing stream-json with terminal bytes, and replacing exit-based completion with a
 * marker scanner, i.e. replacing the module while keeping its name. It stays untouched and still serves
 * the broker's managed-session path. What IS reused here is the pty stack it never touched:
 * `pty/host.ts` (the single node-pty spawner, credential-stripping env allowlist, process-group kill)
 * and `pty/persistentSessions.ts` (owner-bound sessions, output ring, attach/detach) — the same
 * registry the browser terminal attaches to, so the canvas can open any roster agent's real terminal.
 *
 * COORDINATION BRAIN. There is no second state system. Runs, stages, human requests and events stay in
 * `control/store.ts`; the engine's `stageBoundary` remains the single policy/gate authority. This module
 * holds only what is inherently ephemeral (which pty session currently backs which agent) and derives
 * everything else from the store. A pty child cannot survive a daemon restart, so resume RE-SPAWNS the
 * roster from durable run state rather than pretending to re-attach to a dead child.
 *
 * THE STRUCTURAL HALT. `deliver` re-reads the store and refuses — without writing an order file and
 * without writing one byte into the session — unless every human gate declared on the stage is recorded
 * resolved-approved and every `dependsOn` stage has succeeded. The engine already enforces this (plus
 * the whole policy envelope) before it ever calls a worker adapter; this second, store-derived check at
 * the delivery point is what makes "an unapproved gate means the work order provably never reaches the
 * session" a property of the delivery path itself. Policy is NOT re-evaluated here: duplicating that
 * decision would fork the authority that `stageBoundary` owns.
 *
 * TRUST POSTURE (read before widening anything). A roster session is an interactive Claude terminal in
 * the canonical checkout, spawned only after a passkey unlock (`activation.ts`), owned by the operator
 * `sub` that launched the run, with the pty host's credential denylist applied to its environment. It is
 * NOT sandboxed the way a headless attempt worktree is: the agent works where the project's
 * single-writer staging law says it must. The completion marker is therefore a COORDINATION signal, not
 * a security boundary — the per-delivery token proves the order file was read, not that an agent is
 * honest. The canonical stage result recorded for a delivered stage is a completion receipt (summary +
 * server-verified declared artifacts), never a worktree diff.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with `.ts` specifiers.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PtyHost } from '../pty/host.ts';
import type { PersistentSessionRegistry } from '../pty/persistentSessions.ts';
import type { AssignedAgentResolver, ResolvedAssignedAgent } from './agentAssignmentResolver.ts';
import type { ExecutionProfile } from './policy.ts';
import { isSafeRepoRelativePath, type PlanProposal, type ProposalStage, type ResolvedAgentAssignment } from './proposal.ts';
import type { ControlPlaneStore } from './store.ts';
import type { RunDetail } from './types.ts';
import type { WorkerAdapter, WorkerExecutionResult } from './execution.ts';

/** Terminal geometry for a roster session until the browser attaches and resizes it. */
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
/** Rolling scan window for completion markers (marker lines are short; this covers wrapped output). */
const SCAN_WINDOW_CHARS = 16_000;
/** Bound on the agent-reported completion summary carried into the canonical result. */
const MAX_SUMMARY_CHARS = 400;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Marker verdict + stage + per-delivery token, anchored at a line start after ANSI stripping. */
const MARKER = /^FYT-STAGE-(DONE|BLOCKED|FAILED)[ \t]+([A-Za-z0-9._:-]{1,128})[ \t]+([a-f0-9]{32})[ \t]*(.*)$/;
/**
 * The order file spells the verdict as this PLACEHOLDER, never as a literal `FYT-STAGE-DONE`. An agent
 * that `cat`s its own order file into the terminal therefore cannot fabricate a completion by echo — the
 * placeholder can never match {@link MARKER}.
 */
const VERDICT_PLACEHOLDER = 'FYT-STAGE-<VERDICT>';

export class RosterSessionError extends Error {}

/** Resolved launch parameters (`channel`, `slug`, `slice`, …) carried by the compiled proposal. */
export type RosterRunParameters = Readonly<Record<string, string>>;

export interface RosterAgentState {
  agentId: string;
  /** The live pty session id (attachable at `/api/pty?session=<id>`), or null when not spawned. */
  sessionId: string | null;
  status: 'active' | 'waiting' | 'blocked' | 'idle';
  /** One line, refreshed on delivery / completion / gate events. */
  activity: string;
  /** Agent ids this agent is waiting on, and/or gate ids blocking it. */
  waitingOn: string[];
}

export interface RosterEnsureResult {
  runRef: string;
  spawned: string[];
  existing: string[];
}

/** Injectable filesystem seam — tests never touch a real disk. */
export interface RosterFileSystem {
  ensureDir(path: string): void;
  writeFile(path: string, contents: string): void;
  exists(path: string): boolean;
}

export interface RosterSessionsOptions {
  store: ControlPlaneStore;
  /** Canonical checkout. Session cwd and declared-artifact verification are anchored here. */
  repoRoot: string;
  /** Dashboard state root (outside the repo): binding contexts and order files live here. */
  stateRoot: string;
  host: PtyHost;
  registry: PersistentSessionRegistry;
  /** The SAME server-owned verifier the engine uses; identity/hash/runner-bound/profile all re-proven. */
  assignedAgents: AssignedAgentResolver;
  resolveProfiles: (project: string) => readonly ExecutionProfile[];
  fs?: RosterFileSystem;
  now?: () => number;
  /** 32 lowercase hex chars per delivery. */
  mintToken?: () => string;
  cols?: number;
  rows?: number;
  /** The single line that boots the interactive agent terminal. */
  launchLine?: (input: { model: string; bindingPath: string; runRef: string; agentId: string }) => string;
  /** The single line that hands a stage's order file to a live session. */
  deliveryLine?: (input: { orderPath: string; stageId: string }) => string;
}

export interface RosterEnsureInput {
  subject: string;
  runRef: string;
  proposal: PlanProposal;
  /** pty ownership. Defaults to `subject` (the operator that launched the run). */
  owner?: string;
}

export interface RosterDeliveryInput {
  subject: string;
  runRef: string;
  stageRef: string;
  stageId: string;
  attemptRef: string;
  proposalStage: ProposalStage;
  project: string;
  /** Present only when the engine's resolver verified this stage's declaration. */
  assignedAgent?: ResolvedAssignedAgent;
}

export interface RosterSessionManager {
  /** Idempotent: spawn one session per distinct agent id (manager included); resume-safe. */
  ensureRoster(input: RosterEnsureInput): RosterEnsureResult;
  hasRoster(runRef: string): boolean;
  /** Gate-checked delivery; resolves when the session reports the delivery's own marker. */
  deliver(input: RosterDeliveryInput): Promise<WorkerExecutionResult>;
  /** Graceful stop + reap for one run's roster (run terminal, operator stop, or Lock). */
  retire(runRef: string, reason: string): string[];
  /** Retire every roster (execution Lock / daemon drain). */
  retireAll(reason: string): string[];
  /** Canvas-facing projection (Task 5): derived from the store on demand, never polled. */
  state(subject: string, runRef: string): RosterAgentState[];
}

interface RosterSessionEntry {
  agentId: string;
  sessionId: string;
  owner: string;
  model: string;
  bindingPath: string;
  buffer: string;
  unobserve: () => void;
  /** At most one outstanding delivery per agent session (a terminal runs one order at a time). */
  pending: PendingDelivery | null;
}

interface PendingDelivery {
  stageId: string;
  token: string;
  settle: (result: WorkerExecutionResult) => void;
}

interface RosterRunEntry {
  subject: string;
  owner: string;
  project: string;
  parameters: RosterRunParameters;
  workDir: string;
  sessions: Map<string, RosterSessionEntry>;
  /** Last one-line activity per agent id (durably mirrored as `roster:` store events). */
  activity: Map<string, string>;
}

const defaultFileSystem: RosterFileSystem = {
  ensureDir: (path) => { mkdirSync(path, { recursive: true }); },
  writeFile: (path, contents) => { writeFileSync(path, contents, { encoding: 'utf8' }); },
  exists: (path) => existsSync(path),
};

/** Drop ANSI/OSC control sequences and bare carriage returns so marker scanning sees plain lines. */
export function stripTerminalControl(chunk: string): string {
  /* eslint-disable no-control-regex */
  return chunk
    // OSC (window title etc.), then CSI (colour/cursor), then any other two-byte escape.
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    // Remaining C0/DEL noise, keeping the tab and newlines the line scanner needs.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r/g, '\n');
  /* eslint-enable no-control-regex */
}

/** Bound and flatten an agent-reported summary before it becomes canonical result content. */
function safeSummary(raw: string, fallback: string): string {
  const flattened = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS);
  return flattened === '' ? fallback : flattened;
}

/** Every distinct agent id in the compiled proposal — worker stages plus the manager. */
export function rosterAgentIds(proposal: PlanProposal): string[] {
  const ids: string[] = [];
  const add = (assignment: ResolvedAgentAssignment | undefined): void => {
    if (!assignment || !SAFE_AGENT_ID.test(assignment.agentId) || ids.includes(assignment.agentId)) return;
    ids.push(assignment.agentId);
  };
  add(proposal.manager.assignment);
  for (const stage of proposal.stages) add(stage.assignment);
  return ids;
}

/**
 * The directory a run's agents work in: the video/work directory when the launch parameters name one,
 * else the project tree, else the repo root — always the DEEPEST existing candidate, so a run whose
 * work directory does not exist yet still opens in a real place (its first stage creates the rest).
 * Never accepts a parameter value as a path fragment without the safe-segment shape the launch route
 * already enforced.
 */
export function resolveRosterWorkDir(
  repoRoot: string,
  project: string,
  parameters: RosterRunParameters,
  exists: (path: string) => boolean,
): string {
  const candidates: string[] = [];
  const safeSegment = (value: string | undefined): string | null =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : null;
  const channel = safeSegment(parameters.channel);
  const slug = safeSegment(parameters.slug);
  if (channel && slug) candidates.push(join(repoRoot, 'orgs', project, 'channels', channel, 'videos', slug));
  if (channel) candidates.push(join(repoRoot, 'orgs', project, 'channels', channel));
  candidates.push(join(repoRoot, 'orgs', project));
  for (const candidate of candidates) if (exists(candidate)) return candidate;
  return repoRoot;
}

function defaultLaunchLine(input: { model: string; bindingPath: string; runRef: string; agentId: string }): string {
  return `claude --model ${input.model} "Read ${input.bindingPath} now. It is your binding context for run `
    + `${input.runRef} as ${input.agentId}: follow it exactly, then wait — work orders arrive in this terminal `
    + `as file paths, one at a time."`;
}

function defaultDeliveryLine(input: { orderPath: string; stageId: string }): string {
  return `Work order for stage ${input.stageId}: read ${input.orderPath} and execute it now, then print the `
    + `completion marker exactly as that file specifies.`;
}

/** Human-request title shape the engine uses for a declared gate (`execution.ts#stableHumanTitle`). */
function gateRequestTitle(stageId: string, gateId: string): string {
  return `automatic:gate:${stageId}:${gateId}`.slice(0, 240);
}

/** Whether one recorded request counts as its gate's acceptance (mirrors `stageBoundary`'s kind rules). */
function gateAccepted(request: RunDetail['humanRequests'][number] | undefined, kind: string): boolean {
  if (!request || request.state !== 'resolved' || request.response === null) return false;
  if (kind === 'governance-refusal') return false;
  if (kind === 'approval' || kind === 'review') return request.response.decision === 'approved';
  return request.response.decision === 'approved' || request.response.decision === 'responded';
}

/**
 * Store-derived deliverability. Returns `null` when the work order may be written, or the refusal reason
 * that must be recorded instead. Deliberately narrow: gates and dependencies only — the policy envelope
 * belongs to `stageBoundary`, which has already run.
 */
export function rosterDeliveryRefusal(detail: RunDetail, input: {
  stageRef: string;
  stageId: string;
  proposalStage: ProposalStage;
}): string | null {
  const stage = detail.stages.find((candidate) => candidate.stageRef === input.stageRef);
  if (!stage || stage.stageId !== input.stageId) return 'stage is not part of this run';
  if (detail.humanRequests.some((request) => request.stageRef === input.stageRef && request.state === 'open')) {
    return 'an open human request is bound to this stage';
  }
  for (const gate of input.proposalStage.humanGates) {
    const title = gateRequestTitle(input.stageId, gate.id);
    const request = detail.humanRequests.find((candidate) => candidate.stageRef === input.stageRef && candidate.title === title);
    if (!gateAccepted(request, gate.kind)) return `human gate '${gate.id}' is not approved`;
  }
  for (const dependencyId of input.proposalStage.dependsOn) {
    const dependency = detail.stages.find((candidate) => candidate.stageId === dependencyId);
    if (!dependency || dependency.state !== 'succeeded') return `dependency stage '${dependencyId}' has not succeeded`;
  }
  return null;
}

/** Create the run-roster session manager. Nothing spawns until `ensureRoster` is called. */
export function createRosterSessionManager(options: RosterSessionsOptions): RosterSessionManager {
  const fs = options.fs ?? defaultFileSystem;
  const now = options.now ?? Date.now;
  const mintToken = options.mintToken ?? (() => randomBytes(16).toString('hex'));
  const cols = options.cols ?? DEFAULT_COLS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const launchLine = options.launchLine ?? defaultLaunchLine;
  const deliveryLine = options.deliveryLine ?? defaultDeliveryLine;
  const runs = new Map<string, RosterRunEntry>();

  const runDir = (runRef: string): string => join(options.stateRoot, 'control', 'roster', runRef);

  const record = (subject: string, runRef: string, agentId: string, activity: string, status: 'pending' | 'success' | 'failure' | 'waiting' | 'interrupted', stageRef?: string): void => {
    const entry = runs.get(runRef);
    if (entry) entry.activity.set(agentId, activity);
    // Durable mirror so an activity line survives a daemon restart (the pty session does not).
    options.store.appendEvent(subject, runRef, {
      kind: 'lifecycle',
      source: 'system',
      status,
      ...(stageRef ? { stageRef } : {}),
      summary: `roster:${agentId} ${activity}`.slice(0, 480),
    });
  };

  const assignmentFor = (proposal: PlanProposal, agentId: string): { assignment: ResolvedAgentAssignment; role: 'manager' | 'worker' } | null => {
    if (proposal.manager.assignment?.agentId === agentId) {
      return { assignment: proposal.manager.assignment, role: 'manager' };
    }
    const stage = proposal.stages.find((candidate) => candidate.assignment?.agentId === agentId);
    return stage?.assignment ? { assignment: stage.assignment, role: 'worker' } : null;
  };

  const bindingMarkdown = (input: {
    runRef: string;
    agentId: string;
    verified: ResolvedAssignedAgent;
    project: string;
    parameters: RosterRunParameters;
    workDir: string;
  }): string => {
    const params = Object.keys(input.parameters).sort()
      .map((key) => `- ${key}: ${input.parameters[key]}`)
      .join('\n');
    return [
      `# Binding context — ${input.agentId} on run ${input.runRef}`,
      '',
      'This file was written by the kb dashboard control plane when your terminal was spawned. It is',
      'binding: it is the only authority for who you are on this run.',
      '',
      '## Verified declaration',
      '',
      `- agent id: ${input.agentId}`,
      `- declaration: ${input.verified.assignment.declarationPath}`,
      `- declaration sha256: ${input.verified.assignment.declarationHash}`,
      `- execution profile: ${input.verified.assignment.profileId}`,
      `- runtime/model: ${input.verified.assignment.runtime}/${input.verified.assignment.model}`,
      '',
      'The declaration below is the verbatim body the server verified against that hash. Re-read the',
      'canonical file if you need it, and refuse to act as any other agent.',
      '',
      '<<<DECLARATION',
      input.verified.instructionMarkdown,
      'DECLARATION>>>',
      '',
      '## Run',
      '',
      `- run: ${input.runRef}`,
      `- project: ${input.project}`,
      `- work directory: ${input.workDir}`,
      params === '' ? '- parameters: none' : `- parameters:\n${params}`,
      '',
      '## How work reaches you',
      '',
      'You never pick your own next task. The control plane delivers ONE work-order file path into this',
      'terminal when — and only when — every human gate in front of that stage is approved and its',
      'upstream stages have landed. Until a path arrives you are idle by design: do not start downstream',
      'work, do not approve anything, and do not spend.',
      '',
      'Each order file names the exact completion marker to print when the stage is genuinely finished,',
      'including a token that only that file carries. Print it on its own line, once, at the end.',
      '',
      'The human may talk to you in this terminal at any time. Answer, iterate, and keep waiting.',
    ].join('\n');
  };

  const orderMarkdown = (input: {
    runRef: string;
    stageId: string;
    token: string;
    proposalStage: ProposalStage;
    parameters: RosterRunParameters;
    workDir: string;
  }): string => {
    const artifacts = input.proposalStage.artifacts.map((artifact) => `- ${artifact.path} — ${artifact.description}`);
    const checkpoints = input.proposalStage.checkpoints.map((checkpoint) => `- ${checkpoint.id}: ${checkpoint.label}`);
    const params = Object.keys(input.parameters).sort().map((key) => `- ${key}: ${input.parameters[key]}`);
    return [
      `# Work order — stage ${input.stageId} (run ${input.runRef})`,
      '',
      `- title: ${input.proposalStage.title}`,
      `- action: ${input.proposalStage.action}`,
      `- target: ${input.proposalStage.target}`,
      `- risk tier: ${input.proposalStage.riskTier}`,
      `- work directory: ${input.workDir}`,
      params.length === 0 ? '- parameters: none' : `- parameters:\n${params.join('\n')}`,
      '',
      '## Instructions',
      '',
      input.proposalStage.workOrder,
      '',
      '## Approved scope',
      '',
      `- read: ${input.proposalStage.scope.read.join(', ') || 'none'}`,
      `- write: ${input.proposalStage.scope.write.join(', ') || 'none'}`,
      artifacts.length === 0 ? '- declared artifacts: none' : `- declared artifacts:\n${artifacts.join('\n')}`,
      checkpoints.length === 0 ? '- checkpoints: none' : `- checkpoints:\n${checkpoints.join('\n')}`,
      '',
      '## Completion protocol',
      '',
      `- completion token: ${input.token}`,
      `- when the stage is finished, print ONE line: ${VERDICT_PLACEHOLDER} ${input.stageId} ${input.token} <one-line summary>`,
      '- replace <VERDICT> with DONE (finished), BLOCKED (needs a human), or FAILED (cannot finish).',
      '- print it once, at a line start, after the work is really on disk. The control plane is watching',
      '  this terminal for exactly that line and advances the run on it.',
      '- never print the marker for a stage or token other than the ones above.',
    ].join('\n');
  };

  const scan = (entry: RosterSessionEntry, chunk: string): void => {
    const pending = entry.pending;
    if (!pending) {
      // Keep the window bounded even while idle so a chatty session cannot grow memory.
      entry.buffer = (entry.buffer + stripTerminalControl(chunk)).slice(-SCAN_WINDOW_CHARS);
      return;
    }
    entry.buffer = (entry.buffer + stripTerminalControl(chunk)).slice(-SCAN_WINDOW_CHARS);
    const lines = entry.buffer.split('\n');
    // Keep the trailing partial line for the next chunk; a marker is only acted on once complete.
    entry.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const match = MARKER.exec(line.trim());
      if (!match) continue;
      const [, verdict, stageId, token, rest] = match;
      if (stageId !== pending.stageId || token !== pending.token) continue;
      entry.pending = null;
      const summary = safeSummary(rest ?? '', `stage ${stageId} reported ${verdict.toLowerCase()}`);
      if (verdict === 'DONE') {
        pending.settle({ state: 'succeeded', summary, usage: zeroUsage(), artifacts: [], checkpoints: [] });
      } else if (verdict === 'BLOCKED') {
        pending.settle({ state: 'waiting-human', summary, usage: zeroUsage(), artifacts: [], checkpoints: [] });
      } else {
        pending.settle({ state: 'failed', summary, usage: zeroUsage(), artifacts: [], checkpoints: [] });
      }
      return;
    }
  };

  const settlePending = (run: RosterRunEntry, runRef: string, entry: RosterSessionEntry, summary: string): void => {
    const pending = entry.pending;
    if (!pending) return;
    entry.pending = null;
    record(run.subject, runRef, entry.agentId, summary, 'interrupted');
    pending.settle({ state: 'waiting-human', summary, usage: zeroUsage(), artifacts: [], checkpoints: [] });
  };

  const spawnSession = (run: RosterRunEntry, runRef: string, agentId: string, verified: ResolvedAssignedAgent): RosterSessionEntry => {
    const agentDir = join(runDir(runRef), agentId);
    fs.ensureDir(join(agentDir, 'orders'));
    const bindingPath = join(agentDir, 'binding.md');
    fs.writeFile(bindingPath, bindingMarkdown({
      runRef, agentId, verified, project: run.project, parameters: run.parameters, workDir: run.workDir,
    }));
    const created = options.registry.create(run.owner, options.host, {
      requestId: '', cwd: run.workDir, cols, rows,
    });
    const entry: RosterSessionEntry = {
      agentId,
      sessionId: created.sessionId,
      owner: run.owner,
      model: verified.assignment.model,
      bindingPath,
      buffer: '',
      unobserve: () => {},
      pending: null,
    };
    entry.unobserve = options.registry.observe(
      run.owner,
      created.sessionId,
      (chunk) => scan(entry, chunk),
      // The shell died (crash, operator close, daemon drain). Settle any outstanding delivery as a human
      // wait instead of leaving the engine awaiting output that can never arrive.
      () => settlePending(run, runRef, entry, `delivery abandoned: session ${created.sessionId} ended`),
    );
    options.registry.write(run.owner, created.sessionId, `${launchLine({
      model: verified.assignment.model, bindingPath, runRef, agentId,
    })}\r`);
    run.sessions.set(agentId, entry);
    record(run.subject, runRef, agentId, `session ${created.sessionId} spawned at ${new Date(now()).toISOString()}`, 'pending');
    return entry;
  };

  const retireRun = (runRef: string, reason: string): string[] => {
    const run = runs.get(runRef);
    if (!run) return [];
    const retired: string[] = [];
    for (const entry of run.sessions.values()) {
      settlePending(run, runRef, entry, `delivery abandoned: roster retired (${reason})`);
      entry.unobserve();
      // Graceful stop first (the REPL exits cleanly and flushes), then reap the process group.
      try { options.registry.write(entry.owner, entry.sessionId, '/exit\r'); } catch { /* already gone */ }
      options.registry.close(entry.owner, entry.sessionId);
      retired.push(entry.sessionId);
      record(run.subject, runRef, entry.agentId, `session ${entry.sessionId} retired (${reason})`, 'success');
    }
    run.sessions.clear();
    runs.delete(runRef);
    return retired;
  };

  return {
    ensureRoster(input) {
      if (!SAFE_REF.test(input.runRef) || !SAFE_REF.test(input.subject)) {
        throw new RosterSessionError('run roster requires safe subject/run references');
      }
      const owner = input.owner ?? input.subject;
      const parameters = input.proposal.parameters ?? {};
      let run = runs.get(input.runRef);
      if (!run) {
        run = {
          subject: input.subject,
          owner,
          project: input.proposal.project,
          parameters,
          workDir: resolveRosterWorkDir(options.repoRoot, input.proposal.project, parameters, fs.exists),
          sessions: new Map(),
          activity: new Map(),
        };
        runs.set(input.runRef, run);
      }
      const profiles = options.resolveProfiles(input.proposal.project);
      const spawned: string[] = [];
      const existing: string[] = [];
      for (const agentId of rosterAgentIds(input.proposal)) {
        const live = run.sessions.get(agentId);
        // A session whose shell exited is no longer in the registry: re-spawn rather than deliver into a
        // corpse. This is also the daemon-restart path — every roster session is gone after a restart.
        if (live && options.registry.canAttach(run.owner, live.sessionId).ok) {
          existing.push(agentId);
          continue;
        }
        if (live) {
          live.unobserve();
          run.sessions.delete(agentId);
        }
        const found = assignmentFor(input.proposal, agentId);
        if (!found) throw new RosterSessionError(`roster agent '${agentId}' has no assignment in the approved proposal`);
        const verified = options.assignedAgents.resolve({
          assignment: found.assignment, role: found.role, project: input.proposal.project, profiles,
        });
        spawnSession(run, input.runRef, agentId, verified);
        spawned.push(agentId);
      }
      return { runRef: input.runRef, spawned, existing };
    },

    hasRoster(runRef) {
      return runs.has(runRef);
    },

    async deliver(input) {
      const run = runs.get(input.runRef);
      if (!run) throw new RosterSessionError(`run '${input.runRef}' has no live roster`);
      const agentId = input.assignedAgent?.assignment.agentId;
      if (!agentId) {
        // Fail closed: without a server-verified assignment there is no owning agent to deliver to, and
        // guessing one from prose would be exactly the smuggling this design forbids.
        throw new RosterSessionError(`stage '${input.stageId}' has no verified agent assignment to deliver to`);
      }
      const entry = run.sessions.get(agentId);
      if (!entry) throw new RosterSessionError(`roster agent '${agentId}' has no live session on run '${input.runRef}'`);
      if (entry.pending) throw new RosterSessionError(`roster agent '${agentId}' already has an outstanding work order`);

      // THE STRUCTURAL HALT. Re-read durable state and refuse before authoring the order file or
      // writing anything into the session.
      const detail = options.store.getRun(input.subject, input.runRef);
      if (!detail.ok) {
        return { state: 'waiting-human', summary: `roster delivery withheld: ${detail.detail}`, usage: zeroUsage(), artifacts: [], checkpoints: [] };
      }
      const refusal = rosterDeliveryRefusal(detail.value, {
        stageRef: input.stageRef, stageId: input.stageId, proposalStage: input.proposalStage,
      });
      if (refusal !== null) {
        const summary = `work order withheld: ${refusal}`;
        record(run.subject, input.runRef, agentId, summary, 'waiting', input.stageRef);
        return { state: 'waiting-human', summary: `roster delivery withheld: ${refusal}`, usage: zeroUsage(), artifacts: [], checkpoints: [] };
      }

      const token = mintToken();
      if (!/^[a-f0-9]{32}$/.test(token)) throw new RosterSessionError('roster completion token is malformed');
      const orderPath = join(runDir(input.runRef), agentId, 'orders', `${input.stageId}.md`);
      fs.ensureDir(join(runDir(input.runRef), agentId, 'orders'));
      fs.writeFile(orderPath, orderMarkdown({
        runRef: input.runRef, stageId: input.stageId, token, proposalStage: input.proposalStage,
        parameters: run.parameters, workDir: run.workDir,
      }));

      const settled = new Promise<WorkerExecutionResult>((resolve) => {
        entry.pending = { stageId: input.stageId, token, settle: resolve };
      });
      entry.buffer = '';
      const wrote = options.registry.write(entry.owner, entry.sessionId, `${deliveryLine({ orderPath, stageId: input.stageId })}\r`);
      if (!wrote) {
        entry.pending = null;
        const summary = `work order could not be written into session ${entry.sessionId}`;
        record(run.subject, input.runRef, agentId, summary, 'interrupted', input.stageRef);
        return { state: 'waiting-human', summary, usage: zeroUsage(), artifacts: [], checkpoints: [] };
      }
      record(run.subject, input.runRef, agentId, `working stage ${input.stageId}`, 'pending', input.stageRef);
      const result = await settled;
      if (result.state === 'succeeded') {
        // Declared artifacts are verified SERVER-SIDE before the completion is accepted; a marker alone
        // never satisfies a stage that promised files.
        const missing = input.proposalStage.artifacts
          .map((artifact) => artifact.path)
          .filter((path) => !isSafeRepoRelativePath(path) || !fs.exists(join(options.repoRoot, path)));
        if (missing.length > 0) {
          const summary = `stage ${input.stageId} reported done but declared artifacts are missing: ${missing.join(', ')}`;
          record(run.subject, input.runRef, agentId, summary, 'waiting', input.stageRef);
          return { state: 'waiting-human', summary: summary.slice(0, MAX_SUMMARY_CHARS), usage: zeroUsage(), artifacts: [], checkpoints: [] };
        }
      }
      record(
        run.subject, input.runRef, agentId,
        `stage ${input.stageId} ${result.state}: ${result.summary}`,
        result.state === 'succeeded' ? 'success' : result.state === 'failed' ? 'failure' : 'waiting',
        input.stageRef,
      );
      return result;
    },

    retire(runRef, reason) {
      return retireRun(runRef, reason);
    },

    retireAll(reason) {
      const retired: string[] = [];
      for (const runRef of [...runs.keys()]) retired.push(...retireRun(runRef, reason));
      return retired;
    },

    state(subject, runRef) {
      const run = runs.get(runRef);
      const detail = options.store.getRun(subject, runRef);
      if (!detail.ok) return [];
      return projectRosterState(detail.value, {
        sessions: run ? new Map([...run.sessions].map(([agentId, entry]) => [agentId, entry.sessionId])) : new Map(),
        working: run ? new Set([...run.sessions.values()].filter((entry) => entry.pending !== null).map((entry) => entry.agentId)) : new Set(),
        activity: run?.activity ?? new Map(),
        events: options.store.listEvents(subject, runRef, 0, 400),
      });
    },
  };
}

function zeroUsage(): { inputTokens: number; outputTokens: number; costUsdMicros: number } {
  // Subscription roster sessions report no metered usage; the accounting reservation still bounds them.
  return { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 };
}

export interface RosterStateProjectionInput {
  /** agentId → live pty session id. */
  sessions: ReadonlyMap<string, string>;
  /** Agent ids with an outstanding delivered work order. */
  working: ReadonlySet<string>;
  /** In-memory activity lines (authoritative while the daemon lives). */
  activity: ReadonlyMap<string, string>;
  /** Durable event mirror, used to recover activity lines after a restart. */
  events: ReturnType<ControlPlaneStore['listEvents']>;
}

/**
 * Project roster state for the canvas from durable run state plus the ephemeral session map. Pure and
 * synchronous: computed per request, so the server never runs a polling loop to keep it fresh.
 *
 * - `blocked` — a gate or other human request is open on one of the agent's stages (waitingOn = gate ids)
 * - `active`  — a work order is outstanding, or one of its stages is running
 * - `waiting` — it has unstarted work whose upstream stages have not landed (waitingOn = those agents)
 * - `idle`    — nothing outstanding
 */
export function projectRosterState(detail: RunDetail, input: RosterStateProjectionInput): RosterAgentState[] {
  const agentIds: string[] = [];
  const addAgent = (agentId: string | null | undefined): void => {
    if (typeof agentId === 'string' && agentId !== '' && !agentIds.includes(agentId)) agentIds.push(agentId);
  };
  addAgent(detail.run.managerAssignment?.agentId ?? null);
  for (const stage of detail.stages) addAgent(stage.assignment?.agentId ?? null);
  for (const agentId of input.sessions.keys()) addAgent(agentId);

  const ownerOf = new Map<string, string>();
  for (const stage of detail.stages) {
    if (stage.assignment?.agentId) ownerOf.set(stage.stageId, stage.assignment.agentId);
  }
  const durableActivity = new Map<string, string>();
  if (input.events.ok) {
    for (const event of input.events.value) {
      const match = /^roster:([a-z0-9][a-z0-9-]{0,63}) (.+)$/.exec(event.summary ?? '');
      if (match) durableActivity.set(match[1], match[2]);
    }
  }

  return agentIds.map((agentId) => {
    const stages = detail.stages.filter((stage) => stage.assignment?.agentId === agentId);
    const openRequests = detail.humanRequests.filter((request) =>
      request.state === 'open' && stages.some((stage) => stage.stageRef === request.stageRef));
    const running = stages.some((stage) => stage.state === 'running');
    const pendingStages = stages.filter((stage) => !['succeeded', 'failed', 'stopped'].includes(stage.state));
    const waitingOnAgents: string[] = [];
    for (const stage of pendingStages) {
      for (const dependencyId of stage.dependsOn) {
        const dependency = detail.stages.find((candidate) => candidate.stageId === dependencyId);
        if (!dependency || dependency.state === 'succeeded') continue;
        const owner = ownerOf.get(dependencyId);
        if (owner && owner !== agentId && !waitingOnAgents.includes(owner)) waitingOnAgents.push(owner);
      }
    }
    const status: RosterAgentState['status'] = openRequests.length > 0
      ? 'blocked'
      : input.working.has(agentId) || running
        ? 'active'
        : pendingStages.length > 0 && waitingOnAgents.length > 0
          ? 'waiting'
          : 'idle';
    const activity = input.activity.get(agentId)
      ?? durableActivity.get(agentId)
      ?? (status === 'blocked'
        ? `blocked: ${openRequests.map((request) => gateIdOf(request.title)).join(', ')} awaiting your approval`
        : status === 'active' ? 'working' : status === 'waiting' ? `waiting on ${waitingOnAgents.join(', ')}` : 'idle');
    return {
      agentId,
      sessionId: input.sessions.get(agentId) ?? null,
      status,
      activity,
      waitingOn: status === 'blocked'
        ? openRequests.map((request) => gateIdOf(request.title))
        : status === 'waiting' ? waitingOnAgents : [],
    };
  });
}

/** The gate/boundary id inside an engine-generated human-request title, else the whole title. */
function gateIdOf(title: string): string {
  const match = /^automatic:(?:gate|policy|budget|execution):[^:]+:(.+)$/.exec(title);
  return (match ? match[1] : title).slice(0, 120);
}

export interface RosterWorkerAdapterOptions {
  sessions: RosterSessionManager;
  /**
   * The proven headless adapter, used for every run WITHOUT a live roster (Wave-A kb-ops workflows).
   * This is a routing seam, not a second implementation of delivery: exactly one of the two adapters
   * handles a given run, decided by whether that run has a roster.
   */
  fallback: WorkerAdapter;
}

/**
 * Worker adapter that delivers a stage's work order into its owning roster session instead of spawning a
 * headless `claude -p`. Everything the engine does before calling `execute` — gate boundaries, the spend
 * gate, dependency release, policy, the accounting reservation — is unchanged and still upstream of this.
 */
export function createRosterWorkerAdapter(options: RosterWorkerAdapterOptions): WorkerAdapter {
  return {
    async execute(input) {
      if (!options.sessions.hasRoster(input.runRef)) return options.fallback.execute(input);
      // Fail closed: roster delivery is defined by the compiled stage (its gates, dependencies and
      // declared artifacts). Without that immutable object there is nothing to gate delivery against,
      // and reconstructing it from the loose fields would be exactly the guessing this design forbids.
      if (!input.proposalStage || !input.project) {
        throw new RosterSessionError('roster delivery requires the compiled stage and project from the engine');
      }
      return options.sessions.deliver({
        subject: input.subject,
        runRef: input.runRef,
        stageRef: input.stageRef,
        stageId: input.proposalStage.id,
        attemptRef: input.attemptRef,
        project: input.project,
        proposalStage: input.proposalStage,
        ...(input.assignment && input.instructionMarkdown
          ? { assignedAgent: { assignment: input.assignment, instructionMarkdown: input.instructionMarkdown } }
          : {}),
      });
    },
  };
}
