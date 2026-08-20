"""Pure, recomputed promotion logic (spec Task 3.1, O7).

Autonomy is *never* stored; it is recomputed from the grade ledger every time,
keyed on ``(worker, project, task_type, tier)``. Everything here fails closed:
when an input is missing, malformed, or ambiguous the answer is the *more*
restrictive one — ``queues-for-me`` for autonomy, and the strongest human
channel (``signed-only``) for the assurance class.

Two entry points:

* ``status(worker, project, task_type, tier, grades_rows, frozen) -> str`` — a
  PURE function of its arguments. Returns ``"autonomous"`` iff **not frozen**,
  the tier is known, there are at least ``window`` graded runs in the current
  streak, and none of the last ``window`` runs are below the tier pass-bar (a
  below-floor run RESETS the streak). It trusts the rows it is handed: filtering
  rows down to *trusted* graders is ``decide()``'s job (below), so that ``status``
  stays a small, well-tested primitive.

* ``decide(cadence, repo_root, ...) -> {"autonomy", "assurance_class"}`` — the
  I/O-bearing entry point dispatch (Task 3.4) wires in. It reads the grades
  ledger, the ``ledgers/grades/FROZEN`` sentinel, ``governance/graders.yaml``
  (the grader trust anchor), and shells ``git show <main-ref>:<heartbeat>`` for
  the standing-authorization cross-check. It also emits an ``assurance_class`` so
  downstream notify (Task 2.4) never has to recompute novelty.

Threat model (Wave 3, v1): reconciliation catches non-adversarial drift and
buggy workers, not a maliciously injected worker. Interim integrity rests on
(a) T3 permanently capped (never acts alone — a human token is always required),
(b) agent-generated task types defaulting to queues-for-me, (c) the standing-auth
main-ref cross-check (we NEVER trust the ops working tree — only the bytes a
human authored onto protected ``main``), and (d) the trust-anchor invariant (an
absent/empty ``graders.yaml`` trusts no grader, so no grade row earns autonomy).
"""
from __future__ import annotations

import csv
import re
import subprocess
from pathlib import Path

import yaml

# --- autonomy verdicts -------------------------------------------------------
AUTONOMOUS = "autonomous"
QUEUES_FOR_ME = "queues-for-me"
ACTS_ALONE = "acts-alone"
EVAL_WORKER = "eval-suite"
_RESERVED_EVAL_KEYS = ("task_type", "card_id", "kind")

# --- the precise, named assurance-class set (Task 2.4 consumes these) --------
ASSURANCE_CLASSES = frozenset({
    "acts-alone",          # will act alone; no approval channel needed
    "possession-eligible",  # T1/T2 queued to a human; possession (tap) admissible
    "T3-novel",            # first-ever T3 key: SIGNED channel only, no possession button (O9)
    "T3-established",       # seen-before / human-authored T3: fast-lane / possession-eligible
    "signed-only",         # fail-closed strongest channel (unknown tier / ambiguous)
})

# Per-tier promotion parameters (risk-tiers.md, binding wording):
#   window  — graded runs required in the current streak
#   bar     — a run scoring below this (in the last `window`) blocks autonomy
#   floor   — below this RESETS the streak; kind "score" (T1/T2) or "fail" (T3)
_TIERS = {
    "T1": {"window": 10, "bar": 90, "floor": 80, "floor_kind": "score"},
    "T2": {"window": 20, "bar": 95, "floor": 90, "floor_kind": "score"},
    "T3": {"window": 40, "bar": 98, "floor": None, "floor_kind": "fail"},
}

_GIT_TIMEOUT = 15
_FENCE = re.compile(r"```yaml\s*\n(.*?)\n```", re.DOTALL)
# Fields that make a cadence block "the same block". A change to any of these is
# an escalation the human did not author on main -> not standing-authorized.
_CADENCE_FIELDS = ("name", "schedule", "tier", "risk-tier", "prompt")


# --------------------------------------------------------------------------- #
# row coercion helpers (rows arrive from TSV as strings, or typed from tests)  #
# --------------------------------------------------------------------------- #

def _score(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _passed(value) -> bool:
    """Fail-closed truthiness: only an explicit true-ish token counts as a pass.
    Anything unrecognized (blank, None, garbage) is treated as a failure."""
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "1", "yes", "pass", "passed")


def _row_key(row: dict) -> tuple:
    return (row.get("worker"), row.get("project"), row.get("task_type"), row.get("tier"))


def _is_reserved_eval_row(row: dict) -> bool:
    """True for eval evidence, which is never promotion evidence.

    This is deliberately keyed by both the reserved writer identity and the
    reserved ``eval:`` namespace.  Keeping the decision here gives every row
    source (ledger reads, injected test rows, and direct ``status`` callers)
    one fail-closed boundary.
    """
    if str(row.get("worker") or "") == EVAL_WORKER:
        return True
    return any(str(row.get(key) or "").startswith("eval:")
               for key in _RESERVED_EVAL_KEYS)


def _promotion_rows(rows) -> list[dict]:
    """The sole row boundary for autonomy/promotion calculations."""
    return [row for row in rows if isinstance(row, dict) and not _is_reserved_eval_row(row)]


def _below_floor(row: dict, tier: str) -> bool:
    cfg = _TIERS[tier]
    if cfg["floor_kind"] == "fail":          # T3: any failure resets
        return not _passed(row.get("pass"))
    s = _score(row.get("score"))
    if s is None:                            # malformed score -> reset (fail closed)
        return True
    return s < cfg["floor"]


def _below_bar(row: dict, tier: str) -> bool:
    cfg = _TIERS[tier]
    # Defense-in-depth: a failed run never counts toward the promotion window,
    # regardless of its numeric score.
    if not _passed(row.get("pass")):
        return True
    s = _score(row.get("score"))
    if s is None:
        return True
    return s < cfg["bar"]


def _streak_is_autonomous(matching: list[dict], tier: str) -> bool:
    cfg = _TIERS.get(tier)
    if cfg is None:
        return False
    window = cfg["window"]
    streak: list[dict] = []
    for row in matching:
        if _below_floor(row, tier):
            streak = []                      # below-floor RESETS the counter
        else:
            streak.append(row)
    if len(streak) < window:
        return False
    last = streak[-window:]
    return not any(_below_bar(row, tier) for row in last)


# --------------------------------------------------------------------------- #
# status(): the pure primitive                                                #
# --------------------------------------------------------------------------- #

def status(worker, project, task_type, tier, grades_rows, frozen) -> str:
    """Recompute autonomy for one key from the (already trusted) grade rows.

    Returns ``"autonomous"`` or ``"queues-for-me"``. Fails closed on a frozen
    fleet or an unknown tier. Rows are matched by the full key and ordered by
    ``ts`` (lexicographic — the ledger writes sortable ISO timestamps)."""
    if frozen:
        return QUEUES_FOR_ME
    if tier not in _TIERS:
        return QUEUES_FOR_ME
    if _is_reserved_eval_row({"worker": worker, "task_type": task_type}):
        return QUEUES_FOR_ME
    key = (worker, project, task_type, tier)
    matching = sorted(
        (r for r in _promotion_rows(grades_rows) if _row_key(r) == key),
        key=lambda r: str(r.get("ts") or ""))
    return AUTONOMOUS if _streak_is_autonomous(matching, tier) else QUEUES_FOR_ME


# --------------------------------------------------------------------------- #
# ledger / governance reads (fail-closed)                                     #
# --------------------------------------------------------------------------- #

def read_grades(repo_root) -> list[dict]:
    """Every grade row across all day-shards (a promotion window can span many
    days). The FROZEN sentinel has no ``.tsv`` suffix and is skipped by the glob."""
    d = Path(repo_root) / "ledgers" / "grades"
    rows: list[dict] = []
    if not d.exists():
        return rows
    for shard in sorted(d.glob("*.tsv")):
        try:
            with shard.open(encoding="utf-8", newline="") as f:
                rows.extend(csv.DictReader(f, delimiter="\t"))
        except OSError:
            continue
    return rows


def is_frozen(repo_root) -> bool:
    return (Path(repo_root) / "ledgers" / "grades" / "FROZEN").exists()


def allowed_graders(repo_root) -> set[str]:
    """Grader ids trusted to author grade rows, from ``governance/graders.yaml``.

    The file is committed by a human at Gate 3.7 and does not exist yet; read it
    DEFENSIVELY. Absent, unreadable, or malformed -> the empty set, i.e. NO grader
    is trusted and no grade row earns autonomy (the trust-anchor invariant). The
    exact schema is not frozen yet, so accept a few plausible shapes: a list of
    id strings, a list of ``{id|inspector_id|name: ...}`` dicts, or a mapping."""
    path = Path(repo_root) / "governance" / "graders.yaml"
    if not path.exists():
        return set()
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (yaml.YAMLError, OSError):
        return set()
    if not isinstance(data, dict):
        return set()
    graders = data.get("graders", [])
    out: set[str] = set()
    if isinstance(graders, list):
        for g in graders:
            if isinstance(g, str):
                out.add(g.strip())
            elif isinstance(g, dict):
                gid = g.get("id") or g.get("inspector_id") or g.get("name")
                if isinstance(gid, str):
                    out.add(gid.strip())
    elif isinstance(graders, dict):
        out.update(str(k).strip() for k in graders)
    return {g for g in out if g}


def trusted_grades(repo_root) -> list[dict]:
    """Promotion-eligible rows from allow-listed graders.

    The reserved ``eval-suite`` worker records eval evidence, never autonomy
    evidence. Empty when graders.yaml is absent/empty (fail closed)."""
    allowed = allowed_graders(repo_root)
    if not allowed:
        return []
    return _promotion_rows(
        r for r in read_grades(repo_root) if r.get("inspector_id") in allowed)


# --------------------------------------------------------------------------- #
# standing authorization: exact cadence block on the protected main ref (D4)  #
# --------------------------------------------------------------------------- #

def _git_show(repo_root, ref: str, rel: str) -> str | None:
    try:
        res = subprocess.run(["git", "show", f"{ref}:{rel}"], cwd=str(repo_root),
                             capture_output=True, text=True, timeout=_GIT_TIMEOUT)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    if res.returncode != 0:
        return None
    return res.stdout


def _resolve_main_ref(repo_root, explicit: str | None = None) -> str:
    """The PROTECTED main ref to verify standing authorization against. An
    explicit argument wins (hermetic tests pin one directly); otherwise prefer
    the protected remote-tracking ``refs/remotes/origin/main`` (only a human can
    merge into it) over the agent-writable local ``refs/heads/main``; fall back
    to ``refs/heads/main`` ONLY when no remote-tracking ref exists (a fresh
    hermetic clone with no ``origin``).

    N1 (mirrors ``approvals._resolve_approvals_ref``): resolving the LOCAL branch
    first would let an ops-tier agent ``git branch -f main <rogue-sha>`` in its
    own clone — with no push, human, or signature — and forge a standing-auth
    cadence. That grants ``acts-alone`` at T1/T2 AND launders a novel T3 from the
    signed-only channel to possession-eligible. The remote-tracking ref reflects
    only what a human actually merged onto protected ``main``, so it is the one
    we trust. When git itself is unavailable we return ``refs/heads/main`` and
    the downstream ``git show`` fails closed (no standing authorization)."""
    if explicit:
        return explicit
    for ref in ("refs/remotes/origin/main", "refs/heads/main"):
        try:
            r = subprocess.run(
                ["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"],
                cwd=str(repo_root), capture_output=True, text=True,
                timeout=_GIT_TIMEOUT)
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            return "refs/heads/main"
        if r.stdout.strip():
            return ref
    return "refs/heads/main"


def _parse_cadences_text(text: str) -> list[dict]:
    m = _FENCE.search(text or "")
    if not m:
        return []
    try:
        data = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return []
    if not isinstance(data, dict):
        return []
    return [c for c in (data.get("cadences") or []) if isinstance(c, dict)]


def _cadence_matches(main_cadence: dict, given: dict) -> bool:
    """True iff every security-relevant field of the cadence equals the block the
    human authored on main. Extra incidental keys are ignored, but any change to
    name/schedule/tier/risk-tier/prompt (e.g. an escalated prompt) fails."""
    return all(main_cadence.get(f) == given.get(f) for f in _CADENCE_FIELDS)


def _standing_authorized(cadence: dict, repo_root, heartbeat_rel, main_ref="refs/remotes/origin/main") -> bool:
    """Standing authorization (risk-tiers.md): a cadence a human authored and
    committed to a HEARTBEAT.md on protected ``main`` is pre-approved at its
    declared risk tier. We verify against ``git show <main_ref>:<heartbeat_rel>``
    ONLY — never the ops working tree, which an ops-tier agent can write, and
    never the agent-writable LOCAL ``refs/heads/main`` (callers should pass a
    ref resolved by ``_resolve_main_ref``, which prefers protected
    ``refs/remotes/origin/main``). Fails closed when the cadence, path, or main
    ref is missing, the tier is unknown, or the exact block is absent from main."""
    if not cadence or not heartbeat_rel:
        return False
    if cadence.get("risk-tier") not in _TIERS:
        return False
    text = _git_show(repo_root, main_ref, str(heartbeat_rel))
    if text is None:
        return False
    return any(_cadence_matches(c, cadence) for c in _parse_cadences_text(text))


# --------------------------------------------------------------------------- #
# decide(): the wired entry point                                             #
# --------------------------------------------------------------------------- #

def _assurance_class(autonomy: str, tier: str, novel: bool, known: bool) -> str:
    if not known:
        return "signed-only"                 # fail closed: unknown tier -> strongest channel
    if autonomy == ACTS_ALONE:
        return "acts-alone"
    if tier == "T3":
        return "T3-novel" if novel else "T3-established"
    return "possession-eligible"


def decide(cadence, repo_root, *, worker, project, task_type=None, tier=None,
           today=None, heartbeat_rel=None, main_ref=None,
           grades_rows=None, frozen=None, standing_authorized=None,
           has_prior_approval=False) -> dict:
    """Route one (cadence-)action. Returns ``{"autonomy", "assurance_class"}``.

    Precedence (test_decide_precedence): FROZEN -> queues-for-me; else
    standing-authorized (exact block on main) -> acts-alone (T1/T2) / fast-lane
    (T3); else earned autonomous status -> acts-alone (T1/T2) / fast-lane (T3);
    else queues-for-me (the v1 default for anything an agent generates).

    T3 is permanently capped: any acts-alone verdict at T3 is downgraded to
    queues-for-me (fast-lane) — a human token is always required (risk-tiers.md).

    Anything that must do I/O is injectable for pure tests: pass ``grades_rows``
    (already-trusted rows), ``frozen``, or ``standing_authorized`` to bypass the
    corresponding read.

    ``has_prior_approval`` must be a TRUSTED signal if supplied; it is NOT derived
    from the ops working tree (a planted ``approved`` card there could otherwise
    downgrade a novel T3 from the signed channel to possession). It defaults to
    False, so novelty is decided solely by trusted grade rows and standing-auth.
    """
    repo_root = Path(repo_root)
    cadence = cadence or {}
    if tier is None:
        tier = cadence.get("risk-tier")
    if task_type is None:
        name = cadence.get("name")
        task_type = f"cadence:{name}" if name else None

    if grades_rows is None:
        grades_rows = trusted_grades(repo_root)
    else:
        grades_rows = _promotion_rows(grades_rows)
    if frozen is None:
        frozen = is_frozen(repo_root)
    if standing_authorized is None:
        # main_ref defaults to None so the production caller (dispatch 3.4) gets
        # the PROTECTED remote ref automatically; an explicit value still wins.
        resolved_main_ref = _resolve_main_ref(repo_root, main_ref)
        standing_authorized = _standing_authorized(
            cadence, repo_root, heartbeat_rel, resolved_main_ref)

    known = tier in _TIERS

    # ---- base autonomy (fail-closed precedence) ----
    if _is_reserved_eval_row({"worker": worker, "task_type": task_type}):
        autonomy = QUEUES_FOR_ME
    elif not known:
        autonomy = QUEUES_FOR_ME
    elif frozen:
        autonomy = QUEUES_FOR_ME
    elif standing_authorized:
        autonomy = ACTS_ALONE
    elif status(worker, project, task_type, tier, grades_rows, frozen) == AUTONOMOUS:
        autonomy = ACTS_ALONE
    else:
        autonomy = QUEUES_FOR_ME

    # ---- T3 permanent cap: never acts alone ----
    if tier == "T3" and autonomy == ACTS_ALONE:
        autonomy = QUEUES_FOR_ME

    # ---- novelty (O9): a novel T3 must stay on the SIGNED channel. A key is
    # only "established" (novel -> possession-eligible) when it has a genuine
    # ESTABLISHED history: at least one TRUSTED, bar-meeting/passing row for the
    # key (grades_rows are already trust-filtered by trusted_grades()). Mere
    # EXISTENCE is not enough — a single failed/planted row (score 0, pass false)
    # must NEVER reduce assurance, so we reuse _below_bar (a failed run is always
    # below-bar) rather than a bare key match. A standing-authorized cadence is
    # human-approved by authoring, so it is likewise never "novel".
    key = (worker, project, task_type, tier)
    established_history = known and any(
        _row_key(r) == key and not _below_bar(r, tier) for r in grades_rows)
    novel = (not established_history) and (not has_prior_approval) and (not standing_authorized)

    return {"autonomy": autonomy,
            "assurance_class": _assurance_class(autonomy, tier, novel, known)}
