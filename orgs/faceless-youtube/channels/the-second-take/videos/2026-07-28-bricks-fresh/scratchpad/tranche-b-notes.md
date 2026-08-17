# Tranche B derivation — 28 selected shots + leg 0 repairs

Selected: L05–L09, L17–L18, L25, L31–L33, L36, L46–L47, L51–L54,
L63, L70–L73, L83, L102, L112, L114, L196. This is 28 shots from the
109-shot eligible pool. The seven parked tranche-A repairs are a separate leg 0:
L28, L60, L108–L109, L161–L162, and L184.

The choice intentionally takes full short chains rather than orphaning their deltas: the
PC-store chain L05→L06→L07→L08; storefront L17→L18; cash stack L31→L32→L33;
clinic L52→L53→L54; quota room L70→L71→L72→L73; and the verified-parent chains
L45→L46→L47 and L61→L63. The other eight selected shots are genuine standalone plates.
This gives a tranche close to one fifth of the pool without creating an unverified external
parent dependency.

## Strata coverage

| Stratum | Eligible before B | B selected | Notes |
| --- | ---: | ---: | --- |
| Remaining anon-foreground VPW conversions | 20 | 3 | L08, L17, L18 route to crowd tier; no invented named cast |
| Remaining over-cap VPW restages | 2 | 2 | L53 and L54, both included |
| Remaining prose-vs-seed VPW cut | 1 | 1 | L196, included |
| Recurring-place stage heads | 25 | 6 | L05, L17, L31, L52, L70, L196; two candidates each |
| Standalone plates | 36 | 8 | L09, L25, L36, L51, L83, L102, L112, L114 |
| Delta/composite shots | 48 | 14 | Chain members plus L46–L47 and L63 |

The selected root/delta mix (6/8/14) follows the eligible 25/36/48 mix closely enough
while honoring the stronger dependency-closure rule. Candidate places are deliberately not
over-weighted: six against 25 eligible heads. The standalone count is eight, and every
selected delta has its chain head or a verified ancestor available now.

## VPW workload in this tranche

The 43-shot VPW list less tranche A's 17 completed repairs leaves 26. Three of those are
the reserved word-sync edits (L02, L03, L197), so the non-word-sync selection pool is 23,
not 26. B takes six:

- `anon_foreground` → crowd: L08, L17, L18.
- Over-cap restage: L53, L54.
- Prose-vs-seed cut: L196.

For L08, retain the handbag/banknotes beat but make the counter figure crowd-tier. For
L17–L18, preserve the tug analogy as a small crowd-tier tableau rather than two separately
described foreground bodies. L53–L54 retain only two resolved STEP-1 figures plus their
parent plate, reducing the current six-seed slates to three. L196 retains `surrender` and
deletes the conflicting open-raised-palms prose.

The 17 ordinary VPW repairs still left after B are: L19, L20, L21, L22, L34, L93, L115,
L123, L133, L144, L163, L169, L170, L179, L199, L200, L201. The final word-sync block
remains L02, L03, L197; its dependent L198 must stay with it because current L198 seeds
from L197.

## Dependency closure

The forge dry-run used the tranche-A-compatible command:

`py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py batch --kit orgs/faceless-youtube/channels/the-second-take/visual-kit --batch orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json --out C:\NUL`

It printed the full 215-shot seed slate and then exited 1 with the expected SEEDING-LAW
violations; no key was loaded and no output was persisted. Treating each `_staging/Lnn.png`
seed as `Lnn → child` gives these selected edges:

`L05→L06→L07→L08`, `L17→L18`, `L31→L32→L33`, `L45(verified)→L46→L47`,
`L52→L53→L54`, `L61(verified tranche A)→L63`, and `L70→L71→L72→L73`.

Every other selected shot is a root plate. Therefore **closure_missing=0**. The leg-0 repairs
are also closed: L28 anchors to approved L27; L60 anchors to approved L60 place; L108→L109
and L161→L162 are rebuilt in order from approved L107/L160; L184 anchors to approved L183.

## Leg 0 — tranche-A parked repairs

All seven are 2K retry-overlay/place-anchor composites and are already VPW-correct:

- L28: Terry named-cast eye rig and one-hand drive hold, anchored to L27.
- L60: approved L60 place; varied-haired crowd, Wiles at the table head inside the lamp cone,
  gold tie clip visible.
- L108 then L109: reduced crowd-tier rig, no invented text, with L109 seeded from repaired L108.
- L161 then L162: continuity from approved L160, varied-haired crowd (not all bald/cream), with
  L162's lantern visibly raised and seeded from repaired L161.
- L184: full authored-prompt courtroom regeneration from L183; the ghost is Wiles.

## Cost and sub-cap

| Line | Gens | Tier | Rate | Subtotal |
| --- | ---: | --- | ---: | ---: |
| STEP-1 figures (L52 ×2, L196 ×1) | 3 | 1K | $0.039 | $0.117 |
| Recurring-place candidates (6 ×2) | 12 | 2K | $0.134 | $1.608 |
| Standalone plates | 8 | 2K | $0.134 | $1.072 |
| Selected deltas/composites | 14 | 2K | $0.134 | $1.876 |
| Leg-0 parked repairs | 7 | 2K | $0.134 | $0.938 |
| **Subtotal** | **44** |  |  | **$5.611** |
| 15% contingency |  |  |  | **$0.842** |
| **Total** | **44** |  |  | **$6.453** |

Recommended tranche-B sub-cap: **$6.50**. It leaves **$18.50** of the $25 B–E-plus-repairs
envelope, or about $6.17 per remaining tranche. It does not crowd the remainder budget, though
any expansion beyond the stated one-retry contingency should be priced again before spend.

## Left for C/D/E after B

The nominal remaining eligible pool is 81 shots:

`L01, L12–L16, L19–L22, L34–L35, L39–L40, L64–L65, L80–L82, L85–L90, L93,
L97–L99, L103–L105, L115, L117–L119, L122–L123, L126–L131, L133, L136–L138,
L144, L146–L148, L152–L158, L163, L169–L175, L179–L182, L192–L194, L198–L201,
L206–L208`.

Of those, 80 are selectable before the last word-sync pass. **L198 is nominally eligible but is
not independently selectable:** its current parent is L197, which must be merged/re-authored in the
final word-sync tranche. The final block is therefore L02, L03, L197, and dependent L198. This
accounts for the full original target set: 27 tranche-A shots + 3 free frames + 28 tranche-B shots
+ 80 C/D/E-now shots + 4 final-block shots = 142.

## 2026-08-03 addendum — Daniel scope corrections (R1/R2)

- **R1 — retain verified pulled-in parents.** L05 and L06 are kept as their existing verified
  canonical originals, not regenerated. L07 now seeds from `assets/scenes/L06.png` with its
  SHA-256 pinned; L08 follows the newly staged, digest-pinned L07. The already-produced
  `L05-candidate-1` / `L05-candidate-2` pair is discarded, not picked.
- **R2 — one plate per place going forward.** Tranche-B remainder and C/D/E use one 2K plate
  generation per place; no two-candidate taste batches remain in the forward plan. The 19
  remaining recurring C/D/E place heads therefore avoid 19 former second candidates:
  `19 × $0.134 = $2.546` saved.
- **C/D/E R1 pool sweep.** L13, L14, L80, L86, L98, L152, and L180 were each confirmed in
  `chain_parents_added.json`, manifest `review_status: verified`, absent from the 107-shot
  condemned source (`report_data.json` / `wave-plan.md` §1), and absent from the parked set.
  All seven are removed from C/D/E as kept verified originals; none failed the check. The nominal
  C/D/E pool is now **74** (73 selectable before final word-sync). This avoids seven one-per-place
  2K gens: `7 × $0.134 = $0.938`. Keeping L05/L06 also avoids their formerly planned three 2K
  gens: `3 × $0.134 = $0.402`. The discarded L05 pair's already-spent `$0.268` is not counted as
  a saving.
