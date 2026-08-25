import gzip
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tarfile
import types
from pathlib import Path

import pytest

from scripts.build_platform_release import (
    BREAKING_MARKER,
    BROKER_ARCHIVE,
    assert_broker_archive,
    build_release,
)


release_signing_public = types.ModuleType("release_signing_public")
release_signing_public.RELEASE_PUBLIC_KEY = ""
sys.modules.setdefault("release_signing_public", release_signing_public)

from deploy import activate_release


VERSION = "a" * 40
NODE = shutil.which("node")


def elf_native(machine: int = 0x3E, elf_class: int = 2, data: int = 1) -> bytes:
    """A minimal but real ELF header: class/endianness/e_machine are what the packer checks."""
    ident = bytes([0x7F, 0x45, 0x4C, 0x46, elf_class, data, 1]) + bytes(9)
    return ident + (2).to_bytes(2, "little") + machine.to_bytes(2, "little") + b" fake native"


ELF_NATIVE = elf_native()
KOFFI_NATIVE_MEMBER = "node_modules/@koromix/koffi-linux-x64/linux_x64/koffi.node"
BROKER_MEMBERS = (
    ("main.js", b"import './server/pty/linuxBrokerMain.js';\n"),
    ("package.json", b'{"name":"kb-shell-broker","private":true,"type":"module"}\n'),
    ("server/pty/linuxBrokerMain.js", b"export const broker = 1;\n"),
    ("node_modules/node-pty/package.json", b'{"name":"node-pty"}\n'),
    ("node_modules/node-pty/build/Release/pty.node", ELF_NATIVE),
    # koffi is loaded on EVERY inbound broker connection (SO_PEERCRED), from an install root with no
    # node_modules above it: unpackaged, the broker starts, reports active, and refuses every client.
    ("node_modules/koffi/package.json", b'{"name":"koffi"}\n'),
    (KOFFI_NATIVE_MEMBER, ELF_NATIVE),
)


def write_broker_archive(source: Path, members=BROKER_MEMBERS) -> str:
    """The `npm run build:pty-broker` payload, packed the same deterministic way the script packs it."""
    path = source / BROKER_ARCHIVE
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed, tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name, data in members:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o444
            archive.addfile(info, io.BytesIO(data))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def release_source(root: Path) -> Path:
    source = root / "source"
    write_broker_archive(source)
    for rel in (
        "dashboard/dist/app.js", "dashboard/server/index.ts", "dashboard/src/lib/timelineModel.ts", "dashboard/package.json",
        "dashboard/package-lock.json", "dashboard/node_modules/pkg/index.js", "scripts/cards.py",
        "schemas/compatibility.json", "dashboard/config/repositories.json",
        "deploy/activate_release.py", "deploy/bootstrap_vm.py", "deploy/control_plane_schema.py", "deploy/export_tier0.py",
        "deploy/validate_vm_runtime.py", "deploy/systemd/kb-dashboard.service",
        "deploy/systemd/kb-shell-broker.service", "deploy/systemd/kb-shell-broker.socket",
        "deploy/kb_node_proxy.py", "deploy/kb_whois_shim.py",
        "deploy/systemd/kb-node-proxy.service", "deploy/systemd/kb-whois.service",
        "deploy/systemd/kb-whois.socket",
        "HEARTBEAT.md", "orgs/kb-ops/HEARTBEAT.md", "orgs/atlas-prep/HEARTBEAT.md",
        "agents/hygiene.md", "agents/dispatcher-cloud.md",
    ):
        path = source / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rel, encoding="utf-8")
    return source


def test_cadence_files_byte_identical_in_versioned_release_that_excludes_data(tmp_path: Path):
    source = release_source(tmp_path)
    (source / "deploy/__pycache__").mkdir()
    (source / "deploy/__pycache__/activate_release.cpython-313.pyc").write_bytes(b"local bytecode")
    (source / "queue").mkdir()
    (source / "queue/card.md").write_text("secret data", encoding="utf-8")
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    attestation = tmp_path / f"kb-platform-{VERSION}.attestation.json"
    build_release(source, VERSION, output, attestation, host_platform="linux")
    with tarfile.open(output, "r:gz") as archive:
        names = set(archive.getnames())
        assert "VERSION" in names
        assert "dashboard/server/index.ts" in names
        assert "dashboard/src/lib/timelineModel.ts" in names
        assert "deploy/activate_release.py" in names
        assert "deploy/bootstrap_vm.py" in names
        assert "deploy/control_plane_schema.py" in names
        assert "deploy/export_tier0.py" in names
        assert "deploy/validate_vm_runtime.py" in names
        assert "deploy/systemd/kb-dashboard.service" in names
        for rel in (
            "HEARTBEAT.md", "orgs/kb-ops/HEARTBEAT.md", "orgs/atlas-prep/HEARTBEAT.md",
            "agents/hygiene.md", "agents/dispatcher-cloud.md",
        ):
            assert rel in names
            assert archive.extractfile(rel).read() == (source / rel).read_bytes()
        assert not any("__pycache__" in name or name.endswith(".pyc") for name in names)
        assert not any(name.startswith("queue/") for name in names)
        assert archive.extractfile("VERSION").read().decode() == VERSION + "\n"
        assert "MANIFEST.sha256" in names
        manifest = archive.extractfile("MANIFEST.sha256").read().decode("utf-8")
        assert "  dashboard/src/lib/timelineModel.ts\n" in manifest
    assert attestation.read_bytes().endswith(b"\n")


def test_release_attestation_uses_registry_metadata(tmp_path):
    source = release_source(tmp_path)
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    attestation = tmp_path / f"kb-platform-{VERSION}.attestation.json"
    build_release(source, VERSION, output, attestation, host_platform="linux")
    value = json.loads(attestation.read_bytes())
    assert set(value) == {
        "archive", "schema", "sha256", "sourceCommit", "stateSchema",
        "rollbackStateSchema", "stateMigration", "workflow",
    }
    assert value == {
        "archive": output.name, "schema": "kb.release-attestation/v2",
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "sourceCommit": VERSION, "stateSchema": "3",
        "rollbackStateSchema": "2", "stateMigration": "breaking",
        "workflow": "kb-platform-release",
    }


def test_utf8_manifest_is_accepted_by_the_release_consumer(tmp_path: Path):
    source = release_source(tmp_path)
    snow = source / "dashboard/node_modules/pkg/fixtures/snow \u2603/index.html"
    snow.parent.mkdir(parents=True)
    snow.write_text("snow\n", encoding="utf-8")
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json", host_platform="linux")

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
        build_release(source, VERSION, output, root / "attestation.json", host_platform="linux")
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
    build_release(source, VERSION, output, tmp_path / "attestation.json", host_platform="linux")
    with tarfile.open(output, "r:gz") as archive:
        assert "dashboard/node_modules/@peculiar/asn1-schema/build/cjs/index.js" in set(archive.getnames())


def test_broker_archive_is_manifest_covered_by_its_own_digest(tmp_path: Path):
    """The installer's whole identity check: MANIFEST.sha256 must record the archive's real bytes."""
    source = release_source(tmp_path)
    digest = hashlib.sha256((source / BROKER_ARCHIVE).read_bytes()).hexdigest()
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json", host_platform="linux")
    with tarfile.open(output, "r:gz") as archive:
        names = set(archive.getnames())
        manifest = archive.extractfile("MANIFEST.sha256").read().decode("utf-8")
        assert BROKER_ARCHIVE in names
        # install_pty_broker refuses a release that does not carry BOTH units, so the release must.
        assert "deploy/systemd/kb-shell-broker.service" in names
        assert "deploy/systemd/kb-shell-broker.socket" in names
        assert f"{digest}  {BROKER_ARCHIVE}\n" in manifest
        assert "  deploy/systemd/kb-shell-broker.socket\n" in manifest
    assert assert_broker_archive(source, host_platform="linux") == digest


def test_node_proxy_shim_and_three_units_are_packed_under_manifest(tmp_path: Path):
    """dashboard-v3 P6 §3.3: the attested proxy + WhoIs shim + all three units ride the release tree, so
    MANIFEST.sha256 covers them and validate_vm_runtime digest-verifies them at boot."""
    source = release_source(tmp_path)
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json", host_platform="linux")
    packed = (
        "deploy/kb_node_proxy.py", "deploy/kb_whois_shim.py",
        "deploy/systemd/kb-node-proxy.service", "deploy/systemd/kb-whois.service",
        "deploy/systemd/kb-whois.socket",
    )
    with tarfile.open(output, "r:gz") as archive:
        names = set(archive.getnames())
        manifest = archive.extractfile("MANIFEST.sha256").read().decode("utf-8")
    for rel in packed:
        assert rel in names, rel
        digest = hashlib.sha256((source / rel).read_bytes()).hexdigest()
        assert f"{digest}  {rel}\n" in manifest, rel


def test_a_non_linux_build_host_cannot_pack_a_linux_broker_archive_at_all(tmp_path: Path):
    """There is no "foreign native accepted" path any more.

    npm installs only the host's native sidecars, so a Windows-packed release ships PE `.node` files
    that fail at first broker spawn or first connection - deep inside the VM, long after signing.
    """
    source = release_source(tmp_path)
    for host in ("win32", "darwin"):
        with pytest.raises(ValueError, match="only be packed on a Linux build host"):
            assert_broker_archive(source, host_platform=host)
        with pytest.raises(ValueError, match="only be packed on a Linux build host"):
            build_release(source, VERSION, tmp_path / f"kb-platform-{VERSION}.tar.gz",
                          tmp_path / "attestation.json", host_platform=host)


@pytest.mark.parametrize("native,message", [
    (b"MZ\x90\x00 portable executable, padded past twenty bytes", "is not ELF"),
    (b"\x7fELF", "is not ELF"),
    (elf_native(elf_class=1), "not ELF class 64"),
    (elf_native(data=2), "not little-endian"),
    (elf_native(machine=0x03), "targets machine 0x3"),
])
def test_broker_archive_natives_must_be_loadable_on_the_vm(tmp_path: Path, native: bytes,
                                                           message: str):
    source = release_source(tmp_path)
    assert assert_broker_archive(source, host_platform="linux")
    write_broker_archive(source, tuple(
        (name, native if name.endswith(".node") else data) for name, data in BROKER_MEMBERS))
    with pytest.raises(ValueError, match=message):
        assert_broker_archive(source, host_platform="linux")


@pytest.mark.parametrize("dropped,message", [
    ("node_modules/koffi/package.json", "missing"),
    (KOFFI_NATIVE_MEMBER, "no koffi native module"),
    ("node_modules/node-pty/build/Release/pty.node", "no node-pty native module"),
])
def test_release_refuses_a_broker_archive_missing_a_runtime_dependency(tmp_path: Path, dropped: str,
                                                                       message: str):
    """koffi runs on every inbound connection; node-pty on every session. Both must ship."""
    source = release_source(tmp_path)
    write_broker_archive(source, tuple(m for m in BROKER_MEMBERS if m[0] != dropped))
    with pytest.raises(ValueError, match=message):
        build_release(source, VERSION, tmp_path / f"kb-platform-{VERSION}.tar.gz",
                      tmp_path / "attestation.json", host_platform="linux")


@pytest.mark.parametrize("dropped", ["main.js", "package.json", "server/pty/linuxBrokerMain.js"])
def test_release_refuses_a_broker_archive_missing_a_pinned_member(tmp_path: Path, dropped: str):
    source = release_source(tmp_path)
    write_broker_archive(source, tuple(member for member in BROKER_MEMBERS if member[0] != dropped))
    with pytest.raises(ValueError, match="missing"):
        build_release(source, VERSION, tmp_path / f"kb-platform-{VERSION}.tar.gz",
                      tmp_path / "attestation.json", host_platform="linux")


def test_release_refuses_a_broker_archive_without_a_node_pty_native_module(tmp_path: Path):
    source = release_source(tmp_path)
    write_broker_archive(source, tuple(member for member in BROKER_MEMBERS
                                       if not member[0].endswith(".node")))
    with pytest.raises(ValueError, match="no node-pty native module"):
        build_release(source, VERSION, tmp_path / f"kb-platform-{VERSION}.tar.gz",
                      tmp_path / "attestation.json", host_platform="linux")


def test_release_refuses_a_missing_broker_archive(tmp_path: Path):
    source = release_source(tmp_path)
    (source / BROKER_ARCHIVE).unlink()
    with pytest.raises(FileNotFoundError, match="kb-shell-broker.tar.gz"):
        build_release(source, VERSION, tmp_path / f"kb-platform-{VERSION}.tar.gz",
                      tmp_path / "attestation.json", host_platform="linux")


def test_breaking_marker_ships_and_is_manifest_covered_when_source_carries_it(tmp_path: Path):
    """`BREAKING` at the source root rides into the release tree, covered by MANIFEST.sha256."""
    source = release_source(tmp_path)
    (source / BREAKING_MARKER).write_text("state schema bump\n", encoding="utf-8")
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json", host_platform="linux")
    with tarfile.open(output, "r:gz") as archive:
        names = set(archive.getnames())
        manifest = archive.extractfile("MANIFEST.sha256").read().decode("utf-8")
    assert BREAKING_MARKER in names
    digest = hashlib.sha256((source / BREAKING_MARKER).read_bytes()).hexdigest()
    assert f"{digest}  {BREAKING_MARKER}\n" in manifest


def test_no_breaking_marker_when_source_lacks_it(tmp_path: Path):
    """The marker is additive: a release with no `BREAKING` source file ships none [P5-C42]."""
    source = release_source(tmp_path)
    assert not (source / BREAKING_MARKER).exists()
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json", host_platform="linux")
    with tarfile.open(output, "r:gz") as archive:
        assert BREAKING_MARKER not in set(archive.getnames())


def test_breaking_marker_directory_at_source_root_is_not_shipped(tmp_path: Path):
    """Only a regular `BREAKING` file marks a breaking release; a directory is ignored."""
    source = release_source(tmp_path)
    (source / BREAKING_MARKER).mkdir()
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json", host_platform="linux")
    with tarfile.open(output, "r:gz") as archive:
        assert BREAKING_MARKER not in set(archive.getnames())


@pytest.mark.slow
def test_real_repo_release_manifest_is_accepted_by_the_release_consumer(tmp_path: Path):
    if NODE is None:
        pytest.fail("release acceptance prerequisite missing: node is not installed")
    source = Path(__file__).resolve().parents[1]
    required = [source / rel for rel in ("dashboard/dist", "dashboard/node_modules")]
    missing = [str(path.relative_to(source)) for path in required if not path.exists()]
    if missing:
        pytest.fail(f"release acceptance prerequisites missing: {', '.join(missing)}")
    output = tmp_path / f"kb-platform-{VERSION}.tar.gz"
    build_release(source, VERSION, output, tmp_path / "attestation.json", host_platform="linux")
    extracted = tmp_path / "extracted"
    with tarfile.open(output, "r:gz") as archive:
        entries = activate_release._manifest_entries(archive.extractfile("MANIFEST.sha256").read())
        archive.extractall("\\\\?\\" + str(extracted) if sys.platform == "win32" else extracted)
    assert entries
    result = subprocess.run(
        [NODE, "--experimental-strip-types", "-e", f"import({(extracted / 'dashboard/server/index.ts').as_uri()!r})"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
