# Local simple-portrait diagnostic review - 2026-09-08

## Bound evidence

This review covers one completed local diagnostic under
`_private/figment-local-comfy-simple-portrait-20260908-v1/`. It does not
approve the output for training, establish identity, or authorize another run.

| Record | SHA-256 |
| --- | --- |
| `manifest.json` | `7bad7f10091acfa0604d8aab05b2a5726c469bb8799ae77d487ac7764c3a5d05` |
| `receipt.json` and completed `journal.json` | `97b968517a444fed7945e7ef6bd50c1472a9f94696996ef69e2abfe1b7c3aeae` |
| `dispatch-attempt.json` | `d310a648c9cc282a73b2229b490897d736fcf530b90aab89ca176856061e741c` |
| Input `g01-face384-crop-v1.png` | `5d6045e15a8d025ad33912234230c257678292331abdf122998ba4cefa28f27c` |
| Output `figment-local-comfy-input_00001_.png` | `06c468272f74c9c52b8f8b161ae0df467c8bd5451e1a15463f3b156b2e3c618b` |

The manifest binds the sole source `anchors/g01.jpg`, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`,
the same 384-square crop input as the preserved crop diagnostic, and the
closed `simple-portrait-v1` prompt profile. It records one 1024 by 1024 image,
seed `481516234`, 24 DPM++ 2M/Karras steps, and the local pins in the manifest.
The receipt records a completed result with the stated 1,180,068-byte PNG.

Against the preserved face-crop manifest
`0fcbbd1c0d6778df23ef78f5678eac7a3d38b2f5b985bd9a7eb699f9c53991a1`, the
API graphs become byte-equivalent after restoring only CLIP nodes 6 and 7. Both
load `g01-face384-crop-v1.png` at node 2. Their launcher hashes differ
(`2997ba...7bac` here; `f84ce1...8cc4` for the preserved crop), so this
establishes the stated graph-text comparison, not equality of every surrounding
launcher byte.

The receipt's teardown reports wrapper PID 3084 and children 36904 and 37352
as terminated, with `verified_stopped: true`, no unresolved processes, and no
teardown errors. That records runtime completion; it does not itself assess the
image.

## Raw fixed640 observer record

`identity-fixed640.json` is SHA-256
`f8345d03f0731fafad3a5118c0ea5808c21040cab9da14a9667f6def1d930c82`. It
records `fixed-max-edge-640@1`, one detected candidate face, and one detected
face for each declared anchor. The following values are transcribed raw from
that receipt; they are neither calibrated nor thresholds or decisions.

| Anchor | Raw cosine | Candidate faces | Anchor faces |
| --- | ---: | ---: | ---: |
| g01 | 0.5779512293389373 | 1 | 1 |
| g02 | 0.6144644004467416 | 1 | 1 |
| g07 | 0.4878149143602172 | 1 | 1 |

The receipt binds the candidate output hash above and rehashes each anchor
before and after observation. It persists no embeddings, threshold, pass/fail
state, approval, or promotion. The preserved crop observer had two candidate
faces and null cosine values, so this table makes no numeric comparison to it.

## Independent visual observations

Compared at original resolution with g01 and the preserved crop output, the
new result does meet the requested shoulders-up, front-facing, plain-background
composition more closely. It is a photorealistic still and depicts an
adult-presenting subject in intact opaque clothing. The white, black-trimmed
tank differs from g01's black strapped top. A dark overlapping hair-like form
behind the subject's left shoulder makes the single-person composition less
clean, though it is not a clearly depicted second face like the framed portrait
in the preserved crop output.

The new face retains broad high-level traits such as dark middle-parted hair,
but its face shape, eye geometry, nose, lips, makeup, and proportions differ
materially from g01 on direct visual inspection. It therefore does not provide
a reliable same-person result. The preserved crop likewise had clear identity,
wardrobe, room, and duplicate-portrait drift. Neither comparison supports an
identity conclusion beyond these single-image observations.

This output has a more target-shaped composition and no framed-background
portrait, but a single deterministic output cannot isolate which wording caused
those differences or generalize them to other prompts, seeds, or conditions.
These observations provide no quality threshold, training admission, or
promotion status.

## Gallery v4 visual QA

The owned local preview at `127.0.0.1:5419` returned five generated-input
records, including the rejected baseline V3 output
`3d6e97572ac4be8a7e7fd786bed7a8eea7580abb097bdf4eaef0a9a4299fb8d8`.
The v4 desktop and mobile screenshots keep creator-001, the provisional g01
reference, g02/g07 comparator context, individual record statuses, and the
diagnostic/non-promotable boundary visible. Desktop presents readable two-column
record cards; mobile stacks them without visible horizontal overflow. This is a
UI observation only and does not change any record's review status.
