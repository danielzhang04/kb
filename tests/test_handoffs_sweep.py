import json
import os
import subprocess
from pathlib import Path

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
