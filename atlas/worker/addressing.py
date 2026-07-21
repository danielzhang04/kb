"""Addressed-speech gate (conversation-rules design §1): decides, ahead of the LLM, whether an
utterance was meant for Atlas. Pure over an injected clock; holds ONE piece of state — the time
of the last Atlas-side activity (wake or an Atlas spoken line, marked by app.py).

`is_addressed` never mutates state: user speech must not extend the window, or continuous
ambient conversation would hold the gate open indefinitely (the 2026-07-21 transcript failure
this module exists to kill). In production the addressed reply Atlas speaks is what re-arms
the window, via app.py's mirror path calling mark_activity()."""
import time

from worker import router


def _vocab_forms(raw: str) -> set:
    """Both normalized shapes of a vocab entry: router.normalize strips punctuation, so
    "faceless-youtube" -> "facelessyoutube" (one token) — but Deepgram transcribes the spoken
    name as "faceless youtube" (two tokens). Register both so either form hits."""
    return {router.normalize(raw), router.normalize(raw.replace("-", " ").replace("_", " "))} - {""}


class Addressing:
    def __init__(self, window_s: float, vocab=(), clock=time.monotonic) -> None:
        self._window = float(window_s)
        self._clock = clock
        self._last: float | None = None
        self._tokens: set = set()     # single-word vocab: token-set match
        self._phrases: list = []      # multi-word vocab: word-boundary substring match
        for raw in vocab:
            for form in _vocab_forms(raw):
                if " " in form:
                    self._phrases.append(form)
                else:
                    self._tokens.add(form)

    def mark_activity(self) -> None:
        self._last = self._clock()

    def is_addressed(self, norm: str) -> bool:
        if self._last is not None and self._clock() - self._last <= self._window:
            return True
        tokens = set(norm.split())
        if "atlas" in tokens or tokens & self._tokens:
            return True
        padded = f" {norm} "
        return any(f" {p} " in padded for p in self._phrases)
