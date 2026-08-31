"""kb_node_proxy unit tests — every §3.3 clause of the attested node-identity hop as its own test."""
import json

import pytest

from deploy import kb_node_proxy as proxy


# --- header handling: strip every inbound Tailscale-* AND X-Forwarded-* before any work ---------

def test_strips_every_tailscale_and_x_forwarded_header_case_insensitively():
    inbound = [
        ("Host", "kb.command.ts.net"),
        ("Tailscale-User-Login", "attacker@evil.example"),
        ("Tailscale-User-Name", "Mallory"),
        ("Tailscale-Node-ID", "forgedNODE"),
        ("X-Forwarded-For", "100.64.0.9"),
        ("x-forwarded-proto", "https"),
        ("Accept", "application/json"),
    ]
    stripped = proxy.strip_client_identity_headers(inbound)
    names = {name.lower() for name, _ in stripped}
    assert names == {"host", "accept"}
    assert not any(n.lower().startswith(("tailscale-", "x-forwarded-")) for n, _ in stripped)


def test_injects_exactly_one_node_id_header_and_no_user_header():
    inbound = [("Tailscale-User-Login", "x@y"), ("X-Forwarded-For", "1.2.3.4"), ("Accept", "*/*")]
    out = proxy.inject_node_identity(inbound, "nodeVM01")
    node_headers = [(n, v) for n, v in out if n.lower() == "tailscale-node-id"]
    assert node_headers == [("Tailscale-Node-ID", "nodeVM01")]
    # It mints NO user identity at all — structurally incapable of forging the operator subject.
    assert not any(n.lower().startswith("tailscale-user") for n, _ in out)
    assert not any(n.lower().startswith("x-forwarded-") for n, _ in out)


def test_a_malformed_node_id_from_whois_is_a_fail_closed_refusal_not_an_injected_guess():
    for bad in ("bad id!", "", "abc", "x" * 40):
        with pytest.raises(proxy.AttributionUnavailable):
            proxy.inject_node_identity([("Accept", "*/*")], bad)


# --- upstream peer-uid proof: full 4-tuple /proc match, fail closed on ambiguity ---------------

DASH_PORT = 4319
PEER_PORT = 0xCF32


def _proc_table(uid, peer_addr="0100007F", dash_addr="0100007F"):
    return (
        "  sl  local_address rem_address   st ... uid\n"
        f"   6: {dash_addr}:{DASH_PORT:04X} {peer_addr}:{PEER_PORT:04X} 01 x x x   999 0 1 1 0\n"
        f"   8: {peer_addr}:{PEER_PORT:04X} {dash_addr}:{DASH_PORT:04X} 01 x x x   {uid} 0 2 1 0\n"
    )


def test_proves_upstream_root_peer_uid_zero():
    tables = [_proc_table(0)]
    proxy.prove_upstream_is_root("127.0.0.1", DASH_PORT, "127.0.0.1", PEER_PORT, tables)  # no raise


def test_refuses_a_non_root_upstream_peer():
    with pytest.raises(proxy.UntrustedUpstream):
        proxy.prove_upstream_is_root("127.0.0.1", DASH_PORT, "127.0.0.1", PEER_PORT, [_proc_table(999)])


def test_fails_closed_when_no_row_matches_the_four_tuple():
    with pytest.raises(proxy.UntrustedUpstream):
        proxy.prove_upstream_is_root("127.0.0.1", DASH_PORT, "127.0.0.1", 0x1234, [_proc_table(0)])


def test_fails_closed_on_an_ambiguous_two_owner_match():
    # Two ESTABLISHED rows with the identical 4-tuple but different uids: deny rather than guess.
    ambiguous = (
        "  sl  local rem st ... uid\n"
        f"   8: 0100007F:{PEER_PORT:04X} 0100007F:{DASH_PORT:04X} 01 x x x   0 0 1 1 0\n"
        f"   9: 0100007F:{PEER_PORT:04X} 0100007F:{DASH_PORT:04X} 01 x x x   999 0 2 1 0\n"
    )
    assert proxy.find_peer_uid("127.0.0.1", DASH_PORT, "127.0.0.1", PEER_PORT, [ambiguous]) is None


def test_source_address_spoof_selects_only_the_attacker_row():
    # Attacker binds 127.0.0.2 on the same source port a genuine root connection uses; the full-4-tuple
    # match against the accepted connection's real 127.0.0.2 remote selects only the attacker's uid.
    spoof = (
        "  sl  local rem st ... uid\n"
        f"   6: 0100007F:{DASH_PORT:04X} 0200007F:{PEER_PORT:04X} 01 x x x   999 0 1 1 0\n"
        f"   7: 0200007F:{PEER_PORT:04X} 0100007F:{DASH_PORT:04X} 01 x x x   999 0 2 1 0\n"
        f"   8: 0100007F:{PEER_PORT:04X} 0100007F:{DASH_PORT:04X} 01 x x x   0 0 3 1 0\n"
    )
    assert proxy.find_peer_uid("127.0.0.1", DASH_PORT, "127.0.0.2", PEER_PORT, [spoof]) == 999


# --- WhoIs client: reachable => node id; unreachable/error => AttributionUnavailable ------------

class _FakeConn:
    def __init__(self, reply: bytes, raise_on=None):
        self._reply = reply
        self._raise = raise_on
        self.sent = b""
    def settimeout(self, _): pass
    def sendall(self, data):
        if self._raise == "send":
            raise OSError("broken pipe")
        self.sent += data
    def recv(self, n):
        chunk, self._reply = self._reply[:n], self._reply[n:]
        return chunk
    def close(self): pass


def test_whois_returns_the_node_id_on_a_good_reply():
    conn = _FakeConn(b'{"node":"nodeVM01","login":"x@y","tags":[]}\n')
    assert proxy.whois("100.64.0.9", 41234, "/run/kb-whois/whois.sock", connect=lambda: conn) == "nodeVM01"


def test_whois_refuses_when_the_shim_is_unreachable():
    def connect():
        raise OSError("connection refused")
    with pytest.raises(proxy.AttributionUnavailable):
        proxy.whois("100.64.0.9", 41234, "/run/kb-whois/whois.sock", connect=connect)


@pytest.mark.parametrize("reply", [
    b'{"error":"tailscaled-unreachable"}\n',
    b'{"login":"x@y"}\n',            # no node
    b'not json\n',
    b'{"node":"bad id!"}\n',          # malformed node id
])
def test_whois_refuses_on_any_error_or_malformed_reply(reply):
    with pytest.raises(proxy.AttributionUnavailable):
        proxy.whois("100.64.0.9", 41234, "/run/kb-whois/whois.sock", connect=lambda: _FakeConn(reply))
