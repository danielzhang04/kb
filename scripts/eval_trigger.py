"""Report-only eval trigger — changed paths -> affected agent eval suites.

This is a REPORT, never a gate: `--run` executes deterministic cards for every
affected suite and prints failures, but the CLI exit code is always 0, NO
MATTER WHAT — a failing card, a suite that crashes outright, an unwritable
`--report-out` path, all degrade to a printed diagnostic, never a non-zero
exit. Nothing here may block a commit, a merge, or a dispatch (loop-design-
check: a trigger reports; it never blocks or remediates on its own).

Mapping rules (`affected_suites`) — keys are always REAL agent ids (never the
literal `_fleet`; see below):
    kit/**  or  skills/curated/**  or  evals/agents/_fleet/**
                                       -> EVERY real agent suite (every
                                          directory under evals/agents/ except
                                          `_fleet` itself — a shared kit/skill/
                                          fleet-baseline change can affect any
                                          agent)
    agents/<id>.md                    -> that agent's own suite
    evals/agents/<id>/**  (id != _fleet) -> that suite

`_fleet` is EXCLUDED from direct suite enumeration/execution: it is not a
standalone runnable target (its cards read `{agent_id}`, which only resolves
under `agent_evals.run_suite(..., fleet=True, agent_id=<real id>)` — running
it "as itself" would substitute the literal string `_fleet` and false-red on
e.g. `memory/_fleet.md`). Instead, every mapped agent id's `--run` step
executes BOTH that agent's own suite AND the shared fleet baseline targeted at
it (`run_suite(root, agent_id, fleet=True)`).

`--run` reuses `scripts/agent_evals.run_suite` (deterministic judges only,
`judge: model` cards excluded by default) — never a parallel runner. It calls
`preamble.check` first (the constitution's STOP/API-key/budget gate); on a
preamble failure card execution is SKIPPED (the mapping above is still
printed) rather than the CLI ever returning non-zero.

Public API:
    affected_suites(repo_root, git_range) -> dict[str, list[str]]
CLI:
    py -3 -m scripts.eval_trigger --range <git-range> [--run] [--report-out PATH]
"""
from __future__ import annotations

import argparse
import datetime
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `py -3 -m scripts.eval_trigger`

import agent_evals  # noqa: E402
import preamble  # noqa: E402

_AGENT_DEF_RE = re.compile(r"^agents/([^/]+)\.md$")
_SUITE_DIR_RE = re.compile(r"^evals/agents/([^/]+)/")
_KIT_OR_SKILLS_RE = re.compile(r"^(kit/|skills/curated/)")


class EvalTriggerError(Exception):
    """git (or repo state) prevented computing the change set."""


# --------------------------------------------------------------------------- #
# mapping                                                                      #
# --------------------------------------------------------------------------- #
def _changed_paths(repo_root: Path, git_range: str) -> list[str]:
    try:
        res = subprocess.run(
            ["git", "diff", "--name-only", git_range],
            cwd=str(repo_root), capture_output=True, text=True, timeout=30)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as err:
        raise EvalTriggerError(f"git diff failed: {err}") from err
    if res.returncode != 0:
        raise EvalTriggerError(f"git diff failed: {res.stderr.strip()}")
    return [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]


def _valid_suite_id(aid: str) -> bool:
    """Mirrors `agent_evals.suite_dir`'s own validation exactly, so a change
    matching a structurally-invalid id (e.g. `agents/.template.md` -> id
    `.template`) never enters the mapping at all — `suite_dir`/`run_suite`
    would raise on it, and this is a report, so we filter instead of crash."""
    return bool(aid) and "/" not in aid and "\\" not in aid and not aid.startswith(".")


def _real_agent_suite_ids(repo_root: Path) -> list[str]:
    """Every directory under `evals/agents/` that is a REAL, runnable agent
    suite — `_fleet` is deliberately excluded (see module docstring)."""
    d = Path(repo_root) / "evals" / "agents"
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.iterdir()
                 if p.is_dir() and p.name != agent_evals.FLEET_SUITE_ID
                 and _valid_suite_id(p.name))


def affected_suites(repo_root: Path, git_range: str) -> dict[str, list[str]]:
    """`{agent_id: [reason-path, ...]}` for the given git range. Report-only:
    raises `EvalTriggerError` only when the change set itself cannot be
    computed (bad range, git unavailable) — never on an empty or unaffected
    range, which simply yields `{}`. Keys are always real agent ids (see
    module docstring for why `_fleet` never appears as a key)."""
    repo_root = Path(repo_root)
    changed = _changed_paths(repo_root, git_range)
    mapping: dict[str, list[str]] = {}

    def _add(suite_id: str, path: str) -> None:
        if not _valid_suite_id(suite_id):
            return
        bucket = mapping.setdefault(suite_id, [])
        if path not in bucket:
            bucket.append(path)

    fleet_prefix = f"evals/agents/{agent_evals.FLEET_SUITE_ID}/"
    broad_hits = [p for p in changed
                  if _KIT_OR_SKILLS_RE.match(p) or p.startswith(fleet_prefix)]
    if broad_hits:
        for suite_id in _real_agent_suite_ids(repo_root):
            for p in broad_hits:
                _add(suite_id, p)

    for p in changed:
        m = _AGENT_DEF_RE.match(p)
        if m:
            _add(m.group(1), p)
            continue
        m = _SUITE_DIR_RE.match(p)
        if m:
            sid = m.group(1)
            if sid == agent_evals.FLEET_SUITE_ID:
                continue  # already fanned out above (broad_hits) — never a direct key
            _add(sid, p)

    return mapping


# --------------------------------------------------------------------------- #
# safe execution — the exit-0 law applies to EVERY suite run, individually     #
# --------------------------------------------------------------------------- #
def _safe_run_suite(repo_root: Path, suite_id: str, *, fleet: bool) -> "agent_evals.SuiteReport":
    """`run_suite`, but a crash (bad id, unexpected exception, anything) is
    caught and turned into a REFUSED report instead of propagating — a report
    tool must never die because one suite is broken."""
    label = "fleet" if fleet else "own"
    try:
        return agent_evals.run_suite(repo_root, suite_id, fleet=fleet)
    except Exception as err:  # noqa: BLE001 — exit-0 law: nothing here may escape
        return agent_evals.SuiteReport(suite_id, [], f"{label} suite crashed: {err!r}")


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
def _render_mapping(mapping: dict[str, list[str]]) -> str:
    if not mapping:
        return "eval_trigger: no affected suites in range"
    lines = ["affected suites:"]
    for suite_id in sorted(mapping):
        lines.append(f"  {suite_id}: {', '.join(mapping[suite_id])}")
    return "\n".join(lines)


def _head_sha(repo_root: Path) -> str:
    try:
        res = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(repo_root),
                             capture_output=True, text=True, timeout=15)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return "unknown"
    return res.stdout.strip() if res.returncode == 0 else "unknown"


def _report_suite_section(suite_id: str, label: str,
                          report: "agent_evals.SuiteReport | None") -> tuple[list[str], int, int]:
    lines = [f"### {suite_id} — {label}", "",
            "| card | verdict | hermetic | reason |", "|---|---|---|---|"]
    if report is None or report.reason:
        reason = report.reason if report is not None else "not run (preamble gate failed)"
        lines.append(f"| - | REFUSED | - | {reason} |")
        return lines, 0, 0
    passed = 0
    for card in report.cards:
        verdict = "PASS" if card.passed else "FAIL"
        passed += 1 if card.passed else 0
        lines.append(f"| {card.id} | {verdict} | {'yes' if card.hermetic else 'no'} "
                     f"| {card.reason} |")
    return lines, passed, len(report.cards)


def _render_report(mapping: dict[str, list[str]], git_range: str, repo_root: Path,
                   own_reports: dict[str, "agent_evals.SuiteReport"],
                   fleet_reports: dict[str, "agent_evals.SuiteReport"]) -> str:
    header = [
        "# eval_trigger report",
        "",
        f"- range: `{git_range}`",
        f"- HEAD: `{_head_sha(repo_root)}`",
        f"- generated: {datetime.datetime.now(datetime.timezone.utc).isoformat()}",
        "",
    ]
    if not mapping:
        header.append("No affected suites in range.")
        return "\n".join(header)

    rollup = ["## Rollup", ""]
    body: list[str] = []
    for suite_id in sorted(mapping):
        own = own_reports.get(suite_id)
        fleet = fleet_reports.get(suite_id)
        own_lines, own_pass, own_total = _report_suite_section(suite_id, "own suite", own)
        fleet_lines, fleet_pass, fleet_total = _report_suite_section(suite_id, "fleet baseline",
                                                                      fleet)
        rollup.append(f"- {suite_id}: own {own_pass}/{own_total}, fleet {fleet_pass}/{fleet_total}")
        body.append(f"## {suite_id}")
        body.append("")
        body += own_lines
        body.append("")
        body += fleet_lines
        body.append("")
    rollup.append("")
    return "\n".join(header + rollup + body)


def _safe_cost_fn():
    try:
        import ledger
        return ledger.cost_today
    except ImportError:
        return None


def _force_utf8_stdio() -> None:
    """A Windows cp1252 console raises `UnicodeEncodeError` out of `print()`
    on a non-cp1252 character (e.g. `→`/`中` embedded in a card's `reason`,
    surfaced here via the mapping/report tables that echo `agent_evals`
    `CardResult.reason` strings verbatim). Uncaught, that would exit non-zero
    and break this CLI's HARD exit-0-ALWAYS contract. Reconfiguring both
    streams to UTF-8 with `errors="replace"` at entry makes `print()`
    incapable of raising on encoding. `hasattr` guards environments where
    `.reconfigure` does not exist."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def main(argv=None) -> int:
    _force_utf8_stdio()
    ap = argparse.ArgumentParser(
        prog="eval_trigger",
        description="Report-only mapping: changed paths -> affected agent eval suites")
    ap.add_argument("--range", required=True, dest="git_range", metavar="GIT_RANGE")
    ap.add_argument("--run", action="store_true",
                    help="also run each affected suite's own cards AND the fleet "
                         "baseline targeted at it, printing failures (report-only; "
                         "exit code is always 0)")
    ap.add_argument("--report-out", default=None,
                    help="with --run, write the markdown report here (default: stdout)")
    ap.add_argument("--repo", default=".", help="repo root")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).resolve()

    # Preamble supremacy is called first even though this CLI never blocks on
    # it — a failure only skips --run's card execution below.
    problems = preamble.check(repo_root, cost_today_fn=_safe_cost_fn())
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)

    try:
        mapping = affected_suites(repo_root, args.git_range)
    except EvalTriggerError as err:
        print(f"eval_trigger: {err}", file=sys.stderr)
        mapping = {}

    print(_render_mapping(mapping))

    if args.run:
        own_reports: dict[str, agent_evals.SuiteReport] = {}
        fleet_reports: dict[str, agent_evals.SuiteReport] = {}
        if problems:
            print("skipping card execution: preamble gate failed (report-only; "
                  "the mapping above still stands)", file=sys.stderr)
        else:
            for suite_id in sorted(mapping):
                own = _safe_run_suite(repo_root, suite_id, fleet=False)
                fleet = _safe_run_suite(repo_root, suite_id, fleet=True)
                own_reports[suite_id] = own
                fleet_reports[suite_id] = fleet
                for label, report in (("own", own), ("fleet", fleet)):
                    if report.reason:
                        print(f"suite {suite_id} ({label}): REFUSED — {report.reason}")
                    for card in report.failures:
                        print(f"FAIL {suite_id}/{label}/{card.id}: {card.reason}")

        report_text = _render_report(mapping, args.git_range, repo_root,
                                     own_reports, fleet_reports)
        if args.report_out:
            try:
                out_path = Path(args.report_out)
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(report_text, encoding="utf-8")
                print(f"report written to {args.report_out}")
            except OSError as err:
                # exit-0 law extends to our OWN I/O: an unwritable --report-out
                # path degrades to printing the report, never a crash/nonzero exit.
                print(f"eval_trigger: could not write --report-out ({err}); "
                     "printing report instead", file=sys.stderr)
                print(report_text)
        else:
            print(report_text)

    return 0  # report-only: never blocks, exit 0 ALWAYS


if __name__ == "__main__":
    sys.exit(main())
