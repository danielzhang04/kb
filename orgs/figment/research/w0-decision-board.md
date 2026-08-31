# W0 decision board — bake-off plan + stack recommendation

Synthesized 2026-08-31 from r1–r4. GATE: Daniel picks stacks + approves spend.

## Compute reality (verified this session)

- kb VM (`kb` on tailnet, ssh as root): **no NVIDIA GPU** — not usable for generation/training.
- Local machine: RTX 4070 Laptop, **8 GB VRAM** — quantized SDXL inference OK; Flux LoRA
  training and Wan i2v impractical-to-slow.
- Conclusion: open-source track runs on rented 24 GB pods (RunPod-class, ~$0.35–0.69/hr),
  spun up per wave. No standing GPU cost.

## Stills bake-off (from r1)

| # | Stack | Est. cost | Why in |
|---|-------|-----------|--------|
| 1 | Higgsfield Soul ID (Starter $19/mo) | ~$19–25 | Best SaaS realism reputation + real API; open question = its filter flags swimwear as false-positive — $19 resolves the biggest SaaS risk first |
| 2 | Glambase ($15–30) | ~$15–30 | Only SaaS whose ToS explicitly permits the register; no API (manual UI); mixed trust signals |
| 3 | ComfyUI + SDXL/Juggernaut-or-Flux + char LoRA (ostris/kohya) on rented 4090 | ~$1–3 compute + setup hours | Highest ceiling, no external filter, fully automatable; Flux commercial use needs a paid BFL license — SDXL/Juggernaut is the license-clean default |

Dropped: Eromify (Trustpilot 2.2/5, "images look very AI-generated", no real maturity signal).
License landmines to avoid in any commercial path: InstantID + IP-Adapter FaceID (InsightFace
non-commercial encumbrance), stale upstreams.

## Video bake-off (from r2)

Same protocol all candidates: 4 outputs each — 5s 9:16 held-pose/slow-pan + 5s simple
motion, 2 takes each, same reference still/seed/prompt; reject on identity change, hand
warp, gloss skin, non-causal fabric/hair; record failures, no re-prompting.

| # | Candidate | Est. cost | Note |
|---|-----------|-----------|------|
| 1 | Kling (multi-image ref) | $1.12–1.96 | Only candidate with multi-image identity conditioning |
| 2 | Runway Gen-4 Turbo | $1.00 | Cheap, 9:16 native; lingerie explicitly limited by policy — test resolves |
| 3 | Wan 2.2 TI2V-5B (rented pod) | $0.69–1.38 | Open-weight path, no hosted filter; slow on small VRAM |

Fallback if all fail QC: Veo 3.1 Ingredients ($4.80–12.80) and Luma Ray 3.2 ($1.20), same protocol.

## Posting + metrics (from r3) — no bake-off needed, architecture pick

- **Publish:** direct Meta Graph API (professional account, operator OAuth): JIT media
  containers, video status polling, live `content_publishing_limit` check, idempotent queue,
  manual-approval gate. Reels/carousels/photos supported; stories limited — operator
  notification fallback.
- **Metrics:** daily `/insights` pulls (account + media) into a first-party store; story
  capture before 24h expiry; PLAYS/LIKES kept metric-labeled.
- **Attribution:** Short.io custom domain, one slug per persona-door, UTM; join clicks to
  media id/batch/persona in our store, not the shortener's.
- **Scheduler UI:** none for v1; Postiz (AGPL — review before embedding) only if a calendar
  workflow proves needed. TikTok Content Posting API = later connector, not now.
- Unofficial private-API clients: NOT RECOMMENDED, documented as a Daniel-level risk
  exception only.

## Spend ask (this gate)

~$35–58 SaaS (Higgsfield + Glambase) + ~$2–5 rented GPU hours + ~$3–6 video API credits
≈ **$40–70 total** for the full stills+video bake-off. Order: Higgsfield first (cheapest
kill-shot on the SaaS-policy question), open-source pod second, Glambase last (manual labor).

## Operator context (from r4)

Recurring proven pattern matches our design: SD/Flux + LoRA-or-faceswap consistency,
separate video step, IG/TikTok as free funnel, Fanvue as paid terminal with a real
disclosed-AI creator program (bio disclosure + no-real-person-claims — mirror this copy).
Realistic solo economics: $500–2K/mo months 4–6, $2–10K/mo months 6–12 at 200–500 subs
(Fanvue self-published; directional). Roster model (The Clueless: 3 personas, one pipeline)
validates multi-ready schema. Follow-up lead: BlackHatWorld thread 1604877 (fetch-blocked).
