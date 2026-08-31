# W0 decision board v2 — bake-off plan + stack recommendation

v2 2026-08-31, rewritten after opus adversarial review (BLOCKING, 27 findings — all folded
or explicitly declined below). GATE: Daniel picks stacks + approves spend.

## Test 0 — the distribution ceiling (cheapest, highest-stakes, runs first)

The one assumption every downstream dollar rests on: a disclosed-AI persona posting
swimwear/lingerie-register content can build reach on Instagram at all, under Meta's
AI-labeling and "sexually suggestive" recommendation rules, via API publishing.
**Test:** one professional test account (Daniel creates; disclosure copy his), ~10
in-register images published through the Graph API over 2 weeks; watch reach, AI-label
behavior, recommendation eligibility. Cost ≈ $0. Runs in parallel with the bake-off; a
supplementary policy report (r5-meta-ai-policy.md) is being researched now.

## Provenance + identity seeding (blocking-finding fix)

- **Provenance rule (absolute):** reference images are 100% synthetic. No real person's
  photos ever enter a training set, reference set, or face-swap source. This is a legal
  wall (Flux digital-replica bar, Glambase/Kling/Pika/Luma consent clauses) and a project
  law, checked at qa-gate.
- **Seeding protocol:** ONE canonical synthetic reference set is created first — generate
  candidates with a base model, curate ~20 multi-angle/multi-lighting images of one test
  character — and EVERY stack (Soul ID, LoRA, PuLID, SaaS) is seeded from that same set.
  No stack is seeded by another competing stack's generator.

## Stills bake-off (revised candidates + an actual protocol)

| # | Stack | Est. cost | Rationale |
|---|-------|-----------|-----------|
| 0 | Leonardo API policy probe | $0 (free $5 credit) | Cheapest register-policy datapoint; not a finalist |
| 1 | Higgsfield Soul ID | ~$25 (month-to-month; $19 is the annual-commit rate) | Best SaaS realism reputation + API; its filter's swimwear false-positive risk is the open question; note routed-model moderation varies |
| 2 | ZenCreator | ~$20 (200 non-expiring credits) | REST API + MCP, explicit register support, non-expiring credits — replaces Glambase (no API, manual-only; run Glambase only if both API SaaS fail) |
| 3 | ComfyUI + SDXL **RealVisXL** + char LoRA (ostris/kohya), rented 24GB pod | ~$3–6 pod wall-clock | License-clean open path; RealVisXL per r1 edges Juggernaut on portrait/close-up realism. Ceiling claim is "best community-fine-tune", not Flux's — Flux needs a paid BFL commercial license (priced later if SDXL disappoints) |
| 4 | PuLID-FLUX/SDXL arm (Apache-2.0, tuning-free, ~12–16GB) | ~$1–2 pod | Removes LoRA training wall-clock (the plan's one unpinned quantity); license-clean unlike InstantID/FaceID |

**Protocol:** 40 stills per stack from a locked 10-prompt matrix (bedroom/window-light/
mirror/outdoor × distances), same seed policy, same reference set. Scoring is **blinded**:
outputs shuffled and stack-stripped before grading; rubric = identity consistency (vs
reference sheet), realism/anti-gloss (skin texture, lighting), hands/detail integrity;
3-state per image. **Policy probes are separate from quality QC**: a filter rejection is
a policy datapoint, not a quality sample. Next-day regeneration stability on the winner.
Pricing re-verified at execution time before any subscription (r1's own instruction).

## Video bake-off (revised)

**n = 12 per candidate** (two shot types × 6 takes — n=4 can't discriminate yield), same
reference still, same prompt template; reject on identity change/hand warp/gloss/
non-causal motion; failures recorded, no re-prompting.

| # | Candidate | Est. cost | Note |
|---|-----------|-----------|------|
| 1 | Kling — **two arms**: single-still i2v AND multi-image reference mode | ~$3.4–5.9 | Multi-ref is its differentiator; testing it single-still-only would erase the reason it's included |
| 2 | Veo 3.1 Ingredients (Fast tier) | ~$14.4 (Fast $0.15/s × 96s; Ingredients-mode rate unverified — confirm before run) | Promoted from fallback: the only documented CROSS-CLIP identity mechanism in r2 — the criterion we care most about |
| 3 | Wan 2.2 TI2V-5B, rented pod | ~$2–4 | Open-weight path. Verdict scope-limited: a fail reads "5B variant fails", not "open video fails" — A14B (80GB) exists above it |

Dropped to optional baseline: Runway (first-frame-only + policy explicitly limits
lingerie). Remaining fallback: Luma Ray 3.2 (~$3.6 at n=12).

## Posting + metrics architecture (restored r3 items the v1 board dropped)

- Direct Meta Graph API publish (JIT containers, video status polling, live
  `content_publishing_limit`), idempotent queue, manual-approval gate.
- **Token-health monitor** (long-lived tokens die ~60 days; alarms to operator — never a
  hand-copied token in an unattended loop).
- **Multi-account risk named:** Standard access covers operator-administered accounts;
  a multi-account roster may trigger Advanced Access/App Review. Fallback per r3: Buffer/
  Metricool publish while first-party Insights + short-link collection stay ours.
- **Stories/attribution honesty:** story link stickers are NOT API-automatable; the
  strongest link surface is manual-in-the-loop by construction. Choosing Instagram-Login
  (no Page linkage) forfeits API stories entirely — decide at W4 with eyes open.
- Metrics: daily account+media Insights pulls, PLAYS/LIKES labeled, story capture <24h.
- Attribution: Short.io custom domain (paid plan + domain ≈ $10–20/mo — now costed),
  per-door slugs + UTM, mapping stored our side. TikTok: later; its client audit is
  lead-time, start the paperwork when W4 nears.

## Spend ask (honest, worst-case-inclusive)

- Stills: $25 + $20 + ~$5–8 pod = **~$50–55** (Glambase +$15–30 only if both API SaaS fail)
- Video: ~$5.4–9.9 + $14.4 + $2–4 = **~$22–28**; +Luma fallback ~$3.6 if triggered
- Test 0: $0. Short.io + domain: ~$10–20/mo starts at W4, not now.
- **Total this gate: ~$75–90; hard cap $120 including all fallbacks.** Both SaaS subs get
  a calendar cancellation step in the wave plan. GPU line assumes wall-clock billing
  including setup (setup hours ARE pod hours).

## Sequencing

1. Test 0 (IG ceiling) starts immediately — needs Daniel's test account + token.
2. Leonardo $0 policy probe + synthetic reference-set creation (local, free).
3. Open-source pod arm (resolves LoRA wall-clock, the one unbounded quantity) + PuLID arm.
4. Higgsfield + ZenCreator months.
5. Video candidates after stills seeding exists (video needs the reference stills).

## Operator context (r4, corrected)

Fanvue's self-published ramp *including the part we'd live in*: $0–500/mo months 1–3,
$500–2K months 4–6, $2–10K months 6–12 at 200–500 subs. Realistic solo anchor: ~$2.5–4K/mo
at ~150 subs (Hailey Lopez). Caveat: these operators' paid tiers sit above our stated
content ceiling — transferability is an assumption, not a fact. Roster model (The Clueless)
validates multi-ready schema. Follow-up lead: BlackHatWorld thread 1604877.

## Review findings declined (with reasons)

- Eromify stays dropped (its non-expiring credits noted, but "looks AI-generated" hits our
  #1 criterion; ZenCreator provides the pay-per-use-ish structure instead).
- Face-swap (ReActor) not added as a bake-off arm — kept in toolkit for salvage passes at
  qa-gate; maintained line's mandatory NSFW pre-filter noted (unmaintained strip-forks are
  out of bounds).
