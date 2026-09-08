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
installation SQLite database path; the next launcher revision records the exact
owned process tree and passes an owned private `--database-url`. It is pending
fresh review and has not produced a diagnostic image.
