"""Host-side WebAuthn assertion verifier for a fleet-PTY open (D3.1 MED mitigation).

This module is the **Factor C** verifier of the cross-user PTY-host channel. Opening a fleet PTY
requires, on top of the existing peer-SID (Factor A) and per-boot-token (Factor B) factors, a
HOST-verified, hardware-backed WebAuthn assertion over a HOST-issued fresh nonce. This verifier runs
inside the kb-fleet PTY-host process — the one process a same-user (Medium-IL) attacker cannot BE — so
an attacker who bypasses the daemon and talks to the pipe directly still cannot forge Factor C.

WHY A NEW MODULE (not ``webauthn_verify.verify_webauthn_approval``): that function is CARD-centric —
it requires a committed card path, recomputes ``content_hash`` from the card, and parses the challenge
as the FOUR-tuple ``[cardId, action, contentHash, nonce]``. A PTY open has no card and a TWO-tuple
``["kb-pty-open", nonce]`` challenge (domain-separated). Editing the frozen card verifier to add a
card-less mode is forbidden and would broaden a T3-critical function. So this module REUSES the frozen
primitives BY IMPORT ONLY (importing a module and calling its functions is not an edit) and contributes
only the PTY challenge parse + the host-nonce orchestration.

REUSED FROZEN PRIMITIVES (``scripts/webauthn_verify.py``, byte-identical, zero edits):
  * ``_es256_verify``            — the audited pure-python P-256 ECDSA verify (crypto is NOT reimplemented).
  * ``_load_pinned_config``      — the credential store anchored by ``EXPECTED_CRED_STORE_SHA256`` +
                                   committed-object pinning (ONE authorized-passkey source of truth,
                                   shared with the card channel).
  * ``_parse_authenticator_data``, ``_check_flags`` (UP∧UV), ``_check_rpid_hash``, ``_check_origin``,
    ``_check_counter`` + ``_store_counter`` + ``_counter_path`` (shared monotone counter store),
    ``_b64url_decode``, ``_resolve_ops_ref``, ``EXPECTED_CRED_STORE_SHA256``, ``_USE_PINNED_CONSTANT``.

Every input is treated as hostile; every check FAILS CLOSED. Any missing/malformed field, any absent
enforcement infrastructure (unpinned store, unknown credential), any exception path returns a rejection
— never a skip-to-accept. The boundary ``except`` returns a rejection, never an accept.

ANTI-REPLAY: the caller (the pipe server) issues a fresh 256-bit nonce per CONNECTION and passes the
assembled ``expected_challenge`` here; this verifier requires ``clientDataJSON.challenge`` to byte-equal
it. An assertion captured over one connection's nonce cannot satisfy another connection's nonce. Single
use is guaranteed by the caller's per-connection nonce, so no shared nonce store is needed on this path
(unlike the card channel's cross-process nonce ledger).

INDEPENDENCE note: the tests carry a SEPARATE, independent P-256 signer (mirroring
``tests/test_webauthn_verify.py``), so a shared implementation bug cannot make a forged assertion verify.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import sys
from pathlib import Path

import webauthn_verify as wv  # reuse the frozen, audited primitives BY IMPORT ONLY (no edits)

# Domain-separation discriminant — distinct from the card channel's 4-tuple. A card-approval assertion
# can never satisfy a PTY open and vice-versa (different tag AND different arity).
PTY_CHALLENGE_TAG = "kb-pty-open"


def _reject(reason: str) -> tuple[bool, str]:
    return (False, reason)


def parse_pty_challenge(challenge: str):
    """Inverse of the TS ``buildPtyChallenge``. Returns the embedded ``nonceB64url`` string, or raises
    ValueError on anything that is not a base64url-wrapped 2-tuple ``["kb-pty-open", <string>]``.
    Rejecting the card channel's 4-tuple here is the domain-separation guard (mirrors the TS
    ``parsePtyChallenge``)."""
    decoded = wv._b64url_decode(challenge).decode("utf-8")
    parsed = json.loads(decoded)
    if (not isinstance(parsed, list) or len(parsed) != 2
            or not all(isinstance(p, str) for p in parsed)):
        raise ValueError("pty challenge is not a 2-element string array")
    tag, nonce = parsed
    if tag != PTY_CHALLENGE_TAG:
        raise ValueError(f"pty challenge tag is not {PTY_CHALLENGE_TAG!r}")
    if not nonce:
        raise ValueError("pty challenge nonce is empty")
    return nonce


def verify_pty_assertion(
    expected_challenge,
    credential_id,
    authenticator_data,
    client_data_json,
    signature,
    repo_root,
    *,
    ref=None,
    counter_path=None,
    expected_rp_id=None,
    expected_origin=None,
    expected_cred_store_sha256=wv._USE_PINNED_CONSTANT,
) -> tuple[bool, str]:
    """Independently verify a recorded WebAuthn assertion for a fleet-PTY open against the HOST-issued
    ``expected_challenge``. Returns ``(ok, reason)``. Fails closed on every malformed/missing input and
    on any absent enforcement infrastructure. The boundary NEVER raises to accept.

    ``authenticator_data`` / ``client_data_json`` / ``signature`` are base64url strings (as produced by
    the browser assertion). ``expected_challenge`` is the base64url-wrapped 2-tuple the host issued.
    """
    try:
        repo_root = Path(repo_root)

        # (0) DOMAIN-SEPARATION guard: the host-issued challenge MUST itself be a well-formed
        #     kb-pty-open 2-tuple (a card 4-tuple passed here is rejected outright).
        try:
            parse_pty_challenge(expected_challenge)
        except (ValueError, UnicodeDecodeError, TypeError, AttributeError):
            return _reject("expected challenge is not a valid kb-pty-open challenge (domain separation)")

        # (1) Pinned config: RP id/origin + credential public keys, ANCHORED to the in-source
        #     root-of-trust SHA and to the committed object on the ref (never the mutable working tree).
        #     A caller may inject an expected hash (tests, to exercise the accept path with an ephemeral
        #     store); production uses the pinned module constant. Fail closed.
        resolved_ref = wv._resolve_ops_ref(repo_root, ref)
        expected_sha = (wv.EXPECTED_CRED_STORE_SHA256
                        if expected_cred_store_sha256 is wv._USE_PINNED_CONSTANT
                        else expected_cred_store_sha256)
        config, cfg_reason = wv._load_pinned_config(
            repo_root, resolved_ref, expected_sha256=expected_sha)
        if config is None:
            return _reject(cfg_reason)
        cfg_rp_id, cfg_origin, creds = config
        rp_id = expected_rp_id or cfg_rp_id
        origin = expected_origin or cfg_origin

        # (2) Decode the recorded assertion envelope.
        try:
            auth_data_raw = wv._b64url_decode(authenticator_data)
            client_data_raw = wv._b64url_decode(client_data_json)
            sig = wv._b64url_decode(signature)
        except (ValueError, TypeError, AttributeError):
            return _reject("assertion envelope is missing or not valid base64url")
        if not isinstance(credential_id, str):
            return _reject("assertion has no credential-id")

        # (3) Credential must be pinned in governance -> its public key.
        pub = creds.get(credential_id)
        if pub is None:
            return _reject("assertion credential-id is not a governance-pinned credential")

        # (4) authenticatorData: flags (UP∧UV), rpIdHash, signCount.
        parsed = wv._parse_authenticator_data(auth_data_raw)
        if parsed is None:
            return _reject("authenticatorData is too short / malformed")
        rp_id_hash, flags, sign_count = parsed
        ok, why = wv._check_flags(flags)
        if not ok:
            return _reject(why)
        ok, why = wv._check_rpid_hash(rp_id_hash, rp_id)
        if not ok:
            return _reject(why)

        # (5) clientDataJSON: type + origin + challenge byte-equality against the host nonce.
        try:
            client_data = json.loads(client_data_raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return _reject("clientDataJSON is not valid JSON")
        if not isinstance(client_data, dict):
            return _reject("clientDataJSON is not an object")
        ok, why = wv._check_origin(client_data, origin)
        if not ok:
            return _reject(why)
        challenge = client_data.get("challenge")
        if not isinstance(challenge, str):
            return _reject("clientDataJSON has no challenge")
        # ANTI-REPLAY: the signed challenge must byte-equal the nonce THIS connection issued.
        if not hmac.compare_digest(challenge, str(expected_challenge)):
            return _reject("signed challenge does not match the host-issued nonce (replay?)")

        # (6) Signature over authenticatorData || SHA-256(clientDataJSON), chaining to the pinned key.
        signed_message = auth_data_raw + hashlib.sha256(client_data_raw).digest()
        if not wv._es256_verify(pub, signed_message, sig):
            return _reject("signature does not verify against the pinned public key")

        # (7) Anti-clone: signCount strictly greater than the stored counter, then persist. The counter
        #     store is SHARED with the card channel (one authenticator -> one global monotone count).
        #     Durable state is written only AFTER all checks pass.
        cpath = wv._counter_path(repo_root, counter_path)
        ok, why = wv._check_counter(credential_id, sign_count, cpath)
        if not ok:
            return _reject(why)
        if not wv._store_counter(credential_id, sign_count, cpath):
            return _reject("could not persist the sign counter (fail closed)")

        return (True, "ok")
    except Exception as exc:  # noqa: BLE001 — the boundary NEVER raises to accept
        return _reject(f"verification error (fail closed): {exc}")


# --------------------------------------------------------------------------- #
# STDIN entry point — the assertion travels via STDIN JSON (never argv), so it #
# stays out of the process table and dodges arg-length/escaping.               #
# --------------------------------------------------------------------------- #
def _main(argv=None) -> int:
    """Read one assertion payload as JSON from STDIN, print one line ``{"ok","reason"}``.

    Payload keys: ``expectedChallenge``, ``credentialId``, ``authenticatorData``, ``clientDataJSON``,
    ``signature``, ``repoRoot`` (optional, default "."), ``ref`` (optional). Any missing field or
    unparseable payload fails closed with a rejection.
    """
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        print(json.dumps({"ok": False, "reason": "unparseable stdin payload (fail closed)"}))
        return 1
    if not isinstance(payload, dict):
        print(json.dumps({"ok": False, "reason": "stdin payload is not an object (fail closed)"}))
        return 1
    try:
        ok, reason = verify_pty_assertion(
            payload["expectedChallenge"],
            payload["credentialId"],
            payload["authenticatorData"],
            payload["clientDataJSON"],
            payload["signature"],
            payload.get("repoRoot", "."),
            ref=payload.get("ref"),
        )
    except KeyError as exc:
        print(json.dumps({"ok": False, "reason": f"missing assertion field (fail closed): {exc}"}))
        return 1
    print(json.dumps({"ok": bool(ok), "reason": reason}))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(_main())
