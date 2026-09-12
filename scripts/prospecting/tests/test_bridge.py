from io import StringIO
import json
from pathlib import Path
import subprocess
import sys
import threading
import time

import pytest

from scripts.prospecting.manager import bridge as bridge_module
from scripts.prospecting.manager.bridge import (
    DesktopBridge,
    SshStager,
    read_bounded_output,
)
from scripts.prospecting.manager.bindings import command_digest
from scripts.prospecting.manager import desktop_stage as desktop_stage_module
from scripts.prospecting.manager.desktop_stage import run as run_desktop_stage
from scripts.prospecting.p2_store import compile_target_policy
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_bridge")


class FakeProcess:
    def __init__(self, stdout='{}', stderr='', code=0, timeout=False):
        self.stdout, self.stderr = StringIO(stdout), StringIO(stderr)
        self.returncode, self.pid, self.args, self.timeout = code, 71, ['fake'], timeout
    def wait(self, timeout):
        if self.timeout: raise subprocess.TimeoutExpired(self.args, timeout)
        return self.returncode


def job(operation='build'):
    value = {"operation": operation, "stage_id": "list", "attempt": 1, "run_id": "run-one", "execution_key": "a" * 64, "policy_id": "policy-one", "policy_hash": "b" * 64, "campaign_id": "campaign-one", "sender_profile_id": "sender-one", "lanes": ["manual"], "model_response": "C:/safe.json", "output": "C:/safe.json", "ids": [], "hashes": [], "counts": {}}
    value["command_digest"] = command_digest(value)
    return value


def _desktop_job(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, operation: str
) -> tuple[Path, Path, dict]:
    root = tmp_path / "kb-prospecting"
    root.mkdir()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(root / "store.sqlite"))
    store = open_store(root / "store.sqlite")
    store.execute(
        "INSERT INTO sender_profile(sender_profile_id,sender_name,sender_focus,sender_background,sender_operating_proof,approved_metrics) VALUES(?,?,?,?,?,?)",
        ("sender-one", "Synthetic", "testing", "synthetic", "fixture", "[]"),
    )
    store.execute(
        "INSERT INTO campaign(campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,send_window,timezone,daily_cap,hourly_cap,firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("campaign-one", "networking", "sender-one", "{}", "informational_call", "direct", "fixture", "[]", "{}", "UTC", 1, 1, 1, "T1", "mailbox-one", "{}", 0, "active", "b" * 64),
    )
    store.close()
    jobs = root / "jobs"
    jobs.mkdir()
    payload = job(operation)
    payload["model_response"] = str(root / "response.json")
    payload["output"] = str(root / "prepared.json")
    payload["command_digest"] = command_digest(payload)
    path = jobs / "job.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return root, path, payload


def test_every_stage_uses_one_desktop_job_argv(tmp_path: Path) -> None:
    seen = []
    for agent, operation in (("list-builder", "build"), ("personalizer", "personalize"), ("campaigner", "scan"), ("inspector", "grade")):
        payload = job(operation); payload["stage_id"] = "inspect-list" if agent == "inspector" else payload["stage_id"]
        DesktopBridge(tmp_path, launch=lambda argv, **kwargs: (seen.append(argv) or FakeProcess('{"stage_id":"list","state":"complete","ids":[],"counts":{},"hashes":[],"failure_codes":{},"attempt":1}'))).invoke(agent, payload, "local")
    assert all(argv[3] == "scripts.prospecting.manager.desktop_stage" and argv[4] == "--job" for argv in seen)


def test_local_bridge_binds_store_job_directory_and_repo_cwd(tmp_path: Path) -> None:
    desktop_root = tmp_path / "local-app-data" / "kb-prospecting"
    jobs = desktop_root / "jobs"
    store = desktop_root / "selected.sqlite"
    repo = tmp_path / "repo"
    desktop_root.mkdir(parents=True)
    store.touch()
    repo.mkdir()
    seen = []

    def launch(argv, **kwargs):
        seen.append((argv, kwargs))
        return FakeProcess('{"stage_id":"list","state":"complete","ids":[],"counts":{},"hashes":[],"failure_codes":{},"attempt":1}')

    outcome = DesktopBridge(
        jobs,
        launch=launch,
        local_app_data=desktop_root.parent,
        store_path=store,
        repo_root=repo,
    ).invoke("list-builder", job(), "local")

    assert outcome.code == "ok"
    argv, options = seen[0]
    assert Path(argv[-1]).parent == jobs
    assert options["cwd"] == str(repo)
    assert options["env"]["LOCALAPPDATA"] == str(desktop_root.parent)
    assert options["env"]["KB_PROSPECTING_STORE"] == str(store)
    assert options["env"]["KB_PROSPECTING_NO_NETWORK"] == "1"
    assert not list(jobs.glob("job-*.json"))


def test_local_bridge_rejects_a_store_or_job_dir_outside_desktop_root(
    tmp_path: Path,
) -> None:
    desktop_root = tmp_path / "local-app-data" / "kb-prospecting"
    desktop_root.mkdir(parents=True)
    with pytest.raises(ValueError, match="^desktop_context_invalid$"):
        DesktopBridge(
            tmp_path / "outside-jobs",
            local_app_data=desktop_root.parent,
            store_path=desktop_root / "store.sqlite",
        )
    with pytest.raises(ValueError, match="^desktop_context_invalid$"):
        DesktopBridge(
            desktop_root / "jobs",
            local_app_data=desktop_root.parent,
            store_path=tmp_path / "outside.sqlite",
        )


def test_local_bridge_rechecks_job_directory_links_at_write_time(
    tmp_path: Path,
) -> None:
    desktop_root = tmp_path / "local-app-data" / "kb-prospecting"
    desktop_root.mkdir(parents=True)
    store = desktop_root / "store.sqlite"
    store.touch()
    jobs = desktop_root / "jobs"
    outside = tmp_path / "outside"
    outside.mkdir()
    bridge = DesktopBridge(
        jobs,
        launch=lambda *_args, **_kwargs: pytest.fail("child launched"),
        local_app_data=desktop_root.parent,
        store_path=store,
    )
    try:
        jobs.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("directory symlinks unavailable")

    with pytest.raises(ValueError, match="^job_directory_invalid$"):
        bridge.invoke("list-builder", job(), "local")

    assert list(outside.iterdir()) == []


def test_local_bridge_reuses_only_an_identical_crash_leftover_job(
    tmp_path: Path,
) -> None:
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    payload = job()
    staged = jobs / f"job-{payload['run_id']}-{payload['execution_key']}.json"
    staged.write_text(
        json.dumps(payload, sort_keys=True, separators=(",", ":")), encoding="utf-8"
    )
    bridge = DesktopBridge(
        jobs,
        launch=lambda *_args, **_kwargs: FakeProcess(
            '{"stage_id":"list","state":"complete","ids":[],"counts":{},"hashes":[],"failure_codes":{},"attempt":1}'
        ),
    )

    assert bridge.invoke("list-builder", payload, "local").code == "ok"
    assert not staged.exists()

    staged.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="^job_path_conflict$"):
        bridge.invoke("list-builder", payload, "local")
    assert staged.read_text(encoding="utf-8") == "{}"


def test_nonzero_stderr_pii_is_redacted(tmp_path: Path) -> None:
    outcome = DesktopBridge(tmp_path, launch=lambda *args, **kwargs: FakeProcess(stderr=SYNTHETIC["private_error_email"], code=1)).invoke("list-builder", job(), "local")
    assert outcome.code == "failed_output_redacted" and outcome.summary == {"counts": {"failed_output_redacted": 1}}


@pytest.mark.parametrize("mode", ["timeout", "overflow"])
def test_failure_paths_guard_output(tmp_path: Path, mode: str) -> None:
    killed = []
    if mode == "timeout": process = FakeProcess(stderr=SYNTHETIC["private_error_email"], timeout=True)
    else: process = FakeProcess("x" * 70_000, SYNTHETIC["private_error_email"])
    outcome = DesktopBridge(tmp_path, launch=lambda *args, **kwargs: process, terminate_tree=killed.append).invoke("list-builder", job(), "local", timeout=1)
    assert outcome.code == "failed_output_redacted" and killed == [71]


def test_bounded_output_cancels_and_joins_publishers_after_consumer_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    threads: list[threading.Thread] = []

    def tracked_thread(*args, **kwargs):
        thread = threading.Thread(*args, **kwargs)
        threads.append(thread)
        return thread

    monkeypatch.setattr(bridge_module, "Thread", tracked_thread)
    process = FakeProcess("x" * 100_000, "y" * 100_000)

    with pytest.raises(RuntimeError, match="^synthetic_consumer_failure$"):
        read_bounded_output(
            process,
            2,
            lambda _name, _text: (_ for _ in ()).throw(
                RuntimeError("synthetic_consumer_failure")
            ),
            cancel=lambda: None,
        )

    assert len(threads) == 2
    assert all(not thread.is_alive() for thread in threads)


def test_real_silent_child_timeout_terminates_without_blocked_pipe_threads() -> None:
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(3)"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    def cancel() -> None:
        process.kill()
        process.wait(timeout=0.5)

    started = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        read_bounded_output(process, 0.1, cancel=cancel)

    assert time.monotonic() - started < 1
    assert process.poll() is not None


def test_ssh_is_allowlisted_and_strict(tmp_path: Path) -> None:
    seen = []
    cleaned = []
    bridge = DesktopBridge(tmp_path, launch=lambda argv, **kwargs: (seen.append(argv) or FakeProcess('81\n{}')), stage=lambda *args: "C:/kb-prospecting/jobs/a.json", cleanup=lambda *args: cleaned.append(args), allowed_hosts=frozenset({"desktop.test"}))
    with pytest.raises(ValueError, match="ssh_host_not_allowed"):
        bridge.invoke("list-builder", job(), "ssh", host="other.test")
    outcome = bridge.invoke("list-builder", job(), "ssh", host="desktop.test")
    assert outcome.code == "ok"
    assert "StrictHostKeyChecking=yes" in seen[0]
    assert cleaned and not list(tmp_path.glob("job-*.json"))


@pytest.mark.parametrize("mode", ("launch_failure", "timeout"))
def test_ssh_failure_cleans_remote_and_local_staging(
    tmp_path: Path, mode: str
) -> None:
    cleaned = []
    killed = []

    def launch(*_args, **_kwargs):
        if mode == "launch_failure":
            raise RuntimeError("synthetic_launch_failure")
        return FakeProcess("81\n{}", timeout=True)

    bridge = DesktopBridge(
        tmp_path,
        launch=launch,
        stage=lambda *_args: "C:/kb-prospecting/jobs/a.json",
        cleanup=lambda *args: cleaned.append(args),
        terminate_tree=killed.append,
        remote_terminate_tree=lambda *_args: None,
        allowed_hosts=frozenset({"desktop.test"}),
    )

    if mode == "launch_failure":
        with pytest.raises(RuntimeError, match="^synthetic_launch_failure$"):
            bridge.invoke("list-builder", job(), "ssh", host="desktop.test")
    else:
        assert bridge.invoke(
            "list-builder", job(), "ssh", host="desktop.test", timeout=1
        ).code == "timeout"

    assert cleaned and not list(tmp_path.glob("job-*.json"))
    assert killed == ([71] if mode == "timeout" else [])


def test_ssh_cleanup_failure_still_removes_local_staging(tmp_path: Path) -> None:
    def cleanup(*_args):
        raise RuntimeError("synthetic_remote_cleanup_failure")

    bridge = DesktopBridge(
        tmp_path,
        launch=lambda *_args, **_kwargs: FakeProcess("81\n{}"),
        stage=lambda *_args: "C:/kb-prospecting/jobs/a.json",
        cleanup=cleanup,
        allowed_hosts=frozenset({"desktop.test"}),
    )

    with pytest.raises(RuntimeError, match="^bridge_cleanup_failed$"):
        bridge.invoke("list-builder", job(), "ssh", host="desktop.test")

    assert not list(tmp_path.glob("job-*.json"))


def test_ssh_cleanup_failure_preserves_selected_timeout(tmp_path: Path) -> None:
    bridge = DesktopBridge(
        tmp_path,
        launch=lambda *_args, **_kwargs: FakeProcess("81\n{}", timeout=True),
        stage=lambda *_args: "C:/kb-prospecting/jobs/a.json",
        cleanup=lambda *_args: (_ for _ in ()).throw(
            RuntimeError("synthetic_remote_cleanup_failure")
        ),
        terminate_tree=lambda _pid: None,
        remote_terminate_tree=lambda *_args: None,
        allowed_hosts=frozenset({"desktop.test"}),
    )

    outcome = bridge.invoke(
        "list-builder", job(), "ssh", host="desktop.test", timeout=1
    )

    assert outcome.code == "timeout"
    assert not list(tmp_path.glob("job-*.json"))


def test_stager_has_bounded_transfer_commands(tmp_path: Path) -> None:
    calls = []
    stager = SshStager(run=lambda argv, **kwargs: calls.append(kwargs))
    stager.stage(tmp_path / "job.json", "desktop.test", timeout=9)
    assert all(call["timeout"] == 9 and call["shell"] is False for call in calls)


def test_real_bridge_uses_the_selected_store_for_list_and_inspection(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "kb-prospecting"; root.mkdir(); monkeypatch.setenv("LOCALAPPDATA", str(tmp_path)); monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    store = root / "store.sqlite"; db = open_store(store)
    policy = {"predicates": [], "requested_companies": 3, "requested_people": 6, "extra_fields": [], "lane_plan": ["manual"], "scorer_version": "fit-v1"}
    digest = compile_target_policy(policy, lambda _: None).policy_hash
    db.execute("INSERT INTO sender_profile(sender_profile_id,sender_name,sender_focus,sender_background,sender_operating_proof,approved_metrics) VALUES(?,?,?,?,?,?)", ("sender-one", "Synthetic", "testing", "synthetic", "fixture", "[]"))
    db.execute("INSERT INTO campaign(campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,send_window,timezone,daily_cap,hourly_cap,firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("camp_0000000000000001", "networking", "sender-one", json.dumps(policy), "informational_call", "direct", "fixture", "[]", "{}", "UTC", 1, 1, 1, "T1", "mailbox-one", "{}", 0, "active", digest))
    for index in range(6):
        db.execute("INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)", (f"obs-{index}", "person", f"person-{index}", "full_name", json.dumps(f"Synthetic {index}"), "manual", "2026-09-03T00:00:00Z", 1.0))
    for index in range(3): db.execute("INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)", (f"firm-{index}", f"Firm {index}", "manual", f"firm-key-{index}"))
    db.close()
    payload = job(); payload["campaign_id"] = "camp_0000000000000001"; payload["policy_hash"] = digest
    payload["command_digest"] = command_digest(payload)
    bridge = DesktopBridge(
        root / "jobs",
        local_app_data=tmp_path,
        store_path=store,
        repo_root=Path(__file__).resolve().parents[3],
    )
    listed = bridge.invoke("list-builder", payload, "local")
    assert listed.code == "ok"
    assert listed.summary["state"] == "complete"
    assert listed.summary["counts"]["people"] == 6
    payload["operation"] = "grade"; payload["stage_id"] = "inspect-list"; payload["execution_key"] = "c" * 64
    payload["command_digest"] = command_digest(payload)
    inspected = bridge.invoke("inspector", payload, "local")
    assert inspected.code == "ok"
    assert set(inspected.summary) == {
        "stage_id", "state", "ids", "counts", "hashes", "failure_codes",
        "attempt", "execution_key", "command_digest",
    }
    assert inspected.summary["state"] == "failed"
    assert inspected.summary["counts"] == {}
    assert inspected.summary["failure_codes"] == {"inspector_unavailable": 1}
    assert inspected.summary["hashes"] == []


def test_desktop_cache_is_correlated_and_conflicting_key_is_rejected(
    tmp_path: Path, monkeypatch
) -> None:
    root = tmp_path / "kb-prospecting"
    root.mkdir()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(root / "store.sqlite"))
    store = open_store(root / "store.sqlite")
    store.execute(
        "INSERT INTO sender_profile(sender_profile_id,sender_name,sender_focus,sender_background,sender_operating_proof,approved_metrics) VALUES(?,?,?,?,?,?)",
        ("sender-one", "Synthetic", "testing", "synthetic", "fixture", "[]"),
    )
    store.execute(
        "INSERT INTO campaign(campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,send_window,timezone,daily_cap,hourly_cap,firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("campaign-one", "networking", "sender-one", "{}", "informational_call", "direct", "fixture", "[]", "{}", "UTC", 1, 1, 1, "T1", "mailbox-one", "{}", 0, "active", "b" * 64),
    )
    store.close()
    jobs = root / "jobs"
    jobs.mkdir()
    payload = job("grade")
    payload["stage_id"] = "inspect-list"
    payload["command_digest"] = command_digest(payload)
    path = jobs / "job.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    first = run_desktop_stage(path)
    assert run_desktop_stage(path) == first
    assert first["failure_codes"] == {"inspector_unavailable": 1}

    store = open_store(root / "store.sqlite")
    store.execute(
        "UPDATE campaign SET policy_hash=? WHERE campaign_id=?",
        ("f" * 64, "campaign-one"),
    )
    store.close()
    with pytest.raises(ValueError, match="^job_binding_conflict$"):
        run_desktop_stage(path)
    store = open_store(root / "store.sqlite")
    store.execute(
        "UPDATE campaign SET policy_hash=? WHERE campaign_id=?",
        ("b" * 64, "campaign-one"),
    )
    store.close()

    payload["counts"] = {"changed": 1}
    payload["command_digest"] = command_digest(payload)
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="^cache_conflict$"):
        run_desktop_stage(path)


def test_desktop_claim_prevents_duplicate_execution(
    tmp_path: Path, monkeypatch
) -> None:
    root = tmp_path / "kb-prospecting"
    root.mkdir()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(root / "store.sqlite"))
    store = open_store(root / "store.sqlite")
    store.execute(
        "INSERT INTO sender_profile(sender_profile_id,sender_name,sender_focus,sender_background,sender_operating_proof,approved_metrics) VALUES(?,?,?,?,?,?)",
        ("sender-one", "Synthetic", "testing", "synthetic", "fixture", "[]"),
    )
    store.execute(
        "INSERT INTO campaign(campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,send_window,timezone,daily_cap,hourly_cap,firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("campaign-one", "networking", "sender-one", "{}", "informational_call", "direct", "fixture", "[]", "{}", "UTC", 1, 1, 1, "T1", "mailbox-one", "{}", 0, "active", "b" * 64),
    )
    store.close()
    jobs = root / "jobs"
    jobs.mkdir()
    payload = job("grade")
    payload["stage_id"] = "inspect-list"
    payload["command_digest"] = command_digest(payload)
    path = jobs / "job.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    claim = jobs / f"claim-{payload['execution_key']}.json"
    claim.write_text(json.dumps({
        "command_digest": payload["command_digest"],
        "execution_key": payload["execution_key"],
    }, sort_keys=True, separators=(",", ":")), encoding="utf-8")

    result = run_desktop_stage(path)

    assert result["failure_codes"] == {"adapter_recovery_required": 1}
    assert claim.exists()
    assert not (jobs / f"result-{payload['execution_key']}.json").exists()


def test_desktop_syncs_claim_before_child_and_cache_before_claim_removal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _root, path, _payload = _desktop_job(tmp_path, monkeypatch, "build")
    events: list[str] = []
    monkeypatch.setattr(
        desktop_stage_module.os, "fsync", lambda _descriptor: events.append("file")
    )
    monkeypatch.setattr(
        desktop_stage_module,
        "_sync_directory",
        lambda _path: events.append("directory") or True,
    )
    monkeypatch.setattr(
        desktop_stage_module,
        "_run_child",
        lambda _argv: events.append("child") or {"companies": 1},
    )

    result = run_desktop_stage(path)

    assert result["counts"] == {"companies": 1}
    assert events == [
        "file", "directory", "child", "file", "directory", "directory",
        "directory",
    ]


@pytest.mark.parametrize(
    "mode,expected",
    (
        ("success", {}),
        ("failure", {"adapter_failed": 1}),
        ("timeout", {"adapter_timeout": 1}),
        ("overflow", {"adapter_output_overflow": 1}),
        ("rejected", {"adapter_output_rejected": 1}),
    ),
)
def test_personalizer_child_is_bounded_and_owned_profile_is_always_removed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    expected: dict[str, int],
) -> None:
    root, path, _payload = _desktop_job(tmp_path, monkeypatch, "personalize")
    seen_profiles: list[Path] = []
    killed: list[int] = []

    def launch(argv, **kwargs):
        assert kwargs["shell"] is False
        assert kwargs["env"]["KB_PROSPECTING_NO_NETWORK"] == "1"
        profile = Path(argv[argv.index("--sender-profile") + 1])
        assert profile.is_file()
        assert profile.parent == root / "snapshots" / "manager-private"
        seen_profiles.append(profile)
        if mode == "failure":
            return FakeProcess(code=1)
        if mode == "timeout":
            return FakeProcess(timeout=True)
        if mode == "overflow":
            return FakeProcess("x" * 70_000)
        if mode == "rejected":
            return FakeProcess(SYNTHETIC["private_error_email"])
        return FakeProcess('{"revisions_created":1}')

    monkeypatch.setattr(desktop_stage_module.subprocess, "Popen", launch)
    monkeypatch.setattr(
        desktop_stage_module, "terminate_windows_tree", killed.append
    )

    result = run_desktop_stage(path)

    assert result["failure_codes"] == expected
    assert seen_profiles and not seen_profiles[0].exists()
    assert killed == ([71] if mode in {"timeout", "overflow"} else [])


def test_profile_snapshot_reparse_is_rejected_before_child_launch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, path, _payload = _desktop_job(tmp_path, monkeypatch, "personalize")
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (root / "snapshots").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("directory symlinks unavailable")
    monkeypatch.setattr(
        desktop_stage_module.subprocess,
        "Popen",
        lambda *_args, **_kwargs: pytest.fail("child launched"),
    )

    result = run_desktop_stage(path)

    assert result["failure_codes"] == {"adapter_failed": 1}
    assert list(outside.iterdir()) == []


def test_profile_cleanup_refuses_to_remove_a_replacement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _root, path, _payload = _desktop_job(tmp_path, monkeypatch, "personalize")
    replacement: list[Path] = []

    def launch(argv, **_kwargs):
        profile = Path(argv[argv.index("--sender-profile") + 1])
        profile.unlink()
        profile.write_text("synthetic replacement", encoding="utf-8")
        replacement.append(profile)
        return FakeProcess('{"revisions_created":1}')

    monkeypatch.setattr(desktop_stage_module.subprocess, "Popen", launch)

    result = run_desktop_stage(path)

    assert result["failure_codes"] == {"adapter_cleanup_failed": 1}
    assert replacement[0].read_text(encoding="utf-8") == "synthetic replacement"
