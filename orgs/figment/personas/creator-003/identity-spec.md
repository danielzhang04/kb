# creator-003 — identity spec

Fully synthetic persona built on the `tensor` recipe profile (spec
docs/superpowers/specs/2026-09-29-figment-tensor-parity-design.md). No real person.

- Passport slot words (module 03 copy block): hair `long, straight platinum blonde hair`,
  eyes `bright light blue-grey`. The package's own defaults, confirmed by the operator on
  the passport T2 card. Only `identity.look.hair` and `.eyes` feed tensor prompts. The other
  six look fields satisfy the persona schema and must never appear in a tensor prompt (the
  §9 parity test fails if they do).
- Identity: none until the operator picks a passport. The pick writes
  `anchors/passport.png` as `identity.references[0]`.
- Adult read: GUARDRAILS #2; the operator rules every image by eye.
