# R8 — Hetzner as a GPU compute host (project figment)

Scope: can a Hetzner dedicated GPU server serve lane 1 (ordinary photoreal gen + LoRA training) and/or lane 2 (lawful, disclosed-AI adult personas), and how does renting from Hetzner compare to buying a consumer GPU outright. Primary sources used wherever Hetzner publishes the fact directly; secondary sources (price-tracker sites) flagged where Hetzner's own pages are JS-rendered and didn't yield a number directly.

## 1. GPU products Hetzner sells today

Hetzner has **no cloud GPU product currently on general sale** — the `hetzner.com/cloud/gpu/` marketing page exists but only links out to the dedicated GPU line; there is no GPU cloud-instance type in the Hetzner Cloud console today. [Hetzner Cloud GPU](https://www.hetzner.com/cloud/gpu/) All real GPU compute at Hetzner is **dedicated (rented physical) servers**, ordered through Robot, on the "GEX" line.

Current catalog, per Hetzner's own June-2026 price list (effective 2026-06-15, last updated 2026-07-08 — this is the live price as of today, 2026-08-31): [Price adjustment doc](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), cross-checked against the live product pages [GEX44](https://www.hetzner.com/dedicated-rootserver/gex44/), [GEX131](https://www.hetzner.com/dedicated-rootserver/gex131/), and [GPU server line docs](https://docs.hetzner.com/robot/dedicated-server/server-lines/gpu-server/).

| Model | GPU | VRAM | CPU | RAM | Storage | Monthly (EUR, ex. VAT) | Setup fee (EUR) |
|---|---|---|---|---|---|---|---|
| **GEX44-1** | RTX 4000 SFF Ada | 20 GB GDDR6 ECC | Intel Core i5-13500 (6P+8E) | 64 GB DDR4 | 2×1.92 TB NVMe | **€232.30** | **€114.00** |
| **GEX131-1** | RTX PRO 6000 Blackwell Max-Q | 96 GB GDDR7 ECC | Intel Xeon Gold 5412U | 256 GB DDR5 ECC reg. | 2×960 GB NVMe | **€1,197.30** | **€599.00** |
| **GEX131-2** | RTX PRO 6000 Blackwell Max-Q | 96 GB GDDR7 ECC | Intel Xeon Gold 5412U | 512 GB DDR5 ECC reg. | 2×1.92 TB NVMe | **€1,797.30** | **€899.00** |
| **GEX131-3** | RTX PRO 6000 Blackwell Max-Q | 96 GB GDDR7 ECC | Intel Xeon Gold 5412U | 768 GB DDR5 ECC reg. | 4×3.84 TB NVMe | **€2,297.30** | **€1,149.00** |

Notes:
- **GEX130** (RTX 6000 Ada, 48 GB, ~€838/mo) — Hetzner's previous mid-tier card — no longer appears in the current official price list and is reported as discontinued/replaced by GEX131. [Hetzner GEX130 press note](https://www.hetzner.com/news/gpu-server-gex130/) (historical), third-party confirmation of discontinuation via [gpuhosted.com review](https://gpuhosted.com/en/hetzner-gpu-review/).
- Locations: GEX44 in Falkenstein (FSN1) only; GEX131 in Falkenstein and Nuremberg per docs (one third-party source says Helsinki instead of Nuremberg — datacenter assignment should be re-verified in the Robot ordering flow, it may vary by config).
- Contract terms, confirmed directly from the GEX44 and GEX131 product pages: **"No minimum contract term"**, **"Cancellation period: immediately."** There is also an hourly billing toggle shown on the product pages ("per month" / "per hour"), but Hetzner's own price-adjustment doc only tabulates monthly + setup-fee figures for dedicated servers — I could not pull an authoritative hourly € figure from Hetzner directly (the page is JS-rendered and the number isn't in server-side HTML). Third-party trackers estimate hourly at roughly monthly÷730 plus a premium (~€1.92/h quoted for GEX131-1, ~€0.38/h for GEX44 by [gpuhosted.com](https://gpuhosted.com/en/hetzner-gpu-review/)) — **treat this as an estimate, not a quote**, and confirm the real hourly rate in the Robot configurator before relying on it.
- **You cannot install additional GPUs** in these chassis — no multi-GPU configs, no A100/H100 options. [GPU server line docs](https://docs.hetzner.com/robot/dedicated-server/server-lines/gpu-server/)
- **Availability is genuinely unstable.** Hetzner's own infrastructure-status history shows a company-wide "limited availability of cloud instances" incident starting 2026-04-28 driven by hardware shortages, and third-party stock trackers ([Server Radar](https://radar.iodev.org/)) show dedicated-server and cloud stock frequently sold out by datacenter. At least one snapshot (July 2026, secondary source) reported GEX44 as unavailable while GEX131 was orderable. **Check live stock in the Robot ordering flow at time of purchase — do not assume either model is in stock.**

## 2. Server Auction (Serverbörse)

Checked [hetzner.com/sb/](https://www.hetzner.com/sb/) directly: **no GPU-equipped machines were listed at the time of this check.** The auction sells only previous customers' cancelled hardware, tested and wiped before relisting; GPU cards do occasionally appear (the community docs mention an IPv4/GPU filter existing in the auction UI, implying GPU auction listings happen from time to time) but none were live in this check. Auction terms generally: **no setup fee**, price starts fixed per configuration and drops at randomized intervals until bought (no real "bidding"), and once sold a specific unit is gone — the same config may reappear unpredictably. [Hetzner blog on auction mechanics](https://www.hetzner.com/blog/refurbished-servers-how-the-hetzner-server-auction-works/) Because there's currently no GPU stock there, the auction is not presently a usable path for this project — worth a recheck periodically, not a planning assumption.

## 3. Terms of Service — the decisive question

Primary source: Hetzner's General Terms and Conditions (English), current version, [hetzner.com/legal/terms-and-conditions/](https://www.hetzner.com/legal/terms-and-conditions/), cross-checked against the downloadable AGB PDF and the German docs mirror. Relevant clauses, quoted:

**Clause 8.1** — general legal-compliance duty: "The Customer is obligated to check and comply with the legal provisions arising from the use of the contractually agreed services..." (covers Telecommunications Act / Telemedia Act compliance per the German version). This is a blanket "you must follow the law" clause — it does not itself name adult content.

**Clause 8.2** — the actual content restriction, and the key wording: **"The Customer is obligated not to *publish* any content that infringes on the rights of third parties or otherwise violates applicable law. This includes in particular, but is not limited to, pornographic or obscene material... material that could seriously endanger the morals of children or young people..."**

**Clause 8.3** — spam and, separately, cryptocurrency mining are explicitly and independently banned ("the operation of applications for mining cryptocurrencies remains prohibited").

**Clause 8.4** — DSA-driven notice-and-action: "If we become aware of illegal activities [we are] obligated under Art. 6 Abs. 1 DSA... to request that the customer immediately remove the offending content," with a deadline; after non-response Hetzner may **"lock the customer's IP address via which the relevant content is accessible."**

**Clause 2.7** — termination without notice for good cause, including violation of 8.1–8.3.

**Jurisdiction (14.1–14.2 / equivalent US-terms clause 22):** governed by German law; exclusive venue is Hetzner's registered office, Gunzenhausen, Germany.

**On the hosting-vs-generation distinction the operator asked about:** Hetzner's own wording is genuinely on the operator's side here, and it's load-bearing enough to quote twice. The prohibition in 8.2 is scoped to content the customer **"publishes"** — not content the customer merely stores, processes, or generates on the box. That reading is reinforced by the enforcement mechanism in 8.4 and the System Policies page: Hetzner acts on **abuse reports of illegal content**, and the described remedy is to **"lock the customer's IP address via which the relevant content is accessible"** — i.e., the mechanism targets content a third party could reach (a public web/FTP/whatever service on the server), not files sitting in a private directory with no exposed service. Hetzner does not run content scanners against a customer's disk; there is no clause anywhere in the T&C, System Policies, or DSA page giving Hetzner a right to inspect private files absent an abuse report. [System Policies](https://www.hetzner.com/legal/system-policies/), [Digital Services Act page](https://www.hetzner.com/legal/digital-services-act/)

**Where this stays ambiguous, stated plainly:** Hetzner's terms do not contain an explicit sentence saying "generating and privately storing adult content for your own non-public use is permitted." The "publish" wording supports that reading, but it is an inference from clause language and enforcement mechanics, not a direct guarantee. Two things follow from that gap:
- If the operator's workflow at any point exposes the content publicly from the box itself (a web UI reachable from the internet, an unauthenticated file share, a public S3-compatible bucket on the same server) that is "publishing" under 8.2 and squarely inside the pornographic-content ban regardless of the personas being fictional/disclosed-AI.
- Even for pure private generate-and-download-off-box use, Hetzner has broad "good cause" termination language (2.7) and a subjective abuse-report trigger (8.4) — a false or hostile abuse report referencing adult content, even about private use, could still get the account locked while Hetzner sorts it out, since the T&C gives Hetzner discretion to lock first and ask questions during the DSA notice period.

I found **no separate published Acceptable Use Policy document** beyond the System Policies overview page and the T&C itself — the System Policies page is a thin index pointing back to the same clauses, plus product-specific notes (no crypto-mining, no scanning other networks, don't compromise third-party server integrity). [System Policies](https://www.hetzner.com/legal/system-policies/)

**On German/EU youth-protection law specifically:** I could **not find any explicit reference to the JMStV (Jugendmedienschutz-Staatsvertrag) or JuSchG by name** in Hetzner's T&C, System Policies, or DSA page — the T&C's "morals of children or young people" language tracks the substance of German youth-protection law without citing the statute. Given German jurisdiction is contractually fixed (Gunzenhausen), German youth-protection statutes and the EU DSA apply to Hetzner's own obligations as a hosting provider regardless of whether Hetzner's T&C cites them by name — this is a background legal fact, not something dependent on Hetzner's wording.

**What should be confirmed in writing with Hetzner before relying on any of this** (do not guess past this point):
1. Explicit confirmation that AI-generated adult content, wholly fictional personas, disclosed as AI, generated and stored/processed on the server with no public-facing exposure, does not itself violate 8.2's "publish" scoping.
2. Whether Hetzner treats a password-gated or authenticated-only web service (not indexable, not publicly linked) as "published" for 8.2 purposes, if the plan ever needs any remote UI on the box.
3. Whether abuse.hetzner.com treats an anonymous/bad-faith report naming "adult content" as sufficient to trigger a lock-first response, or whether Hetzner requires the reported content to actually be reachable before acting.

## 4. Rent vs. buy — a consumer GPU

Comparator: a 16–24 GB consumer card (e.g. RTX 4080/4090-class, used market or new), one-time **$1,200–2,500** ≈ **€1,110–2,315** at ~€0.926/$1 (approximate; use live rate).

- **GEX44** (20 GB, €232.30/mo + €114 setup): break-even vs. a $1,200 (~€1,110) card ≈ **4.6 months**; vs. a $2,500 (~€2,315) card ≈ **9.5 months**. Note GEX44's 20 GB VRAM sits below a 24 GB consumer card and its RTX 4000 SFF Ada is a lower-clocked, lower-bandwidth part than a 4090 — cost-per-month is not cost-per-compute-hour equivalent.
- **GEX131-1** (96 GB, €1,197.30/mo + €599 setup): far more VRAM than any consumer card, but at this price a $2,500 outright card pays for itself in **under 2 months** — GEX131 is not a "instead of buying a card" comparison, it's a different tier of hardware (workstation/datacenter class) that no consumer purchase replicates for headroom, but it's expensive to run continuously.
- **Practical differences that don't show up in the monthly number:**
  - *Data residency*: content lives on Hetzner's infrastructure in Germany/Finland, subject to German legal process and Hetzner's own T&C/abuse pipeline — a materially different risk posture than a card in the operator's own machine, especially for lane 2.
  - *Remote access*: rented box is reachable from anywhere without maintaining home networking/VPN; a local card requires the operator's own machine to be up and reachable if remote access is wanted.
  - *Upgradeability*: a purchased card can be resold/replaced at will; Hetzner GEX servers are fixed configs you can't add a second GPU to, and switching models means re-provisioning a new server (though "no minimum term / cancel immediately" makes that cheap to do).
  - *No physical noise/heat/power*: real advantage of renting — a 300W+ card generating heat/noise/power draw in a home is avoided entirely by renting.
  - *Existing CPU vserver*: the operator already has a Hetzner relationship (CPU vServer) — no new vendor onboarding, likely same account/billing, and traffic between the two Hetzner boxes would be low-latency/same-provider, though there's no indication that translates into any pricing advantage.

## 5. Practical fit for the actual workloads

- **(a) SDXL/Flux LoRA training** — comfortably fits **GEX44's 20 GB**: SDXL LoRA training typically needs 12–16 GB with modern trainers (kohya_ss, ai-toolkit) at reasonable batch size/resolution, and Flux LoRA training is heavier but generally trainable in 20–24 GB with gradient checkpointing / low-rank configs. GEX44 is workable; GEX131's 96 GB is comfortable headroom (larger batches, full fine-tunes rather than just LoRA) but is overkill and expensive if LoRA training is the only goal.
- **(b) Batch still generation** — trivial fit on either box; 20 GB comfortably runs SDXL/Flux inference at batch, 96 GB allows large batch sizes / multiple models resident simultaneously.
- **(c) Self-hosted Wan / HunyuanVideo image-to-video** — this is where GEX44's 20 GB gets tight. Community-reported minimums for HunyuanVideo/Wan-class video models run from ~24 GB (heavily quantized, low resolution/short clips) up to 48–80 GB for higher resolution or longer clips at reasonable speed. **GEX44 (20 GB) is marginal-to-insufficient** for video generation beyond short/low-res/quantized runs; **GEX131 (96 GB)** comfortably covers this tier including headroom for larger models or multiple concurrent jobs. If video generation (lane 1 or lane 2) is a real requirement rather than a maybe, GEX131 is the model that actually fits, at ~5x GEX44's monthly cost.

## Recommendation

**Lane 1 (ordinary photoreal image/video gen + LoRA training): yes, Hetzner can serve this.** There's nothing in the T&C that restricts non-adult AI image/video work, and technically GEX44 covers stills/LoRA training while GEX131 is needed if video generation (Wan/HunyuanVideo-class) is in scope. Compared to the current plan of RunPod hourly for lane 1: Hetzner trades RunPod's pay-per-hour elasticity for a flat monthly commitment with **no minimum term and immediate cancellation** — meaning the downside of a "wrong" monthly commitment is capped at roughly one month's fee, not a long lock-in. Whether that's cheaper than RunPod hourly depends entirely on utilization: at low/bursty usage RunPod hourly likely wins; at near-continuous usage GEX44's €232/mo flat rate beats most hourly rental of comparable low-end GPUs, and GEX131 at €1,197+/mo is worth it only if the 96 GB card and continuous availability are actually being used, not idling.

**Lane 2 (lawful adult content, fictional disclosed-AI personas): probably, but not confirmed, and the honest answer is "the terms are ambiguous by omission, not by explicit permission."** Hetzner's ban targets content the customer **publishes** (8.2) and is enforced via a **notice-and-takedown mechanism keyed to public reachability** (8.4: locking "the IP address via which the... content is accessible"). Purely generating and privately storing/processing adult content on a rented box, with nothing publicly exposed from that box, reads as outside the literal scope of what Hetzner's terms prohibit. But Hetzner never says this affirmatively anywhere I found — no clause distinguishes "hosting/publishing" from "generating/storing" in so many words; that's an inference from how 8.2 and 8.4 are worded, not a guarantee. Given lane 2 is legally and reputationally the higher-stakes lane, **this should not be relied on without getting Hetzner's own confirmation in writing** on the three specific points listed in Section 3 before committing lane-2 workloads to a Hetzner box. Compared to the current plan of buying hardware for lane 2: buying remains the lower-ambiguity choice for lane 2 specifically, because it removes any vendor-terms exposure entirely — the trade is a $1,200–2,500 sunk cost against Hetzner's €232–1,197/mo with unresolved fine print. If Hetzner confirms private-generation is fine in writing, GEX44 (LoRA/stills) or GEX131 (if video is needed) become a reasonable, cancel-anytime alternative to owning hardware; until confirmed, treat lane 2 on Hetzner as **not yet cleared**, and keep the buy-hardware plan as the default for lane 2.

## Sources

- [Hetzner GEX44 product page](https://www.hetzner.com/dedicated-rootserver/gex44/)
- [Hetzner GEX131 product page](https://www.hetzner.com/dedicated-rootserver/gex131/)
- [Hetzner GPU server line — configurations and add-ons (docs.hetzner.com)](https://docs.hetzner.com/robot/dedicated-server/server-lines/gpu-server/)
- [Hetzner June 2026 price adjustment (docs.hetzner.com)](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [Hetzner Cloud GPU marketing page](https://www.hetzner.com/cloud/gpu/)
- [Hetzner Server Auction](https://www.hetzner.com/sb/)
- [Hetzner Server Auction mechanics (Hetzner blog)](https://www.hetzner.com/blog/refurbished-servers-how-the-hetzner-server-auction-works/)
- [Hetzner Terms and Conditions](https://www.hetzner.com/legal/terms-and-conditions/)
- [Hetzner AGB PDF (English, v2.0.0)](https://www.hetzner.com/assets/Uploads/downloads/AGB-en.pdf)
- [Hetzner System Policies](https://www.hetzner.com/legal/system-policies/)
- [Hetzner Digital Services Act notice-and-action page](https://www.hetzner.com/legal/digital-services-act/)
- [Hetzner press: GEX131 launch](https://www.hetzner.com/pressroom/new-gex131/)
- [Hetzner press: GEX130 launch (historical, now discontinued)](https://www.hetzner.com/news/gpu-server-gex130/)
- Secondary/cross-check only (used where Hetzner's own pages are JS-rendered and didn't expose a number to fetch directly): [gpuhosted.com Hetzner GPU review 2026](https://gpuhosted.com/en/hetzner-gpu-review/), [Server Radar stock tracker](https://radar.iodev.org/), [whtop.com Hetzner plan listings](https://www.whtop.com/plans/hetzner.com/128304)
