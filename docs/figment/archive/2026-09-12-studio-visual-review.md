# Studio visual acceptance - 2026-09-12

Root independently inspected two saved Chrome/CDP screenshots of the current Figment workspace at a 1440 x 1200 desktop viewport. Text, controls and limitations were readable, with no observed overlap or clipping in either captured state.

The first state has no run record but one configured synthetic review claim; it is not an empty claim inventory. The second follows explicit clicks on Runs & review and Check recorded review and shows a synthetic reported-pass result. This accepts those two rendered states only. It does not establish a live backend, authentication, real media playback, creator quality, mobile coverage or a complete operator journey.

Evidence lives under `C:/Users/danie/kb/_private/`:

- `figment-studio-visual-cdp2-empty-20260912.png`: 35,193 bytes, SHA-256 `9761654b7be53c3b3243360345e08b9dd8c1cdb0867256469ef5adc824a36cd5`.
- `figment-studio-visual-cdp2-result-20260912.png`: 61,901 bytes, SHA-256 `3ecae3103f9657c49fedcce76c2eee200bd7a6f7c22b94373ade95ba959d6b4d`.
- `figment-studio-visual-cdp2-receipt-20260912.md`: SHA-256 `a2e792f07c659c1cbf8dbc9194516aa4075f75c21e58e6b5329c44a52cdc5584`, with driver/status/log hashes and execution limits.

The preview used one workspace per page, existing styles, a strict synthetic fetch allowlist, a loopback Vite server without a proxy and a fresh task-only browser profile. The CDP driver exited 0. Browser sandboxing remained enabled. Launchers were intentionally force-stopped after capture; no normal launcher exit status is claimed. Owned launchers were absent and ports 64913/9237 closed on recheck. The exact two temporary preview files were removed after containment checks; private evidence and profile remain.

Earlier default-sandbox browser launches failed with access-denied GPU-child exits before page control. The first elevated launch reached CDP but ended before automation; that was unfinished work, not demonstrated CDP failure. Preparing the driver before resuming the authorized elevated launch produced the accepted captures. No product source or configuration changed for this check.
