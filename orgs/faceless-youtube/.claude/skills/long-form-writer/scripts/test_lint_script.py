#!/usr/bin/env python3
"""Focused coverage for the long-form lint's deterministic Step and runtime-band rules."""
import contextlib
import importlib.util
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


LINT_PATH = Path(__file__).with_name("lint_script.py")
SPEC = importlib.util.spec_from_file_location("lint_script", LINT_PATH)
lint_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lint_script)


def script(*body):
    return "# Script\n- Estimated runtime: 0:10\n---\n" + "\n".join(body) + "\n"


def script_with_band(target_length_line, *body):
    """Header carrying a 'Target length:' line (for the hard-band tests) plus a
    valid 'Estimated runtime:' line (so the unrelated header-runtime check never
    fires here)."""
    return (
        "# Script\n"
        f"- Target length: {target_length_line}\n"
        "- Estimated runtime: 0:10\n"
        "---\n" + "\n".join(body) + "\n"
    )


def words_line(n):
    return " ".join(["word"] * n) + "."


class LintScriptTests(unittest.TestCase):
    def run_lint(self, text, wpm=150, wpm_given=False):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "script.md"
            path.write_text(text, encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = lint_script.main(path, wpm, wpm_given)
        return code, output.getvalue()

    def test_complete_step_sequence_and_advisory_are_nonblocking(self):
        code, output = self.run_lint(script(
            "**Step 1: Make the lie.**",
            "He actually did print the paperwork.",
            "**Step 2: Sell the lie.**",
        ))
        self.assertEqual(code, 0)
        self.assertIn("Advisories", output)
        self.assertNotIn("skipped/out-of-order", output)

    def test_contextual_actually_and_really_are_not_phrase_advisories(self):
        code, output = self.run_lint(script("It actually looked real to them.", "It really mattered."))
        self.assertEqual(code, 0)
        self.assertNotIn("Advisories", output)

    def test_malformed_duplicate_skipped_and_orphan_steps_fail(self):
        cases = {
            "malformed": script("Step 1:"),
            "duplicate": script("Step 1: Start.", "Step 1: Repeat."),
            "skipped": script("Step 1: Start.", "Step 3: Finish."),
            "orphan": script("Step 1: Start."),
        }
        for name, text in cases.items():
            with self.subTest(name=name):
                code, output = self.run_lint(text)
                self.assertEqual(code, 1)
                self.assertIn(name if name != "skipped" else "skipped/out-of-order", output)

    def test_blockquoted_straight_and_curly_quotes_surface_as_nonblocking_advisories(self):
        for quoted in ('> "He said it."', "> “He said it.”"):
            with self.subTest(quoted=quoted):
                code, output = self.run_lint(script(quoted))
                self.assertEqual(code, 0)
                self.assertIn("quote in VO body", output)
                self.assertIn("Advisories", output)

    def test_runtime_suggestion_is_words_over_wpm_with_no_cue_math(self):
        # 15 VO words at the default 150 wpm: 15/150*60 = 6.0s -> 0:06. No cue-seconds
        # math is added (script.md is pure prose; pauses live with audio-director).
        code, output = self.run_lint(script(
            "One two three four five.",
            "Six seven eight nine ten.",
            "Eleven twelve thirteen fourteen fifteen.",
        ))
        self.assertEqual(code, 0)
        self.assertIn("Estimated runtime: 0:06 (15 words ÷ 150 wpm)", output)
        self.assertNotIn("pauses", output)

    def test_bracketed_cues_in_vo_body_are_hard_violations(self):
        # script.md is pure prose: [B-ROLL]/[PAUSE]/[BEAT] (standalone or inline) are all
        # hard violations now, never a legal cue the writer can author.
        cases = {
            "b-roll": "[B-ROLL: exterior of the warehouse]",
            "pause": "[PAUSE]",
            "pause-long": "[PAUSE:LONG]",
            "beat": "[BEAT]",
            "inline": "He signed the paperwork [PAUSE] and walked out.",
        }
        for name, line in cases.items():
            with self.subTest(name=name):
                code, output = self.run_lint(script("Some ordinary VO line.", line))
                self.assertEqual(code, 1)
                self.assertIn("bracketed cue in VO body", output)
                self.assertIn("pure prose", output)

    def test_one_sentence_paragraphs_are_a_nonblocking_advisory(self):
        # Two standalone one-sentence paragraphs (lines 6 and 10 of the written file)
        # among two multi-sentence idea blocks. Advisory only, never blocking.
        code, output = self.run_lint(script(
            "This is a two sentence paragraph. It keeps going right here.",
            "",
            "Short standalone sentence.",
            "",
            "Multi-sentence block one. Multi-sentence block two. Multi-sentence block three.",
            "",
            "Another lone line here.",
        ))
        self.assertEqual(code, 0)
        self.assertIn("Advisories", output)
        self.assertIn("2 one-sentence paragraphs", output)
        self.assertIn("idea blocks average 4-5 sentences", output)
        self.assertIn("L6", output)
        self.assertIn("L10", output)

    # -- Hard pre-render runtime band -----------------------------------------

    def test_target_band_parses_all_accepted_forms(self):
        cases = {
            "mmss_hyphen": ("Target length: 7:30-9:30", (450, 570)),
            "mmss_en_dash": ("Target length: 7:30–9:30", (450, 570)),
            "to_min": ("Target length: 8 to 10 min", (480, 600)),
            "hyphen_min": ("Target length: 8-10 min", (480, 600)),
            "en_dash_min": ("Target length: 8–10 min", (480, 600)),
        }
        for name, (line, expected) in cases.items():
            with self.subTest(name=name):
                result = lint_script.parse_target_band([line])
                self.assertIsNotNone(result)
                floor_s, ceiling_s, _ = result
                self.assertEqual((floor_s, ceiling_s), expected)

    def test_real_legacy_one_line_header_parses_target_band(self):
        line = (
            "- **Target length:** 12-15 min · **Estimated runtime:** "
            "9:24 (1,411 words ÷ 150 wpm)"
        )
        floor_s, ceiling_s, band_text = lint_script.parse_target_band([line])
        self.assertEqual((floor_s, ceiling_s), (720, 900))
        self.assertEqual(band_text, "12-15 min")

    def test_no_parsable_band_stays_advisory_only(self):
        # No 'Target length:' line at all: current behavior preserved even with
        # --wpm given and a word count that would blow any plausible band.
        code, output = self.run_lint(
            script(words_line(5)), wpm=171, wpm_given=True
        )
        self.assertEqual(code, 0)
        self.assertNotIn("runtime outside hard band", output)
        self.assertIn("VO word count: 5", output)

    def test_unparsable_band_present_adds_advisory_without_failing(self):
        code, output = self.run_lint(
            script_with_band("about eight minutes", words_line(5)),
            wpm=171,
            wpm_given=True,
        )
        self.assertEqual(code, 0)
        self.assertIn(
            "Target length present but unparsable — hard band not enforced",
            output,
        )
        self.assertNotIn("runtime outside hard band", output)

    def test_reversed_band_is_unparsable_and_advisory_only(self):
        for band in ("9:30-7:30", "10-8 min", "10 to 8 min"):
            with self.subTest(band=band):
                self.assertIsNone(
                    lint_script.parse_target_band([f"Target length: {band}"])
                )
                code, output = self.run_lint(
                    script_with_band(band, words_line(5)),
                    wpm=171,
                    wpm_given=True,
                )
                self.assertEqual(code, 0)
                self.assertIn(
                    "Target length present but unparsable — hard band not enforced",
                    output,
                )
                self.assertNotIn("runtime outside hard band", output)

    def test_mmss_seconds_over_59_are_unparsable(self):
        for band in ("7:60-9:30", "7:30-9:99"):
            with self.subTest(band=band):
                self.assertIsNone(
                    lint_script.parse_target_band([f"Target length: {band}"])
                )
                code, output = self.run_lint(
                    script_with_band(band, words_line(5)),
                    wpm=171,
                    wpm_given=True,
                )
                self.assertEqual(code, 0)
                self.assertIn(
                    "Target length present but unparsable — hard band not enforced",
                    output,
                )

    def test_band_present_but_wpm_not_given_stays_advisory_only(self):
        # A parsable band with --wpm NOT given (wpm_given=False, the plain `python
        # lint_script.py file.md` invocation) never hard-fails on it.
        code, output = self.run_lint(
            script_with_band("7:30-9:30", words_line(5)), wpm=150, wpm_given=False
        )
        self.assertEqual(code, 0)
        self.assertNotIn("runtime outside hard band", output)

    def test_estimate_below_floor_is_hard_violation(self):
        # 200 words at 171 wpm ~= 70s, far under the 7:30 (450s) floor.
        code, output = self.run_lint(
            script_with_band("7:30-9:30", words_line(200)), wpm=171, wpm_given=True
        )
        self.assertEqual(code, 1)
        self.assertIn("runtime outside hard band", output)
        self.assertIn("hard 7:30-9:30 band", output)
        self.assertIn("add ", output)

    def test_estimate_above_ceiling_is_hard_violation(self):
        # 1700 words at 171 wpm ~= 596s, over the 9:30 (570s) ceiling.
        code, output = self.run_lint(
            script_with_band("7:30-9:30", words_line(1700)), wpm=171, wpm_given=True
        )
        self.assertEqual(code, 1)
        self.assertIn("runtime outside hard band", output)
        self.assertIn("hard 7:30-9:30 band", output)
        self.assertIn("cut ", output)

    def test_estimate_inside_band_passes(self):
        # 1425 words at 171 wpm = 500s, inside 450-570s.
        code, output = self.run_lint(
            script_with_band("7:30-9:30", words_line(1425)), wpm=171, wpm_given=True
        )
        self.assertEqual(code, 0)
        self.assertNotIn("runtime outside hard band", output)

    def test_mmss_arithmetic_is_exact_at_the_boundary(self):
        # wpm=60 makes 1 word == 1 second exactly, so 7:30-9:30 is a literal
        # 450-570 word band with no rounding ambiguity.
        # One word under the floor: hard fail naming the exact shortfall.
        code, output = self.run_lint(
            script_with_band("7:30-9:30", words_line(449)), wpm=60, wpm_given=True
        )
        self.assertEqual(code, 1)
        self.assertIn("add 1w (need 450w+) for 7:30", output)

        # Exactly on the floor: passes (inclusive boundary).
        code, output = self.run_lint(
            script_with_band("7:30-9:30", words_line(450)), wpm=60, wpm_given=True
        )
        self.assertEqual(code, 0)

        # Exactly on the ceiling: passes (inclusive boundary).
        code, output = self.run_lint(
            script_with_band("7:30-9:30", words_line(570)), wpm=60, wpm_given=True
        )
        self.assertEqual(code, 0)

        # One word over the ceiling: hard fail naming the exact overage.
        code, output = self.run_lint(
            script_with_band("7:30-9:30", words_line(571)), wpm=60, wpm_given=True
        )
        self.assertEqual(code, 1)
        self.assertIn("cut 1w (need 570w or fewer) for 9:30", output)

    def test_main_accepts_spaced_wpm_and_rejects_equals_form(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "script.md"
            path.write_text(script(words_line(5)), encoding="utf-8")

            accepted = subprocess.run(
                [sys.executable, "-X", "utf8", str(LINT_PATH), str(path), "--wpm", "171"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
            self.assertIn("5 words ÷ 171 wpm", accepted.stdout)

            rejected = subprocess.run(
                [sys.executable, "-X", "utf8", str(LINT_PATH), str(path), "--wpm=171"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            self.assertEqual(rejected.returncode, 2)
            self.assertIn("usage:", rejected.stdout)


if __name__ == "__main__":
    unittest.main()
