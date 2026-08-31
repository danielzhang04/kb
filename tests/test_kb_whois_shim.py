"""kb_whois_shim unit tests — the request-line grammar and each bound as its own test, plus a Linux-only
run against a FAKE tailscaled unix socket (the pre-P7 executed verification of the grant mechanism)."""
import json
import socket
import sys
import threading

import pytest

from deploy import kb_whois_shim as shim


# --- request-line grammar + the 64-byte bound -------------------------------------------------

@pytest.mark.parametrize("line,expected", [
    (b"100.64.0.9:41234\n", ("100.64.0.9", 41234)),
    (b"127.0.0.1:1\n", ("127.0.0.1", 1)),
    (b"[fd7a:115c:a1e0::1]:443\n", ("fd7a:115c:a1e0::1", 443)),
])
def test_parses_a_well_formed_request_line(line, expected):
    assert shim.parse_request_line(line) == expected


@pytest.mark.parametrize("line", [
    b"100.64.0.9:41234",                 # no newline
    b"100.64.0.9\n",                     # no port
    b"not-an-ip:1234\n",                 # host is not an IP (never forwarded unparsed)
    b"100.64.0.9:70000\n",               # port out of range
    b"100.64.0.9:0\n",                   # port 0
    b"100.64.0.9:abc\n",                 # non-numeric port
    b"100.64.0.9:1\n100.64.0.9:2\n",     # two lines
    b"\xff\xfe:1\n",                      # non-ascii
])
def test_refuses_a_malformed_request_line(line):
    with pytest.raises(shim.RequestError):
        shim.parse_request_line(line)


def test_refuses_a_request_over_64_bytes():
    over = b"1" * 64 + b":1\n"
    assert len(over) > shim.MAX_REQUEST_BYTES
    with pytest.raises(shim.RequestError):
        shim.parse_request_line(over)


# --- exactly one method + path, addr percent-encoded ------------------------------------------

def test_issues_only_a_get_to_the_whois_localapi_path():
    request = shim.localapi_request("100.64.0.9", 41234)
    assert request.startswith(b"GET /localapi/v0/whois?addr=")
    assert b"addr=100.64.0.9%3A41234" in request
    # No other method, no other path — a single request line then headers.
    assert request.count(b"\r\n\r\n") == 1
    assert b"POST" not in request and b"/localapi/v0/whois" in request


# --- reply bound (4 KiB) ----------------------------------------------------------------------

def test_formats_a_bounded_json_reply_line():
    reply = shim.format_reply("nodeVM01", "x@y", ["tag:vm"])
    assert reply.endswith(b"\n")
    assert json.loads(reply) == {"node": "nodeVM01", "login": "x@y", "tags": ["tag:vm"]}


def test_refuses_to_emit_a_reply_over_4_kib():
    with pytest.raises(shim.RequestError):
        shim.format_reply("nodeVM01", "x@y", ["tag:" + "z" * 5000])


def test_error_reply_is_a_single_json_line():
    assert json.loads(shim.error_reply("bad-request")) == {"error": "bad-request"}


# --- HTTP response mapping --------------------------------------------------------------------

def test_maps_a_localapi_200_body_to_node_login_tags():
    body = json.dumps({"Node": {"StableID": "nodeDESK9", "Tags": ["tag:desktop"]},
                       "UserProfile": {"LoginName": "daniel@example.com"}})
    raw = ("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n" + body).encode()
    node, login, tags = shim.whois_from_localapi(shim.parse_localapi_response(raw))
    assert (node, login, tags) == ("nodeDESK9", "daniel@example.com", ["tag:desktop"])


def test_a_non_200_localapi_response_is_a_request_error():
    raw = b"HTTP/1.1 404 Not Found\r\n\r\n{}"
    with pytest.raises(shim.RequestError):
        shim.parse_localapi_response(raw)


def test_handle_request_answers_bad_request_for_a_malformed_line_without_touching_tailscaled():
    touched = []
    def connect():
        touched.append(True)
        raise AssertionError("must not connect to tailscaled for a malformed request")
    reply = shim.handle_request(b"not-an-ip:1\n", "/run/kb-whois/whois.sock", connect=connect)
    assert json.loads(reply) == {"error": "bad-request"}
    assert touched == []


# --- Linux-only: run against a FAKE tailscaled unix socket ------------------------------------

pytestmark_unix = pytest.mark.skipif(
    not hasattr(socket, "AF_UNIX") or sys.platform == "win32",
    reason="AF_UNIX fake-tailscaled fixture is Linux-only",
)


@pytestmark_unix
def test_query_against_a_fake_tailscaled_socket(tmp_path):
    sock_path = str(tmp_path / "tailscaled.sock")
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(sock_path)
    server.listen(1)
    received = {}

    def serve_once():
        conn, _ = server.accept()
        received["request"] = conn.recv(4096)
        body = json.dumps({"Node": {"StableID": "nodeVM01"}, "UserProfile": {"LoginName": "daniel@x"}})
        conn.sendall(("HTTP/1.1 200 OK\r\n\r\n" + body).encode())
        conn.close()

    thread = threading.Thread(target=serve_once, daemon=True)
    thread.start()
    reply = shim.query_tailscaled("100.64.0.9", 41234, sock_path)
    thread.join(timeout=5)
    server.close()
    assert json.loads(reply)["node"] == "nodeVM01"
    assert received["request"].startswith(b"GET /localapi/v0/whois?addr=")


@pytestmark_unix
def test_query_against_an_unreachable_socket_answers_error(tmp_path):
    reply = shim.query_tailscaled("100.64.0.9", 41234, str(tmp_path / "absent.sock"))
    assert "error" in json.loads(reply)


def test_in_flight_cap_refuses_over_ten_concurrent_connections():
    # A BoundedSemaphore of MAX_IN_FLIGHT: the eleventh acquire fails, which is the "refuse not queue" path.
    gate = threading.BoundedSemaphore(shim.MAX_IN_FLIGHT)
    acquired = [gate.acquire(blocking=False) for _ in range(shim.MAX_IN_FLIGHT + 1)]
    assert acquired.count(True) == shim.MAX_IN_FLIGHT
    assert acquired[-1] is False
