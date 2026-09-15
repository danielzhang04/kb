# figment run roots

`pipeline --out` defaults to `orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/`. That
directory holds the `--stage all` plan plus `downstream/gen`, `downstream/detail`,
`downstream/video` and `deliverable/`.

Run roots live INSIDE the repo because the `video` stage compiles its manifest with
`video_manifest.build_manifest(root=<repo root>, mode=review-candidate-v1, ...)`, whose
containment requires one common root holding the plan, the in-repo `persona.yaml`, the
approved still and the output. Everything but this README is gitignored.
