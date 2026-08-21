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
  python lint_shots.py <path-to/shots.json> [--write] [--fragment]
  --fragment sizes long-form against the covered script prefix; it never writes scope metadata.
Exit 0 = clean (safe to render); 1 = HARD violations (fix before handoff).
"""
import difflib
import json
import re
import sys
from pathlib import Path

_RENDER_SCRIPTS = Path(__file__).resolve().parent.parent.parent / "render-builder" / "scripts"
if str(_RENDER_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_RENDER_SCRIPTS))
from render import match_shots_to_tokens, word_timings_for  # noqa: E402

_BRACKET = re.compile(r"\[[^\]]*\]")            # [B-ROLL]/[PAUSE]/[BEAT] — never spoken
_ITALIC_META = re.compile(r"^\*[^*].*[^*]\*$")  # a WHOLE line in italics = a note about the video
_NORM = lambda w: re.sub(r"[^a-z0-9]+", "", w.lower())   # mirrors render.py::_NORM
LONG_SPAN_WORDS = 20                            # V1 D13: ~>8s of VO on one anchor -> densify heads-up
CADENCE_TARGET_S = 5.0                          # minimal P1 floor: runtime / 5

DEFAULT_WPM = 150.0
_HEADER_WPM = re.compile(r"([\d,]+)\s*(?:gross\s+)?wpm", re.IGNORECASE)
_HEADER_RUNTIME = re.compile(r"Estimated runtime\D{0,4}\s*(\d+):([0-5]\d)", re.IGNORECASE)

SCHEMA_V1 = "faceless-youtube/shots@1"
SCHEMA_V2 = "faceless-youtube/shots@2"
LEGACY_FILE_FIELDS = ("house_style", "needed_assets", "shot_counts", "timing_status")
LEGACY_SHOT_FIELDS = ("from_cue", "beat", "narration_type", "cast", "props")

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
            if ln.strip() and not ln.strip().startswith("[B-ROLL")
            and not _ITALIC_META.match(ln.strip())]
    vo = " ".join(narr)
    spans = [(m.start(), m.end()) for m in _BRACKET.finditer(vo)]
    in_bracket = lambda p: any(a <= p < b for a, b in spans)
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

def lint_piece(label, shots, md_path, hard, soft, word_timings=None, new_plan=True,
               fragment=False):
    """Validate one piece against the REAL VO stream. S3: the HARD check runs against the
    voiceover.manifest word_timings when present (the exact stream + matcher render times
    against); script.md is a soft cross-check AND the source of the derived vo_text spans.
    Returns id2text (for --write) or None."""
    md_exists = Path(md_path).exists()
    vo, md_toks = (None, None)
    if md_exists:
        vo, md_toks = build_vo_stream(md_path)

    if fragment and not shots:
        hard.append(f"[{label}] --fragment requires at least one long_form.shots record.")
        return None
    if fragment and not md_exists:
        hard.append(f"[{label}] --fragment requires script.md; file is absent: {md_path}.")
        return None
    if fragment and not md_toks:
        hard.append(f"[{label}] --fragment requires a non-empty parseable script.md.")
        return None

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

    md_matches = match_shots_to_tokens(shots, md_toks) if md_toks else []
    covered_vo, covered_words = vo, None
    runtime_s, rate = None, None
    if fragment:
        last = md_matches[-1]
        if not last["needle"] or last["start"] is None:
            hard.append(f"[{label}] --fragment cannot resolve the last shot anchor in script.md.")
            return None
        last_i = next(i for i, tok in enumerate(md_toks) if tok[1] == last["start"])
        covered_end_i = last_i + len(last["needle"])
        covered_end = md_toks[covered_end_i][1] if covered_end_i < len(md_toks) else len(vo)
        covered_vo = vo[:covered_end].rstrip()
        covered_words = sum(tok[1] < covered_end for tok in md_toks)
        header_wpm = header_pace(md_path)[0]
        wpm = header_wpm or DEFAULT_WPM
        runtime_s = covered_words / wpm * 60.0
        fallback = "the fallback — the header states no rate" if header_wpm is None else "per the header"
        rate = f"{covered_words} covered script words / {wpm:.0f}wpm, {fallback}"
        soft.append(f"fragment scope: covered {covered_words}/{len(md_toks)} script words")
    elif vo_words:
        wpm, stated_runtime_s = header_pace(md_path) if md_exists else (None, None)
        if wpm:
            runtime_s, rate = vo_words / wpm * 60.0, f"{vo_words} words / {wpm:.0f}wpm, per the header"
        elif stated_runtime_s:
            runtime_s, rate = float(stated_runtime_s), "the header's stated Estimated runtime"
        else:
            runtime_s = vo_words / DEFAULT_WPM * 60.0
            rate = f"{vo_words} words / {DEFAULT_WPM:.0f}wpm, the fallback — the header states no rate"

    if runtime_s is not None:
        sum_dur = sum(_dur(sh) or 0.0 for sh in shots)
        if sum_dur < 0.85 * runtime_s:
            hard.append(f"[{label}] Sum of duration_s {sum_dur:.0f}s < 85% of the ~{runtime_s:.0f}s "
                        f"runtime ({rate}) — durations do not cover the VO; densify.")
        if new_plan and len(shots) < runtime_s / CADENCE_TARGET_S:
            hard.append(f"[{label}] {len(shots)} shots for a ~{runtime_s:.0f}s runtime ({rate}) "
                        f"(< 1 cut / {CADENCE_TARGET_S:.0f}s) — too few cuts; start in the 2–5s band.")
        stage_counts = {}
        for sh in shots:
            if sh.get("stage"):
                stage_counts[sh["stage"]] = stage_counts.get(sh["stage"], 0) + 1
        for sh in shots:
            dur = _dur(sh)
            progressive = bool(sh.get("stage") and stage_counts.get(sh.get("stage"), 0) > 1)
            if (new_plan and dur is not None and dur > 6.0 and not progressive
                    and not str(sh.get("hold_reason") or "").strip()):
                hard.append(f"[{label}] {sh.get('id','?')}: {dur:g}s hold exceeds ~6s without a "
                            "story-needed held state change or non-empty hold_reason.")

    if any(m["start"] is None for m in hard_matches):
        return None

    if word_timings and md_toks:
        for m in match_shots_to_tokens(shots, md_toks):
            if m["needle"] and m["start"] is None:
                soft.append(f"[{label}] {m['id']}: vo_ref matches the VO timings but NOT script.md "
                            f"verbatim — script/VO drift; derived vo_text spans may be approximate.")

    if not md_toks:
        return None
    if any(m["start"] is None for m in md_matches):
        return None
    if md_matches and md_matches[0]["start"] not in (0, None) and md_matches[0]["start"] > 40:
        soft.append(f"[{label}] first shot's anchor isn't at the script start "
                    f"(offset {md_matches[0]['start']}) — opening narration may be uncovered.")
    id2text = tile(shots, md_matches, len(covered_vo), covered_vo)
    for sh in shots:
        wc = len(id2text[sh["id"]].split())
        if wc > LONG_SPAN_WORDS:
            soft.append(f"[{label}] {sh['id']}: covers ~{wc} words on one anchor "
                        f"(>~8s VO) — ensure a story-needed held state change or non-empty "
                        f"hold_reason, or densify (add a cut).")
    return id2text

def strip_derived(txt):
    txt = re.sub(r'(?m)^[ \t]*"vo_text": .*\n', "", txt)
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

def stage_check(label, shots, hard, soft):
    """Held-stage field checks. Q4: the structural caps of the delta-chain contract — exactly
    one base FIRST and at most 3 deltas — are HARD (they bound drift; lint owns the mechanical
    caps). Timing and contiguity remain SOFT heads-ups. Never touches the vo_ref matcher — stage
    fields are optional and zero chains is valid; stage membership is authored by the schema's
    hold-camera criterion; lint enforces structure only."""
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
    for sid, c in seen.items():
        if c > 1:
            soft.append(f"[{label}] stage '{sid}' appears in {c} non-contiguous runs — a stage should be one consecutive run.")

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
                            "still_prompt but it is not in `cast`.")

_TEXT_NOUN = (r"numbers?|numerals?|percentages?|dates?|names?|labels?|tags?"
              r"|captions?|headers?|headings?|headlines?|titles?|signs?"
              r"|placards?|plaques?|banners?|stamps?|inscriptions?|slogans?|prices?"
              r"|calculations?|equations?|formulae|formulas?")

_PROMINENCE = (r"prominent|large|big|giant|huge|oversized|bold|dominant|single"
               r"|lone|one|two|three|four|five|six|seven|eight|nine|ten"
               r"|several|multiple")
_SLOT = re.compile(
    r"\b(?:" + _PROMINENCE + r")\b(?:\s+[\w#'-]+){0,3}?\s+\b(?:" + _TEXT_NOUN + r")\b",
    re.IGNORECASE)

_PHRASE_END = re.compile(
    r"\s*(?:[^\w\s]|$)"                              # punctuation, or end of the body
    r"|\s+\w+(?:ing|ed|er|est|ly)\b"                 # participle / comparative / adverb
    r"|\s+(?:in|on|at|of|to|for|from|over|under|above|below|beside|behind|with|without"
    r"|across|against|into|onto|through|along|is|are|was|were|that|which|who|and|or|but"
    r"|while|as|its|their|his|her)\b",
    re.IGNORECASE)

_INK = (r"painted|written|printed|lettered|emblazoned|inscribed|engraved|spelled"
        r"|stencill?ed|carved|etched|chisell?ed|embossed|scrawled|daubed")
_RENDER_VERB = re.compile(
    r"\b(?:" + _TEXT_NOUN + r")\b[^,;:.]{0,30}?\b(?:" + _INK + r")\b"
    r"|\b(?:" + _INK + r")\b[^,;:.]{0,30}?\b(?:" + _TEXT_NOUN + r")\b"
    r"|\bmarked\s+(?:with|by)\b[^,;:.]{0,30}?\b(?:" + _TEXT_NOUN + r")\b"
    r"|(?<!-)\b(?:reading(?!\s+(?:glasses|spectacles)\b)|labell?ed|captioned|titled|that\s+says|which\s+reads)\b",
    re.IGNORECASE)

_READS_AS = re.compile(r"\bread(?:s|ing)?\s+as\b", re.IGNORECASE)

_QUOTED = re.compile("(?<![A-Za-z])['\"‘“][^'\"‘’“”]{1,60}"
                     "['\"’”]")
_DIGITS = re.compile(r"\d")

_SUPPLY_WINDOW = 60

_ABSENCE = re.compile(
    r"\b(no|without|absent|omit|omitted|free of|clear of|devoid of|never|not"
    r"|blank|empty|unmarked|unlettered|wordless|textless|illegible)\b",
    re.IGNORECASE)

def strip_suffix(prompt, suffix):
    """Compatibility scrubber for legacy files; the current locked value is empty."""
    p = prompt or ""
    s = (suffix or "").strip()
    if not s:
        return p
    if s in p:
        return p.replace(s, " ")
    head = s[:60]
    i = p.find(head)
    return p[:i] if i != -1 else p

_AS_SIMILE = re.compile(r"\bas\s*$", re.IGNORECASE)

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
    spans = _value_spans(body)
    for rx in (_SLOT, _RENDER_VERB):
        for m in rx.finditer(body):
            if rx is _SLOT and not _PHRASE_END.match(body, m.end()):
                continue
            hi = min(len(body), m.end() + _SUPPLY_WINDOW)
            if _supplies_literal(body, spans, m.start(), m.end(), hi):
                continue
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

_CONTROL_LEAK = re.compile(
    r"\b(?:rig\s+form|comedy\s+off|humou?r\s+off|gravity\s+register"
    r"|palette\s+turn|register\s+off|style\s+token|shot\s+class)\b",
    re.IGNORECASE)

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
    """HARD L-3: every authored in-image literal is at most four words."""
    for pid, field, prompt in prompts:
        for lit, _s, _e in quoted_literals(prompt, suffix):
            n = len(lit.split())
            if n > cap:
                hard.append(
                    f"[{label}] {pid}.{field}: authored lettering {lit!r} is {n} words "
                    f"(cap {cap}). Shorten it or carry the meaning in the composition.")

def script_vocab(md_path):
    """Every word the script uses, lowercased, for place-inventory validation."""
    try:
        txt = Path(md_path).read_text(encoding="utf-8")
    except OSError:
        return set()
    return {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'-]*", txt)}

_NEG_NOUN = re.compile(r"\b(?:no|without)\s+((?:[a-z]+-)?[a-z]+)\b", re.IGNORECASE)
_NEG_STOP = frozenset(
    "longer more other less better worse further fewer sooner else matter way "
    "doubt bigger smaller taller wider".split())
_ANATOMY = frozenset(
    "nose noses nostril nostrils ear ears tooth teeth eyebrow eyebrows lash lashes "
    "eyelash eyelashes pupil pupils iris irises finger fingers thumb thumbs toe toes "
    "lip lips tongue chin chins neck necks wrinkle wrinkles freckle freckles "
    "detail details face faces".split())
_SENTENCE_SPLIT = re.compile(r"(?<=[.;!?])\s+")

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

def blank_backticked(body):
    """`body` with every backticked VOCABULARY span blanked to spaces of equal length.

    Offset-preserving on purpose: `carried_literal_check` scans and reports by index into
    this same string, so deleting the spans instead would shift every later match.

    WHY THIS EXISTS. A backticked slug is a CONTROL TOKEN naming a registry asset — it is
    resolved to a file by `forge.py` and never reaches the artwork. Scanning it as prose
    made a place's own owner literal collide with its own cast slug: `place_owner:
    "MINISCRIBE"` is word-boundary-matched inside `` `miniscribe-rep` ``, so naming the
    company's personified rep inside the company's branded place HARD-failed unless the
    prompt re-quoted 'MINISCRIBE' within the 60-char supply window. Measured consequences on
    the 2026-08-04 fresh fifth: it forced the payload into the identity zone on L28 (the
    ordering law's worst case in the file) and it bent a CASTING decision on L29 — a lint
    rule steering casting, and pushing an author to draw signage into frames that do not
    contain the sign, which is the fabrication class the text laws exist to prevent."""
    out = list(body or "")
    for m in _BACKTICK.finditer(body or ""):
        for i in range(m.start(), m.end()):
            out[i] = " "
    return "".join(out)

def carried_literal_check(label, shots, suffix, hard):
    """HARD. Within a stage, a literal established on an earlier frame must be
    RE-QUOTED verbatim on any later frame that mentions it — never restated as a
    lowercase description. This is the CHECKIG defect, and it is the reason Class B
    is an authoring fault: L12 alone in its chain wrote 'the checking passbook'
    where L11/L13/L14 wrote labelled 'CHECKING' / 'SAVINGS' / 'ONLINE'.

    The scan runs over the prompt with backticked vocabulary BLANKED (`blank_backticked`):
    a control token is resolved to a seed file and never drawn, so a literal fragment
    inside one is not a mention of that literal.

    A mention is excused when it carries its OWN quoted value nearby (reusing the
    Class-A supply test, so 'a marker card labelled "ONLINE"' does not flag the
    established literal 'CARD'). Scoped to contiguous stage runs — a fresh scene
    redraws nothing and inherits nothing.

    ONE exception to the stage scoping: a place's `place_owner` literal (the plate's
    declared owner cue) is established for every shot of that PLACE, across stage runs.
    A place is one set with one sign on the wall, so a later in-place shot that redraws
    the sign is redrawing an established literal by definition, whatever chain it sits
    in — that carry is the place-owner law's own promise (shots-schema `place_owner`),
    enforced here rather than in a second, parallel carry mechanism."""
    owner_of = {place: plate.get("place_owner") for place, plate, _g, _q in place_groups(shots)
                if isinstance(plate.get("place_owner"), str) and plate.get("place_owner").strip()}
    runs = []
    for sh in shots:
        sid = sh.get("stage")
        if runs and sid and runs[-1][0] == sid:
            runs[-1][1].append(sh)
        else:
            runs.append((sid, [sh]))
    for stage_id, grp in runs:
        established = []                      # literals quoted on EARLIER frames of this stage
        for sh in grp:
            owner = owner_of.get(sh.get("place"))
            if owner and owner.strip() not in established:
                established.append(owner.strip())   # the place's own sign, established by its plate
            body = blank_backticked(strip_suffix(sh.get("still_prompt") or "", suffix))
            spans = _value_spans(body)
            own = quoted_literals(sh.get("still_prompt") or "", suffix)
            for lit in established:
                for m in re.finditer(r"\b" + re.escape(lit) + r"\b", body, re.IGNORECASE):
                    if m.group() == lit:
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

_RIG_CLAUSE = re.compile(
    r"FULL base family rig"
    r"|CROWD RIG\s*:"
    r"|non-recurring person"
    r"|drawn as follows"
    r"|the identical rig the named cast holds",
    re.IGNORECASE)

FIGURES_KEYS = ("crowd",)
_PLACE_ANCHOR = re.compile(r"assets/scenes/[A-Za-z0-9][A-Za-z0-9._-]*\.png\Z")

def place_anchor_check(label, objs, hard):
    """Structural contract for forge's optional, video-local approved-place seed.

    This owns only authoring shape and legal-role placement. File existence and resolved-path
    containment belong to forge, which is the runtime that opens the seed.

    C-5 widened this from base-only to any NON-DELTA shot: a delta continues its own base's held
    scene (a different seed, already covered by the chain parent), but a standalone place-first
    shot with no `stage` at all is exactly the single-use-place case C-4's conditional plate law
    legalizes, and it needs to be able to carry a human-picked place_anchor too.

    SANCTIONED MIRROR of forge's `cmd_batch` delta refusal. The canonical law sentence is the
    parenthetical below - "a delta continues its own base's held scene via the chain parent;
    `place_anchor` is a different seed, for a base or standalone shot" - byte-identical at both
    sites, the same precedent seam 3 set for the cross-place law (lint's message shape is the
    canonical one; each side keeps only its own context prefix). `stage_role` is compared
    case-normalized the way forge normalizes it
    (`str(shot.get("stage_role","")).lower()`), so a `"Delta"` cannot pass here at $0 and then be
    hard-refused by forge at batch time - which is the entire purpose of a mirror."""
    for pid, sh in objs:
        if "place_anchor" not in sh:
            continue
        anchor = sh.get("place_anchor")
        if not isinstance(anchor, str) or not _PLACE_ANCHOR.fullmatch(anchor):
            hard.append(
                f"[{label}] {pid}: `place_anchor` must be a non-empty normalized video-relative "
                "`assets/scenes/<file>.png` path (no absolute, traversal, or cross-video path).")
            continue
        if str(sh.get("stage_role") or "").lower() == "delta":
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
                        f"closed: {list(FIGURES_KEYS)!r} (shots-schema.md); forge.py hard-rejects "
                        f"anything outside its own known set too (SystemExit), so a misspelled key "
                        f"fails loud at gen time instead of silently dropping the rig clause.")
        if "crowd" in fig:
            if not isinstance(fig["crowd"], bool):
                hard.append(f"[{label}] {pid}: `figures.crowd` is {fig['crowd']!r}, expected true "
                            f"or false (it gates the section 2d CROWD-RIG clause).")
            elif fig["crowd"] is False:
                soft.append(f"[{label}] {pid}: `figures.crowd` is false - omit the key instead; "
                            f"the spec says present-and-true or absent.")

_NON_MATERIAL_DELTA = re.compile(
    r"\b(?:cosmetic|detail(?:-only)?|label(?:-only)?|reposition(?:-only)?|tiny|decorative|ornamental)\b"
    r"|\bmoves?\s+(?:to|onto)\b",
    re.IGNORECASE,
)

def delta_feasibility_check(label, objs, hard):
    """HARD: one non-empty semantic change; cosmetic/detail/label/reposition no-ops refuse."""
    for pid, sh in objs:
        if sh.get("stage_role") != "delta":
            continue
        changes = sh.get("changed_elements")
        if not isinstance(changes, list) or len(changes) != 1 or not isinstance(changes[0], str) or not changes[0].strip():
            hard.append(
                f"[{label}] {pid}: delta must declare exactly one non-empty `changed_elements` "
                "string naming a visually distinct, story-needed transformation.")
            continue
        if _NON_MATERIAL_DELTA.search(changes[0]):
            hard.append(
                f"[{label}] {pid}: delta change {changes[0]!r} is a cosmetic/detail/label/"
                "reposition no-op; author one visually distinct, story-needed state change or hard-cut.")

def channel_suffix(vdir):
    """Return the style-bible's canonical suffix, including empty; None means no visual kit."""
    if not vdir:
        return None
    bible = Path(vdir).parent.parent / "visual-kit" / "style-bible.md"
    try:
        md = bible.read_text(encoding="utf-8")
    except OSError:
        return None
    out, seeking = [], False
    for ln in md.splitlines():
        if not seeking:
            if ln.lstrip("*").startswith("`global_prompt_suffix`"):
                seeking = True
            continue
        if ln.strip().startswith(">"):
            out.append(ln.strip()[1:].strip())
        elif ln.lstrip().startswith("#"):
            break
        elif out:
            break
    return " ".join(out).strip()

def suffix_one_voice_check(suffix, hard, vdir=None):
    """HARD byte equality, with empty file data locked to an empty Bible declaration."""
    canonical = channel_suffix(vdir)
    if canonical is None:
        return
    suffix = (suffix or "").strip()
    if suffix != canonical:
        hard.append(
            "[suffix] global_prompt_suffix does not match style-bible.md verbatim.\n"
            f"      file:    {suffix}\n"
            f"      channel: {canonical}")

_PLACE_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

_PLACELESS_SHOT_CLASSES = frozenset((
    "symbolic-stand-in-object", "number-glued-to-object", "map-plan-view",
    "physicalized-imbalance", "register-shift-infographic"))

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
                        "first_frame never do (C-3); they run seedless under the bible "
                        "descriptor unconditionally.")

def place_inventory_check(label, objs, vocab, hard):
    """HARD. Every declared place must anchor to the script's vocabulary."""
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

_PLATE_ELIGIBLE_SOURCES = ("ai-gen", "hybrid")

def _plate_eligible(sh):
    return sh.get("source", "ai-gen") in _PLATE_ELIGIBLE_SOURCES

def place_groups(shots):
    """THE definition of a place's plate - one definition, used by every place law here.

    **The plate of a place is the FIRST-IN-FILE GENERATED shot declaring that place** (source
    `ai-gen`/`hybrid`/absent - absent defaults to `ai-gen`, same as forge). Not "the first
    shot", not "the first shot forge happens to emit": one rule, decidable from the authored
    file alone, so lint and the author always agree about which shot the plate laws are
    talking about. A place whose shots are declared but none of them generated (pure
    stock/chart/screencap/archival) has no plate at all - forge builds nothing for it either,
    so no plate law applies.

    **A place RECURS when the file REVISITS it after leaving** — its shots form two or more
    non-contiguous runs. That is the qualification test (or a plate declaring `place_owner`;
    a branded set records its ownership whatever its visit count).

    The old test was "counts >=2 shots declared", which read an unbroken single visit of two
    adjacent shots as a recurrence and demanded a dedicated cast-free plate frame for a set
    the video never comes back to — pure generation cost. An unbroken single visit is a
    STAGE: its chain base already IS the place-first frame every later shot of the run seeds,
    so nothing is unanchored. The circularity the old wording carried (SKILL.md said "declare
    `place` on every shot in a recurring set" while the plate law defined recurrence as
    "declared by >=2 shots") is gone: recurrence is a property of the SET's visits, decidable
    from file order alone, never of the author's own declaration count.

    Forge's plate is the MECHANICAL mirror of this one: `forge.py cmd_batch` marks the
    slate that ended up with zero seeds (`plate = not seeds`), after skipping non-generated
    shots the same way `_plate_eligible` does above. The two coincide only when the
    AUTHORING is right - the place's first GENERATED shot has to be the one with no cast to
    seed - and asserting that coincidence on the authoring side, at $0, is exactly
    `place_plate_check`'s job. Lint never re-derives forge's marker and forge never
    re-checks the authoring.

    Returns [(place, plate, group, qualifying)] in first-declaration order."""
    groups, runs, prev = {}, {}, None
    for sh in shots:
        place = sh.get("place")
        place = place if isinstance(place, str) and place.strip() else None
        if place:
            groups.setdefault(place, []).append(sh)
            if place != prev:
                runs[place] = runs.get(place, 0) + 1       # a fresh VISIT to this set
        prev = place
    out = []
    for place, grp in groups.items():
        plate = next((sh for sh in grp if _plate_eligible(sh)), None)
        if plate is None:
            continue          # nothing generated for this place - forge builds no plate either
        qualifying = runs[place] >= 2 or "place_owner" in plate
        out.append((place, plate, grp, qualifying))
    return out

def place_plate_check(label, shots, chars, hard):
    """C-4 HARD. A QUALIFYING place's plate (see `place_groups`) declares zero SEEDED
    figures - named cast - and is not a stage `delta`.

    Why those two: the plate is the frame every other shot in the place seeds from, so
    whatever it contains bleeds into all of them. A seeded figure on the plate means every
    later in-place shot seeds a figure-BEARING rendered scene as its place frame - the
    content-bleed path the doctrine limits to plates by design - and a delta plate would
    make the place's root frame a shot that itself inherits a chain parent.

    A non-qualifying place (one unbroken visit, no `place_owner`) is exempt: its first
    generated shot is its own place-first frame and runs seedless, same as before the reset.

    With no figure vocabulary resolvable (`chars` empty - no registry, no Pass-1 manifest)
    the figure half degrades silently, the same way seat_support_check and
    two_cast_presence_check do; the delta half still applies."""
    for place, plate, grp, qualifying in place_groups(shots):
        if not qualifying:
            continue
        named = _named_chars(plate.get("still_prompt") or "", chars) if chars else []
        if named:
            hard.append(
                f"[{label}] place {place!r}: its plate {plate.get('id', '?')!r} (the first "
                f"generated shot declaring this place, and this place qualifies for the plate "
                f"law - the file revisits it, or its plate declares place_owner "
                f"({'declared' if 'place_owner' in plate else 'absent'}), {len(grp)} shot(s)) "
                f"names {', '.join('`' + c + '`' for c in named)}. A plate declares ZERO SEEDED "
                f"figures (C-4): every other shot in the place "
                f"seeds it, so a figure on the plate bleeds into all of them. Author a figure-free "
                f"establishing frame first, or move this shot after one.")
        if str(plate.get("stage_role") or "").lower() == "delta":
            hard.append(
                f"[{label}] place {place!r}: its plate {plate.get('id', '?')!r} is a stage "
                f"`delta`. A plate is the place's root frame - it cannot itself inherit a chain "
                f"parent (C-4). Make the place's first shot a base/standalone shot.")

def place_owner_check(label, shots, suffix, hard):
    """HARD, forced choice. Every place's plate (see `place_groups`) declares EXACTLY ONE
    of `place_owner: '<LITERAL>'` or `owner_ambiguity: true`. Neither is a hard failure;
    both is a hard failure.

    This replaces the old "if someone quoted a name somewhere, require it on the plate"
    inference, which suppressed exactly the case it existed to catch: a place whose author
    simply forgot the owner cue quoted nothing anywhere, so the check stayed silent - which
    IS Daniel's failure #6 (office ownership invisible on the establishing frame). A forced
    choice cannot be satisfied by silence.

    `place_owner` is per-video DATA, never a skill constant, and it is not a second
    lettering mechanism: the declared literal must be QUOTED in the plate's own
    `still_prompt`, so the ordinary word cap and L-1 carry apply."""
    for place, plate, grp, _qualifying in place_groups(shots):
        pid = plate.get("id", "?")
        owner = plate.get("place_owner")
        has_owner = "place_owner" in plate
        ambiguous = plate.get("owner_ambiguity") is True
        if has_owner and ambiguous:
            hard.append(
                f"[{label}] place {place!r}: plate {pid!r} declares BOTH `place_owner` {owner!r} "
                f"and `owner_ambiguity: true`. Exactly one: either the owner is legible on the "
                f"establishing frame, or its absence is the intended read. Drop whichever is not "
                f"the shot you authored.")
        elif not has_owner and not ambiguous:
            hard.append(
                f"[{label}] place {place!r}: plate {pid!r} declares neither `place_owner` nor "
                f"`owner_ambiguity: true`. Every place records an ownership decision on its plate "
                f"- author a visible owner cue (a plaque/nameplate/door-glass literal, quoted in "
                f"this shot's still_prompt, and name it here as `place_owner`), or declare "
                f"`owner_ambiguity: true` if unmarked ownership is the intended read. Ownership "
                f"invisible on the establishing frame with no decision recorded is audit failure "
                f"#6.")
        elif has_owner:
            if not isinstance(owner, str) or not owner.strip():
                hard.append(f"[{label}] place {place!r}: plate {pid!r} `place_owner` is {owner!r}, "
                            f"expected the owner literal as a non-empty string (e.g. \"MINISCRIBE\").")
            else:
                lits = {lit for lit, _s, _e in quoted_literals(plate.get("still_prompt") or "", suffix)}
                if owner.strip() not in lits:
                    hard.append(
                        f"[{label}] place {place!r}: plate {pid!r} declares `place_owner` "
                        f"{owner!r} but its still_prompt never quotes that literal "
                        f"({sorted(lits)!r} quoted instead). The owner cue is a DRAWN cue: quote "
                        f"it verbatim on the plate the way any other in-image literal is authored, "
                        f"or declare `owner_ambiguity: true` instead.")
        for sh in grp:
            if sh is plate:
                continue
            for field in ("place_owner", "owner_ambiguity"):
                if field in sh:
                    hard.append(
                        f"[{label}] {sh.get('id', '?')}: declares `{field}` but is not the plate of "
                        f"place {place!r} ({pid!r} is). The ownership decision is recorded once, on "
                        f"the place's first shot; a later shot re-quoting the cue is ordinary L-1 "
                        f"carry, not a second declaration.")

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

def _seed_key(sh):
    return sh.get("place") or sh.get("stage") or sh.get("id")

def delta_parent_of(shots):
    """`{shot id -> the shot whose frame a `stage_role: delta` inherits}`, forge's binding.

    Only deltas appear; a delta whose key has no earlier shot is absent (forge does not
    treat it as a delta beat at all)."""
    out, last = {}, {}
    for sh in shots:
        key = _seed_key(sh)
        if str(sh.get("stage_role") or "").lower() == "delta" and key in last:
            out[sh.get("id")] = last[key]
        last[key] = sh
    return out

LETTERING_EXEMPLAR = "lettering-marker-italic"

def lettering_route_check(label, objs, suffix, hard):
    """HARD. A text-bearing shot whose `assets` block routes no lettering exemplar.

    §5 is LOCKED: the marker-capitals exemplar seeds every gen that draws in-world text, and
    without it a literal renders in whatever register the engine reaches for - the clean
    digital font the bible forbids. The 2026-08-04 fresh fifth seeded it on 0 of its 14
    text-bearing frames (the problem-era file managed 12/12) purely because the file carried
    no `assets` blocks at all.

    WHERE THE LAW IS ENFORCED, AND WHY THIS CHECK IS THE SECOND HALF, NOT THE FIRST.
    A LOCKED style law must not depend on an author remembering a field, so the guarantee is
    a DERIVATION: `forge.py cmd_batch` appends the exemplar to any scene whose prompt carries
    a quoted literal, exactly the way it already derives the crowd rig from `figures.crowd`.
    That is the one refusal-free route, and it covers the whole authoring window - `assets`
    is written by image-generation's Pass 1, so a freshly authored file has none and this
    check is correctly silent on it.

    What this check owns is the window AFTER Pass 1, where an `assets` block exists and can
    disagree with the derivation: a hand-edited or partial tag map that drops the exemplar
    from a text-bearing shot, or an `assets_omitted` entry that deliberately suppresses it.
    Both are decidable here, at $0, and neither is visible to forge as an error."""
    for pid, sh in objs:
        if not isinstance(sh, dict):
            continue
        assets = sh.get("assets")
        omitted = sh.get("assets_omitted") or ()
        if not isinstance(assets, dict) or not assets:
            continue          # pre-Pass-1: forge's derivation is the route
        if not quoted_literals(sh.get("still_prompt") or "", suffix):
            continue
        if LETTERING_EXEMPLAR in assets and LETTERING_EXEMPLAR not in omitted:
            continue
        hard.append(
            f"[{label}] {pid}: draws in-world text but its `assets` block routes no "
            f"{LETTERING_EXEMPLAR!r} seed"
            + (" (it is listed in `assets_omitted`)" if LETTERING_EXEMPLAR in omitted else "")
            + f". style-bible.md §5 is LOCKED - that exemplar seeds every text-bearing gen, "
            f"and without it the literal renders in a clean digital font instead of the "
            f"marker capitals the register requires. Add it to `assets`, or delete the "
            f"partial block and let `forge.py` derive the route.")

def interaction_cast_check(label, objs, chars, interactions, hard):
    """HARD: interaction geometry needs two seeded figures and a fresh base."""
    if not chars or not interactions:
        return
    for pid, sh in objs:
        prompt = sh.get("still_prompt") or ""
        named = [n for n in (m.group(1) for m in _BACKTICK.finditer(prompt)) if n in interactions]
        if not named:
            continue
        slugs = sorted(set(named))
        cast = _named_chars(prompt, chars)
        if len(cast) < 2:
            hard.append(
                f"[{label}] {pid}: authors the interaction template "
                f"{', '.join('`' + s + '`' for s in slugs)} with "
                f"{len(cast)} seeded figure(s) ({', '.join('`' + c + '`' for c in cast) or 'none'}). "
                f"An interaction template is two blank mannequins carrying clasp geometry and "
                f"eye-line - it resolves the contact BETWEEN two bodies and binds to neither "
                f"alone. Name both figures, or stage the gesture in prose and drop the slug.")
        if str(sh.get("stage_role") or "").lower() == "delta":
            hard.append(
                f"[{label}] {pid}: authors the interaction template "
                f"{', '.join('`' + s + '`' for s in slugs)} on a stage `delta`. A two-figure "
                f"delta seeds parent + both canonicals + one proved primitive, with no slot "
                f"for the template; when contact begins a story-needed held state change, stage the "
                f"fresh two-figure shot as its BASE. Author the "
                f"contact geometry on the base.")

def video_assets(data, vdir, kinds=None):
    """Named assets of selected kinds, or every declared asset when ``kinds`` is omitted."""
    names = set()
    if data.get("channel"):
        try:
            reg = json.loads((vdir.parent.parent / "visual-kit" / "registry"
                              / "registry.json").read_text(encoding="utf-8"))
            names |= {a["name"] for a in reg.get("assets", [])
                      if (kinds is None or a.get("kind") in kinds) and a.get("name")}
        except (OSError, ValueError, KeyError):
            pass
    try:
        mani = json.loads((vdir / "assets" / "library" / "manifest.json").read_text(encoding="utf-8"))
        names |= {e["name"] for e in mani.get("assets", [])
                  if (kinds is None or e.get("kind") in kinds) and e.get("name")}
    except (OSError, ValueError, KeyError):
        pass
    return names

PRIMITIVE_KINDS = {"pose", "action", "expression", "interaction", "costume"}
_ELEVATION_FLAG = re.compile(r"\bELEVATION\b[^\n]*\bprimitive\s+needed\b", re.IGNORECASE)

def video_primitives(data, vdir):
    return video_assets(data, vdir, PRIMITIVE_KINDS)

def video_interactions(data, vdir):
    return video_assets(data, vdir, {"interaction"})

def primitive_catalog_check(label, objs, token_catalog, hard):
    """R5 HARD: every backticked token resolves; an elevation flag keeps its shot blocked."""
    for pid, sh in objs:
        prompt = sh.get("still_prompt") or sh.get("gen_prompt") or ""
        unresolved = sorted({token for token in _BACKTICK.findall(prompt)
                             if token not in token_catalog})
        if unresolved:
            hard.append(
                f"[{label}] {pid}: backticked token(s) {unresolved!r} do not resolve in the "
                "channel registry or approved video library. Snap to the nearest catalog token; if none "
                "is close, remove the token and elevate the blocked shot until one is minted + approved.")
        notes = sh.get("notes") or ""
        if _ELEVATION_FLAG.search(notes):
            hard.append(f"[{label}] {pid}: explicit primitive ELEVATION is unresolved — shot remains "
                        "BLOCKED until the primitive is minted, approved, and present in the catalog.")

def bool_field_check(label, objs, field, hard):
    """HARD, shape only. A non-boolean value silently fails every `... is True` test
    elsewhere in this file (for example place_owner_check's `owner_ambiguity`) - shape drift here is a silent false negative downstream."""
    for pid, sh in objs:
        if field in sh and not isinstance(sh[field], bool):
            hard.append(f"[{label}] {pid}: `{field}` is {sh[field]!r}, expected true or false.")

_BACKTICK = re.compile(r"`([^`]+)`")

BASE_TEMPLATE = "base"

def _named_chars(prompt, chars):
    """Seeded figures backticked in `prompt`, in first-appearance order - every one of them
    NAMED CAST, since `video_chars` drops the rig template and crowd carries no slug."""
    out = []
    for m in _BACKTICK.finditer(prompt or ""):
        n = m.group(1)
        if n in chars and n not in out:
            out.append(n)
    return out

def video_chars(data, vdir):
    """The working SEEDED-FIGURE vocabulary for THIS video: the channel `registry.json`'s
    PROMOTED characters, plus this video's own Pass-1 `assets/library/manifest.json`
    identities - mirroring forge.py's `merge_vocabulary`. A video's own lead
    (`qt-wiles`, `brick-foreman` ...) never reaches the channel registry (registry
    promotion rule, kept, see shots-schema.md/forge.py), so registry-only lookup
    misses exactly the cast C-7/C-8 exist for. Best-effort: either source
    missing/unreadable degrades that half silently, never a hard failure - this is a
    figure-BINDING aid, not the name-resolution gate the critic already owns (question 3).

    `base` is DROPPED: it is the shared rig template, not a character, and it is never cast
    (visual-grammar §2 - every human in frame is NAMED CAST or CROWD). It was kept here from
    2026-08-06 to 2026-08-12 so the figure laws could see the seeded-performer tier; that tier
    is abolished, `shot_cast` excludes `base` again, and forge refuses a `base` casting by name
    (`seeding_law_violations`) - so a name no law may bind must not enter this vocabulary."""
    chars = set()
    channel = data.get("channel")
    if channel:
        reg_path = vdir.parent.parent / "visual-kit" / "registry" / "registry.json"
        try:
            reg = json.loads(reg_path.read_text(encoding="utf-8"))
            chars |= set(reg.get("characters", {}).keys())
        except (OSError, ValueError):
            pass
    chars.discard(BASE_TEMPLATE)
    mani_path = vdir / "assets" / "library" / "manifest.json"
    try:
        mani = json.loads(mani_path.read_text(encoding="utf-8"))
        for e in mani.get("assets", []):
            if e.get("kind") in ("identity", "character") and e.get("name"):
                chars.add(e["name"])
    except (OSError, ValueError):
        pass
    return chars

def declared_cast(data, vdir):
    """The video-local closed cast declaration VPW reuses during scoped repair."""
    try:
        log = (vdir / "vpw-log.md").read_text(encoding="utf-8")
    except OSError:
        return set()
    section = re.search(r"^## Closed named cast\s*$([\s\S]*?)(?=^## |\Z)", log, re.MULTILINE)
    return set(_BACKTICK.findall(section.group(1))) if section else set()

def video_token_catalog(data, vdir):
    """Every declared backtick namespace: channel/video assets plus the video-local cast list."""
    return video_chars(data, vdir) | declared_cast(data, vdir) | video_assets(data, vdir)

def _shot_prompts(shots):
    return [(sh.get("id", "?"), "still_prompt", sh.get("still_prompt") or "") for sh in shots]


def occupancy_diagnostics(label, shots, id2text, chars, soft):
    """Report occupancy evidence from structured fields and executable cast tokens only."""
    id2text = id2text or {}
    zero_run = []

    def executable(sh):
        return [slug for slug in _BACKTICK.findall(sh.get("still_prompt") or "")
                if slug in chars]

    def flush_zero_run():
        if not zero_run:
            return
        ids = [sh.get("id", "?") for sh in zero_run]
        duration = sum(_dur(sh) or 0.0 for sh in zero_run)
        refs = [str(sh.get("vo_ref") or "") for sh in zero_run]
        vo = " | ".join(id2text.get(sid, "") for sid in ids)
        clipped = vo if len(vo) <= 180 else vo[:177] + "..."
        soft.append(
            f"[{label}] occupancy zero-human run: ids={','.join(ids)}; duration={duration:g}s; "
            f"vo_refs={refs!r}; vo={clipped!r}"
        )
        zero_run.clear()

    for index, sh in enumerate(shots):
        sid = sh.get("id", "?")
        slugs = executable(sh)
        crowd = (sh.get("figures") or {}).get("crowd") is True
        if not slugs and not crowd:
            zero_run.append(sh)
        else:
            flush_zero_run()
        if 1 <= len(slugs) <= 2:
            soft.append(
                f"[{label}] occupancy cast: id={sid}; executable={','.join(slugs)}; "
                f"assets=ready; base_role={sh.get('stage_role') == 'base'}"
            )
        if (sh.get("figures") or {}).get("crowd") is True:
            prev_id = shots[index - 1].get("id") if index else None
            next_id = shots[index + 1].get("id") if index + 1 < len(shots) else None
            soft.append(
                f"[{label}] occupancy crowd: id={sid}; vo={id2text.get(sid, '')!r}; "
                f"prev={prev_id or 'START'}; next={next_id or 'END'}"
            )
    flush_zero_run()


def main(argv):
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass                                     # captured/wrapped stdout — nothing to do
    if not argv or argv[0] in ("-h", "--help"):
        print("usage: python lint_shots.py <path-to/shots.json> [--write] [--fragment]")
        return 2
    path = argv[0]
    flags = set(argv[1:])
    unknown = flags - {"--write", "--fragment"}
    if unknown:
        print(f"HARD: unknown option(s): {', '.join(sorted(unknown))}")
        return 2
    do_write = "--write" in flags
    fragment = "--fragment" in flags
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    vdir = Path(path).parent
    script_md = vdir / "script.md"
    chars = video_chars(data, vdir)          # C-7/C-8: this video's seeded-figure vocabulary
    interactions = video_interactions(data, vdir)   # the two-figure template vocabulary
    token_catalog = video_token_catalog(data, vdir) # R5: closed declared backtick vocabulary

    vo_manifest_path = vdir / "assets" / "voiceover.manifest.json"
    vo_manifest = (json.loads(vo_manifest_path.read_text(encoding="utf-8"))
                   if vo_manifest_path.exists() else {"pieces": []})

    lf_shots = data.get("long_form", {}).get("shots", [])
    shorts = data.get("shorts", []) or []

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
                         word_timings=word_timings_for(vo_manifest, "long-form"),
                         new_plan=strict_schema, fragment=fragment)
    if lf_text is not None:
        occupancy_diagnostics("long-form", lf_shots, lf_text, chars, soft)
    stage_check("long-form", lf_shots, hard, soft)
    casting_check("long-form", lf_shots, chars, soft)
    suffix = data.get("global_prompt_suffix") or ""
    suffix_one_voice_check(suffix, hard, vdir)   # C-2(a): empty/absent stays locked to its channel home
    lf_prompts = _shot_prompts(lf_shots)
    lf_vocab = script_vocab(script_md)
    lf_objs = [(sh.get("id", "?"), sh) for sh in lf_shots]
    text_supply_check("long-form", lf_prompts, suffix, hard)
    word_cap_check("long-form", lf_prompts, suffix, hard)
    control_leak_check("long-form", lf_prompts, suffix, hard)
    shot_class_check("long-form", lf_shots, hard, soft, strict_schema)
    figures_check("long-form", lf_objs, hard, soft)
    primitive_catalog_check("long-form", lf_objs, token_catalog, hard)
    delta_feasibility_check("long-form", lf_objs, hard)
    place_anchor_check("long-form", lf_objs, hard)
    place_key_check("long-form", lf_objs, hard)
    place_shot_class_exempt_check("long-form", lf_shots, hard)
    place_inventory_check("long-form", lf_objs, lf_vocab, hard)
    place_plate_check("long-form", lf_shots, chars, hard)
    place_owner_check("long-form", lf_shots, suffix, hard)
    place_anchor_same_place_check("long-form", lf_shots, hard)
    lettering_route_check("long-form", lf_objs, suffix, hard)
    interaction_cast_check("long-form", lf_objs, chars, interactions, hard)
    bool_field_check("long-form", lf_objs, "hard_cut", hard)
    bool_field_check("long-form", lf_objs, "owner_ambiguity", hard)
    numeral_form_check("long-form", lf_prompts, suffix, soft)
    carried_literal_check("long-form", lf_shots, suffix, hard)
    th = data.get("thumbnail") or {}
    th_prompts = [("thumbnail.primary", "gen_prompt", (th.get("primary") or {}).get("gen_prompt") or "")]
    th_prompts += [(f"thumbnail.challengers[{i}]", "gen_prompt", (c or {}).get("gen_prompt") or "")
                   for i, c in enumerate(th.get("challengers") or [])]
    th_objs = [("thumbnail.primary", th.get("primary") or {})]
    th_objs += [(f"thumbnail.challengers[{i}]", c or {}) for i, c in enumerate(th.get("challengers") or [])]
    text_supply_check("thumbnail", th_prompts, suffix, hard)
    word_cap_check("thumbnail", th_prompts, suffix, hard)
    control_leak_check("thumbnail", th_prompts, suffix, hard)
    place_context_exempt_check("thumbnail", th_objs, hard)
    primitive_catalog_check("thumbnail", th_objs, token_catalog, hard)
    ordered += lf_shots
    if lf_text:
        id2text_all.update(lf_text)

    for short in shorts:
        sshots = short.get("shots", [])
        smd = vdir / short.get("file", "")
        piece = Path(short.get("file", "")).stem
        st = lint_piece(f"short:{short.get('file','?')}", sshots, smd, hard, soft,
                        word_timings=word_timings_for(vo_manifest, piece), new_plan=strict_schema)
        stage_check(f"short:{short.get('file','?')}", sshots, hard, soft)
        casting_check(f"short:{short.get('file','?')}", sshots, chars, soft)
        slabel = f"short:{short.get('file','?')}"
        sprompts = _shot_prompts(sshots)
        ff_obj = short.get("first_frame") or {}
        ff = ff_obj.get("still_prompt") or ""
        if ff:
            sprompts.append(("first_frame", "still_prompt", ff))
        svocab = script_vocab(smd) | lf_vocab
        sshot_objs = [(sh.get("id", "?"), sh) for sh in sshots]
        text_supply_check(slabel, sprompts, suffix, hard)
        word_cap_check(slabel, sprompts, suffix, hard)
        control_leak_check(slabel, sprompts, suffix, hard)
        shot_class_check(slabel, sshots, hard, soft, strict_schema)
        figures_check(slabel, sshot_objs + ([("first_frame", ff_obj)] if ff_obj else []), hard, soft)
        primitive_catalog_check(slabel, sshot_objs + ([("first_frame", ff_obj)] if ff_obj else []),
                                token_catalog, hard)
        delta_feasibility_check(slabel, sshot_objs, hard)
        place_anchor_check(slabel, sshot_objs + ([("first_frame", ff_obj)] if ff_obj else []), hard)
        place_key_check(slabel, sshot_objs, hard)
        place_shot_class_exempt_check(slabel, sshots, hard)
        place_inventory_check(slabel, sshot_objs, svocab, hard)
        place_plate_check(slabel, sshots, chars, hard)
        place_owner_check(slabel, sshots, suffix, hard)
        place_anchor_same_place_check(slabel, sshots, hard)
        lettering_route_check(slabel, sshot_objs + ([("first_frame", ff_obj)] if ff_obj else []),
                              suffix, hard)
        interaction_cast_check(slabel, sshot_objs, chars, interactions, hard)
        place_context_exempt_check(slabel, [("first_frame", ff_obj)] if ff_obj else [], hard)
        bool_field_check(slabel, sshot_objs, "hard_cut", hard)
        bool_field_check(slabel, sshot_objs, "owner_ambiguity", hard)
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
        print(f"\nWROTE derived vo_text ({len(id2text_all)} shots). JSON valid.")
    return 1 if hard else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
