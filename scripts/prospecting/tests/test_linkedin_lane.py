from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.prospecting.browser_guard import CHROME_CHANNEL, LINKEDIN_HOST
from scripts.prospecting.linkedin_lane import LinkedInAssistedLane
from scripts.prospecting.p2_store import TargetPolicy, validate_target_policy
from scripts.prospecting.store import open_store


class Clock:
    def __init__(self):
        self.value = datetime(2026, 9, 3, tzinfo=timezone.utc)

    def now(self):
        return self.value

    def advance(self, seconds):
        self.value += timedelta(seconds=seconds)


class Rng:
    def randint(self, low, high):
        assert (low, high) == (45, 120)
        return 45


class Page:
    def __init__(self, clock, html="<main>fixture</main>", navigation_seconds=0):
        self.clock = clock
        self.html = html
        self.navigation_seconds = navigation_seconds
        self.urls = []
        self.closed = False

    def goto(self, url):
        self.urls.append(url)
        self.clock.advance(self.navigation_seconds)

    def content(self):
        return self.html

    def close(self):
        self.closed = True


class Opener:
    def __init__(self, page):
        self.page = page
        self.calls = []

    def __call__(self, user_data_dir, channel):
        self.calls.append((user_data_dir, channel))
        return self.page


def live_lane(clock, connection, page, sleeper=lambda _: None):
    return LinkedInAssistedLane(
        clock, connection, Rng(), sleeper, _page_opener=Opener(page)
    )


def enable(lane):
    lane.plan(
        SimpleNamespace(
            enabled=True, lanes=("linkedin_assisted",), domain_allowlist=(LINKEDIN_HOST,)
        )
    )
    return lane


@pytest.fixture
def database():
    return open_store(Path(":memory:"))


def test_checkpoint_stop_persists_and_human_clear_is_required(database, monkeypatch, tmp_path):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    clock = Clock()
    checkpoint_page = Page(clock, "<main>checkpoint</main>")
    first = enable(live_lane(clock, database, checkpoint_page))
    assert first.run_live(("file:///synthetic-checkpoint.html",)) == "checkpoint"

    later_page = Page(clock)
    second = enable(live_lane(clock, database, later_page))
    assert second.run_live(("file:///synthetic-later.html",)) == "checkpoint_stop_active"
    assert later_page.urls == []
    with pytest.raises(ValueError, match="checkpoint_clear_requires_human"):
        second.clear_checkpoint_stop("worker:opaque")
    second.clear_checkpoint_stop("human:opaque")
    assert second.run_live(("file:///synthetic-later.html",)) == "exhausted"
    assert later_page.urls == ["file:///synthetic-later.html"]


def test_slow_navigation_crossing_session_limit_is_not_counted(database, monkeypatch, tmp_path):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    clock = Clock()
    page = Page(clock, navigation_seconds=1800)
    lane = enable(live_lane(clock, database, page))
    assert lane.run_live(("file:///synthetic-slow.html",)) == "session_limit"
    assert database.execute(
        "SELECT COUNT(*) FROM audit WHERE action='linkedin_profile_load_success'"
    ).fetchone()[0] == 0


def test_spacing_is_checked_against_the_clock(database, monkeypatch, tmp_path):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    clock = Clock()
    page = Page(clock)
    lane = enable(live_lane(clock, database, page))
    assert lane.run_live(("file:///synthetic-one.html", "file:///synthetic-two.html")) == "spacing_not_elapsed"
    assert page.urls == ["file:///synthetic-one.html"]


def test_page_opener_receives_only_guarded_dedicated_chrome_settings(database, monkeypatch, tmp_path):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    clock = Clock()
    page = Page(clock)
    opener = Opener(page)
    lane = LinkedInAssistedLane(clock, database, Rng(), lambda _: None, _page_opener=opener)
    enable(lane)
    assert lane.run_live(("file:///synthetic-page.html",)) == "exhausted"
    assert opener.calls == [(tmp_path / "kb-outreach-chrome", CHROME_CHANNEL)]


def test_linkedin_policy_rejects_any_host_other_than_the_single_allowed_host():
    policy = TargetPolicy((), 0, 0, (), (), "fit-v1", True, ("linkedin_assisted",), ("example.test",))
    with pytest.raises(ValueError, match="linkedin_domain_allowlist_must_be_exact"):
        validate_target_policy(policy)
