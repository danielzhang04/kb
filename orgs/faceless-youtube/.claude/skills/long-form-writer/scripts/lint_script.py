#!/usr/bin/env python3
"""Deterministic lint for a long-form script.md.

Checks ONLY what needs no judgment: em/en dashes, quotation marks in the VO body,
leftover fact-traces / outline comments, a filled-in header runtime, and the VO
word count vs runtime.

Second person is intentionally NOT checked here: whether a "you" casts the viewer
into the story (banned) or is the generic impersonal "you" ("gold you could wash
out of the sand", fine) is a judgment call that belongs to the taste critic.

Usage: python lint_script.py <path-to-script.md>
Exit code 0 = clean, 1 = hard violations found (dashes / quotes / traces).
"""
import re
import sys


def main(path):
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()

    hard = []   # (lineno, kind, text) — must fix before ship
    soft = []   # (lineno, kind, text) — heads-up

    # Locate the VO body: after the first standalone '---', before '## Sources'.
    body_start, body_end = None, len(lines)
    seen_hr = False
    for i, ln in enumerate(lines):
        s = ln.strip()
        if body_start is None:
            if s == "---":
                body_start = i + 1
            continue
        if s.lower().startswith("## sources") or s.lower() == "## sources":
            body_end = i
            break
    if body_start is None:
        body_start = 0

    # Header (everything before the VO body) must carry a filled-in runtime estimate.
    header = lines[: body_start if body_start else 0]
    runtime_line = next(
        (ln for ln in header if re.search(r"estimated runtime\s*:", ln, re.I)), None
    )
    if runtime_line is None:
        hard.append((0, "missing header runtime", "no 'Estimated runtime:' line in header"))
    elif not re.search(r"estimated runtime[:*\s]*\d+:\d{2}", runtime_line, re.I):
        # present but unfilled (TBD / blank / not MM:SS)
        hard.append((0, "unfilled header runtime", runtime_line.strip()))

    vo_words = 0
    for i, ln in enumerate(lines):
        lineno = i + 1
        stripped = ln.strip()

        # em/en dashes anywhere are a hard violation.
        if "—" in ln or "–" in ln:
            hard.append((lineno, "em/en dash", stripped))

        # leftover fact-traces or outline comments anywhere.
        if re.search(r"<!--\s*F-?\d+", ln) or re.search(r"<!--\s*outline", ln, re.I):
            hard.append((lineno, "leftover trace/outline comment", stripped))

        in_body = body_start <= i < body_end
        is_cue = stripped.startswith("[")            # [B-ROLL] / [PAUSE] / [BEAT]
        is_meta = stripped.startswith(("#", "-", "*", ">")) or stripped == "---" or stripped == ""

        if in_body and not is_cue and not is_meta:
            # quotation marks in a spoken VO line = the no-quotes lock.
            if '"' in ln or "“" in ln or "”" in ln:
                hard.append((lineno, "quote in VO line", stripped))
            # count spoken words (rough: split on whitespace).
            vo_words += len(stripped.split())

    print(f"== lint: {path} ==")
    if hard:
        print(f"\nHARD violations ({len(hard)}) — must fix before ship:")
        for lineno, kind, text in hard:
            snippet = text[:100] + ("…" if len(text) > 100 else "")
            print(f"  L{lineno}  [{kind}]  {snippet}")
    else:
        print("\nHARD violations: none (no dashes, no VO quotes, no leftover traces).")

    total_s = round(vo_words / 150.0 * 60)
    mm, ss = divmod(total_s, 60)
    print(
        f"\nVO word count: {vo_words}  ->  header should read: "
        f"Estimated runtime: {mm}:{ss:02d} ({vo_words:,} words ÷ 150 wpm)"
    )

    return 1 if hard else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python lint_script.py <path-to-script.md>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
