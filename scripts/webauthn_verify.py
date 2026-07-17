"""Dispatcher-side WebAuthn assertion verifier (dashboard plan D2.3).

This module is the **T3 trust boundary** of the dashboard's approval channel. A
recorded WebAuthn assertion (produced in the operator's browser by an enrolled
authenticator) authorises a consequential action; ``verify_webauthn_approval``
is the independent, dispatcher-side check that the assertion is genuine, fresh,
and bound to *exactly* the card content that is about to execute. A bug here
silently defeats the entire approval gate, so every input is treated as hostile
and every check FAILS CLOSED: any missing/malformed value, any exception path,
and any absent piece of enforcement infrastructure (pinned public key, nonce
store, counter store) returns a rejection — never a skip-to-accept.

====================================================================== =========
## Security-review note (HUMAN GATE D2.11) — what is and is not bound
====================================================================== =========

WHAT THE ASSERTION BINDS (cannot be changed after the operator taps their key):

  * The four consequential card fields ``action`` / ``target`` / ``risk-tier`` /
    ``owner``, via ``content_hash`` — the SHA-256 of the canonical payload
    defined in the FROZEN ``dashboard/server/auth/challenge.ts`` and recomputed
    here byte-identically (see PARITY note below). ``content_hash`` travels
    inside the signed ``challenge`` (``base64url([cardId, action, content_hash,
    nonce])``), so flipping any of the four fields after a signature is collected
    changes the recomputed hash and the assertion no longer matches. This is what
    closes the tier-laundering / target-swap / owner-swap holes.
  * The card **identity** (``cardId``) and ``action``, which appear in the
    challenge tuple directly and are re-checked against the committed card, so a
    valid assertion for card A cannot be pasted onto a different card B.
  * The origin (phishing-resistance) and RP id (which site the key answered to),
    via ``clientDataJSON.origin`` and ``authenticatorData.rpIdHash``.

WHAT ``content_hash`` DOES **NOT** COVER — and how it is bound instead:

  * The **work-order body** (and every other byte of the card outside the four
    fields) is deliberately NOT in ``content_hash``. The card-schema hash-binding
    note (governance/card-schema.md) makes this a cross-plan invariant: the
    dashboard channel binds the four consequential fields; the fleet signed
    channel (``scripts/approvals.py``) binds ``action`` + ``target`` + work-order
    prose instead — the two channels canonicalize DIFFERENTLY ON PURPOSE and must
    not be "harmonized". I did NOT add the body to ``content_hash``: doing so
    would break byte-identity with the frozen D2.2 preimage and silently reject
    every real assertion.
  * Instead, the body (and the whole file) is bound by **committed-object
    pinning**, mirroring ``approvals.py``'s discipline: the verifier recomputes
    ``content_hash`` from, and returns the card parsed from, the EXACT committed
    bytes of the introducing commit on the ref being approved
    (``git show <sha>:<rel>``), and REQUIRES the working tree to be identical to
    that object. The executor (D2.4) acts on that pinned ``.card`` — never a
    re-read of the mutable working tree/ops HEAD.

    Tamper cases this leaves for the reviewer to weigh:
      - Post-approval body swap in the WORKING TREE only  -> rejected: working
        tree diverges from the committed object.
      - Post-approval card swap pushed to ops as a NEW commit -> rejected: the
        new introducing commit's four fields no longer hash to the signed
        ``content_hash`` (if the four fields changed), OR — if ONLY the body
        changed while the four fields are byte-identical — the recomputed
        ``content_hash`` still matches the challenge. THIS IS THE RESIDUAL: a
        same-fields, body-only rewrite that is *also* pushed as the introducing
        commit AND leaves the working tree matching it would pass the hash and
        worktree checks. The nonce single-use gate still blocks *replaying* a
        prior assertion, but a first-use assertion whose card had its body
        rewritten (four fields intact) before first verification would execute
        the rewritten body. Whether that residual is acceptable depends on the
        threat model for the same-desktop ops-writer between challenge issuance
        (D2.2) and first verification; the corroboration UI (D2.4) shows the
        operator ``cardId + action + risk-tier`` — NOT the body — so a body-only
        swap is not visible to the human either. RECOMMENDATION for D2.11: decide
        whether the body must also enter ``content_hash`` for the WebAuthn channel
        (a deliberate divergence from D2.2 would then be required), or whether
        pinning the challenge to the specific committed object SHA at issuance
        (recording it server-side, out of ops-writer reach) is preferred. This
        module implements the plan-as-written (four-field hash + committed-object
        pin) and flags the residual rather than silently choosing.

## Security-review note (HUMAN GATE D2.11) — the credential-store anchor (BLOCKER-1)
------------------------------------------------------------------------------------
The card is committed-object-pinned, but the thing that decides WHICH public key /
rp-id / origin authorizes it — ``governance/webauthn-credentials.yaml`` — must be
anchored just as hard, or an attacker with working-tree write (in scope for this
threat model) simply swaps in their own rp-id/origin/pubkey, signs a T3 card with
their own key, and it verifies. The fix applies BOTH layers ``approvals.py`` uses:

  * ROOT OF TRUST (load-bearing): ``EXPECTED_CRED_STORE_SHA256`` — an in-source
    SHA-256 of the authorized store, the direct analogue of
    ``approvals.WEB_FLOW_FINGERPRINTS``. The committed store bytes MUST hash to it
    or the channel rejects. A working-tree/.git attacker cannot forge a constant
    baked into this reviewed source. ``None`` is the fail-closed sentinel until
    gate D2.12 registers a passkey (see the constant's comment).
  * DEFENSE-IN-DEPTH: the store is read from the COMMITTED OBJECT on the resolved
    ref (``git show <sha>:<rel>``, same as the card) and the working-tree copy must
    match that object (worktree-match).

CAVEAT the reviewer must weigh (why the SHA is the load-bearing control): the ref
preference in ``_resolve_ops_ref`` (``refs/remotes/origin/ops`` over local ``ops``)
is NOT a real anchor in a *local clone* — ``refs/remotes/origin/ops`` is just a
file under ``.git/`` that the same working-tree/.git attacker can rewrite. So the
committed-object + ref layer alone does not stop BLOCKER-1 (the attacker's store IS
the committed object in their clone); the in-source ``EXPECTED_CRED_STORE_SHA256``
constant is what actually stops it. The ref/committed-object layer is retained as
defense-in-depth (it catches a worktree-only swap and keeps the executor reading
the anchored bytes), mirroring the identical N1 caveat on the signed channel.

(The work-order-body-not-bound question above remains a SEPARATE open decision for
D2.11 — unchanged here; ``content_hash``'s D2.2-frozen preimage is untouched.)

PARITY note (load-bearing): the frozen ``challenge.ts`` computes the payload with
JS ``JSON.stringify``, which emits raw UTF-8 for non-ASCII characters. Python's
``json.dumps`` DEFAULTS to ``ensure_ascii=True`` (``\\uXXXX`` escapes) — the
docstring hint in ``challenge.ts`` naming ``json.dumps(...)`` is therefore
INCOMPLETE: for any non-ASCII field it would produce a DIFFERENT hash and reject
a legitimate assertion. This module uses ``ensure_ascii=False`` to be
byte-identical to the running TS code (verified against Node for ASCII and
non-ASCII cards). This is a correctness/availability property, not a hole (a
mismatch fails closed), but it is exactly the subtle divergence this boundary
must get right.

INDEPENDENCE note: the ECDSA P-256 verify below is a self-contained pure-python
implementation (no third-party ``cryptography`` dependency is available in this
environment). The test suite carries a SEPARATE, independent P-256 signer, so a
shared implementation bug cannot make a forged assertion verify.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import subprocess
from pathlib import Path

import yaml

import approvals  # reuse the audited committed-object discipline (F1/F5, TOCTOU)
import cards

# The WebAuthn assertion frontmatter discriminator + the four sub-fields.
_ASSURANCE = "webauthn"
_WEBAUTHN_KEY = "webauthn"

# authenticatorData flag bits (WebAuthn L2 §6.1).
_FLAG_UP = 0x01  # User Present
_FLAG_UV = 0x04  # User Verified (biometric / PIN)

_GIT_TIMEOUT = 30

# The governance-relative path of the pinned credential store (rp-id, origin,
# authorized public keys). Loaded from the COMMITTED OBJECT on the protected ref,
# never from the mutable working tree (see _load_pinned_config).
_CRED_STORE_REL = "governance/webauthn-credentials.yaml"

# ============================================================================ #
# ROOT OF TRUST — pinned SHA-256 of the AUTHORIZED credential store.           #
# ============================================================================ #
# This in-source constant is the LOAD-BEARING anchor for the credential store
# (rp-id / origin / the public keys that authorize a T3 approval), exactly like
# ``approvals.WEB_FLOW_FINGERPRINTS`` anchors the signed channel. The committed
# store bytes MUST hash to this constant or EVERY webauthn approval is rejected.
#
# WHY A BAKED-IN CONSTANT AND NOT JUST THE COMMITTED OBJECT / REF:
#   The threat model grants the attacker WORKING-TREE (and local ``.git``) write.
#   Such an attacker can rewrite governance/webauthn-credentials.yaml AND commit
#   it AND point a local ref at it — so "load from the committed object on
#   refs/remotes/origin/ops" is NOT, by itself, an anchor in a local clone (that
#   ref is just an attacker-writable file under .git/). The only thing the
#   attacker CANNOT forge is a constant baked into this reviewed verifier source.
#   So this SHA is the real root of trust; the committed-object + worktree-match
#   layer below is defense-in-depth (it catches a worktree-only swap and keeps
#   the executor reading the same bytes we anchored). See the D2.11 note in the
#   module docstring.
#
# SENTINEL — ``None`` means "NO PASSKEY HAS BEEN REGISTERED YET": the verifier
# FAILS CLOSED and rejects ALL webauthn approvals. This is the correct state
# until human gate D2.12 runs.
#
#   >>> HUMAN GATE D2.12 (MANDATORY before the webauthn channel can approve): <<<
#   After the operator registers their passkey and commits
#   governance/webauthn-credentials.yaml on the PROTECTED main/ops ref, set this
#   constant to the sha256 of the committed store bytes, e.g.:
#       git show origin/ops:governance/webauthn-credentials.yaml | sha256sum
#   and land that change through the human-edited-governance path. Leaving it
#   None keeps the whole channel fail-closed (safe) but non-functional.
EXPECTED_CRED_STORE_SHA256 = None

# Sentinel distinguishing "caller did not pass an expected hash → use the pinned
# module constant" from "caller explicitly passed a hash (tests inject one to
# exercise the accept path with an ephemeral store)".
_USE_PINNED_CONSTANT = object()


# --------------------------------------------------------------------------- #
# Result type — a (ok, reason) 2-tuple that also carries the verified card.    #
# --------------------------------------------------------------------------- #
class WebAuthnResult(tuple):
    """``(ok, reason)`` that also exposes ``.card`` — the card parsed from the
    committed, pinned object the assertion was verified against, so the executor
    (D2.4) acts on exactly those bytes and never re-reads the working tree."""

    def __new__(cls, ok: bool, reason: str, card=None):
        self = super().__new__(cls, (bool(ok), reason))
        self._card = card
        return self

    @property
    def ok(self) -> bool:
        return self[0]

    @property
    def reason(self) -> str:
        return self[1]

    @property
    def card(self):
        return self._card


def _reject(reason: str, card=None) -> WebAuthnResult:
    return WebAuthnResult(False, reason, card)


# --------------------------------------------------------------------------- #
# base64url + canonical hashing (byte-identical to the frozen challenge.ts).   #
# --------------------------------------------------------------------------- #
def _b64url_decode(s: str) -> bytes:
    """Strict base64url decode (no padding), fail-closed on anything malformed."""
    if not isinstance(s, str):
        raise ValueError("not a string")
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


_CANONICAL_FIELDS = ("action", "target", "risk-tier", "owner")


def canonical_card_payload(meta: dict) -> str:
    """The frozen D2.2 canonical preimage: four fixed fields, read by name, each
    JSON-encoded with compact separators, ``"<field>:<json>"`` lines joined by LF
    with no trailing newline. ``ensure_ascii=False`` to match JS ``JSON.stringify``
    (see the module PARITY note)."""
    return "\n".join(
        f"{field}:{json.dumps(meta.get(field), separators=(',', ':'), ensure_ascii=False)}"
        for field in _CANONICAL_FIELDS)


def content_hash(meta: dict) -> str:
    return hashlib.sha256(canonical_card_payload(meta).encode("utf-8")).hexdigest()


def build_challenge(card_id: str, action: str, chash: str, nonce: str) -> str:
    pre = json.dumps([card_id, action, chash, nonce],
                     separators=(",", ":"), ensure_ascii=False)
    return _b64url_encode(pre.encode("utf-8"))


def parse_challenge(challenge: str):
    """Inverse of build_challenge. Returns (cardId, action, contentHash, nonce)
    or raises ValueError. Fail closed on anything that isn't a 4-element string
    array (mirrors challenge.ts ``parseChallenge``)."""
    decoded = _b64url_decode(challenge).decode("utf-8")
    parsed = json.loads(decoded)
    if (not isinstance(parsed, list) or len(parsed) != 4
            or not all(isinstance(p, str) for p in parsed)):
        raise ValueError("challenge is not a 4-element string array")
    return tuple(parsed)


# --------------------------------------------------------------------------- #
# Pure-python NIST P-256 (secp256r1) ECDSA verification.                       #
# --------------------------------------------------------------------------- #
_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
_A = _P - 3
_B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
_GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
_GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_G = (_GX, _GY)


def _inv(a: int, m: int) -> int:
    return pow(a % m, m - 2, m)


def _on_curve(pt) -> bool:
    if pt is None:
        return False
    x, y = pt
    if not (0 <= x < _P and 0 <= y < _P):
        return False
    return (y * y - (x * x * x + _A * x + _B)) % _P == 0


def _pt_add(p, q):
    if p is None:
        return q
    if q is None:
        return p
    (x1, y1), (x2, y2) = p, q
    if x1 == x2 and (y1 + y2) % _P == 0:
        return None
    if p == q:
        lam = (3 * x1 * x1 + _A) * _inv(2 * y1, _P) % _P
    else:
        lam = (y2 - y1) * _inv(x2 - x1, _P) % _P
    x3 = (lam * lam - x1 - x2) % _P
    y3 = (lam * (x1 - x3) - y1) % _P
    return (x3, y3)


def _pt_mul(k: int, point):
    result = None
    addend = point
    while k:
        if k & 1:
            result = _pt_add(result, addend)
        addend = _pt_add(addend, addend)
        k >>= 1
    return result


def _der_parse_sig(sig: bytes):
    """Parse a DER ECDSA-Sig-Value (SEQUENCE{INTEGER r, INTEGER s}) into (r, s).
    Strict / fail-closed: raises ValueError on any structural defect."""
    if len(sig) < 8 or sig[0] != 0x30:
        raise ValueError("bad DER: not a SEQUENCE")
    seq_len = sig[1]
    if seq_len & 0x80:
        raise ValueError("bad DER: long-form length not allowed for P-256")
    if seq_len != len(sig) - 2:
        raise ValueError("bad DER: sequence length mismatch / trailing bytes")
    idx = 2

    def _read_int(i):
        if sig[i] != 0x02:
            raise ValueError("bad DER: expected INTEGER")
        ln = sig[i + 1]
        if ln & 0x80 or ln == 0:
            raise ValueError("bad DER: bad INTEGER length")
        start = i + 2
        end = start + ln
        if end > len(sig):
            raise ValueError("bad DER: INTEGER overruns buffer")
        return int.from_bytes(sig[start:end], "big"), end

    r, idx = _read_int(idx)
    s, idx = _read_int(idx)
    if idx != len(sig):
        raise ValueError("bad DER: trailing bytes after s")
    return r, s


def _es256_verify(pub, message: bytes, der_sig: bytes) -> bool:
    """ECDSA P-256 / SHA-256 verify. Returns True only on a valid signature;
    any malformation returns False (fail closed)."""
    try:
        if not _on_curve(pub):
            return False
        r, s = _der_parse_sig(der_sig)
        if not (1 <= r < _N and 1 <= s < _N):
            return False
        z = int.from_bytes(hashlib.sha256(message).digest(), "big")
        w = _inv(s, _N)
        u1 = z * w % _N
        u2 = r * w % _N
        point = _pt_add(_pt_mul(u1, _G), _pt_mul(u2, pub))
        if point is None:
            return False
        return point[0] % _N == r
    except Exception:  # noqa: BLE001 — any failure is a rejection
        return False


# --------------------------------------------------------------------------- #
# Pinned credential store (governance/), nonce store + counter store (ledgers).#
# --------------------------------------------------------------------------- #
def _committed_blob(sha: str, rel: str, repo_root: Path):
    """Raw committed bytes of ``<sha>:<rel>`` (NOT the working tree), or ``None``.

    Mirrors ``approvals._committed_card`` but returns the bytes unparsed, so the
    credential store can be hashed byte-for-byte against the pinned root of trust.
    """
    try:
        res = subprocess.run(["git", "show", f"{sha}:{rel}"], cwd=repo_root,
                             capture_output=True, timeout=_GIT_TIMEOUT)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    return res.stdout


def _load_pinned_config(repo_root: Path, resolved_ref: str, *, expected_sha256):
    """Load the pinned RP id/origin + credential public keys — ANCHORED to the
    in-source root of trust and to the committed object, never the working tree.

    Two layers of defense, applied in order:
      1. ROOT OF TRUST (load-bearing): the committed store bytes MUST hash to
         ``expected_sha256`` (the ``EXPECTED_CRED_STORE_SHA256`` module constant,
         or a test-injected override). ``expected_sha256 is None`` is the
         "no passkey registered yet" sentinel and rejects unconditionally.
      2. DEFENSE-IN-DEPTH: the store is read from the COMMITTED OBJECT on the
         protected ``resolved_ref`` (``git show <introducing-sha>:<rel>``, exactly
         as the card is loaded) and the WORKING TREE copy the executor reads must
         be byte-identical to that committed object (worktree-match).

    Returns ``((rp_id, origin, {credential_id: (x, y)}), "ok")`` on success, or
    ``(None, reason)`` (fail closed) on any missing/mismatched/malformed input.
    """
    # (1) ROOT OF TRUST first: no pinned hash => no passkey registered => reject
    #     the ENTIRE channel. A working-tree/.git attacker cannot forge a match
    #     for a constant baked into this reviewed source.
    if expected_sha256 is None:
        return None, ("no passkey registered — EXPECTED_CRED_STORE_SHA256 is the "
                      "fail-closed sentinel (None); all webauthn approvals rejected "
                      "until human gate D2.12 pins the committed store's sha256")

    rel = _CRED_STORE_REL
    # (2) Committed object on the ref being approved (same discipline as the card).
    sha = approvals._introducing_commit(rel, repo_root, resolved_ref)
    if not sha:
        return None, "pinned credential store is not a committed object on the ref being approved"
    raw = _committed_blob(sha, rel, repo_root)
    if raw is None:
        return None, "cannot read the committed pinned credential store (fail closed)"

    # (3) ROOT OF TRUST enforcement: the committed bytes MUST hash to the pin.
    actual = hashlib.sha256(raw).hexdigest()
    if not hmac.compare_digest(actual, str(expected_sha256)):
        return None, ("pinned credential store sha256 mismatch — the committed store "
                      "is not the authorized root of trust (rejected)")

    # (4) DEFENSE-IN-DEPTH: the working-tree copy the executor reads must equal the
    #     committed object we just anchored (catches a worktree-only key/rp swap).
    matches = approvals._worktree_matches_commit(sha, rel, repo_root)
    if matches is None:
        return None, "cannot compare working-tree credential store to the pinned committed object"
    if not matches:
        return None, ("working-tree credential store differs from the pinned committed "
                      "object (rp-id/origin/pubkey tamper?)")

    # (5) Parse the ANCHORED bytes (not a re-read of the working tree).
    try:
        data = yaml.safe_load(raw.decode("utf-8"))
    except (yaml.YAMLError, UnicodeDecodeError):
        return None, "pinned credential store is malformed (fail closed)"
    if not isinstance(data, dict):
        return None, "pinned credential store is malformed (fail closed)"
    rp_id = data.get("rp-id")
    origin = data.get("origin")
    if not isinstance(rp_id, str) or not isinstance(origin, str):
        return None, "pinned credential store has no valid rp-id/origin (fail closed)"
    creds: dict[str, tuple[int, int]] = {}
    for entry in data.get("credentials", []) or []:
        if not isinstance(entry, dict):
            return None, "pinned credential store has a malformed credential entry (fail closed)"
        cid = entry.get("credential-id")
        try:
            x = int.from_bytes(_b64url_decode(entry["x"]), "big")
            y = int.from_bytes(_b64url_decode(entry["y"]), "big")
        except (KeyError, ValueError, TypeError):
            return None, "pinned credential store has a malformed public key (fail closed)"
        if not isinstance(cid, str):
            return None, "pinned credential store has a malformed credential-id (fail closed)"
        creds[cid] = (x, y)
    if not creds:
        return None, "pinned credential store has no credentials (fail closed)"
    return (rp_id, origin, creds), "ok"


def _nonce_dir(repo_root: Path, nonce_dir=None) -> Path:
    return Path(nonce_dir) if nonce_dir else (
        Path(repo_root) / "ledgers" / "webauthn" / "nonces")


def _nonce_sentinel(nonce: str, ndir: Path) -> Path:
    return ndir / (hashlib.sha256(nonce.encode("utf-8")).hexdigest() + ".used")


def _nonce_consumed(nonce: str, ndir: Path) -> bool:
    return _nonce_sentinel(nonce, ndir).exists()


def _consume_nonce(nonce: str, ndir: Path) -> bool:
    """Atomically mark the nonce consumed. Returns False if it was already
    consumed (concurrent replay) or if the store cannot be written (fail closed)."""
    try:
        ndir.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(_nonce_sentinel(nonce, ndir)),
                     os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
        return True
    except FileExistsError:
        return False
    except OSError:
        return False


def _counter_path(repo_root: Path, counter_path=None) -> Path:
    return Path(counter_path) if counter_path else (
        Path(repo_root) / "ledgers" / "webauthn" / "counters.json")


def _stored_counter(cred_id: str, cpath: Path) -> int:
    """Last seen sign-count for the credential; -1 if never seen (so signCount 0
    is accepted on first use, per WebAuthn's optional counter)."""
    try:
        data = json.loads(cpath.read_text(encoding="utf-8"))
        val = data.get(cred_id, -1)
        return int(val) if isinstance(val, int) else -1
    except (OSError, ValueError, AttributeError):
        return -1


def _store_counter(cred_id: str, value: int, cpath: Path) -> bool:
    try:
        cpath.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = json.loads(cpath.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {}
        except (OSError, ValueError):
            data = {}
        data[cred_id] = int(value)
        cpath.write_text(json.dumps(data), encoding="utf-8")
        return True
    except OSError:
        return False


# --------------------------------------------------------------------------- #
# Ref resolution (the card lives on ops; pin to its introducing commit).       #
# --------------------------------------------------------------------------- #
def _resolve_ops_ref(repo_root: Path, explicit=None) -> str:
    """The ref being approved. An explicit arg wins; else prefer the protected
    ``origin/ops`` over the agent-writable local ``ops``; else fall back to HEAD.
    Mirrors approvals._resolve_approvals_ref's N1 rationale (a local writable ref
    must not be chosen over the protected remote)."""
    if explicit:
        return explicit
    for ref in ("refs/remotes/origin/ops", "refs/heads/ops"):
        try:
            r = subprocess.run(
                ["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"],
                cwd=repo_root, capture_output=True, text=True, timeout=_GIT_TIMEOUT)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return "HEAD"
        if r.stdout.strip():
            return ref
    return "HEAD"


# --------------------------------------------------------------------------- #
# Private per-check helpers (named in the plan).                               #
# --------------------------------------------------------------------------- #
def _parse_authenticator_data(raw: bytes):
    """(rpIdHash, flags, signCount) from authenticatorData, or None if too short."""
    if len(raw) < 37:
        return None
    return raw[0:32], raw[32], int.from_bytes(raw[33:37], "big")


def _check_flags(flags: int) -> tuple[bool, str]:
    if not (flags & _FLAG_UP):
        return False, "user presence (UP) bit not set"
    if not (flags & _FLAG_UV):
        return False, "user verification (UV) bit not set"
    return True, "ok"


def _check_rpid_hash(rp_id_hash: bytes, expected_rp_id: str) -> tuple[bool, str]:
    expected = hashlib.sha256(expected_rp_id.encode("utf-8")).digest()
    if not hmac.compare_digest(rp_id_hash, expected):
        return False, "authenticatorData rpIdHash does not match the pinned RP id"
    return True, "ok"


def _check_origin(client_data: dict, expected_origin: str) -> tuple[bool, str]:
    if client_data.get("type") != "webauthn.get":
        return False, f"clientDataJSON type is not 'webauthn.get' ({client_data.get('type')!r})"
    if client_data.get("origin") != expected_origin:
        return False, f"clientDataJSON origin mismatch (got {client_data.get('origin')!r})"
    return True, "ok"


def _check_counter(cred_id: str, sign_count: int, cpath: Path) -> tuple[bool, str]:
    stored = _stored_counter(cred_id, cpath)
    if sign_count <= stored:
        return False, (f"sign counter not monotonic (got {sign_count}, "
                       f"stored {stored}) — possible authenticator clone")
    return True, "ok"


# --------------------------------------------------------------------------- #
# The verifier.                                                                #
# --------------------------------------------------------------------------- #
def verify_webauthn_approval(
    card_path,
    repo_root,
    *,
    ref=None,
    nonce_dir=None,
    counter_path=None,
    expected_rp_id=None,
    expected_origin=None,
    expected_cred_store_sha256=_USE_PINNED_CONSTANT,
) -> WebAuthnResult:
    """Independently verify a recorded WebAuthn assertion against pinned content.

    Returns a ``WebAuthnResult`` — a ``(ok, reason)`` tuple that also carries
    ``.card`` (the committed, pinned card the executor must act on). Fails closed
    on every malformed/missing input and on any absent enforcement infrastructure.
    """
    try:
        repo_root = Path(repo_root)

        # (1) Path must resolve inside the repo (symlink/out-of-tree escape).
        rel = approvals._rel_in_repo(Path(card_path), repo_root)
        if rel is None:
            return _reject("card path resolves outside the repo (rejected)")

        # (2) Resolve the ref being approved (prefer the protected remote).
        resolved_ref = _resolve_ops_ref(repo_root, ref)

        # (3) Pinned config: RP id/origin + credential public keys, ANCHORED to
        #     the in-source root-of-trust SHA and to the committed object on that
        #     ref (never the mutable working tree). Fail closed. A caller may
        #     inject an expected hash (tests, to exercise the accept path with an
        #     ephemeral store); production uses the pinned module constant.
        expected_sha = (EXPECTED_CRED_STORE_SHA256
                        if expected_cred_store_sha256 is _USE_PINNED_CONSTANT
                        else expected_cred_store_sha256)
        config, cfg_reason = _load_pinned_config(
            repo_root, resolved_ref, expected_sha256=expected_sha)
        if config is None:
            return _reject(cfg_reason)
        cfg_rp_id, cfg_origin, creds = config
        rp_id = expected_rp_id or cfg_rp_id
        origin = expected_origin or cfg_origin

        # (4) Pin the CARD to the committed object on the ref being approved.
        sha = approvals._introducing_commit(rel, repo_root, resolved_ref)
        if not sha:
            return _reject("no commit on the ref being approved introduced the card")

        # (5) Authoritative content = the committed bytes of that commit.
        card = approvals._committed_card(sha, rel, repo_root)
        if card is None:
            return _reject("card is not a committed object on the ref being approved")

        # (6) The working tree the executor reads must equal the pinned object.
        matches = approvals._worktree_matches_commit(sha, rel, repo_root)
        if matches is None:
            return _reject("cannot compare working tree to the pinned committed object")
        if not matches:
            return _reject("working tree differs from the pinned committed card (tamper?)")

        # (7) Channel discriminator.
        if card.meta.get("assurance") != _ASSURANCE:
            return _reject("card is not a WebAuthn-channel approval (assurance != 'webauthn')")

        # (8) The recorded assertion envelope.
        block = card.meta.get(_WEBAUTHN_KEY)
        if not isinstance(block, dict):
            return _reject("card has no 'webauthn' assertion block")
        try:
            cred_id = block["credential-id"]
            auth_data_raw = _b64url_decode(block["authenticator-data"])
            client_data_raw = _b64url_decode(block["client-data-json"])
            signature = _b64url_decode(block["signature"])
        except (KeyError, ValueError, TypeError):
            return _reject("assertion envelope is missing or not valid base64url")
        if not isinstance(cred_id, str):
            return _reject("assertion has no credential-id")

        # (9) Credential must be pinned in governance -> its public key.
        pub = creds.get(cred_id)
        if pub is None:
            return _reject("assertion credential-id is not a governance-pinned credential")

        # (10) authenticatorData: flags (UP/UV), rpIdHash, signCount.
        parsed = _parse_authenticator_data(auth_data_raw)
        if parsed is None:
            return _reject("authenticatorData is too short / malformed")
        rp_id_hash, flags, sign_count = parsed
        ok, why = _check_flags(flags)
        if not ok:
            return _reject(why)
        ok, why = _check_rpid_hash(rp_id_hash, rp_id)
        if not ok:
            return _reject(why)

        # (11) clientDataJSON: type + origin + challenge.
        try:
            client_data = json.loads(client_data_raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return _reject("clientDataJSON is not valid JSON")
        if not isinstance(client_data, dict):
            return _reject("clientDataJSON is not an object")
        ok, why = _check_origin(client_data, origin)
        if not ok:
            return _reject(why)
        challenge = client_data.get("challenge")
        if not isinstance(challenge, str):
            return _reject("clientDataJSON has no challenge")

        # (12) Challenge binding: recompute content_hash from the pinned card and
        #      require the signed challenge to bind this exact card + fields.
        try:
            ch_card_id, ch_action, ch_hash, ch_nonce = parse_challenge(challenge)
        except (ValueError, UnicodeDecodeError):
            return _reject("signed challenge is malformed")
        if ch_card_id != str(card.meta.get("id")):
            return _reject("signed challenge cardId does not match the card being approved")
        if ch_action != card.meta.get("action"):
            return _reject("signed challenge action does not match the card action")
        recomputed = content_hash(card.meta)
        if not hmac.compare_digest(ch_hash, recomputed):
            return _reject("content hash does not match the pinned card "
                           "(fields changed after approval / ops swap?)")
        # Belt-and-suspenders: the challenge must be the canonical encoding.
        if build_challenge(ch_card_id, ch_action, recomputed, ch_nonce) != challenge:
            return _reject("challenge is not the canonical encoding of its parts")

        # (13) Signature over authenticatorData || SHA-256(clientDataJSON),
        #      chaining to the pinned public key.
        signed_message = auth_data_raw + hashlib.sha256(client_data_raw).digest()
        if not _es256_verify(pub, signed_message, signature):
            return _reject("signature does not verify against the pinned public key")

        # (14) Freshness: single-use nonce, then monotonic counter (read-only
        #      checks; the durable state is committed only after all checks pass).
        ndir = _nonce_dir(repo_root, nonce_dir)
        if _nonce_consumed(ch_nonce, ndir):
            return _reject("nonce already consumed (assertion replay)")
        cpath = _counter_path(repo_root, counter_path)
        ok, why = _check_counter(cred_id, sign_count, cpath)
        if not ok:
            return _reject(why)

        # (15) Commit durable single-use state. Consume the nonce ATOMICALLY —
        #      a lost race here (already consumed) is a replay -> reject. Only
        #      then advance the counter.
        if not _consume_nonce(ch_nonce, ndir):
            return _reject("nonce already consumed (assertion replay)")
        if not _store_counter(cred_id, sign_count, cpath):
            return _reject("could not persist the sign counter (fail closed)")

        return WebAuthnResult(True, "ok", card=card)
    except Exception as exc:  # noqa: BLE001 — the boundary NEVER raises to accept
        return _reject(f"verification error (fail closed): {exc}")


# --------------------------------------------------------------------------- #
# CLI — dashboard-owned, so a small entry point is fine (unlike approvals.py). #
# --------------------------------------------------------------------------- #
def _main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Verify a recorded WebAuthn assertion on a card (D2.3).")
    parser.add_argument("card_path")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--ref", default=None)
    args = parser.parse_args(argv)

    result = verify_webauthn_approval(args.card_path, args.repo_root, ref=args.ref)
    print(json.dumps({"ok": result.ok, "reason": result.reason}))
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(_main())
