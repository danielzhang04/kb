# OmniGen2 cloud preparation (offline only)

This packet makes the frozen local OmniGen2 single-reference probe reviewable as a
RunPod-harness manifest. It does not launch a pod, call a provider, upload an input,
export a LoRA, or contact Gemini. It remains research-only, non-promotable, and has
no authorization to export an output.

`pod/prepare_omnigen2_reference.py` defaults to printing canonical manifest JSON and
performs no filesystem or network I/O. Its explicit `--prepare` mode copies the
admitted g01 bytes into `_private/figment-omnigen2-cloud-preparation-20260909-v1/` for
root review. The staged manifest names only `payload/g01.jpg`; it never points the
harness at the original source path.

Preparation is one-shot: the target payload must be absent. The planner rejects an
existing payload, symlink, junction/reparse-point payload, or symlink/junction/reparse
component in the destination-root ancestry before it creates or copies anything. It never
reuses or overwrites a prior review payload.

## Exact parity

The source graph remains the frozen planner
`pipeline/expand/local_omnigen2_inference.py`: one `LoadImage` input, 768 by 768,
seeds `481516234` and `90210`, and no LoRA. ComfyUI is pinned to
`95d755cd8107a72258d452b5d3657273d571f07d`. The three public Hugging Face weights are
downloaded by the existing bootstrap on the pod and checked there before use:

| destination | source | SHA-256 | bytes |
| --- | --- | --- | ---: |
| `models/diffusion_models` | `Comfy-Org/Omnigen2_ComfyUI_repackaged` / `split_files/diffusion_models/omnigen2_fp16.safetensors` @ `4876f2222e35e269029e8d72aaff5b2aaaf73e1b` | `60dbde45107762d164bac463e1cf365e074b377fa843dc90cb2985fb211cd4de` | 7,934,384,176 |
| `models/text_encoders` | same repo / `split_files/text_encoders/qwen_2.5_vl_fp16.safetensors` @ same revision | `ba05dd266ad6a6aa90f7b2936e4e775d801fb233540585b43933647f8bc4fbc3` | 7,509,337,224 |
| `models/vae` | same repo / `split_files/vae/ae.safetensors` @ same revision | `afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38` | 335,304,388 |

The public model total is 15,779,025,788 bytes (15.78 GB decimal). These weights are
remote downloads, never uploads of local weight files. The sole possible upload is
the exact-byte g01 copy: source
`orgs/figment/personas/creator-001/anchors/g01.jpg`, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`, staged as
`payload/g01.jpg`, and uploaded by the harness to `input/omnigen2/g01.jpg` only after
a separately authorized live run.

## Cloud envelope and limits

The manifest requests one SECURE NVIDIA L40S class pod (48 GB requested VRAM), matching
the known image from the successful tensor-pod manifest:
`runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04`. It has
`max_placement_attempts: 1`, two jobs as one pair, 45 minutes readiness, 5 minutes per
job, and 5 teardown minutes. The existing compatibility-job formula produces the
60-minute minimum exactly. There is no automatic retry or second placement.

The historic L40S rate in `train/tensor-pins.yaml` is $1.30/hour, so the prepared
60-minute ceiling is $1.30, below the recorded remaining $12.199615. This is only a
conservative estimate, not a claim of current RunPod price or availability. A root
review must obtain the current ledger, rate, availability, and card approval before
any live command; this preparation does not establish any of them.

The requested 48 GB is VRAM, chosen to avoid the local host's system-RAM pressure.
System RAM and VRAM are different resources. This does not claim that 12 GiB is a
universal local-RAM minimum. Windows-to-Linux runner changes, package resolution, and
remote hardware mean the cloud environment is a pinned target, not a byte-identical
execution guarantee.

The existing harness verifies model download hashes. It cannot currently attest to a
remote post-upload g01 SHA-256 or to the graph hash ComfyUI actually queues. Those are
missing acceptance checks; this packet does not weaken the harness or fabricate their
results.

## Before a cloud launch

Root must independently review the generated private payload and then confirm all of:

1. the existing local wait has not produced the first result, avoiding a duplicate cloud run;
2. a T2 live-pod card includes this manifest, one pair, one placement, `--max-minutes 60`,
   and a current approved `--max-usd` no greater than the reviewed ceiling;
3. current RunPod availability, hardware details, price, current cost ledger, arc remainder,
   and daily budget all pass the harness gates; and
4. the explicit acceptance gaps above are accepted or closed without changing spend or trust code.

The managed dashboard ledger has no Figment baseline and must not be selected or bypassed
with `--allow-empty-ledger`. Before any future live command, use the canonical provider
ledger at `C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07/ledgers/cost`
explicitly with `--arc-cap-usd 50`; an offline dry-run may use only an isolated fake-ledger
fixture and must never write a real cost ledger.
