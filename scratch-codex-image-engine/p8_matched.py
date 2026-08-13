#!/usr/bin/env python3
"""P8 quality-round composer and fake-safe delta regeneration driver."""
import argparse
import copy
import json
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
FORGE_SCRIPTS = HERE.parent / "orgs" / "faceless-youtube" / ".claude" / "skills" / "image-generation" / "scripts"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(FORGE_SCRIPTS))
import forge  # noqa: E402
import forge_codex as fc  # noqa: E402
import p7_matched as p7  # noqa: E402
import p7_register as p7r  # noqa: E402
import p8_register as p8r  # noqa: E402
import study_metrics as sm  # noqa: E402
import study_run as sr  # noqa: E402


REGISTERS_PATH = HERE / "p8-registers.json"
CONTRACTS_PATH = HERE / "p8-contracts.json"
TARGET_SHOTS = ("L36", "L50", "L28", "L42", "L32", "L35", "L33", "L27")
SHOT_SPEC = copy.deepcopy(p7.SHOT_SPEC)
REPORT_SCHEMA = "p8-results/1"
CLOSED_INVENTORY = ("The scene contains EXACTLY the elements listed â€” add nothing else: no extra shelving, "
                    "furniture, trays, straps, mechanisms, or props.")
FLAT_MATERIAL = ("every surface is a flat painted fill in the cel style â€” no brick/block coursing, no wood grain, "
                 "no concrete speckle, no screws or hardware detail, no photorealistic plastic film; texture lives "
                 "only in the linework and the faint paper grain")


def load_contracts(path=CONTRACTS_PATH):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != "p8-contracts/1" or set((data.get("shots") or {})) != set(TARGET_SHOTS):
        raise RuntimeError("unrecognized or incomplete P8 contracts")
    for shot in TARGET_SHOTS:
        spec = data["shots"][shot]
        if not isinstance(spec.get("camera"), str) or any(not isinstance(spec.get(key), list)
                                                           for key in ("surfaces", "counts", "negatives", "pose", "emitters", "orientation")):
            raise RuntimeError(f"invalid P8 contract for {shot}")
    return data


def load_register_data(path=REGISTERS_PATH):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != "p8-registers/1":
        raise RuntimeError("unrecognized P8 register file schema")
    shots, anchors = data.get("shots") or {}, data.get("anchors") or {}
    if len(shots) != 23 or set(anchors) != set(p7r.TARGET_SHOTS):
        raise RuntimeError("P8 register set or anchor table drifted")
    for shot in TARGET_SHOTS:
        register = shots.get(shot) or {}
        if anchors.get(shot) == shot or anchors.get(shot) not in shots:
            raise RuntimeError(f"invalid P8 anchor for {shot}")
        if not register.get("palette") or not register.get("fill_modes"):
            raise RuntimeError(f"invalid P8 palette or fill modes for {shot}")
    for shot in p7r.TARGET_SHOTS:
        computed = p7r.choose_anchor(shot, shots)
        if anchors[shot] != computed:
            raise RuntimeError(
                f"P8 anchor mismatch for {shot}: stored={anchors[shot]}, computed={computed}")
    return data


def _clauses(label, clauses):
    return [f"{label}: {clause}" for clause in clauses] if clauses else [f"{label}: none."]


def compose_matched(item, reg, canvas, aspect, *, register, shot, contracts, style_path, deltas=()):
    """P7 prompt layout with P8's verbatim boss-contract extensions."""
    payload = fc.translate_idiom(fc.resolve_slugs(item.get("payload") or item.get("delta") or "", reg))
    p7_spec, spec = SHOT_SPEC[shot], contracts["shots"][shot]
    content_roles = [entry for entry in item.get("seed_roles") or [] if entry.get("role") != "style-anchor"]
    content = p7._content_images_line(content_roles)
    style_index = len(content_roles) + 1
    style = (f"Image {style_index}: style reference ONLY â€” match its line weight, outline ink colour, cel-fill treatment, "
             f"palette temperature, shading, texture and detail density exactly; do NOT copy any of its objects, characters, or layout")
    scene = [f"Scene: {payload}"]
    if p7_spec.get("dressing"):
        scene.append(f"Dressing: {p7_spec['dressing']}")
    scene.append(CLOSED_INVENTORY)
    figure = []
    if p7_spec.get("figure"):
        figure.append(f"Figure: {p7_spec['figure']}")
    if p7_spec.get("expression"):
        figure.append(f"Expression geometry: {p7_spec['expression']}")
    no_words = ("words, letters, numerals or signage other than the exact string(s) specified in the Lettering line"
                if shot in p7.LETTERING_SHOTS else "any words, letters, numerals or signage")
    constraints = [fc.constraints_text(item),
                   f"match the tonal richness of Image {style_index} â€” soft light gradients and subtle contact shadows are required; poster-flat minimalism is wrong",
                   f"cel fills fully saturated exactly as in Image {style_index} â€” washed-out pastel or gray-toned fills are wrong",
                   FLAT_MATERIAL, *deltas]
    lines = [
        "Use case: illustration-story",
        "Asset type: documentary-style animated video still frame",
        f"Style/medium: flat 2.5D vector cartoon in the exact style of Image {style_index} â€” even medium-weight dark neutral outline, flat cel fills enriched with soft light pools and gentle tonal gradients on large surfaces, subtle contact shadows under figures and props, faint paper-grain surface texture, rounded friendly shapes, and the same high detail density as Image {style_index}",
        *scene,
        # Camera is intentionally the first composition content, before P7's prose.
        f"Composition: {spec['camera']}",
        p7_spec["composition"],
        *_clauses("Surfaces", spec["surfaces"]),
        *_clauses("Counts", spec["counts"]),
        *_clauses("Inventory negatives", spec["negatives"]),
        *figure,
        *_clauses("Pose", spec["pose"]),
        *_clauses("Emitters", spec["emitters"]),
        *_clauses("Orientation", spec["orientation"]),
        *p7._lettering_lines(p7_spec["lettering_strings"], p7_spec["lettering_treatment"]),
        f"Input images: {'; '.join(part for part in (content, style) if part)}",
        fc.framing_line(aspect, canvas),
        p7._palette_line(shot, register),
        "Constraints: " + "; ".join(constraints),
        f"Avoid: photorealism, painterly or 3D-render look, heavy solid-black ink, warm sepia ink cast, {no_words}, on-screen narrator or host face, logos, watermark, depth-of-field blur, bokeh, soft focus â€” every plane in crisp focus, desaturated pastel fills",
    ]
    return "\n".join(lines) + "\n"


def driver_cells(shots=TARGET_SHOTS, *, round_number=1):
    return [{"lever": "P8", "shot": shot, "variant": f"match-r{round_number}", "rep": 1, "gens": 1}
            for shot in shots]


def staged_name(cell):
    return f"{cell['shot']}-p8-match-r{cell['variant'].rsplit('r', 1)[1]}"


def _compose_for(register, shot, contracts, style_path, deltas):
    return lambda item, reg, canvas, aspect: compose_matched(
        item, reg, canvas, aspect, register=register, shot=shot, contracts=contracts,
        style_path=style_path, deltas=deltas.get(shot, ()))


def reference_plan(derived, data, shot):
    anchor = data["anchors"][shot]
    style_path = str((p7.BASELINE_DIR / f"{anchor}.png").resolve())
    roles = list(copy.deepcopy(derived["items"][shot].get("seed_roles") or []))
    refs = list(derived["seeds"][shot])
    roles, refs, trims = p7.trim_references(roles, refs, cap=fc.CODEX_SEED_CAP)
    return (roles + [{"path": style_path, "role": "style-anchor", "character": None}],
            refs + [style_path], trims, anchor)


def make_generate_fn(derived, data, contracts, deltas, *, stats):
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
            compose_fn=_compose_for(data["shots"][shot], shot, contracts, style_path, deltas)))
        output = Path(forge._staging_png(derived["kit"], item["name"]))
        if status == "OK":
            stats["subprocess_generations"] += 1
        if row is not None:
            stats["engine_rows"][shot] = row
        stats["provenance"][staged_name(cell)] = {
            "anchor": anchor,
            "refs_used": [{"role": role.get("role"), "path": path}
                          for role, path in zip(item["seed_roles"], refs)],
            "ref_trims": copy.deepcopy(trims),
        }
        if (status == "OK" or status.startswith("SKIP")) and output.is_file():
            return str(output.resolve())
        raise RuntimeError(f"{item['name']}: forge_codex.run_item returned {status}")
    return generate_cell


def _parse_shots(value):
    if value is None:
        return TARGET_SHOTS
    shots = tuple(part.strip() for part in value.split(",") if part.strip())
    if not shots or len(set(shots)) != len(shots) or any(shot not in TARGET_SHOTS for shot in shots):
        raise ValueError("--shots must be a comma-separated, unique subset of P8 target shots")
    return shots


def _load_deltas(path):
    if path is None:
        return {}
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not data or any(shot not in TARGET_SHOTS or not isinstance(clauses, list) or
                                                     not clauses or any(not isinstance(clause, str) for clause in clauses)
                                                     for shot, clauses in data.items()):
        raise RuntimeError("--deltas must be a non-empty JSON object mapping P8 shots to non-empty string lists")
    return data


def _engine_rows(kit, cells):
    path = Path(fc.engine_log_path(kit.staging))
    if not path.is_file():
        return {}
    wanted = {staged_name(cell) for cell in cells}
    return {row["name"]: row for row in
            (json.loads(line) for line in path.read_text(encoding="utf-8").splitlines())
            if row.get("name") in wanted}


def run_driver(*, results_dir, mode, shots=TARGET_SHOTS, deltas=None, fake_mode="ok", register_path=REGISTERS_PATH):
    results_dir = Path(results_dir).resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    deltas = deltas or {}
    round_number = 2 if deltas else 1
    if mode == "fake":
        p7.configure_fake(results_dir, fake_mode)
    data, contracts = load_register_data(register_path), load_contracts()
    derived = p7.derive_corpus(fake_seed_dir=(results_dir / "_fake_missing_forge_seeds") if mode == "fake" else None)
    derived["kit"].staging = str((results_dir / "p8-staging").resolve())
    Path(derived["kit"].staging).mkdir(parents=True, exist_ok=True)
    cells = driver_cells(shots, round_number=round_number)
    stats = {"run_item_calls": 0, "subprocess_generations": 0, "engine_rows": {},
             "ref_trims": {}, "provenance": {}}
    results_path = results_dir / "p8-results.jsonl"
    summary = p7.run_banked_study(
        cells=cells, generate_fn=make_generate_fn(derived, data, contracts, deltas, stats=stats),
        measure_fn=sm.measure, results_path=results_path, budget=sr.Budget(len(cells)),
        provenance=stats["provenance"], name_fn=staged_name)
    wanted = {f"{cell['lever']}|{cell['shot']}|{cell['variant']}|{cell['rep']}" for cell in cells}
    result_rows = [row for row in sr.load_results(str(results_path))
                   if f"{row['lever']}|{row['shot']}|{row['variant']}|{row['rep']}" in wanted]
    engines = _engine_rows(derived["kit"], cells)
    mismatches = []
    for row in result_rows:
        mismatch = p7._seed_evidence_mismatch(
            row.get("provenance") or {}, engines.get(staged_name(row), {}))
        if mismatch:
            mismatches.append({"shot": row["shot"], "variant": row["variant"], **mismatch})
    return {"schema": REPORT_SCHEMA, "mode": mode, "shots": list(shots), "round": round_number,
            "results_path": str(results_path), "this_run": dict(summary, **stats),
            "results": result_rows, "provenance_mismatches": mismatches}


def main(argv=None):
    parser = argparse.ArgumentParser(description="P8 matched composer and delta re-generation driver")
    parser.add_argument("--mode", choices=("fake", "real"), default="real")
    parser.add_argument("--fake-mode", default="ok")
    parser.add_argument("--i-am-the-boss-with-p8-go", action="store_true")
    parser.add_argument("--results-dir", type=Path, required=True)
    parser.add_argument("--shots")
    parser.add_argument("--deltas", type=Path)
    args = parser.parse_args(argv)
    if args.mode == "real" and not args.i_am_the_boss_with_p8_go:
        print("REFUSED: real mode requires --i-am-the-boss-with-p8-go", file=sys.stderr)
        return 2
    try:
        selected, deltas = _parse_shots(args.shots), _load_deltas(args.deltas)
    except (ValueError, RuntimeError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    if deltas:
        selected = tuple(shot for shot in selected if shot in deltas)
        if not selected:
            parser.error("--shots does not include any shot named by --deltas")
    report = run_driver(results_dir=args.results_dir, mode=args.mode, shots=selected, deltas=deltas,
                        fake_mode=args.fake_mode)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
