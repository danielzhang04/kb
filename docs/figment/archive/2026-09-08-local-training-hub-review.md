# Local training readiness hub review

## Scope

This review uses a fresh, loopback-only visual fixture on port 5420. It reads the four configured local receipts through the existing Figment read route and records only the projected `localTraining` slice. The fixture injects the read route directly for visual QA, so this is not an authentication test or a claim about production access control.

## Expected projection

The fixture should show historical, recorded local preparation: one original observation, one repeat, an 896 × 512 effective bucket, CPU/CUDA masking and teardown, and two local tokenizer inventories with a 19-token availability probe. It should explicitly state that GPU training and quality review are not reported by these receipts. Those receipt-bounded statements do not establish current eligibility, GPU admission, a checkpoint, or a quality approval.

## Verification record

The fresh fixture is under `_private/ignored_private/figment-training-preview-20260908-v1`. Its named `preview-server.mjs` entrypoint was started hidden as Node PID 37008 at `2026-09-08T16:51:09.7800555Z`, listening only at `http://127.0.0.1:5420`; `server-ready.json` records the PID, port, start time, and loopback URL. The pre-existing preview on port 5419 was not changed.

The verification script first fetched the actual fixture projection and retained only this `localTraining` summary:

- `status: recorded`, `historical: true`
- one original observation, one repeat, target 768 × 768, effective bucket 896 × 512
- CPU CUDA masking and verified teardown both true
- two tokenizer loads, each with a 19-token probe

It rejected a projected local-training slice containing a private path, receipt filename, or raw/frozen digest metadata. The saved slice is `screenshots/local-training-projection.json` (SHA-256 `EF5C6CA0B8A861777A28510802EB5A64C12D8C21B57E0F388FAE8E3C66907B22`).

A CDP session created a new, dedicated loopback tab, selected **Training readiness**, captured desktop and mobile evidence, cleared its device-metrics override, and closed that dedicated tab. It did not attach to or alter another browser tab.

- Desktop: configured 1440 × 1600; no horizontal overflow; `Training readiness` selected; historical scope shown; tokenizer summary reports two inventories and a 19-token availability probe; GPU and quality each say `Not reported by these receipts.` Screenshot SHA-256: `650853734C612AC4BF373E7DA1A5BD93A0E2A79DF6C189F2A7799510CFBD34DD`. State SHA-256: `FF8DF6E307DCFB35100037B2B6274A1E1D5E2C2E153F8B83A7491C430434F4E8`.
- Initial mobile capture: configured 390 × 844 with mobile emulation; the same six content assertions passed, but Chrome expanded its layout viewport to 453 × 979. The initial overflow check was insufficient, as corrected below. Screenshot SHA-256: `EE48778D7258BE53CC62C1A07F11682729DF1D422ACA55B3F408B6F0814DEE4E`. State SHA-256: `6F98AC44B9CE78220E6103CC6274AFD0E991020D5160169D85AB8931B3CE5FFB`.

Visual inspection confirms the desktop panel has four cards in one row. The initial mobile capture showed stacked cards but did not establish correct viewport fit.

## V2 mobile correction

The original mobile capture was insufficient evidence for its no-overflow claim: it compared `scrollWidth` with `window.innerWidth`, while Chrome had expanded the layout viewport to 453 px under mobile emulation. That capture remains preserved for traceability, but its mobile no-overflow conclusion is withdrawn.

The responsive repair adds `flex-wrap: wrap` to `.figment__tabs`, so the six tabs wrap at the small layout width. The updated stylesheet SHA-256 is `0FF01F97ACF55451324AD4B9F77AA2D6D99A7330CC82E99D8E3FFF622A92BC63`.

Fresh V2 captures use a configured 390 × 844 CSS viewport. The mobile state records `innerWidth: 390`, `clientWidth: 375`, `visualViewportWidth: 375`, and `scrollWidth: 375`; the 15 px difference is the vertical scrollbar, and the required invariant `scrollWidth <= clientWidth` passes. The desktop state is 1440 for all three width measurements and also passes the invariant. Both V2 views again selected Training readiness, showed historical scope, two tokenizer inventories with the 19-token availability-probe caption, and exactly two neutral unreported states.

The root assistant independently viewed the V2 mobile screenshot and confirmed that all six tabs wrap into two rows and all four cards fit without clipping.

- V2 projected slice: `screenshots/local-training-projection-v2.json`, SHA-256 `EF5C6CA0B8A861777A28510802EB5A64C12D8C21B57E0F388FAE8E3C66907B22`.
- V2 desktop screenshot and state: `training-readiness-v2-desktop.png` SHA-256 `650853734C612AC4BF373E7DA1A5BD93A0E2A79DF6C189F2A7799510CFBD34DD`; `training-readiness-state-v2-desktop.json` SHA-256 `7B78122036C24F496C939F61415A0352456312C024C06B3D2027C3E50E34328B`.
- V2 mobile screenshot and state: `training-readiness-v2-mobile.png` SHA-256 `763363070A6C3990A1FA2EE4908BA47B9C71A9454EE4F4121AA7BC98A04EF413`; `training-readiness-state-v2-mobile.json` SHA-256 `810529F986084F61FCBA8C6312D2B109AB34BA8D23B2C487AAFC5008E2D7F6C1`.

## Existing verification context

Focused implementation tests passed: author 123 tests plus TypeScript typecheck; independent review 122 pre-delta tests and the delta review passed; root ran five delta tests and an actual four-receipt Node projection. A broader suite was stopped after at least 59 failures in 19 files. It did not reach a final count and no pre-existing baseline was established; shared fixture and environment causes remain suspected rather than proven.
