# Register the PTY host (D3.1 HUMAN GATE)

`scripts/pty_host_launch.cmd` + `dashboard/server/pty/hostMain.ts` are agent-built and rehearsed (a
dry-run under a `STOP` file must no-op — it refuses to listen; see
`dashboard/server/pty/registerPtyHost.rehearsal.test.ts`). **Registering the scheduled task, setting the
rendezvous ACL, and capturing `<DANIEL_SID>` are HUMAN-ONLY steps** — they create/place OS-enforced
identity boundaries and touch the fleet account's stored password, which no agent may handle. Do them by
hand after D3.1a–i are merged, in the order below.

The design this implements: `d31-pty-host-design.md` §7 (registration) + §8 (can't-push verification).
Key pinned fact: **kb-fleet SID = `S-1-5-21-732142867-588960626-3228783940-1007`** (hostMain refuses to
listen unless its own process SID equals this). `<DANIEL_SID>` is captured in step A.

---

## A. Rendezvous dir ACL + `peer.sid` (Daniel, elevated once)

`C:\ProgramData\kb\pty-host\` is the cross-user rendezvous. `ProgramData`'s default ACL grants
`Users: Read` — unacceptable — so replace it with an explicit allowlist and drop the Medium label.

```
mkdir C:\ProgramData\kb\pty-host
icacls C:\ProgramData\kb\pty-host /inheritance:r
icacls C:\ProgramData\kb\pty-host /grant "danie:(OI)(CI)F" "kb-fleet:(OI)(CI)(RX,W)" "SYSTEM:(OI)(CI)F"

:: Capture <DANIEL_SID> and write peer.sid (Daniel-WRITE-only → its provenance is OS-guaranteed).
whoami /user                                            :: record <DANIEL_SID> (S-1-5-21-…)
> C:\ProgramData\kb\pty-host\peer.sid  echo <DANIEL_SID>
icacls C:\ProgramData\kb\pty-host\peer.sid /inheritance:r /grant "danie:R,W" "kb-fleet:R" "SYSTEM:F"
```

Then set the **Medium integrity label** on the dir and verify **no `Users` / `Authenticated Users` ACE
remains** (`icacls C:\ProgramData\kb\pty-host`). `boot.token` itself is created by hostMain at boot with
its OWN explicit descriptor (kb-fleet FA + `<DANIEL_SID>` FR + SYSTEM FA + Medium `NRNWNX`) and a DACL+label
read-back verify — the dir ACL is the outer guard, the file ACL the inner.

Fail-closed check: `peer.sid` must be exactly one well-formed `S-1-…` SID, and it must NOT equal the
kb-fleet SID — hostMain refuses to authorize itself as its own peer.

## B. node-pty for kb-fleet (D-3: vendor the prebuild, grant read)

The ConPTY prebuild is architecture-specific, not user-specific — a vendored prebuilt binary works for any
user that can READ it. So do NOT rebuild per-user; grant kb-fleet **read** on the launch tree:

```
icacls C:\Users\danie\kb\dashboard\node_modules\node-pty /grant "kb-fleet:(OI)(CI)RX" /T
icacls C:\Users\danie\kb /grant "kb-fleet:(OI)(CI)RX"      :: repo launch tree (read+traverse)
```

(If node-pty was built from source, that is already sufficient — kb-fleet needs only read on the vendored
`build/Release` output, not the VS build toolchain.)

## C. Register the task (kb-fleet, at logon, persistent listener)

```
schtasks /Create /TN "kb-pty-host" ^
  /TR "C:\Users\danie\kb\scripts\pty_host_launch.cmd" ^
  /SC ONLOGON ^
  /RU "kb-fleet" /RP * ^
  /RL LIMITED /F
```

- `/RU kb-fleet /RP *` — Task Scheduler prompts for kb-fleet's password at REGISTRATION (a one-time HUMAN
  credential act; the stored secret lives in the OS task store, never handled as an object by any agent).
- `/RL LIMITED` — Medium IL, matching the label model; the host needs no elevation.
- Grant kb-fleet the **"Log on as a batch job"** right (secpol.msc → Local Policies → User Rights
  Assignment) for a stored-password task.

Confirm the pipe appears (`[System.IO.Directory]::GetFiles("\\.\pipe\") -match 'kb-pty-host'`) and the
dashboard's `openPty` succeeds after a fresh WebAuthn step.

## D. Can't-push verification (as kb-fleet — the identity boundary rests on this)

Open a shell AS kb-fleet (`runas /user:kb-fleet cmd`, or a one-shot task) and confirm it cannot push:

```
cmdkey /list                                                         :: NO github/git credential
set | findstr /I "GITHUB GH_TOKEN GIT_ASKPASS OAUTH ANTHROPIC TOKEN" :: empty
git -C C:\Users\danie\kb push --dry-run origin ops                   :: FAILS (auth/permission)
```

Then from inside a **live PTY opened through the dashboard** (end-to-end proof of the child allowlist):

```
Get-ChildItem Env: | findstr /I "TOKEN OAUTH GITHUB"   :: empty (buildChildEnv allowlist + denylist)
git push --dry-run origin ops                          :: FAILS
```

Record all four results in the D3.1 gate note. If any push SUCCEEDS or any credential is present, STOP —
the identity boundary is not intact and the host must not run.

## E. Factor C — hardware-passkey rehearsal (D3.1 MED mitigation, M8 human gate)

Background: a fleet-PTY open now requires a THIRD factor on top of the peer-SID (A) and per-boot-token
(B) — a **host-verified hardware-passkey WebAuthn assertion over a host-issued fresh nonce** (Factor C).
The daemon issues nothing: the kb-fleet host mints a fresh 256-bit nonce per connection, the browser
signs it with the passkey (physical touch + UV), and the host verifies it via
`scripts/pty_host_assertion_verify.py` (which reuses the frozen `webauthn_verify` primitives). This closes
the MED "any Medium-IL process can read `boot.token` and open a fleet PTY directly, bypassing the WebAuthn
gate" — `boot.token` is now insufficient alone.

Prerequisites (already satisfied for the card channel; reuse the SAME source of truth):
- A passkey is enrolled and `governance/webauthn-credentials.yaml` is committed on the protected ref.
- `scripts/webauthn_verify.py`'s `EXPECTED_CRED_STORE_SHA256` is pinned (NOT the `None` sentinel) — the
  PTY verifier reads the same constant. If it is still `None`, EVERY PTY open fails closed (safe but
  non-functional) until gate D2.12 pins it.
- The dashboard is reachable at the pinned origin/rp-id in the store (e.g. `http://localhost:5317`).

Rehearse ALL of these and record each in the D3.1 gate note (any deviation ⇒ STOP):

1. **Happy path (touch opens a terminal).** Open a fleet terminal in the dashboard. On the `challenge`
   prompt, complete the passkey (touch + biometric/PIN). The terminal opens. Confirm exactly one
   `pty-open`/`opened` row in `ledgers/audit/**` and one host-side accept.
2. **Declined / no touch ⇒ refused.** Start an open and CANCEL / let the passkey time out. The open is
   refused (host-nack); NO shell spawns; the audit shows a refusal, not an open.
3. **Replay ⇒ refused.** Capture a valid assertion (devtools) from one open, then start a SECOND
   connection and present the captured assertion. It is refused: the second connection minted a DIFFERENT
   nonce, so `clientDataJSON.challenge` ≠ the host's expected challenge (check 4). No shell spawns.
4. **Malware simulation (SID + token, no assertion) ⇒ refused.** As Daniel (Medium IL), connect to
   `\\.\pipe\kb-pty-host` directly, present Daniel's SID (A) and a freshly-read `boot.token` (B), and send
   an `open` frame with NO `assertion` (or a garbage one). The host rejects at Factor C
   (`unauthenticated: assertion-missing` / `assertion:*`) and spawns NOTHING. This is the MED itself,
   proven closed.
5. **UV enforced.** If your authenticator can produce a UP-only (no user-verification) assertion, confirm
   it is refused (`user verification (UV) bit not set`). Otherwise note it as covered by the automated
   suite (`tests/test_pty_host_assertion_verify.py::test_uv_zero_rejected`).

Irreducible residual to acknowledge in the note: a fully-hijacked daemon at the exact moment of a
legitimate touch can ride that ONE touch for ONE terminal, once (the single-use per-connection nonce caps
it). DoS by racing the pipe remains (denies service, grants no shell). Both are documented and accepted.
