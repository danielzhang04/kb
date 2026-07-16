import re
from pathlib import Path

ROUTINE = Path(__file__).resolve().parents[1] / "routines" / "nightly.md"


def test_routine_ensures_pyyaml_and_targets_ops():
    text = ROUTINE.read_text(encoding="utf-8")

    # 1. A pyyaml install fallback must be present.
    assert re.search(r"(python -m )?pip install (--user )?pyyaml", text), (
        "routines/nightly.md must contain a pyyaml install fallback line"
    )

    # 2. Every `git push` mention must target ops, never main.
    for line in text.splitlines():
        if "git push" in line:
            assert "main" not in line, (
                f"git push line must not reference main: {line!r}"
            )


def test_routine_uses_new_verifier_and_hash_note():
    text = ROUTINE.read_text(encoding="utf-8")

    # Step 4b must call the new verifier(s), and must NOT reference the removed
    # local-author function (1.2 deleted approved_by_human).
    assert "verify_signed_approval" in text, (
        "step 4b must verify with approvals.py verify_signed_approval"
    )
    assert "approved_by_human" not in text, (
        "the removed approved_by_human must no longer be referenced"
    )

    # The hash note must say the hash binds action + target + work order,
    # not the stale 'only the `## Work order` prose'.
    assert re.search(r"action.{0,40}target.{0,40}work[ -]?order", text,
                     re.IGNORECASE), (
        "hash note must state the hash binds action + target + work order"
    )
    assert "only the `## Work order`" not in text, (
        "stale hash note ('only the `## Work order` prose') must be gone"
    )


def test_routine_push_fallback_is_pr_human_merge():
    text = ROUTINE.read_text(encoding="utf-8")

    # (a) The routine still tries a direct push to ops first, and no push
    #     line anywhere targets main.
    assert "git push origin ops" in text, (
        "routine must attempt a direct `git push origin ops` first"
    )
    for line in text.splitlines():
        if "git push" in line:
            assert "main" not in line, (
                f"git push line must not reference main: {line!r}"
            )

    # (b) On push rejection there is a fallback block that: pushes a dated
    #     claude/ops-sync- branch, opens a PR targeting ops, and writes a
    #     wake-me card noting the PR awaits Daniel's merge.
    assert "claude/ops-sync-" in text, (
        "fallback must push a dated `claude/ops-sync-<date>` branch"
    )
    assert re.search(r"open(s)?\s+a?\s*(pull request|PR)", text, re.IGNORECASE), (
        "fallback must open a pull request"
    )
    assert re.search(r"(target|targeting|into|→|->|base).{0,40}\bops\b", text), (
        "the fallback PR must target the ops branch"
    )
    assert re.search(r"wake-me card", text) and "queue/inbox/" in text, (
        "fallback must write a wake-me card into queue/inbox/"
    )

    # (c) An explicit line stating the routine NEVER merges PRs itself
    #     (human merge only).
    assert re.search(
        r"never merges pull requests|never merge.{0,40}PR", text, re.IGNORECASE
    ), "routine must state it never merges PRs itself"
    assert re.search(r"merging is a human action|human merge", text, re.IGNORECASE), (
        "routine must state merging is a human action"
    )

    # The summary must record which push path was taken.
    assert "DIRECT-PUSH" in text and "PR-AWAITING-HUMAN-MERGE" in text, (
        "routine must state in its summary which push path was taken"
    )
