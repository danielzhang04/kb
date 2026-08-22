import datetime
import hashlib
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


# --------------------------------------------------------------------------- #
# Task 4.2 -- role-tagged cards + auto inspect sibling + main-ref standing-auth
# --------------------------------------------------------------------------- #
#
# solo-cadence (SOLO_HB, above) is already committed onto the repo's local
# `main` via _repo_on_main -- reused here as the base for an inspected cadence
# and for the main-ref divergence check, same discriminating trick
# test_standing_auth_requires_main_ref (tests/test_promotion.py) uses.

INSPECT_HB = """# Heartbeat — kb

```yaml
cadences:
  - name: solo-inspected
    schedule: daily
    tier: cloud
    risk-tier: T1
    inspect: true
    prompt: |
      Do a thing that gets inspected.
```
"""

BAD_ROLE_HB = """# Heartbeat — kb

```yaml
cadences:
  - name: bad-role-cadence
    schedule: daily
    tier: cloud
    risk-tier: T1
    role: manager
    prompt: |
      Has an invalid role value (must be one of cards.ROLES).
```
"""


def test_cadence_emits_work_and_inspect_sibling(tmp_path):
    import cards
    repo = _repo_on_main(tmp_path, INSPECT_HB)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 2
    parsed = [cards.parse(p) for p in emitted]
    work = next(c for c in parsed if c.meta["role"] == "work")
    inspect = next(c for c in parsed if c.meta["role"] == "inspect")

    assert work.meta["action"] == "cadence:solo-inspected"
    assert work.meta["state"] == "inbox"  # standing-authorized -> acts-alone
    assert work.meta["owner"] == "dispatcher-cloud"

    assert inspect.meta["depends-on"] == [work.meta["id"]]
    assert inspect.meta["state"] == "blocked"  # never released before its dep exists
    # role-identity owner, never the dispatching agent -- routines/roles/inspector.md
    assert inspect.meta["owner"] == "inspector@agents.local"
    # SECURITY: sibling must not carry a BROADER autonomy than the work card's
    # own promotion.decide()-computed verdict.
    assert inspect.meta["autonomy"] == work.meta["autonomy"]
    assert inspect.meta["assurance_class"] == work.meta["assurance_class"]


def test_standing_auth_only_from_main_ref(tmp_path):
    import cards
    repo = _repo_on_main(tmp_path, SOLO_HB)  # solo-cadence committed onto local main

    # Diverge the WORKING TREE only: add a second cadence never authored on
    # main. Prepended (not appended) so solo-cadence stays the LAST list item
    # in both the committed and the working-tree copy -- otherwise the FENCE
    # regex's `(.*?)\n\`\`\`` trailing-newline handling would make solo-cadence's
    # own `prompt` field read back differently depending on what follows it,
    # a parsing artifact unrelated to what this test is actually proving.
    rogue_hb = SOLO_HB.replace("cadences:\n", """cadences:
  - name: rogue-cadence
    schedule: daily
    tier: cloud
    risk-tier: T1
    prompt: |
      Never authored on main.
""", 1)
    (repo / "HEARTBEAT.md").write_text(rogue_hb, encoding="utf-8")

    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    by_action = {cards.parse(p).meta["action"]: cards.parse(p) for p in emitted}

    solo = by_action["cadence:solo-cadence"]
    assert solo.meta["state"] == "inbox"
    assert solo.meta["autonomy"] == "acts-alone"

    rogue = by_action["cadence:rogue-cadence"]
    assert rogue.meta["state"] == "approvals"
    assert rogue.meta["autonomy"] == "queues-for-me"


def test_invalid_role_cadence_fails_closed_no_card(tmp_path, capsys):
    repo = _repo_on_main(tmp_path, BAD_ROLE_HB)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert emitted == []
    assert "bad-role-cadence" in capsys.readouterr().out


# --------------------------------------------------------------------------- #
# Task 3.6 -- fail-closed tier-partition rule (D5 invariants closing gaps)    #
# --------------------------------------------------------------------------- #

BAD_TIER_HB = """# Heartbeat

```yaml
cadences:
  - name: mystery-cadence
    schedule: daily
    tier: gpu
    risk-tier: T1
    prompt: |
      Do a thing on an unknown tier.
```
"""


def test_unknown_tier_skipped_with_wake_me(tmp_path):
    import cards
    _write_project(tmp_path, "proj-a", BAD_TIER_HB)
    day = datetime.date(2026, 7, 14)

    cloud_emitted = dispatch.run(tmp_path, "cloud", "dispatcher-cloud", today=day)
    assert not any(cards.parse(p).meta.get("action") == "cadence:mystery-cadence"
                  for p in cloud_emitted)

    desktop_emitted = dispatch.run(tmp_path, "desktop", "dispatcher-desktop", today=day)
    assert not any(cards.parse(p).meta.get("action") == "cadence:mystery-cadence"
                  for p in desktop_emitted)

    def _wake_cards():
        return [cards.parse(p) for p in (tmp_path / "queue").glob("*/*.md")
                if cards.parse(p).meta.get("action") == "wake-me:unknown-tier"]

    wakes = _wake_cards()
    assert len(wakes) == 1
    assert wakes[0].meta["risk-tier"] == "T1"
    assert "proj-a" in wakes[0].meta["target"]
    assert "mystery-cadence" in wakes[0].meta["target"]

    # dedupe: repeated runs by EITHER dispatcher must not spam a second wake-me
    # for the same cadence.
    dispatch.run(tmp_path, "cloud", "dispatcher-cloud", today=day)
    dispatch.run(tmp_path, "desktop", "dispatcher-desktop", today=day)
    assert len(_wake_cards()) == 1


def test_no_cadence_claimable_by_both_dispatchers(tmp_path):
    """D5 #10: the tier partition is exclusive -- a cadence can only ever be
    claimed by the dispatcher matching its own declared `tier`, never both,
    no matter how many times either dispatcher runs the same day."""
    import cards
    repo = make_repo(tmp_path)  # nightly-review/weekly-audit=cloud, heavy-render=desktop
    day = datetime.date(2026, 7, 14)  # Tuesday: nightly-review + heavy-render due

    cloud_emitted = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day)
    desktop_emitted = dispatch.run(repo, "desktop", "dispatcher-desktop", today=day)

    cloud_actions = {cards.parse(p).meta["action"] for p in cloud_emitted}
    desktop_actions = {cards.parse(p).meta["action"] for p in desktop_emitted}

    assert cloud_actions == {"cadence:nightly-review"}
    assert desktop_actions == {"cadence:heavy-render"}
    assert cloud_actions.isdisjoint(desktop_actions)

    # Idempotent re-runs by BOTH dispatchers must not additionally claim
    # anything -- proving neither tier can later pick up the other's cadence.
    assert dispatch.run(repo, "cloud", "dispatcher-cloud", today=day) == []
    assert dispatch.run(repo, "desktop", "dispatcher-desktop", today=day) == []


# --------------------------------------------------------------------------- #
# Task 5.2 -- optional `agent:` cadence key routes card ownership             #
# --------------------------------------------------------------------------- #
#
# A cadence may name a worker via `agent:`; dispatch writes it into the WORK
# card's owner via cards.claim(card, agent) instead of the dispatching
# agent_id. Absent `agent:` is a no-op (backward-compatible: owner stays the
# dispatcher, exactly as every pre-5.2 test above already proves).

AGENT_KEY_HB = """# Heartbeat — kb

```yaml
cadences:
  - name: agent-cadence
    schedule: daily
    tier: cloud
    risk-tier: T1
    agent: codex-worker
    prompt: |
      Do a thing as codex-worker.
```
"""


def test_agent_key_sets_owner(tmp_path):
    import cards
    _write_project(tmp_path, "proj-a", AGENT_KEY_HB)
    emitted = dispatch.run(tmp_path, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1
    c = cards.parse(emitted[0])
    assert c.meta["owner"] == "codex-worker"


def test_absent_agent_key_keeps_dispatcher_owner(tmp_path):
    import cards
    # regression: no `agent:` key anywhere in this heartbeat -> owner stays the
    # dispatching agent_id, exactly as before Task 5.2.
    repo = make_repo(tmp_path)
    emitted = dispatch.run(repo, tier="cloud", agent_id="dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1
    c = cards.parse(emitted[0])
    assert c.meta["owner"] == "dispatcher-cloud"


# THINK+COVER: does `agent:` interact with promotion.decide()? decide() takes a
# `worker=` argument that keys the earned-autonomy grade-streak lookup
# (promotion.status()). A cadence's `agent:` key names a distinct EXECUTING
# identity -- so that identity's own streak, not the dispatcher's, must govern
# its autonomy verdict. Otherwise a freshly-named, zero-track-record worker
# would inherit whatever acts-alone streak the DISPATCHER happens to have
# earned for itself, which is a privilege-escalation bug, not a convenience.
# This proves worker=<named agent> is what decide() actually evaluates: a full
# earned T1 streak recorded under "codex-worker" (not under the dispatcher,
# "dispatcher-cloud") is what promotes agent-cadence to acts-alone.

AGENT_KEY_UNPROVEN_HB = """# Heartbeat — kb

```yaml
cadences:
  - name: agent-cadence
    schedule: daily
    tier: cloud
    risk-tier: T1
    agent: codex-worker
    prompt: |
      Do a thing as codex-worker.
```
"""


def _grade_row(*, worker, project, task_type, tier="T1", score=95, ts="000000"):
    return {"worker": worker, "project": project, "task_type": task_type,
            "tier": tier, "card_id": "c", "score": score, "pass": score >= 90,
            "rubric_version": "1", "inspector_id": "inspector", "ts": ts}


def test_agent_key_streak_governs_named_worker_not_dispatcher(tmp_path):
    import cards
    import ledger

    _write_project(tmp_path, "proj-a", AGENT_KEY_UNPROVEN_HB)
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "graders.yaml").write_text(
        "graders:\n  - inspector\n", encoding="utf-8")
    # A full T1 window (10 runs, all >= the 90 bar) recorded under the NAMED
    # agent, "codex-worker" -- never under "dispatcher-cloud", which has no
    # grade history for this key at all.
    for i in range(10):
        ledger.append(tmp_path, "grades", f"w{i}",
                      _grade_row(worker="codex-worker", project="proj-a",
                                 task_type="cadence:agent-cadence", ts=f"{i:06d}"))

    emitted = dispatch.run(tmp_path, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1
    c = cards.parse(emitted[0])
    assert c.meta["owner"] == "codex-worker"
    # Earned by codex-worker's own streak, not the dispatcher's (which has none
    # for this key) -- proves worker=<named agent>, not worker=agent_id.
    assert c.meta["autonomy"] == "acts-alone"
    assert c.meta["state"] == "inbox"


# --------------------------------------------------------------------------- #
# Task D1.1 -- session-id thread + due() paused-marker awareness              #
# --------------------------------------------------------------------------- #

def test_run_stamps_session_id_when_supplied(tmp_path):
    import cards
    repo = make_repo(tmp_path)
    emitted = dispatch.run(repo, tier="cloud", agent_id="dispatcher-cloud",
                           today=datetime.date(2026, 7, 14), session_id="sess-xyz")
    assert len(emitted) == 1
    c = cards.parse(emitted[0])
    assert c.meta["session-id"] == "sess-xyz"


def test_run_without_session_id_leaves_field_null(tmp_path):
    import cards
    repo = make_repo(tmp_path)
    emitted = dispatch.run(repo, tier="cloud", agent_id="dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    assert len(emitted) == 1
    c = cards.parse(emitted[0])
    assert c.meta["session-id"] is None


def test_due_skips_paused_cadence(tmp_path):
    import cards
    repo = make_repo(tmp_path)
    day = datetime.date(2026, 7, 14)  # Tuesday: nightly-review (cloud daily) is due
    paused_dir = repo / "queue" / "paused"
    paused_dir.mkdir(parents=True)
    (paused_dir / "nightly-review").write_text("paused 2026-07-14: investigating\n",
                                                encoding="utf-8")

    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day)
    assert emitted == []  # nightly-review suppressed; no other cloud cadence due today

    # A marker for one cadence must not affect an unrelated cadence -- add
    # weekly-audit's Saturday run and confirm it is unaffected by nightly's pause.
    sat = datetime.date(2026, 7, 18)
    emitted_sat = dispatch.run(repo, "cloud", "dispatcher-cloud", today=sat)
    assert len(emitted_sat) == 1
    assert cards.parse(emitted_sat[0]).meta["action"] == "cadence:weekly-audit"

    # Removing the marker restores nightly-review's next beat.
    (paused_dir / "nightly-review").unlink()
    wed = datetime.date(2026, 7, 15)
    emitted_wed = dispatch.run(repo, "cloud", "dispatcher-cloud", today=wed)
    assert len(emitted_wed) == 1
    assert cards.parse(emitted_wed[0]).meta["action"] == "cadence:nightly-review"


def test_due_paused_check_is_repo_root_aware_and_backward_compatible():
    # Existing two-positional-arg call sites (no repo_root) must keep working
    # unchanged -- this is the pre-D1.1 regression surface.
    sat = datetime.date(2026, 7, 18)
    tue = datetime.date(2026, 7, 14)
    daily = {"name": "n", "schedule": "daily"}
    weekly = {"name": "w", "schedule": "weekly:sat"}
    assert dispatch.due(daily, tue) is True
    assert dispatch.due(weekly, sat) is True
    assert dispatch.due(weekly, tue) is False


# --------------------------------------------------------------------------- #
# Phase R1.3 -- routing resolution at claim + owner-by-runtime                 #
# --------------------------------------------------------------------------- #
#
# A tmp-path policy fixture (governance/model-routing.yaml does NOT exist in the
# repo yet -- Daniel commits it at gate R1.0). work/T1 routes to codex, work/T3
# to claude, so a single policy exercises both owner-by-runtime branches.

R1_POLICY = """\
version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases:
      opus: claude-opus-4-8
      sonnet: claude-sonnet-5
      haiku: claude-haiku-4-5
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker
    aliases:
      codex: gpt-5-codex
    known_models: [gpt-5-codex]
policy:
  work:
    T1: { runtime: codex, model: codex }
    T3: { runtime: claude, model: opus }
role_default: { runtime: claude, model: sonnet }
"""


def _write_r1_policy(repo: Path) -> None:
    gov = repo / "governance"
    gov.mkdir(parents=True, exist_ok=True)
    (gov / "model-routing.yaml").write_text(R1_POLICY, encoding="utf-8")


def _hb(name, *, tier="cloud", risk="T1", extra_lines=""):
    lines = [
        "# Heartbeat — kb", "", "```yaml", "cadences:",
        f"  - name: {name}", f"    schedule: daily", f"    tier: {tier}",
        f"    risk-tier: {risk}",
    ]
    for line in extra_lines.splitlines():
        if line.strip():
            lines.append("    " + line)
    lines += ["    prompt: |", "      Do the thing.", "```", ""]
    return "\n".join(lines)


def test_run_stamps_routing_from_policy(tmp_path):
    import cards
    # work/T3, no agent, inspect sibling -> stamp claude/opus on the WORK card
    # only, never the inspect sibling.
    repo = _repo_on_main(tmp_path, _hb("routed-work", risk="T3", extra_lines="inspect: true"))
    _write_r1_policy(repo)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    parsed = [cards.parse(p) for p in emitted]
    work = next(c for c in parsed if c.meta["role"] == "work")
    inspect = next(c for c in parsed if c.meta["role"] == "inspect")
    assert work.meta["runtime"] == "claude"
    assert work.meta["model"] == "claude-opus-4-8"
    # the inspect sibling is never stamped -- a fresh session grades it later.
    assert inspect.meta["runtime"] is None
    assert inspect.meta["model"] is None


def test_run_owner_selected_from_resolved_runtime(tmp_path):
    import cards
    # work/T1 -> codex (policy) with no cadence agent -> owner == codex-worker.
    repo_codex = _repo_on_main(tmp_path / "c", _hb("codex-work", risk="T1"))
    _write_r1_policy(repo_codex)
    emitted = dispatch.run(repo_codex, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    c = cards.parse(emitted[0])
    assert c.meta["owner"] == "codex-worker"
    assert c.meta["runtime"] == "codex"

    # work/T3 -> claude (policy), no agent -> owner == claude default_worker.
    repo_claude = _repo_on_main(tmp_path / "d", _hb("claude-work", risk="T3"))
    _write_r1_policy(repo_claude)
    emitted2 = dispatch.run(repo_claude, "cloud", "dispatcher-cloud",
                            today=datetime.date(2026, 7, 14))
    c2 = cards.parse(emitted2[0])
    assert c2.meta["owner"] == "worker-desktop"
    assert c2.meta["runtime"] == "claude"


def test_cadence_agent_still_wins_for_owner(tmp_path):
    import cards
    # Pins agent: codex-worker AND carries a card-frontmatter runtime/model that
    # resolves to codex -> the pinned owner is kept, the registered runtime
    # agrees, routing stamps codex verbatim.
    repo = _repo_on_main(tmp_path, _hb(
        "pinned-codex", risk="T1",
        extra_lines="agent: codex-worker\nruntime: codex\nmodel: gpt-5-codex"))
    _write_r1_policy(repo)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    c = cards.parse(emitted[0])
    assert c.meta["owner"] == "codex-worker"
    assert c.meta["runtime"] == "codex"
    assert c.meta["model"] == "gpt-5-codex"


def test_pinned_owner_runtime_conflict_emits_wake_and_skips(tmp_path):
    import cards
    # Pins agent: codex-worker but policy (work/T3) routes to claude -> conflict:
    # wake-me:owner-runtime-mismatch, and the work card is NOT dispatched.
    repo = _repo_on_main(tmp_path, _hb(
        "conflict", risk="T3", extra_lines="agent: codex-worker"))
    _write_r1_policy(repo)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    actions = {cards.parse(p).meta["action"] for p in emitted}
    assert "cadence:conflict" not in actions  # skipped
    wakes = [cards.parse(p) for p in (repo / "queue").glob("*/*.md")
             if cards.parse(p).meta.get("action") == "wake-me:owner-runtime-mismatch"]
    assert len(wakes) == 1
    assert "conflict" in wakes[0].meta["target"]


def test_card_frontmatter_override_wins_in_dispatch(tmp_path):
    import cards
    # A cadence carrying runtime/model (self-route) stamps those verbatim over
    # policy (work/T3 would otherwise be claude/opus).
    repo = _repo_on_main(tmp_path, _hb(
        "self-route", risk="T3",
        extra_lines="runtime: claude\nmodel: claude-haiku-4-5"))
    _write_r1_policy(repo)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    c = cards.parse(emitted[0])
    assert c.meta["runtime"] == "claude"
    assert c.meta["model"] == "claude-haiku-4-5"  # card override, not policy opus


def test_unroutable_card_emits_wake_and_skips(tmp_path):
    import cards
    # A cadence naming an unknown model -> RoutingError -> wake-me:unroutable-card,
    # and the work card is NOT dispatched (never a silent default substitution).
    repo = _repo_on_main(tmp_path, _hb(
        "bad-model", risk="T1",
        extra_lines="runtime: claude\nmodel: claude-ultra-9"))
    _write_r1_policy(repo)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    actions = {cards.parse(p).meta["action"] for p in emitted}
    assert "cadence:bad-model" not in actions  # skipped, never dispatched
    wakes = [cards.parse(p) for p in (repo / "queue").glob("*/*.md")
             if cards.parse(p).meta.get("action") == "wake-me:unroutable-card"]
    assert len(wakes) == 1
    assert "bad-model" in wakes[0].meta["target"]

    # dedupe: a second run does not file a second wake-me.
    dispatch.run(repo, "cloud", "dispatcher-cloud", today=datetime.date(2026, 7, 15))
    wakes2 = [cards.parse(p) for p in (repo / "queue").glob("*/*.md")
              if cards.parse(p).meta.get("action") == "wake-me:unroutable-card"]
    assert len(wakes2) == 1


def test_routing_absent_policy_keeps_dispatcher_owner_and_safe_default(tmp_path):
    import cards
    # No policy file at all (the reality until gate R1.0): owner stays the
    # dispatcher (default_worker_for -> None -> fallback), and the card is
    # stamped with the built-in safe default.
    import routing
    repo = make_repo(tmp_path)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud",
                           today=datetime.date(2026, 7, 14))
    c = cards.parse(emitted[0])
    assert c.meta["owner"] == "dispatcher-cloud"
    assert (c.meta["runtime"], c.meta["model"]) == routing.SAFE_DEFAULT


# --------------------------------------------------------------------------- #
# Wave F -- escalation-on-failure requeue (Quartermaster delta 1)             #
# --------------------------------------------------------------------------- #
#
# requeue() bumps a failed card one MODEL tier up (routing.escalate_model over
# routing.TIER_LADDER -- the single canonical ladder), increments a `retry_count`
# frontmatter counter, and dead-letters to `rejected` + files one deduped
# wake-me:dead-letter once the cap (RETRY_CAP=2) is spent. The R1_POLICY fixture
# above supplies the claude alias ladder (haiku->sonnet->opus) requeue reads.


def _routed_card(queue_root: Path, *, model, runtime="claude", retry_count=None,
                 state="working", owner="worker-desktop"):
    import cards
    extra = {"state": state, "owner": owner, "runtime": runtime, "model": model}
    if retry_count is not None:
        extra["retry_count"] = retry_count
    card = cards.new_card(project="kb", action="cadence:x", target="orgs/kb",
                          risk_tier="T1", body="## Work order\n\ndo it\n", **extra)
    cards.save(card, queue_root)
    return card


def test_requeue_escalates_one_tier(tmp_path):
    import cards
    _write_r1_policy(tmp_path)
    card = _routed_card(tmp_path / "queue", model="claude-sonnet-5")
    rep = dispatch.requeue(tmp_path, card, failure_summary="boom on attempt 1")
    assert rep["outcome"] == "escalated"
    assert rep["model"] == "claude-opus-4-8"   # sonnet -> opus, one tier up
    assert rep["retry_count"] == 1
    reread = cards.parse(rep["path"])
    assert reread.meta["model"] == "claude-opus-4-8"
    assert reread.meta["retry_count"] == 1
    assert reread.meta["state"] == "inbox"
    assert rep["path"].parent.name == "inbox"
    assert "boom on attempt 1" in reread.body  # failure summary threaded as ## Feedback


def test_requeue_negative_retry_count_clamped_to_cap(tmp_path):
    """A negative retry_count (mis-set or crafted) must not widen the cap:
    it reads as 0, so the card gets exactly the normal 3 attempts."""
    import cards
    _write_r1_policy(tmp_path)
    card = _routed_card(tmp_path / "queue", model="claude-sonnet-5")
    card.meta["retry_count"] = -5
    cards.save(card, tmp_path / "queue")
    rep = dispatch.requeue(tmp_path, card, failure_summary="boom")
    assert rep["retry_count"] == 1             # -5 clamps to 0, then +1
    reread = cards.parse(rep["path"])
    rep2 = dispatch.requeue(tmp_path, reread, failure_summary="boom 2")
    assert rep2["retry_count"] == 2
    rep3 = dispatch.requeue(tmp_path, cards.parse(rep2["path"]), failure_summary="boom 3")
    assert rep3["outcome"] == "dead-lettered"  # cap still bounds at 2


def test_requeue_top_tier_no_bump_still_counts(tmp_path):
    import cards
    _write_r1_policy(tmp_path)
    card = _routed_card(tmp_path / "queue", model="claude-opus-4-8")  # already top
    rep = dispatch.requeue(tmp_path, card)
    assert rep["outcome"] == "retried-same-tier"
    assert rep["model"] == "claude-opus-4-8"   # no bump at the top tier
    assert rep["retry_count"] == 1             # ...but the attempt still counts
    reread = cards.parse(rep["path"])
    assert reread.meta["model"] == "claude-opus-4-8"
    assert reread.meta["retry_count"] == 1


def test_requeue_cap_dead_letters_and_mints_wake(tmp_path):
    import cards
    _write_r1_policy(tmp_path)
    # Already retried to the cap -> the next failure dead-letters instead of bumping.
    card = _routed_card(tmp_path / "queue", model="claude-opus-4-8", retry_count=2)
    rep = dispatch.requeue(tmp_path, card, failure_summary="still broken")
    assert rep["outcome"] == "dead-lettered"
    reread = cards.parse(rep["path"])
    assert reread.meta["state"] == dispatch.DEAD_LETTER_STATE == "rejected"
    assert rep["path"].parent.name == "done"   # rejected resolves to queue/done/
    wakes = [cards.parse(p) for p in (tmp_path / "queue").glob("*/*.md")
             if cards.parse(p).meta.get("action") == "wake-me:dead-letter"]
    assert len(wakes) == 1
    assert wakes[0].meta["target"] == card.meta["id"]        # id
    assert "cadence:x" in wakes[0].body                      # action
    assert "claude-opus-4-8" in wakes[0].body                # last model
    assert "still broken" in wakes[0].body                   # failure summary


def test_requeue_dead_letter_wake_is_deduped(tmp_path):
    import cards
    _write_r1_policy(tmp_path)
    card = _routed_card(tmp_path / "queue", model="claude-opus-4-8", retry_count=2)
    dispatch.requeue(tmp_path, card, failure_summary="a")
    # Requeue the same exhausted card again -> still dead-lettered, but NO 2nd wake.
    dispatch.requeue(tmp_path, card, failure_summary="b")
    wakes = [p for p in (tmp_path / "queue").glob("*/*.md")
             if cards.parse(p).meta.get("action") == "wake-me:dead-letter"]
    assert len(wakes) == 1


def test_requeue_retry_count_persists_across_round_trip(tmp_path):
    import cards
    _write_r1_policy(tmp_path)
    # haiku -> sonnet -> opus, with the counter surviving each parse/save round-trip.
    card = _routed_card(tmp_path / "queue", model="claude-haiku-4-5")
    rep = dispatch.requeue(tmp_path, card)
    assert rep["model"] == "claude-sonnet-5" and rep["retry_count"] == 1
    reread = cards.parse(rep["path"])
    assert reread.meta["retry_count"] == 1
    # Escalate again from the RE-PARSED card (proves the counter is read off disk).
    rep2 = dispatch.requeue(tmp_path, reread)
    assert rep2["model"] == "claude-opus-4-8" and rep2["retry_count"] == 2
    assert cards.parse(rep2["path"]).meta["retry_count"] == 2


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


def test_cards_render_is_the_exact_byte_source_used_by_save(tmp_path):
    import cards

    card = cards.new_card(project="kb", action="cadence:hygiene", target="agents/hygiene.md",
                          risk_tier="T1", body="## Work order\n\nRun Hygiene.\n")
    card.meta["id"] = "01234567-89abcdef"
    expected = cards.render(card)
    path = cards.save(card, tmp_path / "queue")
    assert path.read_bytes() == expected
    assert hashlib.sha256(expected).hexdigest() == hashlib.sha256(path.read_bytes()).hexdigest()
