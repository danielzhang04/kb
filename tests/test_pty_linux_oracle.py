"""WSL-only oracle for the built P3 broker.

The broker and dashboard are real fixture processes using synthetic, namespace-local
``kb-shell``/``kb-dashboard`` accounts. This suite makes no systemd or production-uid claim;
P7 owns those assertions. No production account is created or modified.
"""

from __future__ import annotations

import base64
from functools import lru_cache
import json
import multiprocessing
import os
from pathlib import Path
import shutil
import signal
import socket
import struct
import subprocess
import tempfile
import time
from typing import Any, Iterator

import pytest

IS_LINUX = os.name == "posix" and hasattr(socket, "AF_UNIX") and Path("/proc").is_dir()
LINUX_SOCKET = pytest.mark.skipif(
    not IS_LINUX,
    reason="requires Linux AF_UNIX, SO_PEERCRED, /proc fd pinning, uid transitions, and mount namespaces",
)

# `Oracle.__init__` asserts `os.geteuid() == 0` -- it must run through the plan's
# `sudo env -i KB_NODE_BIN=... KB_NPX_BIN=... python3 -m pytest tests/test_pty_linux_oracle.py`
# invocation (docs/plans/2026-08-22-dv3-p3-plan.md section 7), never bare `pytest`. A hosted CI
# runner is Linux but not root, so without this module-level gate every `oracle`-fixture test
# ERRORs in fixture setup instead of skipping. Gate at collection so those tests report skipped,
# not error, off the VM/WSL oracle environment -- the in-fixture assert stays as-is for the case
# this module DOES run, so a future regression there still fails loudly on the VM.
NOT_ROOT_ORACLE = not (IS_LINUX and hasattr(os, "geteuid") and os.geteuid() == 0)
pytestmark = pytest.mark.skipif(
    NOT_ROOT_ORACLE,
    reason="Linux root-broker oracle: run via the plan's `sudo env -i ...` command on the VM/WSL, "
           "not a hosted CI runner (see docs/plans/2026-08-22-dv3-p3-plan.md section 7)",
)
PROTOCOL = "kb-shell-broker/v1"
MAX_FRAME = 98_304
REQUEST_ID = "req-0123456789abcdef0123456789abcdef"
OPERATION_KEY = "op-" + "a" * 64
REPO = Path(__file__).resolve().parents[1]
DASHBOARD = REPO / "dashboard"


def _send(sock: socket.socket, frame: dict[str, Any]) -> None:
    body = json.dumps(frame, separators=(",", ":")).encode()
    sock.sendall(struct.pack(">I", len(body)) + body)


def _receive(sock: socket.socket, timeout: float = 5) -> dict[str, Any]:
    sock.settimeout(timeout)
    header = b""
    while len(header) < 4:
        chunk = sock.recv(4 - len(header))
        if not chunk:
            raise EOFError("built broker closed")
        header += chunk
    size = struct.unpack(">I", header)[0]
    assert size <= MAX_FRAME
    body = b""
    while len(body) < size:
        chunk = sock.recv(size - len(body))
        if not chunk:
            raise EOFError("built broker closed mid-frame")
        body += chunk
    value = json.loads(body)
    assert isinstance(value, dict)
    return value


def _receive_response(client: socket.socket, request_id: str) -> dict[str, Any]:
    while True:
        frame = _receive(client)
        if frame.get("requestId") == request_id:
            return frame


def _tool(name: str) -> str:
    """Absolute path to ``node``/``npx``.

    ``sudo env -i`` strips PATH, and an nvm or ``~/.local`` install is invisible to the
    sanitized PATH the plan's command sets. The caller resolves the tool *before* sudo and
    passes it through ``KB_NODE_BIN`` / ``KB_NPX_BIN``; ``shutil.which`` is only the fallback.
    """
    override = os.environ.get(f"KB_{name.upper()}_BIN")
    if override:
        assert Path(override).is_file(), f"KB_{name.upper()}_BIN={override} is not a file"
        return override
    found = shutil.which(name)
    if found is None:
        raise AssertionError(
            f"{name} was not found on PATH: run the oracle with "
            f"KB_{name.upper()}_BIN=$(command -v {name}) so `sudo env -i` cannot strip it")
    return found


@lru_cache(maxsize=1)
def _built_main() -> Path:
    """Reuse the `npm run build:pty-broker` output when it is present; only build when it is not.

    The oracle must exercise the SHIPPED entrypoint, so there is no hand-written fallback here any
    more: the build script emits main.js, the ESM marker, and the packaged runtime dependencies
    together, and an oracle running against a synthesized main.js would prove nothing about them.
    """
    output = DASHBOARD / "dist-server" / "kb-shell-broker"
    main = output / "main.js"
    emitted = output / "server" / "pty" / "linuxBrokerMain.js"
    if not (main.is_file() and emitted.is_file()):
        subprocess.run([_tool("node"), "scripts/build-pty-broker.mjs"], cwd=DASHBOARD,
                       check=True, timeout=600)
    assert main.is_file() and emitted.is_file(), f"build:pty-broker did not emit {main}"
    return main


def _unused_uids() -> tuple[int, int, int | None]:
    used = {int(line.split(":")[2]) for line in Path("/etc/passwd").read_text().splitlines()
            if len(line.split(":")) > 2 and line.split(":")[2].isdigit()}
    free = [uid for uid in range(61_000, 62_000) if uid not in used]
    if len(free) < 2:
        raise AssertionError("two unused fixture uids are required")
    return free[0], free[1], free[2] if len(free) > 2 else None


def _namespace_helper(root: str, main: str, shell_uid: int, dashboard_uid: int, node: str) -> None:
    fixture = Path(root)
    for source, target in [(fixture / "varlib", "/var/lib"), (fixture / "run", "/run"),
                           (fixture / "passwd", "/etc/passwd"), (fixture / "group", "/etc/group")]:
        subprocess.run(["mount", "--bind", str(source), target], check=True)
    socket_path = "/run/kb-shell/broker.sock"
    try: os.unlink(socket_path)
    except FileNotFoundError: pass
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(socket_path); os.chown(socket_path, dashboard_uid, dashboard_uid); os.chmod(socket_path, 0o600)
    listener.listen(16); os.dup2(listener.fileno(), 3); os.set_inheritable(3, True)
    os.setgroups([])
    os.setgid(shell_uid)
    os.setuid(shell_uid)
    # `node` is the absolute path the fixture resolved before sudo stripped PATH.
    os.execv(node, [node, main, "--socket-fd=3", f"--protocol-version={PROTOCOL}"])


def _create_frame(epoch: str, **changes: Any) -> dict[str, Any]:
    frame: dict[str, Any] = {
        "type": "create", "requestId": REQUEST_ID, "sessionId": None, "epochId": epoch,
        "operationKey": OPERATION_KEY,
        "recipe": {"launcher": "shell", "mode": "interactive", "model": None,
                   "toolPolicyId": "shell-default", "sandbox": "interactive"},
        "rootId": "repo", "relativeCwd": "", "cols": 80, "rows": 24,
    }
    frame.update(changes)
    return frame


def _dashboard_process(socket_path: str, uid: int, mode: str, pipe: Any) -> None:
    os.setgroups([]); os.setgid(uid); os.setuid(uid)
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); client.connect(socket_path)
    _send(client, {"type": "hello", "requestId": REQUEST_ID, "sessionId": None,
                   "protocol": PROTOCOL, "dashboardEpochId": "epoch-" + "d" * 32})
    ready = _receive_response(client, REQUEST_ID)
    if mode == "create":
        _send(client, _create_frame(ready["epochId"]))
        pipe.send(_receive_response(client, REQUEST_ID)["sessionId"])
        while True: time.sleep(1)
    for item in ready["sessions"]:
        _send(client, {"type": "close", "requestId": REQUEST_ID, "sessionId": item["sessionId"],
                       "epochId": ready["epochId"], "sequence": 0})
        _receive_response(client, REQUEST_ID)
    pipe.send("drained"); client.close()


class Oracle:
    def __init__(self) -> None:
        if os.geteuid() != 0:
            raise AssertionError("Linux oracle must run through the plan's sudo env command")
        if shutil.which("unshare") is None or shutil.which("mount") is None:
            raise AssertionError("unshare and mount are required for the isolated broker fixture")
        self.shell_uid, self.dashboard_uid, self.other_uid = _unused_uids()
        self.root = Path(tempfile.mkdtemp(prefix="kb-pty-oracle-", dir="/tmp")); os.chmod(self.root, 0o755)
        self._layout()
        self.socket_path = self.root / "run/kb-shell/broker.sock"
        self.process: subprocess.Popen[bytes] | None = None
        self.broker_pid: int | None = None
        self.start()

    def _layout(self) -> None:
        for directory in [self.root / "varlib/kb/ops", self.root / "varlib/kb-shell",
                          self.root / "run/kb-shell"]:
            directory.mkdir(parents=True, exist_ok=True); os.chown(directory, 0, 0); os.chmod(directory, 0o755)
        worktrees = self.root / "varlib/kb-shell/worktrees"; home = self.root / "varlib/kb-shell/home"
        worktrees.mkdir(); home.mkdir()
        os.chown(worktrees, self.dashboard_uid, self.shell_uid); os.chmod(worktrees, 0o2770)
        os.chown(home, self.shell_uid, self.shell_uid); os.chmod(home, 0o700)
        # The broker refuses a runtime directory outside policy (0700 service RuntimeDirectoryMode
        # or 0750 socket DirectoryMode). 0750 kb-shell:kb-dashboard is the mode that also lets the
        # dashboard traverse to broker.sock; 0755 is refused.
        runtime = self.root / "run/kb-shell"
        os.chown(runtime, self.shell_uid, self.dashboard_uid); os.chmod(runtime, 0o750)
        (self.root / "passwd").write_text(
            f"root:x:0:0:root:/root:/bin/bash\nkb-shell:x:{self.shell_uid}:{self.shell_uid}::/var/lib/kb-shell/home:/usr/sbin/nologin\n"
            f"kb-dashboard:x:{self.dashboard_uid}:{self.dashboard_uid}::/nonexistent:/usr/sbin/nologin\n")
        (self.root / "group").write_text(
            f"root:x:0:\nkb-shell:x:{self.shell_uid}:\nkb-dashboard:x:{self.dashboard_uid}:\n")

    def start(self) -> None:
        command = ["unshare", "--mount", "--fork", "--propagation", "private", "python3", "-c",
            "from tests.test_pty_linux_oracle import _namespace_helper; import sys; "
            "_namespace_helper(sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4]),sys.argv[5])",
            str(self.root), str(_built_main()), str(self.shell_uid), str(self.dashboard_uid),
            _tool("node")]
        self.process = subprocess.Popen(command, cwd=REPO,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                client = self.connect(); ready = self.hello(client); assert ready["type"] == "ready"
                self.broker_pid = struct.unpack("3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[0]
                client.close(); return
            except (OSError, EOFError):
                if self.process.poll() is not None:
                    stderr = self.process.stderr.read().decode(errors="replace") if self.process.stderr else ""
                    raise AssertionError(f"built broker exited during startup: {stderr}")
                time.sleep(0.05)
        raise AssertionError("built broker did not become ready")

    def connect(self, uid: int | None = None) -> socket.socket:
        target_uid = self.dashboard_uid if uid is None else uid
        old_uid, old_gid = os.geteuid(), os.getegid(); client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            os.setegid(target_uid); os.seteuid(target_uid); client.connect(str(self.socket_path))
        finally:
            os.seteuid(old_uid); os.setegid(old_gid)
        return client

    def hello(self, client: socket.socket) -> dict[str, Any]:
        _send(client, {"type": "hello", "requestId": REQUEST_ID, "sessionId": None,
                       "protocol": PROTOCOL, "dashboardEpochId": "epoch-" + "d" * 32})
        return _receive_response(client, REQUEST_ID)

    def create(self, client: socket.socket, epoch: str, **changes: Any) -> dict[str, Any]:
        _send(client, _create_frame(epoch, **changes)); return _receive_response(client, REQUEST_ID)

    def pids(self) -> list[int]:
        state = self.root / "run/kb-shell/state.json"
        if not state.exists(): return []
        return [row["identity"]["pid"] for row in json.loads(state.read_text())["sessions"]]

    def crash(self) -> None:
        if self.broker_pid is not None:
            try: os.kill(self.broker_pid, signal.SIGKILL)
            except ProcessLookupError: pass
        if self.process is not None: self.process.wait(timeout=5)

    def restart(self) -> None:
        self.crash(); self.start()

    def close(self) -> None:
        self.crash()
        for pid in self.pids():
            try: os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError: pass
        shutil.rmtree(self.root, ignore_errors=True)


@pytest.fixture
def oracle() -> Iterator[Oracle]:
    fixture = Oracle()
    try: yield fixture
    finally: fixture.close()


def _wait_gone(pids: list[int]) -> None:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and any(Path(f"/proc/{pid}").exists() for pid in pids): time.sleep(0.02)
    assert all(not Path(f"/proc/{pid}").exists() for pid in pids), f"orphan pids remain: {pids}"


def _wait_zero_state(oracle: Oracle) -> None:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and oracle.pids(): time.sleep(0.02)
    assert oracle.pids() == []


@LINUX_SOCKET
def test_socket_and_effective_fixture_uid(oracle: Oracle) -> None:
    client = oracle.connect(); ready = oracle.hello(client)
    peer = struct.unpack("3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    assert peer[1:] == (oracle.shell_uid, oracle.shell_uid); assert ready["protocol"] == PROTOCOL
    assert (oracle.socket_path.stat().st_mode & 0o777, oracle.socket_path.stat().st_uid) == (0o600, oracle.dashboard_uid)
    client.close()


@LINUX_SOCKET
def test_unix_only_listener_and_child_network(oracle: Oracle) -> None:
    client = oracle.connect(); ready = oracle.hello(client); created = oracle.create(client, ready["epochId"])
    command = b"python3 -c 'import socket; socket.socket(socket.AF_INET,socket.SOCK_DGRAM); print(\"NETWORK-OK\")'\n"
    _send(client, {"type": "input", "requestId": REQUEST_ID, "sessionId": created["sessionId"],
                   "epochId": ready["epochId"], "sequence": 0, "encoding": "base64",
                   "data": base64.b64encode(command).decode()})
    _receive_response(client, REQUEST_ID); output = b""; deadline = time.monotonic() + 5
    while b"NETWORK-OK" not in output and time.monotonic() < deadline:
        frame = _receive(client)
        if frame["type"] == "data": output += base64.b64decode(frame["data"])
    assert b"NETWORK-OK" in output; client.close()


@LINUX_SOCKET
def test_repo_and_worktrees_policy(oracle: Oracle) -> None:
    client = oracle.connect(); ready = oracle.hello(client)
    assert oracle.create(client, ready["epochId"])["type"] == "ack"; client.close()
    assert (oracle.root / "varlib/kb-shell/worktrees").stat().st_mode & 0o7777 == 0o2770


@LINUX_SOCKET
def test_traversal_and_denied_roots(oracle: Oracle) -> None:
    client = oracle.connect(); ready = oracle.hello(client)
    for cwd in ["../state", "/root", "a//b", "a/../b"]:
        result = oracle.create(client, ready["epochId"], relativeCwd=cwd,
                               operationKey="op-" + os.urandom(32).hex())
        assert result["code"] == "unsafe-cwd"
    client.close()


@LINUX_SOCKET
def test_fd_pinned_symlink_swap(oracle: Oracle) -> None:
    """A policy-valid symlinked cwd launches; repointing it between pins must refuse."""
    worktrees = oracle.root / "varlib/kb-shell/worktrees"
    target = worktrees / "target"
    target.mkdir(); os.chown(target, oracle.shell_uid, oracle.shell_uid); os.chmod(target, 0o2770)
    denied = worktrees / "denied"
    denied.mkdir(); os.chown(denied, 0, 0); os.chmod(denied, 0o755)  # not a 02770 kb-shell worktree
    link = worktrees / "swap"
    link.symlink_to(target); os.lchown(link, oracle.shell_uid, oracle.shell_uid)
    client = oracle.connect(); ready = oracle.hello(client)

    first = oracle.create(client, ready["epochId"], rootId="worktrees", relativeCwd="swap",
                          operationKey="op-" + os.urandom(32).hex())
    assert first["type"] == "ack", first

    # swap the symlink after the broker pinned it: the next walk resolves the new target and refuses
    link.unlink(); link.symlink_to(denied); os.lchown(link, oracle.shell_uid, oracle.shell_uid)
    swapped = oracle.create(client, ready["epochId"], rootId="worktrees", relativeCwd="swap",
                            operationKey="op-" + os.urandom(32).hex())
    assert swapped["type"] == "error" and swapped["code"] == "unsafe-cwd", swapped

    # and a target outside the approved roots is refused by the chain check, not followed
    link.unlink(); link.symlink_to("/etc"); os.lchown(link, oracle.shell_uid, oracle.shell_uid)
    escaped = oracle.create(client, ready["epochId"], rootId="worktrees", relativeCwd="swap",
                            operationKey="op-" + os.urandom(32).hex())
    assert escaped["type"] == "error" and escaped["code"] == "unsafe-cwd", escaped
    client.close()


@LINUX_SOCKET
def test_recipe_and_raw_field_refusal(oracle: Oracle) -> None:
    client = oracle.connect(); ready = oracle.hello(client); bad = _create_frame(ready["epochId"]); bad["argv"] = ["bash"]
    _send(client, bad); assert _receive_response(client, REQUEST_ID)["code"] == "invalid-request"; client.close()


@LINUX_SOCKET
def test_input_bounds_and_high_water(oracle: Oracle) -> None:
    client = oracle.connect(); ready = oracle.hello(client); created = oracle.create(client, ready["epochId"])
    wires = []
    for index in range(5):
        frame = {"type": "input", "requestId": f"req-{index:032x}", "sessionId": created["sessionId"],
                 "epochId": ready["epochId"], "sequence": index, "encoding": "base64",
                 "data": base64.b64encode(b"x" * 65_536).decode()}
        body = json.dumps(frame, separators=(",", ":")).encode(); wires.append(struct.pack(">I", len(body)) + body)
    client.sendall(b"".join(wires)); responses = []
    while len(responses) < 5:
        frame = _receive(client)
        if frame.get("requestId") is not None: responses.append(frame)
    assert sum(frame.get("accepted", 0) for frame in responses) == 262_144
    assert any(frame.get("code") == "input-too-large" for frame in responses); client.close()


@LINUX_SOCKET
def test_epoch_loss_abandons_before_exit(oracle: Oracle) -> None:
    client = oracle.connect(); old = oracle.hello(client); oracle.create(client, old["epochId"])
    pids = oracle.pids(); client.close(); oracle.restart(); _wait_gone(pids)
    client = oracle.connect(); current = oracle.hello(client)
    _send(client, {"type": "close", "requestId": REQUEST_ID, "sessionId": "pty-" + "a" * 32,
                   "epochId": old["epochId"], "sequence": 0})
    assert _receive_response(client, REQUEST_ID)["code"] == "epoch-lost"; assert current["sessions"] == []
    client.close()


@LINUX_SOCKET
def test_peer_uid_refusal(oracle: Oracle) -> None:
    if oracle.other_uid is None: pytest.skip("no second unused fixture uid is available")
    # Open the runtime directory and socket wide, so SO_PEERCRED — not the filesystem — is what
    # refuses the third uid. The broker's own directory-mode policy is asserted at startup.
    runtime = oracle.socket_path.parent
    os.chmod(oracle.socket_path, 0o666); os.chmod(runtime, 0o755)
    try:
        client = oracle.connect(oracle.other_uid)
        with pytest.raises((EOFError, ConnectionResetError, BrokenPipeError)): oracle.hello(client)
        client.close()
    finally: os.chmod(oracle.socket_path, 0o600); os.chmod(runtime, 0o750)


@LINUX_SOCKET
def test_runtime_directory_mode_refusal(oracle: Oracle) -> None:
    """A runtime directory outside BROKER_RUNTIME_POLICY refuses startup, state file or not."""
    runtime = oracle.root / "run/kb-shell"
    oracle.crash()
    os.chmod(runtime, 0o755)
    try:
        with pytest.raises(AssertionError, match="exited during startup"):
            oracle.start()
    finally:
        os.chmod(runtime, 0o750)
    oracle.start()
    client = oracle.connect(); assert oracle.hello(client)["type"] == "ready"; client.close()


@LINUX_SOCKET
def test_dashboard_and_broker_restart_zero_orphans(oracle: Oracle) -> None:
    parent, child = multiprocessing.Pipe()
    dashboard = multiprocessing.Process(target=_dashboard_process,
        args=(str(oracle.socket_path), oracle.dashboard_uid, "create", child))
    dashboard.start(); parent.recv(); first = oracle.pids(); assert first
    dashboard.kill(); dashboard.join(timeout=5)
    parent2, child2 = multiprocessing.Pipe()
    replacement = multiprocessing.Process(target=_dashboard_process,
        args=(str(oracle.socket_path), oracle.dashboard_uid, "drain", child2))
    replacement.start(); assert parent2.recv() == "drained"; replacement.join(timeout=5)
    _wait_gone(first); _wait_zero_state(oracle)
    client = oracle.connect(); ready = oracle.hello(client); oracle.create(client, ready["epochId"])
    second = oracle.pids(); client.close(); oracle.restart(); _wait_gone(second)
    _wait_zero_state(oracle)
