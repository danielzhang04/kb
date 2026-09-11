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
