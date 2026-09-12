"""Campaign-scoped local companion for one explicitly selected control request."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import re
import sqlite3

from scripts.prospecting.control_desktop import (
    ControlError,
    DesktopControl,
    ReceiptView,
    SshPullTransport,
    read_receipt,
    run_once,
)
from scripts.prospecting.control_protocol import (
    CONTROL_REF,
    OPERATIONS,
    REQUEST_ID,
    ControlResult,
    parse_request,
    parse_result,
)


_CAMPAIGN_ID = re.compile(r"camp_[0-9a-f]{16}\Z")
_DISPLAY_CAMPAIGN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")


class ControlReviewError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise ControlReviewError(code)


def _expiry(value: object) -> datetime:
    if type(value) is not str or not value.endswith("Z"):
        _fail("control_binding_invalid")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        _fail("control_binding_invalid")
    if parsed.tzinfo != timezone.utc or parsed.microsecond:
        _fail("control_binding_invalid")
    if parsed.isoformat(timespec="seconds").replace("+00:00", "Z") != value:
        _fail("control_binding_invalid")
    return parsed


@dataclass(frozen=True)
class ControlReviewConfig:
    campaign_id: str
    control_ref: str
    operation: str
    configured_request_id: str
    control: DesktopControl
    transport: SshPullTransport


@dataclass(frozen=True)
class ControlReviewStatus:
    enabled: bool
    campaign_id: str
    configured_request_id: str | None
    control_ref: str | None
    operation: str | None
    grant_state: str | None
    receipt_state: str | None
    remote_acknowledgement: str
    code: str
    counts: dict[str, int]


class ControlReviewAdapter:
    """Expose status and a single user-triggered, exactly bound pull operation."""

    def __init__(
        self,
        connection: sqlite3.Connection,
        config: ControlReviewConfig | None = None,
    ) -> None:
        self.connection = connection
        self.config = config
        if config is None:
            return
        if (
            type(config.campaign_id) is not str
            or _CAMPAIGN_ID.fullmatch(config.campaign_id) is None
            or type(config.control_ref) is not str
            or CONTROL_REF.fullmatch(config.control_ref) is None
            or type(config.operation) is not str
            or config.operation not in OPERATIONS
            or type(config.configured_request_id) is not str
            or REQUEST_ID.fullmatch(config.configured_request_id) is None
        ):
            _fail("control_config_invalid")
        if config.control.connection is not connection:
            _fail("control_store_mismatch")

    def _selected_campaign(self, campaign_id: str) -> None:
        if type(campaign_id) is not str or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
            _fail("campaign_id_invalid")
        if self.connection.execute(
            "SELECT 1 FROM campaign WHERE campaign_id=?", (campaign_id,)
        ).fetchone() is None:
            _fail("campaign_missing")
        if self.config is not None and campaign_id != self.config.campaign_id:
            _fail("control_campaign_mismatch")

    def _receipt(self) -> ReceiptView | None:
        assert self.config is not None
        receipt = read_receipt(
            self.connection, self.config.configured_request_id
        )
        if receipt is not None and (
            receipt.control_ref,
            receipt.operation,
        ) != (self.config.control_ref, self.config.operation):
            _fail("control_receipt_mismatch")
        return receipt

    def _grant_scope(self):
        assert self.config is not None
        row = self.connection.execute(
            "SELECT g.campaign_id,g.policy_hash,g.operation,g.approval_tier,"
            "g.state,g.expires_at,c.policy_hash,c.approval_tier,c.status "
            "FROM remote_control_grant g LEFT JOIN campaign c "
            "ON c.campaign_id=g.campaign_id WHERE g.control_ref=?",
            (self.config.control_ref,),
        ).fetchone()
        if row is None:
            return None
        if row[0] != self.config.campaign_id or row[2] != self.config.operation:
            _fail("control_binding_mismatch")
        return row

    def _current_authorization(self, row) -> tuple[str, str]:
        if row is None:
            return "missing", "grant_missing"
        if (
            row[3] != "T0"
            or row[6] != row[1]
            or row[7] != row[3]
        ):
            _fail("control_binding_mismatch")
        if row[8] != "active":
            return row[4], "campaign_inactive"
        if row[4] != "active":
            return row[4], "grant_inactive"
        current = self.config.control.now()
        if current.tzinfo is None or current.utcoffset() is None:
            _fail("aware_now_required")
        current = current.astimezone(timezone.utc)
        if current >= _expiry(row[5]):
            return row[4], "grant_expired"
        return row[4], "ready"

    def _terminal_result(self, receipt: ReceiptView) -> ControlResult:
        assert self.config is not None
        row = self.connection.execute(
            "SELECT request_hash,result_json FROM remote_control_receipt "
            "WHERE request_id=?",
            (self.config.configured_request_id,),
        ).fetchone()
        if row is None or row[1] is None:
            _fail("control_receipt_missing")
        result = parse_result(row[1].encode())
        if (
            result.request_id != self.config.configured_request_id
            or result.request_hash != row[0]
            or result.state != receipt.state
        ):
            _fail("control_receipt_mismatch")
        return result

    def _reconcile(self, result: ControlResult) -> None:
        assert self.config is not None
        try:
            self.config.transport.complete(result)
            return
        except ControlError:
            data = self.config.transport.claim_next(
                request_id=self.config.configured_request_id,
                control_ref=self.config.control_ref,
                operation=self.config.operation,
            )
        if data is None:
            _fail("control_acknowledgement_unverified")
        request = parse_request(data)
        if (
            request.request_id,
            request.control_ref,
            request.operation,
            request.digest,
        ) != (
            self.config.configured_request_id,
            self.config.control_ref,
            self.config.operation,
            result.request_hash,
        ):
            _fail("control_request_mismatch")
        self.config.transport.complete(result)

    def status(self, campaign_id: str) -> ControlReviewStatus:
        if (
            type(campaign_id) is not str
            or _DISPLAY_CAMPAIGN_ID.fullmatch(campaign_id) is None
        ):
            _fail("campaign_id_invalid")
        if self.config is None:
            return ControlReviewStatus(
                False, campaign_id, None, None, None, None, None,
                "not_applicable", "disabled", {},
            )
        if campaign_id != self.config.campaign_id:
            return ControlReviewStatus(
                False,
                campaign_id,
                None,
                None,
                None,
                None,
                None,
                "not_applicable",
                "campaign_unavailable",
                {},
            )
        self._selected_campaign(campaign_id)
        grant = self._grant_scope()
        receipt = self._receipt()
        terminal = receipt is not None and receipt.state in {"succeeded", "failed"}
        if terminal:
            grant_state = "missing" if grant is None else grant[4]
            code = receipt.code or "request_in_progress"
        else:
            grant_state, code = self._current_authorization(grant)
            if receipt is not None and code == "ready":
                code = "request_in_progress"
        return ControlReviewStatus(
            True,
            campaign_id,
            self.config.configured_request_id,
            self.config.control_ref,
            self.config.operation,
            grant_state,
            None if receipt is None else receipt.state,
            (
                "unverified"
                if receipt is not None and receipt.state in {"succeeded", "failed"}
                else "not_applicable"
            ),
            code,
            {} if receipt is None else dict(receipt.counts),
        )

    def process(
        self, campaign_id: str, configured_request_id: str
    ) -> ControlReviewStatus:
        if self.config is None:
            _fail("control_unavailable")
        self._selected_campaign(campaign_id)
        if (
            type(configured_request_id) is not str
            or REQUEST_ID.fullmatch(configured_request_id) is None
            or configured_request_id != self.config.configured_request_id
        ):
            _fail("control_request_mismatch")
        grant = self._grant_scope()
        receipt = self._receipt()
        if receipt is not None and receipt.state in {"succeeded", "failed"}:
            if grant is None:
                _fail("grant_missing")
            self._reconcile(self._terminal_result(receipt))
            return replace(
                self.status(campaign_id), remote_acknowledgement="confirmed"
            )
        _grant_state, code = self._current_authorization(grant)
        if code != "ready":
            _fail(code)
        processed = run_once(
            self.config.control,
            self.config.transport,
            request_id=self.config.configured_request_id,
            control_ref=self.config.control_ref,
            operation=self.config.operation,
        )
        if not processed:
            _fail("control_request_unavailable")
        receipt = self._receipt()
        if receipt is None or receipt.state not in {"succeeded", "failed"}:
            _fail("control_receipt_missing")
        return replace(
            self.status(campaign_id), remote_acknowledgement="confirmed"
        )


__all__ = [
    "ControlReviewAdapter",
    "ControlReviewConfig",
    "ControlReviewError",
    "ControlReviewStatus",
]
