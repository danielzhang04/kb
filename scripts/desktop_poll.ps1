# desktop_poll.ps1 — pinned-interpreter wrapper for the desktop interactive-poll cadence (task 2.6).
#
# Owns a Task Scheduler task (name TBD by the human at registration — see
# routines/desktop-poll-cadence.md) that fires every ~2-5 minutes. This is the
# ONE Telegram getUpdates poller for the bot (one-poller-per-bot invariant):
# the desktop is the sole poller, cloud never polls concurrently, and the
# desktop is also the sole holder of the bot token (Windows Credential
# Manager — never the repo, never an agent env). Mirrors scripts/desktop_dispatch.ps1's
# shape exactly, which fixed a silent no-op: on this box bare `python` resolves
# to a pip-less msys build with no PyYAML, so the preamble crashed (exit 1) yet
# Task Scheduler still reported success. This script resolves the REAL
# py-launcher interpreter ONCE and drives the whole flow through it,
# propagating every failure loudly.
#
# Shared offset (one-poller-per-bot): the getUpdates offset is the git-native
# cursor at ledgers/approvals/telegram-cursor (scripts/telegram_poll.py,
# ledger.read_cursor/write_cursor) — a coordination write, so like
# desktop_dispatch.ps1 this script operates on branch `ops`: pull --rebase
# origin ops immediately before reading/advancing the cursor, push
# immediately after. Because this script and desktop_dispatch.ps1 both always
# pull the latest ops state before touching anything and push right after,
# there is only ever ONE authoritative cursor value in the repo at any time —
# never two divergent in-memory offsets racing each other.

$ErrorActionPreference = 'Continue'
$RepoRoot = 'C:\Users\danie\kb'
$LogFile  = Join-Path $env:LOCALAPPDATA 'kb-desktop-poll.log'

function Write-PollLog([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), $msg
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

# Resolve the pinned interpreter ONCE — never bare `python`.
$py = $null
try { $py = (py -c "import sys; print(sys.executable)") } catch { $py = $null }
if (-not $py -or -not (Test-Path $py)) { $py = 'py' }

Set-Location $RepoRoot
git checkout ops
git pull --rebase origin ops

# Preamble decides the flow. Capture stdout for log evidence; keep its exit code.
$preOut = (& $py scripts/preamble.py 2>&1 | Out-String).Trim()
$pre = $LASTEXITCODE

if ($pre -eq 2) {
    Write-PollLog ("exit-path=clean-stop preamble=2 (STOP/budget) interpreter=$py :: " + $preOut)
    exit 0
}
elseif ($pre -eq 0) {
    # Bot token: read ONLY from Windows Credential Manager, ONLY here, and
    # handed to the poll step as an ambient env var — never written to the
    # repo, never printed, never persisted anywhere but the process env of
    # this one short-lived run (constitution: never handle a credential as
    # an object). Native Win32 CredRead via P/Invoke — no extra Python
    # package dependency (this box has already bitten us once on a
    # pip-less `python` silently no-op'ing; do not add a second one).
    # HUMAN GATE 2.8 stores the token as a Windows Generic Credential under
    # target name `kb-telegram-bot-token`.
    $CredTarget = 'kb-telegram-bot-token'
    $cred = $null
    try {
        Add-Type -Namespace KbCred -Name Native -ErrorAction Stop -MemberDefinition @'
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
[DllImport("advapi32.dll", SetLastError = true)]
public static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
}
'@
        $credPtr = [IntPtr]::Zero
        $ok = [KbCred.Native]::CredRead($CredTarget, 1, 0, [ref]$credPtr)
        if ($ok -and $credPtr -ne [IntPtr]::Zero) {
            try {
                $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [type][KbCred.Native+CREDENTIAL])
                if ($c.CredentialBlobSize -gt 0) {
                    $bytes = New-Object byte[] $c.CredentialBlobSize
                    [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $c.CredentialBlobSize)
                    $cred = [System.Text.Encoding]::Unicode.GetString($bytes)
                }
            } finally {
                [KbCred.Native]::CredFree($credPtr)
            }
        }
    } catch { $cred = $null }

    if (-not $cred) {
        Write-PollLog ("exit-path=no-credential preamble=OK interpreter=$py :: bot token not found in Windows Credential Manager (target=$CredTarget) — desktop poll skipped this cycle")
        exit 0
    }

    $env:KB_TELEGRAM_BOT_TOKEN = $cred
    $pollOut = (& $py -c @'
import os, sys, json, urllib.request
sys.path.insert(0, "scripts")
import telegram_poll


class _HTTPTransport:
    """Real Telegram Bot API transport for the desktop poll cadence. Token is
    read ONLY from the ambient KB_TELEGRAM_BOT_TOKEN env var (populated by
    this launcher from Windows Credential Manager) — never fetched from a
    credential store by this code itself, mirroring telegram_send.py's
    default_token_loader convention."""

    API_ROOT = "https://api.telegram.org"

    def __init__(self, token):
        self._token = token

    def _call(self, method, payload):
        url = f"{self.API_ROOT}/bot{self._token}/{method}"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def get_updates(self, offset):
        resp = self._call("getUpdates", {"offset": offset, "timeout": 0})
        return resp.get("result", []) if resp.get("ok") else []

    def answer_callback_query(self, callback_query_id, text=None):
        payload = {"callback_query_id": callback_query_id}
        if text is not None:
            payload["text"] = text
        self._call("answerCallbackQuery", payload)

    def edit_message_text(self, chat_id, message_id, text):
        self._call("editMessageText", {
            "chat_id": chat_id, "message_id": message_id, "text": text,
        })


token = os.environ.get("KB_TELEGRAM_BOT_TOKEN")
if not token:
    print("KB_TELEGRAM_BOT_TOKEN is not set", file=sys.stderr)
    sys.exit(1)

new_offset = telegram_poll.poll(".", _HTTPTransport(token), agent="telegram-poll-desktop")
print(f"polled ok new_offset={new_offset}")
'@ 2>&1 | Out-String).Trim()
    $poll = $LASTEXITCODE
    # The token only ever lived in this process's environment; never printed.
    Remove-Item Env:\KB_TELEGRAM_BOT_TOKEN -ErrorAction SilentlyContinue

    if ($poll -ne 0) {
        Write-PollLog ("exit-path=poll-fail preamble=OK poll-exit=$poll interpreter=$py :: " + $pollOut)
        exit $poll
    }

    $changed = git status --porcelain queue ledgers
    if ($changed) {
        git add queue ledgers
        git commit -m "chore: desktop telegram poll"
        git push origin ops
        $push = $LASTEXITCODE
        if ($push -ne 0) {
            Write-PollLog ("exit-path=push-fail preamble=OK poll='$pollOut' push-exit=$push interpreter=$py")
            exit $push
        }
        Write-PollLog ("exit-path=polled+pushed preamble=OK poll='$pollOut' interpreter=$py")
    }
    else {
        Write-PollLog ("exit-path=polled-nochange preamble=OK poll='$pollOut' interpreter=$py")
    }
    exit 0
}
else {
    Write-PollLog ("exit-path=preamble-crash preamble-exit=$pre (LOUD) interpreter=$py :: " + $preOut)
    exit 1
}
