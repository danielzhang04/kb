# W18 plate re-gen log — 2026-08-13

Cap: $0.30. Tier: Forge 1K (nominal $0.039 per provider call).

| Plate | Spec / provider target | Result | Staged W18 candidate | Nominal spend |
| --- | --- | --- | --- | --- |
| L198 | `w18-L198.spec.json` / `L198` | first call OK (46.2s) | `_staging/L198-w18.png` | $0.039 |
| L65 | `w18-L65.spec.json` / `L65-w18` | first call OK (114.2s) | `_staging/L65-w18.png` | $0.039 |
| L84 | `w18-L84.spec.json` / `L84` | first live attempt skipped because `_staging/L84.png` existed ($0); forced first call OK (46.9s) | `_staging/L84-w18.png` | $0.039 |
| L86 | `w18-L86.spec.json` / `L86` | forced first call OK (48.9s) | `_staging/L86-w18.png` | $0.039 |

Total: 4 provider calls, nominal $0.156. No stall (4-minute threshold), 503, or 429. No re-issue.

All four specs were rebuilt from canonical `shots.json` after the PLATE COMPOSITION law and L86 payload splice. L65 alone uses the sanctioned one-span `forge-retry-overlay@2` replacement to retain W11's flat-floor clause. No promotion, review stamp, or scene-manifest mutation was performed.
