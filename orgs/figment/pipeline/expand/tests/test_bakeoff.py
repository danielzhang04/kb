"""Tests for the identity-transfer bake-off (R24 candidates, single-image -> pose/lighting
variants).

Scope is deliberately narrow: only `m1` (Qwen-Image-Edit-2511, Lightning removed, +
tlennon-ie/qwen-edit-skin) turned out runnable. `m2` (Z-Image-Edit) has no published
weights and `m3` (PuLID FaceNet-loader on FLUX.1-schnell) is rejected on a mandatory
pickle dependency the node itself documents -- both are asserted here as *documented*
non-runnable/reject verdicts with evidence, not built as manifests, per the task brief
("For each runnable method: ..."). See `pipeline/expand/bakeoff/README.md`.

`m1.yaml` is a single-bootstrap ablation: 6 cells x 3 arms = 18 jobs against one
workflow graph, so a scorer can tell what moves identity/age/gloss.

- arm a -- as built: no Lightning, 26 steps, skin LoRA @1.0, refs g01+g02+g07.
- arm b -- arm a with the skin LoRA's `strength_model` substituted to 0.0 (mathematically
  equivalent to the LoRA being absent, without a second model load) -- isolates the LoRA.
- arm c -- arm a's LoRA setting, but only g01 wired into a second, otherwise-identical
  edit-conditioning track -- isolates the multi-reference effect.

One graph carries both tracks; each job's `SaveImage.images` substitution selects which
track's `VAEDecode` output that job actually renders, so ComfyUI's own backward
reachability from the requested output means the *other* track's nodes never execute for
that job (the same "one graph, output selected per job" pattern
`tensor_dataset_v2_api.json` already uses, per `TENSOR-REPLICATION.md` D10).

Follows the same importlib-reuse convention as `test_tensor_dataset.py`: no package
`__init__.py` exists in this tree, so sibling test modules that expose fixtures/constants
are loaded by path instead of duplicated.
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

EXPAND = Path(__file__).resolve().parents[1]
PIPELINE = EXPAND.parent
BAKEOFF = EXPAND / "bakeoff"
POD_RUNNER = PIPELINE / "pod" / "runpod_run.py"
VERIFY_PINS = PIPELINE / "train" / "verify_pins.py"
ROOT = PIPELINE.parents[2]  # this worktree's repo root (.../orgs/figment/pipeline -> ...)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


bes_test = load_module(
    "figment_bakeoff_test_build_expansion_set", EXPAND / "tests" / "test_build_expansion_set.py"
)
BANNED_PHRASES = bes_test.BANNED_PHRASES
UNSAFE_TERMS = bes_test.UNSAFE_TERMS

pod = load_module("figment_bakeoff_test_pod_runpod_run", POD_RUNNER)
verify_pins = load_module("figment_bakeoff_test_verify_pins", VERIFY_PINS)
summarize = load_module("figment_bakeoff_test_summarize", BAKEOFF / "summarize.py")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


MANIFEST_PATH = BAKEOFF / "m1.yaml"
WORKFLOW_PATH = BAKEOFF / "m1_api.json"
PINS_PATH = BAKEOFF / "pins.yaml"
README_PATH = BAKEOFF / "README.md"
SUMMARIZE_PATH = BAKEOFF / "summarize.py"

REQUIRED_LITERAL = "fully opaque and intact"
LICENCE_ALLOWLIST = frozenset({
    "apache-2.0", "mit", "cc-by-4.0", "cc0-1.0",
})
AGE_4C_TOKENS = frozenset({
    "young", "girlish", "small", "little", "cute", "fresh-faced",
})
AGE_4C_PATTERN = re.compile(r"\b(?:" + "|".join(re.escape(t) for t in AGE_4C_TOKENS) + r")\b")

OUTPUT_NAME_RE = re.compile(r"^c001-bo-(?P<arm>[abc])-(?P<cell>.+)$")
ARMS = ("a", "b", "c")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def manifest() -> dict:
    return load_json(MANIFEST_PATH)


@pytest.fixture(scope="module")
def pins() -> dict:
    return load_json(PINS_PATH)


@pytest.fixture(scope="module")
def workflow() -> dict:
    return load_json(WORKFLOW_PATH)


def _job_arm_cell(job: dict) -> tuple[str, str]:
    match = OUTPUT_NAME_RE.match(job["output_name"])
    assert match, f"output_name does not match c001-bo-<arm>-<cell>: {job['output_name']!r}"
    return match.group("arm"), match.group("cell")


def _job_prompt_substitution(job: dict) -> dict:
    """The one substitution on this job whose field is "prompt" (node 10 for arm a/b,
    node 20 for arm c) -- exactly one must exist, on whichever track that job's arm
    actually renders."""
    prompt_subs = [s for s in job["substitutions"] if s["field"] == "prompt"]
    assert len(prompt_subs) == 1, (job["output_name"], job["substitutions"])
    return prompt_subs[0]


def _job_images_substitution(job: dict) -> dict:
    images_subs = [s for s in job["substitutions"] if s["field"] == "images"]
    assert len(images_subs) == 1, (job["output_name"], job["substitutions"])
    return images_subs[0]


def _job_strength_substitution(job: dict) -> dict:
    strength_subs = [s for s in job["substitutions"] if s["field"] == "strength_model"]
    assert len(strength_subs) == 1, (job["output_name"], job["substitutions"])
    return strength_subs[0]


@pytest.fixture(scope="module")
def jobs_by_arm_cell(manifest: dict) -> dict[tuple[str, str], dict]:
    result = {}
    for job in manifest["jobs"]:
        result[_job_arm_cell(job)] = job
    return result


@pytest.fixture(scope="module")
def job_prompts(manifest: dict) -> list[str]:
    """One prompt string per job (18 total) -- the value of whichever track's `prompt`
    substitution that job carries."""
    return [_job_prompt_substitution(job)["value"] for job in manifest["jobs"]]


# ---------------------------------------------------------------------------
# Files exist where the brief says, and only there
# ---------------------------------------------------------------------------


def test_bakeoff_files_exist():
    assert MANIFEST_PATH.is_file()
    assert WORKFLOW_PATH.is_file()
    assert PINS_PATH.is_file()
    assert README_PATH.is_file()



def test_manifest_has_18_jobs(manifest: dict):
    assert len(manifest["jobs"]) == 18


def test_six_cells_three_arms_each_with_shared_seed_per_cell(manifest: dict):
    by_cell: dict[str, set] = {}
    seed_by_cell: dict[str, set] = {}
    arms_seen: set[str] = set()
    for job in manifest["jobs"]:
        arm, cell = _job_arm_cell(job)
        arms_seen.add(arm)
        by_cell.setdefault(cell, set()).add(arm)
        seed_by_cell.setdefault(cell, set()).add(job["seed"])
    assert arms_seen == set(ARMS)
    assert len(by_cell) == 6, sorted(by_cell)
    for cell, arms in by_cell.items():
        assert arms == set(ARMS), (cell, arms)
    for cell, seeds in seed_by_cell.items():
        assert len(seeds) == 1, (cell, seeds, "seed must be identical across a cell's 3 arms")
    all_seeds = {job["seed"] for job in manifest["jobs"]}
    assert len(all_seeds) == 6, "6 distinct fixed seeds, one per cell, reused across arms"


def test_manifest_cell_distribution_matches_the_brief(manifest: dict):
    """2 close frontal, 2 three-quarter half-body, 1 profile, 1 half-body window-light --
    checked once per cell (not per job, now that each cell has 3 jobs)."""
    cells = {_job_arm_cell(job)[1] for job in manifest["jobs"]}
    close_front = [c for c in cells if "close-front" in c]
    threequarter_half = [c for c in cells if "threequarter" in c and "half" in c]
    profile = [c for c in cells if "profile" in c]
    half_window = [c for c in cells if "half-windowlight" in c]
    assert len(close_front) == 2, cells
    assert len(threequarter_half) == 2, cells
    assert len(profile) == 1, cells
    assert len(half_window) == 1, cells
    assert len(cells) == 6


def test_manifest_resolution_is_the_stated_comparable_canvas(workflow: dict):
    for node_id in ("12", "22"):
        latent = workflow[node_id]["inputs"]
        assert (latent["width"], latent["height"]) == (1448, 2176), node_id


def test_manifest_steps_and_cfg_in_the_r24_recipe_range(workflow: dict):
    for node_id in ("13", "23"):
        sampler = workflow[node_id]["inputs"]
        assert 24 <= sampler["steps"] <= 28, node_id
        assert 2.0 <= sampler["cfg"] <= 4.0, node_id
        assert sampler["denoise"] == 1.0, node_id


def test_no_lightning_lora_anywhere_in_m1(manifest: dict, workflow: dict):
    """The whole point of m1 (r24 candidate 1) is Lightning removed, steps raised."""
    blob = json.dumps(manifest).lower() + json.dumps(workflow).lower()
    assert "lightning" not in blob


def test_skin_lora_node_is_shared_and_static_config_is_arm_a_default(workflow: dict):
    lora_node = workflow["4"]["inputs"]
    assert lora_node["lora_name"] == "qwen-edit-skin.safetensors"
    assert lora_node["strength_model"] == 1.0  # every job substitutes this explicitly anyway


def test_arm_strength_substitutions_isolate_the_lora(manifest: dict, jobs_by_arm_cell: dict):
    """Arm a and c keep the recipe strength (1.0-1.5, task's stated LoRA weight band);
    arm b substitutes exactly 0.0 -- mathematically no LoRA, same node, same graph."""
    for (arm, cell), job in jobs_by_arm_cell.items():
        strength = _job_strength_substitution(job)["value"]
        if arm == "b":
            assert strength == 0.0, (arm, cell, strength)
        else:
            assert 1.0 <= strength <= 1.5, (arm, cell, strength)


def test_arm_a_and_b_render_the_three_ref_track_arm_c_the_single_ref_track(
    jobs_by_arm_cell: dict,
):
    for (arm, cell), job in jobs_by_arm_cell.items():
        images_value = _job_images_substitution(job)["value"]
        prompt_node = _job_prompt_substitution(job)["node_id"]
        if arm == "c":
            assert images_value == ["24", 0], (arm, cell)
            assert prompt_node == "20", (arm, cell)
        else:
            assert images_value == ["14", 0], (arm, cell)
            assert prompt_node == "10", (arm, cell)


def test_identical_prompt_text_across_the_three_arms_within_a_cell(
    jobs_by_arm_cell: dict,
):
    cells = {cell for _, cell in jobs_by_arm_cell}
    for cell in cells:
        prompts = {
            _job_prompt_substitution(jobs_by_arm_cell[(arm, cell)])["value"] for arm in ARMS
        }
        assert len(prompts) == 1, (cell, prompts)


def test_track_ab_wires_all_three_anchors_track_c_wires_only_g01(workflow: dict):
    ab_node = workflow["10"]["inputs"]
    ab_images = {
        workflow[ab_node[key][0]]["inputs"]["image"] for key in ("image1", "image2", "image3")
    }
    assert ab_images == {"creator-001/g01.jpg", "creator-001/g02.jpg", "creator-001/g07.jpg"}

    c_node = workflow["20"]["inputs"]
    assert set(c_node) & {"image2", "image3"} == set(), "arm c must not wire a second/third ref"
    assert workflow[c_node["image1"][0]]["inputs"]["image"] == "creator-001/g01.jpg"


def test_output_names_follow_the_c001_bo_arm_cell_pattern(manifest: dict):
    for job in manifest["jobs"]:
        assert OUTPUT_NAME_RE.match(job["output_name"]), job["output_name"]


def test_uploads_reference_files_that_actually_exist(manifest: dict):
    for group in manifest["uploads"]:
        for rel in group["files"]:
            assert (BAKEOFF / rel).is_file(), rel


# ---------------------------------------------------------------------------
# Prompts: identity clause, skin-texture clause, safety vocabulary
# ---------------------------------------------------------------------------


def test_every_job_prompt_contains_fully_opaque_and_intact(job_prompts: list[str]):
    assert len(job_prompts) == 18
    for prompt in job_prompts:
        assert REQUIRED_LITERAL in prompt, prompt


def test_every_job_prompt_carries_the_identity_lock_clause(job_prompts: list[str]):
    for prompt in job_prompts:
        assert "do not change her identity" in prompt.lower()
        assert "same face" in prompt.lower()


def test_every_job_prompt_carries_the_skin_texture_clause(job_prompts: list[str]):
    for prompt in job_prompts:
        lowered = prompt.lower()
        for phrase in ("visible pores", "natural skin texture", "no retouching", "matte skin"):
            assert phrase in lowered, (phrase, prompt)


def test_prompts_carry_no_banned_look_spec_phrase(job_prompts: list[str]):
    for prompt in job_prompts:
        lowered = prompt.lower()
        for phrase in BANNED_PHRASES:
            assert phrase not in lowered, (phrase, prompt)
        for term in UNSAFE_TERMS:
            assert term not in lowered, (term, prompt)
        assert not AGE_4C_PATTERN.search(lowered), prompt


def test_prompts_state_adulthood_without_reading_youthful(job_prompts: list[str]):
    for prompt in job_prompts:
        assert "early twenties" in prompt
        assert "adult woman" in prompt


# ---------------------------------------------------------------------------
# Pins: schema, live verification, allowlisted licences
# ---------------------------------------------------------------------------


def test_pins_m1_models_have_64_hex_sha256_and_allowlisted_licence(pins: dict):
    models = pins["pins"]["m1"]["models"]
    assert len(models) == 4
    for model in models:
        assert re.fullmatch(r"[0-9a-f]{64}", model["sha256"]), model
        assert re.fullmatch(r"[0-9a-f]{40}", model["revision"]), model
        assert model["licence"].lower() in LICENCE_ALLOWLIST, model


def test_pins_m1_custom_nodes_is_empty_core_comfyui_only(pins: dict):
    assert pins["pins"]["m1"]["custom_nodes"] == []


def test_manifest_models_match_pins_yaml_exactly(manifest: dict, pins: dict):
    def key(m):
        return (m["repo_id"], m["filename"], m["revision"], m["sha256"])

    manifest_keys = sorted(key(m) for m in manifest["models"])
    pins_keys = sorted(key(m) for m in pins["pins"]["m1"]["models"])
    assert manifest_keys == pins_keys


def test_pins_verify_live_against_hugging_face(pins: dict):
    """The task brief requires the skin LoRA's licence/format be verified LIVE. This
    re-runs the same live HEAD-request check `figment_train.py plan` uses as a
    preflight (train/verify_pins.py), against our own pins.yaml, via its existing
    `--pins` flag -- no copy script needed."""
    problems = verify_pins.verify_pins(pins, stages=["m1"])
    assert problems == {}, problems


def test_verify_pins_cli_accepts_our_pins_path():
    result = subprocess.run(
        [sys.executable, str(VERIFY_PINS), "--pins", str(PINS_PATH)],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "verified 1 stage(s) clean: m1" in result.stdout


# ---------------------------------------------------------------------------
# Cost ceiling / timeouts, computed with the harness's own helpers
# ---------------------------------------------------------------------------


def test_readiness_within_2700(manifest: dict):
    assert manifest["readiness_timeout_seconds"] <= 2700


def test_job_timeout_sized_from_26_step_1448x2176_qwen_edit_expectations(manifest: dict):
    # MEASURED, not estimated: a live run (pod rmefpbe9v5rgou, 2026-09-06) put the
    # original 240s budget in the ground on its very first job (arm A, cell 1 -- cold
    # model load into VRAM plus the 3-image VL encode plus 26 steps at 1448x2176). The
    # harness terminated it at exactly the 240s wall, so the true duration is unknown
    # beyond ">240s" -- see README's "Measured: the first job exceeded 240s live"
    # note. job_timeout_seconds is now 600s, which is what actually cleared preflight
    # for a live run this session; there is no live confirmation yet that every one of
    # the 17 warm (non-first) jobs also fits inside 600s, only that job 1 does not fit
    # inside 240s.
    assert manifest["job_timeout_seconds"] == 600


def test_max_minutes_equals_the_harness_computed_minimum(manifest: dict):
    minimum = pod.minimum_runtime_minutes(manifest)
    assert manifest["max_minutes"] == minimum


def test_manifest_dry_run_reports_the_documented_ceiling(tmp_path):
    result = subprocess.run(
        [
            sys.executable, str(POD_RUNNER), "run",
            "--manifest", str(MANIFEST_PATH),
            "--out", str(tmp_path / "dry-run"),
            "--dry-run",
        ],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert "preflight cost estimate: $4.98" in combined, combined


# ---------------------------------------------------------------------------
# Every manifest in the bake-off dry-runs green (only m1 exists to run)
# ---------------------------------------------------------------------------


def test_every_bakeoff_manifest_dry_runs_green(tmp_path):
    manifests = sorted(BAKEOFF.glob("*.yaml"))
    manifest_names = {p.name for p in manifests}
    assert manifest_names == {"m1.yaml", "pins.yaml"} or "m1.yaml" in manifest_names
    runnable = [p for p in manifests if p.name != "pins.yaml"]
    assert runnable, "expected at least one runnable manifest (m1.yaml)"
    for index, path in enumerate(runnable):
        result = subprocess.run(
            [
                sys.executable, str(POD_RUNNER), "run",
                "--manifest", str(path),
                "--out", str(tmp_path / f"dry-run-{index}"),
                "--dry-run",
            ],
            cwd=ROOT, text=True, capture_output=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr


def test_no_m2_or_m3_manifest_was_built(manifest: dict):
    """m2/m3 are documented NOT RUNNABLE/REJECT, not shipped as dead manifests."""
    assert not (BAKEOFF / "m2_api.json").exists()
    assert not (BAKEOFF / "m2.yaml").exists()
    assert not (BAKEOFF / "m3_api.json").exists()
    assert not (BAKEOFF / "m3.yaml").exists()


# ---------------------------------------------------------------------------
# README documents every method's verdict with evidence
# ---------------------------------------------------------------------------


def test_readme_documents_all_four_methods_with_verdicts():
    text = README_PATH.read_text(encoding="utf-8")
    assert "M1" in text and "RUNNABLE" in text
    assert "M2" in text and "NOT RUNNABLE" in text
    assert "M3" in text and "REJECT" in text
    assert "M4" in text
    assert "tlennon-ie/qwen-edit-skin" in text
    assert "Tongyi-MAI" in text
    assert "lldacing/ComfyUI_PuLID_Flux_ll" in text


def test_readme_states_the_pickle_rejection_reason_for_m3():
    text = README_PATH.read_text(encoding="utf-8").lower()
    assert "pickle" in text
    assert "eva" in text
    assert "facenet" in text or "vggface2" in text


def test_readme_gives_exact_cli_lines():
    text = README_PATH.read_text(encoding="utf-8")
    assert "runpod_run.py run --manifest" in text
    assert "verify_pins.py --pins" in text


def test_pins_rejected_section_documents_m2_and_m3_evidence(pins: dict):
    rejected = pins["rejected_or_not_runnable"]
    assert rejected["m2_z_image_edit"]["status"] == "NOT RUNNABLE"
    assert rejected["m3_pulid_facenet_schnell"]["status"] == "REJECT"
    models = rejected["m3_pulid_facenet_schnell"]["models_it_downloads"]
    pickle_models = [m for m in models if "pickle" in m["format"].lower()]
    assert len(pickle_models) >= 2, "expected both EVA-CLIP and FaceNet .pt to be flagged"


def test_readme_documents_the_ablation_arms():
    text = README_PATH.read_text(encoding="utf-8")
    assert "arm a" in text.lower() or "arm A" in text
    assert "arm b" in text.lower() or "arm B" in text
    assert "arm c" in text.lower() or "arm C" in text
    assert "18" in text  # job count stated somewhere
    assert "summarize.py" in text


# ---------------------------------------------------------------------------
# summarize.py: per-arm median table over a run.json + a gate.json
# ---------------------------------------------------------------------------


def _fake_run_doc() -> dict:
    jobs = []
    for cell in ("01-x", "02-x"):
        for arm in ARMS:
            jobs.append({
                "job": len(jobs) + 1,
                "output_name": f"c001-bo-{arm}-{cell}",
                "seed": 1,
                "prompt_id": "p",
                "seconds": 0.1,
                "files": [{"path": f"c001-bo-{arm}-{cell}.png", "bytes": 10}],
            })
    return {"schema": "figment/run@1", "jobs": jobs}


def _fake_gate_doc(*, skip: set[str] = frozenset()) -> dict:
    rows = []
    for cell in ("01-x", "02-x"):
        for arm, base in (("a", 0.9), ("b", 0.6), ("c", 0.5)):
            image_id = f"c001-bo-{arm}-{cell}"
            if image_id in skip:
                continue
            rows.append({
                "image_id": image_id,
                "identity_own": base,
                "age_delta": 1.0,
                "gloss": 0.2,
                "niqe": 4.0,
                "pass": base >= 0.7,
            })
    return {"schema": "figment/gate@1", "rows": rows}


def test_summarize_module_exists():
    assert SUMMARIZE_PATH.is_file()


def test_summarize_table_has_one_row_per_arm_with_medians():
    table = summarize.summarize(_fake_run_doc(), _fake_gate_doc())
    assert [row["arm"] for row in table] == ["a", "b", "c"]
    by_arm = {row["arm"]: row for row in table}
    assert by_arm["a"]["n"] == 2
    assert by_arm["a"]["scored"] == 2
    assert by_arm["a"]["identity_own_median"] == 0.9
    assert by_arm["a"]["pass_count"] == 2
    assert by_arm["b"]["pass_count"] == 0
    assert by_arm["b"]["identity_own_median"] == 0.6
    assert by_arm["c"]["pass_count"] == 0


def test_summarize_accepts_bare_list_gate_shape_not_just_rows_dict():
    gate_doc = _fake_gate_doc()["rows"]  # bare list, not {"rows": [...]}
    table = summarize.summarize(_fake_run_doc(), gate_doc)
    assert table[0]["n"] == 2


def test_summarize_tolerates_missing_gate_rows_without_crashing():
    gate_doc = _fake_gate_doc(skip={"c001-bo-a-01-x"})
    table = summarize.summarize(_fake_run_doc(), gate_doc)
    by_arm = {row["arm"]: row for row in table}
    assert by_arm["a"]["n"] == 2
    assert by_arm["a"]["scored"] == 1
    missing = summarize.missing_image_ids(_fake_run_doc(), gate_doc)
    assert missing == ["c001-bo-a-01-x"]


def test_summarize_median_ignores_non_numeric_or_missing_fields():
    gate_doc = _fake_gate_doc()
    gate_doc["rows"][0]["age_delta"] = None
    table = summarize.summarize(_fake_run_doc(), gate_doc)
    # arm a has 2 rows; one has age_delta=None, so the median is just the other value.
    by_arm = {row["arm"]: row for row in table}
    assert by_arm["a"]["age_delta_median"] == 1.0


def test_format_table_renders_arm_labels_and_header():
    table = summarize.summarize(_fake_run_doc(), _fake_gate_doc())
    rendered = summarize.format_table(table)
    assert "arm" in rendered and "pass" in rendered
    assert "a = " in rendered and "b = " in rendered and "c = " in rendered


def test_summarize_cli_prints_a_table_and_exits_zero(tmp_path):
    run_path = tmp_path / "run.json"
    gate_path = tmp_path / "gate.json"
    run_path.write_text(json.dumps(_fake_run_doc()), encoding="utf-8")
    gate_path.write_text(json.dumps(_fake_gate_doc()), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(SUMMARIZE_PATH), "--run", str(run_path), "--gate", str(gate_path)],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "identity_own" in result.stdout or "med_identity_own" in result.stdout


def test_summarize_cli_strict_fails_on_missing_gate_rows(tmp_path):
    run_path = tmp_path / "run.json"
    gate_path = tmp_path / "gate.json"
    run_path.write_text(json.dumps(_fake_run_doc()), encoding="utf-8")
    gate_path.write_text(json.dumps(_fake_gate_doc(skip={"c001-bo-c-02-x"})), encoding="utf-8")
    result = subprocess.run(
        [
            sys.executable, str(SUMMARIZE_PATH),
            "--run", str(run_path), "--gate", str(gate_path), "--strict",
        ],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "c001-bo-c-02-x" in result.stderr


def test_summarize_against_a_real_dry_run_json(tmp_path):
    """End-to-end: a real dry-run's run.json (18 jobs, arm/cell-named) summarizes
    cleanly against a gate.json shaped like `identity_gate.py`'s documented fields."""
    out_dir = tmp_path / "dry-run"
    result = subprocess.run(
        [
            sys.executable, str(POD_RUNNER), "run",
            "--manifest", str(MANIFEST_PATH),
            "--out", str(out_dir),
            "--dry-run",
        ],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    run_doc = load_json(out_dir / "run.json")
    gate_rows = [
        {
            "image_id": job["output_name"],
            "identity_own": 0.8, "age_delta": 1.5, "gloss": 0.3, "niqe": 4.2,
            "pass": True,
        }
        for job in run_doc["jobs"]
    ]
    table = summarize.summarize(run_doc, {"rows": gate_rows})
    assert sum(row["n"] for row in table) == 18
    assert all(row["scored"] == 6 for row in table)


# =============================================================================
# Path-B DIAGNOSTIC (Method D -- PuLID-Flux on FLUX.1-dev), research-only,
# non-commercial, measurement-only. See `pipeline/expand/bakeoff/m3diag_README.md`.
#
# Deliberately separate from everything above: new files only
# (`m3diag_manifest.yaml`, `m3diag_api.json`, `m3diag_pins.json`,
# `m3diag_README.md`), none of them named `m1.*`/`pins.yaml`/`README.md`, and this
# section touches no name defined above it in this module (own constants/fixtures,
# `M3DIAG_`-prefixed or locally scoped, reusing only the already-imported `pod`,
# `verify_pins`, `load_json`, `load_module`, and stdlib imports at file scope).
# =============================================================================

FIGMENT_TRAIN = PIPELINE / "figment_train.py"
figment_train = load_module("figment_bakeoff_test_figment_train", FIGMENT_TRAIN)

M3DIAG_MANIFEST_PATH = BAKEOFF / "m3diag_manifest.yaml"
M3DIAG_WORKFLOW_PATH = BAKEOFF / "m3diag_api.json"
M3DIAG_PINS_PATH = BAKEOFF / "m3diag_pins.json"
M3DIAG_README_PATH = BAKEOFF / "m3diag_README.md"

M3DIAG_OUTPUT_NAME_RE = re.compile(r"^c001-bo-(?P<arm>[DE])-(?P<cell>.+)$")
M3DIAG_ARMS = ("D", "E")
M3DIAG_ARM_WEIGHT = {"D": 1.0, "E": 0.7}


@pytest.fixture(scope="module")
def m3diag_manifest() -> dict:
    return load_json(M3DIAG_MANIFEST_PATH)


@pytest.fixture(scope="module")
def m3diag_workflow() -> dict:
    return load_json(M3DIAG_WORKFLOW_PATH)


@pytest.fixture(scope="module")
def m3diag_pins() -> dict:
    return load_json(M3DIAG_PINS_PATH)


def _m3diag_job_arm_cell(job: dict) -> tuple[str, str]:
    match = M3DIAG_OUTPUT_NAME_RE.match(job["output_name"])
    assert match, f"output_name does not match c001-bo-<D|E>-<cell>: {job['output_name']!r}"
    return match.group("arm"), match.group("cell")


def _m3diag_job_text_substitution(job: dict) -> dict:
    subs = [s for s in job["substitutions"] if s["node_id"] == "9" and s["field"] == "text"]
    assert len(subs) == 1, (job["output_name"], job["substitutions"])
    return subs[0]


def _m3diag_job_weight_substitution(job: dict) -> dict:
    subs = [s for s in job["substitutions"] if s["node_id"] == "8" and s["field"] == "weight"]
    assert len(subs) == 1, (job["output_name"], job["substitutions"])
    return subs[0]


# ---------------------------------------------------------------------------
# Files exist where the task brief says, named m3diag_*, and nothing else moved
# ---------------------------------------------------------------------------


def test_m3diag_files_exist():
    assert M3DIAG_MANIFEST_PATH.is_file()
    assert M3DIAG_WORKFLOW_PATH.is_file()
    assert M3DIAG_PINS_PATH.is_file()
    assert M3DIAG_README_PATH.is_file()
    for path in (M3DIAG_MANIFEST_PATH, M3DIAG_WORKFLOW_PATH, M3DIAG_PINS_PATH, M3DIAG_README_PATH):
        assert path.name.startswith("m3diag_"), path



def test_m3diag_manifest_declares_non_commercial_diagnostic(m3diag_manifest: dict):
    assert m3diag_manifest["diagnostic_non_commercial"] is True
    assert isinstance(m3diag_manifest.get("diagnostic_note"), str) and m3diag_manifest["diagnostic_note"]


def test_m3diag_readme_states_research_only_and_delete_after_scoring():
    text = M3DIAG_README_PATH.read_text(encoding="utf-8")
    lowered = text.lower()
    assert "research-only" in lowered or "research only" in lowered
    assert "never be published" in lowered or "must never be published" in lowered
    assert "delete" in lowered


# ---------------------------------------------------------------------------
# Manifest structure: 6 cells x 2 arms (D, E) = 12 jobs, one bootstrap
# ---------------------------------------------------------------------------


def test_m3diag_manifest_has_12_jobs(m3diag_manifest: dict):
    assert len(m3diag_manifest["jobs"]) == 12


def test_m3diag_six_cells_two_arms_each_with_shared_seed_per_cell(m3diag_manifest: dict):
    by_cell: dict[str, set] = {}
    seed_by_cell: dict[str, set] = {}
    arms_seen: set[str] = set()
    for job in m3diag_manifest["jobs"]:
        arm, cell = _m3diag_job_arm_cell(job)
        arms_seen.add(arm)
        by_cell.setdefault(cell, set()).add(arm)
        seed_by_cell.setdefault(cell, set()).add(job["seed"])
    assert arms_seen == set(M3DIAG_ARMS)
    assert len(by_cell) == 6, sorted(by_cell)
    assert all(arms == set(M3DIAG_ARMS) for arms in by_cell.values())
    assert all(len(seeds) == 1 for seeds in seed_by_cell.values()), seed_by_cell


def test_m3diag_arm_d_weight_1_0_arm_e_weight_0_7(m3diag_manifest: dict):
    for job in m3diag_manifest["jobs"]:
        arm, _cell = _m3diag_job_arm_cell(job)
        weight_sub = _m3diag_job_weight_substitution(job)
        assert weight_sub["value"] == pytest.approx(M3DIAG_ARM_WEIGHT[arm]), job["output_name"]


def test_m3diag_prompts_match_m1_arm_a_verbatim(m3diag_manifest: dict, manifest: dict):
    """The task brief: 'positive prompt = m1's per-cell prompt.' Copied programmatically
    when this diagnostic was built -- this test re-derives m1's arm-a prompt per cell from
    the live m1.yaml fixture and asserts byte-for-byte equality, so a future edit to
    either file cannot silently drift them apart."""
    m1_prompt_by_cell = {}
    for job in manifest["jobs"]:
        arm, cell = _job_arm_cell(job)
        if arm != "a":
            continue
        m1_prompt_by_cell[cell] = _job_prompt_substitution(job)["value"]
    assert len(m1_prompt_by_cell) == 6

    for job in m3diag_manifest["jobs"]:
        _arm, cell = _m3diag_job_arm_cell(job)
        text_sub = _m3diag_job_text_substitution(job)
        assert text_sub["value"] == m1_prompt_by_cell[cell], job["output_name"]


def test_m3diag_seeds_match_m1_per_cell(m3diag_manifest: dict, manifest: dict):
    m1_seed_by_cell = {}
    for job in manifest["jobs"]:
        arm, cell = _job_arm_cell(job)
        if arm != "a":
            continue
        m1_seed_by_cell[cell] = job["seed"]

    for job in m3diag_manifest["jobs"]:
        _arm, cell = _m3diag_job_arm_cell(job)
        assert job["seed"] == m1_seed_by_cell[cell], job["output_name"]


def test_m3diag_load_image_node_always_g01_only(m3diag_workflow: dict):
    """Method D takes a single face reference (unlike m1's 3-image multi-ref) -- no job
    substitutes node 7's image, and it is always g01."""
    assert m3diag_workflow["7"]["class_type"] == "LoadImage"
    assert m3diag_workflow["7"]["inputs"]["image"] == "creator-001/g01.jpg"


def test_m3diag_no_job_substitutes_the_reference_image(m3diag_manifest: dict):
    for job in m3diag_manifest["jobs"]:
        assert not any(s["node_id"] == "7" for s in job["substitutions"]), job["output_name"]


# ---------------------------------------------------------------------------
# Workflow graph: PuLID InsightFace path wired, FLUX guidance/cfg per the brief
# ---------------------------------------------------------------------------


def test_m3diag_workflow_uses_insightface_loader_not_facenet(m3diag_workflow: dict):
    class_types = {node["class_type"] for node in m3diag_workflow.values()}
    assert "PulidFluxInsightFaceLoader" in class_types
    assert "PulidFluxFaceNetLoader" not in class_types


def test_m3diag_flux_guidance_and_ksampler_settings(m3diag_workflow: dict):
    guidance_nodes = [n for n in m3diag_workflow.values() if n["class_type"] == "FluxGuidance"]
    assert len(guidance_nodes) == 1
    assert guidance_nodes[0]["inputs"]["guidance"] == pytest.approx(3.5)

    sampler_nodes = [n for n in m3diag_workflow.values() if n["class_type"] == "KSampler"]
    assert len(sampler_nodes) == 1
    sampler = sampler_nodes[0]["inputs"]
    assert sampler["steps"] == 20
    assert sampler["cfg"] == pytest.approx(1.0)
    assert sampler["sampler_name"] == "euler"

    latent_nodes = [n for n in m3diag_workflow.values() if n["class_type"] == "EmptySD3LatentImage"]
    assert len(latent_nodes) == 1
    assert latent_nodes[0]["inputs"]["width"] == 1024
    assert latent_nodes[0]["inputs"]["height"] == 1536


# ---------------------------------------------------------------------------
# Pins: format-valid, gated files explicitly null+flagged, matches manifest,
# and verified LIVE against Hugging Face (the non-gated 9; the 2 gated ones
# documented to fail verify_pins.py for the stated reason).
# ---------------------------------------------------------------------------


def test_m3diag_manifest_models_match_pins_json_exactly(m3diag_manifest: dict, m3diag_pins: dict):
    def key(m):
        return (m["repo_id"], m["filename"], m["revision"], m.get("sha256"))

    manifest_keys = sorted(key(m) for m in m3diag_manifest["models"])
    pins_keys = sorted(key(m) for m in m3diag_pins["pins"]["m3diag"]["models"])
    assert manifest_keys == pins_keys


def test_m3diag_every_model_pin_has_valid_revision_and_optional_sha256(m3diag_manifest: dict):
    for model in m3diag_manifest["models"]:
        revision = pod.model_revision(model)  # raises HarnessError on bad shape
        assert re.fullmatch(r"[0-9A-Fa-f]{40}", revision), model
        sha = pod.model_sha256(model)
        assert sha is None or re.fullmatch(r"[0-9a-f]{64}", sha), model


def test_m3diag_gated_flux_dev_pins_have_null_sha256_and_a_note(m3diag_manifest: dict):
    gated = [
        m for m in m3diag_manifest["models"]
        if m["repo_id"] == "black-forest-labs/FLUX.1-dev"
    ]
    assert {m["filename"] for m in gated} == {"flux1-dev.safetensors", "ae.safetensors"}
    for model in gated:
        assert model["sha256"] is None
        assert "gated" in model.get("note", "").lower()


def test_m3diag_custom_node_git_ref_is_40_hex(m3diag_manifest: dict):
    for node in m3diag_manifest["custom_nodes"]:
        ref = pod.custom_node_git_ref(node)  # raises HarnessError on bad shape
        assert ref == "7c7362b806c2c0f4bde8742ada9e7cb05b44d249"


def test_m3diag_gated_pins_fail_verify_pins_for_the_documented_reason(m3diag_pins: dict):
    problems = verify_pins.verify_pins(m3diag_pins, stages=["m3diag"])
    assert "m3diag" in problems
    joined = "\n".join(problems["m3diag"])
    assert "flux1-dev.safetensors" in joined and "missing a non-empty 'sha256'" in joined
    assert "ae.safetensors" in joined


def test_m3diag_nongated_pins_verify_live_clean(m3diag_pins: dict):
    """The 9 pins that do carry a sha256 (clip_l, t5xxl_fp8, pulid_flux_v0.9.1,
    EVA-CLIP .pt, and all 5 antelopev2 .onnx files) resolve live clean -- checked
    directly against verify_pins.verify_model_pin so a missing-sha256 gated pin
    elsewhere in the same stage can't hide a real regression in these 9."""
    models = m3diag_pins["pins"]["m3diag"]["models"]
    non_gated = [m for m in models if m.get("sha256")]
    assert len(non_gated) == 9
    problems: list[str] = []
    for model in non_gated:
        problems.extend(verify_pins.verify_model_pin(model))
    assert problems == [], problems


def test_m3diag_verify_pins_cli_reports_the_two_gated_stops():
    result = subprocess.run(
        [sys.executable, str(VERIFY_PINS), "--pins", str(M3DIAG_PINS_PATH), "--stage", "m3diag"],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert result.returncode == 1, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert "flux1-dev.safetensors" in combined
    assert "ae.safetensors" in combined
    assert "missing a non-empty 'sha256'" in combined


# ---------------------------------------------------------------------------
# diagnostic_assets: every flagged file is real, present, and has a reason
# ---------------------------------------------------------------------------


def test_m3diag_diagnostic_assets_block_names_real_flagged_files(m3diag_manifest: dict):
    model_filenames = {m["filename"] for m in m3diag_manifest["models"]}
    assets = m3diag_manifest["diagnostic_assets"]
    assert len(assets) >= 1
    seen = set()
    for entry in assets:
        assert entry["filename"] in model_filenames, entry
        assert isinstance(entry.get("reason"), str) and entry["reason"].strip(), entry
        seen.add(entry["filename"])
    # The pickle .pt and all 5 non-commercial .onnx files must be flagged.
    assert "EVA02_CLIP_L_336_psz14_s6B.pt" in seen
    for onnx_name in (
        "1k3d68.onnx", "2d106det.onnx", "genderage.onnx", "glintr100.onnx", "scrfd_10g_bnkps.onnx",
    ):
        assert onnx_name in seen


# ---------------------------------------------------------------------------
# Cost ceiling / timeouts, computed with the harness's own helpers (imported,
# never reimplemented by hand)
# ---------------------------------------------------------------------------


def test_m3diag_readiness_within_2700(m3diag_manifest: dict):
    assert m3diag_manifest["readiness_timeout_seconds"] <= 2700


def test_m3diag_job_timeout_is_600(m3diag_manifest: dict):
    assert m3diag_manifest["job_timeout_seconds"] == 600


def test_m3diag_max_minutes_equals_the_harness_computed_minimum(m3diag_manifest: dict):
    minimum = pod.minimum_runtime_minutes(m3diag_manifest)
    assert m3diag_manifest["max_minutes"] == minimum
    assert minimum == 170.0


def test_m3diag_manifest_ceiling_is_3_69(m3diag_manifest: dict):
    assert figment_train.manifest_ceiling(m3diag_manifest) == "3.69"


def test_m3diag_manifest_dry_runs_clean(tmp_path):
    """The direct, empirical answer to whether the harness rejects .pt/.pth/.onnx model
    files outright: it does not -- this manifest carries one .pt and five .onnx model
    entries and must still dry-run to a clean exit with all 12 jobs verified."""
    result = subprocess.run(
        [
            sys.executable, str(POD_RUNNER), "run",
            "--manifest", str(M3DIAG_MANIFEST_PATH),
            "--out", str(tmp_path / "m3diag-dry-run"),
            "--dry-run",
        ],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert "preflight cost estimate: $3.68" in combined, combined
    run_doc = load_json(tmp_path / "m3diag-dry-run" / "run.json")
    assert len(run_doc["jobs"]) == 12
    assert all(len(job["files"]) >= 1 for job in run_doc["jobs"])
