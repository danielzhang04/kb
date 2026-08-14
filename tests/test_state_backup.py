import io
import hashlib
import json
import subprocess
import tarfile
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest

from deploy import export_tier0
from scripts import backup_tier0


COMMIT = "a" * 40


def _symlinks_available() -> bool:
    with tempfile.TemporaryDirectory(prefix="kb-symlink-probe-") as directory:
        root = Path(directory)
        target = root / "target"
        target.mkdir()
        try:
            (root / "link").symlink_to(target, target_is_directory=True)
        except OSError:
            return False
        return (root / "link").is_symlink()


requires_symlink = pytest.mark.skipif(
    not _symlinks_available(),
    reason="host cannot create the directory symlinks required by the restore fixture",
)


def canonical(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


class _AnyOutputRoot:
    def __eq__(self, _other):
        return True


def fake_export_io(calls: list[str], cgroup_children: int = 0, fail_on: set[str] | None = None):
    fail_on = fail_on or set()

    class FakeExportIo:
        def is_root(self):
            return True

        def output_root(self):
            return _AnyOutputRoot()

        @contextmanager
        def exclusive_lock(self, _path):
            calls.append("lock")
            yield

        def run(self, argv):
            if argv[:2] == ["systemctl", "stop"]:
                action = "systemctl:stop"
            elif argv[:2] == ["systemctl", "start"]:
                action = "systemctl:start"
            elif argv[0] == "tar":
                action = "tar"
            else:
                action = "run"
            calls.append(action)
            if action in fail_on:
                raise RuntimeError(f"{action} failed")

        def service_cgroup_children(self, _unit):
            calls.append("cgroup:empty")
            return cgroup_children

        def fsync_file_and_parent(self, _path):
            calls.append("fsync")

        def wait_readiness(self):
            calls.append("ready:locked")
            if "ready:locked" in fail_on:
                raise RuntimeError("ready:locked failed")
            return {"ok": True, "quiescent": True, "blockers": []}

    return FakeExportIo()


def fake_desktop_runner(calls: list[list[str]]):
    def run(argv, **_kwargs):
        calls.append(argv)
        if argv[0] == "scp":
            Path(argv[-1]).write_bytes(b"tier-zero")
        if argv[:2] == ["restic", "snapshots"]:
            payload = [{"short_id": "snapshot-1", "time": datetime.now(timezone.utc).isoformat()}]
            return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(payload), stderr="")
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    return run


def valid_restored_tree(tmp_path: Path) -> Path:
    target = tmp_path / "restore"
    release = target / "opt/kb-releases" / COMMIT
    dashboard = release / "dashboard/server"
    dashboard.mkdir(parents=True)
    index = dashboard / "index.ts"; index.write_text("export {};\n", encoding="utf-8")
    (release / "VERSION").write_text(COMMIT + "\n", encoding="ascii")
    (release / "MANIFEST.sha256").write_text(
        f"{hashlib.sha256(index.read_bytes()).hexdigest()}  dashboard/server/index.ts\n", encoding="ascii",
    )
    releases = release.parent
    (releases / "current").symlink_to(COMMIT, target_is_directory=True)
    (releases / "previous").symlink_to(COMMIT, target_is_directory=True)
    ops = target / "var/lib/kb/ops"; ops.mkdir(parents=True)
    state = target / "var/lib/kb/state"
    control = state / "control"; control.mkdir(parents=True)
    control_plane = {
        "version": 1, "nextEventCursor": 1, "proposals": [],
        "runs": [{"runRef": "run-1"}],
        "stages": [{"stageRef": "stage-1", "runRef": "run-1"}],
        "attempts": [{"attemptRef": "attempt-1", "stageRef": "stage-1", "runRef": "run-1"}],
        "sessions": [], "humanRequests": [], "events": [], "quarantine": [],
    }
    (control / "control-plane.json").write_text(json.dumps(control_plane), encoding="utf-8")
    ready = state / "outbox/ready"; receipts = state / "outbox/receipts"
    ready.mkdir(parents=True); receipts.mkdir()
    bundle = ready / f"{COMMIT}.bundle"; bundle.write_bytes(b"bundle")
    manifest = {
        "schema": "kb.ops-outbox/v1", "id": COMMIT, "parent": "b" * 40, "commit": COMMIT,
        "paths": ["queue/inbox/card.md"], "createdAt": "2026-08-11T00:00:00.000Z",
        "bundleSha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
    }
    (ready / f"{COMMIT}.json").write_bytes(canonical(manifest))
    receipt = {
        "schema": "kb.ops-promotion/v1", "id": COMMIT, "sourceCommit": COMMIT,
        "promotedCommit": "c" * 40, "promotedAt": "2026-08-11T00:00:01.000Z",
    }
    (receipts / f"{COMMIT}.json").write_bytes(canonical(receipt))
    return target


def fake_restore_runner(ops: Path, fsck: bool = True, readiness: dict | None = None):
    readiness = readiness or {"ok": True, "quiescent": True, "blockers": []}
    def run(argv, **_kwargs):
        if "fsck" in argv:
            return subprocess.CompletedProcess(argv, 0 if fsck else 1, stdout="", stderr="")
        if "symbolic-ref" in argv:
            return subprocess.CompletedProcess(argv, 0, stdout="refs/heads/ops\n", stderr="")
        if "rev-parse" in argv and "--git-path" in argv:
            return subprocess.CompletedProcess(argv, 0, stdout=str(ops / ".git" / argv[-1]) + "\n", stderr="")
        if "rev-parse" in argv:
            return subprocess.CompletedProcess(argv, 0, stdout=COMMIT + "\n", stderr="")
        if argv[0] == "curl":
            return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(readiness), stderr="")
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")
    return run


def test_export_stops_all_writers_before_tar_and_restarts_locked(tmp_path):
    calls = []
    export_tier0.export(tmp_path / "tier0.tar", io=fake_export_io(calls))
    assert calls == ["lock", "systemctl:stop", "cgroup:empty", "tar", "fsync", "systemctl:start", "ready:locked"]


def test_export_refuses_to_archive_when_the_stopped_service_cgroup_is_not_empty(tmp_path):
    with pytest.raises(RuntimeError, match="cgroup is not empty"):
        export_tier0.export(tmp_path / "tier0.tar", io=fake_export_io([], cgroup_children=1))


def test_export_restarts_even_when_stopping_the_service_raises(tmp_path):
    calls = []
    with pytest.raises(RuntimeError, match="systemctl:stop failed"):
        export_tier0.export(
            tmp_path / "tier0.tar",
            io=fake_export_io(calls, fail_on={"systemctl:stop"}),
        )
    assert calls == ["lock", "systemctl:stop", "systemctl:start", "ready:locked"]


def test_export_preserves_primary_failure_when_restart_readiness_also_fails(tmp_path):
    calls = []
    with pytest.raises(RuntimeError, match="tar failed"):
        export_tier0.export(
            tmp_path / "tier0.tar",
            io=fake_export_io(calls, fail_on={"tar", "ready:locked"}),
        )
    assert calls[-2:] == ["systemctl:start", "ready:locked"]


def test_backup_runs_restic_only_on_desktop_copy(tmp_path):
    calls = []
    backup_tier0.backup("kb-vm", tmp_path, run=fake_desktop_runner(calls))
    assert calls[0][4] == "/usr/local/lib/kb/export_tier0.py"
    assert calls[-2][:3] == ["restic", "backup", str(tmp_path / "kb-tier0.tar")]
    assert calls[-1][:2] == ["restic", "snapshots"]


def test_restore_drill_fails_when_rto_is_exceeded(tmp_path):
    ticks = iter([0.0, 3_601.0])
    with pytest.raises(RuntimeError, match="RTO"):
        backup_tier0.restore_drill(
            tmp_path / "restore",
            rto_minutes=60,
            run=lambda argv: subprocess.CompletedProcess(argv, 0, stdout="", stderr=""),
            monotonic=lambda: next(ticks),
            restore=lambda _target, _run: ("snapshot-1", tmp_path / "kb-tier0.tar", "b" * 64),
            extract=lambda _archive, _target: None,
            verify=lambda _target, run=None: {"gitFsck": True, "invariants": True, "booted": True},
        )


@requires_symlink
def test_restore_requires_fsck_invariants_and_isolated_boot(tmp_path):
    target = valid_restored_tree(tmp_path)
    result = backup_tier0.verify_restored_tree(target, run=fake_restore_runner(target / "var/lib/kb/ops", fsck=False))
    assert result == {"gitFsck": False, "invariants": True, "booted": True}
    assert backup_tier0.decide_restore(result) is False


def test_isolated_boot_sets_its_generated_service_unit_for_readiness(tmp_path, monkeypatch):
    release = tmp_path / "release"
    (release / "dashboard").mkdir(parents=True)
    monkeypatch.setattr(backup_tier0, "validate_release_links", lambda _target: True)
    monkeypatch.setattr(backup_tier0, "validate_ops_head", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(backup_tier0, "validate_state_json", lambda _target: True)
    monkeypatch.setattr(backup_tier0, "validate_outbox_manifests_receipts", lambda _target: True)
    monkeypatch.setattr(backup_tier0, "resolve_restored_release", lambda _target: release)
    monkeypatch.setattr(backup_tier0.secrets, "token_hex", lambda _size: "fixed")
    calls = []

    def run(argv, **_kwargs):
        calls.append(argv)
        if argv[0] == "curl":
            return subprocess.CompletedProcess(
                argv, 0, stdout=json.dumps({"ok": True, "quiescent": True, "blockers": []}), stderr="",
            )
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    result = backup_tier0.verify_restored_tree(tmp_path, run=run)
    systemd_run = next(argv for argv in calls if argv[0] == "systemd-run")
    assert result["booted"] is True
    assert "--setenv=DASHBOARD_SERVICE_UNIT=kb-restore-drill-fixed" in systemd_run


def test_release_validator_counts_nested_version_as_payload(tmp_path):
    release = tmp_path / COMMIT
    nested_version = release / "pkg/VERSION"
    nested_version.parent.mkdir(parents=True)
    nested_version.write_text("package-version\n", encoding="utf-8")
    snow = release / "pkg/snow \u2603/index.html"
    snow.parent.mkdir(parents=True)
    snow.write_text("snow\n", encoding="utf-8")
    (release / "VERSION").write_text(COMMIT + "\n", encoding="ascii")
    (release / "MANIFEST.sha256").write_text(
        f"{hashlib.sha256(nested_version.read_bytes()).hexdigest()}  pkg/VERSION\n"
        f"{hashlib.sha256(snow.read_bytes()).hexdigest()}  pkg/snow \u2603/index.html\n",
        encoding="utf-8",
    )
    backup_tier0._validate_release_directory(release)


@requires_symlink
def test_consistent_restored_tree_passes_every_restore_validator(tmp_path):
    target = valid_restored_tree(tmp_path)
    run = fake_restore_runner(target / "var/lib/kb/ops")
    assert backup_tier0.validate_release_links(target) is True
    assert backup_tier0.validate_ops_head(target / "var/lib/kb/ops", run=run) is True
    assert backup_tier0.validate_state_json(target) is True
    assert backup_tier0.validate_outbox_manifests_receipts(target) is True
    assert backup_tier0.resolve_restored_release(target) == target / "opt/kb-releases" / COMMIT
    assert backup_tier0.wait_for_locked_readiness("http://restore/readyz", run=run, timeout_seconds=0) is True


@requires_symlink
def test_release_link_validator_rejects_a_dangling_symlink(tmp_path):
    target = valid_restored_tree(tmp_path)
    current = target / "opt/kb-releases/current"; current.unlink(); current.symlink_to("missing", target_is_directory=True)
    assert backup_tier0.validate_release_links(target) is False


@requires_symlink
def test_ops_head_validator_rejects_a_missing_ops_ref_object(tmp_path):
    target = valid_restored_tree(tmp_path)
    def missing_ref(argv, **_kwargs):
        if "rev-parse" in argv and argv[-1] == "refs/heads/ops^{commit}":
            return subprocess.CompletedProcess(argv, 1, stdout="", stderr="missing")
        return fake_restore_runner(target / "var/lib/kb/ops")(argv)
    assert backup_tier0.validate_ops_head(target / "var/lib/kb/ops", run=missing_ref) is False


@requires_symlink
def test_state_validator_rejects_a_stage_that_references_an_absent_run(tmp_path):
    target = valid_restored_tree(tmp_path)
    path = target / "var/lib/kb/state/control/control-plane.json"
    value = json.loads(path.read_text(encoding="utf-8")); value["runs"] = []
    path.write_text(json.dumps(value), encoding="utf-8")
    assert backup_tier0.validate_state_json(target) is False


@requires_symlink
def test_outbox_validator_rejects_an_orphaned_receipt(tmp_path):
    target = valid_restored_tree(tmp_path)
    orphan = {"schema": "kb.ops-promotion/v1", "id": "d" * 40, "sourceCommit": "d" * 40, "promotedCommit": "e" * 40, "promotedAt": "2026-08-11T00:00:01.000Z"}
    (target / "var/lib/kb/state/outbox/receipts" / f"{'d' * 40}.json").write_bytes(canonical(orphan))
    assert backup_tier0.validate_outbox_manifests_receipts(target) is False


def test_outbox_validator_ignores_the_retired_promoted_archive(tmp_path):
    target = tmp_path / "restore"
    outbox = target / "var/lib/kb/state/outbox"
    (outbox / "ready").mkdir(parents=True)
    (outbox / "receipts").mkdir()
    (outbox / "promoted").mkdir()
    (outbox / "promoted" / f"{COMMIT}.json").write_bytes(b"retired manifest\n")
    (outbox / "promoted" / f"{COMMIT}.bundle").write_bytes(b"retired bundle")
    (outbox / "promoted" / f"{COMMIT}.receipt.json").write_bytes(b"retired receipt\n")
    assert backup_tier0.validate_outbox_manifests_receipts(target) is True


@requires_symlink
def test_restored_release_resolver_rejects_a_dangling_current_symlink(tmp_path):
    target = valid_restored_tree(tmp_path)
    current = target / "opt/kb-releases/current"; current.unlink(); current.symlink_to("missing", target_is_directory=True)
    with pytest.raises(RuntimeError, match="current"):
        backup_tier0.resolve_restored_release(target)


@requires_symlink
def test_locked_readiness_validator_rejects_an_unlocked_instance(tmp_path):
    target = valid_restored_tree(tmp_path)
    run = fake_restore_runner(target / "var/lib/kb/ops", readiness={"ok": True, "quiescent": False, "blockers": ["execution-unlocked"]})
    assert backup_tier0.wait_for_locked_readiness("http://restore/readyz", run=run, timeout_seconds=0) is False


def write_tar(archive_path: Path, members: list[tarfile.TarInfo]) -> None:
    with tarfile.open(archive_path, "w:") as archive:
        for member in members:
            archive.addfile(member)


def tar_member(name: str, member_type: bytes, linkname: str = "") -> tarfile.TarInfo:
    member = tarfile.TarInfo(name)
    member.type = member_type
    member.linkname = linkname
    return member


@pytest.mark.parametrize(
    "member",
    [
        tar_member("/outside", tarfile.REGTYPE),
        tar_member("var/../outside", tarfile.REGTYPE),
        tar_member("root/link", tarfile.SYMTYPE, "../../outside"),
        tar_member("root/hardlink", tarfile.LNKTYPE, "root/file"),
        tar_member("root/device", tarfile.CHRTYPE),
        tar_member("root/pipe", tarfile.FIFOTYPE),
        tar_member("root/unknown", b"?"),
    ],
    ids=["absolute", "traversal", "escaping-symlink", "hardlink", "device", "fifo", "unsupported"],
)
def test_safe_extract_rejects_unsafe_member(tmp_path: Path, member: tarfile.TarInfo):
    archive = tmp_path / "unsafe.tar"
    write_tar(archive, [member])

    with pytest.raises(RuntimeError, match="unsafe|unsupported|escapes"):
        backup_tier0.safe_extract(archive, tmp_path / "restore")


def test_safe_extract_extracts_regular_files_and_directories_inside_target(tmp_path: Path):
    archive = tmp_path / "safe.tar"
    directory = tarfile.TarInfo("root")
    directory.type = tarfile.DIRTYPE
    payload = b"safe content"
    file_member = tarfile.TarInfo("root/file.txt")
    file_member.size = len(payload)
    with tarfile.open(archive, "w") as output:
        output.addfile(directory)
        output.addfile(file_member, io.BytesIO(payload))

    target = tmp_path / "restore"
    backup_tier0.safe_extract(archive, target)

    assert (target / "root").is_dir()
    assert (target / "root/file.txt").read_bytes() == payload
