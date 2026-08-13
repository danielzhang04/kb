import subprocess
from types import SimpleNamespace
from pathlib import Path

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


@pytest.mark.parametrize("name", ["GITHUB_TOKEN", "GH_TOKEN", "GIT_ASKPASS", "SSH_AUTH_SOCK", "DASHBOARD_SESSION_SECRET", "KB_CANARY_SESSION", "OPENAI_API_KEY", "AWS_ACCESS_KEY_ID"])
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
