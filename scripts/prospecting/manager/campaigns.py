"""Local campaign creation and resume over the existing prospecting store.

The public request key is a UUID. Durable campaign rows keep P8's established
``camp_<16hex>`` identity, generated from UUID randomness.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import hashlib
import json
import re
import sqlite3
import uuid
from collections.abc import Callable, Mapping

from scripts.prospecting.manager.compile_ask import (
    CompileError,
    PREDICATES,
    _split_fit_lines,
    compile_ask,
)
from scripts.prospecting.affinity.fitspec import COPY_PROFILE_DEFAULT
from scripts.prospecting.p2_store import compile_target_policy
from scripts.prospecting.pii_guard import assert_vm_safe


COMPILER_VERSION = "manager-compile-v1"
MAX_BRIEF_BYTES = 64 * 1024
_CAMPAIGN_ID = re.compile(r"camp_[0-9a-f]{16}\Z")
_OPAQUE_MAILBOX_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
_SAFE_LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
_TARGET_KEYS = (
    "predicates",
    "requested_companies",
    "requested_people",
    "extra_fields",
    "lane_plan",
    "scorer_version",
)
_BUSINESS_POLICY_KEYS = (
    "intent",
    "ask_type",
    "ask_minutes",
    "tone",
    "template_family",
    "send_window",
    "timezone",
    "daily_cap",
    "hourly_cap",
    "firm_collision_cap",
    "approval_tier",
    "mailbox_id",
    "evidence_rules",
    "credit_budget",
)
_DRAFTING_KEYS = ("step", "minimum_confidence", "model_version")
_P2_EXTENSION_KEYS = frozenset({"enabled", "lanes", "domain_allowlist"})
_P8_EXTENSION_KEYS = frozenset({"fit_spec_hash", "copy_profile"})
_POLICY_KEYS = frozenset(
    (*_TARGET_KEYS, *_BUSINESS_POLICY_KEYS, *_DRAFTING_KEYS)
) | _P2_EXTENSION_KEYS | _P8_EXTENSION_KEYS


class CampaignError(ValueError):
    """A fixed-code refusal from the local campaign service."""


@dataclass(frozen=True)
class DraftingSettings:
    """Explicit P3 configuration; no model identity is manufactured by the service."""

    step: int
    minimum_confidence: float
    model_version: str


@dataclass(frozen=True)
class CampaignSession:
    request_id: str
    campaign_id: str
    policy_hash: str
    sender_profile_id: str
    mailbox_id: str
    status: str
    target_policy: dict[str, object]
    brief_text: str
    fit_text: str
    drafting_configured: bool
    created: bool
    _policy_state_hash: str

    def vm_projection(self) -> dict[str, object]:
        """Return the typed policy projection; literal local text is excluded."""
        try:
            policy = json.loads(
                json.dumps(
                    self.target_policy,
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                )
            )
            _validate_saved_policy(policy)
            normalized = compile_target_policy(policy, lambda value: value)
        except (CampaignError, TypeError, ValueError):
            raise CampaignError("campaign_state_invalid") from None
        if (
            _policy_state_hash(policy) != self._policy_state_hash
            or normalized.policy_hash != self.policy_hash
            or policy["mailbox_id"] != self.mailbox_id
            or (("model_version" in policy) != self.drafting_configured)
        ):
            raise CampaignError("campaign_state_invalid")
        value = {
            "campaign_id": self.campaign_id,
            "policy_id": "policy-" + self.policy_hash[:16],
            "policy_hash": self.policy_hash,
            "sender_profile_id": self.sender_profile_id,
            "mailbox_id": self.mailbox_id,
            "drafting_configured": self.drafting_configured,
            "target_policy": policy,
        }
        assert_vm_safe({"kind": "vm_policy", "fields": value}, "vm_policy")
        return value


@dataclass(frozen=True)
class SelectedDraftFormatStatus:
    """Opaque state for the optional P22 rendering-format configuration."""

    campaign_id: str
    policy_hash: str
    policy_state_hash: str
    state: str
    changed: bool


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_campaign_id() -> str:
    # P8 owns the durable ID grammar; uuid4 supplies its random identity bytes.
    return "camp_" + uuid.uuid4().hex[:16]


def _canonical_uuid(value: object, code: str) -> str:
    if type(value) is not str:
        raise CampaignError(code)
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError):
        raise CampaignError(code) from None
    if str(parsed) != value:
        raise CampaignError(code)
    return value


def _sender_profile_id(value: object) -> str:
    return _canonical_uuid(value, "invalid_sender_profile_id")


def _mailbox_id(value: object) -> str:
    if type(value) is not str or _OPAQUE_MAILBOX_ID.fullmatch(value) is None:
        raise CampaignError("invalid_mailbox_id")
    return value


def _brief(value: object) -> str:
    if type(value) is not str or not value.strip():
        raise CampaignError("invalid_brief")
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError:
        raise CampaignError("invalid_brief") from None
    if size > MAX_BRIEF_BYTES:
        raise CampaignError("invalid_brief")
    return value


def _drafting_settings(value: object) -> DraftingSettings | None:
    if value is None:
        return None
    if not isinstance(value, DraftingSettings):
        raise CampaignError("invalid_drafting_settings")
    if type(value.step) is not int or value.step not in {0, 1, 2}:
        raise CampaignError("invalid_drafting_settings")
    if (
        isinstance(value.minimum_confidence, bool)
        or not isinstance(value.minimum_confidence, (int, float))
        or not 0 <= value.minimum_confidence <= 1
    ):
        raise CampaignError("invalid_drafting_settings")
    if (
        type(value.model_version) is not str
        or _SAFE_LABEL.fullmatch(value.model_version) is None
    ):
        raise CampaignError("invalid_drafting_settings")
    return DraftingSettings(
        value.step, float(value.minimum_confidence), value.model_version
    )


def _saved_drafting(policy: Mapping[str, object]) -> DraftingSettings | None:
    present = {key for key in _DRAFTING_KEYS if key in policy}
    if not present:
        return None
    if present != set(_DRAFTING_KEYS):
        raise CampaignError("campaign_state_invalid")
    try:
        return _drafting_settings(
            DraftingSettings(
                policy["step"],  # type: ignore[arg-type]
                policy["minimum_confidence"],  # type: ignore[arg-type]
                policy["model_version"],  # type: ignore[arg-type]
            )
        )
    except CampaignError:
        raise CampaignError("campaign_state_invalid") from None


def _validate_saved_policy(policy: object) -> dict[str, object]:
    if not isinstance(policy, dict):
        raise CampaignError("campaign_state_invalid")
    keys = set(policy)
    required = set((*_TARGET_KEYS, *_BUSINESS_POLICY_KEYS))
    if not required <= keys or not keys <= _POLICY_KEYS:
        raise CampaignError("campaign_state_invalid")
    _saved_drafting(policy)
    p8 = keys & _P8_EXTENSION_KEYS
    if "fit_spec_hash" in p8 and p8 != _P8_EXTENSION_KEYS:
        raise CampaignError("campaign_state_invalid")
    if "copy_profile" in p8 and not _is_copy_profile_default(policy["copy_profile"]):
        raise CampaignError("campaign_state_invalid")
    if "fit_spec_hash" in p8 and (
        type(policy["fit_spec_hash"]) is not str
        or re.fullmatch(r"[0-9a-f]{64}", policy["fit_spec_hash"]) is None
    ):
        raise CampaignError("campaign_state_invalid")
    return policy


def _is_copy_profile_default(value: object) -> bool:
    """Require the exact JSON form of the reviewed P22/P8 profile.

    Python equality would accept values such as ``75.0`` or ``True`` for integer
    bands.  Compare canonical JSON instead so persisted configuration remains a
    strict, versioned format contract.
    """
    if type(value) is not dict:
        return False
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ) == json.dumps(
            COPY_PROFILE_DEFAULT, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        )
    except (TypeError, ValueError):
        return False


def _policy_state_hash(policy: Mapping[str, object]) -> str:
    return hashlib.sha256(
        json.dumps(
            policy, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
    ).hexdigest()


def _request_hash(
    brief_text: str,
    fit_text: str,
    sender_profile_id: str,
    mailbox_id: str,
    drafting: DraftingSettings | None,
) -> str:
    value = {
        "brief_text": brief_text,
        "compiler_version": COMPILER_VERSION,
        "fit_text": fit_text,
        "mailbox_id": mailbox_id,
        "sender_profile_id": sender_profile_id,
        "drafting": (
            None
            if drafting is None
            else {
                "step": drafting.step,
                "minimum_confidence": drafting.minimum_confidence,
                "model_version": drafting.model_version,
            }
        ),
    }
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _resolve_company(connection: sqlite3.Connection, name: str) -> tuple[str, ...]:
    return tuple(
        str(row[0])
        for row in connection.execute(
            "SELECT company_id FROM company WHERE name=? COLLATE NOCASE", (name,)
        )
    )


def _resolve_company_id(connection: sqlite3.Connection, value: str) -> str | None:
    row = connection.execute(
        "SELECT company_id FROM company WHERE company_id=?", (value,)
    ).fetchone()
    return str(row[0]) if row is not None else None


def _compile(
    connection: sqlite3.Connection,
    brief_text: str,
    campaign_id: str,
    sender_profile_id: str,
    mailbox_id: str,
    drafting: DraftingSettings | None,
) -> tuple[dict[str, object], dict[str, object], str]:
    capabilities = {
        "manual": {field: ("exact", "v1") for field in PREDICATES.values()}
    }
    compile_campaign_id = str(
        uuid.uuid5(uuid.NAMESPACE_URL, "kb:campaign:" + campaign_id)
    )
    compile_sender_id = str(
        uuid.uuid5(uuid.NAMESPACE_URL, "kb:sender:" + sender_profile_id)
    )
    try:
        compiled = compile_ask(
            brief_text,
            lambda name: _resolve_company(connection, name),
            compile_campaign_id,
            compile_sender_id,
            mailbox_id,
            capabilities,
            set(),
        )
        target_policy = dict(compiled.target_policy)
        normalized = compile_target_policy(
            target_policy, lambda value: _resolve_company_id(connection, value)
        )
    except CompileError as error:
        raise CampaignError(str(error)) from None
    except ValueError:
        raise CampaignError("invalid_policy") from None
    policy = dict(compiled.campaign_policy)
    policy.update(
        campaign_id=campaign_id,
        sender_profile_id=sender_profile_id,
        policy_hash=normalized.policy_hash,
    )
    saved_policy = {
        **target_policy,
        **{key: policy[key] for key in _BUSINESS_POLICY_KEYS},
    }
    if drafting is not None:
        saved_policy.update(
            step=drafting.step,
            minimum_confidence=drafting.minimum_confidence,
            model_version=drafting.model_version,
        )
    return saved_policy, policy, compiled.fit_text


def _require_first_draft_policy(policy: Mapping[str, object]) -> None:
    if policy.get("ask_type") != "informational_call":
        raise CampaignError("ask_type_unsupported")
    minutes = policy.get("ask_minutes")
    if type(minutes) is not int or not 10 <= minutes <= 20:
        raise CampaignError("ask_minutes_unsupported")


def _campaign_row(connection: sqlite3.Connection, campaign_id: str) -> sqlite3.Row:
    row = connection.execute(
        """SELECT b.request_id,b.campaign_id,b.request_hash,b.brief_text,b.fit_text,
                  b.policy_hash AS brief_policy_hash,b.sender_profile_id AS brief_sender,
                  b.mailbox_id AS brief_mailbox,b.compiler_version,
                  c.policy_hash,c.sender_profile_id,c.mailbox_id,c.policy_json,c.status,
                  c.intent,c.ask_type,c.ask_minutes,c.tone,c.template_family,
                  c.send_window,c.timezone,c.daily_cap,c.hourly_cap,
                  c.firm_collision_cap,c.approval_tier,c.evidence_rules,c.credit_budget,
                  EXISTS(SELECT 1 FROM sender_profile AS sp
                         WHERE sp.sender_profile_id=c.sender_profile_id) AS profile_exists
             FROM campaign_brief AS b
             JOIN campaign AS c ON c.campaign_id=b.campaign_id
            WHERE b.campaign_id=?""",
        (campaign_id,),
    ).fetchone()
    if row is None:
        raise CampaignError("campaign_missing")
    return row


def _session(connection: sqlite3.Connection, campaign_id: str) -> CampaignSession:
    row = _campaign_row(connection, campaign_id)
    try:
        target_policy = _validate_saved_policy(json.loads(str(row["policy_json"])))
        drafting = _saved_drafting(target_policy)
        normalized = compile_target_policy(
            target_policy, lambda value: _resolve_company_id(connection, value)
        )
        expected_policy, expected_campaign, expected_fit = _compile(
            connection,
            str(row["brief_text"]),
            campaign_id,
            str(row["sender_profile_id"]),
            str(row["mailbox_id"]),
            drafting,
        )
        column_values = {
            "intent": row["intent"],
            "ask_type": row["ask_type"],
            "ask_minutes": row["ask_minutes"],
            "tone": row["tone"],
            "template_family": row["template_family"],
            "send_window": row["send_window"],
            "timezone": row["timezone"],
            "daily_cap": row["daily_cap"],
            "hourly_cap": row["hourly_cap"],
            "firm_collision_cap": row["firm_collision_cap"],
            "approval_tier": row["approval_tier"],
            "mailbox_id": row["mailbox_id"],
            "evidence_rules": json.loads(str(row["evidence_rules"])),
            "credit_budget": row["credit_budget"],
        }
    except (CampaignError, json.JSONDecodeError, TypeError, ValueError):
        raise CampaignError("campaign_state_invalid") from None
    expected_request_hash = _request_hash(
        str(row["brief_text"]),
        str(row["fit_text"]),
        str(row["brief_sender"]),
        str(row["brief_mailbox"]),
        drafting,
    )
    expected_base = {
        key: expected_policy[key]
        for key in (*_TARGET_KEYS, *_BUSINESS_POLICY_KEYS, *_DRAFTING_KEYS)
        if key in expected_policy
    }
    stored_base = {
        key: target_policy[key]
        for key in (*_TARGET_KEYS, *_BUSINESS_POLICY_KEYS, *_DRAFTING_KEYS)
        if key in target_policy
    }
    if (
        row["compiler_version"] != COMPILER_VERSION
        or row["request_hash"] != expected_request_hash
        or row["profile_exists"] != 1
        or row["brief_policy_hash"] != row["policy_hash"]
        or row["policy_hash"] != normalized.policy_hash
        or row["brief_sender"] != row["sender_profile_id"]
        or row["brief_mailbox"] != row["mailbox_id"]
        or row["fit_text"] != expected_fit
        or expected_base != stored_base
        or any(
            target_policy.get(key) != value for key, value in column_values.items()
        )
        or any(expected_campaign[key] != value for key, value in column_values.items())
    ):
        raise CampaignError("campaign_state_invalid")
    return CampaignSession(
        request_id=str(row["request_id"]),
        campaign_id=str(row["campaign_id"]),
        policy_hash=str(row["policy_hash"]),
        sender_profile_id=str(row["sender_profile_id"]),
        mailbox_id=str(row["mailbox_id"]),
        status=str(row["status"]),
        target_policy=target_policy,
        brief_text=str(row["brief_text"]),
        fit_text=str(row["fit_text"]),
        drafting_configured=drafting is not None,
        created=False,
        _policy_state_hash=_policy_state_hash(target_policy),
    )


class CampaignService:
    """Create and resume desktop-local campaigns without launching workflow work."""

    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        campaign_id_factory: Callable[[], str] = _new_campaign_id,
        now: Callable[[], str] = _utc_now,
    ) -> None:
        self.connection = connection
        self.campaign_id_factory = campaign_id_factory
        self.now = now

    def create(
        self,
        *,
        request_id: str,
        brief_text: str,
        sender_profile_id: str,
        mailbox_id: str,
        drafting: DraftingSettings | None = None,
        require_first_draft_compatible: bool = False,
    ) -> CampaignSession:
        if type(require_first_draft_compatible) is not bool:
            raise CampaignError("invalid_first_draft_compatibility")
        request_id = _canonical_uuid(request_id, "invalid_request_id")
        brief_text = _brief(brief_text)
        sender_profile_id = _sender_profile_id(sender_profile_id)
        mailbox_id = _mailbox_id(mailbox_id)
        drafting = _drafting_settings(drafting)
        _token_text, fit_text = _split_fit_lines(brief_text)
        request_hash = _request_hash(
            brief_text, fit_text, sender_profile_id, mailbox_id, drafting
        )
        if self.connection.in_transaction:
            raise CampaignError("transaction_active")

        self.connection.execute("BEGIN IMMEDIATE")
        try:
            retry = self.connection.execute(
                "SELECT campaign_id,request_hash FROM campaign_brief WHERE request_id=?",
                (request_id,),
            ).fetchone()
            if retry is not None:
                if retry["request_hash"] != request_hash:
                    raise CampaignError("request_conflict")
                session = _session(self.connection, str(retry["campaign_id"]))
                if require_first_draft_compatible:
                    _require_first_draft_policy(session.target_policy)
                self.connection.commit()
                return session

            profile = self.connection.execute(
                "SELECT 1 FROM sender_profile WHERE sender_profile_id=?",
                (sender_profile_id,),
            ).fetchone()
            if profile is None:
                raise CampaignError("sender_profile_missing")

            campaign_id = self.campaign_id_factory()
            if type(campaign_id) is not str or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
                raise CampaignError("invalid_campaign_id")
            if self.connection.execute(
                "SELECT 1 FROM campaign WHERE campaign_id=?", (campaign_id,)
            ).fetchone():
                raise CampaignError("campaign_id_collision")

            target_policy, policy, compiled_fit_text = _compile(
                self.connection,
                brief_text,
                campaign_id,
                sender_profile_id,
                mailbox_id,
                drafting,
            )
            if compiled_fit_text != fit_text:
                raise CampaignError("invalid_brief")
            if require_first_draft_compatible:
                _require_first_draft_policy(target_policy)
            policy_hash = str(policy["policy_hash"])
            self.connection.execute(
                """INSERT INTO campaign(
                       campaign_id,intent,sender_profile_id,policy_json,ask_type,
                       ask_minutes,tone,template_family,cadence,send_window,timezone,
                       daily_cap,hourly_cap,firm_collision_cap,approval_tier,mailbox_id,
                       evidence_rules,credit_budget,status,policy_hash
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    campaign_id,
                    policy["intent"],
                    sender_profile_id,
                    json.dumps(target_policy, sort_keys=True, separators=(",", ":")),
                    policy["ask_type"],
                    policy["ask_minutes"],
                    policy["tone"],
                    policy["template_family"],
                    json.dumps(policy["cadence"], separators=(",", ":")),
                    policy["send_window"],
                    policy["timezone"],
                    policy["daily_cap"],
                    policy["hourly_cap"],
                    policy["firm_collision_cap"],
                    policy["approval_tier"],
                    mailbox_id,
                    json.dumps(policy["evidence_rules"], separators=(",", ":")),
                    policy["credit_budget"],
                    policy["status"],
                    policy_hash,
                ),
            )
            self.connection.execute(
                """INSERT INTO campaign_brief(
                       request_id,campaign_id,request_hash,brief_text,fit_text,policy_hash,
                       sender_profile_id,mailbox_id,compiler_version,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    request_id,
                    campaign_id,
                    request_hash,
                    brief_text,
                    fit_text,
                    policy_hash,
                    sender_profile_id,
                    mailbox_id,
                    COMPILER_VERSION,
                    self.now(),
                ),
            )
            session = replace(_session(self.connection, campaign_id), created=True)
            self.connection.commit()
            return session
        except CampaignError:
            self.connection.rollback()
            raise
        except sqlite3.IntegrityError:
            self.connection.rollback()
            raise CampaignError("campaign_create_failed") from None
        except Exception:
            self.connection.rollback()
            raise

    def resume(self, campaign_id: str) -> CampaignSession:
        if type(campaign_id) is not str or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
            raise CampaignError("invalid_campaign_id")
        return _session(self.connection, campaign_id)

    def selected_draft_format_status(self, campaign_id: str) -> SelectedDraftFormatStatus:
        """Return only opaque state for the optional selected-draft copy profile."""
        policy, policy_hash, _status = self._selected_draft_format_context(campaign_id)
        return SelectedDraftFormatStatus(
            campaign_id, policy_hash, _policy_state_hash(policy),
            "configured" if "copy_profile" in policy else "missing", False,
        )

    def configure_selected_draft_format(
        self, campaign_id: str, expected_policy_state_hash: str,
    ) -> SelectedDraftFormatStatus:
        """Install the canonical P22 format once, without changing target policy.

        This is deliberately separate from P8 fit approval.  It is safe only before
        any render, review, selected-source attestation, approval, or a direct
        campaign-scoped vendor execution request exists for the campaign; once
        present the canonical profile is a monotonic no-op on retries.
        Acquisition finder pages and snapshots do not bind copy semantics and
        correctly do not lock this format.
        """
        if type(campaign_id) is not str or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
            raise CampaignError("invalid_campaign_id")
        if type(expected_policy_state_hash) is not str or re.fullmatch(
            r"[0-9a-f]{64}", expected_policy_state_hash,
        ) is None:
            raise CampaignError("invalid_policy_state_hash")
        try:
            if self.connection.in_transaction:
                raise CampaignError("transaction_active")
        except CampaignError:
            raise
        except (AttributeError, TypeError, sqlite3.Error):
            raise CampaignError("campaign_state_invalid") from None
        try:
            self.connection.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            raise CampaignError("store_busy") from None
        except (AttributeError, TypeError, sqlite3.Error):
            raise CampaignError("campaign_state_invalid") from None
        try:
            policy, policy_hash, status = self._selected_draft_format_context(campaign_id)
            state_hash = _policy_state_hash(policy)
            if "copy_profile" in policy:
                self.connection.commit()
                return SelectedDraftFormatStatus(
                    campaign_id, policy_hash, state_hash, "configured", False,
                )
            if expected_policy_state_hash != state_hash:
                raise CampaignError("policy_state_stale")
            if status != "draft":
                raise CampaignError("selected_draft_format_locked")
            _require_first_draft_policy(policy)
            self._assert_selected_draft_format_unused(campaign_id)
            updated = dict(policy)
            updated["copy_profile"] = dict(COPY_PROFILE_DEFAULT)
            _validate_saved_policy(updated)
            normalized = compile_target_policy(
                updated, lambda value: _resolve_company_id(self.connection, value),
            )
            if normalized.policy_hash != policy_hash:
                raise CampaignError("policy_hash_changed")
            self.connection.execute(
                "UPDATE campaign SET policy_json=? WHERE campaign_id=?",
                (json.dumps(updated, sort_keys=True, separators=(",", ":")), campaign_id),
            )
            try:
                self.connection.commit()
            except (AttributeError, TypeError, sqlite3.Error):
                if not self._rollback_selected_draft_format():
                    raise CampaignError("campaign_state_invalid") from None
                raise CampaignError("campaign_state_invalid") from None
            return SelectedDraftFormatStatus(
                campaign_id, policy_hash, _policy_state_hash(updated), "configured", True,
            )
        except CampaignError:
            if not self._rollback_selected_draft_format():
                raise CampaignError("campaign_state_invalid") from None
            raise
        except (sqlite3.Error, TypeError, ValueError, json.JSONDecodeError):
            self._rollback_selected_draft_format()
            raise CampaignError("campaign_state_invalid") from None

    def _selected_draft_format_context(
        self, campaign_id: str,
    ) -> tuple[dict[str, object], str, str]:
        if type(campaign_id) is not str or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
            raise CampaignError("invalid_campaign_id")
        session = _session(self.connection, campaign_id)
        return dict(session.target_policy), session.policy_hash, session.status

    def _rollback_selected_draft_format(self) -> bool:
        try:
            self.connection.rollback()
            return True
        except (AttributeError, TypeError, sqlite3.Error):
            return False

    def _assert_selected_draft_format_unused(self, campaign_id: str) -> None:
        """Reject configuration after work whose copy semantics must remain fixed."""
        checks = (
            ("revision", "SELECT 1 FROM revision WHERE campaign_id=? LIMIT 1"),
            ("review_candidate", "SELECT 1 FROM review_candidate WHERE campaign_id=? LIMIT 1"),
            ("selected_draft_binding", "SELECT 1 FROM selected_draft_binding WHERE campaign_id=? LIMIT 1"),
            ("selected_source_attestation", "SELECT 1 FROM selected_source_attestation WHERE campaign_id=? LIMIT 1"),
            ("approval", "SELECT 1 FROM approval WHERE campaign_id=? LIMIT 1"),
            ("exec_request", "SELECT 1 FROM exec_request WHERE CASE WHEN json_valid(payload) THEN json_extract(payload, '$.campaign_id') END=? LIMIT 1"),
        )
        tables = {
            str(row[0]) for row in self.connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'",
            )
        }
        if any(table not in tables for table, _query in checks):
            raise CampaignError("campaign_state_invalid")
        for _table, query in checks:
            if self.connection.execute(query, (campaign_id,)).fetchone() is not None:
                raise CampaignError("selected_draft_format_locked")


__all__ = [
    "COMPILER_VERSION",
    "CampaignError",
    "CampaignService",
    "CampaignSession",
    "DraftingSettings",
    "SelectedDraftFormatStatus",
    "MAX_BRIEF_BYTES",
]
