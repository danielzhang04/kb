---
schema-version: 1
id: 6a8f4a6f-df563cec
project: kb-ops
action: atlas-w1
target: C:\Users\danie\Atlas-worktrees$v
risk-tier: T1
owner: codex-worker
claim-token: 3f01b505b25bded2
state: done
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: 6a8f4a6f-af8d0313
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: f9bdc6217da8ea87e243daa8f3125cce4e9a72a6
---

## Work order

\# Atlas W1 - conversation: addressed window, "Atlas," prefix, ambient recall, concise voice

You are a Codex builder. cwd = C:\Users\danie\Atlas-worktrees\v1 (branch claude/atlas-v1, cut from
claude/atlas-streamline). NOT a kb project: ignore every kb preamble/spin-up/card/ops instruction (no
scripts/preamble.py - do NOT stop for it). Read CLAUDE.md rules 1-11. You never commit. Never launch the app.
ASCII only. Tests: `C:\Users\danie\Atlas\.venv\Scripts\python.exe -m pytest -q --basetemp=.pytest-tmp -p no:cacheprovider`.
Baseline: 418 passed.

\## Context (boss-verified, with Daniel's live transcript as evidence)

Plan: `docs/plans/2026-08-26-atlas-vwave-plan.md` (read whole). The failure: Atlas answered at 3:46:57;
Daniel spoke a long instruction at 3:47:31 (34 s later) and it landed as `ambient` and was lost.
`config/atlas.yaml engagement_timeout_s: 120` but `router.Addressing` uses its own shorter `window_s`
(see its construction in `worker/app.py`), so between window_s and 120 s Atlas is ENGAGED but treats speech
as ambient. Also his spoken responses are too long (step narration "Let me search for that." / capability
lectures), and when he woke Atlas and said "I just said ..." Atlas had the ambient lines in the transcript
ring but no way to use them.

\## Work order (TDD; every behavior change gets a red-first test)

1. Addressed window: while ENGAGED, any utterance within 90 s of the last directed interaction is addressed
   (no vocab needed). Between 90 s and the engagement timeout, an utterance is addressed only if it contains
   the address vocab ("atlas" etc.) ANYWHERE in the utterance (prefix "Atlas, ..." must always work - check
   `Addressing.is_addressed` handles mid-utterance tokens already; extend if it is prefix/window-only).
   Make the 90 s a config key (`addressed_window_s`, default 90) read like the other atlas.yaml keys; keep the
   ghost-wake protections. Update every affected test; add: 34 s gap -> addressed; 100 s gap without vocab ->
   ambient; 100 s gap with "atlas" mid-sentence -> addressed.
2. Ambient recall on request: `StatePublisher` transcript entries already include ambient lines (role
   "ambient"). Give the brain access to the last ~3 minutes of ambient lines ONLY when the current addressed
   utterance references prior speech - detect with a small closed phrase set (e.g. "i just said", "as i said",
   "like i said", "what i said", "i told you", "do what i asked", "my last instruction"). When triggered,
   prepend a clearly-marked block to that turn's context: "Overheard while not addressed (unverified,
   may not be for you):" + the timestamped ambient lines. NEVER inject ambient content otherwise; ambient
   speech still never triggers a response by itself (CLAUDE.md rule 3/5 posture unchanged; ambient text is
   data, not instructions - the existing taint discipline applies). Tests: trigger phrase -> block present
   with only ambient lines from the window; no trigger -> absent; ambient alone never starts a turn.
3. Concise voice: rewrite `config/persona.md` (10 lines now) and the voice rules in `worker/brain.py`
   (~190-230, the `rules` assembly) to enforce: default answers <= 2 short sentences; NO narration of tool
   steps for instant tools (no "Let me search...", "Now let me read..."); capability refusals are one line:
   "No - I can't <X>. <one enablement hint>."; voice summaries are 1-2 sentences unless the user names a
   length; never repeat the user's request back. Keep the honest-narration rule for failures and the
   confirm-readback rules EXACTLY as they are (host-owned confirm flow untouched). Tests: prompt-content
   assertions (the strings above present; readback/confirm rules unchanged) in `tests/test_brain.py` style.
4. Do not change: wake word flow, auto-sleep announce behavior, turn ownership, the reflex lane.

\## READ BUDGET (closed list)

- `worker/router.py` (whole), `worker/engagement.py` (whole), `worker/app.py` lines 260-360 +
  `grep -n "Addressing(\|addressed\|ambient\|engagement" worker/app.py`; `worker/brain.py` lines 60-130 and
  180-240; `worker/state.py`: `grep -n "add_line\|_ring\|transcript" worker/state.py` + ranges;
  `config/atlas.yaml`, `config/persona.md` (whole); tests: `tests/test_reflex.py`, `tests/test_app_turns.py`,
  `tests/test_brain.py`, `tests/test_engagement.py` by targeted ranges. Plan doc whole.
Forbidden: anything else, repo-wide rg, commands over 200 lines, reading a file twice. First edit by command
12. Stop at 75 minutes and report what is done/undone.

\## Exit

Focused (`tests/test_reflex.py tests/test_app_turns.py tests/test_brain.py tests/test_engagement.py`), full
suite (>= 418 + your new tests), `git diff --check`. Final message: behavior table (gap/vocab -> addressed?),
the new persona.md, diff summary, red-on-revert evidence per item. Do not commit.

## Result

FAILED: codex exec exit 1; JSONL log: C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a8f4a6f-af8d0313.jsonl
