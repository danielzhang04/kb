"""Task 2.4 -- notify-intent wiring + digest formatter.

``notify.notify_pending(card_path, assurance_class, ...)`` is the ONE send path
for approvals: stage the signed PR (via the 1.4 per-tier opener) and, only
where the ``assurance_class`` emitted by ``promotion.decide()`` (3.1, O9)
admits it, offer a possession button (2.2) alongside it. Novelty is decided
upstream in ``promotion.decide()`` -- this module CONSUMES the class, never
recomputes it from grades.

``notify.digest(dashboard_path)`` formats the morning/mission-control brief
from ``dashboards/executive.md``. That file lives on the ops branch only (not
this work branch), so the test points ``digest`` at a fixture path via the
injectable ``read`` seam rather than assuming the file exists in this
worktree.
"""
import cards
import notify


def _make_card(tmp_path, tier="T3", action="deploy", target="svc-a"):
    repo = tmp_path / "repo"
    (repo / "queue" / "inbox").mkdir(parents=True)
    body = "## Work order\ndo the approved thing\n"
    card = cards.new_card("proj", action, target, tier, body=body)
    path = cards.save(card, repo / "queue")
    return repo, card, path


class RecordingStage:
    """Fake stand-in for stage_approval.stage: records the call, no git/network."""

    def __init__(self, ref="PR:staged"):
        self.calls = []
        self.ref = ref

    def __call__(self, card_path, repo_root, opener):
        self.calls.append((card_path, repo_root, opener))
        return self.ref


class RecordingSend:
    """Fake stand-in for telegram_send.send: records the call, no network."""

    def __init__(self):
        self.calls = []

    def __call__(self, transport, chat_id, text, buttons=None):
        self.calls.append({"transport": transport, "chat_id": chat_id,
                            "text": text, "buttons": buttons})
        return {"ok": True}


# --------------------------------------------------------------------------- #
# notify_pending(): O9 cutline -- novel T3 never gets a possession button     #
# --------------------------------------------------------------------------- #

def test_novel_T3_stages_signed_pr_no_possession_button(tmp_path):
    repo, card, path = _make_card(tmp_path, tier="T3")
    stage_fn = RecordingStage()
    send_fn = RecordingSend()
    opener = object()  # opaque per-tier opener, only ever passed through

    result = notify.notify_pending(
        path, "T3-novel",
        repo_root=repo, opener=opener, transport=object(), chat_id="chat-1",
        stage_fn=stage_fn, send_fn=send_fn,
    )

    # the signed PR was staged via the injected 1.4 opener
    assert stage_fn.calls == [(path, repo, opener)]
    assert result["staged"] == "PR:staged"

    # NO possession button offered for a novel/first-ever T3 (O9)
    assert result["buttons"] is None
    assert send_fn.calls[0]["buttons"] is None


def test_established_tier_offers_possession_button(tmp_path):
    repo, card, path = _make_card(tmp_path, tier="T2")
    stage_fn = RecordingStage()
    send_fn = RecordingSend()

    result = notify.notify_pending(
        path, "possession-eligible",
        repo_root=repo, opener=object(), transport=object(), chat_id="chat-1",
        stage_fn=stage_fn, send_fn=send_fn,
    )

    assert stage_fn.calls  # signed PR still staged alongside the button
    assert result["buttons"] is not None
    assert send_fn.calls[0]["buttons"] == result["buttons"]
    # buttons carry the card's real approve/reject callback_data (2.2 reuse,
    # never reimplemented)
    assert any(
        b["callback_data"].startswith(f"{card.meta['id']}|approve|")
        for b in result["buttons"]
    )


def test_established_T3_also_offers_possession_button(tmp_path):
    repo, card, path = _make_card(tmp_path, tier="T3")
    stage_fn = RecordingStage()
    send_fn = RecordingSend()

    result = notify.notify_pending(
        path, "T3-established",
        repo_root=repo, opener=object(), transport=object(), chat_id="chat-1",
        stage_fn=stage_fn, send_fn=send_fn,
    )

    assert result["buttons"] is not None


def test_signed_only_also_has_no_possession_button(tmp_path):
    # fail-closed unknown/ambiguous class -- same treatment as T3-novel.
    repo, card, path = _make_card(tmp_path, tier="T3")
    stage_fn = RecordingStage()
    send_fn = RecordingSend()

    result = notify.notify_pending(
        path, "signed-only",
        repo_root=repo, opener=object(), transport=object(), chat_id="chat-1",
        stage_fn=stage_fn, send_fn=send_fn,
    )

    assert stage_fn.calls
    assert result["buttons"] is None


def test_acts_alone_needs_no_channel(tmp_path):
    # decide() already routed this to act alone -- nothing to stage or send.
    repo, card, path = _make_card(tmp_path, tier="T1")
    stage_fn = RecordingStage()
    send_fn = RecordingSend()

    result = notify.notify_pending(
        path, "acts-alone",
        repo_root=repo, opener=object(), transport=object(), chat_id="chat-1",
        stage_fn=stage_fn, send_fn=send_fn,
    )

    assert stage_fn.calls == []
    assert send_fn.calls == []
    assert result == {"staged": None, "buttons": None, "sent": None}


# --------------------------------------------------------------------------- #
# digest(): formats the brief from dashboards/executive.md (fixture path --   #
# that file lives on the ops branch only, never assumed present here)        #
# --------------------------------------------------------------------------- #

FIXTURE_DASHBOARD = """# Executive Dashboard
_Generated: 2026-07-16 19:45 UTC by dispatcher-cloud_

## Action required
- **Wake-me (T1):** something needs a human.
- No approvals cards pending.

## Queue
| state | count |
| --- | --- |
| inbox | 1 |

## Last 24h
- Cadence ran fine.

## Projects
- proj-a in flight.
"""


def test_digest_formats_from_dashboard(tmp_path):
    dash = tmp_path / "executive.md"
    dash.write_text(FIXTURE_DASHBOARD, encoding="utf-8")

    text = notify.digest(dash)

    assert "Executive Dashboard" in text
    assert "Wake-me (T1)" in text
    assert "inbox | 1" in text
    assert "Cadence ran fine" in text


def test_digest_uses_injected_reader_not_the_real_file(tmp_path):
    # the digest formatter must not assume dashboards/executive.md exists in
    # this worktree -- it reads through whatever `read` seam the caller wires.
    calls = []

    def fake_read(path):
        calls.append(path)
        return FIXTURE_DASHBOARD

    text = notify.digest("dashboards/executive.md", read=fake_read)

    assert calls == ["dashboards/executive.md"]
    assert "Wake-me (T1)" in text
