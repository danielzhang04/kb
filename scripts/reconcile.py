"""Weekly grades <-> Inspector-activity cross-check (spec Task 3.2, desktop-only).

INTEGRITY-CRITICAL. Fail closed everywhere. This is the standing detector that
catches fabricated grades and buggy/drifting graders, then FREEZES the promotion
loop so nothing auto-promotes on poisoned evidence.

What it proves
--------------
`scripts/grade.py` (3.3) is the single writer of `ledgers/grades/**`; every
`record_grade` call writes a grade row AND a paired `ledgers/activity/` row under
the Inspector identity. On the *desktop* tier the Inspector commits under a
distinct git author (`inspector@agents.local`, 3.8), so a grade row is only
trustworthy when BOTH hold:

1. the git commit that introduced the grade row is authored by the Inspector
   identity (a worker self-grading under its own identity = *wrong grader*), and
2. there is a matching Inspector-authored `activity` row (keyed on ``card_id``)
   proving the grading run actually happened (a lone grade row = *fabricated*).

We attribute each row's introducing commit with the same `git log` pickaxe
machinery `approvals.py` uses (`-S<line>` over the row's exact bytes, scoped to
the ledger path), and we count as evidence ONLY activity rows whose introducing
commit is the Inspector's — non-Inspector activity is never grade evidence.

Any grade row that fails either check is quarantined; if the quarantine is
non-empty the loop FREEZES: `ledgers/grades/FROZEN` is written (with the
quarantine report as its content) and a T1 wake-me card is filed into
`queue/inbox/`.

Sentinel-clear guard
--------------------
The FROZEN sentinel is the live "loop is frozen" flag. If it was ever committed
but is now absent from the working tree, someone cleared it. Clearing an
integrity freeze is a *human* action, so reconcile re-asserts FROZEN + wake-me
UNLESS an **authenticated clear-record** justifies the un-freeze.

Authenticated clear-record (documented fail-closed choice)
----------------------------------------------------------
A file `ledgers/grades/FROZEN.cleared` whose *introducing git commit* is authored
by an allow-listed human email (`governance/humans.yaml` `emails:`, reused via
`approvals._human_emails`) AND whose commit date is not older than the freeze it
clears (no replay of a stale clear against a newer freeze). Absent, unparsable,
non-human-authored, or stale => NOT authenticated => re-assert. In v1 the git
author-email is the trust anchor; upgrading this to the full web-flow *signed*
channel (`approvals.verify_signed_approval`) is month-2+ hardening.

Threat model (honest)
---------------------
v1 catches non-adversarial drift, buggy workers, and a worker self-grading under
its *own* identity. It does NOT stop a malicious worker that fully assumes the
`inspector@agents.local` git identity (author + content) -- real prevention is
the `ledgers/grades/**` push ruleset behind per-agent GitHub identities (3.9,
month-2+). Author cross-check is meaningless in the cloud tier (every commit is
Daniel's identity), so this tool is desktop-pinned.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import sys
from dataclasses import dataclass, field
from pathlib import Path

import approvals
import cards

INSPECTOR_EMAIL = "inspector@agents.local"
INSPECTOR_ID = "inspector"

_SENTINEL = "FROZEN"
_CLEARED = "FROZEN.cleared"
_LOG = "FROZEN.log"


def _now() -> datetime.datetime:
    """UTC now — a seam for deterministic tests."""
    return datetime.datetime.now(datetime.timezone.utc)


@dataclass
class ReconcileResult:
    frozen: bool
    reason: str
    quarantined: list = field(default_factory=list)
    wake_card: Path | None = None
    sentinel: Path | None = None


# --------------------------------------------------------------------------- #
# ledger row iteration (raw line kept for exact-bytes pickaxe attribution)
# --------------------------------------------------------------------------- #

def _shards(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    # Only per-writer day shards (`<agent>-<day>.tsv`); never the sentinel /
    # audit files (FROZEN, FROZEN.cleared, FROZEN.log carry no `.tsv`).
    return sorted(directory.glob("*.tsv"))


def _iter_rows(shard: Path):
    """Yield ``(raw_line, row_dict)`` for each data row of a TSV shard.

    ``raw_line`` is the exact line content (terminator stripped) — a substring of
    the committed blob, so it is a safe fixed-string ``git log -S`` needle for
    attributing the commit that introduced this specific row.
    """
    try:
        text = shard.read_text(encoding="utf-8")
    except OSError:
        return
    lines = text.splitlines()
    if not lines:
        return
    header = next(csv.reader([lines[0]], delimiter="\t"))
    for raw in lines[1:]:
        if not raw.strip():
            continue
        values = next(csv.reader([raw], delimiter="\t"))
        yield raw, dict(zip(header, values))


# --------------------------------------------------------------------------- #
# git attribution (reuses approvals' subprocess/timeout machinery)
# --------------------------------------------------------------------------- #

def _introducing_author(repo_root: Path, needle: str, pathspec: str) -> str | None:
    """Lower-cased author-email of the commit that introduced ``needle`` under
    ``pathspec`` (pickaxe ``-S`` over exact bytes). None if unattributable —
    callers treat None as a failed identity check (fail closed)."""
    if not needle:
        return None
    try:
        res = approvals._run(
            ["git", "log", "--format=%ae", "-S", needle, "--", pathspec],
            cwd=repo_root)
    except (FileNotFoundError, OSError):
        return None
    lines = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]
    if not lines:
        return None
    # Oldest matching commit = the one that added the line (count 0 -> 1).
    return lines[-1].lower()


def _commit_author(repo_root: Path, sha: str) -> str | None:
    try:
        out = approvals._run(["git", "show", "-s", "--format=%ae", str(sha)],
                             cwd=repo_root).stdout.strip()
    except (FileNotFoundError, OSError):
        return None
    return out.lower() or None


def _commit_date(repo_root: Path, sha: str) -> datetime.datetime | None:
    try:
        out = approvals._run(["git", "show", "-s", "--format=%aI", str(sha)],
                             cwd=repo_root).stdout.strip()
    except (FileNotFoundError, OSError):
        return None
    if not out:
        return None
    try:
        return datetime.datetime.fromisoformat(out)
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# grade <-> activity cross-check
# --------------------------------------------------------------------------- #

def _inspector_evidence(repo_root: Path, inspector_email: str) -> set[str]:
    """card_ids covered by an activity row whose introducing commit is the
    Inspector's. Non-Inspector activity is never counted (that is the whole
    point of the desktop author cross-check)."""
    evidence: set[str] = set()
    act_dir = Path(repo_root) / "ledgers" / "activity"
    for shard in _shards(act_dir):
        for raw, row in _iter_rows(shard):
            cid = row.get("card_id")
            if not cid:
                continue
            if _introducing_author(repo_root, raw, "ledgers/activity") == inspector_email:
                evidence.add(cid)
    return evidence


def _find_quarantined(repo_root: Path, inspector_email: str) -> list[dict]:
    inspector_email = inspector_email.lower()
    evidence = _inspector_evidence(repo_root, inspector_email)
    quarantined: list[dict] = []
    grades_dir = Path(repo_root) / "ledgers" / "grades"
    for shard in _shards(grades_dir):
        for raw, row in _iter_rows(shard):
            author = _introducing_author(repo_root, raw, "ledgers/grades")
            if author != inspector_email:
                quarantined.append({
                    **row,
                    "_reason": "grade row not authored by the Inspector identity",
                    "_grader": author,
                })
                continue
            if row.get("card_id") not in evidence:
                quarantined.append({
                    **row,
                    "_reason": "grade row has no matching Inspector activity evidence",
                })
    return quarantined


# --------------------------------------------------------------------------- #
# freeze / wake-me / report
# --------------------------------------------------------------------------- #

def _render_report(reason: str, quarantined: list[dict], ts: str) -> str:
    out = [
        "# FROZEN — promotion loop halted by reconcile",
        "",
        f"asserted: {ts}",
        f"reason: {reason}",
        "",
    ]
    if quarantined:
        out.append(f"quarantined grade rows ({len(quarantined)}):")
        for q in quarantined:
            out.append(
                f"  - card_id={q.get('card_id')} worker={q.get('worker')} "
                f"tier={q.get('tier')} grader={q.get('_grader', q.get('inspector_id'))} "
                f":: {q['_reason']}")
    else:
        out.append("quarantined grade rows: (none — sentinel-clear violation)")
    out.append("")
    out.append("This is INTEGRITY state. Clearing requires human review and an "
               "authenticated clear-record (ledgers/grades/FROZEN.cleared, "
               "human-committed). Do not delete the sentinel by hand.")
    return "\n".join(out) + "\n"


def _emit_wake(repo_root: Path, reason: str, quarantined: list[dict],
               ts: str) -> Path:
    body = (
        "## Work order\n\n"
        "The weekly grades<->Inspector-activity reconcile FROZE the promotion "
        "loop. Human review required before anything auto-promotes.\n\n"
        + _render_report(reason, quarantined, ts)
    )
    card = cards.new_card(
        project="kb",
        action="wake-me",
        target="ledgers/grades/FROZEN",
        risk_tier="T1",
        body=body,
    )
    return cards.save(card, Path(repo_root) / "queue")


def _do_freeze(repo_root: Path, reason: str, quarantined: list[dict],
               now: datetime.datetime | None) -> ReconcileResult:
    grades_dir = Path(repo_root) / "ledgers" / "grades"
    grades_dir.mkdir(parents=True, exist_ok=True)
    ts = (now or _now()).isoformat()
    sentinel = grades_dir / _SENTINEL
    sentinel.write_text(_render_report(reason, quarantined, ts), encoding="utf-8")
    # Append-only audit trail (not load-bearing; the git history of the sentinel
    # is the durable proof a freeze occurred).
    with (grades_dir / _LOG).open("a", encoding="utf-8") as f:
        f.write(f"{ts}\tfreeze\t{reason}\n")
    wake = _emit_wake(repo_root, reason, quarantined, ts)
    return ReconcileResult(frozen=True, reason=reason, quarantined=quarantined,
                           wake_card=wake, sentinel=sentinel)


# --------------------------------------------------------------------------- #
# sentinel-clear guard
# --------------------------------------------------------------------------- #

def _authenticated_clear(repo_root: Path,
                         since: datetime.datetime | None) -> bool:
    """True iff a human-authored clear-record justifies un-freezing. Fail closed:
    any missing/unparsable/non-human/stale condition returns False."""
    rel = f"ledgers/grades/{_CLEARED}"
    if not (Path(repo_root) / rel).exists():
        return False
    sha = approvals._introducing_commit(rel, repo_root)
    if not sha:
        return False
    author = _commit_author(repo_root, sha)
    humans = approvals._human_emails(repo_root)
    if not humans or author is None or author not in humans:
        return False
    # No replay: a clear-record predating the freeze it purports to clear is void.
    cdate = _commit_date(repo_root, sha)
    if since is not None and cdate is not None and cdate < since:
        return False
    return True


def _sentinel_cleared_without_record(repo_root: Path) -> bool:
    sentinel = Path(repo_root) / "ledgers" / "grades" / _SENTINEL
    if sentinel.exists():
        return False
    intro = approvals._introducing_commit("ledgers/grades/FROZEN", repo_root)
    if not intro:
        return False  # never frozen -> nothing to re-assert
    freeze_dt = _commit_date(repo_root, intro)
    return not _authenticated_clear(repo_root, freeze_dt)


# --------------------------------------------------------------------------- #
# entry point
# --------------------------------------------------------------------------- #

def reconcile(repo_root, *, tier: str,
              inspector_email: str = INSPECTOR_EMAIL,
              now: datetime.datetime | None = None) -> ReconcileResult:
    """Run the weekly cross-check. Desktop tier only (fail closed otherwise).

    Returns a ``ReconcileResult``. Writes ``ledgers/grades/FROZEN`` + a wake-me
    card when it freezes; never clears an existing freeze (only a human can).
    """
    if tier != "desktop":
        raise ValueError(
            "reconcile is desktop-tier only (author cross-check is meaningless "
            "in the cloud tier); refusing to run")
    repo_root = Path(repo_root)
    sentinel = repo_root / "ledgers" / "grades" / _SENTINEL

    # 1. Sentinel-clear guard runs first: a cleared-without-record freeze is
    #    itself an integrity violation and must re-assert immediately.
    if _sentinel_cleared_without_record(repo_root):
        return _do_freeze(
            repo_root,
            "FROZEN sentinel was cleared without an authenticated clear-record",
            [], now)

    # 2. grades <-> Inspector-activity cross-check.
    quarantined = _find_quarantined(repo_root, inspector_email)
    if quarantined:
        return _do_freeze(
            repo_root,
            "grade rows failed the Inspector-activity cross-check "
            "(fabricated grade and/or wrong grader identity)",
            quarantined, now)

    # 3. clean. Never auto-clear a pre-existing (human-managed) freeze.
    if sentinel.exists():
        return ReconcileResult(frozen=True, reason="already frozen (unchanged)",
                               quarantined=[], wake_card=None, sentinel=sentinel)
    return ReconcileResult(frozen=False, reason="clean", quarantined=[],
                           wake_card=None, sentinel=None)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="weekly grades<->inspector reconcile")
    ap.add_argument("--tier", required=True,
                    help="must be 'desktop' (author cross-check is desktop-only)")
    ap.add_argument("--repo", default=".")
    args = ap.parse_args(argv)
    if args.tier != "desktop":
        print("reconcile refuses to run outside the desktop tier", file=sys.stderr)
        return 2
    res = reconcile(Path(args.repo), tier=args.tier)
    if res.frozen:
        print(f"FROZEN: {res.reason} ({len(res.quarantined)} quarantined)")
        return 1
    print("reconcile: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
