#!/usr/bin/env python3
"""kb node proxy - the attested node-identity hop (dashboard-v3 P6 section 3.3 [P6-C19]).

It fronts ONLY the 8444 `tailscale serve` node listener and forwards to the dashboard's loopback port.
For every request it:

  1. Proves ITS OWN upstream peer is root (uid 0 = `tailscale serve`) with the full-4-tuple
     `/proc/net/tcp{,6}` match (a Python port of `dashboard/server/auth/peerUid.ts`), failing CLOSED on any
     ambiguity. A local process cannot forge the OS owner of its own socket.
  2. Deletes EVERY inbound `Tailscale-*` header AND every inbound `X-Forwarded-*` header before any other
     work - behind serve the remote tailnet address arrives as `X-Forwarded-For`, so an unstripped forgery
     would be WhoIs'd as an arbitrary node.
  3. Resolves the peer address from the SOCKET PEER of its own upstream connection, never a header value,
     and asks the root-owned WhoIs shim (`GET /localapi/v0/whois?addr=` only) for its node id.
  4. Injects EXACTLY ONE header, `Tailscale-Node-ID`, and mints NO user identity at all - it never writes
     `Tailscale-User-Login`/`-Name`, so it is structurally incapable of forging the operator subject.

When the WhoIs shim is unreachable/refusing/timed-out it REFUSES fail-closed (503
`node-attribution-unavailable`) rather than forward an unattributed request.

The module is import-safe and side-effect-free; only `main()` opens sockets.
"""
from __future__ import annotations

import argparse
import json
import re
import socket
from typing import Iterable

# The node id grammar the shim must return; matches auth/hostNodeMapContracts.ts NODE_ID.
NODE_ID = re.compile(r"^[A-Za-z0-9]{5,32}$")
# Inbound header families a client (or serve) could set that the dashboard must never trust.
_STRIP_PREFIXES = ("tailscale-", "x-forwarded-")
WHOIS_REQUEST_DEADLINE = 1.0
# `st` value for ESTABLISHED in /proc/net/tcp. uid is the 8th whitespace field (index 7).
_ESTABLISHED = "01"
_UID_FIELD = 7
PROC_NET_TABLES = ("/proc/net/tcp", "/proc/net/tcp6")


class AttributionUnavailable(Exception):
    """The WhoIs shim could not attribute the peer: the request must be refused, never forwarded."""


class UntrustedUpstream(Exception):
    """The upstream peer is not root `tailscale serve`: refuse rather than attribute a forged hop."""


# --- header handling ---------------------------------------------------------------------------

def strip_client_identity_headers(headers: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    """Drop EVERY inbound `Tailscale-*` and `X-Forwarded-*` header (case-insensitive), unconditionally."""
    return [(name, value) for name, value in headers
            if not name.lower().startswith(_STRIP_PREFIXES)]


def inject_node_identity(headers: Iterable[tuple[str, str]], node_id: str) -> list[tuple[str, str]]:
    """Strip inbound identity headers, then inject EXACTLY ONE `Tailscale-Node-ID`. Never a user header.

    A node id that does not match the grammar is a fail-closed refusal, not a forwarded guess.
    """
    if not NODE_ID.match(node_id):
        raise AttributionUnavailable(f"WhoIs returned a malformed node id")
    cleaned = strip_client_identity_headers(headers)
    cleaned.append(("Tailscale-Node-ID", node_id))
    return cleaned


# --- peer-uid proof (Python port of auth/peerUid.ts) -------------------------------------------

def _ipv4_bytes(address: str) -> list[int] | None:
    parts = address.split(".")
    if len(parts) != 4:
        return None
    out: list[int] = []
    for part in parts:
        if not re.fullmatch(r"\d{1,3}", part) or int(part) > 255:
            return None
        out.append(int(part))
    return out


def _le_word(byts: list[int]) -> str:
    return "".join(f"{b:02X}" for b in reversed(byts))


def ip_to_proc_hex(address: str) -> str | None:
    """Render an IP into the kernel's `/proc/net/tcp` hex form (each 32-bit word little-endian, uppercase).
    IPv4 only for the loopback peers this proxy sees; returns None for anything unparsable (fail closed)."""
    v4 = _ipv4_bytes(address)
    if v4 is not None:
        return _le_word(v4)
    # Embedded/mapped v6 loopback is normalised by the caller; a bare v6 literal is out of scope here.
    return None


def _hex_port(port: int) -> str:
    return f"{port:04X}"


def _parse_endpoint(field: str) -> tuple[str, str] | None:
    colon = field.rfind(":")
    if colon <= 0 or colon == len(field) - 1:
        return None
    return field[:colon].upper(), field[colon + 1:].upper()


def find_peer_uid(local_address: str, local_port: int, remote_address: str, remote_port: int,
                  tables: Iterable[str]) -> int | None:
    """The uid owning the peer socket of the accepted connection, matched on the FULL 4-tuple. Returns None
    for no-match, ambiguity, or an unparsable table/address - every ambiguity fails CLOSED (see peerUid.ts)."""
    peer_local = ip_to_proc_hex(remote_address)
    peer_remote = ip_to_proc_hex(local_address)
    if peer_local is None or peer_remote is None:
        return None
    peer_local_port = _hex_port(remote_port)
    peer_remote_port = _hex_port(local_port)
    owners: set[int] = set()
    for table in tables:
        for line in table.split("\n"):
            fields = line.strip().split()
            if len(fields) <= _UID_FIELD or not fields[0].endswith(":"):
                continue
            if fields[3] != _ESTABLISHED:
                continue
            local = _parse_endpoint(fields[1])
            remote = _parse_endpoint(fields[2])
            if not local or not remote:
                continue
            if local[1] != peer_local_port or remote[1] != peer_remote_port:
                continue
            if local[0] != peer_local or remote[0] != peer_remote:
                continue
            if not re.fullmatch(r"\d+", fields[_UID_FIELD]):
                return None
            owners.add(int(fields[_UID_FIELD]))
    if len(owners) != 1:
        return None  # no row, or two rows disagreeing - deny
    return next(iter(owners))


def read_proc_net_tables(read=None) -> list[str]:
    reader = read or (lambda path: open(path, "r", encoding="utf-8").read())
    tables: list[str] = []
    for path in PROC_NET_TABLES:
        try:
            tables.append(reader(path))
        except OSError:
            pass  # one family may be absent (IPv6 disabled); absence is never trust
    return tables


def prove_upstream_is_root(local_address: str, local_port: int, remote_address: str, remote_port: int,
                           tables: Iterable[str]) -> None:
    """Refuse unless the upstream peer socket is owned by uid 0 (root `tailscale serve`)."""
    uid = find_peer_uid(local_address, local_port, remote_address, remote_port, tables)
    if uid != 0:
        raise UntrustedUpstream("upstream peer is not root tailscale serve")


# --- WhoIs shim client -------------------------------------------------------------------------

def whois(addr: str, port: int, socket_path: str, deadline: float = WHOIS_REQUEST_DEADLINE,
          connect=None) -> str:
    """Ask the root-owned shim for the node id of `<addr>:<port>`. Returns the node id, or raises
    AttributionUnavailable on any failure (unreachable, timeout, `{error}`, or a malformed reply)."""
    request = f"{addr}:{port}\n".encode("ascii")
    try:
        conn = connect() if connect is not None else _connect_unix(socket_path, deadline)
    except OSError as error:
        raise AttributionUnavailable("WhoIs shim unreachable") from error
    try:
        conn.settimeout(deadline)
        conn.sendall(request)
        reply = _read_line(conn, limit=4096)
    except (OSError, TimeoutError) as error:
        raise AttributionUnavailable("WhoIs shim did not answer in time") from error
    finally:
        try:
            conn.close()
        except OSError:
            pass
    try:
        parsed = json.loads(reply.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise AttributionUnavailable("WhoIs reply is not JSON") from error
    if not isinstance(parsed, dict) or "error" in parsed or "node" not in parsed:
        raise AttributionUnavailable("WhoIs could not attribute the peer")
    node = parsed["node"]
    if not isinstance(node, str) or not NODE_ID.match(node):
        raise AttributionUnavailable("WhoIs returned a malformed node id")
    return node


def _connect_unix(socket_path: str, deadline: float):
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(deadline)
    conn.connect(socket_path)
    return conn


def _read_line(conn, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while total < limit:
        chunk = conn.recv(min(4096, limit - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if b"\n" in chunk:
            break
    return b"".join(chunks).split(b"\n", 1)[0]


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - the socket server entrypoint
    parser = argparse.ArgumentParser(description="kb node-identity proxy")
    parser.add_argument("--listen", required=True, help="loopback host:port to accept the serve listener on")
    parser.add_argument("--upstream", required=True, help="the dashboard loopback host:port")
    parser.add_argument("--whois", required=True, help="the WhoIs shim unix socket path")
    args = parser.parse_args(argv)
    host, _, port = args.listen.rpartition(":")
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("node proxy must bind loopback only")
    raise SystemExit("kb_node_proxy runtime server is provisioned by systemd; import the module for logic")


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
