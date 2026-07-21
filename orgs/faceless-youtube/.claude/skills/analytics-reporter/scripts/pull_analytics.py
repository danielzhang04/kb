#!/usr/bin/env python3
"""pull_analytics.py — READ-ONLY pull of YouTube Analytics for one channel's published videos.

The learning loop's read side: `idea-generator` reads each channel's `performance.md` to learn what
worked; this is the first thing that ever writes real numbers toward it (via `append_digest.py`).

What it does (network path):
  1. Mint a short-lived access token from the OAuth refresh token  (_access_token — the ONLY place
     the three OAuth env vars are ever read, and the ONLY token-minting network call).
  2. Discover the channel's published videos by scanning publish-record.json files.
  3. For each video, fetch three read-only YouTube Analytics API v2 reports (_fetch_report):
        basics       — views, estimatedMinutesWatched, averageViewDuration, subscribersGained
        impressions  — impressions, impressionsClickThroughRate
        retention    — audienceWatchRatio over elapsedVideoTimeRatio (the retention curve)
  4. Parse each report (pure parse_report), reduce to per-video metrics (pure video_metrics),
     assemble one dated "pull", MERGE it into analytics/<channel>/rollup.json (pure rollup — later
     pull wins per video+date), and archive the raw JSON under analytics/<channel>/raw/<date>.json.

CREDENTIAL LAW (constitution-bound):
  * The three OAuth env vars (client id / client secret / refresh token) are read at RUNTIME ONLY,
    inside _access_token — that function is the sole place their names even appear. They are never
    printed, logged, written to disk, or placed in any output or error message.
  * The minted access token flows ONLY from _access_token into _fetch_report (which owns the
    `Authorization: Bearer` header). No parser, rollup, discovery, or disk-writing function ever
    receives it. urllib exception chains are scrubbed (`from None`) so an HTTPError body or traceback
    can never carry a token, and no raised message ever contains a header value.

Freshness caveat: YouTube Analytics lags ~24-48h. "Freshness" here == the last run's --date; that IS
the correct fidelity, documented as such. Timestamps are caller-supplied via --date (no ambient clock)
so a run is reproducible.

Usage:
    py -3 pull_analytics.py --channel the-second-take --date 2026-07-20 \
        [--channel-root <dir>] [--analytics-root <dir>] [--video <slug>]

Only parse_report / retention_curve / video_metrics / rollup / discover_videos are unit-tested; the
two network functions are never touched by tests.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TOKEN_URL = "https://oauth2.googleapis.com/token"
ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports"

BASICS_METRICS = "views,estimatedMinutesWatched,averageViewDuration,subscribersGained"
IMPRESSIONS_METRICS = "impressions,impressionsClickThroughRate"
RETENTION_METRICS = "audienceWatchRatio"


# ------------------------------------------------------------------------------------------------
# Network boundary — the ONLY two functions that touch the wire. NEVER exercised by tests.
# ------------------------------------------------------------------------------------------------
def _access_token() -> str:
    """Exchange the OAuth refresh token for a short-lived access token.

    This is the ONE site that reads the three OAuth env vars and the ONE token-minting network call.
    On any failure it raises a message containing ONLY the HTTP status code — never a body, never a
    credential — and suppresses the exception chain so no traceback frame can surface a secret.
    """
    import os  # local: keep the env surface confined to this function

    client_id = os.environ.get("YOUTUBE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_OAUTH_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_OAUTH_REFRESH_TOKEN")
    missing = [n for n, v in (
        ("YOUTUBE_OAUTH_CLIENT_ID", client_id),
        ("YOUTUBE_OAUTH_CLIENT_SECRET", client_secret),
        ("YOUTUBE_OAUTH_REFRESH_TOKEN", refresh_token),
    ) if not v]
    if missing:
        # Names only (they are not secret); values are never touched here.
        raise RuntimeError(f"missing OAuth env var(s): {', '.join(missing)}")

    body = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode("utf-8")
    req = urllib.request.Request(TOKEN_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Scrub: report status only. The request body carried the secret; drop the chain so no
        # traceback frame (which may hold `body`/`req`) and no HTTPError content can leak it.
        raise RuntimeError(f"token refresh failed (HTTP {e.code})") from None
    except urllib.error.URLError:
        raise RuntimeError("token refresh failed (network error)") from None
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("token refresh failed (no access_token in response)")
    return token


def _fetch_report(access_token, ids, video_id, start_date, end_date, metrics, dimensions=None):
    """GET one read-only YouTube Analytics v2 report. Owns the Authorization header (built from the
    minted token, never from an env var). Scrubs exception chains so the bearer value cannot leak."""
    params = {
        "ids": ids,
        "startDate": start_date,
        "endDate": end_date,
        "metrics": metrics,
        "filters": f"video=={video_id}",
    }
    if dimensions:
        params["dimensions"] = dimensions
    url = ANALYTICS_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", "Bearer " + access_token)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Never echo the header; report status + video id only, and drop the chain.
        raise RuntimeError(f"analytics fetch failed for {video_id} (HTTP {e.code})") from None
    except urllib.error.URLError:
        raise RuntimeError(f"analytics fetch failed for {video_id} (network error)") from None


# ------------------------------------------------------------------------------------------------
# Pure functions — unit-tested, no network, no secrets.
# ------------------------------------------------------------------------------------------------
def parse_report(json_dict) -> list:
    """Map a YouTube Analytics v2 resultTable (columnHeaders + rows) into a list of dict rows.

    columnHeaders is row-major header metadata; rows is a list of value arrays aligned to it. A
    response with no `rows` key (a video with no data yet) parses to [].
    """
    headers = [c["name"] for c in json_dict.get("columnHeaders", [])]
    rows = json_dict.get("rows") or []
    return [dict(zip(headers, row)) for row in rows]


def retention_curve(rows) -> list:
    """From parsed retention rows → [[elapsedVideoTimeRatio, audienceWatchRatio], ...], time-sorted."""
    curve = [
        [r.get("elapsedVideoTimeRatio"), r.get("audienceWatchRatio")]
        for r in rows
        if r.get("elapsedVideoTimeRatio") is not None
    ]
    curve.sort(key=lambda p: p[0])
    return curve


def video_metrics(basics_rows, impressions_rows, retention_rows) -> dict:
    """Reduce the three parsed reports into one flat per-video metrics dict (all keys always present;
    a missing metric → None). Snake_case keys are our stable on-disk contract."""
    b = basics_rows[0] if basics_rows else {}
    i = impressions_rows[0] if impressions_rows else {}
    return {
        "views": b.get("views"),
        "estimated_minutes_watched": b.get("estimatedMinutesWatched"),
        "average_view_duration": b.get("averageViewDuration"),
        "subscribers_gained": b.get("subscribersGained"),
        "impressions": i.get("impressions"),
        "impressions_ctr": i.get("impressionsClickThroughRate"),
        "retention": retention_curve(retention_rows),
    }


def rollup(existing, pull) -> dict:
    """Merge a dated `pull` into the running rollup. Pure — never mutates `existing`.

    Structure:
        {"channel": <name>, "videos": {<video_id>: {"slug", "title", "pulls": {<date>: <metrics>}}}}
    Merge rule: LATER PULL WINS PER VIDEO+DATE — a re-pull on the same date replaces that date's
    block (no duplicate date); a new date adds a block. slug/title live once at the video level and
    are refreshed from the incoming pull.
    """
    out = json.loads(json.dumps(existing)) if existing else {"channel": pull["channel"], "videos": {}}
    out.setdefault("channel", pull["channel"])
    out.setdefault("videos", {})
    date = pull["date"]
    for vid, m in pull["videos"].items():
        metrics = {k: v for k, v in m.items() if k not in ("slug", "title")}
        node = out["videos"].setdefault(vid, {"slug": m.get("slug"), "title": m.get("title"),
                                              "pulls": {}})
        node["slug"] = m.get("slug", node.get("slug"))
        node["title"] = m.get("title", node.get("title"))
        node.setdefault("pulls", {})
        node["pulls"][date] = metrics  # assignment → later pull replaces same date, no duplicate
    return out


def discover_videos(channel_root) -> list:
    """Scan <channel_root>/videos/*/publish-record.json → published videos only.

    A video with no publish-record.json was never published and is skipped. Returns
    [{"slug", "video_id", "title"}] sorted by slug for deterministic output.
    """
    channel_root = Path(channel_root)
    found = []
    videos_dir = channel_root / "videos"
    if not videos_dir.is_dir():
        return found
    for rec_path in sorted(videos_dir.glob("*/publish-record.json")):
        try:
            rec = json.loads(rec_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        vid = rec.get("video_id")
        if not vid:
            continue
        snap = rec.get("metadata_snapshot") or {}
        title = ((snap.get("long_form") or {}).get("title_primary")
                 or snap.get("title") or rec_path.parent.name)
        found.append({"slug": rec_path.parent.name, "video_id": vid, "title": title})
    return found


# ------------------------------------------------------------------------------------------------
# Orchestration (network path; not unit-tested).
# ------------------------------------------------------------------------------------------------
def _pull_channel(channel, date, channel_root, video_filter=None) -> dict:
    """Mint token, discover videos, fetch+parse all three reports each → one dated pull dict."""
    token = _access_token()
    videos = discover_videos(channel_root)
    if video_filter:
        videos = [v for v in videos if v["slug"] == video_filter]
    ids = "channel==MINE"
    start_date, end_date = "2005-01-01", date  # lifetime-to-date window
    out_videos = {}
    for v in videos:
        vid = v["video_id"]
        basics = parse_report(_fetch_report(token, ids, vid, start_date, end_date, BASICS_METRICS))
        impr = parse_report(_fetch_report(token, ids, vid, start_date, end_date, IMPRESSIONS_METRICS))
        ret = parse_report(_fetch_report(
            token, ids, vid, start_date, end_date, RETENTION_METRICS,
            dimensions="elapsedVideoTimeRatio"))
        m = video_metrics(basics, impr, ret)
        m["slug"] = v["slug"]
        m["title"] = v["title"]
        out_videos[vid] = m
    return {"channel": channel, "date": date, "videos": out_videos}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Read-only YouTube Analytics pull for one channel.")
    p.add_argument("--channel", required=True)
    p.add_argument("--date", required=True, help="ISO date (YYYY-MM-DD), caller-supplied — no clock")
    p.add_argument("--video", default=None, help="optional single video slug to limit the pull")
    p.add_argument("--channel-root", default=None,
                   help="channel dir (default: channels/<channel> relative to org root)")
    p.add_argument("--analytics-root", default=None,
                   help="analytics dir (default: analytics/ relative to org root)")
    args = p.parse_args(argv)

    org_root = Path(__file__).resolve().parents[3]  # .../orgs/faceless-youtube
    channel_root = Path(args.channel_root) if args.channel_root else org_root / "channels" / args.channel
    analytics_root = Path(args.analytics_root) if args.analytics_root else org_root / "analytics"

    if not channel_root.is_dir():
        sys.stderr.write(f"channel not found: {channel_root}\n")
        return 1

    pull = _pull_channel(args.channel, args.date, channel_root, args.video)
    if not pull["videos"]:
        sys.stderr.write(f"no published videos discovered for {args.channel}; nothing pulled\n")
        return 1

    ch_analytics = analytics_root / args.channel
    (ch_analytics / "raw").mkdir(parents=True, exist_ok=True)
    (ch_analytics / "raw" / f"{args.date}.json").write_text(
        json.dumps(pull, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    rollup_path = ch_analytics / "rollup.json"
    existing = None
    if rollup_path.exists():
        try:
            existing = json.loads(rollup_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = None
    merged = rollup(existing, pull)
    rollup_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sys.stderr.write(f"pulled {len(pull['videos'])} video(s) for {args.channel} @ {args.date}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
