# GO-WITH-EDITS application notes

Date: 2026-08-19

- Applied the review's §6 `still_prompt` replacements verbatim to L02, L03, L04, L06, L07, L11, L16, L17, and L20. L21 was untouched.
- Restaged `channels/the-second-take/example-shots.md` Entry 1 with foreground geometry and receding overlapping crowd planes; expanded `_REAR_ZONE` to accept the reviewed geometry vocabulary while leaving `_REAR_PROXIMITY` unchanged.
- Updated the four stale suffix-span comments only; no behavior changed beyond `_REAR_ZONE` vocabulary.

## Verification

- `lint_shots.py`: 0 HARD, 82 heads-up.
- Image-generation pytest: 294 passed.
- Visual-prompt-writer pytest: 270 passed.
- All nine reviewer blocks match §6 byte-for-byte. The task JSON delta is exactly L02, L03, L04, L06, L07, L11, L16, L17, and L20, with `still_prompt` as the only changed field; L21 remains unchanged. `global_prompt_suffix` remains byte-identical to the grammar canonical suffix. L03 and L16 conform to the review's crowd-law reading.
- The HEAD comparison additionally shows pre-existing L21 prompt work; it was not changed by this application.
