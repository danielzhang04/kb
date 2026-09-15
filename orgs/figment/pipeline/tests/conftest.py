"""Keep this directory's ``tmp_path``/``tmp_path_factory`` off the
machine-wide ``%TEMP%`` tree.

``observed_reads.py`` deliberately fingerprints every ancestor directory up
to the local drive root (see ``_check_directory``/``_chain`` there) as a
defense against a directory being swapped for a junction/reparse point
mid-observation. That security property is intentional and this file does
not touch it, weaken it, or work around it in production code.

The problem is purely where these tests physically put their files.
pytest's default ``tmp_path`` -- and any ``--basetemp`` under ``%TEMP%``,
which is what dispatched workers are told to pass -- nests inside
``C:\\Users\\<user>\\AppData\\Local\\Temp``. That directory is machine-wide:
every other process on the box (browsers, installers, other concurrently
running kb workers) writes scratch files directly into it. Any such write
between an ``ObservedReads`` construction and a later check on the *same*
test's tree changes ``%TEMP%``'s own mtime/ctime and false-positives as
"directory identity changed" -- entirely unrelated to the test's own
behavior, and non-deterministic depending on machine load. This is why
three full-suite runs produced three different failure sets, and why a
failing test could pass in isolation: it depends on what else on the
machine happened to touch ``%TEMP%`` during the test's lifetime.

Proven directly (see orgs/figment/pipeline/README.md "Open defects"):
constructing an ``ObservedReads`` rooted several directories below
``%TEMP%`` and then, with no other change, creating one throwaway file
*directly in* ``%TEMP%`` (not anywhere under the test's own root) is
already enough to make that instance's next check raise
``ObservedReadError: directory identity changed``.

Fix: root this directory's ``tmp_path``/``tmp_path_factory`` under a
private, worktree-namespaced folder directly under the user profile instead
of ``%TEMP%``, so these tests no longer share a volatile ancestor with the
rest of the machine (see the comment on ``_SCRATCH_ROOT`` below for why
that specific location, and not %TEMP%, the worktree root, or nested under
this ``tests/`` directory). This only changes *where* the fixture's
directories live -- the ``tmp_path``/``tmp_path_factory`` interface, and
each test's own isolation from other tests, are unchanged. Whatever
``--basetemp`` the invoking harness passes is intentionally overridden here
for this directory only.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from _pytest.tmpdir import TempPathFactory

# Directly under the user profile, NOT under %TEMP% and NOT under
# kb-worktrees/. Two locations were tried and rejected:
#
# - Nested under this worktree's own orgs/figment/pipeline/tests/: some
#   fixtures build trees deep enough that the extra nesting pushed
#   individual file paths past Windows' 260-char MAX_PATH, which makes
#   `Path.is_file()`/`Path.exists()` return False for a file that is really
#   there (proven with
#   test_gen_source_read_authority.py::test_cli_success_with_selected_root_under_canonical_gen_plans,
#   whose relocated checkpoint path was 261 chars there).
# - At the worktree root (C:\Users\<user>\kb-worktrees\<this-worktree>\...):
#   shorter, but kb-worktrees\ itself is a shared ancestor of every worktree
#   on the machine, and other kb workers add/remove sibling worktrees during
#   normal fleet operation (leases, per CLAUDE.md's git-hygiene rules). That
#   is a rarer write than %TEMP%'s constant churn, but it is not zero: it
#   reproduced once in an 11-file, ~400-test combined run
#   (test_figment_train_observed_reads.py::test_checkpoint_candidate_exact_value_default_and_observed_parity
#   failed with "directory identity changed" after passing 3x in isolation
#   and in an earlier interleave).
#
# Rooting one level up, directly under the user profile and namespaced by
# this worktree's own name (so concurrent workers in sibling worktrees don't
# collide on the same scratch directory), leaves only C:\, Users and the
# profile folder itself as ancestors -- none of which are written to by
# routine kb-fleet or OS activity the way %TEMP% or kb-worktrees\ are.
_WORKTREE_ROOT = Path(__file__).resolve().parents[4]
_SCRATCH_ROOT = Path.home() / f".pytest-observed-tmp-{_WORKTREE_ROOT.name}"


@pytest.fixture(scope="session")
def tmp_path_factory(request: pytest.FixtureRequest) -> TempPathFactory:
    """Override pytest's built-in session fixture for this directory only.

    ``tmp_path`` (also built in) depends on ``tmp_path_factory`` by name, so
    every test under this directory that uses ``tmp_path`` or
    ``tmp_path_factory.mktemp(...)`` picks this up automatically with no
    change to the test files themselves.
    """
    factory = TempPathFactory(
        given_basetemp=_SCRATCH_ROOT,
        retention_count=3,
        retention_policy="all",
        trace=request.config.trace.get("tmpdir"),
        _ispytest=True,
    )
    try:
        yield factory
    finally:
        shutil.rmtree(_SCRATCH_ROOT, ignore_errors=True)
