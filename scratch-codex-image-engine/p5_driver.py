#!/usr/bin/env python3
"""Bind the P5 register-study ladder to forge_codex.run_item.

The boss runs real mode from the host shell.  Tests and acceptance use ``--fake``,
which replaces the Codex argv with the repository's fake binary before any cell runs.
"""
import argparse
import copy
import json
import os
import re
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
FYT_ROOT = REPO_ROOT / "orgs" / "faceless-youtube"
FORGE_SCRIPTS = FYT_ROOT / ".claude" / "skills" / "image-generation" / "scripts"
KIT_PATH = FYT_ROOT / "channels" / "the-second-take" / "visual-kit"
VIDEO_DIR = FYT_ROOT / "channels" / "the-second-take" / "videos" / "2026-07-28-bricks-fresh"
SHOTS_PATH = VIDEO_DIR / "shots.json"
CANONICAL_TILE = KIT_PATH / "refs" / "env" / "scene-style-tile.png"
BASELINE_DIR = HERE / "gemini-baseline"
FAKE_CODEX = FORGE_SCRIPTS / "_fake_codex.py"
REPORT_HOME = REPO_ROOT / ".superpowers" / "sdd" / "2026-08-11-codex-image-engine"

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(FORGE_SCRIPTS))
import forge  # noqa: E402
import forge_codex as fc  # noqa: E402
import study_metrics as sm  # noqa: E402
import study_run as sr  # noqa: E402


FILTERED_L1_VARIANT = "tile-on-short-label"
REPORT_SCHEMA = "faceless-youtube/codex-image-engine-p5-report@1"
_NAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def driver_cells():
    """The boss-ratified 40-cell/24-gen ladder; study_run's source ladder stays untouched."""
    return [cell for cell in sr.ladder()
            if not (cell["lever"] == "L1" and cell["variant"] == FILTERED_L1_VARIANT)]


def _safe_component(value):
    value = _NAME_SAFE.sub("-", str(value)).strip("-.")
    if not value:
        raise ValueError("staging-name component became empty")
    return value


def staged_name(cell, *, run_id="study", fake=False):
    """Give every generated cell its own direct-child staging stem."""
    return "-".join((
        _safe_component(cell["shot"]),
        "p5",
        "fake" if fake else "real",
        _safe_component(run_id),
        _safe_component(cell["lever"]).lower(),
        _safe_component(cell["variant"]).lower(),
        f"r{int(cell['rep'])}",
    ))


def options_for_cell(cell, tile_path=CANONICAL_TILE):
    """Map a generation cell to the exact RunOptions surface the engine exposes."""
    lever, variant = cell["lever"], cell["variant"]
    if lever == "L0" and variant == "base":
        return fc.RunOptions()
    if lever == "L1" and variant in ("tile-on", "tile-on-short-label"):
        # The engine has one fixed style-anchor -> "style reference only" label.
        # Both names therefore map identically; driver_cells() filters the duplicate.
        return fc.RunOptions(register_seed_tile=str(Path(tile_path).resolve()))
    if lever == "L2" and variant == "format2-labeled":
        return fc.RunOptions(fmt="labeled")
    if lever == "L2" and variant == "format3-minimal":
        return fc.RunOptions(fmt="minimal")
    raise ValueError(f"no generation RunOptions mapping for {lever}/{variant}")


def derive_corpus():
    """Derive the four scene items and resolved seeds through Forge's own dry batch walk."""
    if not SHOTS_PATH.is_file():
        raise RuntimeError(f"shots corpus is missing: {SHOTS_PATH}")
    if not CANONICAL_TILE.is_file():
        raise RuntimeError(f"canonical scene-style tile is missing: {CANONICAL_TILE}")

    kit = forge.Kit(str(KIT_PATH), dry=True)
    expected_root = FYT_ROOT.resolve()
    root_overridden = Path(kit.root).resolve() != expected_root
    if root_overridden:
        # Worktrees intentionally have no ignored .env sentinel.  Forge's own worktree tests use
        # this assignment after Kit(dry=True); it affects path resolution only and reads no key.
        kit.root = str(expected_root)

    fd, spec_path = tempfile.mkstemp(prefix="p5-corpus-", suffix=".json")
    os.close(fd)
    try:
        spec = forge.cmd_batch(
            kit,
            str(SHOTS_PATH),
            spec_path,
            video_dir=str(VIDEO_DIR),
            shots=list(sm.CORPUS),
        )
    finally:
        try:
            os.unlink(spec_path)
        except FileNotFoundError:
            pass

    requested = set(sm.CORPUS)
    items = {item["name"]: item for item in spec if item.get("name") in requested}
    if set(items) != requested:
        missing = sorted(requested - set(items))
        extras = sorted(set(items) - requested)
        raise RuntimeError(f"Forge corpus derivation mismatch; missing={missing}, extras={extras}")
    prerequisite_items = [item["name"] for item in spec if item.get("name") not in requested]
    if prerequisite_items:
        raise RuntimeError("Forge derivation still needs prerequisite generations: "
                           + ", ".join(prerequisite_items))

    seeds = {}
    for shot in sm.CORPUS:
        try:
            seeds[shot] = forge.resolve_request_seeds(kit, items[shot])
        except SystemExit as exc:
            raise RuntimeError(f"Forge seed resolution failed for {shot}: {exc}") from None
        missing = [path for path in seeds[shot] if not Path(path).is_file()]
        if missing:
            raise RuntimeError(f"Forge-derived seed files missing for {shot}: " + ", ".join(missing))
    return {"kit": kit, "items": items, "seeds": seeds,
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


def make_generate_fn(derived, *, run_id, fake, stats):
    kit, items, seeds = derived["kit"], derived["items"], derived["seeds"]

    def generate_cell(cell):
        if cell["lever"] == "L3":
            raise RuntimeError("L3 must use normalize_fn, never generate_fn")
        item = copy.deepcopy(items[cell["shot"]])
        item["name"] = staged_name(cell, run_id=run_id, fake=fake)
        opts = options_for_cell(cell)
        stats["run_item_calls"] += 1
        status, _row = fc.run_item(kit, item, list(seeds[cell["shot"]]), opts)
        out = Path(forge._staging_png(kit, item["name"]))
        if status == "OK":
            stats["subprocess_generations"] += 1
        if (status == "OK" or status.startswith("SKIP")) and out.is_file():
            return str(out.resolve())
        raise RuntimeError(f"{item['name']}: forge_codex.run_item returned {status}")

    return generate_cell


def make_normalize_fn(results_dir):
    normalized_dir = Path(results_dir).resolve() / "normalized"
    normalized_dir.mkdir(parents=True, exist_ok=True)

    def normalize(source_png, image_size):
        source = Path(source_png).resolve()
        canvas = fc.resolve_canvas("16:9", image_size)
        data, _native, _ratio_error = fc.normalize_to_canvas(source.read_bytes(), canvas)
        out = normalized_dir / f"{source.stem}-{image_size}.png"
        fd, tmp = tempfile.mkstemp(prefix=f".{out.stem}.", suffix=".tmp", dir=str(normalized_dir))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, out)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return str(out)

    return normalize


def _round_metric(metric, value):
    if metric == "m1":
        return round(float(value), 3)
    if metric == "m2":
        return round(float(value), 4)
    if metric == "m3":
        return int(value)
    return round(float(value), 5)


def build_report(*, cells, result_rows, baselines, bands, run_summary, stats, fake,
                 fake_mode, run_id, root_overridden, derived_items, derived_seeds):
    wanted = {sr._key(cell) for cell in cells}
    rows = [row for row in result_rows if sr._key(row) in wanted]
    keys = [sr._key(row) for row in rows]
    if len(rows) != len(cells) or len(set(keys)) != len(cells):
        raise RuntimeError(f"results are not one row per planned cell: {len(rows)} rows for "
                           f"{len(cells)} cells ({len(set(keys))} unique)")

    paired = []
    for row in rows:
        shot = row["shot"]
        raw = {metric: row[metric] for metric in sm.METRICS}
        distances = sm.paired_distances(raw, baselines[shot])
        paired.append({
            "lever": row["lever"], "shot": shot, "variant": row["variant"],
            "rep": row["rep"], "gens": row["gens"], "png": row["png"],
            "raw": {m: _round_metric(m, raw[m]) for m in sm.METRICS},
            "distance": {m: _round_metric(m, distances[m]) for m in sm.METRICS},
        })

    l0_spread = {}
    for shot in sm.CORPUS:
        shot_rows = [row for row in paired if row["lever"] == "L0" and row["shot"] == shot]
        if len(shot_rows) != sr.REPS:
            raise RuntimeError(f"L0 spread needs {sr.REPS} rows for {shot}; got {len(shot_rows)}")
        l0_spread[shot] = {
            metric: _round_metric(metric, max(row["raw"][metric] for row in shot_rows)
                                  - min(row["raw"][metric] for row in shot_rows))
            for metric in sm.METRICS
        }

    l0_rep_verdicts = {}
    for rep in range(1, sr.REPS + 1):
        by_shot = {row["shot"]: row["distance"] for row in paired
                   if row["lever"] == "L0" and row["rep"] == rep}
        l0_rep_verdicts[str(rep)] = sm.evaluate_floor(by_shot, bands)
    conservative = {
        shot: {metric: max(row["distance"][metric] for row in paired
                           if row["lever"] == "L0" and row["shot"] == shot)
               for metric in sm.METRICS}
        for shot in sm.CORPUS
    }
    verdict = sm.evaluate_floor(conservative, bands)

    return {
        "schema": REPORT_SCHEMA,
        "mode": "fake" if fake else "real",
        "fake_mode": fake_mode if fake else None,
        "run_id": run_id,
        "ladder": {
            "cells": len(cells),
            "planned_generations": sum(cell["gens"] for cell in cells),
            "completed_generation_cells": sum(row["gens"] for row in paired),
            "budget": sr.GEN_BUDGET,
            "filtered_variant": "L1/tile-on-short-label",
        },
        "this_run": dict(run_summary, **stats),
        "derivation": {
            "shots_path": str(SHOTS_PATH.resolve()),
            "kit_path": str(KIT_PATH.resolve()),
            "canonical_tile": str(CANONICAL_TILE.resolve()),
            "worktree_root_override": root_overridden,
            "items": {
                shot: {
                    "name": derived_items[shot]["name"],
                    "aspect": derived_items[shot].get("aspect"),
                    "image_size": derived_items[shot].get("image_size"),
                    "effective_image_size": derived_items[shot].get("image_size") or "1K",
                    "seed_roles": [
                        {"role": role["role"], "character": role["character"],
                         "path": role["path"]}
                        for role in derived_items[shot]["seed_roles"]
                    ],
                    "resolved_seeds": [str(Path(seed).resolve()) for seed in derived_seeds[shot]],
                }
                for shot in sm.CORPUS
            },
        },
        "corpus_baselines": {
            shot: {metric: _round_metric(metric, baselines[shot][metric])
                   for metric in sm.METRICS}
            for shot in sm.CORPUS
        },
        "baseline_bands": {m: _round_metric(m, value) for m, value in bands.items()},
        "paired_rows": paired,
        "l0_within_cell_spread": l0_spread,
        "l0_floor": {
            "aggregation": "conservative maximum distance across the two reps, per shot/metric",
            "verdict": verdict,
            "per_rep": l0_rep_verdicts,
        },
        "notes": [
            "L1/tile-on-short-label is filtered by boss ruling; Forge exposes only the fixed "
            "style-anchor -> style reference only label, so it would be byte-identical to tile-on.",
            "L26 already carries the canonical style tile at L0 by Forge's cast-free derivation law.",
            "The fake-data verdict measures plumbing only and has no promotion meaning."
            if fake else "The real-data verdict is the P5 floor result.",
        ],
    }


def _fmt(metric, value):
    return {"m1": f"{value:.3f}", "m2": f"{value:.4f}",
            "m3": f"{int(value)}", "m4": f"{value:.5f}"}[metric]


def report_markdown(report):
    verdict = report["l0_floor"]["verdict"]
    lines = [
        "# P5 register-study report",
        "",
        f"Mode: **{report['mode']}**"
        + (f" (`{report['fake_mode']}`)" if report["mode"] == "fake" else "")
        + f". Run id: `{report['run_id']}`.",
        f"Ladder: **{report['ladder']['cells']} cells**, "
        f"**{report['ladder']['planned_generations']} generation cells**, hard budget "
        f"**{report['ladder']['budget']}**.",
        f"This invocation: run_item calls {report['this_run']['run_item_calls']}; "
        f"subprocess generations {report['this_run']['subprocess_generations']}; "
        f"resumed/skipped cells {report['this_run']['skipped']}.",
        "",
        "L1 is filtered to `tile-on`. `tile-on-short-label` is omitted by boss ruling because "
        "Forge has only one fixed `style-anchor` → `style reference only` label surface; the two "
        "variants would be byte-identical. L26 already carries the canonical tile at L0 under "
        "Forge's cast-free law.",
        "",
        f"Canonical tile: `{report['derivation']['canonical_tile']}`.",
        "",
        "Forge's scene items omit `image_size`; `RunOptions()` therefore applies the engine's "
        "documented effective 1K default.",
        "",
        "## Corpus baselines",
        "",
        "| Shot | M1 | M2 | M3 | M4 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for shot in sm.CORPUS:
        baseline = report["corpus_baselines"][shot]
        lines.append(f"| {shot} | {_fmt('m1', baseline['m1'])} | "
                     f"{_fmt('m2', baseline['m2'])} | {_fmt('m3', baseline['m3'])} | "
                     f"{_fmt('m4', baseline['m4'])} |")
    lines += [
        "",
        "## Paired measurements",
        "",
        "| Lever | Variant | Shot | Rep | M1 | dM1 | M2 | dM2 | M3 | dM3 | M4 | dM4 |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in report["paired_rows"]:
        raw, distance = row["raw"], row["distance"]
        lines.append(
            f"| {row['lever']} | {row['variant']} | {row['shot']} | {row['rep']} | "
            f"{_fmt('m1', raw['m1'])} | {_fmt('m1', distance['m1'])} | "
            f"{_fmt('m2', raw['m2'])} | {_fmt('m2', distance['m2'])} | "
            f"{_fmt('m3', raw['m3'])} | {_fmt('m3', distance['m3'])} | "
            f"{_fmt('m4', raw['m4'])} | {_fmt('m4', distance['m4'])} |")
    lines += [
        "",
        "## L0 within-cell spread (n=2)",
        "",
        "| Shot | M1 range | M2 range | M3 range | M4 range |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for shot in sm.CORPUS:
        spread = report["l0_within_cell_spread"][shot]
        lines.append(f"| {shot} | {_fmt('m1', spread['m1'])} | {_fmt('m2', spread['m2'])} | "
                     f"{_fmt('m3', spread['m3'])} | {_fmt('m4', spread['m4'])} |")
    lines += [
        "",
        "## L0 floor verdict",
        "",
        "`evaluate_floor` ran on the conservative maximum distance across the two L0 reps for "
        "each shot/metric.",
        "",
        f"**{'PASS' if verdict['pass'] else 'STOP-and-escalate'}** — {verdict['reason']}.",
    ]
    if report["mode"] == "fake":
        lines += ["", "Fake pixel data makes this verdict meaningless; it proves only that the "
                  "measurement, pairing, spread, and gate machinery execute."]
    return "\n".join(lines) + "\n"


def run_driver(*, results_dir, fake, fake_mode="ok", run_id="study"):
    results_dir = Path(results_dir).resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    if fake:
        configure_fake(results_dir, fake_mode)

    derived = derive_corpus()
    cells = driver_cells()
    planned = sum(cell["gens"] for cell in cells)
    if len(cells) != 40 or planned != 24 or planned > sr.GEN_BUDGET:
        raise RuntimeError(f"ratified driver ladder drifted: {len(cells)} cells/{planned} gens")

    stats = {"run_item_calls": 0, "subprocess_generations": 0}
    results_path = results_dir / "p5-results.jsonl"
    summary = sr.run_study(
        cells=cells,
        generate_fn=make_generate_fn(derived, run_id=run_id, fake=fake, stats=stats),
        normalize_fn=make_normalize_fn(results_dir),
        measure_fn=sm.measure,
        results_path=str(results_path),
        budget=sr.Budget(40),
        # Distances are computed after the full bounded ladder.  Passing baseline_m1 here would
        # compare unrelated shots through run_study's global best and can stop L0 itself.
        baseline_m1=None,
    )
    baselines = sm.baseline_table(str(BASELINE_DIR))
    bands = sm.baseline_bands(str(BASELINE_DIR))
    report = build_report(
        cells=cells,
        result_rows=sr.load_results(str(results_path)),
        baselines=baselines,
        bands=bands,
        run_summary=summary,
        stats=stats,
        fake=fake,
        fake_mode=fake_mode,
        run_id=run_id,
        root_overridden=derived["root_overridden"],
        derived_items=derived["items"],
        derived_seeds=derived["seeds"],
    )
    (results_dir / "p5-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    (results_dir / "p5-report.md").write_text(
        report_markdown(report), encoding="utf-8", newline="\n")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="P5 register-study driver")
    parser.add_argument("--fake", action="store_true",
                        help="use the repository fake Codex binary; zero real generations")
    parser.add_argument("--fake-mode", default="ok",
                        help="_fake_codex.py mode (tests may override; default: ok)")
    parser.add_argument("--i-am-the-boss-with-p5-go", action="store_true",
                        help="required acknowledgment for REAL mode")
    parser.add_argument("--results-dir", type=Path)
    parser.add_argument("--run-id", default="study",
                        help="stable staging namespace; reuse it to resume")
    args = parser.parse_args(argv)

    if not args.fake and not args.i_am_the_boss_with_p5_go:
        print("REFUSED: real mode requires --i-am-the-boss-with-p5-go", file=sys.stderr)
        return 2
    results_dir = args.results_dir or (REPORT_HOME / ("p5-fake-results" if args.fake
                                                       else "p5-real-results"))
    report = run_driver(results_dir=results_dir, fake=args.fake,
                        fake_mode=args.fake_mode, run_id=args.run_id)
    print(json.dumps({
        "results_dir": str(Path(results_dir).resolve()),
        "cells": report["ladder"]["cells"],
        "generation_cells": report["ladder"]["planned_generations"],
        "run_item_calls": report["this_run"]["run_item_calls"],
        "subprocess_generations": report["this_run"]["subprocess_generations"],
        "skipped": report["this_run"]["skipped"],
        "floor_pass": report["l0_floor"]["verdict"]["pass"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
