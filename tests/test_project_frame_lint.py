import os
import subprocess
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "project_frame_lint.py"


def run_lint(root):
    # BOTH ends pinned to UTF-8. The lint's messages contain em dashes, so decoding them depends
    # on what the child encoded with -- which is the parent shell's PYTHONIOENCODING (utf-8 under
    # the Claude Code PowerShell tool, absent under its bash tool, where Python falls back to
    # cp1252). Left to the environment, the em-dash assertions below pass in one shell and fail on
    # mojibake in the other, testing nothing but the terminal. The child is told to emit UTF-8 and
    # the parent decodes UTF-8.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(["python", str(SCRIPT), "--root", str(root)],
                          capture_output=True, text=True, encoding="utf-8", env=env)


def _write(root, project, goal_body, state_body):
    d = root / "orgs" / project
    d.mkdir(parents=True)
    (d / "GOAL.md").write_text(goal_body, encoding="utf-8")
    (d / "STATE.md").write_text(state_body, encoding="utf-8")


GOOD_GOAL = textwrap.dedent("""\
    # demo — GOAL
    _Ruled: 2026-09-01_
    ## North star
    Ship it.
    ## Success conditions
    Tests pass.
    ## Invariants
    Never spend real money.
    ## Governing docs
    docs/x.md
    """)

GOOD_STATE = textwrap.dedent("""\
    # demo — STATE
    _Updated: 2026-09-10 12:00_
    ## Now
    running
    ## Current gate
    review
    ## Decisions
    - 2026-09-11 — example ruling — why
    ## Next
    ship
    ## Blocked
    None
    ## Findings
    none yet
    ## Infra
    n/a
    """)


def test_well_formed_pair_passes(tmp_path):
    _write(tmp_path, "demo", GOOD_GOAL, GOOD_STATE)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout


def test_missing_heading_fails(tmp_path):
    bad_goal = GOOD_GOAL.replace("## Invariants\nNever spend real money.\n", "")
    _write(tmp_path, "demo", bad_goal, GOOD_STATE)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "missing ## Invariants" in r.stdout


def test_malformed_updated_line_fails(tmp_path):
    bad_state = GOOD_STATE.replace("_Updated: 2026-09-10 12:00_", "_Updated: whenever_")
    _write(tmp_path, "demo", GOOD_GOAL, bad_state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "_Updated:_" in r.stdout


def test_state_over_60_lines_fails(tmp_path):
    bloated = GOOD_STATE + ("filler\n" * 60)
    _write(tmp_path, "demo", GOOD_GOAL, bloated)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "max" in r.stdout


def test_no_org_files_is_not_a_failure(tmp_path):
    (tmp_path / "orgs").mkdir()
    r = run_lint(tmp_path)
    assert r.returncode == 0


def test_heading_with_suffix_passes_by_prefix_match(tmp_path):
    """Controller ruling: heading matching is by PREFIX -- `## Current gate (P8)`
    satisfies the required `## Current gate` heading."""
    state = GOOD_STATE.replace("## Current gate\n", "## Current gate (P8)\n")
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout


def test_state_missing_decisions_fails(tmp_path):
    bad_state = GOOD_STATE.replace("## Decisions\n- 2026-09-11 — example ruling — why\n", "")
    _write(tmp_path, "demo", GOOD_GOAL, bad_state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "missing ## Decisions" in r.stdout


def test_decisions_bullet_without_date_fails(tmp_path):
    bad_state = GOOD_STATE.replace(
        "- 2026-09-11 — example ruling — why", "- no date here — example ruling — why"
    )
    _write(tmp_path, "demo", GOOD_GOAL, bad_state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "Decisions bullet 1 lacks the YYYY-MM-DD — ruling — why shape" in r.stdout


def test_decisions_hyphen_separator_passes(tmp_path):
    """The ruling accepts ` - ` as a separator, not only the em dash."""
    state = GOOD_STATE.replace(
        "- 2026-09-11 — example ruling — why", "- 2026-09-11 - example ruling - why"
    )
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout


def test_decisions_annotated_heading_still_validates_bullets(tmp_path):
    """`## Decisions (arc X)` still resolves as `Decisions` -- a well-formed bullet under it
    passes, same as the unannotated heading."""
    state = GOOD_STATE.replace("## Decisions\n", "## Decisions (arc X)\n")
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout


def test_decisions_over_10_bullets_fails(tmp_path):
    bullets = "\n".join(f"- 2026-09-{i:02d} — ruling {i} — why {i}" for i in range(1, 12))
    state = GOOD_STATE.replace(
        "- 2026-09-11 — example ruling — why", bullets
    )
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "Decisions has 11 bullets > 10 max" in r.stdout


def test_heading_prefix_match_requires_word_boundary(tmp_path):
    """`## Nextsteps` must NOT satisfy the required `## Next` heading -- prefix
    matching stops at a word boundary (space or paren), it is not a raw substring
    check."""
    state = GOOD_STATE.replace("## Next\n", "## Nextsteps\n")
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "missing ## Next" in r.stdout


# ── fix wave I1: only `-`/`*` lines are bullets; en dash is a separator ────────────────────────

def test_a_wrapped_bullet_is_one_bullet_not_two(tmp_path):
    """A decision bullet that wraps onto a second line used to be counted as a SECOND bullet and
    then failed the shape check for not starting with a date -- the lint was reading the file's
    line wrapping as its content. One decision is one bullet however it is typed."""
    state = GOOD_STATE.replace(
        "## Decisions\n- 2026-09-11 — example ruling — why\n",
        "## Decisions\n- 2026-09-11 — example ruling — why\n"
        "  continued on a second line because the ruling was long\n",
    )
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout


def test_indented_continuation_lines_do_not_count_towards_the_cap(tmp_path):
    """Ten real bullets, each with a continuation line, is ten bullets -- not twenty."""
    bullets = "".join(
        f"- 2026-09-{day:02d} — ruling {day} — why\n    a wrapped note about ruling {day}\n"
        for day in range(1, 11)
    )
    state = GOOD_STATE.replace("- 2026-09-11 — example ruling — why\n", bullets)
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout


def test_eleven_real_bullets_still_breach_the_cap(tmp_path):
    """The cap itself is untouched: ignoring continuation lines must not ignore bullets."""
    bullets = "".join(f"- 2026-09-{day:02d} — ruling {day} — why\n" for day in range(1, 12))
    state = GOOD_STATE.replace("- 2026-09-11 — example ruling — why\n", bullets)
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "Decisions has 11 bullets > 10 max" in r.stdout


def test_a_malformed_bullet_is_still_caught(tmp_path):
    """Only NON-bullet lines are ignored. A line that starts with `-` is a bullet and is held to
    the shape -- otherwise I1 would have turned the shape check off entirely."""
    state = GOOD_STATE.replace(
        "- 2026-09-11 — example ruling — why\n", "- no date here, just prose\n")
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 1
    assert "lacks the YYYY-MM-DD" in r.stdout


def test_en_dash_is_accepted_as_a_separator(tmp_path):
    """`–` (en dash) is what several editors and agents actually emit; rejecting it made the lint
    fail on correctly-shaped decisions for a reason no one could see in a terminal."""
    state = GOOD_STATE.replace(
        "- 2026-09-11 — example ruling — why\n", "- 2026-09-11 – example ruling – why\n")
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout


def test_asterisk_bullets_are_bullets_too(tmp_path):
    state = GOOD_STATE.replace(
        "- 2026-09-11 — example ruling — why\n", "* 2026-09-11 — example ruling — why\n")
    _write(tmp_path, "demo", GOOD_GOAL, state)
    r = run_lint(tmp_path)
    assert r.returncode == 0, r.stdout
