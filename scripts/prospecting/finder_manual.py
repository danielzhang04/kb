"""Stable manual finder-lane entry point."""

from __future__ import annotations

import hashlib
import json
import sqlite3

from scripts.prospecting.capture import CaptureResult, capture_csv, capture_urls
from scripts.prospecting.lanes import LaneBatch, LaneCursor, LanePlan, YieldEstimate, capabilities_for
from scripts.prospecting.store import SourceObservation


class ManualLane:
    name = "manual"
    capability_version = "manual-v1"

    def __init__(self, connection: sqlite3.Connection | None = None, max_people: int | None = None) -> None:
        self.connection = connection
        self.max_people = max_people
        self._run_id: str | None = None

    def bind_run(self, finder_run_id: str) -> None:
        self._run_id = finder_run_id

    def capabilities(self):
        return capabilities_for(self.name, self.capability_version)

    def plan(self, target_policy):
        return LanePlan(
            self.name,
            self.capability_version,
            self.capabilities(),
            YieldEstimate(1, 5, 10),
            10,
        )

    def run(self, plan, cursor):
        if self.connection is None or self._run_id is None:
            raise ValueError("manual_lane_requires_bound_local_store")
        offset = 0 if cursor is None or cursor.cursor is None else int(cursor.cursor)
        limit = min(plan.limit, self.max_people) if self.max_people is not None else plan.limit
        rows = self.connection.execute(
            """SELECT DISTINCT entity_id FROM source_observation
               WHERE source='manual' AND entity_type='person'
               ORDER BY entity_id LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
        entity_ids = tuple(str(row[0]) for row in rows)
        observations: list[SourceObservation] = []
        for entity_id in entity_ids:
            for row in self.connection.execute(
                """SELECT * FROM source_observation WHERE source='manual'
                   AND entity_type='person' AND entity_id=? ORDER BY observation_id""",
                (entity_id,),
            ):
                values = dict(row)
                values["observation_id"] = "obs_" + hashlib.sha256(
                    f"{self._run_id}|manual|{values['observation_id']}".encode("utf-8")
                ).hexdigest()[:16]
                observations.append(SourceObservation(**values))
        next_offset = offset + len(entity_ids)
        exhausted = len(entity_ids) < limit
        return LaneBatch(
            tuple(observations), None if exhausted else str(next_offset), len(entity_ids),
            len(entity_ids), exhausted, "lane_exhausted" if exhausted and not entity_ids else None,
        )


__all__ = ["CaptureResult", "ManualLane", "capture_csv", "capture_urls"]
