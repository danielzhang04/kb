"""Validate a stage recipe's frontmatter (channel-forge Phase 3)."""
import re
import sys
from pathlib import Path

REQUIRED_KEYS = ["inputs", "reuse_check", "option_shape", "critic_checks", "gate"]
# `routes_to` is OPTIONAL: only stages that delegate to a skill for a reuse resolution
# carry it; doctrine/format/guardrails/scaffold are playbook- or mechanically-authored.


def parse_frontmatter(text):
    """Parse a leading ---fenced flat 'key: value' block into a dict. Missing block -> {}."""
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            out[key.strip()] = value.strip()
    return out


def validate(text):
    """Return a list of error strings; empty means valid."""
    fm = parse_frontmatter(text)
    if not fm:
        return ["missing or malformed frontmatter (--- fenced key: value block)"]
    errors = []
    for key in REQUIRED_KEYS:
        if not fm.get(key):
            errors.append(f"recipe missing or empty required key: {key}")
    return errors


def validate_file(path):
    return validate(Path(path).read_text(encoding="utf-8"))


if __name__ == "__main__":
    errs = validate_file(sys.argv[1])
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    print("ok")
