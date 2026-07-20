"""Wave A — Chief-of-Staff notify step (scripts/brief_notify.py).

Covers: <=400-char summary composition (title + #1 win + pending count),
truncation, hermetic send via an injected fake transport (no network), the
launcher-injected-token gate (require_token + --send refusal), and the no-send
default that only prints."""
import cards
import brief
import brief_notify
import telegram_send

DATE = "2026-07-19"


class FakeTransport:
    """Records send_message calls; performs no real network I/O."""

    def __init__(self):
        self.calls = []

    def send_message(self, chat_id, text, reply_markup=None):
        self.calls.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return {"ok": True}


def _repo(tmp_path):
    repo = tmp_path / "repo"
    for state in ("inbox", "working", "approvals", "done"):
        (repo / "queue" / state).mkdir(parents=True)
    (repo / "dashboards").mkdir(parents=True)
    return repo


# --------------------------------------------------------------------------- #
# summarize_brief                                                              #
# --------------------------------------------------------------------------- #

def test_summary_has_title_win_and_pending_count(tmp_path):
    repo = _repo(tmp_path)
    card = cards.new_card("kb-ops", "deploy", "svc-a", "T3",
                          body="## Work order\ndo\n", state="approvals")
    card.meta["id"] = "0000000a-11112222"
    cards.save(card, repo / "queue")

    brief_text = brief.render_brief(repo, DATE)
    summary = brief_notify.summarize_brief(brief_text)

    assert len(summary) <= brief_notify.SUMMARY_LIMIT
    assert f"Morning brief — {DATE}" in summary
    assert "#1:" in summary
    assert "deploy" in summary          # the #1 win item
    assert "Pending: 1" in summary


def test_summary_pending_zero_when_clear(tmp_path):
    repo = _repo(tmp_path)
    summary = brief_notify.summarize_brief(brief.render_brief(repo, DATE))
    assert "Pending: 0" in summary


def test_summary_truncates_to_limit():
    huge = "# " + ("T" * 900) + "\n\n## #1 win\n" + ("w" * 900) + "\n"
    summary = brief_notify.summarize_brief(huge, limit=120)
    assert len(summary) <= 120
    assert summary.endswith("…")


# --------------------------------------------------------------------------- #
# send_summary — hermetic (injected transport, no network)                    #
# --------------------------------------------------------------------------- #

def test_send_summary_uses_injected_transport():
    transport = FakeTransport()
    result = brief_notify.send_summary("hi there", transport, chat_id=42)
    assert result == {"ok": True}
    assert transport.calls == [{"chat_id": 42, "text": "hi there", "reply_markup": None}]


def test_send_summary_never_touches_network(monkeypatch):
    import urllib.request

    def _boom(*a, **k):
        raise AssertionError("send_summary must not perform real network I/O")

    monkeypatch.setattr(urllib.request, "urlopen", _boom)
    transport = FakeTransport()
    brief_notify.send_summary("hi", transport, chat_id=1)
    assert transport.calls


# --------------------------------------------------------------------------- #
# token gate — the launcher-injected env var, never the credential store       #
# --------------------------------------------------------------------------- #

def test_require_token_fails_closed_when_unset():
    import pytest
    with pytest.raises(RuntimeError) as ei:
        brief_notify.require_token({})
    assert brief_notify.TOKEN_ENV in str(ei.value)


def test_require_token_returns_injected_value():
    assert brief_notify.require_token({brief_notify.TOKEN_ENV: "tok-123"}) == "tok-123"


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #

def test_cli_default_prints_summary_no_send(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(brief_notify.preamble, "check", lambda *a, **k: [])

    rc = brief_notify.main(["--date", DATE], env={})
    out = capsys.readouterr().out
    assert rc == 0
    assert f"Morning brief — {DATE}" in out
    assert "Pending:" in out


def test_cli_send_refused_without_token(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(brief_notify.preamble, "check", lambda *a, **k: [])
    # guard: even the real transport must never be built when the token is absent
    monkeypatch.setattr(telegram_send, "HTTPTransport",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not build transport")))

    rc = brief_notify.main(["--date", DATE, "--send"], env={})
    out = capsys.readouterr().out
    assert rc == 1
    assert "SEND REFUSED" in out
    assert brief_notify.TOKEN_ENV in out


def test_cli_send_refused_without_chat_id(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(brief_notify.preamble, "check", lambda *a, **k: [])
    monkeypatch.setattr(telegram_send, "HTTPTransport",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not build transport")))

    # token present, but no chat id anywhere -> still refused, no transport built
    rc = brief_notify.main(["--date", DATE, "--send"], env={brief_notify.TOKEN_ENV: "tok"})
    out = capsys.readouterr().out
    assert rc == 1
    assert "SEND REFUSED" in out
    assert "chat id" in out


def test_cli_stops_on_preamble_failure(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(brief_notify.preamble, "check",
                        lambda *a, **k: ["STOP file present — fleet is frozen"])

    rc = brief_notify.main(["--date", DATE], env={})
    out = capsys.readouterr().out
    assert rc == 1
    assert "PREAMBLE FAIL" in out
