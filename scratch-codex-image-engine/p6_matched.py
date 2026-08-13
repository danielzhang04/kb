#!/usr/bin/env python3
"""P6 matched-register composer and eight-shot fake-safe driver.

The command-line default refuses real execution.  ``--fake`` replaces the Codex
binary with the repository fixture, so all acceptance work stays local and free.
"""
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
REGISTERS_PATH = HERE / "p6-registers.json"
STYLE_EXEMPLAR = BASELINE_DIR / "L47.png"
CANONICAL_TILE = KIT_PATH / "refs" / "env" / "scene-style-tile.png"
FAKE_CODEX = FORGE_SCRIPTS / "_fake_codex.py"
REPORT_HOME = REPO_ROOT / ".superpowers" / "sdd" / "2026-08-11-codex-image-engine"

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(FORGE_SCRIPTS))
import forge  # noqa: E402
import forge_codex as fc  # noqa: E402
import p6_register as p6r  # noqa: E402
import study_metrics as sm  # noqa: E402
import study_run as sr  # noqa: E402


TARGET_SHOTS = p6r.TARGET_SHOTS
GEN_BUDGET = 8
REPORT_SCHEMA = "faceless-youtube/codex-image-engine-p6-report@1"


def driver_cells():
    return [{"lever": "P6", "shot": shot, "variant": "match", "rep": 1, "gens": 1}
            for shot in TARGET_SHOTS]


def staged_name(cell):
    """P6 names are deliberately stable so the JSONL and Forge staging both resume."""
    return f"{cell['shot']}-p6-match-r1"


def load_registers(path=REGISTERS_PATH):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != "faceless-youtube/codex-image-engine-p6-registers@1":
        raise RuntimeError("unrecognized P6 register file schema")
    rows = data.get("shots") or {}
    expected = set(TARGET_SHOTS + (p6r.STYLE_SHOT,))
    if set(rows) != expected:
        raise RuntimeError("P6 register set drifted; expected exactly " + ", ".join(sorted(expected)))
    for shot in TARGET_SHOTS:
        entry = rows[shot]
        if not entry.get("ink_hex", "").startswith("#") or len(entry.get("palette") or []) != 4:
            raise RuntimeError(f"invalid P6 register for {shot}")
    return rows


def _content_only(item, seeds):
    """Suppress Forge's synthetic style tile; P6 replaces it with L47's accepted frame."""
    tile = CANONICAL_TILE.resolve()
    copied = copy.deepcopy(item)
    roles = copied.get("seed_roles") or []
    kept_roles = [role for role in roles
                  if role.get("role") != "style-anchor" and Path(role.get("path", "")).resolve() != tile]
    kept_seeds = [str(Path(seed).resolve()) for seed in seeds if Path(seed).resolve() != tile]
    copied["seed_roles"] = kept_roles
    return copied, kept_seeds, len(roles) - len(kept_roles)


def _fake_seed_placeholder(root, stem):
    """Make an obvious local-only stand-in solely so fake transport can exercise seed wiring."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{stem}.png"
    if not path.is_file():
        Image.new("RGB", (8, 8), (127, 127, 127)).save(path)
    return str(path.resolve())


def derive_corpus(*, fake_seed_dir=None):
    """Use Forge's dry batch + seed resolver exactly as P5 does, for the P6 target set."""
    if not SHOTS_PATH.is_file():
        raise RuntimeError(f"shots corpus is missing: {SHOTS_PATH}")
    if not STYLE_EXEMPLAR.is_file():
        raise RuntimeError(f"style exemplar is missing: {STYLE_EXEMPLAR}")
    kit = forge.Kit(str(KIT_PATH), dry=True)
    expected_root = FYT_ROOT.resolve()
    root_overridden = Path(kit.root).resolve() != expected_root
    if root_overridden:
        kit.root = str(expected_root)
    fd, spec_path = tempfile.mkstemp(prefix="p6-corpus-", suffix=".json")
    os.close(fd)
    try:
        spec = forge.cmd_batch(kit, str(SHOTS_PATH), spec_path, video_dir=str(VIDEO_DIR),
                               shots=list(TARGET_SHOTS))
    finally:
        try:
            os.unlink(spec_path)
        except FileNotFoundError:
            pass
    items = {item["name"]: item for item in spec if item.get("name") in TARGET_SHOTS}
    if set(items) != set(TARGET_SHOTS):
        raise RuntimeError("Forge corpus derivation mismatch; missing=" +
                           ", ".join(sorted(set(TARGET_SHOTS) - set(items))))
    prerequisites = [item["name"] for item in spec if item.get("name") not in TARGET_SHOTS]
    if prerequisites and fake_seed_dir is None:
        raise RuntimeError("Forge derivation still needs prerequisite generations: " +
                           ", ".join(prerequisites))
    seeds, suppressed, placeholders, baseline_substitutions = {}, {}, {}, {}
    for shot in TARGET_SHOTS:
        try:
            resolved = forge.resolve_request_seeds(kit, items[shot],
                                                   pending=list(TARGET_SHOTS) + prerequisites)
        except SystemExit as exc:
            raise RuntimeError(f"Forge seed resolution failed for {shot}: {exc}") from None
        missing = [path for path in resolved if not Path(path).is_file()]
        if missing:
            replacements = {}
            local_placeholders = []
            unresolved = []
            for path in missing:
                resolved_path, stem = str(Path(path).resolve()), Path(path).stem
                accepted_scene = BASELINE_DIR / f"{stem}.png"
                if stem in TARGET_SHOTS and accepted_scene.is_file():
                    # Forge explicitly named an earlier scene as content.  Point at the same
                    # accepted pixels in-place; the baseline is never copied into a work product.
                    replacements[resolved_path] = str(accepted_scene.resolve())
                    baseline_substitutions.setdefault(shot, []).append(resolved_path)
                elif fake_seed_dir is not None:
                    replacements[resolved_path] = _fake_seed_placeholder(fake_seed_dir, stem)
                    local_placeholders.append(resolved_path)
                else:
                    unresolved.append(path)
            if unresolved:
                raise RuntimeError(f"Forge-derived seed files missing for {shot}: " + ", ".join(unresolved))
            resolved = [replacements.get(str(Path(path).resolve()), str(Path(path).resolve()))
                        for path in resolved]
            copied = copy.deepcopy(items[shot])
            for role in copied.get("seed_roles") or []:
                expected = str((Path(kit.staging) / (Path(role["path"]).stem + ".png")).resolve())
                if expected in replacements:
                    role["path"] = replacements[expected]
            items[shot] = copied
            if local_placeholders:
                placeholders[shot] = sorted(local_placeholders)
        item, content_seeds, removed = _content_only(items[shot], resolved)
        if len(content_seeds) + 1 > fc.TRANSPORT_SEED_CEILING:
            raise RuntimeError(f"{shot}: content references plus the style exemplar exceed the transport ceiling")
        items[shot], seeds[shot], suppressed[shot] = item, content_seeds, removed
    return {"kit": kit, "items": items, "seeds": seeds, "suppressed_tiles": suppressed,
            "fake_seed_placeholders": placeholders,
            "baseline_content_seed_substitutions": baseline_substitutions,
            "root_overridden": root_overridden}


def configure_fake(results_dir, mode="ok"):
    """Mechanically replace every Codex filesystem/process root with the fake fixture."""
    results_dir = Path(results_dir).resolve()
    image_root = results_dir / "_fake_codex_images"
    sessions_root = results_dir / "_fake_codex_sessions"
    image_root.mkdir(parents=True, exist_ok=True)
    sessions_root.mkdir(parents=True, exist_ok=True)
    fc.CODEX_ARGV_PREFIX = [sys.executable, str(FAKE_CODEX), "--mode", str(mode),
                            "--image-root", str(image_root),
                            "--sessions-root", str(sessions_root)]
    fc.IMAGE_ROOT = str(image_root)
    fc.SESSIONS_ROOT = str(sessions_root)
    fc.TIMEOUT_S = 10


def _content_images_line(seed_roles):
    parts = []
    for index, entry in enumerate(seed_roles or [], start=1):
        who = entry.get("character") or Path(entry.get("path", "")).stem
        role = fc._ROLE_CLAUSE.get(entry.get("role"), fc._ROLE_CLAUSE_DEFAULT).format(who=who)
        parts.append(f"Image {index}: {role.rstrip('.')} — do not copy its background or style")
    return "; ".join(parts)


def compose_matched(item, reg, canvas, aspect, *, register, style_path=STYLE_EXEMPLAR):
    """The P6 doctrine, as a pure composer used through Forge's additive hook."""
    payload = fc.translate_idiom(fc.resolve_slugs(item.get("payload") or item.get("delta") or "", reg))
    content_roles = [entry for entry in item.get("seed_roles") or []
                     if entry.get("role") != "style-anchor"]
    content = _content_images_line(content_roles)
    style_index = len(content_roles) + 1
    style = (f"Image {style_index}: style reference ONLY — match its line weight, outline ink colour, "
             f"cel-fill treatment, palette temperature, shading, texture and detail density exactly; "
             "do NOT copy any of its objects, characters, or layout")
    images = "; ".join(part for part in (content, style) if part)
    palette = ", ".join(entry["hex"] for entry in register["palette"])
    red_clause = (", plus the single red accent #d7402b reserved only for "
                  "alarm/prohibition/ownership/the final punch element"
                  if register["red_accent_present"] or "red" in payload.lower() else "")
    lines = [
        "Use case: illustration-story",
        "Asset type: documentary-style animated video still frame",
        f"Style/medium: flat 2.5D vector cartoon in the exact style of Image {style_index} — even "
        f"medium-weight dark neutral outline, flat cel fills enriched with soft light pools and gentle "
        f"tonal gradients on large surfaces, subtle contact shadows under figures and props, faint "
        f"paper-grain surface texture, rounded friendly shapes, and the same high detail density as "
        f"Image {style_index}",
        f"Primary request: {payload}",
        f"Input images: {images}",
        fc.framing_line(aspect, canvas),
        f"Color palette: outline ink {register['ink_hex']}; scene palette — use no colours outside: "
        f"{palette}{red_clause}",
        f"Constraints: {fc.constraints_text(item)}; match the tonal richness of Image {style_index} — "
        "soft light gradients and subtle contact shadows are required; poster-flat minimalism is wrong",
        "Avoid: photorealism, painterly or 3D-render look, heavy solid-black ink, warm sepia ink cast, "
        "any words, letters, numerals or signage, on-screen narrator or host face, logos, watermark",
    ]
    composed = "\n".join(lines) + "\n"
    if "#241a12" in composed and register["ink_hex"] != "#241a12":
        raise RuntimeError("P6 prompt leaked the style-bible warm ink hex")
    return composed


def _compose_for(register):
    return lambda item, reg, canvas, aspect: compose_matched(item, reg, canvas, aspect,
                                                               register=register)


def make_generate_fn(derived, registers, *, stats):
    kit, items, seeds = derived["kit"], derived["items"], derived["seeds"]

    def generate_cell(cell):
        shot = cell["shot"]
        item = copy.deepcopy(items[shot])
        item["name"] = staged_name(cell)
        style_role = {"path": str(STYLE_EXEMPLAR.resolve()), "role": "style-anchor", "character": None}
        item["seed_roles"] = list(item.get("seed_roles") or []) + [style_role]
        refs = list(seeds[shot]) + [str(STYLE_EXEMPLAR.resolve())]
        fc.assert_transport_seed_ceiling(item, refs)
        stats["run_item_calls"] += 1
        status, row = fc.run_item(kit, item, refs,
                                  fc.RunOptions(compose_fn=_compose_for(registers[shot]),
                                                seed_cap_override=fc.TRANSPORT_SEED_CEILING))
        out = Path(forge._staging_png(kit, item["name"]))
        if status == "OK":
            stats["subprocess_generations"] += 1
        if row is not None:
            stats["engine_rows"][shot] = row
        if (status == "OK" or status.startswith("SKIP")) and out.is_file():
            return str(out.resolve())
        raise RuntimeError(f"{item['name']}: forge_codex.run_item returned {status}")

    return generate_cell


def _engine_rows(kit):
    path = Path(fc.engine_log_path(kit.staging))
    out = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if row.get("name") in {staged_name(cell) for cell in driver_cells()}:
            out[row["name"]] = row
    return out


def _round_metric(metric, value):
    return {"m1": round(float(value), 3), "m2": round(float(value), 4),
            "m3": int(value), "m4": round(float(value), 5)}[metric]


def build_report(*, results, baselines, derived, engine_rows, run_summary, stats, fake, fake_mode):
    by_shot = {row["shot"]: row for row in results}
    if set(by_shot) != set(TARGET_SHOTS):
        raise RuntimeError("P6 results are not exactly one completed row per target shot")
    paired = []
    for shot in TARGET_SHOTS:
        row = by_shot[shot]
        engine = engine_rows.get(staged_name(row)) or stats["engine_rows"].get(shot) or {}
        raw = {metric: row[metric] for metric in sm.METRICS}
        paired.append({
            "shot": shot,
            "png": row["png"],
            "raw": {metric: _round_metric(metric, raw[metric]) for metric in sm.METRICS},
            "distance": {metric: _round_metric(metric, value) for metric, value in
                         sm.paired_distances(raw, baselines[shot]).items()},
            "prompt_path": str(Path(fc.composed_prompt_dir(derived["kit"].staging)) /
                               f"{staged_name(row)}.txt"),
            "fidelity_audit": engine.get("fidelity_audit"),
            "refs_used": [{"role": entry["role"], "path": entry["path"]}
                          for entry in derived["items"][shot].get("seed_roles", [])] +
                         [{"role": "style-anchor", "path": str(STYLE_EXEMPLAR.resolve())}],
        })
    return {
        "schema": REPORT_SCHEMA,
        "mode": "fake" if fake else "real",
        "fake_mode": fake_mode if fake else None,
        "budget": {"cells": len(TARGET_SHOTS), "planned_generations": GEN_BUDGET,
                   "hard_cap": GEN_BUDGET},
        "this_run": dict(run_summary, run_item_calls=stats["run_item_calls"],
                         subprocess_generations=stats["subprocess_generations"]),
        "derivation": {"worktree_root_override": derived["root_overridden"],
                       "suppressed_synthetic_style_tiles": derived["suppressed_tiles"],
                       "fake_seed_placeholders": derived["fake_seed_placeholders"],
                       "baseline_content_seed_substitutions": derived["baseline_content_seed_substitutions"],
                       "style_exemplar": str(STYLE_EXEMPLAR.resolve())},
        "paired_rows": paired,
        "notes": ["No floor verdict is computed: P6 is a per-shot matching test.",
                  "Fake output proves plumbing only; it has no visual-evaluation meaning."]
    }


def _fmt(metric, value):
    return {"m1": f"{value:.3f}", "m2": f"{value:.4f}", "m3": f"{int(value)}",
            "m4": f"{value:.5f}"}[metric]


def report_markdown(report):
    lines = [
        "# P6 matched-register report", "",
        f"Mode: **{report['mode']}**" + (f" (`{report['fake_mode']}`)" if report["mode"] == "fake" else "") + ".",
        f"Budget: **{report['budget']['planned_generations']}** one-shot cells; hard cap **{report['budget']['hard_cap']}**.",
        f"This invocation: run_item calls {report['this_run']['run_item_calls']}; subprocess generations "
        f"{report['this_run']['subprocess_generations']}; resumed/skipped cells {report['this_run']['skipped']}.",
        "", "## Paired measurements", "",
        "| Shot | M1 | dM1 | M2 | dM2 | M3 | dM3 | M4 | dM4 | Fidelity audit | Refs |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ]
    for row in report["paired_rows"]:
        raw, distance = row["raw"], row["distance"]
        audit = row["fidelity_audit"]
        audit_text = audit.get("outcome", "n/a") if isinstance(audit, dict) else (audit or "n/a")
        lines.append(
            f"| {row['shot']} | {_fmt('m1', raw['m1'])} | {_fmt('m1', distance['m1'])} | "
            f"{_fmt('m2', raw['m2'])} | {_fmt('m2', distance['m2'])} | {_fmt('m3', raw['m3'])} | "
            f"{_fmt('m3', distance['m3'])} | {_fmt('m4', raw['m4'])} | {_fmt('m4', distance['m4'])} | "
            f"{audit_text} | {len(row['refs_used'])} |")
    lines += ["", "Prompt paths and full fidelity-audit objects are recorded in `p6-report.json`.",
              "", "No floor verdict: the boss judges this matching test."]
    return "\n".join(lines) + "\n"


def run_driver(*, results_dir, fake, fake_mode="ok"):
    results_dir = Path(results_dir).resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    if fake:
        configure_fake(results_dir, fake_mode)
    registers = load_registers()
    derived = derive_corpus(fake_seed_dir=(results_dir / "_fake_missing_forge_seeds") if fake else None)
    derived["kit"].staging = str((results_dir / "staging").resolve())
    Path(derived["kit"].staging).mkdir(parents=True, exist_ok=True)
    cells = driver_cells()
    if len(cells) != GEN_BUDGET or sum(cell["gens"] for cell in cells) != GEN_BUDGET:
        raise RuntimeError("P6 driver cell budget drifted")
    stats = {"run_item_calls": 0, "subprocess_generations": 0, "engine_rows": {}}
    results_path = results_dir / "p6-results.jsonl"
    summary = sr.run_study(cells=cells, generate_fn=make_generate_fn(derived, registers, stats=stats),
                           measure_fn=sm.measure, results_path=str(results_path),
                           budget=sr.Budget(GEN_BUDGET), baseline_m1=None)
    all_baselines = sm.baseline_table(str(BASELINE_DIR))  # includes mandatory SHA fail-closed check
    baselines = {shot: all_baselines[shot] for shot in TARGET_SHOTS}
    report = build_report(results=sr.load_results(str(results_path)), baselines=baselines,
                          derived=derived, engine_rows=_engine_rows(derived["kit"]),
                          run_summary=summary, stats=stats, fake=fake, fake_mode=fake_mode)
    (results_dir / "p6-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n",
                                                  encoding="utf-8", newline="\n")
    (results_dir / "p6-report.md").write_text(report_markdown(report), encoding="utf-8", newline="\n")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="P6 matched-register driver")
    parser.add_argument("--fake", action="store_true", help="use the local fake Codex binary")
    parser.add_argument("--fake-mode", default="ok")
    parser.add_argument("--i-am-the-boss-with-p6-go", action="store_true",
                        help="required acknowledgement for REAL mode")
    parser.add_argument("--results-dir", type=Path)
    args = parser.parse_args(argv)
    if not args.fake and not args.i_am_the_boss_with_p6_go:
        print("REFUSED: real mode requires --i-am-the-boss-with-p6-go", file=sys.stderr)
        return 2
    results_dir = args.results_dir or (REPORT_HOME / "p6-results")
    report = run_driver(results_dir=results_dir, fake=args.fake, fake_mode=args.fake_mode)
    print(json.dumps({"results_dir": str(Path(results_dir).resolve()),
                      "cells": report["budget"]["cells"],
                      "generation_cells": report["budget"]["planned_generations"],
                      "run_item_calls": report["this_run"]["run_item_calls"],
                      "subprocess_generations": report["this_run"]["subprocess_generations"],
                      "skipped": report["this_run"]["skipped"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
