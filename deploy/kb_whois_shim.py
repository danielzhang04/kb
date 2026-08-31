#!/usr/bin/env python3
"""kb WhoIs shim - the root-owned LocalAPI WhoIs grant for kb-node-proxy (dashboard-v3 P6 section 3.3 [P6-C47]).

kb-node-proxy holds NO tailnet rights at all (no operator pref, no group, nologin). Instead this shim runs
as root behind `kb-whois.socket` and answers exactly one question over a tightly bounded line protocol:

  request:  one line `<ip>:<port>\\n`, at most 64 bytes; `<ip>` must PARSE as an IP address, so a
            client-supplied string is never forwarded unparsed.
  reply:    one line of JSON, at most 4 KiB, either {"node","login","tags"} or {"error"}.
  deadline: 1 second per request; at most 10 connections in flight - further connections are refused
            (closed immediately), never queued.

It calls tailscaled's LocalAPI with ONLY `GET /localapi/v0/whois?addr=` - no other path, no other method.

The module is import-safe and side-effect-free; only `main()`/`serve()` open sockets.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import socket
import threading
import urllib.parse

MAX_REQUEST_BYTES = 64
MAX_REPLY_BYTES = 4096
REQUEST_DEADLINE = 1.0
MAX_IN_FLIGHT = 10
LOCALAPI_PATH = "/localapi/v0/whois"
# The node id grammar the proxy will accept back; matches auth/hostNodeMapContracts.ts NODE_ID.
NODE_ID = re.compile(r"^[A-Za-z0-9]{5,32}$")


class RequestError(Exception):
    """A malformed or over-bound request line: answered with an {"error"} reply, never forwarded."""


# --- request-line grammar ----------------------------------------------------------------------

def parse_request_line(data: bytes) -> tuple[str, int]:
    """Parse the one bounded request line `<ip>:<port>\\n` into a validated (ip, port). Raises RequestError
    on any over-bound, non-ascii, malformed, or non-IP input - the shim never forwards an unparsed string."""
    if len(data) > MAX_REQUEST_BYTES:
        raise RequestError("request exceeds 64 bytes")
    if not data.endswith(b"\n"):
        raise RequestError("request must be one newline-terminated line")
    try:
        line = data[:-1].decode("ascii")
    except UnicodeDecodeError as error:
        raise RequestError("request must be ascii") from error
    if "\n" in line:
        raise RequestError("request must be a single line")
    host, sep, port_text = line.rpartition(":")
    if not sep or not host or not re.fullmatch(r"[0-9]{1,5}", port_text):
        raise RequestError("request must be <ip>:<port>")
    port = int(port_text)
    if not 1 <= port <= 65535:
        raise RequestError("port out of range")
    host = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    try:
        ipaddress.ip_address(host)  # the whole point: a non-IP is rejected, never forwarded
    except ValueError as error:
        raise RequestError("host is not an IP address") from error
    return host, port


# --- LocalAPI request (exactly one method + path) ----------------------------------------------

def localapi_request(ip: str, port: int) -> bytes:
    """Build the ONLY request this shim ever issues: `GET /localapi/v0/whois?addr=<ip>:<port>`."""
    addr = f"{ip}:{port}"
    query = urllib.parse.urlencode({"addr": addr})
    return (
        f"GET {LOCALAPI_PATH}?{query} HTTP/1.1\r\n"
        "Host: local-tailscaled.sock\r\n"
        "Connection: close\r\n\r\n"
    ).encode("ascii")


def parse_localapi_response(raw: bytes) -> dict:
    """Extract the JSON body from tailscaled's HTTP/1.1 response, or raise RequestError."""
    head, sep, body = raw.partition(b"\r\n\r\n")
    if not sep:
        raise RequestError("no HTTP body from tailscaled")
    status_line = head.split(b"\r\n", 1)[0].decode("latin-1")
    if " 200 " not in f" {status_line} ":
        raise RequestError(f"tailscaled whois returned: {status_line}")
    try:
        return json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise RequestError("tailscaled whois body is not JSON") from error


def whois_from_localapi(response: dict) -> tuple[str, str, list[str]]:
    """Map tailscaled's WhoIs JSON to (node, login, tags). Raises RequestError on a shape we cannot trust."""
    node_obj = response.get("Node") or {}
    node = node_obj.get("StableID") or node_obj.get("ComputedName") or ""
    if not isinstance(node, str) or not NODE_ID.match(node):
        # Fall back to the numeric node id rendered as an alphanumeric token if it fits the grammar.
        raise RequestError("tailscaled whois returned no usable stable node id")
    profile = response.get("UserProfile") or {}
    login = profile.get("LoginName") or ""
    tags = node_obj.get("Tags") or []
    if not isinstance(tags, list):
        tags = []
    return node, (login if isinstance(login, str) else ""), [t for t in tags if isinstance(t, str)]


# --- reply formatting --------------------------------------------------------------------------

def format_reply(node: str, login: str, tags: list[str]) -> bytes:
    payload = json.dumps({"node": node, "login": login, "tags": tags}, separators=(",", ":"))
    encoded = (payload + "\n").encode("utf-8")
    if len(encoded) > MAX_REPLY_BYTES:
        raise RequestError("reply exceeds 4 KiB")
    return encoded


def error_reply(message: str = "whois-unavailable") -> bytes:
    return (json.dumps({"error": message}, separators=(",", ":")) + "\n").encode("utf-8")


# --- the query, end to end (testable against a fake tailscaled socket) -------------------------

def query_tailscaled(ip: str, port: int, tailscaled_socket: str, deadline: float = REQUEST_DEADLINE,
                     connect=None) -> bytes:
    """Issue the one LocalAPI call and return the framed reply line. Any failure yields an {"error"} line -
    the shim answers, but never leaks a stack or forwards an unattributed request."""
    try:
        conn = connect() if connect is not None else _connect_unix(tailscaled_socket, deadline)
    except OSError:
        return error_reply("tailscaled-unreachable")
    try:
        conn.settimeout(deadline)
        conn.sendall(localapi_request(ip, port))
        raw = _read_all(conn, limit=1 << 16)
    except (OSError, TimeoutError):
        return error_reply("tailscaled-timeout")
    finally:
        try:
            conn.close()
        except OSError:
            pass
    try:
        node, login, tags = whois_from_localapi(parse_localapi_response(raw))
        return format_reply(node, login, tags)
    except RequestError:
        return error_reply("whois-failed")


def handle_request(data: bytes, tailscaled_socket: str, deadline: float = REQUEST_DEADLINE,
                   connect=None) -> bytes:
    """Parse one bounded request line and produce the one bounded reply line."""
    try:
        ip, port = parse_request_line(data)
    except RequestError:
        return error_reply("bad-request")
    return query_tailscaled(ip, port, tailscaled_socket, deadline, connect=connect)


def _connect_unix(path: str, deadline: float):
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(deadline)
    conn.connect(path)
    return conn


def _read_all(conn, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while total < limit:
        chunk = conn.recv(min(4096, limit - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
    return b"".join(chunks)


def _read_request(conn) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while total <= MAX_REQUEST_BYTES:
        chunk = conn.recv(min(64, MAX_REQUEST_BYTES + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if b"\n" in chunk:
            break
    return b"".join(chunks)


def serve(listen_socket, tailscaled_socket: str, in_flight: threading.Semaphore | None = None,
          deadline: float = REQUEST_DEADLINE) -> None:  # pragma: no cover - runtime loop
    """Accept connections, capping at MAX_IN_FLIGHT concurrent handlers; refuse (close) over the cap."""
    gate = in_flight or threading.BoundedSemaphore(MAX_IN_FLIGHT)

    def worker(conn):
        try:
            conn.settimeout(deadline)
            data = _read_request(conn)
            conn.sendall(handle_request(data, tailscaled_socket, deadline))
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass
            gate.release()

    while True:
        conn, _ = listen_socket.accept()
        if not gate.acquire(blocking=False):
            conn.close()  # at capacity - refuse rather than queue
            continue
        threading.Thread(target=worker, args=(conn,), daemon=True).start()


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - the socket server entrypoint
    parser = argparse.ArgumentParser(description="kb WhoIs shim")
    parser.add_argument("--socket-fd", type=int, default=None, help="the systemd-passed listen fd (3)")
    parser.add_argument("--socket", required=True, help="the tailscaled LocalAPI unix socket path")
    args = parser.parse_args(argv)
    if args.socket_fd is None:
        raise SystemExit("kb_whois_shim is socket-activated; expected --socket-fd=3")
    listen_socket = socket.socket(fileno=os.dup(args.socket_fd), family=socket.AF_UNIX, type=socket.SOCK_STREAM)
    serve(listen_socket, args.socket)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
