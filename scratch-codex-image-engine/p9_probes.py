#!/usr/bin/env python3
"""P9 discriminating probes (boss-run). Five gens: A1/A2 gloss-ceiling, B place-plate,
C degloss, D production-shape. Each writes native + normalized PNGs and a results row.

Usage: py -3 p9_probes.py --i-am-the-boss-with-p9-go [--only A1,B]"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "orgs/faceless-youtube/.claude/skills/image-generation/scripts"))
import forge_codex as fc  # noqa: E402
from study_metrics import measure  # noqa: E402

WT = HERE.parent
KIT = WT / "orgs/faceless-youtube/channels/the-second-take/visual-kit"
BASE = HERE / "gemini-baseline"
P8P = WT / ".superpowers/sdd/2026-08-11-codex-image-engine/p8-real-results/p8-staging/_codex/prompts"
OUT = WT / ".superpowers/sdd/2026-08-11-codex-image-engine/p9-probes"
CANVAS = (1376, 768)

MATTE = ("Style/medium: matte 2D cel drawing. Every non-emissive plane has one uniform flat "
         "fill. Tone changes only at hard cel boundaries or line hatching.")
AVOID_MATTE = ("Avoid: specular highlights, glossy or plastic or metallic sheen, reflections, "
               "ambient occlusion, global gradients, bevels, rim light, bloom, volumetric "
               "light, 3D material rendering, soft shadows, airbrush shading, material "
               "texture, photorealism, words, letters, numerals or signage")

L42_SCENE = ("Scene: an old-fashioned dark iron two-pan balance scale seen close in profile, "
             "the beam crossing the frame, its base and pedestal out of frame below; on the "
             "high left pan an open empty tan cardboard carton with a single green banknote "
             "leaning against it; on the low right pan a tall stack of banded green money "
             "bricks; the scale tilted hard down to the right; bare cream background, no "
             "floor line, even frontal light.")

# R3's strip list for probe C, applied to the archived L28 r2 prompt bytes.
# Regex-based: the archived text carries a unicode em-dash that survives source
# round-trips unreliably, so match it with a wildcard.
C_STRIP = [
    r"2\.5D ",
    r" enriched with soft light pools and gentle tonal gradients on large surfaces, subtle contact shadows under figures and props, faint paper-grain surface texture,",
    r"match the tonal richness of Image 2 .{1,3} soft light gradients and subtle contact shadows are required; poster-flat minimalism is wrong; ",
    r", and the same high detail density as Image 2",
]


def probe_a(n):
    lines = [
        "Use case: illustration-story",
        "Asset type: flat 2D cel cartoon still frame",
        L42_SCENE,
        MATTE,
        "Composition/framing: close-up, 16:9 landscape; compose for a 1376x768 pixel frame.",
        AVOID_MATTE,
    ]
    seeds = []
    if n == 2:
        lines.insert(5, "Input images: Image 1: style reference ONLY — match its line "
                        "weight, shape language and palette relationships; do not copy its "
                        "objects or layout.")
        seeds = [str(KIT / "refs/env/scene-style-tile.png")]
    return "\n".join(lines), seeds


def probe_b():
    src = (P8P / "L33-p8-match-r1.txt").read_text(encoding="utf-8")
    old_anchor = None
    for line in src.splitlines():
        if line.startswith("Input images:"):
            old_anchor = line
    assert old_anchor, "L33 archived prompt lost its Input images line"
    new_inputs = (
        "Input images: Image 1: the established assembly-floor room — PRESERVE its exact "
        "geometry, hanging MINISCRIBE sign, roller shutter, left bin rack, bare right wall, "
        "benches, blue work mats, palette, line weight and lighting; change ONLY the addition "
        "of the two figures mid-aisle; do not redesign the room; "
        "Image 2: character reference for ibm-suit — match exactly — do not copy its "
        "background or style; "
        "Image 3: character reference for miniscribe-rep — match exactly — do not "
        "copy its background or style; "
        "Image 4: interaction reference for the handshake geometry only; "
        "Image 5: lettering style reference ONLY for the sign text already present in Image 1")
    prompt = src.replace(old_anchor, new_inputs)
    seeds = [
        str(BASE / "L28.png"),
        str(KIT / "_staging/fig-ibm-suit--expr-smug.png"),
        str(KIT / "_staging/fig-miniscribe-rep--expr-delighted.png"),
        str(KIT / "refs/base/handshake.png"),
        str(KIT / "refs/env/lettering-marker-italic.png"),
    ]
    return prompt, seeds


def probe_c():
    import re
    prompt = (P8P / "L28-p8-match-r2.txt").read_text(encoding="utf-8")
    hits = 0
    for frag in C_STRIP:
        prompt, n = re.subn(frag, "", prompt)
        hits += 1 if n else 0
    prompt = prompt.replace("Style/medium: flat", "Style/medium: matte flat", 1)
    avoid_line = [l for l in prompt.splitlines() if l.startswith("Avoid:")]
    assert avoid_line, "archived L28 prompt lost its Avoid line"
    prompt = prompt.replace(
        avoid_line[0],
        avoid_line[0] + ", specular highlights, glossy or plastic or metallic sheen, "
        "reflections, ambient occlusion, global gradients, bevels, rim light, bloom, "
        "volumetric light, 3D material rendering, airbrush shading")
    prompt += "\n" + MATTE
    seeds = [
        str(KIT / "refs/env/lettering-marker-italic.png"),
        str(BASE / "L48.png"),
    ]
    return prompt, seeds, hits


def probe_d():
    bible = (KIT / "style-bible.md").read_text(encoding="utf-8")
    lines = bible.splitlines()
    i = next(n for n, l in enumerate(lines) if "STYLE-ONLY descriptor" in l)
    desc = []
    for l in lines[i + 1:]:
        if l.startswith("> "):
            desc.append(l[2:])
        elif desc:
            break
    descriptor = " ".join(desc)
    spec = json.loads((WT / "orgs/faceless-youtube/channels/the-second-take/videos/"
                       "2026-07-28-bricks-fresh/shots.json").read_text(encoding="utf-8"))
    suffix = spec["global_prompt_suffix"]
    prompt = "\n".join([
        descriptor,
        "SEED ROLES: Image 1: STYLE TILE — cast-free style reference (line register + "
        "palette only); do not copy its objects or layout.",
        L42_SCENE,
        suffix,
    ])
    return prompt, [str(KIT / "refs/env/scene-style-tile.png")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-am-the-boss-with-p9-go", action="store_true")
    ap.add_argument("--only", default="A1,A2,B,C,D")
    args = ap.parse_args()
    if not getattr(args, "i_am_the_boss_with_p9_go"):
        print("refusing: P9 probes are boss-gated", file=sys.stderr)
        raise SystemExit(2)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "prompts").mkdir(exist_ok=True)
    want = set(args.only.split(","))
    plan = {}
    if "A1" in want:
        plan["A1"] = probe_a(1)
    if "A2" in want:
        plan["A2"] = probe_a(2)
    if "B" in want:
        plan["B"] = probe_b()
    if "C" in want:
        p, s, hits = probe_c()
        print(f"C strip fragments hit: {hits}/{len(C_STRIP)}")
        plan["C"] = (p, s)
    if "D" in want:
        plan["D"] = probe_d()
    results = OUT / "p9-results.jsonl"
    done = set()
    if results.exists():
        done = {json.loads(l)["probe"] for l in results.open(encoding="utf-8")}
    for key, (prompt, seeds) in plan.items():
        if key in done:
            print(f"{key}: already banked, skipping")
            continue
        for s in seeds:
            assert Path(s).is_file(), f"{key}: missing seed {s}"
        pfile = OUT / "prompts" / f"{key}.txt"
        pfile.write_text(prompt, encoding="utf-8", newline="\n")
        print(f"{key}: {len(prompt)} chars, {len(seeds)} seeds — generating...")
        png, meta = fc.generate(prompt_path=str(pfile), seeds=seeds, canvas=CANVAS,
                                name=f"p9-{key}")
        native = OUT / f"p9-{key}-native.png"
        native.write_bytes(png if isinstance(png, bytes) else png[0])
        norm = fc.normalize_to_canvas(native.read_bytes(), CANVAS) \
            if hasattr(fc, "normalize_to_canvas") else None
        if norm:
            (OUT / f"p9-{key}.png").write_bytes(norm)
        m = measure(str(native))
        row = {"probe": key, "chars": len(prompt), "seeds": seeds,
               "native_m1": m["m1"], "native_m2": m["m2"], "native_m3": m["m3"],
               "meta": {k: v for k, v in (meta or {}).items()
                        if isinstance(v, (str, int, float, bool, type(None)))}}
        with results.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        print(f"{key}: banked — native M2 {m['m2']:.3f}")
    print("done")


if __name__ == "__main__":
    main()
