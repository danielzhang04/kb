"""Engagement window state machine (spec §2 Listening decision: audio leaves the PC ONLY
while ENGAGED). Pure logic, no audio — driven by wake word, interaction events, and a clock.

ASLEEP --wake()--> ENGAGED --(clock()-last_activity > timeout_s via tick())--> ASLEEP
                            --dismiss()--> ASLEEP (immediate)
interacted() re-stamps the silence clock while ENGAGED.

The silence clock measures time since the last *directed interaction with Atlas* — wake, an
Atlas reply, or a kept-awake reflex — NOT time since the last transcribed sound. That distinction
is the whole point: while ENGAGED the mic streams the WHOLE room to STT, so background chatter is
transcribed too. Re-stamping on every transcript (the pre-2026-07-21 bug) let ambient talk defeat
the 2-min silence window forever; re-stamping only on Atlas interaction lets the room stay noisy
and Atlas still sleeps timeout_s after it was last actually engaged.
"""
import time

ASLEEP = "ASLEEP"
ENGAGED = "ENGAGED"


class Engagement:
    def __init__(self, timeout_s: float, clock=time.monotonic):
        self.timeout_s = timeout_s
        self._clock = clock
        self._state = ASLEEP
        self._last_activity = 0.0

    @property
    def state(self) -> str:
        return self._state

    def wake(self) -> None:
        """Wake word fired: enter ENGAGED and stamp the silence clock."""
        self._state = ENGAGED
        self._last_activity = self._clock()

    def interacted(self) -> None:
        """A directed interaction with Atlas occurred (Atlas woke, replied, or handled a
        keep-awake reflex): re-stamp the silence clock (no-op while asleep).

        NOT called for raw user transcripts — ambient room speech that Atlas does not act on must
        NOT re-stamp the clock, or continuous background talk keeps Atlas awake forever (the
        symptom this method's rename encodes)."""
        if self._state == ENGAGED:
            self._last_activity = self._clock()

    def dismiss(self) -> None:
        """Explicit dismissal ("that's all"): immediate ASLEEP."""
        self._state = ASLEEP

    def tick(self) -> str:
        """Advance the clock: sleep if silence exceeded timeout_s. No-op while asleep."""
        if self._state == ENGAGED and self._clock() - self._last_activity > self.timeout_s:
            self._state = ASLEEP
        return self._state
