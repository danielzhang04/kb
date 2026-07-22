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
    result = audit.audit(repo, claude, tmp_path / "missing")
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
