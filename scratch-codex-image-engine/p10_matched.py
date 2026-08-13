#!/usr/bin/env python3
"""P10 production-shape composer and fake-safe matched driver.

The Forge-derived slate remains intact.  P10 changes only the compose hook passed
to ``forge_codex.run_item``; it neither trims nor appends any reference images.
"""
import argparse
import copy
import json
import os
import re
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
STYLE_BIBLE = KIT_PATH / "style-bible.md"
CONTRACTS_PATH = HERE / "p8-contracts.json"
FAKE_CODEX = FORGE_SCRIPTS / "_fake_codex.py"
REPORT_HOME = REPO_ROOT / ".superpowers" / "sdd" / "2026-08-11-codex-image-engine"

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(FORGE_SCRIPTS))
import forge  # noqa: E402
import forge_codex as fc  # noqa: E402
import p7_matched as p7  # noqa: E402
import study_metrics as sm  # noqa: E402
import study_run as sr  # noqa: E402


TARGET_SHOTS = ("L27", "L28", "L32", "L33", "L35", "L36", "L42", "L50")
P10_SURFACE_SHOTS = ("L36", "L50", "L42")
REPORT_SCHEMA = "p10-results/1"
# UTF-8-as-cp1252 double-encoding tells, written as escapes: a literal pattern was
# itself mojibaked once by the worker toolchain — the same corruption class it guards.
MOJIBAKE_RE = re.compile("â[€‚„…†‡ˆ‰‹šž‘’“”•–—]"
                         "|Ã[-˿–—“”]")
AVOID_PREFIX = ("Avoid: photorealism, painterly or 3D-render look, specular highlights, glossy or plastic or "
                "metallic sheen, reflections, ambient occlusion, global gradients, bevels, rim light, bloom, "
                "volumetric light, 3D material rendering, heavy solid-black ink, on-screen narrator or host face, "
                "logos, watermark, depth-of-field blur, bokeh, soft focus, words, letters, numerals or signage")


def _fake_seed_placeholder(root, stem):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{stem}.png"
    if not path.is_file():
        Image.new("RGB", (8, 8), (127, 127, 127)).save(path)
    return str(path.resolve())


def derive_corpus(*, fake_seed_dir=None):
    """Reuse P6's Forge batch/resolution mechanics without changing its returned slate."""
    if not SHOTS_PATH.is_file():
        raise RuntimeError(f"shots corpus is missing: {SHOTS_PATH}")
    kit = forge.Kit(str(KIT_PATH), dry=True)
    root_overridden = Path(kit.root).resolve() != FYT_ROOT.resolve()
    if root_overridden:
        kit.root = str(FYT_ROOT.resolve())
    fd, spec_path = tempfile.mkstemp(prefix="p10-corpus-", suffix=".json")
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
        missing = ", ".join(sorted(set(TARGET_SHOTS) - set(items)))
        raise RuntimeError(f"Forge corpus derivation mismatch; missing={missing}")
    prerequisites = [item["name"] for item in spec if item.get("name") not in TARGET_SHOTS]
    if prerequisites and fake_seed_dir is None:
        raise RuntimeError("Forge derivation still needs prerequisite generations: " + ", ".join(prerequisites))
    seeds, placeholders, substitutions = {}, {}, {}
    for shot in TARGET_SHOTS:
        try:
            resolved = forge.resolve_request_seeds(kit, items[shot],
                                                   pending=list(TARGET_SHOTS) + prerequisites)
        except SystemExit as exc:
            raise RuntimeError(f"Forge seed resolution failed for {shot}: {exc}") from None
        replacements, local, unresolved = {}, [], []
        for path in (path for path in resolved if not Path(path).is_file()):
            expected, stem = str(Path(path).resolve()), Path(path).stem
            accepted = p7.BASELINE_DIR / f"{stem}.png"
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
            resolved = [replacements.get(str(Path(path).resolve()), str(Path(path).resolve()))
                        for path in resolved]
            # This is P6's permitted missing-file resolution, not a slate transform.
            copied = copy.deepcopy(items[shot])
            for role in copied.get("seed_roles") or []:
                expected = str((Path(kit.staging) / (Path(role["path"]).stem + ".png")).resolve())
                if expected in replacements:
                    role["path"] = replacements[expected]
            items[shot] = copied
        if local:
            placeholders[shot] = sorted(local)
        seeds[shot] = [str(Path(path).resolve()) for path in resolved]
        if len(items[shot].get("seed_roles") or []) != len(seeds[shot]):
            raise RuntimeError(f"{shot}: Forge slate role/path count diverged")
    return {"kit": kit, "items": items, "seeds": seeds, "fake_seed_placeholders": placeholders,
            "baseline_content_seed_substitutions": substitutions, "root_overridden": root_overridden}


def configure_fake(results_dir, mode="ok"):
    results_dir = Path(results_dir).resolve()
    image_root, sessions_root = results_dir / "_fake_codex_images", results_dir / "_fake_codex_sessions"
    image_root.mkdir(parents=True, exist_ok=True)
    sessions_root.mkdir(parents=True, exist_ok=True)
    fc.CODEX_ARGV_PREFIX = [sys.executable, str(FAKE_CODEX), "--mode", str(mode), "--image-root", str(image_root),
                            "--sessions-root", str(sessions_root)]
    fc.IMAGE_ROOT, fc.SESSIONS_ROOT, fc.TIMEOUT_S = str(image_root), str(sessions_root), 10


def _style_head(path=None):
    """Read §2b at composition time so the source bible remains authoritative."""
    path = STYLE_BIBLE if path is None else Path(path)
    text = Path(path).read_text(encoding="utf-8")
    match = re.search(r"^## 2b\. STYLE-ONLY descriptor.*?\n\n((?:>.*(?:\n|$))+)", text, re.MULTILINE)
    if not match:
        raise RuntimeError(f"STYLE-ONLY descriptor is missing from {path}")
    lines = [line[2:] if line.startswith("> ") else line[1:] if line.startswith(">") else line
             for line in match.group(1).strip().splitlines()]
    return " ".join(part.strip() for part in lines if part.strip())


def _video_shots(path=SHOTS_PATH):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = {entry.get("id"): entry for entry in data.get("long_form", {}).get("shots", [])}
    if not all(shot in rows and isinstance(rows[shot].get("still_prompt"), str) for shot in TARGET_SHOTS):
        raise RuntimeError("bricks shots.json lacks a P10 still prompt")
    suffix = data.get("global_prompt_suffix")
    if not isinstance(suffix, str):
        raise RuntimeError("bricks shots.json lacks global_prompt_suffix")
    return rows, suffix


def load_contracts(path=CONTRACTS_PATH):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != "p8-contracts/1" or not set(P10_SURFACE_SHOTS) <= set(data.get("shots") or {}):
        raise RuntimeError("P8 surface contract is missing a P10 money shot")
    return data


def _role_kind(role):
    stem = Path(role.get("path", "")).stem
    if stem == forge.LETTERING_EXEMPLAR or "lettering-marker" in stem:
        return "lettering"
    if stem == "scene-style-tile" or role.get("role") == "style-anchor":
        return "style_tile"
    return role.get("role") or "other"


def _place_name(role):
    stem = Path(role.get("path", "")).stem
    return {"L28": "assembly-floor room"}.get(stem, stem.replace("-", " "))


def _seed_role_lines(seed_roles, shot):
    lines = []
    for index, role in enumerate(seed_roles, start=1):
        kind = _role_kind(role)
        if kind == "place":
            detail = (f"the established {_place_name(role)} — reproduce this frame's room EXACTLY: geometry, "
                      "layout, furniture, palette, line weight and lighting; change ONLY by adding two figures and handshake.")
        elif kind == "figure":
            detail = "character reference — match exactly — do not copy its background or style."
        elif kind == "lettering":
            detail = "lettering exemplar — use its hand-lettering style only."
        elif kind == "style_tile":
            detail = "production style tile — cast-free style reference (line register + palette only); do not copy objects or layout."
        elif kind == "interaction":
            detail = "interaction reference — contact geometry and placement only."
        elif kind == "prop":
            detail = "prop reference — match exactly — do not copy its background or style."
        else:
            detail = "reference — match exactly — do not copy its background or style."
        lines.append(f"Image {index}: {detail}")
    return "\n".join(lines)


def _money_surface_line(shot, contracts):
    if shot not in P10_SURFACE_SHOTS:
        return ""
    clauses = [clause for clause in contracts["shots"][shot]["surfaces"]
               if any(word in clause.lower() for word in ("money", "bill", "seal", "wrap", "strap", "label"))]
    if not clauses:
        raise RuntimeError(f"{shot}: P10 money-material surface clauses missing")
    return "Surface colors: " + "; ".join(clauses) + "."


def _lettering_strings(shot, seed_roles):
    if not any(_role_kind(role) == "lettering" for role in seed_roles):
        return []
    strings = p7.SHOT_SPEC[shot]["lettering_strings"]
    if not strings:
        raise RuntimeError(f"{shot}: forge supplied lettering exemplar but P7 lettering strings are empty")
    return strings


def _tail(suffix, strings):
    except_clause = "" if not strings else " EXCEPT the exact string(s): " + ", ".join(strings) + "."
    return suffix + "\n" + AVOID_PREFIX + except_clause


def _validate_prompt(text):
    if MOJIBAKE_RE.search(text):
        raise RuntimeError("P10 mojibake law: composed prompt contains double-encoding")
    if not 1300 <= len(text) < 2600:
        raise RuntimeError(f"P10 prompt length {len(text)} is outside 1,300–2,599 chars; BLOCKED, never trim")


def _load_deltas(path):
    if path is None:
        return {}
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    valid = {"style_head", "seed_roles", "still_prompt", "surface_line", "tail_avoid"}
    if not isinstance(data, dict) or not data:
        raise RuntimeError("--deltas must map P10 shots to section replacements")
    for shot, replacements in data.items():
        if shot not in TARGET_SHOTS or not isinstance(replacements, dict) or not replacements:
            raise RuntimeError("--deltas must map P10 shots to non-empty section replacement objects")
        for key, value in replacements.items():
            if key == "extra":
                raise RuntimeError("P10 deltas REPLACE law: 'extra' is forbidden; appending is forbidden")
            if key not in valid or not isinstance(value, str):
                raise RuntimeError(f"P10 deltas REPLACE law: invalid section {key!r}")
    return data


def compose_sections(item, *, shot, contracts, deltas=None):
    rows, suffix = _video_shots()
    still_prompt = rows[shot]["still_prompt"]
    roles = item.get("seed_roles") or []
    sections = {
        "style_head": _style_head(),
        "seed_roles": _seed_role_lines(roles, shot),
        "still_prompt": still_prompt,
        "surface_line": _money_surface_line(shot, contracts),
        "tail_avoid": _tail(suffix, _lettering_strings(shot, roles)),
    }
    for key, value in (deltas or {}).get(shot, {}).items():
        if key == "extra":
            raise RuntimeError("P10 deltas REPLACE law: 'extra' is forbidden; appending is forbidden")
        if key not in sections:
            raise RuntimeError(f"P10 deltas REPLACE law: invalid section {key!r}")
        sections[key] = value
    return sections


def compose_matched(item, reg, canvas, aspect, *, shot, contracts, deltas=None):
    """Compose the five P10 sections in the boss-specified production order."""
    sections = compose_sections(item, shot=shot, contracts=contracts, deltas=deltas)
    lines = [sections["style_head"], sections["seed_roles"], sections["still_prompt"]]
    if sections["surface_line"]:
        lines.append(sections["surface_line"])
    lines.append(sections["tail_avoid"])
    text = "\n".join(lines) + "\n"
    _validate_prompt(text)
    return text


def driver_cells(shots=TARGET_SHOTS, *, round_number=1):
    return [{"lever": "P10", "shot": shot, "variant": f"match-r{round_number}", "rep": 1, "gens": 1}
            for shot in shots]


def staged_name(cell):
    return f"{cell['shot']}-p10-match-r{cell['variant'].rsplit('r', 1)[1]}"


def _compose_for(shot, contracts, deltas):
    return lambda item, reg, canvas, aspect: compose_matched(
        item, reg, canvas, aspect, shot=shot, contracts=contracts, deltas=deltas)


def make_generate_fn(derived, contracts, deltas, *, stats):
    def generate_cell(cell):
        shot = cell["shot"]
        item = copy.deepcopy(derived["items"][shot])
        item["name"] = staged_name(cell)
        # The injected compose hook intentionally sends the literal still_prompt (with backticked
        # slugs), whereas Forge's generic validator translates that field before comparing it.
        # Keep the transport validator from rewriting this P10-only production payload; this does
        # not change a seed role/path.  The explicit allowlist remains available to its text check.
        item["payload"], item["delta"] = "", ""
        item["lettering_strings"] = list(p7.SHOT_SPEC[shot]["lettering_strings"])
        refs = list(derived["seeds"][shot])
        if list(item.get("seed_roles") or []) != list(derived["items"][shot].get("seed_roles") or []):
            raise RuntimeError(f"{shot}: P10 slate mutation detected")
        fc.assert_transport_seed_ceiling(item, refs)
        stats["run_item_calls"] += 1
        status, row = fc.run_item(derived["kit"], item, refs,
                                  fc.RunOptions(compose_fn=_compose_for(shot, contracts, deltas)))
        output = Path(forge._staging_png(derived["kit"], item["name"]))
        if status == "OK":
            stats["subprocess_generations"] += 1
        if row is not None:
            stats["engine_rows"][shot] = row
        stats["provenance"][staged_name(cell)] = {
            "refs_used": [{"role": role.get("role"), "path": path}
                          for role, path in zip(item.get("seed_roles") or [], refs)],
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
        raise ValueError("--shots must be a comma-separated, unique subset of P10 target shots")
    return shots


def run_driver(*, results_dir, mode, shots=TARGET_SHOTS, deltas=None, fake_mode="ok"):
    results_dir = Path(results_dir).resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    deltas = deltas or {}
    round_number = 2 if deltas else 1
    if mode == "fake":
        configure_fake(results_dir, fake_mode)
    contracts = load_contracts()
    derived = derive_corpus(fake_seed_dir=(results_dir / "_fake_missing_forge_seeds") if mode == "fake" else None)
    derived["kit"].staging = str((results_dir / "p10-staging").resolve())
    Path(derived["kit"].staging).mkdir(parents=True, exist_ok=True)
    cells = driver_cells(shots, round_number=round_number)
    stats = {"run_item_calls": 0, "subprocess_generations": 0, "engine_rows": {}, "provenance": {}}
    results_path = results_dir / "p10-results.jsonl"
    summary = p7.run_banked_study(cells=cells, generate_fn=make_generate_fn(derived, contracts, deltas, stats=stats),
                                  measure_fn=sm.measure, results_path=results_path, budget=sr.Budget(len(cells)),
                                  provenance=stats["provenance"], name_fn=staged_name)
    wanted = {f"{cell['lever']}|{cell['shot']}|{cell['variant']}|{cell['rep']}" for cell in cells}
    results = [row for row in sr.load_results(str(results_path))
               if f"{row['lever']}|{row['shot']}|{row['variant']}|{row['rep']}" in wanted]
    return {"schema": REPORT_SCHEMA, "mode": mode, "shots": list(shots), "round": round_number,
            "results_path": str(results_path), "this_run": dict(summary, **stats), "results": results,
            "derivation": {key: derived[key] for key in ("fake_seed_placeholders", "baseline_content_seed_substitutions", "root_overridden")}}


def main(argv=None):
    parser = argparse.ArgumentParser(description="P10 production-shape matched composer")
    parser.add_argument("--mode", choices=("fake", "real"), default="real")
    parser.add_argument("--fake-mode", default="ok")
    parser.add_argument("--i-am-the-boss-with-p10-go", action="store_true")
    parser.add_argument("--results-dir", type=Path, required=True)
    parser.add_argument("--shots")
    parser.add_argument("--deltas", type=Path)
    args = parser.parse_args(argv)
    if args.mode == "real" and not args.i_am_the_boss_with_p10_go:
        print("REFUSED: real mode requires --i-am-the-boss-with-p10-go", file=sys.stderr)
        return 2
    try:
        shots, deltas = _parse_shots(args.shots), _load_deltas(args.deltas)
    except (ValueError, RuntimeError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    if deltas:
        shots = tuple(shot for shot in shots if shot in deltas)
        if not shots:
            parser.error("--shots does not include any shot named by --deltas")
    report = run_driver(results_dir=args.results_dir, mode=args.mode, shots=shots, deltas=deltas,
                        fake_mode=args.fake_mode)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
