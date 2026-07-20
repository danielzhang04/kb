"""Wave D — Sentinel: the fleet immune system (reconciler + usage guards + loop breaker).

REPORT-ONLY by construction. Sentinel observes; it never mutates a card, never
auto-reverts a claim, and (except behind the explicit `usage --enforce` flag)
never writes the STOP freeze. Emitting the actual wake-me card is the
*dispatcher's* job — sentinel prints a summary and sets an exit code. This keeps
the immune system advisory until a human/dispatcher wires its findings into the
freeze chain, matching the conservative resolution recorded in the arc design
(`docs/specs/2026-07-19-fleet-layers-arc-design.md` §Wave D).

Three organs, three subcommands, all preamble-gated on CLI entry (STOP supremacy):

reconcile  Level-triggered DESIRED-vs-OBSERVED diff over freshly-`done` cards
           (and in-flight `working` cards) — see `reconcile_scan`. Findings append
           `ledgers/audit/sentinel-<day>.tsv`; exit 1 when NEW findings exist.

usage      Reservation ledger (`reserve`/`settle`/`release`) +
           `usage check` summing today's held+settled against the OPTIONAL
           `governance/budget.yaml` caps. Breach ⇒ exit 2; STOP write guarded
           behind `--enforce` (default OFF — the dispatcher's flag once trust exists).

loops      Circuit-breaker fingerprinting over a JSONL action log — same
           tool + same canonical-args-hash ≥N consecutively ⇒ exit 1.

Drift taxonomy (reconcile) — five classes, mapped from four verification checks:
    empty-result    `## Result` section absent or trivial (<40 chars of content).
    missing-artifact Result names a repo path that is absent/empty, WITHOUT a
                     success claim (a neutral gap).
    fail-plausible  Result explicitly claims success (a success verb) yet a named
                     artifact is absent/empty — the claim contradicts the disk.
    sandbox-denial  Result contains a sandbox/permission denial signature.
    orphan-claim    A `working` card whose owner produced no dispatch/activity
                    ledger shard in the last 2 days (abandoned in-flight work), OR
                    a dispatched `done` card that carries no `session-id` (a claim
                    with no execution trail — check (iii)/(iv) fold in here).

Idempotency: a git-native int cursor (`ledgers/audit/sentinel-cursor`, mirroring
`ledger.read_cursor`/`write_cursor`) bounds which `done` cards are re-scanned, and
every appended row is de-duplicated against today's shard — so a second run over
an unchanged repo reports nothing and exits 0.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import hashlib
import json
import re
import secrets
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cards
import preamble

try:  # cost hook for the preamble gate; optional so sentinel imports standalone.
    import ledger
    _COST_FN = ledger.cost_today
except Exception:  # noqa: BLE001 — a missing ledger must not break sentinel import.
    ledger = None  # type: ignore[assignment]
    _COST_FN = None

# Exit codes (documented contract, shared across subcommands):
EXIT_CLEAN = 0        # nothing to report
EXIT_FINDINGS = 1     # reconcile: new drift; loops: fingerprints found
EXIT_BREACH = 2       # usage: cap breached
EXIT_PREAMBLE = 3     # STOP / budget / API-key gate blocked the run (did nothing)

AUDIT_DIR = ("ledgers", "audit")
CURSOR_NAME = "sentinel-cursor"

# --------------------------------------------------------------------------- #
# signatures (extensible module-level lists — grep patterns, not code paths)
# --------------------------------------------------------------------------- #

# Denial signatures a sandbox/OS/policy layer leaves in a Result. Case-insensitive
# substring match. Extend freely — this is data, not logic.
SANDBOX_DENIAL_PATTERNS = (
    "permission denied",
    "operation not permitted",
    "eacces",
    "eperm",
    "access is denied",
    "access denied",
    "not permitted",
    "not allowed to",
    "command not allowed",
    "blocked by sandbox",
    "sandbox denied",
    "sandbox: denied",
    "denied by policy",
    "read-only file system",
    "erofs",
    "requires approval to",
)

# Whole-word success claims. If any appears in a Result that also names an absent
# artifact, the gap is a `fail-plausible` (a claim the disk contradicts) rather
# than a neutral `missing-artifact`.
SUCCESS_PATTERNS = (
    "created", "wrote", "written", "added", "committed", "complete", "completed",
    "done", "passed", "green", "shipped", "landed", "generated", "saved", "built",
    "succeeded", "success",
)
_SUCCESS_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in SUCCESS_PATTERNS) + r")\b", re.IGNORECASE)

# A repo-relative path token: at least one `/`, a file extension, and NONE of the
# glob/placeholder/URL markers that mean "not a concrete artifact claim"
# (`memory/<agent-id>.md`, `ledgers/cost/**`, `https://…` are all skipped).
_PATH_RE = re.compile(r"(?<![\w./])([A-Za-z0-9_.\-]+(?:/[A-Za-z0-9_.\-]+)+\.[A-Za-z0-9]+)")
_MIN_RESULT_CHARS = 40


def _now() -> datetime.datetime:
    """UTC now — a seam for deterministic tests."""
    return datetime.datetime.now(datetime.timezone.utc)


# --------------------------------------------------------------------------- #
# audit shard writer (ledgers/audit/ is OUTSIDE ledger.KINDS by design — its own
# tiny writer, same shard-per-writer-per-day convention, never extends KINDS)
# --------------------------------------------------------------------------- #

def _audit_dir(repo_root: Path) -> Path:
    return Path(repo_root, *AUDIT_DIR)


def _shard_path(repo_root: Path, writer: str, day: str) -> Path:
    return _audit_dir(repo_root) / f"{writer}-{day}.tsv"


def _append_audit(repo_root: Path, path: Path, fields: list[str], row: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    is_new = not path.exists() or path.stat().st_size == 0
    with path.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter="\t", extrasaction="ignore")
        if is_new:
            w.writeheader()
        w.writerow(row)
    return path


def _read_shard(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


# --------------------------------------------------------------------------- #
# git-native cursor (mirrors ledger.read_cursor/write_cursor; different dir, so
# a tiny local copy rather than importing the approvals-pinned path)
# --------------------------------------------------------------------------- #

def read_cursor(repo_root: Path, default: int = 0) -> int:
    p = _audit_dir(repo_root) / CURSOR_NAME
    if not p.exists():
        return default
    text = p.read_text(encoding="utf-8").strip()
    if not text:
        return default
    try:
        return int(text)
    except ValueError:
        return default


def write_cursor(repo_root: Path, value: int) -> Path:
    p = _audit_dir(repo_root) / CURSOR_NAME
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(str(int(value)), encoding="utf-8")
    return p


def _card_key(card_id: str) -> int:
    """Monotonic-ish sort key from a card id: the leading `int(time.time()):08x`
    stamp cards.new_id() writes. Git-stable (unlike file mtime). 0 if unparseable."""
    head = str(card_id).split("-", 1)[0]
    try:
        return int(head, 16)
    except (ValueError, TypeError):
        return 0


# --------------------------------------------------------------------------- #
# ORGAN (a): reconciler
# --------------------------------------------------------------------------- #

@dataclass
class Finding:
    card: str
    cls: str
    detail: str


def extract_result(body: str) -> str | None:
    """The text under a `## Result` heading, up to the next `## ` heading or EOF.
    None if there is no Result section at all."""
    lines = body.splitlines()
    out: list[str] = []
    capturing = False
    for ln in lines:
        if re.match(r"^\s*##\s+Result\b", ln, re.IGNORECASE):
            capturing = True
            continue
        if capturing and re.match(r"^\s*##\s+\S", ln):
            break
        if capturing:
            out.append(ln)
    if not capturing:
        return None
    return "\n".join(out).strip()


def extract_paths(text: str) -> list[str]:
    """Concrete repo-relative artifact paths named in `text`. Glob/placeholder/URL
    tokens are excluded (they are not falsifiable artifact claims)."""
    found: list[str] = []
    for m in _PATH_RE.finditer(text):
        tok = m.group(1)
        # Drop URL tails, globs, angle-bracket placeholders (regex already bars
        # <,>,*,? by charclass, but a token can still sit right after `://`).
        start = m.start(1)
        if "://" in text[max(0, start - 8):start + len(tok)]:
            continue
        if tok not in found:
            found.append(tok)
    return found


def _dispatched_card_ids(repo_root: Path) -> set[str]:
    """Card ids that appear in any dispatch ledger shard (proof a card was actually
    dispatched to a worker — so a `session-id` is then expectable)."""
    ids: set[str] = set()
    d = Path(repo_root) / "ledgers" / "dispatch"
    if not d.exists():
        return ids
    for shard in sorted(d.glob("*.tsv")):
        for row in _read_shard(shard):
            cid = row.get("card")
            if cid:
                ids.add(cid.strip())
    return ids


def _owner_has_recent_ledger(repo_root: Path, owner: str, today: datetime.date) -> bool:
    """True iff `owner` wrote a dispatch OR activity shard for today or yesterday
    (filename convention `<agent>-<day>.tsv`). Absence for 2+ days ⇒ orphan."""
    days = {today.isoformat(), (today - datetime.timedelta(days=1)).isoformat()}
    for kind in ("dispatch", "activity"):
        base = Path(repo_root) / "ledgers" / kind
        for day in days:
            if (base / f"{owner}-{day}.tsv").exists():
                return True
    return False


def _scan_done_card(repo_root: Path, card, dispatched: set[str]) -> list[Finding]:
    cid = str(card.meta.get("id"))
    findings: list[Finding] = []
    result = extract_result(card.body)

    if result is None or len(result) < _MIN_RESULT_CHARS:
        findings.append(Finding(cid, "empty-result",
                                "no `## Result` section" if result is None
                                else f"Result trivial ({len(result)} chars < {_MIN_RESULT_CHARS})"))
    else:
        low = result.lower()
        for pat in SANDBOX_DENIAL_PATTERNS:
            if pat in low:
                findings.append(Finding(cid, "sandbox-denial",
                                        f"Result contains denial signature: {pat!r}"))
                break
        success = bool(_SUCCESS_RE.search(result))
        for path in extract_paths(result):
            target = Path(repo_root) / path
            absent = not target.exists()
            empty = target.exists() and target.is_file() and target.stat().st_size == 0
            if absent or empty:
                why = "absent" if absent else "empty"
                if success:
                    findings.append(Finding(cid, "fail-plausible",
                                            f"Result claims success but artifact {why}: {path}"))
                else:
                    findings.append(Finding(cid, "missing-artifact",
                                            f"named artifact {why}: {path}"))

    # (iii)/(iv): a dispatched card that reached `done` with no session-id has no
    # execution trail — fold into orphan-claim.
    if cid in dispatched and not card.meta.get("session-id"):
        findings.append(Finding(cid, "orphan-claim",
                                "dispatched card is done but carries no session-id"))
    return findings


def _scan_working_card(repo_root: Path, card, today: datetime.date) -> list[Finding]:
    owner = card.meta.get("owner")
    if not owner:
        return []
    if not _owner_has_recent_ledger(repo_root, str(owner), today):
        return [Finding(str(card.meta.get("id")), "orphan-claim",
                        f"working card owned by {owner} with no dispatch/activity "
                        f"ledger row in the last 2 days")]
    return []


def _iter_cards(directory: Path):
    if not directory.exists():
        return
    for p in sorted(directory.glob("*.md")):
        try:
            yield cards.parse(p)
        except Exception:  # noqa: BLE001 — a malformed card is not sentinel's job to fix.
            continue


def reconcile_scan(repo_root, *, now: datetime.datetime | None = None):
    """Pure scan: return (findings, new_cursor). Never writes. `findings` covers
    `done` cards with a key strictly greater than the stored cursor, plus every
    in-flight `working` card (orphan detection). `new_cursor` is the max `done`
    key observed (>= the old cursor), so the caller can advance it level-triggered."""
    repo_root = Path(repo_root)
    now = now or _now()
    today = now.date()
    cursor = read_cursor(repo_root)
    dispatched = _dispatched_card_ids(repo_root)

    findings: list[Finding] = []
    max_key = cursor
    for card in _iter_cards(repo_root / "queue" / "done"):
        key = _card_key(card.meta.get("id"))
        max_key = max(max_key, key)
        if key <= cursor:
            continue
        findings.extend(_scan_done_card(repo_root, card, dispatched))

    for card in _iter_cards(repo_root / "queue" / "working"):
        findings.extend(_scan_working_card(repo_root, card, today))

    return findings, max_key


def _existing_fingerprints(repo_root: Path, day: str) -> set[tuple[str, str]]:
    """(card, class) pairs already recorded in today's shard — the dedup key."""
    shard = _shard_path(repo_root, "sentinel", day)
    return {(r.get("card", ""), r.get("class", "")) for r in _read_shard(shard)}


@dataclass
class ReconcileReport:
    new_findings: list[Finding] = field(default_factory=list)
    shard: Path | None = None
    cursor: Path | None = None

    @property
    def has_new(self) -> bool:
        return bool(self.new_findings)


def reconcile(repo_root, *, now: datetime.datetime | None = None,
              write: bool = True) -> ReconcileReport:
    """Run the reconciler: scan, append NEW findings to today's audit shard
    (de-duplicated on (card, class)), advance the cursor. `write=False` makes it a
    dry scan (used by tests that assert on findings without touching disk)."""
    repo_root = Path(repo_root)
    now = now or _now()
    day = now.date().isoformat()
    findings, new_cursor = reconcile_scan(repo_root, now=now)

    seen = _existing_fingerprints(repo_root, day)
    new: list[Finding] = []
    for f in findings:
        fp = (f.card, f.cls)
        if fp in seen:
            continue
        seen.add(fp)
        new.append(f)

    report = ReconcileReport(new_findings=new)
    if not write:
        return report

    shard = _shard_path(repo_root, "sentinel", day)
    ts = now.isoformat()
    for f in new:
        _append_audit(repo_root, shard, ["ts", "card", "class", "detail"],
                      {"ts": ts, "card": f.card, "class": f.cls, "detail": f.detail})
    report.shard = shard if new else None
    report.cursor = write_cursor(repo_root, new_cursor)
    return report


def _summarize(new: list[Finding]) -> str:
    if not new:
        return "sentinel reconcile: clean (no new drift)"
    by_class: dict[str, int] = {}
    for f in new:
        by_class[f.cls] = by_class.get(f.cls, 0) + 1
    lines = [f"sentinel reconcile: {len(new)} new finding(s) across "
             f"{len(by_class)} class(es) — dispatcher should file wake-me cards:"]
    for cls in sorted(by_class):
        lines.append(f"  - {cls}: {by_class[cls]}")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# ORGAN (b): usage reservations
# --------------------------------------------------------------------------- #

UNITS = ("steps", "wall-clock-s")
_RES_FIELDS = ["ts", "id", "agent", "step", "unit", "amount", "state"]


def _reservations_shard(repo_root: Path, agent: str, day: str) -> Path:
    return _shard_path(repo_root, f"reservations-{agent}", day)


def _reservation_row(repo_root: Path, agent: str, step: str, unit: str,
                     amount: float, state: str, rid: str,
                     now: datetime.datetime) -> Path:
    if unit not in UNITS:
        raise ValueError(f"unit must be one of {UNITS}")
    if state not in ("held", "settled", "released"):
        raise ValueError("state must be held|settled|released")
    shard = _reservations_shard(repo_root, agent, now.date().isoformat())
    _append_audit(repo_root, shard, _RES_FIELDS, {
        "ts": now.isoformat(), "id": rid, "agent": agent, "step": step,
        "unit": unit, "amount": amount, "state": state,
    })
    return shard


def reserve(repo_root, agent: str, step: str, unit: str, amount: float,
            *, now: datetime.datetime | None = None, rid: str | None = None) -> str:
    """Hold a reservation before an expensive step. Returns the reservation id
    (`settle`/`release` reference it). Appends a `state=held` row."""
    now = now or _now()
    rid = rid or secrets.token_hex(6)
    _reservation_row(repo_root, agent, step, unit, float(amount), "held", rid, now)
    return rid


def settle(repo_root, agent: str, step: str, unit: str, amount: float, rid: str,
           *, now: datetime.datetime | None = None) -> str:
    """Record actual consumption for reservation `rid` (may differ from the held
    amount). Appends a `state=settled` row; the settle amount is what `check` counts."""
    now = now or _now()
    _reservation_row(repo_root, agent, step, unit, float(amount), "settled", rid, now)
    return rid


def release(repo_root, agent: str, step: str, unit: str, rid: str,
            *, now: datetime.datetime | None = None) -> str:
    """Cancel reservation `rid` unused. Appends a `state=released` row (amount 0);
    the matching held amount stops counting toward usage."""
    now = now or _now()
    _reservation_row(repo_root, agent, step, unit, 0.0, "released", rid, now)
    return rid


def _read_reservations(repo_root: Path, day: str) -> list[dict]:
    base = _audit_dir(repo_root)
    rows: list[dict] = []
    if not base.exists():
        return rows
    for shard in sorted(base.glob(f"reservations-*-{day}.tsv")):
        rows.extend(_read_shard(shard))
    return rows


def usage_by_unit(repo_root, *, now: datetime.datetime | None = None) -> dict:
    """Today's usage per unit. A reservation counts by its terminal disposition:
    `settled` uses the settled amount; `released` counts 0; a still-`held`
    reservation counts its held amount (pessimistic — it may still be running).
    Correlated by reservation id (id-per-lifecycle), so a held→settled pair is
    counted once, at the settled amount."""
    now = now or _now()
    day = now.date().isoformat()
    rows = _read_reservations(repo_root, day)

    # Group by id; last terminal state wins.
    by_id: dict[str, dict] = {}
    for r in rows:
        rid = r.get("id") or ""
        unit = r.get("unit") or ""
        try:
            amount = float(r.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        state = r.get("state") or ""
        rec = by_id.setdefault(rid, {"unit": unit, "held": 0.0,
                                     "settled": None, "released": False})
        if state == "held":
            rec["held"] = amount
            rec["unit"] = unit or rec["unit"]
        elif state == "settled":
            rec["settled"] = amount
            rec["unit"] = unit or rec["unit"]
        elif state == "released":
            rec["released"] = True

    totals: dict[str, float] = {u: 0.0 for u in UNITS}
    for rec in by_id.values():
        unit = rec["unit"] or "steps"
        if rec["settled"] is not None:
            effective = rec["settled"]
        elif rec["released"]:
            effective = 0.0
        else:
            effective = rec["held"]
        totals[unit] = totals.get(unit, 0.0) + effective
    return totals


def _caps(repo_root: Path) -> dict:
    """OPTIONAL caps from budget.yaml. Absent key ⇒ no cap (never invent a default)."""
    f = Path(repo_root) / "governance" / "budget.yaml"
    caps: dict[str, float] = {}
    if not f.exists():
        return caps
    import yaml
    data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    if "daily_step_limit" in data:
        caps["steps"] = float(data["daily_step_limit"])
    if "daily_wallclock_limit_s" in data:
        caps["wall-clock-s"] = float(data["daily_wallclock_limit_s"])
    return caps


@dataclass
class UsageReport:
    totals: dict
    caps: dict
    breaches: list  # list[(unit, used, cap)]
    stop_written: Path | None = None

    @property
    def breached(self) -> bool:
        return bool(self.breaches)


def usage_check(repo_root, *, now: datetime.datetime | None = None,
                enforce: bool = False) -> UsageReport:
    """Sum today's held+settled per unit; flag any that exceed an OPTIONAL cap.
    `enforce=True` writes the STOP freeze on breach (the dispatcher's flag once
    trust exists — default OFF, conservative)."""
    repo_root = Path(repo_root)
    totals = usage_by_unit(repo_root, now=now)
    caps = _caps(repo_root)
    breaches = [(u, totals.get(u, 0.0), caps[u])
                for u in caps if totals.get(u, 0.0) > caps[u]]
    stop = None
    if breaches and enforce:
        stop = repo_root / "STOP"
        detail = "; ".join(f"{u}={used} > cap {cap}" for u, used, cap in breaches)
        stop.write_text(
            f"# STOP written by sentinel usage --enforce at {(now or _now()).isoformat()}\n"
            f"# daily usage cap breached: {detail}\n", encoding="utf-8")
    return UsageReport(totals=totals, caps=caps, breaches=breaches, stop_written=stop)


# --------------------------------------------------------------------------- #
# ORGAN (b'): loop circuit-breaker
# --------------------------------------------------------------------------- #
#
# JSONL action-log schema (one object per line):
#     {"ts": <iso|epoch>, "agent": <str>, "tool": <str>, "args": <object>}
# A loop = the same `tool` with the same canonical-args hash repeated >= N times
# consecutively (no intervening distinct action). Canonicalization drops volatile
# keys (ts/nonce/timestamp/request_id) so a genuine retry with the SAME arguments
# trips, while a retry with DIFFERENT arguments (progress) does not.

_VOLATILE_KEYS = frozenset({"ts", "nonce", "timestamp", "request_id"})


def _strip_volatile(obj):
    if isinstance(obj, dict):
        return {k: _strip_volatile(v) for k, v in obj.items()
                if k not in _VOLATILE_KEYS}
    if isinstance(obj, list):
        return [_strip_volatile(v) for v in obj]
    return obj


def canonical_args_hash(args) -> str:
    """Stable hash of `args` ignoring volatile keys; sorted-JSON, so key order and
    the volatile fields never change the fingerprint."""
    cleaned = _strip_volatile(args if args is not None else {})
    blob = json.dumps(cleaned, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@dataclass
class Fingerprint:
    agent: str
    tool: str
    args_hash: str
    count: int
    first_index: int
    last_index: int


def detect_loops(events, n: int = 3) -> list[Fingerprint]:
    """Return fingerprints for every maximal consecutive run of the same
    (agent, tool, canonical-args-hash) of length >= n. Pure function."""
    fingerprints: list[Fingerprint] = []
    run_key = None
    run_start = 0
    run_len = 0

    def flush(end_index: int):
        if run_len >= n and run_key is not None:
            agent, tool, h = run_key
            fingerprints.append(Fingerprint(agent=agent, tool=tool, args_hash=h,
                                            count=run_len, first_index=run_start,
                                            last_index=end_index))

    for i, ev in enumerate(events):
        key = (ev.get("agent", ""), ev.get("tool", ""),
               canonical_args_hash(ev.get("args")))
        if key == run_key:
            run_len += 1
        else:
            flush(i - 1)
            run_key = key
            run_start = i
            run_len = 1
    flush(len(events) - 1)
    return fingerprints


def load_jsonl(path: Path) -> list[dict]:
    events: list[dict] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        events.append(json.loads(line))
    return events


# --------------------------------------------------------------------------- #
# CLI (preamble-gated on entry — STOP supremacy)
# --------------------------------------------------------------------------- #

def _preamble_blocked(repo_root: Path, env=None) -> list[str]:
    return preamble.check(Path(repo_root), env=env, cost_today_fn=_COST_FN)


def _cmd_reconcile(args) -> int:
    report = reconcile(Path(args.repo))
    print(_summarize(report.new_findings))
    return EXIT_FINDINGS if report.has_new else EXIT_CLEAN


def _cmd_usage(args) -> int:
    repo = Path(args.repo)
    if args.usage_cmd == "reserve":
        rid = reserve(repo, args.agent, args.step, args.unit, args.amount)
        print(f"reserved {args.amount} {args.unit} for {args.agent}/{args.step} id={rid}")
        return EXIT_CLEAN
    if args.usage_cmd == "settle":
        settle(repo, args.agent, args.step, args.unit, args.amount, args.id)
        print(f"settled {args.amount} {args.unit} id={args.id}")
        return EXIT_CLEAN
    if args.usage_cmd == "release":
        release(repo, args.agent, args.step, args.unit, args.id)
        print(f"released id={args.id}")
        return EXIT_CLEAN
    # check
    rep = usage_check(repo, enforce=args.enforce)
    for unit, used in sorted(rep.totals.items()):
        cap = rep.caps.get(unit)
        cap_s = f"cap {cap}" if cap is not None else "no cap"
        print(f"  {unit}: {used} ({cap_s})")
    if rep.breached:
        detail = "; ".join(f"{u} {used} > {cap}" for u, used, cap in rep.breaches)
        print(f"BREACH: {detail}"
              + (f" — STOP written at {rep.stop_written}" if rep.stop_written else ""))
        return EXIT_BREACH
    print("usage: within caps")
    return EXIT_CLEAN


def _cmd_loops(args) -> int:
    events = load_jsonl(Path(args.log))
    fps = detect_loops(events, n=args.n)
    if not fps:
        print(f"loops: clean ({len(events)} events, no run >= {args.n})")
        return EXIT_CLEAN
    print(f"loops: {len(fps)} fingerprint(s) (run >= {args.n}):")
    for fp in fps:
        print(f"  - agent={fp.agent} tool={fp.tool} count={fp.count} "
              f"hash={fp.args_hash[:12]} idx[{fp.first_index}:{fp.last_index}]")
    return EXIT_FINDINGS


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Sentinel — fleet immune system (report-only)")
    ap.add_argument("--repo", default=".")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("reconcile", help="DESIRED-vs-OBSERVED drift scan")

    up = sub.add_parser("usage", help="reservation ledger + cap check")
    us = up.add_subparsers(dest="usage_cmd", required=True)
    for name in ("reserve", "settle"):
        p = us.add_parser(name)
        p.add_argument("--agent", required=True)
        p.add_argument("--step", required=True)
        p.add_argument("--unit", required=True, choices=UNITS)
        p.add_argument("--amount", required=True, type=float)
        if name == "settle":
            p.add_argument("--id", required=True)
    pr = us.add_parser("release")
    pr.add_argument("--agent", required=True)
    pr.add_argument("--step", required=True)
    pr.add_argument("--unit", required=True, choices=UNITS)
    pr.add_argument("--id", required=True)
    pc = us.add_parser("check")
    pc.add_argument("--enforce", action="store_true",
                    help="write STOP on breach (dispatcher's flag; default OFF)")

    lp = sub.add_parser("loops", help="loop circuit-breaker over a JSONL action log")
    lp.add_argument("--log", required=True)
    lp.add_argument("--n", type=int, default=3)

    args = ap.parse_args(argv)

    problems = _preamble_blocked(Path(args.repo))
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return EXIT_PREAMBLE

    if args.cmd == "reconcile":
        return _cmd_reconcile(args)
    if args.cmd == "usage":
        return _cmd_usage(args)
    if args.cmd == "loops":
        return _cmd_loops(args)
    ap.error("unknown command")  # pragma: no cover
    return EXIT_CLEAN  # pragma: no cover


if __name__ == "__main__":
    sys.exit(main())
