"""SessionStart hook: re-inject the operating law after compaction.

Context does not decay on a clock, so there is no timer here. The ONE real decay mode is
compaction, which can drop the @import'd law out of context on a long session. This fires
only on `compact` — on `startup` the @import in CLAUDE.md already loads the law, and
emitting it again would just duplicate it.

stdout on exit 0 is added to the model's context.
"""
import json
import sys
from pathlib import Path

LAW = Path(__file__).resolve().parents[2] / "knowledge" / "operating-law.md"


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never disrupt a session on a parse error
    if data.get("source") != "compact":
        sys.exit(0)
    try:
        text = LAW.read_text(encoding="utf-8")
    except OSError:
        sys.exit(0)  # law missing is not worth killing the session over
    # Write UTF-8 bytes straight to the buffer: the law carries chars (e.g. U+2192)
    # that the default Windows console codec (cp1252) cannot encode, which would
    # otherwise crash print().
    sys.stdout.buffer.write((text + "\n").encode("utf-8"))
    sys.exit(0)


if __name__ == "__main__":
    main()
