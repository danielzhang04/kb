"""Record the three retained native images of one live non-persona tester run.

Offline only. Given an existing native compilation directory, this revalidates the
compilation, reads the harness ``run/run.json`` receipt the compiled argv would have
written, runs the existing ``figment_train.verify_run_record`` receipt/ledger checks,
and binds the original bytes of exactly three native PNGs. The resulting record makes
those images eligible for human visual review. It is not approval, slot fit,
promotion, or delivery, and it never runs, transforms, or edits anything.

``generated`` means only: a non-dry harness receipt with verified teardown and ledger
agreement, whose three output PNGs decode at native size and embed the exact graph
``apply_job`` submits for each manifest job. This is local, unsigned evidence; it is
not cryptographic proof that a GPU produced the bytes, and it says nothing of quality.

Publication mirrors the native compiler: an exclusive pending file is fsynced and then
hard-linked to ``RECORD_NAME`` (never overwriting). The pending file is retained as a
byte-identical duplicate; filesystems without hardlinks fail closed.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

try:
    from . import nonpersona_native as native
except ImportError:  # Direct script execution.
    _spec = importlib.util.spec_from_file_location(
        "figment_nonpersona_retained_native", Path(__file__).with_name("nonpersona_native.py"),
    )
    if _spec is None or _spec.loader is None:
        raise RuntimeError("nonpersona_native.py authority is unavailable")
    native = importlib.util.module_from_spec(_spec)
    sys.modules[_spec.name] = native
    _spec.loader.exec_module(native)

briefs, prep = native.briefs, native.prep

SCHEMA = "figment/nonpersona-native-retained@1"
RECORD_NAME = "nonpersona-native-retained.json"
# Retained after publication by design; revalidation accepts it only as a byte-identical copy.
PENDING_RECORD_NAME = ".nonpersona-native-retained.pending"
RUN_DIR_NAME = "run"
RUN_RECORD_NAME = "run.json"
RUN_SCHEMA = "figment/runpod-run@1"
JOB_KEYS = {"job", "output_name", "seed", "prompt_id", "seconds", "files"}
MAX_IMAGE_BYTES = 64 * 1024 * 1024
ERRORS = (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError)


class NonpersonaRetainedError(ValueError):
    """A native compilation's run output cannot be recorded or revalidated."""


def _fail(message: str) -> NonpersonaRetainedError:
    return NonpersonaRetainedError(message)


def _domain(exc: Exception) -> NonpersonaRetainedError:
    if isinstance(exc, NonpersonaRetainedError):
        return exc
    return NonpersonaRetainedError(f"{type(exc).__name__}: {exc}")


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _binding(path: str, data: bytes) -> dict[str, Any]:
    return {"path": path, "bytes": len(data), "sha256": _digest(data)}


def _reject_nonfinite(value: object, label: str) -> None:
    # Only floats can be non-finite; huge ints are exact and math.isfinite would overflow.
    if isinstance(value, float) and not math.isfinite(value):
        raise _fail(f"{label} carries a non-finite number")
    if isinstance(value, dict):
        for item in value.values():
            _reject_nonfinite(item, label)
    elif isinstance(value, list):
        for item in value:
            _reject_nonfinite(item, label)


def _parse_retained(data: bytes, label: str) -> dict[str, Any]:
    """native._parse bounds, plus rejection of overflowed literals such as 1e999 (-> inf)."""
    value = native._parse(data, label)  # Depth is bounded here before the recursive walk.
    _reject_nonfinite(value, label)
    return value


def _identity(value: os.stat_result) -> tuple[int, int, int, int]:
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)


def _read_unlinked(path: Path, maximum: int, label: str) -> bytes:
    """One bounded snapshot of a regular, singly-linked, non-reparse file."""
    if briefs._is_reparse(path) or not path.is_file():
        raise _fail(f"{label} is missing or linked")
    before = path.stat()
    if before.st_nlink != 1:
        raise _fail(f"{label} must not be hard-linked")
    with path.open("rb") as handle:
        opened = os.fstat(handle.fileno())
        data = handle.read(maximum + 1)
        finished = os.fstat(handle.fileno())
    if len(data) > maximum:
        raise _fail(f"{label} exceeds {maximum} bytes")
    if not (_identity(before) == _identity(opened) == _identity(finished) == _identity(path.stat())) \
            or len(data) != before.st_size:
        raise _fail(f"{label} changed while it was read")
    return data


def _check_run(run: dict[str, Any], cells: list[dict[str, Any]],
               manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """Checks verify_run_record does not make: live receipt, seeds, exact file rows."""
    if run.get("schema") != RUN_SCHEMA:
        raise _fail("run record is not a harness figment/runpod-run@1 receipt")
    if "dry_run" not in run or run["dry_run"] is not False:
        raise _fail("run record is not an explicit live run (dry_run must be false)")
    if "error" in run:
        raise _fail("run record carries an error")
    if run.get("termination_verified") is not True:
        raise _fail("run record termination is not verified")
    if run.get("uploads") != [] or run.get("artifacts") != []:
        raise _fail("run record must carry empty uploads and artifacts")
    jobs, manifest_jobs = run.get("jobs"), manifest.get("jobs")
    if not isinstance(jobs, list) or not isinstance(manifest_jobs, list) \
            or not len(jobs) == len(manifest_jobs) == len(cells) == 3:
        raise _fail("run record must carry exactly the three manifest jobs")
    rows = []
    for number, (job, planned, cell) in enumerate(zip(jobs, manifest_jobs, cells), start=1):
        if not isinstance(job, dict) or set(job) != JOB_KEYS:
            raise _fail(f"run job {number} has unexpected fields")
        seed, name = cell["seed"], cell["output_name"]
        if type(job["job"]) is not int or job["job"] != number:
            raise _fail(f"run job {number} index is out of order")
        if type(job["seed"]) is not int or type(seed) is not int or job["seed"] != seed \
                or type(planned.get("seed")) is not int or planned["seed"] != seed:
            raise _fail(f"run job {number} seed differs from the compiled cell")
        if not isinstance(name, str) or job["output_name"] != name or planned.get("output_name") != name \
                or planned.get("expected_images") != 1:
            raise _fail(f"run job {number} output name differs from the compiled cell")
        if not isinstance(job["prompt_id"], str) or not job["prompt_id"] or \
                type(job["seconds"]) not in (int, float) or job["seconds"] < 0:
            raise _fail(f"run job {number} prompt_id or seconds is malformed")
        if type(job["seconds"]) is float and not math.isfinite(job["seconds"]):
            raise _fail(f"run job {number} seconds is not finite")
        files = job["files"]
        if not isinstance(files, list) or len(files) != 1 or not isinstance(files[0], dict) \
                or set(files[0]) != {"path", "bytes"}:
            raise _fail(f"run job {number} must record exactly one output file")
        path, size = files[0]["path"], files[0]["bytes"]
        # download_job_outputs saves a single expected image as <output_name><suffix>.
        if path != f"{name}.png":
            raise _fail(f"run job {number} output path is not the expected {name}.png")
        if type(size) is not int or not 0 < size <= MAX_IMAGE_BYTES:
            raise _fail(f"run job {number} output bytes are not a bounded positive integer")
        rows.append({"cell": cell, "path": path, "bytes": size})
    if len({row["path"] for row in rows}) != 3 or len({row["cell"]["id"] for row in rows}) != 3:
        raise _fail("run outputs must be three distinct files for three distinct cells")
    return rows


def _decode_png(data: bytes, expected: tuple[int, int]) -> object:
    """Verify, reopen, and fully decode one byte snapshot; return its embedded prompt."""
    try:
        from PIL import Image, ImageFile
    except ImportError as exc:
        raise _fail("Pillow is required to verify retained PNGs") from exc
    if ImageFile.LOAD_TRUNCATED_IMAGES:
        raise _fail("Pillow is configured to tolerate truncated images")
    try:
        with Image.open(io.BytesIO(data)) as image:
            header = (image.format, image.size)
            # Refuse before any pixel decode so a huge declared size is never allocated.
            if header == ("PNG", expected):
                image.verify()
        if header != ("PNG", expected):
            raise _fail("retained image is not a PNG at native tester dimensions")
        with Image.open(io.BytesIO(data)) as image:
            if image.size != expected or getattr(image, "n_frames", 1) != 1 \
                    or getattr(image, "is_animated", False):
                raise _fail("retained image must be a single-frame native PNG")
            image.load()
            return image.info.get("prompt")
    except NonpersonaRetainedError:
        raise
    except Exception as exc:  # Untrusted bytes: any decoder failure is a rejection.
        raise _fail(f"retained image is not a valid complete PNG: {type(exc).__name__}") from exc


def _check_image(run_dir: Path, row: dict[str, Any], expected_graph: dict[str, Any],
                 native_dims: dict[str, int]) -> dict[str, Any]:
    cell, name = row["cell"], row["path"]
    data = _read_unlinked(run_dir / name, MAX_IMAGE_BYTES, f"retained image {name}")
    if len(data) != row["bytes"]:
        raise _fail(f"retained image {name} bytes differ from the run receipt")
    size = (native_dims["width"], native_dims["height"])
    prompt = _decode_png(data, size)
    if not isinstance(prompt, str) or len(prompt.encode("utf-8")) > briefs.MAX_JSON_BYTES:
        raise _fail(f"retained image {name} lacks a bounded embedded prompt")
    embedded = _parse_retained(prompt.encode("utf-8"), f"retained image {name} prompt")
    if not prep._strict_equal(embedded, expected_graph):
        raise _fail(f"retained image {name} prompt differs from the graph submitted for its job")
    return {
        "cell_id": cell["id"], "seed": cell["seed"], "output_name": cell["output_name"],
        "path": f"{RUN_DIR_NAME}/{name}", "bytes": len(data), "sha256": _digest(data),
        "width": size[0], "height": size[1], "review_eligible": True,
    }


def _build(root: Path, out: object) -> tuple[dict[str, Any], dict[str, str]]:
    """Fresh record plus the digests of every input snapshot it was built from."""
    out_dir, out_rel = native._out_dir(root, out, existing=True)
    compilation = native.revalidate_nonpersona_native(root=root, out=out)
    record_data = native._read_bounded(out_dir / native.RECORD_NAME, "compilation record")
    manifest_path = out_dir / native.MANIFEST_NAME
    manifest_data = native._read_bounded(manifest_path, "frozen manifest")
    # Bind the bytes read here to the exact record revalidation accepted, not a later swap.
    if record_data != native._encode_record(compilation) or compilation.get("out") != out_rel \
            or compilation["manifest"] != \
            {"path": native.MANIFEST_NAME, "sha256": _digest(manifest_data)} \
            or compilation["run"].get("out") != RUN_DIR_NAME:
        raise _fail("compilation does not bind this directory, manifest, and run directory")
    manifest = _parse_retained(manifest_data, "frozen manifest")
    run_dir = out_dir / RUN_DIR_NAME
    if briefs._is_reparse(run_dir) or not run_dir.is_dir():
        raise _fail("compiled run directory is missing or linked")
    run_data = _read_unlinked(run_dir / RUN_RECORD_NAME, briefs.MAX_JSON_BYTES, "run record")
    run = _parse_retained(run_data, "run record")
    cells = compilation["cells"]
    rows = _check_run(run, cells, manifest)

    train = native._train()
    pod = train._pod_runner_module()
    verified = train.verify_run_record("tester", manifest, run_dir, Path(compilation["ledger_dir"]))
    if not prep._strict_equal(verified, run):
        raise _fail("verified run record differs from the bounded run snapshot")
    base = pod.load_workflow(manifest, manifest_path)
    seed_fields = pod.manifest_seed_fields(manifest)
    images = [
        _check_image(run_dir, row, pod.apply_job(base, planned, seed_fields),
                     compilation["native_dimensions"])
        for row, planned in zip(rows, manifest["jobs"])
    ]
    if _read_unlinked(run_dir / RUN_RECORD_NAME, briefs.MAX_JSON_BYTES, "run record") != run_data or \
            native._read_bounded(out_dir / native.RECORD_NAME, "compilation record") != record_data or \
            native._read_bounded(manifest_path, "frozen manifest") != manifest_data:
        raise _fail("compilation or run record changed while recording")

    code = Path(__file__)
    if briefs._is_reparse(code) or not code.is_file():
        raise _fail("retained-record code source is missing or linked")
    record = {
        "schema": SCHEMA,
        "stage": "retained-not-reviewed",
        "not_promotable": True,
        "claims": {"generated": True, "reviewed": False, "slot_fit": False, "delivered": False},
        "out": out_rel,
        "compilation": _binding(native.RECORD_NAME, record_data),
        "manifest": _binding(native.MANIFEST_NAME, manifest_data),
        "run_record": _binding(f"{RUN_DIR_NAME}/{RUN_RECORD_NAME}", run_data),
        "creator": compilation["creator"],
        "slot": compilation["slot"],
        "arm": compilation["arm"],
        "native_dimensions": compilation["native_dimensions"],
        "delivery_target": compilation["delivery_target"],
        "delivery_transform": None,
        "images": images,
        "sources": [{"label": "code:nonpersona_retained", "path": code.resolve().as_posix(),
                     "sha256": prep._sha256(code)}],
    }
    snapshots = {"compilation": _digest(record_data), "manifest": _digest(manifest_data),
                 "run_record": _digest(run_data)}
    snapshots.update({image["path"]: image["sha256"] for image in images})
    return record, snapshots


def _encode(record: dict[str, Any]) -> bytes:
    data = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(data) > briefs.MAX_JSON_BYTES:
        raise _fail("retained record exceeds output size limit")
    return data


def _replay(root: Path, out: object, record: dict[str, Any], snapshots: dict[str, str]) -> None:
    again, again_snapshots = _build(root, out)
    if not prep._strict_equal(again, record) or again_snapshots != snapshots:
        raise _fail("compilation, run record, or images changed while recording")


def record_nonpersona_retained(*, root: Path, out: str | Path) -> dict[str, Any]:
    """Publish the retained-output record for one native compilation's live run.

    The commit point is ``os.link(pending, RECORD_NAME)``, exclusive and never
    overwriting. Nothing fallible runs after it. Before it, any failure means this call
    did not publish; an existing record or pending file is never touched or removed.
    """
    try:
        root = briefs._safe_root(Path(root))
        out_dir, _ = native._out_dir(root, out, existing=True)
        pending_path, final_path = out_dir / PENDING_RECORD_NAME, out_dir / RECORD_NAME
        for path in (pending_path, final_path):
            if path.exists() or briefs._is_reparse(path):
                raise _fail(f"{path.name} already exists; refusing to overwrite")
        record, snapshots = _build(root, out)
        _replay(root, out, record, snapshots)
        encoded = _encode(record)
    except ERRORS as exc:
        raise NonpersonaRetainedError(
            f"this call did not publish {RECORD_NAME}; any existing target from another "
            f"writer was left untouched: {_domain(exc)}"
        ) from exc
    try:
        with pending_path.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        _replay(root, out, record, snapshots)
        native._out_dir(root, out, existing=True)
        if native._read_bounded(pending_path, "pending retained record") != encoded:
            raise _fail("pending retained record changed before publication")
        os.link(pending_path, final_path)  # Commit point: exclusive, never overwrites.
    except ERRORS as exc:
        raise NonpersonaRetainedError(
            f"this call did not publish {RECORD_NAME}; a pending file it wrote is retained and "
            f"untrusted, and another writer's existing target may remain: {_domain(exc)}"
        ) from exc
    return record


def revalidate_nonpersona_retained(*, root: Path, out: str | Path) -> dict[str, Any]:
    """Return the record only when it byte-matches a fresh reconstruction from disk."""
    try:
        root = briefs._safe_root(Path(root))
        out_dir, _ = native._out_dir(root, out, existing=True)
        final_path = out_dir / RECORD_NAME
        record_data = native._read_bounded(final_path, "retained record")
        stored = _parse_retained(record_data, "retained record")
        expected, _ = _build(root, out)
        if not prep._strict_equal(stored, expected) or record_data != _encode(expected):
            raise _fail("retained record is stale, edited, or has unknown fields")
        if native._read_bounded(final_path, "retained record") != record_data:
            raise _fail("retained record changed while revalidating")
        pending_path = out_dir / PENDING_RECORD_NAME
        if (pending_path.exists() or briefs._is_reparse(pending_path)) and \
                native._read_bounded(pending_path, "pending retained record") != record_data:
            raise _fail("pending retained record differs from the published record")
        return expected
    except ERRORS as exc:
        raise _domain(exc) from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Record the three retained native images of a live non-persona tester run "
                    "as eligible for human review (not approval, never runs anything).",
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        record_nonpersona_retained(root=args.root, out=args.out)
    except NonpersonaRetainedError as exc:
        parser.error(str(exc))
    print(f"nonpersona retained record (not reviewed): {args.out}/{RECORD_NAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
