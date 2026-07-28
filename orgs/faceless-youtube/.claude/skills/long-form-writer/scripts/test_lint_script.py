#!/usr/bin/env python3
"""Focused coverage for the long-form script lint's deterministic Step rules."""
import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path


LINT_PATH = Path(__file__).with_name("lint_script.py")
SPEC = importlib.util.spec_from_file_location("lint_script", LINT_PATH)
lint_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lint_script)


def script(*body):
    return "# Script\n- Estimated runtime: 0:10\n---\n" + "\n".join(body) + "\n"


class LintScriptTests(unittest.TestCase):
    def run_lint(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "script.md"
            path.write_text(text, encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = lint_script.main(path)
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


if __name__ == "__main__":
    unittest.main()
