"""Per-agent eval suites — the canary discipline, new scope (spec §4).

`evals/agents/<agent-id>/*.md` are golden task cards for ONE agent's job. This
module runs them with DETERMINISTIC judges only (`file-exists`,
`output-contains`, `pytest`) — no network, no model calls; the model-judge tier
lives outside this runner by design.

Reused verbatim from `scripts/canary.py` (one discipline, one implementation):
`verify_manifest` / `update_manifest` (called with `subdir=""` because a suite's
cards sit directly in its own directory), the card-file glob, and
`split_frontmatter`. A suite REFUSES to run when its `MANIFEST.sha256` does not
match the cards on disk — someone edited a golden oracle. Re-blessing is a
human-witnessed act (`--update-manifest`, and only on a green suite).

Grade rows land through the UNCHANGED `grade.py` schema in a RESERVED namespace:
`worker="eval-suite"`, `task_type="eval:<agent-id>:<card-id>"`. Because
`promotion.status()` is keyed on `(worker, project, task_type, tier)`, no volume
of eval passes can ever move the agent's own autonomy — tested, not assumed.

Public API:
    suite_dir(repo_root, agent_id)                -> Path
    load_cards(suite_dir)                         -> list[EvalCard]
    run_card(card, repo_root)                     -> CardResult
    run_suite(repo_root, agent_id, ...)           -> SuiteReport
    update_manifest(repo_root, agent_id)          -> Path
CLI:
    py -3 -m scripts.agent_evals run <agent-id> [--record] [--update-manifest]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `py -3 -m scripts.agent_evals`

import canary  # noqa: E402  (manifest + card-parsing machinery, reused not copied)
import grade  # noqa: E402
import preamble  # noqa: E402

EVAL_WORKER = "eval-suite"
EVAL_PROJECT = "kb"
INSPECTOR_ID = canary.INSPECTOR_ID
SUITES_ROOT = ("evals", "agents")

DEFAULT_TIMEOUT = 120        # seconds, `output-contains`
PYTEST_TIMEOUT = 600         # seconds, `pytest` judge

EXIT_OK = canary.EXIT_OK
EXIT_FAIL = canary.EXIT_FAIL
EXIT_TAMPER = canary.EXIT_TAMPER


class EvalCardError(Exception):
    """Malformed eval card."""


# --------------------------------------------------------------------------- #
# card model                                                                   #
# --------------------------------------------------------------------------- #
_REQUIRED_META = ("id", "capability", "judge", "rubric_version", "k", "source",
                  "immutable", "tier")


@dataclass
class EvalCard:
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
    def judge(self) -> str:
        return str(self.meta["judge"])

    @property
    def input(self) -> dict:
        return self.meta.get("input") or {}

    @property
    def k(self) -> int:
        return max(1, int(self.meta.get("k", 1) or 1))

    @property
    def tier(self) -> str:
        return str(self.meta.get("tier") or "T1")

    @property
    def rubric_version(self) -> str:
        return str(self.meta.get("rubric_version", "1"))


def suite_dir(repo_root: Path, agent_id: str) -> Path:
    """`<repo>/evals/agents/<agent-id>/`. The id is a single path segment."""
    aid = str(agent_id)
    if not aid or "/" in aid or "\\" in aid or aid.startswith("."):
        raise ValueError(f"invalid agent id {agent_id!r}")
    return Path(repo_root).joinpath(*SUITES_ROOT, aid)


def parse_card(path: Path) -> EvalCard:
    meta, body = canary.split_frontmatter(path)
    for key in _REQUIRED_META:
        if key not in meta:
            raise EvalCardError(f"{path}: missing required frontmatter field {key!r}")
    return EvalCard(meta=meta, body=body, path=Path(path))


def load_cards(directory: Path) -> list[EvalCard]:
    """Every card in a suite directory, sorted. Uses canary's own card-file glob
    (README excluded) so the loader and the manifest can never disagree about
    which files are golden."""
    return [parse_card(p) for p in canary._canary_files(Path(directory))]


# --------------------------------------------------------------------------- #
# deterministic judges — each: (card, repo_root) -> (passed, detail)           #
# --------------------------------------------------------------------------- #
def _judge_file_exists(card: EvalCard, repo_root: Path):
    rel = card.input.get("path")
    if not rel:
        return False, "file-exists card needs input.path"
    target = Path(repo_root) / str(rel)
    if target.exists():
        return True, f"exists: {rel}"
    return False, f"missing file: {rel}"


def _judge_output_contains(card: EvalCard, repo_root: Path):
    command = card.input.get("command")
    needle = card.input.get("contains")
    if not isinstance(command, list) or not command or needle is None:
        return False, "output-contains card needs a list input.command and input.contains"
    timeout = int(card.input.get("timeout") or DEFAULT_TIMEOUT)
    try:
        res = subprocess.run([str(part) for part in command], cwd=str(repo_root),
                             capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, f"command failed to run: {err}"
    out = (res.stdout or "") + (res.stderr or "")
    if str(needle) in out:
        return True, f"output contains {needle!r}"
    return False, f"output missing {str(needle)!r} (exit {res.returncode})"


def _judge_pytest(card: EvalCard, repo_root: Path):
    test_file = card.input.get("test_file")
    if not test_file:
        return False, "pytest card needs input.test_file"
    cmd = [sys.executable, "-m", "pytest", str(test_file), "-q", "-p", "no:cacheprovider"]
    try:
        res = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True,
                             timeout=PYTEST_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, f"pytest failed to run: {err}"
    tail = [ln for ln in (res.stdout or "").splitlines() if ln.strip()]
    detail = tail[-1].strip() if tail else f"exit {res.returncode}"
    return (res.returncode == 0), f"{test_file}: {detail}"


JUDGES = {
    "file-exists": _judge_file_exists,
    "output-contains": _judge_output_contains,
    "pytest": _judge_pytest,
}


# --------------------------------------------------------------------------- #
# running                                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class CardResult:
    id: str
    passed: bool
    reason: str
    k: int = 1
    capability: str = ""


@dataclass
class SuiteReport:
    agent_id: str
    cards: list = field(default_factory=list)
    reason: str = ""
    tampered: bool = False

    @property
    def passed(self) -> bool:
        return not self.reason and bool(self.cards) and all(c.passed for c in self.cards)

    @property
    def failures(self) -> list:
        return [c for c in self.cards if not c.passed]


def run_card(card: EvalCard, repo_root: Path) -> CardResult:
    """Run one card `k` times; it passes only if every repeat passes (pass^k)."""
    judge = JUDGES.get(card.judge)
    if judge is None:
        return CardResult(card.id, False,
                          f"unknown judge {card.judge!r} (deterministic judges: "
                          f"{', '.join(sorted(JUDGES))})", card.k, card.capability)
    detail = ""
    for _ in range(card.k):
        try:
            ok, detail = judge(card, Path(repo_root))
        except Exception as err:  # a judge crash is a CARD failure, never a suite crash
            return CardResult(card.id, False, f"judge error: {err!r}", card.k,
                              card.capability)
        if not ok:
            return CardResult(card.id, False, detail, card.k, card.capability)
    return CardResult(card.id, True, detail, card.k, card.capability)


def _record_result(record_root: Path, agent_id: str, card: EvalCard,
                   result: CardResult) -> None:
    """One grade row per card, through the pinned schema, in the RESERVED eval
    namespace (never the agent's own worker identity)."""
    grade.record_grade(
        Path(record_root),
        worker=EVAL_WORKER,
        project=EVAL_PROJECT,
        task_type=f"eval:{agent_id}:{card.id}",
        tier=card.tier,
        card_id=card.id,
        score=100.0 if result.passed else 0.0,
        rubric_version=card.rubric_version,
        inspector_id=INSPECTOR_ID,
        **{"pass": result.passed},
    )


def run_suite(repo_root: Path, agent_id: str, *, record: bool = False,
              record_root: Path | None = None, verify: bool = True) -> SuiteReport:
    """Run every card in `evals/agents/<agent-id>/`.

    Refuses (no cards run, no rows recorded) when the suite's MANIFEST.sha256
    does not verify. With `record`, appends one grade row per card to
    `record_root` (defaults to `repo_root`); tests always pass a tmp root."""
    repo_root = Path(repo_root)
    directory = suite_dir(repo_root, agent_id)
    if not directory.is_dir():
        return SuiteReport(agent_id, [], f"no eval suite at evals/agents/{agent_id}/")

    if verify:
        ok, problems = canary.verify_manifest(directory, subdir="")
        if not ok:
            return SuiteReport(agent_id, [],
                               "manifest verification failed: " + "; ".join(problems),
                               tampered=True)
    try:
        cards = load_cards(directory)
    except (EvalCardError, canary.CanaryError) as err:
        return SuiteReport(agent_id, [], f"card parse error: {err}")
    if not cards:
        return SuiteReport(agent_id, [], f"no eval cards in evals/agents/{agent_id}/")

    results: list[CardResult] = []
    for card in cards:
        result = run_card(card, repo_root)
        results.append(result)
        if record:
            _record_result(Path(record_root or repo_root), agent_id, card, result)
    return SuiteReport(agent_id, results)


# --------------------------------------------------------------------------- #
# manifest (human-gated re-bless)                                              #
# --------------------------------------------------------------------------- #
def _manifest_header(agent_id: str) -> tuple[str, ...]:
    return (
        f"# evals/agents/{agent_id}/MANIFEST.sha256 — golden eval-card hashes.",
        "# Re-bless ONLY via `py -3 -m scripts.agent_evals run <agent-id> --update-manifest`",
        "# on a green suite, as a HUMAN-witnessed act: an agent must never silently",
        "# re-bless its own oracle. A mismatch makes the suite refuse to run.",
        "",
    )


def update_manifest(repo_root: Path, agent_id: str) -> Path:
    """(Re)write the suite's MANIFEST.sha256 — canary's writer, suite scope."""
    return canary.update_manifest(suite_dir(repo_root, agent_id), subdir="",
                                  header=_manifest_header(agent_id))


def verify_manifest(repo_root: Path, agent_id: str) -> tuple[bool, list[str]]:
    """Canary's verifier, suite scope."""
    return canary.verify_manifest(suite_dir(repo_root, agent_id), subdir="")


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
def _render_table(report: SuiteReport) -> str:
    if report.reason:
        return f"suite {report.agent_id}: REFUSED — {report.reason}"
    rows = ["card                      k   result  detail", "-" * 72]
    for c in report.cards:
        rows.append(f"{c.id:<24}  {c.k:<2}  {'PASS' if c.passed else 'FAIL':<6}  {c.reason}")
    passed = len(report.cards) - len(report.failures)
    rows.append("-" * 72)
    rows.append(f"{passed}/{len(report.cards)} eval cards passed ({report.agent_id})")
    return "\n".join(rows)


def _safe_cost_fn():
    try:
        import ledger
        return ledger.cost_today
    except ImportError:
        return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="agent_evals", description="Per-agent eval suite runner (deterministic judges)")
    sub = ap.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run one agent's eval suite")
    run.add_argument("agent_id")
    run.add_argument("--record", action="store_true",
                     help="append a grade row per card (worker=eval-suite)")
    run.add_argument("--record-root", default=None,
                     help="ledger root for --record (default: the repo)")
    run.add_argument("--update-manifest", action="store_true",
                     help="re-bless MANIFEST.sha256 — only on a green suite, human-witnessed")
    run.add_argument("--repo", default=".", help="repo root")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).resolve()

    # Preamble supremacy: STOP-file / API-key / budget gate before anything runs.
    problems = preamble.check(repo_root, cost_today_fn=_safe_cost_fn())
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return EXIT_TAMPER

    if args.update_manifest:
        report = run_suite(repo_root, args.agent_id, verify=False)
        if not report.passed:
            print("refusing to re-bless: suite is not green", file=sys.stderr)
            print(_render_table(report), file=sys.stderr)
            return EXIT_FAIL
        path = update_manifest(repo_root, args.agent_id)
        print("WARNING: re-blessing a golden suite is a HUMAN act — a human must witness "
              "this change and commit it deliberately.")
        print(f"updated {path} ({len(report.cards)} cards)")
        return EXIT_OK

    report = run_suite(repo_root, args.agent_id, record=args.record,
                       record_root=Path(args.record_root) if args.record_root else None)
    print(_render_table(report))
    if report.tampered:
        return EXIT_TAMPER
    return EXIT_OK if report.passed else EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())
