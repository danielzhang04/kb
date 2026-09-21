"""VM tick-source ruling (queue/inbox/2c3d4e5f-708192a3.md, approved by Daniel 2026-09-17): a
systemd timer on the VM drives `scripts/dispatch.py` every 5 minutes. Finding it fixes: a
dashboard-stored schedule (self-lint-report, id 96db76e4, 2026-09-16) was armed but never fired,
because nothing on the VM invoked the dispatcher. This is a config-only test: it parses the two
committed unit files as plain text (no systemd, no VM) and asserts their shape against both the
ruling and `deploy/systemd/kb-dashboard.service`, which they must stay consistent with.
"""
from __future__ import annotations

from pathlib import Path

from deploy.validate_vm_runtime import parse_unit

REPO_ROOT = Path(__file__).resolve().parents[1]
SYSTEMD_DIR = REPO_ROOT / "deploy" / "systemd"


def _directives(text: str, section: str) -> dict[str, str]:
    return dict(parse_unit(text)[section])


def test_dispatch_service_runs_as_the_same_identity_as_the_dashboard_unit():
    dashboard = _directives((SYSTEMD_DIR / "kb-dashboard.service").read_text(encoding="utf-8"), "Service")
    dispatch = _directives((SYSTEMD_DIR / "kb-dispatch.service").read_text(encoding="utf-8"), "Service")
    assert dispatch["User"] == dashboard["User"] == "kb-dashboard"
    assert dispatch["Group"] == dashboard["Group"] == "kb-dashboard"


def test_dispatch_service_execstart_targets_the_release_layout_and_the_script_exists():
    dispatch = _directives((SYSTEMD_DIR / "kb-dispatch.service").read_text(encoding="utf-8"), "Service")
    exec_start = dispatch["ExecStart"]
    assert "/opt/kb-releases/current/scripts/dispatch.py" in exec_start
    assert "--tier cloud" in exec_start and "--agent dispatcher-cloud" in exec_start
    # /opt/kb-releases/current/<rest> is the immutable release tree's copy of THIS repo at deploy
    # time; the relative shape it must exist at is repo-root/scripts/dispatch.py, checked here so a
    # rename of scripts/dispatch.py cannot silently orphan the unit's ExecStart.
    release_relative = exec_start.split("/opt/kb-releases/current/", 1)[1].split(" ", 1)[0]
    assert (REPO_ROOT / release_relative).is_file()


def test_dispatch_service_sandbox_is_no_wider_than_the_dashboard_units_and_scoped_to_ops_only():
    dashboard = _directives((SYSTEMD_DIR / "kb-dashboard.service").read_text(encoding="utf-8"), "Service")
    dispatch = _directives((SYSTEMD_DIR / "kb-dispatch.service").read_text(encoding="utf-8"), "Service")
    assert dispatch["ReadOnlyPaths"] == dashboard["ReadOnlyPaths"] == "/opt/kb-releases"
    # Narrower than the dashboard's own ReadWritePaths ("/var/lib/kb/state /var/lib/kb/ops"):
    # dispatch.py only writes queue/ + ledgers/ inside the ops checkout, never DASHBOARD_STATE_ROOT.
    assert dispatch["ReadWritePaths"] == "/var/lib/kb/ops"
    assert "/var/lib/kb/state" in dashboard["ReadWritePaths"]
    assert dispatch["WorkingDirectory"] == "/var/lib/kb/ops"
    assert dispatch["NoNewPrivileges"] == dashboard["NoNewPrivileges"] == "true"


def test_dispatch_service_has_an_overlap_guard_and_no_extra_listeners():
    dispatch = _directives((SYSTEMD_DIR / "kb-dispatch.service").read_text(encoding="utf-8"), "Service")
    assert dispatch["Type"] == "oneshot"
    assert "flock" in dispatch["ExecStart"] and " -n " in dispatch["ExecStart"]
    text = (SYSTEMD_DIR / "kb-dispatch.service").read_text(encoding="utf-8")
    assert "ListenStream" not in text and "ListenDatagram" not in text


def test_dispatch_timer_cadence_matches_the_ruling():
    timer = _directives((SYSTEMD_DIR / "kb-dispatch.timer").read_text(encoding="utf-8"), "Timer")
    assert timer["OnCalendar"] == "*:0/5"
    assert timer["Persistent"] == "true"
    assert timer["Unit"] == "kb-dispatch.service"


def test_dispatch_timer_wants_the_timers_target():
    install = _directives((SYSTEMD_DIR / "kb-dispatch.timer").read_text(encoding="utf-8"), "Install")
    assert install["WantedBy"] == "timers.target"
