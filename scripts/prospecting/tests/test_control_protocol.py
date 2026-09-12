from datetime import datetime, timedelta, timezone
import json

import pytest

from scripts.prospecting.control_protocol import (
    ControlProtocolError, ControlRequest, ControlResult, encode_request, encode_result,
    parse_request, parse_result,
)

NOW = datetime(2099, 1, 1, 12, tzinfo=timezone.utc)


def request(**changes) -> ControlRequest:
    values = {
        "version": 1, "request_id": "ctlreq_" + "1" * 32,
        "control_ref": "ctl_" + "2" * 32, "operation": "status",
        "not_before": "2099-01-01T12:00:00Z", "expires_at": "2099-01-01T13:00:00Z",
    }
    values.update(changes)
    return ControlRequest(**values)


def test_request_round_trip_is_canonical_and_hash_bound() -> None:
    item = request()
    encoded = encode_request(item)
    assert parse_request(encoded, now=NOW) == item
    assert len(item.digest) == 64
    assert encoded == encode_request(parse_request(encoded))


@pytest.mark.parametrize("data,code", [
    (b'{"version":1,"version":1}', "json_duplicate_key"),
    (json.dumps({**request().__dict__, "extra": 1}).encode(), "request_schema"),
    (json.dumps({**request().__dict__, "version": True}).encode(), "request_schema"),
    (json.dumps({**request().__dict__, "operation": "gmail_send"}).encode(), "request_schema"),
    (b"{" + b" " * 4096 + b"}", "envelope_size"),
])
def test_request_rejects_nonexact_envelopes(data: bytes, code: str) -> None:
    with pytest.raises(ControlProtocolError, match=f"^{code}$"):
        parse_request(data)


@pytest.mark.parametrize("changes,code", [
    ({"not_before": "2099-01-01T12:00:00+00:00"}, "timestamp_invalid"),
    ({"expires_at": "2099-01-03T12:00:00Z"}, "request_lifetime"),
])
def test_request_time_contract_is_bounded(changes: dict[str, object], code: str) -> None:
    with pytest.raises(ControlProtocolError, match=f"^{code}$"):
        parse_request(encode_request(request(**changes)))


def test_request_must_be_current_when_claimed() -> None:
    with pytest.raises(ControlProtocolError, match="^request_not_ready$"):
        parse_request(encode_request(request()), now=NOW - timedelta(seconds=1))
    with pytest.raises(ControlProtocolError, match="^request_expired$"):
        parse_request(encode_request(request()), now=NOW + timedelta(hours=1))


def test_result_round_trip_rejects_unbounded_or_unknown_counts() -> None:
    result = ControlResult(1, request().request_id, "a" * 64, "succeeded", "status", {"due": 2})
    assert parse_result(encode_result(result)) == result
    for counts in ({"unknown": 1}, {"due": True}, {"due": 1_000_001}):
        changed = ControlResult(1, result.request_id, result.request_hash, result.state, result.code, counts)
        with pytest.raises(ControlProtocolError, match="^result_schema$"):
            parse_result(json.dumps({**changed.__dict__, "counts": counts}).encode())


def test_result_duplicate_nested_key_is_rejected() -> None:
    raw = (
        '{"version":1,"request_id":"ctlreq_' + "1" * 32 + '","request_hash":"' +
        "a" * 64 + '","state":"succeeded","code":"status","counts":{"due":1,"due":2}}'
    ).encode()
    with pytest.raises(ControlProtocolError, match="^json_duplicate_key$"):
        parse_result(raw)


@pytest.mark.parametrize("field,value", [("state", []), ("code", {})])
def test_result_rejects_unhashable_typed_fields(field: str, value: object) -> None:
    result = ControlResult(1, request().request_id, "a" * 64, "succeeded", "status", {})
    raw = json.dumps({**result.__dict__, field: value}).encode()
    with pytest.raises(ControlProtocolError, match="^result_schema$"):
        parse_result(raw)
