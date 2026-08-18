import json
import shlex
import subprocess
from types import SimpleNamespace
from pathlib import Path, PurePosixPath

import pytest

from deploy import validate_vm_runtime


VALID_UNIT_TEXT = """[Service]
Environment=DASHBOARD_PLATFORM_ROOT=/opt/kb-releases/current
Environment=PYTHONPATH=/opt/kb-releases/current
Environment=DASHBOARD_REPO_ROOT=/var/lib/kb/ops
Environment=DASHBOARD_STATE_ROOT=/var/lib/kb/state
Environment=DASHBOARD_EXECUTION_ACTIVATED=0
Environment=KB_COORDINATION_PUBLICATION=outbox
Environment=KB_VM_RUNTIME=1
Environment=GIT_CONFIG_GLOBAL=/dev/null
"""
WEBAUTHN_CREDENTIALS = json.dumps([{"id": "a" * 16, "publicKey": "b" * 32, "counter": 0, "transports": ["usb", "internal"]}], separators=(",", ":"))


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
def test_effective_unit_rejects_invalid_rp_origins(value):
    text = VALID_UNIT_TEXT + f"Environment=DASHBOARD_RP_ORIGIN={value}\n"
    with pytest.raises(RuntimeError, match="RP origin"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def valid_static_unit():
    return {
        "Id": "kb-dashboard.service",
        "Names": "kb-dashboard.service",
        "Slice": "system.slice",
        "FragmentPath": "/etc/systemd/system/kb-dashboard.service",
        "DropInPaths": "",
        "User": "kb-dashboard",
        "Group": "kb-dashboard",
        "ExecStart": "{ path=/usr/bin/node ; argv[]=/usr/bin/node --experimental-strip-types server/index.ts ; }",
        "WorkingDirectory": "/opt/kb-releases/current/dashboard",
        "EnvironmentFiles": "",
        "UnsetEnvironment": "GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK DASHBOARD_SESSION_SECRET KB_CANARY_SESSION",
        "KillMode": "control-group",
        "ReadOnlyPaths": "/opt/kb-releases",
        "ReadWritePaths": "/var/lib/kb/state /var/lib/kb/ops",
    }


@pytest.mark.parametrize("name", ["GITHUB_TOKEN", "GH_TOKEN", "GIT_ASKPASS", "SSH_AUTH_SOCK", "DASHBOARD_SESSION_SECRET", "KB_CANARY_SESSION", "OPENAI_API_KEY", "AWS_ACCESS_KEY_ID", "MY_TOKEN"])
def test_vm_validation_rejects_credential_channels(name, tmp_path):
    with pytest.raises(RuntimeError, match=name):
        validate_vm_runtime.validate_environment({name: "present"})


def test_environment_refusal_does_not_print_values():
    with pytest.raises(RuntimeError) as refusal:
        validate_vm_runtime.validate_environment({"OPENAI_API_KEY": "must-not-leak"})
    assert "must-not-leak" not in str(refusal.value)


def test_ops_checkout_is_data_only(tmp_path):
    (tmp_path / "scripts").mkdir()
    with pytest.raises(RuntimeError, match="platform path"):
        validate_vm_runtime.validate_ops_root(tmp_path)


def test_ops_checkout_requires_disabled_push_remote(tmp_path, monkeypatch):
    calls = []

    def run(*args, **kwargs):
        calls.append((args[0], kwargs))
        return subprocess.CompletedProcess(args[0], 0, stdout="ssh://write-enabled\n")

    monkeypatch.setattr(validate_vm_runtime.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="push remote"):
        validate_vm_runtime.validate_ops_root(tmp_path)
    assert calls[0][0][:3] == ["git", "-c", "safe.directory=/var/lib/kb/ops"]
    assert calls[0][1]["timeout"] > 0


def test_ops_git_identity_is_present():
    calls = []
    root = PurePosixPath("/var/lib/kb/ops")

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        values = {"user.email": "kb-dashboard@agents.local\n", "user.name": "kb-dashboard\n"}
        return subprocess.CompletedProcess(argv, 0, stdout=values[argv[-1]])

    validate_vm_runtime.validate_ops_git_identity(root, run=run)

    assert calls == [
        (["git", "-C", "/var/lib/kb/ops", "config", "--get", "user.email"], {"check": True, "text": True, "capture_output": True, "timeout": validate_vm_runtime.COMMAND_TIMEOUT}),
        (["git", "-C", "/var/lib/kb/ops", "config", "--get", "user.name"], {"check": True, "text": True, "capture_output": True, "timeout": validate_vm_runtime.COMMAND_TIMEOUT}),
    ]


@pytest.mark.parametrize("key", ["user.email", "user.name"])
def test_ops_git_identity_rejects_empty_values(key):
    def run(argv, **kwargs):
        value = " \n" if argv[-1] == key else "kb-dashboard@agents.local\n"
        return subprocess.CompletedProcess(argv, 0, stdout=value)

    with pytest.raises(RuntimeError, match=key):
        validate_vm_runtime.validate_ops_git_identity(PurePosixPath("/var/lib/kb/ops"), run=run)


@pytest.mark.parametrize("key", ["user.email", "user.name"])
def test_ops_git_identity_rejects_missing_values(key):
    def run(argv, **kwargs):
        if argv[-1] == key:
            raise subprocess.CalledProcessError(1, argv)
        return subprocess.CompletedProcess(argv, 0, stdout="kb-dashboard@agents.local\n")

    with pytest.raises(RuntimeError, match=key):
        validate_vm_runtime.validate_ops_git_identity(PurePosixPath("/var/lib/kb/ops"), run=run)


def test_outbox_mode_requires_initialized_anchor(tmp_path):
    calls = []

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 1)

    with pytest.raises(RuntimeError, match="outbox anchor refs/kb-outbox/spooled is absent"):
        validate_vm_runtime.validate_outbox_anchor(tmp_path, run=run)
    assert calls == [(["git", "show-ref", "--verify", "--quiet", "refs/kb-outbox/spooled"], {"cwd": tmp_path})]


def test_releases_root_must_be_root_owned_0755():
    validate_vm_runtime.validate_releases_root(SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o40755))
    with pytest.raises(RuntimeError, match="root:root 0755"):
        validate_vm_runtime.validate_releases_root(SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=0o40755))


def test_effective_unit_rejects_dropins_and_wrong_kill_mode():
    show = valid_static_unit()
    show["DropInPaths"] = "/etc/systemd/system/kb-dashboard.service.d/override.conf"
    with pytest.raises(RuntimeError, match="drop-ins"):
        validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT)
    show = valid_static_unit(); show["KillMode"] = "process"
    with pytest.raises(RuntimeError, match="KillMode"):
        validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT)


def test_effective_unit_must_use_the_local_outbox():
    show = valid_static_unit()
    with pytest.raises(RuntimeError, match="outbox publication"):
        validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT.replace("KB_COORDINATION_PUBLICATION=outbox", "KB_COORDINATION_PUBLICATION=github"))


def test_effective_unit_rejects_environment_files():
    show = valid_static_unit()
    show["EnvironmentFiles"] = "/etc/kb-dashboard/session.env"
    with pytest.raises(RuntimeError, match="environment files"):
        validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT)


def test_effective_unit_parses_every_assignment_on_environment_line():
    text = VALID_UNIT_TEXT.replace(
        "Environment=GIT_CONFIG_GLOBAL=/dev/null",
        'Environment="GIT_CONFIG_GLOBAL=/dev/null" "OPENAI_API_KEY=must-not-leak"',
    )
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY") as refusal:
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)
    assert "must-not-leak" not in str(refusal.value)


def test_fake_systemctl_dropin_is_refused():
    def run(argv, **kwargs):
        if argv[1] == "show":
            name = argv[2].split("=", 1)[1]
            value = valid_static_unit()[name]
            if name == "DropInPaths":
                value = "/etc/systemd/system/kb-dashboard.service.d/malicious.conf"
            return subprocess.CompletedProcess(argv, 0, stdout=value + "\n")
        return subprocess.CompletedProcess(argv, 0, stdout=VALID_UNIT_TEXT + "\n# /etc/systemd/system/kb-dashboard.service.d/malicious.conf\nEnvironment=OPENAI_API_KEY=not-a-real-value\n")

    show, text = validate_vm_runtime.read_static_unit("kb-dashboard.service", run=run)
    with pytest.raises(RuntimeError, match="drop-ins"):
        validate_vm_runtime.validate_static_unit(show, text)


def test_static_phase_accepts_inactive_unit_without_a_control_group():
    show = valid_static_unit()
    assert "ControlGroup" not in show
    validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT)


def test_static_phase_accepts_an_optional_valid_rp_origin():
    text = VALID_UNIT_TEXT + "Environment=DASHBOARD_RP_ORIGIN=https://dashboard.example\n"
    validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_static_phase_accepts_sanctioned_webauthn_credentials():
    text = VALID_UNIT_TEXT + f"Environment={shlex.quote(f'DASHBOARD_WEBAUTHN_CREDENTIALS={WEBAUTHN_CREDENTIALS}')}\n"
    validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_static_phase_rejects_other_credential_named_unit_environment():
    for name in ("DASHBOARD_SESSION_SECRET", "MY_TOKEN"):
        text = VALID_UNIT_TEXT + f"Environment={name}=present\n"
        with pytest.raises(RuntimeError, match=name):
            validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


@pytest.mark.parametrize(
    ("value", "defect"),
    [
        ("not-json", "valid JSON"),
        ("{}", "JSON array"),
        (json.dumps([{"id": "a" * 16, "publicKey": "b" * 32, "privateKey": "not-allowed"}]), "unsupported keys"),
        (json.dumps([{"id": "!" * 16, "publicKey": "b" * 32}]), "base64url"),
        (json.dumps([{"id": "a" * 257, "publicKey": "b" * 32}]), "256-character"),
        (json.dumps([{"id": "a" * 16, "publicKey": "b" * 513}]), "512-character"),
        (json.dumps([{"id": "a" * 15 + "=", "publicKey": "b" * 32}]), "padding is not allowed"),
        (json.dumps([{"id": "a" * 16, "publicKey": "b" * 32, "transports": ["USB"]}]), "short strings"),
        (json.dumps([{"id": "a" * 16, "publicKey": "b" * 32, "transports": ["a" * 33]}]), "short strings"),
    ],
)
def test_static_phase_rejects_malformed_webauthn_credentials(value, defect):
    text = VALID_UNIT_TEXT + f"Environment={shlex.quote(f'DASHBOARD_WEBAUTHN_CREDENTIALS={value}')}\n"
    with pytest.raises(RuntimeError, match=defect):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_environment_allows_only_the_sanctioned_public_key_channel():
    validate_vm_runtime.validate_environment({"DASHBOARD_WEBAUTHN_CREDENTIALS": WEBAUTHN_CREDENTIALS})


def test_environment_rejects_malformed_sanctioned_public_key_channel():
    with pytest.raises(RuntimeError, match="valid JSON"):
        validate_vm_runtime.validate_environment({"DASHBOARD_WEBAUTHN_CREDENTIALS": "secret-looking-value"})


def test_effective_unit_still_refuses_a_ninth_unknown_environment_name():
    text = VALID_UNIT_TEXT + "Environment=UNSANCTIONED_NINTH_NAME=1\n"
    with pytest.raises(RuntimeError, match="assignment set is not closed"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_live_phase_requires_service_cgroup_and_current_release_cwd(tmp_path):
    current = tmp_path / "releases" / "current"
    expected_cwd = current / "dashboard"
    expected_cwd.mkdir(parents=True)
    seen = []

    def resolve_proc_cwd(path):
        seen.append(path)
        return expected_cwd

    validate_vm_runtime.validate_live_unit(
        {"ControlGroup": "/system.slice/kb-dashboard.service", "MainPID": "4317"},
        current,
        resolve_proc_cwd=resolve_proc_cwd,
    )
    assert seen == [Path("/proc/4317/cwd")]

    with pytest.raises(RuntimeError, match="working directory"):
        validate_vm_runtime.validate_live_unit(
            {"ControlGroup": "/system.slice/kb-dashboard.service", "MainPID": "4317"},
            current,
            resolve_proc_cwd=lambda _path: tmp_path / "wrong" / "dashboard",
        )
