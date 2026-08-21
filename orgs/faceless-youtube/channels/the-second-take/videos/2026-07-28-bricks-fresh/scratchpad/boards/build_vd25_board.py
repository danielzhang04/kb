"""Build the Variant D / liked pre-reset review board for Bricks L01-L25."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

from build_variant_board import inline_markdown, markdown_table
from build_vpw3_board import chain_parent, image_data_uri, parked_reason


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "scratchpad" / "boards" / "vd25-board.html"
MANIFEST = ROOT / "scratchpad" / "variant-frames" / "vd" / "manifest.json"
ANALYSIS = ROOT / "scratchpad" / "taste-audit" / "variant-d-L01-L25-analysis.md"
SHOT_IDS = [f"L{number:02d}" for number in range(1, 26)]
LIKED_SHOT_IDS = {
    "L05", "L06", "L07", "L08", "L09", "L11", "L19", "L20", "L21", "L22", "L23", "L24", "L25"
}
MAX_BYTES = 14 * 1024 * 1024
ENCODING_LEVELS = ((78, 880), (70, 880), (70, 720))


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def missing_reason(entry: dict | None) -> str:
    if entry is None:
        return "no D manifest record"
    return parked_reason(entry) or str(entry.get("retry_cause") or "no called D frame recorded")


def status_badge(entry: dict | None) -> str:
    status = str((entry or {}).get("review_status") or "unavailable")
    if status == "verified":
        return '<span class="badge verified">verified</span>'
    if status == "parked":
        return '<span class="badge parked">parked</span>'
    return f'<span class="badge unavailable">{html.escape(status)}</span>'


def stage_chips(shot: dict, entry: dict | None) -> str:
    role = str(shot.get("stage_role") or "standalone")
    stage = str(shot.get("stage") or "standalone")
    parent = chain_parent(entry or {}) if role == "delta" else None
    seam = f'<span class="chip seam">hold seam {html.escape(parent)}</span>' if parent else ""
    if role == "delta" and not parent:
        seam = '<span class="chip muted">hold seam unavailable</span>'
    return f'<span class="chip">stage {html.escape(stage)}</span><span class="chip">{html.escape(role)}</span>{seam}'


def word_count(shot: dict) -> int:
    return len(re.findall(r"\S+", str(shot.get("still_prompt") or "")))


def frame(label: str, shot_id: str, path: Path, *, allowed: bool, quality: int, max_dimension: int, missing: list[str], entry: dict | None = None) -> tuple[str, int]:
    if not allowed:
        return '<div class="frame missing"><span>not a taste-reference row</span></div>', 0
    if entry is not None and (entry.get("review_status") == "parked" or not entry.get("file")):
        reason = missing_reason(entry)
        missing.append(f"D/{shot_id} — {reason}")
        return f'<div class="frame missing">frame missing &mdash; {html.escape(reason)}</div>', 0
    if not path.is_file():
        reason = missing_reason(entry) if label == "D" else "liked reference unavailable"
        missing.append(f"{label}/{shot_id} — {reason}")
        return f'<div class="frame missing">frame missing &mdash; {html.escape(reason)}</div>', 0
    uri = image_data_uri(path, quality, max_dimension)
    return f'<button class="image-button" aria-label="Open {html.escape(label)} {shot_id}"><img src="{uri}" alt="{html.escape(label)} {shot_id}" data-lightbox></button>', 1


def review_sections(analysis_path: Path = ANALYSIS) -> str:
    """Use the variant-board markdown rendering for sections 1 through 5."""
    if not analysis_path.is_file():
        return f"<p>Analysis pending &mdash; {html.escape(str(analysis_path))}</p>"
    source = analysis_path.read_text(encoding="utf-8")
    markers = [f"## {number}." for number in range(1, 6)]
    if any(marker not in source for marker in markers):
        return f"<p>Analysis pending &mdash; {html.escape(str(analysis_path))}</p>"
    rendered: list[str] = []
    for number, marker in enumerate(markers):
        start = source.index(marker)
        end = source.index(markers[number + 1], start) if number + 1 < len(markers) else len(source)
        lines = source[start:end].strip().splitlines()
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
            elif line.strip():
                rendered.append(f"<p>{inline_markdown(line)}</p>")
            index += 1
    return "\n".join(rendered)


def manifest_cost(manifest: dict) -> str:
    conservative = manifest.get("conservative_total")
    provider = manifest.get("provider_total")
    if conservative is not None and provider is not None:
        return f"${float(conservative):.3f} conservative / ${float(provider):.3f} provider"
    for field in ("cost_usd", "cost", "usd"):
        if field in manifest:
            return f"${float(manifest[field]):.3f}"
    return "not recorded"


def render_board(quality: int, max_dimension: int, manifest_path: Path = MANIFEST) -> tuple[str, dict[str, int], list[str]]:
    shots = {shot["id"]: shot for shot in load_json(ROOT / "shots.json")["long_form"]["shots"]}
    manifest_data = load_json(manifest_path)
    manifest = {entry["shot_id"]: entry for entry in manifest_data.get("shots", [])}
    counts = {"D": 0, "LIKED": 0}
    missing: list[str] = []
    rows: list[str] = []
    for shot_id in SHOT_IDS:
        shot = shots.get(shot_id, {})
        entry = manifest.get(shot_id)
        d_frame, d_count = frame("D", shot_id, ROOT / "scratchpad" / "variant-frames" / "vd" / f"{shot_id}.png", allowed=True, quality=quality, max_dimension=max_dimension, missing=missing, entry=entry)
        liked_frame, liked_count = frame("LIKED", shot_id, ROOT / "assets" / "_archive-pre-reset" / "scenes" / f"{shot_id}.png", allowed=shot_id in LIKED_SHOT_IDS, quality=quality, max_dimension=max_dimension, missing=missing)
        counts["D"] += d_count
        counts["LIKED"] += liked_count
        retry = str((entry or {}).get("retry_cause") or "")
        retry_note = f'<p class="retry">retry: {html.escape(retry)}</p>' if retry else ""
        liked_badge = '<span class="badge liked">liked</span>' if shot_id in LIKED_SHOT_IDS else ""
        rows.append(
            "<tr>"
            f'<th scope="row"><span class="shot-id">{shot_id}</span>{status_badge(entry)}{stage_chips(shot, entry)}'
            f'<p class="count">still prompt: {word_count(shot)} words</p></th>'
            f'<td class="d-cell">{d_frame}{retry_note}</td>'
            f'<td class="liked-cell">{liked_badge}{liked_frame}</td>'
            f'<td class="vo">{html.escape(str(shot.get("vo_text") or shot.get("vo_ref") or "VO text unavailable"))}</td>'
            "</tr>"
        )
    stats = (
        f'<span><strong>calls</strong> {html.escape(str(manifest_data.get("calls", "unavailable")))}</span>'
        f'<span><strong>verified</strong> {html.escape(str(manifest_data.get("verified", "unavailable")))}</span>'
        f'<span><strong>parked</strong> {html.escape(str(manifest_data.get("parked", "unavailable")))}</span>'
        f'<span><strong>cost</strong> {html.escape(manifest_cost(manifest_data))}</span>'
    )
    page = """<title>Bricks Variant D L01–L25</title>
<style>
*{box-sizing:border-box}body{margin:0;overflow-x:hidden;background:#101010;color:#e7e7e7;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}.board{max-width:100%;padding:24px}.wrap{max-width:1820px;margin:auto}.hero,.section,.decision{margin:0 0 20px;padding:22px;background:#171717;border:1px solid #303030;border-radius:10px}h1{margin:0;font-size:clamp(28px,4vw,42px)}h2{margin:0 0 12px}h3{margin:18px 0 8px}p{color:#cacaca}.summary{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.summary span,.chip,.badge{display:inline-block;border:1px solid #454545;border-radius:999px;padding:3px 9px;font-size:12px}.summary span{background:#111}.summary strong{color:#d9c18e}.grid-scroll,.table-scroll{max-width:100%;overflow:auto;border:1px solid #303030;border-radius:8px}.grid{min-width:1380px;width:100%;border-collapse:separate;border-spacing:0;background:#121212}.grid th,.grid td{vertical-align:top;text-align:left;border-right:1px solid #303030;border-bottom:1px solid #303030}.grid tr>*:last-child{border-right:0}.grid tbody tr:last-child>*{border-bottom:0}.grid thead th{position:sticky;top:0;z-index:2;padding:12px;background:#202020;letter-spacing:.07em;font-size:12px}.grid tbody th{width:290px;padding:12px;background:#171717}.grid td{width:360px}.grid .vo{width:260px;padding:14px;color:#dedede;font-style:italic}.shot-id{display:block;margin-bottom:8px;font-weight:800;letter-spacing:.1em}.chip,.badge{margin:0 5px 6px 0}.chip{color:#c9c9c9;background:#242424}.seam{color:#d9c18e;border-color:#725f38;background:#292417}.muted{color:#777}.badge{font-weight:700}.verified{color:#b7dfb8;background:#172817;border-color:#46744b}.parked{color:#efd49a;background:#332a18;border-color:#80652f}.unavailable{color:#d7c1c1;background:#321d1d;border-color:#754040}.liked{margin:10px 10px 0;color:#b7d7ed;background:#152532;border-color:#3e718e}.count,.retry{margin:7px 0 0;font-size:12px}.retry{padding:0 12px 12px;color:#d9be88}.image-button{display:block;width:100%;padding:0;border:0;background:#0d0d0d;cursor:zoom-in}.image-button img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}.frame{display:grid;place-items:center;min-height:202px;padding:20px;background:#101010}.missing{color:#d69898;border:1px dashed #7c4545}.liked-cell .missing{color:#777;border-color:#444}.decision .reply{padding:12px;border-left:3px solid #d9c18e;background:#1d1d1d}.decision li{margin:8px 0;color:#d0d0d0}.lightbox{position:fixed;inset:0;z-index:9;display:none;place-items:center;padding:24px;background:rgba(0,0,0,.93)}.lightbox.open{display:grid}.lightbox img{max-width:96vw;max-height:92vh;object-fit:contain}@media(max-width:720px){.board{padding:12px}.hero,.section,.decision{padding:16px}}
</style>
<main class="board"><div class="wrap"><header class="hero"><h1>Bricks Variant D — L01–L25</h1><p>D: hold-camera chains, grounded palette, actor-first occupancy, bounded crowds. LIKED: pre-reset taste-reference frames only.</p><div class="summary">__STATS__</div></header><section class="section"><h2>Frame comparison</h2><div class="grid-scroll"><table class="grid"><thead><tr><th>Shot / D review</th><th>D — variant D</th><th>LIKED — pre-reset run</th><th>VO</th></tr></thead><tbody>__ROWS__</tbody></table></div></section><section class="section"><h2>Variant D analysis</h2>__ANALYSIS__</section><section class="decision"><h2>Decision</h2><p class="reply">Reply with: keep D / keep D with edits (name rows) / iterate (note) / revert</p><ol><li>Which D changes survive regardless of the overall pick?</li><li>Does any preferred D frame depend on a changed subject/composition rather than the criterion it tests?</li></ol></section></div></main><div id="lightbox" class="lightbox" role="dialog" aria-modal="true"><img id="lightbox-image" alt="Expanded frame"></div><script>(()=>{const images=[...document.querySelectorAll('[data-lightbox]')],box=document.getElementById('lightbox'),target=document.getElementById('lightbox-image');let current=0;const show=index=>{current=(index+images.length)%images.length;target.src=images[current].src;target.alt=images[current].alt;box.classList.add('open')};images.forEach((image,index)=>image.closest('.image-button').addEventListener('click',()=>show(index)));box.addEventListener('click',event=>{if(event.target===box)box.classList.remove('open')});document.addEventListener('keydown',event=>{if(!box.classList.contains('open'))return;if(event.key==='Escape')box.classList.remove('open');if(event.key==='ArrowLeft')show(current-1);if(event.key==='ArrowRight')show(current+1)})})();</script>""".replace("__STATS__", stats).replace("__ROWS__", "\n".join(rows)).replace("__ANALYSIS__", review_sections())
    return page, counts, missing


def main() -> None:
    last_size = 0
    for quality, max_dimension in ENCODING_LEVELS:
        page, counts, missing = render_board(quality, max_dimension)
        last_size = len(page.encode("utf-8"))
        if last_size < MAX_BYTES:
            OUTPUT.write_text(page, encoding="utf-8")
            print(json.dumps({"output": str(OUTPUT), "bytes": last_size, "D_count": counts["D"], "liked_count": counts["LIKED"], "missing": missing}, ensure_ascii=False))
            return
    raise RuntimeError(f"board remains over 14 MiB after final compression: {last_size} bytes")


if __name__ == "__main__":
    main()
