#!/usr/bin/env python3
"""Narrative beat map from a transcript (pure). NOT visual cuts (G7) — a cut can't be inferred from
audio and isn't load-bearing; the beat signal our music/emission measures need is narrative.

Input: Whisper-style segments [{start, end, text}]. Output: [{at_s, kind, confidence}] where
kind in {act, punchline, plain}. Every beat is `confidence:"directional"` — labels are inferred from
transcript structure (real silence before a line + short-line-after-long), not measured (G6). `reveal`
is folded into `punchline` (both are emphasis beats; distinguishing them heuristically would over-claim).
"""


def narrative_beats(transcript, act_gap_s=2.0, short_words=5):
    beats = []
    for i, seg in enumerate(transcript):
        words = len(seg["text"].split())
        silence_before = (seg["start"] - transcript[i - 1]["end"]) if i > 0 else 0.0
        prev_words = len(transcript[i - 1]["text"].split()) if i > 0 else 0
        if i > 0 and silence_before >= act_gap_s:
            kind = "act"                                   # a real pause before the line = section reset
        elif i > 0 and words <= short_words and prev_words > short_words:
            kind = "punchline"                             # a short line after a longer one = a punch/deflate
        else:
            kind = "plain"
        beats.append({"at_s": round(seg["start"], 3), "kind": kind, "confidence": "directional"})
    return beats
