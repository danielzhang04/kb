# Personas

Each `personas/<creator-id>/` directory is one figment persona: the machine-read
source of truth `pipeline/persona.py` validates and every pipeline command
(`figment_train.py plan|run|grade|apply-rulings|gate|train-first`) reads.

## Adding a persona

1. `<creator-id>/persona.yaml` — copy an existing one (e.g. `creator-001/`) and edit:
   - `id` — matches the directory name.
   - `identity.references` — 2+ relative paths under `anchors/`.
   - `identity.look` — this persona's own face/body words (the ONLY place they may
     live — never a shared template).
   - `identity.spec.{path,sha256}` / `register.spec.{path,sha256,section}` — `sha256`
     is the live digest of the file at `path`; recompute on every edit.
   - `grammar`/`register.settings` — the shared angle/distance/light/wardrobe
     vocabulary (`pipeline/persona.py`'s `ALLOWED_*` sets); copy unchanged.
2. `<creator-id>/anchors/` — 2+ reference images `identity.references` points at,
   each ≥800px.
3. `<creator-id>/identity-spec.md` — short human rationale for the look words; its
   sha256 is what `identity.spec.sha256` must equal.
4. `<creator-id>/training.yaml` — training overrides (`trigger: null`; the pipeline
   derives it from `id` + `base_arch`, never hand-set it).

## Verify

```
python pipeline/figment_train.py plan --creator <creator-id> --stage all \
  --out <scratch-dir> --skip-pin-verify
```

A clean `plan` run proves the schema, banned-phrase, sha256 and allocation checks all
pass, and every generated manifest/prompt is free of another creator's identity words
(grep the `--out` tree for the other creator's id/anchor filenames).

## First real plan

Once real anchor photography replaces any placeholder anchors, re-run `plan --stage
anchor` (never with `--skip-pin-verify` for a live pod), grade it, and apply rulings
to promote exactly one anchor before planning `dataset`.
