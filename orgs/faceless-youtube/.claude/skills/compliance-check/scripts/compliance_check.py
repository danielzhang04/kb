#!/usr/bin/env python3
"""compliance-check — the mechanical + provenance Gate-3 report.

This is the report a HUMAN reads at Gate 3, right before approving a YouTube publish.
Stage-0 law: a human approves EVERY publish, and every upload goes out `private`. This
script does NOT publish anything and NEVER touches the network — it reads a finished
video folder's committed artifacts and renders a verdict a person signs off on.

Two kinds of finding:
  * `## Mechanical checks` — hard, objective PASS|FAIL lines. ANY FAIL → exit code 1.
    publish-queue's preflight (a later task) consumes this exit code as a hard gate.
  * `## Provenance (warn-level)` — citation-hygiene warnings. NEVER affects the exit code;
    they are cues for the human reviewer's eyes, not gates.

Usage:
    py -3 compliance_check.py <video_dir>
        writes <video_dir>/compliance-report.md, prints it, exit 0 = PASS / 1 = FAIL.

Each mechanical check is its own function returning (ok: bool, detail: str), so a check
can be unit-tested in isolation and the report is a straight map over them.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# small IO helpers — every check loads its own inputs and degrades to a FAIL
# (never an exception) when a required artifact is missing or unparseable.
# ---------------------------------------------------------------------------
def _load_json(path: Path):
    """Return (data, error). error is a human string when the file is missing/bad."""
    if not path.exists():
        return None, f"{path.name} missing"
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except (ValueError, OSError) as e:
        return None, f"{path.name} unreadable ({e.__class__.__name__})"


def _read_text(path: Path):
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _hms_to_seconds(stamp: str):
    """Parse a 'MM:SS' or 'HH:MM:SS' chapter timestamp to int seconds, or None."""
    parts = str(stamp).strip().split(":")
    if not (2 <= len(parts) <= 3):
        return None
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if any(n < 0 for n in nums):
        return None
    secs = 0
    for n in nums:
        secs = secs * 60 + n
    return secs


def _render_duration_seconds(video_dir: Path):
    """Best-effort finished duration from the render manifest's long-form piece,
    for the chapters<duration bound. Returns float seconds or None."""
    data, err = _load_json(video_dir / "assets" / "render.manifest.json")
    if err:
        return None
    pieces = data.get("pieces") or []
    long_form = next((p for p in pieces if p.get("piece") == "long-form"), None)
    piece = long_form or (pieces[0] if pieces else None)
    if not piece:
        return None
    for key in ("rendered_seconds", "vo_seconds", "sum_scene_seconds"):
        val = piece.get(key)
        if isinstance(val, (int, float)) and val > 0:
            return float(val)
    return None


# ---------------------------------------------------------------------------
# Mechanical check 1 — render manifest is a real, green render.
# ---------------------------------------------------------------------------
def check_render_manifest(video_dir: Path):
    data, err = _load_json(video_dir / "assets" / "render.manifest.json")
    if err:
        return False, err
    pieces = data.get("pieces") or []
    if not pieces:
        return False, "render.manifest.json has no pieces"
    problems = []
    for p in pieces:
        name = p.get("piece", "?")
        # success marker: per-piece `state == "rendered"` (pinned from wells-fargo).
        if p.get("state") != "rendered":
            problems.append(f"{name}: state={p.get('state')!r} (expected 'rendered')")
        audio = p.get("audio") or {}
        if audio.get("ok") is not True:
            problems.append(f"{name}: audio.ok is not true")
        measured = audio.get("measured") or {}
        if measured.get("lufs") in (None, ""):
            problems.append(f"{name}: no measured LUFS")
        splice = measured.get("splice_continuity") or {}
        if splice.get("fail", 0):
            problems.append(f"{name}: {splice.get('fail')} splice-continuity failures")
        dur = p.get("rendered_seconds") or p.get("vo_seconds")
        if not (isinstance(dur, (int, float)) and dur > 0):
            problems.append(f"{name}: no positive rendered duration")
    if problems:
        return False, "; ".join(problems)
    lufs = (pieces[0].get("audio") or {}).get("measured", {}).get("lufs")
    return True, f"{len(pieces)} piece(s) rendered; LUFS {lufs}, splice gate green"


# ---------------------------------------------------------------------------
# Mechanical check 2 — metadata within YouTube limits + sane chapters.
# ---------------------------------------------------------------------------
def check_metadata(video_dir: Path, duration_s: float | None = None):
    data, err = _load_json(video_dir / "metadata.json")
    if err:
        return False, err
    lf = data.get("long_form") or {}
    if not lf:
        return False, "metadata.json has no long_form block"
    if duration_s is None:
        duration_s = _render_duration_seconds(video_dir)
    problems = []

    title = lf.get("title_primary") or ""
    if len(title) > 100:
        problems.append(f"title {len(title)} chars > 100")

    description = lf.get("description") or ""
    desc_bytes = len(description.encode("utf-8"))
    if desc_bytes > 5000:
        problems.append(f"description {desc_bytes} bytes > 5000")

    tags = lf.get("tags") or []
    tag_chars = sum(len(t) for t in tags)
    if tag_chars > 500:
        problems.append(f"tags total {tag_chars} chars > 500")

    if not lf.get("category_id"):
        problems.append("category_id missing")

    chapters = lf.get("chapters") or []
    prev = None
    for ch in chapters:
        secs = _hms_to_seconds(ch.get("time"))
        if secs is None:
            problems.append(f"chapter time unparseable: {ch.get('time')!r}")
            continue
        if prev is not None and secs <= prev:
            problems.append(f"chapters not strictly monotonic at {ch.get('time')!r}")
        if duration_s is not None and secs >= duration_s:
            problems.append(f"chapter {ch.get('time')!r} >= duration {duration_s:.0f}s")
        prev = secs

    if problems:
        return False, "; ".join(problems)
    return True, (
        f"title {len(title)}c, desc {desc_bytes}B, tags {tag_chars}c, "
        f"category {lf.get('category_id')}, {len(chapters)} chapters monotonic"
    )


# ---------------------------------------------------------------------------
# Mechanical check 3 — Stage-0 policy: private + AI-disclosed.
# ---------------------------------------------------------------------------
def check_privacy(video_dir: Path):
    data, err = _load_json(video_dir / "metadata.json")
    if err:
        return False, err
    defaults = data.get("defaults") or {}
    problems = []
    if defaults.get("privacy_status") != "private":
        problems.append(f"privacy_status={defaults.get('privacy_status')!r} (must be 'private')")
    if defaults.get("contains_synthetic_media") is not True:
        problems.append("contains_synthetic_media is not true (AI disclosure required)")
    if problems:
        return False, "; ".join(problems)
    return True, "privacy_status=private, contains_synthetic_media=true"


# ---------------------------------------------------------------------------
# Mechanical check 4 — every licensed asset is credited; no orphan credits.
#
# Schema note (pinned from real artifacts, 2026-07-20): wells-fargo/poyais assets in
# audio-plan.json and assets/library/manifest.json are all `source: generated`/`reused`
# and carry NO license/attribution fields — there is no external licensed media in the
# corpus yet. So this check is VACUOUSLY GREEN on both directions when nothing declares
# a license and the description has no Credits block, and bites the moment a licensed
# asset goes uncredited OR a credit names something no licensed asset backs.
# A licensed asset is any entry that declares one of the license/attribution keys below.
#
# Credit-block convention (description side, see SKILL.md): a description MAY contain a
# Credits block — a contiguous run of lines following a line matching `^credits:?$`
# (case-insensitive, optional markdown heading `#`/`##`/... or bold `**` markers around
# it), ending at the first blank line or end-of-description. Each non-empty line in that
# block is one credit entry. Matching (both directions) is substring containment between
# a licensed asset's credit string/id and the relevant description text — the reverse
# direction checks each credit-block entry against every licensed asset's credit/id.
# No Credits block present -> orphan detection is vacuously fine (nothing to check).
# ---------------------------------------------------------------------------
_LICENSE_KEYS = ("license", "attribution", "credit", "credit_text", "attribution_text")
_CREDIT_HEADER_RE = re.compile(r"^#{0,6}\s*\*{0,2}\s*credits\s*:?\s*\*{0,2}\s*$", re.IGNORECASE)


def _credit_block_entries(description: str):
    """Return the list of non-empty lines in the description's Credits block, if any.

    The block starts at the first line matching `_CREDIT_HEADER_RE` and runs until the
    first blank line or end of description. Returns [] when there is no such header.
    """
    entries = []
    in_block = False
    for raw in description.splitlines():
        line = raw.strip()
        if not in_block:
            if _CREDIT_HEADER_RE.match(line):
                in_block = True
            continue
        if line == "":
            break
        entries.append(line)
    return entries


def _orphan_credit_entries(description: str, licensed: dict):
    """Credit-block entries with no backing licensed asset (same substring matching rule
    as the credited direction, applied in reverse: does this entry contain a known
    licensed asset's credit string or id?)."""
    orphans = []
    for entry in _credit_block_entries(description):
        matched = any(credit in entry or aid in entry for aid, credit in licensed.items())
        if not matched:
            orphans.append(entry)
    return orphans


def _collect_licensed_ids(video_dir: Path):
    """Return {asset_id: credit_string} for every asset that declares a license/attribution."""
    licensed = {}
    sources = [
        (video_dir / "audio-plan.json", ("cues", "assets", "music", "sfx")),
        (video_dir / "assets" / "library" / "manifest.json", ("assets",)),
    ]
    for path, list_keys in sources:
        data, err = _load_json(path)
        if err or not isinstance(data, dict):
            continue
        entries = []
        for lk in list_keys:
            val = data.get(lk)
            if isinstance(val, list):
                entries.extend(e for e in val if isinstance(e, dict))
        for e in entries:
            credit = next((str(e[k]) for k in _LICENSE_KEYS if e.get(k)), None)
            if credit is None:
                continue
            aid = e.get("name") or e.get("id") or e.get("asset") or e.get("file") or credit
            licensed[str(aid)] = credit
    return licensed


def check_licensing(video_dir: Path):
    licensed = _collect_licensed_ids(video_dir)
    data, err = _load_json(video_dir / "metadata.json")
    if err:
        return False, err
    description = ((data.get("long_form") or {}).get("description")) or ""

    problems = []
    if licensed:
        uncredited = [aid for aid, credit in licensed.items()
                      if credit not in description and aid not in description]
        if uncredited:
            problems.append(
                f"licensed asset(s) not credited in description: {', '.join(sorted(uncredited))}"
            )

    orphans = _orphan_credit_entries(description, licensed)
    if orphans:
        problems.append(
            "orphan credit(s) in description Credits block with no matching licensed asset: "
            + "; ".join(repr(o) for o in orphans)
        )

    if problems:
        return False, "; ".join(problems)
    if not licensed:
        return True, "no licensed assets declared (nothing to credit)"
    return True, f"all {len(licensed)} licensed asset(s) credited in description; no orphan credits"


# ---------------------------------------------------------------------------
# Mechanical check 5 — thumbnail exists and is exactly 1280x720.
# ---------------------------------------------------------------------------
def check_thumbnail(video_dir: Path):
    path = video_dir / "assets" / "thumbnail.png"
    if not path.exists():
        return False, "assets/thumbnail.png missing"
    try:
        from PIL import Image
    except ImportError:
        return False, "PIL (Pillow) not available to verify thumbnail dimensions"
    try:
        with Image.open(path) as img:
            size = img.size
    except Exception as e:
        return False, f"thumbnail.png unreadable ({e.__class__.__name__})"
    if size != (1280, 720):
        return False, f"thumbnail is {size[0]}x{size[1]} (must be 1280x720)"
    return True, "thumbnail.png present, 1280x720"


# ---------------------------------------------------------------------------
# Mechanical check 6 — scene-review invariant (Task-2 semantics).
#
# Source of truth for the per-entry rule: render.py::_entry_review_reason. Restated here
# (NOT imported) so compliance-check has no dependency on render-builder. An entry is
# shippable iff review_status == "verified", or — when review_status is absent — the
# legacy booleans verified.scene AND verified.rig are both true. Any other status
# (parked / unreviewed / …) or a false legacy boolean is NOT shippable and names the shot.
# ---------------------------------------------------------------------------
def _entry_review_reason(entry: dict):
    """Mirror of render.py::_entry_review_reason. None = shippable; else the reason."""
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


def check_scene_review(video_dir: Path):
    data, err = _load_json(video_dir / "assets" / "scenes" / "manifest.json")
    if err:
        return False, err
    shots = data.get("shots") or []
    if not shots:
        return False, "scenes/manifest.json has no shots"
    unshippable = []
    for entry in shots:
        reason = _entry_review_reason(entry)
        if reason is not None:
            unshippable.append(f"{entry.get('shot_id', '?')} ({reason})")
    if unshippable:
        shown = ", ".join(unshippable[:20])
        extra = "" if len(unshippable) <= 20 else f", +{len(unshippable) - 20} more"
        return False, f"{len(unshippable)}/{len(shots)} shot(s) not shippable: {shown}{extra}"
    return True, f"all {len(shots)} scene(s) verified/shippable"


# ---------------------------------------------------------------------------
# Provenance (warn-level) — NEVER affects the exit code.
# Maps [F-NN] citations in script.md to research.md's fact ledger; warns on orphan
# citations and on any 200-word window that leans on a single source >=5 times.
# ---------------------------------------------------------------------------
_CITE_RE = re.compile(r"\[F-\d+\]")
_LEDGER_RE = re.compile(r"\*\*\[(F-\d+)\]\*\*|\[(F-\d+)\]")


def provenance_warnings(video_dir: Path, window: int = 200, threshold: int = 5):
    warnings = []
    script = _read_text(video_dir / "script.md")
    if script is None:
        return ["script.md missing — no provenance mapping possible"]

    # Ledger ids defined in research.md (if present).
    research = _read_text(video_dir / "research.md")
    ledger_ids = set()
    if research is not None:
        for m in _LEDGER_RE.finditer(research):
            ledger_ids.add(m.group(1) or m.group(2))

    cites_in_order = [m.group(0).strip("[]") for m in _CITE_RE.finditer(script)]

    # Orphan citations: cited in the script but not defined in the ledger.
    if research is not None and ledger_ids:
        orphans = sorted({c for c in cites_in_order if c not in ledger_ids})
        if orphans:
            warnings.append(
                f"{len(orphans)} citation(s) in script.md with no research.md ledger entry: "
                + ", ".join(orphans)
            )
    elif research is None:
        warnings.append("research.md missing — citations in script.md are unmapped")

    # Over-reliance: a 200-word sliding window citing one source >= threshold times.
    # Tokenize on whitespace; each [F-NN] token is attributed to the word window it sits in.
    tokens = script.split()
    positions = {}  # F-id -> list of word indices where it is cited
    for idx, tok in enumerate(tokens):
        for m in _CITE_RE.finditer(tok):
            positions.setdefault(m.group(0).strip("[]"), []).append(idx)
    flagged = set()
    for fid, idxs in positions.items():
        if len(idxs) < threshold:
            continue
        # any span of `threshold` consecutive cites within `window` words?
        for i in range(len(idxs) - threshold + 1):
            if idxs[i + threshold - 1] - idxs[i] <= window:
                flagged.add(fid)
                break
    for fid in sorted(flagged):
        warnings.append(
            f"{fid} cited {len(positions[fid])}x, >= {threshold} times within a "
            f"{window}-word window (single-source over-reliance)"
        )

    return warnings


# ---------------------------------------------------------------------------
# Report assembly + CLI.
# ---------------------------------------------------------------------------
MECHANICAL_CHECKS = [
    ("render manifest", check_render_manifest),
    ("metadata limits + chapters", check_metadata),
    ("privacy + AI disclosure", check_privacy),
    ("licensing / credits", check_licensing),
    ("thumbnail 1280x720", check_thumbnail),
    ("scene-review invariant", check_scene_review),
]


def build_report(video_dir: Path):
    """Run every check; return (markdown_text, exit_code)."""
    results = []
    for name, fn in MECHANICAL_CHECKS:
        try:
            ok, detail = fn(video_dir)
        except Exception as e:  # a check must never crash the gate — a crash is a FAIL
            ok, detail = False, f"check errored: {e.__class__.__name__}: {e}"
        results.append((ok, name, detail))
    warnings = provenance_warnings(video_dir)

    passed = all(ok for ok, _, _ in results)
    exit_code = 0 if passed else 1

    lines = [
        f"# Compliance report — {video_dir.name}",
        "",
        f"**Verdict: {'PASS' if passed else 'FAIL'}** "
        f"({sum(ok for ok, _, _ in results)}/{len(results)} mechanical checks passed)",
        "",
        "This is a Gate-3 report for a human reviewer. Mechanical checks are the hard gate "
        "(any FAIL blocks publish, exit 1). Provenance is warn-level and never blocks.",
        "",
        "## Mechanical checks",
        "",
    ]
    for ok, name, detail in results:
        lines.append(f"{'PASS' if ok else 'FAIL'} — {name}: {detail}")
    lines += ["", "## Provenance (warn-level)", ""]
    if warnings:
        for w in warnings:
            lines.append(f"WARN — {w}")
    else:
        lines.append("No provenance warnings.")
    lines.append("")
    return "\n".join(lines), exit_code


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        sys.stderr.write("usage: py -3 compliance_check.py <video_dir>\n")
        return 2
    video_dir = Path(argv[0])
    if not video_dir.is_dir():
        sys.stderr.write(f"not a directory: {video_dir}\n")
        return 2
    text, exit_code = build_report(video_dir)
    (video_dir / "compliance-report.md").write_text(text, encoding="utf-8")
    sys.stdout.write(text + "\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
