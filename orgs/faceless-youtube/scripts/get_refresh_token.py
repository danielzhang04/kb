"""One-time local helper: mint the YouTube analytics refresh token into .env.

Run BY THE HUMAN (Daniel) from orgs/faceless-youtube:  py -3 scripts/get_refresh_token.py
Prereqs: YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET already pasted into .env
(from the rotated OAuth client JSON), and the consent screen lists you as a test user.

What it does: opens the browser to a Google consent page (scopes: youtube.readonly +
yt-analytics.readonly, offline access), catches the code on a localhost loopback redirect,
exchanges it, and writes YOUTUBE_OAUTH_REFRESH_TOKEN into .env in place. Tokens are never
printed, logged, or written anywhere except the .env slot. Credential-law note: this is a
human-run bootstrap; fleet agents never run it.
"""
import http.server
import io
import json
import os
import re
import secrets
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
SCOPES = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly"
PORT = 8765


def read_env():
    vals = {}
    for line in io.open(ENV_PATH, encoding="utf-8"):
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            vals[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return vals


def write_refresh_token(token):
    text = io.open(ENV_PATH, encoding="utf-8").read()
    line = "YOUTUBE_OAUTH_REFRESH_TOKEN=" + token
    if re.search(r"^YOUTUBE_OAUTH_REFRESH_TOKEN=.*$", text, flags=re.M):
        text = re.sub(r"^YOUTUBE_OAUTH_REFRESH_TOKEN=.*$", line, text, flags=re.M)
    else:
        text = text.rstrip("\n") + "\n" + line + "\n"
    tmp = ENV_PATH + ".tmp"
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, ENV_PATH)


def main():
    env = read_env()
    cid = env.get("YOUTUBE_OAUTH_CLIENT_ID")
    csec = env.get("YOUTUBE_OAUTH_CLIENT_SECRET")
    if not cid or not csec:
        sys.exit("Fill YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET in .env first.")

    state = secrets.token_urlsafe(16)
    redirect = f"http://127.0.0.1:{PORT}/"
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code",
        "scope": SCOPES, "access_type": "offline", "prompt": "consent", "state": state,
    })

    got = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            ok = q.get("state", [""])[0] == state and "code" in q
            if ok:
                got["code"] = q["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h2>Done - you can close this tab and return to the terminal.</h2>"
                             if ok else b"<h2>State mismatch or no code - close and re-run.</h2>")

        def log_message(self, *a):  # keep the terminal quiet
            pass

    srv = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.handle_request, daemon=True).start()

    print("Opening browser for consent — sign in with the account that OWNS the channel.")
    webbrowser.open(auth_url)
    while "code" not in got:
        pass
    srv.server_close()

    body = urllib.parse.urlencode({
        "code": got["code"], "client_id": cid, "client_secret": csec,
        "redirect_uri": redirect, "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            tok = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"token exchange failed: HTTP {e.code} (no details printed by design)")

    rt = tok.get("refresh_token")
    if not rt:
        sys.exit("No refresh_token in response (re-run: the 'prompt=consent' flow should force one).")
    write_refresh_token(rt)
    print("Refresh token written to .env (YOUTUBE_OAUTH_REFRESH_TOKEN). Nothing was printed or logged.")


if __name__ == "__main__":
    main()
