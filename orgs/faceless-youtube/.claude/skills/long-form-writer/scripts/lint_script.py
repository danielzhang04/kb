#!/usr/bin/env python3
"""Deterministic lint for a long-form script.md.

Checks ONLY what needs no judgment: em/en dashes, quotation marks in the VO body,
leftover fact-traces / outline comments, a filled-in header runtime, mechanical
Step-card sequences, and the VO word count vs runtime. Exact credibility-padding
phrases are reported as non-blocking advisories.

Second person is intentionally NOT checked here: whether a "you" casts the viewer
into the story (banned) or is the generic impersonal "you" ("gold you could wash
out of the sand", fine) is a judgment call that belongs to the taste critic.

Usage: python lint_script.py <path-to-script.md>
Exit code 0 = clean or advisory-only, 1 = hard violations found.
"""
import re
import sys


STEP_NUMBER = re.compile(r"^Step\s+(\d+)\b", re.I)
STEP_CARD = re.compile(r"^Step\s+(\d+)\s*:\s*.+", re.I)
MALFORMED_STEP = re.compile(r"^Step(?:\s+\d+)?\s*:\s*$", re.I)
CREDIBILITY_ADVISORIES = (
    (re.compile(r"\bthat part is real\b", re.I), "credibility-padding phrase: that part is real"),
    (re.compile(r"\bhe actually did\b", re.I), "credibility-padding phrase: he actually did"),
    (re.compile(r"\bhe really did\b", re.I), "credibility-padding phrase: he really did"),
    (re.compile(r"\bseriously\b", re.I), "credibility-padding phrase: seriously"),
)


def lint_step_sequences(lines, body_start, body_end, hard):
    """Reject only mechanically malformed spoken Step N card sequences."""
    steps = []
    for i in range(body_start, body_end):
        text = lines[i].strip().strip("*").strip()
        numbered = STEP_NUMBER.match(text)
        if numbered:
            if not STEP_CARD.match(text):
                hard.append((i + 1, "malformed Step card", lines[i].strip()))
                continue
            steps.append((int(numbered.group(1)), i + 1, lines[i].strip()))
        elif MALFORMED_STEP.match(text):
            hard.append((i + 1, "malformed Step card", lines[i].strip()))

    if not steps:
        return

    numbers = [number for number, _, _ in steps]
    if len(steps) == 1:
        number, lineno, text = steps[0]
        hard.append((lineno, "orphan Step sequence", text))
        return
    if numbers[0] != 1:
        hard.append((steps[0][1], "Step sequence must start at 1", steps[0][2]))
    seen = set()
    for number, lineno, text in steps:
        if number in seen:
            hard.append((lineno, "duplicate Step number", text))
        seen.add(number)
    for expected, (actual, lineno, text) in enumerate(steps, start=1):
        if actual != expected:
            hard.append((lineno, f"skipped/out-of-order Step (expected {expected})", text))


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

    lint_step_sequences(lines, body_start, body_end, hard)

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

        # The no-quotes lock applies to the whole script body, including Markdown blockquotes or
        # list-formatted prose. Those lines are non-spoken metadata to voiceover, but allowing a quote
        # there would let a generated story beat pass this gate and then disappear from the transcript.
        if in_body and not is_cue and ('"' in ln or "“" in ln or "”" in ln):
            hard.append((lineno, "quote in VO body", stripped))

        if in_body and not is_cue and not is_meta:
            # count spoken words (rough: split on whitespace).
            vo_words += len(stripped.split())
            for pattern, label in CREDIBILITY_ADVISORIES:
                if pattern.search(ln):
                    soft.append((lineno, label, stripped))

    print(f"== lint: {path} ==")
    if hard:
        print(f"\nHARD violations ({len(hard)}) — must fix before ship:")
        for lineno, kind, text in hard:
            snippet = text[:100] + ("…" if len(text) > 100 else "")
            print(f"  L{lineno}  [{kind}]  {snippet}")
    else:
        print("\nHARD violations: none (no dashes, no VO quotes, no leftover traces).")

    if soft:
        print(f"\nAdvisories ({len(soft)}) — review, do not block:")
        for lineno, kind, text in soft:
            print(f"  L{lineno}  [{kind}]  {text[:100]}")

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
