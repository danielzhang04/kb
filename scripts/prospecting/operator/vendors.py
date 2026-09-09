"""Executor-owned vendor adapters for the desktop operator surface.

The adapters deliberately retain no credential state.  A live transport obtains its
credential from the desktop environment only while servicing a reserved request.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import hashlib
import socket
import ssl
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from urllib.parse import urlencode

from scripts.prospecting.providers.base import (
    VendorResult, _ReservationRefused, _execute_vendor_request, queue_vendor_lookup,
)
from scripts.prospecting.store import (
    ContactPoint, CreditReservation, ExecRequest, ProviderAttempt, SourceObservation,
    insert_contact_point, insert_provider_attempt, insert_source_observation, settle_credit, validate_exec_request,
)
from scripts.prospecting.discovery.snov_domain import (
    DEFAULT_TITLE_FUNCTION_EXCLUSIONS, SnovDomainAdapter, SnovPageError, _snov_account_used, register_snov_domain_lane,
    snov_account_credit_ceiling,
)
from scripts.prospecting.providers.snov import SnovEmailFinder
from scripts.prospecting.fetcher import FetchPolicy, _http, fetch_snapshot


class VendorKeyMissing(RuntimeError):
    """A deliberately non-sensitive failure code for an unconfigured provider."""

    def __init__(self) -> None:
        super().__init__("vendor_key_missing")


class VendorHttpError(RuntimeError):
    """A transport failure that deliberately carries no request details."""

    def __init__(self, provider: str, status: int | None) -> None:
        self.provider = provider
        self.status = status
        super().__init__(f"vendor_http_error:{provider}:{status if status is not None else 'unavailable'}")


class ClaimToken:
    """Opaque, one-shot proof minted only for a verified claimed request."""

    __slots__ = ()

_OPERATIONS = {"hunter": "find", "snov": "find", "pdl": "person_search", "apify": "profile_batch"}
_ENVIRON = {
    "hunter": "HUNTER_API_KEY",
    "snov": "SNOV_CLIENT_ID",
    "pdl": "PDL_API_KEY",
    "apify": "APIFY_TOKEN",
}


def selected_provider_names(providers: Sequence[str]) -> tuple[str, ...]:
    """Validate and normalize a credential-free operator provider selection."""
    requested = tuple(providers)
    if not requested or len(set(requested)) != len(requested) or not set(requested) <= _OPERATIONS.keys():
        raise ValueError("invalid_vendor_selection")
    return requested


def _live_call(provider: str, operation: str, payload: Mapping[str, object], request_id: str, timeout: int, *, connection: sqlite3.Connection | None = None, reservation: CreditReservation | None = None) -> Mapping[str, object]:
    """Private, reservation-bound bridge to the one-shot authenticated call."""
    if connection is None or reservation is None:
        raise ValueError("unclaimed_transport")
    row = connection.execute(
        """SELECT er.state,er.operation,json_extract(er.payload,'$.provider') AS provider,
                  cr.reservation_id,cr.state AS reservation_state
           FROM exec_request AS er JOIN credit_reservation AS cr ON cr.exec_request_id=er.request_id
           WHERE er.request_id=?""", (request_id,),
    ).fetchone()
    if (row is None or row["state"] != "claimed" or row["operation"] != "vendor_lookup"
            or row["provider"] != provider or row["reservation_id"] != reservation.reservation_id
            or row["reservation_state"] != "reserved"):
        raise ValueError("unclaimed_transport")
    token = ClaimToken()

    def _call(claim: ClaimToken) -> Mapping[str, object] | VendorHttpError:
        """Build, consume, and discard the authenticated request in this frame."""
        if claim is not token or _OPERATIONS.get(provider) != operation:
            raise ValueError("unclaimed_transport")
        request: urllib.request.Request | None = None
        body: bytes | None = None
        key: str | None = None
        secret: str | None = None
        response: object | None = None
        raw_bytes: bytes | None = None
        try:
            if provider == "hunter":
                key = os.environ.get(_ENVIRON[provider])
                if not key:
                    raise VendorKeyMissing()
                request = urllib.request.Request(
                    "https://api.hunter.io/v2/email-finder?" + urlencode(
                        {**{name: str(value) for name, value in payload.items()}, "api_key": key}
                    )
                )
            elif provider == "snov":
                key = os.environ.get(_ENVIRON[provider])
                secret = os.environ.get("SNOV_CLIENT_SECRET")
                if not key or not secret:
                    raise VendorKeyMissing()
                body = json.dumps(
                    {**payload, "client_id": key, "client_secret": secret}, separators=(",", ":"),
                ).encode("utf-8")
                secret = None
                request = urllib.request.Request(
                    "https://api.snov.io/v1/get-emails-from-names", data=body,
                    headers={"Content-Type": "application/json"}, method="POST",
                )
            elif provider == "pdl":
                key = os.environ.get(_ENVIRON[provider])
                if not key:
                    raise VendorKeyMissing()
                body = json.dumps(dict(payload), separators=(",", ":")).encode("utf-8")
                request = urllib.request.Request(
                    "https://api.peopledatalabs.com/v5/person/search", data=body,
                    headers={"Content-Type": "application/json", "X-Api-Key": key}, method="POST",
                )
            elif provider == "apify":
                key = os.environ.get(_ENVIRON[provider])
                if not key:
                    raise VendorKeyMissing()
                body = json.dumps({"urls": payload.get("profileUrls", [])}, separators=(",", ":")).encode("utf-8")
                request = urllib.request.Request(
                    "https://api.apify.com/v2/acts/atomus~linkedin-profile-scraper/run-sync-get-dataset-items?"
                    + urlencode({"token": key}), data=body,
                    headers={"Content-Type": "application/json"}, method="POST",
                )
            else:
                raise ValueError("unsupported_vendor")
            key = None
            with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310 - claim-scoped desktop transport
                raw_bytes = response.read()
        except (urllib.error.HTTPError, urllib.error.URLError) as error:
            return VendorHttpError(provider, getattr(error, "code", None))
        finally:
            # Never leave an authenticated Request, payload, or key reachable after this call.
            del request
            del body
            del key
            del secret
            del response
        raw = json.loads((raw_bytes or b"{}").decode("utf-8"))
        if provider == "hunter":
            raw = raw if isinstance(raw, Mapping) else {}
            data = raw.get("data") if isinstance(raw.get("data"), Mapping) else {}
            return {"state": str(data.get("status", "invalid")), "credits": 1, "email_ref": data.get("email")}
        if provider == "snov":
            raw = raw if isinstance(raw, Mapping) else {}
            data = raw.get("data")
            emails = data if isinstance(data, list) else (data.get("emails", []) if isinstance(data, Mapping) else [])
            first = emails[0] if emails and isinstance(emails[0], Mapping) else {}
            return {"state": str(first.get("status", "invalid")), "credits": 1, "email_ref": first.get("email")}
        if provider == "pdl":
            raw = raw if isinstance(raw, Mapping) else {}
            records = raw.get("data") if isinstance(raw.get("data"), list) else []
            return {"result": "valid" if records else "not_found", "credits": 1 if records else 0, "records": records}
        records = raw if isinstance(raw, list) else []
        profile = records[0] if records and isinstance(records[0], Mapping) else {}
        return {
            "status": "success" if profile else "not_found", "url": str(payload.get("profileUrls", [""])[0]),
            "profile": profile, "_metadata": {},
        }

    result = _call(token)
    del token
    del _call
    if isinstance(result, VendorHttpError):
        raise result
    return result


@dataclass
class DesktopVendorAdapter:
    """A P2-reserved adapter with no public transport entry point."""

    provider: str
    connection: sqlite3.Connection
    max_retries: int = 0
    _results: dict[str, VendorResult] = field(default_factory=dict, init=False, repr=False)

    def max_cost(self, operation: str) -> int:
        if operation != _OPERATIONS[self.provider]:
            raise ValueError("unsupported_vendor_operation")
        return 1

    def queue(self, connection, *, campaign_id: str, person_id: str, policy_hash: str, request_id: str, now: str) -> str:
        if self.provider == "snov" and _snov_account_used(connection) + self.max_cost(_OPERATIONS[self.provider]) > snov_account_credit_ceiling(connection):
            request = ExecRequest(
                request_id, "prospecting-list-builder", "vendor_lookup",
                {"campaign_id": campaign_id, "person_id": person_id, "provider": self.provider}, policy_hash, None, now,
            )
            connection.execute("BEGIN IMMEDIATE")
            try:
                campaign = connection.execute(
                    "SELECT policy_hash,approval_tier FROM campaign WHERE campaign_id=?", (campaign_id,)
                ).fetchone()
                if campaign is None or campaign["policy_hash"] != policy_hash:
                    raise ValueError("vendor_request_campaign_mismatch")
                validate_exec_request(request, campaign["approval_tier"], connection)
                connection.execute(
                    """INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,created_at,state,reason)
                       VALUES(?,?,?,?,?,?,?,?,?)""",
                    (request.request_id, request.caller, request.operation,
                     json.dumps(request.payload, sort_keys=True, separators=(",", ":")), request.policy_hash,
                     None, now, "rejected", "skipped_budget"),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            return request_id
        return queue_vendor_lookup(
            connection, campaign_id=campaign_id, person_id=person_id, provider=self.provider,
            vendor_operation=_OPERATIONS[self.provider], payload={}, policy_hash=policy_hash,
            request_id=request_id, adapter=self, now=now,
        )

    def _execute(self, reservation: CreditReservation, operation: str, payload: Mapping[str, object], idempotency_key: str, *, claim_token: ClaimToken | None = None) -> VendorResult:
        if reservation.provider != self.provider or operation != _OPERATIONS[self.provider]:
            raise ValueError("vendor_unreserved_call")
        if claim_token is not None:
            raise ValueError("unclaimed_transport")
        if os.environ.get("KB_PROSPECTING_NO_NETWORK") == "1" and self.provider == "snov":
            result = SnovEmailFinder()._execute(reservation, operation, payload, idempotency_key)
            self._results[idempotency_key] = result
            return result
        raw = _live_call(
            self.provider, operation, payload, idempotency_key, 20,
            connection=self.connection, reservation=reservation,
        )
        if self.provider in {"hunter", "snov"}:
            result = VendorResult(str(raw.get("state", "invalid")), int(raw.get("credits", 0)), (raw,))
        elif self.provider == "pdl":
            records = raw.get("records", ())
            result = VendorResult(str(raw.get("result", "error")), int(raw.get("credits", 0)), tuple(records) if isinstance(records, (list, tuple)) else ())
        else:
            result = VendorResult("valid" if raw.get("status") == "success" else "not_found", 1 if raw.get("status") == "success" else 0, (raw,))
        self._results[idempotency_key] = result
        return result


def finder_defaults(adapter: DesktopVendorAdapter) -> tuple[str, int]:
    """Return the selected adapter's default lookup operation and declared cost."""
    operation = _OPERATIONS[adapter.provider]
    return operation, adapter.max_cost(operation)


def _register_selected_vendor_adapters(executor, adapters: Mapping[str, DesktopVendorAdapter], now: str) -> None:
    """Register one executor-owned adapter map, without widening selected providers."""
    def _adapter(request) -> tuple[str, str]:
        executor.connection.commit()
        try:
            if request.payload.get("provider") == "snov":
                return _execute_snov_email_request(executor.connection, request, now, adapters["snov"])
            _execute_vendor_request(executor, request, adapters, now)
        except _ReservationRefused:
            reason = executor.connection.execute(
                "SELECT reason FROM exec_request WHERE request_id=?", (request.request_id,)
            ).fetchone()
            return "rejected", "skipped_budget" if reason is not None and reason[0] == "skipped_budget" else "reservation_missing_or_invalid"
        except VendorHttpError:
            return "rejected", "vendor_http_error"
        except ValueError as error:
            # Validation errors here are intentionally opaque codes; retaining the
            # code makes a rejected executor request diagnosable without exposing
            # any person or company data from the request payload.
            return "rejected", str(error)
        return "succeeded", "vendor_completed"

    executor.register_adapter("vendor_lookup", _adapter)


def _snov_email_state(raw: object) -> str:
    value = str(raw or "").strip().casefold().replace(" ", "_")
    return {
        "valid": "valid", "verified": "valid", "invalid": "invalid",
        "catch_all": "catch_all", "not_verified": "risky", "unverified": "risky",
    }.get(value, "risky")


def _snov_email_records(raw: Mapping[str, object]) -> tuple[Mapping[str, object], ...]:
    data = raw.get("data")
    values = data.get("emails", ()) if isinstance(data, Mapping) else data
    return tuple(item for item in values if isinstance(item, Mapping)) if isinstance(values, Sequence) and not isinstance(values, str) else ()


def _snov_result_complete(raw: Mapping[str, object]) -> bool:
    return str(raw.get("status") or "").casefold() in {"complete", "completed"}


def _snov_complete(raw: Mapping[str, object]) -> bool:
    return _snov_result_complete(raw)


def _snov_email_transport(
    start_url: str | None, result_url: str | None, task_hash: str | None,
    on_task_accepted: Callable[[str, str], None] | None = None,
) -> tuple[str, str, Mapping[str, object] | None]:
    """Start or poll one v2 per-prospect task inside the credential-owning frame."""
    client_id: str | None = None
    client_secret: str | None = None
    token: str | None = None
    try:
        client_id = os.environ.get("SNOV_CLIENT_ID")
        client_secret = os.environ.get("SNOV_CLIENT_SECRET")
        if not client_id or not client_secret:
            raise VendorKeyMissing()

        def request_json(url: str, *, method: str, body: bytes | None = None, bearer: str | None = None) -> Mapping[str, object]:
            headers = {"Content-Type": "application/x-www-form-urlencoded"} if body is not None else {}
            if bearer:
                headers["Authorization"] = f"Bearer {bearer}"
            request = urllib.request.Request(url, data=body, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=20) as response:  # nosec B310 - claim-scoped desktop transport
                    decoded = json.loads(response.read().decode("utf-8"))
            except (urllib.error.HTTPError, urllib.error.URLError) as error:
                raise VendorHttpError("snov", getattr(error, "code", None)) from None
            return decoded if isinstance(decoded, Mapping) else {}

        oauth = request_json(
            "https://api.snov.io/v1/oauth/access_token", method="POST",
            body=urlencode({"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}).encode("utf-8"),
        )
        client_id = None
        client_secret = None
        token = str(oauth.get("access_token") or "")
        if not token:
            raise VendorHttpError("snov", None)
        if result_url is None:
            if start_url is None or not start_url.startswith("https://api.snov.io/v2/"):
                raise VendorHttpError("snov", None)
            started = request_json(start_url, method="POST", bearer=token)
            meta = started.get("meta") if isinstance(started.get("meta"), Mapping) else {}
            links = started.get("links") if isinstance(started.get("links"), Mapping) else {}
            task_hash = str(meta.get("task_hash") or "")
            result_url = str(links.get("result") or "")
            if not task_hash or not result_url.startswith("https://api.snov.io/v2/"):
                raise VendorHttpError("snov", None)
            if on_task_accepted is not None:
                on_task_accepted(task_hash, result_url)
        assert result_url is not None and task_hash is not None
        for poll in range(8):
            result = request_json(result_url, method="GET", bearer=token)
            if _snov_result_complete(result):
                return task_hash, result_url, result
            if poll < 7:
                time.sleep(3)
        return task_hash, result_url, None
    finally:
        del client_id
        del client_secret
        del token


def _execute_snov_email_request(connection: sqlite3.Connection, request, now: str, adapter: DesktopVendorAdapter) -> tuple[str, str]:
    """Resolve a Snov prospect link, retaining unfinished v2 tasks for the next run."""
    payload = request.payload
    person_id = str(payload.get("person_id") or "")
    reservation = connection.execute(
        """SELECT * FROM credit_reservation WHERE exec_request_id=? AND provider='snov' AND state='reserved'""",
        (request.request_id,),
    ).fetchone()
    if reservation is None:
        raise _ReservationRefused("reservation_missing_or_invalid")
    persisted = connection.execute(
        "SELECT task_hash,result_url FROM snov_email_search WHERE request_id=?", (request.request_id,)
    ).fetchone()
    prospect = connection.execute(
        "SELECT company_id,search_emails_start FROM snov_prospect WHERE person_id=?", (person_id,)
    ).fetchone()
    if persisted is None and prospect is None:
        _execute_vendor_request(type("ExecutorRef", (), {"connection": connection})(), request, {"snov": adapter}, now)
        return "succeeded", "vendor_completed"
    task_persisted = persisted is not None

    def persist_accepted_task(accepted_hash: str, accepted_url: str) -> None:
        nonlocal task_persisted
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                """INSERT INTO snov_email_search(request_id,person_id,task_hash,result_url,started_at)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(request_id) DO UPDATE SET task_hash=excluded.task_hash,result_url=excluded.result_url""",
                (request.request_id, person_id, accepted_hash, accepted_url, now),
            )
            connection.commit()
            task_persisted = True
        except Exception:
            connection.rollback()
            raise

    try:
        task_hash, result_url, result = _snov_email_transport(
            None if persisted else str(prospect["search_emails_start"]),
            str(persisted["result_url"]) if persisted else None,
            str(persisted["task_hash"]) if persisted else None,
            None if persisted else persist_accepted_task,
        )
    except VendorHttpError:
        if not task_persisted:
            raise
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute("UPDATE exec_request SET state='uncertain',reason='snov_email_search_poll_error' WHERE request_id=? AND state='claimed'", (request.request_id,))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        return "succeeded", "snov_email_search_poll_error"
    if result is None:
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                """INSERT INTO snov_email_search(request_id,person_id,task_hash,result_url,started_at)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(request_id) DO UPDATE SET task_hash=excluded.task_hash,result_url=excluded.result_url""",
                (request.request_id, person_id, task_hash, result_url, now),
            )
            connection.execute("UPDATE exec_request SET state='uncertain',reason='snov_email_search_in_progress' WHERE request_id=? AND state='claimed'", (request.request_id,))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        # The P1 executor accepts only terminal adapter returns.  The request row
        # has already been durably transitioned to uncertain, so its final update
        # is intentionally a no-op; attach_vendors requeues it on the next run.
        return "succeeded", "snov_email_search_in_progress"
    company_id = str(prospect["company_id"]) if prospect is not None else None
    records = _snov_email_records(result)
    connection.execute("BEGIN IMMEDIATE")
    try:
        for item in records:
            email = str(item.get("email") or "").strip()
            if not email or connection.execute("SELECT 1 FROM contact_point WHERE email=?", (email,)).fetchone():
                continue
            contact_id = "cp_" + hashlib.sha256(email.casefold().encode()).hexdigest()[:16]
            insert_contact_point(connection, ContactPoint(contact_id, person_id, company_id, email, "snov", "snov_email_v2", now, None, _snov_email_state(item.get("status", item.get("smtp_status"))), 1.0, 0))
            insert_source_observation(connection, SourceObservation(
                "obs_" + hashlib.sha256(f"{request.request_id}|{contact_id}".encode()).hexdigest()[:16],
                "contact", contact_id, "provider_attempt_id", json.dumps(request.request_id),
                f"{request.request_id}|snov_email", None, now, 1.0, None,
            ))
        insert_provider_attempt(connection, ProviderAttempt(
            request.request_id, person_id, "snov", "find", hashlib.sha256(request.request_id.encode()).hexdigest(),
            0, 1, "valid" if records else "not_found", now, now, None,
        ))
        connection.execute(
            """INSERT INTO provider_attempt_meta(attempt_id,api_version,task_hash,result_url)
               VALUES(?,?,?,?)""",
            (request.request_id, "v2", task_hash, result_url),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    settle_credit(connection, str(reservation["reservation_id"]), 1, now)
    return "succeeded", "vendor_completed"


def _snov_domain_transport(
    *, domain: str, page: int, positions: Sequence[Mapping[str, object]],
    task_hash: str | None = None, result_url: str | None = None,
) -> Mapping[str, object]:
    """Run Snov's v2 prospect start/poll flow.

    This is deliberately the sole frame that sees ambient Snov credentials.  It
    returns only the decoded, credential-free result to the persistence adapter.
    """
    client_id: str | None = None
    client_secret: str | None = None
    token: str | None = None
    try:
        client_id = os.environ.get("SNOV_CLIENT_ID")
        client_secret = os.environ.get("SNOV_CLIENT_SECRET")
        if not client_id or not client_secret:
            raise VendorKeyMissing()

        def request_json(url: str, *, method: str, body: bytes | None = None, bearer: str | None = None) -> Mapping[str, object]:
            headers = {"Content-Type": "application/x-www-form-urlencoded"} if body is not None else {}
            if bearer:
                headers["Authorization"] = f"Bearer {bearer}"
            request = urllib.request.Request(url, data=body, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=20) as response:  # nosec B310 - executor-only desktop call
                    raw = json.loads(response.read().decode("utf-8"))
            except (urllib.error.HTTPError, urllib.error.URLError) as error:
                raise VendorHttpError("snov", getattr(error, "code", None)) from None
            return raw if isinstance(raw, Mapping) else {}

        token_data = request_json(
            "https://api.snov.io/v1/oauth/access_token", method="POST",
            body=urlencode({"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}).encode("utf-8"),
        )
        client_id = None
        client_secret = None
        token = str(token_data.get("access_token") or "")
        if not token:
            raise VendorHttpError("snov", None)
        if result_url is None:
            title_values = [str(rule.get("class", rule.get("value", ""))) for rule in positions][:10]
            params = urlencode({"domain": domain, "page": page, "positions[]": title_values}, doseq=True)
            started = request_json(
                "https://api.snov.io/v2/domain-search/prospects/start?" + params,
                method="POST", bearer=token,
            )
            meta = started.get("meta") if isinstance(started.get("meta"), Mapping) else {}
            links = started.get("links") if isinstance(started.get("links"), Mapping) else {}
            task_hash = str(meta.get("task_hash") or "")
            result_url = str(links.get("result") or "")
            if not task_hash or not result_url.startswith("https://api.snov.io/v2/"):
                raise VendorHttpError("snov", None)
        assert task_hash is not None and result_url is not None
        for delay in (3, 5, 8):
            try:
                result = request_json(result_url, method="GET", bearer=token)
            except VendorHttpError:
                return {"status": "in_progress", "meta": {"task_hash": task_hash}, "links": {"result": result_url}, "api_version": "v2"}
            if _snov_complete(result):
                return {**result, "api_version": "v2"}
            time.sleep(delay)
        return {"status": "in_progress", "meta": {"task_hash": task_hash}, "links": {"result": result_url}, "api_version": "v2"}
    finally:
        del client_id
        del client_secret
        del token


def title_function_exclusions(connection: sqlite3.Connection) -> tuple[str, ...]:
    """Read the durable, credential-free Snov title-function policy."""
    database = next((str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"), "")
    if not database:
        return DEFAULT_TITLE_FUNCTION_EXCLUSIONS
    try:
        payload = json.loads((Path(database).parent / "operator-vendors.json").read_text(encoding="utf-8"))
        configured = payload.get("title_function_exclusions", DEFAULT_TITLE_FUNCTION_EXCLUSIONS)
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return DEFAULT_TITLE_FUNCTION_EXCLUSIONS
    if not isinstance(configured, list) or not all(isinstance(value, str) for value in configured):
        return DEFAULT_TITLE_FUNCTION_EXCLUSIONS
    return tuple(configured)


def _register_snov_domain_adapter(executor, now: str, per_firm: int | None, max_pages: int = 30) -> None:
    register_snov_domain_lane()
    adapter = SnovDomainAdapter(
        executor.connection, _snov_domain_transport, per_firm=per_firm, max_pages=max_pages,
        title_function_exclusions=title_function_exclusions(executor.connection),
    )

    def _adapter(request) -> tuple[str, str]:
        executor.connection.commit()
        try:
            outcome = adapter.execute(request, now)
        except SnovPageError as error:
            return "rejected", str(error)
        return "succeeded", outcome or "snov_domain_completed"

    executor.register_adapter("finder_page", _adapter)


def _register_snapshot_adapter(executor) -> None:
    """Attach a plain homepage GET transport to P2's typed snapshot operation."""
    def _adapter(request) -> tuple[str, str]:
        entity_id = str(request.payload["entity_id"])
        row = executor.connection.execute("SELECT website_url FROM company WHERE company_id=?", (entity_id,)).fetchone()
        if row is None or not row["website_url"]:
            return "rejected", "snapshot_entity_url_missing"
        from urllib.parse import urlsplit
        host = urlsplit(str(row["website_url"])).hostname
        if not host:
            return "rejected", "fetch_domain_blocked"
        database = next((str(item[2]) for item in executor.connection.execute("PRAGMA database_list") if item[1] == "main"), "")
        allowed_hosts = (host, host[4:]) if host.startswith("www.") else (host, f"www.{host}")
        policy = FetchPolicy(allowed_hosts, "fill-homepage-v1", Path(database).parent / "snapshots")
        try:
            meta = fetch_snapshot(executor.connection, entity_id, policy, datetime.now(timezone.utc), lambda url: _http(url, policy))
        except urllib.error.HTTPError:
            return "rejected", "fetch_http_error"
        except ValueError:
            return "rejected", "fetch_domain_blocked"
        except (urllib.error.URLError, ssl.SSLError, socket.timeout, OSError):
            return "rejected", "fetch_transport_error"
        body = (policy.snapshot_dir / meta.body_ref).read_bytes()
        text = body.decode("utf-8", "replace")
        match = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', text, re.I)
        if not match:
            match = re.search(r'<title[^>]*>(.*?)</title>', text, re.I | re.S)
        blurb = re.sub(r"\s+", " ", match.group(1) if match else "").strip()[:160]
        executor.connection.execute(
            """INSERT INTO company_profile(company_id,website,blurb,fetched_at) VALUES(?,?,?,?)
               ON CONFLICT(company_id) DO UPDATE SET website=excluded.website,blurb=excluded.blurb,fetched_at=excluded.fetched_at""",
            (entity_id, str(row["website_url"]), blurb, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
        )
        return "succeeded", "snapshot_profiled"
    executor.register_adapter("fetch_snapshot", _adapter)


def attach_vendors(executor, *, now: str, providers: Sequence[str] = ("hunter", "snov"), per_firm: int | None = None, max_pages: int = 30) -> dict[str, DesktopVendorAdapter]:
    """Register the requested operator adapters through the P2 reservation path.

    Key availability is intentionally checked by ``_live_call`` at execution,
    rather than during registration, so adapter objects cannot hold credentials.
    """
    requested = selected_provider_names(providers)
    if (per_firm is not None and per_firm < 1) or max_pages < 1:
        raise ValueError("invalid_per_firm")
    adapters = {
        provider: DesktopVendorAdapter(provider, executor.connection)
        for provider in requested
    }
    if "snov" in requested:
        # An unfinished v2 task is retried only after a fresh executor run binds
        # adapters.  Its original reservation and task hash remain untouched.
        executor.connection.execute(
            """UPDATE exec_request SET state='queued',reason='snov_search_resume'
               WHERE state='uncertain' AND request_id IN (
                   SELECT request_id FROM snov_email_search
                   UNION SELECT request_id FROM snov_domain_search
               )"""
        )
        executor.connection.commit()
    _register_selected_vendor_adapters(executor, adapters, now)
    _register_snapshot_adapter(executor)
    if "snov" in requested:
        _register_snov_domain_adapter(executor, now, per_firm, max_pages)
    return adapters
