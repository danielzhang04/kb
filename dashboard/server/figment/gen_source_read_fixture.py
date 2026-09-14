"""Test-only fixture builder for the real HTTP `gen_source_read` harness.

Builds one genuine, finite, on-disk source-read fixture rooted under a
caller-supplied empty directory (`--out`), reusing the *proven* real-producer
helpers already defined in
`orgs/figment/pipeline/tests/test_gen_source_read_producers.py` (loaded from
the caller-supplied `--repo-source` checkout via `importlib`, never copied or
reimplemented here).

This module deliberately does **not** call that test file's `_build_fixture`:
that helper hardcodes its gen-plan directory to a short alias (`"g"`), not a
real published Studio allocation UUID, and renaming a compiled gen plan
directory after the fact would silently break every path baked into
`plan.json` / the gen manifest. Instead, this module drives the same five
proven building blocks directly (`_copy_pipeline_slice`,
`_make_synthetic_persona`, `_run_real_producer_chain`, `_build_gen_plan`,
`_OfflineGuard`, plus `_snapshot_pipeline_slice` and `load_module`) against a
gen-plan directory whose name *is* the real published allocation UUID from
the start, so every compiled path is correct on first write.

Everything produced is SYNTHETIC FIXTURE DATA for `creator-001`: a purely
authored persona, tiny real PNG containers holding synthetic pixels, and
fixture checkpoint/receipt bytes -- never a real pod run, real judge, real
network call, or real creator media. `_OfflineGuard` forces the ML scorer
stack absent and refuses any socket/subprocess attempt for the duration of
the real producer chain; this module asserts zero such attempts occurred and
then lets the guard restore itself before this process exits.

This module never imports, calls, or otherwise exercises
`gen_source_read.py` itself (no reader run, no validator patch, no ROOT
rebinding) -- that adapter is exercised only by the real, separately-owned
HTTP-fixture-consuming test process.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PUBLISHED_ID = "11111111-2222-4333-8444-555555555555"
DEPENDENCY_NAMES = (
    "observed_reads.py", "figment_train.py", "training_config.py",
    "persona.py", "lineage.py",
)
MAX_LINE_BYTES = 64 * 1024


def _fail(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.exit(1)


def _empty_existing_dir(path: Path) -> Path:
    if not path.is_absolute() or not path.is_dir():
        _fail("gen-source-read-fixture: --out must be an existing absolute directory")
    if any(path.iterdir()):
        _fail("gen-source-read-fixture: --out must be empty")
    return path


def _existing_repo(path: Path) -> Path:
    tests_file = path / "orgs" / "figment" / "pipeline" / "tests" / "test_gen_source_read_producers.py"
    if not path.is_absolute() or not tests_file.is_file():
        _fail("gen-source-read-fixture: --repo-source must be an existing absolute checkout")
    return path


def _split(rel: str) -> tuple:
    return tuple(rel.split("/"))


def build_fixture(repo_source: Path, out: Path) -> dict:
    tests_file = (
        repo_source / "orgs" / "figment" / "pipeline" / "tests"
        / "test_gen_source_read_producers.py"
    )

    def _load(name: str, path: Path):
        import importlib.util
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    test_mod = _load("gspr_fixture_test_producers", tests_file)

    root = out / "r"
    figment = root / "orgs" / "figment"
    pipeline_dest = figment / "pipeline"
    personas = figment / "personas"
    source_root = figment / "s"
    gen_root = figment / "_private" / "figment-studio" / "gen-plans" / PUBLISHED_ID
    source_ledger = out / "l" / "src"
    gen_ledger = out / "l" / "gen"

    root.mkdir(parents=True, exist_ok=True)
    figment.mkdir(parents=True, exist_ok=True)
    personas.mkdir(parents=True, exist_ok=True)
    gen_root.parent.mkdir(parents=True, exist_ok=True)
    source_ledger.mkdir(parents=True, exist_ok=True)
    gen_ledger.mkdir(parents=True, exist_ok=True)

    buf_out, buf_err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(buf_out), contextlib.redirect_stderr(buf_err):
        copy_snapshot = test_mod._copy_pipeline_slice(pipeline_dest)
        persona_path = test_mod._make_synthetic_persona(personas)
        generated_look_sha256 = test_mod.file_sha256(pipeline_dest / "look-spec.md")

        command = test_mod.load_module("gspr_fixture_figment_train", pipeline_dest / "figment_train.py")

        with test_mod._OfflineGuard() as guard:
            chain = test_mod._run_real_producer_chain(command, personas, source_root, source_ledger)
            gen_plan, gen_plan_path, gen_manifest_path = test_mod._build_gen_plan(
                command, personas, gen_root, gen_ledger,
            )
        if guard.attempts:
            raise AssertionError(f"forbidden I/O during producer chain: {guard.attempts}")

        full_before = dict(copy_snapshot)
        full_before["look-spec.md"] = generated_look_sha256
        full_after = test_mod._snapshot_pipeline_slice(pipeline_dest)
        if full_before != full_after:
            raise AssertionError("copied pipeline slice mutated by producer chain")

    staged_checkpoint = (gen_root / "train" / "runs" / "accepted-checkpoint"
                         / f"{gen_plan['training']['trigger']}_000001500.safetensors")
    assert staged_checkpoint.is_file(), "staged checkpoint missing"
    assert test_mod.file_sha256(staged_checkpoint) == test_mod.file_sha256(chain.checkpoint_path)

    plan_sha256 = test_mod.file_sha256(gen_plan_path)
    source_plan_sha256 = test_mod.file_sha256(chain.source_plan_path)
    dependency_sha256 = {
        name: test_mod.file_sha256(pipeline_dest / name) for name in DEPENDENCY_NAMES
    }
    adapter_sha256 = test_mod.file_sha256(pipeline_dest / "gen_source_read.py")

    code_pins = []
    for rel, sha in copy_snapshot.items():
        parts = _split(rel)
        assert test_mod.file_sha256(test_mod.PIPELINE.joinpath(*parts)) == sha, "original source changed"
        code_pins.append({
            "source": str(test_mod.PIPELINE.joinpath(*parts)),
            "dest": str(pipeline_dest.joinpath(*parts)),
            "sha256": sha,
        })

    now = datetime.now(timezone.utc)
    created_utc = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    intent_sha256 = hashlib.sha256(f"{PUBLISHED_ID}:creator-001:gen".encode("ascii")).hexdigest()
    marker = {
        "schema": "figment/studio-gen-plan-marker@1",
        "id": PUBLISHED_ID,
        "plan_sha256": plan_sha256,
        "intent_sha256": intent_sha256,
        "created_utc": created_utc,
    }
    (gen_root / "published.json").write_text(json.dumps(marker) + "\n", encoding="ascii")

    return {
        "schema": "figment/gen-source-http-fixture@1",
        "root": str(root),
        "sourceRoot": str(source_root),
        "selectedRoot": str(gen_root),
        "id": PUBLISHED_ID,
        "planSha256": plan_sha256,
        "sourcePlanSha256": source_plan_sha256,
        "adapterSha256": adapter_sha256,
        "dependencySha256": dependency_sha256,
        "checkpointPath": str(chain.checkpoint_path),
        "personaPath": str(persona_path),
        "codePins": code_pins,
        "generatedLookSha256": generated_look_sha256,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-source", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    repo_source = _existing_repo(Path(args.repo_source))
    out = _empty_existing_dir(Path(args.out))

    try:
        descriptor = build_fixture(repo_source, out)
        line = json.dumps(descriptor, sort_keys=True, separators=(",", ":")) + "\n"
        data = line.encode("ascii")
        if len(data) > MAX_LINE_BYTES or data.count(b"\n") != 1:
            raise ValueError("descriptor exceeds bounded output")
        if sys.stdout.buffer.write(data) != len(data):
            raise OSError("short fixture descriptor write")
        sys.stdout.buffer.flush()
    except BaseException:
        _fail("gen-source-read-fixture: build failed; fixture directory preserved for inspection")


if __name__ == "__main__":
    main()
