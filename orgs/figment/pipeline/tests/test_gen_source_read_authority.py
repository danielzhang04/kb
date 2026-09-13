"""Child-process CLI tests for the copied `gen_source_read.py` adapter.

Scope (read before extending):

* Windows/CPython only, like the driver seam module whose helpers are reused.
* The fixture tree is built only by the supplied driver-test helpers:
  `make_copied_producer_fixture`, `load_copied_figment_train` and
  `build_authority_chain`.
* Every artifact is tiny synthetic bytes. None of them is a real image or
  checkpoint. The plans, grade records, lineage and accepted-checkpoint
  records were NOT produced by `build_plan`, `build_grade`, `apply_rulings`
  or the figment CLI.
* This is adapter CLI coverage over a synthetic authority chain. It is not
  producer, planner or launch coverage.
* The exact `gen_source_read.py` is copied into the fixture pipeline before
  any observation. The five dependency pins are computed from the copied
  files.
* The adapter runs in a real `sys.executable -I -B` child with the six exact
  flags. It is never mocked.
* `ROOT` is never monkeypatched, no module is faked or forwarded, and nothing
  touches a provider, the network or real media.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

if os.name != "nt":
    pytest.skip("observed reads support CPython on Windows only", allow_module_level=True)

HERE = Path(__file__).resolve()
PIPELINE = HERE.parents[1]
DRIVER_TEST_PATH = HERE.with_name("test_figment_train_observed_reads.py")


def _load_driver_tests():
    name = "b3_driver_seam_reference"
    spec = importlib.util.spec_from_file_location(name, DRIVER_TEST_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


driver = _load_driver_tests()
# Module-level alias: pytest resolves the driver's exact alias-restoring fixture.
restore_module_aliases = driver.restore_module_aliases
file_sha256 = driver.file_sha256
write_json = driver.write_json

SCHEMA = "figment/gen-source-read@1"
UNAVAILABLE = b'{"result":"unavailable","schema":"figment/gen-source-read@1"}\n'
DEPENDENCIES = (
    "observed_reads.py", "figment_train.py", "training_config.py", "persona.py", "lineage.py",
)


def build(tmp_path, aliases, *, relocate=False):
    fixture = driver.make_copied_producer_fixture(tmp_path)
    pipeline = fixture.root / "pipeline"
    adapter = pipeline / "gen_source_read.py"
    # Copied before anything below reads or observes the tree.
    shutil.copy2(PIPELINE / "gen_source_read.py", adapter)
    ft = driver.load_copied_figment_train(fixture, aliases)
    chain = driver.build_authority_chain(fixture, ft)
    if relocate:
        fixture_root_resolved = fixture.root.resolve()
        target = fixture.root / "_private" / "figment-studio" / "gen-plans" / "creator-001-gen"
        old = chain.gen_root
        source_resolved = old.resolve()
        target_resolved = target.resolve()
        assert source_resolved.is_relative_to(fixture_root_resolved)
        assert target_resolved.is_relative_to(fixture_root_resolved)
        assert source_resolved == chain.gen_root.resolve()
        assert not target_resolved.exists()
        target.parent.mkdir(parents=True)
        shutil.move(str(old), str(target))
        for attr in ("gen_root", "gen_plan_path", "gen_manifest_path", "staged_path"):
            setattr(chain, attr, target / getattr(chain, attr).relative_to(old))
        assert not old.exists() and chain.staged_path.is_file()
    pins = {name: file_sha256(pipeline / name) for name in DEPENDENCIES}
    return fixture, chain, adapter, pins


def run_cli(fixture, chain, adapter, pins, **override):
    args = {
        "--creator": driver.CREATOR,
        "--selected-root": str(chain.gen_root),
        "--selected-plan-sha256": file_sha256(chain.gen_plan_path),
        "--source-root": str(chain.source_root),
        "--source-plan-sha256": file_sha256(chain.source_plan_path),
        "--dependency-sha256": json.dumps(pins),
        **override,
    }
    argv = [sys.executable, "-I", "-B", str(adapter)]
    for flag, value in args.items():
        argv += [flag, value]
    done = subprocess.run(
        argv, capture_output=True, timeout=60, cwd=str(fixture.root), stdin=subprocess.DEVNULL,
    )
    return done.returncode, done.stdout, done.stderr


def assert_success(fixture, chain, adapter, pins):
    code, out, err = run_cli(fixture, chain, adapter, pins)
    assert (code, err) == (0, b""), out
    assert out.endswith(b"\n") and out.count(b"\n") == 1
    assert b"\r" not in out
    assert json.loads(out.decode("ascii")) == {
        "schema": SCHEMA,
        "result": "current-source-observed",
        "creator": driver.CREATOR,
        "selected_plan_sha256": file_sha256(chain.gen_plan_path),
        "persona_sha256": file_sha256(fixture.path),
        "approval_sha256": file_sha256(chain.accepted_path),
        "approval_lineage_sha256": file_sha256(chain.approval_lineage_path),
        "source_plan_sha256": file_sha256(chain.source_plan_path),
        "checkpoint_sha256": file_sha256(chain.checkpoint_path),
        "gen_manifest_sha256": [file_sha256(chain.gen_manifest_path)],
        "gen_runs": 1,
        "claims": {"launch_ready": False, "quality_approved": False, "atomic_snapshot": False},
    }
    assert chain.snapshot["checkpoint_sha256"] == file_sha256(chain.checkpoint_path)


def assert_unavailable(result):
    code, out, err = result
    assert (code, out, err) == (1, UNAVAILABLE, b"")


def flip_first_byte(path):
    data = bytearray(path.read_bytes())
    data[0] ^= 0x01
    path.write_bytes(bytes(data))
    assert len(data) == path.stat().st_size


def test_cli_success_in_fixture_plan_layout(tmp_path, restore_module_aliases):
    assert_success(*build(tmp_path, restore_module_aliases))


def test_cli_success_with_selected_root_under_canonical_gen_plans(tmp_path, restore_module_aliases):
    fixture, chain, adapter, pins = build(tmp_path, restore_module_aliases, relocate=True)
    assert chain.gen_root.parent == fixture.root / "_private" / "figment-studio" / "gen-plans"
    assert chain.source_root.is_relative_to(fixture.root)
    assert_success(fixture, chain, adapter, pins)


def test_cli_refuses_stale_source_plan_digest(tmp_path, restore_module_aliases):
    # Source plan bytes are left untouched; only the configured pin is wrong,
    # which isolates that the adapter checks --source-plan-sha256 itself.
    fixture, chain, adapter, pins = build(tmp_path, restore_module_aliases)
    assert_success(fixture, chain, adapter, pins)
    wrong = "0" * 64
    assert wrong != file_sha256(chain.source_plan_path)
    assert_unavailable(run_cli(fixture, chain, adapter, pins, **{"--source-plan-sha256": wrong}))


def test_cli_refuses_stale_selected_plan_digest(tmp_path, restore_module_aliases):
    fixture, chain, adapter, pins = build(tmp_path, restore_module_aliases)
    assert_success(fixture, chain, adapter, pins)
    stale = file_sha256(chain.gen_plan_path)
    write_json(chain.gen_plan_path, json.loads(chain.gen_plan_path.read_text("utf-8")), indent=4)
    assert file_sha256(chain.gen_plan_path) != stale
    assert_unavailable(run_cli(fixture, chain, adapter, pins, **{"--selected-plan-sha256": stale}))
    # The rewritten tree itself is unchanged content-wise; passing its fresh pin
    # succeeds, proving the prior refusal was caused solely by the stale pin.
    fresh_pin = file_sha256(chain.gen_plan_path)
    assert_success(fixture, chain, adapter, pins)


@pytest.mark.parametrize("attr", ["staged_path", "checkpoint_path"])
def test_cli_refuses_same_length_changed_checkpoint(tmp_path, restore_module_aliases, attr):
    fixture, chain, adapter, pins = build(tmp_path, restore_module_aliases)
    assert_success(fixture, chain, adapter, pins)
    flip_first_byte(getattr(chain, attr))
    assert_unavailable(run_cli(fixture, chain, adapter, pins))


def test_cli_refuses_changed_gen_manifest_with_old_recorded_run_digest(tmp_path, restore_module_aliases):
    fixture, chain, adapter, pins = build(tmp_path, restore_module_aliases)
    assert_success(fixture, chain, adapter, pins)
    recorded = json.loads(chain.gen_plan_path.read_text("utf-8"))["stages"]["gen"]["runs"][0]["sha256"]
    manifest = json.loads(chain.gen_manifest_path.read_text("utf-8"))
    manifest["workflow"]["1"]["inputs"]["seed"] = 41
    write_json(chain.gen_manifest_path, manifest)
    assert file_sha256(chain.gen_manifest_path) != recorded
    # The selected plan pin itself is unchanged from build(); the recorded
    # run.sha256 inside that plan still points at the old manifest bytes.
    unchanged_pin = file_sha256(chain.gen_plan_path)
    assert_unavailable(run_cli(fixture, chain, adapter, pins, **{"--selected-plan-sha256": unchanged_pin}))


def test_cli_accepts_absent_sidecar_then_refuses_malformed_new_sidecar(tmp_path, restore_module_aliases):
    fixture, chain, adapter, pins = build(tmp_path, restore_module_aliases)
    assert not fixture.sidecar.exists(), "fixture must start with the optional sidecar absent"
    assert_success(fixture, chain, adapter, pins)
    write_json(fixture.sidecar, {"training": {"trigger": 7}, "unexpected": True})
    assert_unavailable(run_cli(fixture, chain, adapter, pins))  # fresh child process


def test_cli_refuses_changed_dependency_pin(tmp_path, restore_module_aliases):
    fixture, chain, adapter, pins = build(tmp_path, restore_module_aliases)
    assert_success(fixture, chain, adapter, pins)
    changed = {**pins, "lineage.py": "0" * 64}
    assert changed["lineage.py"] != pins["lineage.py"]
    assert_unavailable(run_cli(
        fixture, chain, adapter, pins, **{"--dependency-sha256": json.dumps(changed)},
    ))


@pytest.mark.parametrize("select", ["source_root", "figment_root", "persona_home", "pipeline"])
def test_cli_refuses_selected_root_replaced_by_another_configured_path(tmp_path, restore_module_aliases, select):
    """Composite CLI refusal: swapping --selected-root for another real,
    configured path (still present on disk) must still be refused. This does
    not isolate or name any specific internal exception."""
    fixture, chain, adapter, pins = build(tmp_path, restore_module_aliases)
    assert_success(fixture, chain, adapter, pins)
    replacement = {
        "source_root": chain.source_root,
        "figment_root": fixture.root.parent,
        "persona_home": fixture.path.parent,
        "pipeline": fixture.root / "pipeline",
    }[select]
    assert_unavailable(run_cli(fixture, chain, adapter, pins, **{"--selected-root": str(replacement)}))
