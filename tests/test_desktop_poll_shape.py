"""Task 2.6 — shape/prose test for scripts/desktop_poll.ps1.

Mirrors the prose-assertion style of tests/test_nightly_routine.py: this does
not execute PowerShell (no Windows Task Scheduler in CI); it asserts the
SCRIPT TEXT carries the conventions scripts/desktop_dispatch.ps1 (the existing
pinned-interpreter wrapper — ground truth for this shape) already established,
so a future silent-no-op regression (bare `python` resolving to a pip-less
build, preamble skipped but task still reporting success) can't creep back in.
"""
import re
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "desktop_poll.ps1"


def _text() -> str:
    return SCRIPT.read_text(encoding="utf-8")


def test_script_exists():
    assert SCRIPT.exists(), "scripts/desktop_poll.ps1 must exist"


def test_pins_the_interpreter_and_never_calls_bare_python():
    text = _text()

    # Resolves py-launcher's real interpreter once, exactly like
    # desktop_dispatch.ps1 — never trusts a bare `python` on PATH.
    assert re.search(r"py -c .*sys\.executable", text), (
        "must resolve the pinned interpreter via `py -c \"...sys.executable\"`, "
        "like desktop_dispatch.ps1"
    )

    # No line anywhere invokes a bare `python` (word-boundary — `$py`/`py -c`
    # calls used to resolve the interpreter are fine; a literal `python ...`
    # invocation is the silent-no-op trap this shape guards against).
    for line in text.splitlines():
        if line.strip().startswith("#"):
            continue
        assert not re.search(r"(?<![\w.\\/-])python(?![\w.\\/-])", line), (
            f"line invokes bare `python` instead of the pinned interpreter: {line!r}"
        )

    # The resolved interpreter variable must be the one used to run scripts.
    assert re.search(r"&\s*\$py\b", text), (
        "must invoke work through the resolved $py variable, not a hardcoded path"
    )


def test_preamble_gate_runs_before_any_poll_work():
    text = _text()

    assert "scripts/preamble.py" in text, "must run the shared preamble first"
    pre_idx = text.index("scripts/preamble.py")

    # The STOP/budget fail exit code (2) must be handled distinctly from a
    # genuine crash — mirrors desktop_dispatch.ps1's $pre -eq 2 / -eq 0 split.
    assert re.search(r"\$pre\s+-eq\s+2", text), (
        "must branch on preamble's STOP/budget exit code (2) distinctly"
    )
    assert re.search(r"\$pre\s+-eq\s+0", text), (
        "must branch on preamble's OK exit code (0) before polling"
    )

    # The actual invocation ("import telegram_poll", the module import inside
    # the embedded poll step) must appear textually AFTER the preamble call —
    # the gate runs before any work, never after. (A design-doc mention of
    # "telegram_poll" in the header comment block, ahead of the preamble
    # call, is fine — it's prose, not an invocation.)
    invoke_markers = [m.start() for m in re.finditer(r"import telegram_poll", text)]
    assert invoke_markers, "script must invoke telegram_poll (import telegram_poll) somewhere"
    assert min(invoke_markers) > pre_idx, (
        "telegram_poll must be invoked after the preamble gate, not before"
    )


def test_fails_loud_never_swallows_errors():
    text = _text()

    assert re.search(r"LASTEXITCODE", text), (
        "must inspect $LASTEXITCODE rather than assume success"
    )
    assert re.search(r"Write-.*Log", text), (
        "must write a log line for every exit path (loud failure, like desktop_dispatch.ps1)"
    )
    # A crash path (unexpected preamble exit code) must not swallow the error —
    # it must exit non-zero rather than treat every unhandled path as success.
    assert re.search(r"exit\s+1\b", text), (
        "an unrecognised/crash exit path must exit 1, not fall through to exit 0"
    )


def test_reads_bot_token_from_credential_manager_never_from_repo():
    text = _text()

    assert re.search(r"Credential Manager", text, re.IGNORECASE), (
        "must document reading the bot token from Windows Credential Manager"
    )
    assert "KB_TELEGRAM_BOT_TOKEN" in text, (
        "must populate the ambient KB_TELEGRAM_BOT_TOKEN env var telegram_send's "
        "default_token_loader convention already establishes"
    )
    # Never a literal bot-token value or a repo write of the credential.
    assert not re.search(r"[0-9]{6,}:[A-Za-z0-9_-]{30,}", text), (
        "must never contain a literal Telegram bot token"
    )


def test_shares_the_one_offset_with_desktop_dispatch_via_ops_branch():
    text = _text()

    # The git-native cursor is only ever authoritative if every poller
    # pulls the latest ops state before reading it and pushes immediately
    # after — exactly the protocol desktop_dispatch.ps1 already follows.
    assert "git checkout ops" in text
    assert re.search(r"git pull --rebase origin ops", text), (
        "must pull --rebase origin ops before touching the shared cursor, "
        "like desktop_dispatch.ps1"
    )
    assert re.search(r"git push origin ops", text), (
        "must push the advanced cursor back to ops immediately, like desktop_dispatch.ps1"
    )
    assert re.search(r"one[- ]poller[- ]per[- ]bot", text, re.IGNORECASE), (
        "must document the one-poller-per-bot invariant it upholds"
    )


def test_cadence_note_documents_the_schedule():
    note = SCRIPT.resolve().parents[1] / "routines" / "desktop-poll-cadence.md"
    assert note.exists(), "routines/desktop-poll-cadence.md must document the cadence"
    text = note.read_text(encoding="utf-8")
    assert re.search(r"2.{0,3}5\s*min", text), (
        "cadence note must state the ~2-5 minute interval"
    )
    assert "Task Scheduler" in text
    assert re.search(r"human", text, re.IGNORECASE), (
        "cadence note must state Task Scheduler registration is a human gate"
    )
