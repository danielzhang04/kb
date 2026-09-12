import subprocess
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "project_frame_lint.py"


def run_lint(root):
    return subprocess.run(["python", str(SCRIPT), "--root", str(root)], capture_output=True, text=True)


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
