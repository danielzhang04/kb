# Local SDXL tokenizer-cache readiness

## What the local trainer requires

The pinned `sd-scripts` checkout loads two `CLIPTokenizer` instances in
`library/sdxl_train_util.py:147-170`:

| Trainer identifier | Existing Hugging Face snapshot |
| --- | --- |
| `openai/clip-vit-large-patch14` | `C:\Users\danie\.cache\huggingface\hub\models--openai--clip-vit-large-patch14\snapshots\32bd64288804d66eefd0ccbe215aa642df71cc41` |
| `laion/CLIP-ViT-bigG-14-laion2B-39B-b160k` | `C:\Users\danie\.cache\huggingface\hub\models--laion--CLIP-ViT-bigG-14-laion2B-39B-b160k\snapshots\743c27bd53dfe508a0ade0f50698f99b39d03bec` |

Those snapshot entries are symlinks. This inventory resolved each entry to a
regular local blob and hashed that blob; it did not load either tokenizer,
model, or CUDA runtime. Both snapshots presently contain these five tokenizer
assets:

| File | `openai/clip-vit-large-patch14` bytes / SHA-256 | `laion/CLIP-ViT-bigG-14-laion2B-39B-b160k` bytes / SHA-256 |
| --- | --- | --- |
| `merges.txt` | 524,619 / `9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a` | 524,619 / `9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a` |
| `special_tokens_map.json` | 389 / `f8c0d6c39aee3f8431078ef6646567b0aba7f2246e9c54b8b99d55c22b707cbf` | 389 / `f8c0d6c39aee3f8431078ef6646567b0aba7f2246e9c54b8b99d55c22b707cbf` |
| `tokenizer.json` | 2,224,003 / `a83e0809aa4c3af7208b2df632a7a69668c6d48775b3c3fe4e1b1199d1f8b8f4` | 2,224,041 / `b556ac8c99757ffb677208af34bc8c6721572114111a6e0aaf5fa69ff0b8d842` |
| `tokenizer_config.json` | 905 / `deef455e52fa5e8151e339add0582e4235f066009601360999d3a9cda83b1129` | 904 / `e19f34ef773563fb695f96cfcae1e4c7b112ab6ad532f6962061df5242d924f0` |
| `vocab.json` | 961,143 / `3f0c4f7d2086b61b38487075278ea9ed04edb53a03cbb045b86c27190fa8fb69` | 862,328 / `5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363` |

The current fit-probe TOML does not set `tokenizer_cache_dir`. Without an
explicit directory, `CLIPTokenizer.from_pretrained(original_path)` follows the
Transformers/Hugging Face cache resolution path. The entries above therefore
show local availability only; they do not pin that mutable shared cache or
prove an offline GPU fit can resolve it.

## Proposed isolated cache, not yet materialized

A later, separately admitted preparation step can copy the listed regular
files, after rechecking their bytes and hashes, into a fresh Figment-private
directory such as:

```text
_private/figment-local-lora-tokenizers-20260908/
  openai_clip-vit-large-patch14/
    merges.txt
    special_tokens_map.json
    tokenizer.json
    tokenizer_config.json
    vocab.json
  laion_CLIP-ViT-bigG-14-laion2B-39B-b160k/
    merges.txt
    special_tokens_map.json
    tokenizer.json
    tokenizer_config.json
    vocab.json
```

Those directory names are fixed by the trainer's
`original_path.replace("/", "_")` rule. Passing that private parent through
`--tokenizer_cache_dir` makes the two local paths selected before the fallback
to `from_pretrained(original_path)`. The copy must use fresh exclusive outputs,
refuse links or reparse points in the source and destination, preserve this
file manifest, and be read-only after publication. It should not mount or copy
the shared Hugging Face cache as a whole.

The trainer sets the second tokenizer's `pad_token_id` to `0` after loading it.
An explicit local load probe must apply and record that effective setting.

The smallest later runtime check is a separate fixed-venv, CPU-only command
that sets `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, and an isolated
`HF_HOME`, then calls `CLIPTokenizer.from_pretrained` only on the two owned
directories. It must record the exact cache manifest and prove neither CUDA
nor model weights were initialized. This note does not perform that check and
does not establish training readiness.
