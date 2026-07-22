---
id: wake-daniel-2026-07-22-engagement-fold
project: faceless-youtube
action: wake:human-decision
target: orgs/faceless-youtube
risk-tier: T2
owner: daniel
state: inbox
---

## Work order

WAKE-ME (2am authorized night run, 2026-07-22 ~03:45): the engagement doctrine fold is STAGED but the
governed-worker leg is PARKED on a precise infrastructure gap. Your decision needed; nothing else was
attempted per your codex-only ruling.

## Result

**What ran clean:**
- N1 research both landed + committed on `claude/engagement-overhaul` (engagement-gap: 90.6%
  dead-frame vs 6-25% = THE gap, cuts already in band, SFX 2-5x under, VO macro-arc flat, humor
  written-not-sold; engagement-craft: delivery-layer diagnosis, eleven_v3 mechanics, selection
  scorecard, three gated contradictions).
- Six fold trigger cards authored + pushed to ops `queue/inbox/eng-fold-{motion,audio,voice,script,
  grammar,selection}.md` — scanner profile, T2, delta-document outputs, evidence + baselines embedded,
  wording clear of the intent-scanner vocabulary.
- Gate flipped ON (`DASHBOARD_EXECUTION_ACTIVATED=1`), daemon healthy (healthz 200). **Left ON per
  your instruction.**

**The block (diagnosed, not worked around):** the queue bridge (`dashboard/server/control/
queueBridge.ts` — discovery, dispatch, reconcile, ledger settle, all built and test-covered) is
**never constructed or started by the production daemon**. `createQueueBridge`/`dispatchClaimedCard`
are imported by tests only; no boot code starts the poller. Watched 80 minutes: cards untouched,
zero claims, zero log activity. So today the ONLY live launch surface is the passkey-gated UI route —
your WebAuthn, which no autonomous head can or should satisfy. Gate-on is currently inert-in-practice
for queue work: nothing polls.

**Your morning options (pick one):**
1. **Wire the bridge (the durable fix, ~small PR):** daemon boot constructs
   `createQueueBridge({repoRoot, dispatch: dispatchClaimedCard(...)})` and starts it behind the
   existing activation gate. This is THE missing piece of headless governed execution — reviewed PR,
   your merge, then the six cards run exactly as staged, tonight's pattern becomes repeatable.
2. **Passkey + UI now:** I convert the six cards to workflow definitions on ops, you unlock
   localhost:5317 once and click Launch six times; runs go through the proven UI path while the
   bridge PR bakes.
3. **Claude-subagent fold:** authorize the fallback you declined overnight; fold lands on the branch
   in ~an hour, governed-worker rehearsal deferred.

**Naming note (honesty):** the governed executor's production worker adapter spawns claude-CLI fleet
workers (subject `dashboard-engine`, managed `codex/managed-*` branches). A literal OpenAI-codex
worker adapter does not exist in the control plane; the legacy codex path is the disabled
`kb-codex-runner` task. If you specifically want OpenAI-codex workers in the governed plane, that is
its own build decision.

**State:** engagement branch has both research records, UNMERGED, awaiting your review either way.
Six eng-fold-* cards remain in inbox (harmless; nothing polls them; they are the ready payload for
option 1 or convertible for option 2). Full context: docs/handoffs/2026-07-21-engagement-overhaul-
handoff.md + memory engagement-overhaul-arc.
