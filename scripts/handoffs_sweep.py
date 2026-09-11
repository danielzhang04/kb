"""Flag stale/superseded/dead-Load handoffs for a human to delete on ops.

Read-only, always. `--delete` only PRINTS the `git rm handoffs/<file>` lines a boss runs by hand
on the ops branch (CLAUDE.md's coordination-write flow: pull --rebase origin ops, write, push) --
this script never deletes, never writes, never touches git state.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STALE_DAYS = 14
GIT_TIMEOUT_S = 10
FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9]+)-.+\.md$")
# Prefix-tolerant: real handoffs write "## Load list (in order)" and the exact-match regex
# this replaces matched none of them -- every such handoff was silently treated as having NO
# Load list at all, so its dead paths were never flagged. The `\b` after Load keeps
# "## Loading notes" out; `.*$` consumes the rest of the heading LINE only, so `m.end()`
# still lands at the newline and the section body starts exactly where it always did.
LOAD_HEADING_RE = re.compile(r"^##\s+Load(?:\s+list)?\b.*$", re.MULTILINE | re.IGNORECASE)
NEXT_HEADING_RE = re.compile(r"^##\s+", re.MULTILINE)
BACKTICK_PATH_RE = re.compile(r"`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`")


@dataclass
class Handoff:
    filename: str
    handoff_date: date | None
    scope: str | None
    text: str


def _git(root: Path, *args: str, input_text: str | None = None) -> subprocess.CompletedProcess | None:
    """Run git, decoding output as UTF-8 (never the OS locale codepage -- on Windows that's
    often cp1252, which mangles non-ASCII handoff content and raises UnicodeDecodeError on byte
    sequences cp1252 has no mapping for). Returns None if git hangs past the timeout, so a caller
    degrades to "unknown" instead of crashing. `input_text`, when given, is piped to stdin --
    used for the batched `cat-file --batch-check` calls."""
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            input=input_text,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=GIT_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return None


def _batch_read_blobs(root: Path, refs: list[str]) -> dict[str, str]:
    """Read blob content for a list of "<ref>:<path>" identifiers in ONE `git cat-file
    --batch` process. Returns {identifier: text} for every identifier that resolved to a
    blob; an identifier that doesn't exist is simply absent from the result.

    Runs in raw bytes (not text) mode and slices each object's content by its reported
    byte `<size>` rather than scanning for a text-mode line boundary -- `--batch`'s
    success records are `<sha> SP <type> SP <size> LF <content> LF`, and content can itself
    contain newlines or non-UTF-8 byte sequences, so a line-oriented text-mode read would
    misparse it. `--batch` answers one record per input line, in the SAME order as the
    input, so records are correlated to `refs` positionally rather than by re-parsing an
    echoed identifier (which `--batch` only echoes back on a "missing" record, not on a
    successful one).

    A missing record is `<verbatim identifier> SP missing` -- and the identifier can
    itself contain spaces (e.g. a handoffs filename with a space in it), so "missing" is
    detected by a SUFFIX check before any space-based split, never by counting
    space-separated fields."""
    if not refs:
        return {}
    stdin_data = ("\n".join(refs) + "\n").encode("utf-8")
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "cat-file", "--batch"],
            input=stdin_data,
            capture_output=True,
            timeout=GIT_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return {}
    if result.returncode != 0:
        return {}

    out: dict[str, str] = {}
    data = result.stdout
    pos = 0
    n = len(data)
    for ref in refs:
        eol = data.find(b"\n", pos)
        if eol == -1:
            break  # truncated/unexpected stream -- stop parsing defensively
        header = data[pos:eol].decode("ascii", errors="replace")
        pos = eol + 1
        if header.endswith(" missing"):
            continue  # this ref doesn't exist -- leave it out of `out` (checked as a
            # suffix, BEFORE any split, since the identifier itself can contain spaces)
        # Only the last two space-separated fields are guaranteed to be <type> and <size>
        # -- the sha is always a fixed-width hex string with no spaces, so this is safe
        # even though we no longer assume exactly 3 fields.
        parts = header.rsplit(" ", 2)
        if len(parts) != 3:
            continue  # malformed header for this ONE record -- skip just it, fail soft
        _sha, _type, size_str = parts
        try:
            size = int(size_str)
        except ValueError:
            continue  # size wasn't numeric -- also malformed, skip just this record
        content = data[pos:pos + size]
        pos += size
        if data[pos:pos + 1] == b"\n":
            pos += 1  # the single LF git appends after every object's content
        out[ref] = content.decode("utf-8", errors="replace")
    return out


def _batch_check_exists(root: Path, ref: str, paths: list[str]) -> dict[str, bool]:
    """One `git cat-file --batch-check` process answers "does `<ref>:<path>` exist" for
    every path at once. Returns {path: bool}; a git failure or timeout maps every path to
    False (degrades to "not found" on that ref, same posture as a single failed
    `cat-file -e` used to). `--batch-check` answers one line per input line, in order, so
    lines are correlated to `paths` positionally (its success line reports the resolved
    sha, not the input path, so positional correlation is required either way)."""
    if not paths:
        return {}
    stdin_data = "".join(f"{ref}:{p}\n" for p in paths)
    result = _git(root, "cat-file", "--batch-check", input_text=stdin_data)
    if result is None or result.returncode != 0:
        return {p: False for p in paths}
    lines = result.stdout.splitlines()
    out: dict[str, bool] = {}
    for p, line in zip(paths, lines):
        out[p] = not line.endswith(" missing")
    for p in paths[len(lines):]:
        out[p] = False  # fewer output lines than inputs -- treat the rest as not found
    return out


def _parse_date(value: str) -> date | None:
    """A calendar-shaped string that is not a real date (2026-13-45 -- a typo, or a handoff
    filename whose leading digits only LOOK like one) is "no date", never a traceback. This
    script's whole job is to be safely runnable on whatever is sitting in handoffs/, and it is
    spawned by the SessionStart hook, so a crash here is a crash in front of a user's keystroke."""
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _now(env: dict) -> date | None:
    override = (env.get("KB_HANDOFFS_NOW") or "").strip()
    if override:
        return _parse_date(override)  # unparseable override -> no age checks, not a crash
    return datetime.now(timezone.utc).date()


def _ops_handoff_names(root: Path) -> set[str]:
    result = _git(root, "ls-tree", "--name-only", "origin/ops:handoffs")
    if result is None or result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip().endswith(".md")}


def _local_handoff_names(root: Path) -> set[str]:
    d = root / "handoffs"
    if not d.is_dir():
        return set()
    return {p.name for p in d.glob("*.md")}


def _read_handoff_text(root: Path, filename: str, ops_blobs: dict[str, str]) -> str:
    """Local disk wins (see fix round 1: a checked-out, possibly-uncommitted local copy is
    truth over the ops ref). `ops_blobs` is the already-fetched result of one batched
    `_batch_read_blobs` call -- no per-file git process happens here."""
    local = root / "handoffs" / filename
    if local.is_file():
        try:
            return local.read_text(encoding="utf-8")
        except OSError:
            return ""
    return ops_blobs.get(f"origin/ops:handoffs/{filename}", "")


def collect_handoffs(root: Path) -> list[Handoff]:
    ops_names = _ops_handoff_names(root)  # 1 process: ls-tree
    local_names = _local_handoff_names(root)
    names = sorted((ops_names | local_names) - {"README.md"})

    # Batch-read every ops-listed handoff's content in ONE process, regardless of whether
    # the local checkout also has a copy (the local copy wins in _read_handoff_text either
    # way -- fetching the ops blob unconditionally keeps this a single call instead of
    # branching per file).
    ops_refs = [f"origin/ops:handoffs/{name}" for name in sorted(ops_names)]
    ops_blobs = _batch_read_blobs(root, ops_refs)  # 1 process: cat-file --batch

    out = []
    for name in names:
        m = FILENAME_RE.match(name)
        handoff_date = _parse_date(m.group(1)) if m else None
        scope = m.group(2) if m else None
        text = _read_handoff_text(root, name, ops_blobs)
        out.append(Handoff(filename=name, handoff_date=handoff_date, scope=scope, text=text))
    return out


def _load_paths(text: str) -> list[str]:
    m = LOAD_HEADING_RE.search(text)
    if not m:
        return []
    rest = text[m.end():]
    nxt = NEXT_HEADING_RE.search(rest)
    body = rest[: nxt.start()] if nxt else rest
    return BACKTICK_PATH_RE.findall(body)


def flag(root: Path, handoffs: list[Handoff], today: date | None) -> list[dict]:
    """`today` is None when KB_HANDOFFS_NOW was set to something unparseable: age checks are then
    skipped entirely, while the scope/supersession and dead-Load-path checks still run."""
    by_scope: dict[str, list[Handoff]] = {}
    for h in handoffs:
        if h.scope:
            by_scope.setdefault(h.scope, []).append(h)

    # STRICT: a Load path is real only if it exists on origin/ops or origin/main. No
    # working-tree fallback -- a path that exists only locally (uncommitted, or committed
    # to a work branch that never reached ops/main) is dead. Every distinct Load path
    # across EVERY handoff is checked against EACH ref in exactly one batched process (2
    # processes total for this whole run), instead of one `cat-file -e` process per
    # path per ref.
    load_paths_by_file: dict[str, list[str]] = {h.filename: _load_paths(h.text) for h in handoffs}
    distinct_paths = sorted({p for paths in load_paths_by_file.values() for p in paths})
    exists_on_ops = _batch_check_exists(root, "origin/ops", distinct_paths)
    exists_on_main = _batch_check_exists(root, "origin/main", distinct_paths)
    path_is_live = {p: exists_on_ops.get(p, False) or exists_on_main.get(p, False) for p in distinct_paths}

    flags: list[dict] = []
    for h in handoffs:
        reasons: list[str] = []
        if today is not None and h.handoff_date is not None:
            age_days = (today - h.handoff_date).days
            if age_days > STALE_DAYS:
                reasons.append(f"{age_days} days old (> {STALE_DAYS})")
        if h.scope and h.handoff_date:
            newer = [
                o for o in by_scope[h.scope]
                if o.filename != h.filename and o.handoff_date and o.handoff_date > h.handoff_date
            ]
            if newer:
                latest = sorted(newer, key=lambda o: o.handoff_date)[-1]
                reasons.append(f"superseded by {latest.filename}")
        dead = [p for p in load_paths_by_file[h.filename] if not path_is_live.get(p, False)]
        if dead:
            reasons.append("dead Load path(s): " + ", ".join(dead))
        if reasons:
            flags.append({"file": h.filename, "reasons": reasons, "reason": "; ".join(reasons)})
    return flags


def render_table(flags: list[dict]) -> str:
    if not flags:
        return "No flagged handoffs."
    width = max(len(f["file"]) for f in flags)
    return "\n".join(f["file"].ljust(width) + "  " + f["reason"] for f in flags)


def render_delete(flags: list[dict]) -> str:
    return "\n".join(f"git rm handoffs/{f['file']}" for f in flags)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(REPO_ROOT))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--delete", action="store_true")
    args = parser.parse_args(argv)

    root = Path(args.root)
    today = _now(os.environ)
    handoffs = collect_handoffs(root)
    flags = flag(root, handoffs, today)

    if args.json:
        print(json.dumps(flags))
    elif args.delete:
        print(render_delete(flags))
    else:
        print(render_table(flags))
    return 0


if __name__ == "__main__":
    sys.exit(main())
