"""yt_analytics.py -- YouTube Analytics reports.query wrapper (design D11, pairs gate G4).

A small, STDLIB-ONLY companion to the `youtube-uploader-mcp` server. It reuses the SAME OAuth
client the uploader uses (`config/client_secret.json`) but mints and persists its OWN token with the
`yt-analytics.readonly` scope (the uploader's `youtube.upload`+`youtube.readonly` scopes do not grant
analytics), stored separately at `%USERPROFILE%\\.yt-analytics-token.json`.

Why stdlib only: this machine has been bitten by missing pip deps, so nothing here imports a
third-party library. The OAuth loopback flow (`--auth`), the refresh-token POST, and the
`reports.query` GET all go through `urllib` + `http.server`; JSON via `json`.

Commands:
  * (default)  a day-by-day report of views / estimated watch-time / subscribers gained for the last
               --days N (channel == MINE), rendered as TSV to stdout.
  * --raw      pass explicit --metrics / --dimensions / --start-date / --end-date / --ids straight
               through to reports.query (still TSV to stdout).
  * --auth     one-time installed-app OAuth consent over a loopback redirect; persists the token.

Auth posture (fail-closed): until the human OAuth gates (G1 creates the GCP OAuth client + enables the
YouTube Analytics API; G4 runs this script's `--auth` once) complete, the client secret and/or token
file are ABSENT. Every non-auth command then exits cleanly with a precise `not-authed: ...` message
that names exactly what is missing and which gate card mints it, using a distinct exit code
(NOT_AUTHED = 3) so a caller never confuses "not set up yet" with "ran and found nothing".

STOP/preamble supremacy: the CLI runs the exact shared preamble check (STOP file, ANTHROPIC_API_KEY,
budget) BEFORE any command, exactly like the sibling scripts. The pure functions never touch the
network or the preamble -- a fake transport is injected in tests.
"""
from __future__ import annotations

import argparse
import datetime
import http.server
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from typing import Callable, NamedTuple

# --------------------------------------------------------------------------- #
# Constants                                                                    #
# --------------------------------------------------------------------------- #

ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly"
DEFAULT_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"
REPORTS_ENDPOINT = "https://youtubeanalytics.googleapis.com/v2/reports"

DEFAULT_METRICS = "views,estimatedMinutesWatched,subscribersGained"
DEFAULT_DIMENSIONS = "day"
DEFAULT_DAYS = 28
CHANNEL_MINE = "channel==MINE"

# Exit codes -- NOT_AUTHED is deliberately distinct from success and from a usage error so a caller
# can branch on "not provisioned yet" versus "ran fine" versus "bad invocation".
EXIT_OK = 0
EXIT_PREAMBLE = 1
EXIT_USAGE = 2
EXIT_NOT_AUTHED = 3
EXIT_ERROR = 4

# The gate cards that mint each missing artifact (design D16). Named in every not-authed message.
GATE_CLIENT_SECRET = "gate card G1 (create the GCP OAuth client + enable the YouTube Analytics API)"
GATE_TOKEN = "gate card G4 (run this script's --auth once for the analytics consent)"


class Response(NamedTuple):
    """A minimal HTTP response: status code + raw body bytes. Headers are not needed here."""
    status: int
    body: bytes


# A transport is `(method, url, headers, data) -> Response`. The default hits the network; tests inject
# a fake so no unit test ever opens a socket.
Transport = Callable[[str, str, dict, "bytes | None"], Response]


class NotAuthed(Exception):
    """Raised when the client secret or token is absent/expired-without-refresh. Maps to EXIT_NOT_AUTHED."""


class ReportError(Exception):
    """A non-auth transport failure (e.g. a 4xx/5xx from reports.query that is not a 401)."""

    def __init__(self, status: int, body: bytes) -> None:
        tail = body.decode("utf-8", "replace")[:500] if body else ""
        super().__init__(f"reports.query failed (HTTP {status}): {tail}")
        self.status = status


# --------------------------------------------------------------------------- #
# Paths                                                                        #
# --------------------------------------------------------------------------- #

def repo_root() -> Path:
    """The kb repo root (this file lives in <root>/scripts/)."""
    return Path(__file__).resolve().parent.parent


def client_secret_path() -> Path:
    """The uploader's OAuth client secret. Override with YT_ANALYTICS_CLIENT_SECRET for tests/relocation."""
    override = os.environ.get("YT_ANALYTICS_CLIENT_SECRET")
    if override:
        return Path(override)
    return repo_root() / "config" / "client_secret.json"


def token_path() -> Path:
    """The analytics token cache: %USERPROFILE%\\.yt-analytics-token.json. Override with YT_ANALYTICS_TOKEN."""
    override = os.environ.get("YT_ANALYTICS_TOKEN")
    if override:
        return Path(override)
    home = os.environ.get("USERPROFILE") or str(Path.home())
    return Path(home) / ".yt-analytics-token.json"


# --------------------------------------------------------------------------- #
# Default transport (urllib) -- never exercised in tests                       #
# --------------------------------------------------------------------------- #

def urllib_transport(method: str, url: str, headers: dict, data: "bytes | None") -> Response:
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request) as resp:  # noqa: S310 -- fixed https endpoints
            return Response(resp.status, resp.read())
    except urllib.error.HTTPError as exc:
        return Response(exc.code, exc.read() or b"")


# --------------------------------------------------------------------------- #
# Client secret + token I/O                                                    #
# --------------------------------------------------------------------------- #

class ClientSecret(NamedTuple):
    client_id: str
    client_secret: str
    auth_uri: str
    token_uri: str


def load_client_secret(path: Path) -> ClientSecret:
    """Read the installed/web OAuth client. Absent or malformed => NotAuthed naming gate G1."""
    if not path.exists():
        raise NotAuthed(
            f"not-authed: client secret not found at {path} -- complete {GATE_CLIENT_SECRET} "
            f"and place the downloaded client_secret.json there"
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise NotAuthed(f"not-authed: client secret at {path} is unreadable ({exc}); re-run {GATE_CLIENT_SECRET}")
    node = data.get("installed") or data.get("web")
    if not isinstance(node, dict):
        raise NotAuthed(
            f"not-authed: client secret at {path} has neither an 'installed' nor a 'web' block; "
            f"re-download it from {GATE_CLIENT_SECRET}"
        )
    client_id = node.get("client_id")
    secret = node.get("client_secret")
    if not client_id or not secret:
        raise NotAuthed(f"not-authed: client secret at {path} is missing client_id/client_secret; re-run {GATE_CLIENT_SECRET}")
    return ClientSecret(
        client_id=client_id,
        client_secret=secret,
        auth_uri=node.get("auth_uri") or DEFAULT_AUTH_URI,
        token_uri=node.get("token_uri") or DEFAULT_TOKEN_URI,
    )


def load_token(path: Path) -> "dict | None":
    """Read the persisted analytics token, or None if it is absent. Malformed file => None (re-auth)."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def save_token(path: Path, token: dict) -> None:
    """Persist the token JSON (0600-ish -- best effort on Windows) atomically enough for a single writer."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(token, indent=2, sort_keys=True), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


# --------------------------------------------------------------------------- #
# OAuth token refresh + access                                                 #
# --------------------------------------------------------------------------- #

def _post_form(url: str, fields: dict, transport: Transport) -> Response:
    body = urllib.parse.urlencode(fields).encode("utf-8")
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    return transport("POST", url, headers, body)


def refresh_access_token(
    token: dict,
    client: ClientSecret,
    transport: Transport,
    now_fn: Callable[[], float] = time.time,
) -> dict:
    """Exchange the stored refresh_token for a fresh access token. No refresh_token => NotAuthed (re-auth)."""
    refresh_token = token.get("refresh_token")
    if not refresh_token:
        raise NotAuthed(
            f"not-authed: the analytics token has no refresh_token (it cannot be renewed) -- re-run --auth "
            f"per {GATE_TOKEN}"
        )
    resp = _post_form(
        client.token_uri,
        {
            "client_id": client.client_id,
            "client_secret": client.client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        transport,
    )
    if resp.status != 200:
        raise NotAuthed(
            f"not-authed: token refresh was rejected (HTTP {resp.status}) -- the grant was likely revoked "
            f"or expired; re-run --auth per {GATE_TOKEN}"
        )
    payload = json.loads(resp.body)
    merged = dict(token)
    merged["access_token"] = payload["access_token"]
    expires_in = int(payload.get("expires_in", 3600))
    merged["expiry"] = now_fn() + expires_in
    # A refresh response usually omits refresh_token; keep the existing one.
    if payload.get("refresh_token"):
        merged["refresh_token"] = payload["refresh_token"]
    return merged


def _is_expired(token: dict, now_fn: Callable[[], float]) -> bool:
    expiry = token.get("expiry")
    if not isinstance(expiry, (int, float)):
        return True  # unknown expiry => treat as expired and refresh
    return now_fn() >= (expiry - 60)  # 60s skew guard


def ensure_access_token(
    token: dict,
    client: ClientSecret,
    transport: Transport,
    now_fn: Callable[[], float] = time.time,
) -> "tuple[str, dict, bool]":
    """Return (access_token, token, refreshed). Refreshes proactively when the access token is expired."""
    if _is_expired(token, now_fn):
        refreshed = refresh_access_token(token, client, transport, now_fn)
        return refreshed["access_token"], refreshed, True
    access = token.get("access_token")
    if not access:
        refreshed = refresh_access_token(token, client, transport, now_fn)
        return refreshed["access_token"], refreshed, True
    return access, token, False


# --------------------------------------------------------------------------- #
# reports.query                                                                #
# --------------------------------------------------------------------------- #

def default_params(days: int, end: "datetime.date | None" = None) -> dict:
    """Views / watch-time / subs by day over the trailing `days` window, channel == MINE."""
    if days < 1:
        raise ValueError("--days must be >= 1")
    end = end or datetime.date.today()
    start = end - datetime.timedelta(days=days - 1)
    return {
        "ids": CHANNEL_MINE,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "metrics": DEFAULT_METRICS,
        "dimensions": DEFAULT_DIMENSIONS,
        "sort": DEFAULT_DIMENSIONS,
    }


def raw_params(
    metrics: str,
    start_date: str,
    end_date: str,
    dimensions: "str | None" = None,
    ids: str = CHANNEL_MINE,
    sort: "str | None" = None,
    filters: "str | None" = None,
) -> dict:
    """Pass-through params for --raw. Only non-empty values are included."""
    params = {"ids": ids, "startDate": start_date, "endDate": end_date, "metrics": metrics}
    if dimensions:
        params["dimensions"] = dimensions
    if sort:
        params["sort"] = sort
    if filters:
        params["filters"] = filters
    return params


def build_report_url(params: dict) -> str:
    """reports.query is a GET with query params (deterministic key order for stable URLs/tests)."""
    ordered = urllib.parse.urlencode(sorted(params.items()))
    return f"{REPORTS_ENDPOINT}?{ordered}"


def query_report(access_token: str, params: dict, transport: Transport) -> Response:
    url = build_report_url(params)
    headers = {"Authorization": f"Bearer {access_token}"}
    return transport("GET", url, headers, None)


def render_tsv(report: dict) -> str:
    """Render a reports.query response (columnHeaders + rows) as TSV. Empty rows => header line only."""
    headers = [col.get("name", "") for col in report.get("columnHeaders", [])]
    lines = ["\t".join(headers)]
    for row in report.get("rows", []) or []:
        lines.append("\t".join("" if cell is None else str(cell) for cell in row))
    return "\n".join(lines)


def run_report(
    params: dict,
    *,
    secret_path: Path,
    tok_path: Path,
    transport: Transport,
    now_fn: Callable[[], float] = time.time,
) -> dict:
    """Full report flow: load client+token, ensure a fresh access token, query, retry ONCE on a 401."""
    client = load_client_secret(secret_path)  # NotAuthed if absent
    token = load_token(tok_path)
    if token is None:
        raise NotAuthed(
            f"not-authed: no analytics token at {tok_path} -- run `py -3 scripts/yt_analytics.py --auth` "
            f"per {GATE_TOKEN}"
        )
    access, token, refreshed = ensure_access_token(token, client, transport, now_fn)
    if refreshed:
        save_token(tok_path, token)

    resp = query_report(access, params, transport)
    if resp.status == 401:
        # The access token was rejected mid-flight; force one refresh + retry.
        token = refresh_access_token(token, client, transport, now_fn)
        save_token(tok_path, token)
        resp = query_report(token["access_token"], params, transport)

    if resp.status != 200:
        raise ReportError(resp.status, resp.body)
    return json.loads(resp.body)


# --------------------------------------------------------------------------- #
# --auth : installed-app OAuth over a loopback redirect                        #
# --------------------------------------------------------------------------- #

def build_auth_url(client: ClientSecret, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": client.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": ANALYTICS_SCOPE,
        "access_type": "offline",
        "prompt": "consent",  # force a refresh_token every time
        "state": state,
    }
    return f"{client.auth_uri}?{urllib.parse.urlencode(params)}"


def extract_callback_code(path: str) -> "tuple[str | None, str | None]":
    """Parse the loopback callback path -> (code, error). Pure; the request handler defers to this."""
    query = urllib.parse.urlparse(path).query
    fields = urllib.parse.parse_qs(query)
    code = fields.get("code", [None])[0]
    error = fields.get("error", [None])[0]
    return code, error


def exchange_code(
    client: ClientSecret,
    code: str,
    redirect_uri: str,
    transport: Transport,
    now_fn: Callable[[], float] = time.time,
) -> dict:
    """Exchange an auth code for a token dict (access + refresh + expiry). Tested with a fake transport."""
    resp = _post_form(
        client.token_uri,
        {
            "client_id": client.client_id,
            "client_secret": client.client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
        transport,
    )
    if resp.status != 200:
        raise NotAuthed(
            f"not-authed: the authorization-code exchange failed (HTTP {resp.status}); re-run --auth per {GATE_TOKEN}"
        )
    payload = json.loads(resp.body)
    expires_in = int(payload.get("expires_in", 3600))
    return {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token"),
        "scope": payload.get("scope", ANALYTICS_SCOPE),
        "token_type": payload.get("token_type", "Bearer"),
        "expiry": now_fn() + expires_in,
    }


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    """Captures the single OAuth redirect. The captured code lands on the server object."""

    def do_GET(self) -> None:  # noqa: N802 -- BaseHTTPRequestHandler contract
        code, error = extract_callback_code(self.path)
        self.server.oauth_code = code  # type: ignore[attr-defined]
        self.server.oauth_error = error  # type: ignore[attr-defined]
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        message = "Analytics authorization received. You can close this tab." if code else f"Authorization failed: {error}"
        self.wfile.write(message.encode("utf-8"))

    def log_message(self, *args) -> None:  # silence the default stderr logging
        pass


def run_auth(
    secret_path: Path,
    tok_path: Path,
    *,
    transport: Transport,
    open_browser: bool = True,
    now_fn: Callable[[], float] = time.time,
) -> dict:
    """One-time loopback OAuth. Serves a single redirect, exchanges the code, persists the token."""
    client = load_client_secret(secret_path)  # NotAuthed if the client isn't provisioned (gate G1)
    server = http.server.HTTPServer(("127.0.0.1", 0), _CallbackHandler)
    server.oauth_code = None  # type: ignore[attr-defined]
    server.oauth_error = None  # type: ignore[attr-defined]
    port = server.server_address[1]
    redirect_uri = f"http://127.0.0.1:{port}"
    state = os.urandom(16).hex()
    auth_url = build_auth_url(client, redirect_uri, state)
    print(f"Opening consent URL (scope {ANALYTICS_SCOPE}):\n  {auth_url}")
    if open_browser:
        try:
            webbrowser.open(auth_url)
        except Exception:  # noqa: BLE001 -- a headless box just prints the URL
            pass
    server.handle_request()  # blocks for exactly one redirect
    code = server.oauth_code  # type: ignore[attr-defined]
    error = server.oauth_error  # type: ignore[attr-defined]
    if not code:
        raise NotAuthed(f"not-authed: OAuth consent did not return a code (error={error}); re-run --auth per {GATE_TOKEN}")
    token = exchange_code(client, code, redirect_uri, transport, now_fn)
    save_token(tok_path, token)
    return token


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #

def _run_preamble(root: Path) -> list:
    """STOP-file supremacy: the exact shared preamble check every actor runs (imported lazily)."""
    import ledger  # local to CLI so unit tests never drag in yaml/ledger
    import preamble
    return preamble.check(root, cost_today_fn=ledger.cost_today)


def _build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="YouTube Analytics reports.query wrapper (stdlib only).")
    ap.add_argument("--auth", action="store_true", help="run the one-time OAuth consent flow and persist the token")
    ap.add_argument("--raw", action="store_true", help="pass explicit metrics/dimensions/dates through to reports.query")
    ap.add_argument("--days", type=int, default=DEFAULT_DAYS, help=f"default report window in days (default {DEFAULT_DAYS})")
    ap.add_argument("--metrics", help="[--raw] comma-separated metrics")
    ap.add_argument("--dimensions", help="[--raw] comma-separated dimensions")
    ap.add_argument("--start-date", help="[--raw] YYYY-MM-DD start date")
    ap.add_argument("--end-date", help="[--raw] YYYY-MM-DD end date")
    ap.add_argument("--ids", default=CHANNEL_MINE, help="[--raw] ids selector (default channel==MINE)")
    ap.add_argument("--sort", help="[--raw] sort spec")
    ap.add_argument("--filters", help="[--raw] filters spec")
    ap.add_argument("--no-browser", action="store_true", help="[--auth] do not auto-open the browser")
    return ap


def main(argv=None) -> int:
    args = _build_parser().parse_args(argv)
    root = Path.cwd()

    problems = _run_preamble(root)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems), file=sys.stderr)
        return EXIT_PREAMBLE

    secret_path = client_secret_path()
    tok_path = token_path()

    try:
        if args.auth:
            run_auth(secret_path, tok_path, transport=urllib_transport, open_browser=not args.no_browser)
            print(f"Authorized. Token saved to {tok_path}")
            return EXIT_OK

        if args.raw:
            if not (args.metrics and args.start_date and args.end_date):
                print("usage: --raw requires --metrics, --start-date, and --end-date", file=sys.stderr)
                return EXIT_USAGE
            params = raw_params(
                metrics=args.metrics,
                start_date=args.start_date,
                end_date=args.end_date,
                dimensions=args.dimensions,
                ids=args.ids,
                sort=args.sort,
                filters=args.filters,
            )
        else:
            params = default_params(args.days)

        report = run_report(params, secret_path=secret_path, tok_path=tok_path, transport=urllib_transport)
        print(render_tsv(report))
        return EXIT_OK
    except NotAuthed as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_NOT_AUTHED
    except (ReportError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
