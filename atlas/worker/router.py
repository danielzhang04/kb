"""Utterance router: V0 is fast-lane-only.

Three lanes are planned for the voice pipeline:
  - reflex: instant canned/local response, no model call (arrives in V1)
  - fast:   tool-use loop over kb read tools (this is V0's only lane)
  - work:   hands off to a longer-running agent/card (arrives in V1)
"""


def route(utterance: str) -> str:
    if not utterance or not utterance.strip():
        raise ValueError("utterance is empty")
    return "fast"
