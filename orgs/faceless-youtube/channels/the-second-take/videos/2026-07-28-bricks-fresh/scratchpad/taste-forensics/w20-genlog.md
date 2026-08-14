# W20 promote, payload, and plate re-gen log — 2026-08-14

## Handshake promotion ($0)

- Promoted `_staging/handshake-w16-rerun-candidate.png` to `refs/base/handshake.png`.
- New canonical SHA-256: `842bfa0f09b6dd166c3dfda30662d301495e039b2ed55e48cfefee09a851fb0c`.
- W19-A + W19-B axes were merged as all-pass under `refs/base/handshake.png`; reviewer: `sonnet verifier pair w19, Daniel head/proportion/eye re-run ruling 2026-08-13`.
- The original backup `refs/base/handshake-pre-rerun-2026-08-13.png` remains present.
- P12 records (`refs/base/expr-pleading.png`, `refs/base/expr-shock.png`) had canonical serialized bytes SHA-256 `b077ce35de84f0dd6f17721e815b32dddf35401a0102a9b43fa74df798d9acf2` before and after the stamp: PASS.

Stored row:

```json
{"canonical_sha256":"842bfa0f09b6dd166c3dfda30662d301495e039b2ed55e48cfefee09a851fb0c","expression_sha256":null,"verdicts":{"primitive_semantics":"pass","base_identity":"pass","head_shape":"pass","no_nose_no_ears":"pass","four_digit_hands":"pass","proportion":"pass","flat_cel_render":"pass","outline_consistency":"pass"},"reviewer":"sonnet verifier pair w19, Daniel head/proportion/eye re-run ruling 2026-08-13","date":"2026-08-13"}
```

## Payload rewrites

### L65 — wiles-office

Before:

> A wide sun-bleached office seen head-on and entirely empty of people: a big desk across the midground carrying a black telephone and one closed folder, an empty high-backed leather swivel chair pushed back behind it, a tall window filling the back wall on a flat pale sky and the tops of two palms. A potted palm stage-left, a bare cream wall stage-right with nothing hung on it. Cream-amber-charcoal palette, hard afternoon sun laid in one bright slab across the desk and carpet, foreground depth from a cropped visitor chair back at the lower-left.

After:

> A wide sun-bleached cast-free office seen head-on: an open stretch of cream carpet runs from the foreground into the midground. In the back third by the tall window, a big desk carries a black telephone and one closed folder, with an empty high-backed leather swivel chair pushed back behind it. The tall window fills the back wall with a flat pale sky and the tops of two palms; a potted palm stands stage-left and a blank cream wall stands stage-right. Cream-amber-charcoal palette, hard afternoon sun laid in one bright slab across the desk and carpet, foreground depth from a cropped visitor chair back at the lower-left edge.

### L84 — audit-room

Before:

> A plain meeting room seen wide and entirely empty of people: a long table across the midground with eight stacking chairs pushed in, two closed grey steel document boxes squared up at the near end of it, a coat stand by the door stage-left holding nothing, a window at the back onto the frosted car park. Cool grey-cream-teal palette, flat overcast daylight with one strip fitting on, foreground depth from a cropped chair back at the lower-right.

After:

> A plain cast-free meeting room seen wide: an open floor zone runs from the foreground into the midground. Along the back wall, a long table runs stage-right with eight stacking chairs pushed in and two closed grey steel document boxes squared up on its near end; a coat stand stands by the door stage-left, and a window at the back looks onto the frosted car park. Cool grey-cream-teal palette, flat overcast daylight with one strip fitting on, foreground depth from a cropped chair back at the lower-right edge.

### L86 — miniscribe-warehouse

Before:

> A wide warehouse aisle seen head-on and entirely empty of people: steel pallet racking four bays high running away on both sides, pallets of flat cartons filling the lower two tiers, the shrink wrap represented only by one flat pale cel band and two or three crisp hard-edged contour lines per pallet face, a concrete floor with yellow lane paint, roof lights in a row overhead. Cool grey-teal-cream palette, flat industrial light, foreground depth from a cropped rack upright at the right edge. Painted across the end panel of the racking that closes the aisle: 'MINISCRIBE'.

After:

> A wide warehouse aisle seen head-on and entirely empty of people: steel pallet racking four bays high running away on both sides, pallets of flat cartons filling the lower two tiers, their wrap surfaces matte flat colour with only one flat pale cel band and two or three crisp hard-edged contour lines per pallet face, a concrete floor with yellow lane paint, roof lights in a row overhead. Cool grey-teal-cream palette, flat industrial light, foreground depth from a cropped rack upright at the right edge. Painted across the end panel of the racking that closes the aisle: 'MINISCRIBE'.

### L198 — jury-courtroom

Before:

> A courtroom seen wide from the back of the well and entirely empty of people: a raised timber bench across the far end with an empty high-backed chair behind it, an empty jury box of twelve seats stage-left, two counsel tables squared up in the midground, rows of gallery pews running toward the viewer. Panelled walls with tall plain windows, cream-oak-teal palette, cold daylight from stage-left across the empty pews, foreground depth from a cropped pew back across the bottom of the frame.

After:

> A cast-free courtroom seen wide from the well: an open courtroom-well floor runs from the foreground into the midground. At the back, a raised timber bench holds an empty high-backed chair behind it; stage-left, an empty jury box has exactly twelve seats in two rows of six. Two counsel tables sit to the sides of the well, and gallery pews flank the well behind them. Panelled walls with tall plain windows, cream-oak-teal palette, cold daylight from stage-left across the gallery pews, foreground depth from a cropped pew end at one lower corner.

## Validation ($0)

- Lint: `0 HARD` violations; its tail is in `w20-lint.txt` (37 pre-existing heads-up rows remain).
- Scoped dry: 4/4 assembled at 1K, each payload matches `shots.json` and appears exactly once in its assembled delta; `w20-dryrun.txt` ends `4 prompts assembled, 0 API calls, 0 files written`.
- The scoped slate reports 17 seeding-law violations outside the four-shot scope; none was acted on.

## Live generation (cap $0.25)

Tier: Forge 1K, nominal $0.039 per provider call.

| Plate | W20 spec | Result | Staged candidate | SHA-256 | Nominal spend |
| --- | --- | --- | --- | --- | --- |
| L65 | `w20-L65.spec.json` | first call OK | `_staging/L65-w20.png` | `678f8f54649e9bc68ac7aa1721ec5a97d0562b033fec18ebeaac5103399c185c` | $0.039 |
| L84 | `w20-L84.spec.json` | first call OK | `_staging/L84-w20.png` | `b48f9b1d6953686c9f68759665a9e6734e606ed104fd74c2681c0c2b747b532b` | $0.039 |
| L86 | `w20-L86.spec.json` | first call OK | `_staging/L86-w20.png` | `0aee609d8069cabf948ac93f7b6780674e15e7ebdb6fff5166c0b513bc140c19` | $0.039 |
| L198 | `w20-L198.spec.json` | first call OK | `_staging/L198-w20.png` | `5999ae3e3a99e847fa447a70167026768a47c90ea8b4624915a77627c9d1966e` | $0.039 |

Total: 4 provider calls, nominal $0.156 / $0.25 cap. No stall, reissue, 503, 429, billing halt, promotion, scene-manifest write, or review stamp for the four plates.

## Deviations

- Two zero-cost command-construction errors occurred before live generation: the first omitted Forge's positional subcommand; the second used a relative `--out`, creating one W20 spec under a duplicated project prefix. Neither called the provider. The accidental file was removed, then the absolute in-scope output was used.
- PowerShell background launching initially rejected duplicate `Path`/`PATH` process entries. Removing the duplicate `PATH` entry only from the launcher process allowed monitoring; `.env` was not read or modified.
