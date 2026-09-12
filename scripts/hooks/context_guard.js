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
 * ── HOW THE SESSION MODEL IS KNOWN (ruling, 2026-09-11) ─────────────────────────────────────────
 * Task 0's probe proved `event.model` is ABSENT on every PreToolUse/SessionStart payload in this
 * build, so project_frame_session_start.js's `## Session model` store note (written from
 * `event.model` when present) is EMPTY in practice, every time. Reading only that note would make
 * this guard permanently inert. So: read the store first; if empty, tail-read
 * `event.transcript_path` (last <= TRANSCRIPT_TAIL_BYTES, via a seek -- never the whole file,
 * which can be many MB) and take the LAST `"model":"claude-…"` occurrence in that tail (a live
 * transcript carries the model on every assistant message, so the last one in the tail is the
 * session's current model). Found -> cache it into the store's `## Session model` via
 * store.updateStore (under the lock) so later tool calls in the same session skip the tail-read.
 * Nothing found anywhere -> guard inactive for that Read (fail open, per spec: "no model note ->
 * no guard").
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
const store = require("./lib/context_store.js");

const DEFAULT_RULES_PATH = path.join(__dirname, "context_guard.rules.yaml");
const MAX_STDIN = 1024 * 1024;
const SESSION_MODEL_HEADING = "Session model";

/** Last <= this many bytes of a transcript are read on the model-detection fallback. */
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

/** Matches a JSON `"model":"claude-…"` field anywhere in a chunk of transcript text. */
const MODEL_FIELD = /"model"\s*:\s*"(claude-[^"]*)"/g;

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
  return {
    id: raw.id,
    tool: raw.tool,
    kind: raw.kind || "regex",
    trigger,
    escape,
    limitBytes: raw.limit_bytes ? Number(raw.limit_bytes) : null,
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

/** Store-only lookup of '## Session model'. Null when absent/empty/unreadable. */
function sessionModel(sessionId, env) {
  if (!sessionId) return null;
  const sections = store.readStore(sessionId, env);
  const body = store.sectionBody(sections, SESSION_MODEL_HEADING);
  return body ? body.trim().toLowerCase() : null;
}

/**
 * Read the last `maxBytes` of a file via a seek -- never the whole file. Returns null on any
 * failure (missing file, unreadable, not a regular file): callers fail open on null.
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
    if (readSize <= 0) return "";
    const start = size - readSize;
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, start);
    return buf.toString("utf8");
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

/** The LAST `"model":"claude-…"` occurrence in `text`, or null. */
function lastModelInText(text) {
  if (!text) return null;
  MODEL_FIELD.lastIndex = 0;
  let match;
  let last = null;
  while ((match = MODEL_FIELD.exec(text)) !== null) {
    last = match[1];
  }
  return last;
}

/**
 * The session's model: store note first, else a tail-read of `event.transcript_path` (cached back
 * into the store on a hit). Null when neither source yields one -- the guard is inactive for that
 * Read (spec: "no model note -> no guard").
 */
function resolveSessionModel(event, env) {
  const sessionId = event.session_id;
  const fromStore = sessionModel(sessionId, env);
  if (fromStore) return fromStore;

  const transcriptPath = event.transcript_path;
  if (typeof transcriptPath !== "string" || !transcriptPath) return null;

  const tail = tailReadFile(transcriptPath, TRANSCRIPT_TAIL_BYTES);
  const model = lastModelInText(tail);
  if (!model) return null;

  if (typeof sessionId === "string" && sessionId) {
    store.updateStore(
      sessionId,
      (sections) => store.upsertSection(sections, SESSION_MODEL_HEADING, model),
      env,
    );
  }
  return model.toLowerCase();
}

function extensionOf(filePath) {
  const m = /\.[a-z0-9]+$/i.exec(String(filePath || ""));
  return m ? m[0].toLowerCase() : "";
}

function checkRead(event, cfg, env) {
  const filePath = event.tool_input && event.tool_input.file_path;
  if (typeof filePath !== "string" || !filePath) return null;
  if (!cfg.readExtensions.includes(extensionOf(filePath))) return null;
  const model = resolveSessionModel(event, env);
  if (!model) return null; // no note recorded anywhere -> no guard
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
      if (size <= (rule.limitBytes || Infinity)) continue;
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
      denyMessage = checkRead(event, cfg, env);
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
