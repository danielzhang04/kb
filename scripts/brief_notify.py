"""Chief-of-Staff notify step — compose a short brief summary and (supervised)
send it over the fleet's existing Telegram channel (Wave A).

This module extends NOTHING in ``telegram_send.py``; it composes a <=400-char
summary of a rendered brief and, ONLY when invoked with ``--send``, hands it to
the existing ``telegram_send`` machinery.

Token custody (unchanged from ``telegram_send`` / ``desktop_poll.ps1``): this
script NEVER reads Windows Credential Manager. The real send path uses
``telegram_send.HTTPTransport``, whose ``default_token_loader`` reads the ambient
``KB_TELEGRAM_BOT_TOKEN`` env var that the desktop launcher injects from
Credential Manager outside this process. ``--send`` refuses to run unless that
launcher-injected env var is present, so an agent invocation without the
launcher can never send.

Default (no ``--send``): the summary is printed; no transport is touched.

Under test the transport is injected (the ``telegram_send`` test seam), so
``send_summary`` never opens a socket.
"""
from __future__ import annotations

import argparse
import datetime
from pathlib import Path

import brief
import ledger
import preamble
import telegram_send

# The launcher-injected ambient env vars (populated by desktop_poll.ps1's
# pattern from Windows Credential Manager / config — never read here directly).
TOKEN_ENV = "KB_TELEGRAM_BOT_TOKEN"
CHAT_ID_ENV = "KB_TELEGRAM_CHAT_ID"

SUMMARY_LIMIT = 400


# --------------------------------------------------------------------------- #
# summary composition (pure)                                                  #
# --------------------------------------------------------------------------- #

def _section_body(brief_text: str, heading: str) -> list[str]:
    """Lines under ``## <heading>`` up to the next ``## `` heading."""
    body: list[str] = []
    collecting = False
    for line in brief_text.splitlines():
        if line.startswith("## "):
            if collecting:
                break
            collecting = line[3:].strip() == heading
            continue
        if collecting:
            body.append(line)
    # trim leading/trailing blanks
    while body and not body[0].strip():
        body.pop(0)
    while body and not body[-1].strip():
        body.pop()
    return body


def summarize_brief(brief_text: str, limit: int = SUMMARY_LIMIT) -> str:
    """Compose a <=``limit``-char one-glance summary of a rendered brief.

    Pulls the title, the "#1 win", and the count of ranked pending items.
    Truncates (with an ellipsis) to at most ``limit`` characters so it fits a
    single Telegram message without the caller having to worry about length."""
    title = ""
    for line in brief_text.splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            break

    win_lines = _section_body(brief_text, "#1 win")
    win = win_lines[0].strip() if win_lines else "(no #1 win)"

    pending = _section_body(brief_text, "Pending (ranked T3 > T2 > T1, then oldest first)")
    if pending and pending[0].strip().lower().startswith("nothing pending"):
        pending_count = 0
    else:
        pending_count = sum(1 for ln in pending if ln.strip()[:1].isdigit())

    summary = f"{title}\n#1: {win}\nPending: {pending_count}"
    if len(summary) > limit:
        summary = summary[: limit - 1].rstrip() + "…"
    return summary


# --------------------------------------------------------------------------- #
# send (hermetic — transport injected)                                        #
# --------------------------------------------------------------------------- #

def send_summary(summary: str, transport, chat_id, *, send_fn=telegram_send.send) -> dict:
    """Send ``summary`` via the injected ``telegram_send.send`` seam. Performs no
    I/O of its own — the real network only happens inside a real transport, so
    this is fully hermetic under a fake transport in tests."""
    return send_fn(transport, chat_id, summary, buttons=None)


def require_token(env) -> str:
    """Return the launcher-injected bot token from ``env`` or fail loud. This
    only READS the ambient env var the launcher populated; it never reads
    Credential Manager (constitution: never handle a credential as an object)."""
    token = env.get(TOKEN_ENV)
    if not token:
        raise RuntimeError(
            f"{TOKEN_ENV} is not set. --send only runs under the desktop "
            "launcher, which injects the bot token from Windows Credential "
            "Manager; this script never reads the credential store itself."
        )
    return token


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #

def _run_preamble(repo_root) -> list[str]:
    return preamble.check(repo_root, cost_today_fn=ledger.cost_today)


def _load_brief_text(repo_root, date: str) -> str:
    """Prefer the already-written ``dashboards/brief-<date>.md``; if it is not
    present in this worktree, render it fresh (the summary is pure of the file)."""
    path = brief.brief_path(repo_root, date)
    if path.exists():
        return path.read_text(encoding="utf-8")
    return brief.render_brief(repo_root, date)


def main(argv=None, env=None) -> int:
    import os
    env = os.environ if env is None else env

    ap = argparse.ArgumentParser(description="Compose (and optionally send) a brief summary.")
    ap.add_argument("--date", default=datetime.date.today().isoformat(),
                    help="brief date YYYY-MM-DD (default: today)")
    ap.add_argument("--send", action="store_true",
                    help="send the summary over Telegram (requires the "
                         "launcher-injected token env var)")
    ap.add_argument("--chat-id", default=None,
                    help=f"target chat id (default: ${CHAT_ID_ENV})")
    args = ap.parse_args(argv)

    repo_root = Path.cwd()
    problems = _run_preamble(repo_root)
    if problems:
        print("PREAMBLE FAIL: " + "; ".join(problems))
        return 1

    summary = summarize_brief(_load_brief_text(repo_root, args.date))

    if not args.send:
        print(summary)
        return 0

    # --send: the token MUST come from the launcher-injected ambient env var.
    try:
        require_token(env)  # presence check only; HTTPTransport reads it at send
    except RuntimeError as err:
        print(f"SEND REFUSED: {err}")
        return 1

    chat_id = args.chat_id or env.get(CHAT_ID_ENV)
    if not chat_id:
        print(f"SEND REFUSED: no chat id (pass --chat-id or set ${CHAT_ID_ENV})")
        return 1

    transport = telegram_send.HTTPTransport()  # reads ambient token at send time
    send_summary(summary, transport, chat_id)
    print(f"sent brief summary to chat {chat_id}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
