---
id: 6a6c3ef9-c9d9cdb6
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-fyt-run
risk-tier: T1
owner: codex-worker
claim-token: c513b9f9a0b4b677
state: done
approval: null
workflow: 019fb6d3-b3cc-7d41-8ac0-3182f034cb56
depends-on: []
variant-group: null
role: work
session-id: 6a6c3e5f-f29a5890
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Follow-up: stripTerminalControl loses cursor-positioned line structure — marker can never match

Same worktree as before: `C:/Users/danie/kb-worktrees/boss-fyt-run`, file
`dashboard/server/control/rosterSessions.ts` (+ its test file). Your previous MCP/deny fix is
committed; work on top of current HEAD there.

\## Live evidence (dry-check run, fyt-story pty, captured verbatim over the real WS transport)

The agent printed the completion marker; the daemon never matched it. Raw bytes around the marker:

```
[mpass was skipped and every\u001b[29;3Hsource is marked evergreen-verify, noted in the file header for the researcher.\u001b[K\u001b[30;3H-\u001b[1CHuman gate g0-idea-pick now blocks the next stage; no self-advancement.\u001b[K\u001b[31;6H\u001b[K\u001b[32;3HFYT-STAGE-DONE idea 56ce2c3254c75fdacfc1255a2f1bccf0 5 ranked deep-path\u001b[1Cidea\u001b[1Cbriefs\u001b[1Cwritten\u001b[1Cto\u001b[33;3Hchannel
```

After the current `stripTerminalControl`, that becomes ONE glued line:

```
...no self-advancement.FYT-STAGE-DONE idea 56ce2c3254c75fdacfc1255a2f1bccf0 5 ranked deep-pathideabriefswrittentochannels/...
```

Two defects, both in `stripTerminalControl` (~line 437):
1. CUP (absolute cursor position, `ESC[<row>;<col>H`, also the `f` HVP form) is deleted with no
   substitute → successive painted lines glue; prose lands ahead of the marker on the reconstructed
   line, and the anchored MARKER regex (correctly, anti-smuggling) refuses it.
2. CUF (cursor forward, `ESC[<n>C`) is deleted with no substitute → the renderer uses it in place of
   spaces, so words glue (`deep-pathideabriefs`).

\## Work order

1. In `stripTerminalControl`, BEFORE the CSI catch-all replace:
   - CUP/HVP (`ESC[<params>H` / `ESC[<params>f`) → `'\n'`
   - CUF (`ESC[<n>C`) → one `' '`
   Keep everything else exactly as is (the catch-all still removes remaining CSI, OSC, C0 handling,
   `\r`→`\n`).
2. Think through and note (in the function doc comment, tersely) the effect on the OTHER consumers of
   the stripped stream: `scan`'s line splitting (the beneficiary), `entry.screen` →
   `classifyFrame`/`detectReplReadinessFresh`/`detectTurnEngaged` (extra newlines in the readiness
   window must not change classification — check how frames/lines are read there), and
   `frameHasDeliveryLine` (whitespace-insensitive already). If any consumer needs a matching
   adjustment, make it; do not regress the frozen-busy freshness gate.
3. Anti-smuggling property must hold: a marker QUOTED mid-prose must still fail. Note that CUP→\n can
   put renderer-wrapped quoted text at line start — that was already possible with `\r\n` wrapping;
   the per-delivery token + stage-id check in `scan` remains the true guard. State this in the test.
4. Tests (extend the existing marker/scan test groups):
   a. THE FIXTURE ABOVE, verbatim (JS string with the real escapes): after strip, `scan`-style
      line-split + `matchCompletionMarker` finds exactly one marker with verdict DONE, stageId
      `idea`, token `56ce2c3254c75fdacfc1255a2f1bccf0`, and a summary beginning `5 ranked deep-path`
      with word gaps restored (`deep-path idea briefs written to`).
   b. CUF substitution: `A\u001b[1CB` → `A B`.
   c. Anchoring preserved: `prose then FYT-STAGE-DONE idea <32hex> x` on ONE line (no CUP) still
      fails to match.
   d. Existing suite stays green — run the full rosterSessions test file; report counts.
5. tsc clean. Do NOT commit. Report diffstat + test counts + one-line summary.

\## Do NOT touch
`.mcp.json`, harness scratchpad files, anything outside the two named dashboard files.

## Result

Implemented; no commit created.

- CUP/HVP now inserts `\n`; CUF inserts one space before CSI catch-all.
- Added live PTY capture regression, CUF/HVP checks, and anchoring/anti-smuggling test.
- Documented readiness/frame consumer impact; no matching code adjustment was needed.

Verification: `rosterSessions.test.ts` — 1 file, 97 passed; `tsc --noEmit` — passed.

Diffstat: 2 files, 37 insertions, 2 deletions.

Summary: cursor-positioned completion markers now remain separate scan lines with restored word gaps.
