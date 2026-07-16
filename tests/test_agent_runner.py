"""Task 5.3 — shape/prose test for scripts/agent_runner.ps1.

Mirrors the prose-assertion style of tests/test_desktop_poll_shape.py: this does not
execute PowerShell (no Task Scheduler / Codex CLI in CI); it asserts the SCRIPT TEXT
carries the conventions scripts/desktop_dispatch.ps1 (the existing pinned-interpreter
wrapper — ground truth for this shape) already established, plus the Codex-specific
billing guard (O8 decision 5): this runner must NEVER silently fall back to Codex's
metered API.
"""
import re
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "agent_runner.ps1"


def _text() -> str:
    return SCRIPT.read_text(encoding="utf-8")


def _non_comment_lines(text: str):
    return [line for line in text.splitlines() if not line.strip().startswith("#")]


def test_script_exists():
    assert SCRIPT.exists(), "scripts/agent_runner.ps1 must exist"


def test_pins_the_interpreter_and_never_calls_bare_python():
    text = _text()

    # Resolves py-launcher's real interpreter once, exactly like
    # desktop_dispatch.ps1 — never trusts a bare `python` on PATH.
    assert re.search(r"py -c .*sys\.executable", text), (
        "must resolve the pinned interpreter via `py -c \"...sys.executable\"`, "
        "like desktop_dispatch.ps1"
    )

    for line in text.splitlines():
        if line.strip().startswith("#"):
            continue
        assert not re.search(r"(?<![\w.\\/-])python(?![\w.\\/-])", line), (
            f"line invokes bare `python` instead of the pinned interpreter: {line!r}"
        )

    assert re.search(r"&\s*\$py\b", text), (
        "must invoke work through the resolved $py variable, not a hardcoded path"
    )


def test_preamble_runs_before_any_codex_exec_invocation():
    text = _text()

    assert "scripts/preamble.py" in text, "must run the shared preamble first"
    pre_idx = text.index("scripts/preamble.py")

    # Find the first ACTUAL invocation of `codex exec` in real (non-comment) code.
    # Header/doc comments are allowed to cite `codex exec -` as a fact (the task
    # requires citing the verified CLI facts in comments) ahead of the preamble
    # call — that's prose, not an invocation, exactly like test_desktop_poll_shape's
    # treatment of prose mentions of "telegram_poll" vs. the actual "import
    # telegram_poll" invocation.
    offset = 0
    invoke_idx = None
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        if not stripped.startswith("#") and "codex exec" in line:
            invoke_idx = offset + line.index("codex exec")
            break
        offset += len(line)

    assert invoke_idx is not None, (
        "script must invoke `codex exec` in actual (non-comment) code somewhere"
    )
    assert invoke_idx > pre_idx, (
        "codex exec must be invoked after the preamble gate, not before — a "
        "preamble failure must mean codex exec NEVER runs"
    )


def test_billing_guard_checks_env_and_auth_and_login_status():
    text = _text()

    assert "OPENAI_API_KEY" in text, "must check OPENAI_API_KEY"
    assert "CODEX_API_KEY" in text, "must check CODEX_API_KEY"
    # Gate-5.0 decision (keyring storage): auth lives in the Windows Credential
    # Manager (cli_auth_credentials_store = "keyring" in .codex/config.toml),
    # so the runner must NOT gate on an auth.json file existing — `codex login
    # status` is the sole, storage-agnostic probe.
    assert not re.search(r"Test-Path.*auth\.json", text), (
        "must NOT file-existence-check auth.json — keyring storage means no "
        "auth.json exists on disk by design (gate-5.0 decision)"
    )
    assert re.search(r"keyring", text, re.IGNORECASE), (
        "must document the keyring auth-storage posture it relies on"
    )
    assert re.search(r"codex login status", text), (
        "must probe `codex login status` — the sole storage-agnostic check for "
        "missing/expired subscription auth"
    )


def test_stale_auth_wakes_and_exits_loud_never_falls_back_to_metered():
    text = _text()

    assert re.search(r"wake-me", text, re.IGNORECASE), (
        "must file a wake-me card when the billing guard fails"
    )
    assert re.search(r"exit\s+1\b", text), (
        "a billing-guard (or preamble) failure must exit non-zero (loud), not "
        "silently continue"
    )
    # CODEX_API_KEY must only ever be READ (existence-checked) here, never
    # SET/assigned — this runner must never mint or forward a metered-billing
    # override itself; env pollution means something else is misconfigured.
    assert not re.search(
        r"\$env:CODEX_API_KEY\s*=|Set-Item(?:Property)?\s+.*CODEX_API_KEY.*-Value",
        text,
    ), "must never assign/set CODEX_API_KEY — that is metered-billing fallback territory"


def test_stop_checked_at_start_and_rechecked_between_cards():
    text = _text()

    stop_markers = [m.start() for m in re.finditer(r"Test-Path.*STOP", text)]
    assert len(stop_markers) >= 2, (
        "must check the STOP file at least twice: once at start (before any git/codex "
        "work), and again between cards in the per-card loop"
    )
    assert re.search(r"foreach\s*\(", text), (
        "must loop over owned cards (foreach) with a STOP re-check inside the loop body"
    )


def test_ops_checkout_and_pull_mirrors_desktop_dispatch():
    text = _text()

    assert "git checkout ops" in text
    assert re.search(r"git pull --rebase origin ops", text), (
        "must pull --rebase origin ops before doing any work, like desktop_dispatch.ps1"
    )


def test_owned_cards_scanned_by_agent_param():
    text = _text()

    assert re.search(r"param\s*\(", text), "must accept -Agent as a script parameter"
    assert "$Agent" in text
    assert re.search(r"owner", text, re.IGNORECASE), (
        "must filter cards by owner == the -Agent value"
    )


def test_logs_model_id_to_cost_ledger_with_zero_usd_subscription():
    text = _text()

    assert "ledger" in text
    assert re.search(r"['\"]usd['\"]\s*:\s*0(\.0)?", text), (
        "must log the cost-ledger entry with usd 0.0 (subscription billing, never metered)"
    )
    assert re.search(r"subscription", text, re.IGNORECASE)
