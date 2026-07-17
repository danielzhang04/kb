"""Notify-intent wiring + digest formatter (plan Task 2.4).

One send path for: a card routed to the ``approvals`` boundary, wake-me trips,
and the morning/mission-control digest. ``notify_pending`` consumes the
``assurance_class`` that ``promotion.decide()`` emits (Task 3.1, O9) so this
module never has to recompute novelty -- it reads the class it is handed and
routes accordingly:

* ``"acts-alone"`` -- decide() already routed the action to act alone; no
  approval channel is needed at all, so ``notify_pending`` is a no-op.
* ``"T3-novel"`` / ``"signed-only"`` -- the signed channel ONLY. The card is
  staged as a signed-channel approval PR (Task 1.4's ``stage_approval.stage``,
  with the tier-appropriate injected ``opener``) and NO possession button is
  offered (O9: possession is never admissible for a novel/first-ever T3, or
  for a fail-closed unknown/ambiguous class).
* ``"possession-eligible"`` / ``"T3-established"`` -- the signed PR is staged
  AND a possession (tap) button is built and sent alongside it (Task 2.2's
  ``telegram_send.build_buttons`` / ``telegram_send.send``, reused rather than
  reimplemented).

Every I/O-performing dependency is injected (``stage_fn``, ``send_fn``,
``build_buttons_fn``, the per-tier ``opener``, the Telegram ``transport``) so
tests stay hermetic: fake stand-ins record calls, no git and no network runs
under test.

``digest()`` formats a short brief from ``dashboards/executive.md`` for the
same notify path. That dashboard file is regenerated on the ``ops`` branch
only (see the dashboard-generator skill) and is not assumed to exist in an
arbitrary work-branch worktree, so the dashboard path AND the file reader are
both caller-supplied / injectable.
"""
from __future__ import annotations

from pathlib import Path

import cards
import stage_approval
import telegram_send

# Assurance classes (from promotion.ASSURANCE_CLASSES) for which a possession
# (tap) button is admissible. "T3-novel" and "signed-only" are deliberately
# absent -- O9's fail-closed cutline: no button for a novel/first-ever T3 or
# for an unknown/ambiguous tier.
POSSESSION_ADMISSIBLE = frozenset({"possession-eligible", "T3-established"})

# Classes that need no approval channel at all -- decide() already routed the
# action to act alone, so there is nothing to stage or send here.
NO_CHANNEL_NEEDED = frozenset({"acts-alone"})

# Sections pulled from dashboards/executive.md into the short digest brief.
DIGEST_SECTIONS = ("Action required", "Queue", "Last 24h")


def _pending_text(card: cards.Card, assurance_class: str) -> str:
    return (
        f"Pending approval: {card.meta.get('action')} -> {card.meta.get('target')} "
        f"(card {card.meta['id']}, {assurance_class})"
    )


def notify_pending(
    card_path,
    assurance_class: str,
    *,
    repo_root,
    opener,
    transport,
    chat_id,
    stage_fn=stage_approval.stage,
    send_fn=telegram_send.send,
    build_buttons_fn=telegram_send.build_buttons,
    text: str | None = None,
) -> dict:
    """Route one pending card to the channel(s) its ``assurance_class`` admits.

    ``assurance_class`` MUST be the value ``promotion.decide()`` emitted for
    this card -- novelty is decided there (O9), never recomputed here.

    Returns ``{"staged": ..., "buttons": ..., "sent": ...}``:

    * ``staged`` -- whatever the injected ``stage_fn`` (default
      ``stage_approval.stage``) returned (a PR ref for the cloud opener, a
      branch ref for the desktop opener), or ``None`` for ``"acts-alone"``.
    * ``buttons`` -- the possession-channel inline-keyboard buttons built via
      ``build_buttons_fn`` (default ``telegram_send.build_buttons``), or
      ``None`` when the assurance class does not admit possession.
    * ``sent`` -- whatever the injected ``send_fn`` (default
      ``telegram_send.send``) returned, or ``None`` for ``"acts-alone"``.
    """
    if assurance_class in NO_CHANNEL_NEEDED:
        return {"staged": None, "buttons": None, "sent": None}

    card = cards.parse(card_path)
    staged = stage_fn(card_path, repo_root, opener)

    buttons = None
    if assurance_class in POSSESSION_ADMISSIBLE:
        buttons = build_buttons_fn(card)

    message = text if text is not None else _pending_text(card, assurance_class)
    sent = send_fn(transport, chat_id, message, buttons=buttons)

    return {"staged": staged, "buttons": buttons, "sent": sent}


def _parse_sections(text: str) -> tuple[str, dict[str, str]]:
    """Split a dashboard markdown document into its ``# Title`` and
    ``## Heading`` sections. Only the first ``# `` line becomes the title;
    everything under a ``## `` heading (up to the next heading) is that
    section's body."""
    title = ""
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in text.splitlines():
        if not title and line.startswith("# "):
            title = line[2:].strip()
            continue
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = []
            continue
        if current is not None:
            sections[current].append(line)
    return title, {name: "\n".join(lines).strip() for name, lines in sections.items()}


def digest(dashboard_path, *, read=None) -> str:
    """Format the morning/mission-control brief from a dashboard markdown file.

    ``dashboard_path`` is whatever path the caller (dispatch/nightly, wired in
    Task 3.4) supplies -- ``dashboards/executive.md`` lives on the ``ops``
    branch only, so this function never assumes it exists in the current
    worktree. ``read`` is an injectable ``path -> str`` reader (defaults to a
    plain UTF-8 file read) so tests can point at a fixture instead.
    """
    read = read or (lambda p: Path(p).read_text(encoding="utf-8"))
    text = read(dashboard_path)
    title, sections = _parse_sections(text)

    parts = [title or "Executive Dashboard"]
    for name in DIGEST_SECTIONS:
        body = sections.get(name)
        if body:
            parts.append(f"{name}:\n{body}")
    return "\n\n".join(parts).strip()
