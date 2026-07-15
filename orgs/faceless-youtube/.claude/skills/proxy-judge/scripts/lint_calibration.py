#!/usr/bin/env python3
"""Validate a proxy-me calibration-set.md against the entry schema.

A calibration entry is a fenced ```calib block of indent-based key/values:

    ```calib
    id: CJ-001
    source: gold            # gold | before-after | git-history | transcript-dig | held-out
    script_ref: path/or/commit/or/transcript-locator
    verdict: accept         # accept | revise | reject
    flagged:                # omit items entirely for a clean accept
      - quote: the offending line
        dimension: 18       # rubric dim # or grammar section; free text ok
        preference: what Daniel dislikes here
        fix: the substantive change wanted
    notes: free text
    ```

Run: python lint_calibration.py <calibration-set.md>   (exit 1 if any errors)
"""
import sys
import re
import pathlib

VERDICTS = {"accept", "revise", "reject"}
SOURCES = {"gold", "before-after", "git-history", "transcript-dig", "held-out", "session-note"}
BLOCK = re.compile(r"```calib\n(.*?)```", re.S)


def _parse_block(block: str) -> dict:
    """Minimal indent-aware parser for our fixed shape (stdlib only)."""
    out = {}
    cur_list = None
    cur_item = None
    for raw in block.splitlines():
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if indent == 0 and line.endswith(":"):
            # A bare "key:" starts a list (e.g. flagged:).
            key = line[:-1].strip()
            out[key] = cur_list = []
            cur_item = None
        elif indent == 0 and ":" in line:
            key, val = line.split(":", 1)
            out[key.strip()] = val.strip().strip('"')
            cur_list = None
            cur_item = None
        elif line.startswith("- ") and cur_list is not None:
            cur_item = {}
            key, val = line[2:].split(":", 1)
            cur_item[key.strip()] = val.strip().strip('"')
            cur_list.append(cur_item)
        elif ":" in line and cur_item is not None:
            key, val = line.split(":", 1)
            cur_item[key.strip()] = val.strip().strip('"')
    return out


def parse_calibration(text: str) -> list:
    entries = []
    for m in BLOCK.finditer(text):
        e = _parse_block(m.group(1))
        flagged = e.get("flagged")
        if not isinstance(flagged, list):
            e["flagged"] = []
        entries.append(e)
    return entries


def lint(text: str) -> list:
    errs = []
    seen = set()
    for e in parse_calibration(text):
        eid = e.get("id", "<no-id>")
        if eid in seen:
            errs.append(f"{eid}: duplicate id")
        seen.add(eid)
        if e.get("id") is None:
            errs.append(f"{eid}: missing id")
        if e.get("verdict") not in VERDICTS:
            errs.append(f"{eid}: bad verdict {e.get('verdict')!r}")
        if e.get("source") not in SOURCES:
            errs.append(f"{eid}: bad source {e.get('source')!r}")
        if not e.get("script_ref"):
            errs.append(f"{eid}: missing script_ref")
        if e.get("verdict") in {"revise", "reject"} and not e.get("flagged"):
            errs.append(f"{eid}: verdict {e.get('verdict')} but flagged is empty")
        for f in e.get("flagged", []):
            if not f.get("quote"):
                errs.append(f"{eid}: a flagged item is missing 'quote'")
    return errs


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python lint_calibration.py <calibration-set.md>")
        sys.exit(2)
    text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    errors = lint(text)
    for e in errors:
        print("ERROR:", e)
    if errors:
        print(f"\n{len(errors)} error(s).")
        sys.exit(1)
    print("OK: calibration set is valid.")
    sys.exit(0)
