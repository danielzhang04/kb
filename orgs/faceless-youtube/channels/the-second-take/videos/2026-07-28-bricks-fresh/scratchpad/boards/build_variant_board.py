"""Build the morning A/B/C/D comparison-board Artifact for the Bricks doctrine trial."""

from __future__ import annotations

import base64
import html
import io
import json
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "scratchpad" / "boards" / "variant-board.html"
REVIEW = ROOT / "scratchpad" / "taste-audit" / "variant-d-blind-review.md"
VIDEO_PATH = "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh"
SHOT_IDS = [f"L{number:02d}" for number in range(1, 13)]
MAX_BYTES = 14 * 1024 * 1024
ENCODING_LEVELS = ((78, 880), (70, 720))
VARIANTS = {
    "A": {"key": "va", "branch": "claude/bricks-variant-va", "description": "poyais-end restoration (net −3,171; suffix kept)"},
    "B": {"key": "vb", "branch": "claude/bricks-variant-vb", "description": "restoration + no-suffix dispatch (liked-run call shape)"},
    "C": {"key": "vc", "branch": "claude/bricks-variant-vc", "description": "current doctrine + surgical fixes only"},
    "D": {"key": "vd", "branch": "claude/bricks-variant-vd", "description": "hold-camera chains + grounded stage palette + actor-first occupancy + bounded crowd geometry"},
}

HEADER_LABELS = {
    "A": "restoration + suffix",
    "B": "restoration, no suffix",
    "C": "surgical fixes",
    "D": "hold-camera + grounded palette",
}

DECISION_COPIES = {
    "A": "Make the −3,171-line poyais-end restoration permanent doctrine <strong>with</strong> the suffix.",
    "B": "Make the −3,171-line restoration permanent doctrine <strong>without</strong> the suffix, using the liked-run call shape.",
    "C": "Keep current doctrine and make only surgical fixes; no restoration becomes permanent.",
    "D": "Use the hold-camera, grounded-palette, actor-first, bounded-crowd criterion set tested here; retain the existing engine, style tile, suffix, seeds, and render register.",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def git_show(branch: str, relative_path: str) -> str:
    """Read a branch file as requested, without checking out or writing to git."""
    result = subprocess.run(
        ["git", "show", f"{branch}:{VIDEO_PATH}/{relative_path}"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise FileNotFoundError(f"{branch}:{relative_path}: {result.stderr.strip()}")
    return result.stdout


def load_branch_shots(branch: str) -> list[dict]:
    source = json.loads(git_show(branch, "shots.json"))
    shots = source["long_form"]["shots"]
    by_id = {shot.get("id"): shot for shot in shots}
    missing = [shot_id for shot_id in SHOT_IDS if shot_id not in by_id]
    if missing:
        raise ValueError(f"{branch} shots.json missing {', '.join(missing)}")
    # The user asked for VO order, rather than an ID join.  These are the first
    # twelve generated shots in each trial source; their text is intentionally
    # left independent when the scripts partition the VO differently.
    ordered = [shot for shot in shots if shot.get("id") in SHOT_IDS]
    if len(ordered) != 12:
        raise ValueError(f"{branch} did not yield exactly twelve trial shots")
    return ordered


def latest_trial_manifest(manifest: dict, key: str) -> dict[str, dict]:
    """Return only the explicitly reviewed L01–L12 trial subset, never stale extras."""
    entries = manifest.get("shots", [])
    selected: dict[str, dict] = {}
    for entry in entries:
        shot_id = entry.get("shot_id")
        if shot_id in SHOT_IDS:
            selected[shot_id] = entry
    missing = [shot_id for shot_id in SHOT_IDS if shot_id not in selected]
    if missing:
        raise ValueError(f"{key} manifest misses trial rows: {', '.join(missing)}")
    return selected


def image_uri(path: Path, quality: int, max_dimension: int) -> str:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode == "RGBA":
            base = Image.new("RGBA", image.size, "#111111")
            base.alpha_composite(image)
            image = base.convert("RGB")
        elif image.mode != "RGB":
            image = image.convert("RGB")
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def reason(entry: dict) -> str:
    reasons = entry.get("parked_reasons") or []
    if isinstance(reasons, str):
        return reasons
    return str(reasons[-1]) if reasons else "No reason recorded."


def state_badge(entry: dict) -> str:
    status = entry.get("review_status", "unreviewed")
    if status == "verified":
        return '<span class="badge verified">verified</span>'
    return f'<span class="badge parked" title="{html.escape(reason(entry), quote=True)}">parked</span>'


def cost_for(manifest: dict) -> str:
    for field in ("cost_usd", "cost", "usd"):
        if field in manifest:
            return f"${manifest[field]:,.2f}"
    return "$— (not recorded)"


def inline_markdown(text: str) -> str:
    safe = html.escape(text.strip())
    safe = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", safe)
    safe = re.sub(r"`(.+?)`", r"<code>\1</code>", safe)
    return safe.replace("—", "&mdash;")


def verdict_chip(value: str) -> str:
    upper = value.upper()
    cls = "pass" if "PASS" in upper else "fail" if "FAIL" in upper else "mixed"
    return f'<span class="chip {cls}">{inline_markdown(value)}</span>'


def markdown_table(lines: list[str]) -> str:
    rows = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not cells or all(re.fullmatch(r"[-: ]+", cell) for cell in cells):
            continue
        rows.append(cells)
    if not rows:
        return ""
    header, body = rows[0], rows[1:]
    rendered = ["<div class=\"table-scroll\"><table class=\"rubric\"><thead><tr>"]
    rendered.extend(f"<th>{inline_markdown(cell)}</th>" for cell in header)
    rendered.append("</tr></thead><tbody>")
    for row in body:
        rendered.append("<tr>")
        for index, cell in enumerate(row):
            rendered.append(f"<td>{verdict_chip(cell) if index == 2 else inline_markdown(cell)}</td>")
        rendered.append("</tr>")
    rendered.append("</tbody></table></div>")
    return "".join(rendered)


def review_sections() -> str:
    """Render the review's required rubric, ranking, frames, and liked verdict."""
    if not REVIEW.is_file():
        return f"<p>Blind review pending — {html.escape(str(REVIEW))}</p>"
    source = REVIEW.read_text(encoding="utf-8")
    wanted = ["## 1.", "## 2.", "## 3.", "## 4."]
    chunks = []
    for number, marker in enumerate(wanted):
        start = source.index(marker)
        end = source.index(wanted[number + 1], start) if number + 1 < len(wanted) else source.index("## 5.", start)
        chunks.append(source[start:end].strip())
    rendered: list[str] = []
    for chunk in chunks:
        lines = chunk.splitlines()
        index = 0
        while index < len(lines):
            line = lines[index]
            if line.startswith("## "):
                rendered.append(f"<h2>{inline_markdown(line[3:])}</h2>")
            elif line.startswith("### "):
                rendered.append(f"<h3>{inline_markdown(line[4:])}</h3>")
            elif line.startswith("|"):
                table_lines = []
                while index < len(lines) and lines[index].startswith("|"):
                    table_lines.append(lines[index])
                    index += 1
                rendered.append(markdown_table(table_lines))
                continue
            elif line.strip().startswith("**") or line.strip():
                rendered.append(f"<p>{inline_markdown(line)}</p>")
            index += 1
    return "\n".join(rendered)


def decision_section() -> str:
    questions = [
        "Which criterion set reads best shot by shot, and which individual D changes should survive even if D does not win overall?",
        "Does any preferred D frame depend on a changed subject/composition rather than the criterion it is meant to test?",
        "What render-register change would close the shared flat-cel gap before the full recut?",
        "Which parked-frame mechanism is repaired at its source before new full-length generation?",
        "Should C’s stronger symbolic vocabulary be carried into a restoration dispatch without importing its crowd failures?",
        "Which existing shots, if any, are preserved rather than recut once the doctrine choice is made?",
    ]
    cards = "".join(
        f"<article><h3>Pick {name}</h3><p>{DECISION_COPIES[name]}</p></article>"
        for name in VARIANTS
    )
    return """
<section class="decision" aria-labelledby="decision-heading">
  <h2 id="decision-heading">Decision</h2>
  <div class="decision-cards">__CARDS__</div>
  <h3>The six recut questions</h3>
  <ol>__QUESTIONS__</ol>
  <p class="procedure"><strong>Morning procedure:</strong> reply with A, B, C, D, or an iteration note; a fresh terminal makes the choice permanent and starts the full-length generation.</p>
</section>
""".replace("__CARDS__", cards).replace("__QUESTIONS__", "".join(f"<li>{html.escape(question)}</li>" for question in questions))


def render(quality: int, max_dimension: int) -> tuple[str, dict[str, int], list[str]]:
    branches = {name: load_branch_shots(spec["branch"]) for name, spec in VARIANTS.items()}
    manifests = {
        name: latest_trial_manifest(load_json(ROOT / "scratchpad" / "variant-frames" / spec["key"] / "manifest.json"), spec["key"])
        for name, spec in VARIANTS.items()
    }
    image_counts = {name: 0 for name in VARIANTS}
    missing: list[str] = []
    grid_rows: list[str] = []
    lightbox_index = 0
    for row_number in range(12):
        cells = []
        for name, spec in VARIANTS.items():
            shot = branches[name][row_number]
            shot_id = shot["id"]
            entry = manifests[name][shot_id]
            path = ROOT / "scratchpad" / "variant-frames" / spec["key"] / f"{shot_id}.png"
            vo = str(shot.get("vo_text") or shot.get("vo_ref") or "VO text unavailable")
            if path.is_file():
                uri = image_uri(path, quality, max_dimension)
                image = f'<img src="{uri}" alt="Variant {name}, {html.escape(shot_id)}" data-lightbox-index="{lightbox_index}">'
                lightbox_index += 1
                image_counts[name] += 1
            else:
                missing_reason = reason(entry) or "no called frame recorded"
                missing.append(f"{name}/{shot_id} image — {missing_reason}")
                image = f'<div class="image-missing">frame missing — {html.escape(missing_reason)}</div>'
            parked = f'<p class="parked-reason">{html.escape(reason(entry))}</p>' if entry.get("review_status") == "parked" else ""
            cells.append(
                "<td><article class=\"shot-cell\">"
                f"<button class=\"image-button\" aria-label=\"Open Variant {name} {html.escape(shot_id)}\">{image}</button>"
                "<div class=\"shot-meta\">"
                f"{state_badge(entry)} <span class=\"shot-id\">{html.escape(shot_id)}</span>"
                f"<p class=\"vo\">{html.escape(vo)}</p>{parked}</div></article></td>"
            )
        grid_rows.append(f"<tr><th scope=\"row\">{row_number + 1:02d}</th>{''.join(cells)}</tr>")
    stats = []
    for name, spec in VARIANTS.items():
        entries = manifests[name].values()
        verified = sum(entry.get("review_status") == "verified" for entry in entries)
        parked = sum(entry.get("review_status") == "parked" for entry in entries)
        raw_manifest = load_json(ROOT / "scratchpad" / "variant-frames" / spec["key"] / "manifest.json")
        stats.append(f"<li><strong>{name}</strong> &mdash; {html.escape(spec['description'])}<br><span>{verified} verified / {parked} parked / {cost_for(raw_manifest)}</span></li>")
    page = """<title>Bricks Variant Trial</title>
<style>
*{box-sizing:border-box} body{margin:0;overflow-x:hidden;background:#111;color:#e8e8e8;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}.board{min-height:100vh;background:#111;padding:24px}.wrap{max-width:1800px;margin:auto}.hero,.section,.decision{background:#171717;border:1px solid #303030;border-radius:12px;padding:22px;margin:0 0 22px}.eyebrow{margin:0 0 6px;color:#a5a5a5;font-size:12px;letter-spacing:.11em;text-transform:uppercase}h1{margin:0;font-size:clamp(28px,4vw,46px);line-height:1.1}h2{margin:0 0 14px;font-size:24px}h3{margin:22px 0 8px;font-size:18px}p{margin:8px 0;color:#d0d0d0}code{color:#d9c18e}.variant-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0 0;padding:0;list-style:none}.variant-summary li{padding:14px;border:1px solid #343434;border-radius:8px;background:#121212}.variant-summary span{color:#b7b7b7;font-size:13px}.grid-scroll,.table-scroll{max-width:100%;overflow:auto;border:1px solid #303030;border-radius:9px}.comparison{width:100%;min-width:1300px;border-collapse:separate;border-spacing:0;background:#121212}.comparison th,.comparison td{vertical-align:top;border-right:1px solid #303030;border-bottom:1px solid #303030}.comparison tr>*:last-child{border-right:0}.comparison tbody tr:last-child>*{border-bottom:0}.comparison thead th{position:sticky;top:0;z-index:2;background:#202020;padding:12px;text-align:left;letter-spacing:.08em;font-size:13px}.comparison thead th:first-child{width:54px;text-align:center}.comparison tbody>tr>th{padding:14px 8px;color:#a8a8a8;text-align:center;background:#181818}.shot-cell{min-width:310px}.image-button{display:block;width:100%;padding:0;border:0;background:#0d0d0d;cursor:zoom-in}.image-button img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover}.image-missing{display:grid;place-items:center;aspect-ratio:16/9;color:#c98787;border:1px dashed #7c4545}.shot-meta{padding:10px 12px}.shot-id{margin-left:8px;color:#fff;font-weight:700;letter-spacing:.07em}.badge,.chip{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid;font-size:12px;font-weight:700;white-space:nowrap}.verified,.pass{color:#b9dfba;background:#162819;border-color:#46744b}.parked,.mixed{color:#efd49a;background:#332a18;border-color:#80652f}.fail{color:#f1b1ad;background:#351c1b;border-color:#7e403c}.vo{margin:9px 0 0;color:#efefef;font-style:italic}.parked-reason{margin:9px 0 0;color:#d5bd8b;font-size:12px}.rubric{border-collapse:collapse;min-width:760px;width:100%}.rubric th,.rubric td{padding:10px;vertical-align:top;text-align:left;border-right:1px solid #303030;border-bottom:1px solid #303030}.rubric th{background:#202020}.rubric tr>*:last-child{border-right:0}.rubric tbody tr:last-child>*{border-bottom:0}.decision-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.decision-cards article{padding:14px;border:1px solid #343434;border-radius:8px;background:#121212}.decision-cards h3{margin:0 0 7px}.decision ol{padding-left:24px}.decision li{margin:7px 0;color:#d0d0d0}.procedure{margin-top:18px;padding:12px;border-left:3px solid #d9c18e;background:#1c1c1c}.lightbox{position:fixed;inset:0;z-index:99;display:none;place-items:center;padding:24px;background:rgba(0,0,0,.93)}.lightbox.open{display:grid}.lightbox img{max-width:96vw;max-height:90vh;object-fit:contain}.lightbox-note{position:fixed;right:20px;bottom:16px;color:#bbb;font-size:12px}@media(max-width:760px){.board{padding:12px}.hero,.section,.decision{padding:16px}.variant-summary,.decision-cards{grid-template-columns:1fr}.comparison{min-width:1130px}.shot-cell{min-width:270px}}
</style>
<main class="board"><div class="wrap">
<header class="hero"><p class="eyebrow">Morning comparison artifact</p><h1>Bricks Variant Trial</h1><p>Tonight tested four doctrine variants against the same script: 12 generated shots each. Pick a doctrine direction, then the next terminal makes it permanent and runs the full-length generation.</p><ul class="variant-summary">__STATS__</ul></header>
<section class="section" aria-labelledby="grid-heading"><h2 id="grid-heading">The grid</h2><p>Rows follow each variant’s own generated VO order. Click a frame to inspect; use ← / → to move across all __FRAME_COUNT__ available frames and Esc to close.</p><div class="grid-scroll"><table class="comparison"><thead><tr><th>Row</th>__HEADERS__</tr></thead><tbody>__ROWS__</tbody></table></div></section>
<section class="section verdicts" aria-label="Visual review verdicts">__VERDICTS__</section>
__DECISION__
</div></main>
<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Expanded comparison frame"><img id="lightbox-image" alt=""><span class="lightbox-note">← → navigate · Esc closes · click backdrop to close</span></div>
<script>(()=>{const images=Array.from(document.querySelectorAll('[data-lightbox-index]'));const box=document.getElementById('lightbox'),target=document.getElementById('lightbox-image');let current=0;const show=i=>{current=(i+images.length)%images.length;target.src=images[current].src;target.alt=images[current].alt;box.classList.add('open')};images.forEach((image,index)=>image.closest('.image-button').addEventListener('click',()=>show(index)));box.addEventListener('click',event=>{if(event.target===box)box.classList.remove('open')});document.addEventListener('keydown',event=>{if(!box.classList.contains('open'))return;if(event.key==='Escape')box.classList.remove('open');if(event.key==='ArrowLeft')show(current-1);if(event.key==='ArrowRight')show(current+1)})})();</script>
""".replace("__STATS__", "".join(stats)).replace("__HEADERS__", "".join(f"<th>{name} &mdash; {html.escape(HEADER_LABELS[name])}</th>" for name in VARIANTS)).replace("__ROWS__", "".join(grid_rows)).replace("__FRAME_COUNT__", str(sum(image_counts.values()))).replace("__VERDICTS__", review_sections()).replace("__DECISION__", decision_section())
    return page, image_counts, missing


def main() -> None:
    last_size = 0
    for quality, dimension in ENCODING_LEVELS:
        page, counts, missing = render(quality, dimension)
        encoded = page.encode("utf-8")
        last_size = len(encoded)
        if last_size < MAX_BYTES:
            OUTPUT.write_bytes(encoded)
            print(json.dumps({"output": str(OUTPUT), "bytes": last_size, "quality": quality, "max_dimension": dimension, "image_counts": counts, "missing": missing}, ensure_ascii=False))
            return
    raise RuntimeError(f"board remains over 14 MB after fallback: {last_size} bytes")


if __name__ == "__main__":
    main()
