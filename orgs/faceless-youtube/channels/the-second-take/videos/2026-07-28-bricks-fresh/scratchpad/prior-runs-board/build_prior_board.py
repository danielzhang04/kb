#!/usr/bin/env python3
"""Build a self-contained comparison board for the three prior bricks-fresh image runs."""
import base64
import html
import io
import json
import re
import unicodedata
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image, ImageOps


HERE = Path(__file__).resolve().parent
ARCHIVE_ROOT = Path(
    r"C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/"
    r"videos/2026-07-28-bricks-fresh/assets"
)
PRE_RESET = ARCHIVE_ROOT / "_archive-pre-reset"
PRE_RESET_SCENES = PRE_RESET / "scenes"
PRE_REGEN = ARCHIVE_ROOT / "_archive-pre-regen-2026-08-06"
MERGED = PRE_RESET / "_review" / "merged.json"
SHOTS = PRE_RESET / "shots.pre-reset.json"
WAVE_SCENES = Path(
    r"C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/"
    r"videos/2026-07-28-bricks-fresh/assets/scenes"
)
WAVE_MANIFEST = Path(
    r"C:/Users/danie/AppData/Local/Temp/claude/"
    r"C--Users-danie-kb/1cd9c89c-cfb7-46ed-9e64-824ddef0603c/"
    r"scratchpad/manifest-6c2.json"
)
WAVE_SHOTS = Path(
    r"C:/Users/danie/AppData/Local/Temp/claude/"
    r"C--Users-danie-kb/1cd9c89c-cfb7-46ed-9e64-824ddef0603c/"
    r"scratchpad/shots-6c2-era.json"
)
OUT = HERE / "board.html"
NOTES = HERE / "notes.md"
MAX_BYTES = 16 * 1024 * 1024
EXPECTED_RESET = 215
EXPECTED_REGEN = 24
WAVE_IDS = tuple(f"L{number:02d}" for number in range(26, 51))
PARKED_WAVE_IDS = ("L34", "L39")
EXPECTED_WAVE_IMAGES = 23
EXPECTED_WAVE_CARDS = 25


def ascii_text(value):
    """Keep HTML text stable even when archival metadata contains display-only Unicode."""
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")
    return value.replace("--", "-")


def note(text):
    with NOTES.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(text.rstrip() + "\n")


def natural_key(path):
    parts = re.split(r"(\d+)", path.stem)
    return tuple(int(part) if part.isdigit() else part.casefold() for part in parts)


def jpeg_uri(path, max_edge, quality):
    """Use the established board pattern: edge-capped optimized JPEG data URIs."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        if max(image.size) > max_edge:
            ratio = max_edge / max(image.size)
            image = image.resize(
                (round(image.width * ratio), round(image.height * ratio)),
                Image.Resampling.LANCZOS,
            )
        encoded = io.BytesIO()
        image.save(encoded, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(encoded.getvalue()).decode("ascii")


def load_shot_metadata():
    source = json.loads(SHOTS.read_text(encoding="utf-8"))
    candidates = source.get("long_form", {}).get("shots", []) if isinstance(source, dict) else []
    result = {}
    for shot in candidates:
        if isinstance(shot, dict) and shot.get("id"):
            result[str(shot["id"])] = {
                "script": shot.get("vo_text") or shot.get("vo_ref") or "",
                "prompt": shot.get("still_prompt") or "",
            }
    return result


def load_wave_rows():
    """Load the 6c2-close manifest and its contemporaneous narration spans."""
    manifest_source = json.loads(WAVE_MANIFEST.read_text(encoding="utf-8-sig"))
    manifest_entries = manifest_source.get("shots", []) if isinstance(manifest_source, dict) else []
    if not isinstance(manifest_entries, list):
        raise TypeError("manifest-6c2.json shots is not a list")
    manifest = {}
    duplicate_ids = []
    for entry in manifest_entries:
        if not isinstance(entry, dict) or not entry.get("shot_id"):
            continue
        shot_id = str(entry["shot_id"])
        if shot_id in manifest:
            duplicate_ids.append(shot_id)
        manifest[shot_id] = entry

    shots_source = json.loads(WAVE_SHOTS.read_text(encoding="utf-8-sig"))
    candidates = shots_source.get("long_form", {}).get("shots", []) if isinstance(shots_source, dict) else []
    metadata = {}
    for shot in candidates:
        if isinstance(shot, dict) and shot.get("id"):
            metadata[str(shot["id"])] = shot.get("vo_text") or shot.get("vo_ref") or ""

    files = {image.stem: image for image in WAVE_SCENES.glob("*.png")}
    expected_files = set(WAVE_IDS) - set(PARKED_WAVE_IDS)
    if set(files) != expected_files:
        raise AssertionError(
            "6c2 source IDs do not equal L26-L50 minus parked L34/L39: "
            f"found {', '.join(sorted(files))}"
        )
    rows = []
    for shot_id in WAVE_IDS:
        entry = manifest.get(shot_id)
        badge = "unreviewed" if entry is None else str(entry.get("review_status") or "reviewed")
        rows.append({
            "run": "6c2-wave",
            "id": shot_id,
            "image": files.get(shot_id),
            "badge": badge,
            "review": entry,
            "script": metadata.get(shot_id, ""),
            "placeholder": shot_id in PARKED_WAVE_IDS,
        })
    return rows, duplicate_ids


def normal_badge(entry):
    if entry is None:
        return "unreviewed"
    raw = ascii_text(entry.get("worst", "reviewed")).strip().lower().replace(" ", "-")
    if raw in {"", "clean", "pass", "passed", "verified"}:
        return "verified"
    return raw


def load_rows():
    pre_reset_files = sorted(PRE_RESET_SCENES.glob("*.png"), key=natural_key)
    pre_regen_files = sorted(PRE_REGEN.glob("*.png"), key=natural_key)
    merged_list = json.loads(MERGED.read_text(encoding="utf-8"))
    if not isinstance(merged_list, list):
        raise TypeError("merged.json is not a list")
    merged = {}
    duplicate_ids = []
    for entry in merged_list:
        if not isinstance(entry, dict) or not entry.get("id"):
            continue
        shot_id = str(entry["id"])
        if shot_id in merged:
            duplicate_ids.append(shot_id)
        merged[shot_id] = entry
    shot_metadata = load_shot_metadata()
    rows = []
    for image in pre_reset_files:
        shot_id = image.stem
        entry = merged.get(shot_id)
        meta = shot_metadata.get(shot_id, {})
        rows.append({
            "run": "pre-reset",
            "id": shot_id,
            "image": image,
            "badge": normal_badge(entry),
            "review": entry,
            "script": meta.get("script", ""),
            "prompt": meta.get("prompt", ""),
        })
    regen_rows = [
        {"run": "pre-regen", "id": image.stem, "image": image, "badge": "prior-still"}
        for image in pre_regen_files
    ]
    return rows, regen_rows, duplicate_ids


def encode_all(rows, max_edge, quality):
    errors, uris = [], {}
    for row in rows:
        try:
            uris[row["image"]] = jpeg_uri(row["image"], max_edge, quality)
        except Exception as exc:  # Corruption must be named, never silently skipped.
            errors.append(f"{row['image']}: {type(exc).__name__}: {exc}")
    return uris, errors


def badge_html(label):
    css = re.sub(r"[^a-z0-9_-]", "-", label.lower())
    return f'<span class="badge {css}">{html.escape(ascii_text(label).upper())}</span>'


def pre_reset_card(row, uri):
    review = row["review"] or {}
    axes = ", ".join(f"{key}:{review[key]}" for key in ("r", "f", "s") if key in review)
    review_detail = (f"review: worst={review.get('worst', '')}" + (f"; {axes}" if axes else "")) if review else "review: no matching merged.json entry"
    why = review.get("why", "") if review else ""
    script = row["script"] or "No script line extractable from shots.pre-reset.json."
    prompt = row["prompt"]
    alt = ascii_text(f"Pre-reset {row['id']} {row['badge']}. {script}")
    prompt_html = (
        f'<details><summary>Prompt text</summary><p>{html.escape(ascii_text(prompt))}</p></details>'
        if prompt else ""
    )
    why_html = f'<p class="why">{html.escape(ascii_text(why))}</p>' if why else ""
    return f'''<article class="card {html.escape(row['badge'], quote=True)}">
  <div class="image-frame"><img class="board-image" src="{uri}" alt="{html.escape(alt, quote=True)}" loading="lazy"></div>
  <header><strong>{html.escape(ascii_text(row['id']))}</strong>{badge_html(row['badge'])}</header>
  <p class="detail">{html.escape(ascii_text(review_detail))}</p>
  <p class="script"><strong>Script:</strong> {html.escape(ascii_text(script))}</p>
  {why_html}
  {prompt_html}
</article>'''


def regen_card(row, uri):
    alt = ascii_text(f"Pre-regen 2026-08-06 {row['image'].name}")
    return f'''<article class="card prior-still">
  <div class="image-frame"><img class="board-image" src="{uri}" alt="{html.escape(alt, quote=True)}" loading="lazy"></div>
  <header><strong>{html.escape(ascii_text(row['image'].name))}</strong>{badge_html('prior still')}</header>
</article>'''


def wave_card(row, uri):
    script = row["script"] or "No narration line extractable from shots-6c2-era.json."
    placeholder = row["placeholder"]
    alt = ascii_text(f"6c2 machine-tier wave {row['id']} {row['badge']}")
    frame = (
        '<div class="image-frame placeholder"><p>parked — no promoted frame</p></div>'
        if placeholder
        else (
            f'<div class="image-frame"><img class="board-image" src="{uri}" '
            f'alt="{html.escape(alt, quote=True)}" '
            f'data-caption="{html.escape(ascii_text(script), quote=True)}" loading="lazy"></div>'
        )
    )
    return f'''<article class="card wave-6c2 {html.escape(row['badge'], quote=True)}" data-wave-badge="{html.escape(row['badge'], quote=True)}" data-wave-script="{'present' if row['script'] else 'missing'}"{' data-placeholder="true"' if placeholder else ''}>
  {frame}
  <header><strong>{html.escape(ascii_text(row['id']))}</strong>{badge_html(row['badge'])}</header>
  <p class="script"><strong>Script:</strong> {html.escape(ascii_text(script))}</p>
</article>'''


def render(wave_rows, pre_reset_rows, regen_rows, uris, settings):
    badges = Counter(row["badge"] for row in pre_reset_rows)
    wave_badges = Counter(row["badge"] for row in wave_rows)
    matched = len(pre_reset_rows) - badges["unreviewed"]
    wave_images = sum(not row["placeholder"] for row in wave_rows)
    wave_scripts = sum(bool(row["script"]) for row in wave_rows)
    wave_cards = "".join(wave_card(row, uris.get(row["image"])) for row in wave_rows)
    reset_cards = "".join(pre_reset_card(row, uris[row["image"]]) for row in pre_reset_rows)
    regen_cards = "".join(regen_card(row, uris[row["image"]]) for row in regen_rows)
    badge_summary = " / ".join(f"{count} {label}" for label, count in sorted(badges.items()))
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bricks-Fresh Prior Full Runs Board</title>
<style>
:root{{--bg:#091018;--panel:#111c28;--panel2:#17283a;--line:#34495d;--text:#f3f7fb;--muted:#adc0d2;--ok:#83dfa1;--bad:#ff897d;--warn:#ffd36a;--ref:#9ac9ff}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}}h1,h2,h3,p{{margin:0}}.top,main{{max-width:1900px;margin:auto}}.top{{padding:22px 20px;background:#0d1722;border-bottom:1px solid var(--line)}}h1{{font-size:28px}}.muted{{color:var(--muted);margin-top:5px}}.summary{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}}.summary div{{padding:12px;background:var(--panel);border:1px solid var(--line);font-size:13px}}.summary strong{{display:block;margin-bottom:5px;color:var(--ref);letter-spacing:.03em}}main{{padding:22px 20px 60px}}.run{{margin-bottom:38px}}.run-header{{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:12px}}h2{{font-size:20px;text-transform:uppercase;letter-spacing:.03em;color:var(--ref)}}.count{{color:var(--muted);font-size:13px}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:13px}}.card{{background:#0d1722;border:1px solid var(--line);padding:9px;min-width:0}}.card header{{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 0 5px}}.card header strong{{font-size:15px;overflow-wrap:anywhere}}.image-frame{{background:#030609}}.image-frame.placeholder{{display:grid;place-items:center;min-height:180px;padding:18px;color:var(--bad);text-align:center}}.board-image{{display:block;width:100%;cursor:zoom-in}}.badge{{padding:3px 7px;border:1px solid #687b90;border-radius:3px;font-size:10px;font-weight:800;letter-spacing:.06em;white-space:nowrap;color:var(--muted)}}.badge.verified{{background:#123222;border-color:#397b4e;color:var(--ok)}}.badge.parked,.badge.fail,.badge.failed,.badge.rejected{{background:#3a2024;border-color:#803b41;color:var(--bad)}}.badge.unreviewed{{background:#3a3218;border-color:#847039;color:var(--warn)}}.badge.prior-still{{background:#172d45;border-color:#38658f;color:var(--ref)}}.detail,.why,.script,details{{font-size:11px;color:var(--muted);margin-top:5px;overflow-wrap:anywhere}}.why{{color:#ffc3bd}}details summary{{cursor:pointer;color:var(--ref)}}details p{{margin-top:5px;white-space:pre-wrap}}#lightbox{{display:none;position:fixed;inset:0;z-index:10;padding:28px 64px;background:rgba(0,0,0,.96)}}#lightbox.open{{display:grid;place-items:center}}#lightbox img{{display:block;max-width:92vw;max-height:85vh;object-fit:contain;background:#030609}}#lb-caption{{margin-top:9px;color:var(--muted);text-align:center;max-width:80vw}}#lightbox button{{position:fixed;border:1px solid #626d7a;background:#171c23;color:var(--text);padding:8px 12px;font:22px/1 system-ui,sans-serif;cursor:pointer}}#lb-close{{top:16px;right:16px;font-size:14px!important}}#lb-prev{{left:16px;top:50%}}#lb-next{{right:16px;top:50%}}@media(max-width:760px){{.summary,.grid{{grid-template-columns:1fr}}#lightbox{{padding:20px}}}}
</style></head><body>
<header class="top"><h1>Bricks-Fresh Prior Full Image Runs</h1><p class="muted">Three prior full image runs, preserved for direct comparison against the current generation. All {wave_images + len(pre_reset_rows) + len(regen_rows)} stills are embedded in this standalone board.</p><div class="summary"><div><strong>6C2 MACHINE-TIER WAVE</strong>{len(wave_rows)} shots: {wave_badges['verified']} verified / {sum(row['placeholder'] for row in wave_rows)} parked<br><span class="muted">{wave_scripts} narration spans</span></div><div><strong>PRE-RESET FULL RUN</strong>{len(pre_reset_rows)} scenes<br><span class="muted">{matched} merged.json matches / {badges['unreviewed']} unreviewed</span></div><div><strong>PRE-REGEN 2026-08-06</strong>{len(regen_rows)} stills, filename order</div></div></header>
<main><section class="run"><div class="run-header"><h2>6c2 machine-tier wave (2026-08-06/07) — L26–L50, 23/25 verified</h2><span class="count">{len(wave_rows)} shots; {wave_images} promoted stills / {sum(row['placeholder'] for row in wave_rows)} parked</span></div><div class="grid">{wave_cards}</div></section><section class="run"><div class="run-header"><h2>Pre-reset full run</h2><span class="count">{len(pre_reset_rows)} scenes in shot-id order</span></div><div class="grid">{reset_cards}</div></section><section class="run"><div class="run-header"><h2>Pre-regen 2026-08-06</h2><span class="count">{len(regen_rows)} stills in filename order</span></div><div class="grid">{regen_cards}</div></section></main>
<div id="lightbox" aria-hidden="true"><div><img id="lb-image" alt=""><div id="lb-caption"></div></div><button id="lb-close" type="button">Esc</button><button id="lb-prev" type="button" aria-label="Previous image">&lt;</button><button id="lb-next" type="button" aria-label="Next image">&gt;</button></div>
<script>(()=>{{const box=document.getElementById('lightbox'),image=document.getElementById('lb-image'),caption=document.getElementById('lb-caption'),images=[...document.querySelectorAll('.board-image')];let index=0;const show=next=>{{index=(next+images.length)%images.length;const current=images[index];image.src=current.src;image.alt=current.alt;caption.textContent=current.dataset.caption||current.alt;box.classList.add('open');box.setAttribute('aria-hidden','false')}};const close=()=>{{box.classList.remove('open');box.setAttribute('aria-hidden','true');image.removeAttribute('src')}};images.forEach((node,i)=>node.addEventListener('click',()=>show(i)));document.getElementById('lb-close').addEventListener('click',close);document.getElementById('lb-prev').addEventListener('click',()=>show(index-1));document.getElementById('lb-next').addEventListener('click',()=>show(index+1));document.addEventListener('keydown',event=>{{if(!box.classList.contains('open'))return;if(event.key==='Escape')close();if(event.key==='ArrowLeft')show(index-1);if(event.key==='ArrowRight')show(index+1)}});box.addEventListener('click',event=>{{if(event.target===box)close()}})}})();</script>
</body></html>'''


class ImageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.board_images = 0
        self.embedded = 0
        self.wave_cards = 0
        self.placeholders = 0
        self.wave_badges = Counter()
        self.wave_scripts = Counter()

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == "article" and "wave-6c2" in data.get("class", "").split():
            self.wave_cards += 1
            self.wave_badges[data.get("data-wave-badge", "unreviewed")] += 1
            self.wave_scripts[data.get("data-wave-script", "missing")] += 1
            if data.get("data-placeholder") == "true":
                self.placeholders += 1
        if tag != "img":
            return
        if "board-image" in data.get("class", "").split():
            self.board_images += 1
            if data.get("src", "").startswith("data:image/jpeg;base64,"):
                self.embedded += 1


def verify_html(expected_images, expected_wave_cards, expected_placeholders, expected_wave_badges, expected_wave_scripts):
    parser = ImageParser()
    parser.feed(OUT.read_text(encoding="utf-8"))
    if (parser.board_images, parser.embedded) != (expected_images, expected_images):
        raise AssertionError(
            f"Parsed {parser.board_images} board images / {parser.embedded} embedded JPEGs; "
            f"expected {expected_images}"
        )
    if parser.wave_cards != expected_wave_cards or parser.placeholders != expected_placeholders:
        raise AssertionError(
            f"Parsed {parser.wave_cards} 6c2 cards / {parser.placeholders} placeholders; "
            f"expected {expected_wave_cards} / {expected_placeholders}"
        )
    if parser.wave_badges != expected_wave_badges or parser.wave_scripts != expected_wave_scripts:
        raise AssertionError(
            f"Parsed 6c2 badges {dict(parser.wave_badges)} / spans {dict(parser.wave_scripts)}; "
            f"expected {dict(expected_wave_badges)} / {dict(expected_wave_scripts)}"
        )
    return parser


def main():
    pre_reset_rows, regen_rows, duplicate_ids = load_rows()
    wave_rows, wave_duplicate_ids = load_wave_rows()
    badges = Counter(row["badge"] for row in pre_reset_rows)
    wave_badges = Counter(row["badge"] for row in wave_rows)
    matched = len(pre_reset_rows) - badges["unreviewed"]
    wave_images = sum(not row["placeholder"] for row in wave_rows)
    wave_scripts = Counter("present" if row["script"] else "missing" for row in wave_rows)
    note("\n## 5. 6c2 machine-tier wave build\n")
    note("\n### Source inventory\n")
    note(f"- Pre-reset PNGs discovered: {len(pre_reset_rows)} (expected {EXPECTED_RESET}).")
    note(f"- Pre-regen PNGs discovered: {len(regen_rows)} (expected {EXPECTED_REGEN}).")
    note(f"- 6c2 cards: {len(wave_rows)} (expected {EXPECTED_WAVE_CARDS}); promoted PNGs: {wave_images} (expected {EXPECTED_WAVE_IMAGES}); parked: {', '.join(PARKED_WAVE_IDS)}.")
    note(f"- merged.json matching pre-reset IDs: {matched}; unreviewed: {badges['unreviewed']}.")
    note(f"- Duplicate merged IDs: {', '.join(duplicate_ids) if duplicate_ids else 'none'}.\n")
    note(f"- Duplicate 6c2 manifest IDs: {', '.join(wave_duplicate_ids) if wave_duplicate_ids else 'none'}.\n")
    if len(pre_reset_rows) != EXPECTED_RESET or len(regen_rows) != EXPECTED_REGEN or wave_images != EXPECTED_WAVE_IMAGES or len(wave_rows) != EXPECTED_WAVE_CARDS:
        raise AssertionError("Source image inventory does not match requested full-run counts")

    all_rows = [row for row in wave_rows if row["image"] is not None] + pre_reset_rows + regen_rows
    settings = None
    uris = {}
    for quality in (65, 60, 55, 50, 45, 40, 35, 30, 25, 20):
        candidate_uris, errors = encode_all(all_rows, 512, quality)
        if errors:
            note("\n## Readability anomalies\n" + "\n".join(f"- {error}" for error in errors))
            raise RuntimeError("Unreadable source PNGs; listed in notes.md")
        document = render(wave_rows, pre_reset_rows, regen_rows, candidate_uris, {"edge": 512, "quality": quality})
        if len(document.encode("utf-8")) < MAX_BYTES:
            settings, uris = {"edge": 512, "quality": quality}, candidate_uris
            break
    if settings is None:
        for edge in (480, 448, 416, 384, 352, 320):
            candidate_uris, errors = encode_all(all_rows, edge, 20)
            if errors:
                note("\n## Readability anomalies\n" + "\n".join(f"- {error}" for error in errors))
                raise RuntimeError("Unreadable source PNGs; listed in notes.md")
            document = render(wave_rows, pre_reset_rows, regen_rows, candidate_uris, {"edge": edge, "quality": 20})
            if len(document.encode("utf-8")) < MAX_BYTES:
                settings, uris = {"edge": edge, "quality": 20}, candidate_uris
                break
    if settings is None:
        raise AssertionError("Could not fit all images below 16 MiB without dropping images")

    note("### 6c2 machine-tier wave (2026-08-06/07)\n")
    note(f"- Rendered {len(wave_rows)} L26-L50 cards: {wave_images} embedded images and {sum(row['placeholder'] for row in wave_rows)} parked placeholders.")
    note("- Badge breakdown: " + ", ".join(f"{label}={count}" for label, count in sorted(wave_badges.items())) + ".")
    note(f"- Script-span coverage: present={wave_scripts['present']}, missing={wave_scripts['missing']}.\n")
    note("### Pre-reset full run\n")
    note(f"- Rendered {len(pre_reset_rows)} cards in natural shot-id order.")
    note("- Badge breakdown: " + ", ".join(f"{label}={count}" for label, count in sorted(badges.items())) + ".")
    note(f"- Script/prompt metadata extracted for {sum(bool(r['script'] or r['prompt']) for r in pre_reset_rows)} cards.\n")
    note("### Pre-regen 2026-08-06\n")
    note(f"- Rendered {len(regen_rows)} cards in natural filename order.\n")

    OUT.write_text(render(wave_rows, pre_reset_rows, regen_rows, uris, settings), encoding="utf-8", newline="\n")
    parser = verify_html(
        EXPECTED_RESET + EXPECTED_REGEN + EXPECTED_WAVE_IMAGES,
        EXPECTED_WAVE_CARDS,
        len(PARKED_WAVE_IDS),
        wave_badges,
        wave_scripts,
    )
    final_bytes = OUT.stat().st_size
    if final_bytes >= MAX_BYTES:
        raise AssertionError(f"Final board is {final_bytes:,} bytes, not below 16 MiB")
    note("### Final verification\n")
    note("| Section | Source files | Embedded images | Badge breakdown |")
    note("| --- | ---: | ---: | --- |")
    note(f"| Pre-reset full run | {len(pre_reset_rows)} | {len(pre_reset_rows)} | " + ", ".join(f"{label} {count}" for label, count in sorted(badges.items())) + " |")
    note(f"| Pre-regen 2026-08-06 | {len(regen_rows)} | {len(regen_rows)} | prior still {len(regen_rows)} |")
    note(f"| 6c2 machine-tier wave | {len(wave_rows)} cards / {wave_images} PNGs | {wave_images} | " + ", ".join(f"{label} {count}" for label, count in sorted(wave_badges.items())) + f"; narration present {wave_scripts['present']}, missing {wave_scripts['missing']} |")
    note(f"| Total | {len(all_rows)} | {parser.embedded} | parsed board-image count {parser.board_images}; placeholders {parser.placeholders} |\n")
    note(f"- Final board: {final_bytes:,} bytes (< {MAX_BYTES:,}); JPEG max edge {settings['edge']}, quality {settings['quality']}.")
    note("- Source PNG readability anomalies: none.")
    print(f"pre-reset: {len(pre_reset_rows)}; matched {matched}; badges {dict(sorted(badges.items()))}")
    print(f"pre-regen: {len(regen_rows)}")
    print(f"6c2: {len(wave_rows)} cards; {wave_images} images; {parser.placeholders} placeholders; badges {dict(sorted(wave_badges.items()))}; narration {dict(sorted(wave_scripts.items()))}")
    print(f"parsed board images: {parser.board_images}; embedded JPEGs: {parser.embedded}")
    print(f"board: {final_bytes:,} bytes; edge {settings['edge']}; quality {settings['quality']}")


if __name__ == "__main__":
    main()
