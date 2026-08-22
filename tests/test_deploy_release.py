import base64
import hashlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

from deploy.control_plane_schema import (
    RELEASE_ATTESTATION_KEYS,
    RELEASE_ATTESTATION_SCHEMA,
    ROLLBACK_STATE_SCHEMA,
    STATE_MIGRATION,
    STATE_SCHEMA,
)

public_key_module = types.ModuleType("release_signing_public")
public_key_module.RELEASE_PUBLIC_KEY = ""
sys.modules.setdefault("release_signing_public", public_key_module)

from deploy import activate_release
from deploy import bootstrap_vm
from deploy.activate_release import require_root_staging
from scripts import deploy_platform_release


TEST_RELEASE_COMMIT = "d" * 40


def test_dashboard_unit_provisions_schedule_socket_runtime_directory():
    unit = (Path(__file__).parents[1] / "deploy/systemd/kb-dashboard.service").read_text(
        encoding="utf-8"
    )
    assert "RuntimeDirectory=kb-dashboard" in unit.splitlines()
    assert "RuntimeDirectoryMode=0750" in unit.splitlines()


def canonical_attestation(commit: str = "a" * 40, digest: str = "b" * 64) -> bytes:
    value = {
        "archive": f"kb-platform-{commit}.tar.gz",
        "schema": "kb.release-attestation/v1",
        "sha256": digest,
        "sourceCommit": commit,
        "workflow": "kb-platform-release",
    }
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_release_archive(path: Path, commit: str = "a" * 40) -> None:
    payload = b"console.log('ok')\n"
    manifest = hashlib.sha256(payload).hexdigest() + "  dashboard/server/index.ts\n"
    with tarfile.open(path, "w:gz") as archive:
        for name, data in (("VERSION", commit.encode("ascii") + b"\n"), ("MANIFEST.sha256", manifest.encode("ascii")), ("dashboard/server/index.ts", payload)):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))


def canonical_attestation_pair(tmp_path: Path, schema_version: int) -> tuple[Path, Path]:
    archive = tmp_path / f"kb-platform-{TEST_RELEASE_COMMIT}.tar.gz"
    write_release_archive(archive, TEST_RELEASE_COMMIT)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    attestation = tmp_path / "attestation.json"
    if schema_version == 1:
        attestation.write_bytes(canonical_attestation(TEST_RELEASE_COMMIT, digest))
    elif schema_version == 2:
        value = {
            "archive": archive.name,
            "schema": RELEASE_ATTESTATION_SCHEMA,
            "sha256": digest,
            "sourceCommit": TEST_RELEASE_COMMIT,
            "stateSchema": STATE_SCHEMA,
            "rollbackStateSchema": ROLLBACK_STATE_SCHEMA,
            "stateMigration": STATE_MIGRATION,
            "workflow": "kb-platform-release",
        }
        attestation.write_bytes(
            (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
        )
    else:
        raise ValueError("schema_version must be 1 or 2")
    return archive, attestation


def rewrite_attestation(path: Path, mutate) -> None:
    value = json.loads(path.read_bytes())
    mutate(value)
    path.write_bytes((json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode())


def installed_root_validator_files(tmp_path: Path) -> list[str]:
    key_payload = (
        len(b"ssh-ed25519").to_bytes(4, "big")
        + b"ssh-ed25519"
        + (32).to_bytes(4, "big")
        + b"\0" * 32
    )
    release_public_key = tmp_path / "release.pub"
    release_public_key.write_text(
        f"ssh-ed25519 {base64.b64encode(key_payload).decode('ascii')}\n",
        encoding="ascii",
    )
    commands = []

    def run(argv, **kwargs):
        commands.append(argv)
        return subprocess.CompletedProcess(argv, 0)

    bootstrap_vm.install_root_validators(
        release_public_key,
        "kb.command.ts.net",
        "daniel.zhang.t1@gmail.com",
        run=run,
    )
    return [
        Path(command[-1]).name
        for command in commands
        if command[:7] == ["install", "-o", "root", "-g", "root", "-m", "0555"]
    ]


def test_desktop_parser_accepts_exact_v1_and_v2(tmp_path):
    for schema_version in (1, 2):
        archive, attestation = canonical_attestation_pair(tmp_path, schema_version)
        assert deploy_platform_release.parse_local_attestation(
            attestation, archive
        )["sourceCommit"] == TEST_RELEASE_COMMIT


def test_local_probe_script_accepts_canonical_v2_from_resident_layout(tmp_path):
    _archive, attestation = canonical_attestation_pair(tmp_path, 2)
    deploy_root = Path(__file__).parents[1] / "deploy"
    resident = tmp_path / "usr/local/lib/kb"
    resident.mkdir(parents=True)
    for name in installed_root_validator_files(tmp_path):
        shutil.copy2(deploy_root / name, resident / name)
    (resident / "release_signing_public.py").write_text("RELEASE_PUBLIC_KEY = ''\n", encoding="ascii")
    probe = (
        "from pathlib import Path; "
        "from activate_release import parse_attestation; "
        f"assert parse_attestation(Path({str(attestation)!r}).read_bytes())['sourceCommit'] == {TEST_RELEASE_COMMIT!r}"
    )
    subprocess.run([sys.executable, "-B", "-c", probe], cwd=resident, check=True)


@pytest.mark.parametrize("missing", sorted(RELEASE_ATTESTATION_KEYS))
def test_desktop_parser_rejects_each_missing_v2_key(tmp_path, missing):
    archive, attestation = canonical_attestation_pair(tmp_path, 2)
    rewrite_attestation(attestation, lambda value: value.pop(missing))
    with pytest.raises(RuntimeError, match="closed canonical"):
        deploy_platform_release.parse_local_attestation(attestation, archive)


def test_desktop_parser_rejects_extra_or_noncanonical_v2(tmp_path):
    archive, attestation = canonical_attestation_pair(tmp_path, 2)
    rewrite_attestation(attestation, lambda value: value.update(extra="x"))
    with pytest.raises(RuntimeError, match="closed canonical"):
        deploy_platform_release.parse_local_attestation(attestation, archive)
    archive, attestation = canonical_attestation_pair(tmp_path, 2)
    attestation.write_text(json.dumps(json.loads(attestation.read_text()), indent=2))
    with pytest.raises(RuntimeError, match="closed canonical"):
        deploy_platform_release.parse_local_attestation(attestation, archive)


@pytest.mark.parametrize(("field", "value"), [
    ("stateSchema", "02"),
    ("rollbackStateSchema", "1.0"),
    ("stateMigration", "forward"),
])
def test_desktop_parser_rejects_structurally_invalid_v2_values(tmp_path, field, value):
    archive, attestation = canonical_attestation_pair(tmp_path, 2)
    rewrite_attestation(attestation, lambda body: body.__setitem__(field, value))
    with pytest.raises(RuntimeError, match=r"^attestation registry metadata mismatch$"):
        deploy_platform_release.parse_local_attestation(attestation, archive)


@pytest.mark.parametrize(("field", "value"), [
    ("stateSchema", "02"),
    ("rollbackStateSchema", "1.0"),
    ("stateMigration", "forward"),
])
def test_resident_parser_rejects_structurally_invalid_v2_values(tmp_path, field, value):
    _archive, attestation = canonical_attestation_pair(tmp_path, 2)
    rewrite_attestation(attestation, lambda body: body.__setitem__(field, value))
    with pytest.raises(RuntimeError, match=r"^attestation registry metadata mismatch$"):
        activate_release.parse_attestation(attestation.read_bytes())


@pytest.mark.parametrize(("field", "value"), [
    ("stateSchema", "4"),
    ("rollbackStateSchema", "1"),
    ("stateMigration", "compatible"),
])
def test_desktop_parser_rejects_structurally_valid_nonregistry_v2_values(tmp_path, field, value):
    archive, attestation = canonical_attestation_pair(tmp_path, 2)
    rewrite_attestation(attestation, lambda body: body.__setitem__(field, value))
    with pytest.raises(RuntimeError, match=r"^attestation registry metadata mismatch$"):
        deploy_platform_release.parse_local_attestation(attestation, archive)


def test_resident_parser_accepts_structurally_valid_future_v2_registry_values(tmp_path):
    _archive, attestation = canonical_attestation_pair(tmp_path, 2)
    rewrite_attestation(attestation, lambda value: value.update(
        stateSchema="3", rollbackStateSchema="2", stateMigration="compatible",
    ))
    parsed = activate_release.parse_attestation(attestation.read_bytes())
    assert (parsed["stateSchema"], parsed["rollbackStateSchema"], parsed["stateMigration"]) == (
        "3", "2", "compatible",
    )


def test_resident_parser_preserves_exact_v1_five_key_compatibility():
    parsed = activate_release.parse_attestation(canonical_attestation())
    assert set(parsed) == {"archive", "schema", "sha256", "sourceCommit", "workflow"}
    assert parsed["schema"] == "kb.release-attestation/v1"


def fake_io(events: list[str], *, signature_ok: bool):
    def secure_copy(_source, _destination):
        events.append("secure-copy")

    def verify_signature(_attestation, _signature):
        events.append("verify-signature")
        if not signature_ok:
            raise RuntimeError("release signature verification failed")

    return SimpleNamespace(secure_copy=secure_copy, verify_signature=verify_signature)


def test_quiescence_refusal_names_blockers():
    with pytest.raises(RuntimeError, match="workers-active"):
        activate_release.require_quiescence({"ok": True, "quiescent": False, "blockers": ["workers-active"]}, "release activation")


def test_archive_member_escape_is_rejected(tmp_path):
    archive_path = tmp_path / "malicious.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        info = tarfile.TarInfo("../escape")
        info.size = 1
        archive.addfile(info, io.BytesIO(b"x"))
    with tarfile.open(archive_path, "r:gz") as archive:
        with pytest.raises(ValueError, match="unsafe archive member"):
            list(activate_release.safe_members(archive))


@pytest.mark.parametrize("kind", ["absolute", "symlink", "hardlink", "fifo", "device"])
def test_unsafe_archive_member_types_are_rejected(tmp_path, kind):
    archive_path = tmp_path / f"{kind}.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        info = tarfile.TarInfo("/absolute" if kind == "absolute" else "unsafe")
        if kind == "symlink":
            info.type = tarfile.SYMTYPE
            info.linkname = "target"
        elif kind == "hardlink":
            info.type = tarfile.LNKTYPE
            info.linkname = "target"
        elif kind == "fifo":
            info.type = tarfile.FIFOTYPE
        elif kind == "device":
            info.type = tarfile.CHRTYPE
        archive.addfile(info)
    with tarfile.open(archive_path, "r:gz") as archive:
        with pytest.raises(ValueError, match="unsafe archive member"):
            list(activate_release.safe_members(archive))


def test_attestation_is_closed_and_binds_full_commit_filename():
    raw = b'{"archive":"kb-platform-' + b'a' * 40 + b'.tar.gz","schema":"kb.release-attestation/v1","sha256":"' + b'b' * 64 + b'","sourceCommit":"' + b'a' * 40 + b'","workflow":"kb-platform-release"}\n'
    assert activate_release.parse_attestation(raw)["sourceCommit"] == "a" * 40
    with pytest.raises(RuntimeError, match="closed canonical attestation"):
        activate_release.parse_attestation(raw[:-2] + b',"extra":true}\n')


def test_candidate_code_is_not_touched_before_root_validator_accepts(tmp_path):
    events = []
    with pytest.raises(RuntimeError, match="signature"):
        activate_release.copy_and_verify_upload(tmp_path, tmp_path / "stage", fake_io(events, signature_ok=False))
    assert events == ["secure-copy", "secure-copy", "secure-copy", "verify-signature"]


def test_activation_refuses_staging_not_owned_by_root_or_not_mode_0700():
    with pytest.raises(RuntimeError, match="root:root 0700"):
        require_root_staging(SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=stat.S_IFDIR | 0o700))
    with pytest.raises(RuntimeError, match="root:root 0700"):
        require_root_staging(SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFDIR | 0o755))


def test_extract_read_only_verifies_exact_manifest_and_modes(tmp_path):
    archive_path = tmp_path / "release.tar.gz"
    payload = b"console.log('ok')\n"
    manifest = hashlib.sha256(payload).hexdigest() + "  dashboard/server/index.ts\n"
    with tarfile.open(archive_path, "w:gz") as archive:
        for name, data in (("VERSION", b"a" * 40 + b"\n"), ("MANIFEST.sha256", manifest.encode()), ("dashboard/server/index.ts", payload)):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    destination = tmp_path / "releases" / ("a" * 40)
    activate_release.extract_read_only(archive_path, destination)
    assert stat.S_IMODE((destination / "dashboard/server/index.ts").stat().st_mode) == 0o444
    assert stat.S_IMODE((destination / "dashboard/server").stat().st_mode) == 0o555


def test_linux_refuses_to_degrade_when_o_nofollow_is_unavailable(monkeypatch):
    monkeypatch.delattr(activate_release.os, "O_NOFOLLOW", raising=False)
    with pytest.raises(RuntimeError, match="O_NOFOLLOW"):
        activate_release.nofollow_flag(platform="posix")
    assert activate_release.nofollow_flag(platform="nt") == 0


def test_extract_rejects_manifest_omissions(tmp_path):
    archive_path = tmp_path / "release.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        for name, data in (("VERSION", b"a" * 40 + b"\n"), ("MANIFEST.sha256", b""), ("unexpected", b"x")):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    with pytest.raises(RuntimeError, match="manifest"):
        activate_release.extract_read_only(archive_path, tmp_path / "destination")


def test_rollback_with_sidecars_repoints_current_only_when_quiescent(tmp_path, monkeypatch):
    releases = tmp_path / "releases"
    first = releases / ("a" * 40)
    second = releases / ("b" * 40)
    first.mkdir(parents=True)
    second.mkdir()
    for release, marker in ((first, b"first"), (second, b"second")):
        (release / "attestation.json").write_bytes(marker)
        (release / "attestation.json.sig").write_bytes(marker + b"-signature")
    paths = activate_release.RuntimePaths(
        releases=releases,
        current=second,
        previous=first,
        ops_root=tmp_path / "ops",
        staging=tmp_path / "staging",
    )
    calls = []
    monkeypatch.setattr(activate_release, "read_readiness", lambda: {"ok": True, "quiescent": True, "blockers": []})
    monkeypatch.setattr(activate_release, "atomic_link", lambda link, target: calls.append(["link", link, target]))
    monkeypatch.setattr(activate_release.subprocess, "run", lambda argv, **kwargs: calls.append(argv) or subprocess.CompletedProcess(argv, 0))
    monkeypatch.setattr(activate_release, "wait_healthy", lambda: calls.append(["healthy"]))
    assert activate_release.rollback(paths) == "a" * 40
    assert calls == [
        ["link", paths.previous, second.resolve()],
        ["link", paths.current, first.resolve()],
        ["systemctl", "restart", "kb-dashboard.service"],
        ["healthy"],
    ]
    assert (first / "attestation.json").read_bytes() == b"first"
    assert (first / "attestation.json.sig").read_bytes() == b"first-signature"
    assert (second / "attestation.json").read_bytes() == b"second"
    assert (second / "attestation.json.sig").read_bytes() == b"second-signature"


def test_rollback_refuses_when_previous_is_current(tmp_path, monkeypatch):
    release = tmp_path / "releases" / ("a" * 40)
    release.mkdir(parents=True)
    paths = activate_release.RuntimePaths(releases=release.parent, current=release, previous=release, staging=tmp_path / "staging")
    monkeypatch.setattr(activate_release, "read_readiness", lambda: {"ok": True, "quiescent": True, "blockers": []})
    with pytest.raises(RuntimeError, match="already selected"):
        activate_release.rollback(paths)


def test_release_lock_uses_exclusive_flock(tmp_path, monkeypatch):
    events = []
    fake_fcntl = SimpleNamespace(
        LOCK_EX=2,
        LOCK_UN=8,
        flock=lambda descriptor, operation: events.append((descriptor, operation)),
    )
    monkeypatch.setattr(activate_release, "_fcntl", fake_fcntl)
    descriptors = iter([40, 41])
    monkeypatch.setattr(
        activate_release.os,
        "open",
        lambda path, flags, mode=0o777: events.append((path, flags, mode)) or next(descriptors),
    )
    monkeypatch.setattr(activate_release.os, "close", lambda descriptor: events.append(("close", descriptor)))
    monkeypatch.setattr(activate_release, "nofollow_flag", lambda platform=None: 0)
    maintenance = tmp_path / "kb-maintenance.lock"
    with activate_release.release_lock(tmp_path, maintenance_lock=maintenance):
        events.append("inside")
    assert events == [
        (maintenance, os.O_RDWR | os.O_CREAT, 0o600),
        (40, fake_fcntl.LOCK_EX),
        (tmp_path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0), 0o777),
        (41, fake_fcntl.LOCK_EX),
        "inside",
        (41, fake_fcntl.LOCK_UN),
        ("close", 41),
        (40, fake_fcntl.LOCK_UN),
        ("close", 40),
    ]


def test_live_validation_failure_restores_previous_selection(tmp_path, monkeypatch):
    releases = tmp_path / "releases"
    old = releases / ("a" * 40)
    old.mkdir(parents=True)
    current = old
    staging = tmp_path / "staging"
    staging.mkdir()
    paths = activate_release.RuntimePaths(
        releases=releases,
        current=current,
        previous=releases / "previous",
        ops_root=tmp_path / "ops",
        staging=staging,
    )
    digest = hashlib.sha256(b"archive").hexdigest()
    links = []
    events = []

    def copy_upload(_upload_dir, stage, _io):
        (stage / "release.tar.gz").write_bytes(b"archive")
        (stage / "attestation.json").write_bytes(canonical_attestation(commit="b" * 40, digest=digest))
        (stage / "attestation.json.sig").write_bytes(b"verified-signature")

    def extract(_archive, destination):
        destination.mkdir()
        (destination / "VERSION").write_text("b" * 40 + "\n", encoding="ascii")

    def run(argv, **kwargs):
        events.append(argv)
        if "--phase" in argv and argv[argv.index("--phase") + 1] == "live":
            raise subprocess.CalledProcessError(1, argv)
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(activate_release.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(activate_release, "require_root_staging", lambda _value: None)
    monkeypatch.setattr(activate_release, "copy_and_verify_upload", copy_upload)
    monkeypatch.setattr(activate_release, "extract_read_only", extract)
    monkeypatch.setattr(activate_release, "read_readiness", lambda: {"ok": True, "quiescent": True, "blockers": []})
    monkeypatch.setattr(activate_release, "atomic_link", lambda link, target: links.append((link, target)))
    activation_io = SimpleNamespace(run=run, wait_healthy=lambda: events.append(["healthy"]))

    with pytest.raises(subprocess.CalledProcessError):
        activate_release.activate_from_upload(tmp_path / "upload", paths, activation_io)

    destination = releases / ("b" * 40)
    original = current.resolve()
    assert links == [(paths.previous, original), (paths.current, destination), (paths.current, original)]
    assert events[-2:] == [["systemctl", "restart", "kb-dashboard.service"], ["healthy"]]
    assert not destination.exists()


def test_first_activation_live_failure_unlinks_current_stops_service_and_cleans_candidate(tmp_path, monkeypatch):
    releases = tmp_path / "releases"
    releases.mkdir()
    staging = tmp_path / "staging"
    staging.mkdir()
    paths = activate_release.RuntimePaths(releases=releases, current=releases / "current", previous=releases / "previous", ops_root=tmp_path / "ops", staging=staging)
    digest = hashlib.sha256(b"archive").hexdigest()
    events = []

    def copy_upload(_upload_dir, stage, _io):
        (stage / "release.tar.gz").write_bytes(b"archive")
        (stage / "attestation.json").write_bytes(canonical_attestation(commit="b" * 40, digest=digest))
        (stage / "attestation.json.sig").write_bytes(b"verified-signature")

    def extract(_archive, destination):
        destination.mkdir()
        (destination / "VERSION").write_text("b" * 40 + "\n", encoding="ascii")

    def run(argv, **kwargs):
        events.append(argv)
        if argv[:3] == ["systemctl", "is-active", "--quiet"]:
            return subprocess.CompletedProcess(argv, 1)
        if "--phase" in argv and argv[argv.index("--phase") + 1] == "live":
            raise subprocess.CalledProcessError(1, argv)
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(activate_release.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(activate_release, "require_root_staging", lambda _value: None)
    monkeypatch.setattr(activate_release, "copy_and_verify_upload", copy_upload)
    monkeypatch.setattr(activate_release, "extract_read_only", extract)
    monkeypatch.setattr(activate_release, "atomic_link", lambda link, _target: link.touch())
    activation_io = SimpleNamespace(run=run, wait_healthy=lambda: events.append(["healthy"]))

    with pytest.raises(subprocess.CalledProcessError):
        activate_release.activate_from_upload(tmp_path / "upload", paths, activation_io)

    assert not paths.current.exists()
    assert not (releases / ("b" * 40)).exists()
    assert ["systemctl", "stop", "kb-dashboard.service"] in events


def test_static_failure_after_extraction_cleans_candidate(tmp_path, monkeypatch):
    releases = tmp_path / "releases"
    releases.mkdir()
    staging = tmp_path / "staging"
    staging.mkdir()
    paths = activate_release.RuntimePaths(releases=releases, current=releases / "current", previous=releases / "previous", ops_root=tmp_path / "ops", staging=staging)
    digest = hashlib.sha256(b"archive").hexdigest()

    def copy_upload(_upload_dir, stage, _io):
        (stage / "release.tar.gz").write_bytes(b"archive")
        (stage / "attestation.json").write_bytes(canonical_attestation(commit="b" * 40, digest=digest))
        (stage / "attestation.json.sig").write_bytes(b"verified-signature")

    def extract(_archive, destination):
        destination.mkdir()
        (destination / "VERSION").write_text("b" * 40 + "\n", encoding="ascii")

    def run(argv, **kwargs):
        if argv[:3] == ["systemctl", "is-active", "--quiet"]:
            return subprocess.CompletedProcess(argv, 1)
        if "--phase" in argv and argv[argv.index("--phase") + 1] == "static":
            raise subprocess.CalledProcessError(1, argv)
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(activate_release.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(activate_release, "require_root_staging", lambda _value: None)
    monkeypatch.setattr(activate_release, "copy_and_verify_upload", copy_upload)
    monkeypatch.setattr(activate_release, "extract_read_only", extract)
    with pytest.raises(subprocess.CalledProcessError):
        activate_release.activate_from_upload(tmp_path / "upload", paths, SimpleNamespace(run=run, wait_healthy=lambda: None))
    assert not (releases / ("b" * 40)).exists()


def test_activation_missing_verified_sidecar_rolls_back_without_partial_install(tmp_path, monkeypatch):
    releases = tmp_path / "releases"
    old = releases / ("a" * 40)
    old.mkdir(parents=True)
    staging = tmp_path / "staging"
    staging.mkdir()
    paths = activate_release.RuntimePaths(
        releases=releases,
        current=old,
        previous=releases / "previous",
        ops_root=tmp_path / "ops",
        staging=staging,
    )
    digest = hashlib.sha256(b"archive").hexdigest()

    def copy_upload(_upload_dir, stage, _io):
        (stage / "release.tar.gz").write_bytes(b"archive")
        (stage / "attestation.json").write_bytes(
            canonical_attestation(commit="b" * 40, digest=digest)
        )

    def extract(_archive, destination):
        destination.mkdir()
        (destination / "VERSION").write_text("b" * 40 + "\n", encoding="ascii")

    monkeypatch.setattr(activate_release.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(activate_release, "require_root_staging", lambda _value: None)
    monkeypatch.setattr(activate_release, "copy_and_verify_upload", copy_upload)
    monkeypatch.setattr(activate_release, "extract_read_only", extract)
    monkeypatch.setattr(
        activate_release,
        "read_readiness",
        lambda: {"ok": True, "quiescent": True, "blockers": []},
    )
    monkeypatch.setattr(activate_release, "atomic_link", lambda *_args: None)

    with pytest.raises(RuntimeError, match="verified attestation sidecars are required"):
        activate_release.activate_from_upload(
            tmp_path / "upload",
            paths,
            SimpleNamespace(
                run=lambda argv, **_kwargs: subprocess.CompletedProcess(argv, 0),
                wait_healthy=lambda: None,
            ),
        )

    assert paths.current.resolve() == old.resolve()
    assert not (releases / ("b" * 40)).exists()
    assert not paths.previous.exists()


def test_activation_with_sidecars_orders_signature_static_validation_and_real_link_selection(tmp_path, monkeypatch):
    releases = tmp_path / "releases"
    releases.mkdir()
    staging = tmp_path / "staging"
    staging.mkdir()
    upload = tmp_path / "upload"
    upload.mkdir()
    archive = upload / "release.tar.gz"
    commit = "c" * 40
    write_release_archive(archive, commit)
    (upload / "attestation.json").write_bytes(canonical_attestation(commit=commit, digest=hashlib.sha256(archive.read_bytes()).hexdigest()))
    (upload / "attestation.json.sig").write_bytes(b"signature")
    paths = activate_release.RuntimePaths(releases=releases, current=releases / "current", previous=releases / "previous", ops_root=tmp_path / "ops", staging=staging)
    events = []
    real_parse = activate_release.parse_attestation
    real_extract = activate_release.extract_read_only
    real_link = activate_release.atomic_link
    selected = {}
    run_calls = []

    def parse(raw):
        events.append("parse")
        return real_parse(raw)

    def extract(source, destination):
        events.append("extract")
        return real_extract(source, destination)

    def link(link_path, target):
        events.append("link")
        try:
            real_link(link_path, target)
        except OSError as error:
            if getattr(error, "winerror", None) != 1314:
                raise
            selected[link_path] = target

    def run(argv, **kwargs):
        run_calls.append((argv, kwargs))
        if argv[:3] == ["systemctl", "is-active", "--quiet"]:
            return subprocess.CompletedProcess(argv, 1)
        if "--phase" in argv:
            events.append(argv[argv.index("--phase") + 1])
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(activate_release.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(activate_release, "require_root_staging", lambda _value: None)
    monkeypatch.setattr(activate_release, "parse_attestation", parse)
    monkeypatch.setattr(activate_release, "extract_read_only", extract)
    monkeypatch.setattr(activate_release, "atomic_link", link)
    activation_io = SimpleNamespace(
        secure_copy=activate_release.secure_copy,
        verify_signature=lambda _attestation, _signature: events.append("signature"),
        run=run,
        wait_healthy=lambda: events.append("healthy"),
    )

    assert activate_release.activate_from_upload(upload, paths, activation_io) == commit
    installed = releases / commit
    assert (installed / "attestation.json").read_bytes() == (upload / "attestation.json").read_bytes()
    assert (installed / "attestation.json.sig").read_bytes() == (upload / "attestation.json.sig").read_bytes()
    assert stat.S_IMODE((installed / "attestation.json").stat().st_mode) == 0o444
    assert stat.S_IMODE((installed / "attestation.json.sig").stat().st_mode) == 0o444
    if paths.current.exists():
        assert paths.current.resolve() == (releases / commit).resolve()
    else:
        assert selected[paths.current] == releases / commit
    assert events.index("signature") < events.index("parse") < events.index("extract")
    assert events.index("static") < events.index("link") < events.index("live")
    assert all(call_kwargs.get("timeout", 0) > 0 for _argv, call_kwargs in run_calls)
    assert any(argv[:4] == ["python3", "-I", "-B", "/usr/local/lib/kb/validate_vm_runtime.py"] for argv, _kwargs in run_calls)


def test_activation_refuses_non_root_before_reading_upload(tmp_path, monkeypatch):
    monkeypatch.setattr(activate_release.os, "geteuid", lambda: 1000, raising=False)
    with pytest.raises(RuntimeError, match="requires root"):
        activate_release.activate_from_upload(tmp_path / "upload")


def test_activation_refuses_digest_mismatch(tmp_path, monkeypatch):
    releases = tmp_path / "releases"
    releases.mkdir()
    staging = tmp_path / "staging"
    staging.mkdir()
    paths = activate_release.RuntimePaths(releases=releases, current=releases / "current", previous=releases / "previous", staging=staging)

    def copy_upload(_upload_dir, stage, _io):
        (stage / "release.tar.gz").write_bytes(b"wrong")
        (stage / "attestation.json").write_bytes(canonical_attestation(digest="0" * 64))

    monkeypatch.setattr(activate_release.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(activate_release, "require_root_staging", lambda _value: None)
    monkeypatch.setattr(activate_release, "copy_and_verify_upload", copy_upload)
    with pytest.raises(RuntimeError, match="digest mismatch"):
        activate_release.activate_from_upload(tmp_path / "upload", paths, SimpleNamespace())


def test_activation_refuses_non_quiescent_readyz(tmp_path, monkeypatch):
    releases = tmp_path / "releases"
    releases.mkdir()
    current = releases / "current"
    current.mkdir()
    staging = tmp_path / "staging"
    staging.mkdir()
    paths = activate_release.RuntimePaths(releases=releases, current=current, previous=releases / "previous", staging=staging)
    digest = hashlib.sha256(b"archive").hexdigest()

    def copy_upload(_upload_dir, stage, _io):
        (stage / "release.tar.gz").write_bytes(b"archive")
        (stage / "attestation.json").write_bytes(canonical_attestation(digest=digest))

    monkeypatch.setattr(activate_release.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(activate_release, "require_root_staging", lambda _value: None)
    monkeypatch.setattr(activate_release, "copy_and_verify_upload", copy_upload)
    monkeypatch.setattr(activate_release, "read_readiness", lambda: {"ok": True, "quiescent": False, "blockers": ["workers-active"]})
    with pytest.raises(RuntimeError, match="workers-active"):
        activate_release.activate_from_upload(tmp_path / "upload", paths, SimpleNamespace())


def test_signature_allowed_signers_file_stays_inside_activation_stage(tmp_path, monkeypatch):
    stage = tmp_path / "stage"
    stage.mkdir(mode=0o700)
    attestation = stage / "attestation.json"
    attestation.write_bytes(b"{}\n")
    seen = []

    def run(argv, **kwargs):
        seen.append(Path(argv[argv.index("-f") + 1]))
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(activate_release, "RELEASE_PUBLIC_KEY", "ssh-ed25519 test")
    activate_release.verify_signature(attestation, stage / "attestation.json.sig", run=run)
    assert seen[0].parent == stage
    assert not seen[0].exists()


def test_desktop_deploy_signs_locally_and_copies_no_private_key(tmp_path):
    archive = tmp_path / f"kb-platform-{'a' * 40}.tar.gz"
    archive.write_bytes(b"archive")
    attestation = tmp_path / "attestation.json"
    attestation.write_bytes(canonical_attestation(digest=hashlib.sha256(b"archive").hexdigest()))
    signing_key = tmp_path / "desktop-signing-key"
    commands = []

    def run(argv, **kwargs):
        commands.append(argv)
        if argv[:4] == ["ssh-keygen", "-Y", "sign", "-f"]:
            attestation.with_suffix(".json.sig").write_bytes(b"signature")
        return subprocess.CompletedProcess(argv, 0)

    deploy_platform_release.deploy(archive, attestation, signing_key, "vm.example", run=run)
    assert commands[0] == ["ssh-keygen", "-Y", "sign", "-f", str(signing_key), "-n", "kb-release", str(attestation)]
    assert all(str(signing_key) not in command for command in commands[1:])
    assert not any("token" in argument.lower() for command in commands for argument in command)
    assert not any(command[:3] == ["ssh", "vm.example", "mv"] for command in commands)
    scp_commands = [command for command in commands if command[0] == "scp"]
    assert all(command[1] == "--" for command in scp_commands)
    assert [command[-1].rsplit("/", 1)[-1] for command in scp_commands] == ["release.tar.gz", "attestation.json", "attestation.json.sig"]
