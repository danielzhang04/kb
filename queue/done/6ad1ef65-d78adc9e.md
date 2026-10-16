---
schema-version: 1
id: 6ad1ef65-d78adc9e
project: kb-ops
action: nyu-inputs-review
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: a1c042bc2ece9649
state: done
approval: null
workflow: 01a1440b-b364-7182-9602-3bff7e0455f7
depends-on: []
variant-group: null
role: work
session-id: 6ad1ee81-b485d00e
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Read-only review of NYU installed-version extraction, cleanup metadata only. Allowed inputs under C:/Users/danie/Projects/Filesystem-Cleanup/reports/: nyu-runtime-nextwave-3e45c04aa4984bcda94a787f421931ec.json; home-nyu-environment-inputs-ef743ea3aed44d96bdaf659f7ac76d2c.json; home-nyu-rebuild-inputs.json; home-nyu-data-mgmt-installed-pins.txt SHA2C16212B422F2763329C2E4FFED418838E16198DDC2B876C96F4F8E03C8036DF; home-nyu-software-eng-installed-pins.txt SHA747E02B06403979FBC300A2096A1EC3CA55CCECBB5FFF391C7CAEEE6AF206339; home-nyu-installed-pins-validation.json. No original projects,.env,credentials,private logs,recoverypayload/manifests, broad architecture/placement docs. Native Claude authored3outputs; root machine validation found107/31safe unique pins exactlyequal DIRECT dist-info metadata, excluding2nested vendored data-mgmt entries. Evaluate accurate extraction and honestlimitations, NOT installability/reproducibility approval. Source reports omit direct_url/.pthcontents and some dependencyfields; public versionpin list is not a lockfile. Root NYU rules explicitly use Windows .venv/Scripts/python.exe; do not recommend substituting Linux pins or latestpackages. No execution/writes/network/packageinstall. Return ACCEPT or preciseblocking inaccuracy, no broadframework/redundanttests.

## Result

ACCEPT

The extraction is accurate:

- 107 data-mgmt and 31 software-eng pins exactly match the direct-child `.dist-info` `Name==Version` metadata, including order.
- The two excluded data-mgmt entries are correctly identified as nested/vendored.
- Pin counts, uniqueness, filename/metadata consistency, and supplied SHA-256 hashes match.
- Limitations are honestly stated: dated Windows metadata only, not a lockfile, with no installability, dependency-closure, reproducibility, `direct_url.json`, or `.pth`-content claims.
- Windows `.venv\Scripts\python.exe` remains the explicit target.
