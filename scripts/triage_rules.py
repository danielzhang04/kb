"""Deterministic email/message triage classifier (fleet-arc Wave B).

The portable core of the ECC chief-of-staff 4-tier taxonomy, rebuilt as a PURE
function so it can be (a) canary-judged deterministically and (b) reused as the
kernel of the kb-native `email-triage` workflow (executor-activation design D14,
DRAFT-ONLY — this module never sends, labels, or drafts; it only *classifies*).

The four tiers, evaluated in strict PRIORITY ORDER (skip wins over everything,
action_required is the last resort):

    skip -> info_only -> meeting_info -> action_required

Priority matters: a newsletter that happens to contain a question but comes
`from` a `noreply@` sender is still `skip` — the sender rule short-circuits the
question rule. `classify` returns the FIRST tier whose rule matches in that
order; if none match the safe default is `info_only` (summarise, never over-draft).

A message is a plain dict. Recognised keys (all optional except a sender):

    from    : sender address (str)                    -- "from" or "sender"
    to       : recipient address(es) (str | list)
    cc       : cc address(es) (str | list)
    subject  : str
    body     : str
    me       : the user's own address (str) -- enables cc-detection + @mention
    automated: bool -- explicit "this is a bot/automated message" override

Everything is lower-cased and substring/prefix matched; no network, no clock,
no model call. Deterministic for a given input.
"""
from __future__ import annotations

import re

# --- tier 1: skip -----------------------------------------------------------
# Local-part tokens that mark a machine sender (matched as a substring of the
# address local-part, so "noreply", "no-reply", "jira-notifications" all hit).
SKIP_LOCAL_TOKENS = (
    "noreply", "no-reply", "donotreply", "do-not-reply", "notification",
    "notifications", "notify", "alert", "alerts", "mailer-daemon", "bounce",
    "postmaster", "automated", "auto-confirm",
)
# Domains whose mail is automated platform noise (exact or subdomain match).
SKIP_DOMAINS = (
    "github.com", "slack.com", "notion.so", "jira.com", "atlassian.net",
    "circleci.com", "pagerduty.com", "sentry.io",
)

# --- tier 2: info_only ------------------------------------------------------
RECEIPT_TOKENS = (
    "receipt", "invoice", "order confirmation", "your order", "payment received",
    "payment confirmation", "subscription renew", "renewal notice", "statement is ready",
)
ANNOUNCE_TOKENS = ("@channel", "@here", "@everyone")

# --- tier 3: meeting_info ---------------------------------------------------
MEETING_URLS = (
    "zoom.us", "teams.microsoft.com", "teams.live.com", "meet.google.com",
    "webex.com", "whereby.com",
)
MEETING_CONTEXT = (
    "meeting", "meet ", "call", "sync", "invite", "calendar", "appointment",
    "1:1", "standup", "stand-up", "catch up", "catch-up", "let's chat", "schedule",
)
# A date/time-ish token (weekday, month, clock time, or a relative day word).
_DATE_RE = re.compile(
    r"\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b"
    r"|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b"
    r"|\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b"
    r"|\b\d{1,2}\s*(am|pm)\b"
    r"|\b\d{1,2}/\d{1,2}\b"
    r"|\btomorrow\b|\btoday\b|\btonight\b|\bnext week\b",
    re.IGNORECASE,
)


def _addrs(value) -> list[str]:
    """Normalise a recipient field (str | list | None) to a lower-cased list."""
    if value is None:
        return []
    if isinstance(value, str):
        parts = re.split(r"[,;]", value)
        return [p.strip().lower() for p in parts if p.strip()]
    return [str(v).strip().lower() for v in value if str(v).strip()]


def _sender(message: dict) -> str:
    return str(message.get("from") or message.get("sender") or "").strip().lower()


def _me(message: dict) -> str:
    return str(message.get("me") or "").strip().lower()


def _text(message: dict) -> str:
    return f"{message.get('subject', '')}\n{message.get('body', '')}".lower()


def is_skip(message: dict) -> bool:
    if message.get("automated") is True:
        return True
    sender = _sender(message)
    if not sender:
        return False
    local, _, domain = sender.partition("@")
    if any(tok in local for tok in SKIP_LOCAL_TOKENS):
        return True
    return any(domain == d or domain.endswith("." + d) for d in SKIP_DOMAINS)


def is_info_only(message: dict) -> bool:
    me = _me(message)
    to = _addrs(message.get("to"))
    cc = _addrs(message.get("cc"))
    if me and me in cc and me not in to:          # merely CC'd -> summary only
        return True
    text = _text(message)
    if any(tok in text for tok in RECEIPT_TOKENS):
        return True
    body = str(message.get("body", "")).lower()
    return any(tok in body for tok in ANNOUNCE_TOKENS)


def is_meeting_info(message: dict) -> bool:
    text = _text(message)
    if any(url in text for url in MEETING_URLS):
        return True
    if any(ctx in text for ctx in MEETING_CONTEXT) and _DATE_RE.search(text):
        return True
    return False


def is_action_required(message: dict) -> bool:
    body = str(message.get("body", ""))
    if "?" in body:                                # an unanswered question
        return True
    if message.get("mentions_me") is True or message.get("direct_question") is True:
        return True
    me = _me(message)
    if me:
        local = me.partition("@")[0]
        if local and ("@" + local) in body.lower():   # @mention of the user
            return True
    return False


def classify(message: dict) -> str:
    """Return exactly one of skip | info_only | meeting_info | action_required.

    Rules are evaluated in priority order; the first match wins, so `skip`
    short-circuits a message that would otherwise be action_required. The safe
    default (no rule matches) is `info_only`."""
    if is_skip(message):
        return "skip"
    if is_info_only(message):
        return "info_only"
    if is_meeting_info(message):
        return "meeting_info"
    if is_action_required(message):
        return "action_required"
    return "info_only"


TIERS = ("skip", "info_only", "meeting_info", "action_required")
