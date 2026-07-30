#!/usr/bin/env python3
"""render.py — shared render-timing + scene-resolution helpers for `render-builder`.

Once the home of a JSON2Video assembly engine; that engine was REMOVED 2026-07-10 (the
local Remotion path in `build_motion.py` is the only engine — JSON2Video was never bought
past the free tier and is fully retired). What remains here is the deterministic timing +
scene-gate logic that BOTH `build_motion.py` (the render driver) and
`visual-prompt-writer/lint_shots.py` import, so they share ONE set of semantics:

  * re-timing a shot list to the real voiceover length (proportional or per-line),
  * the ONE `vo_ref` → word-stream matcher (lint validates the exact algorithm render uses),
  * resolving the verified pre-generated `assets/scenes/<id>.png` stills (the manifest gate).

Not a runnable script — it has no `main()`. Import from it; don't invoke it.
"""

import json
import re
from pathlib import Path


# --------------------------------------------------------------------------- #
# Environment
# --------------------------------------------------------------------------- #
def find_repo_root(start: Path) -> Path:
    for d in [start, *start.parents]:
        if (d / ".env").exists():
            return d
    return start


# --------------------------------------------------------------------------- #
# Re-timing — scale the shot durations to the real voiceover length
# --------------------------------------------------------------------------- #
def retime(durations: list[float], vo_seconds: float | None):
    """Return (scaled_durations, basis). If we have a real VO length, scale the shot
    durations so they sum to it (preserving each shot's cadence ratio). Otherwise keep
    the estimates as-is (dry-run / missing audio) and say so."""
    total = sum(durations) or 1.0
    if vo_seconds and vo_seconds > 0:
        scale = vo_seconds / total
        return [round(d * scale, 3) for d in durations], f"scaled-to-vo({vo_seconds:.2f}s, x{scale:.3f})"
    return [round(d, 3) for d in durations], "shots-estimate (no VO length available)"


_NORM = lambda w: re.sub(r"[^a-z0-9]+", "", w.lower())


def match_shots_to_tokens(shots, toks):
    """The ONE vo_ref matcher, shared by this file's re-timer AND lint_shots.py, so the
    lint validates the exact algorithm render times against.

    `toks` is [(normalized_word, marker)] where marker is a timestamp (render) or a char
    offset (lint). Sequential/monotonic first-4-word match: each shot's vo_ref opening words
    are found at or after the previous match. Returns a per-shot list of
    {id, needle, start} where `start` is the matched marker or None (empty/unfound needle)."""
    pos, out = 0, []
    for sh in shots:
        needle = [x for x in (_NORM(w) for w in (sh.get("vo_ref") or "").split()) if x][:4]
        found = None
        if needle:
            for j in range(pos, len(toks) - len(needle) + 1):
                if all(toks[j + k][0] == needle[k] for k in range(len(needle))):
                    found = toks[j][1]
                    pos = j + 1
                    break
        out.append({"id": sh.get("id", "?"), "needle": needle, "start": found})
    return out


def anchor_time(anchor: str, word_timings) -> float | None:
    """Resolve a verbatim VO anchor phrase (first 4 words) to its render-timeline timestamp,
    reusing the ONE vo_ref matcher so an authored anchor times EXACTLY the way a vo_ref does.
    word_timings is the (pause-shifted) [[word, start_s], ...] stream. Returns the matched word's
    start second, or None when the anchor is empty/absent/unmatched (caller falls back)."""
    if not anchor or not word_timings:
        return None
    toks = [(_NORM(w[0]), w[1]) for w in word_timings]
    return match_shots_to_tokens([{"vo_ref": anchor, "id": "_anchor"}], toks)[0]["start"]


def _renormalize_to_vo(scaled, vo_seconds, floor=0.4):
    """Q1: the 0.4s per-shot floor can push Σ(scaled) above the real VO length, so the video
    silently runs longer than its audio. Squeeze the above-floor headroom back down so the sum
    hits vo_seconds. If the floors ALONE already exceed the VO (too many cuts for this VO),
    return the floor-minimum durations + a warning — nothing more can be compressed."""
    if not vo_seconds or vo_seconds <= 0:
        return scaled, None
    total = sum(scaled)
    if abs(total - float(vo_seconds)) <= 1e-6:
        return scaled, None
    floor_total = floor * len(scaled)
    if floor_total >= float(vo_seconds):
        return [round(floor, 3)] * len(scaled), (
            f"too many cuts for this VO: {len(scaled)} shots x {floor}s floor = {floor_total:.1f}s "
            f"> {float(vo_seconds):.1f}s VO")
    need = total - float(vo_seconds)          # >0 (floors only add) → reduce; <0 → expand
    headroom = total - floor_total            # slack available above the floor
    out = []
    for d in scaled:
        share = ((d - floor) / headroom) if headroom else 0.0
        out.append(round(d - need * share, 3))
    return out, None


def retime_by_timings(shots, durations, word_timings, vo_seconds):
    """True per-line sync: place each shot at the real timestamp of its vo_ref in the
    narration, so cuts land on the words they illustrate. Returns scaled durations, or
    None (→ caller falls back to proportional) when the timings are missing or the
    vo_ref → word-stream match isn't reliable enough to trust.

    Matching is sequential/monotonic: each shot's vo_ref (first few words) is found in the
    word stream at or after the previous match. Unmatched shots are interpolated between
    their matched neighbours by estimated-duration weight, so a few misses don't break it."""
    if not word_timings or not vo_seconds:
        return None
    toks = [(_NORM(w), t) for w, t in word_timings]
    toks = [(w, t) for w, t in toks if w]
    n = len(shots)
    # one shared matcher (also used by lint_shots.py) so lint validates what render times against.
    m = match_shots_to_tokens(shots, toks)
    starts = [x["start"] for x in m]
    matched = sum(1 for x in m if x["start"] is not None)
    if matched < max(2, n * 0.5):
        return None  # not enough anchors — proportional is safer
    if starts[0] is None:
        starts[0] = 0.0
    anchors = [(i, s) for i, s in enumerate(starts) if s is not None]
    if any(b[1] < a[1] for a, b in zip(anchors, anchors[1:])):
        return None  # non-monotonic match — bail to proportional
    # Fill each gap between anchors (and the tail to vo_seconds) by estimated-duration weight.
    times = [None] * n
    for (i0, s0), (i1, s1) in zip(anchors, anchors[1:] + [(n, float(vo_seconds))]):
        seg_total = sum(durations[i0:i1]) or 1.0
        acc = 0.0
        for i in range(i0, i1):
            times[i] = round(s0 + (s1 - s0) * acc / seg_total, 3)
            acc += durations[i] if i < len(durations) else 1.0
    scaled = []
    for i in range(n):
        end = float(vo_seconds) if i == n - 1 else times[i + 1]
        scaled.append(round(max(0.4, end - times[i]), 3))
    scaled, _ = _renormalize_to_vo(scaled, vo_seconds)   # Q1: floors can overrun VO — squeeze back
    return scaled


# --------------------------------------------------------------------------- #
# Scenes mode — resolve the pre-generated, verified stills from image-generation
# --------------------------------------------------------------------------- #
# image-generation deliberately skips these sources (they belong to other pipelines),
# so a missing scene file for them falls back to an inline placeholder card, counted in the manifest.
INLINE_FALLBACK_SOURCES = {"chart", "screencap", "stock", "archival"}

# S1-B: real raster-image signatures. The goal is to reject 0-byte / truncated / garbage
# survivors (the forge open-then-fail poison) — NOT to enforce the container format. Gen output
# is routinely a JPEG saved under a .png name, which renders fine, so accept any real image.
_IMAGE_MAGICS = (
    b"\x89PNG\r\n\x1a\n",   # PNG
    b"\xff\xd8\xff",         # JPEG / JFIF
    b"GIF87a", b"GIF89a",   # GIF
)


def _valid_scene_image(p: Path, min_bytes: int = 1024) -> bool:
    """S1-B: a real, non-truncated raster image. A <1KB or non-image file (e.g. the 0-byte
    forge truncation survivor) is treated as ABSENT so a poisoned/empty frame can't be rendered."""
    try:
        if p.stat().st_size < min_bytes:
            return False
        with open(p, "rb") as f:
            head = f.read(12)
        if any(head.startswith(m) for m in _IMAGE_MAGICS):
            return True
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"   # WebP
    except OSError:
        return False


def _load_scene_manifest(scenes_dir: Path):
    """S2: {shot_id: entry} from scenes/manifest.json (image-generation's verify record), or
    None if the manifest is absent/unparseable (→ the manifest gate is simply not applied)."""
    mp = scenes_dir / "manifest.json"
    if not mp.exists():
        return None
    try:
        data = json.loads(mp.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None
    return {e.get("shot_id"): e for e in data.get("shots", []) if e.get("shot_id")}


def _entry_review_reason(entry: dict):
    """Task-2 per-entry status, applied to ANY shot that HAS a manifest entry (layered ones
    included — layered membership never exempts a shot from this check). Returns None when the
    entry is shippable, else the non-shippable reason:
      * review_status is authoritative when present: "verified" → shippable (None); "parked" →
        "parked: <'; '.join(parked_reasons)>"; "unreviewed"/anything else → "gate";
      * absent → legacy boolean gate: scene and rig both true → shippable, else "gate"."""
    rs = entry.get("review_status")
    if rs is not None:
        if rs == "verified":
            return None
        if rs == "parked":
            return "parked: " + "; ".join(entry.get("parked_reasons") or ["no reasons recorded"])
        return "gate"
    v = entry.get("verified") or {}
    if v.get("scene") is not True or v.get("rig") is not True:
        return "gate"
    return None


def resolve_scene_files(scenes_dir: Path, piece: str, shots: list, is_short: bool,
                        allow_missing: bool, layered_ids=None,
                        preview_parked=False, previewed_out=None):
    """Per-shot Path-or-None list for scenes mode. Naming convention (the image-generation
    output contract): long-form -> scenes/<shot-id>.png; shorts -> scenes/<piece>-<shot-id>.png.

    A scene is only usable when (S1-B) the PNG is real + non-truncated AND (S2) — when
    scenes/manifest.json exists — the shot has a shippable manifest entry (see
    `_entry_review_reason`). The manifest IS the gate: a filename with no verified entry is NOT
    shippable. A shot that fails either is a HARD ERROR (run image-generation pass 2 + its verify
    gate) unless --allow-missing, which falls back to a placeholder card and warns.

    chart/screencap/stock/archival shots, and any shot whose id is in `layered_ids` (the motion
    plan materializes it as plate+cutout; apply_motion_plan supplies its plate+layers), are
    exempt from the S1-B PNG-EXISTENCE requirement ONLY — they legitimately have no
    scenes/<id>.png. They are NEVER exempt from the S2 status check: a layered/fallback shot with
    a manifest entry is gated exactly like any other (the fyt-run-001 hole was exempting them
    from S2 too, so a manifest in which nothing was verified still passed). Deliberate
    compatibility carve-out: a manifest with NO entry at all for a layered/fallback shot passes
    (legacy manifests never listed layered shots; stamp_review.py writes entries for new runs).

    `preview_parked` (opt-in, HUMAN EYE-GATE ONLY) shows a PARKED shot's actual best-attempt PNG
    instead of a placeholder card, and appends its id to `previewed_out`. It is scoped strictly to
    `review_status == "parked"` WITH a valid PNG: "missing" and "gate" (unreviewed/unverified) are
    never rescued, and no status is rewritten. Previewed shots are reported SEPARATELY from the
    allow-missing `allowed` list so the caller can stamp a non-shippable manifest state — a render
    built this way is a review artifact, never a publishable one."""
    manifest = _load_scene_manifest(scenes_dir)   # S2
    layered_ids = layered_ids or set()
    files, missing, gate_failed, parked = [], [], [], []
    for shot in shots:
        sid = shot.get("id", "")
        stem = f"{piece}-{sid}" if is_short else sid
        p = scenes_dir / f"{stem}.png"
        is_fallback = ((shot.get("source") or "ai-gen") in INLINE_FALLBACK_SOURCES
                       or sid in layered_ids)
        png_ok = p.exists() and _valid_scene_image(p)          # S1-B
        entry = manifest.get(sid) if manifest is not None else None
        # None = usable/fallback; "missing" = no valid PNG; "gate" = unreviewed/unverified;
        # "parked: <reasons>" = reviewed, defects known, honestly NOT shippable.
        reason = None
        if entry is not None:                                  # S2 — runs for EVERY shot w/ entry
            reason = _entry_review_reason(entry)               # (layered/fallback NOT exempt here)
        elif manifest is not None and not is_fallback:
            # Filename with no verified entry: not shippable. PNG present → gate; absent → missing.
            # (A layered/fallback shot with no entry is the deliberate compat carve-out → passes.)
            reason = "gate" if png_ok else "missing"
        # S1-B — PNG existence. layered_ids / fallback sources are exempt from THIS check only.
        if reason is None and not is_fallback and not png_ok:
            reason = "missing"
        # Opt-in preview of PARKED pixels for the human eye-gate. Deliberately narrow: only a
        # "parked: …" reason qualifies (never "missing"/"gate") and only with real pixels on disk,
        # so nothing is invented and no review_status is touched. Tracked apart from `allowed`.
        if preview_parked and png_ok and isinstance(reason, str) and reason.startswith("parked"):
            files.append(p)
            if previewed_out is not None:
                previewed_out.append(sid or "?")
            continue
        if reason is None:
            files.append(p if png_ok else None)
            continue
        files.append(None)
        if reason == "missing":
            missing.append(sid or "?")
        elif reason == "gate":
            gate_failed.append(sid or "?")
        elif reason:                                           # "parked: ..."
            parked.append((sid or "?", reason))

    if (missing or gate_failed or parked) and not allow_missing:
        parts = []
        if missing:
            parts.append(f"{len(missing)} with no valid scene PNG "
                         f"({', '.join(missing[:20])}{' …' if len(missing) > 20 else ''})")
        if gate_failed:
            parts.append(f"{len(gate_failed)} present but NOT verified in manifest.json "
                         f"(verified.scene/rig != true: {', '.join(gate_failed[:20])}"
                         f"{' …' if len(gate_failed) > 20 else ''})")
        if parked:
            parts.append(f"{len(parked)} parked (reviewed, defects known — NOT shippable): "
                         f"{'; '.join(f'{sid} → {r}' for sid, r in parked[:20])}"
                         f"{' …' if len(parked) > 20 else ''}")
        raise SystemExit(
            f"{piece}: {'; '.join(parts)} in {scenes_dir} — run image-generation pass 2 and its "
            f"verify gate first (or --allow-missing for a test slice). Rendering these would bypass "
            f"the locked-style / rig gate.")
    allowed = missing + gate_failed + [sid for sid, _ in parked]
    if allowed:
        print(f"  ! {piece}: --allow-missing — {len(allowed)} shot(s) fall back to a placeholder card "
              f"(style NOT locked): {', '.join(allowed[:10])}{' …' if len(allowed) > 10 else ''}")
    return files, allowed


# --------------------------------------------------------------------------- #
# Voiceover manifest readers (piece → real audio length / per-word timings / mp3 path)
# --------------------------------------------------------------------------- #
def vo_seconds_for(manifest: dict, piece: str) -> float | None:
    """Real audio length for a piece from the voiceover manifest, or None if the audio
    wasn't synthesized (dry-run manifest / bench short)."""
    for p in manifest.get("pieces", []):
        if p.get("piece") == piece and p.get("audio"):
            return p.get("est_duration_s")
    if piece == "long-form" and manifest.get("long_form_est_runtime_s"):
        return manifest["long_form_est_runtime_s"]
    return None


def word_timings_for(manifest: dict, piece: str) -> list:
    """Per-word [word, start_s] timings for a piece (empty if the voiceover predates the
    with-timestamps upgrade — render-builder then falls back to proportional re-timing)."""
    for p in manifest.get("pieces", []):
        if p.get("piece") == piece and p.get("audio"):
            return p.get("word_timings") or []
    return []


def vo_audio_path(video_dir: Path, piece: str) -> Path:
    return video_dir / ("assets/vo.mp3" if piece == "long-form"
                        else f"assets/shorts/{piece}.mp3")
