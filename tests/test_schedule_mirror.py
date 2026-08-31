"""W5 renderer suite for scripts/schedule_mirror.py (dashboard v3 P4 section 3.5).

The renderer is a field-level row updater: it rewrites `schedule:`/`armed:` (and `agent:` when the
line already exists) inside the cadence entry that carries the store row's name, and leaves every
other byte alone. The decisive test is `test_real_heartbeat_*`: a fixture copy of the repo's own
HEARTBEAT.md, the file `scripts/dispatch.py` and `server/schedules/seedImport.ts` actually read.

`tests/fixtures/dashboard-v3-p4-mirror-vectors.json` is shared with
`dashboard/server/schedules/mirror.test.ts`; both suites assert the same rendered bytes and digests.
"""
from __future__ import annotations

import difflib
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "schedule_mirror.py"
VECTORS_PATH = REPO_ROOT / "tests" / "fixtures" / "dashboard-v3-p4-mirror-vectors.json"
REAL_HEARTBEAT = REPO_ROOT / "HEARTBEAT.md"

_spec = importlib.util.spec_from_file_location("schedule_mirror", SCRIPT)
assert _spec and _spec.loader
schedule_mirror = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(schedule_mirror)

VECTORS = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))


def real_heartbeat() -> str:
    """The real file EXACTLY as the server hands it to the renderer: no newline translation."""
    with open(REAL_HEARTBEAT, encoding="utf-8", newline="") as handle:
        return handle.read()


def sid(seed: str) -> str:
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def row(name, schedule, armed=True, agent="alpha-agent", key="row"):
    return {"id": sid(key), "name": name, "schedule": schedule, "agent": agent, "armed": armed}


ORG = (
    "# Heartbeat — org\n"
    "\n"
    "Prose above the block stays byte-identical.\n"
    "\n"
    "```yaml\n"
    "cadences:\n"
    "  - name: alpha\n"
    "    schedule: daily\n"
    "    tier: desktop\n"
    "    agent: alpha-agent\n"
    "    risk-tier: T1\n"
    "    prompt: |\n"
    "      Line one of the prompt.\n"
    "      schedule: this-is-prompt-text-not-a-field\n"
    "\n"
    "  - name: beta\n"
    "    schedule: weekly:sat\n"
    "    tier: cloud\n"
    "    agent: beta-agent\n"
    "    armed: false\n"
    "    risk-tier: T2\n"
    "```\n"
    "\n"
    "## Notes\n"
)
ORG_PATH = "orgs/faceless-youtube/HEARTBEAT.md"


def render(paths):
    return schedule_mirror.render_batch({"paths": paths})


def render_one(path, source, rows):
    return render([{"path": path, "bytes": source, "rows": rows}])


def only(result):
    assert result["ok"] is True, result
    assert len(result["paths"]) == 1
    return result["paths"][0]


# --- the decisive test: the real HEARTBEAT.md ------------------------------------------------

def real_heartbeat_rows():
    return [
        row("nightly-review", "daily", True, "dispatcher-cloud", "nightly"),
        row("system-sweeper", "*/30 * * * *", False, "system-sweeper", "sweeper"),
    ]


def test_real_heartbeat_preserves_every_cadence_and_prompt():
    source = real_heartbeat()
    content = only(render_one("HEARTBEAT.md", source, real_heartbeat_rows()))["content"]

    before = schedule_mirror.parse_seeds_compatible(source, "HEARTBEAT.md")
    after = schedule_mirror.parse_seeds_compatible(content, "HEARTBEAT.md")
    assert [seed["name"] for seed in before] == [seed["name"] for seed in after]
    assert len(after) == 11
    assert source.count("- name:") == content.count("- name:") == 11
    assert schedule_mirror.preserved_key_counts(source) == schedule_mirror.preserved_key_counts(content)
    assert schedule_mirror.preserved_key_counts(content) == {"prompt": 11, "tier": 11, "risk-tier": 11}


def test_real_heartbeat_changes_only_the_targeted_values():
    source = real_heartbeat()
    content = only(render_one("HEARTBEAT.md", source, real_heartbeat_rows()))["content"]
    before, after = source.splitlines(), content.splitlines()

    # `nightly-review` has no `armed:` line, so exactly one line is added; nothing else is inserted.
    assert len(after) - len(before) == 1
    inserted = [line[2:] for line in difflib.ndiff(before, after) if line.startswith("+ ")]
    removed = [line[2:] for line in difflib.ndiff(before, after) if line.startswith("- ")]
    assert inserted == ['    armed: true', '    schedule: "*/30 * * * *"', "    armed: false"]
    assert removed == ['    schedule: "*/15 * * * *"', "    armed: true"]

    preserved = re.compile(r"^\s*(prompt|tier|risk-tier):")
    assert [line for line in before if preserved.match(line)] == [line for line in after if preserved.match(line)]
    # Every prompt BODY line survives byte-identically too.
    assert [line for line in before if line.startswith("      ")] == [line for line in after if line.startswith("      ")]


def test_real_heartbeat_untouched_when_every_row_already_agrees():
    source = real_heartbeat()
    rows = [row("system-sweeper", "*/15 * * * *", True, "system-sweeper", "sweeper")]
    rendered = only(render_one("HEARTBEAT.md", source, rows))
    assert rendered["changed"] is False
    assert rendered["content"] == source


def test_real_heartbeat_rows_without_a_cadence_name_are_skipped_not_rendered():
    source = real_heartbeat()
    rows = [
        {"id": sid("operator"), "name": None, "schedule": "daily", "agent": "ops", "armed": True},
        row("not-in-this-file", "daily", True, "ops", "ghost"),
    ]
    rendered = only(render_one("HEARTBEAT.md", source, rows))
    assert rendered["changed"] is False
    assert rendered["content"] == source
    assert [entry["reason"] for entry in rendered["skipped"]] == ["not-seed-originated", "no-matching-cadence"]


# --- the shared cross-language vectors ---------------------------------------------------------

def test_vector_file_pins_the_shared_row_fields():
    assert tuple(VECTORS["rowFields"]) == schedule_mirror.MIRROR_ROW_FIELDS


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[case["name"] for case in VECTORS["cases"]])
def test_shared_vectors(case):
    rendered = only(render_one(case["path"], case["input"], case["rows"]))
    assert rendered["content"] == case["expected"]["content"]
    assert rendered["digest"] == case["expected"]["digest"]
    assert rendered["changed"] == case["expected"]["changed"]
    assert rendered["skipped"] == case["expected"]["skipped"]
    assert rendered["digest"] == hashlib.sha256(rendered["content"].encode("utf-8")).hexdigest()


def test_shared_vectors_include_the_real_heartbeat():
    paths = {case["path"] for case in VECTORS["cases"]}
    assert "HEARTBEAT.md" in paths
    real = next(case for case in VECTORS["cases"] if case["name"] == "real-heartbeat-field-level-update")
    assert real["input"] == real_heartbeat(), (
        "the shared vector must track the repo's real HEARTBEAT.md; regenerate the fixture"
    )


# --- field-level update behaviour ---------------------------------------------------------------

def test_prompt_block_content_is_never_mistaken_for_a_field():
    rendered = only(render_one(ORG_PATH, ORG, [row("alpha", "15 4 * * *", True, "alpha-agent", "a")]))
    assert "      schedule: this-is-prompt-text-not-a-field\n" in rendered["content"]
    assert rendered["content"].count("schedule:") == ORG.count("schedule:")
    assert '    schedule: "15 4 * * *"\n' in rendered["content"]


def test_armed_is_inserted_after_schedule_when_absent():
    rendered = only(render_one(ORG_PATH, ORG, [row("alpha", "daily", False, "alpha-agent", "a")]))
    lines = rendered["content"].splitlines()
    index = lines.index("    schedule: daily")
    assert lines[index + 1] == "    armed: false"
    assert len(lines) == len(ORG.splitlines()) + 1


def test_existing_armed_line_is_updated_in_place():
    rendered = only(render_one(ORG_PATH, ORG, [row("beta", "weekly:sat", True, "beta-agent", "b")]))
    assert len(rendered["content"].splitlines()) == len(ORG.splitlines())
    assert "    armed: true\n" in rendered["content"]
    assert "    armed: false\n" not in rendered["content"]


def test_agent_line_is_updated_only_when_it_already_exists():
    without_agent = ORG.replace("    agent: alpha-agent\n", "")
    rendered = only(render_one(ORG_PATH, without_agent, [row("alpha", "daily", True, "renamed", "a")]))
    assert "agent: renamed" not in rendered["content"]
    updated = only(render_one(ORG_PATH, ORG, [row("alpha", "daily", True, "renamed", "a")]))
    assert "    agent: renamed\n" in updated["content"]


def test_null_agent_leaves_the_existing_agent_line_alone():
    rows = [{"id": sid("a"), "name": "alpha", "schedule": "daily", "agent": None, "armed": True}]
    rendered = only(render_one(ORG_PATH, ORG, rows))
    assert "    agent: alpha-agent\n" in rendered["content"]
    assert rendered["skipped"] == []


def test_cron_values_are_quoted_and_plain_values_are_not():
    rendered = only(render_one(ORG_PATH, ORG, [
        row("alpha", "*/5 * * * *", True, "alpha-agent", "a"),
        row("beta", "daily", True, "beta-agent", "b"),
    ]))
    assert '    schedule: "*/5 * * * *"\n' in rendered["content"]
    assert "    schedule: daily\n" in rendered["content"]


def test_file_rows_with_no_store_counterpart_are_untouched():
    rendered = only(render_one(ORG_PATH, ORG, [row("alpha", "daily", True, "alpha-agent", "a")]))
    beta = rendered["content"].split("  - name: beta\n")[1]
    assert beta.startswith("    schedule: weekly:sat\n    tier: cloud\n    agent: beta-agent\n    armed: false\n")


# --- per-row skips never reject the batch (M4) ---------------------------------------------------

@pytest.mark.parametrize("rows,reason", [
    ([row("alpha", "x" * 201, True, "alpha-agent", "a")], "field-too-long"),
    ([row("y" * 201, "daily", True, "alpha-agent", "a")], "field-too-long"),
    ([row("alpha", "daily `whoami`", True, "alpha-agent", "a")], "unsafe-field-value"),
    ([row("alpha", 'daily "x"', True, "alpha-agent", "a")], "unsafe-field-value"),
    ([row("alpha", "daily ", True, "alpha-agent", "a")], "unsafe-field-value"),
    ([row("nope", "daily", True, "alpha-agent", "a")], "no-matching-cadence"),
    ([{"id": sid("a"), "name": "", "schedule": "daily", "agent": "x", "armed": True}], "not-seed-originated"),
])
def test_bad_row_skips_the_row_and_keeps_the_batch(rows, reason):
    rendered = only(render_one(ORG_PATH, ORG, rows))
    assert rendered["changed"] is False
    assert rendered["content"] == ORG
    assert [entry["reason"] for entry in rendered["skipped"]] == [reason]


def test_a_skipped_row_does_not_block_its_neighbour():
    rendered = only(render_one(ORG_PATH, ORG, [
        row("alpha", "x" * 201, True, "alpha-agent", "a"),
        row("beta", "daily", True, "beta-agent", "b"),
    ]))
    assert rendered["changed"] is True
    assert "    schedule: daily\n    tier: cloud\n" in rendered["content"]
    assert [entry["reason"] for entry in rendered["skipped"]] == ["field-too-long"]


def test_two_store_rows_claiming_one_cadence_name_skip_the_second():
    rendered = only(render_one(ORG_PATH, ORG, [
        row("alpha", "daily", True, "alpha-agent", "first"),
        row("alpha", "weekly:sun", True, "alpha-agent", "second"),
    ]))
    reasons = [entry["reason"] for entry in rendered["skipped"]]
    assert reasons == ["duplicate-store-row"]


def test_duplicate_cadence_names_in_the_file_skip_the_row():
    duplicated = ORG.replace("  - name: beta\n", "  - name: alpha\n")
    rendered = only(render_one(ORG_PATH, duplicated, [row("alpha", "daily", True, "alpha-agent", "a")]))
    assert rendered["changed"] is False
    assert [entry["reason"] for entry in rendered["skipped"]] == ["ambiguous-cadence-name"]


def test_cadence_without_a_schedule_line_skips_the_row():
    stripped = ORG.replace("    schedule: daily\n", "")
    rendered = only(render_one(ORG_PATH, stripped, [row("alpha", "daily", True, "alpha-agent", "a")]))
    assert [entry["reason"] for entry in rendered["skipped"]] == ["no-schedule-line"]


# --- the 32-file cap counts CHANGED files only (M3) ----------------------------------------------

def org_path(index: int) -> str:
    return f"orgs/project-{index:03d}/HEARTBEAT.md"


def test_forty_paths_with_one_change_prepare_fine():
    paths = []
    for index in range(40):
        # `beta` already carries `armed: false` and `schedule: weekly:sat`, so 39 of the 40 paths
        # render byte-identical and are excluded from the cap before it is applied.
        rows = [row("beta", "15 4 * * *" if index == 7 else "weekly:sat", False, "beta-agent", f"a{index}")]
        paths.append({"path": org_path(index), "bytes": ORG, "rows": rows})
    result = render(paths)
    assert result["ok"] is True
    assert sum(1 for entry in result["paths"] if entry["changed"]) == 1
    assert len(result["paths"]) == 40


def test_thirty_three_changed_files_reject():
    paths = []
    for index in range(33):
        rows = [row("beta", "15 4 * * *", False, "beta-agent", f"a{index}")]
        paths.append({"path": org_path(index), "bytes": ORG, "rows": rows})
    assert render(paths) == {"ok": False, "code": "too-many-changed-files", "path": None}


def test_thirty_two_changed_files_are_accepted():
    paths = []
    for index in range(32):
        rows = [row("beta", "15 4 * * *", False, "beta-agent", f"a{index}")]
        paths.append({"path": org_path(index), "bytes": ORG, "rows": rows})
    result = render(paths)
    assert result["ok"] is True
    assert sum(1 for entry in result["paths"] if entry["changed"]) == 32


# --- structural rejects --------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "../HEARTBEAT.md", "orgs/../HEARTBEAT.md", "/HEARTBEAT.md", "orgs\\evil\\HEARTBEAT.md",
    "orgs/EVIL/HEARTBEAT.md", "heartbeat.md", "orgs/a/b/HEARTBEAT.md", "",
])
def test_hostile_paths_reject(path):
    assert render_one(path, ORG, [])["code"] == "invalid-mirror-path"


@pytest.mark.parametrize("source,code", [
    ("# no fence\n", "missing-cadences-block"),
    ("```yaml\ncadences:\n```\n```yaml\ncadences:\n```\n", "duplicate-yaml-block"),
    ("```yaml\ncadences:\n  - name: alpha\n", "unterminated-yaml-block"),
])
def test_structural_file_failures_reject(source, code):
    assert render_one(ORG_PATH, source, [])["code"] == code


@pytest.mark.parametrize("row_value,code", [
    ({"id": "short", "name": "alpha", "schedule": "daily", "agent": "a", "armed": True}, "malformed-schedule-id"),
    ({"id": sid("a"), "name": "alpha", "schedule": 7, "agent": "a", "armed": True}, "malformed-row-field"),
    ({"id": sid("a"), "name": "alpha", "schedule": "daily", "agent": "a", "armed": "yes"}, "malformed-row-field"),
    ({"id": sid("a"), "name": "alpha", "schedule": "daily", "agent": "a"}, "missing-row-field"),
    ({"id": sid("a"), "name": "alpha", "schedule": "daily", "agent": "a", "armed": True, "x": 1}, "unknown-row-field"),
])
def test_row_shape_failures_reject_the_batch(row_value, code):
    assert render_one(ORG_PATH, ORG, [row_value])["code"] == code


def test_duplicate_schedule_id_across_paths_rejects():
    entry = {"path": ORG_PATH, "bytes": ORG, "rows": [row("alpha", "daily", True, "alpha-agent", "same")]}
    other = {"path": org_path(1), "bytes": ORG, "rows": [row("alpha", "daily", True, "alpha-agent", "same")]}
    assert render([entry, other])["code"] == "duplicate-schedule-id"


def test_duplicate_path_rejects():
    entry = {"path": ORG_PATH, "bytes": ORG, "rows": [row("alpha", "daily", True, "a", "one")]}
    other = {"path": ORG_PATH, "bytes": ORG, "rows": [row("alpha", "daily", True, "a", "two")]}
    assert render([entry, other])["code"] == "duplicate-path"


def test_oversized_input_rejects():
    padded = ORG + ("x" * 1_048_577)
    assert render_one(ORG_PATH, padded, [])["code"] == "input-too-large"


def test_too_many_rows_rejects():
    rows = [row("alpha", "daily", True, "a", f"r{index}") for index in range(201)]
    assert render_one(ORG_PATH, ORG, rows)["code"] == "too-many-rows"


def test_self_check_refuses_a_render_that_would_change_the_seed_identity(monkeypatch):
    def corrupt(rows, entries, lines):
        replacements, insertions, skipped, expected = original(rows, entries, lines)
        for entry in entries:
            if entry.name == "alpha":
                replacements[entry.start] = "  - name: renamed\n"
        return replacements, insertions, skipped, expected

    original = schedule_mirror.plan_edits
    monkeypatch.setattr(schedule_mirror, "plan_edits", corrupt)
    result = render_one(ORG_PATH, ORG, [row("alpha", "daily", True, "alpha-agent", "a")])
    assert result == {"ok": False, "code": "render-identity-changed", "path": ORG_PATH}


def test_self_check_refuses_a_render_that_would_drop_a_prompt(monkeypatch):
    original = schedule_mirror.plan_edits

    def corrupt(rows, entries, lines):
        replacements, insertions, skipped, expected = original(rows, entries, lines)
        for index, line in enumerate(lines):
            if line.strip() == "prompt: |":
                replacements[index] = "    note: |\n"
        return replacements, insertions, skipped, expected

    monkeypatch.setattr(schedule_mirror, "plan_edits", corrupt)
    result = render_one(ORG_PATH, ORG, [row("alpha", "daily", True, "alpha-agent", "a")])
    assert result == {"ok": False, "code": "render-identity-changed", "path": ORG_PATH}


# --- the subprocess contract the server actually uses --------------------------------------------

def run_script(payload: str) -> tuple[int, str]:
    process = subprocess.run(
        [sys.executable, str(SCRIPT), "--render"],
        input=payload, capture_output=True, text=True, encoding="utf-8",
    )
    return process.returncode, process.stdout


def test_subprocess_renders_the_real_heartbeat():
    source = real_heartbeat()
    payload = json.dumps({"paths": [{"path": "HEARTBEAT.md", "bytes": source, "rows": real_heartbeat_rows()}]})
    code, stdout = run_script(payload)
    assert code == 0
    decoded = json.loads(stdout)
    assert decoded["ok"] is True
    assert decoded["paths"][0]["content"].count("- name:") == 11


def test_subprocess_reports_reject_on_stdout_with_exit_one():
    code, stdout = run_script(json.dumps({"paths": [{"path": "../x", "bytes": "", "rows": []}]}))
    assert code == 1
    assert json.loads(stdout) == {"ok": False, "code": "invalid-mirror-path", "path": "../x"}


def test_subprocess_rejects_an_unknown_invocation():
    process = subprocess.run(
        [sys.executable, str(SCRIPT), "--wat"], input="", capture_output=True, text=True, encoding="utf-8",
    )
    assert process.returncode == 1
    assert json.loads(process.stdout)["code"] == "unknown-invocation"


def test_subprocess_rejects_malformed_json():
    code, stdout = run_script("{not json")
    assert code == 1
    assert json.loads(stdout) == {"ok": False, "code": "malformed-input", "path": None}
