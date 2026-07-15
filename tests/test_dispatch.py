import datetime
from pathlib import Path

import dispatch
import ledger

HB = """# Heartbeat — test

```yaml
cadences:
  - name: nightly-review
    schedule: daily
    tier: cloud
    risk-tier: T1
    prompt: |
      Regenerate dashboards.
  - name: weekly-audit
    schedule: weekly:sat
    tier: cloud
    risk-tier: T1
    prompt: |
      Audit the system.
  - name: heavy-render
    schedule: daily
    tier: desktop
    risk-tier: T2
    prompt: |
      Render pending videos.
```
"""


def make_repo(tmp_path: Path) -> Path:
    proj = tmp_path / "orgs" / "proj-a"
    proj.mkdir(parents=True)
    (proj / "HEARTBEAT.md").write_text(HB, encoding="utf-8")
    return tmp_path


def test_parse_heartbeat(tmp_path):
    repo = make_repo(tmp_path)
    cadences = dispatch.parse_heartbeat(repo / "orgs" / "proj-a" / "HEARTBEAT.md")
    assert [c["name"] for c in cadences] == ["nightly-review", "weekly-audit", "heavy-render"]


def test_due_daily_and_weekly():
    sat = datetime.date(2026, 7, 18)  # a Saturday
    tue = datetime.date(2026, 7, 14)  # a Tuesday
    daily = {"name": "n", "schedule": "daily"}
    weekly = {"name": "w", "schedule": "weekly:sat"}
    assert dispatch.due(daily, tue) is True
    assert dispatch.due(weekly, sat) is True
    assert dispatch.due(weekly, tue) is False


def test_run_emits_claimed_cards_for_tier_only(tmp_path):
    repo = make_repo(tmp_path)
    emitted = dispatch.run(repo, tier="cloud", agent_id="dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1  # nightly only (Tuesday, cloud tier)
    import cards
    c = cards.parse(emitted[0])
    assert c.meta["owner"] == "dispatcher-cloud"
    assert c.meta["state"] == "inbox"
    assert "Regenerate dashboards." in c.body


def test_run_is_idempotent_within_a_day(tmp_path):
    repo = make_repo(tmp_path)
    day = datetime.date(2026, 7, 14)
    first = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day)
    second = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day)
    assert len(first) == 1 and len(second) == 0


def test_archived_projects_skipped(tmp_path):
    repo = make_repo(tmp_path)
    arch = repo / "orgs" / "_archive" / "old"
    arch.mkdir(parents=True)
    (arch / "HEARTBEAT.md").write_text(HB, encoding="utf-8")
    emitted = dispatch.run(repo, "cloud", "d", today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1


NIGHTLY_HB = """# Heartbeat

```yaml
cadences:
  - name: nightly-review
    schedule: daily
    tier: cloud
    risk-tier: T1
    prompt: |
      Regenerate dashboards.
```
"""


def _write_project(repo: Path, name: str, content: str) -> None:
    proj = repo / "orgs" / name
    proj.mkdir(parents=True)
    (proj / "HEARTBEAT.md").write_text(content, encoding="utf-8")


def test_same_cadence_name_across_projects_both_dispatch(tmp_path):
    _write_project(tmp_path, "proj-a", NIGHTLY_HB)
    _write_project(tmp_path, "proj-b", NIGHTLY_HB)
    day = datetime.date(2026, 7, 14)
    first = dispatch.run(tmp_path, "cloud", "dispatcher-cloud", today=day)
    assert len(first) == 2  # same cadence name in two projects -> both dispatch
    second = dispatch.run(tmp_path, "cloud", "dispatcher-cloud", today=day)
    assert len(second) == 0  # idempotent, per-project keys already ran


def test_malformed_heartbeat_skips_project_not_run(tmp_path):
    _write_project(tmp_path, "proj-a", NIGHTLY_HB)
    broken = "# Heartbeat\n\n```yaml\ncadences: [unclosed\n```\n"
    _write_project(tmp_path, "proj-b", broken)
    emitted = dispatch.run(tmp_path, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1  # proj-a still dispatched despite proj-b malformed
    import cards
    assert cards.parse(emitted[0]).meta["project"] == "proj-a"


def test_target_uses_posix_separators(tmp_path):
    repo = make_repo(tmp_path)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    import cards
    assert cards.parse(emitted[0]).meta["target"] == "orgs/proj-a"
