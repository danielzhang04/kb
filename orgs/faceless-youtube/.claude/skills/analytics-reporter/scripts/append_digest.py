#!/usr/bin/env python3
"""append_digest.py — append a dated analytics digest to a channel's performance.md.

Closes the loop: `idea-generator` reads performance.md to learn what worked; this writes the numbers
into it. One dated block per run, under an `## Analytics digests` section (newest at the bottom).

Idempotent per date: each block is fenced by `<!-- digest:<date> START -->` / `... END -->` markers.
Re-running the same --date REPLACES that block in place — it never duplicates. A new date appends a
new block. The date is caller-supplied via --date (no ambient clock) so a run is reproducible.

Usage:
    py -3 append_digest.py --channel the-second-take --date 2026-07-20 [--analytics-root <dir>]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SECTION = "## Analytics digests"


def _start(date):  # noqa: D401
    return f"<!-- digest:{date} START -->"


def _end(date):
    return f"<!-- digest:{date} END -->"


def _latest_pull(video) -> dict:
    pulls = video.get("pulls") or {}
    return pulls[max(pulls)] if pulls else {}


def digest_block(channel, date, rollup) -> str:
    """Build the fenced, human-readable digest block for one date (pure — no I/O)."""
    videos = rollup.get("videos") or {}
    lines = [_start(date), f"### Analytics digest — {date}", ""]
    if not videos:
        lines.append("_No published-video data for this channel yet._")
    else:
        lines.append("| Video | Views | Watch min | Avg view (s) | CTR % | Subs + |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for _, v in sorted(videos.items(), key=lambda kv: kv[1].get("slug") or kv[0]):
            m = _latest_pull(v)
            title = (v.get("title") or v.get("slug") or "—").replace("|", "\\|")

            def cell(x):
                if x is None:
                    return "—"
                return f"{x:,}" if isinstance(x, int) else f"{x:g}"

            lines.append(
                f"| {title} | {cell(m.get('views'))} | {cell(m.get('estimated_minutes_watched'))} "
                f"| {cell(m.get('average_view_duration'))} | {cell(m.get('impressions_ctr'))} "
                f"| {cell(m.get('subscribers_gained'))} |"
            )
    lines += ["", f"_Source: analytics/{channel}/rollup.json. YouTube lags ~24-48h; "
              f"freshness = this date._", _end(date)]
    return "\n".join(lines)


def apply_digest(md_text, date, block) -> str:
    """Insert-or-replace `block` for `date` into `md_text`. Pure. Idempotent per date.

    If a block for that date already exists (matched by its START..END markers), replace it in place.
    Otherwise append it under the `## Analytics digests` section (created if absent) — newest last.
    """
    text = md_text if md_text.endswith("\n") else md_text + "\n"
    pattern = re.compile(
        re.escape(_start(date)) + r".*?" + re.escape(_end(date)), re.DOTALL)
    if pattern.search(text):
        return pattern.sub(lambda _m: block, text)

    if SECTION not in text:
        text = text.rstrip("\n") + "\n\n" + SECTION + "\n"
    return text.rstrip("\n") + "\n\n" + block + "\n"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Append a dated analytics digest to performance.md.")
    p.add_argument("--channel", required=True)
    p.add_argument("--date", required=True, help="ISO date (YYYY-MM-DD), caller-supplied — no clock")
    p.add_argument("--analytics-root", default=None)
    p.add_argument("--channel-root", default=None)
    args = p.parse_args(argv)

    org_root = Path(__file__).resolve().parents[3]
    analytics_root = Path(args.analytics_root) if args.analytics_root else org_root / "analytics"
    channel_root = (Path(args.channel_root) if args.channel_root
                    else org_root / "channels" / args.channel)

    rollup_path = analytics_root / args.channel / "rollup.json"
    if not rollup_path.exists():
        sys.stderr.write(f"no rollup for {args.channel}: {rollup_path} — run pull_analytics first\n")
        return 1
    rollup = json.loads(rollup_path.read_text(encoding="utf-8"))

    perf_path = channel_root / "performance.md"
    if not perf_path.exists():
        sys.stderr.write(f"performance.md not found: {perf_path}\n")
        return 1

    block = digest_block(args.channel, args.date, rollup)
    updated = apply_digest(perf_path.read_text(encoding="utf-8"), args.date, block)
    perf_path.write_text(updated, encoding="utf-8")
    sys.stderr.write(f"digest for {args.date} written to {perf_path}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
