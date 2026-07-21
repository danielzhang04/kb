#!/usr/bin/env python3
"""Tests for analytics-reporter — network-free, tmp-dir fixtures, stdlib only (unittest).

Three engines under test, all NETWORK-FREE here:
  * pull_analytics.py   — the pure parse/rollup half (parse_report / retention_curve / video_metrics /
                          rollup / discover_videos). The two network functions (_access_token,
                          _fetch_report) are NEVER called by any test.
  * build_dashboard.py  — pure render_html + the refuse-to-write-on-empty guard.
  * append_digest.py    — pure apply_digest (idempotent-per-date replace-or-append).

Plus the mandatory `test_no_secret_leak`: the three OAuth env NAMES may appear only inside the single
function `_access_token`, and no disk-writing / pure function may receive the access-token object.

Fixtures are canned YouTube Analytics API **v2** `reports.query` responses — the documented
`columnHeaders` (name/columnType/dataType) + `rows` (row-major array) shape:
https://developers.google.com/youtube/analytics/reference/reports/query .

Run:  py -3 -m unittest test_analytics -v      (from this scripts/ dir)
"""
from __future__ import annotations

import ast
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import pull_analytics as pa  # noqa: E402
import build_dashboard as bd  # noqa: E402
import append_digest as ad  # noqa: E402


# --- Canned YouTube Analytics API v2 reports.query responses -------------------------------------

BASICS_RESPONSE = {
    "kind": "youtubeAnalytics#resultTable",
    "columnHeaders": [
        {"name": "views", "columnType": "METRIC", "dataType": "INTEGER"},
        {"name": "estimatedMinutesWatched", "columnType": "METRIC", "dataType": "INTEGER"},
        {"name": "averageViewDuration", "columnType": "METRIC", "dataType": "INTEGER"},
        {"name": "subscribersGained", "columnType": "METRIC", "dataType": "INTEGER"},
    ],
    "rows": [[1234, 5678, 210, 42]],
}

IMPRESSIONS_RESPONSE = {
    "kind": "youtubeAnalytics#resultTable",
    "columnHeaders": [
        {"name": "impressions", "columnType": "METRIC", "dataType": "INTEGER"},
        {"name": "impressionsClickThroughRate", "columnType": "METRIC", "dataType": "FLOAT"},
    ],
    "rows": [[10000, 4.5]],
}

RETENTION_RESPONSE = {
    "kind": "youtubeAnalytics#resultTable",
    "columnHeaders": [
        {"name": "elapsedVideoTimeRatio", "columnType": "DIMENSION", "dataType": "FLOAT"},
        {"name": "audienceWatchRatio", "columnType": "METRIC", "dataType": "FLOAT"},
    ],
    "rows": [[0.0, 1.0], [0.1, 0.88], [0.2, 0.77], [0.3, 0.71]],
}

# An empty result table (a brand-new video with no data yet) — rows key may be absent.
EMPTY_RESPONSE = {
    "kind": "youtubeAnalytics#resultTable",
    "columnHeaders": [{"name": "views", "columnType": "METRIC", "dataType": "INTEGER"}],
}


class ParseReportTests(unittest.TestCase):
    def test_parse_maps_columns_to_rows(self):
        rows = pa.parse_report(BASICS_RESPONSE)
        self.assertEqual(
            rows,
            [{"views": 1234, "estimatedMinutesWatched": 5678, "averageViewDuration": 210,
              "subscribersGained": 42}],
        )

    def test_parse_missing_rows_is_empty(self):
        self.assertEqual(pa.parse_report(EMPTY_RESPONSE), [])

    def test_retention_curve_pairs(self):
        curve = pa.retention_curve(pa.parse_report(RETENTION_RESPONSE))
        self.assertEqual(curve, [[0.0, 1.0], [0.1, 0.88], [0.2, 0.77], [0.3, 0.71]])

    def test_video_metrics_assembles_all(self):
        m = pa.video_metrics(
            basics_rows=pa.parse_report(BASICS_RESPONSE),
            impressions_rows=pa.parse_report(IMPRESSIONS_RESPONSE),
            retention_rows=pa.parse_report(RETENTION_RESPONSE),
        )
        self.assertEqual(m["views"], 1234)
        self.assertEqual(m["estimated_minutes_watched"], 5678)
        self.assertEqual(m["average_view_duration"], 210)
        self.assertEqual(m["subscribers_gained"], 42)
        self.assertEqual(m["impressions"], 10000)
        self.assertEqual(m["impressions_ctr"], 4.5)
        self.assertEqual(m["retention"][0], [0.0, 1.0])


class RollupMergeTests(unittest.TestCase):
    def _pull(self, date, views):
        return {
            "channel": "the-second-take",
            "date": date,
            "videos": {
                "VID1": {"slug": "2026-07-04-poyais", "title": "Poyais", "views": views,
                         "estimated_minutes_watched": views * 3, "average_view_duration": 200,
                         "impressions": 9000, "impressions_ctr": 3.9, "subscribers_gained": 10,
                         "retention": [[0.0, 1.0], [0.5, 0.6]]},
            },
        }

    def test_rollup_merges_two_dates(self):
        r = pa.rollup(None, self._pull("2026-07-15", 100))
        r = pa.rollup(r, self._pull("2026-07-20", 500))
        self.assertEqual(r["channel"], "the-second-take")
        pulls = r["videos"]["VID1"]["pulls"]
        self.assertEqual(set(pulls), {"2026-07-15", "2026-07-20"})
        self.assertEqual(pulls["2026-07-15"]["views"], 100)
        self.assertEqual(pulls["2026-07-20"]["views"], 500)
        # slug/title carried at the video level, not duplicated per pull
        self.assertEqual(r["videos"]["VID1"]["slug"], "2026-07-04-poyais")
        self.assertNotIn("slug", pulls["2026-07-20"])

    def test_later_pull_wins_per_video_date(self):
        r = pa.rollup(None, self._pull("2026-07-20", 100))
        r = pa.rollup(r, self._pull("2026-07-20", 999))  # same date, re-pulled → replaces
        pulls = r["videos"]["VID1"]["pulls"]
        self.assertEqual(list(pulls), ["2026-07-20"])  # no duplicate date
        self.assertEqual(pulls["2026-07-20"]["views"], 999)

    def test_rollup_does_not_mutate_existing(self):
        r1 = pa.rollup(None, self._pull("2026-07-15", 100))
        _ = pa.rollup(r1, self._pull("2026-07-20", 500))
        self.assertEqual(set(r1["videos"]["VID1"]["pulls"]), {"2026-07-15"})


class DiscoverVideosTests(unittest.TestCase):
    def test_discovers_from_publish_records(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for slug, vid in [("2026-07-04-poyais", "VID1"), ("2026-07-10-nauru", "VID2")]:
                vdir = root / "videos" / slug
                vdir.mkdir(parents=True)
                (vdir / "publish-record.json").write_text(json.dumps({
                    "video_id": vid, "url": f"https://www.youtube.com/watch?v={vid}",
                    "uploaded_at": "2026-07-11T00:00:00Z", "privacy_status": "private",
                    "file_sha256": "abc", "metadata_snapshot": {
                        "long_form": {"title_primary": f"Title {vid}"}},
                }), encoding="utf-8")
            # a video with no publish-record must be skipped (never published)
            (root / "videos" / "_scratch").mkdir(parents=True)
            found = pa.discover_videos(root)
            got = {v["video_id"]: v for v in found}
            self.assertEqual(set(got), {"VID1", "VID2"})
            self.assertEqual(got["VID1"]["slug"], "2026-07-04-poyais")
            self.assertEqual(got["VID1"]["title"], "Title VID1")


class DashboardTests(unittest.TestCase):
    def _rollups(self):
        return {
            "the-second-take": {
                "channel": "the-second-take",
                "videos": {
                    "VID1": {
                        "slug": "2026-07-04-poyais", "title": "Poyais",
                        "pulls": {"2026-07-20": {
                            "views": 500, "estimated_minutes_watched": 1500,
                            "average_view_duration": 200, "impressions": 9000,
                            "impressions_ctr": 3.9, "subscribers_gained": 10,
                            "retention": [[0.0, 1.0], [0.5, 0.6], [1.0, 0.3]]}},
                    },
                },
            },
        }

    def test_html_contains_required_marks(self):
        html = bd.render_html(self._rollups())
        self.assertIn("the-second-take", html)          # channel tab
        self.assertIn("tab-the-second-take", html)      # tab element id
        self.assertIn("2026-07-04-poyais", html)        # video slug drilldown
        self.assertIn("<svg", html)                     # inline SVG
        self.assertIn("<polyline", html)                # retention polyline

    def test_html_is_self_contained(self):
        html = bd.render_html(self._rollups())
        for forbidden in ("<script", "<link ", " src=", "@import", "url(http"):
            self.assertNotIn(forbidden, html, f"external ref leaked: {forbidden!r}")

    def test_refuses_to_write_when_all_rollups_empty(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            out = root / "dashboard.html"
            out.write_text("LAST-GOOD", encoding="utf-8")  # a prior good build
            # an analytics tree with an empty rollup (no videos)
            ch = root / "analytics" / "the-second-take"
            ch.mkdir(parents=True)
            (ch / "rollup.json").write_text(
                json.dumps({"channel": "the-second-take", "videos": {}}), encoding="utf-8")
            rc = bd.main(["--analytics-root", str(root / "analytics"), "-o", str(out)])
            self.assertNotEqual(rc, 0)
            self.assertEqual(out.read_text(encoding="utf-8"), "LAST-GOOD")  # untouched

    def test_writes_when_rollups_present(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            out = root / "dashboard.html"
            ch = root / "analytics" / "the-second-take"
            ch.mkdir(parents=True)
            (ch / "rollup.json").write_text(
                json.dumps(self._rollups()["the-second-take"]), encoding="utf-8")
            rc = bd.main(["--analytics-root", str(root / "analytics"), "-o", str(out)])
            self.assertEqual(rc, 0)
            self.assertIn("<polyline", out.read_text(encoding="utf-8"))

    def test_retention_scales_to_fixed_ceiling_not_per_video_peak(self):
        """Two videos with different true retention peaks (1.0 vs 0.5) must plot against the SAME
        fixed 0.0-1.0 y-ceiling. Under the old self-peak normalization, both curves' first points
        would land at the identical top pixel row (each video visually "looks like" 100% retention
        even though one only ever reaches 50%) — that's the bug. w=320,h=90,pad=6, so
        x = pad + x_ratio*(w-2*pad) and y = (h-pad) - clamp(y_ratio,0,1)*(h-2*pad)."""
        curve_full = [[0.0, 1.0], [1.0, 0.3]]   # true peak 1.0
        curve_low = [[0.0, 0.5], [1.0, 0.15]]   # true peak 0.5 — half as good
        svg_full = bd._retention_svg(curve_full)
        svg_low = bd._retention_svg(curve_low)
        self.assertIn("6.0,6.0", svg_full)     # ratio 1.0 against a 1.0 ceiling -> top of chart
        self.assertIn("6.0,45.0", svg_low)     # ratio 0.5 against the SAME 1.0 ceiling -> mid-chart
        # would be "6.0,6.0" too under the old normalize-to-own-peak behavior — must NOT happen now
        self.assertNotIn("6.0,6.0", svg_low)

    def test_retention_clamps_values_above_one(self):
        """A value >1.0 (data anomaly) must clamp to the 1.0 ceiling, not overflow above the chart
        (which an unclamped y = (h-pad) - y_ratio*(h-2*pad) would produce as a negative y)."""
        svg = bd._retention_svg([[0.0, 1.4], [1.0, 0.2]])
        self.assertIn("6.0,6.0", svg)   # clamped to the ceiling, not "6.0,-25.2"


PERF_SEED = """# Performance log — The Second Take

Append-only analytics + learnings.

## Learnings (what to do more / less of)

- (none yet)
"""


class DigestTests(unittest.TestCase):
    def _rollup(self):
        return {
            "channel": "the-second-take",
            "videos": {
                "VID1": {"slug": "2026-07-04-poyais", "title": "Poyais",
                         "pulls": {"2026-07-20": {
                             "views": 500, "estimated_minutes_watched": 1500,
                             "average_view_duration": 200, "impressions": 9000,
                             "impressions_ctr": 3.9, "subscribers_gained": 10,
                             "retention": [[0.0, 1.0], [1.0, 0.3]]}}},
            },
        }

    def test_appends_exactly_one_block(self):
        block = ad.digest_block("the-second-take", "2026-07-20", self._rollup())
        out = ad.apply_digest(PERF_SEED, "2026-07-20", block)
        self.assertEqual(out.count("<!-- digest:2026-07-20 START -->"), 1)
        self.assertEqual(out.count("<!-- digest:2026-07-20 END -->"), 1)
        self.assertIn("Poyais", out)

    def test_idempotent_same_date_replaces(self):
        b1 = ad.digest_block("the-second-take", "2026-07-20", self._rollup())
        once = ad.apply_digest(PERF_SEED, "2026-07-20", b1)
        # re-run same date with different content → replaces, never duplicates
        r2 = self._rollup()
        r2["videos"]["VID1"]["pulls"]["2026-07-20"]["views"] = 777
        b2 = ad.digest_block("the-second-take", "2026-07-20", r2)
        twice = ad.apply_digest(once, "2026-07-20", b2)
        self.assertEqual(twice.count("<!-- digest:2026-07-20 START -->"), 1)
        self.assertIn("| 777 |", twice)          # new views cell
        self.assertNotIn("| 500 |", twice)       # old views cell gone (not merely appended)

    def test_second_date_adds_block(self):
        b1 = ad.digest_block("the-second-take", "2026-07-20", self._rollup())
        once = ad.apply_digest(PERF_SEED, "2026-07-20", b1)
        b2 = ad.digest_block("the-second-take", "2026-07-27", self._rollup())
        twice = ad.apply_digest(once, "2026-07-27", b2)
        self.assertEqual(twice.count("<!-- digest:2026-07-20 START -->"), 1)
        self.assertEqual(twice.count("<!-- digest:2026-07-27 START -->"), 1)
        # newest at the bottom
        self.assertLess(twice.index("digest:2026-07-20"), twice.index("digest:2026-07-27"))


class OrgRootTests(unittest.TestCase):
    """Pins the default org-root resolution WITHOUT network. Each script lives at
    .../orgs/faceless-youtube/.claude/skills/analytics-reporter/scripts/<file>.py — its `_org_root()`
    must resolve to the `faceless-youtube` directory (which contains `.claude`), NOT `.claude` itself
    (an off-by-one in `parents[N]` silently makes every flagless invocation write to the wrong tree)."""

    def _assert_is_org_root(self, root):
        self.assertEqual(root.name, "faceless-youtube",
                          f"expected org root 'faceless-youtube', got {root}")
        self.assertTrue((root / ".claude").is_dir(),
                         f"{root} does not contain .claude — not the real org root")

    def test_pull_analytics_org_root(self):
        self._assert_is_org_root(pa._org_root())

    def test_build_dashboard_org_root(self):
        self._assert_is_org_root(bd._org_root())

    def test_append_digest_org_root(self):
        self._assert_is_org_root(ad._org_root())


class SecretLeakTests(unittest.TestCase):
    """CREDENTIAL LAW: the three OAuth env NAMES may appear only inside `_access_token`, and no pure /
    disk-writing function may receive the access-token object. Greps module source; never imports .env,
    never calls a network function."""

    ENV_NAMES = ["YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET",
                 "YOUTUBE_OAUTH_REFRESH_TOKEN"]

    def _fn_span(self, src, name):
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == name:
                return node.lineno, node.end_lineno
        return None

    def test_env_names_only_inside_access_token(self):
        src = (HERE / "pull_analytics.py").read_text(encoding="utf-8")
        span = self._fn_span(src, "_access_token")
        self.assertIsNotNone(span, "_access_token function must exist")
        lo, hi = span
        for i, line in enumerate(src.splitlines(), start=1):
            for env in self.ENV_NAMES:
                if env in line:
                    self.assertTrue(lo <= i <= hi,
                                    f"{env} leaked outside _access_token at line {i}: {line!r}")

    def test_env_names_absent_from_other_modules(self):
        for mod in ("build_dashboard.py", "append_digest.py"):
            src = (HERE / mod).read_text(encoding="utf-8")
            for env in self.ENV_NAMES:
                self.assertNotIn(env, src, f"{env} must not appear in {mod}")

    def test_no_writer_receives_the_token(self):
        """The access-token object flows ONLY from _access_token into _fetch_report. No pure parser,
        rollup, discovery, or disk-writing function takes a token/access_token parameter."""
        src = (HERE / "pull_analytics.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        allowed = {"_access_token", "_fetch_report"}
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name not in allowed:
                params = {a.arg for a in node.args.args}
                self.assertFalse(
                    params & {"access_token", "token", "bearer"},
                    f"{node.name} must not receive the token object (params={params})")


if __name__ == "__main__":
    unittest.main()
