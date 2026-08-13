---
id: 6a7e17cf-bfc1f6fe
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-taste-forensics
risk-tier: T1
owner: codex-worker
claim-token: a87c18f9647132ed
state: done
approval: null
workflow: 019ffc85-5445-7f61-b0a8-832d9c9217a6
depends-on: []
variant-group: null
role: work
session-id: 6a7e15d4-194eadbc
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Mint round — crowd-exemplar re-roll + 3 flat-fill cast retries (GEN ONLY, no promotion)

You are a codex worker in worktree `C:\Users\danie\kb-worktrees\boss-taste-forensics` (branch
`claude/bricks-taste-forensics`), project `orgs/faceless-youtube`, channel `channels/the-second-take`,
video `videos/2026-07-28-bricks-fresh`. All paths below are relative to the worktree root unless absolute.

\## Context (you start cold)

Task 14 of this arc (read `.superpowers/sdd/2026-08-11-bricks-taste-forensics/task-14-report.md`,
sections "Jobs 2 + 3 — the mint round" onward) minted new character canonicals. Daniel (the human)
has now ruled:

1. **`crowd-exemplar` re-roll** — the minted `assets/library/crowd-exemplar.png` (under the video dir)
   measured ~4.4 heads tall vs the rig law's 3.17 (`refs/base/base.png`, channel visual-kit) and the
   channel precedent's ~3.9 (`refs/base/crowd-exemplar.png`). Proportions are WAY OFF. Re-roll it.
2. **Flat-fill retries** for `return-customer`, `brick-co-seller`, `hr-officer` — their task-14 retry
   frames fixed the ear defect but failed `flat_cel_render` on fabric texture the costume prose invited
   (quilted delivery coat / heavy canvas apron / long tweed skirt). Daniel authorized ONE more targeted
   round each: keep the ear fix, add a flat-fill clause.
3. `trial-judge` and everything else: NOT yours. Do not generate, promote, or stamp anything for them.

\## Work order

\### Job A — the 3 cast retries

- Read `scratchpad/taste-forensics/t14_mint.py` and `t14_retry.py` (in the video dir) — they are the
  sanctioned pattern. Use the SAME route: `forge.py gen --mode new_character --seed refs/base/base.png`
  (the one P3 call-site exemption for genuine new-character mints), ASCII-only prompt text on argv.
- For each character, construct the prompt from its `visual-kit/registry/registry.json` `characters{}`
  row (role / head_tone / costume) exactly as t14_retry did, KEEPING t14_retry's local ear-ban
  restatement (it worked — all four lost their ears), and ADDING a local flat-fill clause immediately
  next to the costume sentence, naming that character's fabric. Shape (adapt per character):
  "the <garment> is one single flat solid colour fill in flat cel shading — no fabric texture, no
  weave, no stitching, no quilting lines, no herringbone, no mottling; the only shading is the style's
  simple two-tone cel shadow". Say what to draw INSTEAD of texture, not just a ban.
- Do NOT alter the registry rows. Do NOT weaken the costume prose (the quilted/canvas/tweed words are
  canonical); the flat-fill clause governs RENDERING, not wardrobe.

\### Job B — crowd-exemplar re-roll

- Same route t14_mint.py used for the crowd job: `forge.py gen --mode environment --aspect 4:3`.
  Carry over its content: 1980s American workplace era, 6 figures, 3 flat head tones (#f5ead6,
  #e2b78c, #7a4f33), 3 distinct hair silhouettes, anchor-not-uniform variety.
- ADD explicit proportion law, stated positively and early in the prompt: every figure is SQUAT,
  3 to 3.5 heads tall, matching the channel's base rig — large round head, short body, short legs;
  no figure is lanky, no figure is 4+ heads tall. Reference the base rig's build in words.
- The candidate frame must NOT overwrite `assets/library/crowd-exemplar.png` (the current file stays
  in place until the boss verifies the new one). Leave the output where forge stages it, or copy it to
  `scratchpad/taste-forensics/crowd-exemplar-reroll-candidate.png`, and report the exact path.

\## Laws (binding)

- **Spend**: $0.039/call. Hard cap **$0.50** for this whole round — halt and report if the next call
  would exceed it. Expected: 4 calls (3 cast + 1 crowd), retries only if a call STALLS (4-minute
  ceiling per gen, ONE re-issue, then park that item and continue the others).
- **Billing probe**: if the first call returns HTTP 429 with `FreeTier ... limit: 0`, probe at most
  once more, then HALT everything and report "BILLING NOT RESTORED". Do not work around it.
- Append one line per provider call to `scratchpad/taste-forensics/tranche-genlog.md` (existing
  format — read the tail first).
- **Never** read, print, copy, or edit `.env` or the API key; forge loads it itself.
- **No promotion, no stamping, no registry edits, no review-store writes** — you stage frames and
  report. Verification and promotion are a separate pass with fresh verifier agents.
- Do not commit or push anything. Do not touch files outside `scratchpad/taste-forensics/` and forge's
  own staging output. Another worker is editing `image-generation/scripts/build_review_artifact.py` in
  this same worktree — do not touch that file or run the full test suite.

\## Acceptance criteria / report

Final message = a report containing:
1. Per-frame table: character/crowd, calls used, staged output path, stall/park events.
2. The exact prompt text used per frame (so the boss can audit the clauses).
3. Spend total + genlog lines appended.
4. Any deviation from this brief, flagged explicitly with rationale.

## Result

Completed four GEN-only candidates; no promotions, stamps, registry edits, or review-store writes.

| Frame | Calls | Staged output | Stall/park |
|---|---:|---|---|
| return-customer | 1 | [return-customer-r2-flat-fill-candidate.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/return-customer-r2-flat-fill-candidate.png) | none |
| brick-co-seller | 1 | [brick-co-seller-r2-flat-fill-candidate.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/brick-co-seller-r2-flat-fill-candidate.png) | none |
| hr-officer | 1 | [hr-officer-r2-flat-fill-candidate.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/hr-officer-r2-flat-fill-candidate.png) | none |
| crowd-exemplar | 1 | [crowd-exemplar-reroll-candidate.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/crowd-exemplar-reroll-candidate.png) | none |

Exact deltas used:

```text
A full-body standing character reference sheet of ONE cast member, the complicit distributor. IDENTITY: dark beard, broad build, flat head tone #b07f55; costume is a navy quilted delivery coat with the breast patch left plain and unlettered, dark trousers, heavy boots, and a knitted navy beanie pushed back on the head. The navy quilted delivery coat is one single flat solid colour fill in flat cel shading - no fabric texture, no weave, no stitching, no quilting lines, no herringbone, no mottling; the only shading is the style's simple two-tone cel shadow.  No lettering, no logo, no company mark anywhere. CRITICAL FACE RULE, overriding anything the costume suggests: this character has NO EARS AT ALL and NO NOSE AT ALL. Draw NO ear on either side of the head - not under the headwear, not beside the hair, not in front of it. The sides of the head are smooth bare skin running unbroken down to the jawline, with no ear shape, no ear outline and no inner-ear line anywhere. Draw NO nose - no nose shape, no bridge, no nostril line, no shading where a nose would be. The face carries ONLY eyes, brows and a mouth. Flat stylized cartoon skull - no jaw, no cheekbones, no realistic face structure. RESTING FACE (copy EXACTLY from the reference image, the bald template): heavy lowered upper eyelids covering the top of each eye, small pupils set high against the upper lid, thin level gently-arched brows, and a small closed mouth with the faintest upturn at its corners. Eyes look straight out at the viewer, level and symmetric, not sideways, not up, not down. RESTING STANCE (copy EXACTLY from the reference image): standing straight and frontal, facing the viewer square-on, both shoulders level, both arms hanging straight down at the sides, both hands open, relaxed and EMPTY, feet flat and evenly planted. Carries NOTHING and touches nothing. No emotion of any kind, completely neutral and at rest. Plain flat light-grey studio background, no horizon line, no floor line, no props, no text.
```

```text
A full-body standing character reference sheet of ONE cast member, the Colorado brick seller. IDENTITY: greying moustache, weathered look, sturdy build, flat head tone #c98a5c; costume is a dusty tan work shirt with the sleeves rolled, a heavy canvas apron, a wide-brimmed straw hat worn square on the head, dark work trousers and boots. The heavy canvas apron is one single flat solid colour fill in flat cel shading - no fabric texture, no weave, no stitching, no quilting lines, no herringbone, no mottling; the only shading is the style's simple two-tone cel shadow.  CRITICAL FACE RULE, overriding anything the costume suggests: this character has NO EARS AT ALL and NO NOSE AT ALL. Draw NO ear on either side of the head - not under the headwear, not beside the hair, not in front of it. The sides of the head are smooth bare skin running unbroken down to the jawline, with no ear shape, no ear outline and no inner-ear line anywhere. Draw NO nose - no nose shape, no bridge, no nostril line, no shading where a nose would be. The face carries ONLY eyes, brows and a mouth. Flat stylized cartoon skull - no jaw, no cheekbones, no realistic face structure. RESTING FACE (copy EXACTLY from the reference image, the bald template): heavy lowered upper eyelids covering the top of each eye, small pupils set high against the upper lid, thin level gently-arched brows, and a small closed mouth with the faintest upturn at its corners. Eyes look straight out at the viewer, level and symmetric, not sideways, not up, not down. RESTING STANCE (copy EXACTLY from the reference image): standing straight and frontal, facing the viewer square-on, both shoulders level, both arms hanging straight down at the sides, both hands open, relaxed and EMPTY, feet flat and evenly planted. Carries NOTHING and touches nothing. No emotion of any kind, completely neutral and at rest. Plain flat light-grey studio background, no horizon line, no floor line, no props, no text.
```

```text
A full-body standing character reference sheet of ONE cast member, the HR officer, a woman. IDENTITY: dark hair pinned up, slight build, flat head tone #e0b48d; costume is a rust-red knitted cardigan over a cream blouse, a long tweed skirt and flat shoes, with reading spectacles hanging on a chain at the chest. The long tweed skirt is one single flat solid colour fill in flat cel shading - no fabric texture, no weave, no stitching, no quilting lines, no herringbone, no mottling; the only shading is the style's simple two-tone cel shadow.  CRITICAL FACE RULE, overriding anything the costume suggests: this character has NO EARS AT ALL and NO NOSE AT ALL. Draw NO ear on either side of the head - not under the headwear, not beside the hair, not in front of it. The sides of the head are smooth bare skin running unbroken down to the jawline, with no ear shape, no ear outline and no inner-ear line anywhere. Draw NO nose - no nose shape, no bridge, no nostril line, no shading where a nose would be. The face carries ONLY eyes, brows and a mouth. Flat stylized cartoon skull - no jaw, no cheekbones, no realistic face structure. RESTING FACE (copy EXACTLY from the reference image, the bald template): heavy lowered upper eyelids covering the top of each eye, small pupils set high against the upper lid, thin level gently-arched brows, and a small closed mouth with the faintest upturn at its corners. Eyes look straight out at the viewer, level and symmetric, not sideways, not up, not down. RESTING STANCE (copy EXACTLY from the reference image): standing straight and frontal, facing the viewer square-on, both shoulders level, both arms hanging straight down at the sides, both hands open, relaxed and EMPTY, feet flat and evenly planted. Carries NOTHING and touches nothing. No emotion of any kind, completely neutral and at rest. Plain flat light-grey studio background, no horizon line, no floor line, no props, no text.
```

```text
A crowd-rig reference sheet: SIX anonymous background figures standing in a loose row, full body, all facing the viewer. PROPORTION LAW: every figure is SQUAT, only 3 to 3.5 heads tall, matching the channel's base rig - a large round head on a short compact body with short legs. No figure is lanky and no figure is 4 or more heads tall. These are CROWD figures, not foreground cast: every one of the six has the SIMPLIFIED crowd face - plain DOT EYES, ONE simple neutral closed mouth, NO nose, NO ears, NO teeth, no eyebrows, no individuated features. Apply this identical simplified face to EVERY figure without exception; a single detailed or individuated face anywhere in the group is a failure. PROPORTION is the EXACT same squat head-to-body proportion as the reference image - a large round head on a short compact body, NOT taller, NOT lanky. Hands, where visible, are the same four-digit cartoon hand. HEAD TONES: use ONLY these three flat tones across the six figures, repeating - #f5ead6, #e2b78c and #7a4f33. Never one uniform tone for the whole group, and never a tone invented for an individual figure. HAIR: at most THREE repeating simple silhouettes across the whole group, repeating - short side-parted hair, a short curly cap of hair, and hair pinned up. Never a distinct hairstyle invented per individual figure. ERA DRESS: 1980s American workplace, the ordinary mid-decade register - plain shirt-sleeved office and factory clothes, open-collar shirts, plain knitwear, plain trousers and simple skirts, flat everyday shoes. Muted ordinary colours. No lettering, no logos, no badges, no brand marks, no slogans anywhere. No hats. No period costume from any other decade. All six stand straight and neutral, arms at their sides, carrying nothing. Plain flat light-grey studio background, no horizon line, no floor line, no props, no text.
```

Spend: **$0.156** total (4 × $0.039), under the $0.50 cap. All four lines were appended to [tranche-genlog.md](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/tranche-genlog.md).

Deviation: none. I added the allowed scratchpad-only driver [t16_mint.py](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/t16_mint.py) to preserve the sanctioned route and audit prompts. `trial-judge` was untouched; the existing library crowd exemplar was not overwritten.
