# Qwen 2511 component license evidence — 2026-09-09

This is a bounded source inventory for the exact public components pinned by
`prepare_qwen_reference.py`. It records what each publisher says at the pinned
repository revision. It is not legal advice, production clearance, or evidence about
training-data rights, input-image rights, generated-output ownership, publicity
rights, or whether a downstream fine-tune is a derivative work.

| Pinned component | Exact primary evidence | Verified statement | Remaining gap |
| --- | --- | --- | --- |
| Qwen-Image-Edit-2511 FP8-mixed UNET, `Comfy-Org/Qwen-Image-Edit_ComfyUI`, revision `4c7c4ea236326cbae56d403d22a03c6cd86ad9a0` | [Pinned repository tree](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/tree/4c7c4ea236326cbae56d403d22a03c6cd86ad9a0), [pinned `README.md`](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/blob/4c7c4ea236326cbae56d403d22a03c6cd86ad9a0/README.md), and the unversioned upstream [Qwen-Image-Edit-2511 card](https://huggingface.co/Qwen/Qwen-Image-Edit-2511/blob/main/README.md) | The pinned repackage card metadata says `apache-2.0`; the upstream 2511 card says Qwen-Image is Apache 2.0. The exact weight remains bound by the manifest SHA-256 `c9fdc158e46d3b61ef75f21ae866ca2fe808bf4a53643120d1c1e87c19280a4e`. | The pinned repackage tree exposes no standalone `LICENSE` or provenance statement tying this FP8 conversion byte-for-byte to a particular upstream revision. The upstream card is supporting evidence at an unpinned `main`, not an immutable manifest input. Quantization authorship and byte-level provenance remain unverified. |
| Qwen 2.5 VL 7B FP8-scaled encoder, `Comfy-Org/Qwen-Image_ComfyUI`, revision `25608066f9bf5cdc28020836ce9549587053f346` | [Pinned repository tree](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/tree/25608066f9bf5cdc28020836ce9549587053f346), [pinned `README.md`](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/blob/25608066f9bf5cdc28020836ce9549587053f346/README.md), and the official [Qwen2.5-VL-7B-Instruct card](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct/blob/cc594898137f460bfe9f0759e9844b3ce807cfb5/README.md) | Both the pinned repackage metadata and the immutable upstream card revision identify `apache-2.0`. The manifest binds the FP8 file by SHA-256 `cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4`. | Neither pinned tree shows a standalone license-text file for this repackaged FP8 file, and the repackage card does not name the exact upstream conversion source. Metadata alignment does not prove provenance or resolve derivative-model obligations. |
| Qwen Image VAE, `Comfy-Org/Qwen-Image_ComfyUI`, revision `dfe60a0d63f0b946628080f070978594983b8b6e` | [Pinned repository tree](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/tree/dfe60a0d63f0b946628080f070978594983b8b6e), [pinned `README.md`](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/blob/dfe60a0d63f0b946628080f070978594983b8b6e/README.md), and upstream Qwen-Image [`LICENSE`](https://huggingface.co/Qwen/Qwen-Image/blob/a861db9cde8d041a350d4a9ba9fe0718aa966e6d/LICENSE) | The pinned repackage is labeled `apache-2.0`; the immutable upstream license path contains the Apache License 2.0 text. The manifest binds the VAE by SHA-256 `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f`. | The repackage does not state an exact upstream source revision or include its own standalone license text at the pin. Byte-level provenance from the upstream VAE to the packaged file remains unverified. |

## Native runtime and workflow source

The candidate pins native ComfyUI commit
`95d755cd8107a72258d452b5d3657273d571f07d`. Its exact license-text path is
[`LICENSE` at that commit](https://github.com/Comfy-Org/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/LICENSE).
Root read that exact Git object from the known local ComfyUI clone: it has the GNU GPL
version 3 header, is 35,149 bytes, and has SHA-256
`3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`.
This verifies GPL-3.0 at the runtime pin even though the bounded browser could not
retrieve the commit-specific page. The official workflow source is separately pinned at
`a861fcde234d5cda3095087c509858fb001a6093`; its exact
[`LICENSE`](https://github.com/Comfy-Org/workflow_templates/blob/a861fcde234d5cda3095087c509858fb001a6093/LICENSE)
is MIT.

This audit does not crawl ComfyUI's Python packages, container-image contents, CUDA
stack, or transitive dependencies. Those components retain their own terms. Running
Apache-labeled weights through GPL runtime code does not by itself establish rights in
inputs, outputs, a trained adapter, or a production dataset. The candidate therefore
remains research-only and `commercial_use_cleared: false`; the exact RunPod/reference
action also remains blocked by account approval.
