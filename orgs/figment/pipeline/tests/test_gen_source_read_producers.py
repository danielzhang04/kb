"""Real-producer -> gen_source_read.py adapter integration test (Windows/CPython only).

Synthetic-evidence scope, read before extending
------------------------------------------------
* This module drives the REAL production functions
  (`figment_train.build_plan`, `build_grade`, `apply_rulings`) over a finite,
  explicitly copied slice of the repo tree, plus a purely synthetic persona
  authored independently in this file (not a call into any other fixture
  module, and never a copy of the live `personas/creator-001/persona.yaml`).
* Every checkpoint byte, training-receipt JSON, and operator ruling used below
  is SYNTHETIC FIXTURE DATA. The "tester images" written to disk ARE real
  image files on disk (tiny real PNG containers holding synthetic blank
  pixels) -- no real pod, no real ComfyUI/ai-toolkit run, no real vision
  judge, no network call, and no real creator media ever exists in this test.
* The gate always reports every cell FAILED CLOSED (`skip_judge=True`, no
  scorer library reachable -- torch/transformers/facenet_pytorch are forced
  absent for the producer calls only, via a private, self-restoring
  monkeypatch context owned by this module). The one "kept" tester cell rides
  on an explicit, attributed `gate_override` string that says exactly that.
* `gen_source_read.py` itself is exercised only as a real, unmocked, isolated
  child process (`sys.executable -I -B`) with its exact six flags. Nothing in
  this file monkeypatches the adapter, `observe_gen_source`, `main`, ROOT, or
  any domain validator.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

if os.name != "nt":
    pytest.skip("observed reads support CPython on Windows only", allow_module_level=True)

HERE = Path(__file__).resolve()
PIPELINE = HERE.parents[1]
ROOT = HERE.parents[4]
CREATOR = "creator-001"

# ---------------------------------------------------------------------------
# Explicit finite copy list -- never rglob, never the whole pipeline/personas.
# Defined exactly once; every entry MUST exist at copy time (no silent skip).
# ---------------------------------------------------------------------------
PIPELINE_FILES = (
    "figment_train.py", "observed_reads.py", "training_config.py", "persona.py",
    "lineage.py", "gen_source_read.py", "gates.py", "qa_stamp.py", "score_cells.py",
    "identity_gate.py", "gate.yaml", "vlm_judge.py",
)
PIPELINE_DIRS = (
    ("pod", ("runpod_run.py", "recovery.py")),
    ("train", ("render_aitoolkit_config.py", "tensor-pins.yaml",
               "ai-toolkit-krea2.yaml.template", "identity_check.py")),
    ("train/runs", ("start-training-aitoolkit.sh.template",
                     "start-comfy-lorapath.sh.template")),
    ("expand/templates", ("tensor-dataset-prompts.yaml", "anchor-prompts.yaml",
                           "gen-prompts.yaml")),
    ("expand/workflows", ("tensor_dataset_v2_api.json", "tensor_dataset_fullbody_api.json",
                           "zimage_passport_api.json")),
    ("train/workflows", ("krea2_gen_api.json", "krea2_detail_only_api.json")),
)

PROJECT_ALIAS_PREFIXES = ("_figment", "_score_cells", "gspr_")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value, *, indent: int = 2) -> None:
    path.write_text(json.dumps(value, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")


@pytest.fixture
def restore_module_aliases():
    """Snapshot only known project aliases before the test, restore the exact
    prior objects (or absence) afterward. Never touches third-party/stdlib
    modules or unrelated pytest-imported modules (e.g. numpy)."""
    def _project_aliases():
        return {
            name: mod for name, mod in sys.modules.items()
            if any(name.startswith(prefix) for prefix in PROJECT_ALIAS_PREFIXES)
        }

    before = dict(_project_aliases())
    for name in before:
        del sys.modules[name]
    yield
    after = _project_aliases()
    for name in after:
        if name not in before:
            del sys.modules[name]
    for name, mod in before.items():
        sys.modules[name] = mod


def _copy_pipeline_slice(dest_pipeline: Path) -> dict:
    """Copy the explicit finite slice; every entry must exist. Returns a
    {relative_posix_path: sha256} snapshot of every copied file."""
    dest_pipeline.mkdir(parents=True, exist_ok=True)
    snapshot: dict[str, str] = {}
    for name in PIPELINE_FILES:
        source = PIPELINE / name
        assert source.is_file(), f"required pipeline file missing: {source}"
        dest = dest_pipeline / name
        shutil.copy2(source, dest)
        snapshot[name] = file_sha256(dest)
    for rel, names in PIPELINE_DIRS:
        (dest_pipeline / rel).mkdir(parents=True, exist_ok=True)
        for name in names:
            source = PIPELINE / rel / name
            assert source.is_file(), f"required pipeline dir file missing: {source}"
            dest = dest_pipeline / rel / name
            shutil.copy2(source, dest)
            snapshot[f"{rel}/{name}"] = file_sha256(dest)
    return snapshot


def _snapshot_pipeline_slice(dest_pipeline: Path) -> dict:
    """Re-hash the exact same finite list of files already copied, without
    any extension enumeration or whole-tree walk."""
    snapshot: dict[str, str] = {}
    for name in PIPELINE_FILES:
        snapshot[name] = file_sha256(dest_pipeline / name)
    for rel, names in PIPELINE_DIRS:
        for name in names:
            snapshot[f"{rel}/{name}"] = file_sha256(dest_pipeline / rel / name)
    look_spec = dest_pipeline / "look-spec.md"
    if look_spec.is_file():
        snapshot["look-spec.md"] = file_sha256(look_spec)
    return snapshot


def _synthetic_look() -> dict:
    """Fully clothed, adult-only synthetic wording -- distinct from any live persona."""
    return {
        "age_stage": (
            "an adult woman in her late twenties with an adult woman's proportions, "
            "an adult jawline, and hands and neck matching her face's age"
        ),
        "hair": "short dark hair tucked behind one ear",
        "eyes": "deep brown eyes",
        "skin": "olive skin with visible pores and natural texture",
        "brows": "her own straight dark brows, unaltered",
        "makeup": "bare face with a touch of lip balm",
        "build": "average adult build",
        "clothing": "wearing a fully opaque loose grey cotton sweater and dark trousers",
    }


def _make_synthetic_persona(personas_root: Path) -> Path:
    """Build a purely synthetic creator-001 persona, authored independently in
    this module (not by calling any other fixture's builder). Uses tiny real
    PNG reference files (synthetic blank pixels), valid exemplar stems, our
    own look wording, and a non-empty `identity.history` so
    `build_plan(stage="all")` never plans "anchor"."""
    home = personas_root / CREATOR
    anchors = home / "anchors"
    anchors.mkdir(parents=True)
    ref_names = ("s01.png", "s02.png", "s03.png")
    for name in ref_names:
        Image.new("RGB", (8, 8), color=(90, 70, 50)).save(anchors / name)

    identity_spec = home / "identity-spec.md"
    register_spec = personas_root.parent / "pipeline" / "look-spec.md"
    identity_spec.write_bytes(b"synthetic identity spec fixture\n")
    register_spec.write_bytes(b"synthetic register spec fixture\n")

    floor = {"status": "uncalibrated", "value": None, "calibration_set_sha": None, "locked_by_gate": None}
    data = {
        "id": CREATOR,
        "disclosure": {"is_ai_generated": True},
        "identity": {
            "references": [f"anchors/{name}" for name in ref_names],
            "history": ["anchors/old-synthetic-anchor.png"],
            "spec": {"path": "identity-spec.md", "sha256": file_sha256(identity_spec)},
            "floor": {"anchor_cosine_p5": dict(floor), "min_face_px": dict(floor)},
            "look": _synthetic_look(),
        },
        "body_target": {"source": "synthetic", "exemplars": ["s02", "s03"]},
        "grammar": {
            "angles": ["front"], "distances": ["half"], "lights": ["flat-white"],
            "wardrobe_families": ["cotton"], "traversal_order": ["angle", "distance", "light"],
            "allocation": {
                "strata": 1, "replicates": 1, "replicate_scope": "half-body-strata-only",
                "replicate_policy": "alt-wardrobe-new-seed", "seed_policy": "fixed-per-cell",
            },
        },
        "register": {
            "spec": {"path": "../../pipeline/look-spec.md", "sha256": file_sha256(register_spec), "section": "synthetic"},
            "settings": {"makeup": "none", "skin": "olive", "light": ["flat-white"],
                         "wardrobe_families": ["cotton"]},
        },
        "lora": {"base": "krea2", "tier": "synthetic"},
        "voice": {},
        "accounts": [],
        "tiers": {"instagram": {}, "explicit": {}},
        "training": {
            "trigger": None, "base_arch": "krea2", "steps": 2000, "save_every": 250,
            "caption_mode": "provided", "pod_class": "l40s",
            "price_ceiling_usd_per_hour": 1.30,
        },
    }
    path = home / "persona.yaml"
    write_json(path, data)
    return path


class _OfflineGuard:
    """Forces the real scorer/judge dependencies absent and refuses any network
    connection or subprocess-spawn attempt for the duration of a producer call,
    using its own private `pytest.MonkeyPatch` context -- never the caller's
    fixture-scoped monkeypatch. Guaranteed restore on any exception."""

    def __init__(self):
        self._mp = None
        self.attempts: list[str] = []
        self._original_popen = subprocess.Popen

    def __enter__(self):
        self._mp = pytest.MonkeyPatch()
        mp = self._mp
        for name in ("torch", "transformers", "facenet_pytorch"):
            mp.setitem(sys.modules, name, None)

        def refuse_connect(*args, **kwargs):
            self.attempts.append("socket.connect")
            raise AssertionError("network connection attempted during producer call")

        def refuse_connect_ex(*args, **kwargs):
            self.attempts.append("socket.connect_ex")
            raise AssertionError("network connection attempted during producer call")

        def refuse_create_connection(*args, **kwargs):
            self.attempts.append("socket.create_connection")
            raise AssertionError("network connection attempted during producer call")

        def refuse_getaddrinfo(*args, **kwargs):
            self.attempts.append("socket.getaddrinfo")
            raise AssertionError("network connection attempted during producer call")

        def refuse_popen(*args, **kwargs):
            self.attempts.append("subprocess.Popen")
            raise AssertionError("subprocess spawn attempted during producer call")

        mp.setattr(socket.socket, "connect", refuse_connect)
        mp.setattr(socket.socket, "connect_ex", refuse_connect_ex)
        mp.setattr(socket, "create_connection", refuse_create_connection)
        mp.setattr(socket, "getaddrinfo", refuse_getaddrinfo)
        mp.setattr(subprocess, "Popen", refuse_popen)
        return self

    def __exit__(self, *exc_info):
        if self._mp is not None:
            self._mp.undo()
            self._mp = None
        assert subprocess.Popen is self._original_popen, (
            "subprocess.Popen must be restored to its original object before "
            "any real CLI child-process is spawned"
        )
        return False


def _fake_stage_outputs(out: Path, plan: dict, stage: str) -> None:
    for run in plan["stages"][stage]["runs"]:
        manifest = json.loads((out / run["manifest"]).read_text(encoding="utf-8"))
        run_out = out / run["out"]
        run_out.mkdir(parents=True, exist_ok=True)
        for job in manifest["jobs"]:
            Image.new("RGB", (8, 8)).save(run_out / f"{job['output_name']}.png")


def _axes(gate_override: str | None = None) -> dict:
    row = {
        "identity": "pass", "realism": "pass", "hands": "pass", "lighting": "pass",
        "adult_read": "pass", "garment_integrity": "pass", "real_person_resemblance": "clear",
    }
    if gate_override is not None:
        row["gate_override"] = gate_override
    return row


class Chain:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _run_real_producer_chain(command, personas: Path, source_root: Path, source_ledger: Path):
    """The proven `build_plan(all)` -> synthetic train/tester receipts ->
    `build_grade(tester, skip_judge=True)` -> `apply_rulings(checkpoint_step=1500)`
    sequence, adapted for a non-hardcoded creator id and a derived (not
    guessed) checkpoint filename."""
    plan = command.build_plan(
        CREATOR, "all", source_root, personas_root=personas,
        skip_pin_verify=True, ledger_dir=source_ledger,
    )
    assert "anchor" not in plan["stages"], "non-empty identity.history must exclude the anchor stage"

    train_run = plan["stages"]["train"]["runs"][0]
    train_manifest = json.loads((source_root / train_run["manifest"]).read_text(encoding="utf-8"))
    trigger = plan["training"]["trigger"]
    assert trigger, "plan must carry a resolved training trigger"
    step = 1500
    intermediate_name = f"{trigger}_{step:09d}.safetensors"
    final_name = f"{trigger}.safetensors"

    intermediate_matches = [a for a in train_manifest["artifacts"] if a["local"] == intermediate_name]
    assert len(intermediate_matches) == 1, "exactly one step-1500 intermediate artifact must exist"
    final_matches = [a for a in train_manifest["artifacts"] if a["local"] == final_name]
    assert len(final_matches) == 1, "exactly one final unsuffixed artifact must exist"
    assert len(train_manifest["artifacts"]) == 8, "fixture expects exactly 8 total train artifacts"
    assert not final_name.endswith(f"_{step:09d}.safetensors"), "final checkpoint name must remain unsuffixed"
    assert intermediate_name.endswith(f"_{step:09d}.safetensors"), "staged checkpoint must be step-suffixed"

    filename = intermediate_matches[0]["local"]

    train_out = source_root / train_run["out"]
    train_out.mkdir(parents=True, exist_ok=True)
    receipt_artifacts = []
    for index, item in enumerate(train_manifest["artifacts"]):
        artifact_path = train_out / item["local"]
        artifact_path.write_bytes(f"synthetic fixture checkpoint bytes {index:02d}".encode("utf-8"))
        receipt_artifacts.append({"remote": item["remote"], "bytes": artifact_path.stat().st_size})
    write_json(train_out / "run.json", {
        "error": None, "dry_run": False, "termination_verified": True,
        "artifacts": receipt_artifacts,
    })

    tester_run = plan["stages"]["tester"]["runs"][0]
    tester_manifest = json.loads((source_root / tester_run["manifest"]).read_text(encoding="utf-8"))
    candidate_job = next(
        job for job in tester_manifest["jobs"]
        if any(item.get("field") == "lora_name" and item.get("value") == filename
               for item in job.get("substitutions", []))
    )
    _fake_stage_outputs(source_root, plan, "tester")
    tester_out = source_root / tester_run["out"]
    write_json(tester_out / "run.json", {
        "error": None, "dry_run": False, "termination_verified": True,
        "jobs": [{
            "output_name": job["output_name"],
            "files": [{"bytes": 10} for _ in range(job.get("expected_images", 1))],
        } for job in tester_manifest["jobs"]],
    })

    checkpoint_inputs = command._tester_checkpoint_inputs(plan, source_root, tester_run)
    write_json(source_root / "stage.json", {
        "schema": "figment/train-stage@1",
        "creator": CREATOR,
        "plan_sha256": command._sha256(source_root / "plan.json"),
        "status": "complete:tester",
        "runs": {
            train_run["manifest"]: {"status": "complete"},
            tester_run["manifest"]: {"status": "complete", "checkpoint_inputs": checkpoint_inputs},
        },
        "completed_stages": ["train", "tester"],
    })

    grade = command.build_grade(CREATOR, "tester", source_root / "plan.json", skip_judge=True)
    gate_document = json.loads(Path(grade["gate"]).read_text(encoding="utf-8"))
    assert gate_document["judge_skipped"] is True
    assert len(gate_document["rows"]) == len(tester_manifest["jobs"]), (
        "gate row count must match the actual number of tester jobs"
    )
    assert gate_document["rows"], "gate rows must be non-empty"
    assert all(row["pass"] is False for row in gate_document["rows"]), (
        "the fail-closed gate must reject every synthetic cell -- this proves the "
        "outage/no-real-face path, never a numeric quality claim"
    )

    override = "synthetic fixture: no real face in this 8x8 synthetic image; forced offline scorer outage"
    template = json.loads(Path(grade["rulings_template"]).read_text(encoding="utf-8"))
    for job in template["rulings"]:
        keep = job["image_id"] == candidate_job["output_name"]
        job.update(_axes(override if keep else None), decision="keep" if keep else "cull")
    template.update({"decided_by": "operator-fixture-synthetic",
                      "decided_at": "2026-09-13T00:00:00Z"})
    rulings_path = source_root / "tester-rulings.json"
    write_json(rulings_path, template)

    command.apply_rulings(
        CREATOR, "tester", source_root / "plan.json", rulings_path, checkpoint_step=step,
    )
    accepted_path = source_root / "grade" / "tester" / "accepted-checkpoint.json"
    assert accepted_path.is_file()
    approval_lineage_path = source_root / "grade" / "tester" / "approval-lineage.json"
    accepted = json.loads(accepted_path.read_text(encoding="utf-8"))
    checkpoint_path = Path(accepted["checkpoint"]["path"])
    assert checkpoint_path.is_absolute(), "accepted checkpoint path must be absolute"
    assert checkpoint_path.name == filename

    return Chain(
        plan=plan, source_root=source_root, accepted_path=accepted_path,
        approval_lineage_path=approval_lineage_path, checkpoint_path=checkpoint_path,
        source_plan_path=source_root / "plan.json",
    )


def _build_gen_plan(command, personas: Path, gen_root: Path, gen_ledger: Path):
    plan = command.build_plan(
        CREATOR, "gen", gen_root, personas_root=personas,
        skip_pin_verify=True, ledger_dir=gen_ledger,
    )
    gen_run = plan["stages"]["gen"]["runs"][0]
    return plan, gen_root / "plan.json", gen_root / gen_run["manifest"]


def _build_fixture(tmp_path):
    """One finite copied natural repo tree, one real producer chain, one real gen plan.

    Layout (kept extremely short -- Windows path-limit friendly):
      tmp_path/r/orgs/figment/pipeline   -- explicit copied pipeline slice
      tmp_path/r/orgs/figment/personas   -- synthetic creator-001 persona
      tmp_path/r/orgs/figment/s          -- source-lineage (train+tester) plan
      tmp_path/r/orgs/figment/_private/figment-studio/gen-plans/g -- gen plan
      tmp_path/l                         -- explicit local ledger dirs
    """
    root = tmp_path / "r"
    figment = root / "orgs" / "figment"
    pipeline = figment / "pipeline"
    personas = figment / "personas"
    source_root = figment / "s"
    gen_root = figment / "_private" / "figment-studio" / "gen-plans" / "g"
    gen_root.parent.mkdir(parents=True, exist_ok=True)
    source_ledger = tmp_path / "l" / "src"
    gen_ledger = tmp_path / "l" / "gen"
    source_ledger.mkdir(parents=True)
    gen_ledger.mkdir(parents=True)

    pins_before = _copy_pipeline_slice(pipeline)
    personas.mkdir(parents=True)
    persona_path = _make_synthetic_persona(personas)
    pins_before["look-spec.md"] = file_sha256(pipeline / "look-spec.md")

    command = load_module("gspr_figment_train", pipeline / "figment_train.py")

    with _OfflineGuard() as guard:
        chain = _run_real_producer_chain(command, personas, source_root, source_ledger)
        gen_plan, gen_plan_path, gen_manifest_path = _build_gen_plan(
            command, personas, gen_root, gen_ledger,
        )
    assert guard.attempts == [], f"producer chain attempted forbidden I/O: {guard.attempts}"

    # The real source-lineage final checkpoint artifact is unsuffixed
    # (e.g. "<trigger>.safetensors"), while the gen-stage's chosen staged
    # checkpoint copy is step-suffixed (e.g. "<trigger>_000001500.safetensors").
    staged_checkpoint = (
        gen_root / "train" / "runs" / "accepted-checkpoint"
        / f"{gen_plan['training']['trigger']}_000001500.safetensors"
    )
    assert staged_checkpoint.is_file(), "gen-stage staged checkpoint copy must exist"
    assert file_sha256(staged_checkpoint) == file_sha256(chain.checkpoint_path), (
        "gen-stage staged checkpoint bytes must match the accepted source checkpoint"
    )

    pins_after = _snapshot_pipeline_slice(pipeline)
    assert pins_before == pins_after, "producer calls must never mutate the copied pipeline slice"

    pipeline_pins = {
        name: file_sha256(pipeline / name)
        for name in ("observed_reads.py", "figment_train.py", "training_config.py",
                     "persona.py", "lineage.py")
    }
    return Chain(
        root=root, pipeline=pipeline, persona_path=persona_path,
        chain=chain, gen_root=gen_root, gen_plan_path=gen_plan_path,
        gen_manifest_path=gen_manifest_path, pins=pipeline_pins,
        gen_plan=gen_plan, source_root=source_root,
        source_pins_before=pins_before, source_pins_after=pins_after,
    )


def _adapter_path(fx) -> Path:
    return fx.pipeline / "gen_source_read.py"


def run_cli(fx, **override):
    args = {
        "--creator": CREATOR,
        "--selected-root": str(fx.gen_root),
        "--selected-plan-sha256": file_sha256(fx.gen_plan_path),
        "--source-root": str(fx.source_root),
        "--source-plan-sha256": file_sha256(fx.chain.source_plan_path),
        "--dependency-sha256": json.dumps(fx.pins),
        **override,
    }
    argv = [sys.executable, "-I", "-B", str(_adapter_path(fx))]
    for flag, value in args.items():
        argv += [flag, value]
    pins_before = _snapshot_pipeline_slice(fx.pipeline)
    assert pins_before == fx.source_pins_before, "pipeline slice pins must match fixture creation baseline"
    done = subprocess.run(
        argv, capture_output=True, timeout=90, cwd=str(fx.root), stdin=subprocess.DEVNULL,
    )
    pins_after = _snapshot_pipeline_slice(fx.pipeline)
    assert pins_after == fx.source_pins_before, "the CLI must never mutate the copied pipeline slice"
    return done.returncode, done.stdout, done.stderr


SCHEMA = "figment/gen-source-read@1"
UNAVAILABLE = b'{"result":"unavailable","schema":"figment/gen-source-read@1"}\n'


def _digest_snapshot(fx) -> dict:
    return {
        "gen_plan": file_sha256(fx.gen_plan_path),
        "gen_manifest": file_sha256(fx.gen_manifest_path),
        "source_plan": file_sha256(fx.chain.source_plan_path),
        "accepted": file_sha256(fx.chain.accepted_path),
        "approval_lineage": file_sha256(fx.chain.approval_lineage_path),
        "checkpoint": file_sha256(fx.chain.checkpoint_path),
        "persona": file_sha256(fx.persona_path),
    }


def assert_success(fx):
    code, out, err = run_cli(fx)
    assert (code, err) == (0, b""), out
    assert len(out) <= 4096
    assert out.endswith(b"\n") and out.count(b"\n") == 1 and b"\r" not in out
    assert json.loads(out.decode("ascii")) == {
        "schema": SCHEMA,
        "result": "current-source-observed",
        "creator": CREATOR,
        "selected_plan_sha256": file_sha256(fx.gen_plan_path),
        "persona_sha256": file_sha256(fx.persona_path),
        "approval_sha256": file_sha256(fx.chain.accepted_path),
        "approval_lineage_sha256": file_sha256(fx.chain.approval_lineage_path),
        "source_plan_sha256": file_sha256(fx.chain.source_plan_path),
        "checkpoint_sha256": file_sha256(fx.chain.checkpoint_path),
        "gen_manifest_sha256": [file_sha256(fx.gen_manifest_path)],
        "gen_runs": 1,
        "claims": {"launch_ready": False, "quality_approved": False, "atomic_snapshot": False},
    }


def assert_unavailable(result):
    code, out, err = result
    assert (code, out, err) == (1, UNAVAILABLE, b"")


def flip_first_byte(path: Path) -> None:
    data = bytearray(path.read_bytes())
    data[0] ^= 0x01
    path.write_bytes(bytes(data))


def test_real_producer_chain_then_isolated_cli_success(tmp_path_factory, restore_module_aliases):
    fx = _build_fixture(tmp_path_factory.mktemp("p"))
    before = _digest_snapshot(fx)
    assert_success(fx)
    after = _digest_snapshot(fx)
    assert before == after, "the adapter must never mutate any observed source file"


def test_real_producer_chain_then_stale_source_checkpoint_refuses(tmp_path_factory, restore_module_aliases):
    fx = _build_fixture(tmp_path_factory.mktemp("p"))
    assert_success(fx)
    before = _digest_snapshot(fx)
    flip_first_byte(fx.chain.checkpoint_path)
    assert_unavailable(run_cli(fx))
    after_bad = _digest_snapshot(fx)
    assert after_bad["checkpoint"] != before["checkpoint"]
    # restore and re-prove success, isolating that the checkpoint mutation alone
    # caused the prior refusal
    flip_first_byte(fx.chain.checkpoint_path)
    assert _digest_snapshot(fx)["checkpoint"] == before["checkpoint"]
    assert_success(fx)


def test_real_producer_chain_then_persona_drift_refuses(tmp_path_factory, restore_module_aliases):
    fx = _build_fixture(tmp_path_factory.mktemp("p"))
    assert_success(fx)
    original_bytes = fx.persona_path.read_bytes()
    persona = json.loads(fx.persona_path.read_text(encoding="utf-8"))
    persona["training"]["style_lora_strength"] = 0.42
    write_json(fx.persona_path, persona)
    assert fx.persona_path.read_bytes() != original_bytes
    assert_unavailable(run_cli(fx))
    fx.persona_path.write_bytes(original_bytes)
    assert fx.persona_path.read_bytes() == original_bytes
    assert_success(fx)
