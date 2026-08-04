# Second Take open-model hosted-GPU bakeoff handoff — 2026-08-04

## Context

Daniel paused setup before any GPU run or cloud spend. The active question is whether a cheap,
hosted open-model workflow can match enough of The Second Take's current Gemini Pro image quality
and iteration behavior to justify integration.

The first comparison is deliberately small:

1. `Qwen/Qwen-Image-Edit-2511` — strongest candidate for reference-driven editing, recurring
   characters, and restaging approved frames.
2. `black-forest-labs/FLUX.2-klein-4B` — fast, cheap production candidate, tested distilled and
   without a LoRA first.

**Hard workspace boundary:** this handoff lives in KB, but the experiment does not. On pickup,
read this file, delete it through the handoff lifecycle, and then create/use
`C:\Users\danie\second-take-open-model-bakeoff` (or another explicitly standalone path) outside
both `C:\Users\danie\kb` and every faceless-youtube/FYT checkout. Do not run the harness from KB or
FYT. Do not write weights, Hugging Face caches, generated images, or result archives into either
repo.

## Done

- Built an isolated, resume-safe Python harness with three representative Second Take cases, two
  fixed seeds, timing/peak-VRAM/error capture, manifests, montages, and an evaluation scorecard.
- Dry-run validation passed for both model routes. Defaults are 3 cases x 2 seeds = 6 images/model,
  12 total at 1536x864; Qwen defaults to 40 steps and distilled FLUX to 4.
- Built a self-contained upload archive containing only the harness, locked style-bible excerpt,
  three approved references, cases, and scorecard:

  `C:\Users\danie\faceless-youtube-channel-forge\channels\the-second-take\visual-kit\experiments\open-model-bakeoff\second-take-open-model-bakeoff.zip`

  - Size: `1,710,193` bytes
  - SHA-256: `2A0A0D717F2D936A0F2C5F6EE7409F0D2DBE78D4A7E216350CC18E3EF99E7D0D`
  - Archive members: `run_bakeoff.py`, `cases.json`, `requirements.txt`, `README.md`,
    `scorecard.csv`, `kit/style-bible.md`, the base/MacGregor refs, and the approved bank-teller
    frame.
- Confirmed the intended external Windows workspace does not yet exist. Nothing was copied or moved.
- No RunPod pod was created, no model weights were downloaded, and no paid cloud spend occurred.
- The harness writes only to its own `outputs/` directory. It does not touch `_staging`, Gemini
  forge outputs, the asset registry, or a video directory.

### Test cases

| Case | What it probes | References |
| --- | --- | --- |
| Single-character scene | Identity and house-style retention in a new scene | Base character |
| Two-character interaction | Two distinct identities plus a readable handoff | MacGregor + base |
| Complex restage | Composition and cast retention from an approved scene | Bank-teller frame |

## Remaining

### 1. Pick up safely and relocate the bundle

The pickup terminal must first remove this active handoff from `handoffs/` according to
`handoffs/README.md`. Then, in a normal PowerShell terminal:

```powershell
$sourceZip = 'C:\Users\danie\faceless-youtube-channel-forge\channels\the-second-take\visual-kit\experiments\open-model-bakeoff\second-take-open-model-bakeoff.zip'
$testRoot = 'C:\Users\danie\second-take-open-model-bakeoff'

New-Item -ItemType Directory -Path $testRoot
Copy-Item -LiteralPath $sourceZip -Destination $testRoot
Set-Location $testRoot
Get-FileHash -Algorithm SHA256 -LiteralPath '.\second-take-open-model-bakeoff.zip'
Expand-Archive -LiteralPath '.\second-take-open-model-bakeoff.zip' -DestinationPath '.\bundle'
python .\bundle\run_bakeoff.py --model qwen --kit .\bundle\kit --dry-run
python .\bundle\run_bakeoff.py --model flux --kit .\bundle\kit --dry-run
```

Expected SHA-256 is the value recorded above. Stop if it differs. Do not delete the source copy in
the stale forge checkout without Daniel's explicit authorization.

### 2. Human gate: create the cheap hosted pod

Use RunPod's official PyTorch pod template with:

- **GPU:** A40 48 GB (preferred first test) or an equivalently priced 48 GB card.
- **System RAM:** at least 64 GB because Qwen uses CPU offload on the A40.
- **Disk/volume:** about 150 GB mounted at `/workspace` for environments, two model downloads,
  cache, and results.
- **Access:** JupyterLab is sufficient. A RunPod API key is not needed for this manual test.
- **Credentials:** optional Hugging Face token only if anonymous downloads are rate-limited. Never
  paste a token into this handoff, a repo file, a notebook, or shell history.

Why not start with 24 GB: FLUX Klein should fit, but Qwen on 24 GB adds quantization/aggressive
offload and more failure variables. Why not start with A100 80 GB: it is easier, but unnecessary for
the smoke test. An A40 plus CPU offload is the intended price/quality compromise.

Verify the live hourly price at pickup. Earlier planning estimated roughly `$0.50-$2.00` total
compute for setup/downloads plus six images, but that is not a guaranteed quote. Starting the pod is
a spend gate and remains Daniel's action/approval.

### 3. Upload and run the six-image smoke test

Upload the ZIP from the external Windows folder to `/workspace` through JupyterLab, open a terminal
on the pod, and run:

```bash
cd /workspace
python -m zipfile -e second-take-open-model-bakeoff.zip bakeoff
cd bakeoff
export HF_HOME=/workspace/.cache/huggingface
python -m pip install -r requirements.txt

python run_bakeoff.py \
  --model qwen \
  --kit ./kit \
  --offload \
  --variants 1 \
  --width 1344 \
  --height 768

python run_bakeoff.py \
  --model flux \
  --kit ./kit \
  --variants 1 \
  --width 1344 \
  --height 768

python -m zipfile -c results.zip outputs
```

This produces 3 Qwen images plus 3 FLUX images. Download `/workspace/bakeoff/results.zip` to the
external Windows workspace. Terminate the pod and delete any persistent paid volume after the
download to stop charges.

If Qwen alone runs out of memory, retry only Qwen once at the smaller size:

```bash
python run_bakeoff.py \
  --model qwen \
  --kit ./kit \
  --offload \
  --variants 1 \
  --width 1024 \
  --height 576
```

Do not jump to an A100 or add quantization/LoRA work until the error, GPU/RAM configuration, and
first fallback result are recorded and Daniel approves the next cost/complexity step.

### 4. Judge practicality for production

Fill in `scorecard.csv` and compare the models on:

1. recognizable recurring-character identity;
2. separation of multiple characters;
3. readable action and composition;
4. match to the locked 2.5D vector/environment recipe;
5. editability/retry behavior, not just the best first image;
6. elapsed time, peak VRAM, failure rate, and estimated cost per accepted image.

The decision is not “which single image looks nicest.” It is whether either route lowers accepted
frame cost after iterations while preserving enough continuity for faceless YouTube production.
Do not modify FYT based on an unscored montage.

### 5. Migration only if the bakeoff wins

Do **not** move weights or the GPU runtime into KB/FYT. The clean production shape is:

- standalone GPU worker/service outside both repos, packaged as a container;
- model cache/weights on the cloud volume or image;
- RunPod Serverless or a watched persistent endpoint when usage justifies it;
- a thin HTTP provider adapter added to FYT only after Daniel approves migration;
- existing PNG, staging, montage, review, and registry contracts preserved;
- environment-based provider selection with Gemini Pro retained as fallback during transition;
- KB stores decisions/status only, never runtime artifacts.

The GPU setup is therefore portable: the same container/service can be reached from FYT later
without relocating the model into the repo. Production integration must be a separate approved arc.
The current Gemini entry point is `.claude/skills/image-generation/scripts/forge.py`; do not edit it
during this smoke test.

## Known gotchas

- The source folder is inside `faceless-youtube-channel-forge`, whose `.git` pointer is stale/broken
  (`git status` reports it is not a repository). Treat that location as read-only source material,
  not a durable worktree.
- The bundled README's A100 recommendation describes the lowest-friction full-BF16 run. For this
  cheaper smoke test, the commands and A40 guidance in **this handoff** supersede that recommendation.
- `requirements.txt` installs current Diffusers from Git because these pipeline classes may not be
  present in an older release. Preserve the resulting environment/version details with results.
- Re-running the same command is resume-safe and skips completed images. Use `--force` only when an
  intentional replacement is desired.
- Model downloads can dominate the first bill. Keep `HF_HOME` on `/workspace` during the pod's life,
  but remove any paid persistent volume after results are safely downloaded.

## Load list

- `handoffs/2026-08-04-fyt-open-model-gpu-bakeoff.md` — this active resume state; delete on pickup.
- `handoffs/README.md` — lifecycle and ops-branch coordination rules.
- `orgs/faceless-youtube/CLAUDE.md` — project router and production boundary.
- `orgs/faceless-youtube/knowledge/operating-law.md` — spend gate, smallest-slice test, and file rules.
- `orgs/faceless-youtube/channels/the-second-take/dna.md` — locked channel look and quality bar.
- External bundle source (read-only):
  `C:\Users\danie\faceless-youtube-channel-forge\channels\the-second-take\visual-kit\experiments\open-model-bakeoff\second-take-open-model-bakeoff.zip`
- External execution root to create on pickup:
  `C:\Users\danie\second-take-open-model-bakeoff`
- Model pages: `https://huggingface.co/Qwen/Qwen-Image-Edit-2511` and
  `https://huggingface.co/black-forest-labs/FLUX.2-klein-4B`.
- RunPod pod console: `https://www.runpod.io/console/pods`.
