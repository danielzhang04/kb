import datetime

import grade
import ledger
import pytest


def _valid_fields(**overrides):
    fields = dict(
        worker="claude-worker-1",
        project="kb-ops",
        task_type="triage",
        tier="cloud",
        card_id="card-abc123",
        score=92,
        pass_field=True,
        rubric_version="v1",
        inspector_id="inspector",
    )
    fields["pass"] = fields.pop("pass_field")
    fields.update(overrides)
    return fields


SCHEMA_KEYS = {
    "worker",
    "project",
    "task_type",
    "tier",
    "card_id",
    "score",
    "pass",
    "rubric_version",
    "inspector_id",
    "ts",
}


def test_grade_row_schema(tmp_path):
    today = datetime.date.today().isoformat()
    grade.record_grade(tmp_path, **_valid_fields())

    grade_rows = ledger.read_day(tmp_path, "grades", today)
    assert len(grade_rows) == 1
    assert set(grade_rows[0].keys()) == SCHEMA_KEYS

    # paired activity row, authored under the Inspector identity, in the same call
    activity_rows = ledger.read_day(tmp_path, "activity", today)
    assert len(activity_rows) == 1
    assert activity_rows[0]["inspector_id"] == "inspector"
    assert activity_rows[0]["card_id"] == "card-abc123"

    activity_dir = tmp_path / "ledgers" / "activity"
    shards = list(activity_dir.glob("inspector-*.tsv"))
    assert len(shards) == 1


def test_score_out_of_range_rejected(tmp_path):
    with pytest.raises(ValueError):
        grade.record_grade(tmp_path, **_valid_fields(score=101))
    with pytest.raises(ValueError):
        grade.record_grade(tmp_path, **_valid_fields(score=-1))
    assert ledger.read_day(tmp_path, "grades", datetime.date.today().isoformat()) == []


def test_score_boundaries_accepted(tmp_path):
    grade.record_grade(tmp_path, **_valid_fields(score=0, card_id="c-low"))
    grade.record_grade(tmp_path, **_valid_fields(score=100, card_id="c-high"))
    rows = ledger.read_day(tmp_path, "grades", datetime.date.today().isoformat())
    assert len(rows) == 2


def test_missing_field_rejected(tmp_path):
    fields = _valid_fields()
    del fields["rubric_version"]
    with pytest.raises(ValueError):
        grade.record_grade(tmp_path, **fields)
    assert ledger.read_day(tmp_path, "grades", datetime.date.today().isoformat()) == []


def test_extra_field_rejected(tmp_path):
    with pytest.raises(ValueError):
        grade.record_grade(tmp_path, **_valid_fields(extra_field="nope"))
    assert ledger.read_day(tmp_path, "grades", datetime.date.today().isoformat()) == []


def test_pass_must_be_bool(tmp_path):
    with pytest.raises(ValueError):
        grade.record_grade(tmp_path, **_valid_fields(**{"pass": "true"}))
    with pytest.raises(ValueError):
        grade.record_grade(tmp_path, **_valid_fields(**{"pass": 1}))
    assert ledger.read_day(tmp_path, "grades", datetime.date.today().isoformat()) == []


def test_score_must_be_numeric_not_bool(tmp_path):
    with pytest.raises(ValueError):
        grade.record_grade(tmp_path, **_valid_fields(score=True))


def test_ts_auto_generated_when_omitted(tmp_path):
    grade.record_grade(tmp_path, **_valid_fields())
    rows = ledger.read_day(tmp_path, "grades", datetime.date.today().isoformat())
    assert rows[0]["ts"]


def test_ts_explicit_value_preserved(tmp_path):
    grade.record_grade(tmp_path, **_valid_fields(ts="2026-07-16T00:00:00+00:00"))
    rows = ledger.read_day(tmp_path, "grades", datetime.date.today().isoformat())
    assert rows[0]["ts"] == "2026-07-16T00:00:00+00:00"
