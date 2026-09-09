"""Deterministic desktop-local prospecting foundation."""

from __future__ import annotations

import os
import socket

SCHEMA_VERSION = 1
_NETWORK_GUARD_INSTALLED = False


def install_no_network_guard() -> None:
    """Deny non-loopback connects when the P1 gate marks this process."""
    global _NETWORK_GUARD_INSTALLED
    if os.environ.get("KB_PROSPECTING_NO_NETWORK") != "1" or _NETWORK_GUARD_INSTALLED:
        return
    original_socket = socket.socket

    class LoopbackOnlySocket(original_socket):
        def connect(self, address: object) -> object:
            host = address[0] if isinstance(address, tuple) and address else ""
            if host not in {"127.0.0.1", "::1", "localhost"}:
                raise OSError("external network disabled by P1 gate")
            return super().connect(address)

    socket.socket = LoopbackOnlySocket
    _NETWORK_GUARD_INSTALLED = True


install_no_network_guard()
