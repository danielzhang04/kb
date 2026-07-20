"""Wave B — deterministic 4-tier triage classifier (scripts/triage_rules.py).

Priority order is load-bearing: skip -> info_only -> meeting_info ->
action_required. The table below is >=12 labelled fixtures including the edge
case that priority matters (a newsletter WITH a question, but from a noreply
sender, is still `skip`).
"""
import pytest

import triage_rules

ME = "daniel.zhang.t1@gmail.com"

# (name, message, expected_label)
CASES = [
    ("noreply_sender_skips",
     {"from": "noreply@service.com", "to": [ME], "subject": "Your weekly digest",
      "body": "Here is what happened this week."},
     "skip"),
    ("notification_local_part_skips",
     {"from": "jira-notifications@company.com", "to": [ME], "subject": "Issue updated",
      "body": "PROJ-1 moved to Done."},
     "skip"),
    ("github_domain_skips",
     {"from": "ci@github.com", "to": [ME], "subject": "Build passed",
      "body": "All checks green."},
     "skip"),
    ("newsletter_with_question_from_noreply_still_skips",  # <-- priority edge case
     {"from": "no-reply@newsletter.io", "to": [ME],
      "subject": "This week in AI — what will you build?",
      "body": "Big question: are you ready for the future? Click to read more."},
     "skip"),
    ("explicit_automated_flag_skips",
     {"from": "team@startup.com", "to": [ME], "automated": True,
      "subject": "Deploy done", "body": "Anything to review?"},
     "skip"),
    ("cc_recipient_is_info_only",
     {"from": "alice@partner.com", "to": ["bob@partner.com"], "cc": [ME],
      "me": ME, "subject": "Project plan", "body": "Bob, please confirm the plan?"},
     "info_only"),
    ("receipt_is_info_only",
     {"from": "billing@saas.com", "to": [ME], "me": ME,
      "subject": "Your receipt from SaaS Co", "body": "Payment received. Amount: $20."},
     "info_only"),
    ("channel_announcement_is_info_only",
     {"from": "lead@team.com", "to": [ME], "me": ME, "subject": "FYI",
      "body": "@channel we shipped the release."},
     "info_only"),
    ("meeting_url_is_meeting_info",
     {"from": "alice@partner.com", "to": [ME], "me": ME, "subject": "Sync",
      "body": "Join our call: https://zoom.us/j/123456789"},
     "meeting_info"),
    ("date_plus_context_is_meeting_info",
     {"from": "alice@partner.com", "to": [ME], "me": ME,
      "subject": "1:1 next week", "body": "Let's do our meeting on Tuesday at 3pm."},
     "meeting_info"),
    ("direct_question_is_action_required",
     {"from": "alice@partner.com", "to": [ME], "me": ME,
      "subject": "Contract", "body": "Can you confirm the deadline is still Friday?"},
     "action_required"),
    ("mention_of_me_is_action_required",
     {"from": "bob@team.com", "to": [ME], "me": ME, "subject": "Review",
      "body": "Hey @daniel.zhang.t1 please take a look when you can."},
     "action_required"),
    ("plain_fyi_defaults_to_info_only",
     {"from": "carol@partner.com", "to": [ME], "me": ME, "subject": "Update",
      "body": "Just letting you know we shipped it."},
     "info_only"),
    ("meeting_beats_action_when_both_match",
     {"from": "alice@partner.com", "to": [ME], "me": ME, "subject": "Call",
      "body": "Can we meet? https://meet.google.com/abc-defg-hij"},
     "meeting_info"),
    ("cc_beats_action_required",
     {"from": "alice@partner.com", "to": ["team@partner.com"], "cc": [ME],
      "me": ME, "subject": "Q", "body": "Team, can someone own this?"},
     "info_only"),
]


@pytest.mark.parametrize("name,message,expected", CASES,
                         ids=[c[0] for c in CASES])
def test_classify(name, message, expected):
    assert triage_rules.classify(message) == expected


def test_priority_order_skip_wins_over_everything():
    # A noreply sender whose body has a question AND a zoom link is still skip.
    msg = {"from": "noreply@x.com", "to": [ME], "me": ME,
           "subject": "Meeting?", "body": "Join https://zoom.us/j/1 — can you? Tuesday 3pm"}
    assert triage_rules.classify(msg) == "skip"


def test_returns_a_known_tier():
    for _, message, _ in CASES:
        assert triage_rules.classify(message) in triage_rules.TIERS


def test_string_recipients_are_normalised():
    # `to`/`cc` accept a bare string, not only a list.
    msg = {"from": "alice@partner.com", "to": "bob@partner.com", "cc": ME,
           "me": ME, "subject": "x", "body": "please confirm?"}
    assert triage_rules.classify(msg) == "info_only"
