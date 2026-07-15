# Playbook — business & policy law (cross-niche)

The always-applicable rules for how content gets made and published here. Channel-specific rules live
in each `channels/<name>/dna.md` and override nothing here on compliance.

## Originality bar (the survival rule)

YouTube's **"inauthentic content" policy** (renamed from "repetitious content" on **2025-07-15**,
actively enforced) makes templated, mass-produced, near-duplicate video ineligible for monetization —
and the penalty hits the **whole channel**, not one video. Reporting during the crackdown cites large
losses (est. ~$10M creator revenue, ~35M subscribers affected).

**What this means for us:**
- Every video must carry **materially different, original substance.** The literal test: *"the average
  viewer can tell the videos differ."*
- Prefer **narrative-driven** shapes (story, argument, original POV) over list/compilation templates —
  narrative can't be photocopied and retains 40–60% better.
- The idea-generator is **forbidden** from "clone this specific rival." Study a format, then
  deliberately differentiate.
- AI-*assisted* content is explicitly allowed by YouTube. The interchangeable *template* is what gets
  killed. Human-supplied angle + quality bar is the requirement.

## Excluded formats (never build these)

- Scraped TikTok/IG reposts. Movie/TV-clip channels (Content ID → strikes → termination; e.g. Screen
  Culture, KH Studio were terminated). No automation makes unlicensed clips safe.
- "Top 10 X" / "amazing facts" / quote-slideshow / stock-footage compilation templates — saturated
  *and* the exact shape being demonetized.

## Compliance facts (not optional preferences)

- No unlicensed copyrighted footage or music.
- Disclose AI/synthetic content where required.
- **Never** create extra Google Cloud projects to multiply upload quota (violates API Terms; suspends
  ALL projects).
- **Audit gate:** an unaudited OAuth app (created after 2020-07-28) uploads every video **locked to
  private**, and the API cannot make it public. Submit the API client for YouTube's compliance audit
  *before* relying on auto-publish; keep the human gate on while pending.

## Quota (verified 2026-06, corrected)

As of **2025-12-04**, `videos.insert` dropped from ~1,600 → ~100 units. The free 10,000 units/day tier
now allows **~100 uploads/day** (the old "~6/day" figure is obsolete). Reads mostly govern the budget
now. Still: **pace uploads slowly** — a young channel posting in bursts reads as spam regardless of
quota.

## Autonomy — trust ramp (current: **Stage 0**)

- **Stage 0** (now, until the YouTube API audit clears): **full human gate.** Draft everything; a
  human approves every publish.
- **Stage 1** (after ≈10 clean human-approved videos AND the audit has cleared): auto-publish
  *approved* scripts; human still gates idea + script.
- **Stage 2** (after `compliance-check` has caught real problems over several weeks): **fully
  autonomous publish;** human reviews after the fact.

Goal state = Stage 2 (a mostly-autonomous loop). Advance only when the current stage has earned it;
record each promotion in `decisions.md`. **Never skip the audit gate.** Human involvement is low by
design — build toward the autonomous loop.

## Format & cadence

- **Long-form is the earner** (RPM ~$1–30). **Shorts are a discovery funnel** (RPM ~$0.03–0.10, ~3–14%
  of long-form) — not an income source.
- **8-minute line:** videos ≥8 min unlock mid-roll ads (+30–100% RPM). The old universal "sweet
  spot 8–15 min" rule is retired (2026-07-01); length bands are now **per niche** and validated
  against 2025-2026 retention data — see the niche playbook file in
  `research/niche-playbooks/<niche>.md` (§Length band). **Retention still beats length** — go
  longer only while holding the length band's benchmark AVD.
- Optimal length varies by niche — see `research/format.md` and the niche playbook.
- Suggested cadence once running: 1–2 long-form/week + 15–30 Shorts/month. Every Short carries a
  specific CTA to its long-form + a pinned comment linking it.

## Production defaults

- **Audience/region:** US, English (best RPM). Overridable per channel in `dna.md`.
- **Budget:** no hard cap set. Still prefer the cheapest tool that clears the quality bar; log spend
  in `stack.md`.
- **Voiceover-led, not cloned-avatar** — avoids the per-identity consent step that would block
  unattended runs. Use an avatar only if a presenter genuinely *is* the format.
- One locked voice ID per channel (identity separation the policy rewards).
- Script carries `[B-ROLL]` and `[PAUSE]` markers that double as the shot list.
- Visual density weighted to the first 60 seconds (where watch-time is won).
- Run a QA/voice check before publish — a wrong-sounding voice noticeably hurts results.

## Economic framing

A portfolio of cheap media bets. Expect **months to first revenue** (bar: 1,000 subs + 4,000 watch
hours, or 10M Shorts views/90 days). Kill niches that find no audience within a couple months; pour
budget into the one or two that do. A real 6-week autonomous test produced ~52 videos / ~30k views.
