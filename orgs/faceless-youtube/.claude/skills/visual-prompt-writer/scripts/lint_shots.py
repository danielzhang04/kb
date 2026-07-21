#!/usr/bin/env python3
"""Deterministic lint for a video's shots.json against its script.md.

WHY THIS EXISTS
---------------
`render-builder` times every cut by finding each shot's `vo_ref` in the real VO
word-stream (see render.py::retime_by_timings): it normalizes the FIRST 4 WORDS of
`vo_ref` and matches them SEQUENTIALLY (each shot at or after the previous match).
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
On a clean pass, (re)generates two DERIVED, review-only fields, preserving the
file's exact formatting:
  * `vo_text` on every shot = the verbatim script span it covers (from its anchor
    to the next shot's). This is COMPUTED, never authored, and is NOT a depiction
    brief — a shot's image is anchored to its moment, not asked to represent the
    whole span. A span that comes out long is a signal to DENSIFY (add a cut),
    per the §10 cadence rule, not to cram meaning into one image.
  * a top-level `shot_counts` block (informational; downstream ignores it).

Usage:
  python lint_shots.py <path-to/shots.json> [--write]
Exit 0 = clean (safe to render); 1 = HARD violations (fix before handoff).
"""
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
_NORM = lambda w: re.sub(r"[^a-z0-9]+", "", w.lower())   # mirrors render.py::_NORM
LONG_SPAN_WORDS = 20                            # V1 D13: ~>8s of VO on one anchor -> densify heads-up


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
    narr = [ln.strip() for ln in lines[body_start:body_end]
            if ln.strip() and not ln.strip().startswith("[B-ROLL")]
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
    # (the stretch-to-fill dead-hold kill-rule, made deterministic).
    if vo_words:
        runtime_s = vo_words / 150.0 * 60.0      # 150 wpm
        sum_dur = sum(_dur(sh) or 0.0 for sh in shots)
        if sum_dur < 0.85 * runtime_s:
            hard.append(f"[{label}] Σ duration_s {sum_dur:.0f}s < 85% of the ~{runtime_s:.0f}s runtime "
                        f"({vo_words} words / 150wpm) — durations don't cover the VO (stretch-to-fill "
                        f"risk); size shots near real seconds or densify.")
        if len(shots) < runtime_s / 8.0:
            hard.append(f"[{label}] {len(shots)} shots for a ~{runtime_s:.0f}s runtime (< 1 cut / 8s) — "
                        f"too few cuts; densify to the retention cadence.")

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
    txt = re.sub(r'(?ms)^\s*"shot_counts": \{.*?\n\s*\},\n', "", txt)
    return txt


def write_back(path, data, ordered_shots, id2text):
    """Insert vo_text after each vo_ref line + a top-level shot_counts, preserving format."""
    txt = strip_derived(Path(path).read_text(encoding="utf-8"))
    lf = data["long_form"]["shots"]
    n_long = len(lf)
    n_thumb = 1 + len(data.get("thumbnail", {}).get("challengers", []))
    shorts = data.get("shorts", []) or []
    n_short_pieces = len(shorts)
    n_short_shots = sum(len(s.get("shots", [])) for s in shorts)
    sc = (
        '  "shot_counts": {\n'
        '    "_note": "informational only; not consumed by downstream image-gen -- counts of prompt blocks in this file",\n'
        f'    "long_form_shots": {n_long},\n'
        f'    "thumbnail_prompts": {n_thumb},\n'
        f'    "shorts": {n_short_pieces},\n'
        f'    "shorts_shots": {n_short_shots},\n'
        f'    "total_prompts": {n_long + n_thumb + n_short_shots}\n'
        '  },\n'
    )
    txt = re.sub(r'(?m)^(\s*"status": .*\n)', lambda m: m.group(1) + sc, txt, count=1)  # V1 D12: any indent

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


def stage_check(label, shots, hard, soft):
    """Held-stage field checks. Q4: the structural caps of the delta-chain contract — exactly
    one base FIRST and at most 3 deltas — are HARD (they bound drift; lint owns the mechanical
    caps). Timing/changed_elements/contiguity remain SOFT heads-ups. Never touches the vo_ref
    matcher — stage fields are optional metadata layered on top of the anchor contract."""
    runs = []  # contiguous runs of (stage_id, [shots])
    for sh in shots:
        sid = sh.get("stage")
        if runs and sid and runs[-1][0] == sid:
            runs[-1][1].append(sh)
        else:
            runs.append((sid, [sh]))
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


# A3: casting enforcement. A known channel-registry CHARACTER named in a still_prompt but absent from
# the shot's `cast` is an authoring gap — image-gen enumerates figures from `cast`, so an uncast
# registry name renders off-rig (free-drawn) instead of seeded. Derived-only, SOFT (never blocks a
# render). Deliberately scoped to REGISTRY names — a generic capitalized-proper-noun heuristic was
# tried and cut: it fired on the channel name in the house-style suffix and on every place-name
# (Britain, Europe, Mosquito Coast), all noise, no reliable signal. A brand-new (unregistered)
# character is already surfaced by VPW's own `needed_assets` gate, not here.
def _cast_names(shot):
    return {(c.get("character") or "").lower() for c in (shot.get("cast") or []) if c.get("character")}


def casting_check(label, shots, registry_characters, soft):
    reg = {c.lower() for c in (registry_characters or [])}
    for sh in shots:
        prompt = sh.get("still_prompt") or ""
        cast = _cast_names(sh)
        for rc in reg:
            if re.search(r"\b" + re.escape(rc) + r"\b", prompt, re.IGNORECASE) and rc not in cast:
                soft.append(f"[{label}] {sh.get('id','?')}: names registry character '{rc}' in "
                            f"still_prompt but it is not in `cast` — cast it or it renders off-rig.")


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
    r"|(?<!-)\b(?:reading|labell?ed|captioned|titled|that\s+says|which\s+reads)\b",
    re.IGNORECASE)

# "reads as" / "read as" is this project's idiom for LEGIBILITY ("he reads as the
# confident architect", "a king reads as a king"), never for rendered lettering.
_READS_AS = re.compile(r"\breads?\s+as\b", re.IGNORECASE)

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


def word_cap_check(label, prompts, suffix, hard, cap=4):
    """HARD. SKILL rule 9 caps authored in-image lettering at 1-4 words ("1-4 words
    proven"), and the measurement backs it: across 250 authored literals in the two
    videos, the single string that exceeds the cap — Poyais L97's 7-word 'Official
    Shoemaker to the Princess of Poyais' — is also a documented lettering defect
    (logged in that video's manifest under the serif-register drift cluster). Long
    strings are where the engine's per-glyph error rate compounds into an unreadable
    render. The cap was previously prose-only; it is now enforced."""
    for pid, field, prompt in prompts:
        for lit, _s, _e in quoted_literals(prompt, suffix):
            n = len(lit.split())
            if n > cap:
                hard.append(
                    f"[{label}] {pid}.{field}: authored lettering {lit!r} is {n} words (cap {cap}). "
                    f"In-image lettering is redrawn glyph by glyph; past ~4 words the render garbles. "
                    f"Shorten it to the load-bearing words, or carry the meaning in the composition "
                    f"instead of in text.")


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


def _shot_prompts(shots):
    return [(sh.get("id", "?"), "still_prompt", sh.get("still_prompt") or "") for sh in shots]


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print("usage: python lint_shots.py <path-to/shots.json> [--write]")
        return 2
    path = argv[0]
    do_write = "--write" in argv[1:]
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    vdir = Path(path).parent
    script_md = vdir / "script.md"

    # A3: registry character names (minus the base template) for the casting check — best-effort.
    reg_chars = []
    reg_path = None
    for anc in vdir.parents:
        cand = anc / "visual-kit" / "registry" / "registry.json"
        if cand.exists():
            reg_path = cand
            break
    if reg_path:
        try:
            reg_json = json.loads(reg_path.read_text(encoding="utf-8"))
            reg_chars = [c for c in (reg_json.get("characters") or {}) if c != "base"]
        except (ValueError, OSError):
            reg_chars = []

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

    lf_text = lint_piece("long-form", lf_shots, script_md, hard, soft,
                         word_timings=word_timings_for(vo_manifest, "long-form"))
    stage_check("long-form", lf_shots, hard, soft)
    casting_check("long-form", lf_shots, reg_chars, soft)
    suffix = data.get("global_prompt_suffix") or ""
    lf_prompts = _shot_prompts(lf_shots)
    text_supply_check("long-form", lf_prompts, suffix, hard)
    word_cap_check("long-form", lf_prompts, suffix, hard)
    control_leak_check("long-form", lf_prompts, suffix, hard)
    numeral_form_check("long-form", lf_prompts, suffix, soft)
    carried_literal_check("long-form", lf_shots, suffix, hard)
    # The thumbnail is the single most-seen frame of the video — its prompts get
    # the same guard as the shot list.
    th = data.get("thumbnail") or {}
    th_prompts = [("thumbnail.primary", "gen_prompt", (th.get("primary") or {}).get("gen_prompt") or "")]
    th_prompts += [(f"thumbnail.challengers[{i}]", "gen_prompt", (c or {}).get("gen_prompt") or "")
                   for i, c in enumerate(th.get("challengers") or [])]
    text_supply_check("thumbnail", th_prompts, suffix, hard)
    word_cap_check("thumbnail", th_prompts, suffix, hard)
    control_leak_check("thumbnail", th_prompts, suffix, hard)
    ordered += lf_shots
    if lf_text:
        id2text_all.update(lf_text)

    for short in shorts:
        sshots = short.get("shots", [])
        smd = vdir / short.get("file", "")
        piece = Path(short.get("file", "")).stem
        st = lint_piece(f"short:{short.get('file','?')}", sshots, smd, hard, soft,
                        word_timings=word_timings_for(vo_manifest, piece))
        stage_check(f"short:{short.get('file','?')}", sshots, hard, soft)
        casting_check(f"short:{short.get('file','?')}", sshots, reg_chars, soft)
        slabel = f"short:{short.get('file','?')}"
        sprompts = _shot_prompts(sshots)
        # The first_frame IS the short's thumbnail; it carries baked caption text
        # more often than any other prompt in the file, so it must be covered.
        ff = (short.get("first_frame") or {}).get("still_prompt") or ""
        if ff:
            sprompts.append(("first_frame", "still_prompt", ff))
        text_supply_check(slabel, sprompts, suffix, hard)
        word_cap_check(slabel, sprompts, suffix, hard)
        control_leak_check(slabel, sprompts, suffix, hard)
        numeral_form_check(slabel, sprompts, suffix, soft)
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
        print(f"\nWROTE derived vo_text ({len(id2text_all)} shots) + shot_counts. JSON valid.")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
