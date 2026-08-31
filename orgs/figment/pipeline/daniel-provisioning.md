# Provisioning list — Daniel-only items

Constitution: agents never create accounts, hold credentials as objects, or spend money.
Everything below is yours to do; keys land in the runner environment, never in this repo.

## Paid — unblocks the confirmation trial (cap $40 approved)

| # | Item | Cost | Why | What I need |
|---|------|------|-----|-------------|
| 1 | RunPod account + credits | ~$15 | LoRA training + 40-still batches + Wan clips (SFW workload — within their ToS) | API key in env `RUNPOD_API_KEY` |
| 2 | ZenCreator credit pack | $19.99 | The head-to-head arm: their NSFW SaaS vs our LoRA, blinded | API key in env `ZENCREATOR_API_KEY` |
| 3 | Kling API credits | ~$5 | Video micro-test (multi-image reference mode) | API key in env `KLING_API_KEY` |

Buy in that order — 1 alone unblocks the arms that matter most. Note both 2 and 3 are
prepaid credits, not subscriptions: nothing to cancel later.

## Free — the two verify-first actions

**4. Test 0 — Instagram reach ceiling.** Create one Instagram **professional** account
(Business or Creator) for a throwaway test persona; put the AI disclosure in the bio and
turn on the AI-generated-profile label. Create a Meta developer app, connect the account,
and generate a long-lived token with `instagram_business_basic` +
`instagram_business_content_publish`. Token in env `META_IG_TOKEN`, account id in
`META_IG_USER_ID`. Then I publish ~10 in-register images over two weeks with
`is_ai_generated` set and we watch reach, labeling, and recommendation eligibility.
This is the assumption every downstream dollar rests on.

**5. Fanvue written confirmation.** Ask Fanvue support, in writing, whether a disclosed
fictional AI-persona creator account with our intended monetisation config will be
approved — and keep the reply. R7 named this the single highest-impact unknown: it
resolves platform + payment continuity before we train a persona LoRA worth protecting.

## Deferred (not now)

Explicit-lane GPU hardware (16–24 GB, ~$1.2–2.5K one-time) — decide only after the trial
proves the pipeline. Short.io custom domain + hosting (~$10–20/mo) — starts at W4.
