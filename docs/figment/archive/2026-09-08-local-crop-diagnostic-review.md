# Local face-crop diagnostic review — 2026-09-08

## Scope

This record assesses the preserved output from the local face-crop diagnostic and
its runtime evidence separately. It does not accept the image as a training input,
repair the failed run, or authorize another run.

## Bound evidence

The run directory is `_private/figment-local-comfy-crop-20260908-v1/`.

| Record | SHA-256 |
| --- | --- |
| `manifest.json` | `0fcbbd1c0d6778df23ef78f5678eac7a3d38b2f5b985bd9a7eb699f9c53991a1` |
| `journal.json` | `cfa93aeb4f235381a0093cb27f6d00bd3fbb6a2a264264923028d3ce83fd634a` |
| `dispatch-attempt.json` | `9fe1a276f0cbe721649711faf0bad733c0ea6cf82439f3ca74e0fd300635d748` |
| `recovery-observation.json` | `08bb89089b5eeddbd17ab188c7c158b3beb80cfaf00dbf05a66ca6c3bb59dfc2` |
| `identity-fixed640.json` | `33a54de195d521797b593d0e19031242f5cd9d014de34c6ac95c01bd6d76ed2d` |
| Crop input `g01-face384-crop-v1.png` | `5d6045e15a8d025ad33912234230c257678292331abdf122998ba4cefa28f27c` |
| Output `figment-local-comfy-input_00001_.png` | `f887f164ff3d57e11ef7b921fd0c1713eecfefda915fba9d74760c17c578a1f7` |

The parent source was `anchors/g01.jpg`, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.
The crop record binds the original 1408 × 768 JPEG to the exact Pillow box
`(512, 17, 896, 401)`, producing a 384 × 384 RGB PNG without resize. It records
Pillow 12.3.0, PNG `optimize: false`, and `compress_level: 9`.

The baseline V3 comparison manifest is
`4c1a9fdd6324a4e0fc72b199aeef884145b70b341b787a329d5146074586909e`;
its output hash is
`3d6e97572ac4be8a7e7fd786bed7a8eea7580abb097bdf4eaef0a9a4299fb8d8`.
The two API workflows differ only at node 2: baseline loads `g01.jpg`; this run
loads `g01-face384-crop-v1.png`. The broader manifests also differ in
conditioning provenance and launcher hash, so this is a graph-only comparison,
not proof that every surrounding implementation byte was identical.

## Runtime status

The original launcher journal is `failed` with `LocalComfyError`; it records
the two children as terminated but has a teardown error for wrapper PID 13288 and
`verified_stopped: false`. There is no `receipt.json`. The later recovery
observation reports all three recorded process identities absent and no listener
on 127.0.0.1:8190, but explicitly says it is not a completed launcher receipt.
It does not convert the original failed journal into a completed run.

The fixed640 observer receipt reports two candidate faces, `multiple faces
detected`, and no raw cosine values. Those unavailable values are diagnostic
observations, not a score or decision.

## Independent visual observations

At original resolution, the crop output is photorealistic and shows an
adult-presenting subject in intact opaque clothing. It does not provide a close
visual match to g01: facial proportions, wardrobe, and room composition differ.
A second portrait face appears in the framed background, creating a duplicate
person depiction. The baseline output had the same decisive duplicate-person
and drift problems; the crop did not resolve them.

These observations reject the output as a training input. They do not establish
a general identity conclusion, a quality threshold, or any promotion status.
