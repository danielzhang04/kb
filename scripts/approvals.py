"""Human-only approval verification (spec s7).

Two entry points, both fail-closed:

* ``verify_signed_approval`` — the signed channel. The approval record must be
  introduced by a commit that is web-flow-signed and verified OFFLINE against
  the pinned ``governance/web-flow.gpg`` keyring (proving GitHub, not a local
  agent, performed the merge), the merge-commit author-email must be in
  ``governance/humans.yaml`` (the human who clicked merge), the recomputed I3
  ``payload_hash`` must match the record, and the approval must be unexpired.
* ``verify_telegram_approval`` — the possession channel. A tap-minted record
  (``assurance: possession``) whose full payload hash matches the re-read card
  and is unexpired; the ``from.id`` allow-list is enforced upstream at mint time.

``verdict()`` remains a pure, well-tested primitive. The former
``approved_by_human()`` local-git-author check is gone: a spoofable ``%an`` /
``author.login`` string is no longer a trust input.
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


def _now() -> datetime.datetime:
    """Current UTC time — a seam so tests can pin 'now' deterministically."""
    return datetime.datetime.now(datetime.timezone.utc)


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


def _human_emails(repo_root: Path) -> set[str]:
    """Verified human emails from governance/humans.yaml (lower-cased).

    The signed channel matches the merge-commit author-email against this set.
    The legacy ``humans:`` name list is advisory only (no longer a trust input),
    so an emails source (top-level ``emails:`` or a per-human ``github_email`` /
    ``email``) MUST exist — absent, the caller fails closed. Gate 1.8 adds this
    data to the real governance file.
    """
    path = Path(repo_root) / "governance" / "humans.yaml"
    if not path.exists():
        return set()
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    emails: set[str] = set()
    for e in data.get("emails", []) or []:
        if isinstance(e, str):
            emails.add(e.strip().lower())
    for human in data.get("humans", []) or []:
        if isinstance(human, dict):
            for key in ("github_email", "email", "emails"):
                val = human.get(key)
                if isinstance(val, str):
                    emails.add(val.strip().lower())
                elif isinstance(val, list):
                    emails.update(x.strip().lower() for x in val if isinstance(x, str))
    return emails


def _introducing_commit(card_path: Path, repo_root: Path) -> str | None:
    """SHA of the most recent commit touching the record file (the merge/record
    commit on the approvals ref), or None."""
    rel = str(Path(card_path).relative_to(repo_root)).replace("\\", "/")
    try:
        out = _run(["git", "log", "-1", "--format=%H", "--", f":(literal){rel}"],
                   cwd=repo_root).stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    return out or None


def _commit_age(sha: str, repo_root: Path) -> datetime.timedelta | None:
    try:
        iso = _run(["git", "show", "-s", "--format=%aI", str(sha)],
                   cwd=repo_root).stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if not iso:
        return None
    return _now() - datetime.datetime.fromisoformat(iso)


def _expiry_ok(card: cards.Card, age: datetime.timedelta | None) -> tuple[bool, str]:
    if age is None:
        return False, "cannot determine approval commit age"
    if age < datetime.timedelta(0):
        return False, "approval author date is in the future (clock skew or forgery?)"
    if age > MAX_AGE:
        return False, f"approval is stale (> {MAX_AGE})"
    expires = card.meta.get("expires")
    if expires:
        try:
            exp = datetime.datetime.fromisoformat(str(expires))
        except ValueError:
            return False, "approval has an unparseable 'expires' field"
        if _now() >= exp:
            return False, "approval has expired"
    return True, "ok"


def verify_signed_approval(card_path: Path, repo_root: Path) -> tuple[bool, str]:
    """Fail-closed signed-channel trust chain (I1). Returns (ok, reason)."""
    repo_root = Path(repo_root)
    try:
        card = cards.parse(card_path)
    except Exception as exc:  # noqa: BLE001 — any parse failure rejects
        return False, f"card does not parse: {exc}"

    if card.meta.get("assurance") != "signed":
        return False, "record is not a signed-channel approval (assurance != 'signed')"
    if card.meta.get("state") != "approved":
        return False, f"card state is '{card.meta.get('state')}', not 'approved'"

    approval = card.meta.get("approval")
    if not approval:
        return False, "card has no approval value"
    try:
        recomputed = payload_hash(card)
    except ValueError:
        return False, "card has no work order section"
    if approval != recomputed:
        return False, "approval hash does not match action+target+work order (content changed after approval?)"

    allow = _human_emails(repo_root)
    if not allow:
        return False, "no verified human emails configured in humans.yaml (fail closed)"

    sha = _introducing_commit(card_path, repo_root)
    if not sha:
        return False, "no commit introduced the approval record"
    good, signer, author_email = _verify_commit_signature(sha, repo_root)
    if not good:
        return False, f"web-flow signature verification failed: {signer}"
    if not author_email or author_email.strip().lower() not in allow:
        return False, f"merge-commit author email '{author_email}' is not an allow-listed human"

    return _expiry_ok(card, _commit_age(sha, repo_root))


def verify_telegram_approval(card_path: Path, repo_root: Path) -> tuple[bool, str]:
    """Fail-closed possession-channel checks. Returns (ok, reason).

    The tap's ``from.id`` allow-list and tier admissibility (never novel/
    first-time T3, per O9) are enforced upstream at mint time (telegram_poll /
    notify); here we re-verify the record is possession-class, its full payload
    hash still matches the re-read card, and it is unexpired.
    """
    repo_root = Path(repo_root)
    try:
        card = cards.parse(card_path)
    except Exception as exc:  # noqa: BLE001
        return False, f"card does not parse: {exc}"

    if card.meta.get("assurance") != "possession":
        return False, "record is not a possession-channel approval (assurance != 'possession')"
    if card.meta.get("state") != "approved":
        return False, f"card state is '{card.meta.get('state')}', not 'approved'"

    approval = card.meta.get("approval")
    if not approval:
        return False, "card has no approval value"
    try:
        recomputed = payload_hash(card)
    except ValueError:
        return False, "card has no work order section"
    if approval != recomputed:
        return False, "approval hash does not match action+target+work order (content changed after approval?)"

    expires = card.meta.get("expires")
    if expires:
        try:
            exp = datetime.datetime.fromisoformat(str(expires))
        except ValueError:
            return False, "approval has an unparseable 'expires' field"
        if _now() >= exp:
            return False, "approval has expired"
    return True, "ok"
