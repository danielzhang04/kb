"""Wave E — Mission Control: the ranked morning PROJECTION over pending work.

`render_mission_control(repo_root, now, ...) -> str` produces
`dashboards/mission-control.md`. It is a *projection*, not a store: it never
moves, edits, or creates a card. The dashboard Inbox already renders the raw
cards; Mission Control adds the ranking + operational metrics a human needs to
triage a morning's backlog at a glance.

Four sections:

(a) RANKED pending approvals — every `queue/approvals` card, plus the wake-me
    and human-gate cards in `queue/inbox` (owner `human-operator` or an
    `approve:*` action). Each is scored:

        risk score = tier weight + age + novelty

    * tier weight — T3 > T2 > T1 (an unknown tier scores 0 and is flagged).
    * age — older cards rank higher (bounded, so age never outranks tier).
    * novelty — reuses `promotion.py`'s assurance-class vocabulary. A card whose
      (worker, project, task_type, tier) key has NO trusted, bar-meeting grade
      history is *novel* (per `promotion._assurance_class`: a novel T3 stays on
      the SIGNED channel) and ranks HIGHER than an established key. Novelty is
      computed only from `promotion.trusted_grades` — the same trust-anchored
      evidence the promotion loop keys off — so an untrusted/planted grade row
      never lowers a card's rank.

(b) QUARANTINE — the fleet's frozen/flagged state: the `STOP` freeze, the
    promotion-loop `ledgers/grades/FROZEN` sentinel (the reconcile module's
    freeze), and reconcile/sentinel drift rows from `ledgers/audit/sentinel-*.tsv`
    (columns `ts, card, class, detail`, aggregated by drift class).

(c) DIGEST — T2-and-below batchable pending items: everything pending in
    `queue/inbox` + `queue/blocked` that is NOT already in the ranked-approvals
    section, at tier T1/T2 — the low-risk backlog a human can batch-clear.

(d) RUBBER-STAMP metric — proposal->decision latency. For every card that has a
    timestamped *appearance* (an `activity` row) AND a later timestamped
    *decision* (a `grades` row or an `approvals`-ledger decision row), the
    latency is `decision_ts - appearance_ts` seconds. The reported figure is the
    MEDIAN. When fewer than the derivations exist the metric is emitted honestly
    as `insufficient data (n=X)` — never invented. When `n >= 5` AND the median
    is below `--rubber-stamp-floor` (default 120s) an ALARM line fires: approvals
    are being decided too fast to be real reviews.

CLI: `py -3 scripts/mission_control.py [--repo .] [--dry-run]
      [--rubber-stamp-floor 120]`. The CLI runs the shared preamble FIRST
(STOP-file supremacy); the pure render/write functions never do — only the CLI
entry point does, so the renderer stays a small, hermetic, testable primitive.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import statistics
import sys
from pathlib import Path

import cards
import preamble
import promotion

try:  # cost hook for the preamble gate; optional so the module imports standalone.
    import ledger
    _COST_FN = ledger.cost_today
except Exception:  # noqa: BLE001 — a missing ledger must not break the import.
    ledger = None  # type: ignore[assignment]
    _COST_FN = None

# --- scoring weights (documented, deterministic) ---------------------------- #
# Tier dominates the score; novelty is the next lever; age only breaks ties
# within a tier (bounded so a very old T1 never outranks a fresh T3).
_TIER_WEIGHT = {"T1": 100, "T2": 200, "T3": 300}
_NOVELTY_WEIGHT = 40.0
_AGE_CAP_DAYS = 30.0        # age contributes at most 30 points (30 days saturates)
_SECONDS_PER_DAY = 86400.0

# Decision-side markers: an `activity` row of one of these kinds is a DECISION,
# not a proposal appearance, so it never counts as the "appearance" timestamp.
_DECISION_KINDS = frozenset({"grade", "decision", "approved", "rejected",
                             "approve", "reject"})


# --------------------------------------------------------------------------- #
# small pure helpers                                                          #
# --------------------------------------------------------------------------- #

def _now() -> datetime.datetime:
    """UTC now — a seam for deterministic tests."""
    return datetime.datetime.now(datetime.timezone.utc)


def _card_epoch(card: cards.Card) -> int:
    """The unix-seconds prefix baked into the card id (`cards.new_id` =
    ``f"{int(time.time()):08x}-..."``). Older cards have a smaller value. Falls
    back to the file mtime, then 0, so a hand-authored id never raises."""
    cid = str(card.meta.get("id") or "")
    head = cid.split("-", 1)[0]
    try:
        return int(head, 16)
    except ValueError:
        pass
    if card.path is not None:
        try:
            return int(Path(card.path).stat().st_mtime)
        except OSError:
            return 0
    return 0


def _age_points(card: cards.Card, now: datetime.datetime) -> float:
    """Bounded age contribution in points: `min(age_days, 30)`. Never negative
    (a card minted 'in the future' by clock skew contributes 0)."""
    age_s = max(0.0, now.timestamp() - _card_epoch(card))
    return min(age_s / _SECONDS_PER_DAY, _AGE_CAP_DAYS)


def _iter_cards(repo_root, state: str):
    """Yield parsed cards from ``queue/<state>/``; silently skip anything that
    does not parse (a malformed file must never crash the projection)."""
    d = Path(repo_root) / "queue" / state
    if not d.exists():
        return
    for path in sorted(d.glob("*.md")):
        try:
            yield cards.parse(path)
        except Exception:  # noqa: BLE001 — a bad card is skipped, never fatal
            continue


def _is_wake_me(card: cards.Card) -> bool:
    return str(card.meta.get("action") or "").startswith("wake-me")


def _is_human_gate(card: cards.Card) -> bool:
    """An inbox card only a human can move: owned by the human operator or
    carrying an explicit ``approve:*`` action."""
    return (str(card.meta.get("owner") or "") == "human-operator"
            or str(card.meta.get("action") or "").startswith("approve:"))


def _worker_of(card: cards.Card) -> str:
    """Best-effort identity of the agent whose work is being gated (for novelty).
    Prefers an explicit ``worker`` field, else the card ``owner``. A human-gate
    card owned by ``human-operator`` carries no worker signal -> empty string,
    which matches no grade key, so the card reads as novel (fail-toward-attention)."""
    worker = card.meta.get("worker") or card.meta.get("owner") or ""
    if worker == "human-operator":
        return ""
    return str(worker)


def _task_type_of(card: cards.Card) -> str:
    """Best-effort task_type for the novelty key. Prefers an explicit
    ``task_type``/``task-type`` field, else a ``cadence:<name>`` form, else the
    card action. Matched against grade-row ``task_type`` values."""
    tt = card.meta.get("task_type") or card.meta.get("task-type")
    if tt:
        return str(tt)
    cadence = card.meta.get("cadence")
    if cadence:
        return f"cadence:{cadence}"
    return str(card.meta.get("action") or "")


# --------------------------------------------------------------------------- #
# novelty + risk scoring (reuses promotion.py's assurance vocabulary)         #
# --------------------------------------------------------------------------- #

def _is_novel(card: cards.Card, trusted_grades: list[dict]) -> bool:
    """True iff the card's (worker, project, task_type, tier) key has NO trusted,
    bar-meeting grade history — mirroring `promotion.decide`'s novelty test
    (`_row_key` match AND not `_below_bar`). A single failed/planted row never
    establishes history, so it never reduces novelty."""
    tier = card.meta.get("risk-tier")
    if tier not in promotion._TIERS:
        return True  # unknown tier is never "established"
    key = (_worker_of(card), card.meta.get("project"),
           _task_type_of(card), tier)
    for row in trusted_grades:
        if promotion._row_key(row) == key and not promotion._below_bar(row, tier):
            return False
    return True


def risk_score(card: cards.Card, now: datetime.datetime,
               trusted_grades: list[dict]) -> dict:
    """Pure per-card score: `tier weight + novelty + age`. Returns the numeric
    score plus its components and the reused promotion assurance-class label."""
    tier = card.meta.get("risk-tier")
    known = tier in promotion._TIERS
    tier_weight = _TIER_WEIGHT.get(tier, 0)
    novel = _is_novel(card, trusted_grades)
    age_pts = _age_points(card, now)
    score = tier_weight + (_NOVELTY_WEIGHT if novel else 0.0) + age_pts
    assurance = promotion._assurance_class(
        promotion.QUEUES_FOR_ME, tier, novel, known)
    return {
        "score": score,
        "tier": tier,
        "tier_weight": tier_weight,
        "novel": novel,
        "age_points": age_pts,
        "assurance_class": assurance,
        "known_tier": known,
    }


def _ranked_approvals(repo_root, now: datetime.datetime,
                      trusted_grades: list[dict]) -> list[dict]:
    """Every actionable pending item, scored and ranked (highest score first,
    then oldest first, then id — a total, deterministic order). Each entry:
    ``{kind, card, ...score components}``."""
    items: list[dict] = []
    for card in _iter_cards(repo_root, "approvals"):
        items.append({"kind": "approval", "card": card})
    for card in _iter_cards(repo_root, "inbox"):
        if _is_wake_me(card):
            items.append({"kind": "wake-me", "card": card})
        elif _is_human_gate(card):
            items.append({"kind": "human-gate", "card": card})
    for entry in items:
        entry.update(risk_score(entry["card"], now, trusted_grades))
    items.sort(key=lambda e: (-e["score"], _card_epoch(e["card"]),
                              str(e["card"].meta.get("id") or "")))
    return items


# --------------------------------------------------------------------------- #
# quarantine (frozen/flagged state)                                           #
# --------------------------------------------------------------------------- #

def _read_tsv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        with path.open(encoding="utf-8", newline="") as f:
            return list(csv.DictReader(f, delimiter="\t"))
    except OSError:
        return []


def _sentinel_findings(repo_root) -> list[dict]:
    """All reconcile/sentinel drift rows across every audit shard
    (`ledgers/audit/sentinel-*.tsv`)."""
    d = Path(repo_root) / "ledgers" / "audit"
    rows: list[dict] = []
    if not d.exists():
        return rows
    for shard in sorted(d.glob("sentinel-*.tsv")):
        rows.extend(_read_tsv(shard))
    return rows


def quarantine_state(repo_root) -> dict:
    """The fleet's frozen/flagged state: STOP freeze, promotion FROZEN sentinel,
    and drift findings aggregated by class."""
    repo_root = Path(repo_root)
    stop = repo_root / "STOP"
    frozen = repo_root / "ledgers" / "grades" / "FROZEN"
    frozen_reason = ""
    if frozen.exists():
        try:
            for line in frozen.read_text(encoding="utf-8").splitlines():
                if line.lower().startswith("reason:"):
                    frozen_reason = line.split(":", 1)[1].strip()
                    break
        except OSError:
            frozen_reason = ""
    findings = _sentinel_findings(repo_root)
    by_class: dict[str, int] = {}
    for row in findings:
        cls = row.get("class") or "?"
        by_class[cls] = by_class.get(cls, 0) + 1
    return {
        "stop": stop.exists(),
        "frozen": frozen.exists(),
        "frozen_reason": frozen_reason,
        "findings": findings,
        "by_class": by_class,
    }


# --------------------------------------------------------------------------- #
# digest bucket (T2-and-below batchables not already ranked)                  #
# --------------------------------------------------------------------------- #

def _digest_items(repo_root, ranked_ids: set[str]) -> list[cards.Card]:
    """Pending T1/T2 cards in inbox + blocked that are NOT in the ranked-approvals
    section — the low-risk backlog a human can batch-clear."""
    out: list[cards.Card] = []
    for state in ("inbox", "blocked"):
        for card in _iter_cards(repo_root, state):
            cid = str(card.meta.get("id") or "")
            if cid in ranked_ids:
                continue
            if card.meta.get("risk-tier") in ("T1", "T2"):
                out.append(card)
    out.sort(key=lambda c: (_card_epoch(c), str(c.meta.get("id") or "")))
    return out


# --------------------------------------------------------------------------- #
# rubber-stamp metric (proposal->decision latency)                            #
# --------------------------------------------------------------------------- #

def _read_all_shards(repo_root, kind: str) -> list[dict]:
    d = Path(repo_root) / "ledgers" / kind
    rows: list[dict] = []
    if not d.exists():
        return rows
    for shard in sorted(d.glob("*.tsv")):
        rows.extend(_read_tsv(shard))
    return rows


def _parse_ts(value) -> datetime.datetime | None:
    """Parse a fine-grained ISO timestamp. Returns None for a missing/coarse/
    unparseable value (a plain ``YYYY-MM-DD`` date has no time-of-day resolution,
    so it cannot detect sub-threshold rubber-stamping and is excluded)."""
    if not value:
        return None
    text = str(value).strip()
    if "T" not in text and " " not in text:
        return None  # date-only, no time component
    try:
        dt = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def rubber_stamp_metric(repo_root, *, floor: float = 120.0) -> dict:
    """Median proposal->decision latency (seconds) across cards with both a
    timestamped appearance (`activity` row, non-decision kind) and a later
    timestamped decision (`grades` row or `approvals`-ledger row). Alarms when
    `n >= 5` and the median is below `floor`. Honest: `n` reflects only cards
    where the latency is genuinely derivable."""
    repo_root = Path(repo_root)

    # Earliest appearance ts per card (an activity row that is NOT a decision).
    appear: dict[str, datetime.datetime] = {}
    for row in _read_all_shards(repo_root, "activity"):
        cid = row.get("card_id") or row.get("card")
        if not cid or (row.get("kind") or "") in _DECISION_KINDS:
            continue
        ts = _parse_ts(row.get("ts"))
        if ts is None:
            continue
        if cid not in appear or ts < appear[cid]:
            appear[cid] = ts

    # Earliest decision ts per card (a grade row, or an approvals-ledger row).
    decide: dict[str, datetime.datetime] = {}
    for kind in ("grades", "approvals"):
        for row in _read_all_shards(repo_root, kind):
            cid = row.get("card_id") or row.get("card")
            if not cid:
                continue
            ts = _parse_ts(row.get("ts"))
            if ts is None:
                continue
            if cid not in decide or ts < decide[cid]:
                decide[cid] = ts

    latencies: list[float] = []
    for cid, a in appear.items():
        d = decide.get(cid)
        if d is None or d < a:
            continue
        latencies.append((d - a).total_seconds())

    n = len(latencies)
    median = statistics.median(latencies) if latencies else None
    alarm = bool(median is not None and n >= 5 and median < floor)
    return {"n": n, "median": median, "floor": floor, "alarm": alarm}


# --------------------------------------------------------------------------- #
# rendering                                                                   #
# --------------------------------------------------------------------------- #

def _fmt_card_line(index: int, entry: dict) -> str:
    m = entry["card"].meta
    novel = "novel" if entry["novel"] else "established"
    return (
        f"{index}. **[{entry['tier']}]** score {entry['score']:.1f} "
        f"({entry['assurance_class']}, {novel}) — {entry['kind']}: "
        f"{m.get('action')} -> {m.get('target')} (card `{m.get('id')}`)"
    )


def _ranked_section(ranked: list[dict]) -> list[str]:
    if not ranked:
        return ["Nothing pending — `queue/approvals/` and the wake-me/human-gate "
                "inbox are clear."]
    out = []
    for i, entry in enumerate(ranked, start=1):
        out.append(_fmt_card_line(i, entry))
    return out


def _quarantine_section(q: dict) -> list[str]:
    out: list[str] = []
    if q["stop"]:
        out.append("- **STOP present** — the fleet is FROZEN (halt everything).")
    if q["frozen"]:
        reason = f" — {q['frozen_reason']}" if q["frozen_reason"] else ""
        out.append(f"- **Promotion loop FROZEN** (`ledgers/grades/FROZEN`){reason}.")
    if q["by_class"]:
        out.append(f"- Reconcile/sentinel drift ({len(q['findings'])} finding(s)):")
        for cls in sorted(q["by_class"]):
            out.append(f"  - {cls}: {q['by_class'][cls]}")
    if not out:
        return ["Clean — no STOP, no promotion freeze, no reconcile/sentinel drift."]
    return out


def _digest_section(items: list[cards.Card]) -> list[str]:
    if not items:
        return ["No batchable T1/T2 backlog outside the ranked section."]
    out = []
    for card in items:
        m = card.meta
        out.append(f"- [{m.get('risk-tier')}] {m.get('action')} -> "
                   f"{m.get('target')} (card `{m.get('id')}`)")
    return out


def _rubber_stamp_section(metric: dict) -> list[str]:
    n = metric["n"]
    if metric["median"] is None:
        return [f"Proposal->decision latency: insufficient data (n={n}). "
                "Need paired timestamped appearance + decision ledger rows."]
    median = metric["median"]
    out = [f"Proposal->decision latency: median {median:.1f}s over n={n} "
           f"decision(s) (floor {metric['floor']:.0f}s)."]
    if metric["alarm"]:
        out.append(f"- **ALARM: median latency {median:.1f}s < floor "
                   f"{metric['floor']:.0f}s with n={n} (>=5)** — approvals are "
                   "being decided too fast to be genuine reviews (rubber-stamping).")
    elif n < 5:
        out.append(f"- (alarm suppressed: n={n} < 5 — too few decisions to judge)")
    return out


def render_mission_control(repo_root, *, now: datetime.datetime | None = None,
                           rubber_stamp_floor: float = 120.0) -> str:
    """Render `dashboards/mission-control.md`. Deterministic given
    (repo state, ``now``, ``rubber_stamp_floor``): no network, no LLM, no
    preamble, no card mutation."""
    repo_root = Path(repo_root)
    now = now or _now()
    trusted = promotion.trusted_grades(repo_root)

    ranked = _ranked_approvals(repo_root, now, trusted)
    ranked_ids = {str(e["card"].meta.get("id") or "") for e in ranked}
    q = quarantine_state(repo_root)
    digest = _digest_items(repo_root, ranked_ids)
    metric = rubber_stamp_metric(repo_root, floor=rubber_stamp_floor)

    out: list[str] = []
    out.append("# Mission Control")
    out.append("")
    out.append("_Ranked morning projection over pending work — a read-only view, "
               "never a store. Cards are not moved or edited here._")
    out.append("")
    out.append("## Ranked approvals (score = tier + age + novelty)")
    out.extend(_ranked_section(ranked))
    out.append("")
    out.append("## Quarantine")
    out.extend(_quarantine_section(q))
    out.append("")
    out.append("## Digest (T2-and-below batchables)")
    out.extend(_digest_section(digest))
    out.append("")
    out.append("## Rubber-stamp metric")
    out.extend(_rubber_stamp_section(metric))
    out.append("")
    return "\n".join(out)


def mission_control_path(repo_root) -> Path:
    return Path(repo_root) / "dashboards" / "mission-control.md"


def write_mission_control(repo_root, *, now: datetime.datetime | None = None,
                          rubber_stamp_floor: float = 120.0) -> Path:
    """Write `dashboards/mission-control.md` idempotently — identical content is
    never rewritten (a re-run leaves the file's mtime untouched)."""
    content = render_mission_control(repo_root, now=now,
                                     rubber_stamp_floor=rubber_stamp_floor)
    path = mission_control_path(repo_root)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Render the Mission Control ranked projection (Wave E).")
    ap.add_argument("--repo", default=".", help="repo root")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the rendered projection instead of writing the file")
    ap.add_argument("--rubber-stamp-floor", type=float, default=120.0,
                    help="median proposal->decision latency (s) below which the "
                         "rubber-stamp alarm fires when n>=5 (default 120)")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).resolve()
    problems = preamble.check(repo_root, cost_today_fn=_COST_FN)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return 1

    if args.dry_run:
        print(render_mission_control(repo_root,
                                     rubber_stamp_floor=args.rubber_stamp_floor))
        return 0

    path = write_mission_control(repo_root,
                                 rubber_stamp_floor=args.rubber_stamp_floor)
    print(str(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
