"""Compile one prepared non-persona slot into an existing RunPod harness manifest.

Offline only. The compiler turns one current C/D/E slot preparation into a frozen
tester-class manifest (base model, no LoRA, three fixed seeds) plus the exact
``figment_train._planned_run`` record the existing harness would be invoked with.
It never runs that argv, contacts a provider, uploads, trains, reviews, or
delivers. Native inference stays at the tester's 1448x2176; the taxonomy delivery
surface is recorded separately and no crop or resize is implied.

The pinned tester stage launches ComfyUI through ``start-comfy-lorapath.sh``, which
the harness only writes when a manifest carries a training block. Native manifests
have none, so the compiler selects the harness's plain ``python main.py`` launch
(run from the configured ComfyUI root) in a copied comfyui config, leaving every
other tester setting and the LoRA tester path itself unchanged.

Publication: the record is written to a private pending file, fsynced, and only
then hard-linked to ``RECORD_NAME`` (exclusive, never overwriting). A filesystem
without hardlink support fails closed before completion. Without ``RECORD_NAME``
the output is untrusted and the supported revalidator rejects it.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any

try:
    from . import content_brief as briefs
    from . import nonpersona_prep as prep
except ImportError:  # Direct script execution.
    def _load(name: str, filename: str) -> Any:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
        if spec is None or spec.loader is None:
            raise RuntimeError(f"{filename} authority is unavailable")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    prep = _load("figment_nonpersona_native_prep", "nonpersona_prep.py")
    briefs = prep.briefs


SCHEMA = "figment/nonpersona-native-compilation@1"
MANIFEST_NAME = "nonpersona-native-manifest.json"
RECORD_NAME = "nonpersona-native-compilation.json"
# Retained after publication by design; revalidation accepts it only as a byte-identical copy.
PENDING_RECORD_NAME = ".nonpersona-native-compilation.pending"
NATIVE_START_COMMAND = "python main.py"
ARM = "base-model-no-lora"
EXPECTED_NATIVE = {"width": 1448, "height": 2176}
WORKFLOW_NODES = ("1", "2", "3", "5", "6", "7", "8", "9", "10")
LOADERS = (("1", "unet_name"), ("2", "clip_name"), ("3", "vae_name"))
MODEL_KEYS = {"repo_id", "filename", "revision", "sha256", "destination_dir"}
REVISION_RE = re.compile(r"[0-9a-f]{40}\Z")
SHA_RE = re.compile(r"[0-9a-f]{64}\Z")


class NonpersonaNativeError(ValueError):
    """A non-persona preparation cannot be compiled or revalidated."""


def _fail(message: str) -> NonpersonaNativeError:
    return NonpersonaNativeError(message)


def _norm(value: object) -> object:
    return value.as_posix() if isinstance(value, Path) else value


def _positive_int(value: object) -> bool:
    return type(value) is int and value > 0


def _reject_constant(name: str) -> Any:
    raise _fail(f"non-finite JSON constant {name} is not allowed")


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _fail(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _read_bounded(path: Path, label: str) -> bytes:
    if briefs._is_reparse(path) or not path.is_file():
        raise _fail(f"{label} is missing or linked")
    with path.open("rb") as handle:
        data = handle.read(briefs.MAX_JSON_BYTES + 1)
    if len(data) > briefs.MAX_JSON_BYTES:
        raise _fail(f"{label} exceeds {briefs.MAX_JSON_BYTES} bytes")
    return data


def _parse(data: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(
            data.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise _fail(f"{label} is not valid UTF-8 JSON") from exc
    briefs._check_shape(value, label)
    if not isinstance(value, dict):
        raise _fail(f"{label} must be an object")
    return value


def _digest(data: bytes) -> str:
    return prep.hashlib.sha256(data).hexdigest()


def _train() -> Any:
    return prep._train_module()


def _out_dir(root: Path, out: object, *, existing: bool) -> tuple[Path, str]:
    relative = briefs._relative(_norm(out), "out")
    current = root
    for part in relative.parts[:-1]:
        current = current / part
        if not current.is_dir() or briefs._is_reparse(current):
            raise _fail("out parent is missing or traverses a link")
    target = root / relative
    if briefs._is_reparse(target):
        raise _fail("out must not be a link")
    if existing and not target.is_dir():
        raise _fail("out must be an existing compilation directory")
    if not existing and target.exists():
        raise _fail("out must be a fresh directory; refusing to overwrite")
    return target, relative.as_posix()


def _check_models(models: object, loader_names: set[str]) -> list[dict[str, str]]:
    if not isinstance(models, list) or len(models) != len(loader_names):
        raise _fail("tester models do not match the pinned loader set")
    names = set()
    for model in models:
        if not isinstance(model, dict) or set(model) != MODEL_KEYS:
            raise _fail("tester model pin has unexpected fields")
        if not all(isinstance(model[key], str) and model[key] for key in MODEL_KEYS):
            raise _fail("tester model pin fields must be nonempty strings")
        if not REVISION_RE.match(model["revision"]) or not SHA_RE.match(model["sha256"]):
            raise _fail("tester model pin revision/sha256 is malformed")
        names.add(PurePosixPath(model["filename"]).name)
    if names != loader_names:
        raise _fail("tester model pins do not correspond to the workflow loaders")
    return copy.deepcopy(models)


def _check_workflow(workflow: dict[str, Any], native: dict[str, int],
                    prompt_text: str, prefix: str) -> set[str]:
    if tuple(workflow) != WORKFLOW_NODES:
        raise _fail("base tester workflow node set changed")
    if workflow["5"]["inputs"].get("text") != prompt_text:
        raise _fail("base tester workflow does not carry the prepared prompt text")
    if workflow["10"]["inputs"].get("filename_prefix") != prefix:
        raise _fail("base tester workflow does not carry the expected output prefix")
    # Inspect structure, not the serialized text: a scene subject such as "flora"
    # must not trip a LoRA check, and node 4 is only reachable through a link value.
    for node in workflow.values():
        if "lora" in str(node.get("class_type", "")).lower():
            raise _fail("base tester workflow contains a LoRA node")
        for value in node.get("inputs", {}).values():
            if isinstance(value, list) and value[:1] == ["4"]:
                raise _fail("base tester workflow references LoRA node 4")
    if workflow["5"]["inputs"].get("clip") != ["2", 0] or workflow["8"]["inputs"].get("model") != ["1", 0]:
        raise _fail("base tester workflow is not wired to the base loaders")
    latent = workflow["7"]["inputs"]
    if not (_positive_int(latent.get("width")) and _positive_int(latent.get("height"))) or {
        "width": latent["width"], "height": latent["height"],
    } != native:
        raise _fail("base tester workflow dimensions differ from native tester dimensions")
    names = {workflow[node]["inputs"].get(field) for node, field in LOADERS}
    if len(names) != len(LOADERS) or not all(isinstance(name, str) and name for name in names):
        raise _fail("base tester workflow loader names are malformed")
    return names


def _native_dimensions(train: Any) -> dict[str, int]:
    native = train.TESTER_NATIVE_DIMENSIONS
    if not isinstance(native, dict) or set(native) != {"width", "height"} or not all(
        _positive_int(native[key]) for key in native
    ) or dict(native) != EXPECTED_NATIVE:
        raise _fail("tester native dimensions are not the expected 1448x2176")
    return {"width": native["width"], "height": native["height"]}


def _preparation(root: Path, prep_rel: object) -> tuple[Path, bytes, dict[str, Any]]:
    prep_file = prep._safe_input(root, prep_rel, "preparation")
    data = _read_bounded(prep_file, "preparation")
    parsed = _parse(data, "preparation")
    refs = [parsed.get(key) for key in ("request", "brief", "scene")]
    if not all(isinstance(ref, dict) and isinstance(ref.get("path"), str) for ref in refs):
        raise _fail("preparation input bindings are malformed")
    current = prep.revalidate_nonpersona_slot_preparation(
        root, refs[0]["path"], refs[1]["path"], refs[2]["path"],
        prep_file.relative_to(root).as_posix(),
    )
    if not prep._strict_equal(current, parsed):
        raise _fail("preparation is stale or malformed against current inputs")
    if _digest(data) != prep._sha256(prep_file):
        raise _fail("preparation changed while revalidating")
    return prep_file, data, parsed


def _check_prep_fields(parsed: dict[str, Any], train: Any) -> None:
    seeds = parsed["seeds"]
    expected = list(train.DIAGNOSTIC_PROTOCOL_SEEDS[:3])
    if not isinstance(seeds, list) or len(seeds) != 3 or any(type(s) is not int for s in seeds) \
            or seeds != expected or len(set(seeds)) != 3 or any(type(s) is not int for s in expected):
        raise _fail("preparation seeds are not the three fixed diagnostic seeds")
    basis = parsed["generation_basis"]
    if basis.get("native_inference_dimensions") is not None or basis.get("arm") != ARM:
        raise _fail("preparation generation basis is malformed")
    delivery = basis.get("delivery_target")
    if not isinstance(delivery, dict) or set(delivery) != {"aspect", "width", "height"} \
            or not isinstance(delivery["aspect"], str) or not delivery["aspect"] \
            or not _positive_int(delivery["width"]) or not _positive_int(delivery["height"]):
        raise _fail("preparation delivery target is malformed")
    slot = parsed["slot"]
    index = slot.get("index") if isinstance(slot, dict) else None
    if not isinstance(slot, dict) or slot.get("kind") != "nonpersona" or type(index) is not int \
            or index < 0 or slot.get("taxonomy_type") not in prep.ALLOWED_NONPERSONA_TYPES:
        raise _fail("preparation slot is malformed")


def _sources(root: Path, prep_file: Path, prep_data: bytes, parsed: dict[str, Any],
             pins_data: bytes, sidecar: Path | None, train: Any) -> list[dict[str, str]]:
    content_relative = {"taxonomy", "template"}
    entries: list[tuple[str, Path, str]] = [("preparation", prep_file, prep_file.relative_to(root).as_posix())]
    for label in ("brief", "request", "scene"):
        entries.append((label, root / parsed[label]["path"], parsed[label]["path"]))
    for label in sorted(parsed["dependencies"]):
        path = parsed["dependencies"][label]["path"]
        base = briefs.CONTENT_DIR if label in content_relative else root
        entries.append((f"dependency:{label}", base / path, path))
    entries.append(("tensor-pins", Path(train.PINS_PATH), Path(train.PINS_PATH).resolve().as_posix()))
    if sidecar is not None:
        entries.append(("persona-training-sidecar", sidecar, sidecar.relative_to(root).as_posix()))
    code = Path(train.HERE)
    for label, path in (
        ("code:figment_train", code / "figment_train.py"),
        ("code:training_config", Path(train.TRAINING_CONFIG_MODULE)),
        ("code:runpod_run", Path(train.POD_RUNNER)),
        ("code:content_brief", briefs.CONTENT_DIR / "content_brief.py"),
        ("code:nonpersona_prep", Path(prep.__file__)),
        ("code:nonpersona_native", Path(__file__)),
    ):
        entries.append((label, path, path.resolve().as_posix()))
    records = []
    for label, path, shown in entries:
        if briefs._is_reparse(path) or not path.is_file():
            raise _fail(f"{label} source is missing or linked")
        records.append({"label": label, "path": shown, "sha256": prep._sha256(path)})
    bound = {"preparation": _digest(prep_data), "tensor-pins": _digest(pins_data)}
    expected_deps = {f"dependency:{k}": v["sha256"] for k, v in parsed["dependencies"].items()}
    expected_deps.update({k: parsed[k]["sha256"] for k in ("brief", "request", "scene")})
    expected_deps.update(bound)
    for record in records:
        if record["label"] in expected_deps and record["sha256"] != expected_deps[record["label"]]:
            raise _fail(f"{record['label']} changed while compiling")
    return records


def _sources_again(root: Path, sources: list[dict[str, str]]) -> None:
    """Re-hash every bound source from disk; stored hashes are never trusted alone."""
    for record in sources:
        shown = Path(record["path"])
        path = shown if shown.is_absolute() else (
            briefs.CONTENT_DIR / shown if record["label"] in {"dependency:taxonomy", "dependency:template"}
            else root / shown
        )
        if briefs._is_reparse(path) or not path.is_file() or prep._sha256(path) != record["sha256"]:
            raise _fail(f"{record['label']} changed after validation")


def _build(root: Path, prep_rel: object, out_dir: Path, ledger: Path) -> tuple[bytes, dict[str, Any]]:
    """Pure expected manifest bytes plus every record field except the planned run."""
    train = _train()
    pod = train._pod_runner_module()
    prep_file, prep_data, parsed = _preparation(root, prep_rel)
    _check_prep_fields(parsed, train)
    native = _native_dimensions(train)

    pins_data = _read_bounded(Path(train.PINS_PATH), "tensor-pins")
    pins = _parse(pins_data, "tensor-pins")
    if _digest(pins_data) != parsed["generation_basis"].get("pins_sha256"):
        raise _fail("tensor-pins differ from the preparation's bound pins")
    tester = pins.get("pins", {}).get("tester") if isinstance(pins.get("pins"), dict) else None
    if not isinstance(tester, dict) or not isinstance(tester.get("custom_nodes"), list):
        raise _fail("tensor-pins tester section is malformed")

    creator = parsed["creator"]
    persona_file = root / parsed["dependencies"]["persona"]["path"]
    if persona_file.name != "persona.yaml" or persona_file.parent.name != creator:
        raise _fail("persona dependency is not <personas>/<creator>/persona.yaml")
    persona, training, loaded_pins = train._load_inputs(creator, persona_file.parent.parent)
    if persona.get("id") != creator or not prep._strict_equal(loaded_pins, pins):
        raise _fail("persona or tensor-pins changed while loading training inputs")
    trigger, pod_class = training.get("trigger"), training.get("pod_class")
    if not isinstance(trigger, str) or not trigger or not isinstance(pod_class, str):
        raise _fail("persona training trigger or pod class is malformed")
    prompt_text = parsed["prompt"]["text"]
    lowered = prompt_text.lower()
    if trigger.lower() in lowered or creator.lower() in lowered:
        raise _fail("scene subject names the resolved persona trigger or creator")
    sidecar = persona_file.with_name("training.yaml")
    sidecar = sidecar if sidecar.exists() or briefs._is_reparse(sidecar) else None

    slot_index = parsed["slot"]["index"]
    code = train._creator_output_code(creator)
    prefix = f"{code}-np-s{slot_index}"
    workflow = train._tester_base_workflow(prompt_text, prefix)
    loader_names = _check_workflow(workflow, native, prompt_text, prefix)
    models = _check_models(tester.get("models"), loader_names)
    if not prep._strict_equal(models, parsed["generation_basis"].get("models")):
        raise _fail("preparation models differ from current tester pins")
    seeds = parsed["seeds"]
    cells = [{"id": f"s{slot_index}-{seed}", "seed": seed, "output_name": f"{prefix}-{seed}"}
             for seed in seeds]
    base = train._pod_base(pins, pod_class, "tester")
    pinned_comfy = base.get("comfyui")
    if not isinstance(pinned_comfy, dict):
        raise _fail("tester stage comfyui config is malformed")
    # The pinned tester launch is a script written only for training manifests;
    # select the harness's plain launch on a copy so the pins stay untouched.
    comfy = {**copy.deepcopy(pinned_comfy), "start_command": NATIVE_START_COMMAND}
    startup = {"pinned_start_command": copy.deepcopy(pinned_comfy.get("start_command")),
               "start_command": NATIVE_START_COMMAND}
    manifest = {
        **base,
        "comfyui": comfy,
        "models": models,
        "custom_nodes": copy.deepcopy(tester["custom_nodes"]),
        "workflow": workflow,
        "seed_fields": ["seed", "noise_seed"],
        "jobs": [{"seed": c["seed"], "output_name": c["output_name"], "expected_images": 1}
                 for c in cells],
    }
    if {"uploads", "training", "artifacts"} & set(manifest):
        raise _fail("native manifest must not upload, train, or collect artifacts")
    if manifest["comfyui"].get("start_command") != NATIVE_START_COMMAND or \
            {k: v for k, v in manifest["comfyui"].items() if k != "start_command"} != \
            {k: v for k, v in pinned_comfy.items() if k != "start_command"}:
        raise _fail("native manifest startup is not the plain harness launch over tester pins")
    manifest_path = out_dir / MANIFEST_NAME
    pod.require_manifest(manifest, manifest_path)
    minimum = pod.minimum_runtime_minutes(manifest)
    if not isinstance(manifest.get("max_minutes"), (int, float)) or minimum > manifest["max_minutes"]:
        raise _fail("minimum runtime exceeds the manifest max_minutes cap")
    data = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    sources = _sources(root, prep_file, prep_data, parsed, pins_data, sidecar, train)
    fields = {
        "schema": SCHEMA,
        "stage": "compiled-not-run",
        "not_promotable": True,
        "claims": {"generated": False, "reviewed": False, "slot_fit": False, "delivered": False},
        "preparation": {"path": prep_file.relative_to(root).as_posix(),
                        "bytes": len(prep_data), "sha256": _digest(prep_data)},
        "creator": creator,
        "slot": copy.deepcopy(parsed["slot"]),
        "arm": ARM,
        "native_dimensions": native,
        "delivery_target": copy.deepcopy(parsed["generation_basis"]["delivery_target"]),
        "delivery_transform": None,
        "startup": startup,
        "cells": cells,
        "sources": sources,
        "manifest": {"path": MANIFEST_NAME, "sha256": _digest(data)},
        "minimum_runtime_minutes": minimum,
        "ledger_dir": str(ledger),
        "out": out_dir.relative_to(root).as_posix(),
    }
    return data, fields


def _encode_record(record: dict[str, Any]) -> bytes:
    data = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(data) > briefs.MAX_JSON_BYTES:
        raise _fail("compilation record exceeds output size limit")
    return data


def _domain(exc: Exception) -> NonpersonaNativeError:
    if isinstance(exc, NonpersonaNativeError):
        return exc
    return NonpersonaNativeError(f"{type(exc).__name__}: {exc}")


def compile_nonpersona_native(
    *, root: Path, preparation_path: str | Path, out: str | Path, ledger_dir: Path | None = None,
) -> dict[str, Any]:
    """Compile one current preparation into a fresh out/ with a frozen manifest and record.

    The commit point is ``os.link(pending, RECORD_NAME)``: it publishes the fsynced
    record exclusively and refuses an existing target. Any failure before it leaves
    ``RECORD_NAME`` absent, so the retained partial output is untrusted and
    ``revalidate_nonpersona_native`` rejects it. Nothing fallible runs after the link;
    the pending file is kept as a byte-identical duplicate.
    """
    try:
        root = briefs._safe_root(Path(root))
        prep_rel = _norm(preparation_path)
        out_dir, _ = _out_dir(root, out, existing=False)
        ledger = _train()._resolved_ledger_dir(ledger_dir)
        data, fields = _build(root, prep_rel, out_dir, ledger)
        replay_data, replay_fields = _build(root, prep_rel, out_dir, ledger)
        if replay_data != data or not prep._strict_equal(replay_fields, fields):
            raise _fail("inputs changed while compiling")
        _out_dir(root, out, existing=False)
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError) as exc:
        raise _domain(exc) from exc
    try:
        out_dir.mkdir(exist_ok=False)
        manifest_path = out_dir / MANIFEST_NAME
        with manifest_path.open("xb") as handle:
            handle.write(data)
            handle.flush()
            prep.os.fsync(handle.fileno())
        run = _train()._planned_run(out_dir, manifest_path, out_dir / "run", ledger_dir=ledger)
        if run.get("sha256") != fields["manifest"]["sha256"]:
            raise _fail("frozen manifest changed after publication")
        _sources_again(root, fields["sources"])
        _out_dir(root, out, existing=True)
        record = {**fields, "run": run}
        encoded = _encode_record(record)
        pending_path, final_path = out_dir / PENDING_RECORD_NAME, out_dir / RECORD_NAME
        with pending_path.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            prep.os.fsync(handle.fileno())
        _sources_again(root, fields["sources"])
        _out_dir(root, out, existing=True)
        if _read_bounded(manifest_path, "frozen manifest") != data or \
                _read_bounded(pending_path, "pending compilation record") != encoded:
            raise _fail("compilation output changed before publication")
        os.link(pending_path, final_path)  # Commit point: exclusive, never overwrites.
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError) as exc:
        raise NonpersonaNativeError(
            f"compilation failed before {RECORD_NAME} was published; the partial directory is "
            f"retained, untrusted, and rejected by revalidate_nonpersona_native: {_domain(exc)}"
        ) from exc
    return record


def revalidate_nonpersona_native(*, root: Path, out: str | Path) -> dict[str, Any]:
    """Return the stored record only when it exactly matches a fresh in-memory rebuild."""
    try:
        root = briefs._safe_root(Path(root))
        out_dir, _ = _out_dir(root, out, existing=True)
        record_data = _read_bounded(out_dir / RECORD_NAME, "compilation record")
        manifest_path = out_dir / MANIFEST_NAME
        manifest_data = _read_bounded(manifest_path, "frozen manifest")
        stored = _parse(record_data, "compilation record")
        preparation, ledger_value = stored.get("preparation"), stored.get("ledger_dir")
        if not isinstance(preparation, dict) or not isinstance(preparation.get("path"), str) \
                or not isinstance(ledger_value, str) or not ledger_value:
            raise _fail("compilation record bindings are malformed")
        ledger = _train()._resolved_ledger_dir(Path(ledger_value))
        if str(ledger) != ledger_value:
            raise _fail("recorded ledger_dir is not a resolved explicit directory")
        data, fields = _build(root, preparation["path"], out_dir, ledger)
        if manifest_data != data:
            raise _fail("frozen manifest differs from the current expected manifest")
        run = _train()._planned_run(out_dir, manifest_path, out_dir / "run", ledger_dir=ledger)
        expected = {**fields, "run": run}
        if not prep._strict_equal(stored, expected) or record_data != _encode_record(expected):
            raise _fail("compilation record is stale, edited, or has unknown fields")
        _sources_again(root, fields["sources"])
        if _read_bounded(manifest_path, "frozen manifest") != data or \
                _read_bounded(out_dir / RECORD_NAME, "compilation record") != record_data:
            raise _fail("compilation output changed while revalidating")
        # The retained pending file is tolerated only as an exact duplicate of the record.
        pending_path = out_dir / PENDING_RECORD_NAME
        if (pending_path.exists() or briefs._is_reparse(pending_path)) and \
                _read_bounded(pending_path, "pending compilation record") != record_data:
            raise _fail("pending compilation record differs from the published record")
        return expected
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError) as exc:
        raise _domain(exc) from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compile one non-persona slot preparation into an offline harness manifest "
                    "(never runs it).",
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--preparation", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--ledger-dir", type=Path)
    args = parser.parse_args(argv)
    try:
        record = compile_nonpersona_native(
            root=args.root, preparation_path=args.preparation, out=args.out,
            ledger_dir=args.ledger_dir,
        )
    except NonpersonaNativeError as exc:
        parser.error(str(exc))
    print(f"nonpersona native compilation: {args.out}/{RECORD_NAME}")
    print(f"planned (not run): {record['run']['cli']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
