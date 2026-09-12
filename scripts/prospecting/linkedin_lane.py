"""Injected, sequential shell for the self-owned assisted LinkedIn finder lane."""

from __future__ import annotations

from datetime import timedelta
import hashlib
import sqlite3
import uuid
from collections.abc import Callable, Iterable, Mapping

from scripts.prospecting import browser_guard
from scripts.prospecting.browser_guard import BrowserPolicy, check_navigation, detect_stop, next_delay
from scripts.prospecting.lanes import LaneBatch, LaneCursor, LanePlan, YieldEstimate, capabilities_for
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import LaneCapability, SourceObservation
from scripts.prospecting.p2_store import TargetPolicy


class LinkedInBudget:
    def __init__(self, connection: sqlite3.Connection, clock: object) -> None:
        self.connection = connection
        self.clock = clock
        self.started = None

    def start_session(self) -> None:
        self.started = self.clock.now()  # type: ignore[attr-defined]

    def may_navigate(self) -> bool:
        return self.started is None or (
            self.clock.now() - self.started  # type: ignore[attr-defined,operator]
        ).total_seconds() < 1800

    def cap_reached(self) -> bool:
        cutoff = (self.clock.now() - timedelta(hours=24)).isoformat()  # type: ignore[attr-defined]
        row = self.connection.execute(
            "SELECT COUNT(*) FROM audit WHERE action=? AND at>?",
            ("linkedin_profile_load_success", cutoff),
        ).fetchone()
        return int(row[0]) >= 40

    def reserve_navigation(self, url: str) -> str | None:
        cutoff = (self.clock.now() - timedelta(hours=24)).isoformat()  # type: ignore[attr-defined]
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            row = self.connection.execute(
                "SELECT COUNT(*) FROM audit WHERE action=? AND at>?",
                ("linkedin_profile_load_success", cutoff),
            ).fetchone()
            if int(row[0]) >= 40:
                self.connection.rollback()
                return None
            load_id = str(uuid.uuid4())
            digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
            self.connection.execute(
                """INSERT INTO audit(
                   event_id,actor,action,entity_type,entity_id,at,before_hash,after_hash,reason
                   ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    load_id, "executor", "linkedin_profile_load_reserved", "finder_run", load_id,
                    self.clock.now().isoformat(), None, digest, "cap_reserved",  # type: ignore[attr-defined]
                ),
            )
            self.connection.commit()
            return load_id
        except Exception:
            self.connection.rollback()
            raise

    def mark_success(self, load_id: str, url: str) -> None:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
        self.connection.execute(
            """INSERT INTO audit(
               event_id,actor,action,entity_type,entity_id,at,before_hash,after_hash,reason
               ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                str(uuid.uuid4()), "executor", "linkedin_profile_load_success", "finder_run",
                load_id, self.clock.now().isoformat(), None, digest, "visible_page",  # type: ignore[attr-defined]
            ),
        )
        self.connection.commit()


class LinkedInAssistedLane:
    name = "linkedin_assisted"
    capability_version = "linkedin-v1"

    def __init__(
        self,
        clock: object,
        connection: sqlite3.Connection,
        rng: object,
        sleeper: Callable[[int], None],
        on_stop: Callable[[str], None] = lambda reason: None,
        *,
        _page_opener: Callable[[object, object], object] | None = None,
    ) -> None:
        self.clock = clock
        self.connection = connection
        self.rng = rng
        self.sleeper = sleeper
        self.on_stop = on_stop
        # Test-only seam: this still receives a guard-validated dedicated path and channel.
        self._page_opener = _page_opener or browser_guard.open_persistent_page
        self._target_policy: TargetPolicy | None = None

    def _checkpoint_stop_active(self) -> bool:
        row = self.connection.execute(
            "SELECT 1 FROM linkedin_checkpoint_stop WHERE singleton=1 AND cleared_at IS NULL"
        ).fetchone()
        return row is not None

    def _persist_checkpoint_stop(self, reason: str) -> None:
        self.connection.execute(
            """INSERT INTO linkedin_checkpoint_stop(singleton,reason,stopped_at,cleared_at,cleared_by)
               VALUES(1,?,?,NULL,NULL)
               ON CONFLICT(singleton) DO UPDATE SET reason=excluded.reason,
                   stopped_at=excluded.stopped_at, cleared_at=NULL, cleared_by=NULL""",
            (reason, self.clock.now().isoformat()),  # type: ignore[attr-defined]
        )
        self.connection.commit()

    def clear_checkpoint_stop(self, actor: str) -> None:
        if not actor.startswith("human:") or actor == "human:":
            raise ValueError("checkpoint_clear_requires_human")
        self.connection.execute(
            "UPDATE linkedin_checkpoint_stop SET cleared_at=?, cleared_by=? WHERE singleton=1",
            (self.clock.now().isoformat(), actor),  # type: ignore[attr-defined]
        )
        self.connection.commit()

    def _open_page(self) -> object:
        user_data_dir = browser_guard.dedicated_user_data_dir()
        browser_guard.validate_dedicated_launch(user_data_dir, browser_guard.CHROME_CHANNEL)
        return self._page_opener(user_data_dir, browser_guard.CHROME_CHANNEL)

    def capabilities(self) -> Mapping[str, LaneCapability]:
        return capabilities_for(self.name, self.capability_version)

    def plan(self, target_policy: TargetPolicy) -> LanePlan:
        if not target_policy.enabled or self.name not in target_policy.lanes:
            raise ValueError("linkedin_lane_disabled")
        if not target_policy.domain_allowlist:
            raise ValueError("linkedin_domain_allowlist_missing")
        if set(target_policy.domain_allowlist) != {browser_guard.LINKEDIN_HOST}:
            raise ValueError("linkedin_domain_allowlist_must_be_exact")
        assert_vm_safe(
            {
                "kind": "stdout",
                "fields": {
                    "enabled": target_policy.enabled,
                    "lanes": target_policy.lanes,
                    "domain_allowlist": target_policy.domain_allowlist,
                },
            },
            "stdout",
        )
        self._target_policy = target_policy
        return LanePlan(
            self.name,
            self.capability_version,
            self.capabilities(),
            YieldEstimate(5, 15, 40),
            40,
        )

    def dry_run(
        self, plan: LanePlan, cursor: LaneCursor | None, now: object
    ) -> tuple[dict[str, int], ...]:
        return tuple(
            {"ordinal": index + 1, "earliest_offset_seconds": 45 * index}
            for index in range(plan.limit)
        )

    def run(self, plan: LanePlan, cursor: LaneCursor | None) -> LaneBatch:
        return LaneBatch((), cursor.cursor if cursor else None, 0, 0, False, None)

    def run_live(self, urls: Iterable[str]) -> str:
        if self._target_policy is None:
            raise ValueError("linkedin_live_policy_required")
        policy = BrowserPolicy(self._target_policy.domain_allowlist)
        values = tuple(urls)
        for url in values:
            check_navigation(url, policy)

        if self._checkpoint_stop_active():
            return "checkpoint_stop_active"

        budget = LinkedInBudget(self.connection, self.clock)
        budget.start_session()
        page = self._open_page()
        try:
            next_navigation_at = None
            for index, url in enumerate(values):
                if budget.cap_reached():
                    return "cap_reached"
                if next_navigation_at is not None and self.clock.now() < next_navigation_at:  # type: ignore[attr-defined,operator]
                    return "spacing_not_elapsed"
                if not budget.may_navigate():
                    return "session_limit"
                load_id = budget.reserve_navigation(url)
                if load_id is None:
                    return "cap_reached"
                page.goto(url)  # type: ignore[attr-defined]
                if not budget.may_navigate():
                    return "session_limit"
                reason = detect_stop(page.content())  # type: ignore[attr-defined]
                if reason:
                    self._persist_checkpoint_stop(reason)
                    self.on_stop(reason)
                    return reason
                budget.mark_success(load_id, url)
                if index + 1 < len(values):
                    delay = next_delay(self.rng)
                    next_navigation_at = self.clock.now() + timedelta(seconds=delay)  # type: ignore[attr-defined,operator]
                    self.sleeper(delay)
            return "exhausted"
        finally:
            browser_guard.close_persistent_page(page)
