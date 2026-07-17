"""Task D2.3 — adversarial suite for the dispatcher-side WebAuthn assertion verifier.

This is the T3 trust boundary of the dashboard approval channel: a forged browser
assertion that slips past ``verify_webauthn_approval`` executes a T3 action. Every
test here is written to FAIL CLOSED — the happy path is a single test; the rest
prove specific forgeries are rejected.

Design note — INDEPENDENT crypto on the test side.
The fixtures below carry a *self-contained* pure-python NIST P-256 (secp256r1)
ECDSA keygen + signer. It shares NO code with ``scripts/webauthn_verify.py``'s
verifier. Two independent implementations cross-check each other, so a shared bug
("both wrong the same way") cannot make a forged assertion verify. The verifier is
the artifact under review; this signer only manufactures believable fixtures.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import subprocess
from collections import namedtuple
from pathlib import Path

import cards
import webauthn_verify as wv


# --------------------------------------------------------------------------- #
# Independent P-256 ECDSA (sign + keygen) — fixture crypto only.               #
# --------------------------------------------------------------------------- #
_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
_A = _P - 3
_GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
_GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_G = (_GX, _GY)


def _inv(a: int, m: int) -> int:
    return pow(a % m, m - 2, m)


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


def _keygen():
    d = secrets.randbelow(_N - 1) + 1
    return d, _pt_mul(d, _G)


def _sign(d: int, message: bytes) -> bytes:
    z = int.from_bytes(hashlib.sha256(message).digest(), "big")
    while True:
        k = secrets.randbelow(_N - 1) + 1
        r = _pt_mul(k, _G)[0] % _N
        if r == 0:
            continue
        s = _inv(k, _N) * (z + r * d) % _N
        if s == 0:
            continue
        return _der(r, s)


def _der_int(v: int) -> bytes:
    b = v.to_bytes((v.bit_length() + 7) // 8 or 1, "big")
    if b[0] & 0x80:
        b = b"\x00" + b
    return b"\x02" + bytes([len(b)]) + b


def _der(r: int, s: int) -> bytes:
    body = _der_int(r) + _der_int(s)
    return b"\x30" + bytes([len(body)]) + body


# --------------------------------------------------------------------------- #
# Fixture helpers                                                              #
# --------------------------------------------------------------------------- #
def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _canonical_hash(action, target, risk_tier, owner) -> str:
    fields = [("action", action), ("target", target),
              ("risk-tier", risk_tier), ("owner", owner)]
    payload = "\n".join(
        f"{name}:{json.dumps(val, separators=(',', ':'), ensure_ascii=False)}"
        for name, val in fields)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _build_challenge(card_id, action, content_hash, nonce) -> str:
    pre = json.dumps([card_id, action, content_hash, nonce],
                     separators=(",", ":"), ensure_ascii=False)
    return _b64u(pre.encode("utf-8"))


def _auth_data(rp_id: str, up: int, uv: int, sign_count: int) -> bytes:
    flags = (0x01 if up else 0) | (0x04 if uv else 0)
    return (hashlib.sha256(rp_id.encode("utf-8")).digest()
            + bytes([flags]) + sign_count.to_bytes(4, "big"))


def _git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True,
                   capture_output=True, text=True)


def _write_cred_file(repo: Path, rp_id, origin, credential_id, pub, alg=-7):
    x, y = pub
    (repo / "governance").mkdir(parents=True, exist_ok=True)
    (repo / "governance" / "webauthn-credentials.yaml").write_text(
        "rp-id: \"%s\"\n"
        "origin: \"%s\"\n"
        "credentials:\n"
        "  - credential-id: \"%s\"\n"
        "    alg: %d\n"
        "    x: \"%s\"\n"
        "    y: \"%s\"\n" % (
            rp_id, origin, credential_id, alg,
            _b64u(x.to_bytes(32, "big")), _b64u(y.to_bytes(32, "big"))),
        encoding="utf-8")


def _assertion_meta(*, credential_id, sign_d, rp_id, origin,
                    up, uv, sign_count, client_type, client_origin,
                    action, target, risk_tier, owner, card_id, nonce):
    """Build the recorded ``webauthn:`` frontmatter block for one assertion."""
    content_hash = _canonical_hash(action, target, risk_tier, owner)
    challenge = _build_challenge(card_id, action, content_hash, nonce)
    client_data = json.dumps(
        {"type": client_type, "challenge": challenge, "origin": client_origin},
        separators=(",", ":")).encode("utf-8")
    auth_data = _auth_data(rp_id, up, uv, sign_count)
    signature = _sign(sign_d, auth_data + hashlib.sha256(client_data).digest())
    return {
        "credential-id": credential_id,
        "authenticator-data": _b64u(auth_data),
        "client-data-json": _b64u(client_data),
        "signature": _b64u(signature),
    }


def _commit_card(repo, action, target, risk_tier, owner, card_id, webauthn_meta,
                 msg, init=False):
    card = cards.new_card("dash", action, target, risk_tier,
                          body="## Work order\ndo it\n",
                          state="approvals", owner=owner, id=card_id)
    card.meta["assurance"] = "webauthn"
    card.meta["webauthn"] = webauthn_meta
    card_path = cards.save(card, repo / "queue")
    if init:
        _git(repo, "init", "-q")
        _git(repo, "config", "user.name", "Test")
        _git(repo, "config", "user.email", "test@example.com")
        _git(repo, "config", "core.autocrlf", "false")
        _git(repo, "config", "commit.gpgsign", "false")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", msg)
    return card_path


Case = namedtuple("Case", "repo card_path sign_d credential_id rp_id origin")


def _build_repo(
    tmp_path,
    name="repo",
    *,
    rp_id="dash.tailnet-abc.ts.net",
    origin=None,
    auth_rp_id=None,        # rp id hashed into authenticatorData (default rp_id)
    client_origin=None,     # origin written into clientDataJSON (default origin)
    up=1, uv=1, sign_count=1,
    client_type="webauthn.get",
    action="deploy", target="svc-a", risk_tier="T3", owner="claude/m1",
    card_id="01ARZ3NDEKTSV4RRFFQ69G5FAV",
    nonce="nonce-000",
    sign_d=None,            # private key used to SIGN (default: the pinned key)
    pin_pub=None,           # public key PINNED in governance (default: sign_d's)
) -> Case:
    origin = origin if origin is not None else f"https://{rp_id}"
    auth_rp_id = auth_rp_id if auth_rp_id is not None else rp_id
    client_origin = client_origin if client_origin is not None else origin

    repo = tmp_path / name
    (repo / "queue" / "approvals").mkdir(parents=True)
    (repo / "ledgers" / "webauthn").mkdir(parents=True)

    if sign_d is None:
        sign_d, sign_pub = _keygen()
    else:
        sign_pub = _pt_mul(sign_d, _G)
    pinned_pub = pin_pub if pin_pub is not None else sign_pub

    credential_id = _b64u(secrets.token_bytes(16))
    _write_cred_file(repo, rp_id, origin, credential_id, pinned_pub)

    wm = _assertion_meta(
        credential_id=credential_id, sign_d=sign_d, rp_id=auth_rp_id, origin=origin,
        up=up, uv=uv, sign_count=sign_count, client_type=client_type,
        client_origin=client_origin, action=action, target=target,
        risk_tier=risk_tier, owner=owner, card_id=card_id, nonce=nonce)
    card_path = _commit_card(repo, action, target, risk_tier, owner, card_id, wm,
                             "record webauthn approval", init=True)
    return Case(repo, card_path, sign_d, credential_id, rp_id, origin)


def _recommit_card_field(case: Case, field: str, value):
    """Swap a canonical field on the card and commit it (simulates an ops push)."""
    card = cards.parse(case.card_path)
    card.meta[field] = value
    cards.save(card, case.repo / "queue")
    _git(case.repo, "add", "-A")
    _git(case.repo, "commit", "-q", "-m", "swap card on ops")


def _committed_store_sha(case: Case) -> str:
    """sha256 of the COMMITTED credential store on HEAD — the value a human sets
    into ``EXPECTED_CRED_STORE_SHA256`` at gate D2.12. Recomputed at call time so
    a test that re-commits the store (repin) gets the post-repin hash."""
    out = subprocess.run(
        ["git", "show", "HEAD:governance/webauthn-credentials.yaml"],
        cwd=case.repo, check=True, capture_output=True).stdout
    return hashlib.sha256(out).hexdigest()


def _verify(case: Case, card_path=None, **kwargs):
    """Drive the verifier with the committed store's sha256 INJECTED by default,
    so the accept path is reachable with the ephemeral fixture store (production
    uses the pinned ``EXPECTED_CRED_STORE_SHA256`` constant, which is the None
    sentinel until gate D2.12). A test overrides ``expected_cred_store_sha256``
    to exercise a wrong-hash or None-sentinel rejection."""
    kwargs.setdefault("expected_cred_store_sha256", _committed_store_sha(case))
    return wv.verify_webauthn_approval(
        card_path or case.card_path, case.repo, **kwargs)


# --------------------------------------------------------------------------- #
# The named adversarial tests.                                                 #
# --------------------------------------------------------------------------- #
def test_valid_assertion_accepts(tmp_path):
    c = _build_repo(tmp_path)
    ok, reason = _verify(c)
    assert ok, reason
    assert reason == "ok"


def test_uv_zero_rejected(tmp_path):
    # UV == 0: no biometric/PIN user-verification. Without this the whole
    # "biometric required" guarantee is unenforced.
    c = _build_repo(tmp_path, uv=0)
    ok, reason = _verify(c)
    assert not ok
    assert "uv" in reason.lower() or "user verification" in reason.lower(), reason


def test_up_zero_rejected(tmp_path):
    c = _build_repo(tmp_path, up=0)
    ok, reason = _verify(c)
    assert not ok
    assert "up" in reason.lower() or "user presence" in reason.lower(), reason


def test_wrong_rpidhash_rejected(tmp_path):
    # rpIdHash bound to a different host than the pinned RP id.
    c = _build_repo(tmp_path, auth_rp_id="evil.attacker.example")
    ok, reason = _verify(c)
    assert not ok
    assert "rpid" in reason.lower() or "rp id" in reason.lower(), reason


def test_non_monotonic_counter_rejected(tmp_path):
    # A first valid assertion (signCount 10) stores the counter; a second
    # assertion on the SAME credential with a regressed signCount (5) and a
    # FRESH nonce must be rejected as a clone/replay.
    c = _build_repo(tmp_path, sign_count=10, nonce="nonce-A",
                    card_id="01BX5ZZKBKACTAV9WEVGEMMVRZ")
    ok, reason = _verify(c)
    assert ok, reason

    wm = _assertion_meta(
        credential_id=c.credential_id, sign_d=c.sign_d, rp_id=c.rp_id, origin=c.origin,
        up=1, uv=1, sign_count=5, client_type="webauthn.get", client_origin=c.origin,
        action="deploy", target="svc-a", risk_tier="T3", owner="claude/m1",
        card_id="01CX5ZZKBKACTAV9WEVGEMMVR2", nonce="nonce-B")
    path2 = _commit_card(c.repo, "deploy", "svc-a", "T3", "claude/m1",
                         "01CX5ZZKBKACTAV9WEVGEMMVR2", wm, "second assertion")
    ok2, reason2 = _verify(c, path2)
    assert not ok2
    assert "counter" in reason2.lower() or "monotonic" in reason2.lower() \
        or "clone" in reason2.lower(), reason2


def test_origin_mismatch_rejected(tmp_path):
    c = _build_repo(tmp_path, client_origin="https://evil.example")
    ok, reason = _verify(c)
    assert not ok
    assert "origin" in reason.lower(), reason


def test_nonce_replay_rejected(tmp_path):
    c = _build_repo(tmp_path)
    ok, reason = _verify(c)
    assert ok, reason
    # Replaying the exact same recorded assertion -> single-use nonce is spent.
    ok2, reason2 = _verify(c)
    assert not ok2
    assert "nonce" in reason2.lower() or "replay" in reason2.lower(), reason2


def test_signature_not_chaining_to_pinned_pubkey_rejected(tmp_path):
    # Sign with attacker key d2 but pin the honest key's public point.
    _, honest_pub = _keygen()
    attacker_d, _ = _keygen()
    c = _build_repo(tmp_path, sign_d=attacker_d, pin_pub=honest_pub)
    ok, reason = _verify(c)
    assert not ok
    assert "signature" in reason.lower(), reason


def test_content_hash_recomputed_and_pinned_to_committed_object(tmp_path):
    # Happy path proves the hash is recomputed from the committed object and the
    # verified card is returned. Then a WORKING-TREE-only swap of a consequential
    # field (no commit) must be rejected: the verifier binds to git show
    # <sha>:<rel>, never the mutable working tree.
    c = _build_repo(tmp_path, risk_tier="T3")
    res = _verify(c)
    assert res.ok, res.reason
    assert res.card is not None
    assert res.card.meta["risk-tier"] == "T3"

    card = cards.parse(c.card_path)
    card.meta["target"] = "prod-db"
    cards.save(card, c.repo / "queue")
    ok2, reason2 = _verify(c)
    assert not ok2
    assert "working tree" in reason2.lower() or "committed" in reason2.lower(), reason2


def test_toctou_ops_swap_rejected(tmp_path):
    # After the assertion is recorded, a replacement card is pushed to ops with a
    # laundered risk-tier. The verifier recomputes content_hash from the committed
    # object being approved; the swapped fields no longer match the signed
    # challenge -> the swap does not take effect.
    c = _build_repo(tmp_path, risk_tier="T2")
    _recommit_card_field(c, "risk-tier", "T3")
    ok, reason = _verify(c)
    assert not ok
    assert ("content" in reason.lower() and "hash" in reason.lower()) \
        or "pinned" in reason.lower() or "challenge" in reason.lower(), reason


# --- fail-closed infrastructure gaps ---------------------------------------- #
def test_missing_credential_store_fails_closed(tmp_path):
    # Delete the WORKING-TREE store (the committed object still exists). With the
    # committed store injected as expected, the worktree-match layer catches the
    # divergence and fails closed.
    c = _build_repo(tmp_path)
    sha = _committed_store_sha(c)  # committed store is still present
    (c.repo / "governance" / "webauthn-credentials.yaml").unlink()
    ok, reason = wv.verify_webauthn_approval(
        c.card_path, c.repo, expected_cred_store_sha256=sha)
    assert not ok


def test_credential_id_not_pinned_fails_closed(tmp_path):
    c = _build_repo(tmp_path)
    _, other_pub = _keygen()
    _write_cred_file(c.repo, c.rp_id, c.origin,
                     _b64u(secrets.token_bytes(16)), other_pub)
    _git(c.repo, "add", "-A")
    _git(c.repo, "commit", "-q", "-m", "repin")
    # Inject the POST-repin committed store sha so the root-of-trust gate passes
    # and the rejection is proven to come from the credential-id-not-pinned check.
    ok, reason = _verify(c)
    assert not ok


# --- BLOCKER-1: the credential store must be anchored, not read from the tree - #
def test_working_tree_credstore_swap_rejected(tmp_path):
    # DEFENSE-IN-DEPTH layer (worktree-match). The honest store is committed and
    # its sha is the pinned root of trust. An attacker with WORKING-TREE write
    # (in the threat model) rewrites governance/webauthn-credentials.yaml with
    # their OWN rp-id/origin/pubkey but does NOT commit it — the copy the executor
    # would read. The verifier must reject: the working tree diverges from the
    # committed object it anchored. (Ports poc_credstore.py's tree-swap variant.)
    c = _build_repo(tmp_path)
    honest_sha = _committed_store_sha(c)
    _, atk_pub = _keygen()
    _write_cred_file(c.repo, "attacker.evil.example",
                     "https://attacker.evil.example",
                     _b64u(secrets.token_bytes(16)), atk_pub)
    ok, reason = wv.verify_webauthn_approval(
        c.card_path, c.repo, expected_cred_store_sha256=honest_sha)
    assert not ok
    assert "working" in reason.lower() and "tree" in reason.lower(), reason


def test_credstore_not_matching_pinned_sha_rejected(tmp_path):
    # ROOT-OF-TRUST layer (the load-bearing anchor, and the core of the PoC).
    # The attacker FULLY controls the store — their rp-id/origin/pubkey, committed
    # AND matching the working tree, signing with their own key — so every other
    # check passes. It still must fail because the committed store does not hash
    # to the in-source pinned sha (which authorizes a DIFFERENT, honest store).
    atk_d, atk_pub = _keygen()
    c = _build_repo(tmp_path, rp_id="attacker.evil.example",
                    origin="https://attacker.evil.example",
                    sign_d=atk_d, pin_pub=atk_pub)
    wrong_sha = hashlib.sha256(b"the-authorized-store-not-this-one").hexdigest()
    ok, reason = wv.verify_webauthn_approval(
        c.card_path, c.repo, expected_cred_store_sha256=wrong_sha)
    assert not ok
    assert "sha256" in reason.lower() or "root of trust" in reason.lower(), reason
    # Proof the sha pin is the ONLY thing stopping it: injecting the attacker
    # store's own sha (i.e. had the human wrongly pinned it) would accept.
    ok2, _ = wv.verify_webauthn_approval(
        c.card_path, c.repo, expected_cred_store_sha256=_committed_store_sha(c))
    assert ok2


def test_credstore_sentinel_none_rejects_all(tmp_path):
    # SENTINEL: no passkey registered yet (EXPECTED_CRED_STORE_SHA256 is None) →
    # every webauthn approval, even a perfectly-formed one, fails closed.
    c = _build_repo(tmp_path)
    ok, reason = wv.verify_webauthn_approval(
        c.card_path, c.repo, expected_cred_store_sha256=None)
    assert not ok
    assert "no passkey" in reason.lower() or "sentinel" in reason.lower(), reason
    # While the module constant is still the sentinel, the default path matches.
    if wv.EXPECTED_CRED_STORE_SHA256 is None:
        ok2, _ = wv.verify_webauthn_approval(c.card_path, c.repo)
        assert not ok2


# --- crypto edge cases the adversarial review flagged as missing -------------- #
def test_signature_r_s_out_of_range_rejected():
    # ECDSA requires 1 <= r,s < n. Degenerate r/s (0 or >= n) must never verify,
    # even when the DER is structurally well-formed.
    _, pub = _keygen()
    msg = b"authenticatorData||H(clientDataJSON)"
    for r, s in [(0, 1), (1, 0), (_N, 1), (1, _N)]:
        assert wv._es256_verify(pub, msg, _der(r, s)) is False


def test_malformed_der_signature_rejected():
    # The strict DER parser must fail closed on every structural defect.
    _, pub = _keygen()
    msg = b"m"
    malformed = [
        b"\x02\x01\x01",                          # not a SEQUENCE
        b"\x30\x81\x04\x02\x01\x01\x02\x01\x01",  # long-form length (banned)
        _der(1, 1) + b"\x00",                     # trailing bytes after s
        b"\x30\x03\x02\x01\x01",                  # sequence length mismatch
        b"\x30",                                  # too short
        b"",                                      # empty
    ]
    for sig in malformed:
        assert wv._es256_verify(pub, msg, sig) is False


def test_off_curve_pinned_key_rejected():
    # A pinned public key that is NOT on the P-256 curve (or the point at
    # infinity) must never verify — otherwise curve-invalidity attacks apply.
    assert wv._on_curve((1, 1)) is False
    valid_der = _der(12345, 67890)
    assert wv._es256_verify((1, 1), b"m", valid_der) is False
    assert wv._es256_verify(None, b"m", valid_der) is False
