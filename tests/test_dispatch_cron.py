"""Task 7 — 5-field cron in `dispatch.due()`, occurrence-level dedup, card stamps.

Pins (plan `docs/superpowers/plans/2026-08-18-agent-infra.md` §Task 7, spec §5):
  * the legacy `daily` / `weekly:<day>` forms behave EXACTLY as before (bare
    `weekly` stays non-firing);
  * `schedule:` additionally accepts 5-field cron in LOCAL time, fired
    skip-not-replay (most recent occurrence today, missed ones never replayed);
  * a cron cadence fires at most once PER OCCURRENCE (ledger dedup gains
    `scheduled_for`), while legacy cadences keep their per-day dedup;
  * re-timing a cadence voids standing authorization, because timing lives
    inside the `schedule:` string that `promotion._cadence_matches` byte-compares;
  * the six live cadence blocks stay byte-unchanged.
"""
import datetime as dt
import json
import subprocess
from pathlib import Path

import cards
import dispatch
import ledger
import promotion
from test_dispatch import _commit_onto_local_main, make_repo

REPO_ROOT = Path(__file__).resolve().parents[1]

CRON_HB = """# Heartbeat — cron test

```yaml
cadences:
  - name: cron-nightly
    schedule: "3 7 * * *"
    tier: cloud
    risk-tier: T1
    prompt: |
      Cron work.
```
"""

TWICE_HB = CRON_HB.replace('"3 7 * * *"', '"3 7,16 * * *"')
TYPO_HB = CRON_HB.replace('"3 7 * * *"', '"3 25 * * *"')      # hour 25: meant as cron
INSPECT_HB = CRON_HB.replace("    prompt: |", "    inspect: true\n    prompt: |")
DAILY_HB = CRON_HB.replace('"3 7 * * *"', "daily")


def make_cron_repo(tmp_path: Path, heartbeat: str = CRON_HB) -> Path:
    proj = tmp_path / "orgs" / "proj-a"
    proj.mkdir(parents=True)
    (proj / "HEARTBEAT.md").write_text(heartbeat, encoding="utf-8")
    _commit_onto_local_main(tmp_path)
    return tmp_path


def _dispatch_rows(repo: Path) -> list[dict]:
    # run() reads/writes the WALL-CLOCK day shard even when `today` is injected
    # (dispatch.run's ledger_day comment) — read the same shard here.
    return ledger.read_day(repo, "dispatch", dt.date.today().isoformat())


# --------------------------------------------------------------------------- #
# Legacy forms — byte-for-byte identical behaviour                            #
# --------------------------------------------------------------------------- #

def test_legacy_forms_unchanged():
    d = dt.date(2026, 8, 22)  # a Saturday
    assert due_bool({"name": "x", "schedule": "daily"}, d) is True
    assert due_bool({"name": "x", "schedule": "weekly:sat"}, d) is True
    assert due_bool({"name": "x", "schedule": "weekly"}, d) is False   # bare weekly stays dead
    assert due_bool({"name": "x", "schedule": "monthly"}, d) is False
    assert due_bool({"name": "x", "schedule": ""}, d) is False
    assert due_bool({"name": "x"}, d) is False


def due_bool(cadence, day, **kw) -> bool:
    """`due()` must keep returning a real bool (existing tests assert `is True`)."""
    out = dispatch.due(cadence, day, **kw)
    assert out is True or out is False
    return out


def test_legacy_weekday_mapping_is_untouched():
    for name, day in (("mon", dt.date(2026, 8, 17)), ("tue", dt.date(2026, 8, 18)),
                      ("wed", dt.date(2026, 8, 19)), ("thu", dt.date(2026, 8, 20)),
                      ("fri", dt.date(2026, 8, 21)), ("sat", dt.date(2026, 8, 22)),
                      ("sun", dt.date(2026, 8, 23))):
        assert due_bool({"name": "w", "schedule": f"weekly:{name}"}, day) is True
        assert due_bool({"name": "w", "schedule": f"weekly:{name}"},
                        day + dt.timedelta(days=1)) is False


# --------------------------------------------------------------------------- #
# parse_cron / cron_matches / latest_occurrence — pure helpers                 #
# --------------------------------------------------------------------------- #

def test_cron_parse_and_match():
    spec = dispatch.parse_cron("3 7 * * mon,thu")
    assert dispatch.cron_matches(spec, dt.datetime(2026, 8, 20, 7, 3))    # a Thursday
    assert not dispatch.cron_matches(spec, dt.datetime(2026, 8, 20, 7, 4))
    assert not dispatch.cron_matches(spec, dt.datetime(2026, 8, 21, 7, 3))  # Friday
    assert dispatch.parse_cron("daily") is None                            # legacy passthrough
    assert dispatch.parse_cron("weekly:sat") is None
    assert dispatch.parse_cron("weekly") is None
    assert dispatch.parse_cron("") is None


def test_cron_field_forms_lists_ranges_steps():
    every_15 = dispatch.parse_cron("*/15 * * * *")
    for minute, hit in ((0, True), (15, True), (30, True), (45, True), (7, False)):
        assert dispatch.cron_matches(every_15, dt.datetime(2026, 8, 20, 9, minute)) is hit

    workday = dispatch.parse_cron("0 9-17 * * mon-fri")
    assert dispatch.cron_matches(workday, dt.datetime(2026, 8, 20, 17, 0))
    assert not dispatch.cron_matches(workday, dt.datetime(2026, 8, 20, 18, 0))
    assert not dispatch.cron_matches(workday, dt.datetime(2026, 8, 22, 9, 0))  # Saturday

    stepped_range = dispatch.parse_cron("0 0-12/6 * * *")
    assert {h for h in range(24)
            if dispatch.cron_matches(stepped_range, dt.datetime(2026, 8, 20, h, 0))} == {0, 6, 12}

    numeric_dow = dispatch.parse_cron("0 0 * * 0")          # cron 0 == Sunday
    assert dispatch.cron_matches(numeric_dow, dt.datetime(2026, 8, 23, 0, 0))
    assert dispatch.cron_matches(dispatch.parse_cron("0 0 * * 7"),
                                 dt.datetime(2026, 8, 23, 0, 0))  # 7 is Sunday too
    assert not dispatch.cron_matches(numeric_dow, dt.datetime(2026, 8, 24, 0, 0))

    monthly = dispatch.parse_cron("0 5 1 * *")
    assert dispatch.cron_matches(monthly, dt.datetime(2026, 9, 1, 5, 0))
    assert not dispatch.cron_matches(monthly, dt.datetime(2026, 9, 2, 5, 0))

    month_field = dispatch.parse_cron("0 5 * 9 *")
    assert dispatch.cron_matches(month_field, dt.datetime(2026, 9, 2, 5, 0))
    assert not dispatch.cron_matches(month_field, dt.datetime(2026, 8, 2, 5, 0))


def test_restricted_dom_and_dow_are_ored_like_vixie_cron():
    spec = dispatch.parse_cron("0 0 13 * fri")
    assert dispatch.cron_matches(spec, dt.datetime(2026, 11, 13, 0, 0))   # 13th AND Friday
    assert dispatch.cron_matches(spec, dt.datetime(2026, 8, 13, 0, 0))    # 13th, a Thursday
    assert dispatch.cron_matches(spec, dt.datetime(2026, 8, 21, 0, 0))    # a Friday
    assert not dispatch.cron_matches(spec, dt.datetime(2026, 8, 20, 0, 0))


def test_a_stepped_day_field_counts_as_star_for_the_vixie_rule():
    """`*/2` STARTS with `*`, so it sets the star flag exactly as a bare `*`
    does — and the star branch AND-s the two day fields, which both keeps the
    step honoured and stops the OR branch from firing on every stepped weekday."""
    spec = dispatch.parse_cron("0 0 13 * */2")
    assert (spec.dom_star, spec.dow_star) == (False, True)
    # Was the defect: with a bare-`*` test neither flag set, the fields OR-ed,
    # and every even-numbered weekday fired even though the author wrote `13`.
    assert not dispatch.cron_matches(spec, dt.datetime(2026, 8, 20, 0, 0))  # Thu, not the 13th
    assert dispatch.cron_matches(spec, dt.datetime(2026, 8, 13, 0, 0))      # 13th, cron dow 4
    assert not dispatch.cron_matches(spec, dt.datetime(2026, 11, 13, 0, 0))  # 13th, cron dow 5
    # A bare `*` degenerates through the same AND branch: the other field decides.
    assert (dispatch.parse_cron("0 0 13 * *").dow_star,
            dispatch.parse_cron("0 0 * * fri").dom_star) == (True, True)
    assert dispatch.cron_matches(dispatch.parse_cron("0 0 13 * *"),
                                 dt.datetime(2026, 11, 13, 0, 0))
    # ...and a stepped day-of-month field narrows on its own, never silently.
    every_other_dom = dispatch.parse_cron("0 0 */2 * *")
    assert dispatch.cron_matches(every_other_dom, dt.datetime(2026, 8, 19, 0, 0))
    assert not dispatch.cron_matches(every_other_dom, dt.datetime(2026, 8, 20, 0, 0))


def test_malformed_cron_is_not_cron_and_never_fires():
    for expr in ("3 7 * *", "3 7 * * * *", "70 7 * * *", "3 25 * * *",
                 "3 7 32 * *", "3 7 * 13 *", "3 7 * * funday", "* * * * ",
                 "a b c d e", "3-1 7 * * *", "*/0 * * * *"):
        assert dispatch.parse_cron(expr) is None, expr
        # Unparseable timing is INERT, exactly like `schedule: monthly` today.
        assert due_bool({"name": "x", "schedule": expr}, dt.date(2026, 8, 20),
                        now=dt.datetime(2026, 8, 20, 12, 0)) is False


def test_malformed_cron_wakes_a_human_and_still_never_fires(tmp_path):
    """Five fields that do not parse can only be an intended-cron typo (no legacy
    form contains whitespace), so it wakes a human instead of going quietly
    inert — the way a cadence disappears for months."""
    repo = make_cron_repo(tmp_path, TYPO_HB)
    day, now = dt.date(2026, 8, 20), dt.datetime(2026, 8, 20, 15, 0)

    assert dispatch.run(repo, "cloud", "dispatcher-cloud", today=day, now=now) == []
    assert _dispatch_rows(repo) == []                       # non-firing, as before
    wakes = [cards.parse(p) for p in (repo / "queue").glob("*/*.md")]
    wake = next(c for c in wakes if c.meta["action"] == dispatch.MALFORMED_CRON_ACTION)
    assert wake.meta["target"] == "proj-a:cron-nightly"
    assert "3 25 * * *" in wake.body

    # One card per (action, target), however many ticks — same rule as the
    # unknown-tier wake it mirrors.
    dispatch.run(repo, "cloud", "dispatcher-cloud", today=day, now=now)
    dispatch.run(repo, "desktop", "dispatcher-desktop", today=day, now=now)
    assert sum(1 for p in (repo / "queue").glob("*/*.md")
               if cards.parse(p).meta["action"] == dispatch.MALFORMED_CRON_ACTION) == 1


def test_malformed_cron_predicate_never_flags_a_legacy_form():
    for legacy in ("daily", "weekly:sat", "weekly", "monthly", "", None):
        assert dispatch.malformed_cron(legacy) is False
    for typo in ("3 25 * * *", "3 7 * * funday", "a b c d e"):
        assert dispatch.malformed_cron(typo) is True
    assert dispatch.malformed_cron("3 7 * * mon") is False   # a valid cron is not a typo


def test_latest_occurrence_same_day_only_skip_not_replay():
    spec = dispatch.parse_cron("3 7 * * *")
    now = dt.datetime(2026, 8, 20, 15, 0)
    assert dispatch.latest_occurrence(spec, now) == dt.datetime(2026, 8, 20, 7, 3)
    early = dt.datetime(2026, 8, 20, 6, 0)
    assert dispatch.latest_occurrence(spec, early) is None                 # not yet due today


def test_latest_occurrence_picks_the_most_recent_of_several():
    spec = dispatch.parse_cron("0,30 * * * *")
    assert dispatch.latest_occurrence(spec, dt.datetime(2026, 8, 20, 9, 45)) == \
        dt.datetime(2026, 8, 20, 9, 30)
    assert dispatch.latest_occurrence(spec, dt.datetime(2026, 8, 20, 9, 15)) == \
        dt.datetime(2026, 8, 20, 9, 0)
    # No occurrence on a non-matching day, however late in that day it is.
    friday_only = dispatch.parse_cron("0 8 * * fri")
    assert dispatch.latest_occurrence(friday_only, dt.datetime(2026, 8, 20, 23, 59)) is None


# --------------------------------------------------------------------------- #
# due() — cron branch                                                          #
# --------------------------------------------------------------------------- #

def test_due_cron_is_local_time_and_same_day():
    cadence = {"name": "c", "schedule": "3 7 * * *"}
    day = dt.date(2026, 8, 20)
    assert due_bool(cadence, day, now=dt.datetime(2026, 8, 20, 7, 3)) is True
    assert due_bool(cadence, day, now=dt.datetime(2026, 8, 20, 23, 59)) is True
    assert due_bool(cadence, day, now=dt.datetime(2026, 8, 20, 7, 2)) is False
    # dispatch is a same-day scheduler: an injected `today` that is not the
    # clock's day never fires a cron cadence (no backfill, no replay).
    assert due_bool(cadence, dt.date(2026, 8, 21), now=dt.datetime(2026, 8, 20, 9, 0)) is False


def test_due_cron_respects_the_pause_sentinel(tmp_path):
    cadence = {"name": "cron-nightly", "schedule": "3 7 * * *"}
    now = dt.datetime(2026, 8, 20, 9, 0)
    day = dt.date(2026, 8, 20)
    assert due_bool(cadence, day, repo_root=tmp_path, now=now) is True
    paused = tmp_path / "queue" / "paused"
    paused.mkdir(parents=True)
    (paused / "cron-nightly").write_text("paused\n", encoding="utf-8")
    assert due_bool(cadence, day, repo_root=tmp_path, now=now) is False


# --------------------------------------------------------------------------- #
# Occurrence dedup in the dispatch loop + card stamps                          #
# --------------------------------------------------------------------------- #

def test_due_cron_fires_once_per_occurrence(tmp_path):
    """Occurrence-level dedup: the ledger row records `scheduled_for`, and a
    second tick inside the same occurrence emits nothing.

    (Dedup lives in the dispatch loop, not in `due()`: the dedup key is
    `(project, cadence, occurrence)` and `due()` is not given the project.)
    """
    repo = make_cron_repo(tmp_path)
    day, now = dt.date(2026, 8, 20), dt.datetime(2026, 8, 20, 15, 0)

    first = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day, now=now)
    assert len(first) == 1
    rows = _dispatch_rows(repo)
    assert len(rows) == 1
    assert rows[0]["cadence"] == "cron-nightly"
    assert rows[0]["scheduled_for"] == "2026-08-20T07:03:00"

    second = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day,
                          now=dt.datetime(2026, 8, 20, 15, 30))
    assert second == []
    assert len(_dispatch_rows(repo)) == 1


def test_a_later_occurrence_fires_again_the_same_day(tmp_path):
    repo = make_cron_repo(tmp_path, TWICE_HB)
    day = dt.date(2026, 8, 20)

    assert len(dispatch.run(repo, "cloud", "dispatcher-cloud", today=day,
                            now=dt.datetime(2026, 8, 20, 15, 0))) == 1
    assert len(dispatch.run(repo, "cloud", "dispatcher-cloud", today=day,
                            now=dt.datetime(2026, 8, 20, 16, 30))) == 1
    assert sorted(r["scheduled_for"] for r in _dispatch_rows(repo)) == \
        ["2026-08-20T07:03:00", "2026-08-20T16:03:00"]
    # ...and the second occurrence does not re-fire either.
    assert dispatch.run(repo, "cloud", "dispatcher-cloud", today=day,
                        now=dt.datetime(2026, 8, 20, 17, 0)) == []


def test_missed_occurrences_are_skipped_never_replayed(tmp_path):
    repo = make_cron_repo(tmp_path, TWICE_HB)
    day = dt.date(2026, 8, 20)
    # The dispatcher was asleep through 07:03 and only ticks at 16:30: it fires
    # ONCE, for the latest occurrence — 07:03 is skipped, never replayed.
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day,
                           now=dt.datetime(2026, 8, 20, 16, 30))
    assert len(emitted) == 1
    assert [r["scheduled_for"] for r in _dispatch_rows(repo)] == ["2026-08-20T16:03:00"]


def test_cron_card_carries_scheduled_for_and_dispatched_at_stamps(tmp_path):
    repo = make_cron_repo(tmp_path)
    day, now = dt.date(2026, 8, 20), dt.datetime(2026, 8, 20, 15, 0)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day, now=now)
    card = cards.parse(emitted[0])
    assert card.meta["scheduled_for"] == "2026-08-20T07:03:00"
    assert card.meta["dispatched_at"] == "2026-08-20T15:00:00"


def test_inspect_sibling_carries_the_same_occurrence_stamps(tmp_path):
    repo = make_cron_repo(tmp_path, INSPECT_HB)
    day, now = dt.date(2026, 8, 20), dt.datetime(2026, 8, 20, 15, 0)
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day, now=now)
    parsed = [cards.parse(p) for p in emitted]
    work = next(c for c in parsed if c.meta["role"] == "work")
    sibling = next(c for c in parsed if c.meta["role"] == "inspect")
    assert sibling.meta["depends-on"] == [work.meta["id"]]
    # Same occurrence as the card it grades — a sibling that named a different
    # occurrence would be grading a run that never happened.
    assert sibling.meta["scheduled_for"] == work.meta["scheduled_for"] == "2026-08-20T07:03:00"
    assert sibling.meta["dispatched_at"] == work.meta["dispatched_at"] == "2026-08-20T15:00:00"


def test_stamp_schedule_is_a_setter_on_cards(tmp_path):
    card = cards.new_card(project="kb", action="cadence:x", target="orgs/kb-ops",
                          risk_tier="T1", body="b")
    cards.stamp_schedule(card, "2026-08-20T07:03:00", "2026-08-20T15:00:00")
    assert card.meta["scheduled_for"] == "2026-08-20T07:03:00"
    assert card.meta["dispatched_at"] == "2026-08-20T15:00:00"
    # A stamped card still validates and round-trips through save/parse.
    path = cards.save(card, tmp_path / "queue")
    assert cards.parse(path).meta["dispatched_at"] == "2026-08-20T15:00:00"


# --------------------------------------------------------------------------- #
# Ledger back-compatibility                                                    #
# --------------------------------------------------------------------------- #

def test_legacy_cadence_records_scheduled_for_and_still_dedups_per_day(tmp_path):
    repo = make_repo(tmp_path)                       # daily/weekly fixture cadences
    day = dt.date(2026, 7, 14)                       # a Tuesday
    first = dispatch.run(repo, "cloud", "dispatcher-cloud", today=day)
    assert len(first) == 1
    rows = _dispatch_rows(repo)
    assert rows[0]["scheduled_for"] == "2026-07-14"   # the day itself, additive
    assert dispatch.run(repo, "cloud", "dispatcher-cloud", today=day) == []


def test_pre_existing_rows_without_scheduled_for_still_dedup(tmp_path):
    """Old rows (written before this field existed) must keep suppressing a
    re-dispatch exactly as today — for legacy AND cron cadences alike."""
    repo = make_repo(tmp_path)
    day = dt.date(2026, 7, 14)
    ledger.append(repo, "dispatch", "dispatcher-cloud",
                  {"date": day.isoformat(), "cadence": "nightly-review",
                   "project": "proj-a", "card": "old-card"})
    assert dispatch.run(repo, "cloud", "dispatcher-cloud", today=day) == []

    cron_repo = make_cron_repo(tmp_path / "cron")
    ledger.append(cron_repo, "dispatch", "dispatcher-cloud",
                  {"date": "2026-08-20", "cadence": "cron-nightly",
                   "project": "proj-a", "card": "old-card"})
    assert dispatch.run(cron_repo, "cloud", "dispatcher-cloud",
                        today=dt.date(2026, 8, 20),
                        now=dt.datetime(2026, 8, 20, 15, 0)) == []


def test_re_timing_daily_to_cron_mid_day_does_not_double_fire(tmp_path):
    """A day-wide stamp (`2026-08-20`, or a row that lost the column) suppresses
    EVERY occurrence of that cadence today — so swapping `daily` for cron between
    two ticks cannot buy a second run out of the same day."""
    repo = make_cron_repo(tmp_path, DAILY_HB)
    day = dt.date(2026, 8, 20)
    assert len(dispatch.run(repo, "cloud", "dispatcher-cloud", today=day,
                            now=dt.datetime(2026, 8, 20, 6, 0))) == 1
    assert _dispatch_rows(repo)[0]["scheduled_for"] == "2026-08-20"

    (repo / "orgs" / "proj-a" / "HEARTBEAT.md").write_text(TWICE_HB, encoding="utf-8")
    for hour in (7, 16, 23):
        assert dispatch.run(repo, "cloud", "dispatcher-cloud", today=day,
                            now=dt.datetime(2026, 8, 20, hour, 30)) == []
    assert len(_dispatch_rows(repo)) == 1


def test_another_project_with_the_same_cadence_name_still_dispatches(tmp_path):
    """Occurrence dedup keeps the (project, cadence) part of the key."""
    repo = make_cron_repo(tmp_path)
    proj_b = repo / "orgs" / "proj-b"
    proj_b.mkdir(parents=True)
    (proj_b / "HEARTBEAT.md").write_text(CRON_HB, encoding="utf-8")
    emitted = dispatch.run(repo, "cloud", "dispatcher-cloud", today=dt.date(2026, 8, 20),
                           now=dt.datetime(2026, 8, 20, 15, 0))
    assert len(emitted) == 2
    assert {r["project"] for r in _dispatch_rows(repo)} == {"proj-a", "proj-b"}


# --------------------------------------------------------------------------- #
# Authorization + live-block canaries                                          #
# --------------------------------------------------------------------------- #

def test_re_timing_a_cron_cadence_voids_standing_authorization():
    """Timing lives INSIDE `schedule:` precisely so that `_cadence_matches`
    byte-compare catches a re-time — never a sibling YAML key."""
    main = {"name": "cron-nightly", "schedule": "3 7 * * mon", "tier": "cloud",
            "risk-tier": "T1", "prompt": "Cron work.\n"}
    assert promotion._cadence_matches(main, dict(main)) is True
    assert promotion._cadence_matches(main, {**main, "schedule": "4 7 * * mon"}) is False
    assert promotion._cadence_matches(main, {**main, "schedule": "3 8 * * mon"}) is False
    assert promotion._cadence_matches(main, {**main, "schedule": "3 7 * * tue"}) is False
    # Non-pinned keys (e.g. a sibling timing key) would NOT be caught — which is
    # exactly why timing may never live in one.
    assert promotion._cadence_matches(main, {**main, "at": "07:04"}) is True
    assert "schedule" in promotion._CADENCE_FIELDS


LIVE_HEARTBEATS = ("HEARTBEAT.md", "orgs/atlas-prep/HEARTBEAT.md",
                   "orgs/kb-ops/HEARTBEAT.md", "orgs/faceless-youtube/HEARTBEAT.md")


def test_thirteen_live_cadences_parse_with_explicit_declared_owners():
    live = [(project, c)
            for project, hb in dispatch._heartbeats(REPO_ROOT)
            for c in dispatch.parse_heartbeat(hb)]
    assert len(live) == 13
    assert {c["name"] for _, c in live} == {
        "nightly-review", "weekly-audit", "grades-reconcile", "branch-hygiene",
        "research-draft-gate", "self-lint-report", "context-lifecycle", "lessons-miner",
        "grader", "model-audit", "hygiene", "learnings-implementer", "system-sweeper"}
    by_name = {c["name"]: c for _, c in live}
    assert {name: cadence.get("agent") for name, cadence in by_name.items()} == {
        "nightly-review": "dispatcher-cloud", "weekly-audit": "dispatcher-cloud",
        "grades-reconcile": "grader", "branch-hygiene": "hygiene",
        "research-draft-gate": "dispatcher-cloud", "self-lint-report": "hygiene",
        "context-lifecycle": "context-lifecycle", "lessons-miner": "lessons-miner",
        "grader": "grader", "model-audit": "model-audit", "hygiene": "hygiene",
        "learnings-implementer": "learnings-implementer", "system-sweeper": "system-sweeper",
    }
    sat, sun, tue = dt.date(2026, 8, 22), dt.date(2026, 8, 23), dt.date(2026, 8, 18)
    assert due_bool(by_name["nightly-review"], tue) is True
    assert due_bool(by_name["weekly-audit"], sat) is True
    assert due_bool(by_name["weekly-audit"], tue) is False
    assert due_bool(by_name["grades-reconcile"], sat) is True
    assert due_bool(by_name["branch-hygiene"], sun) is True
    assert due_bool(by_name["self-lint-report"], tue) is True
    assert {name: by_name[name]["schedule"] for name in (
        "context-lifecycle", "lessons-miner", "grader", "model-audit",
        "hygiene", "learnings-implementer", "system-sweeper",
    )} == {
        "context-lifecycle": "15 1 * * *",
        "lessons-miner": "45 1 * * *",
        "grader": "15 2 * * *",
        "model-audit": "45 2 * * 1",
        "hygiene": "15 3 * * 0",
        "learnings-implementer": "30 3 * * *",
        "system-sweeper": "*/15 * * * *",
    }
    # bare `schedule: weekly` (orgs/atlas-prep) stays NON-firing on every day
    assert not any(due_bool(by_name["research-draft-gate"], sat + dt.timedelta(days=n))
                   for n in range(7))


def test_shared_eastern_clock_vectors_pin_latest_and_next_occurrences():
    vectors = json.loads((REPO_ROOT / "tests" / "fixtures" / "schedule-clock-vectors.json").read_text(encoding="utf-8"))
    for vector in vectors:
        now = dt.datetime.fromisoformat(vector["now"])
        latest = dispatch.latest_occurrence(dispatch.parse_cron(vector["cron"]), now)
        next_fire = dispatch.next_occurrence(dispatch.parse_cron(vector["cron"]), now)
        assert (latest.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") if latest else None) == vector["latest"], vector["id"]
        assert next_fire.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") == vector["next"], vector["id"]
