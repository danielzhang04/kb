"""Addressed-speech gate (conversation-rules design §1): pure decision, injected clock.

The window is armed ONLY by Atlas-side activity (wake / Atlas speech) — user speech never
extends it, so ambient conversation can't hold the gate open (the 2026-07-21 transcript bug)."""
from worker import addressing


def make(window=30.0, vocab=("card", "cards", "queue", "faceless-youtube"), t0=1000.0):
    now = [t0]
    a = addressing.Addressing(window, vocab, clock=lambda: now[0])
    return a, now


def test_everything_addressed_inside_window():
    a, now = make()
    a.mark_activity()
    now[0] += 29.0
    assert a.is_addressed("i am forty two")          # ambient — but Atlas just spoke


def test_window_expires_then_ambient_is_gated():
    a, now = make()
    a.mark_activity()
    now[0] += 31.0
    assert not a.is_addressed("i am forty two")
    assert not a.is_addressed("he averaged thirty points once he")


def test_no_activity_yet_means_gated_unless_marked():
    a, _ = make()
    assert not a.is_addressed("hows it going")


def test_atlas_name_always_addresses():
    a, now = make()
    a.mark_activity()
    now[0] += 300.0
    assert a.is_addressed("atlas whats in the inbox")


def test_vocab_token_hit_addresses_outside_window():
    a, now = make()
    a.mark_activity()
    now[0] += 300.0
    assert a.is_addressed("how many cards are waiting")
    assert a.is_addressed("whats in the queue")


def test_multiword_vocab_matches_normalized_substring():
    a, _ = make(vocab=("faceless-youtube",))
    assert a.is_addressed("hows the faceless youtube run going")


def test_user_speech_does_not_extend_window():
    a, now = make()
    a.mark_activity()
    now[0] += 29.0
    assert a.is_addressed("some ambient line")        # inside window
    now[0] += 29.0                                    # 58s after the ONLY mark_activity
    assert not a.is_addressed("more ambient chatter") # is_addressed never re-armed it


def test_is_addressed_is_pure_no_rearm_on_vocab_hit():
    a, now = make()
    a.mark_activity()
    now[0] += 300.0
    assert a.is_addressed("whats in the queue")
    now[0] += 29.0
    # still outside the window: the vocab hit above did NOT re-arm (Atlas's spoken reply,
    # mirrored by app.py, is what re-arms in production)
    assert not a.is_addressed("random ambient words")
