"""Verification test for task 4.5: kb-ops and atlas-prep are scaffolded via
new_project.py and each declares >=1 tiered HEARTBEAT cadence (not vacuous)."""

from pathlib import Path

import yaml

REPO = Path(__file__).parent.parent

PROJECTS = ("kb-ops", "atlas-prep")


def _load_cadences(project: str):
    hb_path = REPO / "orgs" / project / "HEARTBEAT.md"
    text = hb_path.read_text(encoding="utf-8")
    # extract the fenced ```yaml ... ``` block
    start = text.index("```yaml") + len("```yaml")
    end = text.index("```", start)
    block = text[start:end]
    data = yaml.safe_load(block)
    return data.get("cadences", [])


def test_projects_exist_with_standard_files():
    for project in PROJECTS:
        root = REPO / "orgs" / project
        for f in ("_index.md", "STATE.md", "contract.md", "HEARTBEAT.md"):
            assert (root / f).exists(), f"{project} missing {f}"
        for d in ("raw", "wiki", "output"):
            assert (root / d).is_dir(), f"{project} missing dir {d}"


def test_projects_registered_in_master_index():
    text = (REPO / "_index.md").read_text(encoding="utf-8")
    for project in PROJECTS:
        assert f"orgs/{project}/_index.md" in text


def test_each_project_has_at_least_one_tiered_cadence():
    for project in PROJECTS:
        cadences = _load_cadences(project)
        assert len(cadences) >= 1, f"{project} HEARTBEAT.md declares no cadences (vacuous)"
        for cadence in cadences:
            assert cadence.get("tier"), f"{project} cadence {cadence.get('name')} missing tier"
            assert cadence.get("risk-tier"), f"{project} cadence {cadence.get('name')} missing risk-tier"
            assert cadence.get("prompt"), f"{project} cadence {cadence.get('name')} missing prompt"


def test_kb_ops_cadence_is_t1_desktop_self_ops():
    cadences = _load_cadences("kb-ops")
    names = {c["name"]: c for c in cadences}
    assert "self-lint-report" in names
    c = names["self-lint-report"]
    assert c["tier"] == "desktop"
    assert c["risk-tier"] == "T1"


def test_atlas_prep_cadence_is_t2_cloud_and_gated():
    cadences = _load_cadences("atlas-prep")
    names = {c["name"]: c for c in cadences}
    assert "research-draft-gate" in names
    c = names["research-draft-gate"]
    assert c["tier"] == "cloud"
    assert c["risk-tier"] == "T2"
    assert "STOP" in c["prompt"]
    assert "queue/approvals" in c["prompt"]


def test_faceless_youtube_untouched():
    # Task 4.5 must not touch the existing faceless-youtube project.
    import subprocess

    result = subprocess.run(
        ["git", "status", "--porcelain", "orgs/faceless-youtube"],
        cwd=REPO, capture_output=True, text=True, check=True,
    )
    assert result.stdout.strip() == "", "faceless-youtube tree was modified"
