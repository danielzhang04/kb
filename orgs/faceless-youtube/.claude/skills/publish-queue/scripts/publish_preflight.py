#!/usr/bin/env python3
"""publish_preflight.py — the idempotent, read-only gate a publish clears BEFORE any upload.

Stage-0 law: a human approves EVERY publish and every upload goes out `private`. This script does not
upload, schedule, or edit anything and makes NO network calls — it only inspects a finished video
folder and reports whether an in-session, human-gated upload may proceed.

Usage:
    py -3 publish_preflight.py <video_dir>

Exit codes (the contract the runner reads):
    0  GO         — ready to upload: compliance PASS + assets/final.mp4 present + no prior record.
    1  NOT-READY  — one readiness condition failed; the message says which.
    2  PUBLISHED  — a publish-record.json already exists; prints "already published: <video_id>".

Idempotency is checked FIRST: if the record exists the video is already done (exit 2), whatever else
is on disk. Otherwise readiness is: (a) compliance-report.md exists AND its `## Mechanical checks`
section has no `FAIL — ` line (we PARSE the report the compliance-check skill already wrote — we never
re-run the checks), and (b) assets/final.mp4 exists.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

MECHANICAL_HEADING = "## Mechanical checks"
FAIL_PREFIX = "FAIL — "


def _record_video_id(record_path: Path) -> str:
    """Best-effort read of the video_id from an existing publish record."""
    try:
        rec = json.loads(record_path.read_text(encoding="utf-8"))
        return str(rec.get("video_id", "<unknown>"))
    except Exception:
        return "<unreadable-record>"


def mechanical_section(report_text: str) -> list[str] | None:
    """Return the lines of the `## Mechanical checks` section, or None if absent.

    The section runs from the heading to the next `## ` heading (or end of file). Scoping to this
    section is deliberate: a `FAIL — ` line elsewhere (e.g. the warn-level provenance section) must
    never trip the gate.
    """
    lines = report_text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip() == MECHANICAL_HEADING:
            start = i + 1
            break
    if start is None:
        return None
    body = []
    for line in lines[start:]:
        if line.startswith("## ") and line.strip() != MECHANICAL_HEADING:
            break
        body.append(line)
    return body


def preflight(video_dir: Path) -> tuple[int, str]:
    """Return (exit_code, message). Pure inspection — no writes, no network."""
    record = video_dir / "publish-record.json"
    if record.exists():
        return 2, f"already published: {_record_video_id(record)}"

    report = video_dir / "compliance-report.md"
    if not report.exists():
        return 1, f"not ready: compliance-report.md not found — run compliance-check first ({report})"
    section = mechanical_section(report.read_text(encoding="utf-8"))
    if section is None:
        return 1, "not ready: compliance-report.md has no '## Mechanical checks' section"
    fails = [ln for ln in section if ln.startswith(FAIL_PREFIX)]
    if fails:
        return 1, "not ready: compliance report has mechanical FAIL(s):\n  " + "\n  ".join(fails)

    final_mp4 = video_dir / "assets" / "final.mp4"
    if not final_mp4.exists():
        return 1, f"not ready: assets/final.mp4 not found — run render-builder first ({final_mp4})"

    return 0, f"GO: {video_dir.name} is publish-ready (compliance PASS, final.mp4 present, no record)"


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        sys.stderr.write("usage: py -3 publish_preflight.py <video_dir>\n")
        return 1
    video_dir = Path(argv[0])
    if not video_dir.is_dir():
        sys.stderr.write(f"not a directory: {video_dir}\n")
        return 1
    code, msg = preflight(video_dir)
    (sys.stdout if code == 0 else sys.stderr).write(msg + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
