# Round-5 generation log — Lane W — 2026-08-04

Lane cap: **$1.25**. B5 `shots.json` at commit `7cfa9ab` is authoritative. Native staging only; no canonical scene, `manifest.json`, or review-stamp write.

## Requests and preliminary self-verdict

| id | file | cost | output SHA-256 | §3 / content preliminary verdict | style, palette, or occupancy note |
|---|---|---:|---|---|---|
| L66 | `_staging/L66-b5W.png` | $0.134 | `057c5e7b72dcf0ec43fb2ab8e6e8637dc7d18d53b8345c134e329343f5bc794d` | FLAG: two named leads and the separated rear-zone crowd are legible with apparent four-digit hands and no visible noses/ears; the framed chart invents readable `SALES`. | Strong warm palette and full occupancy; smooth gradient shading remains a style concern. |
| L66 retry | `_staging/L66-b5W-retry.png` | $0.134 | `f77cb01eb8b3260bd5dbc7e2ce949fad3a5f42b1a6d9bfc2a9e27b74d76f06ef` | Provisional PASS: the single surgical chart replacement removes readable text; Wiles points, the worried foreman, and the rear-zone simplified crowd all hold. | Warm boardroom is occupied and readable; reflections and smooth shading remain more polished than the hardened flat-cel target. |
| L67 | `_staging/L67-b5W.png` | $0.134 | `912a0dddbc373b1f964a4ddb425f542dcef90fc748c9a63a86aaa8af8bdbcdfe` | Provisional PASS: B5 parent topology holds; the two boxes are the only clear new payload, the named leads retain their staged figures, and the rear crowd remains a simplified mass. | Warm occupied boardroom persists; reflections and smooth shading remain a style concern. |
| L68 | `_staging/L68-b5W.png` | $0.134 | `d40408795bdba09dd842b489b895170760b616b3b44ba5184ee77596aea25e30` | Provisional PASS: arms-crossed Wiles, seated worried foreman, shut door, two boxes, and rear-zone crowd all read; no added lettering appears. | Occupied warm room holds its layout; smooth cel gradients remain a style concern. |
| L70 | `_staging/L70-b5W.png` | $0.134 | `d78a088ebb003de51a009e99ef6c7e6a78b69b08b10793f37ae592703c3c675d` | FLAG: empty office, desks, phones, pads, disconnected ring, and light pool are clear, but the corridor's required painted end mark is not legible. | Good root composition; palette is intentionally restrained, but the room is not neutral grey-only. |
| L70 retry, first transport | — | $0.000 | — | MECHANICAL: forge reached `START provider call`, then the local 60-second transport window killed the process before a PNG published. | Re-issued once unchanged from the same overlay; this did not consume a second content retry. |
| L70 retry | `_staging/L70-b5W-retry.png` | $0.134 | `d5d2b90bd4d85b3978ba3990ee9d78c94ea2c2365ea25d2e5df1041415f46d8f` | FAIL: office and ring hold, but the required transverse corridor end mark becomes a long boundary stripe rather than an endpoint where L71's conveyor can stop. | The content retry is exhausted; root chain stopped. |
| L71 | — | $0.000 | — | Not attempted: L70's sole retry still fails its load-bearing corridor mechanism. | Stopped with its parent chain. |
| L72 | — | $0.000 | — | Not attempted: depends on L71. | Stopped with its parent chain. |
| L73 | — | $0.000 | — | Not attempted: depends on L72. | Stopped with its parent chain. |

## Digest-pinned staged inputs

| input | SHA-256 | use |
|---|---|---|
| `fig-qt-wiles--point-at-thing--expr-smug.png` | `dd1e99f713fb48e27445903a9cf792dc082cce66d995e4b16dc9decfb0ea3d7f` | L66 and L67 Wiles figure |
| `fig-brick-foreman--expr-worried.png` | `7b70f399f0ad5df51afae75c51368fd04d04f5b973d7da07461844de6981a9cd` | L66 and L67 foreman figure |
| `L66-b5W-retry.png` | `f77cb01eb8b3260bd5dbc7e2ce949fad3a5f42b1a6d9bfc2a9e27b74d76f06ef` | L67 B5 place parent |
| `fig-qt-wiles--action-armscrossed--expr-smug.png` | `61868855d86cd64c825c39e11c8c8e2da4583e2a8acb0f9158ff1d184b404d2f` | L68 Wiles figure |
| `fig-brick-foreman--sit--expr-worried.png` | `61682401c01c274ca8d189d27687322d95cf5c3da7f7be0ee71a23a21d66cbc6` | L68 foreman figure |
| `L67-b5W.png` | `912a0dddbc373b1f964a4ddb425f542dcef90fc748c9a63a86aaa8af8bdbcdfe` | L68 B5 place parent |
| `L70-b5W.png` | `d78a088ebb003de51a009e99ef6c7e6a78b69b08b10793f37ae592703c3c675d` | L70 retry source record (seedless root) |
| `L70-b5W-retry.png` | `d5d2b90bd4d85b3978ba3990ee9d78c94ea2c2365ea25d2e5df1041415f46d8f` | exhausted L70 retry output; not seeded downstream |

## Result

Confirmed spend: **$0.804 / $1.25** (six published 2K PNGs). A provider request started before the first L70-retry transport timeout but published no PNG; it is ledgered as $0.000, with a conservative maximum exposure of **$0.938 / $1.25** if the provider billed that interrupted request.

Preferred staged outputs: `_staging/L66-b5W-retry.png`, `_staging/L67-b5W.png`, and `_staging/L68-b5W.png`. L66's original is retained only as the pre-retry evidence. The `L70 → L71 → L72 → L73` chain is stopped after L70's content retry exhausted its exact corridor-endpoint defect. No canonical scene, manifest, or review stamp was changed.
