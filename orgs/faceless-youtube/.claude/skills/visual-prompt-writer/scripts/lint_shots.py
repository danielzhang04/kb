#!/usr/bin/env python3
"""Deterministic lint for a video's shots.json against its script.md.

WHY THIS EXISTS
---------------
`render-builder` times every cut by finding each shot's `vo_ref` in the real VO
word-stream (see render.py::retime_by_timings): it normalizes the FIRST 4 WORDS of
`vo_ref` — or all of them when the line is shorter, so a 3-word `[PAUSE]`-bounded
sentence is a legal anchor — and matches them SEQUENTIALLY (each shot at or after
the previous match).
Two authoring mistakes silently break that:

  1. A PARAPHRASED vo_ref (e.g. "he commissioned…" when the script says
     "MacGregor commissioned…") never matches -> that shot is placed by
     interpolation, not its true moment. Enough of them -> the whole video
     collapses to crude proportional timing.
  2. An OUT-OF-ORDER shot (a densify insert whose narration actually comes later,
     placed before an earlier line) -> the earlier line is now behind the cursor
     and won't match -> same failure.

This lint reproduces that matcher and HARD-fails on either, so a clean lint means
the render's per-line sync is safe.

WHAT IT ALSO DOES (--write)
---------------------------
On a clean pass, (re)generates ONE DERIVED, review-only field, preserving the
file's exact formatting:
  * `vo_text` on every shot = the verbatim script span it covers (from its anchor
    to the next shot's). This is COMPUTED, never authored, and is NOT a depiction
    brief — a shot's image is anchored to its moment, not asked to represent the
    whole span. A span that comes out long is a signal to DENSIFY (add a cut),
    per the cadence rule, not to cram meaning into one image.
It also STRIPS the retired `shot_counts` block from any v1 file it rewrites.

Usage:
  python lint_shots.py <path-to/shots.json> [--write]
Exit 0 = clean (safe to render); 1 = HARD violations (fix before handoff).
"""
import difflib
import json
import re
import sys
from pathlib import Path

# S3: import the ONE vo_ref matcher (and the manifest word-timing reader) render actually times
# against, from the sibling render-builder skill, so this lint validates the EXACT algorithm and
# the EXACT stream render uses — not a divergent copy.
_RENDER_SCRIPTS = Path(__file__).resolve().parent.parent.parent / "render-builder" / "scripts"
if str(_RENDER_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_RENDER_SCRIPTS))
from render import match_shots_to_tokens, word_timings_for  # noqa: E402

_BRACKET = re.compile(r"\[[^\]]*\]")            # [B-ROLL]/[PAUSE]/[BEAT] — never spoken
_ITALIC_META = re.compile(r"^\*[^*].*[^*]\*$")  # a WHOLE line in italics = a note about the video
_NORM = lambda w: re.sub(r"[^a-z0-9]+", "", w.lower())   # mirrors render.py::_NORM
LONG_SPAN_WORDS = 20                            # V1 D13: ~>8s of VO on one anchor -> densify heads-up
CADENCE_TARGET_S = 4.0                          # 2026-07-28 dial: the band is 1.5–3s, up to 4s earned

# The runtime a shot list is sized against comes from the SCRIPT HEADER's stated rate
# ("1,728 words ÷ 175 wpm" / "Estimated runtime: 9:52"), never a project constant: the
# 150 wpm this lint used to assume is ~17% slower than The Second Take's measured voice,
# so it bought 140 shots for an 11:38 video that runs 9:52. 150 remains the FALLBACK for a
# header that states no rate (mostly shorts, which carry no header).
DEFAULT_WPM = 150.0
_HEADER_WPM = re.compile(r"([\d,]+)\s*(?:gross\s+)?wpm", re.IGNORECASE)
_HEADER_RUNTIME = re.compile(r"Estimated runtime\D{0,4}\s*(\d+):([0-5]\d)", re.IGNORECASE)

# --- shots.json v2 ----------------------------------------------------------
# v2 drops the v1 AUTHORING/REVIEW metadata below. None of it was ever engine-read
# (build_motion.py defaults `beat`; render.py reads none of them), so a v1 file
# still parses, still lints, and still renders. The lint therefore SAYS SO and
# never fails on one: hard-failing a naming change would break every archived
# video for nothing. What the fields were and why they went: docs/retired-features.md.
SCHEMA_V1 = "faceless-youtube/shots@1"
SCHEMA_V2 = "faceless-youtube/shots@2"
LEGACY_FILE_FIELDS = ("house_style", "needed_assets", "shot_counts", "timing_status")
LEGACY_SHOT_FIELDS = ("from_cue", "beat", "narration_type", "hold_reason", "cast", "props")


def build_vo_stream(md_path):
    """Return (vo_text_string, tokens) for a script/short markdown.

    vo_text_string keeps inline [PAUSE]/[BEAT] markers (for readable spans); tokens
    is [(normalized_word, char_offset)] with bracketed markers EXCLUDED, so matching
    sees exactly the words the TTS stream will (render-builder matches that stream)."""
    lines = Path(md_path).read_text(encoding="utf-8").splitlines()
    body_start, body_end = None, len(lines)
    for i, ln in enumerate(lines):
        s = ln.strip()
        if body_start is None:
            if s == "---":
                body_start = i + 1
            continue
        if s.lower().startswith("## sources"):
            body_end = i
            break
    if body_start is None:
        body_start = 0
    # A line wholly wrapped in asterisks is an authoring NOTE about the video (the
    # disclosure tail: "*Disclosure line (spoken tail or end card, per channel YMYL
    # rule): …*"), not narration — counting it inflates the runtime and offers an
    # anchor no voice will speak. Emphasis INSIDE a spoken sentence is spoken, and
    # dropping it would shift every anchor after it, so only a solitary line goes.
    narr = [ln.strip() for ln in lines[body_start:body_end]
            if ln.strip() and not ln.strip().startswith("[B-ROLL")
            and not _ITALIC_META.match(ln.strip())]
    vo = " ".join(narr)
    spans = [(m.start(), m.end()) for m in _BRACKET.finditer(vo)]
    in_bracket = lambda p: any(a <= p < b for a, b in spans)
    # Tokenize on WHITESPACE (not word-chars) so hyphenated words stay one token —
    # render-builder builds its needle from `vo_ref.split()` then _NORM, so "five-star"
    # is one token `fivestar` on both sides. Splitting on the hyphen would false-positive.
    toks = []
    for m in re.finditer(r"\S+", vo):
        if in_bracket(m.start()):           # inline [PAUSE]/[BEAT] — not spoken
            continue
        n = _NORM(m.group())
        if n:
            toks.append((n, m.start()))
    return vo, toks


def header_pace(md_path):
    """Return (wpm | None, stated_runtime_s | None) from the script header — the block above
    the first `---`. A header states its rate as "N words ÷ M wpm" and its length as
    "Estimated runtime: M:SS"; either alone is enough to retire the 150 fallback. The RATE
    wins when both are present: the word count is measured off the real stream here, so
    rate × measured words beats a header total the script may have drifted from."""
    try:
        lines = Path(md_path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return None, None
    head = []
    for ln in lines:
        if ln.strip() == "---":
            break
        head.append(ln)
    head = "\n".join(head)
    m = _HEADER_WPM.search(head)
    wpm = float(m.group(1).replace(",", "")) if m and float(m.group(1).replace(",", "")) > 0 else None
    r = _HEADER_RUNTIME.search(head)
    runtime_s = int(r.group(1)) * 60 + int(r.group(2)) if r else None
    return wpm, runtime_s


def tile(shots, matches, vo_len, vo):
    """vo_text per shot = [its anchor, next anchor) — only valid when all matched."""
    starts = [m["start"] for m in matches]
    id2text = {}
    for k, sh in enumerate(shots):
        s = starts[k]
        e = starts[k + 1] if k + 1 < len(starts) else vo_len
        id2text[sh["id"]] = vo[s:e].strip()
    return id2text


def lint_piece(label, shots, md_path, hard, soft, word_timings=None):
    """Validate one piece against the REAL VO stream. S3: the HARD check runs against the
    voiceover.manifest word_timings when present (the exact stream + matcher render times
    against); script.md is a soft cross-check AND the source of the derived vo_text spans.
    Returns id2text (for --write) or None."""
    md_exists = Path(md_path).exists()
    vo, md_toks = (None, None)
    if md_exists:
        vo, md_toks = build_vo_stream(md_path)

    # Pick the HARD-check stream: the VO word-stream render matches, or script.md as a fallback
    # when no VO has been synthesized yet.
    if word_timings:
        vtoks = [(_NORM(w), k) for k, (w, _t) in enumerate(word_timings)]
        vtoks = [(w, k) for w, k in vtoks if w]
        hard_matches = match_shots_to_tokens(shots, vtoks)
        hard_stream = "the voiceover word-stream"
        vo_words = len(vtoks)
    elif md_toks:
        hard_matches = match_shots_to_tokens(shots, md_toks)
        hard_stream = "script.md"
        vo_words = len(md_toks)
    else:
        soft.append(f"[{label}] no VO stream (no manifest timings, no parseable {md_path}) — skipped.")
        return None

    for m in hard_matches:
        if not m["needle"]:
            hard.append(f"[{label}] {m['id']}: empty vo_ref.")
        elif m["start"] is None:
            hard.append(
                f"[{label}] {m['id']}: vo_ref not found in {hard_stream} at/after the previous "
                f"anchor (needle {' '.join(m['needle'])!r}) -> paraphrased OR out of narration order. "
                f"Copy the opening words VERBATIM and keep shots in narration order.")

    # Q3: cadence floor — durations must ~cover the runtime and there must be enough cuts
    # (the stretch-to-fill dead-hold kill-rule, made deterministic). The planning floor is
    # runtime/4 (the 1.5–3s band, 4s only where the beat earns it); authored long holds above
    # ~6s need a concrete reason for the critic to judge, not a generic exemption. The runtime
    # itself is sized off the header's REAL rate — see header_pace.
    if vo_words:
        wpm, stated_runtime_s = header_pace(md_path) if md_exists else (None, None)
        if wpm:
            runtime_s, rate = vo_words / wpm * 60.0, f"{vo_words} words / {wpm:.0f}wpm, per the header"
        elif stated_runtime_s:
            runtime_s, rate = float(stated_runtime_s), "the header's stated Estimated runtime"
        else:
            runtime_s = vo_words / DEFAULT_WPM * 60.0
            rate = f"{vo_words} words / {DEFAULT_WPM:.0f}wpm, the fallback — the header states no rate"
        sum_dur = sum(_dur(sh) or 0.0 for sh in shots)
        if sum_dur < 0.85 * runtime_s:
            hard.append(f"[{label}] Sum of duration_s {sum_dur:.0f}s < 85% of the ~{runtime_s:.0f}s "
                        f"runtime ({rate}) — durations don't cover the VO (stretch-to-fill "
                        f"risk); size shots near real seconds or densify.")
        if len(shots) < runtime_s / CADENCE_TARGET_S:
            hard.append(f"[{label}] {len(shots)} shots for a ~{runtime_s:.0f}s runtime ({rate}) "
                        f"(< 1 cut / {CADENCE_TARGET_S:.0f}s) — too few cuts; densify to the "
                        f"1.5–3s cadence.")

    if any(m["start"] is None for m in hard_matches):
        return None

    # Soft cross-check: when the HARD check ran on the VO stream, confirm script.md matches
    # verbatim too (a miss = drift between the written script and the synthesized VO).
    if word_timings and md_toks:
        for m in match_shots_to_tokens(shots, md_toks):
            if m["needle"] and m["start"] is None:
                soft.append(f"[{label}] {m['id']}: vo_ref matches the VO timings but NOT script.md "
                            f"verbatim — script/VO drift; derived vo_text spans may be approximate.")

    # vo_text tiling needs script.md char offsets.
    if not md_toks:
        return None
    md_matches = match_shots_to_tokens(shots, md_toks)
    if any(m["start"] is None for m in md_matches):
        return None
    if md_matches and md_matches[0]["start"] not in (0, None) and md_matches[0]["start"] > 40:
        soft.append(f"[{label}] first shot's anchor isn't at the script start "
                    f"(offset {md_matches[0]['start']}) — opening narration may be uncovered.")
    id2text = tile(shots, md_matches, len(vo), vo)
    for sh in shots:
        wc = len(id2text[sh["id"]].split())
        if wc > LONG_SPAN_WORDS:
            soft.append(f"[{label}] {sh['id']}: covers ~{wc} words on one anchor "
                        f"(>~8s VO) — ensure a progressive within-shot reveal, or densify (add a cut).")
    return id2text


def strip_derived(txt):
    # V1 D12: match at any indent (^\s*), not a hardcoded 2 spaces, so a reflowed file still cleans.
    txt = re.sub(r'(?m)^[ \t]*"vo_text": .*\n', "", txt)
    # v2 retired shot_counts. Still stripped, never re-emitted, so rewriting a v1
    # file cleans the stale block out instead of leaving a count that drifts.
    txt = re.sub(r'(?ms)^\s*"shot_counts": \{.*?\n\s*\},\n', "", txt)
    return txt


def write_back(path, data, ordered_shots, id2text):
    """Insert the derived vo_text after each vo_ref line, preserving the file's format."""
    txt = strip_derived(Path(path).read_text(encoding="utf-8"))
    vo_ref_re = re.compile(r'^(\s*)"vo_ref":')
    out, idx = [], 0
    for line in txt.splitlines(keepends=True):
        out.append(line)
        m = vo_ref_re.match(line)
        if m:
            sid = ordered_shots[idx]["id"]
            if sid in id2text:
                ind = m.group(1)
                nl = "\n" if line.endswith("\n") else ""
                out.append(f'{ind}"vo_text": {json.dumps(id2text[sid], ensure_ascii=False)},{nl}')
            idx += 1
    if idx != len(ordered_shots):
        raise SystemExit(f"internal: vo_ref line count {idx} != shot count {len(ordered_shots)}")
    newtxt = "".join(out)
    json.loads(newtxt)   # validate
    Path(path).write_text(newtxt, encoding="utf-8")


def _dur(sh):
    try:
        return float(sh.get("duration_s"))
    except (TypeError, ValueError):
        return None


def stage_check(label, shots, hard, soft, require_stage=False):
    """Held-stage field checks. Q4: the structural caps of the delta-chain contract — exactly
    one base FIRST and at most 3 deltas — are HARD (they bound drift; lint owns the mechanical
    caps). Timing/changed_elements/contiguity remain SOFT heads-ups. Never touches the vo_ref
    matcher — stage fields are optional metadata layered on top of the anchor contract. Strict v2
    long-form plans at the configured size get only a zero-stage guard, never a stage quota."""
    runs = []  # contiguous runs of (stage_id, [shots])
    has_stage_bearing_shot = False
    for sh in shots:
        sid = sh.get("stage")
        has_stage_bearing_shot |= bool(sid) or sh.get("stage_role") == "base"
        if runs and sid and runs[-1][0] == sid:
            runs[-1][1].append(sh)
        else:
            runs.append((sid, [sh]))
    if require_stage and not has_stage_bearing_shot:
        hard.append(f"[{label}] strict v2 long-form plan has {len(shots)} shots but zero "
                    "stage-bearing shots/base roles — add a planned stage chain where a setting "
                    "revisits; this is a zero guard, not a stage quota.")
    seen = {}
    for sid, grp in runs:
        if not sid:
            continue
        seen[sid] = seen.get(sid, 0) + 1
        deltas = len(grp) - 1
        if deltas > 3:
            hard.append(f"[{label}] stage '{sid}': {deltas} delta frames (>3) — cap the chain at 3, then re-base or hard-cut.")
        roles = [s.get("stage_role") for s in grp]
        if roles[0] not in (None, "base"):
            hard.append(f"[{label}] stage '{sid}': first frame role '{roles[0]}', expected 'base' — a chain is ONE base first.")
        if any(r == "base" for r in roles[1:]):
            hard.append(f"[{label}] stage '{sid}': a non-first frame is 'base' — a chain is ONE base then deltas.")
        base_dur = _dur(grp[0])
        for s in grp[1:]:
            d = _dur(s)
            if d and (d > 3.5 or (base_dur and d > base_dur)):
                soft.append(f"[{label}] {s.get('id','?')} (stage '{sid}' delta): {d}s — deltas should be fast (~1.5-3s) and not longer than the base.")
            if not s.get("changed_elements"):
                soft.append(f"[{label}] {s.get('id','?')} (stage '{sid}' delta): no changed_elements — a delta must name what changed.")
    for sid, c in seen.items():
        if c > 1:
            soft.append(f"[{label}] stage '{sid}' appears in {c} non-contiguous runs — a stage should be one consecutive run.")


# v2 SCHEMA + LEGACY-FIELD CHECKS — heads-ups, never violations.
#
# There is no casting check here any more. It compared a registry character named
# in a `still_prompt` against that shot's `cast` array; v2 has no `cast` array —
# naming figures by registry VOCABULARY inline in the prose IS the contract now,
# and resolving those names to files is image-generation's Pass 1. Whether every
# named figure resolves is the post-VPW critic's question (references/critics.md),
# not a deterministic one this lint can answer.
def schema_check(data, soft):
    schema = data.get("schema")
    if schema == SCHEMA_V2:
        return
    if schema == SCHEMA_V1:
        soft.append(f"[file] schema is {SCHEMA_V1!r} — a LEGACY v1 file. It lints and renders "
                    f"exactly as before (no engine-read field changed); author new files as "
                    f"{SCHEMA_V2!r}.")
    else:
        soft.append(f"[file] schema {schema!r} is not {SCHEMA_V2!r} — set it, so downstream can "
                    f"tell a v2 file from a v1 one.")


def legacy_field_check(data, soft):
    """One heads-up listing every dropped v1 field still present. NEVER a violation."""
    found = {}
    for f in LEGACY_FILE_FIELDS:
        if f in data:
            found[f] = found.get(f, 0) + 1
    pieces = [data.get("long_form", {}).get("shots", []) or []]
    pieces += [s.get("shots", []) or [] for s in (data.get("shorts", []) or [])]
    for shots in pieces:
        for sh in shots:
            for f in LEGACY_SHOT_FIELDS:
                if f in sh:
                    found[f] = found.get(f, 0) + 1
    if found:
        listed = ", ".join(f"{f} (x{n})" for f, n in sorted(found.items()))
        soft.append(f"[file] dropped v1 fields still present, ignored by every consumer: {listed}. "
                    f"shots.json v2 removed them (docs/retired-features.md); casting is now inline "
                    f"registry-vocabulary names in `still_prompt`, resolved by image-generation "
                    f"Pass 1. Harmless to leave in an existing file; don't author them into a new one.")


# ---------------------------------------------------------------------------
# TEXT-SUPPLY CHECK — the Class-A guard.
#
# THE DEFECT IT EXISTS FOR
# ------------------------
# A prompt that INSTRUCTS the engine to render text — a number, a name, a date,
# a label, a caption — without SUPPLYING that text's literal value leaves the
# diffusion model to invent it. It always does. On the Wells Fargo documentary
# (a real, named, living person and a documented SEC case) this produced, among
# ~20 fabricated on-screen facts, an invented criminal charge rendered against a
# real person. The authoring bug is one line long and looks harmless:
#
#     "a large marker scorecard number painted on its face"   <- no number given
#     "one prominent number"                                  <- no number given
#
# The engine rendered `1` and `3.5`. Nothing downstream could have caught it:
# by the time a value exists it is pixels, and the frame looks intentional.
#
# THE RULE (SKILL "supplied-text law")
# ------------------------------------
# A prompt may never instruct the engine to render text, a figure, a name or a
# date without supplying that value VERBATIM, inline. If the value cannot be
# sourced from the fact ledger, the element is OMITTED — not gestured at.
#
# HOW THIS IS DECIDED
# -------------------
# Per prompt: strip the house-style `global_prompt_suffix` (it legitimately
# talks about lettering in the abstract — it is style, not scene content), split
# what remains into clauses, and for each clause ask:
#   * does it REQUEST rendered text?  (a text noun, or a text verb like "reading")
#   * does it SUPPLY one?             (a quoted literal, or a digit run, or an
#                                      ALL-CAPS token — the three forms this
#                                      project's TEXT law authors text in)
#   * is it an ABSENCE instruction?   ("NO stamp on it", "face otherwise clear")
# Request AND no supply AND not an absence  ->  HARD violation.
# A clause is the binding scope on purpose: a literal supplied for the *header*
# does not license an unsupplied *number* later in the same sentence.
# ---------------------------------------------------------------------------

# Nouns whose CONTENT is the payload. Deliberately conservative — this list is
# tuned against a real 119-shot file and every entry earned its place:
#   * "figure" is EXCLUDED: in this channel it overwhelmingly means a PERSON
#     ("small executive figures"), and every real money sense ("a fine figure
#     '$17.5M'") already carries its literal, so including it is all noise.
#   * "amount"/"total"/"sum"/"metric" are EXCLUDED: they read as quantities in
#     prose without ever being rendered AS text.
# Widen this list only with a real counter-example in hand.
_TEXT_NOUN = (r"numbers?|numerals?|percentages?|dates?|names?|labels?|tags?"
              r"|captions?|headers?|headings?|headlines?|titles?|signs?"
              r"|placards?|plaques?|banners?|stamps?|inscriptions?|slogans?|prices?"
              # calculation/equation/formula: added after this guard was found to
              # MISS shots-schema.md's own worked example, "a single load-bearing
              # calculation carved into a monolithic stone tablet" — the exemplar
              # that taught the defect in the first place. A guard that cannot
              # catch its own documentation's bad example guards nothing.
              r"|calculations?|equations?|formulae|formulas?")

# --- The two grammars the defect actually appears in --------------------------
# It is NOT enough for a prompt to merely MENTION a text-bearing object. "one red
# accent on the placard's underline" is a colour instruction about an element
# described elsewhere; flagging those made this check fire on 58% of shots, which
# is how a lint gets ignored. The defect has a shape, and it is one of two:
#
# (1) SLOT — a counted or emphasised text object with no content supplied:
#       "one prominent number" · "a large marker scorecard number" ·
#       "Three marker numerals" · "a giant scorecard number"
#     A COUNT or PROMINENCE word within a few words of the noun is the tell: the
#     author is staging the value as the focal point of the frame while never
#     saying what it is. A bare mention ("the culprit is a number", "banners")
#     carries no such staging and is left alone.
_PROMINENCE = (r"prominent|large|big|giant|huge|oversized|bold|dominant|single"
               r"|lone|one|two|three|four|five|six|seven|eight|nine|ten"
               r"|several|multiple")
_SLOT = re.compile(
    r"\b(?:" + _PROMINENCE + r")\b(?:\s+[\w#'-]+){0,3}?\s+\b(?:" + _TEXT_NOUN + r")\b",
    re.IGNORECASE)

# …but only when the text noun is the HEAD of that phrase. Used ATTRIBUTIVELY it is a
# modifier and nothing is lettered: in "one red price rail" the count and the colour
# belong to the RAIL, `price` only says what the rail is for (bricks L84, a HARD false
# positive that cost an author a rewrite). The tell is the word AFTER the noun. In every
# real defect the phrase has ENDED there — punctuation ("one prominent number."), a
# participle ("number PAINTED", "number FLOATING"), a comparative ("number HIGHER") or a
# preposition ("numerals IN a row"). A bare following noun means the phrase continues.
_PHRASE_END = re.compile(
    r"\s*(?:[^\w\s]|$)"                              # punctuation, or end of the body
    r"|\s+\w+(?:ing|ed|er|est|ly)\b"                 # participle / comparative / adverb
    r"|\s+(?:in|on|at|of|to|for|from|over|under|above|below|beside|behind|with|without"
    r"|across|against|into|onto|through|along|is|are|was|were|that|which|who|and|or|but"
    r"|while|as|its|their|his|her)\b",
    re.IGNORECASE)

# (2) RENDER VERB — an explicit instruction to put glyphs on a surface:
#       "…number PAINTED on its face" · "a customer's name MARKER-WRITTEN across
#       the top" · "a stamp READING …" · "a bank MARKED WITH the tag"
_INK = (r"painted|written|printed|lettered|emblazoned|inscribed|engraved|spelled"
        r"|stencill?ed|carved|etched|chisell?ed|embossed|scrawled|daubed")
_RENDER_VERB = re.compile(
    r"\b(?:" + _TEXT_NOUN + r")\b[^,;:.]{0,30}?\b(?:" + _INK + r")\b"
    r"|\b(?:" + _INK + r")\b[^,;:.]{0,30}?\b(?:" + _TEXT_NOUN + r")\b"
    r"|\bmarked\s+(?:with|by)\b[^,;:.]{0,30}?\b(?:" + _TEXT_NOUN + r")\b"
    # (?<!-) : these are only text verbs as bare words. "headed" is dropped
    # entirely and the hyphen guard kept, because the rig vocabulary is full of
    # compounds that end in one — "bare-headed" investors flagged L10, whose
    # placard "reading 'CROSS-SELLING'" was correctly authored all along.
    # (?!\s+glasses) : "half-moon READING GLASSES" is an object on a face, not an
    # instruction to letter anything (bricks L148, a HARD false positive).
    r"|(?<!-)\b(?:reading(?!\s+glasses\b)|labell?ed|captioned|titled|that\s+says|which\s+reads)\b",
    re.IGNORECASE)

# "reads as" / "read as" / "reading as" is this project's idiom for LEGIBILITY ("he reads
# as the confident architect", "the opening reading as a hole"), never for rendered
# lettering. The participle form earned its place on bricks L07, a HARD false positive.
_READS_AS = re.compile(r"\bread(?:s|ing)?\s+as\b", re.IGNORECASE)

# How this project's TEXT law supplies a value: QUOTED VERBATIM ("a stamp reading
# 'ADMITTED'", "a marker header 'JUSTICE DEPT'") or as DIGITS ("a marker span
# '2002-2016'", "$17.5M"). Nothing else counts.
#
# ALL-CAPS is deliberately NOT a supply signal even though real stamp faces are
# upper-case: these prompts use caps for EMPHASIS constantly ("rolls DOWNHILL",
# "NO boulder present", "painted LARGE"). Accepting caps as a value let the
# headline defect through — L31's "boulder marked with the scorecard number rolls
# DOWNHILL" scored as supplied because of the word DOWNHILL. Every genuinely
# supplied caps string in this repo is quoted anyway, so the quote is the signal.
# The opening quote must NOT follow a letter, or a POSSESSIVE apostrophe opens a
# phantom literal: "a customer's name marker-written across the top and a small
# 'NEW ACCOUNT' tab" parsed "'s name ... and a small '" as one quoted value and
# scored the unsupplied customer name as supplied. That is the exact frame whose
# invented name rendered as the garbled "YOU NAME".
_QUOTED = re.compile("(?<![A-Za-z])['\"‘“][^'\"‘’“”]{1,60}"
                     "['\"’”]")
_DIGITS = re.compile(r"\d")

# How far from the offending construct a value still counts as "supplied inline".
# How far AFTER the offending construct a value still counts as "supplied inline".
# 60 chars, tuned on the real 119-shot file: wide enough that "Three marker
# numerals in a row on a slate field - a crossed-out '7', a big glowing '8'"
# reads as supplied, while the coordinator rule above still rejects a neighbour's
# value. Distance alone was not enough; both rules are load-bearing.
_SUPPLY_WINDOW = 60

# An instruction to keep the surface EMPTY is the opposite of the defect — an
# unlettered surface is an authored choice ("a single BLANK name line", "NO stamp
# on it", "the face otherwise clear"), not an invitation to invent.
_ABSENCE = re.compile(
    r"\b(no|without|absent|omit|omitted|free of|clear of|devoid of|never|not"
    r"|blank|empty|unmarked|unlettered|wordless|textless|illegible)\b",
    re.IGNORECASE)


def strip_suffix(prompt, suffix):
    """Drop the house-style suffix — it is style boilerplate on EVERY prompt and
    talks about lettering generically ('any in-world lettering hand-lettered in
    the marker style'). Scanning it would flag all 119 shots identically and the
    check would be pure noise. Falls back to a prefix match so a hand-trimmed
    suffix still strips."""
    p = prompt or ""
    s = (suffix or "").strip()
    if not s:
        return p
    if s in p:
        return p.replace(s, " ")
    head = s[:60]
    i = p.find(head)
    return p[:i] if i != -1 else p


# A quoted span introduced by "as" is a SIMILE, not a value: L105's "presenting
# the big cross-sell scorecard number to investors as 'proof the bank was the
# best'" quotes a characterisation while the number itself stays unsupplied.
# Without this the nearby quote would clear a genuine fabrication.
_AS_SIMILE = re.compile(r"\bas\s*$", re.IGNORECASE)


# A coordinator between a request and a nearby value means the value belongs to a
# DIFFERENT element. This is what separates "supplied, just phrased at a distance"
# from "a neighbour's value borrowed to look supplied":
#   L23  "Three marker numerals in a row on a slate field - a crossed-out '7', a
#         big glowing '8'"            -> no coordinator; the numerals ARE supplied.
#   L34  "a customer's name marker-written across the top AND a small 'NEW
#         ACCOUNT' tab"               -> 'NEW ACCOUNT' is the TAB's text; the
#                                        customer's name is never supplied, and
#                                        the engine duly invented one.
# Distance alone cannot tell these apart — they sit ~40 chars apart either way.
_COORD = re.compile(r"\band\b|\bwith\b|\bbeside\b|\bnext to\b|\babove\b|\bbelow\b",
                    re.IGNORECASE)


def _value_spans(body):
    """(start, end) of every span that SUPPLIES a renderable value."""
    spans = [(m.start(), m.end()) for m in _QUOTED.finditer(body)
             if not _AS_SIMILE.search(body[max(0, m.start() - 6):m.start()])]
    spans += [(m.start(), m.end()) for m in _DIGITS.finditer(body)]
    return sorted(spans)


def _supplies_literal(body, spans, start, end, hi):
    """True if a value span serves the construct occupying [start, end).

    A span overlapping the construct always counts ("the numeral '8'"). A span
    AFTER it counts only within the window AND with no coordinator in between."""
    for s, e in spans:
        if s >= hi or e <= start:
            continue
        if s < end:                                # inside/overlapping the construct
            return True
        if not _COORD.search(body[end:s]):
            return True
    return False


def unsupplied_text_requests(prompt, suffix=""):
    """Return a list of offending clause excerpts (empty = clean)."""
    body = _READS_AS.sub("  ", strip_suffix(prompt, suffix))  # sub keeps offsets valid
    hits = []
    # Scanned over the whole body, NOT clause by clause. Clause-splitting was tried
    # and cut: this project's own supplying idiom is "<request>: '<VALUE>'" and
    # "<caption> reading '<VALUE>'", so splitting on ':' — or on the '.' inside a
    # quoted literal like 'A RHYME.' — severed six correctly-authored prompts from
    # the values they DID supply. The _SLOT/_RENDER_VERB patterns already refuse to
    # span punctuation, so they stay inside a clause on their own.
    spans = _value_spans(body)
    for rx in (_SLOT, _RENDER_VERB):
        for m in rx.finditer(body):
            # The SLOT grammar only fires on a text noun that HEADS its phrase; an
            # attributive one ("one red price rail") stages no value at all.
            if rx is _SLOT and not _PHRASE_END.match(body, m.end()):
                continue
            # The value must sit NEXT TO the construct that demands it, and the
            # lookbehind is deliberately TIGHT while the lookahead is generous,
            # because a supplied value follows its request ("a header 'OCC'") and
            # a PRECEDING quote usually belongs to a DIFFERENT element. L16's "a
            # hand-lettered 'PRODUCTS PER HOUSEHOLD' label over one prominent
            # number" supplies the LABEL and nothing for the NUMBER — a backward
            # window wide enough to reach that quote would clear the real defect.
            hi = min(len(body), m.end() + _SUPPLY_WINDOW)
            if _supplies_literal(body, spans, m.start(), m.end(), hi):
                continue
            # Tight on purpose: a negation that means "leave this surface empty"
            # sits ON the element ("a single BLANK name line", "NO stamp on it").
            # Searching the whole supply window instead let L34's unsupplied
            # customer name pass, cleared by an unrelated "opened WITHOUT the
            # customer" 40 characters downstream.
            if _ABSENCE.search(body[max(0, m.start() - 15):min(len(body), m.end() + 15)]):
                continue
            excerpt = m.group().strip()
            if excerpt not in hits:
                hits.append(excerpt)
    return hits


def text_supply_check(label, prompts, suffix, hard):
    """HARD. `prompts` is an iterable of (id, field, prompt-string)."""
    for pid, field, prompt in prompts:
        for excerpt in unsupplied_text_requests(prompt, suffix):
            hard.append(
                f"[{label}] {pid}.{field}: asks the engine to render text without supplying its "
                f"value -> {excerpt!r}. The engine WILL invent one (this is how an invented "
                f"criminal charge reached a real person's frame). Quote the literal value inline, "
                f"right next to the element, sourced from research.md's fact ledger — or, if no "
                f"such fact exists, cut the element rather than gesture at it.")


# ---------------------------------------------------------------------------
# LETTERING-FIDELITY CHECKS — the Class-B guards.
#
# WHY THESE EXIST, AND WHY THEY LIVE NEXT TO THE CLASS-A GUARD ABOVE
# ------------------------------------------------------------------
# fc03482 fixed Class A (a prompt names a text element and never supplies its
# value) and recorded Class B — the garbled renders CHECKIG, 1,44.27, YOU NAME —
# as "a rendering fault, not an authoring one". A measured comparison of the
# Wells Fargo shot list against the Poyais reference implementation shows that
# conclusion is WRONG for at least two of the three, and the mechanism is
# authorial and mechanically detectable. Hence these checks.
#
# The evidence, from the two files themselves:
#
#   L11  "a checking-account passbook on a small marker card labelled 'CHECKING'"
#   L13  "a coin savings-jar added on a small marker card labelled 'SAVINGS'"
#   L14  "a login-screen icon added on a marker card labelled 'ONLINE'"
#        -> all three rendered their lettering CORRECTLY.
#   L12  "a credit-card icon added on a small marker card labelled 'CARD'
#         beside THE CHECKING PASSBOOK"
#        -> rendered `CHECKIG`.
#
# L12 is the only frame in that chain that referred to a carried-forward literal
# by lowercase DESCRIPTION instead of re-quoting it. The engine re-draws every
# glyph in a delta frame; a value it must re-draw from a paraphrase is a value it
# is guessing at. Same family as Class A, one step removed — the value exists,
# the prompt just stopped supplying it on the frame that had to redraw it.
#
# `YOU NAME` (L45) is the same defect wearing Class-B clothes: the prompt asked
# for "a scribbled forged signature" and supplied no name, so the engine reached
# for the form-placeholder `YOUR NAME` and dropped a letter. The Class-A guard
# above already catches that one; it is noted here because it is why Class B is
# not a separate phenomenon.
# ---------------------------------------------------------------------------

# (1) PROMPT-CONTROL VOCABULARY LEAKING INTO THE ARTWORK.
# The engine cannot always tell an instruction from a label. Three frames
# rendered the prompt's own control language as diegetic lettering:
#     L100  "hold ONLY the rig form."          -> a document lettered `rig form`
#     L69   "Grim but not gory; comedy off."   -> a register labelled `COMEDY OFF`
# What these two share, and what "figures on the CROWD RIG" (which never leaked)
# does not, is that they are BARE NOUN PHRASES naming an abstraction of the
# production process — they parse as a thing that could be written on something.
# This is a tight denylist of phrases with a confirmed leak, not a general
# heuristic: widen it only with a rendered counter-example in hand, exactly as
# _TEXT_NOUN above is scoped. A general "abstract noun phrase" detector was not
# attempted; it would fire on most of the file, and a lint that fires everywhere
# is a lint that gets ignored.
_CONTROL_LEAK = re.compile(
    r"\b(?:rig\s+form|comedy\s+off|humou?r\s+off|gravity\s+register"
    r"|palette\s+turn|register\s+off|style\s+token|shot\s+class)\b",
    re.IGNORECASE)

# (2) A CARRIED-FORWARD LITERAL RE-STATED AS A DESCRIPTION.
# Only alphabetic literals of >=4 chars are tracked: a 1-3 char or pure-digit
# literal ('8', 'OCC') collides with ordinary prose constantly and carries no
# signal. The literal must be re-quoted on EVERY frame that redraws it.
_TRACKABLE_LITERAL = re.compile(r"^[A-Za-z][A-Za-z '&/-]{3,}$")

# (3) THE LETTERING BUDGET — three ceilings on how much text one prompt asks for.
# shots-schema §4 already states the principle ("Author fewer strings — the
# highest-leverage lever there is; a string you do not author cannot garble"), and
# numeral_form_check's measurement is where it comes from: controlling for supply,
# the per-literal garble RATE is indistinguishable between the two videos (~6% vs
# ~7%), so what drives a file's absolute defect count is VOLUME. These three caps
# make that mechanical.
LETTERING_CHAR_CAP = 25          # glyphs in ONE literal (vendor-documented ceiling)
LETTERING_COUNT_CAP = 3          # distinct literals in ONE prompt (the 3-phrase ceiling)
LONG_LITERAL_WORD = 9            # chars in one lettered WORD before it draws a heads-up


def quoted_literals(prompt, suffix=""):
    """Every value this prompt SUPPLIES as a quoted literal, in order.

    Reuses the Class-A guard's own notion of a supplied value (_QUOTED) and its
    simile exclusion, so the two checks cannot disagree about what counts as an
    authored string. Returns [(literal, start, end)] over the suffix-stripped body."""
    body = strip_suffix(prompt or "", suffix)
    out = []
    for m in _QUOTED.finditer(body):
        if _AS_SIMILE.search(body[max(0, m.start() - 6):m.start()]):
            continue          # "presenting it as 'proof the bank was the best'" — not lettering
        out.append((m.group()[1:-1], m.start(), m.end()))
    return out


def word_cap_check(label, prompts, suffix, hard, cap=4, char_cap=LETTERING_CHAR_CAP):
    """HARD. SKILL rule 9 caps authored in-image lettering at 1-4 words ("1-4 words
    proven"), and the measurement backs it: across 250 authored literals in the two
    videos, the single string that exceeds the cap — Poyais L97's 7-word 'Official
    Shoemaker to the Princess of Poyais' — is also a documented lettering defect
    (logged in that video's manifest under the serif-register drift cluster). Long
    strings are where the engine's per-glyph error rate compounds into an unreadable
    render. The cap was previously prose-only; it is now enforced.

    TWO caps, because the engine redraws GLYPHS and the word count can hide them.
    `TRANS CONTINENTAL AIRLINES` (_pearlman-test-act1 L04/L14/L19/L22) is THREE
    words — legal under the word cap — and 26 characters, longer than Poyais L97's
    first four words put together. The word cap alone waves it through four times.
    The char cap is the vendor-documented ~25-glyph lettering ceiling and it catches
    exactly this shape: few words, many glyphs.
    What the char cap deliberately does NOT flag: anything at or under 25 chars, so
    every literal in the bricks segment (longest: '125 MILLION', 11) and every
    correctly-rendered Wells Fargo string ('PRODUCTS PER HOUSEHOLD', 22) stays
    silent. It is a second, independent ceiling on the same rule — not a tightening
    of the word cap, which stays at 4."""
    for pid, field, prompt in prompts:
        for lit, _s, _e in quoted_literals(prompt, suffix):
            n = len(lit.split())
            if n > cap:
                hard.append(
                    f"[{label}] {pid}.{field}: authored lettering {lit!r} is {n} words (cap {cap}). "
                    f"In-image lettering is redrawn glyph by glyph; past ~4 words the render garbles. "
                    f"Shorten it to the load-bearing words, or carry the meaning in the composition "
                    f"instead of in text.")
            elif len(lit) > char_cap:
                hard.append(
                    f"[{label}] {pid}.{field}: authored lettering {lit!r} is {len(lit)} characters "
                    f"(cap {char_cap}) - under the {cap}-word cap but over the glyph ceiling. The "
                    f"engine's error rate compounds per GLYPH, not per word, so a short-word string "
                    f"this long garbles like a long one. Shorten it, split the meaning across the "
                    f"composition, or drop the least load-bearing word.")


def literal_count_check(label, prompts, suffix, hard, cap=LETTERING_COUNT_CAP):
    """HARD. One prompt may author at most 3 DISTINCT quoted literals.

    Rare by construction, which is why it can be hard: across the two complete
    videos (~230 shots) exactly four prompts exceed it — Poyais L47 (four city
    plaques: 'POYAIS OFFICE'/'LONDON'/'EDINBURGH'/'PARIS'), Poyais L94, Wells Fargo
    L111 (a sentencing card carrying '3 YRS PROBATION', '6 MO HOME', '$100K FINE',
    '120 HRS SERVICE') and Wells Fargo S02-03 (the four product cards of the CHECKIG
    chain, collapsed into ONE short frame). Every one of them is a frame asking the
    engine to letter a whole document, which is where per-glyph error compounds into
    a visibly wrong image, and L111's four-item card is exactly the saturation
    shots-schema §4 warns about. The fix is always available: stage the list across
    the delta chain that the long-form already uses (L11-L14 authored the same four
    product labels one per frame and three of the four rendered clean).

    DISTINCT, not occurrences — load-bearing. L-1 (carried_literal_check) REQUIRES a
    delta frame to re-quote every literal it redraws, so Wells Fargo L36's two
    mentions of '125 MILLION' and '600 MILLION' are four quotes of two strings.
    Counting occurrences would punish the file for obeying the rule above it."""
    for pid, field, prompt in prompts:
        lits = []
        for lit, _s, _e in quoted_literals(prompt, suffix):
            if lit not in lits:
                lits.append(lit)
        if len(lits) > cap:
            hard.append(
                f"[{label}] {pid}.{field}: authors {len(lits)} distinct literals (cap {cap}) -> "
                f"{lits!r}. A frame lettering a whole document compounds per-glyph error until "
                f"something in it is visibly wrong. Stage them across a delta chain (one literal "
                f"per frame, the way L11-L14 did), or carry the list in the composition and letter "
                f"only the load-bearing value.")


def script_vocab(md_path):
    """Every word the SCRIPT itself uses, lowercased — the video's own vocabulary.

    Used by long_literal_word_check to tell a word the author CHOSE for the image
    from one the video is simply about. Whole file, not just the narration span: a
    proper noun in the header or the source list is still the video's vocabulary."""
    try:
        txt = Path(md_path).read_text(encoding="utf-8")
    except OSError:
        return set()
    return {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'-]*", txt)}


def long_literal_word_check(label, prompts, suffix, soft, vocab=(), floor=LONG_LITERAL_WORD):
    """Heads-up, NOT hard — and it fires only where the author had a CHOICE.

    A long word is more glyphs to get right, but length alone is a weak signal and a
    guard built on it alone is a firehose: >=9 chars raw hits 16 distinct words in
    Wells Fargo and 8 in Poyais, and a lint that fires 24 times across two files is
    a lint that gets ignored.

    The discriminator is the SCRIPT. A long word the narration already says is the
    video's own vocabulary — 'MINISCRIBE' (the bricks segment's subject, 6 frames),
    'MacGregor', 'CROSS-SELLING' — and there is no shorter synonym for a proper
    noun, so the advice "pick a shorter word" is unactionable noise on it. A long
    word the author invented FOR the image is a real choice, and the exemption
    strips the population down to those: 8 -> 0 on Poyais, 1 -> 0 on the bricks
    segment, 16 -> 3 on Wells Fargo. Those three survivors are the case the guard
    exists for — 'TERMINATED' (L69) and 'REINSTATED' (L72) are author-chosen stamp
    faces on a video that elsewhere authored 'FIRED' for the same concept, five
    glyphs instead of ten, and that one rendered clean.

    What it deliberately does NOT flag: any word under 9 chars, so 'CHECKING' (8) is
    silent here BY DESIGN even though CHECKIG is the file's headline garble. That
    defect was a non-re-quoted carried literal (L-1) and carried_literal_check owns
    it; pulling the floor down to catch it would flag most of both files. This guard
    is a risk heads-up about glyph count, not a defect detector.

    NO SCRIPT, NO CHECK. The whole guard is the script comparison, so an empty
    vocabulary (a file whose script.md is missing or unreadable) is not a licence to
    flag every long word — it is the absence of the discriminator, and firing then
    would report the loudest on exactly the file we know the least about. lint_piece
    already says so out loud for the VO stream; this stays silent the same way."""
    vocab = set(vocab or ())
    if not vocab:
        return
    for pid, field, prompt in prompts:
        seen = set()
        for lit, _s, _e in quoted_literals(prompt, suffix):
            for w in re.findall(r"[A-Za-z][A-Za-z'-]*", lit):
                key = w.lower()
                if len(w) < floor or key in vocab or key in seen:
                    continue
                seen.add(key)
                soft.append(
                    f"[{label}] {pid}.{field}: lettered word {w!r} ({len(w)} chars) in {lit!r} is "
                    f"long and the script never uses it, so it is a wording CHOICE. Every glyph is "
                    f"redrawn and the error rate compounds across them - prefer a shorter, more "
                    f"common word where the beat allows it ('FIRED' over 'TERMINATED').")


# --- EXCLUSIONS: a negation LIST is the wrong way to author an absence -------
# The engine has no reliable negation operator; an absence lands only when it is
# authored as a POSITIVE property of the surface. The bricks segment gets this
# right almost everywhere — "Every surface in the room is completely blank and
# unlettered" (L01), "left COMPLETELY BLANK" (L16/L20) — and wrong in exactly the
# shape this guard names: L07's "The glass carries no signs and no words." That is
# the tuning counter-example. L09's "No prices, no words and no labels anywhere on
# the boxes" and L26's "no borders drawn and no place names" are the same defect.
#
# WHAT IT DELIBERATELY DOES NOT FLAG
# ----------------------------------
#  * a SINGLE absence. "The building carries no signage on this side" (L42), "No
#    lettering on any machine" (L15), "no shadows" (L43) all read cleanly and land;
#    one negation is a statement, a pile of them is a wish list. Five such
#    sentences in the segment stay silent.
#  * RIG ANATOMY. shots-schema L-2 explicitly blesses "round heads, dot eyes, NO
#    noses, NO ears" as the LEGAL form — it states properties of a depicted body,
#    which is the positive-state rule already satisfied, just spelled with `no`.
#    The style-bible §2c/§2d clauses are built out of it, so flagging it would
#    fire on every character-bearing prompt in the project. Anatomy-only sentences
#    are exempt; a sentence mixing anatomy with surface nouns still reports.
_NEG_NOUN = re.compile(r"\b(?:no|without)\s+((?:[a-z]+-)?[a-z]+)\b", re.IGNORECASE)
# `no` as an intensifier or comparative, never an absence: "no longer lit", "no
# more than three", "no other figure". Without this the phrase "no longer" pairs
# with any real negation in the same sentence and invents a list of two.
_NEG_STOP = frozenset(
    "longer more other less better worse further fewer sooner else matter way "
    "doubt bigger smaller taller wider".split())
_ANATOMY = frozenset(
    "nose noses nostril nostrils ear ears tooth teeth eyebrow eyebrows lash lashes "
    "eyelash eyelashes pupil pupils iris irises finger fingers thumb thumbs toe toes "
    "lip lips tongue chin chins neck necks wrinkle wrinkles freckle freckles "
    "detail details face faces".split())
_SENTENCE = re.compile(r"(?<=[.;])\s+")


def negation_list_check(label, prompts, suffix, soft):
    """Heads-up. Two or more `no <noun>` clauses in ONE sentence -> author the
    absence as a positive property of the surface instead."""
    for pid, field, prompt in prompts:
        body = strip_suffix(prompt or "", suffix)
        reported = set()
        for sent in _SENTENCE.split(body):
            nouns = []
            for m in _NEG_NOUN.finditer(sent):
                n = m.group(1).lower()
                if n in _NEG_STOP or n.endswith("ly") or n in nouns:
                    continue
                nouns.append(n)
            if len(nouns) < 2 or all(n in _ANATOMY for n in nouns):
                continue
            key = tuple(nouns)
            if key in reported:
                continue
            reported.add(key)
            soft.append(
                f"[{label}] {pid}.{field}: authors an absence as a list of {len(nouns)} negations "
                f"({', '.join('no ' + n for n in nouns)}) -> {sent.strip()[:90]!r}. The engine has "
                f"no reliable negation operator; each `no X` can just as easily put an X in frame. "
                f"State the positive property of the surface instead - 'completely blank and "
                f"unlettered', 'an empty street' - the way L01 and L16 do.")


def numeral_form_check(label, prompts, suffix, soft):
    """Heads-up, NOT hard — and the restraint is deliberate.

    All four known Wells Fargo numeral garbles involve punctuation (1,44.27 · 77,000 ·
    100,000 · a red accent splitting 565,000), which invites a hard ban on punctuated
    numerals. The measurement does not support one. Poyais authored '8,000,000 ACRES'
    on a flat deed face and it rendered clean; Wells Fargo's own '$5.4 MILLION',
    '$1.95T', '2.1M'/'2.55M' and '5,300 FIRED' all rendered correctly and check out
    against the fact ledger. Controlling for supply, the garble rate among digit-
    bearing literals is ~6% in Wells Fargo and ~7% in Poyais — indistinguishable.
    What actually differs is VOLUME: Wells Fargo authors 19 punctuated numerals to
    Poyais's 3, so it ships proportionally more numeral defects in absolute terms.
    The honest rule is therefore "prefer the word form where you have the choice",
    which is advice, not a violation. Hard-failing it would flag 19 correct frames to
    catch none of the four defects."""
    for pid, field, prompt in prompts:
        for lit, _s, _e in quoted_literals(prompt, suffix):
            if len(re.findall(r"\d[.,]\d", lit)) >= 2:
                soft.append(
                    f"[{label}] {pid}.{field}: {lit!r} carries multiple separators inside one digit "
                    f"run — the most garble-prone lettering form. Prefer the word form "
                    f"('8 MILLION' over '8,000,000') where the beat allows it.")


def control_leak_check(label, prompts, suffix, hard):
    """HARD. Production-control vocabulary sitting in a prompt that also authors
    diegetic lettering — the engine renders it as a label."""
    for pid, field, prompt in prompts:
        body = strip_suffix(prompt or "", suffix)
        seen = set()
        for m in _CONTROL_LEAK.finditer(body):
            t = m.group().lower()
            if t in seen:
                continue
            seen.add(t)
            hard.append(
                f"[{label}] {pid}.{field}: production-control phrase {m.group()!r} sits in the scene "
                f"body. The engine cannot reliably tell an instruction from a label and has rendered "
                f"exactly these as lettering (`rig form` on L100, `COMEDY OFF` on L69). State the "
                f"constraint as a property of the depicted thing ('round head, NO nose, NO ears') "
                f"rather than as a noun phrase naming the production rule.")


def carried_literal_check(label, shots, suffix, hard):
    """HARD. Within a stage, a literal established on an earlier frame must be
    RE-QUOTED verbatim on any later frame that mentions it — never restated as a
    lowercase description. This is the CHECKIG defect, and it is the reason Class B
    is an authoring fault: L12 alone in its chain wrote 'the checking passbook'
    where L11/L13/L14 wrote labelled 'CHECKING' / 'SAVINGS' / 'ONLINE'.

    A mention is excused when it carries its OWN quoted value nearby (reusing the
    Class-A supply test, so 'a marker card labelled "ONLINE"' does not flag the
    established literal 'CARD'). Scoped to contiguous stage runs — a fresh scene
    redraws nothing and inherits nothing."""
    runs = []
    for sh in shots:
        sid = sh.get("stage")
        if runs and sid and runs[-1][0] == sid:
            runs[-1][1].append(sh)
        else:
            runs.append((sid, [sh]))
    for stage_id, grp in runs:
        # No `if not stage_id: continue` guard here on purpose. It was written, and
        # mutation testing showed it unkillable — the run-builder above already
        # starts a fresh run for every stage-less shot, so a None stage can never
        # accumulate history and the guard was dead code. `established` is scoped
        # per run, which is the whole mechanism; the guard only looked like it was.
        established = []                      # literals quoted on EARLIER frames of this stage
        for sh in grp:
            body = strip_suffix(sh.get("still_prompt") or "", suffix)
            spans = _value_spans(body)
            own = quoted_literals(sh.get("still_prompt") or "", suffix)
            for lit in established:
                for m in re.finditer(r"\b" + re.escape(lit) + r"\b", body, re.IGNORECASE):
                    # No separate "is it quoted right here" branch: one was written and
                    # mutation testing showed it unkillable. _supplies_literal already
                    # returns True for a value span OVERLAPPING the construct, which is
                    # precisely the re-quoted case, so the branch could never change an
                    # outcome. Removed rather than propped up with a test.
                    if m.group() == lit:
                        # Character-identical, just unquoted: the glyphs are still on the
                        # page verbatim, so the engine has nothing to reconstruct. L78's
                        # "stacked on top of the CFPB slab" rendered clean, and Round 4
                        # rated L77-L80 the strongest sequence in the video. What breaks
                        # is a literal DOWNGRADED to lowercase prose — L12's 'CHECKING'
                        # -> "the checking passbook" — where the engine must re-derive
                        # both the casing and the glyph run. Case is the discriminator;
                        # without it this check flags the clean frames too.
                        continue
                    hi = min(len(body), m.end() + _SUPPLY_WINDOW)
                    if _supplies_literal(body, spans, m.start(), m.end(), hi):
                        continue              # this mention supplies its own value
                    hard.append(
                        f"[{label}] {sh.get('id','?')} (stage '{stage_id}'): refers to the "
                        f"established lettering {lit!r} by description ({body[m.start():m.end()]!r}) "
                        f"instead of re-quoting it. A delta frame REDRAWS every glyph, so a literal "
                        f"it must redraw from a paraphrase is one it guesses at — this is exactly "
                        f"how 'CHECKING' became `CHECKIG` on L12 while L11/L13/L14, which re-quoted "
                        f"theirs, rendered clean. Quote it verbatim: labelled {lit!r}.")
                    break                     # one report per literal per shot
            for lit, _s, _e in own:
                if _TRACKABLE_LITERAL.match(lit) and lit not in established:
                    established.append(lit)


# ---------------------------------------------------------------------------
# SHOT-CLASS ENUM + THE `figures` MIGRATION — the Class-D guards.
#
# WHAT CHANGED, AND WHY LINT IS THE ENFORCER
# ------------------------------------------
# Until 2026-07-29, VPW pasted the style-bible crowd-rig clause verbatim into
# `still_prompt`. The bricks-segment critic found 5 of its 15
# findings were defects of that arrangement: ~350 characters of rig boilerplate,
# identical on 20 of 44 shots, sitting between the scene and its payload — burying
# the ordering law, pushing the real content past the point where long-prompt
# adherence measurably degrades, and (because the clause says "give them a
# distinct outfit") re-inventing a held figure on delta frames that were supposed
# to hold it.
#
# The clauses did not go away; OWNERSHIP moved. VPW now DECLARES the figures in a
# structured `figures` field and `forge.py` expands the template at generation
# time, where it can pluralize over the list and swap in held-figure wording on a
# delta. Two consequences this file has to enforce:
#   * the clause TEXT is now a regression — if it is in a prompt, the migration
#     was skipped for that shot and forge will append a SECOND copy (guard 6);
#   * the `figures` field is machine-read by forge, so its shape is a contract and
#     a malformed one silently drops a rig clause from a generation (guard 7).
# ---------------------------------------------------------------------------

# The closed enum, copied from shots-schema.md §1's `shot_class` line. Copied, not
# imported: the schema is prose documentation with no parseable list, and a lint
# that parses its own docs breaks when a sentence is reworded. Keep in sync by hand
# — the guard's message names the file, so a drift shows up as a wrong suggestion.
SHOT_CLASSES = frozenset((
    "personified-character", "staged-interaction", "symbolic-stand-in-object",
    "number-glued-to-object", "diegetic-device", "map-plan-view",
    "physicalized-imbalance", "register-shift-infographic", "ironic-counterpoint",
    "reaction-shot", "idiom-pun", "aftermath-palette-turn", "crowd-multiplication",
    "literal"))


def shot_class_check(label, shots, hard, soft, strict=True):
    """A `shot_class` outside the closed enum is a typo, and a silent one: no consumer
    reads the field, so nothing downstream ever complains, and the class variety the
    drift self-audit counts is computed off a bucket that doesn't exist.
    'symbolic-stand-in' for 'symbolic-stand-in-object' is the real instance — it sat
    in this lint's own v2 test fixture, unnoticed, for as long as the fixture existed.

    HARD on a v2 file, a heads-up on a v1 one (`strict`), for the reason schema_check
    and legacy_field_check give: the field is not engine-read, so hard-failing an
    ARCHIVED video over a vocabulary change breaks it for nothing. This is not
    hypothetical — the published 2026-07-19 Wells Fargo file (v1) classes three shots
    as 'comparison', a value the table never had. v2 is the contract VPW writes from
    now on, and there the list is closed.

    ABSENT is never flagged, either way: a v1 file may predate the field entirely,
    and a missing value cannot be a typo."""
    sink = hard if strict else soft
    tail = ("" if strict else " (a heads-up only: this is a v1 file and nothing reads the "
                              "field - author v2 files to the closed list)")
    for sh in shots:
        sc = sh.get("shot_class")
        if sc is None or (isinstance(sc, str) and not sc.strip()):
            continue
        if not isinstance(sc, str):
            sink.append(f"[{label}] {sh.get('id','?')}: shot_class is {type(sc).__name__}, "
                        f"expected a string from shots-schema.md's closed list.{tail}")
            continue
        if sc not in SHOT_CLASSES:
            near = difflib.get_close_matches(sc, sorted(SHOT_CLASSES), n=1, cutoff=0.6)
            hint = f" Did you mean {near[0]!r}?" if near else ""
            sink.append(
                f"[{label}] {sh.get('id','?')}: shot_class {sc!r} is not in shots-schema.md's "
                f"closed list.{hint} The list is closed because the narration->shot-class table in "
                f"visual-grammar.md is what routes a beat to a staging, and a class off that table "
                f"routes nowhere.{tail}")


# The fingerprints of rig clauses VPW must no longer paste. Anchored on their
# distinctive spans and on the lead-in
# sentence VPW wrote to introduce them ("The stall keeper is drawn as follows.") —
# which is itself a reliable tell, because the lead-in exists ONLY to hand off to a
# pasted clause and reads as an unfinished sentence without one.
#
# THE DELIBERATE DISAGREEMENT WITH control_leak_check
# ---------------------------------------------------
# test_lettering_fidelity asserts that "on the CROWD RIG: round cream-family heads,
# DOT EYES ..." is CLEAN, and it still is *for that guard*: it never leaked into a
# render as lettering, which is the only question control_leak_check asks. This
# guard asks a different one — does this prompt still carry text forge now owns —
# and the same span answers yes. Both are right; they are not the same check.
#
# What it deliberately does NOT flag: the rig VOCABULARY used as prose about a body
# ("a base-rig anonymous teller in a teal uniform", "figures on the crowd rig"),
# because that is a legal property of a depicted figure and banning the word `rig`
# would fire on most of the file. Only the clause's own distinctive spans match.
_RIG_CLAUSE = re.compile(
    r"FULL base family rig"
    r"|CROWD RIG\s*:"
    r"|non-recurring person"
    r"|drawn as follows"
    r"|the identical rig the named cast holds",
    re.IGNORECASE)


def rig_clause_check(label, prompts, suffix, hard):
    """HARD. A rig-clause text (or its lead-in) still sitting in a prompt —
    the regression guard for the figures migration.

    ONE report per prompt, listing every fingerprint it found. The alternative —
    one per distinct fingerprint, the way control_leak_check reports — turned the
    bricks segment into 78 messages for 20 shots, because a single pasted clause
    matches four of them at once. They are not four defects; they are one
    un-migrated shot."""
    for pid, field, prompt in prompts:
        body = strip_suffix(prompt or "", suffix)
        found = []
        for m in _RIG_CLAUSE.finditer(body):
            if m.group().lower() not in [f.lower() for f in found]:
                found.append(m.group())
        if not found:
            continue
        hard.append(
            f"[{label}] {pid}.{field}: carries rig-clause text {', '.join(repr(f) for f in found)}. "
            f"The style-bible crowd-rig clause is no longer authored into prompts - declare "
            f"`figures`: {{\"crowd\": true}} and forge.py expands the template at generation time. "
            f"Left in, the prompt gets the clause twice.")


FIGURES_KEYS = ("crowd",)
_PLACE_ANCHOR = re.compile(r"assets/scenes/[A-Za-z0-9][A-Za-z0-9._-]*\.png\Z")


def place_anchor_check(label, objs, hard):
    """Structural contract for forge's optional, video-local approved-place seed.

    This owns only authoring shape and legal-role placement. File existence and resolved-path
    containment belong to forge, which is the runtime that opens the seed.

    C-5 widened this from base-only to any NON-DELTA shot: a delta continues its own base's held
    scene (a different seed, already covered by the chain parent), but a standalone place-first
    shot with no `stage` at all is exactly the single-use-place case C-4's conditional plate law
    legalizes, and it needs to be able to carry a human-picked place_anchor too."""
    for pid, sh in objs:
        if "place_anchor" not in sh:
            continue
        anchor = sh.get("place_anchor")
        if not isinstance(anchor, str) or not _PLACE_ANCHOR.fullmatch(anchor):
            hard.append(
                f"[{label}] {pid}: `place_anchor` must be a non-empty normalized video-relative "
                "`assets/scenes/<file>.png` path (no absolute, traversal, or cross-video path).")
            continue
        if sh.get("stage_role") == "delta":
            hard.append(f"[{label}] {pid}: `place_anchor` is not valid on a stage `delta` (a "
                        "delta continues its own base's held scene via the chain parent; "
                        "`place_anchor` is a different seed, for a base or standalone shot).")


def figures_check(label, objs, hard, soft):
    """`figures` shape. `objs` is [(id, shot-dict)].

    HARD on shape, because forge READS this field: an unknown key or a wrong type
    means a rig clause is silently dropped from a generation and the defect only
    shows up as an off-rig figure in a finished image, which is the most expensive
    place to find it."""
    for pid, sh in objs:
        if "figures" not in sh:
            continue
        fig = sh.get("figures")
        if not isinstance(fig, dict):
            hard.append(f"[{label}] {pid}: `figures` is {type(fig).__name__}, expected an object "
                        f"like {{\"crowd\": true}}.")
            continue
        unknown = [k for k in fig if k not in FIGURES_KEYS]
        if unknown:
            hard.append(f"[{label}] {pid}: `figures` has unknown key(s) {unknown!r}. The field is "
                        f"closed: {list(FIGURES_KEYS)!r} (shots-schema.md). forge.py ignores "
                        f"anything else, so a misspelled key drops the rig clause silently.")
        if "crowd" in fig:
            if not isinstance(fig["crowd"], bool):
                hard.append(f"[{label}] {pid}: `figures.crowd` is {fig['crowd']!r}, expected true "
                            f"or false (it gates the section 2d CROWD-RIG clause).")
            elif fig["crowd"] is False:
                soft.append(f"[{label}] {pid}: `figures.crowd` is false - omit the key instead; "
                            f"the spec says present-and-true or absent.")


# ---------------------------------------------------------------------------
# SPATIAL TIER + DELTA FEASIBILITY — the small mechanically-provable subset.
#
# These checks deliberately do NOT try to judge a whole composition, cast identity,
# parent pixels, or semantic equivalence. Those stay with VPW's critic. They catch
# only prose shapes that are already a contradiction at authoring time.
# ---------------------------------------------------------------------------
_REAR_ZONE = re.compile(
    r"\bfar\s+side\s+of\b|\bfarther\s+back\b|\bat\s+the\s+rear\s+of\b|"
    r"\b(?:behind|beyond|through|across)\s+(?:the\s+)?"
    r"(?:glass|divider|partition|doorway|shelving|shelves|table|counter|barrier|"
    r"window|corridor|rack|racks)\b",
    re.IGNORECASE)
_BACKGROUND_CROWD = re.compile(
    r"\bbackground-scale\b|\bbackground\s+crowd\b|\bcrowd\b[^.;:]{0,80}\b"
    r"(?:farther\s+back|clearly\s+(?:smaller|distant)|small\s+and\s+distant)\b",
    re.IGNORECASE)
_ANON_INDIVIDUAL = re.compile(
    r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+|a|an)\s+"
    r"(?:anonymous\s+)?(?:managers?|workers?|person|people|(?:\w+-)?shoppers?|"
    r"customers?|executives?|officers?|foremen|clerks?|staff(?:ers)?)(?!\s+crowd\b)\b",
    re.IGNORECASE)
_COMPLETION_STATE = re.compile(
    r"\b(?:toppled|collapsed|cleared|removed|erased|destroyed|dismantled)\b",
    re.IGNORECASE)
_COMPLETION_QUANTIFIER = re.compile(
    r"\b(?:all|entire|entirely|completely|nothing\s+remains|no\s+\w+\s+remains)\b",
    re.IGNORECASE)
_PRECISION_DELTA = re.compile(
    r"\b(?:\d+(?:\.\d+)?\s*%|\d+\s+percent|pixel(?:-clear)?|"
    r"(?:visible|clear)\s+gap|gap\s+of\s+bare\s+(?:floor|ground)|"
    r"(?:replace|replacing|remove|removing|swap|swapping)\b[^.;:]{0,80}\b"
    r"(?:person|people|figure|figures|manager|worker|shopper|customer|executive|officer)\b|"
    r"\b(?:majority|most|all\s+but)\b[^.;:]{0,80}\b(?:remove|rearrange|clear|erase))",
    re.IGNORECASE)


def spatial_tier_check(label, objs, hard):
    """HARD only on a declared *background* crowd without rear geometry, or with
    individually countable anonymous actors. Face/orientation and anchor compatibility need a
    visual/registry-aware critic, so this function intentionally does not guess."""
    for pid, sh in objs:
        if not isinstance(sh.get("figures"), dict) or sh["figures"].get("crowd") is not True:
            continue
        prompt = sh.get("still_prompt") or ""
        if _BACKGROUND_CROWD.search(prompt) and not _REAR_ZONE.search(prompt):
            hard.append(
                f"[{label}] {pid}: background crowd has no positive rear zone in the primary scene clause. "
                "Put the mass on the far side of real geometry (behind glass, shelving, a divider, doorway, "
                "or table); 'background-scale' after a co-planar gathering is not a mechanism.")
        match = _ANON_INDIVIDUAL.search(prompt)
        if match:
            hard.append(
                f"[{label}] {pid}: individually staged anonymous {match.group()!r} sits inside "
                "`figures.crowd: true`. Give that person cast identity or restage the beat as mass action; "
                "crowd is not a third actor tier.")


def delta_feasibility_check(label, objs, hard):
    """HARD on declared multi-change deltas and known whole-frame precision/removal
    requests. Physical feasibility against a particular parent remains a critic
    judgment unless the prompt itself states one of these unrouteable shapes."""
    for pid, sh in objs:
        if sh.get("stage_role") != "delta":
            continue
        changes = sh.get("changed_elements")
        if isinstance(changes, list) and len(changes) != 1:
            hard.append(
                f"[{label}] {pid}: delta has {len(changes)} declared changed elements; it must express "
                "exactly one declared changed element (one semantic transformation).")
        prompt = sh.get("still_prompt") or ""
        change = re.split(r"\bonly\s+this\s+changes\s*:\s*", prompt, maxsplit=1,
                          flags=re.IGNORECASE)[-1]
        if _COMPLETION_STATE.search(change) and not _COMPLETION_QUANTIFIER.search(change):
            hard.append(
                f"[{label}] {pid}: completion-state delta lacks a completion quantifier. State all/entirely "
                "or what nothing remains, rather than leaving a partial result valid.")
        if _PRECISION_DELTA.search(change):
            hard.append(
                f"[{label}] {pid}: exact gap/percentage, replace-one-person, or majority-removal request is "
                "not a reliable whole-frame prose delta; route it to simplification, a pre-transient rebase, "
                "or the layered/rebase path.")


# ---------------------------------------------------------------------------
# DOCTRINE RESET 2026-08-04 — style one-voice (C-2), place (C-3/C-5), authoring
# feasibility (C-7/C-8). Root cause: audit-drift-2026-08-04.md (5 mechanisms) +
# the design's own correction, adversarial-review-2026-08-04.md M8-M11 — every
# HARD check below is presence/omission ONLY, the same boundary
# spatial_tier_check/delta_feasibility_check already draw above. Whether the
# present clauses actually COHERE (right topology, right cause->effect, right
# casting call) is the shot critic's job (references/critics.md, questions 6-8),
# never lint's — a keyword check that tries to judge coherence is Goodhart-able
# (audit's own L66 diagnosis: the clauses were present and still wrong).
# ---------------------------------------------------------------------------

# --- C-2: banned render-technique terms + suffix one-voice --------------------
# Exact list from the design (spec §1 Style, M8's amendment) — case-insensitive,
# applies to prompts AND `global_prompt_suffix`. Scene-light NOUNS (warm, amber,
# glow, lit, lamp) are deliberately absent: they describe committed scene
# lighting, not a render TECHNIQUE, and "warm lamp amber" is correct prose on
# ~70 real shots (M8's measurement) that this list must never touch.
_BANNED_RENDER_TERMS = re.compile(
    r"\bgradient\b"
    r"|\bgloss(?:y)?\b"
    r"|\bspecular\b"
    r"|\bbloom\b"
    r"|\bdepth[- ]of[- ]field\b"
    r"|\bblurred\s+(?:background|behind)\b"
    r"|\bsoft\s+focus\b"
    r"|\bphotoreal\w*\b"
    r"|\bsubsurface\b"
    r"|\brim\s+light\b",
    re.IGNORECASE)

# The suffix's own extra vocabulary the C-1 recipe deleted ("gentle soft cel
# shading", "no feathered or blended transitions") — narrower than the prompt
# ban above because the suffix is boilerplate, not scene content, so a stricter
# list is cheap here without the false-positive risk a prompt-wide ban on
# "gentle"/"soft"/"blend" would carry over 214 shots of ordinary prose. Bare
# "soft" is included (the deleted phrase paired it with "gentle") but excludes
# "soft focus" — that exact phrase is already the C-2 banned term above, and
# without the exclusion the same span would report twice.
_SUFFIX_SOFT = re.compile(
    r"\bgentle\b|\bblend(?:ed|ing)?\b|\bfeather(?:ed|ing)?\b|\bsoft\b(?!\s+focus)",
    re.IGNORECASE)


def render_technique_check(label, prompts, hard):
    """C-2 HARD. `prompts` is [(id, field, text)] — the same shape text_supply_check
    uses, so this call slots into main() beside it for every still_prompt, suffix,
    thumbnail gen_prompt, and short first_frame."""
    for pid, field, prompt in prompts:
        seen = set()
        for m in _BANNED_RENDER_TERMS.finditer(prompt or ""):
            t = m.group().lower()
            if t in seen:
                continue
            seen.add(t)
            hard.append(
                f"[{label}] {pid}.{field}: banned render-technique term {m.group()!r} — the C-1 "
                f"unified recipe is flat fills + at most one hard-edged single-step shadow, no "
                f"soft/blended rendering. A scene-light NOUN (warm, amber, glow, lit, lamp) is "
                f"never this — only the render-TECHNIQUE word is banned.")


def suffix_one_voice_check(suffix, hard):
    """C-2(a) HARD, one-voice. `global_prompt_suffix` carries no banned render-technique
    term (shares render_technique_check's own list, so the two checks cannot disagree)
    and no OTHER soft/gradient-permissive wording. A second voice in the one string
    appended to every prompt is audit mechanism 1 — the global smooth/glossy drift
    traced to the suffix and the style-bible descriptor disagreeing with the hardened
    scene style."""
    render_technique_check("suffix", [("global_prompt_suffix", "global_prompt_suffix", suffix or "")], hard)
    seen = set()
    for m in _SUFFIX_SOFT.finditer(suffix or ""):
        t = m.group().lower()
        if t in seen:
            continue
        seen.add(t)
        hard.append(
            f"[suffix] global_prompt_suffix: soft/gradient-permissive wording {m.group()!r} "
            f"contradicts the C-1 one-voice recipe (flat fills, one hard-edged shadow, no "
            f"feathered or blended transitions) — style-bible.md's own text deleted this wording; "
            f"the suffix must not reintroduce it.")


# --- C-3/C-5: place --------------------------------------------------------
_PLACE_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# The symbolic/abstract/object-insert `shot_class` values (visual-grammar.md §1's
# table) — each depicts a floating object or abstraction, never a diegetic SET,
# so `place` is structurally inapplicable, never merely omittable.
_PLACELESS_SHOT_CLASSES = frozenset((
    "symbolic-stand-in-object", "number-glued-to-object", "map-plan-view",
    "physicalized-imbalance", "register-shift-infographic"))

# Structural set-type nouns that name a KIND of place, not a SPECIFIC one — dropped
# before comparing a place id's tokens against the script's own vocabulary, the same
# way long_literal_word_check's floor drops words the author had no real choice about.
_PLACE_GENERIC_TOKEN = frozenset((
    "room", "office", "yard", "store", "dock", "hall", "floor", "area", "site",
    "desk", "shop", "zone", "house", "corridor", "table", "warehouse", "lot",
    "lobby", "wing", "bay", "plant", "boardroom", "exterior", "interior"))


def place_key_check(label, objs, hard):
    """HARD, shape only. `place` is a kebab-case set id (C-3) — never `stage`'s
    caps/contiguity semantics, just a lower-case, hyphen-separated identity string."""
    for pid, sh in objs:
        place = sh.get("place")
        if place is None:
            continue
        if not isinstance(place, str) or not _PLACE_ID.fullmatch(place):
            hard.append(f"[{label}] {pid}: `place` {place!r} must be a non-empty lower-case "
                        "kebab-case set id (e.g. 'miniscribe-boardroom') - distinct from `stage`.")


def place_shot_class_exempt_check(label, shots, hard):
    """HARD. The symbolic/abstract/object-insert shot classes never declare `place`
    (C-3) - visual-grammar.md's own class table shows why: each depicts a floating
    object/abstraction, never a set."""
    for sh in shots:
        sc = sh.get("shot_class")
        if "place" in sh and sc in _PLACELESS_SHOT_CLASSES:
            hard.append(
                f"[{label}] {sh.get('id', '?')}: shot_class {sc!r} declares `place` "
                f"{sh.get('place')!r} - this class is exempt (C-3): it depicts a floating "
                f"object/abstraction, never a diegetic set.")


def place_context_exempt_check(label, objs, hard):
    """HARD. A short's `first_frame` and the thumbnail block never declare `place`
    (C-3) - neither inhabits a per-video diegetic set the way a long-form/short shot
    does."""
    for pid, sh in objs:
        if isinstance(sh, dict) and "place" in sh:
            hard.append(f"[{label}] {pid}: declares `place` {sh['place']!r} - thumbnail/"
                        "first_frame never do (C-3); they run seedless under the hardened "
                        "descriptor unconditionally.")


def place_inventory_check(label, objs, vocab, hard):
    """HARD. Every declared `place` must anchor to a word the script itself uses
    (`script_vocab`) - the same class of error as an invented lettering literal
    (long_literal_word_check reuses the identical discriminator). At least one
    non-generic token (dropping structural set-type nouns like 'room'/'yard', which
    name a KIND of set, not the specific one) must be real script vocabulary, or the
    place was invented rather than read off the script. NO SCRIPT VOCAB, NO CHECK -
    an empty vocabulary is the absence of the discriminator, not a licence to flag
    every place (same reasoning as long_literal_word_check)."""
    if not vocab:
        return
    for pid, sh in objs:
        place = sh.get("place")
        if not isinstance(place, str) or not place.strip():
            continue
        toks = [t for t in place.lower().split("-") if len(t) >= 4 and t not in _PLACE_GENERIC_TOKEN]
        if not toks:
            continue          # nothing but structural nouns - nothing this check can anchor
        if not any(t in vocab for t in toks):
            hard.append(
                f"[{label}] {pid}: place {place!r} has no token the script itself uses "
                f"({toks!r} not found in script.md) - an invented place is the same class of "
                f"error as an invented lettering literal; anchor it to the script's own wording "
                f"or fold the shot into an existing declared place.")


def place_owner_check(label, shots, suffix, hard):
    """HARD. A branded interior - a `place` group where ANY shot authors an alphabetic
    trackable literal (L-1's own vocabulary; a proper-noun-shaped quoted string, never
    a bare numeral, is presumptively the owner's signage/letterhead/plaque) - must
    carry that SAME literal on its place-first shot (file order within the group
    mirrors C-4's derived plate: the first emitted no-cast shot of the place), or the
    group must declare `owner_ambiguity: true` somewhere. Ownership invisible on the
    establishing frame while a LATER shot quotes the company name is Daniel's failure
    #6 (office ownership invisible) under another name. The literal is per-video DATA,
    never a skill constant - this reads only what the author already quoted."""
    groups = {}
    for sh in shots:
        place = sh.get("place")
        if isinstance(place, str) and place.strip():
            groups.setdefault(place, []).append(sh)
    for place, grp in groups.items():
        if any(sh.get("owner_ambiguity") is True for sh in grp):
            continue
        literals = {}
        for sh in grp:
            for lit, _s, _e in quoted_literals(sh.get("still_prompt") or "", suffix):
                if _TRACKABLE_LITERAL.match(lit):
                    literals.setdefault(lit, []).append(sh.get("id", "?"))
        if not literals:
            continue           # nothing branded declared anywhere in this place - not this check's job
        plate = grp[0]         # C-4: the place-first shot in file order mirrors the derived plate
        plate_lits = {lit for lit, _s, _e in quoted_literals(plate.get("still_prompt") or "", suffix)}
        missing = {lit: ids for lit, ids in literals.items() if lit not in plate_lits}
        if missing:
            hard.append(
                f"[{label}] place {place!r}: owner cue(s) {missing!r} quoted elsewhere in the "
                f"place but absent from its place-first shot {plate.get('id', '?')!r} - author "
                f"the cue on the plate, or declare `owner_ambiguity: true` if the ambiguity is "
                f"intentional.")


def place_anchor_same_place_check(label, shots, hard):
    """C-5 HARD mirror of forge's same-place law: a `place_anchor` may only seed a shot
    within its OWN place - cross-place image seeding is the probe-refuted style-anchor
    failure under another name (decisions.md 2026-08-04). The anchor's filename stem is
    the SOURCE shot's own `id` (forge's convention: `assets/scenes/<id>.png`); resolve
    it in this same file and compare `place` fields. Silent when either side's `place`
    is unset (an archived pre-place file, or a legitimate no-place root) - this is the
    same-PLACE law, not a mandatory-place law."""
    by_id = {sh.get("id"): sh for sh in shots}
    for sh in shots:
        anchor = sh.get("place_anchor")
        if not isinstance(anchor, str):
            continue
        stem = Path(anchor).stem
        source = by_id.get(stem)
        if source is None:
            continue           # forge/filesystem resolves cross-file/missing anchors, not this check
        src_place, dst_place = source.get("place"), sh.get("place")
        if src_place and dst_place and src_place != dst_place:
            hard.append(
                f"[{label}] {sh.get('id', '?')}: `place_anchor` {anchor!r} seeds from {stem!r} "
                f"(place {src_place!r}) into a shot declared place {dst_place!r} - cross-place "
                f"image seeding is the probe-refuted style-anchor failure (decisions.md "
                f"2026-08-04); a plate may only seed shots in its own place.")


def bool_field_check(label, objs, field, hard):
    """HARD, shape only. A non-boolean value silently fails every `... is True` test
    elsewhere in this file (action_chain_check's `hard_cut`, place_owner_check's
    `owner_ambiguity`) - shape drift here is a silent false negative downstream."""
    for pid, sh in objs:
        if field in sh and not isinstance(sh[field], bool):
            hard.append(f"[{label}] {pid}: `{field}` is {sh[field]!r}, expected true or false.")


# --- C-8: two-cast presence, action-chain, semantic-cast (narrow) -------------
_BACKTICK = re.compile(r"`([^`]+)`")
_SENTENCE_SPLIT = re.compile(r"(?<=[.;!?])\s+")

# The registry vocabulary token for the seated POSE PRIMITIVE (kind: pose, name:
# "sit") - copied, not imported, same precedent as SHOT_CLASSES above: widen only
# with a real counter-example (a second seated-primitive name) in hand.
SEATED_PRIMITIVE = "sit"

_SUPPORT_NOUN = r"chair|stool|bench|seat|crate|step|ledge|desk\s+edge|sill"
_SUPPORT = re.compile(r"\b(?:" + _SUPPORT_NOUN + r")\b", re.IGNORECASE)
# A physical-contact verb/preposition near the support noun - the "contact phrase"
# C-7 requires alongside the noun itself.
_CONTACT_NEAR = re.compile(
    r"\bon\b|\bin\b|\bagainst\b|\batop\b|\balong\b|\bastride\b|\bstraddl\w*"
    r"|\bperch\w*|\brest\w*|\blean\w*|\bprop\w*|\bsit(?:s|ting)?\b|\bhips?\b",
    re.IGNORECASE)
_CONTACT_WINDOW = 30

_PLANE_CLAUSE = re.compile(
    r"\bforeground\b|\bbackground\b|\bmidground\b|\bmid-ground\b|\bsame\s+plane\b"
    r"|\bplane\b|\bnearer\b|\bfarther\b|\bcloser\s+to\b|\bbehind\s+(?:him|her|them)\b"
    r"|\bin\s+front\s+of\b", re.IGNORECASE)
_EYELINE_CLAUSE = re.compile(
    r"\beye[- ]?line\b|\bgaze\b|\blooks?\s+(?:at|toward|across|down\s+at|up\s+at)\b"
    r"|\bfacing\s+(?:each\s+other|him|her|them|away)\b|\beye\s+contact\b", re.IGNORECASE)
_SCALE_CLAUSE = re.compile(
    r"\brelative\s+(?:head\s+)?(?:scale|size)\b|\bhead\s+scale\b"
    r"|\b(?:larger|smaller|bigger|taller|shorter)\s+(?:in\s+(?:the\s+)?frame|head)\b"
    r"|\bdominant\b", re.IGNORECASE)

# A generic PLURAL role noun - the exact M11 trigger. Deliberately PLURAL-only:
# L100's real defect is "managers" (plural), and a singular ("a manager") is far
# more often a specific individual the shot is right to cast by name.
_GENERIC_PLURAL_ROLE = re.compile(
    r"\b(?:managers|executives|workers|employees|officers|clerks|staffers|bankers"
    r"|auditors|reps|representatives|foremen|colleagues|investors|shareholders"
    r"|directors|officials|accountants)\b", re.IGNORECASE)

# This project's own continuity idiom, used correctly on delta frames that DO carry
# a `stage` ("The same shop interior, same locked framing", "The same populated
# boardroom, same locked framing"). A shot that uses it WITHOUT a `stage`/`hard_cut`
# is the L89-L91 drift: a backward reference to a held scene with nothing declaring
# the shots linked.
_SAME_CALLBACK = re.compile(r"\bthe\s+same\s+[a-z]", re.IGNORECASE)


def _named_chars(prompt, chars):
    """Registry characters backticked in `prompt`, in first-appearance order."""
    out = []
    for m in _BACKTICK.finditer(prompt or ""):
        n = m.group(1)
        if n in chars and n not in out:
            out.append(n)
    return out


def video_chars(data, vdir):
    """The working cast vocabulary for THIS video: the channel `registry.json`'s
    PROMOTED characters, plus this video's own Pass-1 `assets/library/manifest.json`
    identities - mirroring forge.py's `merge_vocabulary`. A video's own lead
    (`qt-wiles`, `brick-foreman` ...) never reaches the channel registry (registry
    promotion rule, kept, see shots-schema.md/forge.py), so registry-only lookup
    misses exactly the cast C-7/C-8 exist for. Best-effort: either source
    missing/unreadable degrades that half silently, never a hard failure - this is a
    cast-BINDING aid, not the name-resolution gate the critic already owns (question 3)."""
    chars = set()
    channel = data.get("channel")
    if channel:
        reg_path = vdir.parent.parent / "visual-kit" / "registry" / "registry.json"
        try:
            reg = json.loads(reg_path.read_text(encoding="utf-8"))
            chars |= set(reg.get("characters", {}).keys())
        except (OSError, ValueError):
            pass
    chars.discard("base")
    mani_path = vdir / "assets" / "library" / "manifest.json"
    try:
        mani = json.loads(mani_path.read_text(encoding="utf-8"))
        for e in mani.get("assets", []):
            if e.get("kind") in ("identity", "character") and e.get("name"):
                chars.add(e["name"])
    except (OSError, ValueError):
        pass
    return chars


def seat_support_check(label, objs, chars, soft, hard):
    """C-7 HARD. A NAMED figure carrying the registry `sit` pose primitive - bound by
    backtick ORDER to the most-recently-named character, mirroring forge.py's
    `shot_cast`, NEVER the English verb "sits" (this project's own prose uses that
    verb constantly for OBJECTS: "the metal desk sits pushed aside", "a brick sits on
    its end", "the cabinet sits blurred") - must name a support noun from the closed
    list AND a contact phrase in the SAME SENTENCE. Framing sufficiency ("does the
    render show enough of it") is not lint-decidable - a SOFT heads-up on every
    structurally-passing seated shot, per M9's amendment."""
    if not chars:
        return
    for pid, sh in objs:
        prompt = sh.get("still_prompt") or ""
        cur = None
        seated = []
        for m in _BACKTICK.finditer(prompt):
            name = m.group(1)
            if name in chars:
                cur = name
            elif name == SEATED_PRIMITIVE and cur:
                seated.append((cur, m))
        if not seated:
            continue
        sentences = []
        start = 0
        for m in _SENTENCE_SPLIT.finditer(prompt):
            sentences.append((start, m.start(), prompt[start:m.start()]))
            start = m.end()
        sentences.append((start, len(prompt), prompt[start:]))
        for char, tok in seated:
            sent = next((s for (a, b, s) in sentences if a <= tok.start() < b), prompt)
            sup = _SUPPORT.search(sent)
            has_contact = bool(sup) and bool(_CONTACT_NEAR.search(
                sent[max(0, sup.start() - _CONTACT_WINDOW):min(len(sent), sup.end() + _CONTACT_WINDOW)]))
            if sup and has_contact:
                soft.append(f"[{label}] {pid}: `{char}` carries `{SEATED_PRIMITIVE}` with support "
                            f"{sup.group()!r} authored - confirm the render's FRAMING actually "
                            f"shows the support (not lint-decidable; forced review row).")
            else:
                missing = [] if sup else ["a support object (chair|stool|bench|seat|crate|step|"
                                          "ledge|desk edge|sill)"]
                if sup and not has_contact:
                    missing = ["a contact phrase near the support"]
                hard.append(
                    f"[{label}] {pid}: `{char}` carries the seated pose primitive "
                    f"`{SEATED_PRIMITIVE}` but its sentence names no {missing[0]} - a body seated "
                    f"on nothing (L89's unambiguous floating sit). Name the support and how "
                    f"`{char}` contacts it in the same sentence.")


def two_cast_presence_check(label, objs, chars, hard):
    """C-8 HARD = presence only. A shot naming >=2 registry characters must state a
    plane clause, an eye-line clause, and a relative-head-scale clause ("dominant"
    legally resolves scale via posture/framing, per the design). Whether the stated
    clauses describe the right TOPOLOGY - the audit's own L66 finding, where the
    clauses were present and the foreman still miniaturized - is the shot critic's
    judgment (critics.md question 6), never lint's."""
    if not chars:
        return
    for pid, sh in objs:
        prompt = sh.get("still_prompt") or ""
        named = _named_chars(prompt, chars)
        if len(named) < 2:
            continue
        missing = []
        if not _PLANE_CLAUSE.search(prompt):
            missing.append("plane")
        if not _EYELINE_CLAUSE.search(prompt):
            missing.append("eye line")
        if not _SCALE_CLAUSE.search(prompt):
            missing.append("relative head scale")
        if missing:
            hard.append(
                f"[{label}] {pid}: 2+-named-cast shot ({', '.join('`' + c + '`' for c in named)}) "
                f"states no {', '.join(missing)} clause - presence only (C-8); whether the stated "
                f"clauses cohere into the right topology is the critic's call.")


def action_chain_check(label, shots, hard):
    """C-8 HARD = presence only. A shot's prose that calls back to a held scene/prop
    ("the same wax-sealed box" - this project's own idiom, used correctly on delta
    frames that DO declare a `stage`) but carries no `stage`/`stage_role` of its own
    and no `hard_cut: true` is exactly the L89-L91 drift: three shots visibly
    continuing one action (pry the box, swap the sheet, get caught) that ran as three
    independent seedless roots because nothing declared them linked. Cause->effect
    READABILITY stays the critic's judgment (critics.md question 7); this only checks
    the omission."""
    for sh in shots:
        if sh.get("stage") or sh.get("hard_cut") is True:
            continue
        prompt = sh.get("still_prompt") or ""
        m = _SAME_CALLBACK.search(prompt)
        if m:
            hard.append(
                f"[{label}] {sh.get('id', '?')}: still_prompt calls back to a held scene/prop "
                f"({prompt[m.start():m.start() + 40].strip()!r}...) but declares no `stage`/"
                f"`stage_role` chain and no `hard_cut: true` - an action continuing across shots "
                f"needs one or the other (the L89-L91 drift: a box-tampering sequence that ran as "
                f"three independent seedless roots).")


def semantic_cast_check(label, shots, id2text, chars, hard):
    """C-8 HARD, narrow per M11. Fires ONLY the decidable case: a shot's OWN vo_text
    names a generic PLURAL role ('managers', 'executives' ...) while the shot casts a
    named character whose slug fragment (a `-`-split token, e.g. 'foreman' from
    `brick-foreman`) appears NOWHERE in that shot's vo_text or its immediate +/-1
    neighbours' - the real L100 defect: VO says 'managers', the shot casts
    `brick-foreman`+`qt-wiles` specifically, and neither name surfaces anywhere near
    it (vpw-log.md Phase B3's bulk anon_foreground->named-cast conversion is the
    mechanism). A shot where the VO itself names the role ('the foreman told his
    crew') is a legitimately justified lead and stays silent. Everything else - is the
    cast choice dramatically RIGHT - is the critic's call (critics.md question 8), not
    lint's. Needs `id2text` (vo_text tiling); silently skipped wherever anchors did
    not tile clean."""
    if not id2text or not chars:
        return
    ordered = [sh.get("id") for sh in shots]
    for i, sh in enumerate(shots):
        sid = sh.get("id")
        vo = id2text.get(sid, "")
        plural = _GENERIC_PLURAL_ROLE.search(vo)
        if not plural:
            continue
        prompt = sh.get("still_prompt") or ""
        named = _named_chars(prompt, chars)
        if not named:
            continue
        window_ids = [ordered[k] for k in (i - 1, i, i + 1) if 0 <= k < len(ordered)]
        window = " ".join(id2text.get(w, "") for w in window_ids).lower()
        unjustified = [
            c for c in named
            if not any(len(tok) >= 3 and re.search(r"\b" + re.escape(tok) + r"\b", window)
                       for tok in c.split("-"))
        ]
        if unjustified:
            hard.append(
                f"[{label}] {sid}: vo_text names a generic plural role ({plural.group()!r}) while "
                f"the shot casts {', '.join('`' + c + '`' for c in unjustified)}, whose name "
                f"appears nowhere in this VO span or its neighbours - the L100 defect (bulk "
                f"generic->named conversion casting a specific lead the narration never names "
                f"here). Either the VO's own words justify the named lead nearby, or recast the "
                f"shot to the generic role.")


def _shot_prompts(shots):
    return [(sh.get("id", "?"), "still_prompt", sh.get("still_prompt") or "") for sh in shots]


def main(argv):
    # This machine's console is cp1252 and a single un-encodable character in ONE message
    # raises UnicodeEncodeError mid-print, so the whole HARD list the author needs vanishes
    # (bricks pipe test F-3 — the report was invisible without PYTHONIOENCODING=utf-8).
    # Messages stay ASCII-safe on their own; this is the belt for anything added later.
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass                                     # captured/wrapped stdout — nothing to do
    if not argv or argv[0] in ("-h", "--help"):
        print("usage: python lint_shots.py <path-to/shots.json> [--write]")
        return 2
    path = argv[0]
    do_write = "--write" in argv[1:]
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    vdir = Path(path).parent
    script_md = vdir / "script.md"
    chars = video_chars(data, vdir)          # C-7/C-8: this video's working cast vocabulary

    # S3: the VO word-timings render actually matches against (empty if not yet voiced).
    vo_manifest_path = vdir / "assets" / "voiceover.manifest.json"
    vo_manifest = (json.loads(vo_manifest_path.read_text(encoding="utf-8"))
                   if vo_manifest_path.exists() else {"pieces": []})

    lf_shots = data.get("long_form", {}).get("shots", [])
    shorts = data.get("shorts", []) or []

    # C2: every shot must have a unique, non-empty id BEFORE any tile/write_back deref (those
    # index by id and would KeyError). This is a hard prerequisite for the rest of the lint.
    id_errs, seen_ids = [], set()
    for lbl, sh_list in ([("long-form", lf_shots)]
                         + [(f"short:{s.get('file','?')}", s.get("shots", []) or []) for s in shorts]):
        for k, sh in enumerate(sh_list):
            sid = sh.get("id")
            if not sid or not str(sid).strip():
                id_errs.append(f"[{lbl}] shot #{k}: missing/empty id.")
            elif sid in seen_ids:
                id_errs.append(f"[{lbl}] duplicate id '{sid}'.")
            else:
                seen_ids.add(sid)
    if id_errs:
        print(f"== lint_shots: {path} ==")
        print(f"\nHARD violations ({len(id_errs)}) — every shot needs a unique non-empty id:")
        for e in id_errs:
            print(f"  {e}")
        return 1

    hard, soft = [], []
    ordered, id2text_all = [], {}
    strict_schema = data.get("schema") == SCHEMA_V2

    schema_check(data, soft)
    legacy_field_check(data, soft)

    lf_text = lint_piece("long-form", lf_shots, script_md, hard, soft,
                         word_timings=word_timings_for(vo_manifest, "long-form"))
    stage_check("long-form", lf_shots, hard, soft,
                require_stage=strict_schema and len(lf_shots) >= 40)
    suffix = data.get("global_prompt_suffix") or ""
    suffix_one_voice_check(suffix, hard)     # C-2(a): the suffix's own one-voice check, once
    lf_prompts = _shot_prompts(lf_shots)
    lf_vocab = script_vocab(script_md)
    lf_objs = [(sh.get("id", "?"), sh) for sh in lf_shots]
    text_supply_check("long-form", lf_prompts, suffix, hard)
    word_cap_check("long-form", lf_prompts, suffix, hard)
    literal_count_check("long-form", lf_prompts, suffix, hard)
    control_leak_check("long-form", lf_prompts, suffix, hard)
    rig_clause_check("long-form", lf_prompts, suffix, hard)
    render_technique_check("long-form", lf_prompts, hard)
    shot_class_check("long-form", lf_shots, hard, soft, strict_schema)
    figures_check("long-form", lf_objs, hard, soft)
    spatial_tier_check("long-form", lf_objs, hard)
    delta_feasibility_check("long-form", lf_objs, hard)
    place_anchor_check("long-form", lf_objs, hard)
    place_key_check("long-form", lf_objs, hard)
    place_shot_class_exempt_check("long-form", lf_shots, hard)
    place_inventory_check("long-form", lf_objs, lf_vocab, hard)
    place_owner_check("long-form", lf_shots, suffix, hard)
    place_anchor_same_place_check("long-form", lf_shots, hard)
    bool_field_check("long-form", lf_objs, "hard_cut", hard)
    bool_field_check("long-form", lf_objs, "owner_ambiguity", hard)
    action_chain_check("long-form", lf_shots, hard)
    seat_support_check("long-form", lf_objs, chars, soft, hard)
    two_cast_presence_check("long-form", lf_objs, chars, hard)
    numeral_form_check("long-form", lf_prompts, suffix, soft)
    long_literal_word_check("long-form", lf_prompts, suffix, soft, lf_vocab)
    negation_list_check("long-form", lf_prompts, suffix, soft)
    carried_literal_check("long-form", lf_shots, suffix, hard)
    # The thumbnail is the single most-seen frame of the video — its prompts get
    # the same guard as the shot list. The one exception is rig_clause_check: the
    # `figures` field is a per-SHOT key, so the thumbnail has no way to declare an
    # anonymous figure and banning the clause there would leave the rig
    # unexpressible on the most-seen frame in the video. §2c's auto-append covers
    # a character-bearing thumbnail already.
    th = data.get("thumbnail") or {}
    th_prompts = [("thumbnail.primary", "gen_prompt", (th.get("primary") or {}).get("gen_prompt") or "")]
    th_prompts += [(f"thumbnail.challengers[{i}]", "gen_prompt", (c or {}).get("gen_prompt") or "")
                   for i, c in enumerate(th.get("challengers") or [])]
    th_objs = [("thumbnail.primary", th.get("primary") or {})]
    th_objs += [(f"thumbnail.challengers[{i}]", c or {}) for i, c in enumerate(th.get("challengers") or [])]
    text_supply_check("thumbnail", th_prompts, suffix, hard)
    word_cap_check("thumbnail", th_prompts, suffix, hard)
    literal_count_check("thumbnail", th_prompts, suffix, hard)
    control_leak_check("thumbnail", th_prompts, suffix, hard)
    render_technique_check("thumbnail", th_prompts, hard)
    place_context_exempt_check("thumbnail", th_objs, hard)
    long_literal_word_check("thumbnail", th_prompts, suffix, soft, lf_vocab)
    negation_list_check("thumbnail", th_prompts, suffix, soft)
    ordered += lf_shots
    if lf_text:
        id2text_all.update(lf_text)
    semantic_cast_check("long-form", lf_shots, lf_text, chars, hard)

    for short in shorts:
        sshots = short.get("shots", [])
        smd = vdir / short.get("file", "")
        piece = Path(short.get("file", "")).stem
        st = lint_piece(f"short:{short.get('file','?')}", sshots, smd, hard, soft,
                        word_timings=word_timings_for(vo_manifest, piece))
        stage_check(f"short:{short.get('file','?')}", sshots, hard, soft)
        slabel = f"short:{short.get('file','?')}"
        sprompts = _shot_prompts(sshots)
        # The first_frame IS the short's thumbnail; it carries baked caption text
        # more often than any other prompt in the file, so it must be covered.
        ff_obj = short.get("first_frame") or {}
        ff = ff_obj.get("still_prompt") or ""
        if ff:
            sprompts.append(("first_frame", "still_prompt", ff))
        # A short is DERIVED from the long-form script, so both vocabularies are the
        # video's own — union, not either alone. Its own md alone would make every
        # long word the long-form established a heads-up on the short (Wells Fargo's
        # 'OBSTRUCTION' appears on three short frames); the long-form alone would
        # miss what the short names for itself. A missing short md degrades to the
        # long-form set rather than to empty, which would flag everything.
        svocab = script_vocab(smd) | lf_vocab
        sshot_objs = [(sh.get("id", "?"), sh) for sh in sshots]
        text_supply_check(slabel, sprompts, suffix, hard)
        word_cap_check(slabel, sprompts, suffix, hard)
        literal_count_check(slabel, sprompts, suffix, hard)
        control_leak_check(slabel, sprompts, suffix, hard)
        rig_clause_check(slabel, sprompts, suffix, hard)
        render_technique_check(slabel, sprompts, hard)
        shot_class_check(slabel, sshots, hard, soft, strict_schema)
        figures_check(slabel, sshot_objs + ([("first_frame", ff_obj)] if ff_obj else []), hard, soft)
        spatial_tier_check(slabel, sshot_objs, hard)
        delta_feasibility_check(slabel, sshot_objs, hard)
        place_anchor_check(slabel, sshot_objs + ([("first_frame", ff_obj)] if ff_obj else []), hard)
        place_key_check(slabel, sshot_objs, hard)
        place_shot_class_exempt_check(slabel, sshots, hard)
        place_inventory_check(slabel, sshot_objs, svocab, hard)
        place_owner_check(slabel, sshots, suffix, hard)
        place_anchor_same_place_check(slabel, sshots, hard)
        place_context_exempt_check(slabel, [("first_frame", ff_obj)] if ff_obj else [], hard)
        bool_field_check(slabel, sshot_objs, "hard_cut", hard)
        bool_field_check(slabel, sshot_objs, "owner_ambiguity", hard)
        action_chain_check(slabel, sshots, hard)
        seat_support_check(slabel, sshot_objs, chars, soft, hard)
        two_cast_presence_check(slabel, sshot_objs, chars, hard)
        semantic_cast_check(slabel, sshots, st, chars, hard)
        numeral_form_check(slabel, sprompts, suffix, soft)
        long_literal_word_check(slabel, sprompts, suffix, soft, svocab)
        negation_list_check(slabel, sprompts, suffix, soft)
        carried_literal_check(slabel, sshots, suffix, hard)
        ordered += sshots
        if st:
            id2text_all.update(st)

    print(f"== lint_shots: {path} ==")
    print(f"long-form shots: {len(lf_shots)}  |  shorts: {len(data.get('shorts', []) or [])}")
    if hard:
        print(f"\nHARD violations ({len(hard)}) — render sync WILL degrade, fix before handoff:")
        for h in hard:
            print(f"  {h}")
    else:
        print("\nHARD violations: none — every anchor matches verbatim + in narration order.")
    if soft:
        print(f"\nHeads-up ({len(soft)}):")
        for s in soft:
            print(f"  {s}")

    if do_write:
        if hard:
            print("\n--write SKIPPED: fix HARD violations first (won't derive vo_text over broken anchors).")
            return 1
        write_back(path, data, ordered, id2text_all)
        print(f"\nWROTE derived vo_text ({len(id2text_all)} shots). JSON valid.")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
