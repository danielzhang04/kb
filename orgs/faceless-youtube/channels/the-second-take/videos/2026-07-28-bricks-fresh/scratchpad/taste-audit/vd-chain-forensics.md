# Delta-chain forensics — Bricks variant D

Scope: read-only comparison of `claude/bricks-variant-va`, current `claude/bricks-variant-vb` (`17becaaf`), `claude/bricks-variant-vc`, liked anchor `30d2b7e8`, and recon at `claude/bricks-taste-forensics` (`c7166556`). `V` means `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh`. Classification and proposed missed chains below are **INFERRED**; counts and authored metadata are measured.

Evidence aliases: `VPW` = `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/SKILL.md`; `Schema` = its `references/shots-schema.md`; `Critic` = its `references/critics.md`; `Lint` = its `scripts/lint_shots.py`; `IG` = `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md`; `Forge` = its `scripts/forge.py`; `Grammar` = `orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md`.

## 1. Liked-run chain anatomy

### Identity and counts

`30d2b7e8:V/shots.json` is the liked run: 214 shots, 73 `delta`, 67 `base`, 74 shots with no `stage`, and 140 stage-bearing shots. Thus the brief's “≈73 stage-bearing” is precisely **73 delta records**, not all stage-bearing records. There are 67 named stages, of which 44 are real multi-shot chains and 23 are stage-labelled singletons. This matches `V/scratchpad/taste-audit/prompt-diff-analysis.md:54-72` and the liked anchor named in `doctrine-recon/era-map.md:5`.

Chain length was not “mostly pairs”: 21/44 chains had 2 members, 17/44 had 3, and 6/44 had 4 (maximum = one base + three deltas).

### Every multi-shot chain, classified

Definitions: **R** progressive reveal = a withheld/latent fact becomes visible; **E** enumeration = serial additions/list items; **A** same-place successive action = actors/objects advance a beat while the set holds; **S** camera hold with state change = depletion, transformation, time, lighting, or condition changes without a new vantage; **O** other/weak. Classification is **INFERRED** from `changed_elements` and prompts at `30d2b7e8:V/shots.json`.

| Type | Stage | Members | Evidentiary delta summary |
|---|---|---:|---|
| E | `eighties-den` | L01–L04 (4) | wig → arcade cabinet → contract folder |
| A | `pc-store-1983` | L05–L08 (4) | unpacked PC → window crowd → buyer's banknotes |
| S | `drive-strongroom` | L12–L15 (4) | corridor darkens → shelves fill twice |
| S | `storefront-brawl` | L17–L18 (2) | contested PC becomes smartphone |
| O | `brick-warehouse` | L21–L22 (2) | worker looks at viewer; audited no-op L22 |
| R | `cash-stack` | L31–L33 (3) | value appears → stack becomes tower |
| R | `crisis-office` | L43–L44 (2) | struck-through ledger page appears |
| A | `hq-office` | L45–L47 (3) | money appears → banker offers folder |
| S | `tv-chef-analogy` | L49–L50 (2) | dining room becomes bright/full |
| R | `multi-office-portals` | L55–L57 (3) | Wiles appears → MiniScribe portal brightens |
| R | `fear-boardroom-target` | L61–L62 (2) | banknote envelope appears |
| S | `fear-boardroom-escalation` | L64–L65 (2) | target rises into ceiling |
| E | `quota-room` | L70–L73 (4) | conveyor → calendar → managers |
| A | `quota-room-2` | L74–L75 (2) | foreman signs order pad |
| A | `audit-arrival` | L76–L77 (2) | auditor advances inside and opens case |
| R | `lockbox-office-written` | L87–L88 (2) | one box glows/acquires wax seal |
| S | `quota-room-3` | L94–L95 (2) | order-pad tower grows |
| A | `product-request` | L97–L99 (3) | auditor enters/touches carton → checklist tick |
| R | `scheme-table` | L100–L101 (2) | brick appears on plan |
| R | `brick-co-yard` | L103–L105 (3) | sign disclosed → loaded truck appears |
| A | `packing-line` | L107–L110 (4) | stamp → genuine drive → wrapped pallet |
| S | `shipping-map` | L116–L119 (4) | Wiles appears → pallet travels → reaches coast |
| S | `return-loop` | L120–L121 (2) | calendar/tallies appear |
| A | `test-count-scale` | L128–L129 (2) | auditor isolates one pallet |
| A | `test-count-floor-2` | L130–L132 (3) | ledger/check → stamp across pallet row |
| R | `brick-vs-drive-weigh` | L134–L135 (2) | second carton opens to reveal real drive |
| A | `escalation-cycle` | L136–L137 (2) | Wiles turns dial |
| E | `padding-warehouse` | L139–L141 (3) | metal scraps → miscellaneous junk |
| E | `family-packing-night` | L143–L144 (2) | completed carton joins stack |
| R | `best-managed-award` | L146–L148 (3) | plaque text → curtain exposes warehouse |
| R | `layoff-floor-christmas` | L152–L154 (3) | laid-off line → foreman among them |
| A | `phone-call-newspaper` | L156–L158 (3) | newspaper appears → receiver returned |
| A | `rifenburgh-office` | L160–L162 (3) | empty Wiles chair → search moves deeper |
| R | `restated-books` | L165–L167 (3) | 1988 page → 14M total |
| R | `lawyers-arrive` | L173–L175 (3) | bondholders → cracked certificate |
| R | `verdict-punitive` | L180–L182 (3) | wedge hits auditor → pallets exposed |
| R | `verdict-punitive-2` | L183–L184 (2) | ghosted office memory appears |
| S | `overturn-courtroom` | L185–L187 (3) | glowing scrap → smoke → absence |
| R | `wiles-trial` | L192–L193 (2) | stamped folders appear |
| A | `defense-vs-testimony` | L196–L198 (3) | witnesses appear → turn toward Wiles |
| O | `insider-sale` | L199–L200 (2) | calendar plus crack; audited no-op L200 |
| S | `aftermath-panel` | L202–L203 (2) | FOR LEASE becomes MAXTOR |
| R | `brick-co-payday` | L207–L208 (2) | banknote stack appears at gate |
| E | `champion-belt` | L209–L211 (3) | fallen glove → fallen ledger page |

Totals: R 16, E 5, A 12, S 9, O 2. Therefore **28/44 = 63.6% were not progressive reveals**. Even generously treating enumeration as “reveal family,” **23/44 = 52.3% were neither reveals nor enumerations**. The liked logic was primarily “one camera/set can hold while the story state changes,” not reveal-only. The six liked no-op deltas were L22/L32/L157/L167/L175/L200 (`poyais-register-audit.md:47-57,73`); imperfections do not erase the distribution.

### What delta prose looked like

All pairs are from `30d2b7e8:V/shots.json`:

1. `pc-store-1983`, L05 base: “A small high-street computer shop stands empty of customers… Wide interior at eye level…” L07 delta: “The same shop interior, same locked framing… Only this changes: the street outside is now packed…; everything else exactly as established.” This is same-place demand action, not a withheld-truth reveal.
2. `audit-arrival`, L76 base: auditor at the warehouse threshold, case in hand. L77 delta: “The same warehouse threshold, same locked framing… Only this changes: auditor-rep now stands well inside the warehouse… his ledger case open.” This is successive action.
3. `overturn-courtroom`, L185 base: empty courtroom, cold daylight, gavel. L187 delta: “The same empty courtroom, same locked framing… Only this changes: where the glowing scrap lay, only a thin wisp of pale smoke now rises.” This is a held-state transformation.

The delta grammar was consistent: restate the locked set/framing, say “Only this changes,” name one visible delta, then “everything else exactly as established.” Bases fully composed the set.

### Era forge seeding

Yes: the era Forge passed the parent frame as an image reference. At `30d2b7e8:Forge:1243-1253`, delta priority is “[in-chain parent] > [canonical identity]”; `:1320` recognizes a delta; `:1412-1427` resolves the prior place shot from emitted/on-disk frames and places `place_role(parent)` first; `:939-941` converts every seed to an image part sent to the provider. The actual liked full-generation commit was `309b341b` against the preceding 215-shot corpus (`prompt-diff-analysis.md:343-368`): its scheduler explicitly calls this the “delta-seeds-its-parent-frame shape” (`309b341b:Forge:478-485`) and sends all seeds as image parts (`:675-679`).

## 2. What current vb doctrine says

The operative vb restoration is commit `373515df`; the following is the complete chain-governing rule inventory in the seven requested files.

| Surface | Exact governing clauses and executable effect |
|---|---|
| VPW | “A stage delta = the next still simply has the new element… AT the cut”; author “intent, never mechanism,” and restage impossible mechanisms as tableau/delta/baked (`VPW:34-44`). `Schema` is the exact contract and canonical chain home (`VPW:116-128`). Long coverage means densify or “confirm a progressive in-shot reveal” (`VPW:152-157`). Keep a whole chain inside one partition (`VPW:164`). Mandatory lint, then fresh critic and lint rerun (`VPW:224-239`). Output fields are optional `stage?`/`stage_role?`/`changed_elements?` (`VPW:255-263`). |
| Schema: fields/mechanics | `stage` = optional id for consecutive shots on “ONE persistent set”; `base` establishes set+subject; `delta` is “ONE element added/moved on the SAME set” (`Schema:51-53`). The base establishes; each delta adds/moves one world-change; integrative changes are delta-chain, discrete additions are authored with the same metadata but may be promoted to a layer; re-base in the same location seeds the prior base; intent only; ≤3 deltas; every member owns its `vo_ref`; deltas 1.5–3s, bases 4–12s (`Schema:131-149`). Changes arrive at the hard cut (`Schema:195`). |
| Schema: semantic criterion | HARD: exactly one “visually distinct, story-needed transformation”; cosmetic/detail/label/reposition alone does not earn a frame (`Schema:363-366`). After inventing shots, **group consecutive shots sharing ONE setting/subject**; exactly one word-anchored world-change; additive/discrete entrants stay in the shared stage; decisive flips must flip; “Hard-cut to a NEW stage only when the setting/subject/register genuinely changes”; ≤3 deltas; standalone means hard cut (`Schema:370-395`). |
| Schema: critic charter | Critic judges whether shots are really one held set, and must flag “consecutive shots on one set that were NOT chained” or chains whose set changes; lint alone owns base/order/cap/contiguity/timing (`Schema:404-415`). |
| Critic | Runs after clean lint, pre-generation; one independent findings-only pass (`Critic:1-14`). It must apply Schema's canonical plan-level chain/disclosure contract (`Critic:45-50`), avoid overtriggering (`:52-62`), and author may split a chain only when a flagged restage forces it (`:70-75`). |
| Lint: structure | Fields are optional and “zero chains is valid; a chain exists only for a progressive reveal” (`Lint:249-253`). HARD: >3 deltas, non-base first, or later base; SOFT: long deltas and non-contiguous reuse (`Lint:254-281`). **Gap:** it never requires every later member's role to equal `delta`, and cannot detect a missing stage because zero is valid. |
| Lint: semantic no-op | HARD: a delta must have exactly one non-empty `changed_elements` string; regex rejects cosmetic/detail/label/reposition/tiny/decorative/ornamental and every phrase matching “moves to/onto”; error says “genuine progressive reveal or hard cut” (`Lint:726-746`). Delta `place_anchor` is forbidden (`Lint:692-695`); delta interaction template is HARD-forbidden because of seed slots (`Lint:1098-1105`); parent is derived by place/stage/id and prior order (`Lint:1023-1034`). |
| IG | Walk in order; continuity parent is the preferred mandatory style anchor (`IG:154-171`). Authored delta-chain parent is a defective-seed exception but requires before/after crop batteries (`IG:173-181`). Contradictorily, it says “Ignore” `stage`/`stage_role`/`changed_elements` (`IG:196-200`), then defines seeded chain only where change is **INTEGRATIVE**, with each delta seeded from the previous output; **DISCRETE** changes become layers; ≤3 deltas (`IG:223-231`). Gates require verified same-place parent + one semantic transform and refuse no-ops (`IG:233-240`); chain stays in one partition and review is one batch after generation, “do not gate mid-run” (`IG:244-251`). |
| Forge | `stage_role == delta` selects the delta arm (`Forge:533-590,1257-1258`); deltas/chained requests cannot be seedless (`:604-617`); key is `place > stage > id` (`:1240-1248`); parent is previous shot in that place and its emitted/on-disk frame is resolved (`:1348-1351`); parent goes first in delta seed roles (`:1379-1390`); parked parents refuse, in-batch parents continue lineage (`:1552-1564`). Two-figure interaction template on delta refuses (`:472-476`). **Gap:** Forge contains no `changed_elements`/semantic-no-op inspection; it trusts upstream lint and sends the full `still_prompt` as payload (`:1421-1437`). |
| Forge: P3 | General seeds need review (`Forge:1123-1150`), but `canonical` and ordinary `parent` roles are expressly exempt (`:1152-1167`). Only a parent that is itself a place plate is re-gated (`:1379-1382,1416`). Thus ordinary same-batch chaining does not add a per-delta human gate. |
| Grammar | Continuous action may be staged as a held tableau or its change may “arrive at a cut (a stage delta)” (`Grammar:45-52`); an expression change is a legitimate delta (`:59-66`); every shot still hard-cuts (`:204`). Crowd/base-rig deltas must restate the proportion fact (`:119-125`). |

### Where reveal-only narrowing came from

`33676421` introduced chain-as-default; `f1c3b1aa` reversed it to reveal-only using Poyais 0/22 versus fresh 26/109 no-op evidence, but recon explicitly calls the post-change result untested (`drift-ledger.md:94-96,203-209`; `era-map.md:22,34,57,69,128`). Its exact old clauses were “stage… genuine progressive reveal” and “Sharing a set does not earn a chain” (`f1c3b1aa:Schema:21-22,122-128`), plus “Seeded delta-chain (a genuine progressive reveal)” (`f1c3b1aa:IG:249-255`).

The recut verdict then ordered deletion of reveal-only and ≤2 while keeping HARD semantic no-op (`c7166556:doctrine-recon/recut-plan.md:98-108,201-214,274-282,337-345,553-560,842-847`), implemented by `373515df`. Current vb therefore has a **broad canonical criterion** in `Schema:370-395`, but still carries suppressive remnants: “progressive reveal” in `Schema:378-380`, “only… progressive reveal” in `Lint:249-253`, the reveal-or-hard-cut error at `Lint:743-746`, the overbroad `moves to/onto` no-op regex (`Lint:726-729`), and IG's integrative-only seeded-chain boundary (`IG:231`). These conflict with Schema's own character-entering, expression-change, and same-set successive-action examples.

## 3. Missed chains in L01–L12

Criterion used (from liked behavior, **INFERRED**): chain when one camera/set/primary subject can hold and the next consecutive beat makes one visible story-state change; hard-cut when vantage, setting, primary subject, or register genuinely changes. VO source is `V/script.md:11,13,15`; shot metadata is each branch's `V/shots.json`; rendered checks are `V/scratchpad/variant-frames/{va,vb,vc}/L*.png`.

| Variant | Standalone pair/run that should have been planned as one held stage | VO span | One material delta per cut |
|---|---|---|---|
| va | L05→L06 | “It's 1983…” → “computer had only been invented” (`script.md:13`) | Hold one shop counter: base PC+1983; delta = PC now half-unpacked / crate and straw appear. This exactly parallels liked L05→L06. |
| va | L08→L09 (extend authored L07→L08) | “Anybody with money…” → “and they were flying off” (`script.md:13`) | Hold L07 shelf/rail camera: after depletion, add the shopper crowd behind the same rail toward the remaining boxes. |
| va | L11→L12 | “Well, computers run…” → “A hard drive is the…” (`script.md:15`) | Hold the workbench: add the computer and one copper connection around the established drive. |
| vb | L05→L06 | same `script.md:13` span | Hold the oak counter/showroom: newly unpacked/crated state is the sole change, rather than rebuilding the shop. |
| vb | L08→L09 (extend `retail-shelf` L07→L08) | same buying/flying span, `script.md:13` | Add restrained crowd behind the already-established brass rail; shelves and camera remain. `fragment-A1.json:9-11` shows L09 says “same brass rail” yet omits the stage. |
| vb | L11→L12 | same `script.md:15` span | Hold the repair bench: add computer + conduit as the relational explanation. |
| vc | L05→L07 | “It's 1983…” → “few years earlier. They were all…” (`script.md:13`) | One store-counter stage: base PC+1983 context; delta = unpacked/new singleton; delta = crowd arrives around the held display. This is the liked L05–L07 logic. |

These are proposed authoring corrections, not claims that the independently generated standalone pixels already match: the frames confirm the current variants changed vantage because they were planned as new bases.

### Hard-cut boundaries (demonstrating restraint)

Across va/vb, L01→L04 move den → arcade/mall → corporate object → electronics reaction, so subject/vantage changes make hard cuts defensible; L09→L10 changes demand scene to analogy/pun; L10→L11 changes shop analogy to component hero. In vc, L01→L02 stays in a mall but changes the primary subject from TV/maze to `pc-boxy`/arcade cabinet; L02→L03 changes playful mall-character subject to corporate trophy; L03→L04 changes trophy to mystery carton; L07→L08 changes crowd/store event to a balance metaphor; L08→L09 changes metaphor to checkout inventory; L10→L11 changes store reaction to phone-vs-PC museum comparison. These fail the held-camera/held-subject test even if the broad location label is similar.

### Liked first-25 positive control

At `30d2b7e8:V/shots.json`, L01–L04 are a four-member den enumeration; L05–L08 are a four-member shop action run; L12–L15 are a four-member strongroom state/enumeration; L17–L18 hold the shop while the contested object flips; L21–L22 hold the warehouse for a reaction (but L22 is a known false-positive/no-op). Correct hard cuts include L08→L09 (wide shop interior to tight shelf-line subject/vantage), L09→L10 (period shelf to modern night street), L10→L11 (street to object exhibit), L11→L12 (object hero to strongroom metaphor), L15→L16 (strongroom to computer cutaway), L18→L19 (shop brawl to loading yard), and L22→L23→L24→L25 (people-wide warehouse → tight brick carton → top-down map → exterior). Positive control therefore supports selective holds, not chain density.

## 4. Why VPW did not author them — ranked

The causal ranking is **INFERRED** from the plan/procedure and executable gates; direct text evidence is distinguished from mechanism gaps.

| Rank | Cause | Evidence / verdict |
|---:|---|---|
| 1 | **(c) A1 plan lock** | Direct and sufficient. `V/scratchpad/vpw-var/plan.md:20-23` names exactly six A1 stages, then says **“All other cuts are standalone bases.”** `fragment-A1.json` contains exactly those six stage runs; among L01–L12, only L07→L08. The missed pairs were decided before prose authoring. |
| 2 | **(a) mixed doctrine text** | Schema actually requires grouping same-set consecutive shots (`Schema:370-395`), but “progressive reveal” remnants and IG's **INTEGRATIVE-only** seeded-chain arm narrow the salient mental model (`Schema:378-380`; `Lint:249-253,743-746`; `IG:231`). This makes ordinary action/addition holds feel exceptional despite liked evidence. |
| 3 | **(d) critic path did not challenge the lock** | Critic should flag unchained same-set shots (`Schema:404-409`; `Critic:50`), but the plan says the fragment is intentionally incomplete and only manually audited because lint has no fragment mode (`plan.md:31`). VPW requires critic only after a complete clean lint (`VPW:224-239`; `Critic:11-14`), so this fragment workflow had no evidenced critic opportunity to overturn the stage list. |
| 4 | **(b) lint HARD rules** | Not the proximate cause: lint was not run, zero chains is valid, and lint cannot detect omissions. It can exert anticipatory pressure: `moves to/onto` is categorically called a no-op (`Lint:726-746`), and two-figure delta interaction is barred (`:1098-1105`). Keep the semantic floor, but remove syntax-as-semantics. |
| 5 | **(e) Forge P3 cost** | Refuted as main cause. Chains serialize parent dependency and carry seed/crop obligations, but review is one post-batch pass (`IG:244-249`), and ordinary parent/canonical roles bypass P3 asset review (`Forge:1152-1167`). Only a parent classified as a place plate is re-gated (`:1379-1382,1416`). |

## 5. Smallest remedy direction

Change the existing canonical criterion in `Schema:370-395`, not the number of chains: **“Chain consecutive beats when the camera/set and primary subject can hold and the next beat produces exactly one visually distinct, story-needed state change; hard-cut when the required vantage, setting, primary subject, or register changes.”** Enumeration and progressive reveal are examples, not the boundary. Preserve the HARD no-op sentence at `Schema:363-366`.

Make only consistency edits where current text contradicts that criterion:

- `Schema:378-380`: replace “A delta is… progressive reveal” with “A delta is a held-camera story-state change”; retain one-change/word timing, decisive flip, ≤3, and hard-cut language.
- `Lint:249-253,743-746`: replace “only/genuine progressive reveal” with the held-camera/material-state criterion. Keep exactly-one non-empty `changed_elements` HARD. In `_NON_MATERIAL_DELTA` (`Lint:726-729`), keep cosmetic/detail/label/reposition/tiny/decorative/ornamental, but remove blanket `moves to/onto`; lint should inspect **materiality and one-change cardinality**, not action verbs or counts.
- `Critic` via its existing Schema pointer (`Critic:50`): judge two semantics, not totals: (1) could camera/set/primary subject actually hold, and (2) does the delta visibly advance story state? Flag both missed holds and forced holds. No quota, ban, or new section.
- `IG:196-200,231`: resolve the internal contradiction: image generation must read stage metadata for parent routing; “integrative vs discrete” chooses regeneration versus layer realization, **not whether VPW may author the shared stage**. Keep parent, provenance, seed-cap, crop, and verified-only gates.
- `Forge:1257-1258,1348-1390`: mechanics already seed the prior frame correctly. Add no count-based taste gate. Cross-file obligation is exact semantic parity across Schema ↔ VPW pointer/procedure ↔ Lint messages/regex ↔ Critic rubric ↔ IG boundary ↔ Forge validation/tests; otherwise the broad authoring rule will again be narrowed downstream.

This restores liked-era judgment while retaining the lesson from 26/109 fresh no-ops: the gate is **visible story-state change on a holdable camera**, never chain rate.
