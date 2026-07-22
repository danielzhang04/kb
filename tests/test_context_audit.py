import json
import subprocess
import sys
from pathlib import Path

import scripts.context_audit as audit


def test_audit_counts_only_and_deduplicates(tmp_path):
    repo = tmp_path / "repo"; (repo / ".claude" / "skills" / "on").mkdir(parents=True)
    (repo / "AGENTS.md").write_text("rules\n")
    (repo / ".claude" / "skills" / "on" / "SKILL.md").write_text("---\ndescription: abc\n  def\n---\nsecret body")
    off = repo / ".claude" / "skills" / "off"; off.mkdir(parents=True)
    (off / "SKILL.md").write_text("---\ndescription: hidden\ndisable-model-invocation: true\n---")
    curated = repo / "skills" / "curated" / "source"; curated.mkdir(parents=True)
    (curated / "SKILL.md").write_text("---\ndescription: source\n---")
    claude = tmp_path / "claude"; (claude / "plugins" / "p" / "skills" / "x").mkdir(parents=True)
    old = claude / "plugins" / "old" / "skills" / "x"; old.mkdir(parents=True)
    (old / "SKILL.md").write_text("---\ndescription: old-value\n---")
    (claude / "settings.json").write_text(json.dumps({"enabledPlugins": {"p": True}}))
    (claude / "plugins" / "installed_plugins.json").write_text(json.dumps({"plugins": {"p": [{"installPath": str(old.parents[1]), "installedAt": "1"}, {"installPath": str(claude / "plugins" / "p"), "installedAt": "2"}]}}))
    (claude / "plugins" / "p" / "skills" / "x" / "SKILL.md").write_text("---\ndescription: plug\n---")
    nested = claude / "plugins" / "p" / ".claude" / "skills" / "y"; nested.mkdir(parents=True)
    (nested / "SKILL.md").write_text("---\ndescription: nested\n---")
    (claude / "projects" / "p" / "memory").mkdir(parents=True)
    (claude / "projects" / "p" / "memory" / "MEMORY.md").write_bytes(b"one\ntwo\n")
    (claude / "a.jsonl").write_text('{"message":{"id":"a","usage":{"input_tokens":2,"cache_read_input_tokens":1}}}\n' * 2)
    result = audit.audit(repo, claude, tmp_path / "missing", include_sessions=True)
    assert result["repo_skills"] == {"skill_count": 1, "description_chars": 7, "disabled_skill_count": 1}
    assert result["claude_plugins"]["description_chars"] == 10
    assert result["claude_plugins"]["skill_count"] == 2
    assert result["curated_skill_sources"]["description_chars"] == 6
    assert result["claude_sessions"]["usage_record_count"] == 1
    assert result["auto_memory"] == {"file_count": 1, "bytes": 8, "lines": 2}
    assert "secret" not in json.dumps(result)


def test_cli_is_deterministic_json_with_missing_homes(tmp_path):
    script = Path(__file__).parents[1] / "scripts" / "context_audit.py"
    cmd = [sys.executable, str(script), "--repo", str(tmp_path), "--claude-home", str(tmp_path / "none"), "--codex-home", str(tmp_path / "none")]
    first = subprocess.check_output(cmd, text=True).strip()
    assert first == subprocess.check_output(cmd, text=True).strip()
    assert json.loads(first)["claude_sessions"]["jsonl_file_count"] == 0
    claude = tmp_path / "claude"; claude.mkdir()
    (claude / "session.jsonl").write_text('{"usage":{"input_tokens":3}}\n')
    command = cmd[:5] + [str(claude), "--codex-home", str(tmp_path / "none"), "--include-sessions"]
    assert json.loads(subprocess.check_output(command, text=True))["claude_sessions"]["input_tokens"] == 3


def test_default_audit_does_not_read_sessions(tmp_path, monkeypatch):
    def fail(_):
        raise AssertionError("session traversal must be opt-in")
    monkeypatch.setattr(audit, "usage", fail)
    result = audit.audit(tmp_path, tmp_path / "claude", tmp_path / "codex")
    assert result["claude_sessions"]["included"] == 0
    assert result["claude_sessions"] == audit.empty_usage()
    assert result["codex_sessions"] == audit.empty_usage()


def test_explicitly_disabled_plugins_are_not_included(tmp_path):
    home = tmp_path / "claude"
    (home / "settings.json").parent.mkdir()
    (home / "settings.json").write_text(json.dumps({"enabledPlugins": {"p": False}}))
    (home / "plugins").mkdir(exist_ok=True)
    (home / "plugins" / "installed_plugins.json").write_text(
        json.dumps({"plugins": {"p": {"installPath": str(home / "plugin")}}})
    )
    assert audit.enabled_plugin_roots(home) == []


def test_codex_usage_and_top_level_plugin_skill_only(tmp_path):
    home = tmp_path / "codex"; home.mkdir()
    records = [
        {"type": "event_msg", "payload": {"type": "token_count", "info": None}},
        {"type": "event_msg", "payload": {"type": "token_count", "info": {"last_token_usage": {"input_tokens": 4, "output_tokens": 2}}}},
    ]
    (home / "a.jsonl").write_text("\n".join(json.dumps(record) for record in records) + "\n")
    assert audit.usage(home)["input_tokens"] == 4
    plugin = tmp_path / "plugin"; (plugin / "skills" / "one").mkdir(parents=True); (plugin / "skills" / "one" / "SKILL.md").write_text("---\ndescription: a\n---")
    (plugin / "skills" / "one" / "nested").mkdir(); (plugin / "skills" / "one" / "nested" / "SKILL.md").write_text("---\ndescription: long\n---")
    assert audit.skill_totals([plugin / "skills"])["skill_count"] == 1


def test_usage_limits_are_counted_without_content_or_paths(tmp_path, monkeypatch):
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setattr(audit, "MAX_JSONL_CANDIDATES", 1)
    monkeypatch.setattr(audit, "MAX_JSONL_FILE_BYTES", 12)
    monkeypatch.setattr(audit, "MAX_JSONL_RECORD_BYTES", 4)
    (home / "a.jsonl").write_bytes(b"abcdef" + b"0123456789")
    (home / "b.jsonl").write_text("{}\n")
    result = audit.usage(home)
    assert result["included"] == 1
    assert result["candidate_limit_count"] == 1
    assert result["discovery_complete"] == 0
    assert result["record_byte_limit_count"] == 1
    assert result["file_byte_limit_count"] == 1
    assert str(home) not in json.dumps(result)


def test_usage_directory_entry_budget_is_explicit(tmp_path, monkeypatch):
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setattr(audit, "MAX_JSONL_ENTRIES", 2)
    for name in ("a.txt", "b.txt", "c.txt"):
        (home / name).write_text("not a session")
    result = audit.usage(home)
    assert result["included"] == 1
    assert result["traversal_limit_count"] == 1
    assert result["discovery_complete"] == 0
    assert result["jsonl_file_count"] == 0


def test_candidate_cap_marks_newest_selection_incomplete(tmp_path, monkeypatch):
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setattr(audit, "MAX_JSONL_CANDIDATES", 1)
    (home / "a.jsonl").write_text('{"usage":{"input_tokens":1}}\n')
    (home / "z.jsonl").write_text('{"usage":{"input_tokens":9}}\n')
    result = audit.usage(home)
    assert result["candidate_limit_count"] == 1
    assert result["discovery_complete"] == 0
    assert result["jsonl_file_count"] == 1


def test_instruction_inventory_skips_symlinks_and_outside_targets(tmp_path):
    repo = tmp_path / "repo"; repo.mkdir()
    (repo / "AGENTS.md").write_text("inside")
    outside = tmp_path / "outside.md"; outside.write_text("outside")
    link = repo / "CLAUDE.md"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        return
    files = audit.instruction_files(repo)
    assert files == [repo / "AGENTS.md"]
