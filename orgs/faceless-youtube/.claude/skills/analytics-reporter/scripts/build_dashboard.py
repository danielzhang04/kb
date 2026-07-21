#!/usr/bin/env python3
"""build_dashboard.py — render ALL channels' rollups into ONE self-contained analytics dashboard.

Reads every analytics/<channel>/rollup.json, renders a single offline HTML file: a CSS-only tab per
channel (the radio-input trick — no JavaScript), a per-video drilldown (<details>), and, per video,
an inline-SVG retention polyline + a CTR bar. Fully self-contained: embedded CSS, inline SVG, no
external scripts/styles/fonts/images — safe to publish as a single Claude artifact.

Fail = keep last-good: if NO channel has any video data (all rollups missing or empty), it REFUSES to
write and returns non-zero, leaving any existing dashboard.html untouched. A blank dashboard would
otherwise erase the last good one the moment a pull fails.

This script ONLY writes the HTML file. The orchestrator republishes it as the ONE stable-URL Claude
artifact (URL kept in DASHBOARD.md); freshness == the last pull's date (YouTube lags ~24-48h).

Usage:
    py -3 build_dashboard.py [--analytics-root <dir>] [-o analytics/dashboard.html]
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path


def load_rollups(analytics_root) -> dict:
    """Read analytics/<channel>/rollup.json for every channel dir → {channel: rollup}. Skips
    unreadable/invalid files (a partial write must never crash the dashboard build)."""
    analytics_root = Path(analytics_root)
    out = {}
    if not analytics_root.is_dir():
        return out
    for rollup_path in sorted(analytics_root.glob("*/rollup.json")):
        try:
            data = json.loads(rollup_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        channel = data.get("channel") or rollup_path.parent.name
        out[channel] = data
    return out


def _latest_pull(video) -> dict:
    pulls = video.get("pulls") or {}
    if not pulls:
        return {}
    return pulls[max(pulls)]


def _fmt(n) -> str:
    if n is None:
        return "—"
    if isinstance(n, float):
        return f"{n:g}"
    if isinstance(n, int):
        return f"{n:,}"
    return html.escape(str(n))


def _retention_svg(curve) -> str:
    """Inline SVG retention polyline: x = elapsedVideoTimeRatio (0..1), y = audienceWatchRatio
    plotted against a FIXED 0.0-1.0 ceiling (not each video's own peak), so retention severity is
    visually comparable across videos — a video that only ever holds 50% of viewers must not look
    identical to one that holds 100%. Values above 1.0 (a data anomaly) are clamped to 1.0."""
    w, h, pad = 320, 90, 6
    if not curve:
        return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="no retention data"></svg>'
    pts = []
    for x_ratio, y_ratio in curve:
        if x_ratio is None or y_ratio is None:
            continue
        y_clamped = max(0.0, min(y_ratio, 1.0))
        x = pad + x_ratio * (w - 2 * pad)
        y = (h - pad) - y_clamped * (h - 2 * pad)
        pts.append(f"{x:.1f},{y:.1f}")
    poly = " ".join(pts)
    return (
        f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
        f'aria-label="retention curve" class="ret">'
        f'<polyline fill="none" stroke="currentColor" stroke-width="2" points="{poly}"/>'
        f"</svg>"
    )


def _ctr_svg(ctr) -> str:
    """Inline SVG CTR bar (0..20% clamped to a fixed track)."""
    w, h = 320, 16
    val = ctr if isinstance(ctr, (int, float)) else 0.0
    frac = max(0.0, min(val / 20.0, 1.0))
    fill = 2 + frac * (w - 4)
    label = f"{val:g}%" if isinstance(ctr, (int, float)) else "—"
    return (
        f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
        f'aria-label="impressions CTR {html.escape(label)}" class="ctr">'
        f'<rect x="1" y="1" width="{w - 2}" height="{h - 2}" rx="3" class="track"/>'
        f'<rect x="2" y="2" width="{fill:.1f}" height="{h - 4}" rx="2" class="bar"/>'
        f"</svg>"
    )


CSS = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  margin: 0; padding: 24px; background: Canvas; color: CanvasText; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { opacity: .65; margin: 0 0 20px; font-size: 13px; }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent); }
.tabs input { position: absolute; opacity: 0; pointer-events: none; }
.tabs label { padding: 8px 14px; cursor: pointer; border-radius: 6px 6px 0 0; opacity: .6; font-weight: 600; font-size: 13px; }
.panel { display: none; padding: 18px 2px; }
.card { border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 10px;
  padding: 12px 14px; margin: 10px 0; }
.card > summary { cursor: pointer; font-weight: 600; list-style: none; }
.card > summary::-webkit-details-marker { display: none; }
.card > summary::before { content: "\\25B8"; display: inline-block; width: 1em; opacity: .6; }
.card[open] > summary::before { content: "\\25BE"; }
.slug { opacity: .6; font-weight: 400; font-size: 12px; }
.metrics { display: flex; flex-wrap: wrap; gap: 18px; margin: 10px 0 4px; }
.metrics div { min-width: 90px; }
.metrics .k { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
.metrics .v { font-size: 18px; font-weight: 700; }
.chart { margin-top: 8px; }
.chart .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
svg.ret { display: block; }
svg.ctr .track { fill: color-mix(in srgb, CanvasText 12%, transparent); }
svg.ctr .bar { fill: currentColor; }
.empty { opacity: .6; font-style: italic; }
"""


def _video_card(video) -> str:
    latest = _latest_pull(video)
    slug = html.escape(video.get("slug") or "")
    title = html.escape(video.get("title") or slug or "untitled")
    m = latest
    metric_cells = "".join(
        f'<div><span class="k">{k}</span><span class="v">{_fmt(v)}</span></div>'
        for k, v in (
            ("views", m.get("views")),
            ("watch min", m.get("estimated_minutes_watched")),
            ("avg view (s)", m.get("average_view_duration")),
            ("impressions", m.get("impressions")),
            ("subs +", m.get("subscribers_gained")),
        )
    )
    return (
        f'<details class="card" data-slug="{slug}">'
        f'<summary>{title} <span class="slug">{slug}</span></summary>'
        f'<div class="metrics">{metric_cells}</div>'
        f'<div class="chart"><div class="lbl">Retention</div>{_retention_svg(m.get("retention") or [])}</div>'
        f'<div class="chart"><div class="lbl">Impressions CTR</div>{_ctr_svg(m.get("impressions_ctr"))}</div>'
        f"</details>"
    )


def render_html(rollups) -> str:
    """Pure: {channel: rollup} → one self-contained HTML document (no external references)."""
    channels = sorted(rollups)
    radios, labels, panels = [], [], []
    for idx, ch in enumerate(channels):
        safe = html.escape(ch)
        tab_id = f"tab-{ch}"  # channel tab id — asserted by the test
        checked = " checked" if idx == 0 else ""
        radios.append(f'<input type="radio" name="tabs" id="{html.escape(tab_id)}"{checked}>')
        labels.append(f'<label for="{html.escape(tab_id)}">{safe}</label>')
        videos = (rollups[ch].get("videos") or {})
        if videos:
            cards = "".join(
                _video_card(v) for _, v in sorted(videos.items(), key=lambda kv: kv[1].get("slug") or kv[0])
            )
        else:
            cards = '<p class="empty">No pulled data for this channel yet.</p>'
        panels.append(f'<section class="panel" id="panel-{html.escape(ch)}">{cards}</section>')

    # CSS wiring: the checked radio drives its label + matching panel (sibling selectors, no JS).
    wiring = "\n".join(
        f'#{html.escape("tab-" + ch)}:checked ~ .tabs label[for="{html.escape("tab-" + ch)}"] {{ opacity: 1; '
        f'border-bottom: 2px solid currentColor; }}\n'
        f'#{html.escape("tab-" + ch)}:checked ~ #panel-{html.escape(ch)} {{ display: block; }}'
        for ch in channels
    )
    body_tabs = "".join(radios) + f'<div class="tabs">{"".join(labels)}</div>' + "".join(panels)
    if not channels:
        body_tabs = '<p class="empty">No channels with analytics data.</p>'

    return (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>Faceless YouTube — Analytics</title>"
        f"<style>{CSS}\n{wiring}</style></head><body>"
        "<h1>Faceless YouTube — Analytics</h1>"
        '<p class="sub">Rebuilt from rollup files. YouTube Analytics lags ~24-48h; freshness is the '
        "last pull's date.</p>"
        f"{body_tabs}"
        "</body></html>\n"
    )


def _has_data(rollups) -> bool:
    return any((r.get("videos") or {}) for r in rollups.values())


def _org_root() -> Path:
    """The org root: .../orgs/faceless-youtube — four levels up from this scripts/ file
    (scripts -> analytics-reporter -> skills -> .claude -> faceless-youtube). Module-level and
    argument-free so it is unit-testable without invoking main()."""
    return Path(__file__).resolve().parents[4]


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Render the file-backed analytics dashboard.")
    p.add_argument("--analytics-root", default=None,
                   help="analytics dir (default: analytics/ relative to org root)")
    p.add_argument("-o", "--output", default=None,
                   help="output HTML (default: <analytics-root>/dashboard.html)")
    args = p.parse_args(argv)

    org_root = _org_root()
    analytics_root = Path(args.analytics_root) if args.analytics_root else org_root / "analytics"
    output = Path(args.output) if args.output else analytics_root / "dashboard.html"

    rollups = load_rollups(analytics_root)
    if not _has_data(rollups):
        sys.stderr.write(
            "no non-empty rollups found; refusing to write dashboard (keeping last-good)\n")
        return 1

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_html(rollups), encoding="utf-8")
    sys.stderr.write(f"wrote {output} ({len(rollups)} channel(s))\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
