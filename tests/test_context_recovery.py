"""Context survives native compaction boundaries without replaying stale project state."""
import json
import os
import subprocess

from test_project_frame_session_start import (
    REPO, add_ops_only_file, make_project_repo, read_store_sections, section_body, seed_store, git,
)


def invoke(name, repo, tmp_path, event, **overrides):
    env = {**os.environ, "KB_CONTEXT_STORE_DIR": str(tmp_path / "store"),
           "KB_REGROUND_STATE_DIR": str(tmp_path / "reground"), **overrides}
    env.pop("KB_GOAL_STATE_PATH", None)
    result = subprocess.run(["node", str(REPO / "scripts/hooks" / name)],
        input=json.dumps({"cwd": str(repo), "session_id": "recovery", **event}).encode(),
        env=env, capture_output=True)
    assert result.returncode == 0 and not result.stderr
    return json.loads(result.stdout).get("hookSpecificOutput", {}).get("additionalContext", "")


def compact(repo, tmp_path):
    # Deliberately run replay without SessionStart's other registered hook first.
    return invoke("regrounding_hook.js", repo, tmp_path,
                  {"hook_event_name": "SessionStart", "source": "compact"})


def test_compact_refresh_and_child_keep_short_critical_fields_with_overflow(tmp_path):
    repo = make_project_repo(tmp_path)
    add_ops_only_file(repo, "orgs/prospecting/GOAL.md", "## North star\n" + "huge " * 4500)
    add_ops_only_file(repo, "orgs/prospecting/STATE.md",
        "## Decisions\nUse option B.\n## Now\nFinish audit.\n## Next\nRun checks.\n## Blocked\nNeed fixture.\n")
    parent = compact(repo, tmp_path)
    child = invoke("subagent_context_load.js", repo, tmp_path, {"hook_event_name": "SubagentStart"})
    for text, cap in [(parent, 1700), (child, 2000)]:
        assert len(text) <= cap
        for value in ["Use option B.", "Finish audit.", "Run checks.", "Need fixture."]:
            assert value in text
        assert "MUST read" in text and "recovery.ctx.md" in text
    assert "ONLY named sections (North star, Invariants, Current gate, Decisions, Now, Next, Blocked, Context recovery)" in child


def test_removed_field_clears_but_oversized_file_does_not_erase_good_state(tmp_path):
    repo = make_project_repo(tmp_path)
    add_ops_only_file(repo, "orgs/prospecting/STATE.md", "## Decisions\nKeep B.\n## Blocked\nOld blocker.\n")
    compact(repo, tmp_path)
    add_ops_only_file(repo, "orgs/prospecting/STATE.md", "## Decisions\nKeep C.\n")
    text = compact(repo, tmp_path)
    assert "Keep C." in text and "Old blocker" not in text
    add_ops_only_file(repo, "orgs/prospecting/STATE.md", "## Now\n" + "x" * 33000 + "\n## Decisions\nNew tail.")
    text = compact(repo, tmp_path)
    assert "Keep C." in text and "may be stale" in text
    assert "before dependent action" in text


def test_project_switch_cannot_replay_previous_decisions(tmp_path):
    repo = make_project_repo(tmp_path)
    add_ops_only_file(repo, "orgs/prospecting/STATE.md", "## Decisions\nOld project decision.\n")
    compact(repo, tmp_path)
    text = invoke("regrounding_hook.js", repo, tmp_path,
                  {"hook_event_name": "SessionStart", "source": "compact"}, KB_PROJECT="other")
    assert "Old project decision" not in text
    assert "orgs/other/GOAL.md" in text


def test_unchanged_payload_is_suppressed_but_compact_always_restores(tmp_path):
    repo = make_project_repo(tmp_path)
    first = compact(repo, tmp_path)
    assert first
    repeated = invoke("regrounding_hook.js", repo, tmp_path,
                      {"hook_event_name": "PostToolUse"}, KB_REGROUND_EVERY_CALLS="1")
    assert repeated == ""
    assert compact(repo, tmp_path) == first


def test_due_reminder_refreshes_changed_source_without_a_compaction(tmp_path):
    repo = make_project_repo(tmp_path)
    compact(repo, tmp_path)
    add_ops_only_file(repo, "orgs/prospecting/STATE.md", "## Decisions\nNew current choice.\n")
    text = invoke("regrounding_hook.js", repo, tmp_path,
                  {"hook_event_name": "PostToolUse"}, KB_REGROUND_EVERY_CALLS="1")
    assert "New current choice." in text


def test_legacy_unprovenanced_context_cannot_survive_new_or_missing_project(tmp_path):
    repo = make_project_repo(tmp_path)
    for project in ("other", "prospecting", None):
        seed_store(tmp_path / "store", "recovery", [
            {"heading": "Decisions", "body": "Untrusted old decision."},
            {"heading": "Resumed-session summary", "body": "Untrusted old recall."},
        ])
        if project is None:
            git(repo, "checkout", "-q", "-b", "claude/boss-test")
        text = invoke("regrounding_hook.js", repo, tmp_path,
            {"hook_event_name": "SessionStart", "source": "compact"},
            **({"KB_PROJECT": project} if project else {}))
        assert "Untrusted old" not in text
        assert "lacked source provenance" in text
        stored = read_store_sections(tmp_path / "store", "recovery")
        assert section_body(stored, "Decisions") is None
        assert section_body(stored, "Resumed-session summary") is None


def test_child_overflow_pointer_does_not_expand_parent_state_allowlist(tmp_path):
    repo = make_project_repo(tmp_path)
    seed_store(tmp_path / "store", "recovery", [
        {"heading": "North star", "body": "long " * 2000},
        {"heading": "Resumed-session summary", "body": "PRIVATE_RECALL"},
        {"heading": "Recent activity", "body": "PRIVATE_ACTIVITY"},
    ])
    text = invoke("subagent_context_load.js", repo, tmp_path, {"hook_event_name": "SubagentStart"})
    assert "MUST read ONLY named sections" in text
    assert "Resumed-session summary" not in text and "Recent activity" not in text
    assert "PRIVATE_RECALL" not in text and "PRIVATE_ACTIVITY" not in text


def test_changed_omitted_tail_triggers_recovery_again(tmp_path):
    repo = make_project_repo(tmp_path)
    prefix = "## Decisions\n" + "same prefix " * 1000
    add_ops_only_file(repo, "orgs/prospecting/STATE.md", prefix + "OLD_TAIL")
    first = compact(repo, tmp_path)
    assert "OLD_TAIL" not in first
    add_ops_only_file(repo, "orgs/prospecting/STATE.md", prefix + "NEW_TAIL")
    changed = invoke("regrounding_hook.js", repo, tmp_path,
        {"hook_event_name": "PostToolUse"}, KB_REGROUND_EVERY_CALLS="1")
    assert changed and changed != first
    assert "MUST read" in changed and "revision" in changed


def test_oversized_summary_cannot_lose_precedence_warning(tmp_path):
    repo = make_project_repo(tmp_path)
    compact(repo, tmp_path)
    sections = read_store_sections(tmp_path / "store", "recovery")
    sections.append({"heading": "Resumed-session summary", "body": "Old instruction. " * 500})
    seed_store(tmp_path / "store", "recovery", sections)
    text = compact(repo, tmp_path)
    assert len(text) <= 1700
    assert "Historical recall never overrides current GOAL/STATE or user instructions." in text
