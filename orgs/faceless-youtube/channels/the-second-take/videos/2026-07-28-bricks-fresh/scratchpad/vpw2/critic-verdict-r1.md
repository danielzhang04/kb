# Fresh-context VPW critic verdict

Artifact: `channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json` (243 long-form shots)

## Scope and method

- Cold review against all eight questions in `visual-prompt-writer/references/critics.md`, the current visual grammar and style bible, and Daniel's 2026-08-19 taste ground truth.
- Whole-file mechanical/pattern pass over all 243 prompts and stage chains.
- Shot-by-shot qualitative sample: L01-L25; every `stage_role: base` (107 shots); and deterministic random non-base shots L50, L53, L58, L73, L83, L100, L136, L159, L162, L180, L185, L189 (seed `20260819`, three per act).
- Assembly flags force-reviewed separately: L112, L132, L243, L85, L207, L208.
- Author notes outside `shots.json` were not read. Only `partitions.json` was read from the VPW authoring area, for act ranges.

## Mechanical evidence

- `lint_shots.py` read-only result: zero HARD violations.
- Registry resolution: 47 distinct backticked names used; zero absent from the current registry.
- Voice-aware lint emitted 146 heads-ups. The exact cadence breakdown and critic rulings follow below.

## Per-critic-question results

### 1. Scene logic and facts — FAIL

Most sampled frames have intelligible object relations and explicit depth. All 11 sampled two-seeded-figure bases pin plane, eye-line, relative head scale, facing, and face clearance. The material logic failures are:

- L78-L79 replace the two managers who bear the beat with jacketed empty chairs.
- L112 depicts the rented off-site warehouse while the VO is still only the managers' decision setup.
- L120 asks one `hold-both-hands` seed to hold a brick in one hand and steady a separate open carton in the other.
- L126 says "Perfectly indistinguishable" while both cartons are open and visibly contain different things; the indistinguishable state arrives late at L127.
- L160-L162 depict an executive bringing family to pack with no family member and with `brick-foreman` standing in for the executive.
- L168 says "It was a layoff" but shows only a dormant warning panel; the chain does not deliver its promised consequence.

### 2. Literal-check against the bar — FAIL, localized

The class mix is not collapsed: ironic-counterpoint 53, literal 39, physicalized-imbalance 38, staged-interaction 28, personified-character 18, register-shift-infographic 16, and nine smaller classes. Literal shots are generally attached to concrete actions or objects. The failures are not excess literalism so much as deleting the true human subject: L78-L79 turn the managers into furniture, L112 removes the managers from their decision beat, and L160-L162 replace the family relationship with an empty station and lunchbox.

### 3. Prompt construction and payload ordering — FAIL

- Registry: PASS — every backticked name resolves; no silent slug invention.
- Seeded-figure prose: FAIL at L120, where the prose authors two independent hand-object mechanics over `hold-both-hands`.
- Positive absence / author-mechanism leakage: FAIL at L09 ("with no people"), L54 ("no likeness-specific trait"), L78 ("without individuated people"), L123 ("without a backticked prop slug"), L136 ("without showing a payment"), L137 ("without lettering"), L155 ("without turning the foreman into background furniture"), L160 ("without casting an invented person"), and L162 ("without depicting an unapproved person"). L123/L155/L160/L162 are authoring rationale inside the image prompt, not scene content; L136 is also a factual risk because naming the forbidden payment may cause the generator to draw it.
- Crowd expression/attitude: PASS — all 54 crowd-declared shots author a beat-fit expression or group attitude.
- Forced payload row: the sampled bases do not generally reopen a fresh scene after the payload, and quoted-literal/delta closure passes lint. The failures are temporal rather than terminal-clause placement: the payload is assigned to the wrong VO beat in L38-L40, L66-L71, L98-L100, L126-L127, L166-L168, and L184-L186.

### 4. Renderability and generator risk — FAIL

- L71 asks a sticky delta to enlarge Wiles's seeded body until his shoulders dominate the upper background; that is a whole-figure rescale/reframe, not the one feasible semantic change the parent is built to accept.
- L87's group "enters" the aisle without a held arrival tableau or whole-body attitude, so the action reads as a freeze of travel.
- L101-L103 leave the load-bearing count as bare "three locked ... boxes" rather than a countable arrangement such as a row of three.
- L120-L122 bind incompatible independent hand mechanics to `hold-both-hands`.
- L243 leaves "three retained ... payroll cards" as a bare count and also asks one static tableau to carry an 8.88s real hold.

### 5. Disclosure order — FAIL

Earliest premature disclosures:

- L39 shows `600 MILLION` before L40 says it; L40 introduces the modern comparison tower before L41 says the Reddit comparison.
- L44 shows a dismissal sheet and Terry departing before L45 narrates the layoffs and Terry's exit.
- L112 shows the off-site warehouse before L113 says one was rented.
- L132 introduces `return-customer` before L133 first says "customers."
- L178 reveals `rifenburgh-ceo` before L180 says Richard Rifenburgh.
- L185 prints `1986` before L186 says it.
- L191 puts MiniScribe below zero before L192 reveals its negative worth.
- L233 stages the transfer to the rival drive maker before L234 names Maxtor and says it bought the remains.

### 6. Two-figure plane/scale coherence — PASS

All 11 two-seeded-figure bases (L18, L32, L35, L44, L46, L96, L115, L132, L135, L204, L233) describe a coherent shared plane and relative scale. None places the second-named figure into an implied rear zone. Some fail disclosure or subject timing, but not topology.

### 7. Action-chain cause-to-effect readability — FAIL

There are 86 multi-shot stages. Most are mechanically and semantically progressive. These chains are not:

- L38-L40: the `600 MILLION` result and then the modern comparison arrive one VO beat early.
- L66-L68: the target sheet appears on "fear," while the actual "set sales targets" shot changes a telephone network instead of delivering targets.
- L69-L71: the fat bonus is present at the base, before it is spoken; the final beat enlarges Wiles rather than delivering the bonus.
- L98-L100: the better sheet replaces the real one before "wrote down a better number," and the final beat changes to a pressure shadow after the effect.
- L126-L127: open, visibly different contents contradict "Perfectly indistinguishable"; closure arrives on the unrelated Peloton setup.
- L166-L168: the chain's promised final cause is the layoff, but its final image is another dormant watchdog device.
- L184-L186: the 1986 stop arrives on L185, one beat before the spoken year.

### 8. Semantic-cast justification — FAIL, localized

The broad cast is mostly justified by named roles or a consistent representative function; this is not a wholesale wrong-cast wave. The clear failures are L78-L79, where two story-bearing managers are demoted to empty chairs, and L160-L162, where `brick-foreman` substitutes for an explicitly stated executive while the executive's family is absent. L132's customer cast is semantically appropriate after the word "customers," but is introduced one shot early.

## Plan-level results

### Balanced human use

The longest figureless run by real VO time is L26-L27 at 13.08s. The brick/carton is legitimately the subject, so figurelessness itself is earned; the two real holds (6.73s and 6.35s) are not. The actual human-use defects are L78-L79, L112, and L160-L162, where a decision or relationship whose subject is people is staged through an empty place/object.

### Cadence taste

FAIL, systemic. Voice-aware lint finds 115 of 243 real holds outside the cadence band: 73 below 1.5s, 21 over the 3s band, and 21 over the 4s earned ceiling. Twenty-seven deltas are longer than their bases. The over-4s set is L03, L26, L27, L41, L45, L85, L106, L110, L111, L113, L131, L141, L188, L192, L193, L200, L208, L218, L225, L230, and L240. L243 is separately a >8s span (8.88s real); L85 is 7.07s real. This is not fixable by changing `duration_s`: boundaries must be merged/split against the existing voice manifest.

### Place monotony and stage grouping

Stage grouping is semantically active rather than absent: 86 multi-shot stages, with coherent held-set logic in most chains. Place reuse is also justified by the narration. The MiniScribe place allocation is nevertheless unbalanced: 25 shots use `miniscribe-building`, while the L28 factory plate and L86 warehouse variant each effectively carry roughly 12 shots and the L84 conference variant carries only two. That puts two backdrops near half the place run each, above the doctrine's rough one-third ceiling, and reinforces the repeated depth template.

## Monotony counts

Counts are prompt occurrences by shot unless stated otherwise; vantage categories overlap.

| Axis | Count / longest span | Ruling |
| --- | ---: | --- |
| `cropped` | 218/243 | New dominant staging tic. |
| `foreground` | 219/243 | Nearly universal plane label. |
| `cropped` + `foreground` | 202/243; longest contiguous run L135-L177 (43) | Same entry device overwhelms nominal vantage variety. |
| recession language (`recede`/`receding`) | 174/243; longest run L23-L61 (39) | Depth is repeatedly asserted with the same verb family. |
| cropped + foreground + midground + recession | 114/243; longest run L160-L176 (17) | Repeated three-plane sentence architecture. |
| small/recede phrase family | 63/243 | New tic replacing the old wording. Exact `small and receding`: 24; exact `receding smaller`: 14. |
| prior warned tics | `clearly smaller`: 0; `receding rows`: 0 | Old exact tics removed, but the device migrated rather than disappeared. |
| explicit air/negative-space stock phrases | 18/243 | Too sparse to establish the 30-50% air gestalt, and often asserted rather than spatially built. |
| lead scale on 70 named-cast bases | 6 explicitly small/tiny in the opening figure clause; 16 explicitly large/dominant | The taste ratio is inverted too often; most remaining leads are medium/foreground-default. |
| temperature | `warm`: 235; `amber`: 167; `warm cream`: 131; cool-confined/motivated tail: 96 | Balanced-warm becomes a near-universal recipe instead of a scene decision. |
| recurring palette nouns | `tobacco brown`: 89; `muted teal`: 55; `forensic charcoal`: 40 | Strong act-level palette reuse. |
| vantage tokens | wide 68; high 68; three-quarter 30; low-wide 17; oblique 7; top-down 6; frontal 6 | Nominal angle variety exists, but the same cropped-foreground/recession depth shape makes it read less varied than the token list. |
| declared durations | `2.3s`: 72 shots; L112-L176 is 65 consecutive shots at 2.3s | Severe timing-template tic, contradicted by real VO holds. |
| exact/normalized sentence templates | `The committed palette is...`: 31; normalized cast opening `... remains stage-left facing...`: 17 | Repeated prose register beyond required chain continuity. |
| mandatory delta coda | `everything else exactly as established`: 135; `only this changes`: 101 | Counted for transparency; this repetition is doctrine-required and is not itself a defect. |

The standing taste failure is not cured. The file frequently says "small," "receding," "wide," or "air," but its dominant authored structure is still a cropped foreground object, a medium/foreground lead, and recession boilerplate. That asserts depth while repeatedly composing the same depth shape. The prompts do not reliably stage the target gestalt of a 10-30%-height figure inside a deep structured world with 30-50% open air.

## Assembly-flag rulings

- **L112 warehouse-before-disclosure — FAIL (high):** the warehouse is fully visible before the VO says it was rented, and the managers are absent from their own decision beat. Re-author L112 around the managers' collective decision with every warehouse cue absent; disclose the warehouse only after "rented a warehouse" begins in a densified L113 sequence.
- **L132 customer-one-early — FAIL (high):** `return-customer` appears on the Singapore-shipping line. Keep L132 to pallet/cargo departure; introduce the customer as a fresh base on L133's word "customers," then rebuild the return-contract chain from that base.
- **L243 9.4s hold — FAIL (blocking):** declared 9.4s, real 8.88s, 33-word span, one static tableau. Split the HR naming reveal from the payroll/Christmas counterfactual into at least two additional cuts; if the three-card device remains, stage the cards in a countable row or fan.
- **L85 long span — FAIL (high):** declared 3.0s but real 7.07s over 21 words; a blank sheet plus crowd huddle provides no progressive refresh. Split the room's need, the missing number, and the collective decision to write one into distinct cuts.
- **L207/L208 seated supports — PASS for support geometry:** both prompts explicitly keep the judge fully supported on a high-backed oak chair behind the bench, and the framing retains that chair. Independent cadence issue: L207 is only 0.97s real; L208 is 4.01s real and its 3.5s delta is longer than the 1.8s base.

## Ranked defect list

| ID | Defect | Severity | Exact fix intent |
| --- | --- | --- | --- |
| SYSTEM-CADENCE | 115/243 real holds are outside cadence; 27 deltas outlast their bases; L112-L176 repeats 2.3s for 65 shots. | blocking | Re-cut anchors against `voiceover.manifest.json`: merge sub-1.5s fragments and split >4s spans into new payload-bearing shots; do not edit `duration_s` as a substitute. Re-run the critic because the repair necessarily touches over one third of the list. |
| SYSTEM-SCALE | Cropped-foreground/recession boilerplate dominates, while only 6/70 named-cast bases explicitly stage the lead small/tiny and 16 make it large/dominant. | blocking | Re-compose the affected bases from world geometry outward: choose distinct architecture/depth shapes, keep story figures genuinely 10-30% frame height where scale is the argument, and reserve real 30-50% open air through layout rather than the words "small/receding/air." |
| PLACE-miniscribe-building | Two effective backdrops each carry roughly 12 of the place's 25 shots, above the rough one-third plate-variant ceiling. | high | Add/reassign a genuinely different factory/warehouse zone or vantage within the same place and redistribute anchors so no one plate carries about half the run. |
| L26-L27 | Longest figureless run is 13.08s real in the first minute; both static holds exceed 6s. | high | Preserve the object-led hook but split its reveal/count/world-sale payload into faster distinct compositions. |
| L39-L40 | `600 MILLION` and then the modern comparison are each disclosed one VO beat early. | high | Put the buyer/Compaq beat on L39, the 600-million tower on L40, and introduce the modern comparison only when L41 speaks it. |
| L44-L45 | Dismissal and Terry's exit appear before the narration states either consequence. | high | Stage the IBM order cut alone on L44; introduce workers/Terry only on L45 and densify its 5.88s real span. |
| L66-L71 | Target and bonus payloads run one beat ahead; L71 also attempts a sticky whole-figure rescale. | high | Re-map each visual change to its spoken noun/result and replace L71's body enlargement with a new base or an object-state change that the held composition can accept. |
| L78-L79 | Two story-bearing managers are replaced by empty dressed chairs. | high | Put performing people back into the beat: plan the required manager cast or restage the incident as genuine mass action without making furniture bear the human act. |
| L85 | One static crowd/tableau carries 7.07s real and 21 words. | high | Split need, absence, and falsification into separate readable cuts. |
| L87 | "enters" relies on travel-in-progress and the crowd lacks a held whole-body arrival attitude. | medium | Stage the audit team planted across the threshold with cases held and a clear paused group posture. |
| L98-L100 | Better-sheet effect appears before its spoken cause; the last beat switches to pressure shadow. | medium | Keep the real sheet through L99, make the better sheet the L100 payload, and move pressure to an earlier setup or separate shot. |
| L101-L103 | Bare count of three boxes is not staged countably. | medium | Arrange them explicitly in one row of three (or remove the arbitrary count) and carry that arrangement through the deltas. |
| L112 | Warehouse disclosure is early and the managers are absent from the decision beat. | high | Re-author L112 as the managers' plan with the warehouse entirely absent; reveal the set only after the relevant L113 words. |
| L120-L122 | `hold-both-hands` is asked to perform two incompatible one-hand object acts. | high | Fix the carton on the bench and make both hands carry one primitive-compatible act/object; rebuild later deltas from that feasible base. |
| L123/L155 and prompt-leak set | Author-mechanism and negative-absence prose appears inside prompts (full set: L09, L54, L78, L123, L136, L137, L155, L160, L162). | medium | Remove rationale/mechanism language from pixels; state positive scene surfaces and move explanations to `notes`. |
| L126-L127 | The visible contents contradict "Perfectly indistinguishable"; closure arrives on the Peloton line. | high | Make L126 the closed, externally identical-box payoff, then hard-cut to the Peloton analogy instead of carrying the box delta into it. |
| L132 | Customer cast enters one shot before "customers." | high | Keep L132 customer-free and introduce `return-customer` on a fresh L133 base. |
| L136 | "without showing a payment" names the unverified bribe inside a negative instruction and may generate it. | high | Describe only the empty under-table space and ambiguous shadow as positive visible facts; omit payment/money nouns from the prompt. |
| L160-L162 | An explicitly stated executive and family relationship is replaced by `brick-foreman`, an empty station, and a lunchbox. | blocking | Plan the correct executive/family story-bearer cast and stage at least one family helper performing the packing relationship; do not proxy them with an object or crowd. |
| L166-L168 | The chain ends on a dormant panel instead of the narrated layoff. | high | Make L168 visibly deliver the layoff consequence or cut directly to a newly timed worker/layoff base on the word "layoff." |
| L178-L180 | Rifenburgh's canonical appears two shots before his name. | high | Use a generic management-team setup until L180, then reveal `rifenburgh-ceo` on the naming words as a fresh base. |
| L185-L186 | `1986` is lettered one beat before it is spoken. | high | Keep L185's chronology unresolved; place the dated stop on L186. |
| L191 | MiniScribe is shown under zero before the VO reveals negative worth. | high | Keep the zero/shaft consequence absent on L191; reveal the below-zero state with the 88-million line on L192. |
| L233-L234 | The rival buyer and transfer are visible before Maxtor and the purchase are narrated. | high | Let L233 show MiniScribe's disappearance alone; introduce the rival/transfer as a fresh base on L234. |
| L243 | Static 8.88s real final hold; bare three-card count. | blocking | Split the final argument into multiple cuts and arrange any retained cards in an explicit countable geometry. |

## VERDICT

**REJECT.** This file should not enter generation. The blocking reasons are systemic real-cadence failure, a whole-file composition template that still asserts rather than stages Daniel's scale gestalt, and a missing-family/wrong-subject sequence at L160-L162. The disclosure and chain defects are individually repairable, but the cadence/scale repair will touch more than one third of the artifact and therefore warrants a second fresh critic pass after re-authoring.
