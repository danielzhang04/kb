# Bricks variant D occupancy forensics — round 2

## Method and scope

Human means a real human body. Personified devices/company tokens (`pc-boxy`,
`drive-maker`, `miniscribe-rep`, `ibm-suit`, etc.) are excluded, matching the
existing audit definition (`scratchpad/taste-audit/character-presence-audit.md:18`).
Rendered counts are direct frame reads; `7+` is deliberately a bucket rather
than false precision where bodies overlap. Authored intent is read from each
branch's complete `long_form.shots[].still_prompt` plus `figures.crowd`; it is
not an image-generation success measure. Daniel's verdict and the standing
rulings in the brief are the judgment authority.

## 1. Counts: rendered frames and authored intent

### Frame-by-frame counts

| Set | Human-figure count by frame (`count/bucket`) |
| --- | --- |
| va L01–L12 | L01 0/0; L02 0/0; L03 0/0; L04 0/0; L05 0/0; L06 0/0; L07 0/0; L08 0/0; **L09 7+/7+**; L10 0/0; L11 0/0; L12 0/0 |
| vb L01–L12 | L01 0/0; **L02 7+/7+**; L03 0/0; L04 0/0; L05 0/0; L06 0/0; L07 0/0; L08 0/0; **L09 7+/7+**; L10 0/0; L11 0/0; L12 0/0 |
| vc L01–L12 | **L01 7+/7+**; L02 0/0; L03 0/0; L04 0/0; L05 0/0; L06 0/0; **L07 7+/7+**; L08 0/0; L09 0/0; L10 0/0; L11 0/0; L12 0/0 |
| liked L01–L25 | L01 0/0; L02 0/0; L03 0/0; L04 0/0; L05 0/0; L06 0/0; **L07 7+/7+; L08 7+/7+**; L09 0/0; **L10 7+/7+**; L11 0/0; L12 0/0; L13 0/0; L14 0/0; L15 0/0; L16 0/0; **L17 2/2–3; L18 2/2–3; L19 1/1; L20 7+/7+; L21 1/1; L22 1/1**; L23 0/0; L24 0/0; L25 0/0 |

Evidence: variant PNGs at `scratchpad/variant-frames/{va,vb,vc}/L01..L12.png`;
liked PNGs at `assets/_archive-pre-reset/scenes/L01..L25.png`. The earlier audit
independently records that the fresh L01–L25 board had one crowd and no named
human bodies (`scratchpad/taste-audit/character-presence-audit.md:53`).

### Histograms

| Rendered set | 0 | 1 | 2–3 | 4–6 | 7+ | Share in 1–3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| va (n=12) | 11 | 0 | 0 | 0 | 1 | **0/12 (0%)** |
| vb (n=12) | 10 | 0 | 0 | 0 | 2 | **0/12 (0%)** |
| vc (n=12) | 10 | 0 | 0 | 0 | 2 | **0/12 (0%)** |
| all variants (n=36) | **31** | **0** | **0** | **0** | **5** | **0/36 (0%)** |
| liked L01–L25 (n=25) | **16** | **3** | **2** | **0** | **4** | **5/25 (20%)** |

The liked slice is not “people everywhere”: most frames are still empty (16/25),
but its five 1–3-person frames bridge object-only space and true mass scenes.
The variants delete that bridge. This is the measured form of Daniel's “good
middle ground,” not a proposed quota.

### Authored human-figure intent in the complete variant fragments

| Authored fragment | Shots | 0 | 1 | 2–3 | 4–6 | Crowd/7+ | Share in 1–3 | Human-bearing shot IDs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| va | 47 | **43** | 3 | 0 | 0 | 1 | **3/47 (6.4%)** | L09 crowd; L30 Terry; L43 worker; L44 Terry |
| vb | 45 | **39** | 3 | 0 | 0 | 3 | **3/45 (6.7%)** | L02/L09/L15 crowds; L30 Terry; L43 worker; L44 Terry |
| vc | 44 | **41** | 1 | 0 | 0 | 2 | **1/44 (2.3%)** | L01/L07 crowds; L34 Terry |

Evidence: `git show claude/bricks-variant-{va,vb,vc}:orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`, listed shot IDs. All three prompts explicitly declare their crowd shots; all singleton rows explicitly name a real-human token. The named two-character beats use personified company/device tokens and therefore do not enter the human count (`character-presence-audit.md:18`).

**Finding.** The skew is authoring-born. Generation preserved the opening
boards' authored binary choice exactly: 31 authored human-empty frames rendered
empty, and the five authored crowds rendered as 7+. Across the complete
fragments, 123/136 shots (90.4%) author zero humans, seven author a crowd, six
author one human, and **none author a human pair or trio**. INFERRED: rendering
may worsen crowd density/individuation, but it did not create the missing-middle
distribution.

## 2. Per-frame judgment

`Right` means the human count suits the narrated beat; it does not excuse an
unrelated rig/style defect. Sources are the rendered PNG and the same-branch
`shots.json` record named by shot ID. Proposed figures stay roughly 10–25% of
frame height in the mid/rear zone, preserving the liked “small figure in a
large structured world” gestalt (`doctrine-recon/goal-state.md:17-23`).

### va

| Frame | Verdict | Beat evidence and concrete occupancy direction |
| --- | --- | --- |
| L01 | **Right** | VO “We're in the 1980s.” The era-room/computer is the subject; 0 humans is a legitimate establishing object beat. |
| L02 | **Too few** | “Home to big hair, Pac-Man.” Add **two** small midground teens at the distant cabinet—one playing, one watching, with period hair silhouettes. They make the cultural action visible without a crowd. |
| L03 | **Right** | “one of the funniest [corporate scams].” The carton/pedestal/red-thread mystery is the payload; 0 is earned. |
| L04 | **Right** | “corporate scams that you've never [heard of].” `pc-boxy` supplies a non-human reaction; no human causal actor is named yet. |
| L05 | **Right** | “It's 1983.” Calendar + computer is a time/object fact; 0 is cleaner. |
| L06 | **Right** | “computer had only been invented.” Machine + short circuit-board sprout makes newness the mechanism; 0 is earned. |
| L07 | **Too few** | “They were all the craze.” Add **a clerk and one customer** small at the rear counter, the clerk presenting a boxed PC across the bench. The social craze needs actors, not a mass. |
| L08 | **Too few** | “Anybody with money was buying.” Rebase/hold the depletion with **one customer and one clerk** completing the handoff beside the barer shelf; 2 figures, not a crowd. |
| L09 | **Right (count); rig failure** | “they were flying off [the shelves].” Aggregate demand is the subject, so a rear-zone **7+ crowd belongs**. The existing prominent/individuated front row is separately defective (`variant-visual-review.md:21-23,89`); reduce visual dominance, not occupancy class. |
| L10 | **Right** | “like when Apple [released the iPhone].” The product analogy is the subject; 0 avoids an unnecessary reenactment. |
| L11 | **Right** | “computers run on these [things].” Component hero/mechanism beat; 0 is correct. |
| L12 | **Right** | “A hard drive is the [part…].” Computer-to-drive conduit explains a relationship between objects; 0 is correct. |

### vb

| Frame | Verdict | Beat evidence and concrete occupancy direction |
| --- | --- | --- |
| L01 | **Right** | “We're in the 1980s.” Home-den mystery object is a valid cast-free hook. |
| L02 | **Too many** | “Home to big hair, Pac-Man.” Minimum is **two** small teens—player + onlooker—at the distant cabinet. The subject is an era vignette, **not a mass**, so the crowd rig does not belong. |
| L03 | **Right** | “one of the funniest [corporate scams].” Trophy-carton symbolic stand-in carries the tease; 0 is earned. |
| L04 | **Right** | “corporate scams that you've never [heard of].” Small `pc-boxy` reaction is legitimate personification before human actors enter. |
| L05 | **Right** | “It's 1983.” Calendar/computer time fact; 0 is correct. |
| L06 | **Right** | “computer had only been invented.” Tiny machine in huge showroom is precisely an object/scale beat; 0 is correct. |
| L07 | **Too few** | “They were all the craze.” Replace “EMPTY/no shoppers” with **one clerk showing a computer to one customer**, small beneath the skylight; the stocked architecture remains dominant. |
| L08 | **Too few** | “Anybody with money was buying.” Keep the depleted-shelf delta but retain that **clerk/customer pair** completing a box-for-payment exchange in the midground. |
| L09 | **Right** | “they were flying off [the shelves].” Mass demand is the subject; a restrained rear-zone **7+ crowd belongs**. This is the best of the variant crowd executions (`variant-visual-review.md:36-38`). |
| L10 | **Right** | “like when Apple [released the iPhone].” Carton-on-ramp is a clean object analogy; 0 is earned. |
| L11 | **Right** | “computers run on these.” Drive hero/mechanism; 0 is correct. |
| L12 | **Right** | “A hard drive is the [part…].” Computer/drive conduit is the causal subject; 0 is correct. |

### vc

| Frame | Verdict | Beat evidence and concrete occupancy direction |
| --- | --- | --- |
| L01 | **Too many** | “We're in the 1980s.” Minimum is **one** small distant period shopper passing the TV, enough to make the mall lived-in. The subject is era/place, **not a mass**; crowd rig does not belong. |
| L02 | **Too few** | “Home to big hair, Pac-Man.” Add **one** small teen actively playing the cabinet, period hair silhouette readable; keep `pc-boxy` secondary. |
| L03 | **Right** | “one of the funniest corporate [scams].” Cracked trophy is an earned symbolic object beat; 0 is correct. |
| L04 | **Right** | “scams that you've never heard of.” Unknown carton in an empty museum corridor stages obscurity/absence; 0 is correct. |
| L05 | **Right** | “It's 1983, and the personal [computer…].” Product row and dated world are the subject; 0 is acceptable. |
| L06 | **Right** | “computer had only been invented a [few years earlier].” Tiny new machine in a vast showroom is the intended scale argument; 0 is correct. |
| L07 | **Right (count); rig failure** | “They were all [the craze].” The craze is genuinely collective, so a rear-zone **7+ crowd belongs**. The rendered wall-to-wall individuation was correctly parked (`variant-visual-review.md:51-53,87`); repair the rig/depth, not the class. |
| L08 | **Too few** | “Anybody with money was [buying].” Keep the balance metaphor, but add **a customer and clerk** small behind it, exchanging one boxed computer; the pair acts the verb while the scale carries the argument. |
| L09 | **Too few** | “buying one, and they were flying [off].” Add **a clerk handing one carton to one customer** at a distant checkout bay; two figures make throughput visible without reopening a crowd. |
| L10 | **Right** | “off the shelves.” Empty shelf + surprised `pc-boxy` is an aftermath beat; 0 humans is earned. |
| L11 | **Right** | “when Apple released the iPhone.” Generic phone/computer comparison is object-led; 0 is correct. |
| L12 | **Right** | “computers run on these things [called hard drives].” Component hero is the subject; 0 is correct. |

**Judgment tally:** 26 right, 8 too few, 2 too many. The two unnecessary
crowds collapse to one or two actors; the eight empty misses recover mostly as
one working pair. No 4–6 compromise is needed. INFERRED: the useful middle is
functional staging—who performs the sentence—not a numerical halfway point.

## 3. Trace to doctrine

### How the stack selects occupancy

- **0 figures — permitted for object/mechanism beats.** The vb plan says: “Object-only frames are limited to the mechanism, quantity, or absence beats that would lose clarity with a performer added” (`V/scratchpad/vpw-var/plan.md:25`). The grammar simultaneously makes non-literal depiction the default and reserves literal depiction for physical actions/objects (`visual-kit/visual-grammar.md:28-34`). The schema offers numerous object-capable classes beside `crowd-multiplication` (`visual-prompt-writer/references/shots-schema.md:55`).

- **1 figure — story-bearing individual.** The operative grammar says: “Every story-bearing individual is seeded named cast. Only a genuine rearward mass beat uses the simplified crowd rig” (`visual-kit/visual-grammar.md:147`). The more explicit upstream formulation is: “One seeded figure is the default human solution” (`V/scratchpad/vpw3/plan.md:17`). The VPW skill delegates figure staging to the grammar (`visual-prompt-writer/SKILL.md:125`) and orders authors to “classify → cast → stage the tableau” (`SKILL.md:140-141`).

- **2 figures — mechanically supported, weakly authored.** The grammar says “Co-stars share eye-line and height” (`visual-grammar.md:67-69`) and describes a two-figure interaction asset with ordered cast slots (`visual-grammar.md:106-110`). `cast` enumerates every prominent figure and seeds its identity/pose/expression (`shots-schema.md:170`); missing interactions block through `needed_assets` (`shots-schema.md:179`). Lint explicitly requires “two seeded figures and a fresh base” for interaction geometry (`scripts/lint_shots.py:1079-1104`).

- **3 figures — UNVERIFIED.** Arrays can represent more than two entries, but this audit did not verify the vb seed-cap/forge path for three independently seeded humans plus scene assets. Doctrine should not promise this until that path is tested.

- **Crowd — one cheap categorical switch with a strong visual anchor.** `figures.crowd` is the only structured figure key lint recognizes (`lint_shots.py:661,718-721`). The grammar supplies a complete CROWD-RIG clause (`visual-grammar.md:112-118`), requires it only for a genuine rearward mass (`visual-grammar.md:147`), and seeds the exemplar into every crowd generation (`visual-grammar.md:133-140`). The bible reviews every depicted crowd figure against that exemplar (`style-bible.md:160,214`); the registry provides the ready-made `crowd-anchor` (`registry/registry.json:78-84`).

- **Object/cast-free protection is strong.** The critic explicitly says not to flag non-literal depictions merely because they feel indirect (`references/critics.md:57`). That is correct in isolation, but the vb critic contains no equally concrete “who performs this verb?” test.

### Why these clauses yield poles

The stack provides three highly legible routes: no human declaration, one fully seeded story-bearer, or one `crowd:true` switch backed by a finished exemplar. A functional pair requires two cast records, compatible seeded assets, interaction geometry when relevant, and a fresh base. INFERRED: this asymmetric authoring cost encourages “object-only or crowd,” matching the authored fragments—123/136 zero-human shots, seven crowds, six singletons, and no pairs/trios.

The vb plan’s criterion is directionally correct, but “actor/worker/reaction beats retain a body” (`vpw-var/plan.md:25`) is not applied before class selection. Consequently “craze” and “buying” become shelf/quantity metaphors or crowds instead of clerk/customer actions.

### Is there middle-ground vocabulary?

**Mechanical vocabulary exists; staging vocabulary does not.** The stack knows `staged-interaction`, co-stars, ordered two-cast slots, and interaction assets (`shots-schema.md:55,170`; `visual-grammar.md:67-69,106-110`; `registry.json:410,418,458`). It does not teach ordinary small-group tableaux such as clerk + customer, two workers sharing a bench, manager + auditor over a ledger, or player + onlooker. Thus “few” appears as exceptional interaction plumbing, not a normal occupancy decision.

The liked-era skill was clearer about the missing route:

> “An anonymous person with an individual count, action, or face requirement is CAST, or the beat restages as mass action” (`git show 30d2b7e8:.../visual-prompt-writer/SKILL.md:68-72`).

The restoration dropped that explicit **individually counted actor → cast** route. Do not restore the liked-era fallback that pushed all non-story-bearing people to crowd scale; retain promotion/seeding and restore only the useful actor-routing judgment.

### Ranked causes

1. **Missing actor-first decision at authoring time.** Eight empty rendered beats narrate an action best carried by one person or pair; none of the 136 authored shots chooses a human pair.
2. **Binary cast model plus asymmetric tooling pressure.** Zero costs nothing; crowd is one boolean; a pair invokes multiple seeded records and interaction checks. INFERRED from `shots-schema.md:170,179` and `lint_shots.py:1079-1104`.
3. **Rich object-class vocabulary without equivalent ordinary-pair examples.** The schema enumerates many object/non-literal classes but no occupancy staging patterns (`shots-schema.md:55`).
4. **Crowd exemplar availability.** The exemplar makes a mass visually easy once selected (`visual-grammar.md:133-140`; `registry.json:78-84`), though it does not itself decide when a crowd belongs.
5. **Generation is secondary.** Rendering worsened some crowd density/individuation, but exactly preserved the authored zero-versus-crowd opening-board choices.

## 4. Remedy direction

Make the smallest normative change in the existing **Figure / crowd staging** section, replacing—not supplementing—the story-bearer sentence at `visual-grammar.md:147`:

> Decide occupancy from who is acting in this beat. Use no human when mechanism, quantity, place, object, or absence is the subject; one seeded performer for one person’s decision/action/reaction/consequence; a seeded pair or necessary small group when exchange, relationship, or shared labour makes the sentence true; the simplified crowd rig only when the subject is the mass.

Then add compact examples inside that same figure paragraph: clerk + customer exchanging a box; two workers at one bench; manager + auditor over one ledger. Preserve small mid/rear scale and the structured world. This is vocabulary, not a quota.

Required aligned edits:

- `visual-grammar.md:147`: canonical occupancy criterion and small-group examples.
- `visual-prompt-writer/SKILL.md:140-141`: change dispatch order to **subject → acting participants → occupancy → class → cast → tableau**; keep `SKILL.md:125` pointing to the grammar as the sole normative home.
- `V/scratchpad/vpw-var/plan.md:25`: replace its narrower sentence with the same actor-first application, condensed for this run.
- `references/critics.md`: replace the current human-use prompt in place with: “Who acts in this sentence, and would removing every visible person hide that causal subject?” Also ask whether every crowd’s subject is genuinely the mass.
- `shots-schema.md:170,179`: preserve seeded cast arrays and interaction gating; clarify that ordinary two-person action is legal without requiring physical-contact choreography. Verify three-person seed support before documenting it.
- `lint_shots.py`: retain declaration/interaction validation; add diagnostics, not pass quotas.

Lint should report:

- Consecutive zero-human runs with shot IDs, duration, `vo_ref`, and derived VO text.
- Every crowd-bearing shot with `vo_ref`, class, and neighboring occupancy.
- Every one-/two-/three-cast shot and whether its assets/base are renderable.

The critic—not lint—should judge zero-runs containing hidden actions/decisions and crowd frames whose narrated subject is not a mass. No fixed maximum run, minimum human share, or crowd ban.

Cross-file obligation: grammar owns judgment; VPW owns decision order; plan applies it locally; schema/image-generation/forge preserve seeded execution; lint exposes measurements; critic makes the semantic call; bible/registry continue to own only crowd appearance. Update equality fixtures/tests wherever these exact clauses are mirrored, and delete superseded wording instead of adding an exception block.
