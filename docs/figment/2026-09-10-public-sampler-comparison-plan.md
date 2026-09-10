# Public sampler-package comparison plan

This is a prepared-only, public-base diagnostic. It asks one narrow question:
with the frozen completed baseline text, seed 1595, direct `CLIPTextEncode`, public
model pins, no LoRA, and 1448x2176 held constant, does the current Comfy sampler
package differ visibly from the official-template package?

The two cells each make one image. The current cell is `4 / res_2s / beta`; the
official-template cell is `8 / euler / simple`. Both use Comfy CFG 1 and denoise 1.
Only node 8's steps, sampler, and scheduler vary; output names and job records vary
only to keep artifacts separate. Prompt refinement is absent from both cells.

The experiment has one placement, a 60-minute / $1.30 ceiling, and no authorization
to launch. Its native dry-run uses an isolated ledger. The payload is restricted to
the three existing pinned public Krea component downloads and the existing pinned
public custom node. It contains no upload, reference input, private checkpoint,
private-derived feature, secret forwarding, or LoRA loader.

After one pair, review may record only crop/framing, cautious adult appearance, and
realism/garment observations. It cannot make age or identity acceptance decisions,
make a multi-seed claim, or attribute an effect to one individual setting in the
three-setting sampler package. If the pair does not show a useful change, stop this
sampler branch; no parameter search follows from this plan.

The source note is the pinned read-only official audit at
`_private/figment-official-sampling-audit-20260910-v1/official-sampling-parity-audit.md`
(SHA-256 `d862fb9ac6f3cc72679112b8b190947391f2e1a5b07779699f4b627812d64e8f`),
which found the exact `8 / euler / simple` official Comfy package and the separate
default prompt-refinement confound.
