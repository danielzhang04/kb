"""Build the self-contained FRESH / V2 / LIKED review board for L01-L25."""

from __future__ import annotations

import base64
import html
import io
import json
import re
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "scratchpad" / "boards" / "fresh-3way-board.html"
SHOT_IDS = [f"L{number:02d}" for number in range(1, 26)]
LIKED_SHOT_IDS = {"L05", "L06", "L07", "L08", "L09", "L11", "L19", "L20", "L21", "L22", "L23", "L24", "L25"}
MAX_BYTES = 14 * 1024 * 1024
ENCODING_LEVELS = ((78, 880), (70, 880), (70, 720))


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def image_data_uri(path: Path, quality: int, max_dimension: int) -> str:
    """Return an RGB JPEG data URI, reduced to the requested maximum dimension."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode == "RGBA":
            background = Image.new("RGBA", image.size, "#111111")
            background.alpha_composite(image)
            image = background.convert("RGB")
        elif image.mode != "RGB":
            image = image.convert("RGB")
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{payload}"


def chain_parent(manifest_entry: dict) -> str | None:
    """Read the authoritative parent seed recorded in the scene manifest."""
    for seed in manifest_entry.get("seeds", []):
        if seed.get("role") == "parent":
            match = re.search(r"(L\d{2,3})\.png$", seed.get("path", ""))
            if match:
                return match.group(1)
    return None


def parked_reason(entry: dict) -> str | None:
    reasons = entry.get("parked_reasons") or []
    if isinstance(reasons, str):
        return reasons
    if reasons:
        # Some records lead with a terse severity marker (for example, "rig:
        # HIGH") and follow it with the human-useful diagnosis.
        return str(reasons[-1])
    return entry.get("notes") or entry.get("retry_cause")


def card_image(label: str, uri: str | None, image_number: int | None) -> str:
    if uri is None:
        return (
            '<div class="frame-cell placeholder"><div class="frame-label">'
            f"{label}</div><div class=\"placeholder-copy\">no liked-era frame</div></div>"
        )
    return (
        '<div class="frame-cell"><div class="frame-label">'
        f"{label}</div><img src=\"{uri}\" alt=\"{label} frame\" "
        f"data-lightbox-index=\"{image_number}\"></div>"
    )


def render_board(quality: int, max_dimension: int) -> tuple[str, dict[str, int], list[str]]:
    shots_data = load_json(ROOT / "shots.json")
    shots = {shot["id"]: shot for shot in shots_data["long_form"]["shots"]}
    manifest_data = load_json(ROOT / "assets" / "scenes" / "manifest.json")
    manifest = {entry["shot_id"]: entry for entry in manifest_data["shots"]}

    sources = {
        "FRESH": ROOT / "assets" / "scenes",
        "V2": ROOT / "scratchpad" / "fresh-gen" / "v2-frames",
        "LIKED": ROOT / "assets" / "_archive-pre-reset" / "scenes",
    }
    image_counts = {label: 0 for label in sources}
    missing: list[str] = []
    cards: list[str] = []
    image_number = 0

    for shot_id in SHOT_IDS:
        shot = shots.get(shot_id)
        manifest_entry = manifest.get(shot_id)
        if shot is None:
            missing.append(f"{shot_id}: shots.json record missing")
            shot = {}
        if manifest_entry is None:
            missing.append(f"{shot_id}: manifest record missing")
            manifest_entry = {}

        images: dict[str, str | None] = {}
        for label, directory in sources.items():
            image_path = directory / f"{shot_id}.png"
            # The brief defines the authoritative liked-era subset.  Other historical
            # files in this shared archive must not silently fill placeholder cells.
            permitted = label != "LIKED" or shot_id in LIKED_SHOT_IDS
            if permitted and image_path.is_file():
                images[label] = image_data_uri(image_path, quality, max_dimension)
                image_counts[label] += 1
            else:
                images[label] = None
                if label != "LIKED":
                    missing.append(f"{shot_id}: {label} image missing")

        role = str(shot.get("stage_role") or "unknown")
        if manifest_entry.get("review_status") == "verified":
            badge = '<span class="badge verified">verified</span>'
            parked = ""
        else:
            badge = '<span class="badge parked">parked</span>'
            reason = parked_reason(manifest_entry)
            parked = (
                f'<p class="parked-reason">{html.escape(reason)}</p>' if reason else ""
            )
        parent = chain_parent(manifest_entry)
        parent_note = (
            f'<span class="chain">parent {html.escape(parent)}</span>'
            if role == "delta" and parent
            else ('<span class="chain muted">parent unavailable</span>' if role == "delta" else "")
        )

        cells: list[str] = []
        for label in ("FRESH", "V2", "LIKED"):
            if images[label] is not None:
                cells.append(card_image(label, images[label], image_number))
                image_number += 1
            else:
                cells.append(card_image(label, None, None))
        vo_text = str(shot.get("vo_text") or shot.get("vo_ref") or "VO text unavailable")
        cards.append(
            '<article class="shot-card">'
            '<header class="card-header">'
            f'<span class="shot-id">{html.escape(shot_id)}</span>{badge}'
            f'<span class="role">{html.escape(role)}</span>{parent_note}'
            '</header>'
            f'<div class="frames">{"".join(cells)}</div>'
            f'<blockquote class="script-line">“{html.escape(vo_text)}”</blockquote>'
            f"{parked}</article>"
        )

    fragment = """<title>Bricks 3-Way Board</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; overflow-x: hidden; background: #111; color: #e8e8e8; font: 15px/1.45 Arial, sans-serif; }
.board { min-height: 100vh; max-width: 100%; overflow-x: hidden; background: #111; padding: 24px; }
.board-inner { width: min(100%, 1800px); margin: 0 auto; }
.board-title { margin: 0 0 10px; font-size: clamp(24px, 3vw, 36px); letter-spacing: .02em; }
.legend { margin: 0 0 24px; padding: 16px 18px; border: 1px solid #343434; border-radius: 8px; background: #171717; color: #c8c8c8; }
.legend p { margin: 4px 0; }
.legend strong { color: #e8e8e8; }
.cards { display: grid; gap: 18px; }
.shot-card { min-width: 0; overflow: hidden; border: 1px solid #303030; border-radius: 9px; background: #181818; }
.card-header { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 10px 14px; border-bottom: 1px solid #303030; flex-wrap: wrap; }
.shot-id { font-weight: 700; letter-spacing: .08em; }
.badge, .role, .chain { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.badge { border: 1px solid; }
.verified { color: #b6c9b6; background: #1d2a1d; border-color: #4b694b; }
.parked { color: #d9c18e; background: #302a1d; border-color: #70603d; }
.role { color: #c2c2c2; background: #262626; border: 1px solid #454545; }
.chain { color: #b5b5b5; border: 1px solid #3d3d3d; }
.muted { color: #777; }
.frames { display: flex; min-width: min-content; overflow-x: auto; gap: 1px; background: #303030; }
.frame-cell { flex: 1 0 300px; min-width: 0; background: #151515; }
.frame-label { padding: 8px 10px; color: #aaa; border-bottom: 1px solid #303030; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
.frame-cell img { display: block; width: 100%; max-width: 100%; height: auto; cursor: zoom-in; background: #111; }
.placeholder { display: grid; grid-template-rows: auto 1fr; min-height: 250px; color: #777; }
.placeholder-copy { display: grid; place-items: center; padding: 28px; border: 1px dashed #424242; border-width: 0 1px 1px; font-size: 13px; }
.script-line { margin: 0; padding: 14px 16px; color: #d7d7d7; font-size: 16px; font-style: italic; }
.parked-reason { margin: -2px 16px 14px; color: #baad89; font-size: 13px; }
.lightbox { position: fixed; inset: 0; z-index: 9999; display: none; place-items: center; padding: 24px; background: rgba(0, 0, 0, .93); cursor: zoom-out; }
.lightbox.open { display: grid; }
.lightbox img { max-width: 96vw; max-height: 92vh; object-fit: contain; cursor: default; }
.lightbox-note { position: fixed; right: 20px; bottom: 16px; color: #a8a8a8; font-size: 12px; }
@media (max-width: 720px) { .board { padding: 12px; } .frame-cell { flex-basis: 82vw; } .script-line { font-size: 15px; } }
</style>
<main class="board">
  <div class="board-inner">
    <h1 class="board-title">Bricks — L01–L25 Three-Way Review</h1>
    <section class="legend" aria-label="Board legend">
      <p><strong>FRESH</strong> = full clean VPW run, 2026-08-19. <strong>V2</strong> = prior doctrine-v2 regeneration. <strong>LIKED</strong> = pre-reset run Daniel liked.</p>
      <p><strong>L09 is parked:</strong> the crowd did not hold to the required simplified crowd rig after its sanctioned retry.</p>
    </section>
    <section class="cards" aria-label="L01 to L25 shot comparisons">
__CARDS__
    </section>
  </div>
</main>
<div id="lightbox" class="lightbox" role="dialog" aria-modal="true" aria-label="Expanded board image"><img id="lightbox-image" alt="Expanded board frame"><span class="lightbox-note">← → navigate · Esc or click outside to close</span></div>
<script>
(() => {
  const images = Array.from(document.querySelectorAll('[data-lightbox-index]'));
  const overlay = document.getElementById('lightbox');
  const target = document.getElementById('lightbox-image');
  let current = 0;
  const show = index => { current = (index + images.length) % images.length; target.src = images[current].src; target.alt = images[current].alt; overlay.classList.add('open'); };
  images.forEach((image, index) => image.addEventListener('click', () => show(index)));
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.classList.remove('open'); });
  document.addEventListener('keydown', event => {
    if (!overlay.classList.contains('open')) return;
    if (event.key === 'Escape') overlay.classList.remove('open');
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });
})();
</script>
""".replace("__CARDS__", "\n".join(cards))
    return fragment, image_counts, missing


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    last_size = 0
    for quality, max_dimension in ENCODING_LEVELS:
        fragment, image_counts, missing = render_board(quality, max_dimension)
        encoded = fragment.encode("utf-8")
        last_size = len(encoded)
        if last_size < MAX_BYTES:
            OUTPUT.write_bytes(encoded)
            print(json.dumps({
                "output": str(OUTPUT),
                "bytes": last_size,
                "quality": quality,
                "max_dimension": max_dimension,
                "image_counts": image_counts,
                "missing": missing,
            }, ensure_ascii=False))
            return
    raise RuntimeError(f"Board remains over 14 MB after final compression level: {last_size} bytes")


if __name__ == "__main__":
    main()
