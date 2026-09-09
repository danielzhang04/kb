# Codex judge transport protocol - 2026-09-09

This is a reviewable, one-shot transport protocol for the standalone diagnostic backend. It does not change a Figment gate, calibration, approval, training result, or model selection. No smoke invocation has run while this document was prepared.

## Fixed transport

The backend now adds these explicit Codex `-c` settings to every argv after the existing low-reasoning setting:

```text
-c project_doc_max_bytes=0
-c features.shell_tool=false
-c web_search="disabled"
```

They supplement `--ephemeral`, `--ignore-user-config`, `--sandbox read-only`, and `--skip-git-repo-check`. The [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) defines `project_doc_max_bytes`, `features.shell_tool`, and the top-level `web_search` setting. This only narrows project instruction reading, the default shell tool, and web search. The runner still must be treated as diagnostic infrastructure, never a gate.

The first standalone increment remains recorded at commit `628b59fb9825da45d30ea85c0404036feb4f2297`; its independently reviewed module hash was `99467813473ecc99cad001fa5c7a798b9100cbd1a0a3b109a112ea63138ec49a`. This transport patch intentionally changes the module hash and requires its own review.

## Proposed single smoke

`C:\Users\danie\kb\_private\run-figment-codex-judge-smoke-20260909-v1.py` is a one-shot helper for root to run only after review. It pins the final backend hash, the explicit vendor `codex.exe`, `gpt-5.6-terra`, low reasoning, and a 120-second timeout. It compares the exact g01 source to itself once:

```text
g01 SHA-256 e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed
```

The helper creates a fresh exclusive `.lock` before validation, then refuses either an existing lock or result, source-hash drift, module-hash drift, a non-native executable, or a temporary work root beneath `C:\Users\danie\kb`. A failed attempt remains locked rather than retrying. The backend creates one fresh runner-owned directory under the same-user system temporary directory and removes it after the call. Its only diagnostic result is `C:\Users\danie\kb\_private\figment-codex-judge-smoke-20260909-v1.json`, written exclusively after the single call finishes.

The record contains the fixed source digest/byte count, backend hash, requested model, protocol-safe argv provenance, and diagnostic payload or unavailable reason. It intentionally has no raw local paths, credentials, cost, response-model claim, quality conclusion, or gate decision. A schema-valid payload is still only a self-comparison smoke result.

## Review conditions

Before running, review the final source, test, helper, and document hashes; verify the helper still has one invocation and a 120-second limit. Do not add retries or run it inside the kb tree. A later integration would need its own review of model output, image-text prompt-injection limits, tool/web restrictions, and calibration evidence. The smoke cannot transfer Sonnet thresholds or make a production-quality claim.