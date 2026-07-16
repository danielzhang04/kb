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


# --------------------------------------------------------------------------- #
# Task 4.1 -- depends-on DAG release logic (dispatch.py's release pass)      #
# --------------------------------------------------------------------------- #
#
# The release pass is a distinct, additive concern from the per-cadence loop
# above: it walks existing queue/ cards looking for `blocked` children with a
# non-empty `depends-on`, and releases them to `inbox` (threading dep `##
# Result` sections into the body) only once every dep is `done`. It runs
# unconditionally inside dispatch.run() -- it is not gated by cadence `tier` --
# because it concerns the queue's existing DAG state, not heartbeat cadences.

def _bare_repo(tmp_path: Path) -> Path:
    """A repo root with no heartbeats at all -- run() should still execute the
    release pass (and simply emit zero cadence cards)."""
    return tmp_path


def _make_dep(queue_root: Path, *, state: str, result_body: str | None = None):
    import cards
    body = "## Work order\n\ndo the dep\n"
    if result_body is not None:
        body += f"\n## Result\n\n{result_body}\n"
    dep = cards.new_card(project="kb", action="dep-action", target="dep-target",
                         risk_tier="T1", body=body, state=state)
    cards.save(dep, queue_root)
    return dep


def _make_blocked_child(queue_root: Path, *, depends_on: list[str], **extra):
    import cards
    meta_extra = {"state": "blocked", "depends-on": depends_on}
    meta_extra.update(extra)
    child = cards.new_card(project="kb", action="child-action", target="child-target",
                           risk_tier="T1", body="## Work order\n\ndo the child\n",
                           **meta_extra)
    cards.save(child, queue_root)
    return child


def test_child_blocked_until_deps_done(tmp_path):
    import cards
    repo = _bare_repo(tmp_path)
    queue_root = repo / "queue"
    # Dep exists but is NOT done yet (still "working") -> child must stay blocked.
    dep = _make_dep(queue_root, state="working", result_body="dep output")
    child = _make_blocked_child(queue_root, depends_on=[dep.meta["id"]])

    dispatch.run(repo, "cloud", "dispatcher-cloud", today=datetime.date(2026, 7, 14))

    reread = cards.parse(child.path)
    assert reread.meta["state"] == "blocked"
    assert reread.meta["depends-on"] == [dep.meta["id"]]


def test_child_released_with_results_threaded(tmp_path):
    import cards
    repo = _bare_repo(tmp_path)
    queue_root = repo / "queue"
    dep1 = _make_dep(queue_root, state="done", result_body="first dep's output")
    dep2 = _make_dep(queue_root, state="done", result_body="second dep's output")
    child = _make_blocked_child(queue_root, depends_on=[dep1.meta["id"], dep2.meta["id"]])

    dispatch.run(repo, "cloud", "dispatcher-cloud", today=datetime.date(2026, 7, 14))

    reread = cards.parse(child.path)
    assert reread.meta["state"] == "inbox"
    assert "first dep's output" in reread.body
    assert "second dep's output" in reread.body
    # Original work order survives the threading.
    assert "do the child" in reread.body


def test_child_stays_blocked_when_one_dep_not_done(tmp_path):
    import cards
    repo = _bare_repo(tmp_path)
    queue_root = repo / "queue"
    dep1 = _make_dep(queue_root, state="done", result_body="first dep's output")
    dep2 = _make_dep(queue_root, state="working", result_body="second dep's output")
    child = _make_blocked_child(queue_root, depends_on=[dep1.meta["id"], dep2.meta["id"]])

    dispatch.run(repo, "cloud", "dispatcher-cloud", today=datetime.date(2026, 7, 14))

    reread = cards.parse(child.path)
    assert reread.meta["state"] == "blocked"


def test_child_stays_blocked_when_dep_card_unparseable(tmp_path):
    import cards
    repo = _bare_repo(tmp_path)
    queue_root = repo / "queue"
    dep = _make_dep(queue_root, state="done", result_body="dep output")
    child = _make_blocked_child(queue_root, depends_on=[dep.meta["id"]])
    # Corrupt the dep card on disk after it was created -- fail-closed must
    # leave the child blocked rather than raise or silently release it.
    dep.path.write_text("not a card at all, no frontmatter", encoding="utf-8")

    dispatch.run(repo, "cloud", "dispatcher-cloud", today=datetime.date(2026, 7, 14))

    reread = cards.parse(child.path)
    assert reread.meta["state"] == "blocked"


def test_release_never_routes_queues_for_me_child_to_inbox(tmp_path):
    """Security invariant: a blocked child whose OWN routing verdict was
    `queues-for-me` (destined for human approval) must never be act-alone
    released into `inbox` just because its deps finished -- and the pass must
    never upgrade its stamped autonomy/assurance_class either. cards.py's LEGAL
    map only allows blocked -> inbox (no blocked -> approvals), so the release
    pass's only safe move for such a card is to leave it blocked; some other,
    out-of-scope mechanism is responsible for eventually routing it to
    approvals. This proves the depends-on release pass cannot be used as a
    side channel to bypass an approvals gate."""
    import cards
    import promotion
    repo = _bare_repo(tmp_path)
    queue_root = repo / "queue"
    dep = _make_dep(queue_root, state="done", result_body="dep output")
    child = _make_blocked_child(
        queue_root, depends_on=[dep.meta["id"]],
        autonomy=promotion.QUEUES_FOR_ME, assurance_class="signed-only",
    )

    dispatch.run(repo, "cloud", "dispatcher-cloud", today=datetime.date(2026, 7, 14))

    reread = cards.parse(child.path)
    assert reread.meta["state"] == "blocked"
    assert reread.meta["autonomy"] == promotion.QUEUES_FOR_ME
    assert reread.meta["assurance_class"] == "signed-only"


def test_release_does_not_thread_into_a_non_depends_on_card(tmp_path):
    """A card with an empty depends-on (the common case -- every existing
    cadence-emitted card) must be completely untouched by the release pass."""
    import cards
    repo = _bare_repo(tmp_path)
    queue_root = repo / "queue"
    plain = cards.new_card(project="kb", action="a", target="t", risk_tier="T1",
                           body="## Work order\n\nplain\n", state="inbox")
    cards.save(plain, queue_root)

    dispatch.run(repo, "cloud", "dispatcher-cloud", today=datetime.date(2026, 7, 14))

    reread = cards.parse(plain.path)
    assert reread.meta["state"] == "inbox"
    assert reread.body == plain.body
