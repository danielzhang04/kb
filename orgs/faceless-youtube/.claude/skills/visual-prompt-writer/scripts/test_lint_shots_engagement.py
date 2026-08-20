"""Regression coverage for long-form CADENCE rules and the VO stream they measure.

The cadence pair (enough cuts, durations that cover the VO) is only as honest as the
runtime it is sized against, so the runtime SOURCE — the script header's stated rate —
and the stream the word count comes from are pinned here alongside the floors.
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lint_shots import build_vo_stream, lint_piece

# A real header, from channels/the-second-take/videos/2026-07-28-bricks-fresh/script.md:
# this channel's locked voice measures ~175 gross wpm, not the 150 the lint used to assume,
# so the same script sized off 150 buys shots for an 11:38 video that runs 9:52.
HEADER_175 = (
    "# The Company That Shipped Bricks and Called Them Hard Drives\n\n"
    "- **Voice:** Miles, ElevenLabs v3 · measured ~175 gross wpm\n"
    "- **Estimated runtime:** 9:52 (1,728 words ÷ 175 wpm)\n\n"
)


def _lint_piece(shots, words, header=""):
    with tempfile.TemporaryDirectory() as td:
        script = Path(td) / "script.md"
        script.write_text(header + "---\n" + " ".join(words) + "\n", encoding="utf-8")
        hard, soft = [], []
        lint_piece("long-form", shots, script, hard, soft)
        return hard


def test_runtime_over_five_cadence_floor_fails():
    words = ["word"] * 50
    shots = [{"id": f"L{i}", "vo_ref": "word", "duration_s": 4} for i in range(1, 4)]
    errs = _lint_piece(shots, words)
    assert any("1 cut / 5s" in e for e in errs), errs


def test_the_cadence_floor_divisor_is_five():
    """Minimal P1: 60 words = 24 seconds, so four shots fail the five-second floor."""
    words = ["word"] * 60
    shots = [{"id": f"L{i}", "vo_ref": "word", "duration_s": 6} for i in range(1, 5)]
    errs = _lint_piece(shots, words)
    assert any("1 cut / 5s" in e for e in errs), errs


def test_coverage_floor_still_fails_short_durations():
    """The other half of the cadence pair: enough cuts, but the durations don't
    cover the VO — the stretch-to-fill dead-hold risk."""
    words = ["word"] * 100
    shots = [{"id": f"L{i}", "vo_ref": "word", "duration_s": 1} for i in range(1, 12)]
    errs = _lint_piece(shots, words)
    assert any("do not cover the VO" in e for e in errs), errs


# --- the runtime SOURCE: the script header's stated rate, not a 150 constant ----

def _cadence_shots():
    """20 shots x 2.75s = 55s of durations against 175 words: clean at the header's
    175 wpm (60s runtime, floor 51s / 15 cuts), under-covered at 150 (70s, floor 59.5s)."""
    return [{"id": f"L{i}", "vo_ref": "word", "duration_s": 2.75} for i in range(1, 21)]


def test_the_header_rate_sizes_the_runtime():
    errs = _lint_piece(_cadence_shots(), ["word"] * 175, HEADER_175)
    assert errs == [], errs


def test_without_the_header_the_150_default_still_applies():
    errs = _lint_piece(_cadence_shots(), ["word"] * 175)
    assert any("do not cover the VO" in e and "150wpm" in e for e in errs), errs


def test_the_runtime_message_names_the_rate_it_used():
    """A lint that sizes off the wrong rate must be diagnosable from its own message."""
    shots = [{"id": "L1", "vo_ref": "word", "duration_s": 1}]
    errs = _lint_piece(shots, ["word"] * 175, HEADER_175)
    assert any("175wpm" in e for e in errs), errs


# --- the stream the word count (and every anchor) is measured from --------------

def test_a_solitary_italic_meta_line_is_not_narration():
    """script.md's tail carries an authoring note in italics ("*Disclosure line
    (spoken tail or end card, per channel YMYL rule): ...*"). It is meta ABOUT the
    video, not a VO line, and counting it inflates the runtime and offers the writer
    an anchor no voice will ever speak."""
    with tempfile.TemporaryDirectory() as td:
        md = Path(td) / "script.md"
        md.write_text(
            "---\n\nThe audit passed and nobody looked inside.\n\n"
            "*Disclosure line (spoken tail or end card, per channel YMYL rule): "
            "This is a story about what happened, not financial advice.*\n",
            encoding="utf-8")
        vo, toks = build_vo_stream(md)
    assert "Disclosure" not in vo, vo
    assert not any(t == "disclosure" for t, _ in toks)
    assert "nobody looked inside" in vo


def test_inline_emphasis_inside_a_real_line_is_still_narration():
    """Only a WHOLE line wrapped in asterisks is meta — emphasis inside a spoken
    sentence is spoken, and dropping it would break every anchor after it."""
    with tempfile.TemporaryDirectory() as td:
        md = Path(td) / "script.md"
        md.write_text("---\n\nNone of them is a *hard drive*. They're bricks.\n", encoding="utf-8")
        vo, toks = build_vo_stream(md)
    assert "hard drive" in vo
    assert ["hard", "drive"] == [t for t, _ in toks if t in ("hard", "drive")]


def test_a_short_anchor_under_four_words_still_matches():
    """F-2 from the bricks pipe test: a [PAUSE]-bounded line ("The audit passed.")
    cannot yield 4 words. The matcher takes the first FOUR words or fewer, so a
    3-word anchor is legal — the lint must not report it as unfound."""
    words = "The audit passed and then the serial numbers were applied to rocks".split()
    shots = [{"id": "L1", "vo_ref": "The audit passed", "duration_s": 8},
             {"id": "L2", "vo_ref": "the serial numbers", "duration_s": 8}]
    errs = _lint_piece(shots, words)
    assert not any("vo_ref not found" in e for e in errs), errs


def test_out_of_order_anchor_fails():
    words = "alpha beta gamma delta epsilon zeta eta theta".split()
    shots = [
        {"id": "L01", "vo_ref": "epsilon zeta eta theta", "duration_s": 4},
        {"id": "L02", "vo_ref": "alpha beta gamma delta", "duration_s": 4},
    ]
    errs = _lint_piece(shots, words)
    assert any("out of narration order" in e for e in errs), errs
