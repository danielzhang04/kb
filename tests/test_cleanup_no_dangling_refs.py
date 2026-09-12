"""No committed, non-archival file names a path this repo has deleted. Archival plan/spec docs
(dated historical records of what was planned/shipped at the time) are excluded deliberately --
rewriting their own history is out of scope; see docs/superpowers/plans/2026-09-11-token-discipline.md
Task 6 for the reasoning. The token-discipline SDD's own plan/evidence docs (and this test file's
own DELETED_PATHS literals) are excluded for the same reason -- see SDD_SELF_ALLOWLIST below."""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

DELETED_PATHS = [
    "docs/plans/2026-08-18-agent-platform-GOAL-STATE.md",
    "docs/proposals/regrounding-hook.md",
    "docs/proposals/context-lifecycle-hooks.md",
    "docs/proposals/spawn-model-verify-hooks.md",
]

ARCHIVAL_ALLOWLIST = {
    "docs/superpowers/specs/2026-08-19-wave2-overnight-design.md",
    "docs/superpowers/plans/2026-08-19-wave2-overnight.md",
    "docs/superpowers/plans/2026-08-18-agent-infra.md",
    "docs/plans/2026-08-18-agent-platform-program-spec.md",
    "docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md",
    # Closed/shipped plan (PR #182, merged) whose Task 7 section quotes the proposal docs'
    # OLD status lines verbatim as a before/after diff of its own historical record -- same
    # "rewriting history in a closed plan is undesirable" principle as the five entries above,
    # just not enumerated when that principle was first written down.
    "docs/superpowers/plans/2026-09-11-project-frame-hooks.md",
}

# The token-discipline SDD's own planning/evidence documents necessarily name the exact paths
# THIS cleanup deletes (they are the design record instructing Task 6 to delete them, and the
# evidence trail explaining why) -- self-reference, not a dangling forward pointer. Same
# reasoning task0-probes.md gives for excluding the GOAL-STATE doc from its own candidate list.
SDD_SELF_ALLOWLIST = {
    "docs/superpowers/plans/2026-09-11-token-discipline.md",
    "docs/superpowers/specs/2026-09-11-token-discipline-evidence/task0-probes.md",
    # This test file's own DELETED_PATHS literals, below, must spell out the exact dead paths.
    "tests/test_cleanup_no_dangling_refs.py",
}


def _tracked_files() -> list[str]:
    r = subprocess.run(["git", "-C", str(REPO), "ls-files"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return [line for line in r.stdout.splitlines() if line]


def test_no_committed_file_references_a_deleted_path():
    offenders = []
    for rel in _tracked_files():
        if rel in ARCHIVAL_ALLOWLIST or rel in SDD_SELF_ALLOWLIST or rel.startswith("node_modules/"):
            continue
        full = REPO / rel
        if not full.is_file():
            continue
        try:
            text = full.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for dead in DELETED_PATHS:
            if dead in text:
                offenders.append(f"{rel} references {dead}")
    assert not offenders, "\n".join(offenders)


def test_deleted_paths_no_longer_exist_on_disk():
    for dead in DELETED_PATHS:
        assert not (REPO / dead).exists(), dead
