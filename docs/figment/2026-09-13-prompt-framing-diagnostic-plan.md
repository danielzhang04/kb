# Prompt framing diagnostic — preparation and review

Status: preparation only, 2026-09-13. No new paid run is admitted or started.

## Decision

Test whether removing one body-and-hands phrase improves tight shoulders-up framing. Use four fresh public-base images: baseline and treatment for each of two seeds, in one pod with unchanged hardware, model pins, workflow and sampling settings. This is a small paired diagnostic, not a checkpoint evaluation or a production prompt promotion.

The completed RTX 6000 Ada diagnostic produced two clothed adult images and zero tight-framing passes. Exact-owned teardown was verified. Its images remain historical evidence; they are not fresh controls for this experiment. The earlier hardware change also prevents a height-only causal conclusion. Do not replay any completed diagnostic card.

## Research assessment

Krea's official guide recommends natural-language descriptions and includes close-up examples; this supports a prompt experiment, not a promise of reliable crop control. The model card acknowledges variable prompt following. [Official prompting guide](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md), [official model card](https://huggingface.co/krea/Krea-2-Turbo).

Keep the current ComfyUI CFG value of 1. Krea's native sampler uses its zero guidance setting for the conditional prediction; the pinned ComfyUI sampler uses CFG 1 for that result. Copying the numeral zero between these implementations would change behavior. [Krea sampler](https://github.com/krea-ai/krea-2/blob/main/sampling.py), [ComfyUI v0.34.0 sampler](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/v0.34.0/comfy/samplers.py).

The official ComfyUI tutorial describes its default workflow and optional prompt enhancement. The research did not establish an exact official workflow JSON matching this project's `res_2s`/`beta` configuration. It therefore does not justify changing sampler, step count or enhancement during the prompt comparison. [ComfyUI tutorial](https://docs.comfy.org/tutorials/image/krea/krea-2).

Root reviewed two completed Sonnet public-research outputs and an Opus hypothesis review. Actual responding models were `claude-sonnet-5` and `claude-opus-5`; all four research/hypothesis/manifest-author jobs exited 0. Native success is not acceptance of every recommendation. The first research answer omitted the prompting guide; the follow-up corrected that gap. Root independently checked the primary sources above.

## Exact treatment and invariants

Delete exactly this one span from the baseline prompt:

> , an adult woman's proportions and an adult woman's frame, her hands and neck reading the same age as her face

All other prompt text remains identical, including early twenties/about twenty-one, adult face, the explicit adult-woman statement, fully clothed black crew-neck top, shoulders-up instruction, lighting, background and camera description. The untrained trigger stays unchanged. This removes a coupled text span: it also shortens the prompt and removes repeated age wording. It cannot isolate body semantics alone.

Order: baseline 481516234, treatment 481516234, treatment 90210, baseline 90210. Reverse the order within the second pair to reduce a simple order confound. Each job produces one image. Four unique output names bind condition and seed.

Preserve the baseline's SECURE single RTX 6000 Ada, 1448×1448 batch one, public model revisions/hashes, ComfyUI v0.34.0, pinned custom node, four steps, CFG 1, `res_2s`, `beta`, denoise 1 and graph edges. No LoRA, checkpoint upload, reference image, training, model promotion or enhancement is introduced.

## Acceptance and interpretation

Before execution, a source-pinned offline verifier must call the actual harness's manifest validation and job substitution helpers. It must prove that all top-level manifest values except jobs match the frozen baseline, and each effective graph changes only seed/output prefix plus the treatment text where applicable. Retain before/after pins, raw output, native exit and all four effective graphs. Independent review precedes acceptance.

After any admitted run, first verify original run/journal, model/config bindings, PNG decoding, embedded prompts, four exact outputs, costs and exact-owned teardown. Then review the actual images independently. Record adulthood/clothing safety separately from framing; stop normal delivery on any ambiguous-age or clothing failure.

Record an absolute framing result for every image and a paired comparison for each seed. A treatment that passes when its baseline also passes is an absolute success but not a demonstrated improvement. Record crown clipping, visible framing boundary and whether the requested tight shoulders-up composition was achieved. Preserve failures and ambiguous judgments. Two seeds cannot establish general reliability, identity quality or causality beyond this coupled prompt change. No automatic promotion, replication, retry or sweep follows.

## Budget and admission

Planning envelope: one placement, 95 minutes, harness `--max-usd 2.10`, separate $0.40 cleanup reserve, $2.50 total ceiling. The declared $0.84/hour rate is historical, not a fresh quote or guarantee. The existing timing formula gives 80 minutes for four jobs; 95 minutes accommodates that declared allowance. At the declared rate, 95 minutes estimates $1.33 compute, or $1.73 with the reserve. Storage, actual READY rate, cleanup and billing uncertainty still require the existing admission safeguards. Do not change spend-control code.

Last accepted paid-arc estimate is $33.590210 against $50, with two older $0.40 reserves separately retained: $34.390210 including those reserves. A full new $2.50 reservation would bring the conservative envelope to $36.890210 before any other concurrent spend. Reconcile fresh state and create the precise work card before a live action. These figures are estimates/reservations, not invoices or provider observations from this preparation.

## Current blocker and next step

The unaccepted manifest author's JSON preserves every top-level baseline value except jobs, but its two substitutions use `node`; the actual harness expects `node_id`. Root supplied that incorrect key in the work order. No execution or offline-verifier pass is claimed.

Automatic review rejected the prepared Sonnet key-repair transfer before launch because its new private harness-source fragment needs specific payload/destination consent. The related offline-verifier authoring packet has not been attempted. An exact consent question for both is pending; neither has a `process.json`. This is separate from the pending HTTP/UI source packet and does not authorize routing either blocked packet elsewhere.

After consent: launch the prepared repair and verifier workers, assemble their exact reviewed output, obtain independent review, run the bounded local verifier, then assess fresh budget/provider state and the concrete live-run admission. No old diagnostic is permission for a retry.

Local evidence: `MAIN/_private/figment-claude-overnight-20260913/media-preparation-root-review.json`; four named worker directories; `manifest-author-v1-unaccepted.json` (6,126 bytes, SHA-256 `94691115c7c3c2ba8e060b8d613dd3fc0a67f672005292c7b6e3d716fb6bcf37`). Baseline remains `MAIN/_private/figment-square-rtx6000ada-20260913-v1/manifest.candidate.json`.
