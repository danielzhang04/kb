import os
import subprocess
from pathlib import Path

import pytest

from deploy import bootstrap_vm


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
    assert ["install", "-d", "-o", "root", "-g", "root", "-m", "0700", "/var/lib/kb-release-staging"] in commands
    assert ["install", "-d", "-o", "root", "-g", "root", "-m", "0755", "/opt/kb-releases"] in commands
    assert not any(command[:6] == ["install", "-d", "-o", "kb-dashboard", "-g", "kb-dashboard"] and command[-1] == "/opt/kb-releases" for command in commands)


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


@pytest.mark.parametrize(
    "value",
    [
        "ssh-rsa AAAA",
        "ssh-ed25519  AAAA",
        "ssh-ed25519 AAAA",
        "ssh-ed25519 AAAA comment",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "ssh-ed25519 AAAA\n",
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
    assert any(command[:7] == ["install", "-o", "root", "-g", "root", "-m", "0555"] and command[-1] == "/usr/local/lib/kb/activate_release.py" for command in commands)
    assert any(command[:7] == ["install", "-o", "root", "-g", "root", "-m", "0444"] and command[-1] == "/usr/local/lib/kb/release_signing_public.py" for command in commands)
    assert any(command[-1] == "/etc/systemd/system/kb-dashboard.service" for command in commands)
