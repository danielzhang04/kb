#!/usr/bin/env node
/*
 * kb model-verify SubagentStop hook — INERT (not wired into any settings file).
 *
 * Purpose:
 *   Close the loop its PreToolUse sibling opens. That hook records which model a dispatch ASKED for;
 *   this one reads the finished subagent's own transcript and records which model actually RAN, then
 *   writes both into one audit row. This is BOSS.md's grading rule — grep the subagent transcript for
 *   `"model":`, never trust the dispatch argument — performed automatically instead of by hand.
 *
 * Status:
 *   INERT. Nothing in .claude/settings*.json references this file. Arming snippet and decision-notes:
 *   docs/proposals/spawn-model-verify-hooks.md.
 *
 * ── WHICH TRANSCRIPT (verified against the installed harness) ───────────────────────────────────
 * The SubagentStop payload carries BOTH `transcript_path` (the parent session's, from the common
 * field builder) and `agent_transcript_path` (the subagent's own). Only the latter answers "what did
 * the child run on", so it is preferred and `transcript_path` is the fallback. `agent_id` and
 * `agent_type` are REQUIRED on this event (unlike the base schema, where they are optional) — checked
 * in Claude Code 2.1.234's embedded SubagentStop schema; evidence in the proposal.
 *
 * ── PAIRING IS BEST-EFFORT, AND THE ROW SAYS SO ─────────────────────────────────────────────────
 * There is no dispatch id shared between the PreToolUse row and this event: a top-level dispatch (Agent/Task) call
 * carries no `agent_id`, so the two rows can only be matched on `session_id` + (`subagent_type` ==
 * `agent_type`), taking the most recent match. With one dispatch of a given agent type in flight that
 * is exact; with several concurrent dispatches of the SAME type in the SAME session it can pair the
 * wrong two. The row therefore records `pairing: "heuristic"` whenever a requested model was found
 * this way, so a mismatch is read as "look at this", never as proof on its own.
 *
 * Contract:
 *   - Reads env: KB_MODEL_AUDIT_PATH, KB_CONTEXT_STORE_DIR (default log root).
 *   - Reads stdin JSON ({hook_event_name, session_id, agent_id, agent_type, agent_transcript_path,
 *     transcript_path, ...}).
 *   - ALWAYS emits "{}" and exits 0, stderr always empty. Missing/unreadable/oversized transcript,
 *     no model strings in it, unwritable log, any thrown error: no-op, no row.
 *   - Reads the transcript ONLY for model ids — no message content is read or logged. The verdict is
 *     computed from the FIRST assistant record's `message.model`; the raw-text distinct-model list is
 *     supplementary row data only (see the note above `firstRespondingModel`).
 *   - No subprocess, no network, no clock.
 */
"use strict";

const io = require("./lib/hook_io.js");
const audit = require("./lib/model_audit.js");

/**
 * THE PRIMARY OBSERVATION: the model that answered FIRST.
 *
 * BOSS.md's rule is about which model actually served the subagent's turns, and the first assistant
 * response is what settles that. So the primary value is read STRUCTURALLY — parse each JSONL record,
 * take `message.model` off the first record whose `type` is `"assistant"` — rather than off the raw
 * text. Confirmed against real transcripts on this machine: assistant records carry the id at
 * `message.model` and nowhere else at top level.
 *
 * WHY NOT THE RAW GREP FOR THIS. A regex over the whole file also matches `"model":` strings that are
 * merely CONTENT — a transcript that read a settings file, quoted a routing YAML, or discussed a model
 * id will contain them, and any of those can precede the real first response. Good enough to enumerate
 * what a transcript mentions; not good enough to attest what ran.
 *
 * Returns null when no assistant record carries a model.
 */
function firstRespondingModel(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch (_err) {
      continue; // a partial trailing line is normal on a live transcript
    }
    if (!record || typeof record !== "object" || record.type !== "assistant") continue;
    const message = record.message;
    const model = message && typeof message === "object" ? message.model : undefined;
    if (typeof model === "string" && model.trim()) {
      return model.trim();
    }
  }
  return null;
}

/**
 * SUPPLEMENTARY: every distinct `"model": "<value>"` anywhere in the transcript, in first-seen order.
 *
 * This is the literal BOSS.md grep, kept because it catches a model switch mid-run that the first
 * response cannot show. It is explicitly NOT the verdict input — see the caveat above about quoted
 * model strings in file contents. The charset is deliberately narrow (model ids only) so no prose can
 * match.
 */
function observedModels(text) {
  const seen = [];
  const re = /"model"\s*:\s*"([A-Za-z0-9._\-[\]]{1,80})"/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (seen.indexOf(match[1]) === -1) {
      seen.push(match[1]);
      if (seen.length >= 8) break; // a transcript with 8 distinct models has told us all we need
    }
  }
  return seen;
}

/** The most recent PreToolUse row plausibly describing this subagent — see the pairing note above. */
function requestedFor(sessionId, agentType) {
  const rows = audit.readRows();
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.event !== "PreToolUse") continue;
    if (sessionId && row.session_id && row.session_id !== sessionId) continue;
    if (agentType && row.subagent_type && row.subagent_type !== agentType) continue;
    if (typeof row.requested_model === "string" && row.requested_model) {
      return row.requested_model;
    }
  }
  return null;
}

/**
 * Did the run match the ask? Computed against the FIRST RESPONDING model only — the supplementary
 * distinct-model list never produces a verdict, because a quoted model id in file content would
 * otherwise be able to manufacture a `match`.
 *
 *   'match'      — the first responding model contains the requested name. Substring, because a
 *                  dispatch names an ALIAS ("opus") while a transcript records a full id
 *                  ("claude-opus-5[1m]"), and the alias is a substring of its own target throughout
 *                  governance/model-routing.yaml.
 *   'mismatch'   — a requested model was known and the first responding model is not it.
 *   'unverified' — one half is missing (no requested model paired, or no assistant record carried a
 *                  model). Nothing can be concluded, and the row claims nothing.
 */
function compare(requested, observedModel) {
  if (!requested || !observedModel) {
    return "unverified";
  }
  return observedModel === requested || observedModel.indexOf(requested) !== -1 ? "match" : "mismatch";
}

function main() {
  // Empty/closed stdin, malformed JSON, or a payload naming a different event all no-op inside this
  // call ("{}", exit 0).
  const event = io.readEventFor("SubagentStop");

  // The subagent's OWN transcript first; the parent's only as a fallback (see the header).
  const transcriptPath =
    typeof event.agent_transcript_path === "string" && event.agent_transcript_path
      ? event.agent_transcript_path
      : event.transcript_path;
  if (typeof transcriptPath !== "string" || !transcriptPath) {
    io.noop();
  }

  // Missing, unreadable, or absurdly large transcript -> null -> no row. The size cap and the guarded
  // read live in lib/hook_io.js, shared with the PreCompact hook.
  const text = io.readCappedFile(transcriptPath);
  if (text === null) {
    io.noop();
  }

  const observedModel = firstRespondingModel(text);
  const observed = observedModels(text);
  if (!observedModel && observed.length === 0) {
    io.noop(); // nothing to attest -> write nothing rather than an empty claim
  }

  const sessionId = typeof event.session_id === "string" ? event.session_id : null;
  const agentType = typeof event.agent_type === "string" ? event.agent_type : null;
  const requested = requestedFor(sessionId, agentType);

  audit.appendRow({
    event: "SubagentStop",
    session_id: sessionId,
    agent_id: typeof event.agent_id === "string" ? event.agent_id : null,
    agent_type: agentType,
    requested_model: requested,
    // The verdict input: the model that answered first, read off an assistant record.
    observed_model: observedModel,
    // Supplementary only — every model id the transcript MENTIONS, which is not the same claim.
    observed_models: observed,
    pairing: requested ? "heuristic" : "none",
    verdict: compare(requested, observedModel),
  });

  io.noop();
}

// Belt and braces: this hook never breaks a subagent's completion — any escaped throw becomes "{}".
io.run(main);
