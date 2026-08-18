"""Deterministic per-agent track record rolled up from the grades ledger.

Read-only. This script computes the evidence table Loop C
(``docs/proposals/loops/prompt-loop-c.md``) writes its upgrade proposals against, so the
model no longer selects its own evidence: it runs this, and writes prose over the output.

Trust semantics are not reimplemented here — they are DELEGATED to ``scripts/promotion.py``
so the two can never drift:

* ``promotion.trusted_grades`` (promotion.py:213-219) keeps only rows whose ``inspector_id``
  is allow-listed by ``promotion.allowed_graders`` (promotion.py:181-211), which fails closed
  to the empty set when ``governance/graders.yaml`` is absent, unreadable, or malformed. An
  empty allow-list therefore yields an EMPTY table, never an unfiltered one.
* ``promotion.read_grades`` (promotion.py:161-174) is the shard reader; the ``FROZEN``
  sentinel has no ``.tsv`` suffix and is skipped by its glob.
* ``promotion._passed`` (promotion.py:85-90) and ``promotion._score`` (promotion.py:78-82)
  are the fail-closed coercers for the TSV's string columns.
* ``promotion._below_floor`` (promotion.py:97-104) and ``promotion._TIERS``
  (promotion.py:61-65) define what resets a streak; ``streak`` below accumulates exactly as
  ``promotion._streak_is_autonomous`` (promotion.py:119-133) does.

Grouping key is ``(agent, project, task_type, tier)`` — the same key
``promotion._row_key`` (promotion.py:93-94) uses. ``project`` is carried as its own column
rather than collapsed: two projects can share a task_type, and merging them would report a
streak no promotion decision would ever agree with.

Usage:
    py -3 scripts/agent_track_record.py [--root .] [--format markdown|json] [--out PATH]

Without ``--out`` it writes nothing at all; the report goes to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import promotion  # noqa: E402

COLUMNS = ("agent", "project", "task_type", "tier", "runs", "passes", "streak",
           "failure_patterns")

# Failure reason codes. Deterministic and closed: the grades TSV carries no free-text
# failure column, so a "pattern" is the reason a row did not count, never a paraphrase.
FAILED = "failed"
MALFORMED_SCORE = "malformed-score"
UNKNOWN_TIER = "unknown-tier"
BELOW_BAR = "below-bar<{bar}>"


def _failure_code(row: dict, tier: str) -> str | None:
    """The reason this row is a failure, or None if it is a clean pass.

    Mirrors ``promotion._below_bar`` (promotion.py:107-116): a failed run never counts
    regardless of score, and a malformed score is a failure (fail closed).
    """
    if not promotion._passed(row.get("pass")):
        return FAILED
    score = promotion._score(row.get("score"))
    if score is None:
        return MALFORMED_SCORE
    cfg = promotion._TIERS.get(tier)
    if cfg is None:
        return UNKNOWN_TIER
    bar = cfg["bar"]
    return BELOW_BAR.format(bar=bar) if score < bar else None


def _streak(rows: list[dict], tier: str) -> int:
    """Length of the current (trailing) streak, accumulated exactly as
    ``promotion._streak_is_autonomous`` does: a below-floor row resets the counter.

    An unknown tier has no floor definition, so it cannot be evaluated -> 0 (fail closed).
    """
    if tier not in promotion._TIERS:
        return 0
    streak = 0
    for row in rows:
        if promotion._below_floor(row, tier):
            streak = 0
        else:
            streak += 1
    return streak


def rollup(repo_root) -> list[dict]:
    """The evidence table: one row per (agent, project, task_type, tier).

    Rows are ordered by the grouping key so two runs over the same ledger produce
    byte-identical output.
    """
    groups: dict[tuple, list[dict]] = {}
    for row in promotion.trusted_grades(repo_root):
        key = promotion._row_key(row)          # (worker, project, task_type, tier)
        groups.setdefault(key, []).append(row)

    table: list[dict] = []
    for key in sorted(groups, key=lambda k: tuple("" if part is None else str(part) for part in k)):
        agent, project, task_type, tier = key
        # Sorted by ts, the same ordering promotion.status applies before walking the
        # streak; the ledger writes sortable ISO timestamps.
        rows = sorted(groups[key], key=lambda r: str(r.get("ts") or ""))
        patterns: dict[str, int] = {}
        passes = 0
        for row in rows:
            code = _failure_code(row, tier)
            if code is None:
                passes += 1
            else:
                patterns[code] = patterns.get(code, 0) + 1
        table.append({
            "agent": agent,
            "project": project,
            "task_type": task_type,
            "tier": tier,
            "runs": len(rows),
            "passes": passes,
            "streak": _streak(rows, tier),
            "failure_patterns": [
                {"pattern": code, "count": patterns[code]} for code in sorted(patterns)
            ],
        })
    return table


def _patterns_cell(patterns: list[dict]) -> str:
    return "; ".join(f"{p['pattern']} x{p['count']}" for p in patterns) or "-"


def render_markdown(table: list[dict]) -> str:
    lines = [
        "# Agent track record",
        "",
        "Trust-filtered per governance/graders.yaml. Generated by scripts/agent_track_record.py.",
        "",
        "| " + " | ".join(COLUMNS) + " |",
        "|" + "|".join(["---"] * len(COLUMNS)) + "|",
    ]
    if not table:
        lines.append("| (no trusted grade rows) |" + " |" * (len(COLUMNS) - 1))
    for entry in table:
        cells = [str(entry[column]) for column in COLUMNS[:-1]]
        cells.append(_patterns_cell(entry["failure_patterns"]))
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    return "\n".join(lines)


def render_json(table: list[dict]) -> str:
    return json.dumps(table, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="repository root to read")
    parser.add_argument("--format", default="markdown", choices=("markdown", "json"))
    parser.add_argument("--out", default=None,
                        help="write the report here (default: stdout, writing nothing)")
    args = parser.parse_args(argv)

    table = rollup(Path(args.root))
    text = render_json(table) if args.format == "json" else render_markdown(table)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
