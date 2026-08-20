"""Build the VPW3 NEW / YESTERDAY / LIKED review board for L01-L25."""

from __future__ import annotations

import base64
import html
import io
import json
import re
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "scratchpad" / "boards" / "vpw3-board.html"
SHOT_IDS = [f"L{number:02d}" for number in range(1, 26)]
LIKED_SHOT_IDS = {
    "L05", "L06", "L07", "L08", "L09", "L11", "L19", "L20", "L21", "L22", "L23", "L24", "L25"
}
MAX_BYTES = 14 * 1024 * 1024
ENCODING_LEVELS = ((78, 880), (70, 880), (70, 720))


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def image_data_uri(path: Path, quality: int, max_dimension: int) -> str:
    """Downscale an image and return it as an RGB JPEG data URI."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode == "RGBA":
            background = Image.new("RGBA", image.size, "#111111")
            background.alpha_composite(image)
            image = background.convert("RGB")
        elif image.mode != "RGB":
            image = image.convert("RGB")
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        image.save(encoded, format="JPEG", quality=quality, optimize=True, progressive=True)
    payload = base64.b64encode(encoded.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{payload}"


def chain_parent(manifest_entry: dict) -> str | None:
    """Extract the parent frame from the manifest's seed path(s)."""
    for seed in manifest_entry.get("seeds", []):
        path = seed.get("path", "") if isinstance(seed, dict) else str(seed)
        match = re.search(r"(?:^|/)\b(L\d{2,3})\.png$", path.replace("\\", "/"))
        if match:
            return match.group(1)
    return None


def parked_reason(manifest_entry: dict) -> str | None:
    reasons = manifest_entry.get("parked_reasons") or []
    if isinstance(reasons, str):
        return reasons
    return str(reasons[-1]) if reasons else None


def frame_cell(label: str, uri: str | None, shot_id: str) -> str:
    if uri is None:
        return (
            '<div class="frame-cell placeholder"><div class="frame-label">'
            f"{html.escape(label)}</div>"
            '<div class="placeholder-copy">no liked-era frame</div></div>'
        )
    return (
        '<div class="frame-cell"><div class="frame-label">'
        f"{html.escape(label)}</div>"
        f'<img src="{uri}" alt="{html.escape(label)} {shot_id} frame" data-lightbox></div>'
    )


def render_board(quality: int, max_dimension: int) -> tuple[str, dict[str, int], list[str]]:
    shots_data = load_json(ROOT / "shots.json")
    shots = {shot["id"]: shot for shot in shots_data["long_form"]["shots"]}
    manifest_data = load_json(ROOT / "assets" / "scenes" / "manifest.json")
    manifest = {entry["shot_id"]: entry for entry in manifest_data["shots"]}
    sources = {
        "NEW - VPW3 re-author": ROOT / "assets" / "scenes",
        "YESTERDAY - prior rerun": ROOT / "assets" / "_archive-vpw2-fresh",
        "LIKED - pre-reset": ROOT / "assets" / "_archive-pre-reset" / "scenes",
    }
    image_counts = {label.split(" - ")[0]: 0 for label in sources}
    missing: list[str] = []
    cards: list[str] = []

    for shot_id in SHOT_IDS:
        shot = shots.get(shot_id)
        entry = manifest.get(shot_id)
        if shot is None:
            missing.append(f"{shot_id}: current shots.json record missing")
            shot = {}
        if entry is None:
            missing.append(f"{shot_id}: current manifest record missing")
            entry = {}

        image_uris: dict[str, str | None] = {}
        for label, directory in sources.items():
            set_name = label.split(" - ")[0]
            path = directory / f"{shot_id}.png"
            allowed = set_name != "LIKED" or shot_id in LIKED_SHOT_IDS
            if allowed and path.is_file():
                image_uris[label] = image_data_uri(path, quality, max_dimension)
                image_counts[set_name] += 1
            else:
                image_uris[label] = None
                if set_name != "LIKED":
                    missing.append(f"{shot_id}: {set_name} frame missing")
                elif shot_id in LIKED_SHOT_IDS:
                    missing.append(f"{shot_id}: expected LIKED frame missing")

        review_status = str(entry.get("review_status") or "status unavailable")
        if review_status == "verified":
            badge = '<span class="badge verified">verified</span>'
        elif review_status == "parked":
            badge = '<span class="badge parked">parked</span>'
        else:
            badge = f'<span class="badge unavailable">{html.escape(review_status)}</span>'

        stage_role = str(shot.get("stage_role") or "not staged")
        depiction_class = shot.get("depiction_class") or shot.get("shot_class")
        depiction = (
            f'<span class="meta-chip">depiction {html.escape(str(depiction_class))}</span>'
            if depiction_class else '<span class="meta-chip muted">depiction unavailable</span>'
        )
        parent = chain_parent(entry) if stage_role == "delta" else None
        parent_note = (
            f'<span class="meta-chip">chain parent {html.escape(parent)}</span>' if parent
            else ('<span class="meta-chip muted">chain parent unavailable</span>' if stage_role == "delta" else "")
        )
        parked = ""
        if review_status == "parked":
            reason = parked_reason(entry)
            parked = f'<p class="parked-reason">{html.escape(reason)}</p>' if reason else ""

        frames = "".join(frame_cell(label, image_uris[label], shot_id) for label in sources)
        vo_text = str(shot.get("vo_text") or shot.get("vo_ref") or "VO text unavailable")
        cards.append(
            '<article class="shot-card">'
            '<header class="card-header">'
            f'<span class="shot-id">{html.escape(shot_id)}</span>{badge}'
            f'<span class="meta-chip">stage role {html.escape(stage_role)}</span>{parent_note}{depiction}'
            '</header>'
            f'<div class="frames">{frames}</div>'
            f'<blockquote class="script-line"><span>VO</span> "{html.escape(vo_text)}"</blockquote>'
            f"{parked}</article>"
        )

    fragment = """<title>Bricks VPW3 Board</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; overflow-x: hidden; background: #111; color: #e8e8e8; font: 15px/1.45 Arial, sans-serif; }
.vpw3-board { min-height: 100vh; max-width: 100%; overflow-x: hidden; background: #111; padding: 24px; }
.board-inner { width: min(100%, 1800px); margin: 0 auto; }
.board-title { margin: 0 0 10px; font-size: clamp(24px, 3vw, 36px); letter-spacing: .02em; }
.legend { margin: 0 0 24px; padding: 16px 18px; border: 1px solid #343434; border-radius: 8px; background: #171717; color: #c8c8c8; }
.legend p { margin: 4px 0; }
.legend strong { color: #e8e8e8; }
.cards { display: grid; gap: 18px; }
.shot-card { min-width: 0; overflow: hidden; border: 1px solid #303030; border-radius: 9px; background: #181818; }
.card-header { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 10px 14px; border-bottom: 1px solid #303030; flex-wrap: wrap; }
.shot-id { font-weight: 700; letter-spacing: .08em; }
.badge, .meta-chip { display: inline-block; border: 1px solid #454545; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.badge { border-color: currentColor; }
.verified { color: #b6d7b6; background: #1d2a1d; }
.parked { color: #dec58d; background: #302a1d; }
.unavailable { color: #d0c5c5; background: #302020; }
.meta-chip { color: #c2c2c2; background: #262626; }
.muted { color: #777; }
.frames { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: #303030; }
.frame-cell { min-width: 0; background: #151515; }
.frame-label { padding: 8px 10px; color: #aaa; border-bottom: 1px solid #303030; font-size: 12px; font-weight: 700; letter-spacing: .06em; }
.frame-cell img { display: block; width: 100%; max-width: 100%; height: auto; cursor: zoom-in; background: #111; }
.placeholder { display: grid; grid-template-rows: auto 1fr; min-height: 250px; color: #777; }
.placeholder-copy { display: grid; place-items: center; padding: 28px; border: 1px dashed #424242; border-width: 0 1px 1px; font-size: 13px; }
.script-line { margin: 0; padding: 14px 16px; color: #d7d7d7; font-size: 16px; font-style: italic; }
.script-line span { margin-right: 8px; color: #999; font-size: 11px; font-style: normal; font-weight: 700; letter-spacing: .08em; }
.parked-reason { margin: -2px 16px 14px; color: #c5b589; font-size: 13px; }
.lightbox { position: fixed; inset: 0; z-index: 9999; display: none; place-items: center; padding: 24px; background: rgba(0, 0, 0, .93); cursor: zoom-out; }
.lightbox.open { display: grid; }
.lightbox img { max-width: 96vw; max-height: 92vh; object-fit: contain; cursor: default; }
.lightbox-note { position: fixed; right: 20px; bottom: 16px; color: #a8a8a8; font-size: 12px; }
@media (max-width: 720px) { .vpw3-board { padding: 12px; } .frames { grid-template-columns: 1fr; } .script-line { font-size: 15px; } }
</style>
<main class="vpw3-board">
  <div class="board-inner">
    <h1 class="board-title">Bricks - VPW3 L01-L25 Review Board</h1>
    <section class="legend" aria-label="Board legend">
      <p><strong>NEW</strong> = poyais-revert doctrine + VPW3 re-author, 2026-08-20. <strong>YESTERDAY</strong> = prior doctrine full rerun, 2026-08-19. <strong>LIKED</strong> = pre-reset frames Daniel liked.</p>
      <p><strong>Alignment note:</strong> rows align by slot number, not story beat; the three source files use different authored beat maps.</p>
      <p><strong>L09 is parked:</strong> its sanctioned retry left unrequested "PC" text on background boxes and a residual crowd-rig tone issue, so it remains amber rather than receiving another reroll.</p>
    </section>
    <section class="cards" aria-label="L01 to L25 shot comparisons">
__CARDS__
    </section>
  </div>
</main>
<div id="lightbox" class="lightbox" role="dialog" aria-modal="true" aria-label="Expanded board image"><img id="lightbox-image" alt="Expanded board frame"><span class="lightbox-note">Left/right arrows navigate | Esc or click outside to close</span></div>
<script>
(() => {
  const images = Array.from(document.querySelectorAll('[data-lightbox]'));
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
    last_size = 0
    for quality, max_dimension in ENCODING_LEVELS:
        fragment, image_counts, missing = render_board(quality, max_dimension)
        encoded = fragment.encode("utf-8")
        last_size = len(encoded)
        if last_size < MAX_BYTES:
            OUTPUT.write_bytes(encoded)
            print(json.dumps({
                "output": str(OUTPUT), "bytes": last_size, "quality": quality,
                "max_dimension": max_dimension, "image_counts": image_counts, "missing": missing,
            }, ensure_ascii=False))
            return
    raise RuntimeError(f"Board remains over 14 MB after final compression level: {last_size} bytes")


if __name__ == "__main__":
    main()
