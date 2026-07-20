#!/usr/bin/env python3
"""Flatten chains.json into per-chain ordered batch files.

`forge.py gen --batch` takes a LIST; chains.json is a dict keyed by chain head. Each
chain's follow-on gens are delta-chained off their predecessor and so MUST run in the
listed order — one file per chain keeps that ordering inside a single sequential
forge invocation, while letting separate chains run concurrently.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
chains = json.load(open(os.path.join(HERE, "chains.json"), encoding="utf-8"))
for head, reqs in chains.items():
    out = os.path.join(HERE, f"w1-chain-{head}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(reqs, f, indent=1)
    print(f"w1-chain-{head}.json  {len(reqs)} gen(s): {[r['name'] for r in reqs]}")
