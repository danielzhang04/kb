# Figment content asset binding plan

## Purpose and boundary

Add one offline adapter that binds every required slot in one current compiled
content brief to a distinct, currently approved local `gen` still. The result is
planning evidence for hub tracking. It is not a new image approval, a generated
asset, a batch acceptance, a publishing authorization, or evidence that any
audience metric was observed.

The adapter reuses `figment_train.validate_approved_gen_still` as the only image
authority. It does not treat an `approved-list.json` as standalone authority,
reproduce the approval rules, accept diagnostic video, or add a generation orchestrator. The
first version supports only `persona` still slots. Non-persona slots and the
`G` motion slot remain unassigned until an authority specific to those asset
classes exists.

## Input and output

The command is:

```powershell
python orgs/figment/pipeline/content/content_asset_binding.py `
  --root <bounded-content-and-plan-root> `
  --brief <root-relative-brief.json> `
  --request <root-relative-original-request.json> `
  --rulings <root-relative-slot-fit-rulings.json> `
  --out <fresh-root-relative-assignment.json>
```

`--root` and every input/output path must be real, non-reparse paths. Inputs
cannot escape the root. The output parent must already exist and the output is
created once with exclusive creation.

The rulings schema is `figment/content-slot-fit-rulings@1`. It contains exactly
one row per compiled brief slot. Each row repeats the exact `slot_index`, `role`,
`taxonomy_type`, and `kind`; records `decision: fit`, a bounded `decided_by` and
ISO `decided_at`; and names one source with `kind: approved-gen-still`, a
root-relative `plan`, and its `image_id`. The attribution is per slot because
approved `gen` lineage establishes image identity, safety, and quality review,
but does not establish that an image performs a particular content role.

The output schema is `figment/content-asset-assignment@1`. It records
`not_promotable: true`, the current brief and request paths and hashes, the
creator, and the exact ordered slot assignments. Each asset projection contains
only root-relative paths, byte count and SHA-256, plus hashes of the source
plan, approval-lineage, and approved-list records returned by the existing
authority. It carries no prompt, reference image bytes, platform action,
publication state, or observed metric.

## Revalidation

Before resolving assignments, the producer contract recompiles the brief from
the original request and current persona, canonical reference, taxonomy, and
selected template. The stored brief must equal that current record exactly.
This binds the creator and exact required slots and detects a stale request,
persona, reference, taxonomy, or template.

For every slot, the adapter calls
`validate_approved_gen_still(creator, plan, image_id)`. The returned source plan,
approval lineage, approved list, and image must all remain below `--root`; no
absolute machine paths are emitted. After all evidence has been captured, the
adapter recompiles and compares the brief again, verifies the rulings bytes are
unchanged, calls the approved-still authority again for every image, and
requires an identical bounded projection before writing the output.

The cross-join also requires the plan's current persona bytes to match the
brief's persona hash and requires the plan and current approval subject to carry
the same complete anchor inventory. The brief's canonical reference name and
hash must occur in that inventory. Fixed `grade/gen` evidence paths and the
plan's authority-root-relative persona path are checked lexically for reparse
components before the existing authority is invoked or trusted.

## Failure cases

The command writes nothing when:

- the brief cannot be reproduced from its request and current producer inputs;
- a path escapes the root, crosses a symlink/reparse point, is missing, is too
  large/deep, or the output already exists;
- the rulings omit or add a slot, repeat an index, change a slot's exact
  role/type/kind, lack a per-slot fit attribution, or reuse an image ID;
- the brief creator and approved `gen` creator differ;
- a slot is non-persona, a motion/video slot, or names any authority other than
  `approved-gen-still`;
- the existing `gen` authority rejects missing, stale, rejected, unsafe, or
  mutated approval evidence or image bytes;
- the brief, request, rulings, approved image, or returned evidence projection
  changes during assembly.

Tests use media-light synthetic files. One producer-to-consumer fixture builds
real current `gen` approval lineage and exercises the command. Negative tests
cover stale producer inputs, slot coverage and fit mismatches, creator and image
reuse, unsupported asset classes, reparse/traversal, second-pass source changes,
fresh-output enforcement, and observable CLI failure without partial output.
