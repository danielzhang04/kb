# Adversarial review — fix-plan v2 implementation + V9 scoped re-pass

Reviewer: claude (adversarial fallback; two codex attempts died on infrastructure).
Date: 2026-08-18. Read-only review; this file is the only write.
Scope: V1–V7 doctrine/code edits, V8 exemplar copy, V9 re-author of L02/L03/L04/L06/L07/L11/L17/L20/L21.
The V9 author crashed after writing prompts and BEFORE the skill's critic pass — the critic pass is run here.

## 0. State verified before judging

| Check | Result |
| --- | --- |
| Current on-disk lint (246 shots, in-place) | **0 HARD / 82 heads-up** — brief's claim confirmed |
| Suffix byte-equality grammar ↔ shots.json | confirmed by implementer; suffix diff read and matches V2 exactly |
| Non-prompt metadata on all 9 changed ids | **byte-identical** to HEAD (id, duration, vo_ref, vo_text, shot_class, stage, stage_role, changed_elements, figures, source) — the re-pass touched `still_prompt` only |
| `notes` fields on the 9 | **unchanged** — several now describe the pre-repass staging (see F-9) |
| L16 | **not touched** by V9, yet it is the chain base of L17 (see F-1) |

**Liked-era probe (the one that matters for V5).** Ran the *current* tightened lint against
`git show 30d2b7e8:…/shots.json` (214 shots). 55 HARD total, but only **one** is crowd-distance:
liked-era `L07` ("a dense press of onlookers crowding the window from the pavement … palms and coat
sleeves flattened against the pane"). Every other liked-era HARD is an old-era artifact the later
resets legitimately introduced (lettering-seed routing, payload-last ordering, `glossy`, delta-cap).
Notably liked-era **L20 passes** (the picks-and-shovels stall — the same beat) and liked-era **L17
passes** ("a customer crowd pressing around a waist-high display counter"), so removing the
"across the counter" satisfier did **not** over-fire on the liked era. **V5 is well-calibrated:
1/214 liked-era frames killed, and that one is the pane-press pattern the owner explicitly ruled
is not distance.** The "over-tightened lint" charge does not survive the probe.

---

## 1. Per-shot three-way verdicts

Legend for "stages vs asserts": does the new prompt put *real intervening geometry* between camera
and crowd, or does it only use distance words?

| id | (a) liked-era 30d2b7e8 | (b) pre-repass HEAD | (c) current on-disk | Stages or asserts? | Strengths kept? | **Verdict** |
| --- | --- | --- | --- | --- | --- | --- |
| **L02** | different beat (den delta, wig on `pc-boxy`) — no crowd at all | crowd shoulder-to-shoulder at midground; hair "fills the entire upper third like a hedge" | crowd behind "two receding rows of low vinyl benches, cafe tables and skate racks", "clearly smaller", hair an "uneven skyline" | **Stages** — real rink furniture | vantage ✓ (floor-level up), joke ✓ (tower dead centre) | **EDIT** — payload no longer closes the prompt; up-angle now fights the receded crowd |
| **L03** | different beat | "wall of raised applauding hands and shoulders fills the lower third"; "warm near-black room shadow" | near-black → warm chestnut; honey-gold/cream/burgundy; **payload moved to final clause** | palette: real fix. Crowd: **untouched** | vantage ✓, joke ✓ (blank board, empty lectern), mood ✓ | **EDIT** — palette work is the best in the set, but the near-camera wall of hands is exactly what V6 outlaws and lint misses it |
| **L04** | different beat | "Cool blue dawn air … blue-taupe-amber"; window of "beige **computer** cartons" | warm oak/cream/amber dominant; blue confined to "thin sky light"; cartons now just "cream cartons" | n/a (no crowd) | vantage ✓ (oblique receding), '1983' last ✓ | **EDIT** — the palette pass deleted the word "computer" from the only computer in the shot, and over-cooled the dawn out of a dawn shot |
| **L06** | different beat | crowd "pressing shoulder to shoulder with palms flat on the pane" — the banned class | crowd behind "a broad pavement strip and two staggered rows of bicycle racks and zigzag queue rail", "clearly smaller … overlapping rows" | **Stages** — but with invented furniture | vantage ✓ (display's own), hunger ✓ | **EDIT** — anachronistic zigzag queue rail with nobody queuing in it; and `crowd-multiplication` at 1.5s now has an occluded, small crowd — the class's payload is the mass |
| **L07** | *same beat family*: "a dense press of onlookers crowding the window … palms flattened against the pane" (the one liked-era frame the new lint kills) | "fistfuls of banknotes thrust across the counter from customers crowded three deep against it" | crowd at far till behind "two receding rows of display tables"; "a long trail of banknotes lies in separate overlapping fans along the counter" | **Stages the crowd — but ASSERTS the action** | vantage ✓, payload-last ✓ | **EDIT** — highest-value catch: the transaction was de-animated. Banknotes lying in fans on a counter read as spilled money, not buying. "the open trail of money links the distant buyers to the computer" is a claim the image cannot make. `shot_class: literal` on a beat whose literal action was removed |
| **L11** | different beat | "Warm amber bedside lamp against deep blue night, blue-amber-cream" — a *motivated* night | walnut/honey/cream/amber "dominate"; "Warm amber bedside light fills the table, bed **and curtains**"; blue reduced to "the thin window light" | n/a (no crowd) | vantage ✓ (foot of bed), locket beat ✓ | **EDIT** — contradicts the style-bible clause V3 *deliberately kept*: "a genuinely cold scene cools its LIGHT, never its neutrals". A night scene is the genuinely cold case; the fix warmed the **light**, when only the **neutrals** were owed. V9's own note exempts L09/L12 as "motivated" — L11's night is motivated identically |
| **L16** | different beat | (unchanged) "beyond the ropes, a dense crowd roaring with arms up" | **unchanged** | asserts — "beyond the ropes" is a divider label, which V6 says is not distance; lint passes it anyway | — | **EDIT (out of declared scope — needs owner ruling)** — see F-1 |
| **L17** | different beat | delta: "the roaring crowd beyond, seen from the same low ringside angle … Only this changes: the two machines have lunged together" | adds "two staggered rows of ringside benches" + crowd "reads clearly smaller"; C-8 plane/eye-line/head-scale clauses now present | stages — **but against geometry its own base does not contain** | C-8 HARD genuinely fixed ✓; lost B's "stubby arms and legs braced wide" → "stubby legs planted wide" | **EDIT** — delta integrity broken (F-1) |
| **L20** | **same beat, and the model**: "an apron-wearing merchant crowd serves picks and long-handled shovels from a plank trestle … Across the creek, prospectors work their pans among canvas tents, wheelbarrows and muddy spoil heaps. Wide three-quarter framing" | "a press of grinning prospectors … reaches up for the tools from the far side of the counter" | restores the liked-era idiom almost exactly: wide three-quarter, generous pale sky, creek, prospectors across it "in overlapping depth", tents/spoil/wheelbarrows | **Stages** — best staging work in the set; genuine restoration of the liked frame | wide-with-air ✓ restored, payload-last ✓, vantage improved | **EDIT** — "holding a pick and a shovel out across it **toward the buyers**": there are no buyers left in frame. The sale has no counterparty. Also 12+ named objects at a **1.4s** hold (lint already flags real hold 1.42s below the floor) |
| **L21** | different beat (warehouse) | delta: "prospectors still pressing in on the far side" | holds L20's exact stage facts (wide three-quarter, pale sky, tool rack, water butt, counter, creek, crowd across creek behind reeds/sluice); terminal change = coin box only | stages, inherited correctly | stage hold ✓✓, one-change delta ✓ | **SHIP** — this is how a delta should restate a re-staged base; it is the counter-example that convicts L17 |

**Score: 1 SHIP, 9 EDIT, 0 REAUTHOR.** No shot needs re-authoring — the staging thinking is sound
throughout. Every EDIT is a clause-level correction, given verbatim in §6.

---

## 2. The crowd-fix devices are a new authoring tic (measured)

Regex counts across all **246** shots in the current file:

| device | count | which shots |
| --- | ---: | --- |
| `two (receding\|staggered) rows` | 4 | L02, L06, L07, L17 — **all four are re-passed shots; zero elsewhere** |
| `clearly smaller` | 6 | L02, L06, L07, L17, L20, L21 — **exactly the six re-passed crowd shots; zero elsewhere** |
| `overlapping (ranks\|rows\|depth)` | 5 | L02, L06, L07, L20, L21 — **all re-passed; zero elsewhere** |

Every device introduced by the re-pass appears **only** in the re-passed shots and **nowhere** in the
other 240. Act 1's opening run will announce itself as a different hand: four of the first
seventeen shots resolve their depth with the identical "two rows of furniture" move. The VPW critic's
own place-monotony rule fires on this directly — *"a span where vantage, figure scale, depth shape,
or palette temperature repeats shot after shot: the repetition across the list is the defect, not any
one frame."* The doctrine is right; the execution converged on one formula. §6 varies three of the four.

**Fairness check on the sweeping version of this charge.** 72 shots carry `figures.crowd: true`;
only 6 were re-passed. I swept the other 66 for near-camera staging and the file is **largely
conformant already** — L80, L131, L140, L162, L183 all stage genuine recession ("on the far side of a
long trestle table", "beyond a long reception counter", "banquet tables running away toward a low lit
dais"). **L03 is the single un-fixed near-camera crowd in the file**, and it was in the re-pass set.
That makes F-2 a precise finding, not a systemic one.

---

## 3. VPW critic pass (the pass the crashed author never ran)

Charter: `.claude/skills/visual-prompt-writer/references/critics.md`, eight questions, judged at both
whole-scene and per-element granularity. Findings only, ranked most-damaging first, per the charter's
output contract. Clean shots are silent per the charter.

### Q1 — Scene logic and facts
- **L20** — "holding a pick and a shovel out across it toward the buyers", but the only figures are across a creek working pans. The offer has no addressee; the geometry contradicts the stated relation. *Fix direction: aim the offer at the diggings, or return a buyer tier to the mid-plane.*
- **L07** — "a long trail of banknotes lies in separate overlapping fans along the counter" with the buyers at the far till: money at rest in the near plane, buyers in the far plane, and no hand joining them. Per-element, every noun survives; whole-scene, the purchase does not happen. *Fix direction: enact the exchange where the crowd legitimately is.*
- **L06** — a "zigzag queue rail" standing empty on a 1983 high-street pavement while the crowd stands beyond it. Both anachronistic and illogical: the crowd should be *in* the rail. *Fix direction: replace with period-plausible street furniture and put the crowd into the queue.*
- **L02** — "Shot from floor level looking up" is retained while the crowd is pushed to the far side of an open floor. From floor level a distant crowd sits near the horizon line; the hairdos can no longer loom. Vantage and staging now pull opposite ways. *Fix direction: keep the up-angle but let the hair skyline break the horizon.*
- **L04** — a half-raised shutter cannot warm an entire dawn street; "Warm oak, cream and amber dominate the shop **and pavement**" against blue "confined to the thin sky light" inverts the light logic of the only light source stated. *Fix direction: let dawn hold the sky and the unlit side of the street.*

### Q2 — Literal-check against the bar
- **L07** — `shot_class: literal`, and literal is correct here ("Anybody with money was buying one"), but the re-pass removed the physical action that justified the class. A literal shot that no longer depicts its action is worse than a non-literal one. *Fix direction: restore the act, not the class.*
- No other finding. L03's ironic-counterpoint, L20's idiom-pun, and L06's crowd-multiplication all still skew correctly past the first idea.

### Q3 — Prompt construction (incl. FORCED payload-ordering row, stated for all ten)

| id | payload | final clause | ordering |
| --- | --- | --- | --- |
| L02 | the hair skyline | "…even amber rink light." | **FAIL** — trailing palette/light after payload |
| L03 | the empty dais | "…beside a lectern with nobody behind it." | PASS |
| L04 | the chalked '1983' | "…the single chalked line '1983'." | PASS |
| L06 | the mass of demand | "…flat cool daylight confined to the street beyond." | **FAIL** — trailing light |
| L07 | the purchase | "…without overlapping it." | PASS (staging clause) |
| L11 | `pc-boxy` hugging the drive | "…honey, cream, walnut and amber dominate the scene." | **FAIL** — trailing palette |
| L16 | the two cases squared off | "Umber-cream-teal palette." | **FAIL** (pre-existing, unchanged) |
| L17 | the scrum | "…everything else exactly as established." | PASS (delta convention) |
| L20 | the tools being sold | "…small and receding across the creek." | PASS |
| L21 | the open coin box | "…everything else exactly as established." | PASS (delta convention) |

The re-pass **fixed** the ordering on L03 and left it broken on L02, L06, L11 — three shots it
rewrote end-to-end and could have fixed at zero cost. Inconsistent application of a law the author
demonstrably knew (L03 proves it).

Registry names: `pc-boxy`, `rival-pc`, `prop-beige-pc`, `prop-drive`, `drive-maker`, `expr-*`,
`action-*` — all pre-existing and unchanged from HEAD; no new slug invented by the re-pass. Clean.
Crowd-rig prose expression is present and beat-fit on every crowd shot ("grinning and shouting",
"faces open and hungry", "eager and impatient", "roaring", "hopeful") — the reset win holds.
Crowd-distance sub-question: **L03 and L16 fail visual-grammar §2 as now written** (see F-1, F-2).

### Q4 — Renderability and generator risk
- **L20** — a 1.4s hold (measured real hold 1.42s, already below the 1.5s floor) now carries tool rack, water butt, counter, sacks, lanterns, barrels, rope, creek, reeds, sluice frames, pans, wheelbarrows, tents, spoil heaps and two crowd tiers. The payload cannot be read in the time. *Fix direction: thin the midground inventory; the creek and the two tiers are the load-bearing facts.*
- **L06** — "two staggered rows of bicycle racks and zigzag queue rail" plus a plate window plus a pavement strip is three occluders in a 1.5s frame. Same defect, smaller.
- **L17** — countable staging: "two staggered rows of ringside benches" is correctly staged countably (a named arrangement, not a bare number). No finding. Same for L02/L06/L07.
- Figure cap: no shot exceeds ≤2 named foreground cast (L16/L17 carry exactly 2, plane/eye-line/scale pinned). Clean.
- Attribute bleed: L16/L17 differentiate `rival-pc` explicitly ("narrower and a head taller", "stacked vent slots", "silhouette still distinct"). Clean — this is a reset win held.

### Q5 — Disclosure order
No finding. L04 keeps the bricks undisclosed; the '1983' dateline is the script's own year at its own
beat; the re-pass introduced no new entity ahead of its narration. Clean.

### Q6 — Two-figure plane/scale coherence
- **L17** — the C-8 clauses are present and read correctly as topology: both cases on the same centre-canvas plane, matching eye-line, same relative head scale, distinct silhouette. The lint HARD is genuinely fixed, and the author's diagnosis is verified sound (`rival-pc` entering `registry.json` at `693b0fff` made `video_chars()` resolve two figures where `573414b7` resolved one — a real defect exposed by asset-state completion, not a V5 artifact).
- **But**: the new "at the far side of two staggered rows of ringside benches, the roaring crowd reads clearly smaller" is precisely the mechanism the charter warns about in reverse — a rear-zone clause written for the crowd that now also implies a background pull. Here it is contained because both cases are explicitly pinned. No finding beyond F-1.

### Q7 — Action-chain cause→effect readability
- **L16 → L17: FAIL.** The base is unchanged and establishes "beyond the ropes, a dense crowd roaring with arms up". The delta declares `changed_elements: ["+ the two cases lunge together into a panel-to-panel shoving scrum"]` and closes "everything else exactly as established" — while silently introducing ringside benches that do not exist in the base and re-describing the base's dense crowd as "clearly smaller". A stage delta seeds from the base image; the generator will be asked for furniture the seed does not contain and a crowd scale the seed contradicts. **The crowd fix was applied to the wrong end of the chain.** *Fix direction: fix the base, restate in the delta.*
- **L20 → L21: PASS, exemplary.** The base was re-staged and the delta restates the base's *new* facts verbatim before its one change. This is the correct pattern and it is in the same commit as the L17 failure — the author had the pattern and did not apply it.

### Q8 — Semantic-cast justification
No finding. `drive-maker` genuinely bears the picks-and-shovels beat (he is the seller the idiom is about); `pc-boxy`/`rival-pc` bear the fight beat as actors; L02/L03/L06/L07 correctly stay mass-action with no named stand-in. No mascot-of-convenience reuse introduced. Clean — and the re-pass resisted the tempting fix of demoting a beat to rear-zone crowd, which the charter names as the wrong direction.

### Plan-level rows
- **Balanced human use** — L04 and L11 are the only figureless/near-figureless shots in the set; both earned (a dateline and a personified-object beat). Longest figureless run in the reviewed span: **L04→L05, ~5.1s**. Not a finding.
- **Cadence taste** — L20 at 1.4s (real 1.42s) with the densest prompt in the set is the one cadence finding; L03 at 3.76s is over the 3s band but is the hook peak and earns it.
- **Place monotony / palette temperature** — **FINDING, the biggest taste risk in the wave.** See §4/R2: the re-pass removed the cool pole from L02, L04, L06 and L11 simultaneously, collapsing Act 1's first eleven shots into one temperature.
- **Stage grouping** — semantically sound; `pc-ring` and `supply-stall` are really one held set each.

**Critic verdict line: ship-with-edits (9 shots).**

---

## 4. Forward risks

| # | Risk | Mechanism | Shot class it hits | Severity |
| --- | --- | --- | --- | --- |
| **R1** | **Anti-clutter pressure moved off the generator-facing channel** | V2 deleted the environment recipe ("built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth prop)") from the **suffix** — the only always-on text `forge.py` appends to *every* gen. V4's compensating standalone-prop rule lives in `visual-grammar.md §3`, which only the **author** reads. The generator now receives zero environment restraint. | Object / document / mechanism still-lifes (symbolic-stand-in-object, diegetic-device) — the payload-frame class, a large share of this 246-shot file. Owner's "generous negative space" goal is the direct casualty. | **HIGH** |
| **R2** | **Warm-monotone Act 1 — three warm pressures now stack** | (i) suffix still asserts "warm-biased scene palette" always-on; (ii) style-bible §2b lost its positive chroma clause ("flat colours laid down at FULL cel strength — every fill a real colour"), leaving only the negative floor "never drains to greyscale"; (iii) the re-pass warmed four of Act 1's few cool shots at once. Measured: L01 mustard-brown-cream · L02 cream-coral-honey · L03 honey-gold/cream/burgundy · L04 warm oak/cream/amber · L05 oatmeal-grey-cream-amber · L06 cream-amber-warm-grey · L07 cream/warm-brown · L08 cream-oatmeal-amber · L11 honey/cream/walnut/amber. **Nine of the first eleven shots now sit in one narrow warm band.** Before the re-pass, 7 of those 11 carried a real cool pole; now ~3 do. | Every warm-interior shot; the whole of Act 1 as a run. Owner's constitution says *balanced*-warm and *accent = per-beat option* — not all-warm. Predicted failure: a beige, low-contrast, undifferentiated opening. | **HIGH** |
| **R3** | **Doctrine-induced sameness in crowd staging** | V6's law is decidable but under-specified in *how*: "SMALLER through intervening depth and overlap". Every author who reads it reaches for the same move. Measured proof in §2: "two rows of furniture" and "clearly smaller" appear in the re-passed shots and **nowhere else in 246 shots**. | Every future crowd shot (72 in this file carry `figures.crowd`). Converges depth shape across the run — the exact defect the critic's place-monotony row names. | **MEDIUM-HIGH** |
| **R4** | **`crowd-multiplication` class vs. the depth law** | The class's payload *is* legible mass. The law pushes mass small and occludes it behind intervening geometry. At 1.5s (L06) the two cannot both be satisfied by the default move. | `crowd-multiplication` specifically (L06 here; recurs later in the file). | **MEDIUM** |
| **R5** | **Lint under-enforces the law it now states — 0 HARD is a false green** | The tightened `_REAR_ZONE` catches pressed-to-pane wording, but **L03** ("a wall of raised applauding hands and shoulders fills the lower third") and **L16** ("beyond the ropes, a dense crowd") both pass while violating §2 as now written — L16 passes on a **divider label**, which V6 explicitly says is not distance. | Any crowd shot whose near mass is described as an anatomical wall rather than a *press*, and any crowd behind a named divider. | **MEDIUM** — the risk is trusting 0 HARD as conformance |
| **R6** | **Tightened `_REAR_ZONE` false HARDs on future authoring** | Empirically low: **1/214** liked-era shots fired, and the removed "across the counter" satisfier did **not** kill liked-era L17. The rule is proportionate. Residual: the negative-proximity term may fire on legitimate *non-crowd* proximity prose in a shot that happens to carry `figures.crowd`. | Crowd shots with a deliberate near-camera *cast* element (e.g. a named figure at the counter with a crowd behind). | **LOW** |
| **R7** | **Prompt-idiom bimodality** | V2 deleted "locked 2-3 colour"; the 9 re-passed shots converted to palette prose ("Honey-gold, cream and muted burgundy dominate the room"), while ~237 shots still end on colour-lock triples ("Umber-cream-teal palette."). Two idioms in one file; whichever the next author imitates depends on which shot they read first. | Whole file; every future edit. | **LOW-MEDIUM** — cosmetic unless exemplars disagree (see cross-file §5) |
| **R8** | **Stale `notes` fields** | All 9 `notes` are unchanged and several now describe the *pre-repass* staging — L02's note still argues "Low upward vantage makes the hair loom, which is the payload", which the new prompt no longer delivers. Notes are the next author's reasoning trail. | Any future scoped repair that trusts `notes`. | **LOW** |

---

## 5. Cross-file coherence

The implementer's consistency sweep grepped for **five literal strings** and reported NO HITS. That is
true and insufficient: the sweep could not catch **semantic** echoes, and it did not look at
`example-shots.md` at all. A dedicated read of the whole flow found seven live findings.

| # | File | Location | Problem | One-line fix |
| --- | --- | --- | --- | --- |
| **F-A** | `channels/the-second-take/example-shots.md` | Entry 1, lines 15–20 — the file's **flagship first exemplar** (Physicalized imbalance, Poyais hook) | The crowd is staged as ONE populated plane — "held in a planted tableau in the lower third" — against scenery: "across the water a radiant golden fantasy skyline dominates the upper two-thirds". No depth, no overlap, no second distance. Its own "Why" note says **"scale is the argument"**, which is precisely the case the new §2 sentence governs: *"never a single populated plane against scenery."* **The channel's #1 exemplar is the textbook violation of the rule written to kill that exact failure.** VPW SKILL.md Step 3b re-reads this file **before every act**, and `critics.md` hands it to the shot critic as **"the bar"** — so it will silently re-teach the deleted staging to every future authoring run and to the critic meant to catch it. | Restage Entry 1's crowd across ≥2 depth planes with overlap (a nearer cluster reading larger, a further one smaller through intervening figures) before the golden skyline. |
| **F-B** | `channels/the-second-take/example-shots.md` | Entry 9, lines 76–78 — the **only** plate-authoring exemplar in the file | The ideal plate is "the brokerage's front room, one counter and a row of chairs under tall windows, dust hanging in thin morning light" — sparse, no fore/mid/background read, two pieces of furniture. Conflicts with style-bible §5 ("Rich, not sparse: name the real furniture of the place; no dead air"), with visual-grammar §2's plate law ("NOT a cavernous empty hangar"), and with image-generation SKILL.md's `insertability` row — all of which V4 restored or strengthened. The one worked plate example teaches the anti-pattern. | Give the plate working occupancy (stock on shelving, a ledger table, signage in progress) while still reading under-visited — or state in the Why note that its emptiness is a deliberate narrative exception. |
| **F-C** | `.claude/skills/image-generation/scripts/forge.py` | lines 281–288, `assemble_prompt` docstring | The load-bearing rationale for putting style in the tail still asserts the tail is "where line weight, **the 2-3 colour palette rule** and the single-red-accent law actually land". V2 deleted that rule from the suffix. A core function's docstring now describes doctrine the channel data no longer contains. | Say the tail carries the warm-biased-palette + single-red-accent law; drop the "2-3 colour" claim. |
| **F-D** | `.claude/skills/image-generation/scripts/forge.py` | line ~1476, `seed_roles_text` / STYLE_ANCHOR_ROLE comment | Comment reasons that palette discipline is "what the rest of the prompt already says four times over (§2b 'simple', the authored `Palette:` line, **the suffix's '2-3 colour' cap** and its semantic-only red)" — citing a fourth source that no longer exists. The model-facing `detail` string itself was correctly updated to SATURATION/TEMPERATURE language, so this is dead documentation, not a functional bug. | Drop the "suffix's '2-3 colour' cap" clause from the comment. |
| **F-E** | `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` **and** `scripts/test_doctrine_reset_guards.py` | lint 1473–1475 (`suffix_one_voice_check` docstring); test 149–151 | Both state the suffix "legitimately names **'flat gradient sky/ground'** and 'no photorealism' as fixed, human-approved channel data". V2 deleted "flat gradient sky/ground" with the environment recipe. The `ERA_SUFFIX` fixture itself is byte-correct, so behaviour is fine — but the comments now assert something false about current channel data, in exactly the place a future author checks for ground truth. | Replace "flat gradient sky/ground" with a phrase actually in the suffix (e.g. "no realistic detail") in both docstrings. |
| **F-F** | `channels/the-second-take/example-shots.md` | Entry 7, lines 59–62 (Literal-correct, Poyais departure) | "settlers on the `crowd-exemplar` rig wave from the deck" — no rear zone, no depth, no overlap. §2's crowd-distance law is **not** scoped to scale-argument beats only, so this is a genuine gap; mitigated because the shot is literal-correct (a real departing ship) rather than a staged-scale beat. | Add depth/overlap: settlers packing the near rail, more crowding smaller further back along the deck. |
| **F-G** | `channels/the-second-take/example-shots.md` | Entry 8, lines 64–70 (delta-chain trio) | The chain base is "an empty golden paradise, lush hills under a radiant sky, nothing built yet" — minimal geometry, no foreground depth prop: a different-words echo of the deleted "built-but-flat environment … minimal geometry" recipe. Narratively justified (it is the zero-state of a nothing→capital→bank→banknotes build-up), but minable out of context as licence for sparse environment bases. | One clause in the Why note marking the emptiness as this chain's deliberate zero-state, not a general environment pattern. |

**Answers to the specific questions**

- **(a) Do example-shots.md exemplars still model the OLD grammar?** **Yes — and this is the single most
  consequential finding of the whole review (F-A).** Entry 1, the flagship, is the exact anti-pattern.
  Entry 9's plate is sparse against the standing rich-environment law. Entries 7 and 8 are softer echoes.
  No entry uses a literal colour-lock triple or "payload owning the plane" phrasing, so V1/V2's literal
  deletions are clean — the leakage is entirely **structural/semantic**, which is why the implementer's
  five-string grep reported NO HITS in good faith and still missed it.
- **(b) Semantic echoes of deleted doctrine?** Yes: F-C, F-D, F-E — all comments/docstrings citing the
  "2-3 colour" cap or "flat gradient sky/ground" as live suffix content. **Every model-facing string is
  clean** (`desc_identity`, `desc_style`, `desc_rig*`, `desc_crowdrig`, `PLATE_COMPOSITION`, the
  STYLE_ANCHOR_ROLE detail text). Note `style-bible.md` §5's "built (flat-but-real) environments … Rich,
  not sparse" is **not** stale — V2's deletion brings the suffix back into alignment with it.
- **(c) `_REAR_ZONE` + the new negative-proximity term** (`lint_shots.py` 1281–1291):
  ```python
  _REAR_ZONE = re.compile(
      r"\bfar\s+side\s+of\b|\bfarther\s+back\b|\bat\s+the\s+rear\s+of\b|"
      r"\b(?:behind|beyond)\s+(?:the\s+)?(?:shelving|shelves|rack|racks)\b|"
      r"\bthrough\s+(?:the\s+)?(?:doorway|corridor)\b",
      re.IGNORECASE)
  _REAR_PROXIMITY = re.compile(
      r"\bpacked\s+shoulder\s+to\s+shoulder\b|"
      r"\bpress(?:ed|ing|es)?\s+shoulder\s+to\s+shoulder\b|"
      r"\bcrowded\s+three\s+deep\b|(?<!rear-zone\s)\bpress\s+of\b|"
      r"\bpressing\s+in\s+on\b",
      re.IGNORECASE)
  ```
  "counter" appears nowhere in `_REAR_ZONE` — the false satisfier is confirmed gone. `_REAR_PROXIMITY`
  HARD-fails independently at line 1324, **ahead of** the rear-zone check. The gating neighbour is
  `_BACKGROUND_CROWD` (1292–1295): `elif _BACKGROUND_CROWD.search(prompt) and not _REAR_ZONE.search(prompt)`.
  `test_new_guards.py` 371–393 exercises the trio correctly.
  **Reviewer's note on the accepted-vocabulary problem:** `_REAR_ZONE` accepts only five narrow phrasings,
  and `behind|beyond` is whitelisted **only** for shelving/racks. So "beyond the ropes", "beyond the
  glass", "beyond the counter" do **not** satisfy it — the rule effectively forces the literal token
  "far side of" into every crowd prompt. That is the mechanical root of the R3 authoring tic, and it is
  why all six re-passed shots converged on identical wording. It also means F-2/L16 passes only because
  `_BACKGROUND_CROWD` never fires on it, not because it is conformant.
- **(d) forge.py role strings?** Clean — no model-facing string describes flat environments or colour
  locks. Only the two comments (F-C, F-D).
- **(e) vpw-log.md?** No material conflict. Its colour paragraph already lists six named colours plus the
  red accent (a rich palette, not a 2–3 lock); its crowd-dressing note matches style-bible §2d; it says
  nothing about environment richness or crowd depth, so it does not intersect V4/V6 at all.
- **(f) Dead doctrine?** Only F-C/F-D/F-E — dead in the narrow sense of citing suffix spans that no longer
  exist on disk. No skill, constant, or doctrine paragraph is referenced by nothing.

---

## 6. Exact replacement text for every EDIT

Each block is a complete `still_prompt` replacement. No metadata changes. All keep the vantage,
the joke, the chain facts, and the registry names; all close on the payload.

### L02 — move the payload to the final clause, let the hair break the horizon
```
Beyond a chrome rail crossing low across the frame, a roller-rink lobby opens into a long structured view under a tall ceiling. Shot from floor level looking up: foreground the chequer-tile floor, chrome rail and a cropped ticket-booth corner stage-left; midground a broad strip of open floor broken by two receding rows of low vinyl benches, cafe tables and skate racks; background at the far side of the benches, a clearly smaller crowd of 1980s skaters in shoulder-padded jumpsuits and white hi-tops stands in overlapping ranks, grinning and shouting over the music. Warm cream-coral-honey surfaces, restrained teal in the wall-light panels, even amber rink light. Their teased blonde and copper hairdos rise off those small bodies into an uneven skyline that breaks the ceiling line right across the frame, one huge blonde tower highest at dead centre.
```

### L03 — recede the ovation without losing it (keeps the re-pass's palette work verbatim)
```
Seen from a high vantage at the back of a hotel function room, looking down across the crowd toward an empty awards dais: foreground a cropped band of near heads and raised hands along the very bottom edge; midground the applauding crowd on its feet between cream-clothed banquet tables that run back through the depth, a velvet rope and a pleated honey-gold curtain beyond them, the standing figures growing clearly smaller at the far side of the tables. Honey-gold, cream and muted burgundy dominate the room, with warm chestnut shadow and low amber ambient light. In the background, one hard white-gold overhead spot isolates the empty dais stage-right: an oversized display board stands angled on it with its face completely blank and unlettered, beside a lectern with nobody behind it.
```

### L04 — restore the computers; let dawn stay dawn
```
A suburban high-street electronics shop seen at a receding oblique angle along the empty dawn pavement: foreground wet paving reflects the shop's amber light; midground a half-raised shutter reveals golden-oak shelving stacked with beige computer cartons behind the window under a striped awning, with a parked hatchback farther along stage-right; background the pavement continues past a cropped lamp post at the frame edge. Warm oak, cream and amber own the shop and the pavement it lights, while a cool blue dawn still holds the sky, the far pavement and the shaded side of the street. Propped in the doorway's warm light, a chalk sandwich board carrying the single chalked line '1983'.
```

### L06 — the queue IS the depth device (multiplies and recedes at once); drops the anachronism and the tic; payload last
```
A `prop-beige-pc` unit alone on a lit turntable plinth, front panel to the viewer. Seen from just behind the plinth looking out, as if from the display's own vantage: foreground the plinth edge and warm display light pool around the unit; midground the full-height plate window, a broad pavement strip, a row of parked bicycles and a lamp post crossing it; background at the far side of that street geometry, a queue of hopeful buyers runs back along the shopfront and out of frame at the far end, each rank clearly smaller and more overlapped than the one before it, faces open and hungry. Cream-amber-warm-grey palette, the plinth light dominant, flat cool daylight confined to the street. Far more people out there than the one small machine on the plinth.
```

### L07 — put the buying back in the frame, at the far till where the crowd legitimately is
```
A `prop-beige-pc` unit sits on a shop counter top, front panel turned toward the far till. Seen from slightly above the counter, looking down its length: foreground the unit, the warm wood counter and a cropped till corner at the lower-right; midground two receding rows of display tables and boxed peripherals beside the counter; background at the far side of those tables, a clearly smaller crowd gathers around the far till in overlapping ranks, banknotes held out over the heads in front and boxed units already going back the other way, faces eager and impatient. Cream, warm brown and restrained teal surfaces under even amber shop light. Money going one way and boxes the other at the far till, the sold machine waiting alone in the near plane.
```
*Note: kept as mass action deliberately — adding a single named shopkeeper would trip C-4 ("individually staged anonymous … sits inside `figures.crowd: true`").*

### L11 — warm the neutrals, keep the night cool (the style-bible clause V3 kept, applied correctly)
```
`pc-boxy`, `expr-delighted`, on a walnut bedside table stage-right, a `prop-drive` hugged between both stubby arms like a locket, its own screen face dark. Seen from the foot of the bed looking toward the nightstand: foreground a rumpled honey-cream blanket corner runs across the bottom of frame; midground the unmade bed reaches back stage-left; background the walnut table, cream curtains and a window beyond. Walnut, honey and cream keep every surface in the room warm while the night light stays cool — one warm amber pool from the bedside lamp, deep blue night across everything it does not reach. The lamp's pool lands on the hugged drive and nothing else.
```

### L16 — fix the chain at the base (⚠ outside V9's declared scope; needs an owner ruling before applying)
```
`pc-boxy`, `expr-annoyed`, planted low and wide in the near corner stage-left, front panel squared toward the far corner. Facing it in the far corner stage-right, `rival-pc` -- a slate-grey desktop case on the same no-hand boxy form but narrower and a head taller, a pair of stacked vent slots ribbing its front panel above its own cartoon eyes and mouth, `expr-annoyed` to match. Seen ringside from a low angle looking up at both, so the two cases loom: foreground a cropped ring post at the right edge, midground the two machines holding one plane at a matching eye line and equal relative head scale, three slack ropes crossing between them, background a corner stool at each post and, at the far side of the ropes and two banked tiers of ringside seating, a clearly smaller crowd roaring with arms up in overlapping ranks under one hard overhead ring light. Umber-cream-teal palette.
```

### L17 — restate the base's established facts only; restore "stubby arms"
```
`pc-boxy` and `rival-pc` on the canvas inside the three slack ropes as established, the banked ringside tiers and, at the far side of them, the clearly smaller roaring crowd, seen from the same low ringside angle, umber-cream-teal palette under the hard overhead ring light. The two machines hold the same centre-canvas plane, their front-panel faces at a matching eye-line and the same relative head scale, rival-pc's narrower taller case silhouette still distinct. Only this changes: the two machines have lunged together at centre canvas, front panels locked flat against each other in one straining shoving scrum, stubby arms and legs braced wide; everything else exactly as established.
```

### L20 — give the offer an addressee; thin the midground for a 1.4s hold
```
`drive-maker`, `expr-smug`, `action-present`, stands behind a plank counter stage-right, holding a pick and a shovel out across it toward the diggings. A wide three-quarter view leaves generous pale sky above the canvas awning and holds the whole supply stall at a muddy creek bend: foreground a tall tool rack and cropped water butt overlap the lower-left; midground the counter, sacks and tin lanterns beside the open creek; background on the far side of the creek, a clearly smaller crowd of hopeful prospectors in muddy hats and mud-caked coats labours in overlapping depth, the nearer line working pans behind reeds and sluice frames while farther figures push wheelbarrows among canvas tents and spoil heaps. Ochre, warm brown, canvas cream and worn green under hard high sun. The held pick and shovel dominate the near plane while the labouring line stays small and receding across the creek.
```
*L21 needs no change: its restatement ("tool rack and water butt foreground, counter and open creek midground") already matches this base exactly.*

### Verification of the replacement text (not asserted — run)

All nine blocks above were applied to a scratchpad copy of the 246-shot file and linted:

```
base copy      HARD violations: none    Heads-up (30)
patched copy   HARD violations: none    Heads-up (30)
```

Identical. **The proposed edits introduce zero HARD and zero new heads-up.** (Heads-up reads 30 rather
than 82 in a scratchpad copy because the video directory's `voiceover.manifest.json` is not alongside
it — the same file-state effect the V9 author documented; the base/patched comparison is like-for-like.)

Three phrasings were **changed during that test** and the blocks above carry the tested wording:
L03, L06, L16 and L17 all had to keep the literal token **"far side of"**, because `_REAR_ZONE`
whitelists `behind|beyond` only for shelving/racks (see §5(c)) — "beyond the ropes", "beyond the glass"
and "beyond that geometry" do **not** satisfy it. This is direct evidence for R3: the lint's narrow
accepted vocabulary is what forces every crowd prompt into the same words.

---


## 7. Reset-win regression check (2026-08-18)

| Reset win | Status | Evidence |
| --- | --- | --- |
| **warmth-tail** | **PASS with caveat** | Suffix retains "warm-biased scene palette"; style-bible retains "TINTED WARM … never drains to greyscale" and "a genuinely cold scene cools its LIGHT, never its neutrals". Caveat: the positive chroma clause was deleted and four Act-1 shots warmed at once → R2. **L11 actively contradicts the retained cold-light clause.** |
| **vantage variety** | **PASS** | All nine kept their vantage signature: floor-level-up (L02), high-rear (L03), oblique-receding (L04), display's-own (L06), above-counter-down-length (L07), foot-of-bed (L11), low ringside (L17), wide three-quarter (L20/L21). L20 improved — "wide with air" restored, matching the liked-era frame. |
| **chain-as-default** | **ONE FAILURE** | `supply-stall` L20→L21 held perfectly. `pc-ring` L16→L17 **broken**: the delta introduces geometry and a crowd scale the unchanged base does not contain, while declaring "everything else exactly as established". |
| **subject rule** | **MINOR REGRESSION** | L04's subject includes the personal computer of its VO line; the palette pass replaced "beige **computer** cartons" with "cream cartons", removing the only computer read from the shot. |
| **rig fidelity** | **PASS** | No hand/extremity close-up introduced; `pc-boxy` keeps "both stubby arms" (L11); `rival-pc` differentiation clauses intact (L16/L17); crowd-rig prose expression present and beat-fit on every crowd shot. Minor: L17 dropped "stubby arms" from the delta restatement (restored in §6). |
| **lettering hygiene** | **PASS** | '1983' stays in L04's final clause; no new in-world literal introduced by the re-pass; every `assets` block byte-identical, so no lettering-seed routing disturbed. |
| **parallel-by-default** | **PASS / N/A** | Untouched by prompt edits; no chain restructuring that would serialize a wave. |
| **0 HARD** | **PASS (but see R5)** | Verified in place: 0 HARD / 82 heads-up. L17's C-8 HARD genuinely fixed; the five crowd HARDs genuinely fixed. The green is real for what lint measures — it is not proof of §2 conformance. |
| **suffix byte-equality** | **PASS** | Confirmed. |
| **no bloat / no duplicates / no hyper-specific rules** | **PASS** | Net +60 lines across implementation files; V6 put the crowd law in grammar §2 as sole owner and had `critics.md` cite it (+1 line) rather than restate it — correct ownership discipline. |


---

## 8. Findings index (referenced above)

| id | Finding |
| --- | --- |
| **F-1** | **L16→L17 chain broken — the crowd fix was applied to the wrong end.** L17 is a `stage_role: delta` of `pc-ring` whose base L16 was left byte-identical. L17 now introduces "two staggered rows of ringside benches" that do not exist in L16 and re-describes L16's "dense crowd roaring with arms up" as "clearly smaller", while its `changed_elements` names only the scrum and its prose closes "everything else exactly as established". A delta seeds from the base image, so the generator is asked for furniture the seed lacks and a crowd scale the seed contradicts. L20→L21 in the same commit shows the correct pattern (base re-staged, delta restates the new facts). **Highest-severity shot-level finding.** Fixing it requires editing L16, which is outside V9's declared scope — an owner ruling is needed. |
| **F-2** | **L03's crowd plane was never addressed.** "foreground a wall of raised applauding hands and shoulders fills the lower third" survives untouched, on a `figures.crowd: true` shot, and is the exact near-camera mass V6 outlaws. V9 scoped L03 to palette only. It is the single un-fixed near-camera crowd in the 246-shot file (66 other crowd shots were swept and stage real recession). |
| **F-9** | **Stale `notes` on the re-passed shots.** All nine `notes` are unchanged and several now argue for the pre-repass staging — e.g. L02's still reads "Low upward vantage makes the hair loom, which is the payload", which the new prompt no longer delivers. Notes are the next author's reasoning trail; leaving them describing a deleted composition is how the next scoped repair reverts the fix. |
| **F-A…F-G** | Cross-file findings — see §5. **F-A (example-shots.md Entry 1) is the most consequential finding in the review.** |

---

## OVERALL: **GO-WITH-EDITS**

The wave is fundamentally sound and should not be reverted. V1–V7 were implemented faithfully and
honestly (the implementer reported an inconvenient 6-HARD state rather than masking it, and did not
edit out-of-scope prompts to make a number look better — that is the right instinct and it is worth
saying). V5 is empirically well-calibrated: the liked-era probe kills 1 of 214 frames, and the frame it
kills is the pane-press the owner ruled against. L20 is a genuine restoration of the liked-era idiom,
and L21 is a model delta. The staging thinking behind the re-pass is correct — **no shot needs
re-authoring.**

But three things block a clean GO, and one of them is not in the shots at all.

**Blocking edits (must land before pixels are bought):**

1. **F-A — `example-shots.md` Entry 1.** The channel's flagship exemplar is the textbook violation of
   the rule V4/V6 were written to install, on a beat whose own note says "scale is the argument". It is
   re-read before **every** authoring act and handed to the shot critic as "the bar". Left as is, it
   re-injects the deleted grammar into every future run and into the critic meant to catch it. **Fix
   this before the next authoring act, not after.** F-B (the only plate exemplar, sparse against the
   standing rich-environment law) rides with it.
2. **F-1 — L16→L17.** Apply the §6 L16 + L17 pair, or explicitly rule that L17 may re-stage its base.
   Silently shipping a delta that contradicts its seed wastes a chained generation. *Requires an owner
   ruling: L16 was outside V9's declared scope.*
3. **The seven §6 shot edits** (L02, L03, L04, L06, L07, L11, L20). Every one is clause-level, verified
   0 HARD, and each fixes a defect the re-pass either created (L04's deleted "computer", L07's
   de-animated purchase, L20's addressee-less offer, L11's warmed night light) or had the file open and
   did not fix (L02/L06/L11 payload ordering, F-2's crowd plane).

**Non-blocking but should be scheduled:** F-C/F-D/F-E (four stale docstrings citing suffix spans that no
longer exist — no behavioural effect, but they are exactly the comments a future author trusts);
F-F/F-G (softer exemplar echoes); F-9 (stale `notes`).

**The two risks the owner should rule on rather than an agent:**

- **R2 — warm monotony.** Nine of Act 1's first eleven shots now sit in one narrow warm band; before the
  re-pass, seven of eleven carried a real cool pole. The constitution says *balanced*-warm and
  *accent = per-beat option*. The §6 L04 and L11 edits restore two of the four; whether L02 and L06 should
  also keep a real cool pole is a taste call, not a lint call.
- **R1 — the suffix is now silent on environment.** The anti-clutter pressure moved from the only
  always-on generator-facing channel to an author-facing grammar section. If the next wave comes back
  cluttered, this is the mechanism, and the fix is a short environment-restraint clause back in the
  suffix — not a new rule elsewhere.

**Do not ship on the strength of "0 HARD."** The green is real for what lint measures and is not proof
of §2 conformance: L03 and L16 both violate the crowd law as now written and both pass.
