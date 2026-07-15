"""Heuristic injection scan for skills (spec s6 v1 gate) — grep-class, NOT semantic.

A pass here is necessary, never sufficient: the human read-through checklist in
governance/security-rules.md is mandatory before promotion to curated/.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PATTERNS = [
    ("instruction-override",
     re.compile(r"(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\s+instructions", re.I)),
    ("piped-install", re.compile(r"(curl|wget|iwr|Invoke-WebRequest)[^\n|]*\|\s*(ba|z|pwsh|power)?sh", re.I)),
    ("secrets-reference", re.compile(r"(\.env\b|ANTHROPIC_API_KEY|OPENAI_API_KEY|~/.ssh|id_rsa|client_secret)", re.I)),
    ("encoded-exec", re.compile(r"(powershell[^\n]*-enc\b|base64\s*(-d|--decode)[^\n]*\|\s*sh|eval\s*\(\s*atob)", re.I)),
    ("destructive", re.compile(r"rm\s+-rf\s+[~/]|Remove-Item\s+-Recurse\s+-Force\s+[A-Z]:\\\\?", re.I)),
    ("hidden-unicode", re.compile("[​‌‍‎‏‪-‮⁦-⁩]")),
]
TEXT_EXT = {".md", ".txt", ".py", ".js", ".ts", ".sh", ".ps1", ".json", ".yaml", ".yml", ".toml"}
MAX_FILE_BYTES = 1_000_000


def scan(skill_dir: Path) -> list[str]:
    findings: list[str] = []
    for f in sorted(Path(skill_dir).rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(skill_dir)
        if f.stat().st_size > MAX_FILE_BYTES:
            findings.append(f"{rel}:0: oversized-file (> {MAX_FILE_BYTES} bytes in a skill)")
            continue
        if f.suffix.lower() not in TEXT_EXT:
            findings.append(f"{rel}:0: non-text-file (binary payloads need individual justification)")
            continue
        for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for name, pat in PATTERNS:
                if pat.search(line):
                    findings.append(f"{rel}:{i}: {name}")
    return findings


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: scan_skill.py <skill-dir>")
        return 2
    findings = scan(Path(sys.argv[1]))
    for f in findings:
        print(f"FLAG {f}")
    print(f"{len(findings)} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
