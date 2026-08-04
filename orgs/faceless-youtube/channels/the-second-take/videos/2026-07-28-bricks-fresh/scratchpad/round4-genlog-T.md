# Round-4 generation log — Lane T — 2026-08-04

Lane cap: **$1.80**. Native staging only; no canonical scene, `manifest.json`, or review-stamp write. The batch loader does not accept SHA objects in a normal generation slate, so every input is digest-pinned here and the exact source paths are retained in `round4-T.builder.json`.

## Pinned inputs

| input | SHA-256 |
|---|---|
| `fig-brick-foreman--sit--expr-worried.png` | `61682401c01c274ca8d189d27687322d95cf5c3da7f7be0ee71a23a21d66cbc6` |
| `L74-b4T.png` | `6e30fc5f63078715b8d51897963705e2d9fffc9635e39f3ca23c686e1c4767c7` |
| `brick-foreman.png` canonical | `0e4988f6386b9fe3e35204acb7e4e4290d5e4223d86ff9ad913f6501102b32b5` |
| `auditor-rep.png` canonical | `2c65fe8d5abc5f8753e40f9aeccf1c2b4ff2f510d92a3c10eff1595bcc43e028` |
| `L76-round3-P.png` | `34c0d4f202edfdd0a91a4acc8a814263a25f0c88b8629f6efaeaf9f99fde7760` |
| `L80.png` | `872bba03f11fb04a76fce5677c9e4665a74ab2aeb6ca4860c0ac0272292b75b0` |
| `fig-auditor-rep--expr-skeptical.png` | `1b842763ff19274999b6897f94ec8d255bf0fd03571de9da619887a495f5edcf` |
| `fig-brick-foreman--expr-worried.png` | `7b70f399f0ad5df51afae75c51368fd04d04f5b973d7da07461844de6981a9cd` |
| `fig-brick-foreman--expr-caught.png` | `e365a3cd0b44554334a1d00a0d96678b6ad78eb42299a5862da29d81fa05d731` |
| `fig-brick-foreman--sit--expr-deadpan.png` | `29f1cdde2b61c59c9971a7d284ff65585b0f7ec0b472834f27d087b9d96cb9a4` |
| `fig-brick-foreman--action-shrug--expr-smug.png` | `093707ea340e1501f37b8db719a1cc7a3b01c5e753674f496685c21e76433f7b` |
| `fig-auditor-rep--sign-with-pen--expr-deadpan.png` | `bd282212643885f834c401e58aef8a74a790cec2b498cfa15f122f26d8c9d7a9` |
| `expr-deadpan.png` | `f28e6a95f9f9e3e0829313191fe0c57c93614915409c454277e9814d8c05a96d` |
| `crowd-exemplar.png` | `8453e25efde3455c6e3585cf80f1a35f3a5b821eb62f3a4d3debb06bdef7b299` |
| `lettering-marker-italic.png` | `054454bd2d17128c4cbb3999addad45c4c44dc5567b179a846f5195d67f27e56` |

## Requests and preliminary self-verdict

| id | file | cost | output SHA-256 | §3 / content preliminary verdict | style, palette, or occupancy note |
|---|---|---:|---|---|---|
| L74 | `_staging/L74-b4T.png` | $0.134 | `6e30fc5f63078715b8d51897963705e2d9fffc9635e39f3ca23c686e1c4767c7` | Provisional PASS: foreman identity, noseless/earless round rig, blank pad, hovering pen, and ring are present; apparent four-digit hands. | Concern: ring glow, soft background, and smooth shading exceed the hardened flat-cel ideal. |
| L75 | `_staging/L75-b4T.png` | $0.134 | `57cffc88bb2541d621ad8800c62541d00b9aa739d9449e24044c97b0aa992f05` | FLAG: foreman rig/identity holds, but the pen lies on the pad rather than touching it mid-stroke. | Same bright ring and soft background as L74; independent review should rule the failed changed element. |
| L77 | `_staging/L77-b4T.png` | $0.134 | `d1d88a785a485fb520230599eadcf31166adccc2d756e694a23e2ad5ceff9f75` | Provisional PASS: auditor has glasses, suit, case, pen, and open ledger; `1987` is exact. | Cool grey warehouse is densely composed; the smooth shading remains a style concern. |
| L81 | `_staging/L81-b4T.png` | $0.134 | `94f2f99d0576c07aaeb35a2f80bbd18bc744d6fe14a9c29149d69416d844ddbd` | Provisional PASS: two leads, raised blank ledger, active counting crew, and no added text. | Occupancy is high and legible, but the palette drifts cool/white and the shrink-wrap is glossier than the brief. |
| L82 | `_staging/L82-b4T.png` | $0.134 | `319002ab3ef0313f523868a12d44e9280cf770a7fe2ceabb84b8456cf5803f4a` | Provisional PASS: foreman studies a blank pad, auditor/crowd remain at the count floor, and lead identities hold. | Strong warm palette and full occupancy; still a more polished/smooth render than the flat-cel target. |
| L84 | `_staging/L84-b4T.png` | $0.134 | `794c941f5078e27ef83c1b98f1ca68b1b6e185770a9a71606e7a2cd4cd7bda2d` | Provisional PASS: figure-free shelf bay, empty outlined box volume, and exact `4 MILLION` lettering. | Sparse by design; neutral grey shelf palette is authored and the lettering is clear. |
| L85 | `_staging/L85-b4T.png` | $0.134 | `29dedb60c5c53927cc1173156aa30ce81d2e64babf26a315239a3a5d25cdc605` | FLAG: box-shaped chalk outline and rig hold, but `expr-caught` renders as a toothy grin. | Original retained as the less-bad candidate; retry below introduced a wrong body outline. |
| L85 retry | `_staging/L85-b4T-retry.png` | $0.134 | `814663ff9148acba0028a85b4ccdfded0866a24473ef9b064cbcff6041ac74b7` | FAIL: caught face improves, but the mandated empty box outline changes into a body-shaped chalk outline. Stop chain; do not select. | No further retry permitted. |
| L89 | `_staging/L89-b4T.png` | $0.134 | `0be545d88815dd853edf28f314c0a0eb701ab17689a08f866666731ec0315d54` | Provisional PASS: seated foreman, cracked lockbox, one wrench and paper clip read; apparent four-digit hands. | Composition is airy and softly blurred; multiple wax seals are more ornate than necessary. |
| L90 | `_staging/L90-b4T.png` | $0.134 | `45e42da387789127671cfb0006a939ac405d7651e578dbf8d73d1e3d5c285de9` | Provisional PASS: open box holds clean fake sheet and real sheet on floor has one red line; foreman rig holds. | Palette and scale read cleanly; smooth texture is the remaining style concern. |
| L91 | `_staging/L91-b4T.png` | $0.134 | `5baacd97610834f4f50d1daba8f247c1a020d4ded86738a4456f6ba91c7b4153` | Provisional PASS: smug shrug, cabinet/corridor, and apparent four-digit hands hold. | The reaction is clear; background is sparse but on the authored beat. |
| L92 | `_staging/L92-b4T.png` | $0.134 | `ebe98881dd79aece450256bda0b5584d5da2f5fbf91a9bcb1972cfe0681863fb` | FLAG: auditor loses the canonical spectacles and ledger case. | Do not select; exact identity retry below is preferred. |
| L92 retry | `_staging/L92-b4T-retry.png` | $0.134 | `63dbb72ff1a80b65e260824c13fadecec1cd12d6f4805b25a7dc6ff68200efe0` | Provisional PASS: auditor’s glasses, leather case, charcoal suit, signing pose, blank page, and dark stamp are restored. | Prefer this candidate; small signature-like mark merits independent lettering scrutiny. |

## Result

- Spend: **$1.742 / $1.80**. Provider failures: none. First-try L74 through L92 staged as planned; only L85 and L92 used their single authorized precision retries.
- Preferred staged files: `L74-b4T`, `L75-b4T` (flagged), `L77-b4T`, `L81-b4T`, `L82-b4T`, `L84-b4T`, `L85-b4T` (flagged; retry rejected), `L89-b4T`, `L90-b4T`, `L91-b4T`, and `L92-b4T-retry`.
- Stopped chain: L85 after the retry changed the required box outline into a body outline. L75 is also surfaced as a first-pass fidelity flag; no budget remains for another retry.
