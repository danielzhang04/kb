#!/usr/bin/env python3
"""Resolve a proxy-me facet manifest to absolute, existence-checked paths.

Reads knowledge/proxy-me/facets.md, substitutes <ch> with the channel, and returns
the taste-pack file paths for a facet (plus the raw `gates` string). Raises loudly
on an unknown facet or a missing pack file.

Run: python resolve_manifest.py <facet> <channel>
"""
import sys
import pathlib


def _load_facets(repo_root: pathlib.Path) -> dict:
    text = (repo_root / "knowledge/proxy-me/facets.md").read_text(encoding="utf-8")
    facets = {}
    cur = None
    for line in text.splitlines():
        if line.startswith("## "):
            cur = line[3:].strip()
            facets[cur] = {}
        elif cur is not None and ":" in line and not line.startswith("#"):
            key, val = line.split(":", 1)
            facets[cur][key.strip()] = val.strip()
    return facets


def resolve(facet: str, channel: str, repo_root: pathlib.Path) -> dict:
    facets = _load_facets(repo_root)
    if facet not in facets:
        raise KeyError(f"unknown facet {facet!r}; have {sorted(facets)}")
    spec = facets[facet]
    out = {}
    missing = []
    for key, val in spec.items():
        if key == "gates":
            out["gates"] = val
            continue
        p = repo_root / val.replace("<ch>", channel)
        out[key] = p
        if not p.exists():
            missing.append(str(p))
    if missing:
        raise FileNotFoundError(
            "missing taste-pack files for facet "
            f"{facet!r} / channel {channel!r}:\n  " + "\n  ".join(missing)
        )
    return out


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python resolve_manifest.py <facet> <channel>")
        sys.exit(2)
    root = pathlib.Path(__file__).resolve().parents[4]
    try:
        resolved = resolve(sys.argv[1], sys.argv[2], root)
    except (KeyError, FileNotFoundError) as exc:
        print("ERROR:", exc)
        sys.exit(1)
    for key, val in resolved.items():
        print(f"{key}: {val}")
