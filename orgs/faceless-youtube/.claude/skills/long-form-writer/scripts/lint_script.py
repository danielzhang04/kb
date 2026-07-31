#!/usr/bin/env python3
"""Deterministic lint for a long-form script.md.

Checks ONLY what needs no judgment: em/en dashes, leftover fact-traces / outline
comments, a filled-in header runtime, mechanical Step-card sequences, bracketed
production cues in the VO body, and the VO word count vs runtime. Quotation
marks in the VO body, exact credibility-padding phrases, standalone
one-sentence paragraphs, and a skewed contraction ratio are reported as
non-blocking advisories (quoting, paragraph shape, and contraction register
are taste calls for the critics, not a lock).

script.md is pure prose: the writer authors no pause cues, no beats, and no
[B-ROLL] anchors. Any `[B-ROLL`, `[PAUSE`, or `[BEAT` occurrence in the VO body
is a HARD violation: deliberate pauses are audio-director's job and visual
beat segmentation moves downstream entirely.

The runtime suggestion is words-at-wpm only: the channel voice's measured gross
wpm already embeds its natural pausing, so no separate cue-time math is added.

If the header's `Target length:` line carries a parsable band (`M:SS-M:SS`,
`N to M min`, or `N-M min`; hyphen or en dash) AND --wpm was passed on the
command line, the words-at-wpm estimate falling outside that band is a HARD
violation (same class as em-dashes) — the pre-render runtime band is a hard
floor and ceiling, not advice (docs/superpowers/specs/2026-07-30-hard-runtime-
band-design.md). A missing/unparsable band, or no --wpm given, leaves the
runtime suggestion an advisory only, unchanged from before.

Usage: python lint_script.py <path-to-script.md> [--wpm N]
--wpm is the channel voice's measured words-per-minute from dna.md (default 150),
used for the runtime suggestion and (when a header band parses) the hard band check.
Exit code 0 = clean or advisory-only, 1 = hard violations found.
"""
import re
import sys


STEP_NUMBER = re.compile(r"^Step\s+(\d+)\b", re.I)
STEP_CARD = re.compile(r"^Step\s+(\d+)\s*:\s*.+", re.I)
MALFORMED_STEP = re.compile(r"^Step(?:\s+\d+)?\s*:\s*$", re.I)
CUE_PATTERN = re.compile(r"\[B-ROLL|\[PAUSE|\[BEAT")
SENTENCE_END = re.compile(r"[.!?]+[\"'\)’”]*(?=\s|$)")
CREDIBILITY_ADVISORIES = (
    (re.compile(r"\bthat part is real\b", re.I), "credibility-padding phrase: that part is real"),
    (re.compile(r"\bhe actually did\b", re.I), "credibility-padding phrase: he actually did"),
    (re.compile(r"\bhe really did\b", re.I), "credibility-padding phrase: he really did"),
    (re.compile(r"\bseriously\b", re.I), "credibility-padding phrase: seriously"),
)
# Contraction-ratio advisory: contraction tokens (closed class, not possessive 's) vs
# their expandable uncontracted forms at clause starts. A channel voice that runs
# contracted (the norm for this project's casual-friend register) reading uncontracted
# at scale is a register drift worth a human look — never a lock.
CONTRACTION_PATTERN = re.compile(
    r"\b(?:i'm|i've|i'll|i'd|you're|you've|you'll|you'd|he's|he'll|he'd|she's|she'll|she'd|"
    r"it's|it'll|it'd|we're|we've|we'll|we'd|they're|they've|they'll|they'd|that's|that'll|"
    r"that'd|there's|there'll|who's|who'll|what's|what'll|here's|let's|don't|doesn't|didn't|"
    r"won't|wouldn't|shouldn't|couldn't|can't|cannot|isn't|aren't|wasn't|weren't|hasn't|"
    r"haven't|hadn't|mustn't|needn't|ain't)\b",
    re.I,
)
UNCONTRACTED_PATTERN = re.compile(
    r"\b(?:That is|It is|There is|He is|She is|They are|You are|We are|Do not|Did not|"
    r"Was not|Were not|Is not|Are not|Cannot|Could not|Would not|Should not)\b",
    re.I,
)

# Hard pre-render runtime band: parsed from the header's "Target length:" line.
# Accepted forms, checked in order (most specific first so "7:30-9:30" never
# gets misread by the plain-minutes patterns): M:SS-M:SS, "N to M min", "N-M min".
# Hyphen or en dash accepted throughout.
TARGET_LENGTH_LINE = re.compile(r"target length", re.I)
MMSS_BAND = re.compile(r"(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})")
PLAIN_MIN_TO_BAND = re.compile(r"(\d+)\s*to\s*(\d+)\s*min", re.I)
PLAIN_MIN_HYPHEN_BAND = re.compile(r"(\d+)\s*[-–]\s*(\d+)\s*min", re.I)


def parse_target_band(header_lines):
    """Parse a hard runtime band (floor_s, ceiling_s, band_text) from the header's
    'Target length:' line, or None if no line/no parsable band. band_text is the
    matched substring, used verbatim in violation messages."""
    line = next((ln for ln in header_lines if TARGET_LENGTH_LINE.search(ln)), None)
    if line is None:
        return None
    m = MMSS_BAND.search(line)
    if m:
        floor_s = int(m.group(1)) * 60 + int(m.group(2))
        ceiling_s = int(m.group(3)) * 60 + int(m.group(4))
        return floor_s, ceiling_s, m.group(0)
    m = PLAIN_MIN_TO_BAND.search(line)
    if m:
        floor_s = int(m.group(1)) * 60
        ceiling_s = int(m.group(2)) * 60
        return floor_s, ceiling_s, m.group(0)
    m = PLAIN_MIN_HYPHEN_BAND.search(line)
    if m:
        floor_s = int(m.group(1)) * 60
        ceiling_s = int(m.group(2)) * 60
        return floor_s, ceiling_s, m.group(0)
    return None


def format_mmss(total_s):
    mm, ss = divmod(total_s, 60)
    return f"{mm}:{ss:02d}"


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


def main(path, wpm=150, wpm_given=False):
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

    target_band = parse_target_band(header)

    vo_words = 0
    one_sentence_paragraphs = []   # line numbers of standalone one-sentence VO paragraphs
    contraction_count = 0
    uncontracted_count = 0
    uncontracted_lines = []        # line numbers carrying an uncontracted expandable form
    para_start = None
    para_text = []

    def close_paragraph():
        nonlocal para_start, para_text
        if para_start is not None and para_text:
            joined = " ".join(para_text)
            if len(SENTENCE_END.findall(joined)) == 1:
                one_sentence_paragraphs.append(para_start)
        para_start = None
        para_text = []

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

        # script.md is pure prose: any bracketed production cue anywhere in the VO body
        # is a hard violation, wherever it sits on the line (standalone or inline).
        # Deliberate pauses are audio-director's job; visual beats move downstream.
        if in_body and CUE_PATTERN.search(ln):
            hard.append((
                lineno,
                "bracketed cue in VO body (script.md is pure prose; pauses belong to "
                "audio-director, visual beats move downstream)",
                stripped,
            ))

        # Quotes in the VO body are a taste call (narrator-reported speech is the default telling
        # mode, not a lock) — surfaced as an advisory so the critics see them, never a hard failure.
        # The whole body is scanned, including blockquotes/lists, so a quoted beat can't hide there.
        if in_body and not is_cue and ('"' in ln or "“" in ln or "”" in ln):
            soft.append((lineno, "quote in VO body (taste review)", stripped))

        # Paragraph tracking for the standalone one-sentence-paragraph advisory: a paragraph
        # is consecutive non-blank VO prose lines; any meta/blank/cue line or leaving the body
        # closes it. Reuses the same prose-line definition as the word count below.
        if in_body and not is_cue and not is_meta:
            if para_start is None:
                para_start = lineno
            para_text.append(stripped)
        else:
            close_paragraph()

        if in_body and not is_cue and not is_meta:
            # count spoken words (rough: split on whitespace).
            vo_words += len(stripped.split())
            for pattern, label in CREDIBILITY_ADVISORIES:
                if pattern.search(ln):
                    soft.append((lineno, label, stripped))
            contraction_count += len(CONTRACTION_PATTERN.findall(stripped))
            uncontracted_hits = UNCONTRACTED_PATTERN.findall(stripped)
            if uncontracted_hits:
                uncontracted_count += len(uncontracted_hits)
                uncontracted_lines.append(lineno)

    close_paragraph()  # a final paragraph that runs to the end of the body without a trailing blank

    if one_sentence_paragraphs:
        refs = ", ".join(f"L{n}" for n in one_sentence_paragraphs)
        soft.append((
            0,
            "one-sentence paragraph",
            f"{len(one_sentence_paragraphs)} one-sentence paragraphs; idea blocks average "
            f"4-5 sentences ({refs})",
        ))

    if uncontracted_count >= 5 and uncontracted_count >= contraction_count / 2:
        refs = ", ".join(f"L{n}" for n in uncontracted_lines)
        soft.append((
            0,
            "contraction ratio",
            f"{contraction_count} contractions vs {uncontracted_count} uncontracted expandable "
            f"forms (That is / It is / Do not / etc.); channel voice runs contracted ({refs})",
        ))

    # Hard pre-render runtime band: only fires when the header band parsed AND
    # --wpm was explicitly given (no band, or default wpm, stays advisory-only —
    # unchanged behavior for channels/runs that haven't declared a band).
    if target_band is not None and wpm_given:
        floor_s, ceiling_s, band_text = target_band
        estimate_s = round(vo_words / float(wpm) * 60)
        if estimate_s < floor_s or estimate_s > ceiling_s:
            floor_words = round(floor_s * wpm / 60.0)
            ceiling_words = round(ceiling_s * wpm / 60.0)
            if estimate_s < floor_s:
                need = floor_words - vo_words
                fix = f"add {need}w (need {floor_words:,}w+) for {format_mmss(floor_s)}"
            else:
                need = vo_words - ceiling_words
                fix = f"cut {need}w (need {ceiling_words:,}w or fewer) for {format_mmss(ceiling_s)}"
            # Kept short: the hard-violation print truncates each line's text at 100
            # chars, and estimate + band + fix-words must all survive that.
            hard.append((
                0,
                "runtime outside hard band",
                f"{format_mmss(estimate_s)} estimate outside hard {band_text} band "
                f"({vo_words:,}w @ {wpm}wpm); {fix}",
            ))

    print(f"== lint: {path} ==")
    if hard:
        print(f"\nHARD violations ({len(hard)}) — must fix before ship:")
        for lineno, kind, text in hard:
            snippet = text[:100] + ("…" if len(text) > 100 else "")
            print(f"  L{lineno}  [{kind}]  {snippet}")
    else:
        print("\nHARD violations: none (no dashes, no leftover traces).")

    if soft:
        print(f"\nAdvisories ({len(soft)}) — review, do not block:")
        for lineno, kind, text in soft:
            print(f"  L{lineno}  [{kind}]  {text[:100]}")

    total_s = round(vo_words / float(wpm) * 60)
    mm, ss = divmod(total_s, 60)
    print(
        f"\nVO word count: {vo_words}  ->  header should read: "
        f"Estimated runtime: {mm}:{ss:02d} ({vo_words:,} words ÷ {wpm} wpm)"
    )

    return 1 if hard else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    wpm = 150
    wpm_given = "--wpm" in args
    if wpm_given:
        i = args.index("--wpm")
        try:
            wpm = int(args[i + 1])
        except (IndexError, ValueError):
            print("usage: python lint_script.py <path-to-script.md> [--wpm N]")
            sys.exit(2)
        del args[i : i + 2]
    if len(args) != 1:
        print("usage: python lint_script.py <path-to-script.md> [--wpm N]")
        sys.exit(2)
    sys.exit(main(args[0], wpm, wpm_given))
