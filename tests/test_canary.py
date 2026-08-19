"""Wave B — canary runner (scripts/canary.py).

Covers: all-21 green on the real repo (T6 fold-in adds `promotion-eval-namespace`,
capability `eval-namespace-isolation`), manifest tamper refusal, an intentionally
broken fixture canary failing loud, record mode writing pinned-schema rows to a
TMP ledger (never the real one), and diff-guard detection.
"""
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

import canary
import grade
import promotion

REPO_ROOT = Path(__file__).resolve().parents[1]
EVALS_DIR = REPO_ROOT / "evals"


# --------------------------------------------------------------------------- #
# healthy repo: all 20 canaries pass, manifest verifies                        #
# --------------------------------------------------------------------------- #
def test_all_canaries_pass_on_healthy_repo():
    report = canary.run_all(EVALS_DIR, REPO_ROOT)
    assert len(report.results) == 21, [r.id for r in report.results]
    assert report.all_pass, [(r.id, r.details) for r in report.failures]


def test_real_manifest_verifies():
    ok, problems = canary.verify_manifest(EVALS_DIR)
    assert ok, problems


def test_every_capability_is_covered():
    caps = {c.capability for c in canary.load_canaries(EVALS_DIR / "canaries")}
    assert caps == set(canary.CHECKERS), caps


# --------------------------------------------------------------------------- #
# hermetic copy helpers                                                        #
# --------------------------------------------------------------------------- #
def _copy_evals(tmp_path) -> Path:
    dst = tmp_path / "evals"
    shutil.copytree(EVALS_DIR, dst)
    return dst


def _write_canary(canary_dir: Path, cid: str, expected_label: str):
    (canary_dir / f"{cid}.md").write_text(textwrap.dedent(f"""\
        ---
        id: {cid}
        capability: triage-taxonomy
        judge: deterministic
        rubric_version: "1"
        k: 1
        source: curated
        immutable: true
        tier: T1
        input:
          message:
            from: alice@partner.com
            to: [me@x.com]
            me: me@x.com
            subject: Q
            body: can you confirm?
        expected:
          label: {expected_label}
        ---
        # fixture canary
        """), encoding="utf-8")


# --------------------------------------------------------------------------- #
# manifest tamper refusal                                                      #
# --------------------------------------------------------------------------- #
def test_manifest_tamper_refuses_to_run(tmp_path):
    evals = _copy_evals(tmp_path)
    canary.update_manifest(evals)
    ok, _ = canary.verify_manifest(evals)
    assert ok
    # Tamper: append a byte to a golden canary.
    victim = evals / "canaries" / "triage-action-required.md"
    victim.write_text(victim.read_text(encoding="utf-8") + "\n# tampered\n", encoding="utf-8")
    ok, problems = canary.verify_manifest(evals)
    assert not ok and any("tamper" in p for p in problems)
    with pytest.raises(canary.CanaryTamper):
        canary.run_all(evals, REPO_ROOT)


def test_added_canary_without_manifest_entry_is_tamper(tmp_path):
    evals = _copy_evals(tmp_path)
    canary.update_manifest(evals)
    _write_canary(evals / "canaries", "sneaky-extra", "action_required")
    ok, problems = canary.verify_manifest(evals)
    assert not ok and any("unmanifested" in p for p in problems)


# --------------------------------------------------------------------------- #
# an intentionally broken fixture canary fails loud                            #
# --------------------------------------------------------------------------- #
def test_broken_fixture_canary_fails(tmp_path):
    evals = _copy_evals(tmp_path)
    # This canary EXPECTS the wrong label -> the deterministic judge must fail it.
    _write_canary(evals / "canaries", "broken-expectation", "skip")
    canary.update_manifest(evals)  # bless the tampered set so we test the JUDGE, not the guard
    report = canary.run_all(evals, REPO_ROOT)
    assert not report.all_pass
    broken = [r for r in report.results if r.id == "broken-expectation"]
    assert broken and not broken[0].passed


# --------------------------------------------------------------------------- #
# record mode writes pinned-schema rows to a TMP ledger                        #
# --------------------------------------------------------------------------- #
def test_record_mode_writes_pinned_schema_to_tmp_ledger(tmp_path):
    record_root = tmp_path / "recordrepo"
    record_root.mkdir()
    report = canary.run_all(EVALS_DIR, REPO_ROOT, record=True, record_root=record_root)
    assert report.all_pass
    rows = promotion.read_grades(record_root)
    assert len(rows) == 21
    want_fields = set(grade.REQUIRED_FIELDS) | {"ts"}
    for row in rows:
        assert set(row) == want_fields
        assert row["task_type"].startswith("canary:")
        assert row["inspector_id"] == "inspector@agents.local"
        assert row["worker"] == "canary-suite"


def test_record_does_not_touch_real_repo_ledger(tmp_path):
    record_root = tmp_path / "isolated"
    record_root.mkdir()
    canary.run_all(EVALS_DIR, REPO_ROOT, record=True, record_root=record_root)
    # Everything landed under the tmp record root, nothing under REPO_ROOT via this call.
    assert (record_root / "ledgers" / "grades").exists()
    assert list((record_root / "ledgers" / "grades").glob("*.tsv"))


def test_default_run_is_report_only(tmp_path):
    # A run without record= must not create any grades under the given record_root.
    record_root = tmp_path / "norecord"
    record_root.mkdir()
    canary.run_all(EVALS_DIR, REPO_ROOT, record=False, record_root=record_root)
    assert not (record_root / "ledgers").exists()


# --------------------------------------------------------------------------- #
# diff-guard                                                                   #
# --------------------------------------------------------------------------- #
def _git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def _init_repo(tmp_path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")
    _git(repo, "config", "commit.gpgsign", "false")
    _git(repo, "config", "core.autocrlf", "false")
    return repo


def test_diff_guard_flags_evals_change(tmp_path):
    repo = _init_repo(tmp_path)
    (repo / "evals").mkdir()
    (repo / "evals" / "canaries").mkdir()
    (repo / "evals" / "canaries" / "x.md").write_text("a", encoding="utf-8")
    (repo / "readme.txt").write_text("hi", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "base")
    (repo / "evals" / "canaries" / "x.md").write_text("b", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "touch evals")
    hits = canary.diff_guard(repo, "HEAD~1..HEAD")
    assert hits == ["evals/canaries/x.md"]


def test_diff_guard_clean_when_no_evals_change(tmp_path):
    repo = _init_repo(tmp_path)
    (repo / "evals").mkdir()
    (repo / "evals" / "x.md").write_text("a", encoding="utf-8")
    (repo / "code.py").write_text("x = 1\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "base")
    (repo / "code.py").write_text("x = 2\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "touch code only")
    assert canary.diff_guard(repo, "HEAD~1..HEAD") == []
