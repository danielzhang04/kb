# figment QA/review pipeline

Three small stdlib(+Pillow) scripts, ported/built from FYT's image-engine review scaffolding
(`reuse-from-fyt.md`) to serve the W0 blind trial (`trial-protocol.md`). No network, no
spend, no accounts — pure local file processing.

| Script | Role |
|---|---|
| `blind_pool.py` | Pools several arms' images into one anonymized, shuffled directory + a hidden de-anonymization key. Also `reveal`s per-arm results after grading. |
| `build_grading_board.py` | Builds a self-contained offline HTML review board (images inlined, lightbox, parked-only filter). `--blind` hides arm/source and shuffles order. |
| `qa_stamp.py` | The single writer of `review_status`/`parked_reasons` — converts a grader's rulings into the honest `verified` / `parked` / `unreviewed` manifest state. |

Dependency: **Pillow**, for `build_grading_board.py` only (stdlib has no JPEG re-encoder).
`py -3 -m pip install pillow` — or use `C:\Users\danie\tools\ComfyUI\venv\Scripts\python.exe`,
which already has it. `qa_stamp.py` and `blind_pool.py` are pure stdlib.

## How they fit together

```
arm A dir ──┐
arm B dir ──┼─► blind_pool.py build ─► pool/ (anonymized images + arm-free manifest.json)
arm C dir ──┘                     └──► key.json  (arm mapping — kept OUTSIDE pool/)

pool/manifest.json ─► build_grading_board.py --blind ─► board.html (self-contained)
                                                              │
                                            hand ONLY this file to the grader
                                                              │
                                    grader produces rulings.json (per-image axis verdicts)
                                                              │
rulings.json + pool/manifest.json ─► qa_stamp.py ─► pool/manifest.json (stamped, in place)

pool/manifest.json (stamped) + key.json ─► blind_pool.py reveal ─► per-arm pass rates + taxonomy
```

The key file (and the pool directory itself, if the grader has raw filesystem access rather
than just the rendered board) must never reach the grader — that is the entire mechanism of
blindness. `build` refuses to write `--key` under `--pool`. Hand the grader `board.html`
only; it is fully self-contained (no sibling files, no network).

## Review axes (figment, not FYT's)

`identity` (match to the character brief), `realism` (anti-gloss — does it read as a phone
photo), `hands` (hand/detail integrity), `lighting` (plausibility). Each is
`pass` / `soft-fail` / `hard-fail`; any non-pass axis parks the image with a named reason.
See `qa_stamp.py`'s module docstring for the exact classification rules and fail-closed
behavior on malformed rulings.

## Rulings file (what the grader produces)

```json
[
  {"image_id": "img_0001", "identity": "pass", "realism": "pass",
   "hands": "hard-fail", "lighting": "pass",
   "why": "left hand has six fingers in the mirror reflection"},
  {"image_id": "img_0002", "identity": "pass", "realism": "pass",
   "hands": "pass", "lighting": "pass"}
]
```
A human or a fresh grading agent writes this by hand (or via whatever tooling reviews
`board.html`) — nothing in this trio generates it.

## Running a full blind trial end to end

```
py -3 blind_pool.py build \
    --arm A=path\to\comfyui_output \
    --arm B=path\to\saas_output \
    --pool  path\to\trial\pool \
    --key   path\to\trial\pool.key.json

py -3 build_grading_board.py \
    --manifest path\to\trial\pool\manifest.json \
    --out      path\to\trial\board.html \
    --blind --title "W0 blind trial"

# hand board.html to the grader (human or fresh agent); they produce rulings.json

py -3 qa_stamp.py rulings.json path\to\trial\pool\manifest.json

py -3 blind_pool.py reveal \
    --manifest path\to\trial\pool\manifest.json \
    --key      path\to\trial\pool.key.json \
    --out      path\to\trial\report.json
```

Every command supports `--help`.
