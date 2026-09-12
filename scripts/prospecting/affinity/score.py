"""Deterministic, local affinity scoring for approved fit specifications."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
import json
from typing import Any

from .anchors import normalize
from .bio import chronological_kind_sequence
from .fitspec import REASON_CODES, fit_spec_hash
from ..discovery.snov_domain import (
    DEFAULT_TITLE_FUNCTION_EXCLUSIONS,
    _has_excluded_title_function,
    _matching_title_rules,
)


@dataclass(frozen=True)
class Signal:
    code: str
    klass: str
    strength: int
    weight: int
    points: int
    observation_ids: tuple[str, ...]
    evidence_id: str | None = None


@dataclass(frozen=True)
class Affinity:
    person_id: str
    campaign_id: str
    score: int
    signals: tuple[Signal, ...]
    fit_spec_hash: str


@dataclass(frozen=True)
class ScoreSummary:
    scored: int
    rewritten: int
    above_fit: int
    zeroed: int


def _value(record: object, field: str, default: Any = None) -> Any:
    if isinstance(record, Mapping):
        return record.get(field, default)
    try:
        return record[field]  # type: ignore[index]
    except (IndexError, KeyError, TypeError):
        return getattr(record, field, default)


def _values(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return ()
    return tuple(item for item in value if isinstance(item, str)) if isinstance(value, Sequence) else ()


def _observation_ids(records: Sequence[object]) -> tuple[str, ...]:
    return tuple(str(value) for record in records if (value := _value(record, "observation_id")) is not None)


def _kind_history_from_employers(employers: Sequence[object]) -> tuple[tuple[str, ...], str | None]:
    """Rebuild the chronological (kind_sequence, current_kind) pair straight from employer rows.

    The stored row order (and any previously-persisted person_background values) is untrusted:
    this uses the same chronological rule persist_bio_facts uses, so scoring and any background
    reconciliation agree regardless of how the rows were originally persisted.
    """
    rows = []
    for index, row in enumerate(employers):
        ordinal = _value(row, "ordinal")
        rows.append((
            index if ordinal is None else int(ordinal),
            _value(row, "start_year"), _value(row, "end_year"),
            str(_value(row, "employer_kind", "other")),
        ))
    sequence, current = chronological_kind_sequence(rows)
    return tuple(sequence), current


def lcs_length(left: Sequence[str], right: Sequence[str]) -> int:
    """Return the classic dynamic-programming longest common subsequence length."""
    previous = [0] * (len(right) + 1)
    for left_item in left:
        current = [0]
        for index, right_item in enumerate(right, 1):
            current.append(previous[index - 1] + 1 if left_item == right_item else max(previous[index], current[-1]))
        previous = current
    return previous[-1]


def path_ratio(person_kinds: Sequence[str], target_kinds: Sequence[str], current_kind: str | None) -> int:
    """Return integer-only ordered career-path similarity, capped at 100."""
    if not person_kinds or not target_kinds:
        return 0
    lcs = lcs_length(tuple(person_kinds), tuple(target_kinds))
    ratio = (200 * lcs) // (len(person_kinds) + len(target_kinds))
    if ratio and current_kind and target_kinds[-1] == current_kind:
        ratio += 15
    return min(100, ratio)


def band(ratio: int) -> int | None:
    """Map a path ratio to its permitted scoring strength."""
    return 100 if ratio >= 75 else (70 if ratio >= 50 else None)


def _signal(code: str, weight: int, strength: int, observations: Sequence[str] = ()) -> Signal:
    klass = REASON_CODES.get(code, "aside")
    points = 0 if klass == "weak" or code == "path_pair_observed" else round(weight * strength / 100)
    return Signal(code, klass, strength, weight, points, tuple(observations))


def _excluded_title_token(title: str, exclusions: Sequence[str]) -> str | None:
    """Return the configured exclusion phrase found in ``title``, in list order, or ``None``."""
    return next((value for value in exclusions if _has_excluded_title_function(title, (value,))), None)


def _current_employer_observation_id(employers: Sequence[object]) -> str | None:
    """Return the observation_id backing whichever person_employer row is the person's current role.

    Mirrors chronological_kind_sequence's own ordering and "current" pick (oldest-to-newest by
    start_year, ties broken by ordinal descending; current = the still-held role, else the
    chronologically latest) but applied to the real rows, so the row's own observation_id --
    not just its kind -- can be cited as evidence for path_match / role_family_match / level_match.
    """
    if not employers:
        return None
    ordered = sorted(
        employers,
        key=lambda row: (
            _value(row, "start_year") is None, _value(row, "start_year") or 0,
            -int(_value(row, "ordinal", 0) or 0),
        ),
    )
    current = next((row for row in ordered if _value(row, "end_year") is None), ordered[-1])
    value = _value(current, "observation_id")
    return str(value) if value is not None else None


def _matched_signals(spec: Mapping[str, object], anchors: object, background: object,
                     education: Sequence[object], employers: Sequence[object], links: Sequence[object],
                     title: str, level: str | None,
                     exclusions: Sequence[str] = DEFAULT_TITLE_FUNCTION_EXCLUSIONS,
                     employment_observation_id: str | None = None) -> tuple[Signal, ...]:
    weights = _value(spec, "weighted_signals", {})
    weights = weights if isinstance(weights, Mapping) else {}
    matched: list[Signal] = []
    school_rows = tuple(row for row in education if _value(anchors, "schools").match(str(_value(row, "school_norm", _value(row, "school_raw", "")))))
    if school_rows:
        matched.append(_signal("shared_school", int(weights.get("shared_school", 0)), 100, _observation_ids(school_rows)))
    employer_rows = tuple(row for row in employers if _value(anchors, "employers").match(str(_value(row, "employer_norm", _value(row, "employer_raw", "")))))
    if employer_rows:
        matched.append(_signal("shared_prior_employer", int(weights.get("shared_prior_employer", 0)), 100, _observation_ids(employer_rows)))

    if employers:
        kinds, current_kind = _kind_history_from_employers(employers)
    else:
        kinds = _values(_value(background, "kind_sequence"))
        current_kind = _value(background, "current_kind")
    current_employer_observation_id = _current_employer_observation_id(employers)
    best: tuple[int, Mapping[str, object]] | None = None
    pair_seen = False
    for path in _value(spec, "paths", ()):  # validated by fitspec before persistence
        if not isinstance(path, Mapping):
            continue
        target = _values(path.get("kinds", ()))
        ratio = path_ratio(kinds, target, current_kind)
        if len(target) > 1 and any(kinds[index:index + 2] == target[index:index + 2] for index in range(min(len(kinds), len(target)) - 1)):
            pair_seen = True
        if best is None or ratio > best[0]:
            best = ratio, path
    if best is not None and (strength := band(best[0])) is not None:
        # The approved fit spec's shared signal table is the sole scoring-weight authority.
        matched.append(_signal(
            "path_match", int(weights.get("path_match", 0)), strength,
            (current_employer_observation_id,) if current_employer_observation_id else (),
        ))
    if pair_seen:
        matched.append(Signal("path_pair_observed", "aside", 0, 0, 0, ()))

    link_groups = {kind: tuple(row for row in links if _value(row, "kind") == kind) for kind in ("writing", "board", "portfolio")}
    if link_groups["writing"]:
        matched.append(_signal("own_writing", int(weights.get("own_writing", 0)), 100, _observation_ids(link_groups["writing"])))
    if link_groups["board"] or link_groups["portfolio"]:
        matched.append(_signal("board_or_portfolio", int(weights.get("board_or_portfolio", 0)), 100, _observation_ids(link_groups["board"] + link_groups["portfolio"])))
    # role_family_match / level_match cite whichever of (this role's own source_observation,
    # the bio/LinkedIn observation backing the current person_employer row) actually resolves --
    # _source_for_signal tries them in this order and stops at the first that does.
    title_observation_ids = tuple(
        oid for oid in (employment_observation_id, current_employer_observation_id) if oid
    )
    normal_title = normalize(title)
    excluded_token = _excluded_title_token(title, exclusions)
    for family in _value(spec, "role_families", ()):
        if isinstance(family, Mapping) and any(normalize(token) in normal_title for token in _values(family.get("title_tokens", ()))):
            if excluded_token is not None:
                matched.append(Signal(f"role_family_excluded:{excluded_token}", "gate", 0, 0, 0, ()))
            else:
                matched.append(_signal("role_family_match", int(weights.get("role_family_match", 0)), 100, title_observation_ids))
            break
    if level is not None and normalize(level) in {normalize(item) for item in _values(_value(spec, "levels", ()))}:
        matched.append(_signal("level_match", int(weights.get("level_match", 0)), 100, title_observation_ids))
    topics = {normalize(value) for value in _values(_value(background, "topics", ()))}
    if topics & set(_value(anchors, "domains", ())):
        matched.append(_signal("firm_thesis", int(weights.get("firm_thesis", 0)), 100))
    hometown = _value(background, "hometown_hint")
    if hometown and normalize(str(hometown)) in set(_value(anchors, "geography", ())):
        matched.append(_signal("hometown", 0, 100))
    interests = {normalize(value) for value in _values(_value(background, "interests", ()))}
    if interests & set(_value(anchors, "interests", ())):
        matched.append(_signal("shared_interest", 0, 100))
    activities = {normalize(value) for value in _values(_value(background, "activities", ()))}
    if activities & set(_value(anchors, "activities", ())):
        matched.append(_signal("shared_activity", 0, 100))
    return tuple(matched)


def _ordered(signals: Sequence[Signal]) -> tuple[Signal, ...]:
    ranks = {"strong": 0, "medium": 1, "weak": 2, "aside": 2, "gate": -1}
    return tuple(sorted(signals, key=lambda item: (ranks.get(item.klass, 3), -item.points, item.code)))


def _derive_level(spec: Mapping[str, object], title: str, exclusions: Sequence[str]) -> str | None:
    """Weak fallback: classify a level from the title using the discovery lane's own rules.

    Used whenever a real ``seniority_class`` is unavailable, or present but not itself one of
    this fit spec's own ``levels`` (e.g. a P6 class like ``"individual"`` that the fit spec never
    declared). A ``seniority_class`` that *is* one of the spec's own levels always wins over this.
    """
    levels = _values(_value(spec, "levels", ()))
    if not levels:
        return None
    rules = tuple({"class": level} for level in levels)
    matches = _matching_title_rules(title, rules, exclusions)
    return levels[matches[0]] if matches else None


def _is_spec_level(spec: Mapping[str, object], level: str | None) -> bool:
    """Return whether ``level`` is itself one of this fit spec's own (normalised) levels."""
    if not level:
        return False
    return normalize(level) in {normalize(item) for item in _values(_value(spec, "levels", ()))}


def score_person(spec, anchors, background, education, employers, links, title: str,
                 level: str | None, person_id: str, campaign_id: str,
                 exclusions: Sequence[str] = DEFAULT_TITLE_FUNCTION_EXCLUSIONS,
                 employment_observation_id: str | None = None) -> Affinity:
    """Score one candidate using only approved, stored affinity facts."""
    effective_level = level if _is_spec_level(spec, level) else _derive_level(spec, title, exclusions)
    matched = _matched_signals(spec, anchors, background, tuple(education), tuple(employers), tuple(links), title, effective_level, exclusions, employment_observation_id)
    codes = {signal.code for signal in matched}
    digest = fit_spec_hash(spec)
    for required in _value(spec, "required_signals", ()):
        if required not in codes:
            excluded = next((signal for signal in matched if signal.code.startswith("role_family_excluded:")), None)
            reason = excluded if required == "role_family_match" and excluded is not None else Signal("required_missing", "gate", 0, 0, 0, ())
            return Affinity(person_id, campaign_id, 0, (reason,), digest)
    normal_title = normalize(title)
    kinds = {str(_value(row, "employer_kind", "")) for row in employers}
    for disqualifier in _value(spec, "disqualifiers", ()):
        if not isinstance(disqualifier, Mapping):
            continue
        kind, value = disqualifier.get("kind"), normalize(str(disqualifier.get("value", "")))
        hit = (kind == "employer_kind" and value in kinds) or (kind == "title_token" and value in normal_title) or (kind == "level" and level is not None and value == normalize(level))
        if hit:
            return Affinity(person_id, campaign_id, 0, (Signal(f"disqualified_{kind}", "gate", 0, 0, 0, ()),), digest)
    ordered = _ordered(matched)
    score = min(100, sum(signal.points for signal in ordered))
    if bool(_value(spec, "require_strong_or_medium", True)) and not any(signal.klass in {"strong", "medium"} for signal in ordered):
        score = 0
    return Affinity(person_id, campaign_id, score, ordered, digest)


def _signals_json(signals: Sequence[Signal]) -> str:
    return json.dumps([asdict(signal) for signal in signals], sort_keys=True, separators=(",", ":"))


def _carry_forward_evidence(connection, person_id: str, campaign_id: str,
                            signals: Sequence[Signal]) -> tuple[Signal, ...]:
    """Preserve each signal's previously-minted evidence_id across a re-score.

    score_person always computes a fresh Signal with evidence_id=None; only the evidence bridge
    (mint_evidence -> _record_signal_evidence) ever assigns a real one, by patching it into the
    stored signals_json after the row already exists. Without this, a re-score after minting
    would overwrite that row with the freshly-computed (evidence_id=None) signals and silently
    drop every evidence_id the bridge wrote back. A signal keeps its prior evidence_id only when
    the same code was already stored and that id still resolves to a real evidence row.
    """
    existing = connection.execute(
        "SELECT signals_json FROM person_affinity WHERE person_id=? AND campaign_id=?", (person_id, campaign_id)
    ).fetchone()
    if existing is None:
        return tuple(signals)
    try:
        stored = json.loads(_value(existing, "signals_json"))
    except (TypeError, json.JSONDecodeError):
        return tuple(signals)
    if not isinstance(stored, list):
        return tuple(signals)
    prior_ids = {
        item["code"]: item["evidence_id"]
        for item in stored if isinstance(item, dict) and item.get("evidence_id") and isinstance(item.get("code"), str)
    }
    if not prior_ids:
        return tuple(signals)
    live_ids = {
        code: evidence_id for code, evidence_id in prior_ids.items()
        if connection.execute("SELECT 1 FROM evidence WHERE evidence_id=?", (evidence_id,)).fetchone() is not None
    }
    if not live_ids:
        return tuple(signals)
    return tuple(
        replace(signal, evidence_id=live_ids[signal.code]) if signal.code in live_ids else signal
        for signal in signals
    )


def _reconcile_background_kind_history(connection, person_id: str, employers: Sequence[object],
                                       stored_current: object, stored_sequence: object, now: str) -> None:
    """Rewrite a stale person_background.kind_sequence/current_kind pair, idempotently.

    Some rows were persisted before chronological_kind_sequence existed and are still stored
    most-recent-first; the deliverable_v2 blurb's "ex-<kind>" phrase reads current_kind directly,
    so a stale pair silently mislabels a person's most recent former role. person_employer is the
    authoritative, append-only fact table, so it always wins over whatever was last persisted.
    """
    if not employers:
        return
    derived_sequence, derived_current = _kind_history_from_employers(employers)
    if _values(stored_sequence) == derived_sequence and stored_current == derived_current:
        return
    connection.execute(
        "UPDATE person_background SET current_kind=?,kind_sequence=?,updated_at=? WHERE person_id=?",
        (derived_current or "other", json.dumps(list(derived_sequence)), now, person_id),
    )


def score_campaign(connection, campaign_id: str, *, anchors, now: str) -> ScoreSummary:
    """Persist changed affinity rows for the campaign's existing P6 candidates only."""
    from ..operator.vendors import title_function_exclusions
    exclusions = title_function_exclusions(connection)
    fit = connection.execute("SELECT fit_spec_hash,fit_spec_json FROM campaign_fit_spec WHERE campaign_id=? AND state='approved'", (campaign_id,)).fetchone()
    if fit is None:
        raise ValueError("approved_fit_spec_missing")
    spec = json.loads(fit["fit_spec_json"] if hasattr(fit, "keys") else fit[1])
    people = connection.execute(
        """SELECT fp.person_id,e.title,e.source_observation_id,pp.seniority_class,b.has_about,
                  b.hometown_hint,b.current_kind,b.kind_sequence
           FROM fill_person AS fp LEFT JOIN employment AS e ON e.person_id=fp.person_id AND e.valid_to IS NULL
           LEFT JOIN person_profile AS pp ON pp.person_id=fp.person_id LEFT JOIN person_background AS b ON b.person_id=fp.person_id
           WHERE fp.campaign_id=? ORDER BY fp.person_id""", (campaign_id,)).fetchall()
    rewritten = above_fit = zeroed = 0
    for person in people:
        person_id = _value(person, "person_id")
        education = connection.execute("SELECT * FROM person_education WHERE person_id=? ORDER BY ordinal", (person_id,)).fetchall()
        employers = connection.execute("SELECT * FROM person_employer WHERE person_id=? ORDER BY ordinal", (person_id,)).fetchall()
        links = connection.execute("SELECT * FROM person_link WHERE person_id=? ORDER BY ordinal", (person_id,)).fetchall()
        _reconcile_background_kind_history(
            connection, person_id, employers, _value(person, "current_kind"), _value(person, "kind_sequence"), now,
        )
        affinity = score_person(
            spec, anchors, person, education, employers, links, _value(person, "title", "") or "",
            _value(person, "seniority_class"), person_id, campaign_id, exclusions,
            employment_observation_id=_value(person, "source_observation_id"),
        )
        carried_signals = _carry_forward_evidence(connection, person_id, campaign_id, affinity.signals)
        if carried_signals != affinity.signals:
            affinity = replace(affinity, signals=carried_signals)
        signals_json = _signals_json(affinity.signals)
        existing = connection.execute("SELECT fit_spec_hash,signals_json FROM person_affinity WHERE person_id=? AND campaign_id=?", (person_id, campaign_id)).fetchone()
        unchanged = existing is not None and _value(existing, "fit_spec_hash") == affinity.fit_spec_hash and _value(existing, "signals_json") == signals_json
        if not unchanged:
            connection.execute(
                """INSERT INTO person_affinity(person_id,campaign_id,score,signals_json,computed_at,fit_spec_hash) VALUES(?,?,?,?,?,?)
                   ON CONFLICT(person_id,campaign_id) DO UPDATE SET score=excluded.score,signals_json=excluded.signals_json,
                   computed_at=excluded.computed_at,fit_spec_hash=excluded.fit_spec_hash""",
                (person_id, campaign_id, affinity.score, signals_json, now, affinity.fit_spec_hash),
            )
            rewritten += 1
        above_fit += int(affinity.score >= int(spec.get("min_fit", 25)))
        zeroed += int(affinity.score == 0)
    return ScoreSummary(len(people), rewritten, above_fit, zeroed)
