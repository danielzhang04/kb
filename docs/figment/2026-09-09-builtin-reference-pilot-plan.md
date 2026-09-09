# Built-in reference pilot plan — 2026-09-09

## Decision and boundary

The **six-image varied stress pilot is complete**. Root and the independent Sol
reviewer found the six direct-g01 outputs promising enough to curate a 20-plus
image research set. That is a research continuation decision, not dataset
acceptance, training, a selected LoRA, production approval, or a change to any
numerical threshold. The completed reviews are [root](2026-09-09-builtin-pilot-root-review.md)
and [independent](2026-09-09-builtin-pilot-independent-review.md).

Every slot uses the original g01 directly:

- `orgs/figment/personas/creator-001/anchors/g01.jpg`
- 737,366 bytes; 1408×768
- SHA-256 `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`

Do not use slot 1 or any later generated image as a reference for another slot.
Do not chain, blend, or accumulate generated-reference traits.

## Six slots

| slot | variation | completed state | next curation partition |
| ---: | --- | --- | --- |
| 1 | Vertical black-T-shirt-and-jeans portrait against the warm neutral wall; mild turn toward her right/image-left; direct gaze; head through upper thighs, hands and elbows visible | Complete; promising | Train candidate |
| 2 | Opposite mild turn, same opaque black crew-neck T-shirt and dark jeans, same warm neutral wall and soft light; direct gaze | Complete; promising | Train candidate |
| 3 | Front-facing full-body view, same black T-shirt and jeans, neutral wall, natural standing posture and direct gaze | Complete; promising | Reserved evaluation candidate |
| 4 | Outdoor overcast standing waist-up view, opaque gray hoodie, direct gaze | Complete; promising | Train candidate |
| 5 | Seated indoors, gentle closed-mouth smile, same black T-shirt and jeans, natural room light and direct gaze | Complete; promising | Train candidate |
| 6 | Head-and-shoulders view with soft side-window light, neutral expression, direct gaze | Complete; promising | Reserved evaluation candidate |

Slot 1 is preserved at MAIN
`_private/figment-builtin-reference-20260909-v1/portrait-turn-left.png`:
1,998,075 bytes, 1086×1448, SHA-256
`38176c8589fdfac70196cce03355dceba47d8ac1e0861bdbabde0c8b1fb11de4`.
Its request record is beside it as `request.json`. The exact responding model and
incremental USD were not exposed by the tool and must remain recorded that way.

## Generation controls

The built-in image-generation tool received g01 directly on each of the six
calls. The completed prompts preserved the intended fictional adult identity and
appearance around age twenty-one, while changing only the slot's declared pose,
frame, setting, light, clothing, or expression. Keep clothing opaque and the
person fully clothed. Ask for natural camera texture, skin variation, individual
hair strands, fabric folds, coherent anatomy, one person, and no text, watermark,
collage, or split panel.

No API-key CLI or Gemini was used for this pilot. Root owned the generation tool
calls. This local tool pilot does not change the completed RunPod ledger total of
`$38.778929`.

## Candidate curation boundary

The next research inventory is **20 train candidates plus 2 reserved evaluation
candidates**. The train-candidate starting set is g01 and pilot 01, 02, 04, and
05; fifteen further direct-g01 candidates are planned to reach 20. Pilot 03 and
06 are reserved for evaluation and must stay outside trainer media. These are
proposed partitions only: no row is accepted, captioned for admission, or used to
train a checkpoint.

The six hash-bound raw YuNet/SFace observation records are diagnostic evidence.
They contain no identity threshold, pass/fail field, ranking, acceptance, or
promotion. Visual comparison and the existing lineage process remain separate.

## Review protocol

Root and the independent reviewer completed native-resolution, side-by-side
review of all six originals against g01 and one another. Their recorded
observations cover:

- identity: eye and eyelid shape, brow shape and spacing, nose width and tip,
  lips, cheek fullness, jaw proportions, hairline, and hair;
- adult presentation and plausible appearance around twenty-one, stated with
  honest uncertainty rather than an exact-age claim;
- realism: pores, small skin-tone variation, fine hair, natural fabric and light,
  and absence of airbrushed, doll-like, or illustrative rendering;
- pose and framing compliance for the declared slot;
- clothing coverage and consistency;
- anatomy and defects, including hands when visible, extra or fused anatomy,
  extra people, text, watermark, collage, or split-panel output.

The completed reviews found no clothing-safety failure and called the set
promising for the candidate-curation step. They do not accept any image for
dataset use or promotion. A candidate row remains subject to the existing
hash-bound curation, caption, and approval process.

The cloud-pair gallery remains separate from this pilot. It does not turn a
research candidate into accepted dataset media.
