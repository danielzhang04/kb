#!/usr/bin/env python3
"""
analyze_tokens.py -- diagnose Claude Code + Codex subscription token burn,
2026-09-06 .. 2026-09-11, on this machine.

Read-only against ~/.claude/projects, ~/.codex/sessions, kb ledgers, cco data.
Writes ONLY into this scratchpad dir (REPORT.md, analysis_data.json, this script).

Run: py -3 analyze_tokens.py
"""
import os, sys, json, glob, time
from collections import defaultdict
from datetime import datetime, timezone

HOME = r"C:\Users\danie"
CLAUDE_PROJECTS_DIR = os.path.join(HOME, ".claude", "projects")
CODEX_SESSIONS_DIR = os.path.join(HOME, ".codex", "sessions")
KB_LEDGERS_DIR = os.path.join(HOME, "kb", "ledgers")
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

WINDOW_START = datetime(2026, 9, 6, tzinfo=timezone.utc)
WINDOW_END_EXCL = datetime(2026, 9, 12, tzinfo=timezone.utc)  # covers through 09-11 23:59:59
DAYS = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]

def in_window_ts(epoch_seconds):
    dt = datetime.fromtimestamp(epoch_seconds, tz=timezone.utc)
    return WINDOW_START <= dt < WINDOW_END_EXCL

# ---------------------------------------------------------------------------
# Pricing (per 1,000,000 tokens). STATED ASSUMPTIONS -- see REPORT.md Schema notes.
# Anthropic public list prices (input, output) as of this assistant's knowledge
# (Jan 2026 cutoff): Opus 15/75, Sonnet 3/15, Haiku 0.80/4.
# "Fable" is not a publicly priced model at that cutoff -- treated as the
# flagship/Opus-priced tier (ASSUMPTION, flagged).
# cache-read = 10% of input price; cache-creation = 125% of input price
# (both given directly in the task instructions, not assumed).
CLAUDE_PRICING = {
    "opus":    (15.00, 75.00),
    "sonnet":  (3.00, 15.00),
    "haiku":   (0.80, 4.00),
    "fable":   (15.00, 75.00),   # ASSUMPTION: no public price for Fable; Opus-tier used
    "default": (3.00, 15.00),
}
CACHE_READ_MULT = 0.10
CACHE_CREATE_MULT = 1.25

# Codex/OpenAI: gpt-5.x/gpt-6.x "astra/terra/sol" names are not real priced
# models at this assistant's knowledge cutoff. ASSUMPTION: single flat rate,
# GPT-5-class list-price analog (input 1.25, output 10.00 per 1M), cached
# input at OpenAI's disclosed ~50% cached-input discount. Flagged in report.
CODEX_INPUT_PRICE = 1.25
CODEX_OUTPUT_PRICE = 10.00
CODEX_CACHE_MULT = 0.50

def classify_claude_model(model_name):
    m = (model_name or "").lower()
    if "opus" in m:
        return "opus"
    if "haiku" in m:
        return "haiku"
    if "fable" in m:
        return "fable"
    if "sonnet" in m:
        return "sonnet"
    return "default"

def claude_cost(model_class, input_tok, cache_create_tok, cache_read_tok, output_tok):
    in_p, out_p = CLAUDE_PRICING.get(model_class, CLAUDE_PRICING["default"])
    cost = 0.0
    cost += (input_tok / 1e6) * in_p
    cost += (cache_create_tok / 1e6) * in_p * CACHE_CREATE_MULT
    cost += (cache_read_tok / 1e6) * in_p * CACHE_READ_MULT
    cost += (output_tok / 1e6) * out_p
    return cost

def codex_cost(input_tok, cached_tok, output_tok):
    # cached_tok is a SUBSET of input_tok in Codex's schema (input_tokens includes cached)
    uncached = max(0, input_tok - cached_tok)
    cost = (uncached / 1e6) * CODEX_INPUT_PRICE
    cost += (cached_tok / 1e6) * CODEX_INPUT_PRICE * CODEX_CACHE_MULT
    cost += (output_tok / 1e6) * CODEX_OUTPUT_PRICE
    return cost

# ---------------------------------------------------------------------------
# Enumerate Claude Code files
# ---------------------------------------------------------------------------
def enumerate_claude_files():
    files = []
    scanned = {}  # project -> (total_jsonl_seen, in_window_count)
    if not os.path.isdir(CLAUDE_PROJECTS_DIR):
        return files, scanned
    for proj in sorted(os.listdir(CLAUDE_PROJECTS_DIR)):
        pdir = os.path.join(CLAUDE_PROJECTS_DIR, proj)
        if not os.path.isdir(pdir):
            continue
        total = 0
        window = 0
        try:
            entries = os.listdir(pdir)
        except OSError:
            scanned[proj] = (0, 0)
            continue
        for entry in entries:
            full = os.path.join(pdir, entry)
            if entry.endswith(".jsonl") and os.path.isfile(full):
                total += 1
                try:
                    mt = os.path.getmtime(full)
                except OSError:
                    continue
                if in_window_ts(mt):
                    window += 1
                    files.append({
                        "path": full, "project": proj, "kind": "top",
                        "session_id": entry[:-6], "mtime": mt,
                    })
            elif os.path.isdir(full):
                sub = os.path.join(full, "subagents")
                if os.path.isdir(sub):
                    try:
                        sub_entries = os.listdir(sub)
                    except OSError:
                        sub_entries = []
                    for sf in sub_entries:
                        if sf.endswith(".jsonl"):
                            sfull = os.path.join(sub, sf)
                            total += 1
                            try:
                                mt = os.path.getmtime(sfull)
                            except OSError:
                                continue
                            if in_window_ts(mt):
                                window += 1
                                files.append({
                                    "path": sfull, "project": proj, "kind": "subagent",
                                    "session_id": entry, "agent_id": sf[:-6], "mtime": mt,
                                })
        scanned[proj] = (total, window)
    return files, scanned

# ---------------------------------------------------------------------------
# Process one Claude transcript file (streaming)
# ---------------------------------------------------------------------------
WINDOW_DAYS = set(DAYS)

def process_claude_file(finfo):
    # NOTE: files are selected by mtime >= window start, but a long-running
    # session file (e.g. a multi-week boss/orchestrator terminal) can contain
    # turns from WELL BEFORE the window. Every aggregate below is filtered to
    # turns/tool-results whose own timestamp falls in WINDOW_DAYS, so a file's
    # pre-window history never leaks into "last 5 days" totals.
    path = finfo["path"]
    tool_use_names = {}
    turns = 0
    models = defaultdict(int)          # model_name -> turn count (in-window turns only)
    sums = defaultdict(float)          # input/cache_creation/cache_read/output/thinking (in-window only)
    per_day = defaultdict(lambda: defaultdict(float))  # day -> model_class -> field
    compaction_count = 0
    tool_bytes = defaultdict(int)      # tool_name -> bytes (in-window only)
    top_results = []                   # list of (bytes, tool_name, preview) capped at 5
    ctx_per_turn = []                  # cache_read + input, per assistant turn (in-window only)
    first_ts, last_ts = None, None
    out_of_window_turns = 0
    out_of_window_tool_results = 0

    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return None
    with f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            t = d.get("type")
            ts = d.get("timestamp")
            if ts:
                if first_ts is None:
                    first_ts = ts
                last_ts = ts
            day = ts[:10] if ts else None
            in_window = day in WINDOW_DAYS
            if t == "assistant":
                msg = d.get("message") or {}
                model = msg.get("model")
                content = msg.get("content")
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "tool_use":
                            tool_use_names[c.get("id")] = c.get("name")
                if not in_window:
                    out_of_window_turns += 1
                    continue
                usage = msg.get("usage") or {}
                inp = usage.get("input_tokens", 0) or 0
                cc = usage.get("cache_creation_input_tokens", 0) or 0
                cr = usage.get("cache_read_input_tokens", 0) or 0
                out = usage.get("output_tokens", 0) or 0
                otd = usage.get("output_tokens_details") or {}
                think = otd.get("thinking_tokens", 0) or 0
                turns += 1
                if model:
                    models[model] += 1
                sums["input"] += inp
                sums["cache_creation"] += cc
                sums["cache_read"] += cr
                sums["output"] += out
                sums["thinking"] += think
                ctx_per_turn.append(inp + cr)
                mclass = classify_claude_model(model)
                pd = per_day[(day, mclass)]
                pd["input"] += inp
                pd["cache_creation"] += cc
                pd["cache_read"] += cr
                pd["output"] += out
                pd["turns"] += 1
            elif t == "user":
                if not in_window:
                    msg = d.get("message") or {}
                    content = msg.get("content")
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and c.get("type") == "tool_result":
                                out_of_window_tool_results += 1
                    continue
                if d.get("isCompactSummary"):
                    compaction_count += 1
                msg = d.get("message") or {}
                content = msg.get("content")
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "tool_result":
                            tuid = c.get("tool_use_id")
                            name = tool_use_names.get(tuid, "unknown")
                            cval = c.get("content")
                            sz = len(cval) if isinstance(cval, str) else len(json.dumps(cval, default=str))
                            tool_bytes[name] += sz
                            if len(top_results) < 5 or sz > top_results[-1][0]:
                                preview = (cval if isinstance(cval, str) else json.dumps(cval, default=str))[:80]
                                top_results.append((sz, name, preview))
                                top_results.sort(key=lambda x: -x[0])
                                del top_results[5:]
            elif t == "summary":
                if in_window:
                    compaction_count += 1

    return {
        "finfo": finfo,
        "turns": turns,
        "models": dict(models),
        "sums": dict(sums),
        "per_day": {f"{k[0]}|{k[1]}": dict(v) for k, v in per_day.items()},
        "compaction_count": compaction_count,
        "tool_bytes": dict(tool_bytes),
        "top_results": top_results,
        "ctx_per_turn_avg": (sum(ctx_per_turn) / len(ctx_per_turn)) if ctx_per_turn else 0,
        "ctx_per_turn_max": max(ctx_per_turn) if ctx_per_turn else 0,
        "first_ts": first_ts, "last_ts": last_ts,
        "out_of_window_turns": out_of_window_turns,
        "out_of_window_tool_results": out_of_window_tool_results,
    }

# ---------------------------------------------------------------------------
# Enumerate + process Codex files
# ---------------------------------------------------------------------------
def enumerate_codex_files():
    files = []
    if not os.path.isdir(CODEX_SESSIONS_DIR):
        return files
    for root, dirs, fnames in os.walk(CODEX_SESSIONS_DIR):
        for fn in fnames:
            if fn.endswith(".jsonl"):
                full = os.path.join(root, fn)
                try:
                    mt = os.path.getmtime(full)
                except OSError:
                    continue
                if in_window_ts(mt):
                    files.append({"path": full, "mtime": mt})
    return files

def process_codex_file(finfo):
    path = finfo["path"]
    session_id, cwd, originator, source = None, None, None, None
    model, effort = None, None
    turns = 0
    max_usage = None
    start_ts = None
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return None
    with f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            t = d.get("type")
            if t == "session_meta":
                p = d.get("payload") or {}
                session_id = p.get("session_id") or p.get("id")
                cwd = p.get("cwd") or cwd
                originator = p.get("originator")
                source = p.get("source")
                start_ts = p.get("timestamp") or d.get("timestamp")
            elif t == "turn_context":
                p = d.get("payload") or {}
                model = p.get("model") or model
                effort = p.get("effort") or effort
                cwd = p.get("cwd") or cwd
            elif t == "event_msg":
                p = d.get("payload") or {}
                pt = p.get("type")
                if pt == "task_started":
                    turns += 1
                    m = p.get("model")
                    if m:
                        model = m
                elif pt == "token_count":
                    info = p.get("info") or {}
                    tu = info.get("total_token_usage")
                    if tu:
                        if max_usage is None or (tu.get("total_tokens", 0) or 0) > (max_usage.get("total_tokens", 0) or 0):
                            max_usage = tu
    if max_usage is None:
        max_usage = {"input_tokens": 0, "cached_input_tokens": 0, "cache_write_input_tokens": 0,
                     "output_tokens": 0, "reasoning_output_tokens": 0, "total_tokens": 0}
    dispatched = (originator == "codex_exec")
    day = (start_ts or "")[:10] if start_ts else None
    return {
        "path": path, "session_id": session_id, "cwd": cwd, "originator": originator,
        "source": source, "model": model, "effort": effort, "turns": turns,
        "usage": max_usage, "start_ts": start_ts, "day": day, "dispatched": dispatched,
    }

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    t0 = time.time()
    log = []
    def note(s):
        print(s, flush=True)
        log.append(s)

    note("== Enumerating Claude Code files ==")
    claude_files, scanned = enumerate_claude_files()
    note(f"  {len(claude_files)} in-window claude files across {len(scanned)} project dirs")

    note("== Processing Claude Code files (streaming) ==")
    claude_results = []
    for i, finfo in enumerate(claude_files):
        r = process_claude_file(finfo)
        if r:
            claude_results.append(r)
        if (i + 1) % 25 == 0:
            note(f"  ...{i+1}/{len(claude_files)} claude files done ({time.time()-t0:.0f}s)")
    note(f"  done: {len(claude_results)} claude files processed ({time.time()-t0:.0f}s)")

    note("== Enumerating Codex files ==")
    codex_files = enumerate_codex_files()
    note(f"  {len(codex_files)} in-window codex files")

    note("== Processing Codex files ==")
    codex_results = []
    for i, finfo in enumerate(codex_files):
        r = process_codex_file(finfo)
        if r:
            codex_results.append(r)
        if (i + 1) % 25 == 0:
            note(f"  ...{i+1}/{len(codex_files)} codex files done ({time.time()-t0:.0f}s)")
    note(f"  done: {len(codex_results)} codex files processed ({time.time()-t0:.0f}s)")

    # Dump raw intermediate for downstream report generation
    dump = {
        "scanned_claude_dirs": scanned,
        "claude_results": claude_results,
        "codex_results": codex_results,
        "elapsed_s": time.time() - t0,
    }
    with open(os.path.join(OUT_DIR, "analysis_data.json"), "w", encoding="utf-8") as f:
        json.dump(dump, f)
    note(f"Wrote analysis_data.json ({time.time()-t0:.0f}s total)")

if __name__ == "__main__":
    main()
