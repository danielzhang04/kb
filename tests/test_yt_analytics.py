"""YouTube Analytics reports.query wrapper (scripts/yt_analytics.py, design D11).

No network: every test injects a fake transport. Covers:
  * not-authed exits (client secret absent, token absent, expired-without-refresh, refresh rejected)
    each raise NotAuthed and main() maps them to the distinct EXIT_NOT_AUTHED code;
  * a proactive refresh of an expired access token before the query;
  * a reactive refresh + single retry when reports.query returns 401;
  * request-URL construction for the default report (metrics/dates/ids=channel==MINE) and --raw;
  * TSV rendering;
  * the --auth loopback: the callback code parser + exchange_code token persistence with a fake
    (the real network handshake is NOT exercised).
"""
import json
from pathlib import Path

import pytest

import yt_analytics as yt


# --------------------------------------------------------------------------- #
# Fakes                                                                        #
# --------------------------------------------------------------------------- #

CLIENT_JSON = {
    "installed": {
        "client_id": "cid.apps.googleusercontent.com",
        "client_secret": "shhh",
        "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

REPORT_BODY = {
    "columnHeaders": [
        {"name": "day"},
        {"name": "views"},
        {"name": "estimatedMinutesWatched"},
        {"name": "subscribersGained"},
    ],
    "rows": [
        ["2026-07-18", 10, 55, 2],
        ["2026-07-19", 7, 33, 1],
    ],
}


class FakeTransport:
    """Scripted transport. Each call pops the next queued (matcher, Response) and records the request."""

    def __init__(self, script):
        self._script = list(script)
        self.calls = []

    def __call__(self, method, url, headers, data):
        self.calls.append({"method": method, "url": url, "headers": headers, "data": data})
        if not self._script:
            raise AssertionError(f"unexpected transport call: {method} {url}")
        response = self._script.pop(0)
        return response


def resp(status, obj):
    return yt.Response(status, json.dumps(obj).encode("utf-8"))


@pytest.fixture
def secret_file(tmp_path):
    path = tmp_path / "client_secret.json"
    path.write_text(json.dumps(CLIENT_JSON), encoding="utf-8")
    return path


def write_token(tmp_path, **overrides):
    token = {
        "access_token": "at-live",
        "refresh_token": "rt-1",
        "expiry": 10_000_000_000,  # far future
        "scope": yt.ANALYTICS_SCOPE,
    }
    token.update(overrides)
    path = tmp_path / "token.json"
    path.write_text(json.dumps(token), encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# not-authed exits                                                             #
# --------------------------------------------------------------------------- #

def test_missing_client_secret_is_not_authed(tmp_path):
    with pytest.raises(yt.NotAuthed) as exc:
        yt.load_client_secret(tmp_path / "nope.json")
    assert "not-authed" in str(exc.value)
    assert "G1" in str(exc.value)


def test_missing_token_is_not_authed(secret_file, tmp_path):
    with pytest.raises(yt.NotAuthed) as exc:
        yt.run_report(
            yt.default_params(7),
            secret_path=secret_file,
            tok_path=tmp_path / "absent-token.json",
            transport=FakeTransport([]),
        )
    assert "no analytics token" in str(exc.value)
    assert "G4" in str(exc.value)


def test_expired_token_without_refresh_token_is_not_authed(secret_file, tmp_path):
    tok = write_token(tmp_path, refresh_token=None, expiry=0, access_token="stale")
    with pytest.raises(yt.NotAuthed) as exc:
        yt.run_report(
            yt.default_params(7),
            secret_path=secret_file,
            tok_path=tok,
            transport=FakeTransport([]),
            now_fn=lambda: 1_000_000.0,
        )
    assert "no refresh_token" in str(exc.value)


def test_refresh_rejection_is_not_authed(secret_file, tmp_path):
    tok = write_token(tmp_path, expiry=0)  # forces a proactive refresh
    transport = FakeTransport([resp(400, {"error": "invalid_grant"})])
    with pytest.raises(yt.NotAuthed) as exc:
        yt.run_report(
            yt.default_params(7),
            secret_path=secret_file,
            tok_path=tok,
            transport=transport,
            now_fn=lambda: 1_000_000.0,
        )
    assert "refresh was rejected" in str(exc.value)


def test_main_maps_not_authed_to_distinct_exit_code(monkeypatch, tmp_path):
    # No client secret + no token, and a green preamble => the not-authed exit code, not success/usage.
    monkeypatch.setenv("YT_ANALYTICS_CLIENT_SECRET", str(tmp_path / "missing.json"))
    monkeypatch.setenv("YT_ANALYTICS_TOKEN", str(tmp_path / "missing-token.json"))
    monkeypatch.setattr(yt, "_run_preamble", lambda root: [])
    code = yt.main(["--days", "7"])
    assert code == yt.EXIT_NOT_AUTHED
    assert code != yt.EXIT_OK


def test_main_preamble_failure_stops_before_anything(monkeypatch):
    monkeypatch.setattr(yt, "_run_preamble", lambda root: ["STOP file present — fleet is frozen"])
    assert yt.main(["--days", "7"]) == yt.EXIT_PREAMBLE


# --------------------------------------------------------------------------- #
# token refresh                                                                #
# --------------------------------------------------------------------------- #

def test_proactive_refresh_of_expired_access_token(secret_file, tmp_path):
    tok = write_token(tmp_path, expiry=0, access_token="stale")
    transport = FakeTransport([
        resp(200, {"access_token": "at-fresh", "expires_in": 3600}),  # refresh POST
        resp(200, REPORT_BODY),                                        # reports GET
    ])
    report = yt.run_report(
        yt.default_params(7),
        secret_path=secret_file,
        tok_path=tok,
        transport=transport,
        now_fn=lambda: 1_000_000.0,
    )
    assert report == REPORT_BODY
    # first call refreshed, second queried with the NEW bearer
    assert transport.calls[0]["method"] == "POST"
    assert transport.calls[1]["headers"]["Authorization"] == "Bearer at-fresh"
    # the refreshed token was persisted
    persisted = json.loads(Path(tok).read_text(encoding="utf-8"))
    assert persisted["access_token"] == "at-fresh"


def test_reactive_refresh_and_retry_on_401(secret_file, tmp_path):
    tok = write_token(tmp_path)  # not expired -> no proactive refresh
    transport = FakeTransport([
        resp(401, {"error": "unauthorized"}),                          # first GET rejected
        resp(200, {"access_token": "at-after-401", "expires_in": 3600}),  # refresh POST
        resp(200, REPORT_BODY),                                        # retry GET
    ])
    report = yt.run_report(
        yt.default_params(7),
        secret_path=secret_file,
        tok_path=tok,
        transport=transport,
        now_fn=lambda: 1_000_000.0,
    )
    assert report == REPORT_BODY
    assert [c["method"] for c in transport.calls] == ["GET", "POST", "GET"]
    assert transport.calls[2]["headers"]["Authorization"] == "Bearer at-after-401"


# --------------------------------------------------------------------------- #
# request URL construction                                                     #
# --------------------------------------------------------------------------- #

def test_default_params_and_url_construction():
    import datetime
    params = yt.default_params(7, end=datetime.date(2026, 7, 19))
    assert params["ids"] == "channel==MINE"
    assert params["startDate"] == "2026-07-13"  # 7-day inclusive window
    assert params["endDate"] == "2026-07-19"
    assert params["metrics"] == yt.DEFAULT_METRICS
    assert params["dimensions"] == "day"

    url = yt.build_report_url(params)
    assert url.startswith(yt.REPORTS_ENDPOINT + "?")
    assert "ids=channel%3D%3DMINE" in url
    assert "metrics=views%2CestimatedMinutesWatched%2CsubscribersGained" in url
    assert "startDate=2026-07-13" in url
    assert "endDate=2026-07-19" in url


def test_raw_params_passthrough_and_url():
    params = yt.raw_params(
        metrics="likes,comments",
        start_date="2026-01-01",
        end_date="2026-01-31",
        dimensions="country",
        ids="channel==MINE",
    )
    assert params == {
        "ids": "channel==MINE",
        "startDate": "2026-01-01",
        "endDate": "2026-01-31",
        "metrics": "likes,comments",
        "dimensions": "country",
    }
    url = yt.build_report_url(params)
    assert "metrics=likes%2Ccomments" in url
    assert "dimensions=country" in url


def test_default_params_rejects_nonpositive_days():
    with pytest.raises(ValueError):
        yt.default_params(0)


# --------------------------------------------------------------------------- #
# TSV rendering                                                                #
# --------------------------------------------------------------------------- #

def test_render_tsv():
    out = yt.render_tsv(REPORT_BODY)
    lines = out.split("\n")
    assert lines[0] == "day\tviews\testimatedMinutesWatched\tsubscribersGained"
    assert lines[1] == "2026-07-18\t10\t55\t2"
    assert lines[2] == "2026-07-19\t7\t33\t1"


def test_render_tsv_empty_rows_is_header_only():
    out = yt.render_tsv({"columnHeaders": [{"name": "day"}, {"name": "views"}], "rows": []})
    assert out == "day\tviews"


# --------------------------------------------------------------------------- #
# --auth (no real network): callback parser + code exchange + persistence      #
# --------------------------------------------------------------------------- #

def test_extract_callback_code():
    code, error = yt.extract_callback_code("/?code=abc123&state=xyz&scope=analytics")
    assert code == "abc123"
    assert error is None
    code, error = yt.extract_callback_code("/?error=access_denied")
    assert code is None
    assert error == "access_denied"


def test_exchange_code_persists_token(secret_file, tmp_path):
    client = yt.load_client_secret(secret_file)
    transport = FakeTransport([
        resp(200, {"access_token": "at-new", "refresh_token": "rt-new", "expires_in": 3600, "scope": yt.ANALYTICS_SCOPE}),
    ])
    token = yt.exchange_code(client, "the-code", "http://127.0.0.1:5555", transport, now_fn=lambda: 2_000_000.0)
    assert token["access_token"] == "at-new"
    assert token["refresh_token"] == "rt-new"
    assert token["expiry"] == 2_000_000.0 + 3600
    # the POST carried the authorization_code grant
    posted = transport.calls[0]
    assert posted["method"] == "POST"
    assert b"grant_type=authorization_code" in posted["data"]
    assert b"code=the-code" in posted["data"]

    # persistence round-trips
    tok_path = tmp_path / "saved-token.json"
    yt.save_token(tok_path, token)
    reloaded = yt.load_token(tok_path)
    assert reloaded["access_token"] == "at-new"


def test_build_auth_url_requests_offline_analytics_scope(secret_file):
    client = yt.load_client_secret(secret_file)
    url = yt.build_auth_url(client, "http://127.0.0.1:5555", "state-token")
    assert url.startswith(client.auth_uri + "?")
    assert "access_type=offline" in url
    assert "prompt=consent" in url
    assert "yt-analytics.readonly" in url
    assert "state=state-token" in url
