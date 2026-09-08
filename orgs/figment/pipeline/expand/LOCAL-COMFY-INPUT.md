# Local Comfy input diagnostic

`local_comfy_input.py` is an offline validator and manifest builder for one local
ComfyUI diagnostic. Its default command only hashes the pinned local files and
prints a static API graph. It does not start ComfyUI, connect to a server, create
an image, export an image, or use credentials.

```powershell
C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe orgs/figment/pipeline/expand/local_comfy_input.py
```

The manifest binds the installed ComfyUI and IP-Adapter commits, RealVisXL,
IP-Adapter Plus-Face, CLIP ViT-H, canonical `g01.jpg`, current persona bytes,
the accepted persona-age helper, rendered prompt, seed, and a single 1024x1024
graph. The prompt keeps the persona’s early-twenties, adult wording and its
black middle-parted hair description. It uses `IPAdapterAdvanced` with the
non-FaceID CLIP-vision route; InsightFace, LoRAs, ControlNets, and other custom
nodes are absent. The 24-step DPM++ 2M/Karras setting is a bounded first
availability smoke, not an exhaustive RealVisXL-quality configuration and not
a fair causal comparison with the Krea work. No output is an approval.

The installed non-FaceID node’s default CLIP path center-crops the reference
before its 224px encoding. Given g01’s dimensions, that may leave roughly a
768x768 original-pixel central region and an observer-mapped face around
39.5x53.0 CLIP pixels. This is a post-baseline hypothesis only: a future,
separately frozen one-factor test could use a deterministic face crop from the
original g01. It does not alter this graph or establish identity quality.

`--conditioning face-crop384` is an explicit later condition. Its plan-only
form binds the crop helper, original g01 hash, and fixed crop method without
writing a crop. Only an admitted `--execute` materializes the retained PNG in
that fresh run’s owned input directory, binds its resulting hash in the
execution manifest, and changes node 2's `LoadImage` filename. Full-frame
conditioning remains the default.

`--prompt-profile simple-portrait-v1` is a separate plan-only text condition.
It keeps `baseline` as the default and binds the profile identifier together
with the rendered persona-derived age, hair, eyes, positive text, and negative
text. It changes only CLIP text nodes 6 and 7; the profile does not materialize
media, alter conditioning, or make an output eligible for training.

`--execute` exists only for a separately reviewed local admission. It requires a
fresh direct child of the workspace private root, binds 127.0.0.1:8190, uses
isolated input/output/temp/user/home/cache directories, permits only the
installed IP-Adapter plugin, creates one pre-POST dispatch marker, submits one
graph, and stops only its own verified process. The receipt is written only
after that teardown. It is not run by this builder's tests or default command.
If Windows denies inspection of a discovered descendant, the run fails and its
journal records that unresolved PID; it does not claim the unknown process was
stopped or create a completed receipt.

The first admitted startup reached ComfyUI import and exited before listener
readiness because TorchInductor had no cache path under the isolated environment.
The launcher now supplies an owned `TORCHINDUCTOR_CACHE_DIR`. The bounded v2
`torch._dynamo` import probe passed without starting a server; its receipt is
under `_private/figment-local-comfy-importprobe-20260908-v2/`.

A later admitted startup reached ComfyUI's `Starting server` message and was
stopped before any graph POST. It exposed the venv redirector child and a shared
installation SQLite database path. The accepted ownership/database revision then
completed the V3 baseline with verified owned teardown and one local image. Its
independent visual review rejected that image as a training input for reference
drift, extra portrait faces in the background, and wardrobe/composition drift;
the completion does not establish identity quality.

The later face-crop condition produced one local file but its launcher journal
failed closed because teardown could not verify the venv redirector wrapper.
The preserved recovery observation recorded all three tracked PIDs absent and
no listener; it is not a completed receipt, does not make the image eligible for
training, and was not retried.
