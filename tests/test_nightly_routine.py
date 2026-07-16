import re
from pathlib import Path

ROUTINE = Path(__file__).resolve().parents[1] / "routines" / "nightly.md"


def test_routine_ensures_pyyaml_and_targets_ops():
    text = ROUTINE.read_text(encoding="utf-8")

    # 1. A pyyaml install fallback must be present.
    assert re.search(r"(python -m )?pip install (--user )?pyyaml", text), (
        "routines/nightly.md must contain a pyyaml install fallback line"
    )

    # 2. Every `git push` mention must target ops, never main.
    for line in text.splitlines():
        if "git push" in line:
            assert "main" not in line, (
                f"git push line must not reference main: {line!r}"
            )
