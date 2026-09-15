"""B2 driver-seam tests for figment_train.py observed-read authority helpers.

Scope and honest limitations (read before extending):

* Windows/CPython only. `observed_reads.ObservedReads` refuses every other
  platform, so this module skips at import time elsewhere.

* Part 1 covers helpers that never resolve a persona through
  `figment_train.ROOT`/`PERSONAS_ROOT`: `_load_plan`, `_stage_state`,
  `_checkpoint_candidate`, `_verify_tester_receipt_evidence` and
  `_resolve_config_path`. They are loaded from the real
  `pipeline/figment_train.py` and run against small, hand-built synthetic
  plan/manifest/receipt/checkpoint trees. The creator-001 media assets are
  never used. Each case checks default (`reads=None`) behavior against
  `ObservedReads` behavior. The trap test patches a best-effort list of
  Python-level filesystem entry points. It is not a claim of exhaustive
  OS-call interception.

* Part 2 covers persona-authority helpers. `ROOT`/`PERSONAS_ROOT` are never
  monkeypatched. Instead, byte-identical copies of `figment_train.py`,
  `persona.py`, `training_config.py`, `lineage.py`, `observed_reads.py` and
  `gates.py` are placed into a synthetic `orgs/figment/pipeline` tree built by
  the accepted B1 `test_persona_observed_reads.py` fixture helpers, so `ROOT`
  derives from `__file__`. Default-mode persona asset verification runs the
  copied `gates.sha256_file`. No module is faked or forwarded. Every lazily
  loaded copied module is loaded before any reader exists. That way bytecode
  cache writes cannot perturb observed directory identities.

* Part 3 builds a synthetic accepted-checkpoint authority chain. It contains:
  - a source train/tester plan with manifests, successful teardown-verified
    receipts, stage.json with a checkpoint digest inventory, anchors, a
    grading manifest and gate.json;
  - an approval-lineage record whose subject is assembled directly with
    `lineage.review_subject`/`wrap_subject`;
  - an accepted-checkpoint record, a persona checkpoint selection, a gen plan
    with captured `gen_authority`, and an explicitly staged checkpoint.

  The real domain validators are then run over this chain:
  `_load_current_approval`, `_current_review_subject`,
  `_validated_accepted_checkpoint`, `_accepted_checkpoint_snapshot`,
  `_revalidate_planned_gen_authority`, `_validate_gen_source_inputs` and
  `_install_stage_config("gen")`. They run in default mode and under real
  `ObservedReads`, with exact subject-hash parity and a guarded recheck.

  These records were NOT produced by `build_plan`, `build_grade`,
  `apply_rulings` or the CLI. This is validator coverage on synthetic records,
  not producer or CLI coverage. Complete planner/grade/apply-rulings/CLI
  tests remain a separate, later gate.

* Refusal cases are built so that every earlier guard passes and the named
  guard is the one that fires.
  - `_validate_gen_source_inputs` binds the staged checkpoint by bytes, not by
    filename.
  - So the "wrong filename" cases here reach either the exactly-one-explicit
    checkpoint guard or the staged-presence/hash guard. Neither is a
    filename-equality check.
  - `ObservedReads` refuses `..` components lexically. The path-escape case
    therefore uses an absolute upload path, so that both modes reach the
    escape guard itself.

* Module-cache aliases that the copied loaders populate are cleared before
  loading and restored afterward. The fixed names and each generated
  copied-module name are restored exactly, never through a prefix sweep.
"""
from __future__ import annotations

import builtins
import hashlib
import importlib.util
import io
import json
import os
import shutil
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

if os.name != "nt":
    pytest.skip("observed reads support CPython on Windows only", allow_module_level=True)

PIPELINE = Path(__file__).resolve().parents[1]
CREATOR = "creator-001"
JSON_LIMIT = 256 * 1024


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# Real, accepted B1 fixture conventions (make_fixture/reader_for/MISSING),
# reused rather than reinvented -- see the module docstring.
fixtures = load("b2_persona_fixture_reference", Path(__file__).with_name("test_persona_observed_reads.py"))
observed = fixtures.observed

# The real, currently-shipped driver -- default (reads=None) behavior for the
# ROOT-independent helpers is exercised straight from this module object.
figment_train = load("b2_figment_train_under_test", PIPELINE / "figment_train.py")


def write_json(path, value, *, indent=2, sort_keys=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=indent, sort_keys=sort_keys) + "\n", encoding="utf-8")


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class GuardedReader:
    """Wraps a real ObservedReads instance; falsey, and records every call.

    `tracker.depth` is shared by every GuardedReader in one trap scope, so a
    native I/O trap can distinguish reader-internal I/O from unobserved I/O.
    """

    def __init__(self, reader, tracker=None):
        self.reader = reader
        self.tracker = tracker if tracker is not None else SimpleNamespace(depth=0)
        self.calls: list[tuple[str, tuple, dict]] = []

    @property
    def depth(self):
        return self.tracker.depth

    def __bool__(self):
        return False

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)

        def invoke(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            self.tracker.depth += 1
            try:
                return getattr(self.reader, name)(*args, **kwargs)
            finally:
                self.tracker.depth -= 1
        return invoke


_TRAPPED_PATH_METHODS = (
    "stat", "lstat", "open", "read_bytes", "read_text", "write_bytes", "write_text",
    "is_file", "is_dir", "exists", "is_symlink", "is_junction", "resolve", "iterdir",
    "glob", "rglob", "mkdir", "unlink", "rmdir", "rename", "replace", "touch",
    "samefile", "readlink", "chmod",
)
_TRAPPED_OS_FUNCTIONS = (
    "stat", "lstat", "open", "listdir", "scandir", "remove", "unlink", "rename",
    "replace", "mkdir", "rmdir", "chmod", "utime", "access", "readlink", "link",
    "symlink", "truncate",
)
_TRAPPED_OS_PATH_FUNCTIONS = (
    "isfile", "isdir", "exists", "lexists", "islink", "isjunction", "realpath",
    "getsize", "getmtime", "samefile",
)
_TRAPPED_SHUTIL_FUNCTIONS = ("copy", "copy2", "copyfile", "copytree", "move", "rmtree")


def install_native_io_trap(patcher, root, tracker):
    """Refuse listed Python-level filesystem entry points touching `root`
    unless a GuardedReader call is active. Best-effort, not exhaustive."""
    root_norm = os.path.normcase(str(root)).rstrip("\\/")

    def under_root(value):
        if isinstance(value, os.PathLike):
            try:
                value = os.fspath(value)
            except TypeError:
                return False
        if isinstance(value, bytes):
            value = os.fsdecode(value)
        if not isinstance(value, str):
            return False
        normalized = os.path.normcase(value)
        return normalized == root_norm or normalized.startswith(root_norm + os.sep)

    def guard(label, original):
        def wrapped(*args, **kwargs):
            if tracker.depth <= 0 and any(under_root(arg) for arg in args):
                raise AssertionError(f"unobserved native I/O {label} touched {args!r}")
            return original(*args, **kwargs)
        return wrapped

    for name in _TRAPPED_PATH_METHODS:
        if hasattr(Path, name):
            patcher.setattr(Path, name, guard(f"Path.{name}", getattr(Path, name)))
    for name in _TRAPPED_OS_FUNCTIONS:
        if hasattr(os, name):
            patcher.setattr(os, name, guard(f"os.{name}", getattr(os, name)))
    for name in _TRAPPED_OS_PATH_FUNCTIONS:
        if hasattr(os.path, name):
            patcher.setattr(os.path, name, guard(f"os.path.{name}", getattr(os.path, name)))
    for name in _TRAPPED_SHUTIL_FUNCTIONS:
        if hasattr(shutil, name):
            patcher.setattr(shutil, name, guard(f"shutil.{name}", getattr(shutil, name)))
    patcher.setattr(builtins, "open", guard("open", builtins.open))
    patcher.setattr(io, "open", guard("io.open", io.open))


# ---------------------------------------------------------------------------
# Part 1: ROOT-independent helpers, loaded from the real pipeline module.
# ---------------------------------------------------------------------------

def test_load_plan_default_and_observed_parity(tmp_path):
    root = tmp_path / "plan-load-root"
    root.mkdir()
    plan_path = root / "plan.json"
    plan = {"schema": "figment/train-plan@1", "creator": "creator-001", "stages": {}}
    plan_path.write_text(json.dumps(plan), encoding="utf-8")

    default_plan, default_root = figment_train._load_plan("creator-001", plan_path)
    assert default_plan == plan and default_root == root.resolve()

    reader = observed.ObservedReads(
        roots=(root,), members=(observed.ReadMember(plan_path, 64 * 1024, allow_json=True),),
    )
    observed_plan, observed_root = figment_train._load_plan("creator-001", plan_path, reads=reader)
    assert observed_plan == plan and observed_root == root.resolve()
    reader.recheck()


def test_load_plan_wrong_creator_refuses_both_modes(tmp_path):
    root = tmp_path / "plan-mismatch-root"
    root.mkdir()
    plan_path = root / "plan.json"
    plan_path.write_text(
        json.dumps({"schema": "figment/train-plan@1", "creator": "creator-001", "stages": {}}),
        encoding="utf-8",
    )
    with pytest.raises(figment_train.FigmentTrainError) as default_error:
        figment_train._load_plan("creator-002", plan_path)
    reader = observed.ObservedReads(
        roots=(root,), members=(observed.ReadMember(plan_path, 64 * 1024, allow_json=True),),
    )
    with pytest.raises(figment_train.FigmentTrainError) as observed_error:
        figment_train._load_plan("creator-002", plan_path, reads=reader)
    assert str(default_error.value) == str(observed_error.value)


def test_stage_state_absent_default_and_observed_parity(tmp_path):
    root = tmp_path / "stage-absent-root"
    root.mkdir()
    plan_path = root / "plan.json"
    plan_path.write_text(json.dumps({"creator": "creator-001"}), encoding="utf-8")
    state_path = root / "stage.json"

    expected = {
        "schema": "figment/train-stage@1", "creator": "creator-001",
        "plan_sha256": figment_train._sha256(plan_path), "status": "ready",
        "runs": {}, "completed_stages": [],
    }
    assert figment_train._stage_state(state_path, "creator-001", plan_path) == expected

    reader = observed.ObservedReads(
        roots=(root,),
        members=(
            observed.ReadMember(plan_path, 64 * 1024, allow_json=False),
            observed.ReadMember(state_path, 64 * 1024, allow_json=True, optional=True),
        ),
    )
    assert figment_train._stage_state(state_path, "creator-001", plan_path, reads=reader) == expected
    reader.recheck()


def test_stage_state_present_default_and_observed_parity(tmp_path):
    root = tmp_path / "stage-present-root"
    root.mkdir()
    plan_path = root / "plan.json"
    plan_path.write_text(json.dumps({"creator": "creator-001"}), encoding="utf-8")
    state_path = root / "stage.json"
    stored = {
        "schema": "figment/train-stage@1", "creator": "creator-001",
        "plan_sha256": figment_train._sha256(plan_path), "status": "running:train",
        "runs": {"a": {"status": "complete"}}, "completed_stages": [],
        "updated_utc": "2026-01-01T00:00:00+00:00",
    }
    state_path.write_text(json.dumps(stored), encoding="utf-8")

    assert figment_train._stage_state(state_path, "creator-001", plan_path) == stored

    reader = observed.ObservedReads(
        roots=(root,),
        members=(
            observed.ReadMember(plan_path, 64 * 1024, allow_json=False),
            observed.ReadMember(state_path, 64 * 1024, allow_json=True),
        ),
    )
    assert figment_train._stage_state(state_path, "creator-001", plan_path, reads=reader) == stored
    reader.recheck()


def test_stage_state_mismatch_refuses_both_modes(tmp_path):
    root = tmp_path / "stage-mismatch-root"
    root.mkdir()
    plan_path = root / "plan.json"
    plan_path.write_text(json.dumps({"creator": "creator-001"}), encoding="utf-8")
    state_path = root / "stage.json"
    state_path.write_text(
        json.dumps({"creator": "creator-999", "plan_sha256": figment_train._sha256(plan_path)}),
        encoding="utf-8",
    )
    with pytest.raises(figment_train.FigmentTrainError) as default_error:
        figment_train._stage_state(state_path, "creator-001", plan_path)
    reader = observed.ObservedReads(
        roots=(root,),
        members=(
            observed.ReadMember(plan_path, 64 * 1024, allow_json=False),
            observed.ReadMember(state_path, 64 * 1024, allow_json=True),
        ),
    )
    with pytest.raises(figment_train.FigmentTrainError) as observed_error:
        figment_train._stage_state(state_path, "creator-001", plan_path, reads=reader)
    assert str(default_error.value) == str(observed_error.value)


def test_resolve_config_path_default_and_observed_parity(tmp_path):
    target = tmp_path / "resolve-root" / "config.json"
    target.parent.mkdir()
    target.write_text("{}", encoding="utf-8")

    default_result = figment_train._resolve_config_path(str(target))
    assert default_result == target.resolve()

    reader = observed.ObservedReads(
        roots=(target.parent,), members=(observed.ReadMember(target, 4096, allow_json=True),),
    )
    observed_result = figment_train._resolve_config_path(str(target), reads=reader)
    assert observed_result == target.resolve()
    reader.recheck()


def test_verify_tester_receipt_evidence_default_and_observed_parity(tmp_path):
    root = tmp_path / "receipt-root"
    root.mkdir()
    manifest = {"jobs": [{"output_name": "job-a", "expected_images": 1}]}
    out_dir = root / "out"
    out_dir.mkdir()
    receipt = {
        "error": None, "dry_run": False, "termination_verified": True,
        "placement_attempts": [],
        "jobs": [{"output_name": "job-a", "files": [{"bytes": 10}]}],
    }
    receipt_path = out_dir / "run.json"
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    figment_train._verify_tester_receipt_evidence(manifest, out_dir)  # must not raise

    reader = observed.ObservedReads(
        roots=(root,), members=(observed.ReadMember(receipt_path, 64 * 1024, allow_json=True),),
    )
    figment_train._verify_tester_receipt_evidence(manifest, out_dir, reads=reader)
    reader.recheck()

    receipt["dry_run"] = True
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    with pytest.raises(figment_train.FigmentTrainError, match="dry_run must be boolean false"):
        figment_train._verify_tester_receipt_evidence(manifest, out_dir)

    reader2 = observed.ObservedReads(
        roots=(root,), members=(observed.ReadMember(receipt_path, 64 * 1024, allow_json=True),),
    )
    with pytest.raises(figment_train.FigmentTrainError, match="dry_run must be boolean false"):
        figment_train._verify_tester_receipt_evidence(manifest, out_dir, reads=reader2)


# ---------------------------------------------------------------------------
# `_checkpoint_candidate`: bounded synthetic train/tester manifests, a
# completed stage.json, receipts and a tiny checkpoint, exact expected
# candidate, then changed/absent cases.
# ---------------------------------------------------------------------------

def build_checkpoint_fixture(tmp_path):
    root = tmp_path / "ckpt-root"
    runs = root / "train" / "runs"
    out = runs / "out"
    runs.mkdir(parents=True)
    out.mkdir(parents=True)

    trigger = "creator001krea2"
    training = {"trigger": trigger, "steps": 900, "save_every": 300}
    filename = figment_train._checkpoint_name(trigger, 300)
    final_filename = figment_train._checkpoint_name(trigger, None)

    tester_manifest_path = runs / "creator-001-tensor-tester.yaml"
    tester_manifest = {
        "jobs": [
            {"output_name": "c001-tensor-tester-000000300", "expected_images": 1,
             "substitutions": [{"field": "lora_name", "value": filename}]},
            {"output_name": "c001-tensor-tester-final", "expected_images": 1,
             "substitutions": [{"field": "lora_name", "value": final_filename}]},
        ]
    }
    tester_manifest_path.write_text(json.dumps(tester_manifest), encoding="utf-8")

    train_manifest_path = runs / "creator-001-tensor-train.yaml"
    train_manifest = {"artifacts": [
        {"local": filename},
        {"local": figment_train._checkpoint_name(trigger, 600)},
        {"local": final_filename},
    ]}
    train_manifest_path.write_text(json.dumps(train_manifest), encoding="utf-8")

    tester_out = out / "creator-001-tensor-tester"
    tester_out.mkdir(parents=True)
    tester_receipt = {
        "error": None, "dry_run": False, "termination_verified": True,
        "placement_attempts": [],
        "jobs": [
            {"output_name": "c001-tensor-tester-000000300", "files": [{"bytes": 111}]},
            {"output_name": "c001-tensor-tester-final", "files": [{"bytes": 222}]},
        ],
    }
    (tester_out / "run.json").write_text(json.dumps(tester_receipt), encoding="utf-8")

    train_out = out / "creator-001-tensor-train"
    train_out.mkdir(parents=True)
    checkpoint_bytes = b"synthetic checkpoint payload for step 300"
    checkpoint_path = train_out / filename
    checkpoint_path.write_bytes(checkpoint_bytes)
    checkpoint_sha = hashlib.sha256(checkpoint_bytes).hexdigest()
    train_receipt = {
        "error": None, "dry_run": False, "termination_verified": True,
        "artifacts": [{"remote": filename, "bytes": len(checkpoint_bytes)}],
    }
    (train_out / "run.json").write_text(json.dumps(train_receipt), encoding="utf-8")

    tester_run = {
        "manifest": tester_manifest_path.relative_to(root).as_posix(),
        "sha256": figment_train._sha256(tester_manifest_path),
        "out": tester_out.relative_to(root).as_posix(),
    }
    train_run = {
        "manifest": train_manifest_path.relative_to(root).as_posix(),
        "sha256": figment_train._sha256(train_manifest_path),
        "out": train_out.relative_to(root).as_posix(),
    }

    plan = {
        "creator": "creator-001", "training": training,
        "stages": {"tester": {"runs": [tester_run]}, "train": {"runs": [train_run]}},
    }
    plan_path = root / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")

    checkpoint_input = {
        "filename": filename,
        "path": figment_train._relative(checkpoint_path, root),
        "bytes": len(checkpoint_bytes),
        "sha256": checkpoint_sha,
    }
    state = {
        "schema": "figment/train-stage@1", "creator": "creator-001",
        "plan_sha256": figment_train._sha256(plan_path),
        "status": "complete", "completed_stages": ["train", "tester"],
        "runs": {
            train_run["manifest"]: {"status": "complete"},
            tester_run["manifest"]: {"status": "complete", "checkpoint_inputs": [checkpoint_input]},
        },
    }
    state_path = root / "stage.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")

    expected = {
        "step": 300, "filename": filename,
        "tester_image_id": "c001-tensor-tester-000000300",
        "path": str(checkpoint_path.resolve()),
        "bytes": len(checkpoint_bytes), "sha256": checkpoint_sha,
        "train_manifest": train_run["manifest"], "train_manifest_sha256": train_run["sha256"],
    }
    return SimpleNamespace(
        root=root, plan=plan, plan_path=plan_path, state_path=state_path,
        tester_manifest_path=tester_manifest_path, train_manifest_path=train_manifest_path,
        tester_out=tester_out, train_out=train_out, checkpoint_path=checkpoint_path,
        checkpoint_bytes=checkpoint_bytes, filename=filename, expected=expected,
        tester_run=tester_run, train_run=train_run,
    )


def reader_for_checkpoint_fixture(fx):
    members = (
        observed.ReadMember(fx.plan_path, 64 * 1024, allow_json=False),
        observed.ReadMember(fx.tester_manifest_path, 64 * 1024, allow_json=True),
        observed.ReadMember(fx.train_manifest_path, 64 * 1024, allow_json=True),
        observed.ReadMember(fx.tester_out / "run.json", 64 * 1024, allow_json=True),
        observed.ReadMember(fx.train_out / "run.json", 64 * 1024, allow_json=True),
        observed.ReadMember(fx.checkpoint_path, 4096, allow_json=False),
        observed.ReadMember(fx.state_path, 64 * 1024, allow_json=True, optional=True),
    )
    return observed.ObservedReads(
        roots=(fx.root,), members=members,
        limits=observed.ReadLimits(max_files=32, max_unique_bytes=8 * 1024 * 1024, max_stream_bytes=16 * 1024 * 1024),
    )


def test_checkpoint_candidate_exact_value_default_and_observed_parity(tmp_path):
    fx = build_checkpoint_fixture(tmp_path)
    default_result = figment_train._checkpoint_candidate(fx.plan, fx.root, 300)
    assert default_result == fx.expected

    reader = reader_for_checkpoint_fixture(fx)
    observed_result = figment_train._checkpoint_candidate(fx.plan, fx.root, 300, reads=reader)
    assert observed_result == fx.expected
    reader.recheck()


def test_checkpoint_candidate_reader_recheck_detects_post_read_mutation(tmp_path):
    fx = build_checkpoint_fixture(tmp_path)
    reader = reader_for_checkpoint_fixture(fx)
    assert figment_train._checkpoint_candidate(fx.plan, fx.root, 300, reads=reader) == fx.expected
    fx.checkpoint_path.write_bytes(fx.checkpoint_bytes + b"mutated-after-read")
    with pytest.raises(observed.ObservedReadError):
        reader.recheck()


def test_checkpoint_candidate_changed_checkpoint_bytes_refuses_both_modes(tmp_path):
    """Tamper the checkpoint bytes IN PLACE, same length, so the failure is
    isolated to a hash mismatch rather than a train-receipt size
    disagreement, which would fire first if the byte count itself changed."""
    fx = build_checkpoint_fixture(tmp_path)
    tampered = bytearray(fx.checkpoint_bytes)
    tampered[0] ^= 0xFF
    assert len(tampered) == len(fx.checkpoint_bytes)
    fx.checkpoint_path.write_bytes(bytes(tampered))
    with pytest.raises(figment_train.FigmentTrainError, match="no longer matches the bytes recorded"):
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300)
    reader = reader_for_checkpoint_fixture(fx)
    with pytest.raises(figment_train.FigmentTrainError, match="no longer matches the bytes recorded"):
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300, reads=reader)


def test_checkpoint_candidate_changed_checkpoint_size_refuses_via_receipt_disagreement(tmp_path):
    """A checkpoint whose SIZE changed no longer has a train-receipt artifact
    row of matching bytes. The receipt guard runs before the recorded-input
    digest comparison, so the refusal message is deterministic."""
    fx = build_checkpoint_fixture(tmp_path)
    fx.checkpoint_path.write_bytes(fx.checkpoint_bytes + b"more-bytes")
    message = "lacks a real successful, teardown-verified train receipt"
    with pytest.raises(figment_train.FigmentTrainError) as default_error:
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300)
    assert message in str(default_error.value)
    reader = reader_for_checkpoint_fixture(fx)
    with pytest.raises(figment_train.FigmentTrainError) as observed_error:
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300, reads=reader)
    assert message in str(observed_error.value)
    assert str(default_error.value) == str(observed_error.value)


def test_checkpoint_candidate_changed_train_receipt_refuses_both_modes(tmp_path):
    fx = build_checkpoint_fixture(tmp_path)
    receipt_path = fx.train_out / "run.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["dry_run"] = True
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    with pytest.raises(figment_train.FigmentTrainError, match="lacks a real successful"):
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300)
    reader = reader_for_checkpoint_fixture(fx)
    with pytest.raises(figment_train.FigmentTrainError, match="lacks a real successful"):
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300, reads=reader)


@pytest.mark.parametrize("which,match_text", [
    ("tester_manifest_path", "tester manifest changed"),
    ("train_manifest_path", "train manifest changed"),
])
def test_checkpoint_candidate_changed_manifest_refuses_both_modes(tmp_path, which, match_text):
    fx = build_checkpoint_fixture(tmp_path)
    target = getattr(fx, which)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(" ")
    with pytest.raises(figment_train.FigmentTrainError, match=match_text):
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300)
    reader = reader_for_checkpoint_fixture(fx)
    with pytest.raises(figment_train.FigmentTrainError, match=match_text):
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300, reads=reader)


def test_checkpoint_candidate_absent_checkpoint_refuses(tmp_path):
    """Default mode refuses through the domain missing-file guard. Observed
    mode refuses at the admitted, non-optional member itself, and the
    underlying cause is the native FileNotFoundError."""
    fx = build_checkpoint_fixture(tmp_path)
    fx.checkpoint_path.unlink()
    with pytest.raises(figment_train.FigmentTrainError, match="produced checkpoint is missing or empty"):
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300)
    reader = reader_for_checkpoint_fixture(fx)
    with pytest.raises(observed.ObservedReadError) as error:
        figment_train._checkpoint_candidate(fx.plan, fx.root, 300, reads=reader)
    assert isinstance(error.value.__cause__, FileNotFoundError)


def test_checkpoint_candidate_no_unobserved_reads_and_dual_source_hash(tmp_path, monkeypatch):
    """The supplied reader is falsey and stays active.

    A best-effort trap covers the listed Python-level filesystem entry points,
    including the root directory itself. It refuses any of them touching the
    fixture root outside reader depth.

    Before any recheck, the source checkpoint is hashed through the reader
    exactly twice: once for the recorded input and once for the final
    candidate.

    A guarded recheck is then counted at the reader's own `_stream` primitive.
    It must stream the checkpoint exactly once more.
    """
    fx = build_checkpoint_fixture(tmp_path)
    reader = reader_for_checkpoint_fixture(fx)
    spy = GuardedReader(reader)

    stream_calls: list[tuple] = []
    original_stream = observed.ObservedReads._stream

    def counted_stream(self, *args, **kwargs):
        stream_calls.append(args)
        return original_stream(self, *args, **kwargs)

    with monkeypatch.context() as trap:
        install_native_io_trap(trap, fx.root, spy.tracker)
        result = figment_train._checkpoint_candidate(fx.plan, fx.root, 300, reads=spy)
        depth_after = spy.depth
        checkpoint_hash_calls = [
            call for call in spy.calls
            if call[0] == "sha256" and call[1] and Path(call[1][0]) == fx.checkpoint_path
        ]
        trap.setattr(observed.ObservedReads, "_stream", counted_stream)
        spy.recheck()

    assert result == fx.expected
    assert depth_after == 0
    assert len(checkpoint_hash_calls) == 2, (
        "expected exactly the recorded-input source hash and the final candidate "
        "source hash, each re-verified through the reader, before any recheck"
    )
    checkpoint_stream_calls = [
        call for call in stream_calls
        if len(call) >= 2 and getattr(call[1], "path", None) == fx.checkpoint_path
    ]
    assert len(checkpoint_stream_calls) == 1, (
        "expected exactly one additional real primitive stream over the checkpoint "
        "file during recheck, measured at the reader's own _stream method"
    )


# ---------------------------------------------------------------------------
# Part 2: persona-authority helpers, via a copied-producer fixture repo so
# figment_train.ROOT/PERSONAS_ROOT derive naturally (never monkeypatched).
# ---------------------------------------------------------------------------

MODULE_CACHE_ALIASES = (
    "_figment_train_training_config",
    "_figment_train_render_config",
    "_figment_train_build_set",
    "_figment_train_qa_stamp",
    "_figment_train_score_cells",
    "_figment_train_identity_gate",
    "_figment_train_lineage",
    "_figment_train_pod_runpod_run",
    "_figment_train_verify_pins",
    "_figment_training_config_persona",
    "_figment_pipeline_persona_gates",
    "_figment_pipeline_pod_runpod_run",
)
COPIED_MODULES = (
    "figment_train.py", "persona.py", "training_config.py", "lineage.py",
    "observed_reads.py", "gates.py",
)


@pytest.fixture
def restore_module_aliases():
    """Clear exactly the fixed aliases a copied loader can populate, then
    restore them afterward, and remove every generated copied-module name."""
    previous = {name: sys.modules.get(name) for name in MODULE_CACHE_ALIASES}
    registry = SimpleNamespace(fixed=MODULE_CACHE_ALIASES, generated=[])
    yield registry
    for name in registry.generated:
        sys.modules.pop(name, None)
    for name, module in previous.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


def make_copied_producer_fixture(tmp_path, **fixture_kwargs):
    fixture = fixtures.make_fixture(tmp_path, **fixture_kwargs)
    pipeline_dir = fixture.root / "pipeline"
    for name in COPIED_MODULES:
        shutil.copy2(PIPELINE / name, pipeline_dir / name)
    (pipeline_dir / "gate.yaml").write_bytes(b"synthetic-gate-thresholds\n")
    return fixture


def load_copied_figment_train(fixture, aliases):
    """Load the copied driver and eagerly load every copied module the
    authority helpers use lazily, before any reader observes directories."""
    for name in aliases.fixed:
        sys.modules.pop(name, None)
    name = f"b2_figment_train_copied_{uuid.uuid4().hex}"
    aliases.generated.append(name)
    module = load(name, fixture.root / "pipeline" / "figment_train.py")
    training_config = module._training_config_module()
    persona_module = training_config._load_persona_module()
    persona_module._load_gates()
    module._lineage_module()
    return module


def persona_dir_relative(fixture):
    repo_root = fixture.root.parent.parent
    return fixture.home.relative_to(repo_root).as_posix()


def gen_authority_reader(fixture, *, extra_members=(), include_register=True):
    members = [
        observed.ReadMember(fixture.path, JSON_LIMIT, allow_json=True),
        observed.ReadMember(fixture.sidecar, JSON_LIMIT, allow_json=True, optional=True),
        observed.ReadMember(fixture.identity, JSON_LIMIT),
        *((observed.ReadMember(fixture.register, JSON_LIMIT),) if include_register else ()),
        *(observed.ReadMember(ref, JSON_LIMIT) for ref in fixture.refs),
        *extra_members,
    ]
    return observed.ObservedReads(
        roots=(fixture.root,), members=tuple(members),
        limits=observed.ReadLimits(max_files=96, max_unique_bytes=64 * 1024 * 1024, max_stream_bytes=128 * 1024 * 1024),
    )


def test_current_persona_training_reads_mode_matches_persona_contract(tmp_path, restore_module_aliases):
    fixture = make_copied_producer_fixture(tmp_path)
    ft = load_copied_figment_train(fixture, restore_module_aliases)
    plan = {"creator": "creator-001", "assets": {"persona_dir": persona_dir_relative(fixture)}}
    reader = gen_authority_reader(fixture)
    persona, training = ft._current_persona_training(plan, reads=reader)
    reader.recheck()
    assert persona["id"] == "creator-001"
    assert training["trigger"] == "creator001krea2"
    assert training["chosen_checkpoint_step"] is None


def test_current_persona_training_reads_mode_first_and_second_persona_source_distinct(tmp_path, restore_module_aliases):
    """The identity spec and the register spec are two separately declared
    sources, and both are hashed through the one guarded reader that produced
    the result. This test shows that both are observed. It does not show that
    a missing register member is refused; the separate
    missing-register-member test below covers that."""
    fixture = make_copied_producer_fixture(tmp_path)
    ft = load_copied_figment_train(fixture, restore_module_aliases)
    plan = {"creator": "creator-001", "assets": {"persona_dir": persona_dir_relative(fixture)}}
    guarded = GuardedReader(gen_authority_reader(fixture))
    ft._current_persona_training(plan, reads=guarded)
    sha_paths = {Path(args[0]) for name, args, _ in guarded.calls if name == "sha256" and args}
    assert fixture.identity in sha_paths and fixture.register in sha_paths
    assert fixture.identity != fixture.register
    guarded.recheck()


def test_current_persona_training_reads_mode_refuses_unadmitted_register_spec(tmp_path, restore_module_aliases):
    fixture = make_copied_producer_fixture(tmp_path)
    ft = load_copied_figment_train(fixture, restore_module_aliases)
    plan = {"creator": "creator-001", "assets": {"persona_dir": persona_dir_relative(fixture)}}
    reader = gen_authority_reader(fixture, include_register=False)
    with pytest.raises(ft.FigmentTrainError, match="current persona/training configuration is invalid") as error:
        ft._current_persona_training(plan, reads=reader)
    cause = error.value.__cause__
    assert isinstance(cause, observed.ObservedReadError)
    assert "operand was not admitted" in str(cause)
    with pytest.raises(observed.ObservedReadError, match="poisoned or sealed"):
        reader.recheck()


def test_revalidate_planned_gen_authority_detects_persona_drift_reads_mode(tmp_path, restore_module_aliases):
    fixture = make_copied_producer_fixture(tmp_path)
    ft = load_copied_figment_train(fixture, restore_module_aliases)
    plan = {
        "creator": "creator-001", "assets": {"persona_dir": persona_dir_relative(fixture)},
        "training": {}, "persona_sha256": "0" * 64,
        "gen_authority": {
            "approval_sha256": "1" * 64, "source_plan_sha256": "2" * 64,
            "approval_lineage_sha256": "3" * 64, "checkpoint_sha256": "4" * 64,
        },
    }
    reader = gen_authority_reader(fixture)
    with pytest.raises(ft.FigmentTrainError, match="current persona changed after gen planning"):
        ft._revalidate_planned_gen_authority(plan, reads=reader)


def test_validate_gen_source_inputs_refuses_without_selected_checkpoint_both_modes(tmp_path, restore_module_aliases):
    """The captured authority is valid: the persona digest is correct, the
    training values are the current defaults, and gen_authority holds four
    string digests. Because no checkpoint was ever selected, the refusal comes
    specifically from the chosen-checkpoint guard, before any gen manifest or
    upload is examined."""
    fixture = make_copied_producer_fixture(tmp_path)
    ft = load_copied_figment_train(fixture, restore_module_aliases)
    training = ft._training_config_module().load_persona_with_training(
        fixture.path, require_assets=False,
    )["training"]
    assert training["chosen_checkpoint_step"] is None
    plan = {
        "schema": "figment/train-plan@1", "creator": CREATOR,
        "assets": {"persona_dir": persona_dir_relative(fixture)},
        "training": training, "persona_sha256": file_sha256(fixture.path),
        "gen_authority": {
            "approval_sha256": "1" * 64, "source_plan_sha256": "2" * 64,
            "approval_lineage_sha256": "3" * 64, "checkpoint_sha256": "4" * 64,
        },
        "stages": {"gen": {"runs": []}},
    }
    plan_root = fixture.root / "pipeline"
    with pytest.raises(ft.FigmentTrainError, match="gen requires a chosen checkpoint"):
        ft._validate_gen_source_inputs(plan, plan_root)
    reader = gen_authority_reader(fixture)
    with pytest.raises(ft.FigmentTrainError, match="gen requires a chosen checkpoint"):
        ft._validate_gen_source_inputs(plan, plan_root, reads=reader)
    reader.recheck()

# ---------------------------------------------------------------------------
# Part 3: synthetic complete accepted-checkpoint authority chain (validator
# coverage on synthetic records -- NOT planner/grade/apply-rulings/CLI output).
# ---------------------------------------------------------------------------

OPERATOR = {"decided_by": "synthetic-operator", "decided_at": "2026-09-13T00:00:00+00:00"}


def write_training_selection(fixture, selection):
    target = fixture.sidecar if fixture.sidecar.is_file() else fixture.path
    document = json.loads(target.read_text(encoding="utf-8"))
    document["training"] = {**(document.get("training") or {}), **selection}
    write_json(target, document)


def build_authority_chain(fixture, ft):
    root = fixture.root
    assert root == root.resolve(), "copied fixture root must already be resolved"
    repo = root.parent.parent
    assert ft.ROOT == repo, "copied figment_train.ROOT must derive from the fixture tree"
    threshold_path = root / "pipeline" / "gate.yaml"
    assert ft.HERE / "gate.yaml" == threshold_path
    tc = ft._training_config_module()
    lineage = ft._lineage_module()
    persona_dir = persona_dir_relative(fixture)
    pre_selection_persona_sha = file_sha256(fixture.path)

    base_training = tc.load_persona_with_training(fixture.path, require_assets=False)["training"]
    assert base_training["chosen_checkpoint_step"] is None
    trigger = base_training["trigger"]
    steps, save_every = base_training["steps"], base_training["save_every"]
    step = save_every
    checkpoints = [(s, f"{trigger}_{s:09d}.safetensors", f"{s:09d}") for s in range(save_every, steps, save_every)]
    checkpoints.append((steps, f"{trigger}.safetensors", "final"))
    selected_filename = f"{trigger}_{step:09d}.safetensors"
    selected_image_id = f"c001-tensor-tester-{step:09d}"

    source_root = root / "plans" / "source"
    source_runs = source_root / "train" / "runs"
    tester_out = source_runs / "out" / "creator-001-tensor-tester"
    train_out = source_runs / "out" / "creator-001-tensor-train"
    tester_out.mkdir(parents=True)
    train_out.mkdir(parents=True)

    # Train outputs and a successful, teardown-verified train receipt.
    checkpoint_inputs, train_artifacts, receipt_artifacts = [], [], []
    for _, name, _ in checkpoints:
        payload = f"synthetic krea2 checkpoint bytes for {name}".encode("utf-8")
        path = train_out / name
        path.write_bytes(payload)
        train_artifacts.append({"remote": name, "type": "output", "local": name, "wait_for": "_training.complete"})
        receipt_artifacts.append({"remote": name, "local": name, "bytes": len(payload)})
        checkpoint_inputs.append({
            "filename": name, "path": path.relative_to(source_root).as_posix(),
            "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
        })
    checkpoint_inputs.sort(key=lambda row: row["filename"])
    train_receipt_path = train_out / "run.json"
    write_json(train_receipt_path, {
        "error": None, "dry_run": False, "termination_verified": True,
        "placement_attempts": [{"pod_id": "synthetic-train-pod", "termination_verified": True}],
        "artifacts": receipt_artifacts,
    })
    train_manifest_path = source_runs / "creator-001-tensor-train.yaml"
    write_json(train_manifest_path, {
        "training": {"trigger": trigger},
        "jobs": [{"seed": 100001, "output_name": f"training-transport-sentinel-{trigger}",
                  "substitutions": [], "expected_images": 1}],
        "artifacts": train_artifacts,
    })

    # Tester manifest, clothed synthetic renders and a successful tester receipt.
    tester_jobs, receipt_jobs, grading_images, image_paths = [], [], [], []
    for index, (_, name, label) in enumerate(checkpoints):
        output_name = f"c001-tensor-tester-{label}"
        job = {"seed": 1595, "output_name": output_name, "expected_images": 1,
               "substitutions": [{"node_id": "4", "field": "lora_name", "value": name}]}
        if index == 0:
            job["wait_for"] = "_loras.assembled"
        tester_jobs.append(job)
        image = tester_out / f"{output_name}.png"
        image.write_bytes(f"synthetic clothed tester render {output_name}".encode("utf-8"))
        image_paths.append(image)
        receipt_jobs.append({"output_name": output_name,
                             "files": [{"name": image.name, "bytes": image.stat().st_size}]})
        grading_images.append({
            "image_id": output_name, "path": str(image), "review_status": "unreviewed",
            "parked_reasons": [], "safety_failed": False, "safety_reasons": [],
        })
    tester_receipt_path = tester_out / "run.json"
    write_json(tester_receipt_path, {
        "error": None, "dry_run": False, "termination_verified": True,
        "placement_attempts": [{"pod_id": "synthetic-tester-pod", "termination_verified": True}],
        "jobs": receipt_jobs,
    })
    tester_manifest_path = source_runs / "creator-001-tensor-tester.yaml"
    write_json(tester_manifest_path, {"seed_fields": ["seed", "noise_seed"], "jobs": tester_jobs})

    anchor_dir = source_root / "expand" / "runs" / "_uploads" / CREATOR
    anchor_dir.mkdir(parents=True)
    anchors, anchor_paths = [], []
    for ref in fixture.refs:
        target = anchor_dir / ref.name
        shutil.copy2(ref, target)
        anchor_paths.append(target)
        anchors.append(target.relative_to(source_root).as_posix())

    tester_run = {"manifest": tester_manifest_path.relative_to(source_root).as_posix(),
                  "sha256": file_sha256(tester_manifest_path),
                  "out": tester_out.relative_to(source_root).as_posix()}
    train_run = {"manifest": train_manifest_path.relative_to(source_root).as_posix(),
                 "sha256": file_sha256(train_manifest_path),
                 "out": train_out.relative_to(source_root).as_posix()}
    source_plan_path = source_root / "plan.json"
    write_json(source_plan_path, {
        "schema": "figment/train-plan@1", "creator": CREATOR,
        "persona_sha256": pre_selection_persona_sha, "training": base_training,
        "assets": {"anchors": anchors, "persona_dir": persona_dir},
        "stages": {"train": {"runs": [train_run]}, "tester": {"runs": [tester_run]}},
    })
    stage_path = source_root / "stage.json"
    write_json(stage_path, {
        "schema": "figment/train-stage@1", "creator": CREATOR,
        "plan_sha256": file_sha256(source_plan_path), "status": "complete",
        "completed_stages": ["train", "tester"],
        "runs": {
            train_run["manifest"]: {"status": "complete"},
            tester_run["manifest"]: {"status": "complete", "checkpoint_inputs": checkpoint_inputs},
        },
    })

    # Persona checkpoint selection.
    grade_dir = source_root / "grade" / "tester"
    grade_dir.mkdir(parents=True)
    accepted_path = grade_dir / "accepted-checkpoint.json"
    approval_lineage_path = grade_dir / "approval-lineage.json"
    selected_path = train_out / selected_filename
    selected_sha = file_sha256(selected_path)
    write_training_selection(fixture, {
        "chosen_checkpoint_step": step, "chosen_checkpoint_sha256": selected_sha,
        "chosen_checkpoint_approval": accepted_path.relative_to(repo).as_posix(),
    })
    current = tc.load_persona_with_training(fixture.path, require_assets=False)
    current_training = current["training"]
    assert current_training["chosen_checkpoint_step"] == step
    assert (lineage.training_input_projection(current_training)
            == lineage.training_input_projection(base_training))

    # Grade records and a canonical subject assembled directly from lineage.
    grading_path = grade_dir / "grading-manifest.json"
    write_json(grading_path, {"creator": CREATOR, "stage": "tester", "images": grading_images})
    gate_path = grade_dir / "gate.json"
    write_json(gate_path, {
        "schema": "figment/gate@1",
        "rows": [{"image_id": row["image_id"], "pass": True, "reasons": []} for row in grading_images],
        "summary": {"passed": len(grading_images), "total": len(grading_images)},
    })
    subject = lineage.review_subject(
        creator=CREATOR, stage="tester", plan_path=source_plan_path,
        manifest_paths=[tester_manifest_path], images=grading_images, anchors=anchor_paths,
        persona=current, training=current_training, threshold_path=threshold_path,
        score_path=gate_path,
        checkpoint_inputs=[{
            "manifest": tester_run["manifest"], "manifest_sha256": tester_run["sha256"],
            "status": "complete", "inputs": checkpoint_inputs,
        }],
    )
    subject_sha256 = lineage.canonical_sha256(subject)
    evaluation_path = grade_dir / "evaluation-inputs.json"
    write_json(evaluation_path, lineage.wrap_subject(
        lineage.EVALUATION_SCHEMA, subject, creator=CREATOR, stage="tester",
    ))
    rulings_path = grade_dir / "rulings.json"
    write_json(rulings_path, {
        "schema": "figment/rulings@1", "creator": CREATOR, "stage": "tester",
        "evaluation_subject_sha256": subject_sha256, **OPERATOR,
        "rulings": [{
            "image_id": row["image_id"],
            "decision": "keep" if row["image_id"] == selected_image_id else "cull",
            "identity": "pass", "realism": "pass", "hands": "pass", "lighting": "pass",
            "adult_read": "pass", "garment_integrity": "pass",
            "real_person_resemblance": "none", "why": "synthetic fixture ruling",
        } for row in grading_images],
    })
    write_json(grade_dir / "approved-list.json", {
        "schema": "figment/approved-images@1", "creator": CREATOR, "stage": "tester",
        "images": [{"image_id": selected_image_id,
                    "path": str(tester_out / f"{selected_image_id}.png")}],
    })
    write_json(approval_lineage_path, lineage.wrap_subject(
        lineage.APPROVAL_SCHEMA, subject, creator=CREATOR, stage="tester",
        decision="verified", **OPERATOR, rulings_sha256=file_sha256(rulings_path),
        reviewed_subject=subject, reviewed_subject_sha256=subject_sha256,
        transition={"kind": "none", "requires_replan": False},
    ))
    approval_document = json.loads(approval_lineage_path.read_text(encoding="utf-8"))

    checkpoint_record = {
        "step": step, "filename": selected_filename, "tester_image_id": selected_image_id,
        "path": str(selected_path), "bytes": selected_path.stat().st_size, "sha256": selected_sha,
        "train_manifest": train_run["manifest"], "train_manifest_sha256": train_run["sha256"],
    }
    write_json(accepted_path, {
        "schema": lineage.CHECKPOINT_SCHEMA, "creator": CREATOR, "operator": dict(OPERATOR),
        "source_plan": str(source_plan_path), "source_plan_sha256": file_sha256(source_plan_path),
        "approval_lineage": str(approval_lineage_path),
        "approval_lineage_sha256": file_sha256(approval_lineage_path),
        "training_inputs": lineage.training_input_projection(base_training),
        "checkpoint": checkpoint_record,
    })

    # Selected gen plan with an explicitly staged checkpoint.
    gen_root = root / "plans" / "gen"
    gen_runs = gen_root / "train" / "runs"
    staged_path = gen_runs / "accepted-checkpoint" / selected_filename
    staged_path.parent.mkdir(parents=True)
    shutil.copy2(selected_path, staged_path)
    staged_upload = f"accepted-checkpoint/{selected_filename}"
    gen_manifest_path = gen_runs / "creator-001-tensor-gen.yaml"
    write_json(gen_manifest_path, {
        "workflow": {"1": {"class_type": "KSampler", "inputs": {"seed": 40}}},
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [{"files": [staged_upload], "subfolder": trigger, "type": "input",
                     "overwrite": True, "chunk_bytes": 16777216}],
        "jobs": [{"seed": 269789944143426, "output_name": "c001-tensor-gen-01",
                  "expected_images": 3, "wait_for": "_loras.assembled",
                  "substitutions": [{"node_id": "4", "field": "lora_name", "value": selected_filename}]}],
    })
    snapshot = {
        "approval_sha256": file_sha256(accepted_path),
        "source_plan_sha256": file_sha256(source_plan_path),
        "approval_lineage_sha256": file_sha256(approval_lineage_path),
        "checkpoint_sha256": selected_sha,
    }
    gen_plan_path = gen_root / "plan.json"
    write_json(gen_plan_path, {
        "schema": "figment/train-plan@1", "creator": CREATOR,
        "persona_sha256": file_sha256(fixture.path), "training": current_training,
        "assets": {"persona_dir": persona_dir},
        "stages": {"gen": {"runs": [{
            "manifest": gen_manifest_path.relative_to(gen_root).as_posix(),
            "sha256": file_sha256(gen_manifest_path),
            "out": "train/runs/out/creator-001-tensor-gen",
        }]}},
        "gen_authority": snapshot,
    })

    return SimpleNamespace(
        trigger=trigger, step=step, selected_filename=selected_filename,
        source_root=source_root, source_plan_path=source_plan_path, stage_path=stage_path,
        tester_manifest_path=tester_manifest_path, train_manifest_path=train_manifest_path,
        tester_receipt_path=tester_receipt_path, train_receipt_path=train_receipt_path,
        checkpoint_path=selected_path, image_paths=image_paths, anchor_paths=anchor_paths,
        threshold_path=threshold_path, grading_path=grading_path, gate_path=gate_path,
        evaluation_path=evaluation_path,
        approval_lineage_path=approval_lineage_path, accepted_path=accepted_path,
        gen_root=gen_root, gen_plan_path=gen_plan_path, gen_manifest_path=gen_manifest_path,
        staged_path=staged_path, staged_upload=staged_upload,
        subject=subject, subject_sha256=subject_sha256, approval_document=approval_document,
        current_training=current_training, snapshot=snapshot, checkpoint_record=checkpoint_record,
        expected_accepted={
            "candidate": checkpoint_record, "digest": selected_sha, "step": step,
            "approval_path": accepted_path, "source_plan_path": source_plan_path,
            "approval_lineage_path": approval_lineage_path,
        },
    )

def chain_reader(fixture, chain, *, extra_members=()):
    json_paths = (
        fixture.path, chain.source_plan_path, chain.stage_path, chain.tester_manifest_path,
        chain.train_manifest_path, chain.tester_receipt_path, chain.train_receipt_path,
        chain.grading_path, chain.approval_lineage_path, chain.accepted_path,
        chain.gen_plan_path, chain.gen_manifest_path,
    )
    byte_paths = (
        fixture.identity, fixture.register, *fixture.refs, chain.threshold_path, chain.gate_path,
        *chain.anchor_paths, *chain.image_paths, chain.checkpoint_path, chain.staged_path,
    )
    members = (
        *(observed.ReadMember(path, JSON_LIMIT, allow_json=True) for path in json_paths),
        observed.ReadMember(fixture.sidecar, JSON_LIMIT, allow_json=True, optional=True),
        observed.ReadMember(chain.evaluation_path, JSON_LIMIT, allow_json=True, optional=True),
        *(observed.ReadMember(path, JSON_LIMIT) for path in byte_paths),
        *extra_members,
    )
    return observed.ObservedReads(
        roots=(fixture.root,), members=members,
        limits=observed.ReadLimits(max_files=256, max_unique_bytes=64 * 1024 * 1024, max_stream_bytes=128 * 1024 * 1024),
    )


def run_gen_validation(ft, chain, reads=None):
    plan, root = ft._load_plan(CREATOR, chain.gen_plan_path, reads=reads)
    return ft._validate_gen_source_inputs(plan, root, reads=reads)


def test_complete_checkpoint_authority_chain_default_and_observed_parity(tmp_path, restore_module_aliases, monkeypatch):
    fixture = make_copied_producer_fixture(tmp_path)
    ft = load_copied_figment_train(fixture, restore_module_aliases)
    chain = build_authority_chain(fixture, ft)
    lineage = ft._lineage_module()

    d_source_plan, d_source_root = ft._load_plan(CREATOR, chain.source_plan_path)
    assert d_source_root == chain.source_root
    d_grading = ft._read_json(chain.grading_path)
    d_subject = ft._current_review_subject(d_source_plan, d_source_root, "tester", d_grading)
    d_approval = ft._load_current_approval(d_source_plan, d_source_root, "tester")
    d_gen_plan, d_gen_root = ft._load_plan(CREATOR, chain.gen_plan_path)
    d_persona, d_training = ft._current_persona_training(d_gen_plan)
    d_accepted = ft._validated_accepted_checkpoint(d_persona, d_training)
    d_snapshot = ft._accepted_checkpoint_snapshot(d_accepted)
    assert ft._revalidate_planned_gen_authority(d_gen_plan) is None
    assert ft._validate_gen_source_inputs(d_gen_plan, d_gen_root) is None

    assert d_subject == chain.subject
    assert lineage.canonical_sha256(d_subject) == chain.subject_sha256
    assert d_approval == chain.approval_document
    assert d_approval["subject_sha256"] == chain.subject_sha256
    assert d_training == chain.current_training
    assert d_accepted == chain.expected_accepted
    assert d_snapshot == chain.snapshot

    tracker = SimpleNamespace(depth=0)
    labels = ("subject", "approval", "accepted", "revalidate", "gen")
    spies = {label: GuardedReader(chain_reader(fixture, chain), tracker) for label in labels}
    results = {}
    with monkeypatch.context() as trap:
        install_native_io_trap(trap, fixture.root, tracker)

        spy = spies["subject"]
        plan, root = ft._load_plan(CREATOR, chain.source_plan_path, reads=spy)
        grading = ft._read_json(chain.grading_path, reads=spy)
        results["subject"] = ft._current_review_subject(plan, root, "tester", grading, reads=spy)
        spy.recheck()

        spy = spies["approval"]
        plan, root = ft._load_plan(CREATOR, chain.source_plan_path, reads=spy)
        results["approval"] = ft._load_current_approval(plan, root, "tester", reads=spy)
        spy.recheck()

        spy = spies["accepted"]
        plan, _ = ft._load_plan(CREATOR, chain.gen_plan_path, reads=spy)
        persona, training = ft._current_persona_training(plan, reads=spy)
        results["training"] = training
        results["accepted"] = ft._validated_accepted_checkpoint(persona, training, reads=spy)
        results["snapshot"] = ft._accepted_checkpoint_snapshot(results["accepted"], reads=spy)
        spy.recheck()

        spy = spies["revalidate"]
        plan, _ = ft._load_plan(CREATOR, chain.gen_plan_path, reads=spy)
        results["revalidate"] = ft._revalidate_planned_gen_authority(plan, reads=spy)
        spy.recheck()

        spy = spies["gen"]
        plan, root = ft._load_plan(CREATOR, chain.gen_plan_path, reads=spy)
        results["gen"] = ft._validate_gen_source_inputs(plan, root, reads=spy)
        spy.recheck()

    assert tracker.depth == 0
    assert results["subject"] == d_subject
    assert lineage.canonical_sha256(results["subject"]) == chain.subject_sha256
    assert results["approval"] == d_approval
    assert results["training"] == d_training
    assert results["accepted"] == d_accepted == chain.expected_accepted
    assert results["snapshot"] == d_snapshot == chain.snapshot
    assert results["revalidate"] is None and results["gen"] is None
    for label, spy in spies.items():
        assert spy.calls and spy.calls[-1][0] == "recheck", label
    gen_hashed = {Path(args[0]) for name, args, _ in spies["gen"].calls if name == "sha256" and args}
    assert chain.staged_path in gen_hashed and chain.checkpoint_path in gen_hashed


def test_install_stage_config_gen_default_mode_runs_gen_source_validation(tmp_path, restore_module_aliases):
    fixture = make_copied_producer_fixture(tmp_path)
    ft = load_copied_figment_train(fixture, restore_module_aliases)
    chain = build_authority_chain(fixture, ft)
    plan, root = ft._load_plan(CREATOR, chain.gen_plan_path)
    assert ft._install_stage_config("gen", plan, root) is None

    tampered = bytearray(chain.staged_path.read_bytes())
    tampered[0] ^= 0x01
    chain.staged_path.write_bytes(bytes(tampered))
    with pytest.raises(ft.FigmentTrainError, match="staged gen checkpoint changed after planning"):
        ft._install_stage_config("gen", plan, root)

def rewrite_gen_uploads(chain, files):
    manifest = json.loads(chain.gen_manifest_path.read_text(encoding="utf-8"))
    manifest["uploads"][0]["files"] = files
    write_json(chain.gen_manifest_path, manifest)
    plan = json.loads(chain.gen_plan_path.read_text(encoding="utf-8"))
    plan["stages"]["gen"]["runs"][0]["sha256"] = file_sha256(chain.gen_manifest_path)
    write_json(chain.gen_plan_path, plan)


def _case_approval_lineage_reserialized(chain):
    document = json.loads(chain.approval_lineage_path.read_text(encoding="utf-8"))
    write_json(chain.approval_lineage_path, document, indent=4, sort_keys=True)
    assert file_sha256(chain.approval_lineage_path) != chain.snapshot["approval_lineage_sha256"]
    return ()


def _case_accepted_checkpoint_rewritten(chain):
    document = json.loads(chain.accepted_path.read_text(encoding="utf-8"))
    document["operator"]["decided_at"] = "2026-09-13T12:00:00+00:00"
    write_json(chain.accepted_path, document)
    assert file_sha256(chain.accepted_path) != chain.snapshot["approval_sha256"]
    return ()


def _case_staged_checkpoint_bytes(chain):
    tampered = bytearray(chain.staged_path.read_bytes())
    tampered[0] ^= 0x01
    chain.staged_path.write_bytes(bytes(tampered))
    return ()


def _case_glob_upload(chain):
    rewrite_gen_uploads(chain, ["accepted-checkpoint/*.safetensors"])
    return ()


def _case_second_checkpoint_upload(chain):
    rewrite_gen_uploads(chain, [chain.staged_upload, f"accepted-checkpoint/{chain.trigger}_second.safetensors"])
    return ()


def _case_non_safetensors_upload(chain):
    rewrite_gen_uploads(chain, [f"accepted-checkpoint/{Path(chain.selected_filename).stem}.ckpt"])
    return ()


def _case_absent_renamed_upload(chain):
    name = f"{chain.trigger}_renamed.safetensors"
    rewrite_gen_uploads(chain, [f"accepted-checkpoint/{name}"])
    return (observed.ReadMember(chain.staged_path.with_name(name), JSON_LIMIT, optional=True),)


def _case_escaping_absolute_upload(chain):
    escaping = str(chain.checkpoint_path)
    assert not any(char in escaping for char in "*?[]")
    rewrite_gen_uploads(chain, [escaping])
    return ()


REFUSAL_CASES = {
    "approval-lineage-reserialized": (
        _case_approval_lineage_reserialized, "tester approval lineage changed after checkpoint promotion"),
    "accepted-checkpoint-rewritten": (
        _case_accepted_checkpoint_rewritten, "selected checkpoint approval provenance changed after gen planning"),
    "staged-checkpoint-bytes": (
        _case_staged_checkpoint_bytes, "staged gen checkpoint changed after planning"),
    "glob-upload": (_case_glob_upload, "gen manifest must upload exactly one explicit checkpoint"),
    "second-checkpoint-upload": (
        _case_second_checkpoint_upload, "gen manifest must upload exactly one explicit checkpoint"),
    "non-safetensors-upload": (
        _case_non_safetensors_upload, "gen manifest must upload exactly one explicit checkpoint"),
    "absent-renamed-upload": (
        _case_absent_renamed_upload, "staged gen checkpoint changed after planning"),
    "escaping-absolute-upload": (
        _case_escaping_absolute_upload, "gen checkpoint upload escapes the reviewed plan root"),
}


@pytest.mark.parametrize("case", sorted(REFUSAL_CASES))
def test_gen_authority_refusals_reach_intended_guard_both_modes(tmp_path, restore_module_aliases, case):
    fixture = make_copied_producer_fixture(tmp_path)
    ft = load_copied_figment_train(fixture, restore_module_aliases)
    chain = build_authority_chain(fixture, ft)
    assert run_gen_validation(ft, chain) is None  # the unmutated chain is valid

    mutate, message = REFUSAL_CASES[case]
    extra_members = mutate(chain)

    with pytest.raises(ft.FigmentTrainError) as default_error:
        run_gen_validation(ft, chain)
    assert message in str(default_error.value)

    reader = chain_reader(fixture, chain, extra_members=extra_members)
    with pytest.raises(ft.FigmentTrainError) as observed_error:
        run_gen_validation(ft, chain, reads=reader)
    assert message in str(observed_error.value)
    assert str(default_error.value) == str(observed_error.value)
    reader.recheck()
