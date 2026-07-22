#!/usr/bin/env python3
"""Read-only, numeric-only local context inventory (stdlib only)."""
import argparse
import json
from pathlib import Path

MAX_JSONL_FILES = 200
INSTRUCTION_NAMES = {"AGENTS.md", "CLAUDE.md", "GEMINI.md", "contract.md"}


def size_lines(path):
    try:
        blob = path.read_bytes()
    except OSError:
        return (0, 0)
    return (len(blob), blob.count(b"\n") + (1 if blob and not blob.endswith(b"\n") else 0))


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}


def description(path):
    """Return only the front-matter description length and invocation flag."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return (0, 0)
    if not lines or lines[0].strip() != "---":
        return (0, 0)
    fields = {}; current = None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line[:1].isspace() and current == "description":
            fields[current] += " " + line.strip()
        elif ":" in line:
            key, value = line.split(":", 1)
            current = key.strip()
            fields[current] = value.strip().strip('"\'')
    return (len(fields.get("description", "")), int(fields.get("disable-model-invocation", "").lower() == "true"))


def skill_totals(roots):
    count = chars = disabled = 0
    seen = set()
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.glob("*/SKILL.md")):
            key = str(path.resolve()).lower()
            if key in seen:
                continue
            seen.add(key)
            text_len, off = description(path)
            if off:
                disabled += 1
                continue
            count += 1
            chars += text_len
    return {"skill_count": count, "description_chars": chars, "disabled_skill_count": disabled}


def enabled_plugin_roots(home):
    installed = read_json(home / "plugins" / "installed_plugins.json")
    settings = read_json(home / "settings.json")
    enabled = settings.get("enabledPlugins", {}) if isinstance(settings, dict) else {}
    enabled_names = {str(k) for k, v in enabled.items() if v is True}
    roots = []
    plugins = installed.get("plugins", {}) if isinstance(installed, dict) else {}
    if isinstance(plugins, dict):
        for name, entries in plugins.items():
            if enabled_names and name not in enabled_names:
                continue
            if not isinstance(entries, list):
                entries = [entries]
            if entries:
                # Installation records are append-only; use the newest deterministically.
                entries = [max(entries, key=lambda e: str(e.get("installedAt", "")) if isinstance(e, dict) else "")]
            for entry in entries:
                if isinstance(entry, dict):
                    value = entry.get("installPath") or entry.get("install_path")
                    if isinstance(value, str):
                        roots.append(Path(value))
    return roots


def usage(home):
    candidates = list(home.rglob("*.jsonl")) if home.is_dir() else []
    files = sorted(candidates, key=lambda p: (-p.stat().st_mtime_ns, str(p)))[:MAX_JSONL_FILES]
    total = {"jsonl_file_count": len(files), "skipped_jsonl_file_count": max(0, len(candidates) - len(files)), "usage_record_count": 0, "input_tokens": 0,
             "cached_input_tokens": 0, "cache_creation_tokens": 0, "output_tokens": 0,
             "malformed_line_count": 0}
    seen = set()
    for path in files:
        try:
            handle = path.open(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        with handle:
          for line_number, line in enumerate(handle, start=1):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                total["malformed_line_count"] += 1
                continue
            if not isinstance(obj, dict):
                continue
            payload = obj.get("payload", {})
            if obj.get("type") == "event_msg" and isinstance(payload, dict) and payload.get("type") == "token_count":
                info = payload.get("info")
                use = info.get("last_token_usage", {}) if isinstance(info, dict) else {}
                ident = obj.get("id")
            else:
                message = obj.get("message", obj)
                use = message.get("usage", obj.get("usage", {})) if isinstance(message, dict) else {}
                ident = message.get("id") if isinstance(message, dict) else None
            if not isinstance(use, dict) or not any(k in use for k in ("input_tokens", "output_tokens", "cache_read_input_tokens")):
                continue
            key = (str(path), str(ident)) if ident else (str(path), line_number)
            if key in seen:
                continue
            seen.add(key)
            total["usage_record_count"] += 1
            for out, keys in (("input_tokens", ("input_tokens",)), ("cached_input_tokens", ("cache_read_input_tokens", "cached_input_tokens")),
                              ("cache_creation_tokens", ("cache_creation_input_tokens", "cache_creation_tokens")), ("output_tokens", ("output_tokens",))):
                total[out] += next((v for k in keys if isinstance((v := use.get(k)), int) and v >= 0), 0)
    return total


def audit(repo, claude_home, codex_home):
    instructions = [p for p in repo.rglob("*") if p.is_file() and p.name in INSTRUCTION_NAMES]
    instruction_bytes = sum(size_lines(p)[0] for p in instructions)
    instruction_lines = sum(size_lines(p)[1] for p in instructions)
    memories = sorted((claude_home / "projects").glob("*/memory/MEMORY.md")) if (claude_home / "projects").is_dir() else []
    memory_bytes = sum(size_lines(p)[0] for p in memories)
    memory_lines = sum(size_lines(p)[1] for p in memories)
    return {"instruction_files": {"count": len(instructions), "bytes": instruction_bytes, "lines": instruction_lines},
            "repo_skills": skill_totals([repo / ".claude" / "skills"]),
            "curated_skill_sources": skill_totals([repo / "skills" / "curated"]),
            "claude_plugins": skill_totals([child for p in enabled_plugin_roots(claude_home) for child in (p / "skills", p / ".claude" / "skills")]),
            "auto_memory": {"file_count": len(memories), "bytes": memory_bytes, "lines": memory_lines},
            "claude_sessions": usage(claude_home), "codex_sessions": usage(codex_home)}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--claude-home", type=Path, default=Path.home() / ".claude")
    parser.add_argument("--codex-home", type=Path, default=Path.home() / ".codex")
    args = parser.parse_args(argv)
    print(json.dumps(audit(args.repo, args.claude_home, args.codex_home), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
