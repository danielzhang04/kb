# W0 decision board v3 — research-based stack pick

v3 2026-08-31. Supersedes v2's paid SaaS bake-off per Daniel's direction: pick from
evidence (r1–r7), confirm with one cheap hands-on trial. New hard requirement folded:
the stack must support nude/semi-nude output of the fictional personas for the paid
tier (disclosed-AI; platforms like Fanvue explicitly permit). GATE: Daniel approves
stack + ~$10–20 trial.

## The pick: two lanes, one identity backbone

**Identity backbone (both lanes):** self-operated ComfyUI + SDXL photoreal checkpoint
(RealVisXL, Juggernaut as B) + one **persona LoRA** per persona (ostris/kohya), PuLID
as consistency add-on/salvage. Why: R6's output evidence ties ComfyUI-LoRA with
Higgsfield at the top (4/4) — but R7 kills every closed SaaS for the paid tier on
rights or trust grounds, and SDXL's RAIL++ license permits lawful adult content while
Flux.1-dev weights are non-commercial without a BFL license. One LoRA drives both
lanes → cross-lane identity consistency for free.

**Lane 1 — IG register (swimwear ceiling):** LoRA stills on rented pods (SFW workload —
fine under pod ToS); video via i2v from our stills — Kling multi-ref / Veo 3.1
Ingredients (mainstream terms OK at this register, filter behavior tested in trial),
Wan 2.2 self-hosted as fallback. Published via Graph API with `is_ai_generated` set.

**Lane 2 — paid explicit (Fanvue-class):** same ComfyUI + LoRA on **operator-controlled
hardware only**. R7's decisive finding: fal, Replicate, RunPod, and Modal ALL prohibit
adult output in published terms — the "rent a pod" plan is dead for this lane. Video:
Wan I2V self-hosted (Apache-2.0, license-clean; Hunyuan excluded — EU/UK territorial
bar). Lane separation is strict: separate asset stores, prompts, accounts.

**Explicit-lane hardware (open decision, not needed until W3+):** local 4070 (8GB) can
run SDXL quantized/slow at reduced res; real throughput needs a 16–24GB GPU (one-time
~$1.2–2.5K) — decide after the trial proves the pipeline. Interim alternative if ever
needed: ZenCreator (only NSFW SaaS with API + published permission) — but R6 scored its
output evidence low and R7 flags processor/trust risk; treat as bridge, never backbone.

## Why the SaaS candidates fell

- **Higgsfield:** top-tier output evidence, but bans the register (swimwear =
  documented filter false-positive; no adult capability at all) → can't serve lane 2,
  and lane 1 doesn't need it once LoRA quality confirms.
- **Glambase:** ToS says generated material remains COMPANY property — fatal for a
  business whose asset library is the moat.
- **Eromify/Fannabe/Sozee:** no retrievable operative terms; R6 evidence weak
  (Eromify's demos contradicted by its own Trustpilot). Not contractually real.
- **OnlyFans:** current guidance = wholly-AI creators may be removed. Fanvue is the
  documented platform fit (verified AI-creator category, disclosure rules, SFW public
  surface, "reasonable person" visual-age test).

## Confirmation trial (replaces the bake-off) — ~$30–40 (Daniel approved 2026-08-31)

Amendment: **ZenCreator head-to-head arm added** ($19.99 credits, no subscription) —
same test-character brief, same 40-still matrix at the swimwear register, blinded
grading against the LoRA arms. Settles "is our stack actually better than the NSFW
SaaS" empirically.

One synthetic test character (provenance law: 100% synthetic references, stated age
23–27, visual-age unambiguous). On a rented pod (SFW workload): train SDXL-RealVisXL
LoRA + a Flux LoRA for comparison (~$5–8 incl. setup wall-clock; also pins the LoRA
training time, our one unbounded quantity). 40 stills, blinded 3-state grading vs the
r6 rubric (identity, anti-gloss, hands). Video micro-test: Kling multi-ref + Wan 2.2
i2v from the same stills (~$5–10). Next-day regen stability. R6's caveat stands — all
public evidence was vendor-tilted (bot walls blocked independent samples), so this
trial is the real referee.

## Verify-in-writing first (Daniel actions, $0)

1. **Test 0** (unchanged): IG professional test account + token; ~10 in-register posts
   via API, 2 weeks of reach/label observation. R5: mandatory AI-profile label is now
   live — labeled accounts take NO reach penalty; suggestive-content suppression is the
   real variable being measured.
2. **Fanvue written confirmation** (R7's #1 fact): that the exact disclosed
   fictional-AI creator account + monetisation config will be approved. Resolves
   platform/payment continuity before any persona LoRA is trained.

## Standing guardrails

Provenance law (no real-person likeness ever, checked at qa-gate) · visual-age
unambiguously adult (prompt age ≠ safeguard, per Fanvue's own test) · disclosure
consistent across IG bio + `is_ai_generated` + Fanvue AI tag · payment-rail
requirements (Mastercard specialty registration etc.) tracked as launch gates ·
distribution age-assurance laws (UK Ofcom, US state) are platform obligations —
relevant if we ever go direct-to-consumer, noted not blocking.

## Evidence base

r1 stills · r2 video · r3 posting/metrics · r4 operators · r5 Meta AI policy ·
r6 output evidence (caveat: vendor-tilted samples) · r7 adult-stack matrix.
Opus adversarial review of v1 folded at v2; v3 re-reviewed before build starts on W2.
