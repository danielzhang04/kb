# Current native offline join acceptance - September 12

Root accepts one fresh local compiler-to-harness dry run. The current nonpersona preparation and compiler produced a three-job base-model manifest, the original revalidator accepted it before and after execution, and the real harness completed only after the verifier appended `--dry-run`. This is infrastructure evidence; no model ran and no real image or paid pod was produced.

## Review and execution

The initial verifier discarded captured output after hashing it. Root and an independent reviewer required raw byte preservation before execution. The author preserved the original script, added exclusive binary stdout/stderr files and timeout/process evidence, and obtained an independent READY verdict. Root read the original and complete repair diff before authorizing one invocation.

- Verifier SHA-256: `56d6fc4397cc388fbbc2834e8e4578077d1602060c001e3fb7caba11e50097ef`.
- Exact interpreter: `C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe`, invoked with `-B` and no user site.
- Execution: September 12, 07:32:32.700 to 07:32:34.353 UTC; outer native exit 0.
- Harness: exit 0, no timeout, 0.383817 seconds; three seeds `1595`, `481516234`, `90210`.
- Manifest uses `comfyui.start_command: python main.py`, native dimensions 1448 by 2176, base graph without LoRA, and no upload/training/artifact sections.
- Three synthetic output placeholders are each 36 bytes. They are not rendered PNG evidence despite their filenames.
- The dry receipt has `dry_run: true` and synthetic pod ID `dry-run-pod`. The sole synthetic ledger is under the owned run output; the compiler-supplied ledger remains empty.

Root independently rehashed all 16 emitted source bindings, four named source files, the verifier and interpreter, retained harness streams, compilation record, compiled manifest, planned-run descriptor, dry receipt, output manifest, synthetic outputs and synthetic ledger. Counts overlap and describe a finite checked set, not a full dependency closure. The canonical-reference fixture bytes were copied locally by the existing test helper; no reference or model was exported or visually inspected for this check.

## Evidence and limits

Evidence directory: `MAIN/_private/figment-native-current-offline-20260912-v1`. MAIN is `C:/Users/danie/kb`.

- `result.json`: SHA-256 `2acb39fab91d2524146976c72bb192bf53461a3c3accd797d4c0705232482aaa`.
- `EXECUTION-RECEIPT.md`: SHA-256 `e5367cb9e12244653c92c914bd8187582d5dbc9867ac3e6f3551f6b2a6ca789f`.
- Raw harness stderr: 1,922 bytes, SHA-256 `728a5ba28bbea791643ea698b6187f15ec7be293acd2d24c3cfe384a0439d731`; stdout is empty. Both are retained byte-for-byte.

There was one execution and no retry. Timeout, nonzero exit and evidence-write failures were reviewed statically, not dynamically exercised by this successful run. The no-provider/network conclusion follows from the reviewed dry-run implementation, stripped child environment and synthetic receipt; it is not an operating-system packet capture. Historical artifacts were not rewritten or revalidated by this fresh fixture. No current live pilot, creator quality, UI rendering, deployment, publication or paid admission is established. The broader [plan](2026-09-12-overall-plan-review.md) remains open.
