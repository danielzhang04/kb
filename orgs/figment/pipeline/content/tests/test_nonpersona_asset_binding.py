"""Binding tests over real nonpersona and approved-gen producer chains.

The retained images and approved-gen outputs are synthetic fixtures. Every lineage
record is produced and revalidated by the real local APIs; these tests do not make a
real visual-quality, identity, delivery, or publication claim.
"""
from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

from orgs.figment.pipeline.content import content_asset_binding as binding
from orgs.figment.pipeline.content import content_brief as briefs
from orgs.figment.pipeline.content import nonpersona_native as native
from orgs.figment.pipeline.content import nonpersona_prep as prep
from orgs.figment.pipeline.content import nonpersona_retained as retained
from orgs.figment.pipeline.content.tests.test_content_asset_binding import sha, write
from orgs.figment.pipeline.content.tests.test_nonpersona_retained import DAY, POD_ID, USD, _png
from orgs.figment.pipeline.content.tests.test_nonpersona_visual_ruling import (  # noqa: F401
    ACCEPT, IMAGE_KEYS, _brief_ref, _chain, _ruling, _write, root,
)


REPO = Path(__file__).resolve().parents[5]
PIPELINE = REPO / "orgs" / "figment" / "pipeline"
DECIDED_AT = "2026-09-11T00:00:00Z"
ASSET_KEYS = {
    "kind", "scope", "stage", "cell_id", "path", "bytes", "sha256",
    "native_dimensions", "delivery_target", "delivery_quality", "delivery_transform",
    "retained", "visual_ruling",
}


def _source(root: Path, ruling: dict, name: str) -> dict:
    path = write(root / name, ruling)
    return {
        "kind": binding.NONPERSONA_SOURCE_KIND,
        "ruling": path.relative_to(root).as_posix(),
        "ruling_sha256": sha(path),
    }


def _direct_case(root: Path, taxonomy: str, tag: str = "primary") -> tuple[dict, dict, dict, Path]:
    out, record = _chain(root, tag, taxonomy)
    source = _source(root, _ruling(root, out, record, tag), f"{tag}-visual-ruling.json")
    return source, record["slot"], _brief_ref(root, tag), out


@pytest.mark.parametrize("taxonomy", ["C", "D", "E"])
def test_projects_exact_native_source_for_each_nonpersona_type(root: Path, taxonomy: str) -> None:
    source, slot, brief_ref, out = _direct_case(root, taxonomy)
    asset = binding._validate_nonpersona_source(root, "creator-001", source, slot, brief_ref)
    record = retained.revalidate_nonpersona_retained(root=root, out=out)
    selected = record["images"][0]

    assert set(asset) == ASSET_KEYS
    assert asset == {
        "kind": "visually-ruled-nonpersona-still",
        "scope": "source-material-only",
        "stage": "native-source",
        "cell_id": selected["cell_id"],
        "path": f"{out.as_posix()}/{selected['path']}",
        "bytes": selected["bytes"],
        "sha256": selected["sha256"],
        "native_dimensions": record["native_dimensions"],
        "delivery_target": record["delivery_target"],
        "delivery_quality": "not-assessed",
        "delivery_transform": None,
        "retained": {
            "path": f"{out.as_posix()}/{retained.RECORD_NAME}",
            "bytes": (root / out / retained.RECORD_NAME).stat().st_size,
            "sha256": sha(root / out / retained.RECORD_NAME),
        },
        "visual_ruling": {
            "path": source["ruling"],
            "bytes": (root / source["ruling"]).stat().st_size,
            "sha256": source["ruling_sha256"],
            "authority": "human-visual-ruling",
            "decision": "accept-native",
            "decided_by": "reviewer@example.test",
            "decided_at": DECIDED_AT,
        },
    }
    assert asset["delivery_target"]["aspect"] == "3:4"
    assert not {"approved", "bindable", "current", "native_quality"} & set(asset)


@pytest.mark.parametrize(("changes", "message"), [
    ({"authority": "research-disposition"}, "human accept-native"),
    ({"decision": "reject"}, "human accept-native"),
])
def test_refuses_research_or_reject_rulings(root: Path, changes: dict, message: str) -> None:
    out, record = _chain(root, "primary", "D")
    source = _source(root, _ruling(root, out, record, "primary", **changes), "ruling.json")
    with pytest.raises(binding.ContentAssetBindingError, match=message):
        binding._validate_nonpersona_source(
            root, "creator-001", source, record["slot"], _brief_ref(root, "primary"),
        )


def test_refuses_same_shaped_wrong_brief_wrong_slot_and_creator(root: Path) -> None:
    source, slot, brief_ref, _ = _direct_case(root, "D")
    _other_out, other_record = _chain(root, "other", "D")
    other_brief = _brief_ref(root, "other")
    assert other_record["slot"] == slot and other_brief != brief_ref

    for creator, supplied_brief, supplied_slot in (
        ("creator-001", other_brief, slot),
        ("creator-001", brief_ref, {**slot, "index": slot["index"] + 1}),
        ("creator-002", brief_ref, slot),
    ):
        with pytest.raises(binding.ContentAssetBindingError, match="current brief slot and creator"):
            binding._validate_nonpersona_source(
                root, creator, source, supplied_slot, supplied_brief,
            )


def test_refuses_stale_image_and_escaping_or_malformed_source(root: Path) -> None:
    source, slot, brief_ref, out = _direct_case(root, "D")
    escaping = {**source, "ruling": "../ruling.json"}
    with pytest.raises(binding.ContentAssetBindingError, match="authority rejected"):
        binding._validate_nonpersona_source(root, "creator-001", escaping, slot, brief_ref)
    with pytest.raises(binding.ContentAssetBindingError, match="unsupported fields"):
        binding._validate_nonpersona_source(
            root, "creator-001", {**source, "approved": True}, slot, brief_ref,
        )
    record = retained.revalidate_nonpersona_retained(root=root, out=out)
    image = root / out / record["images"][0]["path"]
    image.write_bytes(image.read_bytes() + b"stale")
    with pytest.raises(binding.ContentAssetBindingError, match="authority rejected"):
        binding._validate_nonpersona_source(root, "creator-001", source, slot, brief_ref)


@pytest.mark.parametrize(("decided_by", "decided_at", "accepted"), [
    ("\U0001f600" * 128, "2026-09-11T00:00:00Z", True),
    ("reviewer", "2026-09-11T00:00:00.123456Z", True),
    ("\U0001f600" * 129, "2026-09-11T00:00:00Z", False),
    ("reviewer\x00name", "2026-09-11T00:00:00Z", False),
    ("reviewer", "2026-09-11T00:00:00+00:00", False),
    ("reviewer", "2026-09-11T00:00:00", False),
])
def test_v3_slot_attribution_matches_utf16_and_utc_z_consumer_bounds(
    decided_by: str, decided_at: str, accepted: bool,
) -> None:
    row = {"decided_by": decided_by, "decided_at": decided_at}
    if accepted:
        assert binding._slot_attribution(row, v3=True) == {
            "decision": "fit", "decided_by": decided_by, "decided_at": decided_at,
        }
    else:
        with pytest.raises(binding.ContentAssetBindingError, match="v3 slot-fit attribution"):
            binding._slot_attribution(row, v3=True)


def test_legacy_slot_attribution_behavior_is_unchanged() -> None:
    decided_by = "\U0001f600" * 129
    decided_at = "2026-09-11T00:00:00+00:00"
    assert binding._slot_attribution(
        {"decided_by": decided_by, "decided_at": decided_at}, v3=False,
    ) == {"decision": "fit", "decided_by": decided_by, "decided_at": decided_at}


def _materialize_native_run(root: Path, out: Path, tag: str) -> dict:
    out_dir, pod = root / out, native._train()._pod_runner_module()
    manifest_path = out_dir / native.MANIFEST_NAME
    manifest = json.loads(manifest_path.read_bytes())
    base, fields = pod.load_workflow(manifest, manifest_path), pod.manifest_seed_fields(manifest)
    graphs = [pod.apply_job(base, job, fields) for job in manifest["jobs"]]
    pod_id = f"{POD_ID}-{tag}"
    pod.append_cost_row(
        root / "ledger", pod.gpu_model_label(manifest["gpu"]["type"]),
        f"pod-create {pod_id}", USD, ledger_day=DAY,
    )
    run_dir = out_dir / "run"
    run_dir.mkdir()
    jobs = []
    for number, (job, graph) in enumerate(zip(manifest["jobs"], graphs, strict=True), start=1):
        data = _png(json.dumps(graph), shade=40 * number)
        (run_dir / f"{job['output_name']}.png").write_bytes(data)
        jobs.append({
            "job": number, "output_name": job["output_name"], "seed": job["seed"],
            "prompt_id": f"synthetic-{tag}-{number}", "seconds": 12.5,
            "files": [{"path": f"{job['output_name']}.png", "bytes": len(data)}],
        })
    write(run_dir / "run.json", {
        "schema": retained.RUN_SCHEMA, "dry_run": False, "pod_id": pod_id,
        "estimated_actual_usd": USD, "ledger_day": DAY, "termination_verified": True,
        "placement_attempts": [{"pod_id": pod_id, "estimated_actual_usd": USD,
                                "termination_verified": True}],
        "jobs": jobs, "uploads": [], "artifacts": [],
    })
    return retained.record_nonpersona_retained(root=root, out=out)


def _mixed_case(tmp_path: Path) -> tuple[Path, Path]:
    gen = __import__("orgs.figment.pipeline.tests.test_gen_stage", fromlist=["unused"])
    command = binding._train_module()
    root = tmp_path / "mixed"
    personas = root / "personas"
    gen._promoted_persona(personas, creator_id="creator-002", steps=3000)
    gen._prepare_accepted_checkpoint(command, personas, root)
    plan_root = root / "gen"
    plan = command.build_plan(
        "creator-002", "gen", plan_root, personas_root=personas, skip_pin_verify=True,
    )
    gen.anchor_stage_test._fake_stage_outputs(plan_root, plan, "gen")
    grade = command.build_grade("creator-002", "gen", plan_root / "plan.json", skip_judge=True)
    gen_rulings = gen.load_json(Path(grade["rulings_template"]))
    for row in gen_rulings["rulings"]:
        row.update(gen.anchor_stage_test._axes(), decision="keep",
                   gate_override="fixture: synthetic image")
    gen_rulings.update({"decided_by": "gen-fixture-reviewer", "decided_at": DECIDED_AT})
    command.apply_rulings(
        "creator-002", "gen", plan_root / "plan.json",
        write(root / "gen-rulings.json", gen_rulings),
    )
    approved = gen.load_json(plan_root / "grade/gen/approved-list.json")["images"][:2]
    assert len(approved) == 2

    persona = gen.load_json(personas / "creator-002/persona.yaml")
    write(root / "request.json", {
        "schema": "figment/content-brief-request@1", "brief_date": "2026-09-11",
        "creator": {
            "id": "creator-002", "persona_path": "personas/creator-002/persona.yaml",
            "canonical_reference": persona["identity"]["references"][0],
        },
        "surface": "carousel", "template_id": "CT-5",
        "asset_slots": [
            {"taxonomy_type": "A", "kind": "persona"},
            {"taxonomy_type": "D", "kind": "nonpersona"},
            {"taxonomy_type": "C", "kind": "nonpersona"},
            {"taxonomy_type": "A", "kind": "persona"},
        ],
        "sources": [{"citation": "https://example.test/research", "observed_date": "2026-09-10"}],
        "hypothesis": "A synthetic mixed-source integration fixture.",
        "intended_metric": "saves", "observed_metrics": None,
    })
    briefs.build_content_brief(root, "request.json", "brief.json")
    brief_ref = {"path": "brief.json", "sha256": sha(root / "brief.json")}
    slots = json.loads((root / "brief.json").read_bytes())["content"]["required_asset_slots"]
    (root / "ledger").mkdir(exist_ok=True)
    (root / "out").mkdir()

    nonpersona_sources: dict[int, dict] = {}
    for index, taxonomy, tag in ((2, "D", "slot-2"), (3, "C", "slot-3")):
        scene = write(root / f"{tag}-scene.json", {
            "schema": prep.REQUEST_SCHEMA, "brief": brief_ref, "slot_index": index,
            "taxonomy_type": taxonomy, "subject": f"an empty tiled counter scene {tag}",
        })
        prepared = Path("out") / f"{tag}-prep.json"
        prep.build_nonpersona_slot_preparation(
            root=root, request_path="request.json", brief_path="brief.json",
            scene_path=scene.relative_to(root), output_path=prepared,
        )
        out = Path("out") / f"native-{tag}"
        native.compile_nonpersona_native(
            root=root, preparation_path=prepared, out=out, ledger_dir=root / "ledger",
        )
        record = _materialize_native_run(root, out, tag)
        image = record["images"][0]
        ruling = {
            "schema": "figment/nonpersona-visual-ruling@1",
            "retained": {"out": out.as_posix(),
                         "record_sha256": sha(root / out / retained.RECORD_NAME)},
            "image": {key: image[key] for key in IMAGE_KEYS},
            "brief": brief_ref, "slot": record["slot"],
            "authority": "human-visual-ruling", "criteria": dict(ACCEPT),
            "delivery_quality": "not-assessed", "decision": "accept-native",
            "decided_by": f"visual-{tag}@example.test", "decided_at": DECIDED_AT,
            "note": "synthetic fixture only",
        }
        nonpersona_sources[index] = _source(root, ruling, f"{tag}-visual-ruling.json")

    rows = []
    persona_number = 0
    for slot in slots:
        if slot["kind"] == "persona":
            image = approved[persona_number]
            persona_number += 1
            source = {
                "kind": binding.SOURCE_KIND,
                "plan": (plan_root / "plan.json").relative_to(root).as_posix(),
                "image_id": image["image_id"],
            }
        else:
            source = nonpersona_sources[slot["index"]]
        rows.append({
            "slot_index": slot["index"], "role": slot["role"],
            "taxonomy_type": slot["taxonomy_type"], "kind": slot["kind"],
            "decision": "fit", "decided_by": "slot-fit-reviewer",
            "decided_at": DECIDED_AT, "source": source,
        })
    rulings_path = write(root / "slot-rulings.json", {
        "schema": binding.NONPERSONA_RULINGS_SCHEMA, "brief": brief_ref,
        "creator": "creator-002", "rulings": rows,
    })
    return root, rulings_path


def _build(root: Path, rulings: Path, output: str) -> dict:
    return binding.build_content_asset_binding(
        root=root, brief_path="brief.json", request_path="request.json",
        rulings_path=rulings.relative_to(root).as_posix(), output_path=output,
    )


def test_real_mixed_ct5_api_cli_legacy_refusal_uniqueness_and_final_recheck(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, rulings = _mixed_case(tmp_path)
    result = _build(root, rulings, "assignment.json")
    assert result["schema"] == "figment/content-asset-assignment@3"
    assert result["not_promotable"] is True
    assert result["provenance"] == (
        "offline content-slot planning evidence; nonpersona images are native source material "
        "with delivery review pending; no new asset, batch, publication, or metric approval"
    )
    assert [row["asset"]["kind"] for row in result["assignments"]] == [
        binding.SOURCE_KIND, binding.NONPERSONA_SOURCE_KIND,
        binding.NONPERSONA_SOURCE_KIND, binding.SOURCE_KIND,
    ]
    for row in result["assignments"][1:3]:
        assert set(row["asset"]) == ASSET_KEYS
        assert row["asset"]["visual_ruling"]["decided_by"] != row["slot_fit"]["decided_by"]
        assert row["asset"]["stage"] == "native-source"
        assert row["asset"]["delivery_quality"] == "not-assessed"
        assert row["asset"]["delivery_transform"] is None

    cli = subprocess.run([
        sys.executable, "-I", "-B", str(PIPELINE / "content/content_asset_binding.py"),
        "--root", str(root), "--brief", "brief.json", "--request", "request.json",
        "--rulings", rulings.relative_to(root).as_posix(), "--out", "assignment-cli.json",
    ], cwd=REPO, capture_output=True, text=True, timeout=180)
    assert cli.returncode == 0, cli.stdout + cli.stderr
    assert json.loads((root / "assignment-cli.json").read_bytes()) == result

    old = json.loads(rulings.read_bytes())
    old["schema"] = binding.RULINGS_SCHEMA
    old_path = write(root / "slot-rulings-v1.json", old)
    with pytest.raises(binding.ContentAssetBindingError, match="nonpersona slots have no supported authority"):
        _build(root, old_path, "legacy-must-refuse.json")

    first_asset = copy.deepcopy(result["assignments"][1]["asset"])
    with monkeypatch.context() as duplicate:
        duplicate.setattr(binding, "_validate_nonpersona_source", lambda *_args, **_kwargs: copy.deepcopy(first_asset))
        with pytest.raises(binding.ContentAssetBindingError, match="distinct image"):
            _build(root, rulings, "duplicate-must-refuse.json")

    real_validate = binding._validate_nonpersona_source
    calls: list[tuple[dict, dict]] = []
    first_image = root / result["assignments"][1]["asset"]["path"]

    def mutate_before_final(root_arg, creator, source, slot, brief_ref):
        calls.append((copy.deepcopy(slot), copy.deepcopy(brief_ref)))
        if len(calls) == 3:
            first_image.write_bytes(first_image.read_bytes() + b"changed-during-final-check")
        return real_validate(root_arg, creator, source, slot, brief_ref)

    with monkeypatch.context() as changed:
        changed.setattr(binding, "_validate_nonpersona_source", mutate_before_final)
        with pytest.raises(binding.ContentAssetBindingError, match="authority rejected"):
            _build(root, rulings, "changed-must-refuse.json")
    assert len(calls) == 3 and calls[0] == calls[2]
    assert not (root / "changed-must-refuse.json").exists()
    assert json.loads((root / "assignment.json").read_bytes()) == result
