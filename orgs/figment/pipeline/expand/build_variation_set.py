#!/usr/bin/env python3
"""build_variation_set.py — X3-B: the deterministic expansion-03 anchor-variation
builder (docs/superpowers/specs/2026-09-03-figment-expansion-03-design.md §2/§3/§4,
REVIEW-2026-09-03-expansion-03-design.md fixes 1-2).

Builds the 36-cell anchor-variation allocation (12 templates x 3 anchors, design §2)
from `expand/templates/anchor-variations.yaml`, then emits ComfyUI-harness manifests
for two mechanisms:

  Mechanism A — the verified, UNMODIFIED `train/workflows/klein4b_multiref_api.json`
  graph (empty latent, full denoise), driven by a short (<=25-word) edit-grammar
  prompt with the cell's target anchor first in the LoadImage/ReferenceLatent chain.

  Mechanism B — `expand/workflows/klein4b_anchor_variation_api.json` (the anchor is
  both the initial VAEEncode latent and ReferenceLatent #1), driven by the design's
  <=40-word template prompt plus the template's assigned `SplitSigmasDenoise` rung.

Per the review's blocking fix #1, the pilot is 3 paired trials (one per anchor,
covering turn/crop/wardrobe once each) rendered through BOTH mechanisms — 6 jobs,
3 pairs. `pod/README.md` documents a manifest as carrying exactly ONE `workflow`, so
the pilot is written as two manifests (`-pilot-A.yaml`, `-pilot-B.yaml`, 3 jobs each),
never one manifest with two workflows. The review's fix #2 (a per-arm rollup / decision
rule) is a scoring-time concern and lives in the design doc, not this builder.

The pilot consumes exactly the 3 (anchor, template_id) cells named in
`anchor-variations.yaml`'s `pilot_cells` list — the remaining 33 of the 36 cells are
the "full" batch, built for BOTH arms (`full-A-shard-NN.yaml` / `full-B-shard-NN.yaml`,
10 jobs/manifest) since the winning arm is only chosen after the pilot is scored.

Reuses `build_expansion_set.py`'s manifest-assembly primitives directly (module-level
constants and `_rebind_workflow`) rather than forking them: `COPIED_MANIFEST_KEYS`,
`_OPTIONAL_COPIED_KEYS`, `MANIFEST_OVERRIDES`, `ALLOWED_MANIFEST_KEYS`,
`REFERENCE_NODE_IDS`, `NODE_5_NEGATIVE_PROMPT`, `_rebind_workflow`, `_atomic_write_json`.
Never modifies a P1 scorer/QA/lifecycle/gate/persona file — this module only reads
`persona.py`'s `load_persona` and `pod/runpod_run.py`'s manifest helpers (via
`build_expansion_set.py`'s own loaders).

CLI: `pilot` and `full` (both network-free, byte-reproducible).
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import shutil
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent            # .../pipeline/expand
PIPELINE = HERE.parent                             # .../pipeline
BES_MODULE_PATH = HERE / "build_expansion_set.py"


class VariationBuildError(ValueError):
    """The expansion-03 anchor-variation builder refuses to proceed."""


def _load_module(name: str, path: Path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"could not load {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _bes():
    """`build_expansion_set.py`, loaded once — the source of the manifest-assembly
    primitives this module reuses rather than forks."""
    return _load_module("figment_expand_build_expansion_set", BES_MODULE_PATH)


# ---------------------------------------------------------------------------
# Templates — expand/templates/anchor-variations.yaml
# ---------------------------------------------------------------------------

BATCH_LABEL = "expansion-03"
JOBS_PER_SHARD = 10

SEED_BASE = 530000
ANCHOR_SEED_STEP = 1000

MECHANISMS = ("A", "B")


def load_templates(templates_path: Path) -> dict:
    """Parse `anchor-variations.yaml` (literal JSON, this repo's existing
    JSON-as-YAML convention — see persona.py's module docstring)."""
    text = Path(templates_path).read_text(encoding="utf-8")
    doc = json.loads(text)
    if not isinstance(doc, dict) or "templates" not in doc:
        raise VariationBuildError(
            f"{templates_path} does not carry a 'templates' list"
        )
    templates = doc["templates"]
    if not isinstance(templates, list) or len(templates) != 12:
        raise VariationBuildError(
            f"{templates_path} must define exactly 12 templates, got "
            f"{len(templates) if isinstance(templates, list) else type(templates).__name__}"
        )
    seen_ids = [t.get("template_id") for t in templates]
    if seen_ids != [f"T{i:02d}" for i in range(1, 13)]:
        raise VariationBuildError(
            f"{templates_path} templates must be T01..T12 in order, got {seen_ids}"
        )
    pilot_cells = doc.get("pilot_cells")
    if not isinstance(pilot_cells, list) or len(pilot_cells) != 3:
        raise VariationBuildError(
            f"{templates_path} must define exactly 3 pilot_cells, got {pilot_cells!r}"
        )
    return doc


def _template_by_id(templates_doc: dict, template_id: str) -> dict:
    for template in templates_doc["templates"]:
        if template["template_id"] == template_id:
            return template
    raise VariationBuildError(f"unknown template_id {template_id!r}")


def _clause_for_anchor(value: Any, anchor: str, field: str) -> str:
    if isinstance(value, dict):
        if anchor not in value:
            raise VariationBuildError(f"{field} has no entry for anchor {anchor!r}")
        return value[anchor]
    return value


def build_prompt_b(templates_doc: dict, cell: dict) -> str:
    """The <=40-word Mechanism-B prompt: fixed identity+register clause, the
    template's variation clause, then the fixed capture clause (design §2) — T11
    uses the shorter capture clause, every other template the default one."""
    template = _template_by_id(templates_doc, cell["template_id"])
    variation = _clause_for_anchor(
        template["variation_clause"], cell["anchor"], "variation_clause"
    )
    capture = (
        templates_doc["capture_clause_t11"]
        if cell["template_id"] == "T11"
        else templates_doc["capture_clause_default"]
    )
    return f'{templates_doc["identity_register_clause"]} {variation} {capture}'


def build_prompt_a(templates_doc: dict, cell: dict) -> str:
    """The <=25-word Mechanism-A edit-grammar prompt (review fix #1's suggested
    form): "the same woman as the reference, identical face; <edit>; same room,
    same light.\""""
    template = _template_by_id(templates_doc, cell["template_id"])
    action = _clause_for_anchor(template["edit_action"], cell["anchor"], "edit_action")
    return (
        f'{templates_doc["edit_frame_prefix"]} {action}; '
        f'{templates_doc["edit_frame_suffix"]}'
    )


# ---------------------------------------------------------------------------
# Allocation — 36 cells (12 templates x 3 anchors), deterministic
# ---------------------------------------------------------------------------


def _anchor_order(persona: dict) -> list[str]:
    """The identity-spec canonical reference order (g01, g02, g07), read from the
    persona document itself rather than hardcoded."""
    return [Path(r).stem for r in persona["identity"]["references"]]


def generate_variation_allocation(persona: dict, templates_doc: dict) -> list[dict]:
    """Deterministically enumerate the 36-cell expansion-03 allocation (design §2):
    anchor-major, template-minor (T01..T12), matching the seed formula's
    `anchorIdx`/`templateIdx` ordering. A pure function of the persona + templates
    documents alone — the same inputs always yield the byte-identical allocation."""
    anchors = _anchor_order(persona)
    templates = templates_doc["templates"]
    pilot_keys = {
        (row["anchor"], row["template_id"]) for row in templates_doc["pilot_cells"]
    }

    cells: list[dict] = []
    for anchor_idx, anchor in enumerate(anchors):
        for template_idx, template in enumerate(templates, start=1):
            template_id = template["template_id"]
            cell_id = f"exp03-{anchor}-t{template_idx:02d}"
            cells.append({
                "cell_id": cell_id,
                "anchor": anchor,
                "template_id": template_id,
                "denoise": template["denoise"],
                "seed": SEED_BASE + ANCHOR_SEED_STEP * anchor_idx + template_idx,
                "is_pilot": (anchor, template_id) in pilot_keys,
            })
    return cells


def pilot_cells(allocation: list[dict]) -> list[dict]:
    return [cell for cell in allocation if cell["is_pilot"]]


def full_cells(allocation: list[dict]) -> list[dict]:
    return [cell for cell in allocation if not cell["is_pilot"]]


def _shard_groups(cells: list[dict]) -> list[list[dict]]:
    return [cells[i:i + JOBS_PER_SHARD] for i in range(0, len(cells), JOBS_PER_SHARD)]


# ---------------------------------------------------------------------------
# Per-job substitutions and manifest assembly
# ---------------------------------------------------------------------------


def _reference_substitutions(persona: dict, anchor: str) -> list[dict]:
    """Node 6/7/8 `image` substitutions with the cell's target anchor FIRST (the
    canvas / ReferenceLatent #1 slot — design §1a row "6") and the other two
    references following in the persona's declared order. Used for both
    mechanisms: Mechanism B needs the anchor on the canvas per §1; Mechanism A's
    pilot/full-A jobs put the same anchor first per the review fix's "target
    anchor FIRST in the ReferenceLatent chain so it is the canvas" instruction."""
    persona_id = persona["id"]
    references = persona["identity"]["references"]
    stems = [Path(r).stem for r in references]
    names = {Path(r).stem: Path(r).name for r in references}
    if anchor not in stems:
        raise VariationBuildError(
            f"anchor {anchor!r} is not one of persona.identity.references {stems}"
        )
    order = [anchor] + [stem for stem in stems if stem != anchor]
    bes = _bes()
    if len(order) != len(bes.REFERENCE_NODE_IDS):
        raise VariationBuildError(
            f"persona.identity.references must have exactly "
            f"{len(bes.REFERENCE_NODE_IDS)} entries to rebind nodes "
            f"{bes.REFERENCE_NODE_IDS}, got {len(order)}"
        )
    return [
        {"node_id": node_id, "field": "image", "value": f"{persona_id}/{names[stem]}"}
        for node_id, stem in zip(bes.REFERENCE_NODE_IDS, order)
    ]


def job_for_cell(persona: dict, templates_doc: dict, cell: dict, mechanism: str) -> dict:
    """One pod-manifest job for `cell` rendered through `mechanism` ('A' or 'B').
    Mechanism A carries no denoise substitution (node 29 does not exist on the
    unmodified multiref graph); Mechanism B substitutes node 29's `denoise` field
    with the cell's assigned rung (design §1b)."""
    if mechanism not in MECHANISMS:
        raise VariationBuildError(f"mechanism must be one of {MECHANISMS}, got {mechanism!r}")

    reference_subs = _reference_substitutions(persona, cell["anchor"])
    if mechanism == "A":
        prompt = build_prompt_a(templates_doc, cell)
        output_name = f"c001-{cell['cell_id']}-mechA"
        substitutions = [{"node_id": "4", "field": "text", "value": prompt}, *reference_subs]
    else:
        prompt = build_prompt_b(templates_doc, cell)
        output_name = f"c001-{cell['cell_id']}"
        substitutions = [
            {"node_id": "4", "field": "text", "value": prompt},
            *reference_subs,
            {"node_id": "29", "field": "denoise", "value": cell["denoise"]},
        ]

    return {
        "seed": cell["seed"],
        "output_name": output_name,
        "expected_images": 1,
        "substitutions": substitutions,
    }


def _assemble_manifest(base_manifest: dict, workflow: dict, persona: dict, jobs: list[dict]) -> dict:
    """Copy the non-graph envelope fields verbatim from `base_manifest` (the same
    `train/runs/creator-001-composite-02.yaml` base `build_expansion_set.py` uses),
    bind in `workflow` and `jobs`, and refuse to emit any key outside
    `pod/README.md`'s documented schema — the same contract
    `build_expansion_set.build_manifests` enforces, reused rather than
    reimplemented."""
    bes = _bes()
    manifest: dict[str, Any] = {}
    for key in bes.COPIED_MANIFEST_KEYS:
        if key in base_manifest:
            manifest[key] = copy.deepcopy(base_manifest[key])
        elif key in bes._OPTIONAL_COPIED_KEYS:
            continue
        else:
            raise VariationBuildError(f"base manifest is missing required key {key!r}")

    manifest["workflow"] = copy.deepcopy(workflow)
    manifest["seed_fields"] = ["noise_seed"]
    manifest["uploads"] = [{
        "files": [
            f"_uploads/{persona['id']}/{Path(r).name}"
            for r in persona["identity"]["references"]
        ],
        "subfolder": persona["id"],
        "type": "input",
        "overwrite": True,
    }]
    manifest.update(bes.MANIFEST_OVERRIDES)
    manifest["jobs"] = jobs

    unexpected = sorted(set(manifest) - bes.ALLOWED_MANIFEST_KEYS)
    if unexpected:
        raise VariationBuildError(
            f"manifest carries key(s) outside pod/README.md's documented schema: {unexpected}"
        )
    return manifest


def _write_manifest(path: Path, manifest: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return path


def _rebind(persona: dict, workflow_path: Path) -> dict:
    """`build_expansion_set._rebind_workflow` reused verbatim: rebinds nodes 6/7/8
    to the persona's identity references in canonical order and freezes the
    neutral safety-exclusion negative prompt onto node 5. Per-job substitutions
    (job_for_cell) override nodes 4/6/7/8/29 on top of this base."""
    return _bes()._rebind_workflow(workflow_path, persona)


def _load_persona(persona_path: Path):
    return _bes()._persona_module().load_persona(Path(persona_path))


def _load_base_manifest(base_manifest_path: Path) -> dict:
    return _bes()._pod().load_manifest(Path(base_manifest_path))


# ---------------------------------------------------------------------------
# Pilot — 3 paired trials, 2 manifests (one workflow per manifest)
# ---------------------------------------------------------------------------


def build_pilot_manifests(
    persona_path: Path,
    base_manifest_path: Path,
    multiref_workflow_path: Path,
    variation_workflow_path: Path,
    templates_path: Path,
    out_dir: Path,
) -> dict[str, Path]:
    """Build `creator-001-expansion-03-pilot-A.yaml` (Mechanism A, unmodified
    multiref graph) and `creator-001-expansion-03-pilot-B.yaml` (Mechanism B, the
    anchor-variation graph) — 3 jobs each, one pair per anchor, on the SAME 3
    cells named in `anchor-variations.yaml`'s `pilot_cells` (review fix #1).
    `pod/README.md` documents `workflow` as a single object/path per manifest, so
    a combined 6-job/2-workflow manifest is not a harness feature — two manifests
    are emitted instead."""
    persona = _load_persona(persona_path)
    templates_doc = load_templates(templates_path)
    allocation = generate_variation_allocation(persona, templates_doc)
    pilot = pilot_cells(allocation)
    if len(pilot) != 3:
        raise VariationBuildError(f"expected exactly 3 pilot cells, got {len(pilot)}")

    base_manifest = _load_base_manifest(base_manifest_path)
    workflow_a = _rebind(persona, Path(multiref_workflow_path))
    workflow_b = _rebind(persona, Path(variation_workflow_path))

    jobs_a = [job_for_cell(persona, templates_doc, cell, "A") for cell in pilot]
    jobs_b = [job_for_cell(persona, templates_doc, cell, "B") for cell in pilot]

    manifest_a = _assemble_manifest(base_manifest, workflow_a, persona, jobs_a)
    manifest_b = _assemble_manifest(base_manifest, workflow_b, persona, jobs_b)

    out_dir = Path(out_dir)
    persona_id = persona["id"]
    path_a = _write_manifest(
        out_dir / f"{persona_id}-{BATCH_LABEL}-pilot-A.yaml", manifest_a
    )
    path_b = _write_manifest(
        out_dir / f"{persona_id}-{BATCH_LABEL}-pilot-B.yaml", manifest_b
    )
    return {"A": path_a, "B": path_b}


def pilot_summary(base_manifest: dict, pilot: list[dict]) -> str:
    """Acceptance summary text (design §3/§4): cells, arms, denoise rungs, and the
    per-pod cost ceiling from the manifest's price and the shared `max_minutes`
    safety cap (design's ~$1.10/pod figure; printed to the actual cent)."""
    bes = _bes()
    price = float(base_manifest["price_usd_per_hour"])
    max_minutes = bes.MANIFEST_OVERRIDES["max_minutes"]
    ceiling = round(price * max_minutes / 60.0, 2)
    denoise_rungs = sorted({cell["denoise"] for cell in pilot})
    anchors = [cell["anchor"] for cell in pilot]
    return (
        f"pilot: {len(pilot)} cells (anchors {anchors}) x 2 arms (A, B) = "
        f"{len(pilot) * 2} jobs across 2 manifests; Mechanism-B denoise rungs = "
        f"{denoise_rungs}; per-pod ceiling ${ceiling:.2f} "
        f"(price ${price:.2f}/hr x {max_minutes} min max_minutes, <= $1.10)"
    )


# ---------------------------------------------------------------------------
# Full — 33 remaining cells, both arms, 10 jobs/manifest
# ---------------------------------------------------------------------------


def build_full_manifests(
    persona_path: Path,
    base_manifest_path: Path,
    multiref_workflow_path: Path,
    variation_workflow_path: Path,
    templates_path: Path,
    out_dir: Path,
) -> dict[str, list[Path]]:
    """Build `creator-001-expansion-03-full-A-shard-NN.yaml` and
    `...-full-B-shard-NN.yaml` for the 33 non-pilot cells (36 total - the 3 pilot
    cells consumed above), 10 jobs/shard, for BOTH arms — the arm to actually run
    is chosen after the pilot is scored (design §4 / review fix #2), so both are
    pre-built rather than rebuilt after the decision."""
    persona = _load_persona(persona_path)
    templates_doc = load_templates(templates_path)
    allocation = generate_variation_allocation(persona, templates_doc)
    remaining = full_cells(allocation)

    base_manifest = _load_base_manifest(base_manifest_path)
    workflows = {
        "A": _rebind(persona, Path(multiref_workflow_path)),
        "B": _rebind(persona, Path(variation_workflow_path)),
    }

    out_dir = Path(out_dir)
    persona_id = persona["id"]
    groups = _shard_groups(remaining)

    paths: dict[str, list[Path]] = {"A": [], "B": []}
    for mechanism in MECHANISMS:
        for shard_number, cells in enumerate(groups, start=1):
            jobs = [job_for_cell(persona, templates_doc, cell, mechanism) for cell in cells]
            manifest = _assemble_manifest(base_manifest, workflows[mechanism], persona, jobs)
            path = _write_manifest(
                out_dir / f"{persona_id}-{BATCH_LABEL}-full-{mechanism}-shard-{shard_number:02d}.yaml",
                manifest,
            )
            paths[mechanism].append(path)
    return paths


# ---------------------------------------------------------------------------
# Harvest — one arm's worth of finished pod runs, mirroring
# `build_expansion_set.harvest_runs` (Step 5.4) for the pilot/full-shard run
# layout this module's `pilot`/`full` commands actually produce.
# ---------------------------------------------------------------------------


def _expected_image_id(cell: dict, arm: str) -> str:
    """The `output_name` `job_for_cell` assigns a cell under `arm` — mechanism A
    carries the `-mechA` suffix, mechanism B carries none (mirrors
    `job_for_cell`'s own naming, without needing a `templates_doc` to rebuild
    the whole job)."""
    return f"c001-{cell['cell_id']}-mechA" if arm == "A" else f"c001-{cell['cell_id']}"


def _run_groups(cells: list[dict], arm: str) -> list[tuple[str, list[dict]]]:
    """The ordered `(stem, cells)` pairs this harvester expects on disk for
    `arm`: one `pilot-<arm>` group (if any pilot cells exist) followed by
    `full-<arm>-shard-NN` groups of up to `JOBS_PER_SHARD` cells each — the
    exact split `build_pilot_manifests`/`build_full_manifests` use to name
    their run directories."""
    groups: list[tuple[str, list[dict]]] = []
    pilot = pilot_cells(cells)
    if pilot:
        groups.append((f"pilot-{arm}", pilot))
    for shard_number, shard_cells in enumerate(_shard_groups(full_cells(cells)), start=1):
        groups.append((f"full-{arm}-shard-{shard_number:02d}", shard_cells))
    return groups


def harvest_variation_runs(
    persona_path: Path, allocation_path: Path, run_root: Path, batch_dir: Path, arm: str = "A",
) -> dict:
    """Validate every finished `pilot-<arm>` / `full-<arm>-shard-NN` run's
    provenance before copying anything (same contract as
    `build_expansion_set.harvest_runs`): `run.json.termination_verified is
    True`, harvested output identity (image ids exactly match the group's
    allocated cell ids under `arm`'s naming), and cost — then append one
    `pod_runs[]` row per newly harvested group (via `batch_state.record_pod_run`,
    append-only), copy provenance JSON into `<batch_dir>/pod-runs/<stem>/` and
    images into `<batch_dir>/images/`, and — on a brand-new or freshly-first-
    harvested batch — advance `stage` from `building` to `generated` (one step,
    per `batch_state.mark_batch_stage`'s forward-only rule).

    `batch.json`'s cells are seeded from the FULL allocation (every cell, not
    only what is harvested by this call) at creation time, each carrying
    `cell_id`/`anchor`/`template_id`/`mechanism`/`seed`/`image_id`/
    `state: "generated"` — mirroring `harvest_runs`' own "seed all cells at
    first-touch" behaviour.

    Idempotent on an identical re-harvest of an already-recorded group (returned
    under `already_harvested`, no second cost row, no second stage advance). A
    conflicting duplicate — the same group with different content — is always
    an error, never a silent overwrite. A group whose run directory has no
    `run.json` yet is reported under `skipped_not_run`, never an error."""
    if arm not in MECHANISMS:
        raise VariationBuildError(f"arm must be one of {MECHANISMS}, got {arm!r}")

    bes = _bes()
    persona_module = bes._persona_module()
    gates_module = bes._gates_module()
    bs = bes._batch_state_module()

    persona = persona_module.load_persona(Path(persona_path), require_assets=False)
    persona_id = persona["id"]

    allocation_path = Path(allocation_path)
    allocation_doc = json.loads(allocation_path.read_text(encoding="utf-8"))
    cells_all = allocation_doc["cells"] if isinstance(allocation_doc, dict) else allocation_doc
    allocation_sha256 = gates_module.sha256_file(allocation_path)

    run_root = Path(run_root)
    batch_dir = Path(batch_dir)
    batch_dir.mkdir(parents=True, exist_ok=True)
    batch_path = batch_dir / "batch.json"

    if batch_path.is_file():
        batch = json.loads(batch_path.read_text(encoding="utf-8"))
        if batch.get("allocation_sha256") != allocation_sha256:
            raise VariationBuildError(
                f"{batch_path} was created from a different allocation "
                f"({batch.get('allocation_sha256')!r} != {allocation_sha256!r}) "
                "— refusing to harvest against a stale batch"
            )
    else:
        initial_cells = [
            {
                "cell_id": cell["cell_id"],
                "anchor": cell["anchor"],
                "template_id": cell["template_id"],
                "mechanism": arm,
                "seed": cell["seed"],
                "image_id": _expected_image_id(cell, arm),
                "state": "generated",
            }
            for cell in cells_all
        ]
        batch = bs.new_batch(
            batch_id=BATCH_LABEL, persona_id=persona_id,
            allocation_sha256=allocation_sha256, cells=initial_cells,
        )
        bes._atomic_write_json(batch_path, batch)

    summary: dict[str, list[str]] = {
        "harvested": [], "already_harvested": [], "skipped_not_run": [],
    }

    for stem, cells in _run_groups(cells_all, arm):
        run_dir = run_root / f"{persona_id}-{BATCH_LABEL}-{stem}"
        run_json_path = run_dir / "run.json"
        manifest_json_path = run_dir / "manifest.json"

        if not run_json_path.is_file():
            summary["skipped_not_run"].append(stem)
            continue

        run_data = json.loads(run_json_path.read_text(encoding="utf-8"))
        if run_data.get("termination_verified") is not True:
            raise VariationBuildError(
                f"{stem}: run.json termination_verified is not True — "
                "refusing to harvest an unverified pod exit"
            )
        if not manifest_json_path.is_file():
            raise VariationBuildError(f"{stem}: manifest.json is missing")

        images_doc = json.loads(manifest_json_path.read_text(encoding="utf-8"))
        images = images_doc.get("images") if isinstance(images_doc, dict) else images_doc
        if not isinstance(images, list):
            raise VariationBuildError(f"{stem}: manifest.json has no images list")

        expected_ids = {_expected_image_id(cell, arm) for cell in cells}
        got_ids = {row.get("image_id") for row in images}
        if len(images) != len(cells) or got_ids != expected_ids:
            raise VariationBuildError(
                f"{stem}: harvested output identity mismatch (expected "
                f"{sorted(expected_ids)}, got {sorted(got_ids)})"
            )

        cost = round(float(run_data.get("estimated_actual_usd") or 0.0), 6)
        cell_ids = sorted(cell["cell_id"] for cell in cells)

        existing = next(
            (row for row in batch.get("pod_runs", []) if row.get("shard_id") == stem),
            None,
        )
        if existing is not None:
            if existing.get("cell_ids") == cell_ids and existing.get("cost_usd") == cost:
                summary["already_harvested"].append(stem)
                continue
            raise VariationBuildError(
                f"{stem}: conflicting duplicate harvest — a pod-run row "
                "already exists with different content; pod_runs is "
                "append-only and is never silently overwritten"
            )

        row = {
            "shard_id": stem,
            "arm": arm,
            "run_json_path": str(run_json_path),
            "manifest_json_path": str(manifest_json_path),
            "cell_ids": cell_ids,
            "status": "harvested",
            "cost_usd": cost,
        }

        def _record(current_batch: dict, row: dict = row) -> dict:
            return bs.record_pod_run(current_batch, row)

        batch = bs.apply_batch(batch_path, _record)

        provenance_dir = batch_dir / "pod-runs" / stem
        provenance_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(run_json_path, provenance_dir / "run.json")
        shutil.copy2(manifest_json_path, provenance_dir / "manifest.json")

        images_dir = batch_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        for image_row in images:
            src = run_dir / image_row["path"]
            if src.is_file():
                shutil.copy2(src, images_dir / image_row["path"])

        summary["harvested"].append(stem)

    if batch.get("stage") == "building" and batch.get("pod_runs"):
        batch = bs.apply_batch(batch_path, lambda current: bs.mark_batch_stage(current, "generated"))

    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _write_allocation(out_dir: Path, persona_id: str, allocation: list[dict]) -> Path:
    """Records `anchor`/`template_id`/`denoise`/`seed`/`is_pilot` per cell so a
    downstream scorer can resolve each output image's own anchor (design §4's
    "blocking scoring defect" — `identity_check.py`'s --persona/--batch mode
    resolves a single global anchor; this table is the per-cell fix's input)."""
    path = out_dir / f"{persona_id}-{BATCH_LABEL}-allocation.json"
    bes = _bes()
    bes._atomic_write_json(path, {
        "schema": "figment/expansion-allocation@1",
        "persona_id": persona_id,
        "batch_id": BATCH_LABEL,
        "cells": allocation,
    })
    return path


def _cli_pilot(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    persona = _load_persona(args.persona)
    templates_doc = load_templates(args.templates)
    allocation = generate_variation_allocation(persona, templates_doc)
    _write_allocation(out_dir, persona["id"], allocation)

    paths = build_pilot_manifests(
        args.persona, args.base_manifest, args.multiref_workflow,
        args.variation_workflow, args.templates, out_dir,
    )
    base_manifest = _load_base_manifest(args.base_manifest)
    print(pilot_summary(base_manifest, pilot_cells(allocation)))
    print(f"wrote {paths['A']}")
    print(f"wrote {paths['B']}")
    return 0


def _cli_full(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    persona = _load_persona(args.persona)
    templates_doc = load_templates(args.templates)
    allocation = generate_variation_allocation(persona, templates_doc)
    _write_allocation(out_dir, persona["id"], allocation)

    paths = build_full_manifests(
        args.persona, args.base_manifest, args.multiref_workflow,
        args.variation_workflow, args.templates, out_dir,
    )
    total = sum(len(v) for v in paths.values())
    print(
        f"built {len(full_cells(allocation))} remaining cells across "
        f"{total} manifest(s) ({len(paths['A'])} arm-A shards, "
        f"{len(paths['B'])} arm-B shards, {JOBS_PER_SHARD} jobs/shard max)"
    )
    return 0


def _cli_harvest(args: argparse.Namespace) -> int:
    summary = harvest_variation_runs(
        args.persona, args.allocation, args.run_root, args.batch_dir, args.arm,
    )
    print(
        f"harvested {len(summary['harvested'])} group(s); "
        f"already-harvested {len(summary['already_harvested'])}; "
        f"not yet run {len(summary['skipped_not_run'])}"
    )
    return 0


def _add_common_args(cmd: argparse.ArgumentParser) -> None:
    cmd.add_argument("--persona", required=True, type=Path)
    cmd.add_argument("--base-manifest", required=True, type=Path)
    cmd.add_argument("--multiref-workflow", required=True, type=Path)
    cmd.add_argument("--variation-workflow", required=True, type=Path)
    cmd.add_argument("--templates", required=True, type=Path)
    cmd.add_argument("--out", required=True, type=Path)


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="build_variation_set.py",
        description="Deterministic expansion-03 anchor-variation builder (X3-B).",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    pilot_cmd = sub.add_parser(
        "pilot",
        help="build the 2 pilot manifests (3 paired A/B trials, network-free)",
    )
    _add_common_args(pilot_cmd)
    pilot_cmd.set_defaults(func=_cli_pilot)

    full_cmd = sub.add_parser(
        "full",
        help="build the full-batch manifests for both arms over the 33 remaining cells",
    )
    _add_common_args(full_cmd)
    full_cmd.set_defaults(func=_cli_full)

    harvest_cmd = sub.add_parser(
        "harvest",
        help="validate one arm's finished pod-run provenance and copy it into the tracked batch layout",
    )
    harvest_cmd.add_argument("--persona", required=True, type=Path)
    harvest_cmd.add_argument("--allocation", required=True, type=Path)
    harvest_cmd.add_argument("--run-root", required=True, type=Path)
    harvest_cmd.add_argument("--batch-dir", required=True, type=Path)
    harvest_cmd.add_argument("--arm", choices=MECHANISMS, default="A")
    harvest_cmd.set_defaults(func=_cli_harvest)

    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        return args.func(args)
    except (VariationBuildError, ValueError, OSError) as exc:
        print(f"build_variation_set error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
