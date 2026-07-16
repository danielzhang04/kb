"""Human-only approval verification (spec s7).

verdict() is pure logic (tested); approved_by_human() wires it to git + files.
v1 limitation: local git author is advisory; GitHub branch protection on the
approvals path is the enforced gate. Belt and suspenders.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import yaml

import cards

MAX_AGE = datetime.timedelta(hours=24)

# gpg machine-readable status stream: only lines with this literal prefix carry
# trustworthy tokens; the token is the first field after the prefix.
_GNUPG_PREFIX = "[GNUPG:] "
# A revoked / expired key or signature can still emit VALIDSIG — any of these
# present means the signature is NOT good.
_BAD_SIG_TOKENS = ("REVKEYSIG", "EXPKEYSIG", "EXPSIG")
_GPG_TIMEOUT = 30


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def approval_payload(card: cards.Card) -> str:
    """Canonical I3 payload: action + target + work-order prose.

    ``action`` and ``target`` are JSON-encoded (sorted keys, explicit
    separators) so the payload is *injective across types* — a scalar
    ``"a,b"`` and a list ``["a", "b"]`` serialize differently and never
    collide (a bare comma-join would collapse them). The payload is built
    from the three fields explicitly, so frontmatter key order / whitespace
    does not affect the hash.
    """
    action = card.meta.get("action")
    target = card.meta.get("target")
    enc = lambda v: json.dumps(v, sort_keys=True, separators=(",", ":"))
    return (
        f"action:{enc(action)}\n"
        f"target:{enc(target)}\n"
        f"work-order:\n{work_order_of(card.body)}"
    )


def payload_hash(card: cards.Card) -> str:
    return content_hash(approval_payload(card))


def _evaluate_status(status_text: str) -> tuple[bool, str]:
    """Verdict from gpg's ``--status``/``--raw`` machine-readable stream.

    Tokens are read ONLY from lines beginning with the literal ``[GNUPG:] ``
    prefix, and only as the first whitespace field after it — never a substring
    match against the whole output (an attacker-controlled UID/comment could
    otherwise smuggle a token substring). GOOD iff ``VALIDSIG`` is present AND
    none of ``REVKEYSIG`` / ``EXPKEYSIG`` / ``EXPSIG`` is present. Fail closed.
    Returns (good, signer_identity_or_reason).
    """
    tokens: list[str] = []
    signer = None
    for line in status_text.splitlines():
        if not line.startswith(_GNUPG_PREFIX):
            continue
        rest = line[len(_GNUPG_PREFIX):].split(maxsplit=1)
        if not rest:
            continue
        token = rest[0]
        tokens.append(token)
        if token == "GOODSIG" and len(rest) > 1:
            # GOODSIG <keyid> <user-id>
            sub = rest[1].split(maxsplit=1)
            signer = sub[1] if len(sub) > 1 else rest[1]
    for bad in _BAD_SIG_TOKENS:
        if bad in tokens:
            return False, bad
    if "VALIDSIG" not in tokens:
        return False, "no VALIDSIG status token"
    return True, signer or "unknown signer"


def _run(cmd, cwd=None, env=None):
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True,
                          text=True, errors="replace", timeout=_GPG_TIMEOUT)


def _verify_commit_signature(sha, repo_root) -> tuple[bool, str | None, str | None]:
    """Offline verify a commit's web-flow signature against the pinned keyring.

    Imports ``governance/web-flow.gpg`` into a SHORT scratch GNUPGHOME under
    %TEMP% (Windows gpg-agent socket-path limit) and runs
    ``git verify-commit --raw`` — proving GitHub, not a local agent, produced
    the commit. The verdict is driven only by the [GNUPG:]-anchored status
    tokens. Every gpg/git call has a subprocess timeout so a hung gpg-agent
    cannot wedge the run.

    Returns ``(good, signer_identity_or_reason, author_email_or_None)``. A
    missing gpg binary returns ``(False, "gpg unavailable", None)``.
    """
    repo_root = Path(repo_root)
    if shutil.which("gpg") is None:
        return False, "gpg unavailable", None
    # author email is independent of the signature (git, not gpg)
    try:
        author_email = _run(["git", "show", "-s", "--format=%ae", str(sha)],
                            cwd=repo_root).stdout.strip() or None
    except FileNotFoundError:
        return False, "git unavailable", None
    except subprocess.TimeoutExpired:
        return False, "git show timed out", None
    keyring = repo_root / "governance" / "web-flow.gpg"
    if not keyring.exists():
        return False, "keyring missing", author_email
    scratch = tempfile.mkdtemp(prefix="kbgpg-")
    env = {**os.environ, "GNUPGHOME": scratch}
    try:
        try:
            _run(["gpg", "--homedir", scratch, "--batch", "--import", str(keyring)], env=env)
        except FileNotFoundError:
            return False, "gpg unavailable", author_email
        except subprocess.TimeoutExpired:
            return False, "gpg import timed out", author_email
        # Judge import success by key PRESENCE, not the --import exit code
        # (gpg --import can exit 2 even on success on Windows/MSYS).
        listed = _run(["gpg", "--homedir", scratch, "--list-keys"], env=env)
        if not listed.stdout.strip():
            return False, "keyring import produced no keys", author_email
        try:
            res = _run(["git", "-c", "gpg.program=gpg", "verify-commit", "--raw", str(sha)],
                       cwd=repo_root, env=env)
        except subprocess.TimeoutExpired:
            return False, "verify-commit timed out", author_email
        good, detail = _evaluate_status((res.stderr or "") + (res.stdout or ""))
        return good, detail, author_email
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def work_order_of(body: str) -> str:
    """Extract the first top-level '## Work order' section, fence-aware.

    Rules: a ``` at column 0 toggles fenced-code state; fenced lines are never
    headings. Only column-0 '## ' lines outside fences are headings (no strip).
    Capture only the FIRST '## Work order' section — from the line after the
    exact heading to the next column-0 unfenced '## ' heading (or EOF). Later
    occurrences do not re-arm. Absent heading raises ValueError.
    """
    lines: list[str] = []
    capture = False
    fenced = False
    found = False
    done = False
    for line in body.splitlines():
        if line.startswith("```"):
            fenced = not fenced
            if capture:
                lines.append(line)
            continue
        is_heading = (not fenced) and line.startswith("## ")
        if is_heading:
            if capture:            # next heading ends the first section
                capture = False
                done = True
            elif not done and line == "## Work order":
                capture = True
                found = True
            continue
        if capture:
            lines.append(line)
    if not found:
        raise ValueError("no '## Work order' section")
    return "\n".join(lines).strip()


def verdict(state, author, humans, approval_field, work_order_hash,
            commit_age) -> tuple[bool, str]:
    if state != "approved":
        return False, f"card state is '{state}', not 'approved'"
    if author not in humans:
        return False, f"approver '{author}' is not a listed human"
    if approval_field != work_order_hash:
        return False, "approval hash does not match work order (content changed after approval?)"
    if commit_age < datetime.timedelta(0):
        return False, "approval author date is in the future (clock skew or forgery?)"
    if commit_age > MAX_AGE:
        return False, f"approval is stale (> {MAX_AGE})"
    return True, "ok"


def approved_by_human(card_path: Path, repo_root: Path) -> tuple[bool, str]:
    card = cards.parse(card_path)
    humans_file = Path(repo_root) / "governance" / "humans.yaml"
    humans = (yaml.safe_load(humans_file.read_text(encoding="utf-8")) or {}).get("humans", [])
    try:
        wo_hash = content_hash(work_order_of(card.body))
    except ValueError:
        return False, "card has no work order section"

    # Bind the approver to the commit that INTRODUCED the approval value, not
    # the last commit touching the file. A falsy approval can't be laundered
    # into acceptance by a later unrelated human commit, so reject it early.
    approval = card.meta.get("approval")
    if not approval:
        return False, "card has no approval value"
    rel = str(Path(card_path).relative_to(repo_root)).replace("\\", "/")
    out = subprocess.run(
        ["git", "log", "-1", "--format=%an%n%aI", f"-S{approval}",
         "--", f":(literal){rel}"],
        cwd=repo_root, capture_output=True, text=True, check=True).stdout.strip().splitlines()
    if len(out) < 2:
        return False, "no commit set the approval value"
    author, iso = out[0], out[1]
    age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(iso)
    return verdict(card.meta["state"], author, humans,
                   approval, wo_hash, age)
