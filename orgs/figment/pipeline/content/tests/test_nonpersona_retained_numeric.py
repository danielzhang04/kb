"""Non-finite JSON numbers at the retained-record boundary (overflowed literals like 1e999)."""

from __future__ import annotations

import pytest

from orgs.figment.pipeline.content import nonpersona_retained as retained


def _parse(text: str) -> dict:
    return retained._parse_retained(text.encode("utf-8"), "probe")


@pytest.mark.parametrize("text", [
    '{"seconds": 1e999}',
    '{"seconds": -1e999}',
    '{"jobs": [{"job": 1}], "unused": {"deep": {"seconds": 1e999}}}',
    '{"values": [0, 1.5, -1e999]}',
])
def test_overflowed_float_literals_are_rejected(text: str) -> None:
    with pytest.raises(retained.NonpersonaRetainedError, match="non-finite number"):
        _parse(text)


@pytest.mark.parametrize("text", ['{"seconds": Infinity}', '{"seconds": NaN}',
                                  '{"seconds": -Infinity}'])
def test_literal_nonfinite_constants_stay_rejected(text: str) -> None:
    with pytest.raises(ValueError, match="non-finite JSON constant"):
        _parse(text)


def test_finite_large_numbers_are_kept() -> None:
    huge_int = 10 ** 400  # math.isfinite would overflow on this; ints must pass untouched.
    value = _parse('{"seconds": 1e20, "nested": [{"n": %d}]}' % huge_int)
    assert value == {"seconds": 1e20, "nested": [{"n": huge_int}]}
    assert type(value["seconds"]) is float


def test_duplicate_keys_stay_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate JSON key"):
        _parse('{"seconds": 1, "seconds": 2}')


def _fixture(seconds: object) -> tuple[dict, list, dict]:
    cells = [{"id": f"c{n}", "seed": 100 + n, "output_name": f"out-{n}"} for n in (1, 2, 3)]
    manifest = {"jobs": [{"seed": c["seed"], "output_name": c["output_name"], "expected_images": 1}
                         for c in cells]}
    jobs = [{"job": n, "output_name": c["output_name"], "seed": c["seed"], "prompt_id": f"p{n}",
             "seconds": seconds if n == 1 else 2.5,
             "files": [{"path": f"{c['output_name']}.png", "bytes": 1024}]}
            for n, c in enumerate(cells, start=1)]
    run = {"schema": retained.RUN_SCHEMA, "dry_run": False, "termination_verified": True,
           "uploads": [], "artifacts": [], "jobs": jobs}
    return run, cells, manifest


def test_check_run_fixture_is_valid_with_finite_seconds() -> None:
    rows = retained._check_run(*_fixture(3.25))
    assert [row["path"] for row in rows] == ["out-1.png", "out-2.png", "out-3.png"]


@pytest.mark.parametrize("seconds", [float("inf"), float("nan")])
def test_check_run_rejects_nonfinite_seconds(seconds: float) -> None:
    with pytest.raises(retained.NonpersonaRetainedError, match="run job 1 seconds is not finite"):
        retained._check_run(*_fixture(seconds))
