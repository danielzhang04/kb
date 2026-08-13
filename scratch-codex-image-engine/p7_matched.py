#!/usr/bin/env python3
"""P7 exact-match composer and ten-shot, fake-safe driver."""
import argparse
import copy
import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
FYT_ROOT = REPO_ROOT / "orgs" / "faceless-youtube"
FORGE_SCRIPTS = FYT_ROOT / ".claude" / "skills" / "image-generation" / "scripts"
KIT_PATH = FYT_ROOT / "channels" / "the-second-take" / "visual-kit"
VIDEO_DIR = FYT_ROOT / "channels" / "the-second-take" / "videos" / "2026-07-28-bricks-fresh"
SHOTS_PATH = VIDEO_DIR / "shots.json"
BASELINE_DIR = HERE / "gemini-baseline"
REGISTERS_PATH = HERE / "p7-registers.json"
CANONICAL_TILE = KIT_PATH / "refs" / "env" / "scene-style-tile.png"
LETTERING_EXEMPLAR_PATH = KIT_PATH / "refs" / "env" / "lettering-marker-italic.png"
FAKE_CODEX = FORGE_SCRIPTS / "_fake_codex.py"

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(FORGE_SCRIPTS))
import forge  # noqa: E402
import forge_codex as fc  # noqa: E402
import p7_register as p7r  # noqa: E402
import study_metrics as sm  # noqa: E402
import study_run as sr  # noqa: E402


TARGET_SHOTS = p7r.TARGET_SHOTS
LETTERING_SHOTS = {"L28", "L29", "L33", "L36", "L44", "L50"}
GEN_BUDGET = len(TARGET_SHOTS)
REPORT_SCHEMA = "faceless-youtube/codex-image-engine-p7-report@1"

ASSEMBLY_DRESSING = ("left wall shelf unit with ≈9 gray storage bins in 3 rows; each bench row carries "
                     "VIVID steel-blue rectangular work mats (saturated medium blue, NOT gray-teal) and "
                     "angled beige component trays (≈3 per row) holding rows of parts; the foreground bench "
                     "corner also has a vivid blue mat.")

SHOT_SPEC = {
    "L27": {
        "composition": "pallet stack of shrink-wrapped cartons on a wooden pallet fills the left 55% of frame, a gray canvas tarp half pulled off draping over its top-left; base-cast figure (bald, round white head, brown overcoat, tan trousers) stands right of the stack in profile leaning back, both arms extended gripping the tarp edge, pulling it away to the right; figure ≈55% of frame height. Ceiling skylight upper-left casts a soft beam; one hanging bulb with a warm cone upper-right; closed roller door on the right background wall; dark forklift tines enter the bottom-left foreground.",
        "expression": "deadpan — half-lidded flat eyes, tiny straight mouth, no smile.",
        "dressing": "bare cool-gray concrete floor and walls; shrink-wrap has pale blue-white sheen.",
        "lettering_strings": [],
        "lettering_treatment": "none.",
    },
    "L28": {
        "composition": "one-point-perspective assembly aisle; closed gray roller door at the center back wall; hanging cream signboard centered above it near the ceiling; two rows of steel benches recede left and right; a bench corner cuts into the bottom-right foreground; cool gray floor with one large soft elliptical light pool centered in the aisle; white fluorescent light fixtures hang from the ceiling on rods (≈6 visible); walls cream with a teal wainscot band at mid height.",
        "dressing": ASSEMBLY_DRESSING,
        "lettering_strings": ["MINISCRIBE"],
        "lettering_treatment": "hanging sign — cream rectangular board, thin dark outline, hand-painted brush-marker capitals reading exactly \"MINISCRIBE\" in the reserved red #d7402b.",
    },
    "L29": {
        "composition": "same room as L28 (sign, aisle, benches, bins, blue mats, trays, light pool); miniscribe-rep centered standing in the light pool, hands on hips, ≈55% frame height, full body with feet visible.",
        "expression": "elated — huge open-mouth grin showing upper teeth, wide-open eyes, raised brows.",
        "dressing": ASSEMBLY_DRESSING,
        "lettering_strings": ["MINISCRIBE"],
        "lettering_treatment": "hanging sign — cream rectangular board, thin dark outline, hand-painted brush-marker capitals reading exactly \"MINISCRIBE\" in the reserved red #d7402b.",
    },
    "L32": {
        "composition": "light-gray void room, plain floor with soft shadows only; wooden workbench right of center; on it a hard-drive-sized dark plate GLOWING hot red with a radial red light bloom and two wavy gray smoke wisps rising; hanging metal dome lamp above casts a bright cone onto the bench; scientist figure left of center recoiling away from the bench — torso twisted left, both mitted hands raised palms out, right leg kicked up mid-stumble; ≈70% frame height; wooden tool pegboard on the wall behind the bench (2 screwdrivers with orange handles, 1 wrench hanging); small red bucket on the floor right of the bench; round wooden stool bottom-left corner.",
        "figure": "bald round white head, white lab coat over dark shirt, black trousers, gray shoes, gray quilted oven mitts on both hands.",
        "expression": "shocked — huge wide white eyes with tiny pupils, mouth an open dark oval mid-yell.",
        "lettering_strings": [],
        "lettering_treatment": "none.",
    },
    "L33": {
        "composition": "same room as L28; the two figures stand center-left shaking hands, BOTH full-body at ≈45% frame height, feet in the elliptical light pool; ibm-suit on the left facing right, miniscribe-rep on the right facing left; blue-mat bench corner bottom-right foreground; sign above.",
        "expression": "ibm-suit: dark navy pinstripe suit, gray-templed dark hair, dark skin. Expression smug — half-lidded eyes, small closed one-sided smirk. miniscribe-rep: tan jacket, BROWN trousers (not black), brown swept hair. Expression delighted — closed curved-down eyes, huge open smile showing upper teeth, rosy cheeks.",
        "dressing": ASSEMBLY_DRESSING,
        "lettering_strings": ["MINISCRIBE"],
        "lettering_treatment": "hanging sign — cream rectangular board, thin dark outline, hand-painted brush-marker capitals reading exactly \"MINISCRIBE\" in the reserved red #d7402b.",
    },
    "L35": {
        "composition": "wide warehouse interior, dark roof trusses across the top; a pyramid of shrink-wrapped pallet crates center frame — bottom tier 3 crates, middle tier 2, top tier 1, each on its own wooden pallet; tiny miniscribe-rep figure stands on the top crate, both arms raised in triumph, ≈12% frame height; three wide pale skylight beams fan down from the roof onto the pyramid; pale elliptical light pool on the floor around the pyramid's base.",
        "dressing": "background workbenches with small tool silhouettes and wall tool boards on both sides; a forklift parked on the right; a forklift mast/cage enters the left foreground; muted teal-gray register throughout.",
        "expression": "joyful — closed curved eyes, wide open smile.",
        "lettering_strings": [],
        "lettering_treatment": "none.",
    },
    "L36": {
        "composition": "cream void with a tan floor plane and a visible soft horizon line — NOT a boundless vignette; rep stands atop one large banded stack of bills center frame, fists on hips (powerstance), ≈35% frame height; four smaller banded stacks sit around the big one at the frame corners (partially cropped); soft contact shadows under every stack; every plane crisp — no blur.",
        "dressing": "Money treatment: saturated green bills with heavy dark outlines and large pale oval portrait medallions; cream paper bands.",
        "expression": "greedy-smug — half-lidded eyes, small closed smirk.",
        "lettering_strings": ["125 MILLION"],
        "lettering_treatment": "the big stack's front band reads exactly \"125 MILLION\" in thick near-black hand-marker italic capitals, slightly tilted with the band.",
    },
    "L42": {
        "composition": "dark cast-iron balance scale fills the frame center; left pan raised high holding an open EMPTY tan cardboard box with 3–4 thin single bills leaning against it; right pan sunk low under a tall stack of ≈8 banded money bundles (dark olive-green bills, cream bands); plain warm cream background, faint paper grain, soft shadows under the pans; no figures, no other props; every element heavy-outlined.",
        "lettering_strings": [],
        "lettering_treatment": "none.",
    },
    "L44": {
        "composition": "same room as L28 (sign, benches, bins, blue mats, beige trays, light pool); ibm-suit exec stands center-left IN the light pool, ≈55% frame height full body; left arm extended giving a thumbs-down; a small flat tan package lies on the floor in the pool in front of his feet; blue-mat bench corner bottom-right foreground.",
        "expression": "annoyed — flat half-lidded eyes, small tight frown.",
        "dressing": ASSEMBLY_DRESSING,
        "lettering_strings": ["MINISCRIBE"],
        "lettering_treatment": "hanging sign — cream rectangular board, thin dark outline, hand-painted brush-marker capitals reading exactly \"MINISCRIBE\" in the reserved red #d7402b.",
    },
    "L50": {
        "composition": "warm wood-paneled banker's office, tight shot; banker behind a heavy wooden desk at frame left, leaning in, both hands presenting/embracing one huge banded brick of green bills that dominates the desk center; green glass banker's lamp glowing at frame right with a warm light pool on the paneling behind it; wooden drawer cabinets line the background walls; dark inkwell and pen stand bottom-right foreground on the desk.",
        "figure": "banker — swept gray hair, pale round head, brown pinstripe three-piece suit with white shirt and dark tie.",
        "dressing": "Money treatment: as L36 (saturated greens, heavy outlines, oval medallions, cream bands).",
        "expression": "deadpan-satisfied — half-lidded eyes, tiny closed mouth, faint smugness.",
        "lettering_strings": ["20 MILLION"],
        "lettering_treatment": "the brick's front band reads exactly \"20 MILLION\" in thick near-black hand-marker capitals following the band's tilt.",
    },
}


def driver_cells():
    return [{"lever": "P7", "shot": shot, "variant": "match", "rep": 1, "gens": 1}
            for shot in TARGET_SHOTS]


def staged_name(cell):
    return f"{cell['shot']}-p7-match-r1"


def load_register_data(path=REGISTERS_PATH):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != "faceless-youtube/codex-image-engine-p7-registers@2":
        raise RuntimeError("unrecognized P7 register file schema")
    shots, anchors = data.get("shots") or {}, data.get("anchors") or {}
    if len(shots) != 23 or set(anchors) != set(TARGET_SHOTS):
        raise RuntimeError("P7 register set or anchor table drifted")
    for shot in TARGET_SHOTS:
        if anchors[shot] == shot or anchors[shot] not in shots:
            raise RuntimeError(f"invalid P7 anchor for {shot}")
        computed = p7r.choose_anchor(shot, shots)
        if anchors[shot] != computed:
            raise RuntimeError(
                f"P7 anchor mismatch for {shot}: stored={anchors[shot]}, computed={computed}")
        if len(shots[shot].get("palette") or []) < 6:
            raise RuntimeError(f"invalid P7 palette for {shot}")
    return data


def _fake_seed_placeholder(root, stem):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{stem}.png"
    if not path.is_file():
        Image.new("RGB", (8, 8), (127, 127, 127)).save(path)
    return str(path.resolve())


def _content_only(item, seeds):
    """Remove Forge's synthetic tile; P7 adds its measured accepted-frame anchor later."""
    copied = copy.deepcopy(item)
    tile = CANONICAL_TILE.resolve()
    copied["seed_roles"] = [role for role in copied.get("seed_roles") or []
                            if Path(role.get("path", "")).resolve() != tile and role.get("role") != "style-anchor"]
    return copied, [str(Path(seed).resolve()) for seed in seeds if Path(seed).resolve() != tile]


def derive_corpus(*, fake_seed_dir=None):
    if not SHOTS_PATH.is_file():
        raise RuntimeError(f"shots corpus is missing: {SHOTS_PATH}")
    kit = forge.Kit(str(KIT_PATH), dry=True)
    root_overridden = Path(kit.root).resolve() != FYT_ROOT.resolve()
    if root_overridden:
        kit.root = str(FYT_ROOT.resolve())
    fd, spec_path = tempfile.mkstemp(prefix="p7-corpus-", suffix=".json")
    os.close(fd)
    try:
        spec = forge.cmd_batch(kit, str(SHOTS_PATH), spec_path, video_dir=str(VIDEO_DIR), shots=list(TARGET_SHOTS))
    finally:
        try:
            os.unlink(spec_path)
        except FileNotFoundError:
            pass
    items = {item["name"]: item for item in spec if item.get("name") in TARGET_SHOTS}
    if set(items) != set(TARGET_SHOTS):
        raise RuntimeError("Forge corpus derivation mismatch; missing=" + ", ".join(sorted(set(TARGET_SHOTS) - set(items))))
    prerequisites = [item["name"] for item in spec if item.get("name") not in TARGET_SHOTS]
    if prerequisites and fake_seed_dir is None:
        raise RuntimeError("Forge derivation still needs prerequisite generations: " + ", ".join(prerequisites))
    seeds, placeholders, substitutions = {}, {}, {}
    for shot in TARGET_SHOTS:
        try:
            resolved = forge.resolve_request_seeds(kit, items[shot], pending=list(TARGET_SHOTS) + prerequisites)
        except SystemExit as exc:
            raise RuntimeError(f"Forge seed resolution failed for {shot}: {exc}") from None
        replacements, local, unresolved = {}, [], []
        for path in [path for path in resolved if not Path(path).is_file()]:
            expected, stem = str(Path(path).resolve()), Path(path).stem
            accepted = BASELINE_DIR / f"{stem}.png"
            if stem in TARGET_SHOTS and accepted.is_file():
                replacements[expected] = str(accepted.resolve())
                substitutions.setdefault(shot, []).append(expected)
            elif fake_seed_dir is not None:
                replacements[expected] = _fake_seed_placeholder(fake_seed_dir, stem)
                local.append(expected)
            else:
                unresolved.append(path)
        if unresolved:
            raise RuntimeError(f"Forge-derived seed files missing for {shot}: " + ", ".join(unresolved))
        if replacements:
            resolved = [replacements.get(str(Path(path).resolve()), str(Path(path).resolve())) for path in resolved]
            copied = copy.deepcopy(items[shot])
            for role in copied.get("seed_roles") or []:
                expected = str((Path(kit.staging) / (Path(role["path"]).stem + ".png")).resolve())
                if expected in replacements:
                    role["path"] = replacements[expected]
            items[shot] = copied
        if local:
            placeholders[shot] = sorted(local)
        items[shot], seeds[shot] = _content_only(items[shot], resolved)
        # Forge derives this automatically when the source prompt itself is text-bearing.
        # P7's explicit lettering contract makes it mandatory for every lettering target.
        if shot in LETTERING_SHOTS and not any(_role_kind(role) == "lettering"
                                               for role in items[shot].get("seed_roles") or []):
            if not LETTERING_EXEMPLAR_PATH.is_file():
                raise RuntimeError(f"P7 lettering exemplar is missing: {LETTERING_EXEMPLAR_PATH}")
            items[shot]["seed_roles"].append({"path": str(LETTERING_EXEMPLAR_PATH.resolve()),
                                               "role": "environment", "character": None})
            seeds[shot].append(str(LETTERING_EXEMPLAR_PATH.resolve()))
    return {"kit": kit, "items": items, "seeds": seeds, "fake_seed_placeholders": placeholders,
            "baseline_content_seed_substitutions": substitutions, "root_overridden": root_overridden}


def configure_fake(results_dir, mode="ok"):
    results_dir = Path(results_dir).resolve()
    image_root, sessions_root = results_dir / "_fake_codex_images", results_dir / "_fake_codex_sessions"
    image_root.mkdir(parents=True, exist_ok=True)
    sessions_root.mkdir(parents=True, exist_ok=True)
    fc.CODEX_ARGV_PREFIX = [sys.executable, str(FAKE_CODEX), "--mode", str(mode), "--image-root", str(image_root), "--sessions-root", str(sessions_root)]
    fc.IMAGE_ROOT, fc.SESSIONS_ROOT, fc.TIMEOUT_S = str(image_root), str(sessions_root), 10


def _role_kind(role):
    path = Path(role.get("path", "")).stem
    if path == forge.LETTERING_EXEMPLAR or "lettering-marker" in path:
        return "lettering"
    if role.get("role") == "place":
        return "place"
    if role.get("role") == "style-anchor":
        return "style"
    if role.get("role") in {"figure", "canonical", "pose", "expression"}:
        return "figure"
    return role.get("role") or "other"


def trim_references(seed_roles, seeds, *, cap=fc.TRANSPORT_SEED_CEILING):
    """Drop place, then expendable prop refs; never silently drop figures or lettering."""
    pairs = list(zip(seed_roles, seeds))
    trimmed = []
    while len(pairs) > cap:
        index = next((i for i, (role, _) in enumerate(pairs) if _role_kind(role) == "place"), None)
        if index is None:
            index = next((i for i, (role, _) in enumerate(pairs)
                          if _role_kind(role) not in {"figure", "lettering", "style"}), None)
        if index is None:
            raise RuntimeError("P7 ref cap overflow has no expendable place/prop reference; "
                               "refusing to drop a figure, lettering exemplar, or style anchor")
        role, path = pairs.pop(index)
        trimmed.append({"role": role.get("role"), "path": path, "reason": "P7 ref cap"})
    return [role for role, _ in pairs], [path for _, path in pairs], trimmed


def _content_images_line(seed_roles):
    parts = []
    for index, entry in enumerate(seed_roles, start=1):
        if _role_kind(entry) == "lettering":
            parts.append(f"Image {index}: lettering style reference ONLY — render the specified string(s) in exactly this "
                         "hand-lettering style; do not copy this image's own words, objects, background or layout")
            continue
        who = entry.get("character") or Path(entry.get("path", "")).stem
        role = fc._ROLE_CLAUSE.get(entry.get("role"), fc._ROLE_CLAUSE_DEFAULT).format(who=who)
        parts.append(f"Image {index}: {role.rstrip('.')} — do not copy its background or style")
    return "; ".join(parts)


def _assembly_blue(register):
    accents = [entry for entry in register["palette"] if entry["is_accent"]]
    if not accents:
        return None
    return max(accents, key=lambda entry: int(entry["hex"][5:7], 16) - int(entry["hex"][1:3], 16))


def _palette_line(shot, register):
    entries = [entry["hex"] for entry in register["palette"]]
    named = ""
    if shot in {"L28", "L29", "L33", "L44"}:
        blue = _assembly_blue(register)
        if blue:
            named = f"; vivid steel-blue {blue['hex']} — the bench work mats"
    return f"Color palette: outline ink {register['ink_hex']}; scene palette — use no colours outside: {', '.join(entries)}{named}"


def _lettering_lines(strings, treatment):
    lines = [f"Lettering: {treatment}"]
    if strings:
        allowed = "; ".join(f'"{literal}"' for literal in strings)
        lines.append(f"Text allowlist: text allowed VERBATIM and nothing else: {allowed}.")
    return lines


def compose_matched(item, reg, canvas, aspect, *, register, shot, style_path):
    """P7's front-loaded, literal composition contract passed through Forge's hook."""
    payload = fc.translate_idiom(fc.resolve_slugs(item.get("payload") or item.get("delta") or "", reg))
    spec = SHOT_SPEC[shot]
    content_roles = [entry for entry in item.get("seed_roles") or [] if entry.get("role") != "style-anchor"]
    content = _content_images_line(content_roles)
    style_index = len(content_roles) + 1
    style = (f"Image {style_index}: style reference ONLY — match its line weight, outline ink colour, cel-fill treatment, "
             "palette temperature, shading, texture and detail density exactly; do NOT copy any of its objects, characters, or layout")
    scene = [f"Scene: {payload}"]
    if spec.get("dressing"):
        scene.append(f"Dressing: {spec['dressing']}")
    figure = []
    if spec.get("figure"):
        figure.append(f"Figure: {spec['figure']}")
    if spec.get("expression"):
        figure.append(f"Expression geometry: {spec['expression']}")
    lettering = _lettering_lines(spec["lettering_strings"], spec["lettering_treatment"])
    no_words = ("words, letters, numerals or signage other than the exact string(s) specified in the Lettering line"
                if shot in LETTERING_SHOTS else "any words, letters, numerals or signage")
    lines = [
        "Use case: illustration-story",
        "Asset type: documentary-style animated video still frame",
        f"Style/medium: flat 2.5D vector cartoon in the exact style of Image {style_index} — even medium-weight dark neutral outline, flat cel fills enriched with soft light pools and gentle tonal gradients on large surfaces, subtle contact shadows under figures and props, faint paper-grain surface texture, rounded friendly shapes, and the same high detail density as Image {style_index}",
        *scene,
        f"Composition: {spec['composition']}",
        *figure,
        *lettering,
        f"Input images: {'; '.join(part for part in (content, style) if part)}",
        fc.framing_line(aspect, canvas),
        _palette_line(shot, register),
        f"Constraints: {fc.constraints_text(item)}; match the tonal richness of Image {style_index} — soft light gradients and subtle contact shadows are required; poster-flat minimalism is wrong; cel fills fully saturated exactly as in Image {style_index} — washed-out pastel or gray-toned fills are wrong",
        f"Avoid: photorealism, painterly or 3D-render look, heavy solid-black ink, warm sepia ink cast, {no_words}, on-screen narrator or host face, logos, watermark, depth-of-field blur, bokeh, soft focus — every plane in crisp focus, desaturated pastel fills",
    ]
    return "\n".join(lines) + "\n"


def _compose_for(register, shot, style_path):
    return lambda item, reg, canvas, aspect: compose_matched(item, reg, canvas, aspect, register=register, shot=shot, style_path=style_path)


def reference_plan(derived, data, shot):
    """The exact deterministic reference list, also used to report resumed fake runs."""
    anchor = data["anchors"][shot]
    style_path = str((BASELINE_DIR / f"{anchor}.png").resolve())
    roles = list(copy.deepcopy(derived["items"][shot].get("seed_roles") or []))
    refs = list(derived["seeds"][shot])
    roles, refs, trims = trim_references(roles, refs, cap=fc.CODEX_SEED_CAP)
    return (roles + [{"path": style_path, "role": "style-anchor", "character": None}],
            refs + [style_path], trims, anchor)


def make_generate_fn(derived, data, *, stats):
    def generate_cell(cell):
        shot = cell["shot"]
        item = copy.deepcopy(derived["items"][shot])
        item["name"] = staged_name(cell)
        planned_roles, refs, trims, anchor = reference_plan(derived, data, shot)
        style_path = refs[-1]
        item["seed_roles"] = planned_roles[:-1]
        item["lettering_strings"] = list(SHOT_SPEC[shot]["lettering_strings"])
        item["avoid"] = True
        item = fc.with_style_anchor(item, style_path)
        stats["ref_trims"][shot] = trims
        fc.assert_transport_seed_ceiling(item, refs)
        stats["run_item_calls"] += 1
        status, row = fc.run_item(derived["kit"], item, refs, fc.RunOptions(
            compose_fn=_compose_for(data["shots"][shot], shot, style_path)))
        output = Path(forge._staging_png(derived["kit"], item["name"]))
        if status == "OK":
            stats["subprocess_generations"] += 1
        if row is not None:
            stats["engine_rows"][shot] = row
        stats["refs_used"][shot] = [{"role": role.get("role"), "path": path} for role, path in zip(item["seed_roles"], refs)]
        stats["provenance"][staged_name(cell)] = {
            "anchor": anchor,
            "refs_used": copy.deepcopy(stats["refs_used"][shot]),
            "ref_trims": copy.deepcopy(trims),
        }
        if (status == "OK" or status.startswith("SKIP")) and output.is_file():
            return str(output.resolve())
        raise RuntimeError(f"{item['name']}: forge_codex.run_item returned {status}")
    return generate_cell


def _engine_rows(kit):
    path = Path(fc.engine_log_path(kit.staging))
    if not path.is_file():
        return {}
    wanted = {staged_name(cell) for cell in driver_cells()}
    return {row["name"]: row for row in (json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()) if row.get("name") in wanted}


def _round(metric, value):
    return {"m1": round(float(value), 3), "m2": round(float(value), 4), "m3": int(value), "m4": round(float(value), 5)}[metric]


def run_banked_study(*, cells, generate_fn, measure_fn, results_path, budget, provenance,
                     name_fn=staged_name):
    """P7/P8 runner: provenance lands in the same append-only JSON row as each measurement."""
    result_rows = sr.load_results(str(results_path))
    key = lambda row: f"{row['lever']}|{row['shot']}|{row['variant']}|{row['rep']}"
    done = {key(row) for row in result_rows}
    used = skipped = 0
    for cell in cells:
        if key(cell) in done:
            skipped += 1
            continue
        budget.spend(cell["gens"])
        png = generate_fn(cell)
        banked = provenance.get(name_fn(cell))
        if banked is None:
            raise RuntimeError(f"{name_fn(cell)}: generation returned without banked provenance")
        row = dict(cell, png=png, provenance=copy.deepcopy(banked), **measure_fn(png))
        sr.append_result(str(results_path), row)
        done.add(key(cell))
        used += cell["gens"]
    return {"gens_used": used, "skipped": skipped, "stopped_levers": [],
            "budget_remaining": budget.remaining, "results_path": str(results_path)}


def _seed_evidence_mismatch(provenance, engine):
    banked = [entry["path"] for entry in provenance.get("refs_used") or []]
    evidenced = list((engine.get("seed_sha256") or {}).keys())
    normalized = lambda paths: [os.path.normcase(os.path.realpath(path)) for path in paths]
    if normalized(banked) == normalized(evidenced):
        return None
    return {"banked_seed_paths": banked, "engine_seed_paths": evidenced}


def build_report(*, results, baselines, derived, engine_rows, run_summary, stats, data, fake, fake_mode):
    by_shot = {row["shot"]: row for row in results}
    if set(by_shot) != set(TARGET_SHOTS):
        raise RuntimeError("P7 results are not exactly one completed row per target shot")
    paired = []
    for shot in TARGET_SHOTS:
        row, raw = by_shot[shot], {metric: by_shot[shot][metric] for metric in sm.METRICS}
        engine = engine_rows.get(staged_name(row)) or stats["engine_rows"].get(shot) or {}
        provenance = row.get("provenance")
        if not provenance:
            raise RuntimeError(f"{shot}: result row is missing banked provenance")
        mismatch = _seed_evidence_mismatch(provenance, engine)
        paired.append({"shot": shot, "png": row["png"], "anchor": provenance["anchor"],
                       "raw": {metric: _round(metric, raw[metric]) for metric in sm.METRICS},
                       "distance": {metric: _round(metric, value) for metric, value in sm.paired_distances(raw, baselines[shot]).items()},
                       "prompt_path": str(Path(fc.composed_prompt_dir(derived["kit"].staging)) / f"{staged_name(row)}.txt"),
                       "fidelity_audit": engine.get("fidelity_audit"),
                       "refs_used": copy.deepcopy(provenance["refs_used"]),
                       "ref_trims": copy.deepcopy(provenance["ref_trims"]),
                       "seed_evidence_mismatch": mismatch})
    banked_anchors = {row["shot"]: row["anchor"] for row in paired}
    return {"schema": REPORT_SCHEMA, "mode": "fake" if fake else "real", "fake_mode": fake_mode if fake else None,
            "budget": {"cells": len(TARGET_SHOTS), "planned_generations": GEN_BUDGET, "hard_cap": GEN_BUDGET},
            "this_run": dict(run_summary, run_item_calls=stats["run_item_calls"], subprocess_generations=stats["subprocess_generations"]),
            "derivation": {"worktree_root_override": derived["root_overridden"], "fake_seed_placeholders": derived["fake_seed_placeholders"], "baseline_content_seed_substitutions": derived["baseline_content_seed_substitutions"]},
            "anchors": banked_anchors, "paired_rows": paired,
            "provenance_mismatches": [{"shot": row["shot"], **row["seed_evidence_mismatch"]}
                                      for row in paired if row["seed_evidence_mismatch"]],
            "notes": ["Fake output proves plumbing only; it has no visual-evaluation meaning."]}


def report_markdown(report):
    lines = ["# P7 exact-match report", "", f"Mode: **{report['mode']}**.", "",
             "| Shot | Anchor | Refs | Trims | Seed evidence |",
             "| --- | --- | ---: | ---: | --- |"]
    lines += [f"| {row['shot']} | {row['anchor']} | {len(row['refs_used'])} | "
              f"{len(row['ref_trims'])} | {'MISMATCH' if row['seed_evidence_mismatch'] else 'match'} |"
              for row in report["paired_rows"]]
    lines += ["", "Fake output proves plumbing only; it has no visual-evaluation meaning."]
    return "\n".join(lines) + "\n"


def run_driver(*, results_dir, fake, fake_mode="ok"):
    if results_dir is None:
        raise ValueError("--results-dir is required")
    results_dir = Path(results_dir).resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    if fake:
        configure_fake(results_dir, fake_mode)
    data = load_register_data()
    derived = derive_corpus(fake_seed_dir=(results_dir / "_fake_missing_forge_seeds") if fake else None)
    derived["kit"].staging = str((results_dir / "p7-staging").resolve())
    Path(derived["kit"].staging).mkdir(parents=True, exist_ok=True)
    stats = {"run_item_calls": 0, "subprocess_generations": 0, "engine_rows": {},
             "refs_used": {}, "ref_trims": {}, "provenance": {}}
    results_path = results_dir / "p7-results.jsonl"
    summary = run_banked_study(
        cells=driver_cells(), generate_fn=make_generate_fn(derived, data, stats=stats),
        measure_fn=sm.measure, results_path=results_path, budget=sr.Budget(GEN_BUDGET),
        provenance=stats["provenance"])
    all_baselines = sm.baseline_table(str(BASELINE_DIR))
    report = build_report(results=sr.load_results(str(results_path)), baselines={shot: all_baselines[shot] for shot in TARGET_SHOTS}, derived=derived, engine_rows=_engine_rows(derived["kit"]), run_summary=summary, stats=stats, data=data, fake=fake, fake_mode=fake_mode)
    (results_dir / "p7-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    (results_dir / "p7-report.md").write_text(report_markdown(report), encoding="utf-8", newline="\n")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="P7 exact-match driver")
    parser.add_argument("--fake", action="store_true")
    parser.add_argument("--fake-mode", default="ok")
    parser.add_argument("--i-am-the-boss-with-p7-go", action="store_true")
    parser.add_argument("--results-dir", type=Path)
    args = parser.parse_args(argv)
    if args.results_dir is None:
        parser.error("--results-dir is required")
    if not args.fake and not args.i_am_the_boss_with_p7_go:
        print("REFUSED: real mode requires --i-am-the-boss-with-p7-go", file=sys.stderr)
        return 2
    report = run_driver(results_dir=args.results_dir, fake=args.fake, fake_mode=args.fake_mode)
    print(json.dumps({"results_dir": str(args.results_dir.resolve()), "cells": report["budget"]["cells"], "generation_cells": report["budget"]["planned_generations"], "run_item_calls": report["this_run"]["run_item_calls"], "subprocess_generations": report["this_run"]["subprocess_generations"], "skipped": report["this_run"]["skipped"], "anchors": report["anchors"], "refs": {row["shot"]: row["refs_used"] for row in report["paired_rows"]}, "ref_trims": {row["shot"]: row["ref_trims"] for row in report["paired_rows"] if row["ref_trims"]}, "missing_seeds": report["derivation"]["fake_seed_placeholders"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
