"""nonpersona_retained record/revalidate over a real brief -> prep -> native chain.

The compilation is produced by the real producers (shared fixture from
test_nonpersona_native). Everything under ``run/`` is SYNTHETIC test data standing in
for a harness receipt: a fake pod id, a USD 0.01 row in the fixture's private tmp
ledger (via the real ``append_cost_row``), and solid-colour Pillow PNGs whose embedded
prompt is the real ``apply_job`` graph. Nothing here claims generation or quality.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageFile
from PIL.PngImagePlugin import PngInfo

from orgs.figment.pipeline.content import nonpersona_native as native
from orgs.figment.pipeline.content import nonpersona_retained as retained
from orgs.figment.pipeline.content.tests.test_nonpersona_native import (  # noqa: F401
    SLOTS, _compile, _snapshot, _write_json, root,
)

REPO = Path(__file__).resolve().parents[5]
DAY = "2026-09-11"
POD_ID = "synthetic-fixture-pod"  # fake; only ever written to the tmp ledger
USD = 0.01
NATIVE = (1448, 2176)


def _pod():
    return native._train()._pod_runner_module()


def _png(prompt: str | None, *, size=NATIVE, shade: int = 0, fmt: str = "PNG") -> bytes:
    image, buffer = Image.new("RGB", size, (shade, 40, 80)), io.BytesIO()
    if fmt == "PNG":
        info = PngInfo()
        if prompt is not None:
            info.add_text("prompt", prompt)
        image.save(buffer, "PNG", pnginfo=info)
    else:
        image.save(buffer, fmt)
    return buffer.getvalue()


def _live(root: Path, taxonomy: str = "D") -> tuple[Path, dict, list[dict]]:
    """Real compilation plus a synthetic live receipt, ledger row, and three PNGs."""
    out, _ = _compile(root, taxonomy, taxonomy)
    out_dir, pod = root / out, _pod()
    manifest_path = out_dir / native.MANIFEST_NAME
    manifest = json.loads(manifest_path.read_bytes())
    base, fields = pod.load_workflow(manifest, manifest_path), pod.manifest_seed_fields(manifest)
    graphs = [pod.apply_job(base, job, fields) for job in manifest["jobs"]]
    pod.append_cost_row(root / "ledger", pod.gpu_model_label(manifest["gpu"]["type"]),
                        f"pod-create {POD_ID}", USD, ledger_day=DAY)
    run_dir = out_dir / "run"
    run_dir.mkdir()
    jobs = []
    for number, (job, graph) in enumerate(zip(manifest["jobs"], graphs), start=1):
        data = _png(json.dumps(graph), shade=40 * number)
        (run_dir / f"{job['output_name']}.png").write_bytes(data)
        jobs.append({"job": number, "output_name": job["output_name"], "seed": job["seed"],
                     "prompt_id": f"synthetic-{number}", "seconds": 12.5,
                     "files": [{"path": f"{job['output_name']}.png", "bytes": len(data)}]})
    _write_json(run_dir / "run.json", {
        "schema": retained.RUN_SCHEMA, "dry_run": False, "pod_id": POD_ID,
        "estimated_actual_usd": USD, "ledger_day": DAY, "termination_verified": True,
        "placement_attempts": [{"pod_id": POD_ID, "estimated_actual_usd": USD,
                                "termination_verified": True}],
        "jobs": jobs, "uploads": [], "artifacts": [],
    })
    return out, manifest, graphs


def _edit_run(out_dir: Path, edit) -> None:
    path = out_dir / "run" / "run.json"
    run = json.loads(path.read_bytes())
    edit(run)
    _write_json(path, run)


def _set_image(out_dir: Path, index: int, data: bytes, *, update_bytes: bool = True) -> None:
    """Replace one image; keep the receipt byte count honest so later gates are reached."""
    run = json.loads((out_dir / "run" / "run.json").read_bytes())
    row = run["jobs"][index]["files"][0]
    assert (out_dir / "run" / row["path"]).read_bytes() != data
    (out_dir / "run" / row["path"]).write_bytes(data)
    if update_bytes:
        _edit_run(out_dir, lambda r: r["jobs"][index]["files"][0].update(bytes=len(data)))


def _unpublished(out_dir: Path, *, pending: bool = False) -> None:
    assert not (out_dir / retained.RECORD_NAME).exists()
    assert (out_dir / retained.PENDING_RECORD_NAME).exists() is pending


def _encode(record: dict) -> bytes:
    return (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8")


@pytest.mark.parametrize("taxonomy", ["C", "D", "E"])
def test_real_chain_records_and_revalidates_read_only(root: Path, taxonomy: str) -> None:
    out, manifest, graphs = _live(root, taxonomy)
    out_dir = root / out
    record = retained.record_nonpersona_retained(root=root, out=out)  # Windows Path accepted
    compilation = native.revalidate_nonpersona_native(root=root, out=out)

    assert set(record) == {"schema", "stage", "not_promotable", "claims", "out", "compilation",
                           "manifest", "run_record", "creator", "slot", "arm",
                           "native_dimensions", "delivery_target", "delivery_transform",
                           "images", "sources"}
    assert record["schema"] == retained.SCHEMA and record["stage"] == "retained-not-reviewed"
    assert record["not_promotable"] is True
    assert record["claims"] == {"generated": True, "reviewed": False,
                                "slot_fit": False, "delivered": False}
    assert record["out"] == out.as_posix()
    assert record["slot"]["index"] == SLOTS[taxonomy][1]
    assert record["slot"]["taxonomy_type"] == taxonomy
    assert record["native_dimensions"] == {"width": NATIVE[0], "height": NATIVE[1]}
    assert record["delivery_target"] == compilation["delivery_target"]
    assert record["delivery_target"] == {"aspect": "3:4", "width": 1080, "height": 1440}
    assert record["delivery_transform"] is None
    for key, rel in (("compilation", native.RECORD_NAME), ("manifest", native.MANIFEST_NAME),
                     ("run_record", "run/run.json")):
        data = (out_dir / rel).read_bytes()
        assert record[key] == {"path": rel, "bytes": len(data),
                               "sha256": hashlib.sha256(data).hexdigest()}
    for image, cell, job, graph in zip(record["images"], compilation["cells"],
                                       manifest["jobs"], graphs):
        data = (out_dir / image["path"]).read_bytes()
        assert image == {"cell_id": cell["id"], "seed": cell["seed"],
                         "output_name": cell["output_name"],
                         "path": f"run/{cell['output_name']}.png", "bytes": len(data),
                         "sha256": hashlib.sha256(data).hexdigest(), "width": NATIVE[0],
                         "height": NATIVE[1], "review_eligible": True}
        assert job["seed"] == cell["seed"] and graph["10"]["inputs"]["filename_prefix"] == \
            cell["output_name"]
    assert len({i["seed"] for i in record["images"]}) == 3
    assert len({i["sha256"] for i in record["images"]}) == 3

    final = (out_dir / retained.RECORD_NAME).read_bytes()
    assert final == _encode(record)
    assert (out_dir / retained.PENDING_RECORD_NAME).read_bytes() == final
    before = _snapshot(root)
    assert retained.revalidate_nonpersona_retained(root=root, out=out) == record
    assert _snapshot(root) == before


def test_cli_records_posix_relative_out(root: Path) -> None:
    _live(root, "D")
    command = [sys.executable, "-m", "orgs.figment.pipeline.content.nonpersona_retained",
               "--root", str(root), "--out", "out/native-D"]
    done = subprocess.run(command, cwd=REPO, capture_output=True, text=True, timeout=600)
    assert done.returncode == 0, done.stderr
    assert "not reviewed" in done.stdout
    record = retained.revalidate_nonpersona_retained(root=root, out="out/native-D")
    assert record["claims"]["reviewed"] is False
    again = subprocess.run(command, cwd=REPO, capture_output=True, text=True, timeout=600)
    assert again.returncode == 2 and "already exists" in again.stderr


RUN_EDITS = {
    "dry_true": (lambda r: r.update(dry_run=True), "explicit live run"),
    "dry_missing": (lambda r: r.pop("dry_run"), "explicit live run"),
    "dry_zero": (lambda r: r.update(dry_run=0), "explicit live run"),
    "dry_string": (lambda r: r.update(dry_run="false"), "explicit live run"),
    "dry_none": (lambda r: r.update(dry_run=None), "explicit live run"),
    "schema": (lambda r: r.update(schema="figment/runpod-run@2"), "runpod-run@1 receipt"),
    "error": (lambda r: r.update(error="synthetic"), "carries an error"),
    "termination": (lambda r: r.update(termination_verified=False), "termination is not verified"),
    "placement": (lambda r: r["placement_attempts"][0].update(termination_verified=False),
                  "lacks verified termination"),
    "ledger_usd": (lambda r: r["placement_attempts"][0].update(estimated_actual_usd=0.02),
                   "ledger agreement failed"),
    "ledger_day": (lambda r: r.update(ledger_day="2026-09-10"), "cost ledger is missing"),
    "uploads": (lambda r: r.update(uploads=["x"]), "empty uploads and artifacts"),
    "four_jobs": (lambda r: r["jobs"].append(copy.deepcopy(r["jobs"][0])), "exactly the three"),
    "job_order": (lambda r: r["jobs"].insert(0, r["jobs"].pop(1)), "index is out of order"),
    "job_bool": (lambda r: r["jobs"][0].update(job=True), "index is out of order"),
    "seed_float": (lambda r: r["jobs"][0].update(seed=float(r["jobs"][0]["seed"])),
                   "seed differs"),
    "seconds_bool": (lambda r: r["jobs"][0].update(seconds=True), "prompt_id or seconds"),
    "job_field": (lambda r: r["jobs"][0].update(extra=1), "unexpected fields"),
    "file_field": (lambda r: r["jobs"][0]["files"][0].update(sha256="0" * 64),
                   "exactly one output file"),
    "bytes_float": (lambda r: r["jobs"][0]["files"][0].update(
        bytes=float(r["jobs"][0]["files"][0]["bytes"])), "bounded positive integer"),
    "bytes_bool": (lambda r: r["jobs"][0]["files"][0].update(bytes=True),
                   "bounded positive integer"),
    "path_escape": (lambda r: r["jobs"][0]["files"][0].update(
        path="../" + r["jobs"][0]["files"][0]["path"]), "not the expected"),
    "path_absolute": (lambda r: r["jobs"][0]["files"][0].update(
        path="C:/" + r["jobs"][0]["files"][0]["path"]), "not the expected"),
    "basename": (lambda r: r["jobs"][0]["files"][0].update(
        path=r["jobs"][0]["files"][0]["path"][:-4] + ".jpg"), "not the expected"),
}


@pytest.mark.parametrize("case", sorted(RUN_EDITS))
def test_receipt_rejected(root: Path, case: str) -> None:
    edit, message = RUN_EDITS[case]
    out, _, _ = _live(root)
    _edit_run(root / out, edit)
    with pytest.raises(retained.NonpersonaRetainedError, match=message):
        retained.record_nonpersona_retained(root=root, out=out)
    _unpublished(root / out)


def _graph_png(graphs: list[dict], mutate) -> bytes:
    graph = copy.deepcopy(graphs[0])
    mutate(graph)
    return _png(json.dumps(graph), shade=7)


def _reseed(graph: dict) -> None:
    for node in graph.values():
        for field in ("seed", "noise_seed"):
            if field in node.get("inputs", {}):
                node["inputs"][field] += 1


def _apng(graphs: list[dict]) -> bytes:
    info, buffer = PngInfo(), io.BytesIO()
    info.add_text("prompt", json.dumps(graphs[0]))
    first, second = Image.new("RGB", NATIVE, (1, 2, 3)), Image.new("RGB", NATIVE, (9, 8, 7))
    first.save(buffer, "PNG", pnginfo=info, save_all=True, append_images=[second])
    return buffer.getvalue()


IMAGE_CASES = {
    "wrong_seed": (lambda g: _graph_png(g, _reseed), "prompt differs from the graph"),
    "wrong_prefix": (lambda g: _graph_png(
        g, lambda x: x["10"]["inputs"].update(filename_prefix="synthetic-x")),
        "prompt differs from the graph"),
    "extra_node": (lambda g: _graph_png(
        g, lambda x: x.update({"99": {"class_type": "Note", "inputs": {}}})),
        "prompt differs from the graph"),
    "missing_prompt": (lambda g: _png(None, shade=7), "lacks a bounded embedded prompt"),
    "duplicate_key": (lambda g: _png('{"10": {}, ' + json.dumps(g[0])[1:], shade=7),
                      "duplicate JSON key"),
    "nonfinite": (lambda g: _png('{"x": NaN, ' + json.dumps(g[0])[1:], shade=7), "non-finite"),
    "overflow": (lambda g: _png('{"x": 1e999, ' + json.dumps(g[0])[1:], shade=7),
                 "non-finite number"),
    "wrong_dims": (lambda g: _png(json.dumps(g[0]), size=(1447, 2176)),
                   "not a PNG at native tester dimensions"),
    "jpeg_as_png": (lambda g: _png(None, fmt="JPEG"), "not a PNG at native tester dimensions"),
    "truncated": (lambda g: _png(json.dumps(g[0]), shade=7)[:-20], "not a valid complete PNG"),
    "apng": (_apng, "single-frame"),
}


@pytest.mark.parametrize("case", sorted(IMAGE_CASES))
def test_image_gate_rejects(root: Path, case: str) -> None:
    build, message = IMAGE_CASES[case]
    out, _, graphs = _live(root)
    _set_image(root / out, 0, build(graphs))
    with pytest.raises(retained.NonpersonaRetainedError, match=message):
        retained.record_nonpersona_retained(root=root, out=out)
    _unpublished(root / out)


def test_swapped_images_with_honest_bytes_rejected_by_graph(root: Path) -> None:
    out, _, _ = _live(root)
    run_dir = root / out / "run"
    names = [row["files"][0]["path"]
             for row in json.loads((run_dir / "run.json").read_bytes())["jobs"]]
    first, second = (run_dir / names[0]).read_bytes(), (run_dir / names[1]).read_bytes()
    _set_image(root / out, 0, second)
    _set_image(root / out, 1, first)
    with pytest.raises(retained.NonpersonaRetainedError, match="prompt differs from the graph"):
        retained.record_nonpersona_retained(root=root, out=out)


def test_real_receipt_overflow_rejected(root: Path) -> None:
    out, _, _ = _live(root)
    path = root / out / "run" / "run.json"
    data = path.read_bytes()
    assert b'"seconds": 12.5' in data
    mutated = data.replace(b'"seconds": 12.5', b'"seconds": 1e999', 1)
    assert mutated != data
    path.write_bytes(mutated)
    with pytest.raises(retained.NonpersonaRetainedError, match="non-finite number"):
        retained.record_nonpersona_retained(root=root, out=out)
    _unpublished(root / out)


def test_receipt_byte_count_mismatch_rejected(root: Path) -> None:
    out, _, _ = _live(root)
    out_dir = root / out
    row = json.loads((out_dir / "run" / "run.json").read_bytes())["jobs"][0]["files"][0]
    actual_bytes = len((out_dir / "run" / row["path"]).read_bytes())
    _edit_run(out_dir, lambda r: r["jobs"][0]["files"][0].update(bytes=actual_bytes + 1))
    assert json.loads((out_dir / "run" / "run.json").read_bytes())[
        "jobs"][0]["files"][0]["bytes"] != actual_bytes
    with pytest.raises(retained.NonpersonaRetainedError, match="bytes differ from the run receipt"):
        retained.record_nonpersona_retained(root=root, out=out)


def test_truncation_tolerant_pillow_refused(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out, _, _ = _live(root)
    monkeypatch.setattr(ImageFile, "LOAD_TRUNCATED_IMAGES", True)
    with pytest.raises(retained.NonpersonaRetainedError, match="tolerate truncated images"):
        retained.record_nonpersona_retained(root=root, out=out)


@pytest.mark.parametrize("target", ["image", "run.json"])
def test_hardlinked_input_refused(root: Path, target: str) -> None:
    out, manifest, _ = _live(root)
    name = f"{manifest['jobs'][0]['output_name']}.png" if target == "image" else "run.json"
    os.link(root / out / "run" / name, root / f"alias-{target}")
    with pytest.raises(retained.NonpersonaRetainedError, match="must not be hard-linked"):
        retained.record_nonpersona_retained(root=root, out=out)
    _unpublished(root / out)


def test_symlinked_image_refused(root: Path) -> None:
    out, manifest, _ = _live(root)
    image = root / out / "run" / f"{manifest['jobs'][0]['output_name']}.png"
    real = root / "real.png"
    image.replace(real)
    try:
        os.symlink(real, image)
    except OSError as exc:  # Windows without Developer Mode / SeCreateSymbolicLink.
        pytest.skip(f"symlink creation not permitted: {exc}")
    with pytest.raises(retained.NonpersonaRetainedError, match="missing or linked"):
        retained.record_nonpersona_retained(root=root, out=out)


@pytest.mark.parametrize("after_build", [1, 2])
def test_input_mutation_between_builds_rejected(root: Path, monkeypatch: pytest.MonkeyPatch,
                                                after_build: int) -> None:
    out, manifest, graphs = _live(root)
    out_dir, real_build, calls = root / out, retained._build, []
    first = out_dir / "run" / f"{manifest['jobs'][0]['output_name']}.png"
    original = first.read_bytes()

    def build(root_arg, out_arg):
        result = real_build(root_arg, out_arg)
        calls.append(1)
        if len(calls) == after_build:  # a valid, honest, but different image appears
            _set_image(out_dir, 0, _png(json.dumps(graphs[0]), shade=200))
        return result

    monkeypatch.setattr(retained, "_build", build)
    with pytest.raises(retained.NonpersonaRetainedError, match="images changed while recording"):
        retained.record_nonpersona_retained(root=root, out=out)
    monkeypatch.undo()
    assert len(calls) == after_build + 1
    assert first.read_bytes() != original
    _unpublished(out_dir, pending=after_build == 2)


def _rewrite_record(out_dir: Path, name: str, edit) -> None:
    path = out_dir / name
    record = json.loads(path.read_bytes())
    edit(record)
    path.write_bytes(_encode(record))  # hard-linked pending changes with it


def _replace_pending(out_dir: Path) -> None:
    (out_dir / retained.PENDING_RECORD_NAME).unlink()
    (out_dir / retained.PENDING_RECORD_NAME).write_bytes(b"{}\n")


TAMPERS = {
    "unknown_field": (lambda d: _rewrite_record(d, retained.RECORD_NAME,
                                                lambda r: r.update(extra=1)), "retained record is stale"),
    "not_eligible": (lambda d: _rewrite_record(d, retained.RECORD_NAME,
                                               lambda r: r["images"][0].update(review_eligible=False)),
                     "retained record is stale"),
    "approved": (lambda d: _rewrite_record(d, retained.RECORD_NAME,
                                           lambda r: r["claims"].update(approved=True)),
                 "retained record is stale"),
    "reformatted": (lambda d: (d / retained.RECORD_NAME).write_bytes(
        json.dumps(json.loads((d / retained.RECORD_NAME).read_bytes())).encode()),
        "retained record is stale"),
    "pending_differs": (_replace_pending, "pending retained record differs"),
    "run_edited": (lambda d: _edit_run(d, lambda r: r["jobs"][0].update(seconds=13.0)),
                   "retained record is stale"),
    "stale_compilation": (lambda d: _rewrite_record(d, native.RECORD_NAME,
                                                    lambda r: r.update(extra=1)),
                          "compilation record is stale"),
}


@pytest.mark.parametrize("case", sorted(TAMPERS))
def test_revalidate_rejects_tamper_and_writes_nothing(root: Path, case: str) -> None:
    tamper, message = TAMPERS[case]
    out, _, _ = _live(root)
    retained.record_nonpersona_retained(root=root, out=out)
    tamper(root / out)
    before = _snapshot(root)
    with pytest.raises(retained.NonpersonaRetainedError, match=message):
        retained.revalidate_nonpersona_retained(root=root, out=out)
    assert _snapshot(root) == before


def test_fsync_failure_of_retained_pending_publishes_nothing(
        root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out, _, _ = _live(root)  # native compilation fsyncs happen before the patch
    out_dir, real_fsync, hits = root / out, os.fsync, []

    def fsync(fd: int) -> None:
        if (out_dir / retained.PENDING_RECORD_NAME).exists():
            hits.append(fd)
            raise OSError("injected retained fsync failure")
        real_fsync(fd)

    monkeypatch.setattr(retained.os, "fsync", fsync)
    with pytest.raises(retained.NonpersonaRetainedError, match="injected retained fsync failure"):
        retained.record_nonpersona_retained(root=root, out=out)
    monkeypatch.undo()
    assert len(hits) == 1
    _unpublished(out_dir, pending=True)
    with pytest.raises(retained.NonpersonaRetainedError, match="retained record is missing"):
        retained.revalidate_nonpersona_retained(root=root, out=out)


def test_unsupported_hardlink_publishes_nothing(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out, _, _ = _live(root)

    def link(*_args) -> None:
        raise OSError("hardlinks unsupported (injected)")

    monkeypatch.setattr(retained.os, "link", link)
    with pytest.raises(retained.NonpersonaRetainedError, match="hardlinks unsupported"):
        retained.record_nonpersona_retained(root=root, out=out)
    monkeypatch.undo()
    _unpublished(root / out, pending=True)
    pending = json.loads((root / out / retained.PENDING_RECORD_NAME).read_bytes())
    assert pending["stage"] == "retained-not-reviewed"


def test_final_race_preserves_foreign_bytes(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out, _, _ = _live(root)
    final, real_link = root / out / retained.RECORD_NAME, os.link

    def link(src, dst) -> None:
        final.write_bytes(b"foreign writer\n")
        real_link(src, dst)

    monkeypatch.setattr(retained.os, "link", link)
    with pytest.raises(retained.NonpersonaRetainedError, match="did not publish"):
        retained.record_nonpersona_retained(root=root, out=out)
    monkeypatch.undo()
    assert final.read_bytes() == b"foreign writer\n"
    assert (root / out / retained.PENDING_RECORD_NAME).is_file()
    with pytest.raises(retained.NonpersonaRetainedError):
        retained.revalidate_nonpersona_retained(root=root, out=out)


@pytest.mark.parametrize("name", [retained.PENDING_RECORD_NAME, retained.RECORD_NAME])
def test_existing_target_untouched(root: Path, name: str) -> None:
    out, _, _ = _live(root)
    (root / out / name).write_bytes(b"another writer\n")
    before = _snapshot(root)
    with pytest.raises(retained.NonpersonaRetainedError, match="already exists"):
        retained.record_nonpersona_retained(root=root, out=out)
    assert _snapshot(root) == before
