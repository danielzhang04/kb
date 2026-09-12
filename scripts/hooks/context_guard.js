#!/usr/bin/env node
/**
 * kb PreToolUse:Read|Bash hook — CONTEXT GUARD (L3, token-discipline spec S5).
 *
 * Deliberately on the OLDER exit-code + stderr idiom (hard_ceiling_guard.js's style), NOT
 * lib/hook_io.js's `run()` (which only ever exits 0) -- this hook must be able to say no.
 *
 * Two independent denial classes, both fail-open beyond their own narrow trigger:
 *   1. Read of a configured extension (default: PDF/image) in a session whose model matches a
 *      configured substring (default: fable/opus).
 *   2. Bash matching a configured verbose-command pattern with no escape hatch present
 *      (pytest without -q/tail|head|grep, unbounded `git log`, `find /`, `cat` of a file over a
 *      configured byte limit unless piped through a filter).
 *
 * ── HOW THE SESSION MODEL IS KNOWN (ruling, 2026-09-11; revised in fix round 1) ─────────────────
 * Task 0's probe proved `event.model` is ABSENT on every PreToolUse/SessionStart payload in this
 * build, so the `## Session model` store note project_frame_session_start.js used to write from
 * `event.model` was EMPTY in practice, every time; with this guard reading the transcript instead,
 * that note had no reader and no content, and fix wave M3 deleted it.
 * Instead it ALWAYS tail-reads `event.transcript_path` fresh, on every call (last <=
 * TRANSCRIPT_TAIL_BYTES, via a seek -- never the whole file, which can be many MB). Measured 0.09s
 * on a 100 MB transcript -- cheap enough to skip caching, and caching would go stale across a
 * `/resume` that changes the session's model mid-transcript.
 *
 * Detection is STRUCTURAL, not a raw regex over the bytes: the tail is split into lines, the first
 * (likely partial, since the seek can land mid-line) is dropped, and the remaining complete lines
 * are walked from the END, JSON.parse'd one at a time (parse failures skipped), until one is found
 * where `type === "assistant"` and `message.model` is a string -- that is the model. This matters
 * because a plain substring/regex scan for `"model":"claude-…"` would also match the SAME literal
 * text if it appears inside a later tool-result line (e.g. a tool result echoing another
 * transcript's JSON) and wrongly treat that as the session's current model; the structural walk
 * only trusts a line that is itself a complete, parseable assistant record.
 *
 * Nothing found (no transcript_path, unreadable file, or no assistant record in the tail) -> guard
 * inactive for that Read (fail open, per spec: "no model note -> no guard").
 *
 * ── SUBAGENTS (fix wave M4, verified live 2026-09-12) ───────────────────────────────────────────
 * A subagent's PreToolUse payload carries `transcript_path` = the PARENT session's transcript,
 * plus `agent_id` and the parent's `session_id` (captured verbatim from a live haiku child:
 * {session_id: "a17f3a89-...", transcript_path: "...\\C--Users-danie-kb-worktrees-token-discipline
 * \\a17f3a89-....jsonl", agent_id: "a2f82da3ee1efcfea", agent_type: "general-purpose"}). Reading
 * that path answered with the PARENT'S model, so a haiku extractor dispatched from an Opus boss
 * was told, by this guard, to "delegate to a haiku extractor" -- the escape hatch the denial
 * message prescribes was itself denied, verified live before the fix. When `agent_id` is present,
 * the child's own transcript is resolved at
 *   <dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl
 * (the real on-disk layout under ~/.claude/projects/<project>/), and the parent path is used only
 * when that file is missing -- so a nested agent whose transcript has not been created yet still
 * degrades to the old behaviour rather than to no guard at all.
 *
 * Rules are read from context_guard.rules.yaml (Daniel-owned, hand-parsed -- see that file's own
 * header for why no YAML library is used, and for a naming note reconciling an earlier ruling's
 * prose against the pinned config-shape test). A missing or malformed rules file degrades to ZERO
 * rules loaded (fail open), never a crash; a one-line diagnostic goes to stderr ONLY when
 * KB_DEBUG_HOOKS=1 (never in normal operation, so it can't be mistaken for a denial message).
 *
 * KB_CONTEXT_GUARD_RULES_PATH overrides the rules-file location (test seam, same convention as
 * lib/model_audit.js's KB_MODEL_AUDIT_PATH / KB_MODEL_ROUTING_PATH).
 *
 * Exit codes: 0 = allow (including every fail-open path). 2 = deny, with
 * "[context-guard BLOCK] <message>" on stderr and NOTHING on stdout.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_RULES_PATH = path.join(__dirname, "context_guard.rules.yaml");
const MAX_STDIN = 1024 * 1024;

/** Last <= this many bytes of a transcript are read on every call -- no caching (see file header). */
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

function debugLog(env, message) {
  if (env && env.KB_DEBUG_HOOKS === "1") {
    process.stderr.write("[context-guard debug] " + message + "\n");
  }
}

function parseFlowArray(raw) {
  const m = /^\[(.*)\]$/.exec(raw.trim());
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function parseRulesFile(text) {
  const top = { read_extensions: [], read_models: [], read_message: "", rules: [] };
  let currentRule = null;
  let inRulesList = false;

  for (const rawLine of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const topArray = /^(read_extensions|read_models):\s*(\[.*\])\s*$/.exec(rawLine);
    if (topArray) {
      top[topArray[1]] = parseFlowArray(topArray[2]);
      continue;
    }
    const topScalar = /^read_message:\s*(.*)$/.exec(rawLine);
    if (topScalar) {
      top.read_message = topScalar[1].trim();
      continue;
    }
    if (/^rules:\s*$/.test(rawLine)) {
      inRulesList = true;
      continue;
    }
    if (!inRulesList) continue;

    const newRule = /^\s*-\s*id:\s*(.+?)\s*$/.exec(rawLine);
    if (newRule) {
      if (currentRule) top.rules.push(currentRule);
      currentRule = { id: newRule[1] };
      continue;
    }
    const field = /^\s+([a-z_]+):\s*(.*)$/.exec(rawLine);
    if (field && currentRule) {
      currentRule[field[1]] = field[2].trim();
    }
    // any other line inside the rules list is ignored, not fatal -- fail open, never crash.
  }
  if (currentRule) top.rules.push(currentRule);
  return top;
}

function compileRule(raw) {
  if (!raw || typeof raw.id !== "string" || typeof raw.trigger !== "string" || !raw.tool) {
    return null;
  }
  let trigger;
  try {
    trigger = new RegExp(raw.trigger);
  } catch (_err) {
    return null;
  }
  let escape = null;
  if (raw.escape) {
    try {
      escape = new RegExp(raw.escape);
    } catch (_err) {
      escape = null;
    }
  }
  // `raw.limit_bytes` is always a STRING here (the hand-rolled parser never produces numbers), so
  // a configured `limit_bytes: 0` arrives as the non-empty string "0" -- truthy, so a bare
  // ternary on raw.limit_bytes itself would work for THIS field, but Number.isFinite on the
  // CONVERTED number is used instead so the check reads the same way `checkBash` reads the
  // result (0 is a valid, finite, MEANINGFUL limit; unset/unparsable is `null` = no limit).
  const limitBytesNum = raw.limit_bytes !== undefined ? Number(raw.limit_bytes) : NaN;
  return {
    id: raw.id,
    tool: raw.tool,
    kind: raw.kind || "regex",
    trigger,
    escape,
    limitBytes: Number.isFinite(limitBytesNum) ? limitBytesNum : null,
    message: raw.message || "denied by context guard",
  };
}

/**
 * Read + compile the rules file. Never throws: a missing file, an unreadable file, or a file that
 * parses to nothing usable all degrade to zero rules (fail open). `env` is only consulted for the
 * KB_DEBUG_HOOKS diagnostic -- it changes no behavior.
 */
function loadRules(filePath, env) {
  const e = env || process.env;
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    debugLog(e, "rules file not found at " + filePath + " -- guard inactive");
    return { readExtensions: [], readModels: [], readMessage: "", rules: [] };
  }
  const parsed = parseRulesFile(text);
  const parsedNothing =
    parsed.read_extensions.length === 0 && parsed.read_models.length === 0 && parsed.rules.length === 0;
  if (parsedNothing && text.trim()) {
    debugLog(e, "rules file at " + filePath + " parsed to zero rules (malformed?) -- guard inactive");
  }
  return {
    readExtensions: parsed.read_extensions.map((ext) => ext.toLowerCase()),
    readModels: parsed.read_models.map((m) => m.toLowerCase()),
    readMessage: parsed.read_message,
    rules: parsed.rules.map(compileRule).filter(Boolean),
  };
}

function extractEvent(rawInput) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Read the last `maxBytes` of a file via a seek -- never the whole file. Returns null on any
 * failure (missing file, unreadable, not a regular file): callers fail open on null.
 * `truncated` is true when the read started after byte 0 -- i.e. the FIRST line in `text` is
 * likely a partial line (the seek landed mid-line) and must be dropped before parsing.
 */
function tailReadFile(filePath, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch (_err) {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const readSize = Math.min(size, maxBytes);
    if (readSize <= 0) return { text: "", truncated: false };
    const start = size - readSize;
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, start);
    return { text: buf.toString("utf8"), truncated: start > 0 };
  } catch (_err) {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch (_closeErr) {
      /* best effort */
    }
  }
}

/**
 * The session's CURRENT model, read structurally from the tail of `event.transcript_path`: split
 * into lines (dropping a leading partial line when the tail read started mid-file), then walk the
 * remaining complete lines from the END, JSON.parse'ing each (a parse failure is skipped, never
 * fatal) until one is found where `type === "assistant"` and `message.model` is a string. This
 * deliberately does NOT do a raw substring/regex scan for `"model":"claude-…"`: that text can
 * legitimately appear inside a LATER non-assistant line (e.g. a tool-result echoing another
 * transcript's JSON) without meaning the session's model changed, and only a structural walk can
 * tell the difference. Null when nothing qualifies -- the guard is inactive for that Read (spec:
 * "no model note -> no guard").
 */
/** Harness-generated ids only: anything else must not be pasted into a filesystem path. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * WHICH transcript speaks for this event: the subagent's own when the payload names one and that
 * file exists on disk, else the `transcript_path` the harness sent (the parent's, for a subagent).
 * See the SUBAGENTS note in the file header for the verified payload shape and layout.
 */
function resolveTranscriptPath(event) {
  const parentPath = event.transcript_path;
  if (typeof parentPath !== "string" || !parentPath) return null;
  const agentId = event.agent_id;
  const sessionId = event.session_id;
  if (
    typeof agentId === "string" && SAFE_ID.test(agentId) &&
    typeof sessionId === "string" && SAFE_ID.test(sessionId)
  ) {
    const candidate = path.join(
      path.dirname(parentPath), sessionId, "subagents", "agent-" + agentId + ".jsonl"
    );
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_err) {
      /* no subagent transcript (yet) -- fall through to the parent path */
    }
  }
  return parentPath;
}

function resolveSessionModel(event) {
  const transcriptPath = resolveTranscriptPath(event);
  if (!transcriptPath) return null;

  const tail = tailReadFile(transcriptPath, TRANSCRIPT_TAIL_BYTES);
  if (!tail || !tail.text) return null;

  let lines = tail.text.split("\n");
  if (tail.truncated && lines.length > 0) {
    lines = lines.slice(1); // drop the likely-partial first line
  }

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (_err) {
      continue; // an unparseable (partial/corrupt) line is skipped, never fatal
    }
    if (
      record &&
      typeof record === "object" &&
      record.type === "assistant" &&
      record.message &&
      typeof record.message.model === "string"
    ) {
      return record.message.model.toLowerCase();
    }
  }
  return null;
}

function extensionOf(filePath) {
  const m = /\.[a-z0-9]+$/i.exec(String(filePath || ""));
  return m ? m[0].toLowerCase() : "";
}

function checkRead(event, cfg) {
  const filePath = event.tool_input && event.tool_input.file_path;
  if (typeof filePath !== "string" || !filePath) return null;
  if (!cfg.readExtensions.includes(extensionOf(filePath))) return null;
  const model = resolveSessionModel(event);
  if (!model) return null; // no model found anywhere -> no guard
  if (!cfg.readModels.some((m) => model.includes(m))) return null;
  return cfg.readMessage || "denied by context guard";
}

function resolveCatTarget(command, cwd) {
  const m = /^\s*cat\s+(\S+)/.exec(command);
  if (!m) return null;
  const token = m[1].replace(/^["']|["']$/g, "");
  if (/[*?$`|;&<>]/.test(token)) return null; // not a plain literal path -- don't try to stat it
  return path.isAbsolute(token) ? token : path.join(cwd || ".", token);
}

function checkBash(event, cfg) {
  const command = event.tool_input && event.tool_input.command;
  if (typeof command !== "string" || !command) return null;
  for (const rule of cfg.rules) {
    if (rule.tool !== "Bash") continue;
    if (!rule.trigger.test(command)) continue;
    if (rule.escape && rule.escape.test(command)) continue;
    if (rule.kind === "cat-size") {
      const target = resolveCatTarget(command, event.cwd);
      if (!target) continue;
      let size;
      try {
        size = fs.statSync(target).size;
      } catch (_err) {
        continue; // can't stat it -> not this hook's job to say so
      }
      // rule.limitBytes can legitimately be 0 ("anything over 0 bytes is too big"); `|| Infinity`
      // would treat 0 as falsy and silently disable the check, so `null` (unset) is the only
      // value that means "no limit".
      const limit = rule.limitBytes === null ? Infinity : rule.limitBytes;
      if (size <= limit) continue;
    }
    return rule.message;
  }
  return null;
}

function main() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch (_err) {
    raw = "";
  }
  const event = extractEvent(raw.slice(0, MAX_STDIN));
  if (!event) {
    process.exit(0);
  }
  if (event.hook_event_name && event.hook_event_name !== "PreToolUse") {
    process.exit(0);
  }

  const env = process.env;
  const rulesPath = env.KB_CONTEXT_GUARD_RULES_PATH || DEFAULT_RULES_PATH;
  const cfg = loadRules(rulesPath, env);
  let denyMessage = null;
  try {
    if (event.tool_name === "Read") {
      denyMessage = checkRead(event, cfg);
    } else if (event.tool_name === "Bash") {
      denyMessage = checkBash(event, cfg);
    }
  } catch (_err) {
    process.exit(0); // any classifier failure fails OPEN -- never wedges the tool call
  }

  if (denyMessage) {
    process.stderr.write("[context-guard BLOCK] " + denyMessage + "\n");
    process.exit(2);
  }
  process.exit(0);
}

main();
