# Questions for the public base control

Root observations before the public control runs, 2026-09-10. These are interpretation criteria, not new acceptance rules.

The current dataset does include the canonical seed. `MAIN/_private/figment-builtin-dataset-20260909-v1/dataset-v1/dataset_curation.json` explicitly lists `seed-g01`, kind seed, split train, materialized as `01.png` with `01.txt`. Missing the original seed is therefore not an explanation for this run. The other training samples and their visible identity fidelity may still matter; that question is not settled by inclusion alone.

The intended tester text says close-up and shoulders up. Root's original-resolution inspection of the final output shows substantially more torso and waist, with hands out of frame. The local grader reports final face size 483 pixels against its existing 600-pixel floor. This makes framing a separate observable issue alongside the disputed identity and apparent-age judgments. It does not prove that the LoRA caused the framing, and the floor must not be silently lowered to obtain a PASS.

For the seed-1595 public-base control, inspect the actual image first, with the intended text unchanged. Record whether it frames the face more tightly or also shows the torso; whether identity shifts materially versus the already-local final tester image; realism; clearly adult appearance; and clothing integrity. Do not infer exact age from classifier estimates, or generalize a single matched seed to cross-view or multi-seed consistency.

If the public base follows the close-up instruction but the LoRA output does not, dataset framing or adapter strength becomes a useful later hypothesis. If both fail similarly, prompt/aspect-ratio/base behavior becomes a useful later hypothesis. Neither result alone proves the cause. Any new experiment should vary one relevant condition, retain the current evidence, and preserve the blocked private-checkpoint export pending its exact consent.
