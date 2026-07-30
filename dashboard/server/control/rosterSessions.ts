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
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
/** Rolling scan window for completion markers (marker lines are short; this covers wrapped output). */
const SCAN_WINDOW_CHARS = 16_000;
/** Bound on the agent-reported completion summary carried into the canonical result. */
const MAX_SUMMARY_CHARS = 400;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** One path segment, no separators and no `..` — the traversal guard on any interpolated path fragment. */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/**
 * Marker verdict + stage + per-delivery token, anchored at a line start after ANSI stripping.
 *
 * LEADING DECORATION IS PART OF THE FORMAT. The substrate is an INTERACTIVE `claude` REPL, and a REPL
 * frames what it prints: a gutter glyph (`⏺` U+23FA), a box-drawing rail (`│` U+2502), a list bullet
 * (`- `), a quote marker (`> `), plus whatever indentation the renderer chose. `stripTerminalControl`
 * removes ANSI/OSC/C0 but not printable glyphs, so an anchor of `^FYT-STAGE-` matched a bare line and
 * essentially nothing the real REPL emits — the completion would never arrive.
 *
 * WHY THE PREFIX IS AN ALLOWLIST, NOT "ANY NON-ALPHANUMERIC RUN". The previous prefix was
 * `[^A-Za-z0-9]{0,32}`, which is decoration-tolerant but also QUOTING-tolerant, and an agent restating
 * the line it is ABOUT to print is completely normal behaviour. All of these matched and must not:
 *
 *     `FYT-STAGE-DONE images <tok> ok`        an inline code span
 *     - `FYT-STAGE-DONE images <tok> ok`      a bullet plus backticks
 *     # FYT-STAGE-DONE images <tok> ok        a comment / markdown heading
 *     ```FYT-STAGE-DONE images <tok> ok       a fence that ran on into the line
 *     {"": "FYT-STAGE-DONE images <tok> ok"   JSON with an empty key
 *
 * Each is a stage completing itself by TALKING about completing. So the prefix now admits only
 * characters a terminal uses to FRAME a line — space/tab, `-`, `*`, `>`, and the Unicode bands terminal
 * decoration actually lives in (dashes, bullets, arrows, misc-technical incl. `⏺`, box-drawing/block/
 * geometric/dingbats incl. `│`, misc symbols-and-arrows). That keeps the generality the substrate needs
 * — the next CLI release will render a fourth glyph, and it will be in one of those bands — while every
 * quoting, fencing and structural character (backtick, `#`, `"`, `'`, `{`, `[`, `:`, `.`, `/`, `\`) is
 * excluded. The curly-quote block U+2018-U+201F is deliberately NOT in range for the same reason.
 *
 * It stays ANCHORED and BOUNDED, and that is the anti-smuggling property: a single alphanumeric
 * character ahead of the marker (i.e. any prose at all — "I will print FYT-STAGE-DONE when finished")
 * kills the match, so a marker cannot be hidden mid-sentence. Combined with the per-delivery token and
 * the stage-id check in `scan`, and with the order file spelling only {@link VERDICT_PLACEHOLDER}, an
 * agent still cannot fabricate or replay a completion.
 */
const MARKER = new RegExp(
  '^[ \\t*>\\u2010-\\u2015\\u2022\\u2023\\u2190-\\u21FF\\u2200-\\u23FF\\u2500-\\u27BF\\u2B00-\\u2BFF-]{0,32}'
  + 'FYT-STAGE-(DONE|BLOCKED|FAILED)[ \\t]+([A-Za-z0-9._:-]{1,128})[ \\t]+([a-f0-9]{32})[ \\t]*(.*)$',
);
/**
 * Bound on how long ONE delivery may sit unanswered before it settles as a human wait. Deliberately
 * generous: the longest real stage is a whole long-form script or a 130-200 call image batch — hours,
 * not minutes — and this exists to police NOTHING about pace. It exists because `settled` is otherwise
 * reachable only from a marker match, a session exit, or a retire, so ONE missed marker (a REPL that
 * never came up and a delivery line typed into a bare shell prompt, a renderer this scanner does not
 * recognise, an agent that simply never printed) held the engine's single worker slot forever, until an
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
 * order landed and no marker came back; this one means the order never left the control plane.
 */
export const DELIVERY_NOT_READY_REASON = 'roster-delivery-not-ready';
/**
 * How long ONE delivery may wait for its terminal to reach a plain REPL prompt before it settles as a
 * human wait. Generous, because the legitimate wait is real: a freshly spawned session is still booting
 * `claude` and then reading its binding context, and an agent mid-turn on operator conversation must be
 * allowed to finish. Clamped into [{@link MIN_REPL_READY_TIMEOUT_MS}, the delivery timeout] — the marker
 * deadline stays the OUTER bound, so this can never extend how long a stage may sit.
 */
const DEFAULT_REPL_READY_TIMEOUT_MS = 5 * 60 * 1_000;
const MIN_REPL_READY_TIMEOUT_MS = 5 * 1_000;
/** Readiness poll backoff: quick first re-checks (a menu is usually answered fast), then patient. */
const REPL_POLL_MIN_MS = 250;
const REPL_POLL_MAX_MS = 5_000;
/**
 * Rolling window of terminal output kept for readiness detection, separate from the marker buffer (which
 * is consumed line-by-line and reset per delivery). Small on purpose: an interactive REPL redraws its
 * whole frame continuously and `stripTerminalControl` cannot collapse those redraws, so only the tail is
 * the CURRENT screen — a large window would keep an already-answered menu "visible" forever.
 */
const SCREEN_WINDOW_CHARS = 4_000;
const SCREEN_WINDOW_LINES = 20;
/** Durable activity mirror written by `record` and read back by `state` after a daemon restart. */
const ROSTER_ACTIVITY = /^roster:([a-z0-9][a-z0-9-]{0,63}) (.+)$/;
/** Page size for the INCREMENTAL durable-event read behind `state` (bounded by the store's own cap). */
const EVENT_PAGE = 500;
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
  writeFile(path: string, contents: string): void;
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
  launchLine?: (input: { model: string; bindingPath: string; settingsPath: string; runRef: string; agentId: string }) => string;
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
   * [{@link MIN_REPL_READY_TIMEOUT_MS}, this delivery's marker deadline].
   */
  replReadyTimeoutMs?: number;
  /** Backoff sleep between readiness polls. Injected so the suite never waits on a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Marker deadline per delivery, in ms. A number applies to every stage; a function is consulted per
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
  /** Per-delivery marker deadline override, in ms. Clamped exactly like the manager-level option. */
  timeoutMs?: number;
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
  settingsPath: string;
  buffer: string;
  /**
   * Rolling tail of this terminal's output, kept independently of {@link RosterSessionEntry.buffer}
   * (which is line-consumed and reset per delivery). This is what the REPL-readiness gate reads, so it
   * must survive across deliveries and must keep accumulating while the session is idle — the whole point
   * is to know what is on screen BEFORE a work order is typed.
   */
  screen: string;
  unobserve: () => void;
  /** At most one outstanding delivery per agent session (a terminal runs one order at a time). */
  pending: PendingDelivery | null;
}

interface PendingDelivery {
  stageId: string;
  token: string;
  settle: (result: WorkerExecutionResult) => void;
  /**
   * The marker deadline for THIS delivery. Cleared on every settle path (marker, session exit, retire),
   * so a delivery that already landed can never be re-settled by a late timer.
   */
  timer: ReturnType<typeof setTimeout> | null;
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
  writeFile: (path, contents) => { writeFileSync(path, contents, { encoding: 'utf8' }); },
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

/**
 * A modal prompt is on screen: the REPL is NOT accepting a line of input, it is waiting for a keystroke
 * against a menu. Typing a work order here does not queue it — the characters are consumed by the menu's
 * own key handling and the order is silently destroyed. That is the observed defect: a delivery line
 * interleaved character-by-character with a tool-permission menu and vanished, and the stage then sat
 * against the 4h marker deadline.
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
];
/**
 * The REPL is mid-turn. Input typed now is buffered by the CLI in a way that races its own re-render,
 * and delivering a second order on top of an unfinished one is exactly the "one order at a time"
 * invariant `entry.pending` exists to hold. Wait for the turn to end.
 */
const BUSY_MARKERS: readonly RegExp[] = [
  /\b(?:esc|escape) to interrupt\b/i,
  /\(ctrl\+?-?c to (?:cancel|stop|interrupt)\)/i,
];

export type ReplReadiness =
  | { state: 'ready' }
  | { state: 'modal'; marker: string }
  | { state: 'busy'; marker: string };

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
 * MENU-ABSENCE, NOT PROMPT-PRESENCE. This deliberately does NOT require a positive prompt glyph. The
 * REPL's idle frame is a box-drawn input widget whose exact glyphs change between CLI releases, and a
 * detector that must recognise it would refuse every delivery the day the box changes — trading a rare
 * swallowed order for a total outage. Refusing on a RECOGNISED blocker and defaulting to ready is the
 * safe direction: an unrecognised idle frame behaves exactly as it does today, and every blocker this
 * pipeline has actually hit is recognised.
 */
export function detectReplReadiness(tail: string): ReplReadiness {
  const frame = currentFrame(tail);
  for (const pattern of MODAL_MARKERS) {
    const match = pattern.exec(frame);
    if (match) return { state: 'modal', marker: match[0].trim().slice(0, 80) };
  }
  for (const pattern of BUSY_MARKERS) {
    const match = pattern.exec(frame);
    if (match) return { state: 'busy', marker: match[0].trim().slice(0, 80) };
  }
  return { state: 'ready' };
}

/**
 * Tools whose Claude Code permission rules carry a PATH pathspec, i.e. the only tools an approved scope
 * can actually bound. `Bash` is deliberately absent: a Bash rule matches a COMMAND PREFIX, never a path,
 * so "Bash strictly within scope" is inexpressible and a bare `Bash` entry would be the blanket
 * allow-all this grant is forbidden to be. Shell approvals therefore stay with the human sitting at the
 * terminal — and, since the readiness gate below now refuses to type into an open menu, a stage parked on
 * a Bash prompt parks VISIBLY instead of losing its work order.
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
 * Anchor an absolute directory as a filesystem-ABSOLUTE Claude Code rule pathspec: a leading `//` marks a
 * pathspec filesystem-absolute (a single leading `/` anchors at the settings source instead), Windows
 * backslashes become forward slashes, and the drive letter is preserved — the grammar
 * `claudeWorkerAdapter.ts#absoluteReadDenyRule` already emits, verified against
 * code.claude.com/docs/en/permissions.md. The path's own leading separator is folded into the marker, so
 * a POSIX root `/repo` yields `//repo/...` rather than a meaningless `///repo/...`; a Windows root
 * `C:/Users/danie/kb` has no leading separator and is byte-identical to the existing helper's output.
 */
function absoluteRulePath(root: string, relative?: string): string {
  return `//${absoluteDir(root, relative).replace(/^\/+/, '')}`;
}

export interface RosterPermissionInput {
  /** Canonical checkout the repo-relative scope entries resolve against. */
  repoRoot: string;
  /** `<stateRoot>/control/roster/<runRef>/<agentId>` — this agent's own binding + work-order channel. */
  agentDir: string;
  /** Repo-relative read scope, unioned across the stages this agent owns. */
  read: readonly string[];
  /** Repo-relative write scope, unioned across the stages this agent owns. */
  write: readonly string[];
  /** The server-owned workflow tool cap this run executes under. Nothing outside it is ever granted. */
  tools: readonly string[];
}

export interface RosterPermissionSettings {
  allow: string[];
  additionalDirectories: string[];
  /** The exact bytes written to the per-run settings file and handed to `claude --settings`. */
  json: string;
}

/**
 * Build ONE roster session's scoped permission settings.
 *
 * WHY THIS EXISTS. A spawned roster terminal's FIRST act is to read its own `binding.md`, and that read
 * parked on Claude Code's interactive "Do you want to proceed?" tool-permission menu — a per-session,
 * modal decision that folder trust (`hasTrustDialogAccepted`) does not answer and that no remembered
 * `allowedTools` list covers. The run then went nowhere. The fix is a per-run settings file passed with
 * `--settings <path>` (the CLI accepts a file path or an inline JSON string; `claude --help`:
 * "Path to a settings JSON file or a JSON string to load additional settings from").
 *
 * WHAT IT GRANTS, AND NOTHING MORE:
 *  - `permissions.allow` rules for the scoped file tools, over the stage's ALREADY-DECLARED
 *    `scope.read ∪ scope.write` (reads) and `scope.write` (writes), each rule anchored `//`-absolute at
 *    the canonical repo root. A tool the server-owned workflow profile does not grant produces no rule.
 *  - `Read` over this agent's own roster directory — the control plane's order channel (`binding.md`
 *    plus `orders/*.md`). This is the one grant that is not repo scope, and it is the narrowest possible
 *    form of it: one agent, one run, read-only, deleted when the roster retires.
 *  - `permissions.additionalDirectories` for exactly those same directories, because a scope root or the
 *    roster directory can sit outside the session cwd, and an allow rule alone does not extend the
 *    working set.
 *
 * There is no wildcard, no `defaultMode` change, no deny-list override, and no path that is not either a
 * declared scope entry or this agent's own order channel. An entry that is not a safe repo-relative path
 * is dropped rather than interpolated.
 */
export function buildRosterPermissionSettings(input: RosterPermissionInput): RosterPermissionSettings {
  const allow: string[] = [];
  const additionalDirectories: string[] = [];
  const addAllow = (rule: string): void => { if (!allow.includes(rule)) allow.push(rule); };
  const addDir = (dir: string): void => { if (!additionalDirectories.includes(dir)) additionalDirectories.push(dir); };

  // The order channel first: without it the session cannot read the binding context it is booted on.
  addAllow(`Read(${absoluteRulePath(input.agentDir)}/**)`);
  addDir(absoluteDir(input.agentDir));

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

  return {
    allow,
    additionalDirectories,
    json: `${JSON.stringify({ permissions: { allow, additionalDirectories } }, null, 2)}\n`,
  };
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

export interface CompletionMarker {
  verdict: 'DONE' | 'BLOCKED' | 'FAILED';
  stageId: string;
  token: string;
  summary: string;
}

/**
 * Parse ONE control-stripped line as a completion marker, or `null`. The single reader of {@link MARKER}
 * — `scan` delegates here — and exported so every accepted CLI rendering and every rejected forgery is
 * testable without driving a whole pty session.
 */
export function matchCompletionMarker(line: string): CompletionMarker | null {
  const match = MARKER.exec(line.trim());
  if (!match) return null;
  return {
    verdict: match[1] as CompletionMarker['verdict'],
    stageId: match[2],
    token: match[3],
    summary: match[4] ?? '',
  };
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

function defaultLaunchLine(input: { model: string; bindingPath: string; settingsPath: string; runRef: string; agentId: string }): string {
  // `--settings` takes a file path (or inline JSON). The path is quoted because the dashboard state root
  // is an absolute OS path that may contain spaces.
  return `claude --model ${input.model} --settings "${input.settingsPath}" `
    + `"Read ${input.bindingPath} now. It is your binding context for run `
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
      'Each order file names the exact completion marker to print when the stage is genuinely finished,',
      'including a token that only that file carries. Print it on its own line, once, at the end.',
      '',
      'The human may talk to you in this terminal at any time. Answer, iterate, and keep waiting.',
    ].join('\n');
  };

  const orderMarkdown = (input: {
    runRef: string;
    stageId: string;
    attemptRef: string;
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
      `- when the stage is finished, print ONE line: ${VERDICT_PLACEHOLDER} ${input.stageId} ${input.token} <one-line summary>`,
      '- replace <VERDICT> with DONE (finished), BLOCKED (needs a human), or FAILED (cannot finish).',
      '- print it once, at a line start, after the work is really on disk. The control plane is watching',
      '  this terminal for exactly that line and advances the run on it.',
      '- never print the marker for a stage or token other than the ones above.',
    ].join('\n');
  };

  /**
   * The ONE settle path. Every outcome (marker, missed-marker timeout, session exit, retire) goes
   * through here so the pending slot and its deadline timer are always released together — a delivery
   * that settled twice would resolve the engine's promise once and leak a timer that later fired
   * against a slot a NEW delivery owns.
   */
  const resolvePending = (entry: RosterSessionEntry, result: WorkerExecutionResult): void => {
    const pending = entry.pending;
    if (!pending) return;
    entry.pending = null;
    if (pending.timer) clearTimeout(pending.timer);
    pending.settle(result);
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
   * Wait for a terminal to leave a modal menu / stop being mid-turn, polling its own output stream with
   * exponential backoff. Returns the readiness that was true when it gave up, so the caller can name it.
   *
   * The FAST PATH IS SYNCHRONOUS BY DESIGN: an already-ready terminal never awaits, so `deliver` keeps
   * authoring and typing its order in the same synchronous prefix it always did. Only a genuinely blocked
   * terminal pays a suspension.
   */
  const waitForRepl = async (entry: RosterSessionEntry, budgetMs: number): Promise<ReplReadiness> => {
    const started = now();
    let delay = REPL_POLL_MIN_MS;
    let readiness = detectReplReadiness(entry.screen);
    while (readiness.state !== 'ready') {
      if (now() - started >= budgetMs) return readiness;
      await sleep(Math.min(delay, Math.max(0, budgetMs - (now() - started))));
      delay = Math.min(REPL_POLL_MAX_MS, delay * 2);
      readiness = detectReplReadiness(entry.screen);
    }
    return readiness;
  };

  const scan = (entry: RosterSessionEntry, chunk: string): void => {
    const stripped = stripTerminalControl(chunk);
    // The readiness window accumulates ALWAYS — idle output is exactly what the delivery gate reads.
    entry.screen = (entry.screen + stripped).slice(-SCREEN_WINDOW_CHARS);
    const pending = entry.pending;
    if (!pending) {
      // Keep the window bounded even while idle so a chatty session cannot grow memory.
      entry.buffer = (entry.buffer + stripped).slice(-SCAN_WINDOW_CHARS);
      return;
    }
    entry.buffer = (entry.buffer + stripped).slice(-SCAN_WINDOW_CHARS);
    const lines = entry.buffer.split('\n');
    // Keep the trailing partial line for the next chunk; a marker is only acted on once complete.
    entry.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const marker = matchCompletionMarker(line);
      if (!marker) continue;
      const { verdict, stageId, token } = marker;
      if (stageId !== pending.stageId || token !== pending.token) continue;
      const summary = safeSummary(marker.summary, `stage ${stageId} reported ${verdict.toLowerCase()}`);
      const state = verdict === 'DONE' ? 'succeeded' : verdict === 'BLOCKED' ? 'waiting-human' : 'failed';
      resolvePending(entry, { state, summary, usage: zeroUsage(), artifacts: [], checkpoints: [] });
      return;
    }
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
    const bindingPath = join(agentDir, 'binding.md');
    fs.writeFile(bindingPath, bindingMarkdown({
      runRef, agentId, verified, project: run.project, parameters: run.parameters, workDir: run.workDir,
    }));
    // THE SCOPED PER-RUN PERMISSIONS. Written BEFORE the launch line is typed, from the compiled
    // proposal's own declared scope and the server-owned tool cap — never a blanket flag, never a
    // pre-trusted path, never anything outside `scope.read ∪ scope.write` plus this agent's own order
    // channel. It lives inside the roster run directory, so `retireRun`'s `removeDir` is already its
    // cleanup: the grant cannot outlive the run it was minted for.
    const scope = rosterAgentScope(proposal, agentId);
    const settingsPath = join(agentDir, 'settings.json');
    fs.writeFile(settingsPath, buildRosterPermissionSettings({
      repoRoot: options.repoRoot,
      agentDir,
      read: scope.read,
      write: scope.write,
      tools: rosterAgentTools(proposal, agentId, resolveWorkflowTools),
    }).json);
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
      buffer: '',
      screen: '',
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
      model: verified.assignment.model, bindingPath, settingsPath, runRef, agentId,
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
      // which consumed the keystrokes as menu input, and the stage then sat against the marker deadline
      // with nothing delivered and nothing to report. A terminal is written into only when its own output
      // stream says it is at a plain REPL prompt — not in a modal menu and not mid-turn.
      //
      // The fast path costs nothing: `detectReplReadiness` over an idle frame returns `ready` and the
      // code below runs synchronously exactly as before. Only a blocked terminal suspends, and it does so
      // under a bound that never exceeds this delivery's own marker deadline.
      const readinessBudget = Math.min(
        timeoutMs,
        Math.max(MIN_REPL_READY_TIMEOUT_MS, options.replReadyTimeoutMs ?? DEFAULT_REPL_READY_TIMEOUT_MS),
      );
      let readiness = detectReplReadiness(entry.screen);
      if (readiness.state !== 'ready') readiness = await waitForRepl(entry, readinessBudget);
      if (readiness.state !== 'ready') {
        // NOTHING was authored and NOTHING was typed: no order file, no token, no bytes into the pty.
        // This settles as a named human wait, never as a hang and never as a silent success.
        const detail = readiness.state === 'modal'
          ? `an interactive prompt is open ("${readiness.marker}")`
          : `it is still mid-turn ("${readiness.marker}")`;
        const summary = `work order withheld: the ${agentId} terminal was not at a REPL prompt within `
          + `${Math.max(1, Math.round(readinessBudget / 60_000))} min — ${detail} (${DELIVERY_NOT_READY_REASON}); `
          + 'answer or clear it in that terminal, then re-run the stage';
        record(run.subject, input.runRef, agentId, summary, 'waiting', input.stageRef);
        return {
          state: 'waiting-human', summary: summary.slice(0, MAX_SUMMARY_CHARS), usage: zeroUsage(), artifacts: [], checkpoints: [],
        };
      }

      // THE PRE-DELIVERY BASELINE. Taken before the order file exists, so the agent cannot have acted
      // yet: this is what "the stage changed its declared artifacts" is measured against on completion.
      const snapshots = snapshotDeclaredArtifacts(input.proposalStage);

      const token = mintToken();
      if (!/^[a-f0-9]{32}$/.test(token)) throw new RosterSessionError('roster completion token is malformed');
      const orderPath = join(runDir(input.runRef), agentId, 'orders', `${input.stageId}.md`);
      fs.ensureDir(join(runDir(input.runRef), agentId, 'orders'));
      fs.writeFile(orderPath, orderMarkdown({
        runRef: input.runRef, stageId: input.stageId, attemptRef: input.attemptRef, token,
        proposalStage: input.proposalStage, parameters: run.parameters, workDir: run.workDir,
      }));

      const pending: PendingDelivery = { stageId: input.stageId, token, settle: () => {}, timer: null };
      // The executor runs synchronously, so `settle` is the real resolver before anything can settle.
      const settled = new Promise<WorkerExecutionResult>((resolve) => { pending.settle = resolve; });
      entry.pending = pending;
      entry.buffer = '';
      // THE MARKER DEADLINE. `settled` is otherwise reachable only from a marker match, a session exit,
      // or a retire, so one missed marker held the engine's single worker slot until an operator ran
      // `stop`. Armed against THIS delivery only: a slot that a later delivery owns is left alone.
      const timer = setTimeout(() => {
        if (entry.pending !== pending) return;
        const summary = `delivery abandoned: stage ${input.stageId} printed no completion marker within `
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
      const wrote = options.registry.write(entry.owner, entry.sessionId, `${deliveryLine({ orderPath, stageId: input.stageId })}\r`);
      if (!wrote) {
        // `settled` is discarded with this early return, so releasing the slot and the deadline together
        // is the whole cleanup.
        clearTimeout(timer);
        entry.pending = null;
        const summary = `work order could not be written into session ${entry.sessionId}`;
        record(run.subject, input.runRef, agentId, summary, 'interrupted', input.stageRef);
        return { state: 'waiting-human', summary, usage: zeroUsage(), artifacts: [], checkpoints: [] };
      }
      record(run.subject, input.runRef, agentId, `working stage ${input.stageId}`, 'pending', input.stageRef);
      const result = await settled;
      if (result.state === 'succeeded') {
        // Declared artifacts are verified SERVER-SIDE before the completion is accepted; a marker alone
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
