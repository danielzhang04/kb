# Video resolution profile independent review — 2026-09-09

**Verdict: READY for later manifest preparation.** This review covers a local
compiler change only. It does not establish a rendered clip, temporal quality,
identity consistency, or production acceptance.

## Reviewed snapshot

- `orgs/figment/pipeline/video/video_manifest.py` —
  `303fbf63b9bb95ff09de3a262f220aee10d977c6c646c362964041d9e0bffb7c`
- `orgs/figment/pipeline/video/tests/test_video_manifest.py` —
  `cd3b627148f5fa13b7aa9e81afdd69721f80e6c21184c1a438be1f74c909275e`
- `orgs/figment/pipeline/video/APPROVED_GEN_ADAPTER.md` —
  `e4eefb534189736f46e2362c460b19a91c569a0051ade15f33f350fa74e0dd57`
- implementation result note —
  `53f84cecb2aff60c97a07a21aaf1a1dcbb892bf4366d716a43ec6e1537300dd5`

The selector defaults only when its argument is `None`; falsey non-string
values are rejected. It allows only `legacy-512x288` and `native-1280x704`.
The diagnostic receipt route retains its legacy default. The approved-gen route
defaults to the native profile and rejects an explicit legacy request before a
manifest is written.

The compiler validates the immutable 512x288 template before changing node 55
width and height. It binds those dimensions in both `resolution_profile` and
`frame_budget`, and hashes the manifest-compiled graph. The review confirmed
that this effective graph digest intentionally precedes the existing harness's
per-job seed and output-prefix substitutions; it is not presented as an
executed-workflow attestation. The profile plus digest prefix separates output
names across resolutions. Existing callers remain compatible because the added
argument is optional.

## Verification considered

- Python 3.13 CLI help passed locally and exposes only the two allowlisted
  profile values.
- The author's focused suite reported 24 passing tests, including the current
  approved-gen lineage join and an 81-output harness dry run with verified
  teardown.
- Root independently ran the frozen full video suite: **48 passed in 17.06
  seconds** on Python 3.13 with a short private temp root.

The 1280x704 setting is a fixed compiler profile. Prior resolution experiments
are historical motivation only; they do not prove that a future still, motion,
or seed is acceptable. Any resulting video manifest remains diagnostic and
`not_promotable: true` pending rendering and temporal review.
