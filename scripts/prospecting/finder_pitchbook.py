"""Documented PitchBook CSV import into the desktop-local prospecting store."""

from __future__ import annotations

import csv
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Callable, Mapping, TextIO
from urllib.parse import urlsplit
import uuid

from scripts.prospecting.lanes import LaneBatch, LaneCursor, LanePlan, YieldEstimate, capabilities_for
from scripts.prospecting.store import (
    Company,
    SourceObservation,
    insert_company,
    insert_source_observation,
)
from scripts.prospecting.p2_store import TargetPolicy


PITCHBOOK_HEADERS: tuple[str, ...] = (
    "Company Name",
    "Website",
    "Primary Industry",
    "Company Type",
    "Company Stage",
    "HQ Location",
    "LinkedIn URL",
)

_MULTI_LABEL_PUBLIC_SUFFIXES = frozenset(
    {
        "co.uk",
        "org.uk",
        "ac.uk",
        "com.au",
        "co.jp",
        "co.nz",
        "com.br",
        "co.in",
        "com.sg",
        "co.za",
    }
)


@dataclass(frozen=True)
class MappedCompany:
    name: str
    website_url: str | None
    industry: str | None
    company_type: str | None
    company_stage: str | None
    location: str | None
    linkedin_url: str | None


@dataclass(frozen=True)
class PitchBookReport:
    imported: int
    duplicates: int
    unsupported_columns: tuple[str, ...]


def map_pitchbook_row(row: Mapping[str, str]) -> MappedCompany:
    def value(key: str) -> str | None:
        return (row.get(key) or "").strip() or None

    return MappedCompany(
        name=(row.get("Company Name") or "").strip(),
        website_url=value("Website"),
        industry=value("Primary Industry"),
        company_type=value("Company Type"),
        company_stage=value("Company Stage"),
        location=value("HQ Location"),
        linkedin_url=value("LinkedIn URL"),
    )


def _company_dedupe_key(item: MappedCompany) -> str:
    host = urlsplit(item.website_url).hostname if item.website_url else None
    registrable_host = _registrable_domain(host)
    basis = registrable_host or f"{item.name.casefold()}|{(item.location or '').casefold()}"
    return hashlib.sha256(basis.encode()).hexdigest()


def _registrable_domain(host: str | None) -> str:
    labels = [label for label in (host or "").casefold().rstrip(".").split(".") if label]
    suffix_labels = 2 if ".".join(labels[-2:]) in _MULTI_LABEL_PUBLIC_SUFFIXES else 1
    if len(labels) <= suffix_labels:
        return ""
    return ".".join(labels[-(suffix_labels + 1):])


def import_pitchbook_csv(
    connection: sqlite3.Connection,
    source: TextIO,
    retrieved_at: str,
    id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
) -> PitchBookReport:
    reader = csv.DictReader(source)
    unsupported_columns = tuple(
        header for header in (reader.fieldnames or ()) if header not in PITCHBOOK_HEADERS
    )
    rows = list(reader)
    imported = 0
    duplicates = 0
    connection.execute("BEGIN IMMEDIATE")
    try:
        imported_today = connection.execute(
            "SELECT COUNT(*) FROM audit WHERE action='pitchbook_import' AND substr(at,1,10)=?",
            (retrieved_at[:10],),
        ).fetchone()[0]
        if imported_today + len(rows) > 10:
            raise ValueError("pitchbook_daily_row_cap")
        for row in rows:
            item = map_pitchbook_row(row)
            if not item.name:
                raise ValueError("pitchbook_company_name_required")
            dedupe_key = _company_dedupe_key(item)
            if connection.execute(
                "SELECT 1 FROM company WHERE dedupe_key=?", (dedupe_key,)
            ).fetchone() is not None:
                duplicates += 1
                continue

            company_id = id_factory()
            insert_company(
                connection,
                Company(
                    company_id=company_id,
                    name=item.name,
                    website_url=item.website_url,
                    linkedin_url=item.linkedin_url,
                    one_line_summary=None,
                    industry=item.industry,
                    location=item.location,
                    source_lane="pitchbook",
                    dedupe_key=dedupe_key,
                ),
            )
            for field, value in item.__dict__.items():
                if value is not None:
                    insert_source_observation(
                        connection,
                        SourceObservation(
                            observation_id=id_factory(),
                            entity_type="company",
                            entity_id=company_id,
                            field=field,
                            value=json.dumps(value),
                            source="pitchbook",
                            seen_at=retrieved_at,
                            retrieved_at=retrieved_at,
                            confidence=1.0,
                            snapshot_id=None,
                        ),
                    )
            connection.execute(
                """INSERT INTO audit(
                       event_id,actor,action,entity_type,entity_id,at,before_hash,after_hash,reason
                   ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    id_factory(),
                    "prospecting-list-builder",
                    "pitchbook_import",
                    "company",
                    company_id,
                    retrieved_at,
                    None,
                    dedupe_key,
                    "documented_export",
                ),
            )
            imported += 1
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return PitchBookReport(imported, duplicates, unsupported_columns)


class PitchBookLane:
    name = "pitchbook"
    capability_version = "pitchbook-v1"

    def __init__(self, csv_path: Path | None = None, max_companies: int | None = None) -> None:
        self.csv_path = csv_path
        self.max_companies = max_companies
        self._run_id: str | None = None

    def bind_run(self, finder_run_id: str) -> None:
        self._run_id = finder_run_id

    def capabilities(self):
        return capabilities_for(self.name, self.capability_version)

    def plan(self, target_policy: TargetPolicy) -> LanePlan:
        return LanePlan(
            self.name,
            self.capability_version,
            self.capabilities(),
            YieldEstimate(1, 6, 10),
            10,
        )

    def run(self, plan: LanePlan, cursor: LaneCursor | None) -> LaneBatch:
        if self.csv_path is None or self._run_id is None:
            return LaneBatch((), None, 0, 0, True, "lane_exhausted")
        with self.csv_path.open(newline="", encoding="utf-8") as source:
            records = tuple(map_pitchbook_row(row) for row in csv.DictReader(source))
        offset = 0 if cursor is None or cursor.cursor is None else int(cursor.cursor)
        limit = min(plan.limit, self.max_companies) if self.max_companies is not None else plan.limit
        page = records[offset: offset + limit]
        observations: list[SourceObservation] = []
        for index, item in enumerate(page, start=offset):
            if not item.name:
                raise ValueError("pitchbook_company_name_required")
            source_key = _company_dedupe_key(item)
            upstream_id = "company_" + source_key[:16]
            for field, value in item.__dict__.items():
                if value is None:
                    continue
                observation_id = "obs_" + hashlib.sha256(
                    f"{self._run_id}|pitchbook|{index}|{field}".encode("utf-8")
                ).hexdigest()[:16]
                observations.append(SourceObservation(
                    observation_id, "company", upstream_id, field, json.dumps(value), "pitchbook",
                    None, "2026-09-03T00:00:00Z", 1.0, None,
                ))
        next_offset = offset + len(page)
        exhausted = next_offset >= len(records)
        return LaneBatch(
            tuple(observations), None if exhausted else str(next_offset), len(page), len(page), exhausted,
            "lane_exhausted" if exhausted and not page else None,
        )
