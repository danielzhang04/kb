# Matched current-20 follow-up design - 2026-09-08

## Decision context

The current-caption 20-step pair completed, but it does not justify the next
checkpoint. The independent review stopped the ladder: both LoRA rows remained
near their seed-matched base faces, drifted from the stated g01 cues, and were
tight chest-up crops. The root review records the same weak identity and
framing outcome while allowing one predeclared comparison. Twenty steps cannot
settle what a 100-step checkpoint would show, but that uncertainty does not
reopen current-50, current-final100, concise, or a new training branch. None
has an admission.

The established base-control failure is composition, not gaze: both base
reviews say eyes meet the camera, but both describe a chest-up rather than
waist-up crop and no clear turn to the requested side. Current-20 has a genuine
reviewer disagreement: the independent review records eyes away in both rows;
the root review records camera gaze. Preserve that disagreement. It is neither
proof of LoRA gaze harm nor a reason to call gaze a baseline confound.

| Hypothesis | What the records support | What they do not establish |
| --- | --- | --- |
| Weak identity effect at 20 steps | Neither current-20 row visibly moves toward the stated g01 cues. | That more steps would help. Higher checkpoint renders remain stopped. |
| Under-specified inference wording | The minimal prompt lacks concrete g01 cues, while base misses framing and turn. | That any particular words caused the identity result. |
| Base composition non-adherence | Base already misses the requested crop and turn before an adapter is involved. | That no whole prompt can obtain them. |
| Absent or wrong adapter attachment | The pinned graph has the selected `LoraLoader`; the header has 2,166 `lora_unet_` tensors at step 20; the receipt has zero missing-key warnings; stderr reports 722 attached patches for each prompt. | A useful semantic effect or appropriate adapter strength. |

These are hypotheses, not causal, identity, age, checkpoint, or quality
findings.

## One controlled follow-up

Run no new training. Use a prompt-profile calibration, with the completed
minimal-prompt base/current-20 pairs as historical controls. It has at most
four new PNGs and eight PNGs in the complete comparison record.

| Set | Adapter | Positive prompt | Seeds | New PNGs |
| --- | --- | --- | --- | ---: |
| Historical control | base | existing minimal C1 prompt | 481516234, 90210 | 0 |
| Historical control | current-20 | existing minimal C1 prompt | 481516234, 90210 | 0 |
| Calibration | base | frozen profile prompt below | 481516234, 90210 | 2 |
| Conditional comparison | current-20 | same profile prompt | 481516234, 90210 | 2 |

The base calibration runs and is reviewed before any new LoRA row. The sole
changed factor is the complete positive prompt profile. Persona cues and
composition wording change together, so it cannot attribute an outcome to an
individual word. The negative prompt, seeds, RealVisXL base, 1024x1024
dimensions, 24 steps, CFG 6.0, `dpmpp_2m`, `karras`, denoise 1.0, output node,
Comfy runtime/model pins, and current-20 staged LoRA slot remain fixed. The
new controller and shared execution engine require fresh source hashes and
admissions; historical C2 receipts remain bound to their original source.

The profile is frozen before any render:

```text
figmentlocalg01probe. Photograph of one fictional adult woman around twenty-one,
framed from the top of her head to below her waist, with both elbows visible and
space above her head. Her torso and head face slightly toward image-left while
her eyes look directly into the camera. She has long center-parted jet-black
hair, dark brown almond-shaped eyes with subtly lifted outer corners, dark
arched brows, full pink lips, a tapered jaw and small chin. She wears a plain
opaque black crew-neck T-shirt. Soft daylight against a plain warm off-white wall.
```

This tests a whole prompt profile, including whether explicit composition is
followed before an adapter is involved. It is not a new reference, identity
assertion, age classifier, or evidence that a LoRA learned these attributes.

## Predetermined records and stops

Each new row needs a fresh reviewed admission, seed/prompt/adapter binding,
bounded output inventory, and verified teardown. C2's historical embedded PNG
graphs were checked in a separate audit, not automatically by its executor.
The new protocol must additionally parse bounded embedded `prompt` JSON,
compare the complete canonical graph with its admitted row, and record the
verified graph hash in its receipt. Pair a current-20 output only
with its same-prompt base output; retain, never relabel, the historical pairs.

Root and independent diagnostic reviews record per seed: head-to-below-waist
framing, image-left turn, eyes-to-camera, g01 cue comparison, apparent
adulthood and age fit, clothing integrity, realism, and defects. They are
diagnostic observations, not human QA or approval.

Stop with no profile-current-20 pair if either review records both profile-base
seeds as missing framing, or both seeds as missing the specified turn; if the profile newly
loses direct gaze in both seeds; or for an adult-presentation concern,
garment-integrity failure, duplicate subject, or material anatomy defect. This
means the profile has not removed the base-composition confound. It makes no
claim about LoRA harm or undertraining. Only if neither review stops may the
two profile-current-20 rows run once, with no retry. Stop the study after their
review regardless of result. Any result remains descriptive and cannot reopen
the stopped higher-checkpoint ladder.

## Terminal boundary

This is a one-off bounded study, not a retry-until-likeness loop. It completes
deterministically after the two profile-base PNG receipts and hashes plus two
independent-role observations; the two conditional profile-current-20 PNGs
and their observations are included only when the predeclared base condition
is met. It then terminates regardless of visual quality. Runtime artifact
checks are deterministic; visual judgment is separately recorded, subjective,
and cannot trigger an automatic prompt rewrite, another run, or a production
promotion.

## Minimal implementation shape

If separately admitted, use a new hash-bound fixed protocol with only
`profile-base` and conditional `profile-current-20`. Reuse or narrowly extract
C2's owned-process, listener, output-validation, receipt, and teardown engine.
A behavior-preserving C2 wrapper may adopt that extracted engine after review;
its original stage policy and stopped review bindings must remain strict.
Do not copy another executor or monkeypatch the accepted runtime. No protocol
stage may reach a higher checkpoint or training.

## Evidence pins

Historical receipts: base
`d12cdd5c99cc9666a919632712b3a5556147c509325b29295ad048f92bbd1b7a`;
current-20 `a6140543aff6fbf02bd294fa187b76aa477b593f34108bf6600d47f190746ffb`.
Base review digests: root
`e42edff6f1148a9710221ab06fc0ba582044c8e69c2165adcc2e984119cd293e`;
independent `188d10470dca6f1de71df3e2e8fe4319720207ce63f7775aee5ac8f2c8444d98`.
Current-20 reviews: root
`56d6fa6fba66eacf710c4306e071aeb0b9d78ee3dfc3b71959114ad3c7c0c5d9`;
independent-stop
`299cfb4ca019c08ebe30d3a5eb2eedbb987f3026399da0195310a6fcaad215e4`.

The current source checkpoint is
`fc3222248dd317270f975f34828f5376751114584d443eebeae0112deb3e473f`
(170,540,948 bytes, `ss_steps: "20"`, 2,166 U-Net keys). Both current PNG
embedded graphs reconstruct C1 source
`bca8be929852fe19eab724f878f8985e4b3f6146050e564af91d0c83e6570d6f`.
C2 stderr digest: `1a802e6cf19e24581006c81fa0d3a18d76bc97fc9a49434115c758071935a321`.

This design authorizes no render, admission, training, model read, export,
promotion, or quality decision.
