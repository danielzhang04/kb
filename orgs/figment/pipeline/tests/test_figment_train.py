"""Contract tests for the persona-driven Track-1 command (brief T1-G)."""
from __future__ import annotations

import base64
import csv
import hashlib
import importlib.util
import json
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from PIL import Image


ROOT = Path(__file__).resolve().parents[4]
PIPELINE = ROOT / "orgs" / "figment" / "pipeline"
PERSONAS = ROOT / "orgs" / "figment" / "personas"
MODULE_PATH = PIPELINE / "figment_train.py"
POD_RUNNER = PIPELINE / "pod" / "runpod_run.py"

def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def command():
    return load_module("figment_train_test_module", MODULE_PATH)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def plan_path(out: Path, run: dict) -> Path:
    return out / run["manifest"]


def canonical_json(path: Path) -> bytes:
    """Compare bytes after the documented canonical-format-only delta."""
    return json.dumps(
        load_json(path), ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    ).encode()


def test_creator001_every_planned_stage_dry_runs_clean_and_pins_verify(
    command, tmp_path, monkeypatch,
):
    """Task E1: the hand-written manifests this test used to byte-compare `build_plan`'s
    output against are retired -- figment_train.py is the only producer now. In their
    place, this proves creator-001's REAL, checked-in persona.yaml/training.yaml plans
    every reachable stage clean end to end: each manifest dry-runs green through the pod
    harness, the plan's own bookkeeping (sha256/ceiling_usd/argv) is internally
    consistent, and `verify_pins` (the exact preflight `plan` runs live, normally
    skipped in tests via `skip_pin_verify`) accepts every pin against a monkeypatched
    `head_etag` -- proving the preflight wiring is sound without a live network call.
    """
    verify_pins_module = command._verify_pins_module()
    pins = command._read_json(command.PINS_PATH)
    known_by_url = {}
    for entry in pins["pins"].values():
        for model in verify_pins_module._stage_models(entry):
            known_by_url[verify_pins_module._pin_url(model)] = model

    def _fake_head_etag(url, *, timeout=30.0):
        model = known_by_url[url]
        return 200, {"x-repo-commit": model["revision"], "x-linked-etag": model["sha256"]}

    monkeypatch.setattr(verify_pins_module, "head_etag", _fake_head_etag)

    out = tmp_path / "creator001-plan"
    # skip_pin_verify defaults to False: this run genuinely exercises the preflight.
    # M2: this is a manifest/pin content check, not a budget check -- creator-001's
    # real training.yaml sums well past the live shared ledger's remaining arc cap, so
    # accept_budget is required the same way an operator would pass --accept-budget.
    plan = command.build_plan("creator-001", "all", out, personas_root=PERSONAS, accept_budget=True)

    for stage, stage_data in plan["stages"].items():
        for index, run in enumerate(stage_data["runs"]):
            generated = plan_path(out, run)
            assert run["sha256"] == hashlib.sha256(generated.read_bytes()).hexdigest()
            assert run["ceiling_usd"] == command.manifest_ceiling(load_json(generated))
            assert "--max-usd" in run["argv"]
            assert run["cli"] == subprocess.list2cmdline(run["argv"])
            result = subprocess.run(
                [
                    sys.executable, str(POD_RUNNER), "run",
                    "--manifest", str(generated),
                    "--out", str(tmp_path / "dry-runs" / stage / str(index)),
                    "--dry-run",
                ],
                cwd=ROOT, text=True, capture_output=True,
            )
            assert result.returncode == 0, result.stdout + result.stderr

    # Since 09faa490 the copied dataset workflow is persona-GENERALIZED, not a byte
    # copy of the static template -- `_generalized_dataset_workflow` composes nodes
    # 800 (face identity) and 780 (body identity) from the persona's own
    # `identity.look` (`_compose_look_clause` joins all eight look fields into one
    # clause, used unchanged for both face and body). Byte equality is wrong by
    # design now; instead prove the copy is (a) structurally the same graph as the
    # static template, (b) unchanged on every field the composer isn't supposed to
    # touch, and (c) actually carries creator-001's own words with no cross-persona
    # leak -- while (d) confirming the two other prompt nodes on this same workflow
    # (174/676, substituted per-job by `_dataset_jobs`/`_anchor_manifests`, never by
    # `_generalized_dataset_workflow`) stay genuine structural placeholders, in both
    # the static template and the generated copy, carrying no persona look words at
    # all.
    generated_workflow = load_json(out / "expand" / "workflows" / "tensor_dataset_v2_api.json")
    static_workflow = load_json(PIPELINE / "expand" / "workflows" / "tensor_dataset_v2_api.json")

    # (a) same node ids and class_types as the static template.
    assert set(generated_workflow) == set(static_workflow)
    for node_id, node in static_workflow.items():
        assert generated_workflow[node_id]["class_type"] == node["class_type"], node_id

    # (b) every non-persona input identical to the static template. The only fields
    # `_generalized_dataset_workflow` is allowed to overwrite: the two reference-image
    # uploads (836/837), the composed identity text (800/780), and the output
    # filename_prefix (832).
    persona_varying = {
        ("836", "image"), ("837", "image"),
        ("800", "text"), ("780", "text"),
        ("832", "filename_prefix"),
    }
    for node_id, node in static_workflow.items():
        generated_inputs = generated_workflow[node_id]["inputs"]
        assert set(generated_inputs) == set(node["inputs"]), node_id
        for field, value in node["inputs"].items():
            if (node_id, field) in persona_varying:
                continue
            assert generated_inputs[field] == value, (node_id, field)

    # (c) the two identity nodes the composer actually populates (800 face, 780 body)
    # carry creator-001's own look words and never creator-002's -- proving
    # `identity.look` drove the substitution and nothing cross-persona leaked in.
    creator001_words = ("jet-black", "dark brown eyes")
    creator002_words = ("chestnut-brown", "hazel")
    for node_id in ("800", "780"):
        text = generated_workflow[node_id]["inputs"]["text"]
        for word in creator001_words:
            assert word in text, (node_id, word)
        for word in creator002_words:
            assert word not in text, (node_id, word)

    # (d) the two prompt nodes that stay per-job placeholders (174 face-angle, 676
    # body-pose) are structural only -- no persona look words at all, in either the
    # static template or the generated copy. The two identity nodes (800/780) are ALSO
    # only a structural placeholder on the STATIC templates now (persona rule: no
    # creator-001 look words in shared code/templates) -- `_generalized_dataset_workflow`
    # is the sole producer of the real text, already proven to reach the generated copy by
    # (c) above. The fullbody template carries its own full copy of nodes 800/780
    # (`_fullbody_dataset_workflow` grafts the repair tail onto an ALREADY-generalized
    # dataset workflow dict, never a second independent substitution) plus node 952's
    # fixed face-repair instruction -- none of the three may ever bake a persona look word.
    fullbody_static_workflow = load_json(
        PIPELINE / "expand" / "workflows" / "tensor_dataset_fullbody_api.json")
    for node_id in ("174", "676"):
        for source in (static_workflow, generated_workflow):
            text = source[node_id]["inputs"]["prompt"]
            for word in creator001_words + creator002_words:
                assert word not in text, (node_id, word)
    for node_id in ("800", "780"):
        for source in (static_workflow, fullbody_static_workflow):
            text = source[node_id]["inputs"]["text"]
            for word in creator001_words + creator002_words:
                assert word not in text, (node_id, word)
    repair_text = fullbody_static_workflow["952"]["inputs"]["prompt"]
    for word in creator001_words + creator002_words:
        assert word not in repair_text, ("952", word)


def test_pins_are_the_single_source_for_every_generated_manifest(command, tmp_path):
    out = tmp_path / "pins-plan"
    # M2: manifest/pin content check, not a budget check -- see the sibling test above.
    plan = command.build_plan(
        "creator-001", "all", out, personas_root=PERSONAS, skip_pin_verify=True,
        accept_budget=True,
    )
    pins = load_json(PIPELINE / "train" / "tensor-pins.yaml")
    for stage, profile in (("dataset", "dataset"), ("smoke", "train"),
                           ("train", "train"), ("tester", "tester")):
        for run in plan["stages"][stage]["runs"]:
            manifest = load_json(plan_path(out, run))
            assert manifest["models"] == pins["pins"][profile]["models"]
            assert manifest["custom_nodes"] == pins["pins"][profile]["custom_nodes"]


def _synthetic_look(**overrides) -> dict:
    """A persona look deliberately DIFFERENT from creator-001's own words (persona rule:
    "would this run unchanged for creator-002 from her persona.yaml?" -- proven only if the
    fixture's identity.look isn't creator-001's by coincidence)."""
    look = {
        "age_stage": (
            "a woman in her early twenties, about twenty-two, an adult woman's face with a "
            "set jawline, an adult woman's proportions and an adult woman's frame, her hands "
            "and neck reading the same age as her face"
        ),
        "hair": "honey-blonde hair swept over one shoulder",
        "eyes": "light hazel eyes",
        "skin": "warm-tan skin with visible pores and texture",
        "brows": "her own full dark brows brushed up and not drawn in",
        "makeup": (
            "a thin brown line drawn close to the upper lash with one coat of mascara, "
            "lip balm over her natural lip colour"
        ),
        "build": "slim with an ordinary adult figure",
        "clothing": "wearing a fitted grey crew-neck t-shirt and dark jeans, both fully opaque and intact",
    }
    look.update(overrides)
    return look


def _synthetic_persona(
    personas_root: Path,
    *,
    creator_id: str = "creator-002",
    anchor_names: tuple = ("a01.jpg", "a02.jpg", "a03.jpg"),
    exemplars: list = ("a02", "a03"),
    look: dict | None = None,
) -> Path:
    source = load_json(PERSONAS / "creator-001" / "persona.yaml")
    target = personas_root / creator_id
    anchors = target / "anchors"
    anchors.mkdir(parents=True)
    for name in anchor_names:
        Image.new("RGB", (8, 8), color=(128, 96, 64)).save(anchors / name)

    identity_spec = target / "identity.md"
    register_spec = target / "register.md"
    identity_spec.write_text("synthetic identity fixture\n", encoding="utf-8")
    register_spec.write_text("synthetic register fixture\n", encoding="utf-8")

    source["id"] = creator_id
    source["identity"]["references"] = [f"anchors/{name}" for name in anchor_names]
    source["identity"]["look"] = look or _synthetic_look()
    source["identity"]["spec"] = {
        "path": "identity.md",
        "sha256": hashlib.sha256(identity_spec.read_bytes()).hexdigest(),
    }
    source["body_target"]["exemplars"] = list(exemplars)
    source["register"]["spec"] = {
        "path": "register.md",
        "sha256": hashlib.sha256(register_spec.read_bytes()).hexdigest(),
        "section": "fixture",
    }
    source["training"] = {
        "trigger": None,
        "base_arch": "krea2",
        "steps": 600,
        "save_every": 200,
        "caption_mode": "provided",
        "pod_class": "l40s",
        "price_ceiling_usd_per_hour": 1.30,
        # Matches both real personas' training.yaml (creator-001, creator-002): keeps
        # this fixture's trigger-prompt noun ("<trigger> woman, ...") consistent with
        # the live pipeline instead of falling back to DEFAULT_TRAINING's generic
        # "person" (training_config.py).
        "dop_class": "woman",
    }
    path = target / "persona.yaml"
    path.write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8")
    return path


def test_generalized_prompts_note_derives_from_actual_reference_names_not_g01_g07(
    command, tmp_path, monkeypatch,
):
    """The dataset-prompts note must reflect the real anchor filenames it names.

    Regression for the reviewer's fragility finding: the old code found and replaced the
    literal template substrings "anchors/g01.jpg"/"anchors/g07.jpg" — a silent no-op for any
    template text that does not happen to say exactly that. This uses a template that names
    different (fictional) anchor files to prove the note is built from the persona's actual
    reference filenames, not by string-matching creator-001's old anchor names.
    """
    custom_template = {
        "persona": None,
        "structure": {
            "prepend_is_the_hand_typed_description": (
                "The lesson's own rule: face.identity matches anchors/whatever-face.png; "
                "body.identity matches anchors/whatever-body.png."
            ),
        },
    }
    prompts_path = tmp_path / "tensor-dataset-prompts.yaml"
    prompts_path.write_text(json.dumps(custom_template), encoding="utf-8")
    monkeypatch.setattr(command, "PROMPTS_PATH", prompts_path)

    persona = {
        "id": "creator-002",
        "identity": {"references": ["anchors/a01.jpg", "anchors/a02.jpg", "anchors/a03.jpg"]},
        "body_target": {"exemplars": ["a02", "a03"]},
    }
    prompts = command._generalized_prompts(persona)
    note = prompts["structure"]["prepend_is_the_hand_typed_description"]
    assert "anchors/a01.jpg" in note
    assert "anchors/a03.jpg" in note
    assert "whatever-face" not in note
    assert "whatever-body" not in note


def test_generalized_prompts_raises_on_stale_post_promotion_exemplars(command):
    """Review MED-9: post-anchor-promotion, identity.references collapses to the one
    picked anchor while body_target.exemplars still names the retired g-set -- silently
    falling through to references[-1] happened to work only by coincidence (there is only
    one reference left). It must now fail closed instead of staying silent."""
    persona = {
        "id": "creator-002",
        "identity": {"references": ["anchors/c002-anchor-p04.png"]},
        "body_target": {"exemplars": ["g02", "g07"]},
    }
    with pytest.raises(command.FigmentTrainError, match="stale post-anchor-promotion"):
        command._generalized_prompts(persona)


def test_creator003_two_anchor_persona_plans_clean_and_every_manifest_dry_runs(
    command, tmp_path,
):
    """Lock in the minimal-anchor-count behavior: exactly 2 references, 1 exemplar."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(
        personas_root,
        creator_id="creator-003",
        anchor_names=("a01.jpg", "a02.jpg"),
        exemplars=["a02"],
    )
    out = tmp_path / "creator003-plan"
    # M2: manifest content check, not a budget check -- see the accept_budget note on
    # the sibling creator-001 tests above (default ledger falls back to the live shared
    # OPS ledger on this machine).
    plan = command.build_plan(
        "creator-003", "all", out, personas_root=personas_root, skip_pin_verify=True,
        accept_budget=True,
    )

    assert plan["training"]["trigger"] == "creator003krea2"
    dataset_manifest = load_json(plan_path(out, plan["stages"]["dataset"]["runs"][0]))
    assert len(dataset_manifest["uploads"][0]["files"]) == 2

    tester = load_json(plan_path(out, plan["stages"]["tester"]["runs"][0]))
    assert len(tester["jobs"]) == 3, "still one tester job (branch) per checkpoint"

    all_runs = [run for stage in plan["stages"].values() for run in stage["runs"]]
    # 2 anchor (passport + edit) + 4 dataset manifests (3 shards + fullbody, Track-2 B1)
    # + smoke + train + tester (figment Track-2 A2: STAGES gained "anchor", so
    # --stage all now plans it first).
    assert len(all_runs) == 9
    for index, run in enumerate(all_runs):
        result = subprocess.run(
            [
                sys.executable, str(POD_RUNNER), "run",
                "--manifest", str(plan_path(out, run)),
                "--out", str(tmp_path / "dry-runs" / str(index)),
                "--dry-run",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr


def test_creator002_is_data_only_token_clean_and_every_manifest_dry_runs(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "creator002-plan"
    # M2: manifest content check, not a budget check -- see the accept_budget note above.
    plan = command.build_plan(
        "creator-002", "all", out, personas_root=personas_root, skip_pin_verify=True,
        accept_budget=True,
    )

    assert plan["training"]["trigger"] == "creator002krea2"
    train_manifest = load_json(plan_path(out, plan["stages"]["train"]["runs"][0]))
    assert train_manifest["training"]["checkpoint_steps"] == "000000200 000000400"
    assert train_manifest["training"]["final_step"] == "000000600"
    tester = load_json(plan_path(out, plan["stages"]["tester"]["runs"][0]))
    assert len(tester["jobs"]) == 3
    assert tester["jobs"][-1]["substitutions"][0]["value"] == "creator002krea2.safetensors"

    for path in out.rglob("*"):
        if path.is_file():
            payload = path.read_bytes().lower()
            assert b"creator-001" not in payload, path
            assert b"creator001" not in payload, path
            assert b"g01" not in payload, path
            assert b"g07" not in payload, path

    all_runs = [run for stage in plan["stages"].values() for run in stage["runs"]]
    # 2 anchor (passport + edit) + 4 dataset manifests (3 shards + fullbody, Track-2 B1)
    # + smoke + train + tester (figment Track-2 A2: STAGES gained "anchor", so
    # --stage all now plans it first).
    assert len(all_runs) == 9
    for index, run in enumerate(all_runs):
        result = subprocess.run(
            [
                sys.executable, str(POD_RUNNER), "run",
                "--manifest", str(plan_path(out, run)),
                "--out", str(tmp_path / "dry-runs" / str(index)),
                "--dry-run",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr


def test_tester_prompt_is_trigger_prefixed_for_every_persona_not_only_dop(command, tmp_path):
    """r24/r25 evidence: the train-first LoRA's own tester prompt carried NO trigger word
    while the LoRA loaded fine, so every checkpoint rendered as the base model's generic
    woman (facenet 0.17-0.23 vs anchors -- a stranger). ai-toolkit only ever invokes a
    LoRA identity by naming its trigger in the prompt text, never implicitly just from
    being loaded -- so the tester's CLIPTextEncode node must open with "<trigger>
    <dop_class>, " for every persona, DOP-enabled or not (`_synthetic_persona`'s fixture
    here has `dop_enabled` at its default False)."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "creator002-tester-plan"
    plan = command.build_plan(
        "creator-002", "tester", out, personas_root=personas_root, skip_pin_verify=True,
    )
    tester = load_json(plan_path(out, plan["stages"]["tester"]["runs"][0]))
    text = tester["workflow"]["5"]["inputs"]["text"]
    assert text.startswith("creator002krea2 woman, ")
    assert _synthetic_look()["age_stage"] in text
    assert "fully clothed" in text
    # the old, un-prefixed prompt text must never appear verbatim as the prompt itself.
    assert not text.startswith("Close-up portrait photograph of")
    assert "mid twenties" not in text


def test_creator001_real_persona_tester_gen_and_detail_prompts_are_trigger_prefixed(
    command, tmp_path,
):
    """Same fix, proven against creator-001's own real, checked-in persona.yaml/
    training.yaml (dop_enabled: true, dop_class: "woman") -- the exact configuration the
    r24/r25 evidence's stranger-scoring run used."""
    out = tmp_path / "creator001-tester-plan"
    plan = command.build_plan(
        "creator-001", "tester", out, personas_root=PERSONAS, skip_pin_verify=True,
    )
    tester = load_json(plan_path(out, plan["stages"]["tester"]["runs"][0]))
    tester_text = tester["workflow"]["5"]["inputs"]["text"]
    assert tester_text.startswith("creator001krea2 woman, ")

    persona, training, pins = command._load_inputs("creator-001", PERSONAS)
    persona = dict(persona)
    persona["_persona_path"] = str(PERSONAS / "creator-001" / "persona.yaml")
    gen_training = {**training, "chosen_checkpoint_step": training["steps"]}

    gen_manifest = command._gen_manifest(persona, gen_training, pins)
    gen_text = gen_manifest["jobs"][0]["substitutions"][0]["value"]
    assert gen_text.startswith("creator001krea2 woman, ")

    detail_manifest = command._detail_manifest(persona, gen_training, pins, ["a01.jpg"])
    detail_text = detail_manifest["workflow"]["5"]["inputs"]["text"]
    assert detail_text.startswith("creator001krea2 woman, ")
    assert not detail_text.startswith("Photograph of an adult woman,")


def test_tester_prompt_derives_age_from_persona_and_keeps_adult_clothed_constraints(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    age_stage = (
        "a woman in her early twenties, about twenty-two, an adult woman's face and "
        "adult woman's proportions"
    )
    _synthetic_persona(personas_root, look=_synthetic_look(age_stage=age_stage))

    plan = command.build_plan(
        "creator-002", "tester", tmp_path / "tester", personas_root=personas_root,
        skip_pin_verify=True,
    )
    manifest = load_json(plan_path(tmp_path / "tester", plan["stages"]["tester"]["runs"][0]))
    text = manifest["workflow"]["5"]["inputs"]["text"]

    assert age_stage in text
    assert "mid twenties" not in text
    assert "She is an adult woman, fully clothed" in text


def test_held_out_diagnostic_protocol_freezes_candidate_control_inputs(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    candidate = tmp_path / "creator002krea2.safetensors"
    candidate.write_bytes(b"synthetic safetensors fixture")
    out = tmp_path / "diagnostic-protocol.json"

    protocol = command.build_held_out_diagnostic_protocol(
        "creator-002", candidate, out, personas_root=personas_root,
        canonical_anchor="anchors/a01.jpg",
    )

    assert load_json(out) == protocol
    assert protocol["schema"] == "figment/held-out-diagnostic-protocol@1"
    assert protocol["promotion"] == {"allowed": False}
    assert protocol["persona"]["age_stage"] == _synthetic_look()["age_stage"]
    assert protocol["persona"]["canonical_anchor"]["reference"] == "anchors/a01.jpg"
    assert len(protocol["persona"]["reference_set"]) == 3
    assert all(len(row["sha256"]) == 64 for row in protocol["persona"]["reference_set"])
    assert protocol["checkpoints"][0]["candidate"]["sha256"] == hashlib.sha256(
        candidate.read_bytes(),
    ).hexdigest()
    assert protocol["checkpoints"][1]["id"] == "base-control-no-lora"
    assert protocol["seeds"] == [1595, 481516234, 90210, 314159, 271828]
    assert len(protocol["cells"]) == 10
    assert {row["checkpoint"] for row in protocol["cells"]} == {
        "candidate-lora", "base-control-no-lora",
    }
    assert {row["id"] for row in protocol["criteria"]} == {
        "realism", "within_batch_identity", "reference_identity", "apparent_persona_age",
    }
    assert all(row["status"] == "unscored" for row in protocol["criteria"])
    assert all("score" not in row and "approval" not in row for row in protocol["criteria"])
    persona_age = next(row for row in protocol["criteria"] if row["id"] == "apparent_persona_age")
    assert protocol["persona"]["age_stage"] in persona_age["question"]
    prompt = protocol["prompts"][0]["text"]
    assert _synthetic_look()["age_stage"] in prompt
    assert "fully clothed" in prompt


def test_held_out_diagnostic_protocol_refuses_overwrite_and_non_safetensors_candidate(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    candidate = tmp_path / "candidate.safetensors"
    candidate.write_bytes(b"fixture")
    out = tmp_path / "protocol.json"
    command.build_held_out_diagnostic_protocol(
        "creator-002", candidate, out, personas_root=personas_root,
        canonical_anchor="anchors/a01.jpg",
    )

    with pytest.raises(command.FigmentTrainError, match="overwrite frozen"):
        command.build_held_out_diagnostic_protocol(
            "creator-002", candidate, out, personas_root=personas_root,
            canonical_anchor="anchors/a01.jpg",
        )
    non_checkpoint = tmp_path / "candidate.bin"
    non_checkpoint.write_bytes(b"fixture")
    with pytest.raises(command.FigmentTrainError, match=".safetensors"):
        command.build_held_out_diagnostic_protocol(
            "creator-002", non_checkpoint, tmp_path / "other.json", personas_root=personas_root,
            canonical_anchor="anchors/a01.jpg",
        )


def test_held_out_diagnostic_cli_subcommand_is_registered(command):
    parser = command.build_parser()
    args = parser.parse_args([
        "held-out-diagnostic", "--creator", "creator-002", "--candidate-checkpoint", "c.safetensors",
        "--out", "protocol.json", "--canonical-anchor", "anchors/a01.jpg",
    ])
    assert args.command == "held-out-diagnostic"
    assert args.candidate_checkpoint == Path("c.safetensors")
    assert args.out == Path("protocol.json")
    assert args.canonical_anchor == "anchors/a01.jpg"


def test_held_out_diagnostic_protocol_requires_canonical_anchor_for_a_reference_set(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    candidate = tmp_path / "candidate.safetensors"
    candidate.write_bytes(b"fixture")

    with pytest.raises(command.FigmentTrainError, match="needs --canonical-anchor"):
        command.build_held_out_diagnostic_protocol(
            "creator-002", candidate, tmp_path / "protocol.json", personas_root=personas_root,
        )


def test_held_out_diagnostic_protocol_uses_a_single_reference_without_a_multi_anchor_average(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(
        personas_root, anchor_names=("a01.jpg",), exemplars=("a01",),
    )
    candidate = tmp_path / "candidate.safetensors"
    candidate.write_bytes(b"fixture")

    protocol = command.build_held_out_diagnostic_protocol(
        "creator-002", candidate, tmp_path / "protocol.json", personas_root=personas_root,
    )

    assert protocol["persona"]["canonical_anchor"]["reference"] == "anchors/a01.jpg"
    assert protocol["persona"]["reference_set"] == [protocol["persona"]["canonical_anchor"]]


def test_compile_held_out_diagnostic_emits_ten_isolated_harness_jobs_and_dry_runs(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    candidate = tmp_path / "creator002krea2.safetensors"
    candidate.write_bytes(b"synthetic held-out checkpoint")
    protocol_path = tmp_path / "protocol.json"
    command.build_held_out_diagnostic_protocol(
        "creator-002", candidate, protocol_path, personas_root=personas_root,
        canonical_anchor="anchors/a01.jpg",
    )

    out = tmp_path / "compiled"
    preparation = command.compile_held_out_diagnostic(
        "creator-002", protocol_path, candidate, out, personas_root=personas_root,
    )
    manifest_path = out / preparation["manifest"]["path"]
    manifest = load_json(manifest_path)
    assert preparation["schema"] == "figment/held-out-diagnostic-preparation@1"
    assert preparation["promotion"] == {"allowed": False}
    assert preparation["minimum_runtime_minutes"] <= manifest["max_minutes"]
    assert preparation["run"]["ceiling_usd"] == command.manifest_ceiling(manifest)
    assert preparation["run"]["argv"][preparation["run"]["argv"].index("--max-minutes") + 1] == str(manifest["max_minutes"])
    staged = out / "inputs" / candidate.name
    assert staged.read_bytes() == candidate.read_bytes()
    assert manifest["uploads"][0]["files"] == [f"inputs/{candidate.name}"]
    assert len(manifest["jobs"]) == 10

    runner = command._pod_runner_module()
    candidate_jobs = manifest["jobs"][:5]
    control_jobs = manifest["jobs"][5:]
    assert [job["seed"] for job in candidate_jobs] == list(command.DIAGNOSTIC_PROTOCOL_SEEDS)
    assert [job["seed"] for job in control_jobs] == list(command.DIAGNOSTIC_PROTOCOL_SEEDS)
    for job in candidate_jobs:
        graph = runner.apply_job(manifest["workflow"], job)
        assert graph["4"]["inputs"]["strength_model"] == 1.0
        assert graph["4"]["inputs"]["strength_clip"] == 1.0
        assert graph["5"]["inputs"]["clip"] == ["4", 1]
        assert graph["8"]["inputs"]["model"] == ["4", 0]
    for job in control_jobs:
        graph = runner.apply_job(manifest["workflow"], job)
        assert graph["4"]["inputs"]["strength_model"] == 0.0
        assert graph["4"]["inputs"]["strength_clip"] == 0.0
        assert graph["5"]["inputs"]["clip"] == ["2", 0]
        assert graph["8"]["inputs"]["model"] == ["1", 0]

    result = subprocess.run(
        [sys.executable, str(POD_RUNNER), "run", "--manifest", str(manifest_path),
         "--out", str(tmp_path / "dry-run"), "--dry-run"],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_compile_held_out_diagnostic_refuses_tampering_stale_anchor_and_existing_output(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    candidate = tmp_path / "creator002krea2.safetensors"
    candidate.write_bytes(b"synthetic held-out checkpoint")
    protocol_path = tmp_path / "protocol.json"
    command.build_held_out_diagnostic_protocol(
        "creator-002", candidate, protocol_path, personas_root=personas_root,
        canonical_anchor="anchors/a01.jpg",
    )

    tampered = load_json(protocol_path)
    tampered["promotion"] = {"allowed": True}
    tampered_path = tmp_path / "tampered.json"
    tampered_path.write_text(json.dumps(tampered), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="non-promotable"):
        command.compile_held_out_diagnostic(
            "creator-002", tampered_path, candidate, tmp_path / "tampered-out",
            personas_root=personas_root,
        )

    replacement = tmp_path / "replacement.safetensors"
    replacement.write_bytes(b"different checkpoint")
    with pytest.raises(command.FigmentTrainError, match="checkpoint or tester pins are stale"):
        command.compile_held_out_diagnostic(
            "creator-002", protocol_path, replacement, tmp_path / "wrong-checkpoint-out",
            personas_root=personas_root,
        )

    (personas_root / "creator-002" / "anchors" / "a01.jpg").write_bytes(b"changed anchor")
    with pytest.raises(command.FigmentTrainError, match="reference set is stale"):
        command.compile_held_out_diagnostic(
            "creator-002", protocol_path, candidate, tmp_path / "stale-anchor-out",
            personas_root=personas_root,
        )

    fresh_personas = tmp_path / "fresh-personas"
    _synthetic_persona(fresh_personas)
    fresh_protocol = tmp_path / "fresh-protocol.json"
    command.build_held_out_diagnostic_protocol(
        "creator-002", candidate, fresh_protocol, personas_root=fresh_personas,
        canonical_anchor="anchors/a01.jpg",
    )
    existing = tmp_path / "existing-out"
    existing.mkdir()
    with pytest.raises(command.FigmentTrainError, match="refusing to overwrite"):
        command.compile_held_out_diagnostic(
            "creator-002", fresh_protocol, candidate, existing, personas_root=fresh_personas,
        )


def test_compile_held_out_diagnostic_revalidates_after_candidate_snapshot(command, tmp_path, monkeypatch):
    """A changed checkpoint between initial validation and final publication is refused."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    candidate = tmp_path / "creator002krea2.safetensors"
    candidate.write_bytes(b"initial candidate")
    protocol_path = tmp_path / "protocol.json"
    command.build_held_out_diagnostic_protocol(
        "creator-002", candidate, protocol_path, personas_root=personas_root,
        canonical_anchor="anchors/a01.jpg",
    )
    original_fingerprint = command._source_fingerprint
    changed = False

    def fingerprint_then_change(path):
        nonlocal changed
        result = original_fingerprint(path)
        if not changed and Path(path).resolve() == candidate.resolve():
            candidate.write_bytes(b"changed after snapshot")
            changed = True
        return result

    monkeypatch.setattr(command, "_source_fingerprint", fingerprint_then_change)
    with pytest.raises(command.FigmentTrainError, match="checkpoint or tester pins are stale"):
        command.compile_held_out_diagnostic(
            "creator-002", protocol_path, candidate, tmp_path / "racing-out",
            personas_root=personas_root,
        )
    assert changed


def test_compile_held_out_diagnostic_cli_subcommand_is_registered(command):
    parser = command.build_parser()
    args = parser.parse_args([
        "compile-held-out-diagnostic", "--creator", "creator-002", "--protocol", "p.json",
        "--candidate-checkpoint", "c.safetensors", "--out", "compiled", "--ledger-dir", "ledger",
    ])
    assert args.command == "compile-held-out-diagnostic"
    assert args.protocol == Path("p.json")
    assert args.candidate_checkpoint == Path("c.safetensors")
    assert args.out == Path("compiled")
    assert args.ledger_dir == Path("ledger")


@pytest.mark.parametrize(
    ("age_stage", "message"),
    [
        ("a child with an adult woman's face", "child/minor wording"),
        ("a woman about twenty-three years old", "must explicitly describe an adult"),
    ],
)
def test_tester_prompt_rejects_child_or_non_adult_age_stage(command, age_stage, message):
    persona = {"identity": {"look": {"age_stage": age_stage}}}
    with pytest.raises(command.FigmentTrainError, match=message):
        command._tester_prompt(persona, {"trigger": "fixture"})


def test_tester_prompt_allows_different_explicit_adult_age(command):
    age_stage = "a woman about twenty-nine, an adult woman's face and adult proportions"
    text = command._tester_prompt(
        {"identity": {"look": {"age_stage": age_stage}}}, {"trigger": "fixture"},
    )
    assert age_stage in text


def test_frozen_protocol_publication_has_one_winner_under_an_interleaving(command, tmp_path):
    """Two writers that reach exclusive creation together cannot replace either result."""
    out = tmp_path / "protocol.json"
    barrier = threading.Barrier(2)
    outcomes: list[object] = []

    def write(payload):
        try:
            barrier.wait(timeout=5)
            command._write_frozen_json(out, payload)
            outcomes.append(payload)
        except command.FigmentTrainError as exc:
            outcomes.append(exc)

    left = threading.Thread(target=write, args=({"writer": "left"},))
    right = threading.Thread(target=write, args=({"writer": "right"},))
    left.start()
    right.start()
    left.join(timeout=5)
    right.join(timeout=5)

    assert not left.is_alive() and not right.is_alive()
    assert len([item for item in outcomes if isinstance(item, dict)]) == 1
    assert len([item for item in outcomes if isinstance(item, command.FigmentTrainError)]) == 1
    assert load_json(out) in ({"writer": "left"}, {"writer": "right"})


def _fake_run(out: Path, *, usd: float = 0.25) -> tuple[dict, Path]:
    out.mkdir(parents=True)
    (out / "_training.log").write_text("state dict loaded cleanly\n", encoding="utf-8")
    run = {
        "error": None,
        "pod_id": "pod-fixture",
        "gpu": {"type": "NVIDIA L40S", "count": 1, "cloud": "SECURE"},
        "termination_verified": True,
        "estimated_actual_usd": usd,
        "ledger_day": "2026-09-04",
        "artifacts": [
            {"remote": "model.safetensors", "bytes": 12},
            {"remote": "_training.log", "bytes": 25},
        ],
        "placement_attempts": [{
            "pod_id": "pod-fixture",
            "estimated_actual_usd": usd,
            "termination_verified": True,
        }],
    }
    path = out / "run.json"
    path.write_text(json.dumps(run), encoding="utf-8")
    manifest = {
        "gpu": run["gpu"],
        "artifacts": [
            {"remote": "model.safetensors"},
            {"remote": "_training.log"},
        ],
    }
    return manifest, path


def test_run_verifier_checks_artifacts_termination_ledger_and_training_log(command, tmp_path):
    manifest, run_path = _fake_run(tmp_path / "run")
    ledger = tmp_path / "cost-ledger"
    ledger.mkdir()
    (ledger / "figment-2026-09-04.tsv").write_text(
        "model\tstep\tusd\nrunpod:l40s\tpod-create pod-fixture\t0.250000\n",
        encoding="utf-8",
    )
    verified = command.verify_run_record("smoke", manifest, run_path.parent, ledger)
    assert verified["pod_id"] == "pod-fixture"


@pytest.mark.parametrize("defect", ["termination", "artifact", "ledger", "log"])
def test_run_verifier_stops_on_each_recorded_defect(command, tmp_path, defect):
    manifest, run_path = _fake_run(tmp_path / defect)
    data = load_json(run_path)
    ledger = tmp_path / "cost-ledger"
    ledger.mkdir()
    ledger_text = "model\tstep\tusd\nrunpod:l40s\tpod-create pod-fixture\t0.250000\n"
    if defect == "termination":
        data["termination_verified"] = False
    elif defect == "artifact":
        data["artifacts"][0]["bytes"] = 0
    elif defect == "ledger":
        ledger_text = "model\tstep\tusd\nrunpod:l40s\tpod-create pod-fixture\t0.200000\n"
    else:
        (run_path.parent / "_training.log").write_text(
            "missing_keys: ['layer.weight']\n", encoding="utf-8"
        )
    run_path.write_text(json.dumps(data), encoding="utf-8")
    (ledger / "figment-2026-09-04.tsv").write_text(ledger_text, encoding="utf-8")
    with pytest.raises(command.FigmentTrainError):
        command.verify_run_record("smoke", manifest, run_path.parent, ledger)


def test_run_refuses_to_resume_a_stage_stuck_running(command, tmp_path, monkeypatch):
    out = tmp_path / "resume-plan"
    # M2: manifest content check against the real dataset ceiling, not a budget check --
    # the live shared ledger's remaining arc margin is thin enough to make this flaky
    # without accept_budget (other workers on this machine also spend against it).
    plan = command.build_plan(
        "creator-001", "dataset", out, personas_root=PERSONAS, skip_pin_verify=True,
        accept_budget=True,
    )
    plan_file = out / "plan.json"
    key = plan["stages"]["dataset"]["runs"][0]["manifest"]
    state_path = out / "stage.json"
    state_path.write_text(json.dumps({
        "schema": "figment/train-stage@1",
        "creator": "creator-001",
        "plan_sha256": hashlib.sha256(plan_file.read_bytes()).hexdigest(),
        "status": "running:dataset",
        "runs": {key: {"status": "running", "started_utc": "2026-09-04T00:00:00+00:00"}},
        "completed_stages": [],
    }), encoding="utf-8")

    def _no_launch(*args, **kwargs):
        raise AssertionError("must not launch a subprocess for a run stuck running")
    monkeypatch.setattr(command.subprocess, "run", _no_launch)

    with pytest.raises(command.FigmentTrainError) as excinfo:
        command.run_planned_stage("creator-001", "dataset", plan_file)
    message = str(excinfo.value)
    assert "runpod_run.py" in message
    assert "status" in message and "probe" in message
    # n12: the recovery message this SECOND concurrent invocation actually hits must
    # name the likely-benign case (another invocation is still active) and its fix
    # (wait, then re-run pipeline/run on this same plan) -- not just the crash-
    # recovery case, and never suggest a fresh plan for this alone.
    assert "re-run" in message
    assert "may already have succeeded" in message
    assert "create a reviewed new plan to retry" not in message


def test_ledger_model_dispatches_through_the_pod_harness_function_not_a_copy(
    command, tmp_path, monkeypatch,
):
    """_verify_ledger must call the harness's own gpu_model_label, not a hand copy.

    Proof: monkeypatching the pod module's gpu_model_label changes figment_train's
    ledger-agreement result. A private reimplementation would be unaffected by this.
    """
    assert not hasattr(command, "_ledger_model"), (
        "local gpu-label reimplementation should be deleted in favor of importing "
        "pod/runpod_run.py's gpu_model_label"
    )
    manifest, run_path = _fake_run(tmp_path / "ledger-dispatch")
    ledger = tmp_path / "cost-ledger"
    ledger.mkdir()
    (ledger / "figment-2026-09-04.tsv").write_text(
        "model\tstep\tusd\nrunpod:sentinel-model\tpod-create pod-fixture\t0.250000\n",
        encoding="utf-8",
    )
    pod_module = command._pod_runner_module()
    monkeypatch.setattr(pod_module, "gpu_model_label", lambda gpu_type: "runpod:sentinel-model")

    verified = command.verify_run_record("smoke", manifest, run_path.parent, ledger)
    assert verified["pod_id"] == "pod-fixture"


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def test_dataset_grading_template_round_trip_builds_only_kept_training_images(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "grade-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)

    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    grade = command.build_grade("creator-002", "dataset", plan_file)
    template = load_json(Path(grade["rulings_template"]))
    assert len(template["rulings"]) == 30
    assert "<img" in Path(grade["page"]).read_text(encoding="utf-8")
    assert "full-resolution" in Path(grade["page"]).read_text(encoding="utf-8")

    for index, ruling in enumerate(template["rulings"]):
        ruling.update({
            "decision": "cull" if index == 0 else "keep",
            "identity": "pass",
            "realism": "pass",
            "hands": "pass",
            "lighting": "pass",
            "adult_read": "pass",
            "garment_integrity": "pass",
            "real_person_resemblance": "clear",
            "why": "fixture ruling",
            # This fixture's anchors/cells are fabricated bytes with no real face, so
            # the fail-closed identity/age/realism gate always fails them -- this test
            # is about the dataset-build round-trip, not the gate, hence the override.
            "gate_override": "fixture: no real face in this synthetic image",
        })
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    filled = Path(grade["rulings_template"]).with_name("filled.json")
    filled.write_text(json.dumps(template, indent=2) + "\n", encoding="utf-8")

    result = command.apply_rulings("creator-002", "dataset", plan_file, filled)
    approved = load_json(Path(result["approved_list"]))
    review = load_json(Path(result["review_manifest"]))
    dataset = load_json(out / "train" / "runs" / "creator-002-tensor-dataset" / "dataset_manifest.json")
    assert len(approved["images"]) == 29
    assert dataset["count"] == 29
    assert sum(row["review_status"] == "verified" for row in review["images"]) == 30
    assert not any(row["safety_failed"] for row in review["images"])
    assert (out / "train" / "runs" / "creator-002-tensor-dataset" / "training.json").is_file()


def _all_cull_rulings(template: dict) -> dict:
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "cull",
            "identity": "pass",
            "realism": "pass",
            "hands": "pass",
            "lighting": "pass",
            "adult_read": "pass",
            "garment_integrity": "pass",
            "real_person_resemblance": "clear",
            "why": "fixture all-cull ruling",
        })
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-09T00:00:00Z"})
    return template


def test_apply_rulings_records_an_attributed_all_cull_without_opening_dataset_gate(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="all-cull-dataset")
    template = _all_cull_rulings(load_json(Path(grade["rulings_template"])))
    filled = Path(grade["rulings_template"]).with_name("all-cull.json")
    filled.write_text(json.dumps(template), encoding="utf-8")

    result = command.apply_rulings("creator-002", "dataset", plan_file, filled)
    rejection = load_json(Path(result["rejection_lineage"]))
    evaluation = load_json(Path(grade["gate"]).with_name("evaluation-inputs.json"))
    review = load_json(Path(result["review_manifest"]))
    grade_dir = Path(grade["rulings_template"]).parent

    assert rejection["schema"] == command._lineage_module().APPROVAL_SCHEMA
    assert rejection["decision"] == "rejected"
    assert rejection["decided_by"] == "operator-fixture"
    assert rejection["subject"] == evaluation["subject"]
    assert rejection["subject_sha256"] == evaluation["subject_sha256"]
    assert rejection["reviewed_subject_sha256"] == evaluation["subject_sha256"]
    assert rejection["rulings_sha256"] == command._sha256(Path(result["rulings"]))
    assert all(row["review_status"] == "verified" for row in review["images"])
    assert not (grade_dir / "approval-lineage.json").exists()
    assert not (grade_dir / "approved-list.json").exists()
    assert not (grade_dir / "approved").exists()
    assert not (plan_file.parent / "train" / "runs" / "creator-002-tensor-dataset").exists()
    plan, root = command._load_plan("creator-002", plan_file)
    with pytest.raises(command.FigmentTrainError, match="no current operator approval"):
        command._load_current_approval(plan, root, "dataset")
    with pytest.raises(command.FigmentTrainError, match="refusing to overwrite"):
        command.apply_rulings("creator-002", "dataset", plan_file, filled)


def test_all_cull_cli_reports_rejection_without_a_post_write_error(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="cull-cli")
    grade_dir = Path(grade["rulings_template"]).parent
    filled = grade_dir / "all-cull-input.json"
    filled.write_text(
        json.dumps(_all_cull_rulings(load_json(Path(grade["rulings_template"])))),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-I", "-B", str(MODULE_PATH), "apply-rulings",
         "--creator", "creator-002", "--stage", "dataset", "--plan", str(plan_file),
         "--rulings", str(filled)],
        cwd=ROOT, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "rejection lineage:" in result.stdout
    assert "approved list:" not in result.stdout
    assert load_json(grade_dir / "rejection-lineage.json")["decision"] == "rejected"
    assert not (grade_dir / "approval-lineage.json").exists()
    assert not (grade_dir / "approved-list.json").exists()


def test_all_cull_tester_ruling_rejects_checkpoint_selection_before_writing(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "all-cull-tester"
    plan = command.build_plan(
        "creator-002", "tester", out, personas_root=personas_root, skip_pin_verify=True,
    )
    for run in plan["stages"]["tester"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)
    grade = command.build_grade("creator-002", "tester", out / "plan.json")
    template = _all_cull_rulings(load_json(Path(grade["rulings_template"])))
    filled = out / "all-cull-tester-rulings.json"
    filled.write_text(json.dumps(template), encoding="utf-8")
    grade_dir = Path(grade["rulings_template"]).parent

    with pytest.raises(command.FigmentTrainError, match="rulings approved no images"):
        command.apply_rulings(
            "creator-002", "tester", out / "plan.json", filled, checkpoint_step=250,
        )
    assert not any((grade_dir / name).exists() for name in (
        "rulings.json", "review-manifest.json", "rejection-lineage.json",
        "approved-list.json", "approval-lineage.json", "accepted-checkpoint.json",
    ))

    result = command.apply_rulings("creator-002", "tester", out / "plan.json", filled)
    assert Path(result["rejection_lineage"]).is_file()
    assert not (grade_dir / "accepted-checkpoint.json").exists()
    loaded_plan, root = command._load_plan("creator-002", out / "plan.json")
    with pytest.raises(command.FigmentTrainError, match="no current operator approval"):
        command._load_current_approval(loaded_plan, root, "tester")


def test_all_cull_gen_ruling_leaves_the_gen_consumer_gate_closed(command, tmp_path):
    """Gen must not mistake a rejection record for an approved still lineage."""
    gen_helpers = load_module(
        "figment_rejection_gen_helpers", PIPELINE / "tests" / "test_gen_stage.py",
    )
    personas_root = tmp_path / "personas"
    gen_helpers._promoted_persona(personas_root, creator_id="creator-002", steps=3000)
    gen_helpers._prepare_accepted_checkpoint(command, personas_root, tmp_path)
    out = tmp_path / "all-cull-gen"
    plan = command.build_plan(
        "creator-002", "gen", out, personas_root=personas_root, skip_pin_verify=True,
    )
    gen_helpers.anchor_stage_test._fake_stage_outputs(out, plan, "gen")
    grade = command.build_grade("creator-002", "gen", out / "plan.json", skip_judge=True)
    filled = out / "all-cull-gen-rulings.json"
    filled.write_text(
        json.dumps(_all_cull_rulings(load_json(Path(grade["rulings_template"])))),
        encoding="utf-8",
    )

    result = command.apply_rulings("creator-002", "gen", out / "plan.json", filled)
    grade_dir = Path(grade["rulings_template"]).parent
    assert Path(result["rejection_lineage"]).is_file()
    assert not (grade_dir / "approval-lineage.json").exists()
    assert not (grade_dir / "approved-list.json").exists()
    with pytest.raises(command.FigmentTrainError, match="approval evidence is incomplete"):
        command.validate_approved_gen_still(
            "creator-002", out / "plan.json", load_json(Path(grade["grading_manifest"]))["images"][0]["image_id"],
        )


def test_apply_rulings_fails_closed_when_a_kept_cell_fails_safety(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "unsafe-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)
    grade = command.build_grade("creator-002", "dataset", plan_file)
    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
            # Fabricated bytes, no real face -- always fails the identity/age/realism
            # gate; this test is specifically about the SEPARATE safety-axis check.
            "gate_override": "fixture: no real face in this synthetic image",
        })
    template["rulings"][0]["adult_read"] = "ambiguous"
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    filled = Path(grade["rulings_template"]).with_name("unsafe.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="safety"):
        command.apply_rulings("creator-002", "dataset", plan_file, filled)


# ---------------------------------------------------------------------------
# identity_gate wiring: build_grade writes gate.json + a PASS/FAIL board, apply_rulings
# refuses a bare keep on a failed-gate cell, `gate` CLI prints the table.
# ---------------------------------------------------------------------------


def _build_fake_dataset_grade(command, tmp_path, *, out_name: str):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / out_name
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)
    grade = command.build_grade("creator-002", "dataset", plan_file)
    return plan_file, grade


def test_build_grade_writes_gate_json_and_a_pass_fail_board(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-json-plan")
    assert "gate" in grade
    gate_document = load_json(Path(grade["gate"]))
    assert gate_document["schema"] == "figment/gate@1"
    assert len(gate_document["rows"]) == 30
    for field in ("identity_own", "age_delta", "gloss", "niqe", "pass"):
        assert field in gate_document["rows"][0]
    # This fixture's images/anchors are fabricated bytes with no real face -- every
    # cell must fail the gate, never silently pass.
    assert gate_document["summary"]["passed"] == 0
    assert gate_document["summary"]["failed"] == 30

    page_text = Path(grade["page"]).read_text(encoding="utf-8")
    assert "failed gate (30)" in page_text
    assert "Cells passing the gate (0)" in page_text


def test_apply_rulings_refuses_a_keep_on_a_failed_gate_cell_without_override(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-refuse-plan")
    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
        })
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    filled = Path(grade["rulings_template"]).with_name("no-override.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="gate"):
        command.apply_rulings("creator-002", "dataset", plan_file, filled)


def test_apply_rulings_allows_a_keep_on_a_failed_gate_cell_with_override(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-override-plan")
    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
            "gate_override": "operator manually confirmed identity from the full-res original",
        })
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    filled = Path(grade["rulings_template"]).with_name("override.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    result = command.apply_rulings("creator-002", "dataset", plan_file, filled)
    approved = load_json(Path(result["approved_list"]))
    assert len(approved["images"]) == 30


def test_apply_rulings_refuses_when_gate_json_is_missing(command, tmp_path):
    """Finding 2 (REVIEW-2026-09-07 #2): a deleted gate.json must not turn the
    fail-closed gate into an advisory one -- apply_rulings refuses outright rather than
    treating every keep as ungated."""
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-missing-file-plan")
    Path(grade["gate"]).unlink()

    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
            "gate_override": "would-be override, should never be reached",
        })
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    filled = Path(grade["rulings_template"]).with_name("missing-gate.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="gate.json"):
        command.apply_rulings("creator-002", "dataset", plan_file, filled)


def test_apply_rulings_refuses_when_gate_json_does_not_cover_every_graded_cell(command, tmp_path):
    """Finding 2 (REVIEW-2026-09-07 #2): a cell absent from gate.json (e.g. a partial
    rewrite) must not be treated as an ungated, unguarded keep."""
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-partial-coverage-plan")
    gate_path = Path(grade["gate"])
    gate_document = load_json(gate_path)
    del gate_document["rows"][0]
    gate_path.write_text(json.dumps(gate_document), encoding="utf-8")

    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
            "gate_override": "would-be override, should never be reached",
        })
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-08T00:00:00Z"})
    filled = Path(grade["rulings_template"]).with_name("partial-coverage.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    with pytest.raises(command.FigmentTrainError, match="stale|does not cover"):
        command.apply_rulings("creator-002", "dataset", plan_file, filled)


def test_gate_cli_prints_a_pass_fail_table(command, tmp_path, capsys):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="gate-cli-plan")
    exit_code = command.main(["gate", "--creator", "creator-002", "--stage", "dataset", "--plan", str(plan_file)])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "image_id" in out
    assert "FAIL" in out
    assert "0/30 passed" in out


def test_gate_cli_errors_when_grade_has_not_run(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "no-grade-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    with pytest.raises(command.FigmentTrainError, match="run `figment_train.py grade`"):
        command.command_gate("creator-002", "dataset", plan_file)


# ---------------------------------------------------------------------------
# vlm_judge.py wiring: build_grade runs stage 2 ONLY for cells that clear stage 1,
# --skip-judge omits it entirely, the board shows the judge's numbers + notes.
# ---------------------------------------------------------------------------

_FAKE_STAGE1_PASS_ROW = {
    "identity_own": 0.95, "identity_max": 0.95, "identity_mean": 0.95,
    "identity_per_anchor": {}, "face_px": 900,
    "age_value": 22.0, "age_anchor": 22.0, "age_delta": 0.0,
    "niqe": 1.0, "laplacian_variance": 300.0, "gloss": 0.001,
    "unavailable": {},
}


def _fake_score_cells_for_stage(images, anchors, *, own_anchor, models=None):
    """Every cell reads as a clean stage-1 pass (a real face, well within the identity
    and face-size floors) -- used so tests can exercise stage 2 wiring without loading
    real FaceNet/MTCNN weights."""
    return [dict(_FAKE_STAGE1_PASS_ROW, image_id=item["image_id"]) for item in images]


def _fake_judge_row(image_id: str, **overrides) -> dict:
    row = {
        "image_id": image_id, "same_person": 58, "apparent_age_reference": 23,
        "apparent_age_candidate": 30, "age_delta": 7, "skin_realism": 55, "gloss": 40,
        "artifacts": 5, "notes": "kind of close, older, glossy", "model": "sonnet",
        "duration_s": 0.01, "cost_usd": 0.0012, "cache_hit": False, "unavailable": {},
    }
    row.update(overrides)
    return row


def test_build_grade_runs_the_judge_only_for_cells_that_pass_stage1(command, tmp_path, monkeypatch):
    plan_file, grade, gate_module, judge_calls = _build_grade_with_fake_stage1_and_judge(
        command, tmp_path, monkeypatch, out_name="judge-wiring-plan",
        judge_row_factory=lambda image_id: _fake_judge_row(image_id),
    )
    gate_document = load_json(Path(grade["gate"]))
    assert judge_calls["n"] == 1  # one BATCH call for every stage-1-passing cell
    assert gate_document["judge_skipped"] is False
    row = gate_document["rows"][0]
    assert row["judge"]["same_person"] == 58
    assert row["judge"]["notes"] == "kind of close, older, glossy"
    assert row["stage1"]["pass"] is True
    # gate.yaml's placeholder judge.same_person_min (80) is not cleared by 58 -- stage 2
    # must fail this cell even though stage 1 passed.
    assert row["stage2"]["pass"] is False
    assert row["pass"] is False
    assert any("same_person" in reason for reason in row["reasons"])

    page_text = Path(grade["page"]).read_text(encoding="utf-8")
    assert "same 58" in page_text
    assert "kind of close, older, glossy" in page_text


def test_build_grade_passes_a_cell_whose_judge_verdict_clears_every_threshold(
    command, tmp_path, monkeypatch,
):
    plan_file, grade, gate_module, judge_calls = _build_grade_with_fake_stage1_and_judge(
        command, tmp_path, monkeypatch, out_name="judge-pass-plan",
        judge_row_factory=lambda image_id: _fake_judge_row(
            image_id, same_person=97, age_delta=1, skin_realism=92, gloss=3, artifacts=2,
            notes="clean match",
        ),
    )
    gate_document = load_json(Path(grade["gate"]))
    assert gate_document["summary"]["passed"] == gate_document["summary"]["total"]
    row = gate_document["rows"][0]
    assert row["pass"] is True
    assert row["stage2"]["pass"] is True
    assert "same 97" in Path(grade["page"]).read_text(encoding="utf-8")


def test_build_grade_skip_judge_never_loads_the_judge_module(command, tmp_path, monkeypatch):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "skip-judge-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    gate_module = command._identity_gate_module()
    monkeypatch.setattr(gate_module, "score_cells_for_stage", _fake_score_cells_for_stage)

    def boom():
        raise AssertionError("must never load the judge module under --skip-judge")

    monkeypatch.setattr(gate_module, "_vlm_judge_module", boom)

    grade = command.build_grade("creator-002", "dataset", plan_file, skip_judge=True)
    gate_document = load_json(Path(grade["gate"]))
    assert gate_document["judge_skipped"] is True
    # stage 1 passes (the fake score module says so) but stage 2 was never attempted --
    # must still fail closed, never a silent pass.
    assert gate_document["rows"][0]["judge"] is None
    assert gate_document["rows"][0]["stage1"]["pass"] is True
    assert gate_document["rows"][0]["pass"] is False
    assert gate_document["rows"][0]["reasons"] == ["unavailable: judge"]
    assert gate_document["summary"]["passed"] == 0


def test_build_grade_local_research_is_plan_bound_and_never_calls_external_judges(
    command, tmp_path, monkeypatch,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / "local-research-plan"
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    gate_module = command._identity_gate_module()
    monkeypatch.setattr(gate_module, "score_cells_for_stage", _fake_score_cells_for_stage)
    monkeypatch.setattr(gate_module, "_vlm_judge_module", lambda: (_ for _ in ()).throw(AssertionError("VLM called")))
    monkeypatch.setattr(gate_module, "_codex_judge_backend_module", lambda: (_ for _ in ()).throw(AssertionError("Codex called")))

    grade = command.build_grade("creator-002", "dataset", plan_file, judge_backend="local-research")
    gate_document = load_json(Path(grade["gate"]))
    evaluation = load_json(Path(grade["gate"]).with_name("evaluation-inputs.json"))
    template = load_json(Path(grade["rulings_template"]))
    assert gate_document["judge_backend"] == "local-research"
    assert gate_document["judge_skipped"] is False
    assert gate_document["review_mode"] == "local-research"
    assert gate_document["summary"]["passed"] == 0
    assert gate_document["rows"][0]["stage1"]["pass"] is True
    assert gate_document["rows"][0]["pass"] is False
    assert gate_document["rows"][0]["reasons"] == ["unavailable: judge"]
    assert set(gate_document["research_provenance"]) == {"executing_cli_sha256", "identity_gate_sha256", "stage2"}
    assert evaluation["review_mode"] == "local-research"
    assert evaluation["research_provenance"] == gate_document["research_provenance"]
    assert evaluation["subject"]["numeric_gate"]["sha256"] == command._sha256(Path(grade["gate"]))
    assert template["rulings"][0]["gate_override"] == ""
    board = Path(grade["page"]).read_text(encoding="utf-8")
    assert "Local research mode ran stage-1 diagnostics only" in board
    assert "Research review candidates" in board
    assert f"1. {gate_document['rows'][0]['image_id']}" in board
    assert "unavailable: judge" in board
    assert '<details class="failed-gate">' not in board


def test_run_identity_gate_delegates_to_identity_gate_run_two_stage_gate(command, tmp_path, monkeypatch):
    """The refactor's contract (identity_gate.py's plan-independent `run` CLI and this
    module's own `build_grade` must share ONE gate composition, never duplicate it):
    `_run_identity_gate` is now a thin wrapper around
    `identity_gate.run_two_stage_gate`. Proof: calling that shared function directly
    on the exact same plan-derived anchors/images/persona/grade_dir `build_grade` used
    produces the byte-identical `figment/gate@1` document `build_grade` itself wrote."""
    plan_file, grade, gate_module, judge_calls = _build_grade_with_fake_stage1_and_judge(
        command, tmp_path, monkeypatch, out_name="delegates-plan",
        judge_row_factory=lambda image_id: _fake_judge_row(image_id),
    )
    gate_document = load_json(Path(grade["gate"]))

    plan, root = command._load_plan("creator-002", plan_file)
    anchors = [(root / value).resolve() for value in plan["assets"]["anchors"]]
    images = command._grading_images(plan, root, "dataset")
    grade_dir = root / "grade" / "dataset"
    persona = command._load_persona_document_for_gate(plan)

    direct_document = gate_module.run_two_stage_gate(
        lambda: persona, anchors, images, grade_dir, skip_judge=False,
    )
    assert direct_document == gate_document


def test_run_identity_gate_threads_explicit_codex_backend(command, tmp_path, monkeypatch):
    captured = {}

    class FakeGateModule:
        @staticmethod
        def run_two_stage_gate(load_persona, anchors, images, grade_dir, **kwargs):
            captured.update(kwargs)
            return {"schema": "figment/gate@1", "rows": []}

    monkeypatch.setattr(command, "_identity_gate_module", lambda: FakeGateModule)
    command._run_identity_gate(
        {}, [], [], tmp_path / "grade", judge_backend="codex-diagnostic",
    )
    assert captured == {"skip_judge": False, "judge_backend": "codex-diagnostic"}


def test_grade_parser_defaults_to_claude_and_accepts_explicit_codex(command):
    parser = command.build_parser()
    common = ["grade", "--creator", "creator-001", "--stage", "tester"]
    assert parser.parse_args(common).judge_backend == "claude"
    assert parser.parse_args([*common, "--judge-backend", "codex-diagnostic"]).judge_backend == "codex-diagnostic"
    assert parser.parse_args([*common, "--judge-backend", "local-research"]).judge_backend == "local-research"


def _build_grade_with_fake_stage1_and_judge(
    command, tmp_path, monkeypatch, *, out_name: str, judge_row_factory,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    out = tmp_path / out_name
    command.build_plan("creator-002", "dataset", out, personas_root=personas_root, skip_pin_verify=True)
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    gate_module = command._identity_gate_module()
    monkeypatch.setattr(gate_module, "score_cells_for_stage", _fake_score_cells_for_stage)

    real_vlm_judge = gate_module._vlm_judge_module()
    judge_calls = {"n": 0}

    class FakeJudgeModule:
        judge_gate = staticmethod(real_vlm_judge.judge_gate)

        @staticmethod
        def judge_images_for_stage(images, references, *, cache_dir=None, **kwargs):
            judge_calls["n"] += 1
            return [judge_row_factory(item["image_id"]) for item in images]

    monkeypatch.setattr(gate_module, "_vlm_judge_module", lambda: FakeJudgeModule())

    grade = command.build_grade("creator-002", "dataset", plan_file)
    return plan_file, grade, gate_module, judge_calls


# ---------------------------------------------------------------------------
# Path-A train-first (r24 method 4 + r21 DOP + r25 causes #4/#5): a curated
# selection of EXISTING evidence (select_training_cells.py + build_training_set.py
# --mode provided) trains the LoRA directly, bypassing the module-10 dataset stage's
# fresh generate-then-grade loop. `build_train_first_plan` is deliberately NOT part
# of the STAGES/build_plan/run_planned_stage state machine -- it reuses the same
# manifest-emission helpers (_train_manifest, _tester_manifest, _pod_base,
# _planned_run) but never touches anchor/dataset/apply_rulings at all.
# ---------------------------------------------------------------------------


def _prebuilt_dataset_dir(path: Path, *, command, count: int = 20) -> Path:
    """A dataset directory shaped exactly like build_training_set.py's output
    contract -- NN.png/.txt pairs, dataset_manifest.json, _dataset.ready written
    last -- WITHOUT training.json, since build_train_first_plan renders and writes
    that itself (mirroring _install_stage_config's own division of labor)."""
    path.mkdir(parents=True, exist_ok=True)
    files = []
    for index in range(1, count + 1):
        stem = f"{index:02d}"
        image_path = path / f"{stem}.png"
        image_path.write_bytes(PNG_1X1)
        (path / f"{stem}.txt").write_text("creator001krea2 woman\n", encoding="utf-8")
        files.append({
            "image": f"{stem}.png", "caption_file": f"{stem}.txt",
            "sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
        })
    (path / "dataset_manifest.json").write_text(
        json.dumps({"count": count, "caption_mode": "provided", "files": files}), encoding="utf-8",
    )
    (path / "_dataset.ready").write_text("", encoding="utf-8")
    command.accept_train_first_dataset(
        "creator-002", path, decided_by="operator-fixture",
        decided_at="2026-09-08T00:00:00Z",
    )
    return path


def test_build_train_first_plan_emits_train_and_tester_manifests_that_dry_run(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)  # steps=600, save_every=200 -> ladder [200, 400] + final
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset", command=command)
    out = tmp_path / "train-first-plan"

    plan = command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )

    assert plan["schema"] == "figment/train-plan@1"
    assert plan["variant"] == "train-first"
    assert plan["assets"]["anchors"]
    for relative in plan["assets"]["anchors"]:
        assert (out / relative).is_file()
    train_path = out / "train" / "runs" / "creator-002-tensor-train-first.yaml"
    tester_path = out / "train" / "runs" / "creator-002-tensor-tester-first.yaml"
    assert train_path.is_file() and tester_path.is_file()

    train_manifest = load_json(train_path)
    dataset_dirname = "creator-002-tensor-dataset-train-first"
    assert train_manifest["uploads"][0]["files"] == [
        f"{dataset_dirname}/*.png", f"{dataset_dirname}/*.txt",
        f"{dataset_dirname}/training.json",
    ]
    assert len(train_manifest["artifacts"]) == 3  # 2 intermediates + final, per steps/save_every

    tester_manifest = load_json(tester_path)
    assert tester_manifest["uploads"][0]["files"] == [
        "out/creator-002-tensor-train-first/*.safetensors",
    ]
    assert len(tester_manifest["jobs"]) == 3

    copied_dataset_dir = out / "train" / "runs" / dataset_dirname
    assert (copied_dataset_dir / "01.png").is_file()
    assert (copied_dataset_dir / "02.png").is_file()
    assert (copied_dataset_dir / "_dataset.ready").is_file()
    rendered = load_json(copied_dataset_dir / "training.json")
    train_section = rendered["config"]["process"][0]["train"]
    assert train_section["steps"] == 600
    assert train_section["diff_output_preservation"] is False
    assert "trigger_word" not in rendered["config"]["process"][0]

    pod_module = command._pod_runner_module()
    for run in (plan["stages"]["train"]["runs"][0], plan["stages"]["tester"]["runs"][0]):
        manifest_path = out / run["manifest"]
        result = subprocess.run(
            run["argv"] + ["--dry-run"], cwd=ROOT, capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr
        pod_module.require_manifest(load_json(manifest_path), manifest_path, allow_missing_uploads=True)


def test_build_train_first_plan_honors_dop_from_the_persona_training_config(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    persona_path = _synthetic_persona(personas_root)
    persona_document = load_json(persona_path)
    persona_document["training"]["dop_enabled"] = True
    persona_document["training"]["dop_multiplier"] = 2.0
    persona_document["training"]["dop_class"] = "woman"
    persona_path.write_text(json.dumps(persona_document, indent=2), encoding="utf-8")
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset", command=command)
    out = tmp_path / "train-first-dop"

    command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )

    rendered = load_json(
        out / "train" / "runs" / "creator-002-tensor-dataset-train-first" / "training.json",
    )
    process = rendered["config"]["process"][0]
    assert process["train"]["diff_output_preservation"] is True
    assert process["train"]["diff_output_preservation_multiplier"] == pytest.approx(2.0)
    assert process["train"]["diff_output_preservation_class"] == "woman"
    assert process["trigger_word"] == "creator002krea2"


def test_build_train_first_plan_requires_the_dataset_ready_marker(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    dataset_dir = tmp_path / "not-ready"
    dataset_dir.mkdir()
    (dataset_dir / "01.png").write_bytes(PNG_1X1)

    with pytest.raises(command.FigmentTrainError, match="not ready"):
        command.build_train_first_plan(
            "creator-002", dataset_dir, tmp_path / "out",
            personas_root=personas_root, skip_pin_verify=True,
        )


def test_train_first_cli_subcommand_is_registered_and_parses(command):
    """`main()`'s CLI layer has no way to redirect PERSONAS_ROOT (same as every other
    subcommand -- `plan`'s own CLI is untested against a synthetic persona for the
    identical reason), so this only proves the subcommand exists and its argparse
    wiring is correct; `build_train_first_plan` itself is covered directly above."""
    parser = command.build_parser()
    args = parser.parse_args([
        "train-first", "--creator", "creator-002", "--dataset-dir", "d", "--out", "o",
        "--skip-pin-verify",
    ])
    assert args.command == "train-first"
    assert args.creator == "creator-002"
    assert args.dataset_dir == Path("d")
    assert args.out == Path("o")
    assert args.skip_pin_verify is True


def test_build_train_first_plan_refuses_to_overwrite_an_existing_plan(command, tmp_path):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset", command=command)
    out = tmp_path / "train-first-plan"
    command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )
    with pytest.raises(command.FigmentTrainError, match="refusing to overwrite"):
        command.build_train_first_plan(
            "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
        )


# ---------------------------------------------------------------------------
# Defect fix: train-first is now a first-class VARIANT of the one plan.json schema
# (`figment/train-plan@1`, `variant: "train-first"`) instead of a separately-schemad
# `train_first_plan.json` `run --plan` rejected -- the split the operator wanted gone
# ("slim infra, one pipeline"). These three tests prove `run`/`grade` work UNCHANGED
# against a train-first plan, and that its schema is the normal one plus documented
# extras only.
# ---------------------------------------------------------------------------


def test_build_train_first_plan_shares_the_normal_plan_schema_plus_documented_extras(
    command, tmp_path,
):
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset", command=command)

    # M2: schema comparison check, not a budget check -- see the accept_budget note above.
    normal_plan = command.build_plan(
        "creator-002", "all", tmp_path / "normal-plan",
        personas_root=personas_root, skip_pin_verify=True, accept_budget=True,
    )
    train_first_plan = command.build_train_first_plan(
        "creator-002", dataset_dir, tmp_path / "train-first-plan",
        personas_root=personas_root, skip_pin_verify=True, accept_budget=True,
    )

    assert train_first_plan["schema"] == normal_plan["schema"] == "figment/train-plan@1"
    # The variant and its accepted dataset lineage are the only extra top-level facts;
    # everything else (assets, configs, ledger_dir, ...) has the normal plan shape.
    assert set(train_first_plan) - set(normal_plan) == {"variant", "dataset_approval"}
    assert train_first_plan["variant"] == "train-first"
    assert set(normal_plan) - set(train_first_plan) == set()

    assert set(train_first_plan["stages"]) == {"train", "tester"}
    for stage in ("train", "tester"):
        normal_run = normal_plan["stages"][stage]["runs"][0]
        train_first_run = train_first_plan["stages"][stage]["runs"][0]
        assert set(train_first_run) == set(normal_run), f"runs[] shape differs for {stage!r}"

    # The training block: the persona's own dop_*/steps/save_every are unchanged, plus
    # this variant's one extra fact, which already-built dataset directory it trained
    # from.
    for key in ("dop_enabled", "dop_multiplier", "dop_class", "steps", "save_every"):
        assert train_first_plan["training"][key] == normal_plan["training"][key]
    assert Path(train_first_plan["training"]["dataset_dir"]) == dataset_dir.resolve()
    assert "dataset_dir" not in normal_plan["training"]

    assert train_first_plan["assets"]["anchors"]
    assert train_first_plan["assets"]["persona_dir"] == normal_plan["assets"]["persona_dir"]


def test_train_first_plan_run_stage_all_executes_train_then_tester_in_order(
    command, tmp_path, monkeypatch,
):
    """`run --stage all --plan <train-first plan.json>` must work completely unchanged
    from a normal plan -- same `run_planned_stage`, same `_install_stage_config` skip
    for this variant, same `verify_run_record`/ledger-agreement contract. A fake
    harness runner stands in for the real pod/runpod_run.py subprocess (never launched
    here) and records the order the two stages actually ran in."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)  # steps=600, save_every=200 -> 2 checkpoints + final
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset", command=command)
    out = tmp_path / "train-first-run"

    ledger_dir = tmp_path / "ledger"
    ledger_dir.mkdir()
    ledger_path = ledger_dir / "figment-2026-09-04.tsv"
    ledger_path.write_text("model\tstep\tusd\n", encoding="utf-8")
    plan = command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
        ledger_dir=ledger_dir,
    )
    assert plan["ledger_dir"] == str(ledger_dir)

    pod_module = command._pod_runner_module()
    order: list[str] = []

    def _fake_harness_run(argv, cwd=None):
        manifest_path = Path(argv[argv.index("--manifest") + 1])
        run_out = Path(argv[argv.index("--out") + 1])
        manifest = load_json(manifest_path)
        order.append(manifest_path.stem)
        run_out.mkdir(parents=True, exist_ok=True)
        pod_id = f"pod-{manifest_path.stem}"
        model = pod_module.gpu_model_label(manifest["gpu"]["type"])
        run_doc = {
            "error": None,
            "pod_id": pod_id,
            "gpu": manifest["gpu"],
            "termination_verified": True,
            "estimated_actual_usd": 0.25,
            "ledger_day": "2026-09-04",
            "placement_attempts": [{
                "pod_id": pod_id, "estimated_actual_usd": 0.25, "termination_verified": True,
            }],
        }
        expected_artifacts = manifest.get("artifacts") or []
        if expected_artifacts:
            for row in expected_artifacts:
                (run_out / row["local"]).write_bytes(b"x" * 12)
            run_doc["artifacts"] = [
                {"remote": row["remote"], "bytes": 12} for row in expected_artifacts
            ]
        else:
            run_doc["jobs"] = [
                {
                    "output_name": job["output_name"],
                    "files": [{"bytes": 12} for _ in range(job.get("expected_images", 1))],
                }
                for job in manifest.get("jobs") or []
            ]
        (run_out / "run.json").write_text(json.dumps(run_doc), encoding="utf-8")
        with ledger_path.open("a", encoding="utf-8") as handle:
            handle.write(f"{model}\tpod-create {pod_id}\t0.250000\n")
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(command.subprocess, "run", _fake_harness_run)

    state = command.run_planned_stage("creator-002", "all", out / "plan.json")

    assert order == ["creator-002-tensor-train-first", "creator-002-tensor-tester-first"]
    assert state["status"] == "complete"
    assert state["completed_stages"] == ["train", "tester"]


def test_train_first_plan_grade_stage_tester_works(command, tmp_path):
    """`grade --stage tester` (`build_grade`) must also work unchanged against a
    train-first plan -- proof that `plan["assets"]["anchors"]` is populated with real,
    `out`-relative anchor files the same way a normal plan's is."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset", command=command)
    out = tmp_path / "train-first-grade"

    plan = command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )
    tester_run = plan["stages"]["tester"]["runs"][0]
    manifest = load_json(out / tester_run["manifest"])
    run_out = out / tester_run["out"]
    run_out.mkdir(parents=True)
    for job in manifest["jobs"]:
        (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)

    grade = command.build_grade("creator-002", "tester", out / "plan.json", skip_judge=True)

    template = load_json(Path(grade["rulings_template"]))
    assert len(template["rulings"]) == len(manifest["jobs"]) == 3
    page_text = Path(grade["page"]).read_text(encoding="utf-8")
    assert "<img" in page_text
    assert "full-resolution" in page_text


# ---------------------------------------------------------------------------
# Defect fix: the train stage's wall-clock budget (job_timeout_seconds/max_minutes/
# ceiling_usd) used to be a static pod-class pin regardless of training.steps and
# training.dop_enabled -- a DOP run's real ~9s/step cost could blow through a fixed 3h
# job_timeout / 270min ceiling mid-training. It must now derive from steps + dop_enabled,
# never dropping below the tensor-pins.yaml floor.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "steps, save_every, dop_enabled, expected_job_timeout_seconds, expected_max_minutes",
    [
        # 2000 steps, no DOP: candidate (2000*2.5+900)*1.35=7965 < the 10800s pin floor,
        # so both job_timeout_seconds and max_minutes stay exactly at the pod-class pin.
        (2000, 500, False, 10800, 270),
        # 1250 steps, DOP (creator-001's real, live training.yaml config): candidate
        # (1250*9.0+900)*1.35=16402.5 -> ceil 16403, above the floor; max_minutes follows
        # from minimum_runtime_minutes on that raised job_timeout (5 artifacts: 4
        # intermediates + final).
        (1250, 250, True, 16403, 351),
        # 1000 steps, DOP: (1000*9.0+900)*1.35=13365, above the floor; 4 artifacts.
        (1000, 250, True, 13365, 297),
        # 3000 steps, no DOP: (3000*2.5+900)*1.35=11340, ABOVE the 10800s job_timeout
        # floor, but minimum_runtime_minutes for that job_timeout (6 artifacts) still
        # comes out under the 270min max_minutes floor -- the two floors are independent
        # per the spec formula, and max_minutes must never drop below its own pin.
        (3000, 500, False, 11340, 270),
    ],
)
def test_train_manifest_budget_derives_from_steps_and_dop(
    command, steps, save_every, dop_enabled,
    expected_job_timeout_seconds, expected_max_minutes,
):
    pins = command._read_json(command.PINS_PATH)
    floor = pins["pod_classes"]["l40s"]["stages"]["train"]
    persona = {"id": "creator-999"}
    training = {
        "trigger": "creator999krea2", "caption_mode": "provided", "pod_class": "l40s",
        "steps": steps, "save_every": save_every, "dop_enabled": dop_enabled,
    }

    manifest = command._train_manifest(persona, training, pins, smoke=False)

    assert manifest["job_timeout_seconds"] == expected_job_timeout_seconds
    assert manifest["max_minutes"] == expected_max_minutes
    # Floors: the pod-class pin is never exceeded downward.
    assert manifest["job_timeout_seconds"] >= floor["job_timeout_seconds"]
    assert manifest["max_minutes"] >= floor["max_minutes"]
    # readiness and per-artifact download allowance are untouched by this defect fix.
    assert manifest["readiness_timeout_seconds"] == floor["readiness_timeout_seconds"] == 3600
    assert manifest["artifact_download_seconds"] == floor["artifact_download_seconds"] == 180

    budget = manifest["_budget"]
    assert budget["per_step_s"] == (9.0 if dop_enabled else 2.5)
    assert budget["steps"] == steps
    assert budget["job_timeout_seconds"] == expected_job_timeout_seconds
    assert budget["max_minutes"] == expected_max_minutes
    assert budget["ceiling_usd"] == command.manifest_ceiling(
        {"price_usd_per_hour": manifest["price_usd_per_hour"], "max_minutes": expected_max_minutes},
    )


def test_train_manifest_budget_never_applies_to_the_smoke_stage(command):
    """The smoke stage always trains steps=100/save_every=50 regardless of the
    persona's real training.steps -- its job_timeout_seconds/max_minutes must stay the
    static pod-class pin, untouched by this defect fix."""
    pins = command._read_json(command.PINS_PATH)
    floor = pins["pod_classes"]["l40s"]["stages"]["smoke"]
    persona = {"id": "creator-999"}
    training = {
        "trigger": "creator999krea2", "caption_mode": "provided", "pod_class": "l40s",
        "steps": 3000, "save_every": 250, "dop_enabled": True,
    }

    manifest = command._train_manifest(persona, training, pins, smoke=True)

    assert manifest["job_timeout_seconds"] == floor["job_timeout_seconds"]
    assert manifest["max_minutes"] == floor["max_minutes"]
    assert "_budget" not in manifest


def test_build_plan_train_run_entry_carries_budget_and_dry_runs_clean_under_dop(
    command, tmp_path,
):
    """End to end through `build_plan`: a DOP persona's `train` run entry in plan.json
    carries the derived `budget`, its manifest's job_timeout_seconds/max_minutes agree
    with it, and the manifest dry-runs clean through the real pod harness (proving
    `require_manifest`'s own max_minutes >= minimum_runtime_minutes check is satisfied,
    not just that the numbers look right in isolation)."""
    personas_root = tmp_path / "personas"
    persona_path = _synthetic_persona(personas_root, creator_id="creator-002")
    persona_document = load_json(persona_path)
    persona_document["training"]["dop_enabled"] = True
    persona_document["training"]["steps"] = 1250
    persona_document["training"]["save_every"] = 250
    persona_path.write_text(json.dumps(persona_document, indent=2), encoding="utf-8")
    out = tmp_path / "dop-train-plan"

    plan = command.build_plan(
        "creator-002", "train", out, personas_root=personas_root, skip_pin_verify=True,
    )

    run = plan["stages"]["train"]["runs"][0]
    manifest = load_json(out / run["manifest"])
    assert run["budget"] == {
        "per_step_s": 9.0, "steps": 1250,
        "job_timeout_seconds": 16403, "max_minutes": 351, "ceiling_usd": "7.61",
    }
    assert manifest["job_timeout_seconds"] == run["budget"]["job_timeout_seconds"]
    assert manifest["max_minutes"] == run["budget"]["max_minutes"]
    assert run["ceiling_usd"] == run["budget"]["ceiling_usd"]
    assert "--max-minutes" in run["argv"]
    assert run["argv"][run["argv"].index("--max-minutes") + 1] == "351"

    result = subprocess.run(run["argv"] + ["--dry-run"], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_build_train_first_plan_train_run_entry_carries_budget(command, tmp_path):
    """The train-first entry point shares `_train_manifest`/`_planned_run` with the
    normal plan, so its `train` run entry must carry the same derived `budget` shape."""
    personas_root = tmp_path / "personas"
    persona_path = _synthetic_persona(personas_root)
    persona_document = load_json(persona_path)
    persona_document["training"]["dop_enabled"] = True
    persona_document["training"]["steps"] = 1000
    persona_document["training"]["save_every"] = 250
    persona_path.write_text(json.dumps(persona_document, indent=2), encoding="utf-8")
    dataset_dir = _prebuilt_dataset_dir(tmp_path / "prebuilt-dataset", command=command)
    out = tmp_path / "train-first-budget"

    plan = command.build_train_first_plan(
        "creator-002", dataset_dir, out, personas_root=personas_root, skip_pin_verify=True,
    )

    run = plan["stages"]["train"]["runs"][0]
    assert run["budget"] == {
        "per_step_s": 9.0, "steps": 1000,
        "job_timeout_seconds": 13365, "max_minutes": 297, "ceiling_usd": "6.44",
    }
    manifest = load_json(out / run["manifest"])
    assert manifest["job_timeout_seconds"] == 13365
    assert manifest["max_minutes"] == 297
    # tester never carries a budget -- only the train stage's job_timeout_seconds scales
    # with training.steps/dop_enabled.
    assert "budget" not in plan["stages"]["tester"]["runs"][0]


def test_print_train_budget_prints_the_derived_numbers(command, capsys):
    result = {
        "stages": {
            "train": {"runs": [{"budget": {
                "per_step_s": 9.0, "steps": 1250,
                "job_timeout_seconds": 16403, "max_minutes": 351, "ceiling_usd": "7.61",
            }}]},
        },
    }

    command._print_train_budget(result)

    out = capsys.readouterr().out
    assert "steps=1250" in out
    assert "per_step_s=9.0" in out
    assert "job_timeout_seconds=16403" in out
    assert "max_minutes=351" in out
    assert "ceiling_usd=$7.61" in out


def test_print_train_budget_is_silent_when_the_stage_was_not_planned(command, capsys):
    command._print_train_budget({"stages": {"dataset": {"runs": []}}})
    assert capsys.readouterr().out == ""


def test_planning_freezes_explicit_ledger_for_both_plan_entrypoints_and_harness_budget(
    command, tmp_path, monkeypatch,
):
    """A plan must bind the exact ledger its later harness argv will budget against.

    The two fixture ledgers deliberately disagree: choosing the stale environment ledger
    would leave $49 available, while the explicit reconciled ledger leaves one dollar.
    This uses the real harness's local arc-budget function;
    no harness invocation, auth, or provider call occurs.
    """
    reconciled = tmp_path / "reconciled" / "cost"
    stale = tmp_path / "stale-worktree" / "cost"
    for directory, usd in ((reconciled, "49.000000"), (stale, "1.000000")):
        directory.mkdir(parents=True)
        (directory / "figment-fixture.tsv").write_text(
            f"model\tstep\tusd\nrunpod:test\tprior\t{usd}\n", encoding="utf-8",
        )
    monkeypatch.setenv("KB_LEDGER_DIR", str(stale))

    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    # M2: this fixture deliberately seeds `reconciled` down to $1.00 remaining to prove
    # ledger *selection*, not budget refusal -- accept explicitly.
    normal = command.build_plan(
        "creator-002", "smoke", tmp_path / "normal", personas_root=personas_root,
        skip_pin_verify=True, ledger_dir=reconciled, accept_budget=True,
    )
    dataset = _prebuilt_dataset_dir(tmp_path / "dataset", command=command)
    # Same deliberately-thin `reconciled` ledger as `normal` above -- accept explicitly.
    train_first = command.build_train_first_plan(
        "creator-002", dataset, tmp_path / "train-first", personas_root=personas_root,
        skip_pin_verify=True, ledger_dir=reconciled, accept_budget=True,
    )

    expected = str(reconciled.resolve())
    assert normal["ledger_dir"] == train_first["ledger_dir"] == expected
    for plan in (normal, train_first):
        for stage in plan["stages"].values():
            for run in stage["runs"]:
                argv = run["argv"]
                assert argv[argv.index("--ledger-dir") + 1] == expected

    pod_module = command._pod_runner_module()
    with pytest.raises(pod_module.HarnessError, match="ARC CAP REFUSED"):
        pod_module.enforce_arc_cap(
            2.0, arc_cap_usd=50.0, ledger_dir=Path(normal["ledger_dir"]),
        )
    assert pod_module.enforce_arc_cap(2.0, arc_cap_usd=50.0, ledger_dir=stale) == (50.0, 1.0)

    env_plan = command.build_plan(
        "creator-002", "smoke", tmp_path / "environment", personas_root=personas_root,
        skip_pin_verify=True,
    )
    assert env_plan["ledger_dir"] == str(stale.resolve())


def _repo_figment_ledger_total(pod_module) -> float:
    """Independent (non-`arc_budget_state`) sum of every real `figment-*.tsv` row in
    the repo's own `ledgers/cost/`, for cross-checking E3's merged ledger."""
    total = 0.0
    for path in sorted(pod_module.repo_ledger_dir().glob("figment-*.tsv")):
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            if not reader.fieldnames or "usd" not in reader.fieldnames:
                continue
            for row in reader:
                total += float(row["usd"])
    return total


def test_repo_ledger_is_the_default_single_arc_cap_ledger_e3(
    command, tmp_path, monkeypatch,
):
    """E3: after reconciling every historical `figment-*.tsv` row into this repo's own
    `ledgers/cost/` (union merge, no duplicate/superseded rows -- the two 2026-09-07
    `pod-orphan-estimate` placeholders are superseded by their `pod-orphan-reconciled`
    corrections, never double-counted), the repo directory alone must be a truthful,
    self-sufficient arc-cap ledger: a plan built with no `--ledger-dir` and no managed
    OPS worktree present resolves straight to it, and the harness's own arc-cap function
    sums it to the same total an independent read gets.
    """
    pod_module = command._pod_runner_module()
    monkeypatch.delenv("KB_LEDGER_DIR", raising=False)
    monkeypatch.setattr(pod_module, "OPS_LEDGER_DIR", tmp_path / "no-ops-worktree-here")

    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    plan = command.build_plan(
        "creator-002", "smoke", tmp_path / "default-ledger", personas_root=personas_root,
        skip_pin_verify=True,
    )

    assert plan["ledger_dir"] == str(pod_module.repo_ledger_dir().resolve())

    expected_total = _repo_figment_ledger_total(pod_module)
    # The brief's own recorded figure for the reconciled repo total (rounds to $33.72);
    # a hard floor here catches an accidental partial merge without pinning every cent.
    assert expected_total == pytest.approx(33.7234, abs=0.01)

    cap, spent = pod_module.arc_budget_state(
        arc_cap_usd=50.0, ledger_dir=Path(plan["ledger_dir"]),
    )
    assert cap == 50.0
    assert spent == pytest.approx(expected_total)

    # The 2026-09-07 supersession specifically: no leftover "pod-orphan-estimate" row
    # survives the merge once its "pod-orphan-reconciled" correction is present.
    day_ledger = pod_module.repo_ledger_dir() / "figment-2026-09-07.tsv"
    text = day_ledger.read_text(encoding="utf-8")
    assert "pod-orphan-estimate" not in text
    assert text.count("pod-orphan-reconciled") == 2


def test_creator001_live_3000_step_train_ceiling_still_clears_the_arc_cap_f5(
    command, tmp_path, monkeypatch,
):
    """F5: `personas/creator-001/training.yaml` now reads `steps: 3000` (DOP stays on,
    see TENSOR-TRAINING.md "Step count: 3000, screened by the tester" and r25 causes
    #4/#6). `_apply_train_budget` derives a ceiling from that (~$15.73) which exceeds the
    $10.00 daily cap on its own (a separate, deliberate consequence -- see
    train/tests/test_tensor_track.py's
    test_train_manifest_ceiling_exceeds_the_daily_cap_and_is_refused_by_it) but must still
    clear the much larger $50.00 whole-arc cap against the real, reconciled repo ledger
    (E3) -- this is the actual gate `run --stage train` checks before ever creating a pod.
    """
    pod_module = command._pod_runner_module()
    monkeypatch.delenv("KB_LEDGER_DIR", raising=False)
    monkeypatch.setattr(pod_module, "OPS_LEDGER_DIR", tmp_path / "no-ops-worktree-here")

    plan = command.build_plan("creator-001", "train", tmp_path / "plan", skip_pin_verify=True)
    train_run = plan["stages"]["train"]["runs"][0]
    budget = train_run["budget"]

    assert budget["steps"] == 3000
    checkpoints = command._checkpoint_steps(3000, 250)
    assert len(checkpoints) == 11, "11 intermediates (250..2750) plus the final = 12 total"

    ceiling = float(budget["ceiling_usd"])
    cap, spent = pod_module.arc_budget_state(
        arc_cap_usd=50.0, ledger_dir=Path(plan["ledger_dir"]),
    )
    assert spent + ceiling <= cap, (
        f"train's own ceiling ${ceiling:.2f} plus ${spent:.2f} already spent must still "
        f"clear the ${cap:.2f} arc cap"
    )
    # Not a tautology: this is a real, narrow margin at steps=3000 -- prove it is not
    # trivially satisfied by an oversized cap or an emptied-out ledger.
    assert cap - (spent + ceiling) < 1.0


def test_build_plan_refuses_when_planned_ceilings_exceed_remaining_arc_and_records_with_accept(
    command, tmp_path,
):
    """M2 reproduction: `enforce_arc_cap` only ever compares ONE run's ceiling against
    the arc cap, at RUN time -- a multi-stage plan (anchor+dataset+smoke+train+tester)
    can therefore be accepted for planning even though its SUM cannot possibly clear the
    arc, and the operator only discovers this mid-chain, after anchor+dataset already
    spent. `build_plan` must refuse such a plan up front unless --accept-budget is
    passed, and record the numbers on the plan when it is."""
    ledger_dir = tmp_path / "ledger"
    ledger_dir.mkdir()
    # Seed the arc ledger so only $1.00 remains of the $50.00 cap -- any nonzero
    # multi-stage synthetic plan's summed ceilings exceed that.
    (ledger_dir / "figment-2026-01-01.tsv").write_text(
        "model\tstep\tusd\n" "l40s\tpod-create seed\t49.000000\n", encoding="utf-8",
    )
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)

    with pytest.raises(command.FigmentTrainError, match="budget preflight refused"):
        command.build_plan(
            "creator-002", "all", tmp_path / "refused", personas_root=personas_root,
            skip_pin_verify=True, ledger_dir=ledger_dir,
        )
    assert not (tmp_path / "refused" / "plan.json").exists()

    accepted = command.build_plan(
        "creator-002", "all", tmp_path / "accepted", personas_root=personas_root,
        skip_pin_verify=True, ledger_dir=ledger_dir, accept_budget=True,
    )
    preflight = accepted["budget_preflight"]
    assert preflight["accepted"] is True
    assert preflight["over_arc"] is True
    assert preflight["arc_remaining_usd"] == "1.00"
    assert float(preflight["total_planned_usd"]) > 1.00
    written = load_json(tmp_path / "accepted" / "plan.json")
    assert written["budget_preflight"] == preflight


def test_build_plan_names_a_single_run_over_the_daily_limit_without_refusing(
    command, tmp_path,
):
    """M2 (b): a run's own ceiling bigger than governance/budget.yaml's daily_usd_limit
    is real and expected for `train` at DOP step counts (F5 ruling) -- it must be named
    in the preflight table but never block planning by itself (the live run itself is
    still gated on its own spend day by the unchanged `enforce_daily_budget`)."""
    ledger_dir = tmp_path / "ledger"
    ledger_dir.mkdir()  # empty: arc_spent == 0, so a $50 cap is nowhere near exceeded.
    plan = command.build_plan(
        "creator-001", "train", tmp_path / "plan", skip_pin_verify=True,
        ledger_dir=ledger_dir,
    )
    preflight = plan["budget_preflight"]
    train_run = plan["stages"]["train"]["runs"][0]
    assert float(train_run["ceiling_usd"]) > float(preflight["daily_usd_limit"])
    assert preflight["over_arc"] is False
    assert preflight["accepted"] is False
    assert train_run["manifest"] in preflight["runs_over_daily_limit"]


def test_apply_rulings_dataset_stage_routes_through_the_live_qwen3vl_job_when_declared(
    command, tmp_path, monkeypatch,
):
    """M4 end-to-end (offline): `training.caption_mode == "qwen3vl"` routes
    apply-rulings' dataset-stage local assembly through `_live_qwen3vl_job_runner` --
    one pinned pod job is planned and dispatched (the fake harness proves the SAME
    argv/ledger contract every other stage's live call uses), its `captions.json`
    artifact is read back, and the resulting `dataset_manifest.json`/
    `dataset-approval.json` carry `caption_mode: "qwen3vl"` with a bound
    `caption_sha256` per row -- `lineage.dataset_subject` (called by apply_rulings
    itself right after) accepts it, proving the M4(b) lineage widening end to end."""
    personas_root = tmp_path / "personas"
    _synthetic_persona(personas_root)
    persona_path = personas_root / "creator-002" / "persona.yaml"
    persona_document = load_json(persona_path)
    persona_document.setdefault("training", {})["caption_mode"] = "qwen3vl"
    persona_path.write_text(json.dumps(persona_document, indent=2) + "\n", encoding="utf-8")
    out = tmp_path / "qwen3vl-dataset"
    ledger_dir = tmp_path / "ledger"
    ledger_dir.mkdir()
    ledger = ledger_dir / "figment-2026-09-15.tsv"
    ledger.write_text("model\tstep\tusd\n", encoding="utf-8")

    command.build_plan(
        "creator-002", "dataset", out, personas_root=personas_root,
        skip_pin_verify=True, ledger_dir=ledger_dir,
    )
    plan_file = out / "plan.json"
    plan = load_json(plan_file)
    for run in plan["stages"]["dataset"]["runs"]:
        manifest = load_json(plan_path(out, run))
        run_out = out / run["out"]
        run_out.mkdir(parents=True)
        for job in manifest["jobs"]:
            (run_out / f"{job['output_name']}.png").write_bytes(PNG_1X1)
    grade = command.build_grade("creator-002", "dataset", plan_file)
    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
            "gate_override": "operator manually confirmed identity from the full-res original",
        })
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:00:00Z"})
    filled = Path(grade["rulings_template"]).with_name("qwen3vl-filled.json")
    filled.write_text(json.dumps(template), encoding="utf-8")

    calls: list[str] = []

    def fake_harness(argv, cwd=None):
        manifest_path = Path(argv[argv.index("--manifest") + 1])
        run_out_dir = Path(argv[argv.index("--out") + 1])
        job_manifest = load_json(manifest_path)
        calls.append(manifest_path.name)
        run_out_dir.mkdir(parents=True, exist_ok=True)
        images_dir = manifest_path.parent / "_uploads" / "creator-002"
        captions = {
            p.name: f"a photo of the subject, cell {index}"
            for index, p in enumerate(sorted(images_dir.glob("*.png")))
        }
        (run_out_dir / "captions.json").write_text(json.dumps(captions), encoding="utf-8")
        pod_id = "pod-caption-1"
        receipt = {
            "error": None, "dry_run": False, "pod_id": pod_id, "ledger_day": "2026-09-15",
            "termination_verified": True, "estimated_actual_usd": 0.01,
            "placement_attempts": [{
                "pod_id": pod_id, "estimated_actual_usd": 0.01, "termination_verified": True,
            }],
            "artifacts": [{
                "remote": "captions.json",
                "bytes": (run_out_dir / "captions.json").stat().st_size,
            }],
        }
        (run_out_dir / "run.json").write_text(json.dumps(receipt), encoding="utf-8")
        model = command._pod_runner_module().gpu_model_label(job_manifest["gpu"]["type"])
        with ledger.open("a", encoding="utf-8") as handle:
            handle.write(f"{model}\tpod-create {pod_id}\t0.010000\n")
        return type("Result", (), {"returncode": 0})()

    monkeypatch.setattr(command.subprocess, "run", fake_harness)
    result = command.apply_rulings("creator-002", "dataset", plan_file, filled)

    assert len(calls) == 1 and "tensor-caption.yaml" in calls[0]
    dataset_dir = out / "train" / "runs" / "creator-002-tensor-dataset"
    dataset_manifest = load_json(dataset_dir / "dataset_manifest.json")
    assert dataset_manifest["caption_mode"] == "qwen3vl"
    assert dataset_manifest["count"] == 30
    for row in dataset_manifest["files"]:
        caption_text = (dataset_dir / row["caption_file"]).read_text(encoding="utf-8")
        assert row["caption_sha256"] == hashlib.sha256(caption_text.encode("utf-8")).hexdigest()
        assert caption_text.startswith("creator002krea2 woman, a photo of the subject")
    assert (dataset_dir / "_dataset.ready").is_file()
    approval = load_json(dataset_dir / "dataset-approval.json")
    assert approval["schema"] == command._lineage_module().DATASET_APPROVAL_SCHEMA
    assert approval["subject"]["caption_mode"] == "qwen3vl"
    assert Path(result["approved_list"]).is_file()


def test_caption_manifest_carries_only_pinned_safetensors_and_no_pickle(command):
    pins = command._read_json(command.PINS_PATH)
    manifest = command._caption_manifest(pins, "creator-002", "creator002krea2", ["01.png", "02.png"])
    for model in manifest["models"]:
        assert model["filename"].endswith(".safetensors")
        assert not model["filename"].endswith((".pt", ".pth", ".pkl"))
        assert isinstance(model["sha256"], str) and len(model["sha256"]) == 64
    assert manifest["custom_nodes"] == []
    assert manifest["artifacts"] == [{
        "remote": "captions.json", "local": "captions.json",
        "type": "output", "wait_for": "_caption.complete",
    }]
    assert manifest["uploads"][0]["files"] == [
        "_uploads/creator-002/01.png", "_uploads/creator-002/02.png",
        "_uploads/creator-002/_images.ready",
    ]
    assert manifest["training"]["complete_marker"] == "/workspace/output/_caption.complete"
    assert manifest["training"]["failed_marker"] == "/workspace/output/_caption.failed"
    assert manifest["training"]["start_script_file"] == "start-qwen3vl-caption.sh.template"


def test_plan_qwen3vl_caption_writes_a_dry_manifest_and_never_touches_subprocess(
    command, tmp_path, monkeypatch,
):
    def _forbidden(*args, **kwargs):
        pytest.fail("plan_qwen3vl_caption must never invoke subprocess")
    monkeypatch.setattr(command.subprocess, "run", _forbidden)

    images_dir = tmp_path / "images"
    images_dir.mkdir()
    for name in ("a.png", "b.png"):
        (images_dir / name).write_bytes(PNG_1X1)
    plan_root = tmp_path / "plan"
    planned = command.plan_qwen3vl_caption(
        "creator-002", "creator002krea2",
        [images_dir / "a.png", images_dir / "b.png"], plan_root,
        skip_pin_verify=True, ledger_dir=tmp_path / "ledger",
    )
    manifest_path = plan_root / planned["manifest"]
    assert manifest_path.is_file()
    assert "--max-usd" in planned["argv"]
    assert planned["ceiling_usd"] == command.manifest_ceiling(load_json(manifest_path))


def test_live_qwen3vl_job_runner_rejects_a_pod_that_never_produced_captions(
    command, tmp_path, monkeypatch,
):
    """A pod that "succeeds" (rc=0, run.json termination_verified, and even claims a
    downloaded captions.json in run.json's own artifacts list) but whose captions.json
    is not actually on disk must still fail closed -- never silently promote an empty
    caption set on the strength of a claimed byte count alone."""
    ledger_dir = tmp_path / "ledger"
    ledger_dir.mkdir()
    ledger = ledger_dir / "figment-2026-09-15.tsv"
    ledger.write_text("model\tstep\tusd\n", encoding="utf-8")

    def fake_harness(argv, cwd=None):
        manifest_path = Path(argv[argv.index("--manifest") + 1])
        job_manifest = load_json(manifest_path)
        run_out_dir = Path(argv[argv.index("--out") + 1])
        run_out_dir.mkdir(parents=True, exist_ok=True)
        pod_id = "p1"
        (run_out_dir / "run.json").write_text(json.dumps({
            "error": None, "dry_run": False, "pod_id": pod_id, "ledger_day": "2026-09-15",
            "termination_verified": True, "estimated_actual_usd": 0.01,
            "placement_attempts": [{
                "pod_id": pod_id, "estimated_actual_usd": 0.01, "termination_verified": True,
            }],
            # Claims the artifact downloaded clean -- but the file is never actually
            # written below, proving the caller's own captions_path.is_file() check
            # (not just verify_run_record's claimed-bytes bookkeeping) is load-bearing.
            "artifacts": [{"remote": "captions.json", "bytes": 42}],
        }), encoding="utf-8")
        model = command._pod_runner_module().gpu_model_label(job_manifest["gpu"]["type"])
        with ledger.open("a", encoding="utf-8") as handle:
            handle.write(f"{model}\tpod-create {pod_id}\t0.010000\n")
        return type("Result", (), {"returncode": 0})()

    monkeypatch.setattr(command.subprocess, "run", fake_harness)
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    (images_dir / "a.png").write_bytes(PNG_1X1)
    runner = command._live_qwen3vl_job_runner(
        "creator-002", "creator002krea2", tmp_path / "plan",
        ledger_dir=ledger_dir, skip_pin_verify=True,
    )
    with pytest.raises(command.FigmentTrainError, match="did not produce"):
        runner({"images": [str(images_dir / "a.png")]})


def test_lineage_dataset_subject_refuses_a_qwen3vl_row_with_a_mismatched_caption_sha256(
    command, tmp_path,
):
    """M4(b): dataset_subject's caption_sha256 binding is load-bearing, not decorative
    -- a row whose declared caption_sha256 disagrees with the caption bytes actually on
    disk is refused, whatever it claims."""
    lineage = command._lineage_module()
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    (dataset_dir / "01.png").write_bytes(PNG_1X1)
    caption_bytes = b"creator002krea2 woman, a real caption\n"
    (dataset_dir / "01.txt").write_bytes(caption_bytes)
    manifest = {
        "count": 1, "caption_mode": "qwen3vl",
        "files": [{
            "image": "01.png", "caption_file": "01.txt",
            "sha256": hashlib.sha256((dataset_dir / "01.png").read_bytes()).hexdigest(),
            "caption_sha256": "0" * 64,  # deliberately wrong
        }],
    }
    (dataset_dir / "dataset_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (dataset_dir / "_dataset.ready").write_text("", encoding="utf-8")
    with pytest.raises(lineage.LineageError, match="caption hash mismatch"):
        lineage.dataset_subject(dataset_dir)

    # The correct hash of the real on-disk bytes is accepted.
    manifest["files"][0]["caption_sha256"] = hashlib.sha256(caption_bytes).hexdigest()
    (dataset_dir / "dataset_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    subject = lineage.dataset_subject(dataset_dir)
    assert subject["caption_mode"] == "qwen3vl"


def test_rulings_template_always_carries_gate_override_m9(command, tmp_path):
    """m9: gate_override is the same axis whatever review mode produced the gate --
    the template must never omit it (it used to be conditional on local_research)."""
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="m9-template-plan")
    template = load_json(Path(grade["rulings_template"]))
    assert template["rulings"], "fixture must produce at least one row"
    for row in template["rulings"]:
        assert row["gate_override"] == ""


def test_evaluation_inputs_records_gate_sha256_m9(command, tmp_path):
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="m9-eval-plan")
    grade_dir = Path(grade["gate"]).parent
    evaluation = load_json(grade_dir / "evaluation-inputs.json")
    assert evaluation["gate_sha256"] == command._sha256(Path(grade["gate"]))


def test_load_current_approval_refuses_a_gate_json_swapped_after_evaluation_m9(
    command, tmp_path,
):
    """m9: _load_current_approval fails closed with a precise "gate.json changed"
    message when the recorded gate_sha256 no longer matches the file on disk -- not
    just the broader (also-correct) generic "stale, rebuild" subject-hash path."""
    plan_file, grade = _build_fake_dataset_grade(command, tmp_path, out_name="m9-swap-plan")
    template = load_json(Path(grade["rulings_template"]))
    for ruling in template["rulings"]:
        ruling.update({
            "decision": "keep", "identity": "pass", "realism": "pass",
            "hands": "pass", "lighting": "pass", "adult_read": "pass",
            "garment_integrity": "pass", "real_person_resemblance": "clear",
            "gate_override": "operator manually confirmed identity from the full-res original",
        })
    template.update({"decided_by": "operator-fixture", "decided_at": "2026-09-15T00:00:00Z"})
    filled = Path(grade["rulings_template"]).with_name("m9-filled.json")
    filled.write_text(json.dumps(template), encoding="utf-8")
    command.apply_rulings("creator-002", "dataset", plan_file, filled)

    gate_path = Path(grade["gate"])
    tampered = load_json(gate_path)
    tampered["summary"]["passed"] = 999  # any byte-level change
    gate_path.write_text(json.dumps(tampered), encoding="utf-8")

    plan, root = command._load_plan("creator-002", plan_file)
    with pytest.raises(command.FigmentTrainError, match="gate.json changed"):
        command._load_current_approval(plan, root, "dataset")
