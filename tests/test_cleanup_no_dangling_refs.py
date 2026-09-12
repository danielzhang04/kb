"""No committed, non-archival file names a path this repo has deleted. Archival plan/spec docs
(dated historical records of what was planned/shipped at the time) are excluded deliberately --
rewriting their own history is out of scope; see docs/superpowers/plans/2026-09-11-token-discipline.md
Task 6 for the reasoning. The token-discipline SDD's own plan/evidence docs (and this test file's
own DELETED_PATHS literals) are excluded for the same reason -- see SDD_SELF_ALLOWLIST below."""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# The commit this branch forked from (the project-frame-hooks merge, PR #182). Everything this
# branch deleted is `git diff --diff-filter=D` against it.
CLEANUP_BASE = "f5a9aec2"

# Fallback only -- the four paths Task 6 deleted FIRST, hardcoded so this test still means
# something in a checkout with no git (a source tarball, a sandbox without the binary).
FALLBACK_DELETED_PATHS = [
    "docs/plans/2026-08-18-agent-platform-GOAL-STATE.md",
    "docs/proposals/regrounding-hook.md",
    "docs/proposals/context-lifecycle-hooks.md",
    "docs/proposals/spawn-model-verify-hooks.md",
]


def _derive_deleted_paths() -> tuple[list[str], bool]:
    """Every path this branch deleted, from git (fix wave I2), plus whether git supplied it.

    The hardcoded list covered 4 of the 42 files Task 6 removed, so 38 deletions had no dangling
    reference check at all -- and the 38 were exactly the ones nobody had enumerated by hand,
    i.e. the ones most likely to still be pointed at. Deriving the set means the check cannot
    drift from the cleanup again: delete another file and it is covered on the next run.
    """
    try:
        r = subprocess.run(
            ["git", "-C", str(REPO), "diff", "--diff-filter=D", "--name-only", f"{CLEANUP_BASE}..HEAD"],
            capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.SubprocessError):
        return list(FALLBACK_DELETED_PATHS), False
    if r.returncode != 0:
        return list(FALLBACK_DELETED_PATHS), False
    paths = [line.strip() for line in r.stdout.splitlines() if line.strip()]
    return (paths, True) if paths else (list(FALLBACK_DELETED_PATHS), False)


DELETED_PATHS, DERIVED_FROM_GIT = _derive_deleted_paths()

# Only TRACKED files are ever scanned, so an allowlist entry naming a file this branch DELETED
# excludes nothing and merely reads as though it did (fix wave I2 dropped two such entries:
# docs/superpowers/plans/2026-08-19-wave2-overnight.md and
# docs/plans/2026-08-18-agent-platform-program-spec.md, both deleted by Task 6).
ARCHIVAL_ALLOWLIST = {
    "docs/superpowers/specs/2026-08-19-wave2-overnight-design.md",
    "docs/superpowers/plans/2026-08-18-agent-infra.md",
    "docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md",
    # Closed/shipped plan (PR #182, merged) whose Task 7 section quotes the proposal docs'
    # OLD status lines verbatim as a before/after diff of its own historical record -- same
    # "rewriting history in a closed plan is undesirable" principle as the five entries above,
    # just not enumerated when that principle was first written down.
    "docs/superpowers/plans/2026-09-11-project-frame-hooks.md",
    # Dated read-only subsystem analysis (2026-08-17/18) that cites
    # docs/plans/2026-07-20-overnight-keep-awake.md as EVIDENCE of what was shipped at that date
    # ("wired today, live, shipped ... PR #119 MERGED"). Surfaced the moment DELETED_PATHS became
    # the real 42 (fix wave I2) rather than the hand-typed 4. Same archival principle as the
    # entries above: the citation was true when written, and a snapshot that gets edited every
    # time the repo moves is no longer a snapshot.
    "docs/research/_ig-saved/analysis/lifecycle-hooks-hygiene.md",
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


def test_deleted_set_is_derived_from_git_and_covers_the_whole_cleanup():
    """The 42 files Task 6 removed, not the 4 someone typed out. Guards against the set silently
    collapsing back to the fallback (a wrong CLEANUP_BASE, a rewritten range) while every
    assertion above still passes vacuously."""
    assert DERIVED_FROM_GIT, "git did not supply the deleted set -- the fallback is in use"
    assert len(DELETED_PATHS) >= 42, f"derived only {len(DELETED_PATHS)} deleted paths"
    for dead in FALLBACK_DELETED_PATHS:
        assert dead in DELETED_PATHS, f"{dead} missing from the derived set"


def test_archival_allowlist_only_names_files_that_still_exist():
    """An allowlist entry for a path that is gone skips nothing -- it is a comment pretending to
    be a rule. Both allowlists are scanned against tracked files, so every entry must be one."""
    tracked = set(_tracked_files())
    stale = sorted(e for e in (ARCHIVAL_ALLOWLIST | SDD_SELF_ALLOWLIST) if e not in tracked)
    assert not stale, f"allowlist entries naming untracked/deleted files: {stale}"
