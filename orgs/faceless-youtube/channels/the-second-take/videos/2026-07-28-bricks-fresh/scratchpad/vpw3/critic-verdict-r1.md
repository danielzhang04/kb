# VPW3 fresh-context critic verdict — `shots.candidate.json`

## REJECT

The plan has strong story instincts in its first three quarters, including a healthy class spread and several legible reveal chains. It is not shippable as a complete visual plan: the forbidden house-template convergence is still present at scale, and the final 54 shots visibly fall out of the established prompt register. The closing chain also replays an already-resolved plot thread instead of serving the ending VO.

## Convergence sweep (all 204 long-form prompts)

| Repeated family | Count | Consequence |
| --- | ---: | --- |
| `A cropped … anchors/frames the foreground` | 75 | A foreground-prop boilerplate has become the default opening construction. |
| `… occupies/fills/sits in the middle/midground` | 68 | The same three-plane sentence is repeatedly used as a fill-in frame. |
| `… recedes/vanishes … behind/into/through` | 104 | More than half the film closes depth with the same recession formula. |
| `… commit the palette` | 58 | Palette is authoring rationale, not pixel prose; this wording becomes a second template. |
| `… is/are the payload` final clause | 36 | The prompt labels its own payload instead of depicting it. |
| exact terminal `Cold blue-grey, paper white, and black` | 16 | L151–L170 collapse into one boilerplated palette ending. |
| exact terminal `Courtroom brown, ink black, and semantic red` | 27 | L171–L200 repeat a single courtroom palette ending. |
| delta close `only this changes; everything else exactly as established` | 21 | Expected chain syntax; not counted as an independent rejection reason. |

The first three families are individually widespread and compound within the same prompts. This is the same construction-at-scale failure previously identified, only with a different surface vocabulary.

## Ranked findings and repairs

1. **Whole file — prompt construction / template convergence.** The 75 cropped-anchor, 68 middle-plane, and 104 recession constructions turn otherwise different beats into one house staging recipe (for example L01, L02, L03, L04, L06–L24, L27–L39, L42–L46, L59, L62, L67, L70, L73, L91, L104, L106–L107, L114, L118–L150).  
   **Repair:** Re-author, from each VO span, the 75 cropped-anchor shots and enough of the 104 recession shots to eliminate those constructions as defaults. Use genuinely different camera positions, foreground treatment, depth shapes, and open-air compositions; do not replace one repeated phrase with another.

2. **L151–L204 — prompt register and palette.** At L151 the plan abruptly degrades from scene-and-camera-led frames of roughly 60 words to compressed 16–43 word fragments (mean 24 words across L151–L200). Prompts such as “`A board-report binder lies open … 'MASSIVE FRAUD' Cold blue-grey, paper white, and black.`” and “`A polished gold bond certificate … Courtroom brown, ink black, and semantic red.`” append palette tags rather than authoring a scene. The 16 cold-accounting and 27 courtroom terminal repetitions make this a visible batch seam, not a deliberate low-point palette turn.  
   **Repair:** Re-author **L151–L204** in the same complete scene-and-camera register as the earlier plan. Give each scene a beat-specific three-plane/readable composition where needed; make palette a concrete, per-scene fact that changes with the beat, never a terminal tag or duplicate palette phrase. Remove `commit the palette` (58 shots) and `is/are the payload` (36 shots) throughout; depict the payload last without naming it as a payload.

3. **L40–L41 — question 5, disclosure order / beat fit.** The chain named `ibm-order-collapse` empties the outbound racks on “`Reddit makes today. Or so they said.`”, before the narration has rewound to IBM slashing orders. It visually spends the collapse before its causal reveal.  
   **Repair:** Re-author **L40–L41** as the late-boom / “or so they said” beat, or move the collapse chain to the VO that names the order cut; do not show the emptied bay early.

4. **L135–L137 — question 7, chain necessity and cause→effect.** The rack goes from “brick cartons dominating” to scrap dominance while its delta VO is “`One of the executives`” / “`help pack the boxes.`” The chain deletes the named executive and family work that the narration makes the subject, and its causal progression is not the action being narrated.  
   **Repair:** Split **L135–L137**: stage the scrap-growth comparison on its own appropriate VO, then give the executive/family packing beat a fresh base with the human story-bearers (after their canonicals are approved). Do not use a rack-state delta as a substitute for people packing boxes.

5. **L200–L202 — question 7, chain integrity and beat fit.** On the final “the scheme beat the audit / count sheets but not HR” conclusion, the dossier chain instead reintroduces Wiles’s earlier “`I DIDN'T KNOW`” defence, subordinates’ testimony, and pre-exposure share sale. Those facts were already narrated at L185–L192 and do not answer the final HR causality. Worse, both deltas change the base’s courtroom palette to winter-blue/payroll-pink while claiming “only this changes.”  
   **Repair:** Re-author **L200–L202** as one conclusion chain (or hard cuts) that makes audit/count-sheet success give way to the HR/pink-slip failure. Keep palette and established scene facts continuous within a chain; do not replay the defence/share-sale evidence.

6. **L107–L118 and L127–L138 — plan-level balanced-human use.** These are the two longest figureless runs: 34.4s and 33.8s respectively. The former contains people packing and arranging return pallets; the latter contains auditors sampling and management’s escalating fraud. Object-led depiction is valid for individual mechanism beats, but these long runs hide story-bearing decisions and labor behind cartons, scales, and racks.  
   **Repair:** Break each run with human-led frames where the VO’s subject is an actor: at minimum re-stage **L107–L109** around the packing decision/action and **L135–L140** around the executive/family action. Keep object-first shots where the warehouse mechanism itself is genuinely the subject.

7. **L139–L140 — question 3, closed-world cast.** `packing-executive` and `family-packer` are explicitly marked as pending canonicals in the candidate notes and do not resolve in the current registry/library.  
   **Repair:** Keep both shots blocked until their standard Pass-1 canonicals are minted and approved, or re-stage their beats with an approved cast solution. Do not generate them from prose alone.

## Required audit notes

- **Beat-fit spot audit (16 spread checks):** L04, L16, L24, L33, L62, L82, L91, L109, L115, L128, L137, L147, L159, L176, L202 plus the L40–L41 chain. L04/L16/L24/L33/L62/L82/L91/L109/L115/L128/L147 are materially apt; L40–L41, L135–L137, and L200–L202 fail as above. L159–L161 has a readable loss-restatement progression but must be re-authored with the late-act register repair.
- **Chains:** 14 declared chains, not 15. `pc-shelf-drain`, `brick-box-reveal`, `quota-ratchet`, `count-sheet-substitution`, `fraud-ledger-escalation`, `brick-packing-scale`, `pallet-unmasking`, `pallet-return-loop`, and `sample-pass-propagation` have load-bearing visible deltas. `ibm-order-collapse`, `scrap-padding-dominates`, and `wiles-defense-rebuttal` require the repairs above. `miniscribe-revenue-rise` and `restatement-loss-deepens` are structurally legible but need the respective disclosure/register repairs.
- **Depiction balance:** The class distribution is broad (24 physicalized imbalance, 23 symbolic stand-in, 22 ironic counterpoint, 21 reaction, 19 device, and no literal majority). It reads as storytelling through L150, not quota-shuffling. The late prompt collapse flattens that achievement because distinct classes receive the same palette-tag construction.
- **Crowd / scale:** The six crowd uses (L09, L62–L64, L70–L71) are genuine masses and are held small/rearward; no crowd-law finding. The early figure staging generally keeps figures small in structured worlds. The late abbreviated prompts often omit scale/depth altogether, which is covered by the L151–L204 repair.

**Verdict: restage these repairs before a new lint/critic pass; do not patch by global vocabulary substitution.**
