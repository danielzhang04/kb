/**
 * Run-roster pty sessions + gated work-order delivery (FYT gated-pipeline, Task 4).
 *
 * WHAT THIS IS. The design's execution substrate is a small roster of PERSISTENT, INTERACTIVE Claude
 * terminals — one per distinct agent id in the compiled workflow — spawned when a run is activated and
 * retired when it ships. Stages do not spawn anything: a stage executes by having its work order
 * DELIVERED into the owning agent's live session, and completes when that session writes the run-scoped
 * status file its order names.
 *
 * WHY NOT `claudeSessionAdapter.ts` (the reuse evaluation the spec mandates). That adapter is a
 * ONE-SHOT headless transport: it spawns `claude` with `--output-format stream-json`, writes exactly one
 * approved prompt to stdin and then calls `endStdin()`, parses the transcript, and reports `onExit`. It
 * has no input channel after the first turn, no tty, and its lifetime is one prompt — the three
 * properties a persistent interactive roster session is defined by. Extending it would mean deleting the
 * stdin close and replacing stream-json with terminal bytes, i.e. replacing the module while keeping its
 * name. It stays untouched and still serves
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
 * single-writer staging law says it must. Completion is accepted only through a freshly cleared,
 * server-owned status path bound to the delivery token; terminal output is never an authorization
 * channel. The canonical stage result recorded for a delivered stage is a completion receipt (summary +
 * server-verified declared artifacts), never a worktree diff.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with `.ts` specifiers.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PtyHost } from '../pty/host.ts';
import type { PersistentSessionRegistry } from '../pty/persistentSessions.ts';
import type { AssignedAgentResolver, ResolvedAssignedAgent } from './agentAssignmentResolver.ts';
import type { ExecutionProfile } from './policy.ts';
import { createWorkflowToolPolicyResolver } from './claudeWorkerAdapter.ts';
import { isSafeRepoRelativePath, type PlanProposal, type ProposalScope, type ProposalStage, type ResolvedAgentAssignment } from './proposal.ts';
import type { ControlPlaneStore } from './store.ts';
import type { RunDetail } from './types.ts';
import type { WorkerAdapter, WorkerExecutionResult } from './execution.ts';

/** Terminal geometry for a roster session until the browser attaches and resizes it. */
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
/** Bound on the agent-reported completion summary carried into the canonical result. */
const MAX_SUMMARY_CHARS = 400;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** One path segment, no separators and no `..` — the traversal guard on any interpolated path fragment. */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/**
 * Bound on how long ONE delivery may sit unanswered before it settles as a human wait. Deliberately
 * generous: the longest real stage is a whole long-form script or a 130-200 call image batch — hours,
 * not minutes — and this exists to police NOTHING about pace. It exists because `settled` is otherwise
 * reachable only from a valid status file, a session exit, or a retire, so ONE missed status (a REPL that
 * never came up, a delivery line swallowed before a turn, or an agent that simply never wrote it) held the
 * engine's single worker slot forever, until an
 * operator noticed and ran `stop`. Overridable per stage and per delivery; clamped so no caller can set
 * it to zero or to "never".
 */
const DEFAULT_DELIVERY_TIMEOUT_MS = 4 * 60 * 60 * 1_000;
const MIN_DELIVERY_TIMEOUT_MS = 60 * 1_000;
const MAX_DELIVERY_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
/** Named, greppable settle reason so an operator can find every timed-out delivery in the event log. */
export const DELIVERY_TIMEOUT_REASON = 'roster-delivery-timeout';
/**
 * Named, greppable settle reason for a delivery that was NEVER TYPED because the target terminal was not
 * at a plain REPL prompt. Deliberately distinct from {@link DELIVERY_TIMEOUT_REASON}: that one means the
 * order landed and no status came back; this one means the order never left the control plane.
 */
export const DELIVERY_NOT_READY_REASON = 'roster-delivery-not-ready';
/**
 * How long ONE delivery may wait for its terminal to reach a plain REPL prompt before it settles as a
 * human wait. Generous, because the legitimate wait is real: a freshly spawned session is still booting
 * `claude` and then reading its binding context, and an agent mid-turn on operator conversation must be
 * allowed to finish. Clamped into [{@link MIN_REPL_READY_TIMEOUT_MS}, the delivery timeout] — the completion
 * deadline stays the OUTER bound, so this can never extend how long a stage may sit.
 */
const DEFAULT_REPL_READY_TIMEOUT_MS = 5 * 60 * 1_000;
const MIN_REPL_READY_TIMEOUT_MS = 5 * 1_000;
/** Readiness poll backoff: quick first re-checks (a menu is usually answered fast), then patient. */
const REPL_POLL_MIN_MS = 250;
const REPL_POLL_MAX_MS = 5_000;
/**
 * The gap between typing the order TEXT and sending the submit Enter, as two SEPARATE pty writes.
 *
 * Claude Code's REPL detects a paste by input arriving as one chunk, and folds a carriage return that
 * rides in the SAME chunk as the text into the pasted content as a newline instead of submitting it — so
 * `text + '\r'` in a single write leaves the order sitting UNSENT in the composer and no turn ever starts
 * (a stage that would then sit "running" with nothing delivered, the mirror of the readiness stall). The
 * Enter must therefore arrive as its OWN pty read, which this delay guarantees by letting the paste window
 * close first. Verified live off a faithful pty (claude.exe 2.1.220): a 250ms gap submitted reliably
 * (transcript grew from the delivered order); this uses 2× that for headroom over ConPTY write-coalescing
 * and paste-timing variance, and is negligible against a delivery that already spans seconds.
 */
const SUBMIT_ENTER_DELAY_MS = 500;
/**
 * OUTCOME-VERIFIED SUBMISSION (2026-07-30). The Enter at {@link SUBMIT_ENTER_DELAY_MS} is a WRITE, not a
 * proof: a bytes-written Enter has been observed FOUR times to leave no turn started — a paste-folded CR, an
 * open modal, a mistimed type into a splash, or an at/over-cap interactive block can each swallow it, and the
 * stage then reads "working" until the delivery deadline with nothing ever delivered. So after the
 * Enter, delivery now POLLS the terminal's own output for POSITIVE evidence a turn engaged before it trusts
 * the write, and re-submits (re-typing the line only if it is no longer on screen) up to {@link
 * SUBMIT_VERIFY_RETRIES} times; if no turn ever engages it PARKS LOUDLY (never a false "working").
 *
 * THE SIGNAL, chosen off a live faithful pty capture (claude.exe 2.1.220): a started turn transitions the
 * frame from the idle prompt to a BUSY frame within ~1-1.5s — the spinner footer ({@link BUSY_MARKERS}:
 * `esc to interrupt` / `(Ns ·` / `[↑↓] N tokens`), fresh (last chunk < {@link STALE_BUSY_QUIET_MS} ago). The
 * composer ECHO of the typed line carries no busy marker, so it never false-positives; a non-submitting
 * Enter leaves an idle {@link READY_MARKERS} frame still holding the un-submitted line.
 */
const SUBMIT_VERIFY_RETRIES = 3;
/** Per-attempt window to observe a turn engage. A real turn paints a matchable busy footer within ~1.5s. */
const SUBMIT_VERIFY_WINDOW_MS = 4_000;
/** Poll cadence inside a verify window. Injected `sleep` drives it, so the suite never waits on a real timer. */
const SUBMIT_VERIFY_POLL_MS = 300;
/** Poll cadence for the server-owned completion status file. */
const COMPLETION_STATUS_POLL_MS = SUBMIT_VERIFY_POLL_MS;
/** Named, greppable settle reason for a delivery whose Enter never started a turn across every retry. */
export const DELIVERY_NOT_ENGAGED_REASON = 'roster-delivery-not-engaged';
/**
 * Rolling window of terminal output kept for readiness detection. Small on purpose: an interactive REPL redraws its
 * whole frame continuously and `stripTerminalControl` cannot collapse those redraws, so only the tail is
 * the CURRENT screen — a large window would keep an already-answered menu "visible" forever.
 */
const SCREEN_WINDOW_CHARS = 4_000;
const SCREEN_WINDOW_LINES = 20;
/** Durable activity mirror written by `record` and read back by `state` after a daemon restart. */
const ROSTER_ACTIVITY = /^roster:([a-z0-9][a-z0-9-]{0,63}) (.+)$/;
/** Page size for the INCREMENTAL durable-event read behind `state` (bounded by the store's own cap). */
const EVENT_PAGE = 500;
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

/** What one declared artifact path is on disk. `null` from `stat` means "nothing there at all". */
export interface RosterFileStat {
  /**
   * True ONLY for a regular file. `existsSync` — the check this replaced — was also true for a DIRECTORY
   * named `shots.json`, so a stage could satisfy a declared artifact by creating a folder with its name.
   */
  regularFile: boolean;
  size: number;
}

/** Injectable filesystem seam — tests never touch a real disk. */
export interface RosterFileSystem {
  ensureDir(path: string): void;
  /** UTF-8 file contents, or `null` when the path cannot be read. */
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
  /** Delete one file if it exists. */
  removeFile(path: string): void;
  /** Regular-file-ness and size for one absolute path; `null` when the path does not exist. */
  stat(path: string): RosterFileStat | null;
  /**
   * sha256 of one absolute file's bytes. Called at most ONCE per artifact per delivery phase, and on the
   * verification side only when the size is unchanged and a content comparison is therefore unavoidable.
   */
  hashFile(path: string): string;
  /**
   * Recursive delete of a retired run's roster directory. Optional so an implementation that cannot
   * delete simply keeps the files — never so a caller can silently skip the cleanup.
   */
  removeDir?(path: string): void;
}

/**
 * What a declared artifact looked like at DELIVERY time — the baseline the completion is judged against.
 * Captured before the order file exists, so before the agent can have touched anything.
 */
interface ArtifactSnapshot {
  /** The declared repo-relative path, as written in the work order. */
  path: string;
  absolute: string;
  /**
   * True when the declared path is not a safe repo-relative path. Such a stage can never be verified, so
   * it can never succeed — recorded here rather than thrown so the run parks with a named reason.
   */
  unsafe: boolean;
  /**
   * The pre-existing content baseline, or `null` when there was nothing usable there (absent, a
   * directory, or a 0-byte file). `null` means any real file the stage writes counts as new work.
   */
  before: { size: number; hash: string } | null;
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
  launchLine?: (input: {
    model: string;
    bindingPath: string;
    settingsPath: string;
    mcpConfigPath: string;
    runRef: string;
    agentId: string;
  }) => string;
  /** The single line that hands a stage's order file to a live session. */
  deliveryLine?: (input: { orderPath: string; stageId: string }) => string;
  /**
   * Resolves a workflow execution profile id to its server-owned `allowedTools`. The per-run permission
   * settings are built from THIS and nothing else, so the roster can never grant a tool the profile
   * tables withhold. Defaults to the production resolver; an unresolvable/absent profile yields an empty
   * cap (no rules emitted) rather than a wider one.
   */
  resolveWorkflowTools?: (workflowProfileId: string | null) => readonly string[];
  /**
   * How long a delivery may wait for its terminal to reach a plain REPL prompt. Clamped to
   * [{@link MIN_REPL_READY_TIMEOUT_MS}, this delivery's completion deadline].
   */
  replReadyTimeoutMs?: number;
  /** Backoff sleep between readiness polls. Injected so the suite never waits on a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Completion-status deadline per delivery, in ms. A number applies to every stage; a function is consulted per
   * delivery, so a long stage (a full image batch) can be given more room than a short one. Clamped to
   * [{@link MIN_DELIVERY_TIMEOUT_MS}, {@link MAX_DELIVERY_TIMEOUT_MS}]; absent or non-finite falls back
   * to {@link DEFAULT_DELIVERY_TIMEOUT_MS}.
   */
  deliveryTimeoutMs?: number | ((input: { runRef: string; stageId: string; agentId: string }) => number);
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
  /** Per-delivery completion-status deadline override, in ms. Clamped exactly like the manager-level option. */
  timeoutMs?: number;
}

export interface RosterSessionManager {
  /** Idempotent: spawn one session per distinct agent id (manager included); resume-safe. */
  ensureRoster(input: RosterEnsureInput): RosterEnsureResult;
  hasRoster(runRef: string): boolean;
  /** Gate-checked delivery; resolves when the session writes the delivery's own status file. */
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
  settingsPath: string;
  /**
   * Rolling tail of this terminal's output. This is what the REPL-readiness gate reads, so it must survive
   * across deliveries and must keep accumulating while the session is idle — the whole point is to know
   * what is on screen BEFORE a work order is typed.
   */
  screen: string;
  /**
   * `now()` of the last semantic output appended to {@link RosterSessionEntry.screen}. The readiness gate
   * reads it to tell a LIVE turn (which repaints its spinner ≥1×/s) from a FINISHED turn whose spinner tail
   * is merely frozen in the window. Control-only repaints do not update it.
   */
  lastSemanticAt: number;
  /** When the terminal began continuously classifying ready; reset only by a non-ready semantic frame. */
  readySince: number | null;
  /** Incomplete trailing CSI/OSC bytes retained until the next pty chunk completes the sequence. */
  controlSuffix: string;
  /** Advances only when newly decoded bytes contain a busy transition. */
  busyObservationGeneration: number;
  unobserve: () => void;
  /** At most one outstanding delivery per agent session (a terminal runs one order at a time). */
  pending: PendingDelivery | null;
}

interface PendingDelivery {
  stageId: string;
  token: string;
  settle: (result: WorkerExecutionResult) => void;
  /**
   * The completion deadline for THIS delivery. Cleared on every settle path (status, session exit, retire),
   * so a delivery that already landed can never be re-settled by a late timer.
   */
  timer: ReturnType<typeof setTimeout> | null;
  /** The next server-owned status-file poll, if one is armed. */
  pollTimer: ReturnType<typeof setTimeout> | null;
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

/**
 * Chunk size for {@link defaultFileSystem}'s hash. Streaming in bounded chunks rather than
 * `readFileSync` keeps memory flat over the biggest declared artifact in this pipeline (`final.mp4`,
 * hundreds of MB), which a whole-file read would pull into the daemon's heap.
 */
const HASH_CHUNK_BYTES = 1024 * 1024;

const defaultFileSystem: RosterFileSystem = {
  ensureDir: (path) => { mkdirSync(path, { recursive: true }); },
  readFile: (path) => {
    try { return readFileSync(path, 'utf8'); } catch { return null; }
  },
  writeFile: (path, contents) => { writeFileSync(path, contents, { encoding: 'utf8' }); },
  removeFile: (path) => { rmSync(path, { force: true }); },
  stat: (path) => {
    try {
      const stats = statSync(path);
      return { regularFile: stats.isFile(), size: stats.size };
    } catch {
      return null;
    }
  },
  hashFile: (path) => {
    const hash = createHash('sha256');
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
      for (;;) {
        const read = readSync(fd, buffer, 0, HASH_CHUNK_BYTES, null);
        if (read <= 0) break;
        hash.update(buffer.subarray(0, read));
      }
    } finally {
      closeSync(fd);
    }
    return hash.digest('hex');
  },
  removeDir: (path) => { rmSync(path, { recursive: true, force: true }); },
};

/** Drop ANSI/OSC control sequences and bare carriage returns from terminal text. */
export function stripTerminalControl(chunk: string): string {
  /* eslint-disable no-control-regex */
  return chunk
    // OSC (window title etc.), then CSI (colour/cursor), then any other two-byte escape.
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[Hf]/g, '\n')
    .replace(/\u001b\[[0-9;]*[ -/]*C/g, ' ')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    // Remaining C0/DEL noise, keeping the tab and newlines the line scanner needs.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r/g, '\n');
  /* eslint-enable no-control-regex */
}

/**
 * Split off an incomplete trailing escape sequence. PTY chunk boundaries are arbitrary, so stripping each
 * chunk independently can leak the second half of a CSI/OSC sequence into the semantic screen.
 */
export function splitTerminalControlSuffix(chunk: string): { complete: string; suffix: string } {
  let state: 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' = 'text';
  let sequenceStart = -1;
  for (let index = 0; index < chunk.length; index += 1) {
    const code = chunk.charCodeAt(index);
    if (state === 'text') {
      if (code === 0x1b) {
        state = 'escape';
        sequenceStart = index;
      }
      continue;
    }
    if (state === 'escape') {
      if (chunk[index] === '[') state = 'csi';
      else if (chunk[index] === ']') state = 'osc';
      else {
        state = 'text';
        sequenceStart = -1;
      }
      continue;
    }
    if (state === 'csi') {
      if (code >= 0x40 && code <= 0x7e) {
        state = 'text';
        sequenceStart = -1;
      }
      continue;
    }
    if (state === 'osc') {
      if (code === 0x07) {
        state = 'text';
        sequenceStart = -1;
      } else if (code === 0x1b) {
        state = 'osc-escape';
      }
      continue;
    }
    if (chunk[index] === '\\') {
      state = 'text';
      sequenceStart = -1;
    } else if (code !== 0x1b) {
      state = 'osc';
    }
  }
  if (state === 'text' || sequenceStart < 0) return { complete: chunk, suffix: '' };
  return { complete: chunk.slice(0, sequenceStart), suffix: chunk.slice(sequenceStart) };
}

/**
 * Reconstruct terminal output for the bounded readiness frame, where cursor-positioning sequences must
 * disappear instead of becoming line boundaries. CUF is different: it is horizontal spacing inside a
 * rendered sentence and must become one literal space or modal words glue together and evade classification.
 */
function stripForScreenWindow(chunk: string): string {
  /* eslint-disable no-control-regex */
  return chunk
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;]*[ -/]*C/g, ' ')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r/g, '\n');
  /* eslint-enable no-control-regex */
}

/**
 * A modal prompt is on screen: the REPL is NOT accepting a line of input, it is waiting for a keystroke
 * against a menu. Typing a work order here does not queue it — the characters are consumed by the menu's
 * own key handling and the order is silently destroyed. That is the observed defect: a delivery line
 * interleaved character-by-character with a tool-permission menu and vanished, and the stage then sat
 * against the delivery deadline.
 *
 * These match what the CLI renders around a decision, not what an agent might SAY. They are evaluated
 * only over the last {@link SCREEN_WINDOW_LINES} non-empty lines of the current frame, so an answered
 * menu stops matching as soon as the REPL redraws over it. A false positive costs a bounded wait and
 * then a named `waiting-human` park; a false negative costs a swallowed work order — so this errs toward
 * waiting.
 */
const MODAL_MARKERS: readonly RegExp[] = [
  /\bDo you want to\b/i,
  /\bWould you like to\b/i,
  /\bNo, and tell Claude\b/i,
  /\bYes, and (?:don't ask again|approve)\b/i,
  /^[\s│|>]*[❯>]?\s*[1-9]\.\s+(?:Yes|No)\b/im,
  /\bpress enter to (?:continue|confirm|accept)\b/i,
  /\b(?:accept|trust) (?:edits|files) in this folder\b/i,
  // DEFENSIVE: the FIRST-LAUNCH BYPASS-PERMISSIONS ACCEPTANCE MODAL. Roster terminals now boot
  // `permissions.defaultMode: "auto"`, which shows NO acceptance modal (verified live, claude.exe 2.1.220),
  // so this marker is no longer on the happy path. It is KEPT because a terminal must never hang silently
  // on ANY modal: if some config/mode path ever surfaces the bypass dialog, its `WARNING: … Bypass
  // Permissions mode … 1. No, exit 2. Yes, I accept` menu renders its numbered options as `1.No,exit` /
  // `2.Yes,Iaccept` — the columns are ANSI cursor moves, so there is NO literal whitespace and the generic
  // `[1-9]\.\s+(?:Yes|No)` marker above never matches. Whitespace here is therefore OPTIONAL (`\s*`), which
  // also survives the same word-boundary loss on `Bypass Permissions mode`. Recognising it turns any such
  // modal into a NAMED `roster-delivery-not-ready` park with a clear reason, never a swallowed order.
  /Bypass\s*Permissions\s*mode/i,
];
/**
 * The REPL is mid-turn. Input typed now is buffered by the CLI in a way that races its own re-render,
 * and delivering a second order on top of an unfinished one is exactly the "one order at a time"
 * invariant `entry.pending` exists to hold. Wait for the turn to end.
 *
 * WHAT THE CLI ACTUALLY RENDERS, CAPTURED OFF A REAL PTY (2.1.220), not inferred from its strings:
 *   `✽ Whatchamacalliting… ❯ esc to interrupt` … `(3s · thinking)` … `↓ 25 tokens · thinking)`
 * The interrupt hint is NOT a literal in the binary — `grep -a "to interrupt"` over `claude.exe` finds
 * ZERO hits, and an earlier review read that as proof this whole arm was dead. It is not: the hint is
 * COMPOSED at render time as `<chord> to <action>` (`Ue({chord, action:'interrupt'})` renders
 * `[chordLabel, ' to ', action]`) from the `chat:cancel` keybinding, whose default label is `esc`. A
 * string grep can never see it; a pty can, and did.
 *
 * That composition is also why the first pattern must not be the only one. The chord is user-rebindable
 * and the action wording is CLI copy, so the two patterns after it key on the spinner footer's
 * structure instead — an elapsed-seconds counter and a token counter, both of which a turn renders and
 * an idle prompt does not. A false positive costs a bounded wait and a named `waiting-human` park; a
 * false negative costs a swallowed work order.
 */
const BUSY_MARKERS: readonly RegExp[] = [
  /\b(?:esc|escape|ctrl\+?-?c) to (?:interrupt|cancel|stop)\b/i,
  // `(3s · thinking)` — the spinner's elapsed-time footer, independent of every word around it.
  /\(\d+s\s*[·|]/,
  // `↓ 25 tokens` / `↑ 1.2k tokens` — the in-flight token counter, only ever rendered mid-turn.
  /[↑↓]\s*[\d.,]+\s*[km]?\s*tokens\b/i,
];

/**
 * POSITIVE proof the interactive REPL is up and its input line is live. This is the permission-mode
 * cycler footer the CLI renders on EVERY in-REPL frame — idle and mid-turn alike — captured live under
 * `auto` mode as `⏵⏵ auto mode on (shift+tab to cycle)` (claude.exe 2.1.220). The `shift+tab to cycle`
 * tail is stable across modes, so the marker matches whatever mode the footer names. It is ABSENT on every
 * PRE-REPL screen: the theme picker, the "trust this folder" dialog, the login screen, and any acceptance
 * modal. That absence is exactly what distinguishes "a settled REPL waiting for a command" from
 * "a splash screen that will eat the keystrokes" — a distinction the old menu-absence heuristic could not
 * draw, which is how the acceptance modal's non-empty, busy-marker-free frame classified `ready` and
 * swallowed the work order (see {@link detectReplReadiness}).
 *
 * Whitespace is OPTIONAL: a redraw can position `shift+tab to cycle` with cursor moves rather than literal
 * spaces, so a stripped frame may read `shift+tabtocycle`. Captured off a real pty (claude.exe 2.1.220):
 * the string is stable CLI chrome, not composed per-turn like the interrupt hint.
 *
 * The trade this accepts (deliberately, and the inverse of the pre-fix comment): a CLI release that reworks
 * this footer makes delivery REFUSE (a named `roster-delivery-not-ready` park the operator sees and the
 * gated live test catches) rather than SWALLOW an order into a screen it cannot read. A loud park beats a
 * silent stall that reads "running" forever.
 */
const READY_MARKERS: readonly RegExp[] = [
  /shift\s*\+?\s*tab\s*to\s*cycle/i,
];

export type ReplReadiness =
  | { state: 'ready' }
  | { state: 'modal'; marker: string }
  | { state: 'busy'; marker: string }
  /** An idle marker is visible, but the frame has not yet stayed quiet long enough for delivery. */
  | { state: 'settling'; marker: string }
  /** Nothing has come back from this terminal at all — see {@link detectReplReadiness}. */
  | { state: 'silent'; marker: string };

/** The current frame: the last non-empty lines of the tail, which is all a redrawing REPL leaves true. */
function currentFrame(tail: string): string {
  return tail
    .slice(-SCREEN_WINDOW_CHARS)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .slice(-SCREEN_WINDOW_LINES)
    .join('\n');
}

/**
 * Classify a roster terminal's recent output as safe-to-type-into or not. Pure, so every accepted and
 * refused frame is testable without driving a pty.
 *
 * PROMPT-PRESENCE, NOT MENU-ABSENCE (reversed 2026-07-30 after the failure below). This now REQUIRES
 * positive evidence that the live REPL input line is on screen — a {@link READY_MARKERS} match — before it
 * will call a frame `ready`. The old rule ("non-empty AND no recognised menu ⇒ ready") swallowed a work
 * order: under the prior `bypassPermissions` posture a terminal opened on a `WARNING: … Bypass Permissions
 * mode … 1. No, exit 2. Yes, I accept` acceptance modal whose columns are ANSI cursor moves, so the frame is
 * non-empty, carries no whitespace the numbered-menu marker needs, and — when the `Esc to cancel` footer
 * collapses onto the menu line — carries no busy marker either. It classified `ready`, the order was typed
 * into the menu, the keystrokes were consumed, no turn began, and the stage sat "running" for 36 min with
 * zero transcript. The `auto` posture this pipeline now boots shows no such modal, but the theme picker,
 * the "trust this folder" dialog, and a still-starting REPL slip through the same hole — so the positive
 * input-line marker is what separates every one of those splash screens from a settled prompt, mode-independent.
 *
 * The precedence still refines the answer for a KNOWN blocker so the park message is specific: a recognised
 * MODAL menu (incl. any acceptance modal) reports `modal`; a mid-turn frame reports `busy`. Only
 * after neither matches AND the REPL footer IS present do we return `ready`.
 *
 * EVERY OTHER NON-EMPTY FRAME IS NOT READY. An empty frame is a shell that has not yet booted `claude`
 * (`ensureRoster` re-spawns the whole roster on the daemon-restart resume path, and a same-tick delivery
 * would hit a bare shell). A non-empty frame with no REPL footer is a splash/onboarding/login screen (or a
 * REPL still starting) — typing an order into it loses the order. Both classify `silent`, the caller waits
 * under its existing bound, and if the prompt never appears the delivery parks with a named human wait
 * rather than typing into the void.
 */
export function detectReplReadiness(tail: string): ReplReadiness {
  return classifyFrame(tail, false);
}

/**
 * The classifier core. `skipBusy` is the ONE lever the freshness gate pulls — see
 * {@link detectReplReadinessFresh}. MODAL precedence is unconditional (a menu is never typed into, however
 * long it has sat), so it is honoured even when busy markers are skipped; only the BUSY class is gateable.
 */
function classifyFrame(tail: string, skipBusy: boolean): ReplReadiness {
  const frame = currentFrame(tail);
  if (frame === '') return { state: 'silent', marker: 'no output yet' };
  for (const pattern of MODAL_MARKERS) {
    const match = pattern.exec(frame);
    if (match) return { state: 'modal', marker: match[0].trim().slice(0, 80) };
  }
  if (!skipBusy) {
    for (const pattern of BUSY_MARKERS) {
      const match = pattern.exec(frame);
      if (match) return { state: 'busy', marker: match[0].trim().slice(0, 80) };
    }
  }
  for (const pattern of READY_MARKERS) {
    if (pattern.test(frame)) return { state: 'ready' };
  }
  // Non-empty, not a recognised menu, not mid-turn — but the REPL input line has not appeared. A
  // splash/onboarding/login screen, or a REPL that has printed banner output but not yet its prompt.
  return { state: 'silent', marker: 'no REPL input prompt on screen yet' };
}

/**
 * How long the terminal must have been SILENT before a `busy` classification is treated as stale spinner
 * text rather than a live turn. A running turn repaints its spinner footer at least once a second (the
 * elapsed-seconds counter ticks), so ~2s of no output means the turn has ended and whatever
 * `(3s ·` / token-counter / `esc to interrupt` fragment the window still holds was painted over long ago.
 */
export const STALE_BUSY_QUIET_MS = 2_000;

/**
 * Freshness-gated readiness — the fix for the frozen-busy stall (2026-07-30).
 *
 * `entry.screen` is a LINEAR concatenation of stripped output (a redrawing REPL's in-place repaints cannot
 * be collapsed — see {@link stripTerminalControl}). So when a turn FINISHES the terminal falls silent and
 * the last-window slice stays frozen holding that turn's spinner tail. {@link detectReplReadiness} tests
 * BUSY before READY, matches the DEAD `(Ns ·` fragment, and returns `busy` forever: `waitForRepl` then
 * parks at its budget with "still mid-turn" even though the terminal is idle and typeable, and every
 * post-turn delivery — not just the first — hits it. A bigger budget never flips a frozen frame.
 *
 * The gate: if the base classification is `busy` BUT the terminal has been quiet for
 * {@link STALE_BUSY_QUIET_MS}, re-classify skipping ONLY the busy markers. MODAL is still honoured first
 * (a frozen menu still parks — the catastrophic swallow was always the menu case) and READY still REQUIRES
 * the `shift+tab to cycle` marker (so a theme/trust/login splash, which never carries it, stays not-ready).
 * The only path to `ready` is therefore: quiet ≥ threshold AND idle marker present AND not a modal. A live
 * turn is never quiet that long, and a mistimed type into one queues rather than being swallowed.
 *
 * PURE: `quietMs` is passed in (no clock read here), so the whole decision is unit-testable without a pty.
 */
export function detectReplReadinessFresh(tail: string, quietMs: number): ReplReadiness {
  const base = classifyFrame(tail, false);
  if (base.state === 'busy' && quietMs >= STALE_BUSY_QUIET_MS) return classifyFrame(tail, true);
  return base;
}

/**
 * Delivery-only readiness: the REPL must both classify `ready` AND have classified continuously ready for
 * {@link STALE_BUSY_QUIET_MS}. The stronger pre-type guarantee — "the terminal was idle before we typed" —
 * is what makes a FRESH busy frame inside the submit-verification window evidence that OUR order engaged.
 * A ready footer is rendered on every in-REPL frame, including while a boot initial-prompt turn is only
 * starting to paint; typing in that gap can queue the order into somebody else's turn, whose fresh busy
 * frame then becomes a false engagement signal. Such a ready-but-fresh frame reports `settling`, so delivery
 * keeps polling and can name the real condition if its readiness budget expires.
 *
 * Non-ready frames retain {@link detectReplReadinessFresh}'s result exactly, including its stale-busy
 * reclassification. PURE: both durations are supplied by the caller; the continuously-ready duration
 * defaults to semantic quiet for callers that have only one clock.
 */
export function detectReplReadinessSettled(
  tail: string,
  semanticQuietMs: number,
  continuouslyReadyMs = semanticQuietMs,
): ReplReadiness {
  const readiness = detectReplReadinessFresh(tail, semanticQuietMs);
  if (readiness.state === 'ready' && continuouslyReadyMs < STALE_BUSY_QUIET_MS) {
    return { state: 'settling', marker: 'REPL input prompt is visible but the screen is still painting' };
  }
  return readiness;
}

/** Whether newly decoded bytes contain a busy transition rendered by the live turn. */
function hasBusyTransition(decoded: string): boolean {
  return BUSY_MARKERS.some((pattern) => pattern.test(decoded));
}

/**
 * POSITIVE proof a submitted order actually STARTED A TURN. A generation snapshot is taken immediately
 * before Enter; only a busy transition decoded after that snapshot can engage the delivery. Retained spinner
 * text plus a fresh composer echo therefore cannot be mistaken for a new turn.
 */
export function detectTurnEngaged(observedGeneration: number, generationAtEnter: number): boolean {
  return observedGeneration > generationAtEnter;
}

/**
 * Whether the delivery line is still sitting on screen (space-insensitively, because a redrawing REPL
 * positions the composed line with cursor moves that {@link stripTerminalControl} can only approximate as
 * spaces). Used only to decide a retry's shape: if the line is gone the retry re-TYPES it, otherwise the
 * retry just re-sends Enter. The stage id is the stable, unique fragment of {@link defaultDeliveryLine}.
 */
function frameHasDeliveryLine(tail: string, stageId: string): boolean {
  const compact = currentFrame(tail).replace(/\s+/g, '').toLowerCase();
  return compact.includes(`forstage${stageId.replace(/\s+/g, '').toLowerCase()}`);
}

/**
 * Tools whose Claude Code permission rules carry a PATH pathspec — the file-scoped rules below, listed
 * here for when they are read as declared intent (see {@link buildRosterPermissionSettings}). `Bash` is
 * still absent from this list: a Bash rule matches a COMMAND PREFIX, never a path, so "Bash strictly
 * within scope" was never expressible as a rule and a bare `Bash` entry would have been a blanket
 * allow-all. That containment question is now moot for these sessions — Daniel's 2026-07-30 ruling
 * (`orgs/faceless-youtube/knowledge/decisions.md`) put roster terminals under autonomous operation
 * (`permissions.defaultMode: "auto"`, see below) with routine tool use cleared by auto mode's classifier
 * and governance carried by the `deny` floor, PreToolUse hooks, bindings, and the server-side workflow
 * gates instead of a scoped tool allow-list. The rules built from this list are kept in the settings file
 * regardless — harmless, and useful as a legible record of what each agent was actually scoped to do.
 */
const SCOPED_READ_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep'];
const SCOPED_WRITE_TOOLS: readonly string[] = ['Write', 'Edit'];

/** One absolute directory, forward-slashed and de-duplicated of separators. Not a rule — a real path. */
function absoluteDir(root: string, relative?: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (relative === undefined) return base;
  return `${base}/${relative.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}`;
}

/**
 * Anchor an absolute directory as a Claude Code rule pathspec — the SAME string this file hands to
 * `additionalDirectories` for the same directory, so there is exactly one path grammar here.
 *
 * THIS USED TO PREFIX `//` and every rule it built was silently inert. The `//` marker is what
 * code.claude.com/docs/en/permissions.md describes for a filesystem-absolute pathspec, and it is what
 * `claudeWorkerAdapter.ts#absoluteReadDenyRule` emits — but that helper's rules are documented there as
 * dormant deny-only future-proofing, so nothing ever load-bore them. Here they were load-bearing, and an
 * A/B against the installed CLI (2.1.220, identical target and prompt, only the prefix differing) proved
 * the form never matches on Windows: `Read(//C:/…/**)` DENIED, `Read(C:/…/**)` ALLOWED. The drive letter
 * already makes a Windows pathspec unambiguous, so the marker buys nothing and costs everything.
 *
 * A POSIX root (`/repo`) is emitted the same way, as the plain absolute path. If some host's CLI were to
 * resolve that single leading `/` relative to the settings source instead of the filesystem root, the
 * rule degrades to inert — the fail-CLOSED direction, and identical to today's behaviour on every
 * platform. It can never widen a grant. This daemon runs on Windows, which is the verified case.
 */
function absoluteRulePath(root: string, relative?: string): string {
  return absoluteDir(root, relative);
}

export interface RosterPermissionInput {
  /** Canonical checkout the repo-relative scope entries resolve against. */
  repoRoot: string;
  /** `<stateRoot>/control/roster/<runRef>/<agentId>` — this agent's own binding + work-order channel. */
  agentDir: string;
  /** Exact server-owned completion status files this agent may write. */
  statusPaths?: readonly string[];
  /** Repo-relative read scope, unioned across the stages this agent owns. */
  read: readonly string[];
  /** Repo-relative write scope, unioned across the stages this agent owns. */
  write: readonly string[];
  /** The server-owned workflow tool cap this run executes under. Nothing outside it is ever granted. */
  tools: readonly string[];
  /** Project MCP servers disabled for this unattended roster session. */
  disabledMcpjsonServers?: readonly string[];
}

/**
 * THE RESTRICTION FLOOR: what an UNATTENDED terminal may never do, whatever else it was scoped to.
 *
 * WHY A DENY LIST IS THE RIGHT INSTRUMENT HERE. Roster terminals run under the auto `defaultMode`
 * (Daniel's 2026-07-30 ruling), so the `allow` rules below are declared intent rather than containment —
 * auto mode skips the ASK step. It does NOT skip the DENY step: `deny` / `ask` / `allow` evaluate in that
 * fixed order regardless of mode, so these entries are the one part of this file that still ENFORCES.
 * Verified live against the installed CLI (2.1.220), each case paired against an `allow` that would
 * otherwise let the action through, so a denial proves the rule matched and not the absence of a grant:
 *  - `Bash(git config *)` in `deny` → the Bash call is refused ("Permission to use Bash with command
 *    git config --get user.name has been denied"); the same run without it executes and returns output.
 *  - `Read(<path>)` in `deny` → a BASH command that reads that path is refused too ("permission to use
 *    Bash with `cat marker.txt` was denied"). The CLI resolves the file a command touches and applies
 *    file-path denies to it, so these entries cover the shell as well as the built-in file tools.
 *
 * WHAT IS ON THE LIST, AND WHY EACH ONE IS "NEVER" RATHER THAN "NOT NOW":
 *  - Publication and identity. A roster stage PROPOSES work; the server-side integrator publishes it, on
 *    the coordination checkout, under its own branch guard. A terminal that can `git push` can bypass
 *    every gate in this file, and one that can `git config` can rewrite the identity the fleet's history
 *    is attributed to. Neither is ever part of a stage's job.
 *  - Secrets. `.env` at the repo root and at any depth, through the built-in file tools and (per the
 *    verified behaviour above) through the shell. Nothing in the video pipeline reads a `.env`.
 *  - Credential stores. The obvious ambient ones: ssh keys, cloud/CLI credential directories, the
 *    CLI's own stored credentials, npm/git credential files, and bare private-key material.
 *
 * KNOWN RESIDUAL — the honest boundary. These rules plus the repo's PreToolUse hooks cover Claude's TOOL
 * layer and the Bash commands the CLI can parse. A script the agent WRITES and then RUNS
 * (`python fetch.py`, where `fetch.py` opens `.env` itself) is opaque to command parsing: nothing here
 * sees that read, and stopping it is OS-level sandboxing, not a permission rule. That gap is pre-existing
 * — it is the same under the interactive default mode — and is NOT introduced by the auto `defaultMode`.
 * It is named here so no one mistakes this floor for containment of arbitrary code execution.
 */
const RESTRICTION_FLOOR: readonly string[] = [
  // Publication and identity.
  'Bash(git push *)',
  'Bash(git config *)',
  // `.env`, through the file tools and (verified) through any shell command that opens it.
  'Read(.env)',
  'Read(**/.env)',
  'Read(**/.env.*)',
  'Edit(.env)',
  'Edit(**/.env)',
  'Edit(**/.env.*)',
  // Shell shapes that move a `.env` wholesale rather than reading it in place.
  'Bash(cp .env*)',
  'Bash(mv .env*)',
  // Credential stores.
  'Read(**/.ssh/**)',
  'Edit(**/.ssh/**)',
  'Read(**/.aws/**)',
  'Edit(**/.aws/**)',
  'Read(**/.config/gh/**)',
  'Read(**/.claude/.credentials.json)',
  'Read(**/.git-credentials)',
  'Read(**/.npmrc)',
  'Read(**/credentials.json)',
  'Read(**/token.json)',
  'Read(**/*.pem)',
];

export interface RosterPermissionSettings {
  allow: string[];
  /**
   * The restriction floor actually emitted — {@link RESTRICTION_FLOOR}. Exposed so the ENFORCING half of
   * this settings file is assertable, not only the declared-intent half.
   */
  deny: string[];
  additionalDirectories: string[];
  /** The exact bytes written to the per-run settings file and handed to `claude --settings`. */
  json: string;
}

/**
 * Build ONE roster session's permission settings.
 *
 * WHY THIS EXISTS. A spawned roster terminal's FIRST act is to read its own `binding.md`, and that read
 * parked on Claude Code's interactive "Do you want to proceed?" tool-permission menu — a per-session,
 * modal decision that folder trust (`hasTrustDialogAccepted`) does not answer and that no remembered
 * `allowedTools` list covers. The run then went nowhere. The fix is a per-run settings file passed with
 * `--settings <path>` (the CLI accepts a file path or an inline JSON string; `claude --help`:
 * "Path to a settings JSON file or a JSON string to load additional settings from").
 *
 * AUTONOMOUS BUT GOVERNED — `permissions.defaultMode: "auto"`. A roster terminal must proceed without a
 * human at the keyboard, but it must NOT be ungoverned. `auto` is the mode that gives both: it interposes
 * a background safety CLASSIFIER that clears routine tool use without a prompt while still blocking
 * escalation / unrecognised-infra / hostile-content-driven actions — and, crucially, the `permissions.deny`
 * floor, `ask` rules, and PreToolUse hooks are all evaluated BEFORE that classifier, so they still ENFORCE
 * exactly as under the interactive default mode. This is strictly MORE governed than `bypassPermissions`,
 * which skips the ask step for everything and (almost) ignores deny — and, unlike bypass, `auto` shows NO
 * first-launch acceptance modal, so an unattended pty boots straight to the live REPL instead of stalling
 * on a "WARNING: … Bypass Permissions mode … Yes, I accept" dialog it can never answer. Confirmed live
 * against the installed CLI (claude.exe 2.1.220): an interactive launch with `defaultMode: "auto"` in
 * `--settings` came up with NO modal and the `⏵⏵ auto mode on (shift+tab to cycle)` REPL footer, and a
 * headless `-p` run under the same settings had its `git config` Bash call DENIED by the floor.
 *
 * MODEL REQUIREMENT — `auto` is model-gated. The CLI enables it only on an auto-capable model (verified
 * live: the daemon's default Fable 5 kept `auto mode on`; `claude-sonnet-4-5` reported `auto mode
 * unavailable for this model` and fell back to manual mode). No extra CLI flag, `--permission-mode`
 * argument, or environment variable is added — see `defaultLaunchLine` below, unchanged — so the launched
 * model (`assignment.model`) must be auto-capable, or the terminal degrades to prompting (the delivery
 * gate then parks on the tool-permission modal via {@link detectReplReadiness} rather than hanging).
 *
 * WHAT IT ALSO WRITES, NOW AS DECLARED INTENT RATHER THAN CONTAINMENT (the classifier, not this allow
 * list, is what clears routine tool use under `auto` — kept for legibility of what each agent was scoped to do):
 *  - `permissions.allow` rules for the scoped file tools, over the stage's ALREADY-DECLARED
 *    `scope.read ∪ scope.write` (reads) and `scope.write` (writes), each rule anchored at the canonical
 *    repo root in the pathspec grammar the installed CLI actually matches (see
 *    {@link absoluteRulePath} — the `//`-prefixed form these rules used to carry matched NOTHING on
 *    Windows). A tool the server-owned workflow profile does not grant produces no rule.
 *  - `Read` over this agent's own roster directory — the control plane's order channel (`binding.md`
 *    plus `orders/*.md`) — and `Edit` over each exact server-designated completion status file. These are
 *    the only grants that are not repo scope: one agent, one run, deleted when the roster retires.
 *  - `permissions.additionalDirectories` for exactly those same directories, because a scope root or the
 *    roster directory can sit outside the session cwd, and an allow rule alone does not extend the
 *    working set.
 *
 *  - `permissions.deny`: {@link RESTRICTION_FLOOR}, the one part of this file that still ENFORCES under
 *    the auto `defaultMode` (deny/ask/allow evaluate in that fixed order, mode-independent — auto mode
 *    skips only the ASK step). It is a constant: nothing in the proposal, the scope or the tool cap can
 *    widen it or shrink it, so every roster terminal on every run carries the same floor.
 *
 * There is no wildcard and no path that is not either a declared scope entry or this agent's own order
 * channel. An entry that is not a safe repo-relative path is dropped rather than interpolated. No allow
 * rule can override the floor — a deny always wins, whatever the allow list or the mode says.
 */
export function buildRosterPermissionSettings(input: RosterPermissionInput): RosterPermissionSettings {
  const allow: string[] = [];
  const additionalDirectories: string[] = [];
  const addAllow = (rule: string): void => { if (!allow.includes(rule)) allow.push(rule); };
  const addDir = (dir: string): void => { if (!additionalDirectories.includes(dir)) additionalDirectories.push(dir); };

  // The order channel first: without it the session cannot read the binding context it is booted on.
  addAllow(`Read(${absoluteRulePath(input.agentDir)}/**)`);
  addDir(absoluteDir(input.agentDir));
  for (const statusPath of input.statusPaths ?? []) {
    const normalized = absoluteDir(statusPath);
    const statusRoot = `${absoluteDir(input.agentDir)}/status/`;
    const fileName = normalized.startsWith(statusRoot) ? normalized.slice(statusRoot.length) : '';
    const stageId = fileName.endsWith('.json') ? fileName.slice(0, -'.json'.length) : '';
    if (SAFE_PATH_SEGMENT.test(stageId)) {
      addAllow(`Edit(${absoluteRulePath(normalized)})`);
    }
  }

  const granted = new Set(input.tools);
  const safe = (paths: readonly string[]): string[] => paths.filter((path) => isSafeRepoRelativePath(path));
  const readPaths = [...new Set([...safe(input.read), ...safe(input.write)])];
  const writePaths = [...new Set(safe(input.write))];

  for (const tool of SCOPED_READ_TOOLS) {
    if (!granted.has(tool)) continue;
    for (const path of readPaths) addAllow(`${tool}(${absoluteRulePath(input.repoRoot, path)}/**)`);
  }
  for (const tool of SCOPED_WRITE_TOOLS) {
    if (!granted.has(tool)) continue;
    for (const path of writePaths) addAllow(`${tool}(${absoluteRulePath(input.repoRoot, path)}/**)`);
  }
  for (const path of readPaths) addDir(absoluteDir(input.repoRoot, path));

  // `deny` first, in the file as in the evaluation order: it is the half that still ENFORCES under the
  // auto `defaultMode`, and it is not derived from the proposal — no scope, no stage and no tool cap can
  // add to it or take from it. See {@link RESTRICTION_FLOOR}, including its named residual.
  const deny = [...RESTRICTION_FLOOR];
  const disabledMcpjsonServers = [...new Set(input.disabledMcpjsonServers ?? [])];
  const permissions = {
    defaultMode: 'auto',
    deny,
    allow,
    additionalDirectories,
  };
  return {
    allow,
    deny,
    additionalDirectories,
    json: `${JSON.stringify({
      ...(disabledMcpjsonServers.length > 0 ? { disabledMcpjsonServers } : {}),
      permissions,
    }, null, 2)}\n`,
  };
}

/**
 * Project MCP servers are disabled rather than approved: roster stages must not silently gain MCP
 * execution, and disabling every declared server prevents Claude Code's first-seen project trust dialog.
 */
function disabledProjectMcpjsonServers(fs: RosterFileSystem, repoRoot: string): string[] {
  const raw = fs.readFile(join(repoRoot, '.mcp.json'));
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
    const servers = (parsed as Record<string, unknown>).mcpServers;
    if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return [];
    return Object.keys(servers);
  } catch {
    return [];
  }
}

/**
 * The declared scope ONE roster agent works under: the union over every stage that agent owns, plus the
 * proposal-level scope when it is also the manager. An agent that owns several stages gets the union of
 * exactly those stages' scopes and nothing else — a stage's grant is never widened by a stage some other
 * agent owns.
 */
export function rosterAgentScope(proposal: PlanProposal, agentId: string): ProposalScope {
  const read: string[] = [];
  const write: string[] = [];
  const merge = (scope: ProposalScope | undefined): void => {
    for (const path of scope?.read ?? []) if (!read.includes(path)) read.push(path);
    for (const path of scope?.write ?? []) if (!write.includes(path)) write.push(path);
  };
  if (proposal.manager.assignment?.agentId === agentId) merge(proposal.scope);
  for (const stage of proposal.stages) if (stage.assignment?.agentId === agentId) merge(stage.scope);
  return { read, write };
}

interface CompletionStatus {
  verdict: 'DONE' | 'BLOCKED' | 'FAILED';
  token: string;
  summary: string;
}

/** Parse one server-owned status file for this delivery. Invalid, partial, and replayed files are ignored. */
function parseCompletionStatus(raw: string | null, token: string): CompletionStatus | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const status = parsed as Record<string, unknown>;
    if (status.token !== token) return null;
    if (status.verdict !== 'DONE' && status.verdict !== 'BLOCKED' && status.verdict !== 'FAILED') return null;
    return {
      token,
      verdict: status.verdict,
      summary: typeof status.summary === 'string' ? status.summary : '',
    };
  } catch {
    return null;
  }
}

/** Bound and flatten an agent-reported summary before it becomes canonical result content. */
function safeSummary(raw: string, fallback: string): string {
  const flattened = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS);
  return flattened === '' ? fallback : flattened;
}

/**
 * The server-owned tool cap ONE roster agent runs under: the INTERSECTION of the caps of every stage it
 * owns (a stage may name its own `workflowProfile`; otherwise the run's). Intersection, not union, is the
 * fail-closed direction — an agent that owns both a `producer` stage and a `checker-readonly` stage is
 * capped at what BOTH allow, so no stage's session is ever handed a capability another stage's profile
 * withheld. An agent with no resolvable cap gets none, which simply means no permission rules are
 * emitted and its tool uses fall back to the interactive prompt (today's behaviour).
 */
export function rosterAgentTools(
  proposal: PlanProposal,
  agentId: string,
  resolveTools: (workflowProfileId: string | null) => readonly string[],
): string[] {
  const caps: string[][] = [];
  if (proposal.manager.assignment?.agentId === agentId) caps.push([...resolveTools(proposal.profile ?? null)]);
  for (const stage of proposal.stages) {
    if (stage.assignment?.agentId !== agentId) continue;
    caps.push([...resolveTools(stage.workflowProfile ?? proposal.profile ?? null)]);
  }
  if (caps.length === 0) return [];
  return caps.reduce((left, right) => left.filter((tool) => right.includes(tool)));
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
 * The directory a run's agents work in: PINNED to the project root the work orders are written against.
 *
 * WHY IT IS PINNED AND NOT DISCOVERED. This used to return the DEEPEST EXISTING candidate — video dir,
 * else channel dir, else project root — which broke the work orders in two ways:
 *
 *  1. It disagreed with the orders. Every work order in `video-run.md` states ORG-RELATIVE paths like
 *     `channels/<channel>/videos/<slug>/brief.md`. On a fresh slug the video dir does not exist but the
 *     channel dir does, so the workDir became the CHANNEL dir and that same relative path resolved to
 *     `channels/<c>/channels/<c>/videos/<slug>/brief.md`. Declared artifacts are repo-relative and
 *     correct, so the server looked in the right place, found nothing, and the stage parked.
 *  2. It MOVED. `workDir` is recomputed whenever the in-memory run entry is absent — i.e. after every
 *     daemon restart — so once `idea` created the video dir, a restart silently re-rooted every
 *     subsequent agent one level deeper than the run had been using.
 *
 * `orgs/<project>` is the root those org-relative order paths are written against, it exists for any
 * project that can compile at all (policy requires `orgs/<project>/contract.md` to be readable), and it
 * is the same value before and after any restart. The only fallback is the traversal guard: a project
 * that is not a single safe path segment is never interpolated into a path.
 */
export function resolveRosterWorkDir(repoRoot: string, project: string): string {
  if (!SAFE_PATH_SEGMENT.test(project)) return repoRoot;
  return join(repoRoot, 'orgs', project);
}

function defaultLaunchLine(input: {
  model: string;
  bindingPath: string;
  settingsPath: string;
  mcpConfigPath: string;
  runRef: string;
  agentId: string;
}): string {
  // `--settings` takes a file path (or inline JSON). The path is quoted because the dashboard state root
  // is an absolute OS path that may contain spaces.
  return `claude --model ${input.model} --settings "${input.settingsPath}" `
    + `--strict-mcp-config --mcp-config "${input.mcpConfigPath}" `
    + `"Read ${input.bindingPath} now. It is your binding context for run `
    + `${input.runRef} as ${input.agentId}: follow it exactly, then wait — work orders arrive in this terminal `
    + `as file paths, one at a time."`;
}

function defaultDeliveryLine(input: { orderPath: string; stageId: string }): string {
  return `Work order for stage ${input.stageId}: read ${input.orderPath} and execute it now, then write the `
    + `completion status exactly as that file specifies.`;
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

/**
 * Production tool-cap resolution. Fail-closed by SHAPE: `createWorkflowToolPolicyResolver` throws for an
 * absent, unknown, empty, malformed or forbidden-tool-bearing profile, and the catch turns every one of
 * those into an EMPTY cap — no permission rules, so the session behaves exactly as it does today. A
 * refusal here must never widen a grant, and it must never take down a spawn either: the tool cap that
 * actually GOVERNS a headless attempt is still resolved (and still throws) in `claudeWorkerAdapter.ts`.
 */
const defaultWorkflowTools = (workflowProfileId: string | null): readonly string[] => {
  try {
    return createWorkflowToolPolicyResolver()(workflowProfileId).allowedTools;
  } catch {
    return [];
  }
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  // A readiness backoff must never be the reason a daemon cannot exit.
  if (typeof timer.unref === 'function') timer.unref();
});

/** Create the run-roster session manager. Nothing spawns until `ensureRoster` is called. */
export function createRosterSessionManager(options: RosterSessionsOptions): RosterSessionManager {
  const fs = options.fs ?? defaultFileSystem;
  const now = options.now ?? Date.now;
  const mintToken = options.mintToken ?? (() => randomBytes(16).toString('hex'));
  const cols = options.cols ?? DEFAULT_COLS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const launchLine = options.launchLine ?? defaultLaunchLine;
  const deliveryLine = options.deliveryLine ?? defaultDeliveryLine;
  const resolveWorkflowTools = options.resolveWorkflowTools ?? defaultWorkflowTools;
  const sleep = options.sleep ?? defaultSleep;
  const runs = new Map<string, RosterRunEntry>();
  /**
   * Activity lines recovered from the durable event mirror, plus the event cursor they were read up to.
   * `state` is polled by the canvas, so it reads only what is NEW each time: the previous code asked for
   * the FIRST 400 events on every poll, which re-read the same page forever and went permanently stale
   * once a run passed 400 events — which every real multi-day run does.
   */
  const recoveredActivity = new Map<string, { cursor: number; lines: Map<string, string> }>();

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
      'Each order file names the exact server-owned status path to write when the stage is genuinely',
      'finished, including a token that only that file carries. Do not signal completion in terminal text.',
      '',
      'The human may talk to you in this terminal at any time. Answer, iterate, and keep waiting.',
    ].join('\n');
  };

  const orderMarkdown = (input: {
    runRef: string;
    stageId: string;
    attemptRef: string;
    token: string;
    statusPath: string;
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
      // The attempt this order belongs to. An order file is overwritten per attempt, so without it a
      // re-delivery after a repair is indistinguishable from the original in the file itself.
      `- attempt: ${input.attemptRef}`,
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
      `- completion status path: ${input.statusPath}`,
      `- when the stage is finished, write EXACTLY this JSON (and nothing else) to ${input.statusPath}:`,
      `  {"token":"${input.token}","verdict":"DONE|BLOCKED|FAILED","summary":"<one line>"}`,
      '- replace DONE|BLOCKED|FAILED with exactly one verdict: DONE (finished), BLOCKED (needs a human),',
      '  or FAILED (cannot finish). Write it only after the work is really on disk.',
      '- Do NOT print any completion marker to the terminal; the control plane reads that file, not your terminal.',
    ].join('\n');
  };

  /**
   * The ONE settle path. Every outcome (status, missed-status timeout, session exit, retire) goes
   * through here so the pending slot and its deadline timer are always released together — a delivery
   * that settled twice would resolve the engine's promise once and leak a timer that later fired
   * against a slot a NEW delivery owns.
   */
  const resolvePending = (entry: RosterSessionEntry, result: WorkerExecutionResult): void => {
    const pending = entry.pending;
    if (!pending) return;
    entry.pending = null;
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.pollTimer) clearTimeout(pending.pollTimer);
    pending.settle(result);
  };

  /** Read one delivery's server-owned status path until it contains a valid token-bound verdict. */
  const pollCompletionStatus = (
    entry: RosterSessionEntry,
    pending: PendingDelivery,
    statusPath: string,
  ): void => {
    const poll = (): void => {
      if (entry.pending !== pending) return;
      const status = parseCompletionStatus(fs.readFile(statusPath), pending.token);
      if (status) {
        const summary = safeSummary(
          status.summary,
          `stage ${pending.stageId} reported ${status.verdict.toLowerCase()}`,
        );
        const state = status.verdict === 'DONE'
          ? 'succeeded'
          : status.verdict === 'BLOCKED'
            ? 'waiting-human'
            : 'failed';
        resolvePending(entry, { state, summary, usage: zeroUsage(), artifacts: [], checkpoints: [] });
        return;
      }
      const timer = setTimeout(poll, COMPLETION_STATUS_POLL_MS);
      if (typeof timer.unref === 'function') timer.unref();
      pending.pollTimer = timer;
    };
    poll();
  };

  /**
   * Baseline every declared artifact BEFORE the order file is authored — i.e. before the agent can have
   * touched anything — so the completion is judged against what the stage INHERITED, not against mere
   * existence. A 0-byte file or a directory standing where the artifact belongs is treated as no baseline
   * at all: whatever real file the stage writes over it is new work.
   */
  const snapshotDeclaredArtifacts = (proposalStage: ProposalStage): ArtifactSnapshot[] =>
    proposalStage.artifacts.map((artifact) => {
      if (!isSafeRepoRelativePath(artifact.path)) {
        return { path: artifact.path, absolute: '', unsafe: true, before: null };
      }
      const absolute = join(options.repoRoot, artifact.path);
      const stat = fs.stat(absolute);
      const usable = stat !== null && stat.regularFile && stat.size > 0;
      return {
        path: artifact.path,
        absolute,
        unsafe: false,
        before: usable ? { size: stat.size, hash: fs.hashFile(absolute) } : null,
      };
    });

  /**
   * Why each declared artifact still fails its promise, or an empty list when every one of them is a
   * regular, non-empty file that DIFFERS from what was there at delivery time.
   *
   * The old check was `existsSync` alone, with nothing compared against the pre-delivery state, so a
   * stage was marked `succeeded` on the PREVIOUS attempt's files on any retry — and on any run against a
   * slug that already carries root plan files, which every video under `channels/<c>/videos/` does. The
   * engine's own digest cross-check (`execution.ts#resultIsSafe`) cannot cover this: the roster adapter
   * reports `artifacts: []` (see the completion-receipt note in the module header), so that check
   * iterates nothing. This IS the roster path's substitute for it.
   *
   * BYTE-IDENTICAL OUTPUT PARKS, IT DOES NOT PASS. A stage whose artifact is bit-for-bit what was
   * already there is indistinguishable, at the artifact layer, from a stage that did nothing at all —
   * which is the exact hollow completion this check exists to catch. The gate downstream of `shots-merge`
   * promises an operator that the merge really ran before authorizing $17-27 of image generation, so the
   * tie breaks fail-closed. Parking is cheap and recoverable: it is a `waiting-human`, not a failure, and
   * the summary names the artifact and the reason, so an operator looking at a genuinely idempotent
   * re-run can read what happened and release it. A false PASS here spends real money on an unverified
   * promise; a false PARK costs one human glance.
   */
  const unsatisfiedArtifacts = (snapshots: readonly ArtifactSnapshot[]): string[] => {
    const problems: string[] = [];
    for (const snapshot of snapshots) {
      if (snapshot.unsafe) {
        problems.push(`${snapshot.path} (not a safe repo-relative path)`);
        continue;
      }
      const after = fs.stat(snapshot.absolute);
      if (after === null) {
        problems.push(`${snapshot.path} (missing)`);
        continue;
      }
      // Both of these satisfied the old `existsSync`: a directory wearing the artifact's name, and a
      // 0-byte file.
      if (!after.regularFile) {
        problems.push(`${snapshot.path} (not a regular file)`);
        continue;
      }
      if (after.size === 0) {
        problems.push(`${snapshot.path} (empty)`);
        continue;
      }
      if (snapshot.before === null) continue; // nothing usable was inherited: this file is new work
      // Size is the cheap discriminator, so the big artifacts (`final.mp4`) are hashed on the
      // verification side ONLY when their size did not move and the bytes must actually be compared.
      if (after.size !== snapshot.before.size) continue;
      if (fs.hashFile(snapshot.absolute) !== snapshot.before.hash) continue;
      problems.push(`${snapshot.path} (byte-identical to the file already there when the order was delivered)`);
    }
    return problems;
  };

  const resolveDeliveryTimeout = (input: { runRef: string; stageId: string; agentId: string; timeoutMs?: number }): number => {
    const configured = typeof options.deliveryTimeoutMs === 'function'
      ? options.deliveryTimeoutMs({ runRef: input.runRef, stageId: input.stageId, agentId: input.agentId })
      : options.deliveryTimeoutMs;
    const candidate = input.timeoutMs ?? configured ?? DEFAULT_DELIVERY_TIMEOUT_MS;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return DEFAULT_DELIVERY_TIMEOUT_MS;
    return Math.min(MAX_DELIVERY_TIMEOUT_MS, Math.max(MIN_DELIVERY_TIMEOUT_MS, Math.round(candidate)));
  };

  /**
   * Classify settled readiness from semantic terminal state. Settlement is how long the terminal has
   * continuously classified ready, not how long raw PTY bytes have been quiet; control-only repaints cannot
   * hold an otherwise idle session in `settling`.
   */
  const settledReadiness = (entry: RosterSessionEntry): ReplReadiness => {
    const observedAt = now();
    if (entry.controlSuffix !== '') {
      return { state: 'settling', marker: 'the terminal is in the middle of a control-sequence repaint' };
    }
    const readiness = detectReplReadinessFresh(entry.screen, observedAt - entry.lastSemanticAt);
    if (readiness.state !== 'ready') {
      entry.readySince = null;
      return readiness;
    }
    if (entry.readySince === null) entry.readySince = observedAt;
    return detectReplReadinessSettled(
      entry.screen,
      observedAt - entry.lastSemanticAt,
      observedAt - entry.readySince,
    );
  };

  /** Wait for a terminal to leave a modal menu / stop being mid-turn, with exponential backoff. */
  const waitForRepl = async (entry: RosterSessionEntry, budgetMs: number): Promise<ReplReadiness> => {
    const started = now();
    let delay = REPL_POLL_MIN_MS;
    let readiness = settledReadiness(entry);
    while (readiness.state !== 'ready') {
      if (now() - started >= budgetMs) return readiness;
      await sleep(Math.min(delay, Math.max(0, budgetMs - (now() - started))));
      delay = Math.min(REPL_POLL_MAX_MS, delay * 2);
      readiness = settledReadiness(entry);
    }
    return readiness;
  };

  const scan = (entry: RosterSessionEntry, chunk: string): void => {
    const decoded = splitTerminalControlSuffix(entry.controlSuffix + chunk);
    entry.controlSuffix = decoded.suffix;
    const screenStripped = stripForScreenWindow(decoded.complete);
    // The readiness window accumulates ALWAYS — idle output is exactly what the delivery gate reads.
    entry.screen = (entry.screen + screenStripped).slice(-SCREEN_WINDOW_CHARS);
    if (screenStripped.trim() !== '') {
      entry.lastSemanticAt = now();
      const readiness = detectReplReadinessFresh(entry.screen, 0);
      if (readiness.state === 'ready') {
        if (entry.readySince === null) entry.readySince = entry.lastSemanticAt;
      } else {
        entry.readySince = null;
      }
    }
    if (hasBusyTransition(screenStripped)) entry.busyObservationGeneration += 1;
  };

  const settlePending = (run: RosterRunEntry, runRef: string, entry: RosterSessionEntry, summary: string): void => {
    if (!entry.pending) return;
    record(run.subject, runRef, entry.agentId, summary, 'interrupted');
    resolvePending(entry, { state: 'waiting-human', summary, usage: zeroUsage(), artifacts: [], checkpoints: [] });
  };

  const spawnSession = (
    run: RosterRunEntry,
    runRef: string,
    agentId: string,
    verified: ResolvedAssignedAgent,
    proposal: PlanProposal,
  ): RosterSessionEntry => {
    const agentDir = join(runDir(runRef), agentId);
    fs.ensureDir(join(agentDir, 'orders'));
    fs.ensureDir(join(agentDir, 'status'));
    const bindingPath = join(agentDir, 'binding.md');
    fs.writeFile(bindingPath, bindingMarkdown({
      runRef, agentId, verified, project: run.project, parameters: run.parameters, workDir: run.workDir,
    }));
    // THE SCOPED PER-RUN PERMISSIONS. Written BEFORE the launch line is typed, from the compiled
    // proposal's own declared scope and the server-owned tool cap — never a blanket flag, never a
    // pre-trusted path, never anything outside `scope.read ∪ scope.write` plus this agent's own order/status
    // channels. It lives inside the roster run directory, so `retireRun`'s `removeDir` is already its
    // cleanup: the grant cannot outlive the run it was minted for.
    const scope = rosterAgentScope(proposal, agentId);
    const settingsPath = join(agentDir, 'settings.json');
    const statusPaths = proposal.stages
      .filter((stage) => stage.assignment?.agentId === agentId)
      .map((stage) => join(agentDir, 'status', `${stage.id}.json`));
    fs.writeFile(settingsPath, buildRosterPermissionSettings({
      repoRoot: options.repoRoot,
      agentDir,
      statusPaths,
      read: scope.read,
      write: scope.write,
      tools: rosterAgentTools(proposal, agentId, resolveWorkflowTools),
      disabledMcpjsonServers: disabledProjectMcpjsonServers(fs, options.repoRoot),
    }).json);
    const mcpConfigPath = join(agentDir, 'mcp.json');
    fs.writeFile(mcpConfigPath, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
    const created = options.registry.create(run.owner, options.host, {
      requestId: '', cwd: run.workDir, cols, rows,
    });
    const entry: RosterSessionEntry = {
      agentId,
      sessionId: created.sessionId,
      owner: run.owner,
      model: verified.assignment.model,
      bindingPath,
      settingsPath,
      screen: '',
      lastSemanticAt: now(),
      readySince: null,
      controlSuffix: '',
      busyObservationGeneration: 0,
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
      model: verified.assignment.model, bindingPath, settingsPath, mcpConfigPath, runRef, agentId,
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
    recoveredActivity.delete(runRef);
    // Order files and binding contexts carry this run's completion tokens in plaintext. A retired
    // roster's tokens are already dead (every pending delivery settled above, every session closed), so
    // keeping the directory is a needless durable copy of them. A resume re-authors both from the
    // immutable proposal, so nothing here is load-bearing state.
    //
    // TODO(roster-boot-sweep): this is the ONLY thing that deletes a roster directory, and it runs only
    // on a graceful path — `retireAll` from daemon shutdown (`http/surface.ts`) and from an operator
    // `lock()` (`activation.ts`). A SIGKILL or power loss therefore leaves `<stateRoot>/control/roster/
    // <runRef>/<agentId>/{settings.json,binding.md,orders/*.md}` on disk indefinitely, tokens included.
    // The close is a boot sweep of roster dirs with no live run, which needs three things this file does
    // not have yet: (1) a `listDirs(path): string[]` member on {@link RosterFileSystem} (real impl:
    // `readdirSync(path, { withFileTypes: true })`, absent dir → `[]`), so tests keep their disk-free
    // seam; (2) a call in `createRosterSessionManager` — NOT unconditional: `runs` is empty at
    // construction, so a naive sweep would delete a LIVE run's order channel if the manager is ever
    // reconstructed while another instance holds sessions (`activateExecution` is re-entrant across an
    // unlock). Gate it on the store: sweep a `<runRef>` only when `store.getRun` says the run is in a
    // terminal state or is unknown. (3) One test per branch. Deliberately NOT done in this pass: the
    // orphan itself is inert (a settings file is only read by a process launched with `--settings` at
    // that exact path, and `scan` matches only the LIVE `pending.token`), and getting (2) wrong loses a
    // running roster's orders — a strictly worse failure than the leak it closes.
    try { fs.removeDir?.(runDir(runRef)); } catch { /* a locked file must never block the reap */ }
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
          workDir: resolveRosterWorkDir(options.repoRoot, input.proposal.project),
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
        spawnSession(run, input.runRef, agentId, verified, input.proposal);
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

      const timeoutMs = resolveDeliveryTimeout({
        runRef: input.runRef, stageId: input.stageId, agentId,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      });

      // THE REPL-READINESS GATE. The delivery line used to be typed unconditionally, and that is how a
      // work order was lost: it interleaved character-by-character with an open tool-permission menu,
      // which consumed the keystrokes as menu input, and the stage then sat against the delivery deadline
      // with nothing delivered and nothing to report. A terminal is written into only when its own output
      // stream says it is at a plain REPL prompt — not in a modal menu and not mid-turn.
      //
      // The fast path costs nothing once an idle frame has been quiet for the settle threshold. A fresh
      // ready footer still polls: it may belong to the spin-up gap of the boot binding turn, and only a
      // settled pre-type screen makes submit verification's later fresh-busy signal attributable to OUR
      // order. Every wait remains bounded by this delivery's own completion deadline.
      const readinessBudget = Math.min(
        timeoutMs,
        Math.max(MIN_REPL_READY_TIMEOUT_MS, options.replReadyTimeoutMs ?? DEFAULT_REPL_READY_TIMEOUT_MS),
      );
      const withholdForReadiness = (readiness: Exclude<ReplReadiness, { state: 'ready' }>): WorkerExecutionResult => {
        const detail = readiness.state === 'modal'
          ? `an interactive prompt is open ("${readiness.marker}")`
          : readiness.state === 'settling'
            ? 'a REPL prompt is visible, but it never stayed continuously ready long enough to prove it was idle'
            : readiness.state === 'silent'
              ? readiness.marker === 'no output yet'
                ? 'it has produced no output at all — the REPL may never have come up'
                : 'no REPL input prompt is on screen — a first-run splash/onboarding screen may be open, '
                  + 'or the REPL has not finished starting'
              : `it is still mid-turn ("${readiness.marker}")`;
        const summary = `work order withheld: the ${agentId} terminal was not at a REPL prompt within `
          + `${Math.max(1, Math.round(readinessBudget / 60_000))} min — ${detail} (${DELIVERY_NOT_READY_REASON}); `
          + 'answer or clear it in that terminal, then re-run the stage';
        record(run.subject, input.runRef, agentId, summary, 'waiting', input.stageRef);
        return {
          state: 'waiting-human',
          summary: summary.slice(0, MAX_SUMMARY_CHARS),
          usage: zeroUsage(),
          artifacts: [],
          checkpoints: [],
        };
      };
      let readiness = settledReadiness(entry);
      if (readiness.state !== 'ready') readiness = await waitForRepl(entry, readinessBudget);
      if (readiness.state !== 'ready') {
        // NOTHING was authored and NOTHING was typed: no order file, no token, no bytes into the pty.
        // This settles as a named human wait, never as a hang and never as a silent success.
        return withholdForReadiness(readiness);
      }

      // THE PRE-DELIVERY BASELINE. Taken before the order file exists, so the agent cannot have acted
      // yet: this is what "the stage changed its declared artifacts" is measured against on completion.
      const snapshots = snapshotDeclaredArtifacts(input.proposalStage);
      const token = mintToken();
      if (!/^[a-f0-9]{32}$/.test(token)) throw new RosterSessionError('roster completion token is malformed');
      const orderPath = join(runDir(input.runRef), agentId, 'orders', `${input.stageId}.md`);
      const statusPath = join(runDir(input.runRef), agentId, 'status', `${input.stageId}.json`);
      const pending: PendingDelivery = {
        stageId: input.stageId,
        token,
        settle: () => {},
        timer: null,
        pollTimer: null,
      };
      const settled = new Promise<WorkerExecutionResult>((resolve) => { pending.settle = resolve; });
      // Reserve the one-order slot before yielding the event loop. A concurrent delivery, session exit, or
      // roster retire during the post-snapshot drain must observe and settle this exact delivery.
      entry.pending = pending;
      // Hashing a large inherited artifact is synchronous. Drain once so PTY output queued during that
      // snapshot can update the screen, then re-check immediately before the first delivery write.
      await sleep(0);
      if (entry.pending !== pending) return settled;
      readiness = settledReadiness(entry);
      if (readiness.state !== 'ready') {
        resolvePending(entry, withholdForReadiness(readiness));
        return settled;
      }

      try {
        fs.ensureDir(join(runDir(input.runRef), agentId, 'orders'));
        fs.ensureDir(join(runDir(input.runRef), agentId, 'status'));
        // Snapshot-and-clear: a prior attempt's status can never satisfy this delivery.
        fs.removeFile(statusPath);
        fs.writeFile(orderPath, orderMarkdown({
          runRef: input.runRef, stageId: input.stageId, attemptRef: input.attemptRef, token,
          statusPath, proposalStage: input.proposalStage, parameters: run.parameters, workDir: run.workDir,
        }));
      } catch (error) {
        if (entry.pending === pending) entry.pending = null;
        throw error;
      }
      // THE DELIVERY DEADLINE. `settled` is otherwise reachable only from a valid status, a session exit,
      // or a retire, so one missed status held the engine's single worker slot until an operator ran
      // `stop`. Armed against THIS delivery only: a slot that a later delivery owns is left alone.
      const timer = setTimeout(() => {
        if (entry.pending !== pending) return;
        const summary = `delivery abandoned: stage ${input.stageId} wrote no completion status within `
          + `${Math.round(timeoutMs / 60_000)} min (${DELIVERY_TIMEOUT_REASON}) — open the ${agentId} `
          + 'terminal to see what it is doing, then re-run the stage';
        record(run.subject, input.runRef, agentId, summary, 'waiting', input.stageRef);
        resolvePending(entry, {
          state: 'waiting-human', summary: summary.slice(0, MAX_SUMMARY_CHARS), usage: zeroUsage(), artifacts: [], checkpoints: [],
        });
      }, timeoutMs);
      // The deadline must never be the reason a daemon cannot exit.
      if (typeof timer.unref === 'function') timer.unref();
      pending.timer = timer;
      // TWO SEPARATE WRITES, not `line + '\r'` in one. The REPL folds a same-write trailing CR into the
      // paste instead of submitting it (see {@link SUBMIT_ENTER_DELAY_MS}), so the order text goes first,
      // the paste window is allowed to close, then Enter is sent as its own read to actually fire the turn.
      const typed = options.registry.write(entry.owner, entry.sessionId, deliveryLine({ orderPath, stageId: input.stageId }));
      if (typed) await sleep(SUBMIT_ENTER_DELAY_MS);
      // Submit the Enter and treat a write failure ONLY while this delivery is still ours. The session can
      // be retired or its shell can die DURING the submit gap — either of which
      // resolves `settled` and clears `entry.pending`. In that case skip the Enter (the outcome is already
      // decided) and fall through to `await settled` below, so the retire/exit reason is what returns —
      // never a spurious Enter-write failure.
      if (entry.pending === pending) {
        const generationAtEnter = entry.busyObservationGeneration;
        const wrote = typed && options.registry.write(entry.owner, entry.sessionId, '\r');
        if (!wrote) {
          // `settled` is discarded with this early return, so releasing the slot and the deadline together
          // is the whole cleanup.
          clearTimeout(timer);
          entry.pending = null;
          const summary = `work order could not be written into session ${entry.sessionId}`;
          record(run.subject, input.runRef, agentId, summary, 'interrupted', input.stageRef);
          return { state: 'waiting-human', summary, usage: zeroUsage(), artifacts: [], checkpoints: [] };
        }
        // OUTCOME-VERIFY THE SUBMISSION. Bytes written is not a turn started — see {@link
        // SUBMIT_VERIFY_RETRIES}. Poll for positive evidence the turn engaged (a busy transition decoded
        // after this delivery's Enter), re-submitting up to SUBMIT_VERIFY_RETRIES —
        // re-typing the line only when it has left the composer, otherwise just re-sending Enter. If no turn
        // ever engages, PARK LOUDLY as a named human wait; NEVER record a "working" that reads as running
        // while nothing was delivered and then dies at the delivery deadline.
        let engaged = false;
        for (let attempt = 0; attempt <= SUBMIT_VERIFY_RETRIES; attempt += 1) {
          const windowEnd = now() + SUBMIT_VERIFY_WINDOW_MS;
          for (;;) {
            if (entry.pending !== pending) { engaged = true; break; } // an exit/retire already settled us.
            if (detectTurnEngaged(entry.busyObservationGeneration, generationAtEnter)) {
              engaged = true;
              break;
            }
            if (now() >= windowEnd) break;
            await sleep(Math.min(SUBMIT_VERIFY_POLL_MS, Math.max(0, windowEnd - now())));
          }
          if (engaged || entry.pending !== pending) break;
          if (attempt === SUBMIT_VERIFY_RETRIES) break;
          // Re-submit. A missing line means the prior Enter cleared it WITHOUT starting a turn (submitted-
          // then-errored, or typed into a transient state) — re-type before Enter; a present line is still
          // sitting unsubmitted (a folded CR, or a block that has since cleared), so just re-send Enter.
          if (!frameHasDeliveryLine(entry.screen, input.stageId)) {
            if (!options.registry.write(entry.owner, entry.sessionId, deliveryLine({ orderPath, stageId: input.stageId }))) break;
            await sleep(SUBMIT_ENTER_DELAY_MS);
            if (entry.pending !== pending) { engaged = true; break; }
          }
          if (!options.registry.write(entry.owner, entry.sessionId, '\r')) break;
        }
        if (!engaged && entry.pending === pending) {
          clearTimeout(timer);
          entry.pending = null;
          const summary = `work order was written into session ${entry.sessionId} but no turn engaged after `
            + `${SUBMIT_VERIFY_RETRIES} submit retries (${DELIVERY_NOT_ENGAGED_REASON}) — open the ${agentId} `
            + 'terminal to see whether it is blocked (an open prompt, a usage limit), clear it, then re-run the stage';
          record(run.subject, input.runRef, agentId, summary, 'waiting', input.stageRef);
          return { state: 'waiting-human', summary: summary.slice(0, MAX_SUMMARY_CHARS), usage: zeroUsage(), artifacts: [], checkpoints: [] };
        }
        if (entry.pending === pending) {
          record(run.subject, input.runRef, agentId, `working stage ${input.stageId}`, 'pending', input.stageRef);
          pollCompletionStatus(entry, pending, statusPath);
        }
      }
      const result = await settled;
      if (result.state === 'succeeded') {
        // Declared artifacts are verified SERVER-SIDE before the completion is accepted; a status alone
        // never satisfies a stage that promised files, and neither does a file the stage did not write.
        const problems = unsatisfiedArtifacts(snapshots);
        if (problems.length > 0) {
          const summary = `stage ${input.stageId} reported done but its declared artifacts are not satisfied: ${problems.join(', ')}`;
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
      const recovered = recoveredActivity.get(runRef) ?? { cursor: 0, lines: new Map<string, string>() };
      recoveredActivity.set(runRef, recovered);
      const events = options.store.listEvents(subject, runRef, recovered.cursor, EVENT_PAGE);
      if (events.ok) {
        for (const event of events.value) {
          if (event.cursor > recovered.cursor) recovered.cursor = event.cursor;
          const match = ROSTER_ACTIVITY.exec(event.summary ?? '');
          if (match) recovered.lines.set(match[1], match[2]);
        }
      }
      return projectRosterState(detail.value, {
        sessions: run ? new Map([...run.sessions].map(([agentId, entry]) => [agentId, entry.sessionId])) : new Map(),
        working: run ? new Set([...run.sessions.values()].filter((entry) => entry.pending !== null).map((entry) => entry.agentId)) : new Set(),
        activity: run?.activity ?? new Map(),
        durableActivity: recovered.lines,
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
  /**
   * agentId → the last activity line recovered from the durable event mirror, used after a restart.
   * The CALLER accumulates this across incremental event reads (see `state`), because a projection that
   * re-derived it from one fixed page of events went stale on any run long enough to matter.
   */
  durableActivity: ReadonlyMap<string, string>;
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
      ?? input.durableActivity.get(agentId)
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
   * The proven headless adapter, used for every stage that declares NO agent assignment (Wave-A kb-ops
   * workflows). This is a routing seam, not a second implementation of delivery: exactly one of the two
   * adapters handles a given stage, decided by whether that stage is a roster stage at all.
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
      // ROUTING IS BY STAGE DECLARATION, NOT BY LIVE STATE. `hasRoster` reads an in-memory map that
      // `retireAll` clears, and `retireAll` is exactly what an operator `lock()` calls: routing on it
      // meant a locked daemon's in-flight run kept iterating, saw `hasRoster === false`, and fell
      // through to the headless adapter — spawning a `claude` subprocess AFTER the lock, which is the
      // one thing the INERT invariant exists to prevent. A stage that DECLARES a roster assignment is a
      // roster stage forever; if its roster is gone, the only correct answer is to refuse.
      const declaresRoster = Boolean(input.proposalStage?.assignment ?? input.assignment);
      if (!options.sessions.hasRoster(input.runRef)) {
        if (declaresRoster) {
          throw new RosterSessionError(
            `stage '${input.proposalStage?.id ?? input.stageRef}' declares a roster agent but run `
            + `'${input.runRef}' has no live roster (retired, locked, or drained): refusing to run it headless`,
          );
        }
        return options.fallback.execute(input);
      }
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
