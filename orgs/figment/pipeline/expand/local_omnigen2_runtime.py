"""Thin controller for the fixed local OmniGen2 reference run (two seeds, 768 square).

Policy closes here; lifecycle mechanics live in the shared pair engine. Every
sibling module is loaded from a fixed studio path and hash-checked before
compilation: the admission module against the bootstrap pin below, everything
else against the admitted evidence. No file I/O happens at import time.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
import os
import re
import shutil
import stat
import sys
import time
import types
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parents[3]
MAIN_PRIVATE = STUDIO.parents[1]

ADMISSION_REL = "orgs/figment/pipeline/expand/local_omnigen2_admission.py"
RUNTIME_REL = "orgs/figment/pipeline/expand/local_omnigen2_runtime.py"
RESOURCES_REL = "orgs/figment/pipeline/expand/local_omnigen2_resources.py"
HELPER_REL = "orgs/figment/pipeline/expand/local_comfy_input.py"
ENGINE_REL = "orgs/figment/pipeline/train/local_lora_pair_engine.py"
ADMISSION_SHA256 = "313b5b1269f738035f0ba9e979f9d748a0aecf02b48863fab90ed3110e7e7e51"

SCHEMA = "figment/local-omnigen2-runtime@1"
STAGE = "reference"
SEEDS = (481516234, 90210)
EXPECTED_FILENAMES = {481516234: "figment-local-omnigen2_00001_.png", 90210: "figment-local-omnigen2_00002_.png"}
OUTPUT_NODE = "9"
SIZE = 768
INPUT_NAME = "g01.jpg"
MAX_CODE_BYTES = 512 * 1024
MAX_INPUT_BYTES = 1024 * 1024
MAX_PNG_BYTES = 8 * 1024 * 1024
MAX_STDERR_BYTES = 16 * 1024 * 1024
MAX_LORA_BYTES = 1024 * 1024
MAX_OUTPUT_ENTRIES = 3
DEADLINE_SECONDS = 6000.0
READINESS_SECONDS = 180.0
ROW_SECONDS = 2700.0
TEARDOWN_ACCEPTANCE_SECONDS = 30.0
OBSERVER_INTERVAL_SECONDS = 1.0
OBSERVER_MAXIMUM_SAMPLES = 6100
HEX64 = re.compile(r"^[0-9a-f]{64}$")
_MODULE_PREFIX = "figment_local_omnigen2_runtime_checked"
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class RuntimeControllerError(RuntimeError):
    pass


# ------------------------------------------------------------- checked loading
def _reject_reparse_chain(path: Path) -> None:
    cursor = path
    while True:
        info = os.lstat(cursor)
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & REPARSE_POINT:
            raise RuntimeControllerError(f"checked path traverses a reparse point: {cursor}")
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def _load_checked(relative: str, expected_sha: str) -> types.ModuleType:
    if not isinstance(expected_sha, str) or not HEX64.fullmatch(expected_sha):
        raise RuntimeControllerError(f"no reviewed hash for {relative}")
    path = STUDIO / relative
    _reject_reparse_chain(path)
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size == 0 or before.st_size > MAX_CODE_BYTES:
        raise RuntimeControllerError(f"checked source has an unsafe shape: {relative}")
    with path.open("rb") as handle:
        data = handle.read(MAX_CODE_BYTES + 1)
    after = path.stat()
    if len(data) != before.st_size or (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
        raise RuntimeControllerError(f"checked source changed while read: {relative}")
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise RuntimeControllerError(f"checked source hash mismatch: {relative}")
    name = f"{_MODULE_PREFIX}.{Path(relative).stem}"
    module = types.ModuleType(name)
    module.__file__ = str(path)
    sys.modules[name] = module
    try:
        exec(compile(data, str(path), "exec", dont_inherit=True), module.__dict__)  # noqa: S102 - hash-checked above
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


def _load_admission() -> types.ModuleType:
    return _load_checked(ADMISSION_REL, ADMISSION_SHA256)


def _strict_json(text: str, label: str) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise RuntimeControllerError(f"{label} has a duplicate key")
            result[key] = value
        return result

    def constant(token: str) -> Any:
        raise RuntimeControllerError(f"{label} contains a non-finite number")

    try:
        return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    except json.JSONDecodeError as exc:
        raise RuntimeControllerError(f"{label} is not valid JSON") from exc


# ------------------------------------------------------------------ controller
class _Observer:
    """Tiny wrapper around resources.ResourceObserver adding controller-owned runtime metadata."""

    def __init__(self, base: Any, metadata: dict[str, Any]) -> None:
        self._base, self._metadata = base, metadata

    def __getattr__(self, name: str) -> Any:
        return getattr(self._base, name)

    def record(self) -> dict[str, Any]:
        result = self._base.record()
        runtime = copy.deepcopy(self._metadata)
        runtime["total_elapsed_seconds"] = time.monotonic() - runtime["started_monotonic"]
        result["runtime"] = runtime
        return result


class _HelperProxy:
    """Delegates to the immutable helper; overrides only port check, prompt binding, and teardown timing."""

    def __init__(self, helper: Any, controller: "Controller") -> None:
        self._helper, self._controller = helper, controller

    def __getattr__(self, name: str) -> Any:
        return getattr(self._helper, name)

    def _port_available(self) -> None:
        self._helper._port_available()
        self._controller.preflight()

    def _local_json(self, opener: Any, method: str, endpoint: str, payload: Any = None) -> dict[str, Any]:
        if method == "POST" and endpoint == "/prompt":
            seed = self._controller.bind_dispatch(payload)
            started = time.monotonic()
            result = self._helper._local_json(opener, method, endpoint, payload)
            self._controller.bind_prompt(seed, result, started)
            return result
        return self._helper._local_json(opener, method, endpoint, payload)

    def _teardown(self, wrapper: Any, tracked: Any, process: Any) -> dict[str, Any]:
        started = time.monotonic()
        try:
            result = self._helper._teardown(wrapper, tracked, process)
        finally:
            elapsed = time.monotonic() - started
            self._controller.metadata["teardown"] = {"elapsed_seconds": elapsed, "within_30s_acceptance": elapsed <= TEARDOWN_ACCEPTANCE_SECONDS}
        result = dict(result)
        result["elapsed_seconds"] = elapsed
        result["within_30s_acceptance"] = elapsed <= TEARDOWN_ACCEPTANCE_SECONDS
        return result


class Controller:
    def __init__(self, admission: Any, engine: Any, resources: Any, helper: Any, admitted: Any) -> None:
        self.admission, self.engine, self.resources, self.helper = admission, engine, resources, helper
        self.admitted = admitted
        self.evidence: dict[str, Any] = json.loads(admission.canonical(admitted["evidence"]))
        self.rows = self._rows()
        self.metadata: dict[str, Any] = {"started_monotonic": time.monotonic(), "preflight": None, "rows": {}, "teardown": None, "input": None}
        self.bindings: dict[str, int] = {}
        self.dispatched = 0
        self.sampler = resources.WindowsSampler(helper)
        self.root = Path(self.evidence["run_root"])
        if self.root != admission.RUN_ROOT or self.root.parent != MAIN_PRIVATE:
            raise RuntimeControllerError("admitted run root is not the fixed root")

    def error(self, message: str) -> Exception:
        return RuntimeControllerError(message)

    def _rows(self) -> list[dict[str, Any]]:
        runs = self.evidence["manifest"]["runs"]
        if [run["seed"] for run in runs] != list(SEEDS):
            raise RuntimeControllerError("admitted manifest seeds are not the fixed pair")
        rows = []
        for run in runs:
            graph_sha = hashlib.sha256(self.admission.canonical(run["graph"])).hexdigest()
            if graph_sha != run["graph_sha256"] or not HEX64.fullmatch(graph_sha):
                raise RuntimeControllerError("admitted graph hash does not match its graph")
            rows.append({"id": f"omnigen2-seed-{run['seed']}", "seed": run["seed"], "graph": run["graph"], "graph_sha256": graph_sha})
        return rows

    # ----- prelaunch ---------------------------------------------------------
    def preflight(self) -> None:
        sample = self.sampler({})
        self.metadata["preflight"] = self.resources.preflight(sample, shutil.disk_usage(MAIN_PRIVATE).free)

    def prepare_root(self, root: Path) -> None:
        reference = self.evidence["reference"]
        input_dir = root / "input"
        input_dir.mkdir()
        self.engine.copy_stream(self.admission.REFERENCE_PATH, input_dir / INPUT_NAME, reference["sha256"], maximum=MAX_INPUT_BYTES, source_root=STUDIO, safe_existing=self.admission.safe, reparse=self.admission.reparse, file_hash=self.admission.hash_file, error=self.error)
        self.metadata["input"] = {"filename": INPUT_NAME, "sha256": reference["sha256"], "bytes": reference["bytes"]}

    # ----- dispatch binding --------------------------------------------------
    def bind_dispatch(self, payload: Any) -> int:
        if self.dispatched >= len(self.rows):
            raise RuntimeControllerError("more prompts dispatched than admitted rows")
        row = self.rows[self.dispatched]
        graph = payload.get("prompt") if isinstance(payload, dict) else None
        if hashlib.sha256(self.admission.canonical(graph)).hexdigest() != row["graph_sha256"]:
            raise RuntimeControllerError("dispatched graph is not the next admitted row")
        self.dispatched += 1
        return row["seed"]

    def bind_prompt(self, seed: int, result: Any, started: float) -> None:
        prompt_id = result.get("prompt_id") if isinstance(result, dict) else None
        if not isinstance(prompt_id, str) or prompt_id in self.bindings:
            raise RuntimeControllerError("local prompt id is missing or reused")
        self.bindings[prompt_id] = seed
        self.metadata["rows"][str(seed)] = {"prompt_id": prompt_id, "started_monotonic": started, "finished_monotonic": None, "elapsed_seconds": None}

    # ----- decoder -----------------------------------------------------------
    def _read_png(self, path: Path) -> bytes:
        return self.admission._read_bounded(path, MAX_PNG_BYTES)[0]

    def completed_output(self, history: Any, prompt_id: str, output: Path) -> dict[str, Any] | None:
        seed = self.bindings.get(prompt_id)
        if seed is None:
            raise RuntimeControllerError("history prompt id was never bound to a row")
        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if not isinstance(entry, dict):
            return None
        status = entry.get("status")
        if isinstance(status, dict) and status.get("status_str") == "error":
            raise RuntimeControllerError("local ComfyUI reported a generation error")
        outputs = entry.get("outputs")
        if not isinstance(outputs, dict):
            return None
        if set(outputs) != {OUTPUT_NODE}:
            raise RuntimeControllerError("local ComfyUI reported an unexpected output node")
        images = outputs[OUTPUT_NODE].get("images") if isinstance(outputs[OUTPUT_NODE], dict) else None
        if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict):
            raise RuntimeControllerError("local ComfyUI did not report exactly one output image")
        image_record = images[0]
        filename = image_record.get("filename")
        if image_record.get("type") != "output" or image_record.get("subfolder") != "" or filename != EXPECTED_FILENAMES[seed]:
            raise RuntimeControllerError("local ComfyUI returned an output outside the fixed inventory")
        image = self.admission.safe(output / filename, output, "output image")
        if self.admission.reparse(image):
            raise RuntimeControllerError("output image is a reparse point")
        if not image.exists():
            return None
        data = self._read_png(image)
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as decoded:
                if decoded.format != "PNG" or decoded.size != (SIZE, SIZE):
                    raise RuntimeControllerError("output image has wrong format or dimensions")
                decoded.load()
                embedded = decoded.info.get("prompt")
        except RuntimeControllerError:
            raise
        except Exception as exc:
            raise RuntimeControllerError("output image is not a valid PNG") from exc
        if not isinstance(embedded, str):
            raise RuntimeControllerError("output image carries no embedded prompt")
        graph = _strict_json(embedded, "embedded prompt")
        row = next(r for r in self.rows if r["seed"] == seed)
        if self.admission.canonical(graph) != self.admission.canonical(row["graph"]):
            raise RuntimeControllerError("embedded prompt graph differs from the admitted graph")
        timing = self.metadata["rows"][str(seed)]
        timing["finished_monotonic"] = time.monotonic()
        timing["elapsed_seconds"] = timing["finished_monotonic"] - timing["started_monotonic"]
        return {"filename": filename, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "dimensions": [SIZE, SIZE], "verified_graph_sha256": row["graph_sha256"]}

    # ----- policy callbacks --------------------------------------------------
    def verify_staged(self, _path: Path) -> dict[str, Any]:
        raise RuntimeControllerError("reference run stages no adapter")

    def verify_before_success(self) -> None:
        fresh = self.admission.build_evidence()
        self.admission.compare_admission(fresh, self.admitted["evidence"])
        found = self.engine.entries(self.root / "input", 1, MAIN_PRIVATE, "input", safe_existing=self.admission.safe, reparse=self.admission.reparse, error=self.error)
        expected = self.metadata["input"]
        if expected is None or set(found) != {INPUT_NAME}:
            raise RuntimeControllerError("input inventory is not exact")
        sha, size = self.admission.hash_file(found[INPUT_NAME], MAX_INPUT_BYTES)
        if (sha, size) != (expected["sha256"], expected["bytes"]) or sha != self.evidence["reference"]["sha256"]:
            raise RuntimeControllerError("input copy differs from the admitted reference")
        if self.metadata["preflight"] is None or self.metadata["preflight"].get("ok") is not True:
            raise RuntimeControllerError("resource preflight was not recorded")
        teardown = self.metadata["teardown"]
        if teardown is None or teardown["within_30s_acceptance"] is not True:
            raise RuntimeControllerError("owned teardown exceeded the 30 second acceptance")
        timings = self.metadata["rows"]
        if set(timings) != {str(s) for s in SEEDS} or any(not isinstance(t["elapsed_seconds"], float) or not math.isfinite(t["elapsed_seconds"]) for t in timings.values()):
            raise RuntimeControllerError("exactly two completed row timings are required")

    def receipt_inputs(self, _evidence: dict[str, Any]) -> dict[str, Any]:
        ev = self.evidence
        return {"admission_id": self.admitted["admission_id"], "admission_sha256": self.admitted["admission_sha256"], "admission_file_sha256": self.admitted["admission_file_sha256"], "admission_canonical_sha256": self.admitted["canonical_sha256"], "manifest_sha256": ev["manifest"]["manifest_sha256"], "manifest_record_sha256": hashlib.sha256(self.admission.canonical(ev["manifest"])).hexdigest(), "reference": ev["reference"], "models": ev["models"], "code": ev["code"], "bounds": ev["bounds"], "runtime_bounds": {"deadline_seconds": DEADLINE_SECONDS, "readiness_seconds": READINESS_SECONDS, "row_seconds": ROW_SECONDS, "teardown_acceptance_seconds": TEARDOWN_ACCEPTANCE_SECONDS}, "rows": [{"id": r["id"], "seed": r["seed"], "graph_sha256": r["graph_sha256"]} for r in self.rows]}

    # ----- run -----------------------------------------------------------------
    def run(self) -> dict[str, Any]:
        proxy = _HelperProxy(self.helper, self)
        observer = _Observer(self.resources.ResourceObserver(self.sampler, interval_seconds=OBSERVER_INTERVAL_SECONDS, maximum_samples=OBSERVER_MAXIMUM_SAMPLES), self.metadata)
        extra = ("--input-directory", str(self.root / "input"), "--models-directory", str(self.admission.MODELS_ROOT), "--reserve-vram", "1.0", "--database-url", "sqlite:///:memory:")
        return self.engine.execute_pair({"stage": STAGE, "rows": [{"id": r["id"], "seed": r["seed"], "graph": r["graph"]} for r in self.rows], "checkpoint": None}, proxy, root=self.root, main_private=MAIN_PRIVATE, studio_private=self.admission.STUDIO_PRIVATE, source=None, verify_staged=self.verify_staged, verify_before_success=self.verify_before_success, receipt_inputs=self.receipt_inputs, sha=lambda data: hashlib.sha256(data).hexdigest(), safe_existing=self.admission.safe, reparse=self.admission.reparse, file_hash=self.admission.hash_file, error=self.error, pumper_factory=lambda stream, path: self.engine.Pumper(stream, path, maximum=MAX_STDERR_BYTES, error=self.error), schema=SCHEMA, maximum_lora=MAX_LORA_BYTES, maximum_stderr=MAX_STDERR_BYTES, maximum_png=MAX_PNG_BYTES, maximum_output_entries=MAX_OUTPUT_ENTRIES, deadline_seconds=DEADLINE_SECONDS, extra_arguments=extra, prepare_root=self.prepare_root, completed_output=self.completed_output, observer=observer, readiness_seconds=READINESS_SECONDS, row_seconds=ROW_SECONDS)


def execute() -> dict[str, Any]:
    admission = _load_admission()
    admitted = admission.validate_admission()
    code = admitted["evidence"]["code"]
    engine = _load_checked(ENGINE_REL, code[ENGINE_REL]["sha256"])
    resources = _load_checked(RESOURCES_REL, code[RESOURCES_REL]["sha256"])
    helper = _load_checked(HELPER_REL, code[HELPER_REL]["sha256"])
    return Controller(admission, engine, resources, helper, admitted).run()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="fixed local OmniGen2 reference run (two seeds, 768 square)")
    parser.add_argument("--apply", action="store_true", help="validate the admission and execute the fixed run")
    args = parser.parse_args(argv)
    if not args.apply:
        print(json.dumps({"schema": SCHEMA, "stage": STAGE, "seeds": list(SEEDS), "size": SIZE, "admission_sha256": ADMISSION_SHA256, "executing": False}, sort_keys=True))
        return 0
    try:
        receipt = execute()
    except BaseException as exc:  # The engine records failures after it owns a fresh run root.
        print(json.dumps({"schema": SCHEMA, "status": "failed", "failure_class": type(exc).__name__, "failure_message": str(exc)[:256]}, sort_keys=True))
        return 1
    print(json.dumps({"schema": SCHEMA, "status": receipt["status"], "rows": [{"seed": r["seed"], "sha256": r["output"]["sha256"]} for r in receipt["rows"]], "teardown_verified": receipt["teardown"].get("verified_stopped")}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
