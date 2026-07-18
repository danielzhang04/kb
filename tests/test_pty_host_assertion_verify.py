"""D3.1 (MED mitigation) — M2: adversarial suite for the HOST-side PTY-open assertion verifier.

This is the Factor C trust boundary of the cross-user PTY-host channel: a forged browser assertion that
slips past ``verify_pty_assertion`` opens a fleet PTY. Every test is written to FAIL CLOSED — the happy
path is a single test; the rest prove specific forgeries are rejected.

Design note — INDEPENDENT crypto on the test side (mirrors tests/test_webauthn_verify.py). The fixtures
carry a self-contained pure-python NIST P-256 keygen + signer sharing NO code with the verifier under
test, so a shared implementation bug cannot make a forged assertion verify.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import subprocess
from collections import namedtuple
from pathlib import Path

import pty_host_assertion_verify as pv
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


def _inv(a, m):
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


def _pt_mul(k, point):
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


def _sign(d, message):
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


def _der_int(v):
    b = v.to_bytes((v.bit_length() + 7) // 8 or 1, "big")
    if b[0] & 0x80:
        b = b"\x00" + b
    return b"\x02" + bytes([len(b)]) + b


def _der(r, s):
    body = _der_int(r) + _der_int(s)
    return b"\x30" + bytes([len(body)]) + body


# --------------------------------------------------------------------------- #
# Fixture helpers                                                              #
# --------------------------------------------------------------------------- #
def _b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _pty_challenge(nonce_bytes) -> str:
    """INDEPENDENT mirror of the TS ``buildPtyChallenge`` — base64url(JSON(["kb-pty-open", b64url(nonce)]))."""
    nb = _b64u(nonce_bytes)
    pre = json.dumps(["kb-pty-open", nb], separators=(",", ":"), ensure_ascii=False)
    return _b64u(pre.encode("utf-8"))


def _auth_data(rp_id, up, uv, sign_count):
    flags = (0x01 if up else 0) | (0x04 if uv else 0)
    return (hashlib.sha256(rp_id.encode("utf-8")).digest()
            + bytes([flags]) + sign_count.to_bytes(4, "big"))


def _assertion(*, sign_d, rp_id, origin, challenge, up=1, uv=1, sign_count=1,
               client_type="webauthn.get", client_origin=None):
    client_origin = origin if client_origin is None else client_origin
    client_data = json.dumps(
        {"type": client_type, "challenge": challenge, "origin": client_origin},
        separators=(",", ":")).encode("utf-8")
    auth_data = _auth_data(rp_id, up, uv, sign_count)
    signature = _sign(sign_d, auth_data + hashlib.sha256(client_data).digest())
    return {
        "authenticator_data": _b64u(auth_data),
        "client_data_json": _b64u(client_data),
        "signature": _b64u(signature),
    }


def _git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def _write_cred_file(repo, rp_id, origin, credential_id, pub, alg=-7):
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


Case = namedtuple("Case", "repo sign_d credential_id rp_id origin nonce challenge")


def _build_case(tmp_path, name="repo", *, rp_id="dash.tailnet-abc.ts.net", origin=None,
                sign_d=None, pin_pub=None, nonce=None):
    origin = origin if origin is not None else f"https://{rp_id}"
    repo = tmp_path / name
    (repo / "governance").mkdir(parents=True)

    if sign_d is None:
        sign_d, sign_pub = _keygen()
    else:
        sign_pub = _pt_mul(sign_d, _G)
    pinned_pub = pin_pub if pin_pub is not None else sign_pub

    credential_id = _b64u(secrets.token_bytes(16))
    _write_cred_file(repo, rp_id, origin, credential_id, pinned_pub)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.name", "Test")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "core.autocrlf", "false")
    _git(repo, "config", "commit.gpgsign", "false")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "pin credential store")

    nonce = nonce if nonce is not None else secrets.token_bytes(32)
    challenge = _pty_challenge(nonce)
    return Case(repo, sign_d, credential_id, rp_id, origin, nonce, challenge)


def _committed_store_sha(case):
    out = subprocess.run(
        ["git", "show", "HEAD:governance/webauthn-credentials.yaml"],
        cwd=case.repo, check=True, capture_output=True).stdout
    return hashlib.sha256(out).hexdigest()


_UNSET = object()


def _verify(case, assertion, *, challenge=None, credential_id=None, sha=_UNSET, **kwargs):
    kwargs.setdefault("expected_cred_store_sha256",
                      _committed_store_sha(case) if sha is _UNSET else sha)
    return pv.verify_pty_assertion(
        challenge if challenge is not None else case.challenge,
        credential_id if credential_id is not None else case.credential_id,
        assertion["authenticator_data"], assertion["client_data_json"],
        assertion["signature"], case.repo, **kwargs)


def _good_assertion(case, **over):
    return _assertion(sign_d=case.sign_d, rp_id=case.rp_id, origin=case.origin,
                      challenge=case.challenge, **over)


# --------------------------------------------------------------------------- #
# The named adversarial tests.                                                 #
# --------------------------------------------------------------------------- #
def test_valid_assertion_accepts(tmp_path):
    c = _build_case(tmp_path)
    ok, reason = _verify(c, _good_assertion(c))
    assert ok, reason
    assert reason == "ok"


def test_replayed_nonce_rejected(tmp_path):
    # An assertion signed over connection A's nonce, presented against connection B's fresh nonce.
    c = _build_case(tmp_path)
    other_nonce = secrets.token_bytes(32)
    other_challenge = _pty_challenge(other_nonce)
    # The browser signed the OLD challenge; the host now expects a DIFFERENT one.
    a = _good_assertion(c)  # signed over c.challenge
    ok, reason = _verify(c, a, challenge=other_challenge)
    assert not ok
    assert "host-issued nonce" in reason.lower() or "replay" in reason.lower(), reason


def test_wrong_nonce_in_signed_challenge_rejected(tmp_path):
    # The signed challenge embeds a different nonce than the host issued.
    c = _build_case(tmp_path)
    forged_challenge = _pty_challenge(secrets.token_bytes(32))
    a = _assertion(sign_d=c.sign_d, rp_id=c.rp_id, origin=c.origin, challenge=forged_challenge)
    ok, reason = _verify(c, a)  # host expects c.challenge
    assert not ok
    assert "nonce" in reason.lower() or "replay" in reason.lower(), reason


def test_up_zero_rejected(tmp_path):
    c = _build_case(tmp_path)
    ok, reason = _verify(c, _good_assertion(c, up=0))
    assert not ok
    assert "up" in reason.lower() or "user presence" in reason.lower(), reason


def test_uv_zero_rejected(tmp_path):
    c = _build_case(tmp_path)
    ok, reason = _verify(c, _good_assertion(c, uv=0))
    assert not ok
    assert "uv" in reason.lower() or "user verification" in reason.lower(), reason


def test_wrong_rpidhash_rejected(tmp_path):
    c = _build_case(tmp_path)
    a = _assertion(sign_d=c.sign_d, rp_id="evil.attacker.example", origin=c.origin,
                   challenge=c.challenge)
    ok, reason = _verify(c, a)
    assert not ok
    assert "rpid" in reason.lower() or "rp id" in reason.lower(), reason


def test_origin_mismatch_rejected(tmp_path):
    c = _build_case(tmp_path)
    ok, reason = _verify(c, _good_assertion(c, client_origin="https://evil.example"))
    assert not ok
    assert "origin" in reason.lower(), reason


def test_client_type_not_get_rejected(tmp_path):
    c = _build_case(tmp_path)
    ok, reason = _verify(c, _good_assertion(c, client_type="webauthn.create"))
    assert not ok
    assert "type" in reason.lower() or "webauthn.get" in reason.lower(), reason


def test_unknown_credential_id_rejected(tmp_path):
    c = _build_case(tmp_path)
    ok, reason = _verify(c, _good_assertion(c), credential_id=_b64u(secrets.token_bytes(16)))
    assert not ok
    assert "credential-id" in reason.lower() or "pinned" in reason.lower(), reason


def test_bad_signature_rejected(tmp_path):
    # Sign with an attacker key; pin the honest public key.
    _, honest_pub = _keygen()
    attacker_d, _ = _keygen()
    c = _build_case(tmp_path, sign_d=attacker_d, pin_pub=honest_pub)
    ok, reason = _verify(c, _good_assertion(c))
    assert not ok
    assert "signature" in reason.lower(), reason


def test_non_monotonic_counter_rejected(tmp_path):
    # First assertion (signCount 10) stores the counter; a second with a regressed signCount (5) over a
    # FRESH nonce must be rejected as a clone.
    c = _build_case(tmp_path)
    ok, reason = _verify(c, _good_assertion(c, sign_count=10))
    assert ok, reason
    fresh = _pty_challenge(secrets.token_bytes(32))
    a2 = _assertion(sign_d=c.sign_d, rp_id=c.rp_id, origin=c.origin, challenge=fresh, sign_count=5)
    ok2, reason2 = _verify(c, a2, challenge=fresh)
    assert not ok2
    assert "counter" in reason2.lower() or "monotonic" in reason2.lower() or "clone" in reason2.lower(), reason2


def test_credstore_not_matching_pinned_sha_rejected(tmp_path):
    # ROOT-OF-TRUST layer: the attacker fully controls the committed store (their rp/origin/pubkey), so
    # every other check passes; it still fails because the store does not hash to the injected pin.
    atk_d, atk_pub = _keygen()
    c = _build_case(tmp_path, rp_id="attacker.evil.example",
                    origin="https://attacker.evil.example", sign_d=atk_d, pin_pub=atk_pub)
    wrong_sha = hashlib.sha256(b"the-authorized-store-not-this-one").hexdigest()
    ok, reason = _verify(c, _good_assertion(c), sha=wrong_sha)
    assert not ok
    assert "sha256" in reason.lower() or "root of trust" in reason.lower(), reason
    # Proof the sha pin is the only thing stopping it: the store's own sha would accept.
    ok2, _ = _verify(c, _good_assertion(c, sign_count=2))
    assert ok2


def test_credstore_sentinel_none_rejects_all(tmp_path):
    c = _build_case(tmp_path)
    ok, reason = _verify(c, _good_assertion(c), sha=None)
    assert not ok
    assert "no passkey" in reason.lower() or "sentinel" in reason.lower(), reason


def test_working_tree_credstore_swap_rejected(tmp_path):
    # DEFENSE-IN-DEPTH (worktree-match): the honest store is committed + pinned; an attacker rewrites the
    # WORKING-TREE copy but does not commit it. Rejected: the tree diverges from the anchored object.
    c = _build_case(tmp_path)
    honest_sha = _committed_store_sha(c)
    _, atk_pub = _keygen()
    _write_cred_file(c.repo, "attacker.evil.example", "https://attacker.evil.example",
                     _b64u(secrets.token_bytes(16)), atk_pub)
    ok, reason = _verify(c, _good_assertion(c), sha=honest_sha)
    assert not ok
    assert "working" in reason.lower() and "tree" in reason.lower(), reason


# --- malformed inputs: every one fails closed, boundary never raises to accept --------------- #
def test_malformed_base64url_fields_fail_closed(tmp_path):
    c = _build_case(tmp_path)
    for bad in [
        {"authenticator_data": "!!!", "client_data_json": _good_assertion(c)["client_data_json"],
         "signature": _good_assertion(c)["signature"]},
    ]:
        ok, reason = _verify(c, bad)
        assert not ok


def test_short_authenticator_data_fails_closed(tmp_path):
    c = _build_case(tmp_path)
    a = _good_assertion(c)
    a["authenticator_data"] = _b64u(b"\x00\x01\x02")  # < 37 bytes
    ok, reason = _verify(c, a)
    assert not ok
    assert "authenticatordata" in reason.lower() or "too short" in reason.lower(), reason


def test_non_json_client_data_fails_closed(tmp_path):
    c = _build_case(tmp_path)
    a = _good_assertion(c)
    a["client_data_json"] = _b64u(b"not json at all")
    ok, reason = _verify(c, a)
    assert not ok


def test_client_data_without_challenge_fails_closed(tmp_path):
    c = _build_case(tmp_path)
    client_data = json.dumps({"type": "webauthn.get", "origin": c.origin},
                             separators=(",", ":")).encode()
    auth_data = _auth_data(c.rp_id, 1, 1, 1)
    sig = _sign(c.sign_d, auth_data + hashlib.sha256(client_data).digest())
    a = {"authenticator_data": _b64u(auth_data), "client_data_json": _b64u(client_data),
         "signature": _b64u(sig)}
    ok, reason = _verify(c, a)
    assert not ok


def test_boundary_never_raises_to_accept_on_garbage(tmp_path):
    c = _build_case(tmp_path)
    # None / non-string inputs must be a rejection, never an exception escaping to the caller.
    ok, reason = pv.verify_pty_assertion(None, None, None, None, None, str(c.repo),
                                         expected_cred_store_sha256=_committed_store_sha(c))
    assert ok is False and isinstance(reason, str)


# --- DOMAIN SEPARATION -------------------------------------------------------------------- #
def test_card_four_tuple_challenge_rejected(tmp_path):
    # A card-approval 4-tuple challenge presented as the host expected_challenge is rejected outright.
    c = _build_case(tmp_path)
    card_challenge = _b64u(json.dumps(
        ["01ARZ3NDEKTSV4RRFFQ69G5FAV", "deploy", "a" * 64, "nonce-0"],
        separators=(",", ":")).encode())
    a = _assertion(sign_d=c.sign_d, rp_id=c.rp_id, origin=c.origin, challenge=card_challenge)
    ok, reason = _verify(c, a, challenge=card_challenge)
    assert not ok
    assert "domain separation" in reason.lower() or "kb-pty-open" in reason.lower(), reason


def test_pty_two_tuple_rejected_by_card_verifier_parse():
    # The other half of domain separation: the frozen card parser rejects the PTY 2-tuple.
    pty = _pty_challenge(b"abc")
    try:
        wv.parse_challenge(pty)
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_parse_pty_challenge_matches_ts_pin():
    # CROSS-LANGUAGE PIN: byte-identical to the TS buildPtyChallenge (see ptyChallenge.test.ts). A
    # mismatch would reject a legitimate touch.
    challenge = _pty_challenge(b"test-nonce")
    assert challenge == "WyJrYi1wdHktb3BlbiIsImRHVnpkQzF1YjI1alpRIl0"
    assert pv.parse_pty_challenge(challenge) == _b64u(b"test-nonce")


# --- STDIN entry point -------------------------------------------------------------------- #
def test_main_stdin_accepts_valid(tmp_path, capsys, monkeypatch):
    import io
    c = _build_case(tmp_path)
    a = _good_assertion(c)
    payload = {
        "expectedChallenge": c.challenge, "credentialId": c.credential_id,
        "authenticatorData": a["authenticator_data"], "clientDataJSON": a["client_data_json"],
        "signature": a["signature"], "repoRoot": str(c.repo),
    }
    # Inject the ephemeral store sha via the module constant so the accept path is reachable.
    monkeypatch.setattr(wv, "EXPECTED_CRED_STORE_SHA256", _committed_store_sha(c))
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    rc = pv._main()
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert rc == 0 and out["ok"] is True, out


def test_main_stdin_unparseable_fails_closed(capsys, monkeypatch):
    import io
    monkeypatch.setattr("sys.stdin", io.StringIO("not json"))
    rc = pv._main()
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert rc == 1 and out["ok"] is False


def test_main_stdin_missing_field_fails_closed(capsys, monkeypatch):
    import io
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"expectedChallenge": "x"})))
    rc = pv._main()
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert rc == 1 and out["ok"] is False
