from io import StringIO
import json
from pathlib import Path
import subprocess

import pytest

from scripts.prospecting.manager.bridge import DesktopBridge, SshStager
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
    return {"operation": operation, "stage_id": "list", "attempt": 1, "run_id": "run-one", "execution_key": "a" * 64, "policy_id": "policy-one", "policy_hash": "b" * 64, "campaign_id": "campaign-one", "sender_profile_id": "sender-one", "lanes": ["manual"], "model_response": "C:/safe.json", "output": "C:/safe.json", "ids": [], "hashes": [], "counts": {}}


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


def test_ssh_is_allowlisted_and_strict(tmp_path: Path) -> None:
    seen = []
    bridge = DesktopBridge(tmp_path, launch=lambda argv, **kwargs: (seen.append(argv) or FakeProcess('81\n{}')), stage=lambda *args: "C:/kb-prospecting/jobs/a.json", cleanup=lambda *args: None, allowed_hosts=frozenset({"desktop.test"}))
    with pytest.raises(ValueError, match="ssh_host_not_allowed"):
        bridge.invoke("list-builder", job(), "ssh", host="other.test")
    outcome = bridge.invoke("list-builder", job(), "ssh", host="desktop.test")
    assert outcome.code == "ok"
    assert "StrictHostKeyChecking=yes" in seen[0]


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
    inspected = bridge.invoke("inspector", payload, "local")
    assert inspected.code == "ok"
    assert set(inspected.summary) == {"stage_id", "state", "ids", "counts", "hashes", "failure_codes", "attempt"}
    assert inspected.summary["state"] == "failed"
    assert inspected.summary["counts"] == {}
    assert inspected.summary["failure_codes"] == {"inspector_unavailable": 1}
