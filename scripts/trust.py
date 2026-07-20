"""Trust derivation — rolling canary/grade pass^k per subject (fleet-arc Wave B).

A PURE projection over `ledgers/grades/**`: for every (subject, project,
task_type, tier) key it computes the rolling pass^k over the promotion WINDOW
and the current streak, then writes a derived `dashboards/trust.md`. It NEVER
mutates promotion state — `promotion.decide()` remains the single authority on
autonomy. Trust here only *reports* the same evidence the promotion loop keys
off, so a human (and, later, the dispatcher) can see regressions at a glance.

Window/bar/floor come from `promotion` (imported, never copied) so this stays in
lockstep with the risk-tier law: `promotion._TIERS`, `_below_bar`, `_below_floor`.

`--check-regressions`: any subject whose latest run fell below its tier floor is
a demote candidate — printed, exit 1. Emitting the wake-me / cadence-pause on
that signal is the DISPATCHER's job (a later wave); this tool only surfaces it.

CLI runs `preamble.check` first (STOP-file supremacy, constitution).
"""
from __future__ import annotations

import argparse
import datetime
import sys
from collections import defaultdict
from pathlib import Path

import preamble
import promotion


def _passes_bar(row: dict, tier: str) -> bool:
    """A run that counts as a pass toward the window (tier-aware, fail-closed)."""
    if tier in promotion._TIERS:
        return not promotion._below_bar(row, tier)
    return promotion._passed(row.get("pass"))


def _below_floor(row: dict, tier: str) -> bool:
    if tier in promotion._TIERS:
        return promotion._below_floor(row, tier)
    return not promotion._passed(row.get("pass"))


def _capability(task_type) -> str:
    tt = str(task_type or "")
    return tt.split("canary:", 1)[1] if tt.startswith("canary:") else tt


def compute_trust(repo_root, *, write: bool = True) -> list[dict]:
    """Derive one trust row per grade key. Reads `ledgers/grades/**` via
    `promotion.read_grades`. Writes `dashboards/trust.md` when ``write`` (the
    default; the CLI writes, tests can ask for the pure list)."""
    repo_root = Path(repo_root)
    groups: dict[tuple, list] = defaultdict(list)
    for row in promotion.read_grades(repo_root):
        key = (row.get("worker"), row.get("project"),
               row.get("task_type"), row.get("tier"))
        groups[key].append(row)

    rows: list[dict] = []
    for (worker, project, task_type, tier), rlist in groups.items():
        rlist.sort(key=lambda r: str(r.get("ts") or ""))
        cfg = promotion._TIERS.get(tier)
        window = cfg["window"] if cfg else len(rlist)
        window_rows = rlist[-window:] if window else rlist
        runs = len(window_rows)
        passes = sum(1 for r in window_rows if _passes_bar(r, tier))
        # Streak: trailing runs that never dropped below the tier floor.
        streak = 0
        for r in reversed(rlist):
            if _below_floor(r, tier):
                break
            streak += 1
        demote = _below_floor(rlist[-1], tier) if rlist else False
        rows.append({
            "subject": worker,
            "project": project,
            "task_type": task_type,
            "capability": _capability(task_type),
            "tier": tier,
            "runs": runs,
            "passes": passes,
            "pass_hat_k": 1.0 if runs and passes == runs else 0.0,
            "streak": streak,
            "floor_status": "below-floor" if demote else "ok",
            "demote": demote,
        })

    rows.sort(key=lambda d: (str(d["subject"] or ""), str(d["capability"] or ""),
                             str(d["tier"] or "")))
    if write:
        _write_dashboard(repo_root, rows)
    return rows


def check_regressions(repo_root) -> list[dict]:
    """Subjects whose latest run fell below the tier floor (pure; no write)."""
    return [r for r in compute_trust(repo_root, write=False) if r["demote"]]


# --------------------------------------------------------------------------- #
# Wave F delta 2 -- per-(risk-)tier outcome columns for threshold tuning       #
# --------------------------------------------------------------------------- #
#
# Two honest, per-tier rates published alongside the per-subject table:
#   pass rate       -- share of graded runs at/above the tier bar, aggregated
#                      over the whole grade ledger (ledgers/grades/**).
#   escalation rate -- share of queue/ cards at this risk tier that required an
#                      escalation, derived from the `retry_count` frontmatter
#                      counter that dispatch.requeue (Wave F delta 1) writes: a
#                      card with retry_count>0 was escalated at least once.
#
# Keyed by RISK TIER (T1/T2/T3) deliberately: it is the ONE tier dimension both
# data sources actually carry (grade rows carry `tier`; cards carry `risk-tier`),
# it is immutable on a card (unlike the routed `model`, which escalation
# OVERWRITES -- so an initial-model-tier escalation rate is not recoverable), and
# it is exactly the axis promotion._TIERS tunes thresholds on. When a tier has no
# grade rows the pass column renders "n/a"; when no queue card carries retry data
# for a tier the escalation column renders "n/a (no escalation data)" rather than
# inventing a rate (the design's explicit instruction).
_RISK_TIERS = ("T1", "T2", "T3")


def _iter_cards(repo_root: Path):
    """Every parseable card across the whole queue/ tree. Fail-open per card
    (skip an unparseable one) -- this is an advisory projection, like trust itself."""
    import cards  # local import: keep trust a lean projection, avoid load-order coupling

    queue_root = Path(repo_root) / "queue"
    if not queue_root.exists():
        return
    for path in sorted(queue_root.glob("*/*.md")):
        try:
            yield cards.parse(path)
        except Exception:  # noqa: BLE001 -- advisory scan: skip an unparseable card
            continue


def _card_retry_count(meta: dict) -> int:
    # Floor-clamped like dispatch._retry_count: negative values never count.
    try:
        return max(0, int(meta.get("retry_count") or 0))
    except (TypeError, ValueError):
        return 0


def compute_tier_outcomes(repo_root) -> list[dict]:
    """One outcome row per risk tier (T1/T2/T3). Pure read: grade ledger for the
    pass rate, queue/ cards' `retry_count` for the escalation rate. `pass_rate` /
    `escalation_rate` are None when their source has no rows for that tier (the
    dashboard renders those as "n/a")."""
    repo_root = Path(repo_root)
    grade_runs: dict[str, int] = defaultdict(int)
    grade_passes: dict[str, int] = defaultdict(int)
    for row in promotion.read_grades(repo_root):
        tier = row.get("tier")
        if tier not in _RISK_TIERS:
            continue
        grade_runs[tier] += 1
        if _passes_bar(row, tier):
            grade_passes[tier] += 1

    card_total: dict[str, int] = defaultdict(int)
    card_escalated: dict[str, int] = defaultdict(int)
    for card in _iter_cards(repo_root):
        tier = card.meta.get("risk-tier")
        if tier not in _RISK_TIERS:
            continue
        card_total[tier] += 1
        if _card_retry_count(card.meta) > 0:
            card_escalated[tier] += 1

    rows: list[dict] = []
    for tier in _RISK_TIERS:
        runs = grade_runs[tier]
        passes = grade_passes[tier]
        total = card_total[tier]
        escalated = card_escalated[tier]
        rows.append({
            "tier": tier,
            "grade_runs": runs,
            "grade_passes": passes,
            "pass_rate": (passes / runs) if runs else None,
            "cards": total,
            "escalated": escalated,
            "escalation_rate": (escalated / total) if total else None,
        })
    return rows


def _fmt_rate(rate, passes: int, total: int, na_text: str) -> str:
    """A rate cell: "<pct>% (num/den)" when derivable, else `na_text`."""
    if rate is None:
        return na_text
    return f"{rate * 100:.0f}% ({passes}/{total})"


def _render(rows: list[dict], outcomes: list[dict] | None = None) -> str:
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    out = [
        "# Trust — derived from ledgers/grades",
        "",
        "> Generated by `scripts/trust.py` — DO NOT EDIT. A pure projection of the",
        "> grade ledger; `promotion.decide()` remains the sole authority on autonomy.",
        "",
        f"generated: {ts}",
        "",
        "| subject | capability | tier | window pass^k | streak | floor | demote |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        pk = f"{r['pass_hat_k']:.0f} ({r['passes']}/{r['runs']})"
        demote = "DEMOTE" if r["demote"] else ""
        out.append(
            f"| {r['subject']} | {r['capability']} | {r['tier']} | {pk} "
            f"| {r['streak']} | {r['floor_status']} | {demote} |")
    if not rows:
        out.append("| _(no grade rows yet)_ | | | | | | |")
    out.append("")

    # Wave F delta 2 -- per-(risk-)tier outcome columns for threshold tuning.
    out += [
        "## Per-tier outcomes",
        "",
        "> Pass rate: share of graded runs at/above the tier bar (ledgers/grades).",
        "> Escalation rate: share of queue/ cards at this risk tier that required an",
        "> escalation (`retry_count` > 0, the Wave F requeue counter). \"n/a (no",
        "> escalation data)\" = no queue card carries retry data for this tier yet.",
        "",
        "| tier | pass rate | escalation rate |",
        "|---|---|---|",
    ]
    for o in (outcomes or []):
        pass_cell = _fmt_rate(o["pass_rate"], o["grade_passes"], o["grade_runs"], "n/a")
        esc_cell = _fmt_rate(o["escalation_rate"], o["escalated"], o["cards"],
                             "n/a (no escalation data)")
        out.append(f"| {o['tier']} | {pass_cell} | {esc_cell} |")
    if not outcomes:
        out.append("| _(no tier data yet)_ | | |")
    out.append("")
    return "\n".join(out)


def _write_dashboard(repo_root: Path, rows: list[dict]) -> Path:
    dash = Path(repo_root) / "dashboards"
    dash.mkdir(parents=True, exist_ok=True)
    path = dash / "trust.md"
    outcomes = compute_tier_outcomes(repo_root)
    path.write_text(_render(rows, outcomes), encoding="utf-8")
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="trust derivation (Wave B)")
    ap.add_argument("--repo", default=".", help="repo root")
    ap.add_argument("--check-regressions", action="store_true",
                    help="exit 1 (and list) if any subject fell below its tier floor")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).resolve()
    try:
        import ledger
        cost_fn = ledger.cost_today
    except ImportError:
        cost_fn = None
    problems = preamble.check(repo_root, cost_today_fn=cost_fn)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return 2

    if args.check_regressions:
        demoted = check_regressions(repo_root)
        if demoted:
            print(f"REGRESSIONS: {len(demoted)} subject(s) below floor:")
            for r in demoted:
                print(f"  DEMOTE {r['subject']} / {r['capability']} ({r['tier']}) "
                      f"streak={r['streak']}")
            return 1
        print("trust: no regressions")
        return 0

    path = _write_dashboard(repo_root, compute_trust(repo_root, write=False))
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
