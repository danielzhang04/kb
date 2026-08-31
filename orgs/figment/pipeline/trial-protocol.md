# W0 confirmation trial — protocol (v2, slimmed)

Revised 2026-08-31 per Daniel: small samples are enough to judge AI-like vs real-like
and character consistency. Cap ~$40. Blinded grading is the point, not volume.

## Arms

| Arm | Stack | Why it's in |
|---|---|---|
| A | Our build: ComfyUI + SDXL RealVisXL + persona LoRA (rented pod) | The durable path — portable identity, no lock-in |
| B | Civitai (own-LoRA via Orchestration API) | Same open-source checkpoints, hosted. NOTE: its API terms §9.6 ban explicit content while the site permits X/XXX — verify live before trusting for tier 2 |
| C | Eromify | Purpose-built for this exact use case; our quality case against it rests on 48 Trustpilot reviews and zero independent samples — too thin to decide on |

Dropped: ZenCreator, Promptchan, Glambase — added only if A/B/C all disappoint.

## Test character

One synthetic character ("trial-01"), 100% synthetic references, stated age 25, visual
age unambiguously adult, no real-person likeness. Same character brief given to every
arm so identity drift is comparable.

## Stills — 10 per arm

Five prompts × 2 seeds. Prompts chosen to stress the two things that matter:
1. Bedroom window-light portrait (skin texture / gloss test)
2. Mirror selfie, phone visible (the format we actually post)
3. Close-up face with hands in frame (the classic AI tell)
4. Full-body standing, streetwear (proportion consistency)
5. Night interior, ambient low light (lighting realism)

No re-prompting. Failures are data.

## Video — 2 clips per arm that supports it

One slow pan, one simple motion, 5s 9:16, image-to-video from the same approved still.
Arm A uses Kling multi-ref and/or Wan 2.2; B/C use whatever they offer.

## Grading — blinded

All stills pooled, shuffled, arm labels stripped, graded by a fresh agent that does not
know which arm produced what. Three states per image (pass / soft-fail / hard-fail) on:
- identity match to the character brief
- realism / anti-gloss (does it read as a phone photo)
- hands + detail integrity
- lighting plausibility

Second grader on disagreements. Arm score = pass rate + failure taxonomy.
Reuses FYT's `stamp_review.py` three-state model and `build_review_artifact.py` board
(see reuse-from-fyt.md).

## Also recorded per arm

Wall-clock, actual $, throughput, ops friction, and — for A — LoRA training time (the
plan's one unbounded quantity). Next-day regeneration stability on the winner only.

## Spend

Pod ~$5-8 · Eromify credits ~$6-20 (non-expiring, no subscription) · Civitai Buzz ~small
· video ~$3-5. **Est. $20-35, cap $40.** All accounts/payment are Daniel's.

## Exit

Decision memo: blinded winner, SaaS-vs-own verdict, LoRA wall-clock pinned, tier-2
permission status for each arm. Opus adversarial review → Daniel gate → W1.
