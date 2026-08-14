from __future__ import annotations

import argparse
import hashlib
import hmac
import inspect
import json
import os
import re
import secrets
import stat
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


COORDINATION = re.compile(r"^(?:queue|ledgers|traces|memory|dashboards|handoffs)/.+$|^orgs/[^/]+/STATE\.md$")
INSTRUCTION = re.compile(r"^(?:queue|memory|dashboards|handoffs)/.+$|^orgs/[^/]+/STATE\.md$")
SAFE_HOST = re.compile(r"^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$")
COMMIT_RE = re.compile(r"[0-9a-f]{40}")
DIGEST_RE = re.compile(r"[0-9a-f]{64}")
MANIFEST_KEYS = {"schema", "id", "parent", "commit", "paths", "createdAt", "bundleSha256"}
RECEIPT_KEYS = {"schema", "id", "sourceCommit", "promotedCommit", "promotedAt"}
APPROVAL_KEYS = {"schema", "chainDigest", "firstParent", "lastCommit", "ids"}
SAFE_CHANGED_MODES = {"000000", "100644"}
APPROVAL_PRINCIPAL = "kb-ops-approver"
APPROVAL_NAMESPACE = "kb-ops-instructions"
COMMAND_TIMEOUT = 30
TRANSPORT_TIMEOUT = 900
_GOOD_SIGNATURE = re.compile(
    rb'\AGood "' + re.escape(APPROVAL_NAMESPACE.encode("ascii")) + rb'" signature for '
    + re.escape(APPROVAL_PRINCIPAL.encode("ascii"))
    + rb' with [A-Za-z0-9@._+-]+ key SHA256:[A-Za-z0-9+/=]+\r?\n?\Z'
)
_RAW_HEADER = re.compile(
    rb"\A:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) "
    rb"([0-9a-f]{40}|[0-9a-f]{64}) ([AMD])\Z"
)


def run_git(
    repo: Path,
    args: list[str],
    check: bool = True,
    timeout: int = COMMAND_TIMEOUT,
) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=repo, check=check, capture_output=True,
        timeout=timeout,
    )


def _run_without_check(run, repo: Path, args: list[str]) -> subprocess.CompletedProcess:
    try:
        parameters = inspect.signature(run).parameters.values()
        accepts_check = any(
            parameter.name == "check" or parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in parameters
        )
    except (TypeError, ValueError):
        accepts_check = False
    return run(repo, args, check=False) if accepts_check else run(repo, args)


def _run_with_timeout(run, repo: Path, args: list[str], timeout: int) -> subprocess.CompletedProcess:
    try:
        parameters = inspect.signature(run).parameters.values()
        accepts_timeout = any(
            parameter.name == "timeout" or parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in parameters
        )
    except (TypeError, ValueError):
        accepts_timeout = False
    return run(repo, args, timeout=timeout) if accepts_timeout else run(repo, args)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _bytes(value: str | bytes | None) -> bytes:
    if value is None:
        return b""
    if isinstance(value, bytes):
        return value
    return value.encode("utf-8")


def _text(value: str | bytes | None, *, label: str = "git output") -> str:
    if isinstance(value, str):
        return value
    try:
        return (value or b"").decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError(f"{label} is not UTF-8") from error


def _canonical_json(value: dict) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode("utf-8")


def _read_regular_bytes(path: Path) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    if os.name != "nt" and not nofollow:
        raise RuntimeError("O_NOFOLLOW is required")
    descriptor = os.open(path, flags | nofollow)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError("input must be a regular file")
        chunks = []
        while chunk := os.read(descriptor, 1024 * 1024):
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _closed_json_bytes(raw: bytes, keys: set[str]) -> dict:
    def closed_pairs(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise RuntimeError(f"duplicate JSON key: {key}")
            value[key] = item
        return value

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=closed_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("closed manifest schema required") from error
    if type(value) is not dict or set(value) != keys:
        raise RuntimeError("closed manifest schema required")
    if raw != _canonical_json(value):
        raise RuntimeError("canonical manifest encoding required")
    return value


def parse_closed_json(path: Path, keys: set[str], *, raw: bytes | None = None) -> dict:
    return _closed_json_bytes(_read_regular_bytes(path) if raw is None else raw, keys)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_utc(value: object, label: str) -> None:
    if type(value) is not str:
        raise RuntimeError(f"{label} timestamp is malformed")
    try:
        instant = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise RuntimeError(f"{label} timestamp is malformed") from error
    if instant.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value:
        raise RuntimeError(f"{label} timestamp is not canonical UTC")


def _validate_repo_path(raw: bytes) -> str:
    try:
        path = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError("changed path is not UTF-8") from error
    parts = path.split("/")
    if (
        not path
        or PurePosixPath(path).is_absolute()
        or any(part in {"", ".", ".."} for part in parts)
        or "\\" in path
        or any(ord(character) < 32 or ord(character) == 127 for character in path)
    ):
        raise RuntimeError("changed path is unsafe")
    return path


def parse_raw_diff(raw: str | bytes) -> tuple[list[tuple[str, str]], list[str]]:
    data = _bytes(raw)
    if not data:
        return [], []
    fields = data.split(b"\0")
    if fields[-1] != b"" or len(fields) % 2 != 1:
        raise RuntimeError("raw Git diff is malformed")
    modes: list[tuple[str, str]] = []
    paths: list[str] = []
    for index in range(0, len(fields) - 1, 2):
        match = _RAW_HEADER.fullmatch(fields[index])
        if match is None:
            raise RuntimeError("raw Git diff row is malformed")
        path = _validate_repo_path(fields[index + 1])
        if path in paths:
            raise RuntimeError("raw Git diff contains a duplicate path")
        modes.append((match.group(1).decode("ascii"), match.group(2).decode("ascii")))
        paths.append(path)
    return modes, sorted(paths)


def fetch_vm_outbox(vm_host: str, snapshot_root: Path, run=subprocess.run) -> Path:
    if not SAFE_HOST.fullmatch(vm_host) or vm_host.startswith("-"):
        raise ValueError("vm host must be an SSH hostname with optional user")
    if snapshot_root.exists():
        raise RuntimeError("outbox snapshot root must be fresh")
    snapshot_root.mkdir(parents=True)
    run(
        [
            "scp", "-r",
            f"{vm_host}:/var/lib/kb/state/outbox/ready",
            f"{vm_host}:/var/lib/kb/state/outbox/receipts",
            str(snapshot_root),
        ],
        check=True,
        timeout=TRANSPORT_TIMEOUT,
    )
    result = run(
        ["ssh", vm_host, "git", "-C", "/var/lib/kb/ops", "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        timeout=COMMAND_TIMEOUT,
    )
    head = _text(result.stdout, label="VM source head").strip()
    if COMMIT_RE.fullmatch(head) is None:
        raise RuntimeError("VM returned an invalid source head")
    (snapshot_root / "SOURCE_HEAD").write_text(head + "\n", encoding="ascii")
    ready = snapshot_root / "ready"
    receipts = snapshot_root / "receipts"
    if not ready.is_dir() or ready.is_symlink() or not receipts.is_dir() or receipts.is_symlink():
        raise RuntimeError("VM outbox snapshot did not contain ready/ and receipts/")
    return snapshot_root


def validate_snapshot(spool: Path) -> list[dict]:
    ready = spool / "ready"
    receipts = spool / "receipts"
    if (
        not ready.is_dir()
        or ready.is_symlink()
        or not receipts.is_dir()
        or receipts.is_symlink()
    ):
        raise RuntimeError("snapshot directories are absent")
    entries = list(ready.iterdir())
    if any(
        not item.is_file() or item.is_symlink() or item.suffix not in {".json", ".bundle"}
        for item in entries
    ):
        raise RuntimeError("unknown ready artifact")
    json_stems = {item.stem for item in entries if item.suffix == ".json"}
    bundle_stems = {item.stem for item in entries if item.suffix == ".bundle"}
    if json_stems != bundle_stems:
        raise RuntimeError("manifest and bundle filenames differ")
    manifests = []
    for stem in sorted(json_stems):
        value = parse_closed_json(ready / f"{stem}.json", MANIFEST_KEYS)
        string_fields = {"schema", "id", "parent", "commit", "createdAt", "bundleSha256"}
        if any(type(value[field]) is not str for field in string_fields):
            raise RuntimeError("manifest identity fields are invalid")
        if (
            value["schema"] != "kb.ops-outbox/v1"
            or stem != value["id"]
            or value["id"] != value["commit"]
            or COMMIT_RE.fullmatch(stem) is None
        ):
            raise RuntimeError("manifest filename/id/commit identity mismatch")
        if COMMIT_RE.fullmatch(value["parent"]) is None:
            raise RuntimeError("manifest parent or paths are invalid")
        paths = value["paths"]
        if (
            type(paths) is not list
            or not paths
            or any(type(path) is not str for path in paths)
            or paths != sorted(set(paths))
        ):
            raise RuntimeError("manifest parent or paths are invalid")
        for path in paths:
            _validate_repo_path(path.encode("utf-8"))
        _canonical_utc(value["createdAt"], "manifest")
        if DIGEST_RE.fullmatch(value["bundleSha256"]) is None:
            raise RuntimeError("bundle digest is invalid")
        actual_digest = sha256_file(ready / f"{stem}.bundle")
        if not hmac.compare_digest(actual_digest, value["bundleSha256"]):
            raise RuntimeError("bundle digest mismatch")
        manifests.append(value)
    receipt_entries = list(receipts.iterdir())
    if any(
        not item.is_file()
        or item.is_symlink()
        or item.suffix != ".json"
        or item.stem not in json_stems
        for item in receipt_entries
    ):
        raise RuntimeError("orphan or extra receipt")
    return manifests


def order_from_parent(manifests: list[dict], trusted_head: str) -> list[dict]:
    if COMMIT_RE.fullmatch(trusted_head) is None:
        raise RuntimeError("trusted ops head is invalid")
    by_parent: dict[str, list[dict]] = {}
    for manifest in manifests:
        by_parent.setdefault(manifest["parent"], []).append(manifest)
    ordered: list[dict] = []
    previous = trusted_head
    seen: set[str] = set()
    while previous in by_parent:
        children = by_parent[previous]
        if len(children) != 1:
            raise RuntimeError("outbox chain forks from a parent")
        item = children[0]
        if item["commit"] in seen:
            raise RuntimeError("outbox chain contains a cycle")
        ordered.append(item)
        seen.add(item["commit"])
        previous = item["commit"]
    if len(ordered) != len(manifests):
        raise RuntimeError("outbox is not one parent-topological chain from trusted ops head")
    return ordered


def validate_quarantine_chain(
    spool: Path,
    repo: Path,
    trusted_head: str,
    quarantine_prefix: str,
    run=run_git,
) -> list[dict]:
    if COMMIT_RE.fullmatch(trusted_head) is None:
        raise RuntimeError("trusted ops head is invalid")
    if not re.fullmatch(r"refs/kb-quarantine/[A-Za-z0-9._/-]+", quarantine_prefix):
        raise RuntimeError("quarantine prefix is invalid")
    ordered = order_from_parent(validate_snapshot(spool), trusted_head)
    for manifest in ordered:
        bundle = spool / "ready" / f"{manifest['id']}.bundle"
        ref = f"{quarantine_prefix}/{manifest['id']}"
        run(repo, ["bundle", "verify", str(bundle)])
        heads = _text(run(repo, ["bundle", "list-heads", str(bundle)]).stdout).splitlines()
        expected_head = f"{manifest['commit']} refs/kb-outbox/items/{manifest['id']}"
        if heads != [expected_head]:
            raise RuntimeError("bundle advertised ref mismatch")
        run(repo, ["fetch", "--no-tags", str(bundle), f"{manifest['commit']}:{ref}"])
        actual_commit = _text(run(repo, ["rev-parse", f"{ref}^{{commit}}"] ).stdout).strip()
        if actual_commit != manifest["commit"]:
            raise RuntimeError("quarantine ref does not equal manifest commit")
        parents = _text(run(repo, ["rev-list", "--parents", "-n", "1", ref]).stdout).strip().split()
        if parents != [actual_commit, manifest["parent"]]:
            raise RuntimeError("source commit is not the declared single-parent commit")
        raw = run(
            repo,
            ["diff-tree", "--no-commit-id", "--raw", "--no-abbrev", "-r", "-z", manifest["parent"], ref],
        ).stdout
        modes, changed = parse_raw_diff(raw)
        if any(old not in SAFE_CHANGED_MODES or new not in SAFE_CHANGED_MODES for old, new in modes):
            raise RuntimeError("symlink, gitlink, executable, or unsafe object mode")
        if changed != manifest["paths"]:
            raise RuntimeError("quarantined paths do not equal closed manifest")
        if any(COORDINATION.fullmatch(path) is None for path in changed):
            raise RuntimeError("quarantined commit contains a non-coordination path")
    return ordered


def approval_value(chain: list[dict]) -> dict:
    if not chain:
        raise RuntimeError("instruction approval cannot bind an empty chain")
    instructions = [
        item for item in chain
        if any(INSTRUCTION.fullmatch(path) for path in item["paths"])
    ]
    canonical_chain = b"".join(_canonical_json(item) for item in chain)
    return {
        "schema": "kb.ops-instruction-approval/v1",
        "chainDigest": hashlib.sha256(canonical_chain).hexdigest(),
        "firstParent": chain[0]["parent"],
        "lastCommit": chain[-1]["commit"],
        "ids": [item["id"] for item in instructions],
    }


def require_instruction_approval(
    chain: list[dict],
    approval: Path | None,
    signature: Path | None,
    allowed_signers: Path | None,
    run=subprocess.run,
) -> None:
    instructions = [
        item for item in chain
        if any(INSTRUCTION.fullmatch(path) for path in item["paths"])
    ]
    if not instructions:
        return
    if approval is None or signature is None or allowed_signers is None:
        raise RuntimeError("trusted-desktop approval is required for instruction-bearing paths")

    # The raw bytes are read once, verified first, and parsed only after the verifier's
    # status and anchored success token have both passed. The approval never supplies
    # the principal, namespace, or allowed-signers location.
    raw = _read_regular_bytes(approval)
    try:
        result = run(
            [
                "ssh-keygen", "-Y", "verify", "-f", str(allowed_signers),
                "-I", APPROVAL_PRINCIPAL, "-n", APPROVAL_NAMESPACE,
                "-s", str(signature),
            ],
            input=raw,
            capture_output=True,
            timeout=COMMAND_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("trusted-desktop approval signature failed") from error
    stdout = _bytes(getattr(result, "stdout", None))
    stderr = _bytes(getattr(result, "stderr", None))
    if getattr(result, "returncode", None) != 0 or stderr or _GOOD_SIGNATURE.fullmatch(stdout) is None:
        raise RuntimeError("trusted-desktop approval signature failed")

    value = parse_closed_json(approval, APPROVAL_KEYS, raw=raw)
    if value != approval_value(chain):
        raise RuntimeError("trusted-desktop approval does not bind the quarantined chain")


def read_matching_receipt(spool: Path, manifest: dict) -> dict | None:
    path = spool / "receipts" / f"{manifest['id']}.json"
    if not path.exists():
        return None
    value = parse_closed_json(path, RECEIPT_KEYS)
    if any(type(value[field]) is not str for field in RECEIPT_KEYS):
        raise RuntimeError("promotion receipt fields are invalid")
    if (
        value["schema"] != "kb.ops-promotion/v1"
        or value["id"] != manifest["id"]
        or value["sourceCommit"] != manifest["commit"]
    ):
        raise RuntimeError("promotion receipt does not match its manifest")
    if COMMIT_RE.fullmatch(value["promotedCommit"]) is None:
        raise RuntimeError("promotion receipt commit is invalid")
    _canonical_utc(value["promotedAt"], "promotion")
    return value


def write_receipt_durably(target: Path, value: dict) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        if os.name != "nt":
            directory_fd = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


def clone_fresh(operator_repo: Path, target: Path, run=subprocess.run) -> Path:
    remote = _text(run_git(operator_repo, ["remote", "get-url", "origin"]).stdout).strip()
    if not remote:
        raise RuntimeError("operator checkout origin URL is absent")
    target.parent.mkdir(parents=True, exist_ok=True)
    run(
        ["git", "clone", "--no-tags", "--branch", "ops", "--single-branch", remote, str(target)],
        check=True,
        capture_output=True,
        timeout=TRANSPORT_TIMEOUT,
    )
    return target


def recover_receiptless_remote_prefix(
    spool: Path,
    repo: Path,
    chain: list[dict],
    expected_remote: str,
    remote_head: str,
    quarantine_prefix: str,
    run=run_git,
) -> None:
    rows = _text(
        run(repo, ["rev-list", "--reverse", "--parents", f"{expected_remote}..{remote_head}"]).stdout
    ).splitlines()
    pending = [item for item in chain if read_matching_receipt(spool, item) is None]
    if len(rows) > len(pending):
        raise RuntimeError("origin/ops contains commits outside the pending outbox prefix")
    previous = expected_remote
    for row, manifest in zip(rows, pending):
        fields = row.split()
        if len(fields) != 2 or fields[1] != previous:
            raise RuntimeError("receiptless remote prefix is not single-parent")
        promoted = fields[0]
        message = _text(run(repo, ["show", "-s", "--format=%B", promoted]).stdout).splitlines()
        if message.count(f"KB-Outbox-ID: {manifest['id']}") != 1:
            raise RuntimeError("receiptless remote commit has the wrong outbox trailer")
        source_ref = f"{quarantine_prefix}/{manifest['id']}"
        if _run_without_check(run, repo, ["diff", "--quiet", source_ref, promoted]).returncode != 0:
            raise RuntimeError("receiptless remote commit tree differs from its source commit")
        receipt = {
            "schema": "kb.ops-promotion/v1",
            "id": manifest["id"],
            "sourceCommit": manifest["commit"],
            "promotedCommit": promoted,
            "promotedAt": utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }
        write_receipt_durably(spool / "receipts" / f"{manifest['id']}.json", receipt)
        previous = promoted
    if previous != remote_head:
        raise RuntimeError("receiptless remote prefix does not reach origin/ops")


def promote_one(
    spool: Path,
    repo: Path,
    manifest: dict,
    quarantine_prefix: str,
    run=run_git,
) -> dict:
    del spool
    source_ref = f"{quarantine_prefix}/{manifest['id']}"
    promoted = _text(
        run(
            repo,
            ["log", "HEAD", "--format=%H", "--fixed-strings", f"--grep=KB-Outbox-ID: {manifest['id']}", "-1"],
        ).stdout
    ).strip()
    if promoted and _run_without_check(run, repo, ["diff", "--quiet", source_ref, promoted]).returncode != 0:
        raise RuntimeError("existing promotion commit tree differs from its source commit")
    if not promoted:
        run(repo, ["cherry-pick", "--no-commit", source_ref])
        run(
            repo,
            ["commit", "-m", f"chore(outbox): promote {manifest['id']}", "-m", f"KB-Outbox-ID: {manifest['id']}"],
        )
        promoted = _text(run(repo, ["rev-parse", "HEAD"]).stdout).strip()
        if COMMIT_RE.fullmatch(promoted) is None:
            raise RuntimeError("promoted commit is invalid")
        run(repo, ["push", "origin", "HEAD:refs/heads/ops"])
    return {
        "schema": "kb.ops-promotion/v1",
        "id": manifest["id"],
        "sourceCommit": manifest["commit"],
        "promotedCommit": promoted,
        "promotedAt": utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def promote_pending(
    spool: Path,
    operator_repo: Path,
    work_root: Path,
    trusted_ops_head: str,
    max_attempts: int = 3,
    run_git=run_git,
    clone_fresh=clone_fresh,
    approval: Path | None = None,
    approval_signature: Path | None = None,
    approval_allowed_signers: Path | None = None,
) -> dict[str, int]:
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")
    chain = order_from_parent(validate_snapshot(spool), trusted_ops_head)
    receipt_chain = [read_matching_receipt(spool, item) for item in chain]
    first_gap = next(
        (index for index, receipt in enumerate(receipt_chain) if receipt is None),
        len(receipt_chain),
    )
    if any(receipt is not None for receipt in receipt_chain[first_gap:]):
        raise RuntimeError("promotion receipts are not a parent-order prefix")
    initial_pending = chain[first_gap:]
    if not initial_pending:
        return {"promoted": 0, "pending": 0, "failed": 0}

    for attempt in range(1, max_attempts + 1):
        repo: Path | None = None
        try:
            repo = clone_fresh(
                operator_repo,
                work_root / f"attempt-{attempt}-{secrets.token_hex(4)}",
            )
            remote_head = _text(
                run_git(repo, ["rev-parse", "refs/remotes/origin/ops^{commit}"]).stdout
            ).strip()
            if COMMIT_RE.fullmatch(remote_head) is None:
                raise RuntimeError("origin/ops head is invalid")
            quarantine_prefix = f"refs/kb-quarantine/{secrets.token_hex(6)}"
            try:
                validated = validate_quarantine_chain(
                    spool, repo, trusted_ops_head, quarantine_prefix, run_git,
                )
            except subprocess.CalledProcessError as error:
                raise RuntimeError(
                    "quarantine validation failed on untrusted outbox contents "
                    f"(not a transport fault): {error}"
                ) from error
            require_instruction_approval(
                validated, approval, approval_signature, approval_allowed_signers,
            )
            receipts = [read_matching_receipt(spool, item) for item in validated]
            completed_receipts = [receipt for receipt in receipts if receipt is not None]
            expected_remote = completed_receipts[-1]["promotedCommit"] if completed_receipts else trusted_ops_head
            try:
                recover_receiptless_remote_prefix(
                    spool, repo, validated, expected_remote, remote_head, quarantine_prefix, run_git,
                )
            except subprocess.CalledProcessError as error:
                raise RuntimeError(
                    "quarantine recovery failed on untrusted outbox contents "
                    f"(not a transport fault): {error}"
                ) from error
            for manifest in validated:
                if read_matching_receipt(spool, manifest) is not None:
                    continue
                receipt = promote_one(spool, repo, manifest, quarantine_prefix, run_git)
                write_receipt_durably(
                    spool / "receipts" / f"{manifest['id']}.json", receipt,
                )
            remaining = sum(read_matching_receipt(spool, item) is None for item in chain)
            return {
                "promoted": len(initial_pending) - remaining,
                "pending": remaining,
                "failed": 0,
            }
        except subprocess.CalledProcessError:
            if repo is not None:
                _run_without_check(run_git, repo, ["cherry-pick", "--abort"])
    remaining = sum(read_matching_receipt(spool, item) is None for item in chain)
    return {
        "promoted": len(initial_pending) - remaining,
        "pending": remaining,
        "failed": remaining,
    }


def write_instruction_approval_request(
    chain: list[dict],
    approval: Path,
    repo: Path,
    quarantine_prefix: str,
    run=run_git,
) -> None:
    approval.parent.mkdir(parents=True, exist_ok=True)
    expected = _canonical_json(approval_value(chain))
    if approval.exists() and _read_regular_bytes(approval) != expected:
        raise RuntimeError("existing approval request differs from the quarantined chain")
    if not approval.exists():
        approval.write_bytes(expected)
    for manifest in chain:
        target = approval.parent / f"{manifest['id']}.manifest.json"
        raw = _canonical_json(manifest)
        if target.exists() and _read_regular_bytes(target) != raw:
            raise RuntimeError("existing approval manifest copy differs")
        if not target.exists():
            target.write_bytes(raw)
    for manifest in chain:
        instruction_paths = [path for path in manifest["paths"] if INSTRUCTION.fullmatch(path)]
        if not instruction_paths:
            continue
        source_ref = f"{quarantine_prefix}/{manifest['id']}"
        for args in (
            ["diff", "--stat", manifest["parent"], source_ref, "--", *instruction_paths],
            ["diff", "--no-ext-diff", "--binary", manifest["parent"], source_ref, "--", *instruction_paths],
        ):
            output = _text(run(repo, args).stdout)
            if output:
                sys.stdout.write(output)


def _last_promoted_target(spool: Path, chain: list[dict]) -> str:
    if not chain:
        raise RuntimeError("cannot reconcile an empty outbox chain")
    receipts = [read_matching_receipt(spool, item) for item in chain]
    if any(receipt is None for receipt in receipts):
        raise RuntimeError("cannot reconcile while promotion receipts are pending")
    return receipts[-1]["promotedCommit"]


def create_return_bundle(
    operator_repo: Path,
    work_root: Path,
    expected_target: str,
    run=run_git,
    clone=clone_fresh,
) -> tuple[Path, Path]:
    repo = clone(operator_repo, work_root / f"return-{secrets.token_hex(4)}")
    run(repo, ["fetch", "--no-tags", "origin", "ops"])
    target = _text(run(repo, ["rev-parse", "refs/remotes/origin/ops^{commit}"]).stdout).strip()
    if target != expected_target:
        raise RuntimeError("origin/ops does not equal the just-promoted target")
    run(repo, ["update-ref", "refs/kb-reconciled/ops", "refs/remotes/origin/ops"])
    bundle = repo.parent / f"ops-return-{secrets.token_hex(4)}.bundle"
    _run_with_timeout(
        run, repo, ["bundle", "create", str(bundle), "refs/kb-reconciled/ops"], TRANSPORT_TIMEOUT,
    )
    heads = _text(run(repo, ["bundle", "list-heads", str(bundle)]).stdout).splitlines()
    if heads != [f"{expected_target} refs/kb-reconciled/ops"]:
        raise RuntimeError("return bundle advertised ref mismatch")
    return bundle, repo


def upload_and_apply_reconciliation(
    vm_host: str,
    bundle: Path,
    receipts: Path,
    source_head: str,
    target_head: str,
    run=subprocess.run,
    reconciliation_script: str = "/usr/local/lib/kb/apply_ops_reconciliation.py",
) -> None:
    if not SAFE_HOST.fullmatch(vm_host) or vm_host.startswith("-"):
        raise ValueError("vm host must be an SSH hostname with optional user")
    token = secrets.token_hex(12)
    remote = f"/var/tmp/kb-ops-reconcile-{token}"
    run(["ssh", vm_host, "mkdir", "-m", "0700", "--", remote], check=True, timeout=COMMAND_TIMEOUT)
    run(["scp", "--", str(bundle), f"{vm_host}:{remote}/ops-return.bundle"], check=True, timeout=TRANSPORT_TIMEOUT)
    run(["scp", "-r", "--", str(receipts), f"{vm_host}:{remote}/receipts"], check=True, timeout=TRANSPORT_TIMEOUT)
    run(
        [
            "ssh", vm_host, "sudo", "flock", "-x", "/run/lock/kb-maintenance.lock",
            "python3", "-I", "-B", reconciliation_script,
            "--repo", "/var/lib/kb/ops", "--spool", "/var/lib/kb/state/outbox",
            "--bundle", f"{remote}/ops-return.bundle", "--receipts", f"{remote}/receipts",
            "--expected-source-head", source_head, "--expected-target-head", target_head,
        ],
        check=True,
        timeout=120,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Promote VM outbox bundles from a trusted desktop")
    parser.add_argument("--spool", type=Path, required=True, help="parent directory for immutable snapshots")
    parser.add_argument("--repo", type=Path, required=True, help="operator checkout, queried only for origin URL")
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--vm-host", required=True)
    parser.add_argument("--trusted-ops-head", required=True)
    parser.add_argument("--approval", type=Path)
    parser.add_argument("--approval-signature", type=Path)
    parser.add_argument("--approval-allowed-signers", type=Path)
    parser.add_argument("--max-attempts", type=int, default=3)
    args = parser.parse_args()

    snapshot = args.spool / f"snapshot-{secrets.token_hex(12)}"
    fetch_vm_outbox(args.vm_host, snapshot)
    manifests = validate_snapshot(snapshot)
    chain = order_from_parent(manifests, args.trusted_ops_head)
    source_head = (snapshot / "SOURCE_HEAD").read_text(encoding="ascii").strip()
    if not chain or chain[-1]["commit"] != source_head or chain[0]["parent"] != args.trusted_ops_head:
        raise RuntimeError("VM source head does not equal the closed outbox chain")

    all_receipted = all(read_matching_receipt(snapshot, item) is not None for item in chain)
    if (
        not all_receipted
        and any(any(INSTRUCTION.fullmatch(path) for path in item["paths"]) for item in chain)
        and args.approval_signature is None
    ):
        inspection_repo = clone_fresh(args.repo, args.work_root / f"approval-{secrets.token_hex(4)}")
        prefix = f"refs/kb-quarantine/{secrets.token_hex(6)}"
        validated = validate_quarantine_chain(snapshot, inspection_repo, args.trusted_ops_head, prefix)
        approval = args.approval or snapshot / "instruction-approval.json"
        write_instruction_approval_request(validated, approval, inspection_repo, prefix)
        print(f"approval required: sign {approval}", file=sys.stderr)
        return 3

    result = promote_pending(
        snapshot,
        args.repo,
        args.work_root,
        args.trusted_ops_head,
        args.max_attempts,
        approval=args.approval,
        approval_signature=args.approval_signature,
        approval_allowed_signers=args.approval_allowed_signers,
    )
    if result["pending"]:
        print(json.dumps(result, sort_keys=True))
        return 1
    target = _last_promoted_target(snapshot, chain)
    bundle, _repo = create_return_bundle(args.repo, args.work_root, target)
    upload_and_apply_reconciliation(
        args.vm_host, bundle, snapshot / "receipts", source_head, target,
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
