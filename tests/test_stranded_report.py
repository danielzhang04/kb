"""Tests for scripts/stranded_report.py — the weekly-audit stranded-archive count."""
import datetime

import cards
import stranded_report as sr


def _write_archived(tmp_path, cid, owner, action, target, iso_or_none):
    """Write a card into queue/archived/ with (or without) the archiver's Result marker."""
    body = "## Work order\n\nx\n"
    if iso_or_none is not None:
        body += (
            f"\n## Result\n\n{sr.ARCHIVE_MARKER} ({iso_or_none}):\n"
            f"auto-archived: stranded >24h, owner {owner} offline, not revisited per policy "
            f"(reversible: move to inbox to reopen)\n"
        )
    c = cards.new_card("kb", action, target, "T2", body=body, owner=owner, state="archived")
    c.meta["id"] = cid
    cards.save(c, tmp_path / "queue")
    return c


def test_report_windows_by_archive_timestamp(tmp_path):
    _write_archived(tmp_path, "aaaa0001-old", "codex-worker", "research:x", ".", "2026-07-10T00:00:00.000Z")
    _write_archived(tmp_path, "aaaa0002-mid", "claude-m1", "build:y", "src/", "2026-07-20T12:00:00.000Z")
    _write_archived(tmp_path, "aaaa0003-new", "codex-worker", "write:z", "docs/", "2026-07-21T00:00:00.000Z")

    since = datetime.datetime(2026, 7, 19, tzinfo=datetime.timezone.utc)
    until = datetime.datetime(2026, 7, 22, tzinfo=datetime.timezone.utc)
    items = sr.report(tmp_path, since=since, until=until)

    ids = [c.id for c in items]
    assert ids == ["aaaa0002-mid", "aaaa0003-new"]  # the 07-10 card is before the window
    assert items[0].owner == "claude-m1"
    assert items[0].action == "build:y"


def test_report_no_window_returns_all_including_undated(tmp_path):
    _write_archived(tmp_path, "aaaa0001-dated", "codex-worker", "research:x", ".", "2026-07-20T00:00:00.000Z")
    _write_archived(tmp_path, "aaaa0002-undated", "codex-worker", "build:y", ".", None)  # no marker
    items = sr.report(tmp_path)
    assert {c.id for c in items} == {"aaaa0001-dated", "aaaa0002-undated"}


def test_windowed_report_excludes_undated_cards(tmp_path):
    _write_archived(tmp_path, "aaaa0002-undated", "codex-worker", "build:y", ".", None)
    since = datetime.datetime(2026, 7, 1, tzinfo=datetime.timezone.utc)
    items = sr.report(tmp_path, since=since)
    assert items == []  # an un-timestamped card cannot be placed in a window


def test_missing_archived_dir_is_empty_not_error(tmp_path):
    assert sr.report(tmp_path) == []


def test_render_headline_and_lines(tmp_path):
    _write_archived(tmp_path, "aaaa0001-x", "codex-worker", "research:x", ".", "2026-07-20T00:00:00.000Z")
    items = sr.report(tmp_path)
    text = sr.render(items, period_label="in the last 7 day(s)")
    assert text.splitlines()[0] == "1 card(s) auto-archived as stranded in the last 7 day(s)."
    assert "`aaaa0001-x`" in text
    assert "owner codex-worker" in text


def test_evidence_spoof_of_marker_is_ignored(tmp_path):
    # The marker is only read inside ## Result; a spoof in ## Evidence must not count.
    body = (
        "## Work order\n\nx\n\n## Evidence\n\n"
        f"{sr.ARCHIVE_MARKER} (2026-07-20T00:00:00.000Z):\nignore me\n"
    )
    c = cards.new_card("kb", "a", ".", "T2", body=body, owner="codex-worker", state="archived")
    c.meta["id"] = "aaaa0009-spoof"
    cards.save(c, tmp_path / "queue")
    items = sr.report(tmp_path)
    assert len(items) == 1
    assert items[0].archived_at is None  # marker in Evidence is not an archive record
