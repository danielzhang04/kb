import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from deploy import bootstrap_vm
from scripts import backup_tier0


RP_ORIGIN = "https://dashboard.example"


@pytest.fixture(autouse=True)
def isolated_state_root(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    state_root.mkdir(exist_ok=True)
    monkeypatch.setattr(bootstrap_vm, "STATE_ROOT", str(state_root))
    return state_root


def generated_public_key(tmp_path: Path) -> str:
    private = tmp_path / "release-test-key"
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-C", "", "-N", "", "-f", str(private)], check=True)
    return subprocess.run(["ssh-keygen", "-y", "-f", str(private)], check=True, text=True, capture_output=True).stdout.strip()


def test_bootstrap_stops_old_service_before_clone_and_disables_remotes(tmp_path, monkeypatch):
    key_path = tmp_path / "release.pub"
    key_path.write_text(generated_public_key(tmp_path), encoding="ascii")
    commands = []

    def run(argv, **kwargs):
        commands.append(argv)
        return subprocess.CompletedProcess(argv, 0)

    def install_validators(path, run):
        assert run is fake_run
        commands.append(["validators", str(path)])

    fake_run = run
    monkeypatch.setattr(bootstrap_vm, "install_root_validators", install_validators)
    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", key_path, run=run)
    clone_index = next(i for i, command in enumerate(commands) if command[:2] == ["git", "clone"])
    assert commands[0] == ["systemctl", "disable", "--now", "kb-dashboard.service"]
    assert clone_index > 0
    assert ["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "origin", "disabled://desktop-promotion-only"] in commands
    assert ["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "--push", "origin", "disabled://desktop-promotion-only"] in commands
    assert ["git", "-C", "/var/lib/kb/ops", "update-ref", "refs/kb-outbox/spooled", "HEAD"] in commands
    assert ["install", "-d", "-o", "root", "-g", "root", "-m", "0700", "/var/lib/kb-release-staging"] in commands
    assert ["install", "-d", "-o", "root", "-g", "root", "-m", "0755", "/opt/kb-releases"] in commands
    assert not any(command[:6] == ["install", "-d", "-o", "kb-dashboard", "-g", "kb-dashboard"] and command[-1] == "/opt/kb-releases" for command in commands)


def test_bootstrap_clones_before_transferring_ops_ownership(tmp_path, monkeypatch):
    key_path = tmp_path / "release.pub"
    key_path.write_text(generated_public_key(tmp_path), encoding="ascii")
    commands = []

    def run(argv, **kwargs):
        commands.append(argv)
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(bootstrap_vm, "install_root_validators", lambda *args, **kwargs: None)
    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", key_path, run=run)

    root_ops = ["install", "-d", "-o", "root", "-g", "root", "-m", "0755", "/var/lib/kb/ops"]
    clone_index = commands.index(["git", "clone", "--branch", "ops", "--no-checkout", str(tmp_path / "ops.bundle"), "/var/lib/kb/ops"])
    assert commands.index(root_ops) < clone_index
    assert clone_index < commands.index(["git", "-C", "/var/lib/kb/ops", "sparse-checkout", "set", "--no-cone", *bootstrap_vm.DATA_PATTERNS])
    assert commands.index(["git", "-C", "/var/lib/kb/ops", "update-ref", "refs/kb-outbox/spooled", "HEAD"]) < commands.index(["chown", "-R", "kb-dashboard:kb-dashboard", "/var/lib/kb/ops", bootstrap_vm.STATE_ROOT])


def test_bootstrap_seeds_the_empty_control_plane_document(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    state_root.mkdir(exist_ok=True)
    commands = []
    modes = []
    real_chmod = bootstrap_vm.os.chmod

    def chmod(path, mode):
        modes.append((Path(path), mode))
        real_chmod(path, mode)

    monkeypatch.setattr(bootstrap_vm, "STATE_ROOT", str(state_root))
    monkeypatch.setattr(bootstrap_vm.os, "chmod", chmod)
    monkeypatch.setattr(bootstrap_vm, "install_root_validators", lambda *args, **kwargs: None)
    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "release.pub", run=lambda argv, **kwargs: commands.append(argv))

    assert (state_root / "control/control-plane.json").read_bytes() == b'{"version":1,"nextEventCursor":1,"proposals":[],"runs":[],"stages":[],"attempts":[],"sessions":[],"humanRequests":[],"events":[],"stageGenerations":[],"reviewLoops":[],"reviewReceipts":[],"generationSupersessions":[],"quarantine":[]}\n'
    assert ["install", "-d", "-o", "kb-dashboard", "-g", "kb-dashboard", "-m", "0700", f"{state_root}/control"] in commands
    assert ["chown", "kb-dashboard:kb-dashboard", str(state_root / "control/control-plane.json")] in commands
    assert (state_root / "control", 0o700) in modes
    assert (state_root / "control/control-plane.json", 0o600) in modes


def test_bootstrap_does_not_clobber_an_existing_control_plane_document(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    state_root.mkdir(exist_ok=True)

    monkeypatch.setattr(bootstrap_vm, "STATE_ROOT", str(state_root))
    monkeypatch.setattr(bootstrap_vm, "install_root_validators", lambda *args, **kwargs: None)
    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "release.pub", run=lambda *args, **kwargs: None)
    control_plane = state_root / "control/control-plane.json"
    control_plane.write_bytes(b'{"live":"state"}\n')
    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "release.pub", run=lambda *args, **kwargs: None)

    assert control_plane.read_bytes() == b'{"live":"state"}\n'


def test_bootstrap_seed_passes_the_tier_zero_state_validator(tmp_path, monkeypatch):
    target = tmp_path / "restore"
    state_root = target / "var/lib/kb/state"
    state_root.mkdir(parents=True)

    monkeypatch.setattr(bootstrap_vm, "STATE_ROOT", str(state_root))
    monkeypatch.setattr(bootstrap_vm, "install_root_validators", lambda *args, **kwargs: None)
    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "release.pub", run=lambda *args, **kwargs: None)

    assert backup_tier0.validate_state_json(target) is True


def test_bootstrap_recovers_from_an_interrupted_control_plane_seed(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    control = state_root / "control"
    control.mkdir(parents=True)
    (control / ".control-plane.json.interrupted.tmp").touch()

    monkeypatch.setattr(bootstrap_vm, "STATE_ROOT", str(state_root))
    monkeypatch.setattr(bootstrap_vm, "install_root_validators", lambda *args, **kwargs: None)
    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "release.pub", run=lambda *args, **kwargs: None)

    assert (control / "control-plane.json").read_bytes() == bootstrap_vm.EMPTY_CONTROL_PLANE
    assert list(control.glob(".control-plane.json.*.tmp")) == []


def test_control_plane_seed_removes_a_hardlinked_temp_left_after_linking(tmp_path):
    control = tmp_path / "state/control"
    control.mkdir(parents=True)
    final = control / "control-plane.json"
    temporary = control / ".control-plane.json.after-link.tmp"
    final.write_bytes(bootstrap_vm.EMPTY_CONTROL_PLANE)
    os.link(final, temporary)

    bootstrap_vm.seed_control_plane(tmp_path / "state")

    assert stat.S_ISREG(final.stat().st_mode)
    assert final.stat().st_nlink == 1
    assert list(control.glob(".control-plane.json.*.tmp")) == []


def test_control_plane_seed_fsyncs_a_complete_sibling_temp_before_linking(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    state_root.mkdir(exist_ok=True)
    observed = []
    synced_sizes = []
    real_link = bootstrap_vm.os.link
    real_fsync = bootstrap_vm.os.fsync

    def fsync(descriptor):
        synced_sizes.append(os.fstat(descriptor).st_size)
        real_fsync(descriptor)

    def link(temporary, final):
        temporary = Path(temporary)
        final = Path(final)
        assert temporary.parent == final.parent
        assert not final.exists()
        assert temporary.read_bytes() == bootstrap_vm.EMPTY_CONTROL_PLANE
        assert len(bootstrap_vm.EMPTY_CONTROL_PLANE) in synced_sizes
        observed.append((temporary, final))
        real_link(temporary, final)

    monkeypatch.setattr(bootstrap_vm.os, "fsync", fsync)
    monkeypatch.setattr(bootstrap_vm.os, "link", link)
    bootstrap_vm.seed_control_plane(state_root)

    assert observed
    assert (state_root / "control/control-plane.json").read_bytes() == bootstrap_vm.EMPTY_CONTROL_PLANE


def test_bootstrap_refuses_an_empty_existing_control_plane_document(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    control = state_root / "control"
    control.mkdir(parents=True)
    (control / "control-plane.json").touch()

    monkeypatch.setattr(bootstrap_vm, "STATE_ROOT", str(state_root))
    with pytest.raises(RuntimeError, match="control-plane state is corrupt"):
        bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "release.pub", run=lambda *args, **kwargs: None)


def test_bootstrap_refuses_a_truncated_existing_control_plane_document(tmp_path, monkeypatch):
    state_root = tmp_path / "state"
    control = state_root / "control"
    control.mkdir(parents=True)
    (control / "control-plane.json").write_bytes(b'{"version":1')

    monkeypatch.setattr(bootstrap_vm, "STATE_ROOT", str(state_root))
    with pytest.raises(RuntimeError, match="control-plane state is corrupt"):
        bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "release.pub", run=lambda *args, **kwargs: None)


def empty_control_plane_from_store_source(source: str) -> bytes:
    match = re.search(
        r"function\s+emptyDocument\s*\([^)]*\)\s*:\s*StoreDocument\s*\{\s*return\s*(\{(?P<entries>.*?)\})\s*;",
        source,
        re.DOTALL,
    )
    assert match is not None, "could not find emptyDocument's returned object literal"

    entries = re.sub(r"//[^\r\n]*|/\*[\s\S]*?\*/", "", match.group("entries"))
    entry_pattern = re.compile(r"\s*(?P<key>[A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?P<value>\d+|\[\])\s*,?")
    document = {}
    position = 0
    while position < len(entries):
        if not entries[position:].strip():
            break
        entry = entry_pattern.match(entries, position)
        assert entry is not None, "emptyDocument contains an unsupported object-literal entry"
        document[entry.group("key")] = [] if entry.group("value") == "[]" else int(entry.group("value"))
        position = entry.end()

    return json.dumps(document, separators=(",", ":")).encode("utf-8") + b"\n"


def replace_empty_document_entries(source: str, replacement) -> str:
    match = re.search(
        r"function\s+emptyDocument\s*\([^)]*\)\s*:\s*StoreDocument\s*\{\s*return\s*(\{(?P<entries>.*?)\})\s*;",
        source,
        re.DOTALL,
    )
    assert match is not None
    return source[:match.start("entries")] + replacement(match.group("entries")) + source[match.end("entries"):]


def test_bootstrap_empty_control_plane_matches_daemon_empty_document():
    source = (Path(bootstrap_vm.__file__).parent.parent / "dashboard/server/control/store.ts").read_text(encoding="utf-8")

    assert empty_control_plane_from_store_source(source) == bootstrap_vm.EMPTY_CONTROL_PLANE


def test_empty_control_plane_parser_tolerates_comments_and_detects_drift():
    source = (Path(bootstrap_vm.__file__).parent.parent / "dashboard/server/control/store.ts").read_text(encoding="utf-8")

    assert empty_control_plane_from_store_source(replace_empty_document_entries(
        source,
        lambda entries: entries.replace("\n    version: 1,", "\n    // schema version\n    version: 1, /* cursor follows */"),
    )) == bootstrap_vm.EMPTY_CONTROL_PLANE

    mutations = (
        lambda entries: entries + "    added: [],\n",
        lambda entries: entries.replace("\n    quarantine: [],", ""),
        lambda entries: entries.replace("version: 1,\n    nextEventCursor: 1", "nextEventCursor: 1,\n    version: 1"),
        lambda entries: entries.replace("version: 1", "version: 2"),
    )
    for mutate in mutations:
        assert empty_control_plane_from_store_source(replace_empty_document_entries(source, mutate)) != bootstrap_vm.EMPTY_CONTROL_PLANE


def test_bootstrap_fails_if_the_installed_state_root_is_missing(tmp_path, monkeypatch):
    state_root = tmp_path / "missing-state"
    monkeypatch.setattr(bootstrap_vm, "STATE_ROOT", str(state_root))

    with pytest.raises(RuntimeError, match="state root was not created"):
        bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "release.pub", run=lambda *args, **kwargs: None)


def test_data_patterns_are_closed_to_data_only_paths():
    assert "/dashboard/" not in bootstrap_vm.DATA_PATTERNS
    assert "/scripts/" not in bootstrap_vm.DATA_PATTERNS
    assert "/schemas/" not in bootstrap_vm.DATA_PATTERNS
    assert "/deploy/" not in bootstrap_vm.DATA_PATTERNS
    assert "/.github/" not in bootstrap_vm.DATA_PATTERNS
    assert "/orgs/" in bootstrap_vm.DATA_PATTERNS


def test_bootstrap_and_unit_do_not_use_session_secret_files():
    source = Path(bootstrap_vm.__file__).read_text(encoding="utf-8")
    unit = (Path(bootstrap_vm.__file__).parent / "systemd/kb-dashboard.service").read_text(encoding="utf-8")
    assert "session.env" not in source
    assert "session.env" not in unit
    assert "EnvironmentFile=" not in unit
    assert "Environment=DASHBOARD_SESSION_SECRET=" not in unit
    assert "validate_vm_runtime.py --phase static" in unit
    assert "ExecStartPre=/usr/bin/python3 -I" in unit


def test_public_key_module_contains_exact_public_key_and_no_private_key(tmp_path):
    public_key = generated_public_key(tmp_path)
    source = bootstrap_vm.public_key_module_source(public_key)
    assert source == f"RELEASE_PUBLIC_KEY = {public_key!r}\n"
    assert "PRIVATE KEY" not in source


def test_public_key_module_accepts_and_discards_standard_trailing_comment(tmp_path):
    public_key = generated_public_key(tmp_path)
    source = bootstrap_vm.public_key_module_source(public_key + " workstation key\n")
    assert source == f"RELEASE_PUBLIC_KEY = {public_key!r}\n"


def test_public_key_module_rejects_options_multiline_and_private_key(tmp_path):
    public_key = generated_public_key(tmp_path)
    for value in (
        f'command="echo unsafe" {public_key}',
        public_key + "\nsecond line",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
    ):
        with pytest.raises(ValueError, match="public key"):
            bootstrap_vm.public_key_module_source(value)


@pytest.mark.parametrize(
    "value",
    [
        "ssh-rsa AAAA",
        "ssh-ed25519  AAAA",
        "ssh-ed25519 AAAA",
        "command=\"echo unsafe\" ssh-ed25519 AAAA",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "ssh-ed25519 AAAA\n",
        "ssh-ed25519 AAAA comment\nsecond line",
    ],
)
def test_public_key_validation_rejects_wrong_type_extra_whitespace_and_private_markers(value):
    with pytest.raises(ValueError, match="public key"):
        bootstrap_vm.public_key_module_source(value)


def test_install_root_validators_uses_root_owned_immutable_modes(tmp_path, monkeypatch):
    key_path = tmp_path / "release.pub"
    key_path.write_text(generated_public_key(tmp_path), encoding="ascii")
    commands = []

    def run(argv, **kwargs):
        commands.append(argv)
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(bootstrap_vm.tempfile, "mkstemp", lambda prefix: (os.open(tmp_path / "generated.py", os.O_CREAT | os.O_RDWR), str(tmp_path / "generated.py")))
    bootstrap_vm.install_root_validators(key_path, run=run)
    assert ["install", "-d", "-o", "root", "-g", "root", "-m", "0755", "/usr/local/lib/kb"] in commands
    for helper in ("activate_release.py", "apply_ops_reconciliation.py", "export_tier0.py"):
        assert any(
            command[:7] == ["install", "-o", "root", "-g", "root", "-m", "0555"]
            and command[-1] == f"/usr/local/lib/kb/{helper}"
            for command in commands
        )
    assert any(command[:7] == ["install", "-o", "root", "-g", "root", "-m", "0444"] and command[-1] == "/usr/local/lib/kb/release_signing_public.py" for command in commands)
    assert any(command[-1] == "/etc/systemd/system/kb-dashboard.service" for command in commands)


def test_bootstrap_optional_rp_origin_installs_one_extra_root_owned_immutable_environment_line(tmp_path):
    key_path = tmp_path / "release.pub"
    key_path.write_text(generated_public_key(tmp_path), encoding="ascii")
    installed_unit = None

    def run(argv, **kwargs):
        nonlocal installed_unit
        if argv[-1] == "/etc/systemd/system/kb-dashboard.service":
            installed_unit = Path(argv[-2]).read_bytes()
            assert argv[:7] == ["install", "-o", "root", "-g", "root", "-m", "0444"]
        return subprocess.CompletedProcess(argv, 0)

    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", key_path, rp_origin=RP_ORIGIN, run=run)

    source = (Path(bootstrap_vm.__file__).parent / "systemd/kb-dashboard.service").read_bytes()
    expected = source.replace(
        b"Environment=GIT_CONFIG_GLOBAL=/dev/null\n",
        b"Environment=GIT_CONFIG_GLOBAL=/dev/null\nEnvironment=DASHBOARD_RP_ORIGIN=https://dashboard.example\n",
    )
    assert installed_unit == expected


def test_bootstrap_without_rp_origin_installs_the_current_fragment_byte_for_byte(tmp_path):
    key_path = tmp_path / "release.pub"
    key_path.write_text(generated_public_key(tmp_path), encoding="ascii")
    installed_unit = None

    def run(argv, **kwargs):
        nonlocal installed_unit
        if argv[-1] == "/etc/systemd/system/kb-dashboard.service":
            installed_unit = Path(argv[-2]).read_bytes()
        return subprocess.CompletedProcess(argv, 0)

    bootstrap_vm.bootstrap(tmp_path / "ops.bundle", key_path, run=run)

    assert installed_unit == (Path(bootstrap_vm.__file__).parent / "systemd/kb-dashboard.service").read_bytes()


@pytest.mark.parametrize(
    "value",
    [
        "http://dashboard.example",
        "https://dashboard.example/",
        "https://user@dashboard.example",
        "https://Dashboard.example",
        "https://dashboard.example:8443",
    ],
)
def test_bootstrap_refuses_invalid_rp_origins_before_running_commands(tmp_path, value):
    commands = []

    def run(argv, **kwargs):
        commands.append(argv)
        return subprocess.CompletedProcess(argv, 0)

    with pytest.raises(ValueError, match="RP origin"):
        bootstrap_vm.bootstrap(tmp_path / "ops.bundle", tmp_path / "unread.pub", rp_origin=value, run=run)
    assert commands == []


def test_main_passes_optional_rp_origin_to_bootstrap(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(bootstrap_vm, "bootstrap", lambda ops_bundle, release_public_key, rp_origin=None: seen.append((ops_bundle, release_public_key, rp_origin)))
    monkeypatch.setattr(sys, "argv", ["bootstrap_vm.py", "--ops-bundle", "ops.bundle", "--release-public-key", "release.pub", "--rp-origin", RP_ORIGIN])

    assert bootstrap_vm.main() == 0
    assert seen == [(Path("ops.bundle"), Path("release.pub"), RP_ORIGIN)]
