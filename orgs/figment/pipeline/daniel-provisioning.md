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

**Compute for the long run (R8 settled this).** Hetzner has no cloud-GPU product — only
dedicated GEX servers. GEX44 (RTX 4000 SFF Ada, 20 GB) is €232.30/mo + €114 setup, no
minimum term; GEX131 (96 GB) is €1,197–2,297/mo. So Hetzner is a *standing-cost* option,
wrong for a one-off trial: RunPod hourly (~$15) stays correct for the trial itself.
Afterwards the real choice is three-way — RunPod hourly at low utilisation, GEX44 flat
once utilisation is high, or buying a 16–24 GB card (~$1.2–2.5K, break-even vs GEX44 in
~4.6–9.5 months). Decide after the trial produces real throughput numbers. Note GEX44's
20 GB covers LoRA training and stills but is marginal for Wan/Hunyuan video.

**Lane 2 on Hetzner — plausible, unconfirmed.** Their AGB 8.2 bans *publishing*
pornographic material and enforcement works by locking the IP the content is reachable
on — wording aimed at public exposure, not private generation on a rented box. Hetzner
never says so explicitly, so it is a reading, not a permission. Default stays
buy-hardware for lane 2 unless Hetzner confirms in writing (see r8 for the exact
questions to ask).

Short.io custom domain + hosting (~$10–20/mo) — starts at W4.
