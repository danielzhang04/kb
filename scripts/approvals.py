"""Human-only approval verification (spec s7).

Two entry points, both fail-closed. The load-bearing invariant of *both* is that
the bytes we authorise are the bytes we authenticate — verification never splits
its inputs across two trust domains.

* ``verify_signed_approval`` — the signed channel. The approval record must be
  introduced by the **web-flow-signed merge commit on the protected ``approvals``
  ref** (real GitHub PR-merge topology: an agent commits the record on
  ``approval/<id>``; the human merges via GitHub, producing a no-ff, web-flow
  signed, human-authored merge commit). We resolve that merge commit along the
  ref's FIRST-PARENT history (never ``git log -1 -- <path>``, which git history
  simplification collapses to the *unsigned* PR-branch commit), verify its
  signature OFFLINE against the pinned ``governance/web-flow.gpg`` keyring, and
  additionally require the ``[GNUPG:] VALIDSIG`` fingerprint to equal the pinned
  web-flow fingerprint. The card is parsed and the I3 ``payload_hash`` recomputed
  from the *committed* bytes of that signing commit (``git show <sha>:<rel>``) —
  and the working tree must not diverge from that object, so the verified content
  and the verified signature are the same bytes (closes the verify→execute
  TOCTOU). The merge-commit author-email must be in ``governance/humans.yaml``'s
  top-level ``emails:`` list (the human who clicked merge).
* ``verify_telegram_approval`` — the possession channel. A tap-minted record
  (``assurance: possession``) whose full payload hash matches the re-read card,
  which carries a valid (present, unexpired) ``expires`` AND is within
  ``MAX_AGE`` of its introducing commit, and which is NOT a novel/first-time T3
  (possession is never admissible for novel T3 per O9/D0 — defense-in-depth at
  the last gate, not only at mint time). The ``from.id`` allow-list is enforced
  upstream at mint time.

``verdict()`` remains a pure, well-tested primitive through which the signed
channel funnels its final state/author/hash/age decision. The former
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

# GitHub's web-flow signing key fingerprint (Gate 1.7 pins this in
# governance/web-flow.gpg). A signature is only accepted when its VALIDSIG
# fingerprint is in this set — a rotated-out or extra key that happens to sit in
# the keyring for historical verification must not newly authorise. Tests pass a
# fixture fingerprint explicitly.
WEB_FLOW_FINGERPRINTS = frozenset({"968479A1AFF927E37D1A566BB5690EEEBB952194"})

# gpg machine-readable status stream: only lines with this literal prefix carry
# trustworthy tokens; the token is the first field after the prefix.
_GNUPG_PREFIX = "[GNUPG:] "
# A revoked / expired key or signature can still emit VALIDSIG — any of these
# present means the signature is NOT good.
_BAD_SIG_TOKENS = ("REVKEYSIG", "EXPKEYSIG", "EXPSIG")
_GPG_TIMEOUT = 30


class VerifyResult(tuple):
    """A ``(ok, reason)`` 2-tuple that also carries the *verified* card+payload.

    Backwards compatible with every ``ok, reason = verify_...()`` caller (it IS a
    2-tuple and compares equal to one), while exposing ``.card`` / ``.payload``
    — the bytes parsed from the committed, signed object — so the executor acts
    on exactly what was verified rather than re-reading the mutable working tree
    (closes the re-read TOCTOU; F5).
    """

    def __new__(cls, ok: bool, reason: str, card=None, payload=None):
        self = super().__new__(cls, (ok, reason))
        self._card = card
        self._payload = payload
        return self

    @property
    def ok(self) -> bool:
        return self[0]

    @property
    def reason(self) -> str:
        return self[1]

    @property
    def card(self):
        return self._card

    @property
    def payload(self):
        return self._payload


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
    Returns (good, signer_identity_or_reason). Fingerprint pinning is layered on
    top of this in ``_verify_commit_signature``.
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


def _validsig_fingerprint(status_text: str) -> str | None:
    """The primary-key fingerprint from the ``[GNUPG:] VALIDSIG`` status line.

    Per gpg's status protocol the VALIDSIG line's LAST field is the fingerprint
    of the primary key that made the signature. Read only from the anchored
    ``[GNUPG:] `` prefix, never a substring of human text.
    """
    for line in status_text.splitlines():
        if not line.startswith(_GNUPG_PREFIX):
            continue
        rest = line[len(_GNUPG_PREFIX):].split()
        if rest and rest[0] == "VALIDSIG" and len(rest) >= 2:
            return rest[-1]
    return None


def _run(cmd, cwd=None, env=None):
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True,
                          text=True, errors="replace", timeout=_GPG_TIMEOUT)


def _verify_commit_signature(sha, repo_root, pinned=None) -> tuple[bool, str | None, str | None]:
    """Offline verify a commit's web-flow signature against the pinned keyring.

    Imports ``governance/web-flow.gpg`` into a SHORT scratch GNUPGHOME under
    %TEMP% (Windows gpg-agent socket-path limit) and runs
    ``git verify-commit --raw`` — proving GitHub, not a local agent, produced
    the commit. The verdict is driven only by the [GNUPG:]-anchored status
    tokens AND the VALIDSIG fingerprint being one of ``pinned`` (defaults to the
    module ``WEB_FLOW_FINGERPRINTS``). Every gpg/git call has a subprocess
    timeout so a hung gpg-agent cannot wedge the run.

    Returns ``(good, signer_identity_or_reason, author_email_or_None)``. A
    missing gpg binary returns ``(False, "gpg unavailable", None)``.
    """
    pinned = WEB_FLOW_FINGERPRINTS if pinned is None else pinned
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
        try:
            listed = _run(["gpg", "--homedir", scratch, "--list-keys"], env=env)
        except subprocess.TimeoutExpired:
            return False, "gpg list-keys timed out", author_email
        if not listed.stdout.strip():
            return False, "keyring import produced no keys", author_email
        try:
            res = _run(["git", "-c", "gpg.program=gpg", "verify-commit", "--raw", str(sha)],
                       cwd=repo_root, env=env)
        except subprocess.TimeoutExpired:
            return False, "verify-commit timed out", author_email
        status = (res.stderr or "") + (res.stdout or "")
        good, detail = _evaluate_status(status)
        if not good:
            return False, detail, author_email
        fpr = _validsig_fingerprint(status)
        if fpr is None:
            return False, "no VALIDSIG fingerprint in status stream", author_email
        allowed = {p.upper() for p in pinned}
        if fpr.upper() not in allowed:
            return False, f"signing key fingerprint {fpr} is not the pinned web-flow key", author_email
        return True, detail, author_email
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
    """Verified human emails from governance/humans.yaml's top-level ``emails:``
    list (lower-cased).

    The signed channel matches the merge-commit author-email against this set
    case-insensitively. The legacy ``humans:`` name list is advisory only (no
    longer a trust input), so an emails source (top-level ``emails:`` or a
    per-human ``github_email`` / ``email``) MUST exist — absent, the caller
    fails closed. Gate 1.8 adds this data to the real governance file.
    """
    path = Path(repo_root) / "governance" / "humans.yaml"
    if not path.exists():
        return set()
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return set()
    if not isinstance(data, dict):
        return set()
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


def _rel_in_repo(card_path: Path, repo_root: Path) -> str | None:
    """POSIX path of ``card_path`` relative to ``repo_root``, or None if the
    file resolves OUTSIDE the repo (out-of-tree / symlink escape). Fail closed."""
    try:
        rp = Path(repo_root).resolve()
        cp = Path(card_path).resolve()
        rel = cp.relative_to(rp)
    except (ValueError, OSError, RuntimeError):
        return None
    return str(rel).replace("\\", "/")


def _resolve_approvals_ref(repo_root: Path, explicit: str | None = None) -> str:
    """The protected approvals ref to verify against. An explicit argument wins;
    otherwise resolve a local ``approvals`` / ``origin/approvals`` branch; else
    fall back to ``HEAD`` (production always passes/has the ref — F5)."""
    if explicit:
        return explicit
    for ref in ("refs/heads/approvals", "refs/remotes/origin/approvals"):
        try:
            r = _run(["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"],
                     cwd=repo_root)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return "HEAD"
        if r.stdout.strip():
            return ref
    return "HEAD"


def _introducing_commit(rel: str, repo_root: Path, ref: str = "HEAD") -> str | None:
    """SHA of the commit that introduced ``rel`` along ``ref``'s FIRST-PARENT
    history — i.e. the merge commit on the protected ref, NOT the (unsigned)
    PR-branch commit that ``git log -1 -- <path>`` would return under git history
    simplification (that mismatch is the F2 blocker). Returns None on failure."""
    try:
        out = _run(["git", "log", "--first-parent", "-1", "--format=%H",
                    ref, "--", f":(literal){rel}"], cwd=repo_root).stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    return out or None


def _committed_card(sha: str, rel: str, repo_root: Path):
    """Parse the card from the EXACT committed bytes of ``<sha>:<rel>`` (the
    signed object), or None. This is the authoritative content — never the
    mutable working tree."""
    try:
        res = subprocess.run(["git", "show", f"{sha}:{rel}"], cwd=repo_root,
                             capture_output=True, timeout=_GPG_TIMEOUT)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    try:
        return cards.parse_text(res.stdout.decode("utf-8", errors="replace"))
    except Exception:  # noqa: BLE001 — any parse/validation failure rejects
        return None


def _worktree_matches_commit(sha: str, rel: str, repo_root: Path) -> bool | None:
    """True iff the working-tree ``rel`` is identical (git-normalised) to
    ``<sha>:<rel>``. None on failure (caller fails closed). This binds the bytes
    the executor will read to the bytes that were signed (F1)."""
    try:
        res = subprocess.run(["git", "diff", "--quiet", str(sha), "--", rel],
                             cwd=repo_root, capture_output=True, timeout=_GPG_TIMEOUT)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if res.returncode in (0, 1):
        return res.returncode == 0
    return None


def _commit_age(sha: str, repo_root: Path) -> datetime.timedelta | None:
    if not sha:
        return None
    try:
        iso = _run(["git", "show", "-s", "--format=%aI", str(sha)],
                   cwd=repo_root).stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if not iso:
        return None
    try:
        dt = datetime.datetime.fromisoformat(iso)
    except ValueError:
        return None
    return _now() - dt


def _check_expires(card: cards.Card, require: bool) -> tuple[bool, str]:
    """Validate the record's ``expires`` field. If ``require`` (possession
    channel), a missing/empty value REJECTS. Malformed dates reject (F7)."""
    expires = card.meta.get("expires")
    if not expires:
        if require:
            return False, "approval has no 'expires' and cannot be valid forever"
        return True, "ok"
    try:
        exp = datetime.datetime.fromisoformat(str(expires))
    except ValueError:
        return False, "approval has an unparseable 'expires' field"
    if _now() >= exp:
        return False, "approval has expired"
    return True, "ok"


def verify_signed_approval(card_path, repo_root, approvals_ref=None,
                           pinned_fingerprints=None) -> VerifyResult:
    """Fail-closed signed-channel trust chain (I1). Returns a ``VerifyResult``
    (a ``(ok, reason)`` tuple carrying ``.card`` / ``.payload`` — the verified,
    committed bytes the executor must act on)."""
    repo_root = Path(repo_root)

    rel = _rel_in_repo(card_path, repo_root)
    if rel is None:
        return VerifyResult(False, "approval record resolves outside the repo (rejected)")

    ref = _resolve_approvals_ref(repo_root, approvals_ref)
    sha = _introducing_commit(rel, repo_root, ref)
    if not sha:
        return VerifyResult(False, "no commit on the approvals ref introduced the record")

    # Authoritative content = the committed bytes of the signing commit.
    card = _committed_card(sha, rel, repo_root)
    if card is None:
        return VerifyResult(False, "approval record is not a committed card on the signing commit")

    if card.meta.get("assurance") != "signed":
        return VerifyResult(False, "record is not a signed-channel approval (assurance != 'signed')")

    approval = card.meta.get("approval")
    if not approval:
        return VerifyResult(False, "card has no approval value")
    try:
        recomputed = payload_hash(card)
    except ValueError:
        return VerifyResult(False, "card has no work order section")

    # F1: the working tree the executor will read must equal the signed object.
    matches = _worktree_matches_commit(sha, rel, repo_root)
    if matches is None:
        return VerifyResult(False, "cannot compare working tree to the signed record")
    if not matches:
        return VerifyResult(False, "working tree differs from the signed approval record (tamper?)")

    # Offline web-flow signature + pinned-fingerprint check on the merge commit.
    good, signer, author_email = _verify_commit_signature(sha, repo_root, pinned_fingerprints)
    if not good:
        return VerifyResult(False, f"web-flow signature verification failed: {signer}")

    allow = _human_emails(repo_root)
    if not allow:
        return VerifyResult(False, "no verified human emails configured in humans.yaml (fail closed)")
    author_norm = (author_email or "").strip().lower()
    if author_norm not in allow:
        return VerifyResult(
            False,
            f"merge-commit author email '{author_email}' is not an allow-listed human")

    # Final state/hash/age decision funnels through the pure primitive.
    age = _commit_age(sha, repo_root)
    if age is None:
        return VerifyResult(False, "cannot determine approval commit age")
    ok, reason = verdict(card.meta.get("state"), author_norm, allow, approval, recomputed, age)
    if not ok:
        return VerifyResult(False, reason, card=card, payload=approval_payload(card))

    ok_exp, reason_exp = _check_expires(card, require=False)
    if not ok_exp:
        return VerifyResult(False, reason_exp, card=card, payload=approval_payload(card))

    return VerifyResult(True, "ok", card=card, payload=approval_payload(card))


def verify_telegram_approval(card_path, repo_root, approvals_ref=None) -> VerifyResult:
    """Fail-closed possession-channel checks. Returns a ``VerifyResult``.

    The tap's ``from.id`` allow-list is enforced upstream at mint time
    (telegram_poll / notify). Here we re-verify, as defense-in-depth at the last
    gate, that the record is possession-class, its full payload hash still
    matches the re-read card, it is NOT a novel/first-time T3 (possession is
    never admissible for novel T3 per O9/D0), it carries a present+unexpired
    ``expires``, AND it is within ``MAX_AGE`` of its introducing commit.
    """
    repo_root = Path(repo_root)
    try:
        card = cards.parse(card_path)
    except Exception as exc:  # noqa: BLE001
        return VerifyResult(False, f"card does not parse: {exc}")

    if card.meta.get("assurance") != "possession":
        return VerifyResult(False, "record is not a possession-channel approval (assurance != 'possession')")
    if card.meta.get("state") != "approved":
        return VerifyResult(False, f"card state is '{card.meta.get('state')}', not 'approved'")

    approval = card.meta.get("approval")
    if not approval:
        return VerifyResult(False, "card has no approval value")
    try:
        recomputed = payload_hash(card)
    except ValueError:
        return VerifyResult(False, "card has no work order section")
    if approval != recomputed:
        return VerifyResult(False, "approval hash does not match action+target+work order (content changed after approval?)")

    # F4: possession is never admissible for a novel/first-time T3 action.
    if card.meta.get("risk-tier") == "T3" and not card.meta.get("established-fast-lane"):
        return VerifyResult(
            False,
            "possession channel is not admissible for novel/first-time T3 (needs the signed channel)")

    # F3: missing 'expires' must reject (no valid-forever possession record).
    ok_exp, reason_exp = _check_expires(card, require=True)
    if not ok_exp:
        return VerifyResult(False, reason_exp, card=card, payload=approval_payload(card))

    # F3: MAX_AGE backstop via the introducing commit, like the signed path.
    rel = _rel_in_repo(card_path, repo_root)
    if rel is None:
        return VerifyResult(False, "approval record resolves outside the repo (rejected)")
    ref = _resolve_approvals_ref(repo_root, approvals_ref)
    sha = _introducing_commit(rel, repo_root, ref)
    age = _commit_age(sha, repo_root) if sha else None
    if age is None:
        return VerifyResult(False, "cannot determine approval commit age")
    if age < datetime.timedelta(0):
        return VerifyResult(False, "approval author date is in the future (clock skew or forgery?)")
    if age > MAX_AGE:
        return VerifyResult(False, f"approval is stale (> {MAX_AGE})")

    return VerifyResult(True, "ok", card=card, payload=approval_payload(card))
