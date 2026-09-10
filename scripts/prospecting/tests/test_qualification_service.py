from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
from threading import Barrier, Event

import pytest

from scripts.prospecting.person_research_service import PersonCapture, PersonResearchService
from scripts.prospecting.pipeline_stage_service import StageBinding, StageJob, StageResult
from scripts.prospecting.qualification_service import (
    QualificationError,
    QualificationService,
    QualificationStartRequest,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_person_research_service import (
    _person,
    _request,
    _seed,
    _write,
)


NOW = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
STAMP = NOW.isoformat().replace("+00:00", "Z")


def _binding(identity: str = "synthetic-qualification") -> StageBinding:
    digest = sha256(identity.encode()).hexdigest()
    return StageBinding(
        identity, "synthetic-runtime", "1", digest, digest,
        "synthetic-qualification", "1", digest, digest,
    )


@dataclass
class _Adapter:
    payload_factory: object
    binding: StageBinding = _binding()
    calls: int = 0
    last_job: StageJob | None = None

    def execute(self, job: StageJob) -> StageResult:
        self.calls += 1
        self.last_job = job
        value = json.loads(job.input_json)
        return StageResult(self.payload_factory(value))  # type: ignore[operator]


def _supported_payload(job: dict[str, object]) -> dict[str, object]:
    funding = next(
        source for source in job["sources"]
        if source["origin_kind"] == "funding" and source["binding_kind"] == "funding_event"
    )
    event = funding["observation"]["event"]
    company = job["company"]
    people = []
    for candidate in job["candidates"]:
        identity = candidate["identity"]
        sources = [
            source["source_key"] for source in job["sources"]
            if source["origin_kind"] == "person"
            and source["subject_candidate_id"] == candidate["candidate_id"]
        ]
        people.append({
            "candidate_id": candidate["candidate_id"],
            "page_kind": "current_company_team",
            "role_statement": "current",
            "observed_name": identity["full_name"],
            "observed_company": company["identity"]["name"],
            "observed_title": identity["title"],
            "title_granularity": "exact",
            "continuity": "current_statement",
            "source_keys": sources,
            "uncertainty_codes": [],
        })
    return {
        "company": {
            "identity_consistency": "consistent",
            "location": company["identity"]["location"],
            "sector": company["identity"]["sector"],
            "funding_events": [{
                "source_key": funding["source_key"], "authority": "issuer",
                "entailment": "supports_exact_stage_date", "stage": event["stage"],
                "announced_at": event["announced_at"], "uncertainty_codes": [],
            }],
            "coverage_assessment": "bounded_current_search",
            "source_agreement": "consistent", "uncertainty_codes": [],
        },
        "people": people,
    }


def _qualification_request(started, funding, people, *, request_id="dddddddd-dddd-4ddd-8ddd-dddddddddddd", predecessor=None):
    return QualificationStartRequest(
        request_id, started.run_id, started.intake_hash, funding.batch_id,
        funding.batch_hash, people.batch_id, people.batch_hash,
        None if predecessor is None else predecessor.batch_id,
        None if predecessor is None else predecessor.batch_hash,
    )


def _ready_store(tmp_path: Path, *, person: PersonCapture | None = None):
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    selected_person = person or _person(tmp_path, selected)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (selected_person,)),
    )
    return connection, started, funding, selected, people


def test_start_parks_without_adapter_and_replays_exact_request(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)
    service = QualificationService(connection, now=lambda: NOW)
    request = _qualification_request(started, funding, people)

    first = service.start_or_resume(request)
    replay = service.start_or_resume(request)

    assert first.state == "awaiting_qualification_adapter"
    assert first.counts == {
        "items": 1, "machine_reviewed": 0,
        "source_supported_companies": 0, "source_supported_people": 0,
    }
    assert replay.batch_id == first.batch_id and replay.replayed
    assert connection.execute("SELECT count(*) FROM prospecting_qualification_attempt").fetchone()[0] == 0
    with pytest.raises(QualificationError, match="qualification_adapter_unavailable"):
        service.run_next(service.get_projection(started.run_id).items[0].item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")


def test_real_controller_job_is_scoped_and_records_runtime_receipt(tmp_path: Path) -> None:
    connection, started, funding, selected, people = _ready_store(tmp_path)
    connection.execute(
        """INSERT INTO company(
               company_id,name,website_url,industry,location,source_lane,dedupe_key)
           VALUES(?,?,?,?,?,?,?)""",
        ("co_unrelated", "Unrelated Synthetic", "https://unrelated.test", "other", "Elsewhere", "manual", "unrelated"),
    )
    adapter = _Adapter(_supported_payload)
    service = QualificationService(
        connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW,
    )
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id

    result = service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")

    assert result.state == "machine_reviewed"
    assert result.company_outcome == "source_supported"
    assert result.person_counts["current_role_supported"] == 1
    job = json.loads(adapter.last_job.input_json)
    encoded = adapter.last_job.input_json.decode()
    assert job["company"]["company_id"] == selected.company_id
    assert len(job["candidates"]) == 1
    assert "Unrelated Synthetic" not in encoded and "contact_point" not in encoded
    attempt = connection.execute("SELECT * FROM prospecting_qualification_attempt").fetchone()
    artifact = connection.execute("SELECT * FROM prospecting_qualification_artifact").fetchone()
    assert attempt["state"] == "succeeded"
    assert artifact["producer_identity"] == adapter.binding.executor_identity
    assert artifact["runtime_hash"] == adapter.binding.runtime_hash


@pytest.mark.parametrize(
    ("mutation", "company_outcome", "person_outcome"),
    (
        (lambda value: value["company"]["funding_events"][0].update(authority="unknown"), "unknown", "unknown"),
        (lambda value: value["people"][0].update(
            page_kind="dated_hiring_announcement", role_statement="historical",
            continuity="historical_only", uncertainty_codes=["continuity_not_established"],
        ), "source_supported", "unknown"),
    ),
)
def test_semantic_authority_and_old_hiring_context_do_not_fake_support(
    tmp_path: Path, mutation, company_outcome: str, person_outcome: str,
) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)

    def payload(job):
        value = _supported_payload(job)
        mutation(value)
        return value

    adapter = _Adapter(payload)
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    result = service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert result.company_outcome == company_outcome
    assert result.person_counts[person_outcome] == 1


def test_current_profile_needs_no_publication_date_when_exact_current_context_is_present(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)

    def payload(job):
        value = _supported_payload(job)
        value["people"][0]["page_kind"] = "current_individual_profile"
        return value

    adapter = _Adapter(payload)
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    result = service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert result.person_counts["current_role_supported"] == 1


def test_relevant_predecessor_source_is_bound_and_potential_identity_is_explicit(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    first_source = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        None, "https://history.test/announcement",
        _write(tmp_path, "history.txt", "Avery Example was hired as Head of Operations at Nimbus Systems."), STAMP,
    )
    first = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (first_source,)),
    )
    replacement_source = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        None, "https://nimbus.test/team/avery",
        _write(tmp_path, "current.txt", "Avery Example is Head of Operations at Nimbus Systems."), STAMP,
    )
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(
            started, funding, selected, (replacement_source,),
            request_id="abababab-abab-4bab-8bab-abababababab", predecessor=first,
        ),
    )
    service = QualificationService(connection, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item = service.get_projection(started.run_id).items[0]
    rows = connection.execute(
        "SELECT context_relation FROM prospecting_qualification_source WHERE item_id=? AND origin_kind='person' ORDER BY ordinal",
        (item.item_id,),
    ).fetchall()
    assert [row[0] for row in rows] == ["current", "predecessor"]

    # A source-unknown predecessor with only the same name/company is retained as a
    # possible conflict, but never promoted to an exact identity match.
    connection.close()


def test_same_name_company_without_stable_identity_is_bound_as_potential_conflict(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    uncertain = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        None, "https://history.test/announcement",
        _write(tmp_path, "uncertain.txt", "Avery Example joined another organization."), STAMP,
    )
    first = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (uncertain,)),
    )
    assert first.counts["source_unknown"] == 1
    current = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        None, "https://nimbus.test/team/avery",
        _write(tmp_path, "current.txt", "Avery Example is Head of Operations at Nimbus Systems."), STAMP,
    )
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(
            started, funding, selected, (current,),
            request_id="abababab-abab-4bab-8bab-abababababab", predecessor=first,
        ),
    )
    adapter = _Adapter(_supported_payload)
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    rows = connection.execute(
        "SELECT context_relation FROM prospecting_qualification_source WHERE item_id=? AND origin_kind='person' ORDER BY ordinal",
        (item_id,),
    ).fetchall()
    assert [row[0] for row in rows] == ["current", "potential_conflict"]
    result = service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert result.context_codes == ("supplemental_source_binding_required",)
    assert result.person_counts["unknown"] == 1


def test_exact_identity_title_disagreement_is_bound_and_cannot_be_smoothed_over(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    prior = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Operations Lead",
        "https://profile.test/avery", "https://history.test/announcement",
        _write(tmp_path, "prior-title.txt", "Avery Example joined another organization."), STAMP,
    )
    first = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (prior,)),
    )
    assert first.counts["source_unknown"] == 1
    current = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        "https://profile.test/avery", "https://nimbus.test/team/avery",
        _write(tmp_path, "current-title.txt", "Avery Example is Head of Operations at Nimbus Systems."), STAMP,
    )
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(
            started, funding, selected, (current,),
            request_id="abababab-abab-4bab-8bab-abababababab", predecessor=first,
        ),
    )
    adapter = _Adapter(_supported_payload)
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    relations = connection.execute(
        "SELECT context_relation FROM prospecting_qualification_source WHERE item_id=? AND origin_kind='person' ORDER BY ordinal",
        (item_id,),
    ).fetchall()
    assert [row[0] for row in relations] == ["current", "predecessor_title_disagreement"]
    result = service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert result.person_counts["unknown"] == 1


def test_company_item_survives_zero_person_candidates_and_preserves_deficit(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, ()),
    )
    service = QualificationService(connection, now=lambda: NOW)
    result = service.start_or_resume(_qualification_request(started, funding, people))
    projection = service.get_projection(started.run_id)
    assert result.counts["items"] == 1
    assert projection.items[0].candidate_count == 0
    assert people.counts["provisional_shortfall"] == 2


def test_wrong_or_unbound_source_citation_is_rejected(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)

    def payload(job):
        value = _supported_payload(job)
        value["company"]["funding_events"][0]["source_key"] = "qsrc_unbound"
        return value

    adapter = _Adapter(payload)
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    with pytest.raises(QualificationError, match="qualification_output_invalid"):
        service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert connection.execute("SELECT count(*) FROM prospecting_qualification_artifact").fetchone()[0] == 0


def test_event_uncertainty_cannot_support_company_or_people(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)

    def payload(job):
        value = _supported_payload(job)
        value["company"]["funding_events"][0]["uncertainty_codes"] = ["authority_unclear"]
        return value

    service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(payload)}, now=lambda: NOW,
    )
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    result = service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert result.company_outcome == "unknown"
    assert result.person_counts["unknown"] == 1
    derived = json.loads(connection.execute(
        "SELECT derived_json FROM prospecting_qualification_artifact WHERE item_id=?", (item_id,),
    ).fetchone()[0])
    assert derived["company_uncertainty_codes"] == ["authority_unclear"]


@pytest.mark.parametrize(
    "mutation",
    (
        lambda value: value["company"].update(identity_consistency=[]),
        lambda value: value["company"]["funding_events"][0].update(source_key={}),
        lambda value: value["company"]["funding_events"][0].update(authority=[]),
        lambda value: value["people"][0].update(candidate_id={}),
        lambda value: value["people"][0].update(page_kind=[]),
    ),
)
def test_unhashable_adapter_scalars_fail_with_fixed_code_and_terminal_attempt(
    tmp_path: Path, mutation,
) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)

    def payload(job):
        value = _supported_payload(job)
        mutation(value)
        return value

    service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(payload)}, now=lambda: NOW,
    )
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    with pytest.raises(QualificationError) as refused:
        service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert str(refused.value) == "qualification_output_invalid"
    attempt = connection.execute(
        "SELECT state,failure_code FROM prospecting_qualification_attempt WHERE item_id=?",
        (item_id,),
    ).fetchone()
    assert tuple(attempt) == ("failed", "qualification_output_invalid")


def test_complete_source_text_over_envelope_refuses_before_adapter(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    identity = "Avery Example is Head of Operations at Nimbus Systems."
    body_ref = _write(tmp_path, "large-person.txt", identity + (" synthetic" * 120_000))
    person = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        "https://profile.test/avery", "https://nimbus.test/team/avery", body_ref, STAMP,
    )
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (person,)),
    )
    adapter = _Adapter(_supported_payload)
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    with pytest.raises(QualificationError, match="qualification_input_too_large"):
        service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert adapter.calls == 0
    assert connection.execute("SELECT count(*) FROM prospecting_qualification_attempt").fetchone()[0] == 0


def test_changed_bound_source_refuses_before_adapter_without_private_error_text(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)
    adapter = _Adapter(_supported_payload)
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    body_ref = connection.execute(
        "SELECT expected_body_ref FROM prospecting_qualification_source WHERE item_id=? ORDER BY ordinal LIMIT 1",
        (item_id,),
    ).fetchone()[0]
    (tmp_path / "snapshots" / body_ref).write_text("PRIVATE SENTINEL", encoding="utf-8")
    with pytest.raises(QualificationError) as refused:
        service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert str(refused.value) == "source_changed"
    assert "PRIVATE SENTINEL" not in repr(refused.value)
    assert adapter.calls == 0


def test_invalid_adapter_shape_is_terminal_and_retry_is_bounded(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)
    adapter = _Adapter(lambda _job: {"unexpected": "PRIVATE SENTINEL"})
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    for request_id in (
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
    ):
        with pytest.raises(QualificationError, match="qualification_output_invalid"):
            service.run_next(item_id, request_id)
    assert service.get_projection(started.run_id).items[0].state == "qualification_failed"
    with pytest.raises(QualificationError, match="qualification_attempts_exhausted"):
        service.run_next(item_id, "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd")
    assert "PRIVATE SENTINEL" not in repr(service.get_projection(started.run_id))


def test_adapter_exception_text_is_never_exposed_or_stored(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)

    def raises_private(_job):
        raise QualificationError("SYNTHETIC_PRIVATE_CANARY")

    service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(raises_private)}, now=lambda: NOW,
    )
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    with pytest.raises(QualificationError) as refused:
        service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert str(refused.value) == "qualification_adapter_failed"
    assert connection.execute(
        "SELECT failure_code FROM prospecting_qualification_attempt WHERE item_id=?", (item_id,),
    ).fetchone()[0] == "qualification_adapter_failed"


def test_lease_expiry_after_adapter_call_is_fenced(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)
    clock = [NOW]

    def payload(job):
        clock[0] += timedelta(minutes=6)
        return _supported_payload(job)

    adapter = _Adapter(payload)
    service = QualificationService(connection, adapters={"qualification_factcheck": adapter}, now=lambda: clock[0])
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    with pytest.raises(QualificationError, match="lease_expired"):
        service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    assert connection.execute("SELECT state FROM prospecting_qualification_attempt").fetchone()[0] == "expired"
    assert connection.execute("SELECT count(*) FROM prospecting_qualification_artifact").fetchone()[0] == 0
    with pytest.raises(QualificationError, match="lease_expired"):
        service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(_supported_payload)},
        now=lambda: clock[0],
    )
    assert service.run_next(
        item_id, "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
    ).state == "machine_reviewed"


def test_completed_item_refuses_new_request_before_adapter(tmp_path: Path) -> None:
    connection, started, funding, _selected, people = _ready_store(tmp_path)
    adapter = _Adapter(_supported_payload)
    service = QualificationService(
        connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW,
    )
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    first_request = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    service.run_next(item_id, first_request)
    assert service.run_next(item_id, first_request).state == "machine_reviewed"
    with pytest.raises(QualificationError, match="qualification_already_complete"):
        service.run_next(item_id, "ffffffff-ffff-4fff-8fff-ffffffffffff")
    assert adapter.calls == 1
    assert connection.execute(
        "SELECT count(*) FROM prospecting_qualification_attempt WHERE item_id=?", (item_id,),
    ).fetchone()[0] == 1


def test_concurrent_exact_request_has_one_adapter_call_and_fixed_replay_state(tmp_path: Path) -> None:
    store_path = tmp_path / "store.sqlite"
    connection, started, funding, _selected, people = _ready_store(tmp_path)
    service = QualificationService(connection, now=lambda: NOW)
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    connection.close()

    job_barrier = Barrier(2)
    adapter_entered = Event()
    release_adapter = Event()

    class BarrierService(QualificationService):
        first_job = True

        def _job(self, item):
            result = super()._job(item)
            if self.first_job:
                self.first_job = False
                job_barrier.wait(timeout=5)
            return result

    def payload(job):
        adapter_entered.set()
        assert release_adapter.wait(timeout=5)
        return _supported_payload(job)

    adapters = (_Adapter(payload), _Adapter(payload))

    def run(adapter):
        worker_connection = open_store(store_path)
        try:
            worker = BarrierService(
                worker_connection, adapters={"qualification_factcheck": adapter}, now=lambda: NOW,
            )
            try:
                return worker.run_next(
                    item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                ).state
            except QualificationError as error:
                return str(error)
        finally:
            worker_connection.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(run, adapter) for adapter in adapters]
        assert adapter_entered.wait(timeout=5)
        release_adapter.set()
        outcomes = [future.result(timeout=10) for future in futures]
    assert sum(adapter.calls for adapter in adapters) == 1
    assert set(outcomes) <= {"machine_reviewed", "qualification_in_progress"}
    assert "machine_reviewed" in outcomes
    checked = open_store(store_path)
    assert checked.execute("SELECT count(*) FROM prospecting_qualification_attempt").fetchone()[0] == 1
    assert checked.execute("SELECT count(*) FROM prospecting_qualification_artifact").fetchone()[0] == 1
    checked.close()


def test_start_request_conflict_and_same_input_cannot_reset_attempt_budget(tmp_path: Path) -> None:
    connection, started, funding, selected, people = _ready_store(tmp_path)
    service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(lambda _job: {"invalid": True})},
        now=lambda: NOW,
    )
    first = service.start_or_resume(_qualification_request(started, funding, people))
    with pytest.raises(QualificationError, match="request_conflict"):
        service.start_or_resume(QualificationStartRequest(
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd", started.run_id, started.intake_hash,
            funding.batch_id, funding.batch_hash, people.batch_id, "b" * 64, None, None,
        ))
    item_id = service.get_projection(started.run_id).items[0].item_id
    for attempt_request in (
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
    ):
        with pytest.raises(QualificationError, match="qualification_output_invalid"):
            service.run_next(item_id, attempt_request)
    with pytest.raises(QualificationError, match="qualification_context_unchanged"):
        service.start_or_resume(_qualification_request(
            started, funding, people, request_id="acacacac-acac-4cac-8cac-acacacacacac",
            predecessor=first,
        ))

    changed = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        "https://profile.test/avery", "https://nimbus.test/about/avery",
        _write(
            tmp_path, "person-changed-context.txt",
            "Current leadership profile: Avery Example is Head of Operations at Nimbus Systems.",
        ),
        STAMP,
    )
    replacement_people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(
            started, funding, selected, (changed,),
            request_id="bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc", predecessor=people,
        ),
    )
    second = service.start_or_resume(_qualification_request(
        started, funding, replacement_people,
        request_id="dededede-dede-4ede-8ede-dededededede", predecessor=first,
    ))
    latest = service.get_projection(started.run_id)
    assert latest.predecessor_batch_id == first.batch_id
    assert latest.batch_id == second.batch_id
    assert service.start_or_resume(_qualification_request(started, funding, people)).replayed
