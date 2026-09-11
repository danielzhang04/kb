import json
import os
import subprocess
from pathlib import Path

from scripts import handoffs_sweep as hs

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "handoffs_sweep.py"


def git(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
    (repo / "handoffs").mkdir()
    return repo


def set_ops_main_refs(repo, sha=None):
    """Point refs/remotes/origin/{ops,main} at a commit, so `origin/ops`/`origin/main`
    resolve as revisions without needing an actual configured remote (cat-file only
    needs the ref to exist, not a real `git remote add`)."""
    if sha is None:
        sha = git(repo, "rev-parse", "HEAD").strip()
    git(repo, "update-ref", "refs/remotes/origin/main", sha)
    git(repo, "update-ref", "refs/remotes/origin/ops", sha)


def run_sweep(repo, *args, now=None):
    env = {**os.environ}
    if now:
        env["KB_HANDOFFS_NOW"] = now
    return subprocess.run(
        ["python", str(SCRIPT), "--root", str(repo), *args], capture_output=True, text=True, env=env
    )


def test_stale_by_age_is_flagged(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "handoffs" / "2026-01-01-kb-old-thing.md").write_text("# old\n## Load list\n", encoding="utf-8")
    r = run_sweep(repo, "--json", now="2026-02-01")
    assert r.returncode == 0
    rows = json.loads(r.stdout)
    assert rows[0]["file"] == "2026-01-01-kb-old-thing.md"
    assert "days old" in rows[0]["reason"]


def test_superseded_same_scope_is_flagged(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "handoffs" / "2026-01-01-fyt-first.md").write_text("# a\n", encoding="utf-8")
    (repo / "handoffs" / "2026-01-05-fyt-second.md").write_text("# b\n", encoding="utf-8")
    r = run_sweep(repo, "--json", now="2026-01-06")
    rows = json.loads(r.stdout)
    by_file = {row["file"]: row["reason"] for row in rows}
    assert "superseded by 2026-01-05-fyt-second.md" in by_file["2026-01-01-fyt-first.md"]
    assert "2026-01-05-fyt-second.md" not in by_file  # the newer one is not itself flagged as superseded


def test_dead_load_path_is_flagged(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n## Load list\n`docs/does/not/exist.md`\n", encoding="utf-8"
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    rows = json.loads(r.stdout)
    assert "dead Load path" in rows[0]["reason"]
    assert "docs/does/not/exist.md" in rows[0]["reason"]


def test_healthy_handoff_is_not_flagged(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "README.md").write_text("kept file", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add readme")
    # README.md is only "real" for the strict check once it is reachable from
    # origin/ops or origin/main -- point both refs at this commit.
    set_ops_main_refs(repo)
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n## Load list\n`README.md`\n", encoding="utf-8"
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    assert json.loads(r.stdout) == []


def test_working_tree_only_path_is_still_flagged_dead(tmp_path):
    """Strict per spec/ruling: a Load path that exists ONLY in the local working tree
    (not committed to origin/ops or origin/main) is still dead -- no working-tree
    leniency."""
    repo = make_repo(tmp_path)
    set_ops_main_refs(repo)  # both refs point at the initial (fileless) commit
    (repo / "only-local.md").write_text("uncommitted", encoding="utf-8")
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n## Load list\n`only-local.md`\n", encoding="utf-8"
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    rows = json.loads(r.stdout)
    assert "dead Load path" in rows[0]["reason"]
    assert "only-local.md" in rows[0]["reason"]


def test_delete_mode_prints_git_rm_lines_only(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "handoffs" / "2026-01-01-kb-old.md").write_text("# old\n", encoding="utf-8")
    r = run_sweep(repo, "--delete", now="2026-02-01")
    assert r.returncode == 0
    assert r.stdout.strip() == "git rm handoffs/2026-01-01-kb-old.md"


def test_table_mode_says_no_flags_when_clean(tmp_path):
    repo = make_repo(tmp_path)
    r = run_sweep(repo, now="2026-01-05")
    assert "No flagged handoffs." in r.stdout


def test_batch_read_blobs_missing_identifier_with_space_does_not_desync(tmp_path):
    """Fix round 3: `git cat-file --batch` emits a missing record as
    `<verbatim identifier> missing`, and the identifier itself can contain spaces (e.g. a
    handoffs filename with a space in it). The parser must detect "missing" by a SUFFIX
    check (`header.endswith(" missing")`) BEFORE any space-based split -- splitting first
    would over-count fields for a spacey identifier, fall into the malformed-header branch,
    and (before this fix) `break` out of the whole batch, silently dropping every
    subsequent ref. This calls `_batch_read_blobs` directly with three refs where the
    SECOND is a missing identifier containing a space, and asserts the third ref's content
    is still read (i.e. the parser did not desync/bail after the second record)."""
    repo = make_repo(tmp_path)
    (repo / "a.md").write_text("alpha", encoding="utf-8")
    (repo / "c.md").write_text("charlie", encoding="utf-8")
    git(repo, "add", "a.md", "c.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add a and c")
    sha = git(repo, "rev-parse", "HEAD").strip()
    refs = [
        f"{sha}:a.md",
        f"{sha}:missing file with spaces.md",
        f"{sha}:c.md",
    ]
    out = hs._batch_read_blobs(repo, refs)
    assert out[f"{sha}:a.md"] == "alpha"
    assert f"{sha}:missing file with spaces.md" not in out
    assert out[f"{sha}:c.md"] == "charlie"


def test_load_section_terminates_at_next_heading(tmp_path):
    """Fix round 1, item 1: NEXT_HEADING_RE needs re.MULTILINE so the `## Load` section
    stops at the next `## ` heading. Without it, `_load_paths` never finds a terminator
    and every backtick path in the rest of the file -- including ones under unrelated
    headings like `## Real-store state` -- gets treated as a Load path."""
    repo = make_repo(tmp_path)
    set_ops_main_refs(repo)
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n"
        "## Load\n"
        "`docs/does/not/exist-in-load.md`\n"
        "## Real-store state\n"
        "`docs/does/not/exist-outside-load.md`\n",
        encoding="utf-8",
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    rows = json.loads(r.stdout)
    assert "docs/does/not/exist-in-load.md" in rows[0]["reason"]
    assert "docs/does/not/exist-outside-load.md" not in rows[0]["reason"]


def test_non_ascii_ops_handoff_parses_without_crash(tmp_path):
    """Fix round 1, item 2: `_git()` must decode as UTF-8 (errors=replace), not the OS
    locale codepage (cp1252 on this Windows host), which mangles an em dash and raises
    UnicodeDecodeError on a byte sequence like the UTF-8 encoding of 'L with stroke'
    (Ł) that cp1252 has no mapping for. This handoff is read via `git show
    origin/ops:...` (not the local-disk path), by committing it and then removing the
    local copy, to exercise the exact code path that crashed."""
    repo = make_repo(tmp_path)
    content = "# thing — notes\nŁódź test\n## Load\n`docs/does/not/exist.md`\n"
    handoff = repo / "handoffs" / "2026-01-05-kb-thing.md"
    handoff.write_text(content, encoding="utf-8")
    git(repo, "add", "handoffs/2026-01-05-kb-thing.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add handoff")
    set_ops_main_refs(repo)
    handoff.unlink()  # only the ops-ref copy remains -> forces the `git show` read path
    r = run_sweep(repo, "--json", now="2026-01-05")
    assert r.returncode == 0, r.stderr
    rows = json.loads(r.stdout)
    assert "dead Load path" in rows[0]["reason"]
    assert "docs/does/not/exist.md" in rows[0]["reason"]


def test_mixed_live_and_dead_load_paths_in_one_batch_check(tmp_path):
    """Fix round 2, item 1: dead-Load-path checking is now one batched `git cat-file
    --batch-check` process per ref (covering every distinct Load path across every
    handoff), not one `cat-file -e` process per path per ref. This pins that the batch
    correctly distinguishes a live path from a dead one within the SAME call: one handoff
    whose Load list has both a real path and a nonexistent one must flag only the
    nonexistent one."""
    repo = make_repo(tmp_path)
    (repo / "README.md").write_text("kept file", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add readme")
    set_ops_main_refs(repo)
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n## Load\n`README.md`\n`docs/does/not/exist.md`\n", encoding="utf-8"
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    rows = json.loads(r.stdout)
    reason = rows[0]["reason"]
    assert "docs/does/not/exist.md" in reason
    assert "README.md" not in reason


def test_local_copy_wins_when_present_on_both_ops_and_local(tmp_path):
    """Fix round 1, item 4: when a filename exists on both `origin/ops:handoffs/` and the
    local checkout with divergent content, the local copy wins (matches CLAUDE.md's
    checkout-is-truth-for-uncommitted-work expectation, and _read_handoff_text's
    documented local-first order)."""
    repo = make_repo(tmp_path)
    dup = repo / "handoffs" / "2026-01-05-kb-dup.md"
    dup.write_text("# ops version\n## Load\n`docs/only-in-ops-version.md`\n", encoding="utf-8")
    git(repo, "add", "handoffs/2026-01-05-kb-dup.md")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "ops version")
    set_ops_main_refs(repo)
    # Overwrite the local working copy with different, uncommitted content.
    dup.write_text("# local version\n## Load\n`docs/only-in-local-version.md`\n", encoding="utf-8")
    r = run_sweep(repo, "--json", now="2026-01-05")
    rows = json.loads(r.stdout)
    by_file = {row["file"]: row["reason"] for row in rows}
    assert "docs/only-in-local-version.md" in by_file["2026-01-05-kb-dup.md"]
    assert "docs/only-in-ops-version.md" not in by_file["2026-01-05-kb-dup.md"]


def test_calendar_shaped_but_impossible_filename_date_does_not_crash(tmp_path):
    """F4. `2026-13-45-kb-bad.md` matches FILENAME_RE's digit shape but is not a real date, and
    the unguarded `date.fromisoformat` turned it into a traceback and exit 1 -- from a script the
    SessionStart hook spawns on every session. It is now treated as "no date": never age-flagged,
    still scope- and Load-checked.

    Red on revert: returncode 1 and unparseable stdout."""
    repo = make_repo(tmp_path)
    set_ops_main_refs(repo)
    (repo / "handoffs" / "2026-13-45-kb-bad.md").write_text(
        "# bad\n## Load list\n`docs/does/not/exist.md`\n", encoding="utf-8"
    )
    (repo / "handoffs" / "2026-01-05-kb-good.md").write_text("# good\n", encoding="utf-8")
    r = run_sweep(repo, "--json", now="2026-01-05")
    assert r.returncode == 0, r.stderr
    rows = json.loads(r.stdout)
    by_file = {row["file"]: row["reason"] for row in rows}
    # Still inspected, just never age-flagged.
    assert "dead Load path" in by_file["2026-13-45-kb-bad.md"]
    assert "days old" not in by_file["2026-13-45-kb-bad.md"]
    # And the table and --delete renderers survive the same input.
    assert run_sweep(repo, now="2026-01-05").returncode == 0
    assert run_sweep(repo, "--delete", now="2026-01-05").returncode == 0


def test_unparseable_now_override_skips_age_checks_instead_of_crashing(tmp_path):
    """F4, the other unguarded fromisoformat: KB_HANDOFFS_NOW. An unparseable override means "no
    today" -- age checks are skipped, the rest of the sweep still runs."""
    repo = make_repo(tmp_path)
    set_ops_main_refs(repo)
    (repo / "handoffs" / "2020-01-01-kb-ancient.md").write_text(
        "# ancient\n## Load list\n`docs/does/not/exist.md`\n", encoding="utf-8"
    )
    r = run_sweep(repo, "--json", now="not-a-date")
    assert r.returncode == 0, r.stderr
    rows = json.loads(r.stdout)
    assert "days old" not in rows[0]["reason"]
    assert "dead Load path" in rows[0]["reason"]


def test_annotated_load_heading_is_found(tmp_path):
    """M2. Real handoffs write `## Load list (in order)`; the exact-match heading regex matched
    none of them, so those handoffs were treated as having no Load list at all and their dead
    paths were never flagged.

    Red on revert: no row, because the Load section is never located."""
    repo = make_repo(tmp_path)
    set_ops_main_refs(repo)
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n## Load list (in order)\n`docs/does/not/exist.md`\n"
        "## Next\n`docs/not/in/the/load/list.md`\n",
        encoding="utf-8",
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    rows = json.loads(r.stdout)
    assert "docs/does/not/exist.md" in rows[0]["reason"]
    assert "docs/not/in/the/load/list.md" not in rows[0]["reason"]


def test_load_heading_prefix_does_not_swallow_an_unrelated_heading(tmp_path):
    """`\\b` after Load: `## Loading notes` is NOT a Load list."""
    repo = make_repo(tmp_path)
    set_ops_main_refs(repo)
    (repo / "handoffs" / "2026-01-05-kb-thing.md").write_text(
        "# thing\n## Loading notes\n`docs/does/not/exist.md`\n", encoding="utf-8"
    )
    r = run_sweep(repo, "--json", now="2026-01-05")
    assert json.loads(r.stdout) == []
