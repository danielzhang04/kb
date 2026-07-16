import datetime
import subprocess
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


def _git(repo: Path, *args) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def _commit_onto_local_main(repo: Path) -> None:
    """Commit the current working tree onto a local `main` branch (no `origin`
    configured, so promotion._resolve_main_ref's fallback resolves to
    refs/heads/main). Used so pre-3.4 fixtures whose cadences were never about
    autonomy at all keep getting standing-authorized acts-alone -- and therefore
    keep routing to inbox/ -- once promotion.decide() is actually wired in."""
    _git(repo, "init")
    _git(repo, "config", "user.name", "Test")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "commit.gpgsign", "false")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "hb on main")
    _git(repo, "branch", "-M", "main")


def make_repo(tmp_path: Path) -> Path:
    proj = tmp_path / "orgs" / "proj-a"
    proj.mkdir(parents=True)
    (proj / "HEARTBEAT.md").write_text(HB, encoding="utf-8")
    _commit_onto_local_main(tmp_path)
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
    # Discriminating sequence: proj-a's ledger entry for the shared cadence name
    # `nightly-review` must NOT suppress proj-b's identically-named cadence. Under a
    # name-only dedup key this fails at step 2 below; the composed project:cadence key passes.
    import cards
    repo = make_repo(tmp_path)  # proj-a only, HB declares daily/cloud `nightly-review`
    day = datetime.date(2026, 7, 14)

    # 1) proj-a alone -> exactly one cloud card (nightly-review) on this Tuesday
    first = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day)
    assert len(first) == 1
    assert cards.parse(first[0]).meta["project"] == "proj-a"

    # 2) add proj-b with the SAME cadence name; same day -> proj-b must still dispatch
    _write_project(repo, "proj-b", HB)
    second = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day)
    assert len(second) == 1
    assert cards.parse(second[0]).meta["project"] == "proj-b"

    # 3) everything already ran -> idempotent, nothing more emitted
    third = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day)
    assert len(third) == 0


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


# --------------------------------------------------------------------------- #
# Task 3.4 — promotion.decide() wiring: autonomy/assurance stamping + routing #
# --------------------------------------------------------------------------- #
#
# These cadences live on the root HEARTBEAT.md (project "kb") and are committed
# onto the repo's local `main` branch so promotion._resolve_main_ref's fallback
# (no `origin` remote configured -> refs/heads/main) resolves to the exact same
# bytes `_heartbeats()` reads off disk, giving deterministic standing-authorization
# without mocking git.

def _repo_on_main(root: Path, hb_text: str) -> Path:
    repo = root / "repo"
    repo.mkdir(parents=True)
    (repo / "HEARTBEAT.md").write_text(hb_text, encoding="utf-8")
    _commit_onto_local_main(repo)
    return repo


SOLO_HB = """# Heartbeat — kb

```yaml
cadences:
  - name: solo-cadence
    schedule: daily
    tier: cloud
    risk-tier: T1
    prompt: |
      Do a thing.
```
"""

UNPROVEN_HB = """# Heartbeat — test

```yaml
cadences:
  - name: unproven-cadence
    schedule: daily
    tier: cloud
    risk-tier: T1
    prompt: |
      Do a risky, never-authored thing.
```
"""

# The exact `nightly-review` block declares its intended writes via an optional
# `writes:` list (see dispatch.py's carve-out comment for the assumption this
# encodes). `writes` is not one of promotion._CADENCE_FIELDS, so it never affects
# standing-authorization matching -- only dispatch's own carve-out-scope check.
NIGHTLY_INSCOPE_HB = """# Heartbeat — kb

```yaml
cadences:
  - name: nightly-review
    schedule: daily
    tier: cloud
    risk-tier: T1
    writes:
      - dashboards/executive.md
      - dashboards/handover.md
      - memory/dispatcher-cloud.md
      - ledgers/dispatch/dispatcher-cloud-2026-07-14.tsv
    prompt: |
      Regenerate dashboards.
```
"""

NIGHTLY_OUTOFSCOPE_TEMPLATE = """# Heartbeat — kb

```yaml
cadences:
  - name: nightly-review
    schedule: daily
    tier: cloud
    risk-tier: T1
    writes:
      - {bad_path}
    prompt: |
      Regenerate dashboards.
```
"""


def test_acts_alone_routes_to_inbox(tmp_path):
    import cards
    repo = _repo_on_main(tmp_path, SOLO_HB)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1
    assert emitted[0].parent.name == "inbox"
    c = cards.parse(emitted[0])
    assert c.meta["state"] == "inbox"
    assert c.meta["autonomy"] == "acts-alone"
    assert c.meta["assurance_class"] == "acts-alone"


def test_queues_for_me_routes_to_approvals(tmp_path):
    import cards
    # Never authored onto main (no git repo at all) + no earned grades -> the
    # v1 default (queues-for-me) applies.
    proj = tmp_path / "orgs" / "proj-a"
    proj.mkdir(parents=True)
    (proj / "HEARTBEAT.md").write_text(UNPROVEN_HB, encoding="utf-8")
    emitted = dispatch.run(tmp_path, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1
    assert emitted[0].parent.name == "approvals"
    c = cards.parse(emitted[0])
    assert c.meta["state"] == "approvals"
    assert c.meta["autonomy"] == "queues-for-me"


def test_carveout_allows_own_card_and_dispatch_ledger(tmp_path):
    import cards
    repo = _repo_on_main(tmp_path, NIGHTLY_INSCOPE_HB)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1
    assert emitted[0].parent.name == "inbox"
    c = cards.parse(emitted[0])
    assert c.meta["state"] == "inbox"
    assert c.meta["autonomy"] == "acts-alone"


def test_carveout_excludes_grades_and_activity(tmp_path):
    import cards
    for i, bad_path in enumerate(["ledgers/grades/x-2026-07-14.tsv",
                                   "ledgers/activity/x-2026-07-14.tsv"]):
        hb = NIGHTLY_OUTOFSCOPE_TEMPLATE.format(bad_path=bad_path)
        repo = _repo_on_main(tmp_path / f"r{i}", hb)
        emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                               today=datetime.date(2026, 7, 14))
        assert len(emitted) == 1, bad_path
        assert emitted[0].parent.name == "approvals", bad_path
        c = cards.parse(emitted[0])
        assert c.meta["state"] == "approvals", bad_path
        assert c.meta["autonomy"] == "queues-for-me", bad_path


def test_frozen_forces_queue(tmp_path):
    import cards
    # Would otherwise be acts-alone (exact standing-authorized block on main) but
    # for the FROZEN sentinel, which beats standing-auth in promotion.decide()'s
    # precedence.
    repo = _repo_on_main(tmp_path, SOLO_HB)
    frozen_dir = repo / "ledgers" / "grades"
    frozen_dir.mkdir(parents=True)
    (frozen_dir / "FROZEN").write_text("frozen 2026-07-14: reconcile drift\n",
                                       encoding="utf-8")
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1
    assert emitted[0].parent.name == "approvals"
    c = cards.parse(emitted[0])
    assert c.meta["state"] == "approvals"
    assert c.meta["autonomy"] == "queues-for-me"
