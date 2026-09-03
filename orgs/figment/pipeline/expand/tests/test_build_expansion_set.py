"""Tests for `expand/build_expansion_set.py` (plan Task 5 / P2: allocation,
prompts, manifest validation, resume, harvest — plan Step 5.1-5.4).

Reuses the repo's existing `load_module` ad-hoc file loader (no `__init__.py`
package import is assumed for `pod`/`train`/`persona.py`), the same pattern
`test_batch_state.py` and `test_training_tools.py` already use.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

import pytest
from PIL import Image

EXPAND = Path(__file__).resolve().parents[1]
PIPELINE = EXPAND.parent
POD = PIPELINE / "pod"
TRAIN = PIPELINE / "train"
PERSONAS = PIPELINE.parent / "personas"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


bes = load_module("figment_expand_build_expansion_set", EXPAND / "build_expansion_set.py")
pod = load_module("figment_expand_test_pod_runpod_run", POD / "runpod_run.py")
persona_mod = load_module("figment_expand_test_persona", PIPELINE / "persona.py")
gates_mod = load_module("figment_expand_test_gates", PIPELINE / "gates.py")
bs = load_module("figment_expand_test_batch_state", EXPAND / "batch_state.py")

PERSONA = PERSONAS / "creator-001" / "persona.yaml"
BASE = TRAIN / "runs" / "creator-001-composite-02.yaml"
WORKFLOW = TRAIN / "workflows" / "klein4b_multiref_api.json"

# ---------------------------------------------------------------------------
# BANNED_PHRASES — mirrored from pipeline/look-spec-v2.md §4a ("Banned — these
# pull toward the rejected look"), verbatim per family. UNSAFE_TERMS is this
# test's own sexual/unclothed vocabulary guard, not from look-spec-v2.
# ---------------------------------------------------------------------------
BANNED_PHRASES = frozenset({
    # soft-glam vocabulary
    "soft glam", "glam", "glamorous", "beauty shot", "professional makeup",
    "makeup artist", "full face of makeup", "beat", "snatched", "editorial",
    "high fashion", "vogue", "striking", "sultry", "smouldering", "seductive",
    "alluring",
    # bronzer/contour family
    "bronzer", "bronzed", "luminous bronzer", "sun-kissed", "gilded",
    "contour", "contoured", "sculpted cheekbones", "chiselled",
    "defined jawline", "highlighter", "strobing", "cut crease", "baked",
    "bake-and-brush",
    # plastic-skin family
    "flawless skin", "poreless", "airbrushed", "porcelain skin", "glass skin",
    "glowing", "radiant", "luminous", "dewy glow", "filtered", "retouched",
    "perfect complexion",
    # lip family
    "glossy nude lip", "full lips", "plump lips", "pouty lips", "plush lips",
    "overlined", "lip filler",
    # brow/lash family
    "groomed full brow", "perfectly arched brows", "laminated brows",
    "bold brows", "dramatic lashes", "lash extensions", "winged eyeliner",
    "smoky eye",
    # styling signature
    "gold hoops", "gold hoop earrings", "statement jewelry", "layered gold",
    "caramel balayage", "honey balayage", "money piece", "blowout",
    "salon hair",
    # body family
    "hourglass", "curvaceous", "voluptuous", "busty", "tiny waist",
    "snatched waist",
    # light family
    "studio lighting", "beauty lighting", "softbox", "ring light",
    "seamless backdrop", "golden hour glow", "cinematic lighting",
    "professional photography",
    # age family (reads minor, not merely young)
    "girl", "young girl", "teen", "teenage", "schoolgirl", "high school",
    "barely legal", "youthful", "baby face", "babyface", "childlike",
    "innocent", "doll-like", "petite little", "cute little", "tiny body",
    "pigtails", "uniform", "18", "19",
})

UNSAFE_TERMS = frozenset({
    "nude", "naked", "topless", "nsfw", "explicit sex", "porn", "hardcore",
})


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def persona():
    return persona_mod.load_persona(PERSONA)


@pytest.fixture
def allocation(persona):
    return bes.generate_allocation(persona)


@pytest.fixture
def batch(persona):
    return bs.new_batch(
        batch_id="expansion-02", persona_id=persona["id"],
        allocation_sha256="a" * 64, cells=[],
    )


@pytest.fixture
def staged_uploads(tmp_path):
    """Stage tiny real JPEG bytes at the ignored `_uploads/creator-001/`
    sibling `require_manifest`'s strict (non-dry-run) preflight expects."""
    uploads_dir = tmp_path / "_uploads" / "creator-001"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    for name in ("g01.jpg", "g02.jpg", "g07.jpg"):
        Image.new("RGB", (8, 8), color=(120, 90, 90)).save(uploads_dir / name)
    return uploads_dir


# ---------------------------------------------------------------------------
# Test-local helpers (deliberately NOT part of build_expansion_set.py's
# frozen Step 5.1 interface list)
# ---------------------------------------------------------------------------


def stratum_key(cell: dict) -> tuple:
    return (cell["angle"], cell["distance"], cell["light"])


def primary_lookup(cells: list[dict]) -> dict:
    return {c["stratum_id"]: c for c in cells if not c["is_replicate"]}


def names(paths) -> list[str]:
    return [p.name for p in paths]


def copied_blocks(manifest_path: Path, base_path: Path, keys) -> bool:
    manifest = pod.load_manifest(manifest_path)
    base = pod.load_manifest(base_path)
    return all(manifest.get(key) == base.get(key) for key in keys)


def graph_contract(manifest_path: Path):
    manifest = pod.load_manifest(manifest_path)
    workflow = manifest["workflow"]
    load_images = [
        Path(workflow[node_id]["inputs"]["image"]).name for node_id in ("6", "7", "8")
    ]
    latent = workflow["21"]["inputs"]
    scheduler = workflow["24"]["inputs"]
    return (
        [Path(name).stem for name in load_images],
        latent["width"], latent["height"],
        int(workflow["23"]["inputs"]["cfg"]),
        scheduler["steps"],
        workflow["25"]["inputs"]["sampler_name"],
    )


def no_network_volume_or_unknown_keys(manifest_path: Path) -> bool:
    manifest = pod.load_manifest(manifest_path)
    forbidden = {"network_volume_id", "network_volume", "training", "artifacts"}
    if forbidden & set(manifest):
        return False
    return set(manifest) <= bes.ALLOWED_MANIFEST_KEYS


def provisional_captions_match_all_cell_ids(persona_doc: dict) -> bool:
    cells = bes.generate_allocation(persona_doc)
    ids = {cell["cell_id"] for cell in cells}
    captions = {cell["cell_id"]: bes.build_caption(persona_doc, cell) for cell in cells}
    return (
        set(captions) == ids
        and all("provisional_generation_caption" in text for text in captions.values())
    )


def fake_completed_rows(n: int) -> list[dict]:
    return [
        {"shard_id": bes.shard_id_for(i), "cell_ids": [], "status": "harvested", "cost_usd": 0.1}
        for i in range(1, n + 1)
    ]


def shard_ids(start: int, end_inclusive: int) -> list[str]:
    return [bes.shard_id_for(i) for i in range(start, end_inclusive + 1)]


def write_fake_shard_run(
    run_root: Path, persona_id: str, shard_number: int, cells: list[dict], *,
    termination_verified: bool = True, cost: float = 0.5, break_output_ids: bool = False,
    missing_one_output: bool = False,
) -> Path:
    """A harness-shaped fake run directory: `run.json`, `manifest.json`, and
    one dummy output file per cell — enough for `harvest_runs` to validate
    against without ever touching a real pod."""
    shard_id = bes.shard_id_for(shard_number)
    run_dir = run_root / f"{persona_id}-expansion-02-{shard_id}"
    run_dir.mkdir(parents=True, exist_ok=True)

    images = []
    for index, cell in enumerate(cells):
        image_id = f"c001-{cell['cell_id']}"
        if break_output_ids and index == 0:
            image_id = "c001-not-an-allocated-cell"
        path_name = f"{image_id}.png"
        (run_dir / path_name).write_bytes(b"\x89PNG\r\n\x1a\nfake")
        images.append({
            "image_id": image_id, "path": path_name,
            "review_status": "unreviewed", "parked_reasons": [],
        })
    if missing_one_output and images:
        images.pop()

    run_json = {
        "schema": "figment/runpod-run@1",
        "dry_run": False,
        "pod_id": f"fake-pod-{shard_id}",
        "termination_verified": termination_verified,
        "estimated_actual_usd": cost,
        "jobs": [{"output_name": row["image_id"]} for row in images],
    }
    (run_dir / "run.json").write_text(json.dumps(run_json), encoding="utf-8")
    (run_dir / "manifest.json").write_text(json.dumps({"images": images}), encoding="utf-8")
    return run_dir


def write_allocation_file(persona_doc: dict, out_path: Path) -> list[dict]:
    cells = bes.generate_allocation(persona_doc)
    out_path.write_text(json.dumps({
        "schema": "figment/expansion-allocation@1",
        "persona_id": persona_doc["id"],
        "batch_id": "expansion-02",
        "cells": cells,
    }), encoding="utf-8")
    return cells


# ---------------------------------------------------------------------------
# Step 5.1 — allocation
# ---------------------------------------------------------------------------


def test_allocation_is_deterministic_60_cells_unique_ids_and_seeds(persona):
    one, two = bes.generate_allocation(persona), bes.generate_allocation(persona)
    assert one == two and len(one) == 60
    assert len({c["cell_id"] for c in one}) == len({c["seed"] for c in one}) == 60


def test_first_40_cells_are_40_distinct_strata(allocation):
    assert len({stratum_key(c) for c in allocation[:40]}) == 40


def test_replicates_are_exactly_the_20_half_body_strata_in_order(allocation):
    assert [c["source_stratum_id"] for c in allocation[40:]] == [
        c["stratum_id"] for c in allocation[:40] if c["distance"] == "half"
    ]


def test_replicates_never_repeat_primary_wardrobe_or_seed(allocation):
    primaries = primary_lookup(allocation)

    def primary_for(cell):
        return primaries[cell["source_stratum_id"]]

    assert all(
        c["wardrobe_family"] != primary_for(c)["wardrobe_family"] for c in allocation[40:]
    )
    assert all(c["seed"] != primary_for(c)["seed"] for c in allocation[40:])


def test_wardrobe_families_are_perfectly_balanced_across_all_60_cells(allocation):
    assert set(Counter(c["wardrobe_family"] for c in allocation).values()) == {12}


def test_close_distance_strata_are_never_replicated(allocation):
    replicate_distances = {c["distance"] for c in allocation if c["is_replicate"]}
    assert replicate_distances == {"half"}


def test_allocation_ids_follow_the_spec_ranges(allocation):
    primary_ids = sorted(c["cell_id"] for c in allocation if not c["is_replicate"])
    replicate_ids = sorted(c["cell_id"] for c in allocation if c["is_replicate"])
    assert primary_ids == [f"exp02-s{i:03d}" for i in range(1, 41)]
    assert replicate_ids == [f"exp02-r{i:03d}" for i in range(1, 21)]


# ---------------------------------------------------------------------------
# Step 5.2 — prompts and captions
# ---------------------------------------------------------------------------


def test_prompts_are_80_to_250_words_and_state_adult_woman_fully_opaque_intact(persona, allocation):
    for cell in allocation:
        prompt = bes.build_prompt(persona, cell)
        assert 80 <= len(prompt.split()) <= 250
        assert "adult woman" in prompt.lower()
        assert all(x in prompt.lower() for x in ("fully opaque", "intact"))
        assert not any(term in prompt.lower() for term in BANNED_PHRASES | UNSAFE_TERMS)


def test_provisional_captions_cover_every_cell_id_exactly_once(persona):
    assert provisional_captions_match_all_cell_ids(persona)


def test_all_prompt_and_negative_prompt_templates_are_clean_of_banned_terms(persona, allocation):
    """Greps every prompt/negative-prompt template this plan produces — the P2
    positive-prompt builder, plus node 5's static negative/cleanup text frozen
    into the manifest builder in Step 5.3 — against look-spec-v2 §4a's full
    banned list (age, soft-glam, bronzer/contour, plastic-skin, lip,
    brow/lash, styling-signature, body, and light families)."""
    templates = [bes.build_prompt(persona, cell) for cell in allocation]
    templates.append(bes.NODE_5_NEGATIVE_PROMPT)
    for text in templates:
        assert not any(term in text.lower() for term in BANNED_PHRASES)


# ---------------------------------------------------------------------------
# Step 5.3 — strict manifests from the verified graph
# ---------------------------------------------------------------------------


def test_build_manifests_writes_six_named_shards_of_ten_jobs(tmp_path, staged_uploads):
    paths = bes.build_manifests(PERSONA, BASE, WORKFLOW, tmp_path)
    assert names(paths) == [f"creator-001-expansion-02-shard-{i:02d}.yaml" for i in range(1, 7)]
    assert all(pod.require_manifest(pod.load_manifest(p), p) is None for p in paths)
    assert all(len(pod.load_manifest(p)["jobs"]) == 10 for p in paths)
    assert copied_blocks(
        paths[0], BASE,
        ("gpu", "image", "price_usd_per_hour", "models", "comfyui", "custom_nodes",
         "avoid_machine_hosts"),
    )
    assert graph_contract(paths[0]) == (["g01", "g02", "g07"], 1024, 1280, 4, 50, "euler")
    assert all(no_network_volume_or_unknown_keys(p) for p in paths)


def test_build_manifests_sets_the_expansion02_time_and_disk_overrides(tmp_path):
    paths = bes.build_manifests(PERSONA, BASE, WORKFLOW, tmp_path)
    for path in paths:
        manifest = pod.load_manifest(path)
        assert manifest["job_timeout_seconds"] == 360
        assert manifest["readiness_timeout_seconds"] == 900
        assert manifest["max_minutes"] == 82
        assert manifest["container_disk_gb"] == 60
        assert manifest["volume_gb"] == 0
        # 900 + 10*360 + 300 = 4800s against the 4920s (82 min) budget.
        assert 900 + 10 * 360 + 300 <= manifest["max_minutes"] * 60


def test_build_manifests_never_embeds_planning_metadata(tmp_path):
    paths = bes.build_manifests(PERSONA, BASE, WORKFLOW, tmp_path)
    for path in paths:
        manifest = pod.load_manifest(path)
        for forbidden in ("identity_set", "captions", "stratum_data", "allocation"):
            assert forbidden not in manifest


def test_build_manifests_is_byte_for_byte_reproducible(tmp_path):
    out1, out2 = tmp_path / "one", tmp_path / "two"
    paths1 = bes.build_manifests(PERSONA, BASE, WORKFLOW, out1)
    paths2 = bes.build_manifests(PERSONA, BASE, WORKFLOW, out2)
    assert len(paths1) == len(paths2) == 6
    for p1, p2 in zip(paths1, paths2):
        assert len(pod.load_manifest(p1)["jobs"]) == 10
        assert p1.read_bytes() == p2.read_bytes()


# ---------------------------------------------------------------------------
# Step 5.4 — resume and harvest without a pod
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("finished", [1, 3, 5])
def test_resume_returns_only_missing_shards(finished, batch, allocation):
    batch["pod_runs"] = fake_completed_rows(finished)
    assert bes.missing_shards(allocation, batch) == shard_ids(finished + 1, 6)


def test_resume_with_nothing_done_returns_all_six_shards(batch, allocation):
    assert bes.missing_shards(allocation, batch) == shard_ids(1, 6)


def test_resume_with_everything_done_returns_no_shards(batch, allocation):
    batch["pod_runs"] = fake_completed_rows(6)
    assert bes.missing_shards(allocation, batch) == []


def test_harvest_rejects_bad_termination_outputs_hash_or_duplicate(tmp_path, persona):
    persona_id = persona["id"]
    allocation_path = tmp_path / "allocation.json"
    cells = write_allocation_file(persona, allocation_path)
    groups = [cells[i:i + 10] for i in range(0, 60, 10)]

    # 1) termination not verified -> refuse.
    run_root = tmp_path / "run-root-unverified"
    write_fake_shard_run(run_root, persona_id, 1, groups[0], termination_verified=False)
    with pytest.raises(ValueError, match="termination_verified"):
        bes.harvest_runs(PERSONA, allocation_path, run_root, tmp_path / "batch-unverified")

    # 2) output identity mismatch (an unexpected image id) -> refuse.
    run_root = tmp_path / "run-root-bad-ids"
    write_fake_shard_run(run_root, persona_id, 1, groups[0], break_output_ids=True)
    with pytest.raises(ValueError, match="identity mismatch"):
        bes.harvest_runs(PERSONA, allocation_path, run_root, tmp_path / "batch-bad-ids")

    # 3) missing output count -> refuse.
    run_root = tmp_path / "run-root-missing"
    write_fake_shard_run(run_root, persona_id, 1, groups[0], missing_one_output=True)
    with pytest.raises(ValueError, match="identity mismatch"):
        bes.harvest_runs(PERSONA, allocation_path, run_root, tmp_path / "batch-missing")

    # 4) a conflicting duplicate (same shard_id, different cost) is always an error.
    run_root = tmp_path / "run-root-dup"
    batch_dir = tmp_path / "batch-dup"
    write_fake_shard_run(run_root, persona_id, 1, groups[0], cost=0.42)
    first = bes.harvest_runs(PERSONA, allocation_path, run_root, batch_dir)
    assert first["harvested"] == ["shard-01"]
    write_fake_shard_run(run_root, persona_id, 1, groups[0], cost=0.99)
    with pytest.raises(ValueError, match="conflicting duplicate"):
        bes.harvest_runs(PERSONA, allocation_path, run_root, batch_dir)


def test_identical_reharvest_is_idempotent_and_changed_board_stales_gate(tmp_path, persona):
    persona_id = persona["id"]
    allocation_path = tmp_path / "allocation.json"
    cells = write_allocation_file(persona, allocation_path)
    groups = [cells[i:i + 10] for i in range(0, 60, 10)]

    run_root = tmp_path / "run-root"
    batch_dir = tmp_path / "batch"
    write_fake_shard_run(run_root, persona_id, 1, groups[0], cost=0.5)

    first = bes.harvest_runs(PERSONA, allocation_path, run_root, batch_dir)
    assert first["harvested"] == ["shard-01"]
    batch_path = batch_dir / "batch.json"
    batch_after_first = json.loads(batch_path.read_text(encoding="utf-8"))
    assert len(batch_after_first["pod_runs"]) == 1
    assert batch_after_first["cost_usd"] == pytest.approx(0.5)

    # Identical re-harvest: idempotent, no second cost row.
    second = bes.harvest_runs(PERSONA, allocation_path, run_root, batch_dir)
    assert second["already_harvested"] == ["shard-01"]
    assert second["harvested"] == []
    batch_after_second = json.loads(batch_path.read_text(encoding="utf-8"))
    assert len(batch_after_second["pod_runs"]) == 1
    assert batch_after_second["cost_usd"] == pytest.approx(0.5)

    # A gate bound to the harvested batch.json is current right after it's
    # written...
    gate_path = tmp_path / "gate.json"
    gate = gates_mod.write_gate(
        gate_path, gate_id="gate-a-smoke", subject_path=batch_path,
        decision="verified", decided_by="operator", decided_at="2026-09-03T07:20:00+00:00",
    )
    assert gates_mod.gate_is_current(gate, batch_path) is True

    # ...but harvesting a second shard changes batch.json's bytes, which
    # stales the gate automatically — a stale gate can never approve changed
    # content (plan global constraints).
    write_fake_shard_run(run_root, persona_id, 2, groups[1], cost=0.3)
    bes.harvest_runs(PERSONA, allocation_path, run_root, batch_dir)
    assert gates_mod.gate_is_current(gate, batch_path) is False
