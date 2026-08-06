# Remint verification — fresh-eyes pass (2026-08-05)

Verifier: fresh-eyes Claude subagent. Judged only what is visible. No files changed outside this one.

## Calibration (register exemplars, read first)

- `refs/env/scene-style-tile.png` — warm cream/peach/brick palette, muted sage accents; **medium-thick
  warm dark-brown outline** on every object; one-point frontal staging at eye level, storybook flat.
- `refs/qt-wiles/qt-wiles.png` — older man, silver swept-back hair, **warm peach/tan skin**, grey
  three-piece suit + white shirt + grey tie + gold tie bar, brown shoes, dark-brown outline.
- `refs/auditor-rep/auditor-rep.png` — **medium-brown skin**, dark hair, round goggles/glasses pushed
  up on forehead, charcoal three-piece suit, brown ledger book under right arm, dark-brown outline.

Note: `_staging/L05.png` is **byte-identical** to `refs/env/scene-style-tile.png` (SHA-256 prefix
`bb725adf7676`, both 2752x1536), and differs from its own archived prior (`9447bfc1a479`). The
carried-over "first-pass frame" is literally the style-tile file copied into the plate slot. It is
therefore trivially in-register and is not independent evidence that the remint doctrine works.
All other plates are 1376x768.

---

## Findings (one row per asset, appended as reviewed)

### L03.png — plate, night warehouse (pallets under work-light)
**Verdict: CONCERN**
- Outline: mixed. Pallets/boxes/light-stand carry a correct medium warm-brown line. The room shell —
  walls, roller door, right-hand steel racking, windows — is drawn in **thin cool grey/near-black**
  line, noticeably finer than the tile's stroke. Two line registers in one frame.
- Camera: two-point recession — left wall and right racking both converge hard toward a rear vanishing
  zone, racking foreshortened steeply. Not a vantage trick (still roughly eye-level, no tilt), but
  **deeper than the tile's flat one-point staging**.
- Palette: **grey/cool-blue dominant.** Walls, floor, door, racking all desaturated cool grey; the only
  warmth is the amber pool and the cardboard. Read as a night scene this is motivated, but against the
  criterion "warm-leaning overall" it does not pass on its own terms.
- Anatomy: n/a (no figures).
- Identity: n/a.

### L05.png — plate, 1983 computer shop (carried-over first-pass frame, 2K)
**Verdict: PASS**
- Outline: even, medium-thick, warm dark-brown throughout. Textbook era line.
- Camera: one-point, frontal, eye-level; counter and shelving stage flat to camera. Textbook.
- Palette: warm creams, peach, brick, wood tan with muted sage accents. Textbook.
- Anatomy / identity: n/a.
- Context per brief: 2K while the rest of the set is 1K — the extra resolution is visible as finer
  detail density (terrazzo speckle, floppy stack) but does not change register. Honest caveat: this
  frame IS the style tile, so it sets the bar rather than clearing it.

### L28.png — plate, MiniScribe assembly floor
**Verdict: FAIL**
- Outline: **thin and cool.** Grey-to-black hairlines on the racking, ceiling fixtures, wall, and the
  drive units. Only the sign and the benches approach a warm brown, and even those are lighter than
  the tile stroke. This is the exact "thin, cool/grey ink" defect the doctrine reset was meant to end.
- Camera: **deep oblique two-point perspective** with an elevated vantage — the bench line drives from
  bottom-left to a right-side vanishing point, the second bench bank runs off-frame right, and we look
  down onto the bench tops. Not frontal, not eye-level, not staged.
- Palette: **grey/white dominant and cold.** Pale blue-grey floor, white-grey walls, bluish fluorescent
  tubes, taupe boxes. Almost no warm mass; the only warm note is the bench wood.
- Anatomy / identity: n/a.
- Judgment: this frame reads as a different show from L05. Fails outline, camera, and palette.
- **Before/after — this is a REGRESSION.** The archived prior (`_pre-remint-archive-2026-08-05/L28.png`)
  had a **thicker, warmer dark-brown line**, a **warm cream floor**, and a saturated warm-wood sign.
  The remint thinned the line to grey hairlines and swapped the warm floor for pale blue-grey. Both
  versions share the same deep oblique camera, so the remint fixed nothing and lost ground on two
  criteria. If a plate must be regenerated, this is the one — and the prior is the better starting
  point, not the new frame.

### L63.png — plate, executive office (blinds, palms)
**Verdict: PASS**
- Outline: even medium-thick warm brown throughout — desk, door, cabinet, blinds, plant. Correct.
- Camera: eye-level-to-slightly-above, desk staged at a mild three-quarter angle. Not frontal in the
  strict sense, but no deep recession, no dutch, no foreshortening drama. Within the storybook range.
- Palette: warm — walnut browns, cream walls, olive carpet, warm sunlight bars. Correct.
- Anatomy / identity: n/a.
- Minor note: the vantage is a touch high (we see a lot of floor plane). It reads as staged, not as a
  camera trick, so it does not trip the vantage rule — but it is the least frontal of the passing plates.

### L71.png — plate, boardroom (long table, ~18 seated figures)
**Verdict: PASS (with one honest observation)**
- Outline: thick, even, dark warm-brown. The strongest line in the set — closest to the tile's weight.
- Camera: symmetric one-point, dead frontal, eye-level. Textbook staging.
- Palette: warm cream walls and ceiling, dark walnut table; the suit mass is cool charcoal but is
  contained by warm surround. Reads warm-leaning overall.
- Anatomy: checked both halves at 1.8x. Every seated figure resolves to **two arms, two hands**;
  hands are simplified four-finger mittens with visible fingers, plausible for the register. Chairs,
  shoes, and legs under the table are consistent. No extra limbs found.
- Identity: the crowd is a deliberate anonymous-extra treatment — hairless egg heads, two eye dots,
  a single mouth line, no nose or ears. Consistent within the frame, and consistent with the chibi
  head-to-body proportion of the canonicals. Not a defect, but note that these extras carry far less
  facial information than any named character; if the channel intends extras to read as people, this
  is the frame that decides that convention.

### L113.png — plate, Colorado Brick yard
**Verdict: PASS**
- Outline: even, medium-thick, warm dark-brown on gate, sign, gantry, brick stacks. Correct.
- Camera: centered one-point, eye-level, recession straight down the lane. Deep, but it is the tile's
  own kind of depth (symmetric one-point), not an invented vantage. Acceptable.
- Palette: the warmest frame in the set — brick red dominant, warm clay ground, tan timber. Pale
  blue sky is the only cool element and reads as sky, not as a cool cast.
- Anatomy / identity: n/a.

### L172.png — plate, night typing pool / newsroom
**Verdict: CONCERN**
- Outline: even, medium-thick, warm dark-brown on desks, lamps, phone, cabinetry. Correct.
- Camera: one-point, frontal, eye-level, symmetric aisle with a foreground desk. Correct.
- Palette: split. Foreground and mid-ground are warm (walnut desks, amber lamp pools, cream paper);
  the ceiling, upper walls, and windows are dark slate-navy. Motivated as night, and the warm mass
  dominates the lower two-thirds, so it passes on balance — but it is the second-coolest frame here.
- Anatomy: inspected both halves at 2.2x. Arm and hand counts are correct (two per figure); hands are
  mitten blobs consistent with the extras register.
- **Faces are inconsistent within the frame.** Some extras are fully drawn (brown-haired man
  centre-left, woman with a bun in the back row) with hair, eyes, nose-line and mouth. Others are
  bald egg heads with **eyes and no mouth at all** (front-left figure, two in the right block). A
  third group has eyes plus a mouth. Three levels of facial finish coexist in one shot, and the
  mouthless ones read as unfinished rather than as a stylistic choice. This is not one of the five
  stated era criteria, which is why it is a CONCERN and not a FAIL — but it is the most likely thing
  a human will point at on this frame.
- Identity: no named characters present.

### L196.png — plate, courtroom (1992 calendar)
**Verdict: PASS**
- Outline: even, medium-thick, warm dark-brown throughout the millwork, bench, tables, windows.
- Camera: near-symmetric one-point from the gallery, eye-level. Staged and flat. Correct.
- Palette: warm honey-oak dominant with cream walls; the jury chairs and window light are the only
  cool notes and are minor. Correct.
- Anatomy / identity: n/a (empty room).

---

## Cards

### fig-auditor-rep--action-present--expr-deadpan.png
**Verdict: PASS — defect-fixed: YES**
- Prior defect confirmed present in the archive: the old frame shows **three hands** — a hanging hand
  at viewer-left, a hand gripping the brown ledger at centre-right, and the presenting hand at right.
- Remint: verified at 1.7x zoom on the torso. **Exactly two arms, two hands, two legs.** The third
  limb is gone.
- Outline: even medium-thick warm dark-brown, matching the canonical's stroke.
- Camera: frontal, eye-level, flat. Correct.
- Palette: charcoal suit on neutral warm-grey card ground — identical treatment to the canonical
  reference, so not a palette drift.
- Identity: matches canonical on skin tone (medium brown), hair, goggles pushed up on the forehead,
  charcoal three-piece, white shirt, brown shoes. Expression correctly reads deadpan (half-lidded)
  versus the canonical's wide-eyed default.
- **Honest caveat:** the fix was achieved by deleting the brown ledger book, which is the character's
  signature prop in the canonical. Anatomy is now correct but the card no longer carries the ledger.
  If the ledger is meant to be part of how auditor-rep reads, this needs a decision, not a re-mint.

### fig-qt-wiles--action-accuse--expr-deadpan.png
**Verdict: PASS — defect-fixed: YES**
- Prior defect confirmed in the archive: **three hands** — the pointing hand at far left, a fist at
  viewer-left, and a third fist at viewer-right.
- Remint: verified at 1.7x. **Two arms, two hands.** The viewer-right fist is gone; what remains is
  the right arm pointing across the body plus the left arm hanging in a fist.
- Outline: even medium-thick warm dark-brown. Correct.
- Camera: frontal, eye-level. Correct.
- Palette: grey suit, warm peach skin, brown shoes, warm-grey ground — matches canonical.
- Identity: matches canonical on silver swept hair, face, grey three-piece, white shirt, brown shoes.
- Minor notes (not blocking): (a) the pointing arm crosses the chest, so the hanging left arm's
  shoulder attachment is fully occluded — the limb is countable but not traceable to a shoulder;
  (b) the gold tie bar visible on the canonical and on the other two qt-wiles cards is not visible
  here (the tie is largely covered by the crossing forearm).

### fig-qt-wiles--action-present--expr-delighted.png
**Verdict: PASS — defect-fixed: YES**
- Prior defect confirmed in the archive: **three hands** — presenting hand at right, a second hand
  hanging below it on the same side, and a hand hanging at viewer-left.
- Remint: verified at 1.7x. **Two arms, two hands.** The duplicated right-side hand is gone.
- Outline: even medium-thick warm dark-brown. Correct.
- Camera: frontal, eye-level. Correct.
- Palette: warm peach skin, grey suit, gold tie bar, brown shoes, warm-grey ground. Matches canonical.
- Identity: matches canonical. The expression changed between versions — the prior smiled with closed
  arc eyes and a toothy grin; the remint has open eyes with pupils and an open mouth with tongue. The
  remint is the more exuberant read of "delighted" and stays inside the character; flagging only so
  the difference is not mistaken for drift.

### fig-qt-wiles--action-armscrossed--expr-crestfallen.png
**Verdict: PASS — defect-fixed: YES**
- Prior defect confirmed in the archive: the face and the visible hand are rendered in a **pale
  grey-green / cool cast**, markedly colder than the canonical's warm peach — it reads cadaverous
  next to the reference.
- Remint: the face and hand are **warm peach/cream, matching the canonical skin tone**. Defect gone.
- Outline: even medium-thick warm dark-brown. Correct.
- Camera: frontal, eye-level. Correct.
- Palette: grey suit, gold tie bar, brown shoes, warm-grey ground. Matches canonical.
- Anatomy: verified at 1.7x — two arms crossed (one hand visible with fingers, the other tucked),
  two legs. Correct.
- Identity: matches canonical on hair, face structure, costume, proportion, skin tone. Brows and
  mouth correctly carry the crestfallen expression.


---

## Summary table

| # | Asset | Verdict | Outline | Camera | Palette | Anatomy | Identity | Defect fixed |
|---|---|---|---|---|---|---|---|---|
| 1 | L03 (night warehouse) | CONCERN | mixed: warm on props, thin grey on shell | 2-point, deeper than tile | grey/cool dominant | n/a | n/a | — |
| 2 | L05 (1983 shop) | PASS | correct | correct | correct | n/a | n/a | — (is the style tile, byte-identical) |
| 3 | L28 (MiniScribe floor) | **FAIL** | **thin, cool grey** | **deep oblique + elevated** | **grey/white cold** | n/a | n/a | — (REGRESSED vs prior) |
| 4 | L63 (exec office) | PASS | correct | mildly high, acceptable | correct | n/a | n/a | — |
| 5 | L71 (boardroom) | PASS | correct (best in set) | correct | correct | 2 arms each, verified | extras deliberately blank | — |
| 6 | L113 (brick yard) | PASS | correct | correct | correct (warmest) | n/a | n/a | — |
| 7 | L172 (night typing pool) | CONCERN | correct | correct | warm fg / slate bg, passes on balance | correct | **3 levels of face finish; some extras mouthless** | — |
| 8 | L196 (courtroom) | PASS | correct | correct | correct | n/a | n/a | — |
| 9 | fig-auditor-rep present/deadpan | PASS | correct | correct | matches canonical | **2 arms** | matches (ledger prop removed) | **YES** |
| 10 | fig-qt-wiles accuse/deadpan | PASS | correct | correct | matches canonical | **2 arms** | matches (tie bar occluded) | **YES** |
| 11 | fig-qt-wiles present/delighted | PASS | correct | correct | matches canonical | **2 arms** | matches | **YES** |
| 12 | fig-qt-wiles armscrossed/crestfallen | PASS | correct | correct | **face warm again** | 2 arms | matches | **YES** |

**Counts: 9 PASS / 2 CONCERN / 1 FAIL. Known prior defects fixed: 4 of 4.**

## Overall judgment

The card half of this remint is clean and the four named defects are genuinely closed: all three
three-armed figures now resolve to exactly two arms under zoom, and the crestfallen qt-wiles face is
back to the canonical's warm peach. The plate half is where the set is uneven. **L28 is a fail and
should block the board as-shown** — it is thin cool grey line, cold grey-white palette, and a deep
oblique elevated camera, and the before/after comparison shows the remint made it worse than the
frame it replaced (the archived prior had a thicker warm line and a warm cream floor). L03 is a
softer miss in the same direction: grey-dominant with two different line weights in one frame, though
its remint did move toward warm relative to its prior. L172's issue is not the era register at all
but face finish — bald mouthless extras sitting next to fully-drawn figures in the same shot.
Two smaller things the boss should decide rather than re-mint: L05 is not a plate at all, it is the
style-tile file copied into the slot, so it proves nothing about the doctrine; and auditor-rep's
third arm was removed by deleting his signature brown ledger, which fixes anatomy at the cost of the
prop. **Recommendation: re-mint L28 before the gate board (start from the archived prior's line and
floor, keep the frontal-staging instruction), take L03 to the board flagged as a night-scene
exception for Daniel to rule on, and show L172 with the face-finish question stated out loud. The
other nine are ready to show.**
