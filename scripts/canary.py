"""Canary suite runner — Proving Grounds, fleet-arc Wave B.

`evals/canaries/*.md` are golden task cards with YAML frontmatter (see
`evals/canaries/README.md`). Each declares a `capability`, a hermetic `input`,
and a machine-checkable `expected` outcome. This module runs them ALL in-process
against the repo's own modules (deterministic judges = pure Python execution;
no network, no model calls, a fresh tmp fixture per canary), scores pass@k /
pass^k, and — only under `--record` — appends grade rows through the EXISTING
pinned `grade.record_grade` schema (never a parallel ledger).

Integrity: the runner verifies `evals/MANIFEST.sha256` before it will run a
canary. A hash mismatch means someone edited a "golden" card, so the suite
REFUSES to run (exit 2, `canary-tamper`). `--diff-guard <git-range>` separately
flags any diff in that range touching `evals/` (exit 3). `--update-manifest`
regenerates the manifest, but ONLY when the suite passes — a human-gated act
(documented in the README): agents must not silently re-bless a changed oracle.

CLI entry runs `preamble.check` first (STOP-file supremacy, constitution).

Public API (all hermetic; the only real-tree write is `--record` to the real
grades ledger and `--update-manifest` to MANIFEST.sha256, both explicit CLI acts):
    load_canaries(canary_dir)          -> list[Canary]
    verify_manifest(evals_dir)         -> (ok: bool, problems: list[str])
    update_manifest(evals_dir)         -> Path
    run_canary(canary, repo_root)      -> CanaryResult
    run_all(evals_dir, repo_root, ...) -> Report
    diff_guard(repo_root, git_range)   -> list[str]
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import yaml

import grade
import preamble

MANIFEST_NAME = "MANIFEST.sha256"
CANARY_SUBDIR = "canaries"
INSPECTOR_ID = "inspector@agents.local"
CANARY_WORKER = "canary-suite"

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_TAMPER = 2
EXIT_DIFF = 3


class CanaryError(Exception):
    """Malformed canary card."""


class CanaryTamper(Exception):
    """MANIFEST.sha256 does not match the canary files on disk."""


# --------------------------------------------------------------------------- #
# Canary card model                                                           #
# --------------------------------------------------------------------------- #
@dataclass
class Canary:
    meta: dict
    body: str
    path: Path

    @property
    def id(self) -> str:
        return str(self.meta["id"])

    @property
    def capability(self) -> str:
        return str(self.meta["capability"])

    @property
    def input(self) -> dict:
        return self.meta.get("input") or {}

    @property
    def expected(self) -> dict:
        return self.meta.get("expected") or {}

    @property
    def k(self) -> int:
        return int(self.meta.get("k", 1) or 1)

    @property
    def tier(self) -> str:
        return str(self.meta.get("tier") or "T1")

    @property
    def rubric_version(self) -> str:
        return str(self.meta.get("rubric_version", "1"))


_REQUIRED_META = ("id", "capability", "expected", "judge", "rubric_version",
                  "k", "source", "immutable")


def split_frontmatter(path: Path) -> tuple[dict, str]:
    """(meta, body) for any golden card file — the shared parser for every card
    dialect built on this discipline (canaries here, per-agent eval suites in
    `scripts/agent_evals.py`). Field validation is the caller's job, because the
    required set differs per dialect."""
    text = Path(path).read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    if not lines or lines[0] != "---":
        raise CanaryError(f"{path}: no frontmatter")
    # Split on the first EXACT-line closing fence (`---` at column 0), so an
    # embedded card (whose own `---` lines are indented inside a block scalar)
    # does not truncate the frontmatter.
    close = next((i for i in range(1, len(lines)) if lines[i] == "---"), None)
    if close is None:
        raise CanaryError(f"{path}: unterminated frontmatter")
    meta = yaml.safe_load("\n".join(lines[1:close]))
    if not isinstance(meta, dict):
        raise CanaryError(f"{path}: frontmatter is not a mapping")
    return meta, "\n".join(lines[close + 1:]).lstrip("\n")


def parse_canary(path: Path) -> Canary:
    meta, body = split_frontmatter(path)
    for key in _REQUIRED_META:
        if key not in meta:
            raise CanaryError(f"{path}: missing required frontmatter field {key!r}")
    if meta["capability"] not in CHECKERS:
        raise CanaryError(f"{path}: unknown capability {meta['capability']!r}")
    return Canary(meta=meta, body=body, path=Path(path))


def _canary_files(canary_dir: Path) -> list[Path]:
    """Every canary card in the directory (sorted), excluding the README."""
    return sorted(p for p in Path(canary_dir).glob("*.md") if p.name.lower() != "readme.md")


def load_canaries(canary_dir: Path) -> list[Canary]:
    return [parse_canary(p) for p in _canary_files(canary_dir)]


# --------------------------------------------------------------------------- #
# Manifest (immutability anchor)                                              #
# --------------------------------------------------------------------------- #
def _sha256(path: Path) -> str:
    """Hash a golden text card in its checkout-independent LF form.

    Canary cards are UTF-8 Markdown.  Their manifest is an oracle for text
    content, not for Git's platform-specific CRLF checkout representation.
    """
    content = Path(path).read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(content).hexdigest()


def _manifest_entries(evals_dir: Path, subdir: str = CANARY_SUBDIR) -> list[tuple[str, str]]:
    """(hexdigest, relpath) for every card file, relpath POSIX-style relative
    to evals_dir (so the manifest is stable across OSes). ``subdir`` is where the
    cards live under ``evals_dir``; `""` means the cards sit in ``evals_dir``
    itself (the per-agent suite layout, `evals/agents/<id>/`)."""
    evals_dir = Path(evals_dir)
    card_dir = evals_dir / subdir if subdir else evals_dir
    out: list[tuple[str, str]] = []
    for p in _canary_files(card_dir):
        rel = p.relative_to(evals_dir).as_posix()
        out.append((_sha256(p), rel))
    return out


def _read_manifest(evals_dir: Path) -> dict[str, str]:
    """relpath -> hexdigest from MANIFEST.sha256 ("<hex>  <relpath>" lines)."""
    path = Path(evals_dir) / MANIFEST_NAME
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            out[parts[1]] = parts[0]
    return out


_CANARY_MANIFEST_HEADER = (
    "# evals/MANIFEST.sha256 — golden canary hashes (human-gated regeneration).",
    "# Regenerate ONLY via `py -3 scripts/canary.py --update-manifest` when the suite",
    "# passes and an evals/ change is deliberate. A mismatch fails the suite loud.",
    "",
)


def update_manifest(evals_dir: Path, subdir: str = CANARY_SUBDIR,
                    header: tuple[str, ...] | list[str] | None = None) -> Path:
    """(Re)write MANIFEST.sha256 from the card files on disk. Human-gated act
    (the CLI only calls this after the suite passes). ``header`` lets another
    suite dialect state its own re-bless command; the default is the canary one."""
    evals_dir = Path(evals_dir)
    lines = list(_CANARY_MANIFEST_HEADER if header is None else header)
    lines += [f"{h}  {rel}" for h, rel in _manifest_entries(evals_dir, subdir)]
    path = evals_dir / MANIFEST_NAME
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def verify_manifest(evals_dir: Path, subdir: str = CANARY_SUBDIR) -> tuple[bool, list[str]]:
    """True + [] when every card file matches the manifest EXACTLY (no missing,
    no extra, no changed). Otherwise False + human-readable problem lines."""
    evals_dir = Path(evals_dir)
    if not (evals_dir / MANIFEST_NAME).exists():
        return False, [f"missing {MANIFEST_NAME}"]
    recorded = _read_manifest(evals_dir)
    actual = {rel: h for h, rel in _manifest_entries(evals_dir, subdir)}
    problems: list[str] = []
    for rel, h in actual.items():
        if rel not in recorded:
            problems.append(f"unmanifested canary: {rel}")
        elif recorded[rel] != h:
            problems.append(f"hash mismatch (tampered): {rel}")
    for rel in recorded:
        if rel not in actual:
            problems.append(f"manifested file missing from disk: {rel}")
    return (not problems), problems


# --------------------------------------------------------------------------- #
# Capability checkers — each: (input, expected, repo_root) -> (passed, detail). #
# Every checker is hermetic (its own tmp fixture); none writes the real tree.  #
# --------------------------------------------------------------------------- #
def _check_card_parse(inp, expected, repo_root):
    import cards
    mode = inp.get("mode", "parse")
    if mode == "parse":
        try:
            cards.parse_text(inp["card_text"])
            got = {"ok": True, "error": ""}
        except cards.ValidationError as err:
            got = {"ok": False, "error": str(err)}
        return _match_ok(expected, got)
    if mode == "transition":
        card = cards.new_card("kb", "act", "tgt", inp.get("start_tier", "T1"))
        card.meta["state"] = inp["from_state"]
        if inp.get("owner"):
            card.meta["owner"] = inp["owner"]
        with tempfile.TemporaryDirectory() as td:
            try:
                cards.transition(card, inp["to_state"], Path(td) / "queue")
                got = {"ok": True, "error": ""}
            except cards.ValidationError as err:
                got = {"ok": False, "error": str(err)}
        return _match_ok(expected, got)
    return False, f"unknown card-parse mode {mode!r}"


def _match_ok(expected, got):
    if "ok" in expected and got.get("ok") is not expected["ok"]:
        return False, f"ok mismatch: expected {expected['ok']} got {got}"
    ec = expected.get("error_contains")
    if ec and ec not in (got.get("error") or ""):
        return False, f"error missing {ec!r}: got {got.get('error')!r}"
    return True, "ok"


def _check_routing(inp, expected, repo_root):
    import routing
    policy = inp.get("policy", {})
    override = inp.get("override", {"overrides": []})
    try:
        r = routing.resolve(inp["meta"], inp["role"], inp["tier"], policy, override)
    except routing.RoutingError as err:
        if expected.get("raises") == "RoutingError":
            return True, f"raised RoutingError: {err}"
        return False, f"unexpected RoutingError: {err}"
    if expected.get("raises"):
        return False, f"expected {expected['raises']} but resolved {r.runtime}/{r.model}"
    for key in ("runtime", "model", "source_runtime", "source_model"):
        if key in expected and getattr(r, key) != expected[key]:
            return False, f"{key}: expected {expected[key]!r} got {getattr(r, key)!r}"
    return True, f"resolved {r.runtime}/{r.model} (src {r.source_runtime}/{r.source_model})"


def _check_grade_schema(inp, expected, repo_root):
    import promotion
    mode = inp["mode"]
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        if mode == "record_valid":
            grade.record_grade(root, **inp["fields"])
            rows = promotion.read_grades(root)
            if len(rows) != 1:
                return False, f"expected 1 grade row, got {len(rows)}"
            got_fields = set(rows[0])
            want_fields = set(grade.REQUIRED_FIELDS) | {"ts"}
            if got_fields != want_fields:
                return False, f"schema fields mismatch: {sorted(got_fields)}"
            return True, "recorded pinned-schema row"
        if mode in ("record_extra", "record_missing"):
            try:
                grade.record_grade(root, **inp["fields"])
            except ValueError as err:
                ec = expected.get("error_contains", "")
                return (ec in str(err)), f"raised ValueError: {err}"
            return False, "expected ValueError but record_grade accepted the row"
        if mode == "trust_filter":
            (root / "governance").mkdir(parents=True, exist_ok=True)
            (root / "governance" / "graders.yaml").write_text(
                inp["graders_yaml"], encoding="utf-8")
            for fields in inp["rows"]:
                grade.record_grade(root, **fields)
            trusted = promotion.trusted_grades(root)
            want = expected["trusted_count"]
            return (len(trusted) == want), f"trusted={len(trusted)} want={want}"
    return False, f"unknown grade-schema mode {mode!r}"


def _check_preamble(inp, expected, repo_root):
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        if inp.get("stop_file"):
            (root / "STOP").write_text("frozen", encoding="utf-8")
        env = dict(inp.get("env", {}))
        problems = preamble.check(root, env=env)
        joined = " ; ".join(problems)
        if bool(problems) is not expected.get("has_problems", True):
            return False, f"has_problems mismatch: {problems}"
        ec = expected.get("problem_contains")
        if ec and ec not in joined:
            return False, f"missing {ec!r} in problems: {problems}"
        return True, joined or "no problems"


def _check_promotion(inp, expected, repo_root):
    import promotion
    mode = inp.get("mode", "status")
    if mode == "status":
        verdict = promotion.status(
            inp["worker"], inp["project"], inp["task_type"], inp["tier"],
            inp["rows"], frozen=False)
        return (verdict == expected["verdict"]), f"verdict={verdict}"
    if mode == "frozen":
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "ledgers" / "grades").mkdir(parents=True, exist_ok=True)
            (root / "ledgers" / "grades" / "FROZEN").write_text("frozen", encoding="utf-8")
            frozen = promotion.is_frozen(root)
            verdict = promotion.status(
                inp["worker"], inp["project"], inp["task_type"], inp["tier"],
                inp.get("rows", []), frozen=frozen)
            ok = frozen and verdict == expected["verdict"]
            return ok, f"frozen={frozen} verdict={verdict}"
    return False, f"unknown promotion mode {mode!r}"


def _check_ledger(inp, expected, repo_root):
    import ledger
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        mode = inp.get("mode", "roundtrip")
        if mode == "roundtrip":
            rec = inp["record"]
            ledger.append(root, inp["kind"], inp["agent"], rec)
            day = datetime.date.today().isoformat()
            rows = ledger.read_day(root, inp["kind"], day)
            hit = any(all(str(row.get(k)) == str(v) for k, v in rec.items()) for row in rows)
            return hit, f"read back {len(rows)} row(s)"
        if mode == "cost_today":
            for cost in inp["costs"]:
                ledger.append(root, "cost", inp.get("agent", "w"), cost)
            total = ledger.cost_today(root)
            return (abs(total - expected["total"]) < 1e-6), f"cost_today={total}"
    return False, f"unknown ledger mode {mode!r}"


def _check_reconcile(inp, expected, repo_root):
    import reconcile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)

        def git(*args):
            subprocess.run(["git", *args], cwd=root, check=True,
                           capture_output=True, text=True)

        try:
            git("init")
        except (FileNotFoundError, subprocess.CalledProcessError) as err:
            return False, f"git unavailable: {err}"
        git("config", "user.email", inp.get("author_email", "worker@evil.local"))
        git("config", "user.name", "Wrong Grader")
        git("config", "commit.gpgsign", "false")
        git("config", "core.autocrlf", "false")

        gdir = root / "ledgers" / "grades"
        gdir.mkdir(parents=True, exist_ok=True)
        header = "\t".join(sorted(grade.REQUIRED_FIELDS | {"ts"}))
        row = inp["grade_row"]
        line = "\t".join(str(row[k]) for k in sorted(grade.REQUIRED_FIELDS | {"ts"}))
        (gdir / inp.get("shard", "worker-2026-07-19.tsv")).write_text(
            header + "\n" + line + "\n", encoding="utf-8")
        git("add", "-A")
        git("commit", "-m", "add grade row (wrong author)")

        res = reconcile.reconcile(root, tier="desktop")
        ok = res.frozen and len(res.quarantined) >= expected.get("min_quarantined", 1)
        return ok, f"frozen={res.frozen} quarantined={len(res.quarantined)}"


def _check_triage(inp, expected, repo_root):
    import triage_rules
    label = triage_rules.classify(inp["message"])
    return (label == expected["label"]), f"label={label}"


def _check_eval_namespace_isolation(inp, expected, repo_root):
    """`scripts/agent_evals.py`'s core guarantee (T5/T6), pinned as a permanent
    Proving Grounds regression: a hermetic per-agent eval suite is seeded and
    blessed in a tmp tree, run+recorded N times (worker=eval-suite,
    task_type=eval:<agent_id>:<card_id>), and the target agent's OWN real
    task_type/tier promotion verdict must be byte-identical to the zero-rows
    baseline — eval rows can never move an agent's own autonomy."""
    import agent_evals
    import promotion
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        agent_id = inp.get("agent_id", "demo-agent")
        card_id = inp.get("card_id", "smoke")
        (root / "ANCHOR.md").write_text("x\n", encoding="utf-8")
        suite = root / "evals" / "agents" / agent_id
        suite.mkdir(parents=True)
        card_text = (
            "---\n"
            f"id: {card_id}\n"
            "capability: agent-baseline\n"
            "judge: file-exists\n"
            'rubric_version: "1"\n'
            "k: 1\n"
            "source: curated\n"
            "immutable: true\n"
            "tier: T1\n"
            "input:\n"
            "  path: ANCHOR.md\n"
            "---\n"
            f"# {card_id}\n"
        )
        (suite / f"{card_id}.md").write_text(card_text, encoding="utf-8")
        agent_evals.update_manifest(root, agent_id)

        record_root = root / "ledgerhome"
        repeats = int(inp.get("repeats", 40))
        for _ in range(repeats):
            report = agent_evals.run_suite(root, agent_id, record=True,
                                           record_root=record_root)
            if not report.passed:
                return False, f"seeded eval suite unexpectedly red: {report.reason}"
        rows = promotion.read_grades(record_root)
        if len(rows) != repeats:
            return False, f"expected {repeats} recorded rows, got {len(rows)}"

        real_task_type = inp.get("real_task_type", "build")
        real_tier = inp.get("real_tier", "T2")
        baseline = promotion.status(agent_id, "kb", real_task_type, real_tier, [],
                                    frozen=False)
        verdict = promotion.status(agent_id, "kb", real_task_type, real_tier, rows,
                                   frozen=False)
        want = expected.get("verdict", baseline)
        ok = (verdict == baseline == want)
        return ok, f"baseline={baseline} verdict={verdict} rows={len(rows)}"


CHECKERS = {
    "card-parse": _check_card_parse,
    "routing-resolution": _check_routing,
    "grade-schema": _check_grade_schema,
    "preamble-gate": _check_preamble,
    "promotion-decide": _check_promotion,
    "ledger-shard": _check_ledger,
    "reconcile-quarantine": _check_reconcile,
    "triage-taxonomy": _check_triage,
    "eval-namespace-isolation": _check_eval_namespace_isolation,
}


# --------------------------------------------------------------------------- #
# Running                                                                     #
# --------------------------------------------------------------------------- #
@dataclass
class CanaryResult:
    id: str
    capability: str
    passes: int
    k: int
    details: list

    @property
    def pass_at_k(self) -> float:
        return self.passes / self.k if self.k else 0.0

    @property
    def pass_hat_k(self) -> bool:
        """pass^k — every one of the k repeats passed."""
        return self.k > 0 and self.passes == self.k

    @property
    def passed(self) -> bool:
        return self.pass_hat_k


@dataclass
class Report:
    results: list

    @property
    def all_pass(self) -> bool:
        return all(r.passed for r in self.results)

    @property
    def failures(self) -> list:
        return [r for r in self.results if not r.passed]


def run_canary(canary: Canary, repo_root: Path) -> CanaryResult:
    checker = CHECKERS[canary.capability]
    passes = 0
    details: list = []
    for _ in range(canary.k):
        try:
            ok, detail = checker(canary.input, canary.expected, repo_root)
        except Exception as err:  # a checker crash is a canary FAILURE, never a suite crash
            ok, detail = False, f"checker error: {err!r}"
        passes += 1 if ok else 0
        details.append(detail)
    return CanaryResult(canary.id, canary.capability, passes, canary.k, details)


def _record_result(record_root: Path, canary: Canary, result: CanaryResult) -> None:
    """Append a grade row for one canary result through the pinned schema."""
    grade.record_grade(
        record_root,
        worker=CANARY_WORKER,
        project="kb",
        task_type=f"canary:{canary.capability}",
        tier=canary.tier,
        card_id=canary.id,
        score=100.0 if result.passed else 0.0,
        rubric_version=canary.rubric_version,
        inspector_id=INSPECTOR_ID,
        **{"pass": result.passed},
    )


def run_all(evals_dir: Path, repo_root: Path, *, record: bool = False,
            record_root: Path | None = None, verify: bool = True) -> Report:
    """Run every canary. Verifies the manifest first (raises CanaryTamper on a
    mismatch — the suite refuses to run tampered oracles). With ``record`` it
    also appends a grade row per canary to ``record_root`` (defaults to
    ``repo_root``); tests always pass a tmp ``record_root``."""
    evals_dir = Path(evals_dir)
    if verify:
        ok, problems = verify_manifest(evals_dir)
        if not ok:
            raise CanaryTamper("; ".join(problems))
    results = []
    for canary in load_canaries(evals_dir / CANARY_SUBDIR):
        result = run_canary(canary, repo_root)
        results.append(result)
        if record:
            _record_result(Path(record_root or repo_root), canary, result)
    return Report(results)


# --------------------------------------------------------------------------- #
# Diff guard (test-tamper detection over a git range)                         #
# --------------------------------------------------------------------------- #
def diff_guard(repo_root: Path, git_range: str) -> list[str]:
    """Files under ``evals/`` changed across ``git_range`` (POSIX paths, sorted).
    A non-empty result means a work branch edited a golden oracle."""
    try:
        res = subprocess.run(
            ["git", "diff", "--name-only", git_range],
            cwd=str(repo_root), capture_output=True, text=True, timeout=30)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as err:
        raise CanaryError(f"git diff failed: {err}") from err
    if res.returncode != 0:
        raise CanaryError(f"git diff failed: {res.stderr.strip()}")
    changed = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]
    return sorted(p for p in changed if p == "evals" or p.startswith("evals/"))


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #
def _render_table(report: Report) -> str:
    rows = ["capability                pass@k  pass^k  canary",
            "-" * 64]
    for r in report.results:
        mark = "PASS" if r.passed else "FAIL"
        rows.append(f"{r.capability:<24}  {r.pass_at_k:>5.2f}   {mark:<5}  {r.id}")
        if not r.passed:
            rows.append(f"    -> {r.details[-1]}")
    total = len(report.results)
    passed = total - len(report.failures)
    rows.append("-" * 64)
    rows.append(f"{passed}/{total} canaries passed")
    return "\n".join(rows)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Proving Grounds canary runner (Wave B)")
    ap.add_argument("--all", action="store_true", help="run every canary (report-only)")
    ap.add_argument("--record", action="store_true",
                    help="with --all, also append grade rows via record_grade")
    ap.add_argument("--update-manifest", action="store_true",
                    help="regenerate MANIFEST.sha256 (only when the suite passes)")
    ap.add_argument("--diff-guard", metavar="GIT_RANGE",
                    help="flag any diff in the range touching evals/ (exit 3)")
    ap.add_argument("--repo", default=".", help="repo root")
    ap.add_argument("--evals", default=None, help="evals dir (default <repo>/evals)")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).resolve()
    evals_dir = Path(args.evals).resolve() if args.evals else repo_root / "evals"

    # Preamble supremacy: STOP-file / API-key / budget gate before anything runs.
    problems = preamble.check(repo_root, cost_today_fn=_safe_cost_fn())
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return EXIT_TAMPER

    if args.diff_guard:
        try:
            hits = diff_guard(repo_root, args.diff_guard)
        except CanaryError as err:
            print(f"diff-guard error: {err}", file=sys.stderr)
            return EXIT_TAMPER
        if hits:
            print("canary-diff: evals/ changed in range:")
            for h in hits:
                print(f"  {h}")
            return EXIT_DIFF
        print("canary-diff: clean (no evals/ changes in range)")
        return EXIT_OK

    if args.update_manifest:
        report = run_all(evals_dir, repo_root, verify=False)
        if not report.all_pass:
            print("refusing to update manifest: suite is not green", file=sys.stderr)
            print(_render_table(report), file=sys.stderr)
            return EXIT_FAIL
        path = update_manifest(evals_dir)
        print(f"updated {path} ({len(load_canaries(evals_dir / CANARY_SUBDIR))} canaries)")
        return EXIT_OK

    # default / --all: run the suite.
    try:
        report = run_all(evals_dir, repo_root, record=args.record)
    except CanaryTamper as err:
        print(f"canary-tamper: {err}", file=sys.stderr)
        return EXIT_TAMPER
    print(_render_table(report))
    return EXIT_OK if report.all_pass else EXIT_FAIL


def _safe_cost_fn():
    try:
        import ledger
        return ledger.cost_today
    except ImportError:
        return None


if __name__ == "__main__":
    sys.exit(main())
