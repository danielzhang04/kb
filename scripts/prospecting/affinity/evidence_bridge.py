"""Bridge deterministic affinity facts into P3 Contract 3 evidence rows."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
import json
from typing import Any

from scripts.prospecting.personalizer.evidence import EvidenceDraft, EvidenceError, insert_evidence

from .score import Affinity, Signal


CLAIM_TEMPLATES: Mapping[str, str] = {
    "first_name": "Known as {first_name} at {firm}",
    "company": "Works at {firm} as {title}",
    "role": "Holds the {title} role at {firm}",
    "topic": "{firm} thesis on {domain}",
    "school": "Attended {school}",
    "why_them": "Worked at {employer} before joining {firm}",
    "recipient_hook": "Holds the {title} role at {firm}",
    "transition_from": "Moved from {kind_a} at {employer_a} to {kind_b} at {employer_b}",
    "transition_to": "Moved from {kind_a} at {employer_a} to {kind_b} at {employer_b}",
    "new_fact_sentence": "Published {work_title}",
    "path_transition": "Moved from {path_transition}",
    "role_level": "Current title is in the {role_level}",
}
COPY_ALLOWED_BY_CLASS = {"strong": True, "medium": True, "weak": False, "aside": False, "gate": False}


@dataclass(frozen=True)
class _Observation:
    observation_id: str
    entity_type: str
    entity_id: str
    field: str
    snapshot_id: str
    snapshot_entity_id: str
    observed_at: str | None
    excerpt: str
    confidence: float


@dataclass(frozen=True)
class BoundFacts:
    company_id: str
    firm: str
    title: str
    first_name: str
    sources: Mapping[str, _Observation]
    claims: Mapping[str, str]
    values: Mapping[str, str]


def _value(row: object, name: str, default: Any = None) -> Any:
    if isinstance(row, Mapping):
        return row.get(name, default)
    try:
        return row[name]  # type: ignore[index]
    except (IndexError, KeyError, TypeError):
        return getattr(row, name, default)


def _excerpt(value: object) -> str:
    try:
        parsed = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        return ""
    if isinstance(parsed, Mapping) and isinstance(parsed.get("excerpt"), str):
        return " ".join(parsed["excerpt"].split())[:240]
    return " ".join(parsed.split())[:240] if isinstance(parsed, str) else ""


def _observation(connection, observation_id: str) -> _Observation | None:
    row = connection.execute(
        "SELECT * FROM source_observation WHERE observation_id=?", (observation_id,),
    ).fetchone()
    if row is None:
        return None
    explicit = _value(row, "snapshot_id")
    legacy = _value(row, "source")
    snapshot_id = explicit or legacy
    snapshot = connection.execute(
        "SELECT snapshot_id,entity_id FROM source_snapshot WHERE snapshot_id=?", (snapshot_id,),
    ).fetchone()
    if snapshot is None:
        return None
    if explicit and legacy != explicit:
        conflicting = connection.execute(
            "SELECT 1 FROM source_snapshot WHERE snapshot_id=?", (legacy,),
        ).fetchone()
        if conflicting is not None:
            raise ValueError("evidence_snapshot_conflict")
    return _Observation(
        str(_value(row, "observation_id")), str(_value(row, "entity_type")),
        str(_value(row, "entity_id")), str(_value(row, "field")),
        str(_value(snapshot, "snapshot_id")), str(_value(snapshot, "entity_id")),
        _value(row, "seen_at"), _excerpt(_value(row, "value")),
        float(_value(row, "confidence")),
    )


def _normal(value: str) -> str:
    return " ".join("".join(character.casefold() if character.isalnum() else " " for character in value).split())


def _names(excerpt: str, *values: str) -> bool:
    haystack = f" {_normal(excerpt)} "
    return all(
        (needle := _normal(value)) and f" {needle} " in haystack
        for value in values
    )


def _valid_source(source: _Observation, person_id: str, company_id: str, fields: Sequence[str],
                  named_values: Sequence[str] = ()) -> bool:
    if source.field not in fields or not _names(source.excerpt, *named_values):
        return False
    if source.entity_id == person_id:
        return source.entity_type == "person" and source.snapshot_entity_id == person_id
    return (
        source.entity_id == company_id and source.entity_type == "company"
        and source.snapshot_entity_id == company_id
    )


def _one_row(values: Sequence[object], code: str) -> object:
    if len(values) != 1:
        raise ValueError(code)
    return values[0]


def _first_valid(values: Sequence[_Observation], code: str) -> _Observation:
    """Choose one authentic source deterministically when the fact has duplicates."""
    if not values:
        raise ValueError(code)
    return sorted(values, key=lambda item: item.observation_id)[0]


_SLOT_CODES: Mapping[str, tuple[str, ...]] = {
    "school": ("shared_school",),
    "why_them": ("shared_prior_employer",),
    "transition_from": ("path_match",),
    "transition_to": ("path_match",),
    "new_fact_sentence": ("own_writing", "board_or_portfolio"),
    "topic": ("firm_thesis",),
    "path_transition": ("path_match",),
    "role_level": ("role_family_match", "level_match"),
    "recipient_hook": ("own_writing",),
}


def _signals_for(slot: str, signals: Sequence[Signal]) -> tuple[Signal, ...]:
    """Every signal (in priority order) that a minted claim for ``slot`` should back and cite.

    Returns every match, not just the first, so a person carrying two codes that share a slot
    (e.g. own_writing and board_or_portfolio both feeding "new_fact_sentence", or role_family_match
    and level_match both feeding "role_level") gets the minted evidence_id written back onto both
    -- a single-match lookup here would silently leave the second code uncited.
    """
    wanted = _SLOT_CODES.get(slot, ())
    return tuple(signal for code in wanted for signal in signals if signal.code == code)


def _signal_ids(signals: Sequence[Signal], code: str) -> frozenset[str]:
    return frozenset(oid for signal in signals if signal.code == code for oid in signal.observation_ids)


def _row_for_ids(connection, table: str, person_id: str, ids: frozenset[str], code: str) -> object:
    if not ids:
        raise ValueError("evidence_source_missing")
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT * FROM {table} WHERE person_id=? AND observation_id IN ({placeholders}) ORDER BY ordinal",
        (person_id, *sorted(ids)),
    ).fetchall()
    return _one_row(rows, code)


def _identity(connection, person_id: str, selected_company_id: str | None = None) -> tuple[object, str, str, str]:
    rows = connection.execute(
        """SELECT person.first_name,company.company_id,company.name,employment.title,
                  employment.source_observation_id
             FROM person JOIN employment ON employment.person_id=person.person_id
               AND employment.valid_to IS NULL
             JOIN company ON company.company_id=employment.company_id
            WHERE person.person_id=? AND (? IS NULL OR company.company_id=?)
            ORDER BY employment.company_id""",
        (person_id, selected_company_id, selected_company_id),
    ).fetchall()
    row = _one_row(rows, "evidence_identity_ambiguous" if selected_company_id is None else "evidence_identity_missing")
    return row, str(_value(row, "company_id")), str(_value(row, "name")), str(_value(row, "title"))


def _normal_rows(connection, table: str, person_id: str) -> tuple[object, ...]:
    return tuple(connection.execute(
        f"SELECT * FROM {table} WHERE person_id=? ORDER BY ordinal", (person_id,),
    ).fetchall())


def _row_source(connection, row: object, person_id: str, company_id: str,
                fields: Sequence[str], names: Sequence[str], code: str) -> _Observation:
    source = _observation(connection, str(_value(row, "observation_id")))
    if source is None or not _valid_source(source, person_id, company_id, fields, names):
        raise ValueError(code)
    return source


def _matching_rows(rows: Sequence[object], raw_field: str, supplied: str | None) -> tuple[object, ...]:
    if supplied is None:
        return ()
    wanted = _normal(supplied)
    return tuple(row for row in rows if _normal(str(_value(row, raw_field, ""))) == wanted)


def _signal_row(connection, table: str, person_id: str, ids: frozenset[str], code: str) -> object:
    return _row_for_ids(connection, table, person_id, ids, code)


def _current_employer_row(connection, person_id: str, firm: str, title: str) -> object:
    rows = tuple(
        row for row in _normal_rows(connection, "person_employer", person_id)
        if _normal(str(_value(row, "employer_raw"))) == _normal(firm)
        and _value(row, "end_year") is None
        and (_value(row, "title") in {None, ""} or _normal(str(_value(row, "title"))) == _normal(title))
    )
    return _one_row(rows, "evidence_current_employer_ambiguous")


def _observation_candidates(connection, entity_id: str, fields: Sequence[str]) -> tuple[_Observation, ...]:
    placeholders = ",".join("?" for _ in fields)
    rows = connection.execute(
        f"SELECT observation_id FROM source_observation WHERE entity_id=? AND field IN ({placeholders}) ORDER BY observation_id",
        (entity_id, *fields),
    ).fetchall()
    return tuple(
        source for row in rows
        if (source := _observation(connection, str(_value(row, "observation_id")))) is not None
    )


def resolve_slot_facts(connection, person_id: str, affinity: Affinity,
                       selected_company_id: str | None = None, *,
                       required_slots: Sequence[str] | None = None,
                       supplied_slots: Mapping[str, str] | None = None) -> BoundFacts:
    required = frozenset(required_slots if required_slots is not None else CLAIM_TEMPLATES)
    supplied = supplied_slots or {}
    if selected_company_id is None:
        selected_rows = connection.execute(
            """SELECT company_id FROM fill_person
                WHERE campaign_id=? AND person_id=? AND substituted=0
                ORDER BY company_id""",
            (affinity.campaign_id, person_id),
        ).fetchall()
        if len(selected_rows) == 1:
            selected_company_id = str(_value(selected_rows[0], "company_id"))
    identity, company_id, firm, title = _identity(connection, person_id, selected_company_id)
    first_name = str(_value(identity, "first_name"))
    employment_source: _Observation | None = None
    if required & {"first_name", "company", "role", "transition_to", "recipient_hook"}:
        employment_source = _observation(
            connection, str(_value(identity, "source_observation_id")),
        )
        if employment_source is None or not _valid_source(
            employment_source, person_id, company_id,
            ("employment", "employer", "current_employer"), (first_name, firm, title),
        ):
            raise ValueError("evidence_identity_source_mismatch")

    sources: dict[str, _Observation] = {}
    claims: dict[str, str] = {}
    values: dict[str, str] = {}
    if "first_name" in required:
        name_rows = connection.execute(
            """SELECT observation_id FROM source_observation
                WHERE entity_type='person' AND entity_id=?
                  AND field IN ('name','first_name') ORDER BY observation_id""",
            (person_id,),
        ).fetchall()
        name_sources = [
            source for row in name_rows
            if (source := _observation(connection, str(_value(row, "observation_id")))) is not None
            and _valid_source(
                source, person_id, company_id, ("name", "first_name"), (first_name,),
            )
        ]
        sources["first_name"] = _first_valid(
            name_sources, "evidence_name_source_mismatch",
        )
        claims["first_name"], values["first_name"] = f"Known as {first_name}", first_name
    if "company" in required:
        if employment_source is None:
            raise ValueError("evidence_identity_source_mismatch")
        sources["company"] = employment_source
        claims["company"], values["company"] = f"Works at {firm} as {title}", firm
    if "role" in required:
        if employment_source is None:
            raise ValueError("evidence_identity_source_mismatch")
        sources["role"] = employment_source
        claims["role"], values["role"] = f"Holds the {title} role at {firm}", title
    if "recipient_hook" in required:
        if employment_source is None:
            raise ValueError("evidence_identity_source_mismatch")
        own_writing_ids = _signal_ids(affinity.signals, "own_writing")
        sources["recipient_hook"] = employment_source
        claims["recipient_hook"] = f"Holds the {title} role at {firm}"
        values["recipient_hook"] = f"Your {title} work at {firm} caught my attention."
        if own_writing_ids:
            candidates = [
                source for oid in sorted(own_writing_ids)
                if (source := _observation(connection, oid)) is not None
                and source.entity_id == person_id
                and _valid_source(source, person_id, company_id, ("link",))
                and source.excerpt
            ]
            # A malformed writing signal must not displace a verified current-role hook.
            # The current-employment source above remains mandatory in either case.
            if candidates and len(candidates[0].excerpt.split(".", 1)[0].split()) <= 10:
                source = _first_valid(candidates, "evidence_recipient_hook_source_mismatch")
                sources["recipient_hook"] = source
                claims["recipient_hook"] = source.excerpt
                fragment = source.excerpt.split(".", 1)[0].strip()
                values["recipient_hook"] = f"I read {fragment}."

    school_ids = _signal_ids(affinity.signals, "shared_school")
    if "school" in required:
        if school_ids:
            row = _signal_row(connection, "person_education", person_id, school_ids, "evidence_school_ambiguous")
        else:
            row = _one_row(
                _matching_rows(_normal_rows(connection, "person_education", person_id),
                               "school_raw", supplied.get("school")),
                "evidence_school_missing",
            )
        school = str(_value(row, "school_raw"))
        source = _row_source(
            connection, row, person_id, company_id, ("education",), (school,),
            "evidence_school_source_mismatch",
        )
        if source.entity_id != person_id:
            raise ValueError("evidence_school_source_mismatch")
        sources["school"], claims["school"], values["school"] = source, f"Attended {school}", school

    employer_ids = _signal_ids(affinity.signals, "shared_prior_employer")
    shared_prior_row: object | None = None
    if "why_them" in required or ({"transition_from", "transition_to"} & required):
        if employer_ids:
            shared_prior_row = _signal_row(
                connection, "person_employer", person_id, employer_ids, "evidence_employer_ambiguous",
            )
        elif "why_them" in required:
            shared_prior_row = _one_row(
                _matching_rows(_normal_rows(connection, "person_employer", person_id),
                               "employer_raw", supplied.get("why_them")),
                "evidence_employer_missing",
            )
    if "why_them" in required:
        if shared_prior_row is None:
            raise ValueError("evidence_employer_missing")
        row = shared_prior_row
        employer = str(_value(row, "employer_raw"))
        source = _row_source(
            connection, row, person_id, company_id, ("employer",), (employer,),
            "evidence_employer_source_mismatch",
        )
        if source.entity_id != person_id:
            raise ValueError("evidence_employer_source_mismatch")
        sources["why_them"] = source
        claims["why_them"] = f"Worked at {employer}"
        values["why_them"] = employer

    path_ids = _signal_ids(affinity.signals, "path_match")
    if {"transition_from", "transition_to"} & required:
        if employment_source is None:
            raise ValueError("evidence_identity_source_mismatch")
        current_row = _current_employer_row(connection, person_id, firm, title)
        current_source = _row_source(
            connection, current_row, person_id, company_id, ("employer", "employment", "current_employer"),
            (first_name, firm, title), "evidence_current_employer_source_mismatch",
        )
        current_observation_id = str(_value(current_row, "observation_id"))
        employment_observation_id = str(_value(identity, "source_observation_id"))
        explicit_prior_rows = tuple(
            row for row in _normal_rows(connection, "person_employer", person_id)
            if str(_value(row, "observation_id")) in path_ids
            and _normal(str(_value(row, "employer_raw"))) != _normal(firm)
        )
        if explicit_prior_rows:
            prior_row = _one_row(explicit_prior_rows, "evidence_path_ambiguous")
        else:
            if path_ids and not ({current_observation_id, employment_observation_id} & path_ids):
                raise ValueError("evidence_path_source_mismatch")
            if shared_prior_row is None:
                before = _transition(supplied.get("transition_from", ""))
                prior_row = _one_row(
                    tuple(
                        row for row in _normal_rows(connection, "person_employer", person_id)
                        if _normal(str(_value(row, "employer_raw"))) == _normal(before[1])
                        and _normal(str(_value(row, "employer_kind"))) == _normal(before[0])
                    ),
                    "evidence_path_missing",
                )
            else:
                prior_row = shared_prior_row
        prior = str(_value(prior_row, "employer_raw"))
        prior_kind = str(_value(prior_row, "employer_kind"))
        prior_source = _row_source(
            connection, prior_row, person_id, company_id, ("employer",), (prior,),
            "evidence_path_source_mismatch",
        )
        if prior_source.entity_id != person_id:
            raise ValueError("evidence_path_source_mismatch")
        current_kind = str(_value(current_row, "employer_kind"))
        sources["transition_from"] = prior_source
        claims["transition_from"] = f"Worked in {prior_kind} at {prior}"
        sources["transition_to"] = (
            employment_source if employment_observation_id in path_ids else current_source
        )
        claims["transition_to"] = f"Works in {current_kind} at {firm}"
        values["transition_from"] = f"{prior_kind} at {prior}"
        values["transition_to"] = f"{current_kind} at {firm}"

    if "path_transition" in required:
        current_row = _current_employer_row(connection, person_id, firm, title)
        current_observation_id = str(_value(current_row, "observation_id"))
        if current_observation_id not in path_ids:
            raise ValueError("evidence_path_source_mismatch")
        source = _row_source(
            connection, current_row, person_id, company_id,
            ("employer", "employment", "current_employer"),
            (first_name, firm, title),
            "evidence_path_source_mismatch",
        )
        current_kind = str(_value(current_row, "employer_kind"))
        sources["path_transition"] = source
        claims["path_transition"] = f"Current career category is {current_kind}"
        values["path_transition"] = current_kind

    if "role_level" in required:
        current_row = _current_employer_row(connection, person_id, firm, title)
        source_ids = _signal_ids(affinity.signals, "role_family_match") | _signal_ids(
            affinity.signals, "level_match",
        )
        current_observation_id = str(_value(current_row, "observation_id"))
        if current_observation_id not in source_ids:
            raise ValueError("evidence_role_level_source_mismatch")
        source = _row_source(
            connection, current_row, person_id, company_id,
            ("employer", "employment", "current_employer"),
            (first_name, firm, title),
            "evidence_role_level_source_mismatch",
        )
        sources["role_level"] = source
        claims["role_level"] = f"Current title is {title}"
        values["role_level"] = title

    for slot, codes, fields in (
        ("topic", ("firm_thesis",), ("topic",)),
        ("new_fact_sentence", ("own_writing", "board_or_portfolio"), ("link",)),
    ):
        if slot not in required:
            continue
        ids = frozenset().union(*(
            _signal_ids(affinity.signals, code) for code in codes
        ))
        candidates = []
        observation_ids = sorted(ids)
        if not observation_ids and slot in supplied:
            entity_id = company_id if slot == "topic" else person_id
            observation_ids = [item.observation_id for item in _observation_candidates(connection, entity_id, fields)]
        for oid in observation_ids:
            source = _observation(connection, oid)
            owner = company_id if slot == "topic" else person_id
            if (
                source is not None and source.entity_id == owner
                and _valid_source(source, person_id, company_id, fields)
                and (slot not in supplied or _normal(supplied[slot]) in _normal(source.excerpt))
            ):
                candidates.append(source)
        source = _first_valid(candidates, f"evidence_{slot}_source_mismatch")
        if not source.excerpt:
            raise ValueError(f"evidence_{slot}_source_mismatch")
        sources[slot] = source
        claims[slot] = source.excerpt
        values[slot] = source.excerpt
    return BoundFacts(company_id, firm, title, first_name, sources, claims, values)


def _transition(value: str) -> tuple[str, str]:
    kind, separator, employer = value.partition(" at ")
    return kind.strip() or value, employer.strip() if separator else value


def _word_prefix(display: str, canonical: str) -> bool:
    display_words = _normal(display).split()
    canonical_words = _normal(canonical).split()
    return bool(display_words) and canonical_words[:len(display_words)] == display_words


def _display_matches(slot: str, display: str, canonical: str) -> bool:
    if _normal(display) == _normal(canonical):
        return True
    if slot in {"role", "topic", "recipient_hook"}:
        return _word_prefix(display, canonical)
    if slot == "why_them":
        return _normal(display) == _normal(
            f"Your {canonical} experience caught my attention."
        )
    if slot == "path_transition":
        return _normal(display).split()[-1:] == _normal(canonical).split()
    if slot == "role_level":
        return _normal(display.replace("/", " ")).split()[-1:] == _normal(canonical).split()[-1:]
    return False


def _record_signal_evidence(connection, person_id: str, campaign_id: str,
                            signal: Signal | None, evidence_id: str) -> None:
    """Fill in the matching signal's evidence_id in the stored signals_json, if any.

    Applies to whichever signal ``_signals_for`` resolved for a slot -- not just "why_them", and
    not just the first match -- so every strong/medium signal backed by a minted claim ends up
    with a resolvable evidence_id, which the P8-B delivery gate requires.
    """
    if signal is None:
        return
    row = connection.execute(
        "SELECT signals_json FROM person_affinity WHERE person_id=? AND campaign_id=?", (person_id, campaign_id)
    ).fetchone()
    if row is None:
        return
    try:
        signals = json.loads(str(_value(row, "signals_json")))
    except json.JSONDecodeError:
        return
    if not isinstance(signals, list):
        return
    for item in signals:
        if isinstance(item, dict) and item.get("code") == signal.code:
            item["evidence_id"] = evidence_id
            connection.execute(
                "UPDATE person_affinity SET signals_json=? WHERE person_id=? AND campaign_id=?",
                (json.dumps(signals, sort_keys=True, separators=(",", ":")), person_id, campaign_id),
            )
            return


def mint_evidence(connection, person_id: str, campaign_id: str, affinity: Affinity,
                  slots: Mapping[str, str], now: datetime, confidence_floor: float = 0.7,
                  selected_company_id: str | None = None) -> Mapping[str, str]:
    """Mint claims from exact normalized facts bound to their authentic observations."""
    del now
    facts = resolve_slot_facts(
        connection, person_id, affinity, selected_company_id,
        required_slots=tuple(slots), supplied_slots=slots,
    )
    evidence_ids: dict[str, str] = {}
    for slot in CLAIM_TEMPLATES:
        if slot not in slots:
            continue
        source = facts.sources.get(slot)
        claim = facts.claims.get(slot)
        canonical = facts.values.get(slot)
        if source is None or claim is None or canonical is None:
            raise ValueError("evidence_fact_missing")
        if not _display_matches(slot, slots[slot], canonical):
            raise ValueError("evidence_display_mismatch")
        matched_signals = _signals_for(slot, affinity.signals)
        primary = next(
            (signal for signal in matched_signals if source.observation_id in signal.observation_ids),
            None,
        )
        if primary is None and slot == "transition_from":
            primary = next(
                (signal for signal in affinity.signals
                 if signal.code == "shared_prior_employer"
                 and source.observation_id in signal.observation_ids),
                None,
            )
        evidence_id = sha256(f"{person_id}|{campaign_id}|{slot}|{claim}".encode()).hexdigest()
        identity_class = "medium" if any(item.klass in {"strong", "medium"} for item in affinity.signals) else "gate"
        draft = EvidenceDraft(
            evidence_id, person_id, claim, source.snapshot_id, source.observed_at,
            source.excerpt, source.confidence,
            False if slot in {"path_transition", "role_level"} else
            COPY_ALLOWED_BY_CLASS.get(primary.klass if primary else identity_class, False),
        )
        try:
            insert_evidence(connection, draft, confidence_floor)
        except EvidenceError as error:
            if str(error) != "duplicate_evidence_id":
                raise
            stored = connection.execute(
                """SELECT person_id,claim,url,observed_at,retrieved_at,excerpt,
                          confidence,expires_at,allowed_for_copy
                     FROM evidence WHERE evidence_id=?""",
                (evidence_id,),
            ).fetchone()
            snapshot = connection.execute(
                """SELECT source_url,retrieved_at,expires_at
                     FROM source_snapshot WHERE snapshot_id=?""", (source.snapshot_id,),
            ).fetchone()
            compatible = stored is not None and snapshot is not None and (
                str(_value(stored, "person_id")), str(_value(stored, "claim")),
                str(_value(stored, "url")), _value(stored, "observed_at"),
                str(_value(stored, "retrieved_at")), str(_value(stored, "excerpt")),
                float(_value(stored, "confidence")), str(_value(stored, "expires_at")),
                bool(_value(stored, "allowed_for_copy")),
            ) == (
                person_id, claim, str(_value(snapshot, "source_url")), source.observed_at,
                str(_value(snapshot, "retrieved_at")), source.excerpt, source.confidence,
                str(_value(snapshot, "expires_at")), draft.allowed_for_copy,
            )
            if not compatible:
                raise ValueError("duplicate_evidence_conflict") from error
        evidence_ids[slot] = evidence_id
        for signal in matched_signals:
            if source.observation_id in signal.observation_ids:
                _record_signal_evidence(connection, person_id, campaign_id, signal, evidence_id)
    return evidence_ids
