# Tier-A vantage repairs — 17 shots (bricks-fresh)

**Authority:** `scratchpad/perspective-analysis.md` §6 Tier-A table (17 shots).
**Scope:** exactly those 17 `still_prompt`s (+ their `notes`). Tier B (one-point aisle views) and the
wider recession-verb layer were NOT touched. Worktree `boss-bricks-reset`, detached, nothing committed,
no git action taken.

**Doctrine authored against (read fresh, not from memory):** `visual-kit/style-bible.md` §5
(*"depth read by overlap and scale, eye-level frontal"*, era §2b at the prompt HEAD),
`visual-kit/visual-grammar.md` §3 (framing template deleted; *"the vantage is not a choice — it is the
house eye-level frontal"*), VPW `SKILL.md` step 4 (must-state facts narrowed to **subject scale +
stage position**, `layered depth by overlap and scale`), `scratchpad/vpw-log-fresh.md` lessons 1–35
(#12 corrected: vary the WORLD, not the vantage).

**Method.** Each repair was authored from the shot's own `vo_text` against the current laws. The
off-eye-level clause was **deleted, not replaced**: the era default needs no camera language, so no new
camera sentence was written anywhere. What survives in its place is only what the SKILL now asks for —
subject scale and stage position, stated as facts about the world and the frame. All 17 lost their
`Framing:` label (0 of 17 retain it; 185 remain file-wide in the 231 out-of-scope shots, untouched).

---

## Per-shot: before → after

| id | before (deleted clause) | after (framing summary) | route |
| --- | --- | --- | --- |
| L03 | `wide static from floor level, the lamp pool close to camera and the dark room falling away behind it` | lamp pool stated centre-and-near; the fall-off moved into the palette (`charcoal dark`); pallets keep large-and-high frame position | word-swap |
| L16 | `low wide angle straight down the shelf's length` | shelf face square to frame, cases ranked edge to edge past both frame edges, lit bay moved to centre — the L11 frieze shape | word-swap (restaged prose) |
| L22 | `wide static from floor level, the lit pallets filling the lower two-thirds` | lit pallets large, filling the lower two-thirds; nothing replaces the vantage. Payload `'26,000'` still the final clause | word-swap |
| L32 | `low wide angle from floor level, him large stage-right against the overhead tubes with the busy floor running back deep stage-left` | him large stage-right at full frame height against the tubes, the working floor small stage-left — the boom now reads by SCALE | word-swap |
| L34 | `high, looking down into the open case from over the bench …front bay square to camera` | case large and central, open flank + front bay square-on, bench cropped to a strip (keeps it distinct from L11 without moving the camera) | word-swap |
| L53 | `low wide angle from floor level at the near end of the aisle` (+ `runs back toward camera`) | him large and centred filling the lit doorway; benches now stand either side of him | word-swap |
| L56 | `low angle from the foot of the bench, him large stage-left` | him large stage-left, the bench edge as the one shallow oblique the look allows | word-swap |
| L70 | `wide from the foot of the flight looking up its length, the steps rising and receding stage-right` | **RESTAGE** — the flight drawn broadside in flat elevation, rise crossing the frame low stage-left → high stage-right, climbers at body scale on it | restage |
| L83 | `low wide angle straight down the shelf run … the bays receding stage-left` | shelf face square to frame, ledger large stage-right, bays ranked away stage-left past the frame edge | word-swap |
| L122 | `medium-low from floor level … the pallet run receding stage-left` | ledger large stage-right at crate height, ranked pallets filling stage-left behind it | word-swap |
| L125 | `from low down` + `low wide angle looking up the face of the stacked block` | block face square to frame; the raised pallet keeps its high-and-central FRAME position — height in frame, not by camera, so the pun still lands | word-swap (restage-adjacent) |
| L135 | `seen from the side at floor level` + `low wide angle from floor height` | **RESTAGE** — table drawn broadside in flat SECTION: top a horizontal band across the middle, the space beneath an open compartment holding legs, shoes and the banded brick | restage |
| L137 | `medium-wide from floor level … the run receding stage-left` | pallet + ledger together large stage-right, the returned run ranked stage-left behind them (rhyme with L122 preserved) | word-swap |
| L138 | `wide static from floor level` + `wide one-point view down the narrow aisle` | **RESTAGE** — aisle becomes a WALL: solid rank of wrapped pallets square to the frame filling it top to bottom, accountants small at its foot; "endless" from fill, not convergence | restage |
| L153 | `seen from high on the mezzanine stair landing looking down…` + `high wide from the stair landing looking down` | **RESTAGE** — frontal to the rear wall: bare block wall square to frame fills the upper half, swept floor + hopper crew the lower half; the contrast is now an up/down FRAME arrangement | restage |
| L217 | `wide static from floor level looking up the length of the room` | him small and low at frame centre, bench front filling the top of the frame, box and gallery ranked large around him — pure scale | word-swap |
| L248 | `from floor level` + `wide static at floor level straight down the aisle` | broadside to the rank: lit pallet large stage-right, the rest running away stage-left into unlit dark, the run past both frame edges | word-swap |

**Restages: 4 + 1.** L70 (staircase side-elevation), L135 (table in section), L138 (aisle as wall),
L153 (floor-level frontal restage), plus L16 restaged in prose to the frieze shape (its route asked for
broadside-to-the-shelf, which the old one-point run could not carry as a word-swap). Each keeps its
shot's IDEA intact: L70 the same climb with the step size raised under the people on it; L135 seeing
what is under the table; L138 more boxes than anybody could open; L153 the bare wall against the one
low course; L16 one drive in every machine.

**Notes discipline.** Each shot's `notes` records the repair WITHOUT quoting the banned phrasing (a
quoted record is still a worked precedent the next author reads — perspective-analysis §3.5). Four
pre-existing notes that actively justified the old vantage were corrected in place: L32 ("Scale and
angle go low and wide"), L34 ("a look down into the open case … the vantage is re-derived"), L217 ("the
one low-angle vantage the video has held back"), L153 (capital-F `Framing` clause reference).

---

## Acceptance evidence

### 1. Byte-guard (pre-edit copy taken before the first write)

```
BYTE-GUARD: changed 17 | exactly the 17: True | untouched byte-identical: 231
global_prompt_suffix identical: True
raw out-of-scope hunks: 0
```
Field-level: only `still_prompt` and `notes` differ on the 17; every other field, every other shot,
`thumbnail`, `shorts` and all top-level keys are byte-identical. Raw line-diff of the two files puts
every non-equal hunk inside a target shot.

### 2. Lint — ZERO HARDs

```
== lint_shots: channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json ==
long-form shots: 248  |  shorts: 0
HARD violations: none — every anchor matches verbatim + in narration order.
Heads-up (13):  [5 delta-hold heads-up + 8 pre-existing `sit`-support review rows]
LINT EXIT=0
```
No anchors moved (`vo_ref` / `vo_text` untouched), so no `--write` pass was needed; the 13 heads-up rows
are the pre-existing set, unchanged by this repair.

### 3. Forge dry-run

Two runs, because the environment carries a blocker that is **not** from this repair:

- **Whole file, worktree kit** — all **248 shot rows + thumbnail assemble, 0 refusals, 0 SEEDING-LAW
  blocks**. The run then exits 1 on `seed frame not found: …/refs/base/crowd-exemplar.png`, which is a
  path-resolution artifact only: `forge.Kit` finds the repo root by walking ancestors for a `.env`
  marker, the worktree has none, so repo-relative seed paths resolve against the drive root. The file
  itself is present and tracked in the worktree.
- **Main kit (as briefed), 13 figure-free targets** (L03, L16, L22, L34, L70, L83, L122, L125, L135,
  L137, L138, L153, L248) — `batch --dry-run` **EXIT 0, 0 refusals**, then full prompt assembly
  `gen --dry-run` **EXIT 0**: `== DRY RUN: 13 prompts assembled, 0 API calls, 0 files written ==`,
  0 refusals, repaired text verified present in the assembled prompts. This covers all four restages.

**Pre-existing environment blocker (NOT caused by this repair).** The main checkout's
`visual-kit/_staging` holds **55 staged STEP-1 figure frames with only 2 review records** in
`_staging/review.json` (mtime 16:07 today, i.e. before this run), so forge refuses the first
cast-bearing shot it reaches and aborts the whole-file batch. Proven pre-existing: the same whole-file
dry-run run against the **pre-edit copy** produces the **identical single refusal**
(`fig-terry-johnson--action-present--expr-delighted`, at L31, outside the 17) — new refusals introduced
by this repair: **none**. The four cast-bearing targets (L32, L53, L56, L217) are blocked by that same
staging gap, not by their prose; their seeding rows assemble cleanly in the worktree-kit whole-file run.

### 4. Grep-guard — 0 hits across the 17

Pattern: `floor level | floor height | ground level | low/high angle | low wide angle | high wide |
look(s|ing) up/down | from above/below | mezzanine | stair landing | one-point | from low down |
overhead shot/view/vantage/camera/angle | dutch | canted | tilted horizon | close to camera | to camera |
from over the`, run over **both `still_prompt` and `notes`** of all 17:

```
GREP-GUARD hits across the 17 (prompt+notes): 0 []
```
