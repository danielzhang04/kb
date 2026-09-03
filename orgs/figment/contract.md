# figment — contract (autonomy policy)

Per `governance/risk-tiers.md`. Conservative default: EVERYTHING queues-for-me until grades earn a
wider list. `pipeline/GUARDRAILS.md` binds on top of this file and is not relaxed by any tier,
grade, or permission mode.

## acts-alone (T1)

- Update `STATE.md`, `_index.md` and research notes in this project
- Read-only research per the GUARDRAILS browsing rules; write `research/` reports and claim-checks
- Build, edit and dry-run manifests, templates, taxonomies and workflows (no live execution)
- Run the local review trio (`qa_stamp.py` from a rulings file, `blind_pool.py`,
  `build_grading_board.py`) and local scorers over already-generated images
- Run the pod harness with `--dry-run`, and the publisher/insights runners against recorded fixtures
- Append lessons to `memory/<agent-id>.md`

## queues-for-me (T2 — a card, an estimate, and my approval before it runs)

- **Any live pod run.** The card states the manifest, the cell count, `--max-usd`, `--max-minutes`,
  and the running arc total against the $50 cap
- Any change to spend-controlling code (`runpod_run.py` ledger, guard, lease or teardown paths)
- Any change to identity-scoring code (`identity_check.py`, the pass scorers, the video frame QA)
- Promoting a new external node or model into a manifest — with its pinned commit or file revision
  and its verified licence
- Adopting or dropping a stage-5/stage-6 pass
- Changing the content taxonomy, a carousel/reel template, the weekly mix, or the posting cadence
- Any diff over 400 lines, or anything touching another project

## human-only (T3 — my approval token on the dashboard/WebAuthn channel; never the weak channel)

- **Every publish.** No post, story, reel, carousel, comment or reply leaves the pipeline without it
- Any account-level change: profile, bio, disclosure label, bio link, highlights
- Merges to `main`, deploys, and anything published outside this repo
- Launching a browser session against a live platform account, and every native task inside it

## never (T4 — never carded, never delegated, no exceptions)

- Creating, verifying, warming or recovering a platform account; completing any identity or
  video-selfie challenge
- Handling any credential as an object: creating, reading, opening a store, copying, printing,
  persisting or transmitting one. Ambient environment values may be used and never revealed
- Spending money on any platform: subscriptions, PPV, tips, unlocks, bundles, boosts, or a "free
  trial" that attaches billing. Linking or entering a payment method
- Generating, prompting for, or judging explicit content. The explicit tier is generated on operator
  hardware, by the operator; agents build and test that machine on clothed data only
- Generating a face resembling a specific real person, putting a real person's name in a prompt, or
  cloning a real person's voice
- Likes, follows, comments, DMs, saves, or any engagement action on any platform; scraping;
  downloading another creator's media
- Anti-detect browsers, fingerprint spoofing, proxy rotation, private/unofficial Instagram APIs,
  multi-accounting for evasion, or any other measure whose purpose is to defeat platform detection

## wakes-me-up

- Verification fails twice on the same item
- A pod's termination could not be verified, or a `POD STILL RUNNING` banner appears
- The daily budget or the $50 arc cap would be breached, or a ledger row disagrees with `run.json`
- Any ambiguous-age or clothing-render failure that a QA gate did not catch before delivery
- A platform challenge, a token expiry, or a recommendation-eligibility signal dropping
- Any request to handle a secret as an object, or any governance rule violated
- Research hits a paywall, bot wall or rate limit — recorded as "evidence unavailable", never worked
  around
