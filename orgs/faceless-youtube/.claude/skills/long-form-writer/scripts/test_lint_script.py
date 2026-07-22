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


if __name__ == "__main__":
    unittest.main()
