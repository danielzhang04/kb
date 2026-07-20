"""Engagement window state machine (spec §2 Listening decision: audio leaves the PC ONLY
while ENGAGED). Pure logic, no audio — driven by wake word, speech events, and a clock.

ASLEEP --wake()--> ENGAGED --(clock()-last_activity > timeout_s via tick())--> ASLEEP
                            --dismiss()--> ASLEEP (immediate)
heard_speech() re-stamps the silence clock while ENGAGED.
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

    def heard_speech(self) -> None:
        """A final transcript arrived: re-stamp the silence clock (no-op while asleep)."""
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
