# Historical prompt-profile gallery review — 2026-09-08

The hub now displays the completed C3 profile-base diagnostic as a separate two-image section in Asset review. It preserves both recorded STOP reviews and their second-seed gaze disagreement. No adapter comparison followed that study; this display neither reopens it nor approves identity, age fit, training, or publication. The original C2 matched gallery is unchanged.

## Read boundary

The new reader binds one configured absolute root to the exact raw receipt and both sanitized review hashes listed in the [runtime audit](2026-09-08-local-profile-base-runtime-audit.md). It checks fixed filenames, output hashes and sizes, 1024-square PNG headers, opened-file/named-file stability and reparse paths. The projection contains only bounded fields. Omitted configuration differs from invalid evidence. The server accepts two opaque IDs plus a lowercase SHA-256; malformed requests return404, stale evidence409, and verified PNGs carry image/png, nosniff and no-store. Before each asset read the entire two-image study is revalidated, intentionally retaining the sibling-image consistency check at a small bounded I/O cost.

The new endpoint joins the existing origin, rate-limit and session-protected read scope. JSON projections omit filesystem paths, process IDs, raw provenance and prompts. **Original PNGs retain their recorded generation metadata.** Actual chunk inspection found one tEXt/prompt chunk per image,1461 and1457bytes, with no private-root or Windows user path. These are immutable local evidence assets; no claim is made that they are metadata-free public media. Stripping metadata would require separately identified derivatives rather than changing the receipt-bound originals. No external publication or deployment occurred.

## Independent review and root decisions

A verified Opus reader review returned REQUEST CHANGES. Root adopted independent digest-map cleanup and privilege-independent junction fixtures. The review's predicted Windows symlink failure did not occur in the original seven-case run, but junctions improve portability. Its metadata finding exposed an ambiguous statement in the brief: root clarified the JSON-versus-original-media boundary above after inspecting actual chunks. The later independent integration review explicitly accepted that boundary.

The verified Opus integration review returned READY with two medium notes. Root fixed the actionable one: a failed asset now shows a terminal unavailable cell beside its seed, instead of announcing loading forever. The whole-study pre-check remains deliberate and documented. Actual captures showed exactly two asset GETs per viewport, with no repeated-fetch loop.

## Verification

- Real private evidence smoke: both original PNGs and reviews loaded with unmocked crypto in39.4ms. The smoke's source hash precedes a documentation-only reader comment clarification.
- Reader initially7PASS; composed55cases had54PASS and one5-second timeout caused by deep comparison of a1.4MB Buffer. Root replaced that assertion with Buffer.equals; no timeout limit was raised. Final reader/routes24PASS6.20s; existing matched-reader9cases passed in the composed run.
- Final UI22PASS5.90s, including terminal failure cells; TypeScript no-emit check passed. Three focused composed-server tests passed: unauthenticated401, wrong-origin403 and authenticated stale409. Other92index tests were not selected in that run.
- Actual desktop1440, midwidth900 and mobile390 captures loaded two natural1024-square images each, preserved separate reviews and gaze disagreement, issued only GETs, and had no horizontal overflow. Root visually inspected desktop/mobile. These captures use a clearly labeled local visual fixture; authentication is established by composed-server tests, not the fixture.
- Three JSON fixtures retain exact recorded bytes through a directory .gitattributes rule. Unit tests assert their real hashes; only synthetic PNG stand-ins use narrow digest emulation. No private PNGs were committed.

Broad dashboard-suite health remains unresolved from the earlier run; these focused checks do not establish a full-suite pass. The owned visual fixture was stopped with launch/creation identity verification after capture; its files remain private.

## Accepted source and evidence hashes

| Source | SHA-256 |
|---|---|
| `dashboard/server/figment/profileGallery.ts` | `fad1798ef2260a2ca7a004d1b629c6b840570525ae413de4b123a708cf94b5b8` |
| `dashboard/server/figment/profileGallery.test.ts` | `6058af81f4cf870cf6ed57698d90761fb5dae0fd0074b400bb2a5007f082ec91` |
| `dashboard/server/figment/routes.ts` | `cc77ebb228bc7da31e4888e62825521234559d6bf703eec248fd3044037a3b73` |
| `dashboard/server/index.ts` | `54e1b9f6fa32aad0b03fb2673d8bb5354c990f0f2fe7ea791d2ea81c4c9d0699` |
| `dashboard/src/figment/FigmentWorkspace.tsx` | `8f1796779b064fd624a11ca1ba87abe74615938832f5241876fb83ea1e893b5d` |

Private evidence roots below are local audit references, not hub response fields.

- `figment-claude-fable-profile-gallery-reader-20260908-v1/result.json`: `b0776e1fcdb7261879e34c05fb7a85818ca5b8764a72fa80958a5096da837de4`.
- `figment-claude-fable-profile-gallery-integration-20260908-v1/result.json`: `8a0f04ce52460fc311224bcdbd73b1d975456bf7ce2b888f9c465954139aba32`.
- `figment-claude-opus-profile-reader-review-20260908-v1/result.json`: `2d138a74173cafd43fe0549f60030f5b9ac4c615c0fdf7106b1ca99c29d51e1e`.
- `figment-claude-opus-profile-integration-review-20260908-v1/result.json`: `53cf5d00d918af0dbaf0f4908952479dc76ff1e6d20237f9f0937c2754bcb98d`.
- Real smoke `figment-profile-gallery-real-smoke-20260908-v1/result.json`: `54cb841a9f82932e3cdf3920a1a6156f8da98564e2fa33148627e5db19c6eec9`.
- Preview cleanup `ignored_private/figment-profile-gallery-preview-20260908-v1/cleanup.json`: `57044c11cd7146c1540e68500ac89e542759a5dc1c1a89b13b2b49829d29e469`.
