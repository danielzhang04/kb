from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.prospecting.browser_guard import (
    BrowserPolicy,
    check_navigation,
    check_action,
    detect_stop,
    dedicated_user_data_dir,
    validate_dedicated_launch,
    CHROME_CHANNEL,
    LINKEDIN_HOST,
)
from scripts.prospecting.fetcher import _load_finder_pages
from scripts.prospecting.linkedin_lane import LinkedInAssistedLane, LinkedInBudget
from scripts.prospecting.linkedin_parsers import (
    parse_company,
    parse_profile,
    parse_search_results,
)
from scripts.prospecting.store import open_store


class FakeClock:
    def __init__(self):
        self.value = datetime(2026, 9, 3, tzinfo=timezone.utc)

    def now(self):
        return self.value

    def advance(self, seconds):
        self.value += timedelta(seconds=seconds)


class FakeRng:
    def __init__(self, values):
        self.values = iter(values)
        self.calls = 0

    def randint(self, low, high):
        self.calls += 1
        value = next(self.values)
        assert low <= value <= high
        return value


class FakePage:
    def __init__(self, html="<main>fixture</main>"):
        self.html = html
        self.actions = []
        self.closed = False
        self.urls = []
        self.active = 0
        self.max_active = 0

    def goto(self, url):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.urls.append(url)
        self.active -= 1

    def content(self):
        return self.html

    def close(self):
        self.closed = True


class FakePageOpener:
    def __init__(self, page):
        self.page = page
        self.open_count = 0
        self.requests = []

    def __call__(self, user_data_dir, channel):
        self.open_count += 1
        self.requests.append((user_data_dir, channel))
        return self.page


class FakeContext:
    def __init__(self):
        self.pages = [FakePage()]

    def new_page(self):
        self.pages.append(FakePage())
        return self.pages[-1]


class FakeChromium:
    def __init__(self):
        self.calls = []
        self.context = FakeContext()

    def launch_persistent_context(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.context


class FakePlaywright:
    def __init__(self):
        self.chromium = FakeChromium()


@pytest.fixture
def fake_clock():
    return FakeClock()


@pytest.fixture
def budget_db():
    return open_store(Path(":memory:"))


@pytest.fixture
def fake_page():
    return FakePage()


@pytest.fixture
def fake_playwright():
    return FakePlaywright()


@pytest.fixture
def local_html_fixtures(tmp_path):
    values = {
        "profile": '<span data-field="full_name">Synthetic Person</span><span data-field="title">Partner</span>',
        "company": '<span data-field="name">Synthetic Capital</span><span data-field="industry">Software</span>',
        "search": '<article data-result="1"><span data-field="full_name">Synthetic Person</span><span data-field="title">Partner</span></article>',
    }
    paths = {}
    for name, body in values.items():
        path = tmp_path / f"{name}.html"
        path.write_text(body, encoding="utf-8")
        paths[name] = path
    return paths


def enable_live_lane(lane, hosts=(LINKEDIN_HOST,)):
    lane.plan(
        SimpleNamespace(
            enabled=True,
            lanes=("linkedin_assisted",),
            domain_allowlist=hosts,
        )
    )
    return lane


def test_every_forbidden_action_is_rejected_exhaustively():
    forbidden = ("connect", "message", "follow", "like", "react", "post", "download", "export", "settings", "cookie", "token")
    for action in forbidden:
        with pytest.raises(ValueError, match=f"browser_action_blocked:{action}"):
            check_action(action)
    for action in ("search_results", "profile_page", "company_page", "close", "wait"):
        assert check_action(action) is None


def test_navigation_is_limited_to_allowed_pages_and_offline_fixtures(monkeypatch):
    policy = BrowserPolicy(("linkedin.example.test",))
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    check_navigation("file:///tmp/synthetic.html", policy)
    check_navigation("https://linkedin.example.test/in/synthetic-person", policy)
    with pytest.raises(ValueError, match="browser_domain_blocked"):
        check_navigation("https://example.test/in/synthetic-person", policy)
    with pytest.raises(ValueError, match="browser_action_blocked"):
        check_navigation("https://linkedin.example.test/feed/", policy)


def test_write_action_url_is_refused():
    policy = BrowserPolicy(("example.test",))
    with pytest.raises(ValueError, match="browser_action_blocked"):
        check_navigation("https://example.test/messaging/compose", policy)


def test_lane_allows_exactly_40_paced_file_loads_and_no_41st(
    tmp_path, fake_clock, budget_db, monkeypatch, record_property,
):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    urls = []
    for index in range(41):
        path = tmp_path / f"profile-{index}.html"
        path.write_text("<main>fixture</main>", encoding="utf-8")
        urls.append(path.as_uri())
    page = FakePage()
    rng = FakeRng([45] * 40)
    sleeps = []
    def sleeper(seconds):
        sleeps.append(seconds)
        fake_clock.advance(seconds)
    lane = enable_live_lane(LinkedInAssistedLane(fake_clock, budget_db, rng, sleeper, _page_opener=FakePageOpener(page)))
    result = lane.run_live(tuple(urls))
    assert result == "cap_reached"
    assert len(page.urls) == 40 and urls[40] not in page.urls
    assert sleeps == [45] * 40
    assert rng.calls == 40
    assert sum(sleeps) == 1800
    assert page.max_active == 1
    assert budget_db.execute("SELECT COUNT(*) FROM audit WHERE action='linkedin_profile_load_success'").fetchone()[0] == 40
    record_property("linkedin_successful_loads", 40)
    record_property("linkedin_delay_bound_assertions", 1)


def test_lane_uses_injected_rng_and_sleeper_at_upper_bound(
    tmp_path, fake_clock, budget_db, monkeypatch, record_property,
):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    paths = []
    for index in range(2):
        path = tmp_path / f"upper-{index}.html"
        path.write_text("<main>fixture</main>", encoding="utf-8")
        paths.append(path.as_uri())
    page = FakePage()
    rng = FakeRng([120])
    sleeps = []
    def sleeper(seconds):
        sleeps.append(seconds)
        fake_clock.advance(seconds)
    lane = enable_live_lane(LinkedInAssistedLane(fake_clock, budget_db, rng, sleeper, _page_opener=FakePageOpener(page)))
    assert lane.run_live(tuple(paths)) == "exhausted"
    assert page.urls == paths and sleeps == [120] and rng.calls == 1
    record_property("linkedin_delay_bound_assertions", 1)


def test_session_never_exceeds_30_minutes(fake_clock, budget_db, record_property):
    budget = LinkedInBudget(budget_db, fake_clock)
    budget.start_session()
    fake_clock.advance(1800)
    assert not budget.may_navigate()
    record_property("linkedin_session_cap_assertions", 1)


@pytest.mark.parametrize("marker", ["captcha", "checkpoint", "rate warning", "login challenge", "unexpected modal"])
def test_each_checkpoint_marker_stops(marker):
    assert detect_stop(f"<html><body>{marker}</body></html>") is not None


def test_checkpoint_causes_zero_later_clicks(
    fake_page, fake_clock, budget_db, tmp_path, monkeypatch, record_property,
):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    fixture = Path("orgs/prospecting/fixtures/linkedin-checkpoint.html").resolve()
    later = tmp_path / "later.html"
    later.write_text("<main>later</main>", encoding="utf-8")
    fake_page.html = fixture.read_text(encoding="utf-8")
    lane = LinkedInAssistedLane(fake_clock, budget_db, FakeRng([45]), lambda _: None, _page_opener=FakePageOpener(fake_page))
    enable_live_lane(lane)
    assert lane.run_live((fixture.as_uri(), later.as_uri())) == "checkpoint"
    assert fake_page.urls == [fixture.as_uri()]
    assert fake_page.actions == [] and fake_page.closed
    record_property("post_checkpoint_zero_click_assertions", 1)


def test_success_audit_stores_hash_and_never_url(tmp_path, fake_clock, budget_db, monkeypatch):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    path = tmp_path / "profile.html"
    path.write_text("<main>fixture</main>", encoding="utf-8")
    page = FakePage()
    lane = LinkedInAssistedLane(fake_clock, budget_db, FakeRng([45]), lambda _: None, _page_opener=FakePageOpener(page))
    enable_live_lane(lane)
    lane.run_live((path.as_uri(),))
    digest = budget_db.execute("SELECT after_hash FROM audit WHERE action='linkedin_profile_load_success'").fetchone()[0]
    assert len(digest) == 64 and path.as_uri() not in digest


def test_non_dedicated_profile_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    user_dir = dedicated_user_data_dir({"LOCALAPPDATA": str(tmp_path)})
    assert user_dir == tmp_path / "kb-outreach-chrome"
    with pytest.raises(ValueError, match="browser_profile_refused"):
        validate_dedicated_launch(tmp_path / "other-profile", CHROME_CHANNEL)


def test_parsers_limit_fields(local_html_fixtures):
    assert all(path.as_uri().startswith("file://") for path in local_html_fixtures.values())
    assert set(parse_profile(local_html_fixtures["profile"].read_text(encoding="utf-8"))) <= {"first_name", "full_name", "title", "location", "linkedin_url", "company_name", "company_linkedin_url"}
    assert set(parse_company(local_html_fixtures["company"].read_text(encoding="utf-8"))) <= {"name", "website_url", "linkedin_url", "industry", "location", "one_line_summary"}
    assert all(set(row) <= {"full_name", "title", "linkedin_url", "company_name"} for row in parse_search_results(local_html_fixtures["search"].read_text(encoding="utf-8")))


def test_parsers_keep_the_innermost_field_through_nested_tags_and_siblings():
    html = (
        '<span data-field="title"><strong>Partner</strong></span>'
        '<span data-field="location"><em>New York</em></span>'
    )
    assert parse_profile(html) == {"title": "Partner", "location": "New York"}


def test_live_lane_rejects_disabled_policy_before_opening_a_page(fake_clock, budget_db):
    factory = FakePageOpener(FakePage())
    lane = LinkedInAssistedLane(fake_clock, budget_db, FakeRng([45]), lambda _: None, _page_opener=factory)
    with pytest.raises(ValueError, match="linkedin_lane_disabled"):
        lane.plan(SimpleNamespace(enabled=False, lanes=("linkedin_assisted",), domain_allowlist=("linkedin.example.test",)))
    assert factory.open_count == 0


def test_live_lane_rejects_non_allowlisted_url_before_opening_a_page(fake_clock, budget_db):
    factory = FakePageOpener(FakePage())
    lane = enable_live_lane(LinkedInAssistedLane(fake_clock, budget_db, FakeRng([45]), lambda _: None, _page_opener=factory))
    with pytest.raises(ValueError, match="browser_domain_blocked"):
        lane.run_live(("https://example.test/in/synthetic-person",))
    assert factory.open_count == 0


def test_live_lane_validates_all_urls_before_opening_a_page(fake_clock, budget_db):
    factory = FakePageOpener(FakePage())
    lane = enable_live_lane(LinkedInAssistedLane(fake_clock, budget_db, FakeRng([45]), lambda _: None, _page_opener=factory))
    with pytest.raises(ValueError, match="browser_domain_blocked"):
        lane.run_live((
            "https://linkedin.example.test/in/synthetic-person",
            "https://example.test/in/synthetic-person",
        ))
    assert factory.open_count == 0


def test_finder_page_fixture_urls_resolve_inside_the_fixture_directory():
    repo_root = Path(__file__).resolve().parents[3]
    fixture_dir = repo_root / "orgs/prospecting/fixtures"
    pages = _load_finder_pages(fixture_dir)
    fixture_prefix = fixture_dir.resolve().as_uri().rstrip("/") + "/"
    assert all(
        row["url"].startswith(fixture_prefix)
        for row in pages["linkedin_local_pages"]
    )


def test_p2_tests_and_fixtures_contain_no_real_linkedin_domain():
    repo_root = Path(__file__).resolve().parents[3]
    forbidden = "linkedin" + ".com"
    paths = tuple(
        path
        for root in (repo_root / "scripts/prospecting/tests", repo_root / "orgs/prospecting/fixtures")
        for path in root.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts
    )
    assert all(
        forbidden not in path.read_text(encoding="utf-8", errors="ignore").casefold()
        for path in paths
    )


def test_dry_run_opens_no_browser(fake_clock, budget_db):
    lane = LinkedInAssistedLane(fake_clock, budget_db, FakeRng([45]), lambda _: None, _page_opener=lambda *_: (_ for _ in ()).throw(AssertionError("browser opened")))
    planned = lane.dry_run(type("P", (), {"limit": 3})(), None, fake_clock.now())
    assert len(planned) == 3


def test_feature_flag_off_unless_policy_lists_lane(fake_clock, budget_db):
    lane = LinkedInAssistedLane(fake_clock, budget_db, FakeRng([45]), lambda _: None, _page_opener=lambda *_: None)
    with pytest.raises(ValueError, match="linkedin_lane_disabled"):
        lane.plan(SimpleNamespace(enabled=False, lanes=(), domain_allowlist=()))
