import hashlib
import json
import sys
import tarfile
import types
from pathlib import Path

import pytest

from scripts.build_platform_release import build_release


release_signing_public = types.ModuleType("release_signing_public")
release_signing_public.RELEASE_PUBLIC_KEY = ""
sys.modules.setdefault("release_signing_public", release_signing_public)

from deploy import activate_release


VERSION = "a" * 40


def release_source(root: Path) -> Path:
    source = root / "source"
    for rel in (
        "dashboard/dist/app.js", "dashboard/server/index.ts", "dashboard/package.json",
        "dashboard/package-lock.json", "dashboard/node_modules/pkg/index.js", "scripts/cards.py",
        "schemas/compatibility.json", "dashboard/config/repositories.json",
        "deploy/activate_release.py", "deploy/bootstrap_vm.py", "deploy/export_tier0.py",
        "deploy/validate_vm_runtime.py", "deploy/systemd/kb-dashboard.service",
    ):
        path = source / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rel, encoding="utf-8")
    return source


def test_release_is_versioned_and_excludes_data(tmp_path: Path):
    source = release_source(tmp_path)
    (source / "deploy/__pycache__").mkdir()
    (source / "deploy/__pycache__/activate_release.cpython-313.pyc").write_bytes(b"local bytecode")
    (source / "queue").mkdir()
    (source / "queue/card.md").write_text("secret data", encoding="utf-8")
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    attestation = tmp_path / f"kb-platform-{VERSION}.attestation.json"
    build_release(source, VERSION, output, attestation)
    with tarfile.open(output, "r:gz") as archive:
        names = set(archive.getnames())
        assert "VERSION" in names
        assert "dashboard/server/index.ts" in names
        assert "deploy/activate_release.py" in names
        assert "deploy/bootstrap_vm.py" in names
        assert "deploy/export_tier0.py" in names
        assert "deploy/validate_vm_runtime.py" in names
        assert "deploy/systemd/kb-dashboard.service" in names
        assert not any("__pycache__" in name or name.endswith(".pyc") for name in names)
        assert not any(name.startswith("queue/") for name in names)
        assert archive.extractfile("VERSION").read().decode() == VERSION + "\n"
        assert "MANIFEST.sha256" in names
    assert json.loads(attestation.read_text(encoding="utf-8")) == {
        "archive": output.name,
        "schema": "kb.release-attestation/v1",
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "sourceCommit": VERSION,
        "workflow": "kb-platform-release",
    }
    assert attestation.read_bytes().endswith(b"\n")


def test_utf8_manifest_is_accepted_by_the_release_consumer(tmp_path: Path):
    source = release_source(tmp_path)
    snow = source / "dashboard/node_modules/pkg/fixtures/snow \u2603/index.html"
    snow.parent.mkdir(parents=True)
    snow.write_text("snow\n", encoding="utf-8")
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json")

    with tarfile.open(output, "r:gz") as archive:
        manifest = activate_release._manifest_entries(archive.extractfile("MANIFEST.sha256").read())

    assert "dashboard/node_modules/pkg/fixtures/snow \u2603/index.html" in manifest


def _gyp_package(source: Path, absolute_marker: str) -> None:
    build = source / "dashboard/node_modules/native-pkg/build"
    (build / "Release/obj.target").mkdir(parents=True)
    (build / "config.gypi").write_text(
        f"{{'variables': {{'nodedir': '{absolute_marker}'}}}}\n", encoding="utf-8"
    )
    (build / "Makefile").write_text(
        f"builddir := {absolute_marker}/build/Release\n", encoding="utf-8"
    )
    (build / "Release/obj.target/pty.o").write_bytes(b"\x00obj " + absolute_marker.encode())
    (build / "Release/pty.node").write_bytes(b"identical-loadable-payload")


def test_builds_from_different_source_directories_are_byte_identical(tmp_path: Path):
    """The discriminating shape: same-path double-builds cannot see a path-embedding intermediate."""
    digests = []
    for name in ("b1", "b2"):
        root = tmp_path / name
        source = release_source(root)
        _gyp_package(source, f"/var/tmp/kb-accept/{name}")
        output = root / f"kb-platform-{VERSION}.tar.gz"
        build_release(source, VERSION, output, root / "attestation.json")
        digests.append(hashlib.sha256(output.read_bytes()).hexdigest())
        with tarfile.open(output, "r:gz") as archive:
            names = set(archive.getnames())
        assert "dashboard/node_modules/native-pkg/build/Release/pty.node" in names
        assert not any(
            name.startswith("dashboard/node_modules/native-pkg/build/") and not name.endswith(".node")
            for name in names
        )
    assert digests[0] == digests[1]


def test_published_javascript_build_directories_are_retained(tmp_path: Path):
    """Guard against blanket node_modules/*/build/** pruning of runtime JavaScript."""
    source = release_source(tmp_path)
    published = source / "dashboard/node_modules/@peculiar/asn1-schema/build/cjs/index.js"
    published.parent.mkdir(parents=True)
    published.write_text("module.exports = {};\n", encoding="utf-8")
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json")
    with tarfile.open(output, "r:gz") as archive:
        assert "dashboard/node_modules/@peculiar/asn1-schema/build/cjs/index.js" in set(archive.getnames())


@pytest.mark.slow
def test_real_repo_release_manifest_is_accepted_by_the_release_consumer(tmp_path: Path):
    source = Path(__file__).resolve().parents[1]
    required = [source / rel for rel in ("dashboard/dist", "dashboard/node_modules")]
    if any(not path.exists() for path in required):
        pytest.skip("real release build inputs are not installed")
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json")
    with tarfile.open(output, "r:gz") as archive:
        entries = activate_release._manifest_entries(archive.extractfile("MANIFEST.sha256").read())
    assert entries
