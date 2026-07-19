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
