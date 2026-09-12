"""Counts-only campaigner sweep, scan, and status commands."""
from __future__ import annotations
import argparse
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Iterable
from scripts.prospecting import store
from scripts.prospecting.campaigner.inbound import InboundEnvelope, process_inbound
from scripts.prospecting.campaigner.release import ReleaseResult


def _as_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp must include an offset")
    return parsed.astimezone(timezone.utc)


@dataclass
class CampaignerService:
    connection: sqlite3.Connection
    inbound_source: Callable[[], Iterable[InboundEnvelope]]
    release: Callable[[str], ReleaseResult]
    now: Callable[[], str] = lambda: datetime.now(timezone.utc).isoformat()
    breaker: Callable[[], bool] = lambda: False
    campaign_id: str | None = None
    label_request: Callable[[str, tuple[str, ...], tuple[str, ...]], None] = (
        lambda _thread_id, _add, _remove: None
    )

    def _scope(self, statement: str) -> tuple[str, tuple[str, ...]]:
        if self.campaign_id is None:
            return statement, ()
        return statement + " AND campaign_id=?", (self.campaign_id,)

    def scan(self) -> dict[str, int]:
        total = {'processed': 0, 'stopped': 0, 'blocked': 0}
        for envelope in self.inbound_source():
            item = process_inbound(
                self.connection, envelope, label_request=self.label_request,
            ).as_dict()
            for key in total:
                total[key] += item[key]
        return total

    def sweep(self) -> dict[str, int]:
        scanned = self.scan()
        result = {**scanned, 'considered': 0, 'drafted': 0, 'cancelled': 0,
                  'cap_blocked': 0, 'warning_paused': 0, 'next_due_count': 0}
        try:
            if self.breaker():
                result['warning_paused'] = 1
                return result
            now = _as_utc(self.now())
            statement, parameters = self._scope(
                "SELECT delivery_id,scheduled_at FROM delivery WHERE state='reserved'"
            )
            rows = sorted(
                self.connection.execute(statement, parameters).fetchall(),
                key=lambda row: (_as_utc(row[1]), row[0]),
            )
            for delivery_id, scheduled_at in rows:
                if _as_utc(scheduled_at) > now:
                    continue
                result['considered'] += 1
                released = self.release(delivery_id)
                state = self.connection.execute(
                    "SELECT state FROM delivery WHERE delivery_id=?", (delivery_id,)
                ).fetchone()
                if state is not None and state[0] != 'reserved' and released.state in result:
                    result[released.state] += 1
            return result
        finally:
            second = self.scan()
            for key in ('processed', 'stopped', 'blocked'):
                result[key] += second[key]
            statement, parameters = self._scope(
                "SELECT count(*) FROM delivery WHERE state='reserved'"
            )
            result['next_due_count'] = self.connection.execute(statement, parameters).fetchone()[0]

    def status(self) -> dict[str, int]:
        due_statement, due_parameters = self._scope(
            "SELECT count(*) FROM delivery WHERE state='reserved'"
        )
        enrollment_scope = (" AND campaign_id=?", (self.campaign_id,)) if self.campaign_id else ("", ())
        due = self.connection.execute(due_statement, due_parameters).fetchone()[0]
        paused = self.connection.execute(
            "SELECT count(*) FROM enrollment WHERE status='blocked'" + enrollment_scope[0],
            enrollment_scope[1],
        ).fetchone()[0]
        replied = self.connection.execute(
            "SELECT count(*) FROM enrollment WHERE stop_reason='human_reply'" + enrollment_scope[0],
            enrollment_scope[1],
        ).fetchone()[0]
        return {'due': due, 'paused': paused, 'replied': replied}


def run(service: CampaignerService, command: str) -> dict[str, int]:
    return {'scan': service.scan, 'sweep': service.sweep, 'status': service.status}[command]()


def main(
    argv: list[str] | None = None,
    service: CampaignerService | None = None,
    open_store_fn: Callable[[], sqlite3.Connection] | None = None,
    service_factory: Callable[[sqlite3.Connection], CampaignerService] | None = None,
    emit: Callable[[str], None] = print,
) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('sweep', 'scan', 'status'))
    parser.add_argument('--campaign')
    args = parser.parse_args(argv)
    if service is None:
        connection = (open_store_fn or store.open_store)()
        if service_factory is None:
            raise RuntimeError("no_backend_attached")
        service = service_factory(connection)
    if args.campaign is not None:
        service.campaign_id = args.campaign
    emit(json.dumps(run(service, args.command), sort_keys=True, separators=(',', ':')))
    return 0
