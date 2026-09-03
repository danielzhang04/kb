# R19 — Multi-account Instagram operations

Researched 2026-09-03. Scope: operator-owned, disclosed-AI Instagram professional accounts.
This is an operating recommendation, not legal advice. Source identifiers (`C1` etc.) resolve
in §6; every externally verifiable claim is dated and linked there. Prices are public list
prices checked on 2026-09-03, before tax and usage overages.

## 1. Operating-model recommendation

**Recommendation: one Meta app/control plane, one OAuth grant and account record per creator,
and Graph API as the sole unattended executor.** Use **Instagram API with Instagram Login** for
ordinary owned professional accounts; it does not require a linked Facebook Page (`C1`, checked
2026-09-03). Keep the Facebook-Login configuration only where its extra surfaces actually
justify Page linkage (notably hashtag search, ads/product-tagging or legacy Messenger setup).

Do not make “run N accounts unattended” mean “create, verify, warm, or evade checks unattended.”
Those are operator gates. After a healthy OAuth grant and published-content approval, the queue
can publish and measure without a live browser. A browser profile exists only to prepare a
native-only post or for an operator to resolve a Meta challenge; it never runs engagement,
account-creation, verification, mass follows, likes, or unsolicited DMs.

```text
operator gate ──> account + recovery + verification + OAuth consent
                         │ one account record / token-health state / disclosure=true
creator assets ──> QA ──> scheduler ──> Graph API media container ──> publish
                         │                 │ is_ai_generated=true
                         │                 └──> per-account quota check
                         ├──> Insights poller ──> warehouse ──> optimiser
                         ├──> short-link redirect ──> click/revenue attribution
                         └──> residual-native queue ──> operator browser gate
N accounts: isolated logical records; shared app, workers, audit log, and dashboard
```

**Credential boundary.** Tokens, browser cookies and proxy credentials are never read, copied,
or written by this pipeline/research path; a runtime secret reference and token-health result are
enough. An expiry/challenge pauses only that account and creates an operator task.

## 2. Per-account provisioning checklist

| Item | Required decision / evidence | Who | One-time / monthly incremental cost |
| --- | --- | --- | --- |
| Recovery email | Create a durable, operator-controlled mailbox for the account. Instagram help treats email/phone as recovery channels; no official source promises that disposable providers are tolerated. Do **not** infer a per-account email requirement from absence of a prohibition. (`C10`, 2026-09-03) | Operator | Provider-specific; baseline $0 if using an existing managed domain/mail plan |
| Phone / 2FA | Provide a recovery phone where Instagram asks. There is no official public rule found requiring a unique phone for every account; never reuse numbers merely to defeat limits. Operator completes SMS/identity prompts. (`C10`, `C11`, 2026-09-03) | Operator | Carrier/SIM-specific; $0 incremental if an existing number is permitted by Meta |
| Account creation and age/identity checks | Operator creates each account normally, records the accountable owner and completes any video selfie/ID challenge. A video-selfie challenge requires a live person and can block access for up to two business days. (`C11`, 2026-09-03) | Operator | $0 software; human time |
| Professional conversion | Convert to **Business or Creator** before API connection; personal/consumer accounts are out of scope. Choose Business when Stories via Facebook Login is required; otherwise Creator or Business both work. (`C1`, `C2`, 2026-09-03) | Operator | $0 |
| Facebook Page | **Not required** on Instagram Login. Required when choosing Facebook Login; link one owned Page only if that route/features are needed. (`C1`, 2026-09-03) | Operator | $0 |
| Meta app / access | One Business app can hold all operator-administered accounts. Instagram Login uses the `instagram_business_*` family (at minimum `instagram_business_basic` and `instagram_business_content_publish`; add the current insights/messages scopes if used). Facebook Login uses legacy `instagram_*` scopes plus Page scopes. Confirm the exact current scope strings in the app dashboard. Standard Access covers accounts the app owner manages/adds; Advanced Access/App Review is needed when serving accounts the app does not own/manage. (`C1`, `C2`, 2026-09-03) | Operator | $0; App Review lead time is unpriced/variable |
| Account token | Under one app, maintain a separate long-lived/renewable OAuth grant reference, expiry and refresh health state for **each** account—never a shared account token. R3 recorded the common ~60-day long-lived-token cycle; reconfirm the chosen login route’s current lifecycle at Test 0. (`C1`; [R3](r3-posting-metrics.md), 2026-09-03) | Operator consent; automation monitors | $0 |
| Browser profile | Create a dedicated Playwright persistent profile directory only after interactive login; cookie/session state remains in the controlled runtime, not this repo. Use one named profile per account and no cross-account context. | Operator; automated launcher only after approval | $0 with standard Playwright; infrastructure only |
| Network | Default: the operator’s normal, stable network. Do not buy per-account residential/mobile proxies as a concealment control. A changed network/location is a reason to pause for operator review, not to spoof a device. (`C16`, 2026-09-03) | Operator | $0 baseline |
| Persona disclosure | Set `persona.is_ai_generated=true`; the publisher sends `is_ai_generated=true` while creating the media container (carousel: parent container). Keep a human-readable bio disclosure and immutable publish audit. (`C4`, `C12`, 2026-09-03) | Automation; operator approves wording | $0 |

**Baseline economics.** The API-first path has no per-account Meta/API fee. At 10–50 accounts,
the material recurring cost should be the already-needed hosting/asset delivery and operator
support time—not a proxy or anti-detect subscription. Do not introduce a SIM, proxy, or browser
vendor line until an operator has a legitimate non-evasion need and approves spend.

### Official API capacity and format boundary

| Surface | Current supported path / ceiling | Implementation rule |
| --- | --- | --- |
| Publish | Image, video/Reel, and mixed carousel (up to 10 children); public HTTPS media is fetched by Meta. (`C2`, 2026-09-03) | Create containers close to schedule time; poll video status; publish idempotently. |
| Stories | Official collection describes Stories as Business-only on the Facebook-Login route. (`C1`, 2026-09-03) | Treat as version/route acceptance test; native posting is fallback for stickers/audio. |
| Quota | 100 API-published posts per rolling 24 hours per professional account; carousel counts once; `content_publishing_limit` exposes use. (`C2`, 2026-09-03) | Query per account; never hard-code a shared global allowance. |
| AI label | `is_ai_generated` is supplied at media-container creation; set it on the carousel parent. (`C4`, 2026-09-03) | Required publisher invariant; fail closed if missing. |
| Insights | Account/media endpoints expose compatible organic measures such as reach, views/plays, accounts engaged, interactions, follows, profile/link actions and media likes/comments/shares/saves; exact allowlist varies by media type/version. (`C1`, 2026-09-03) | Persist raw response + API version; pull daily and at 24–48h after publish. |
| Not established | The official publishing materials reviewed do not establish API support for Collab posts, Trial Reels, adding Instagram-library music/trending audio, or Story stickers/interactivity. (`C2`, `C14`, 2026-09-03) | Do not promise them; route to a native operator queue or omit. |

## 3. Capability matrix

| Action | Graph API | Approved browser profile | Not possible / policy-forbidden |
| --- | --- | --- | --- |
| Create account, add recovery email/phone, pass selfie/ID check | No | Operator only | No unattended automation |
| Convert to professional, link Page, configure profile/settings | Partial configuration surface only | Operator only | No scripted creation/verification |
| OAuth/connect an owned professional account | Yes, after operator consent | Operator may complete consent | Never capture credentials/cookies in repo |
| Single image, Reel/video, carousel | Yes (`C2`) | Fallback only | — |
| Story without sticker/music | Route/version dependent; Business Facebook-Login documented (`C1`) | Operator native fallback | — |
| Library/trending audio, sticker/link/poll/GIF effects, collab or Trial-Reel UI | Not established (`C14`) | Operator creates/approves natively | Do not automate UI at scale |
| Comments on own media / permitted inbound DMs | Yes where scoped (`C1`) | Human inbox for exceptions | No auto-like/follow/mass-comment behavior |
| Inbound DM response | Yes only inside applicable messaging policy window (`C13`) | Human Agent manually inside its permitted window | No unsolicited promotional blasts |
| Account/media insights | Yes (`C1`) | — | — |
| Bio-link clicks | Own redirect + UTM / short-link stats (`C15`) | — | Do not infer revenue from reach alone |
| Paid-platform revenue join | Own paid platform’s lawful export/webhook + order/time attribution | Operator reconciliation | No scraping or credential access |

### Browser residual: design, not a bypass recipe

Use a normal Chromium/Playwright persistent context per account, launched only for a queued,
operator-approved native task. Contexts isolate cookies/local storage; headless operation removes
an open desktop tab, but is **not** a guarantee that Instagram will accept automated browsing.
Use a stable, truthful locale/device configuration and stop on a challenge. Mobile emulation is
for QA of mobile layouts, not an identity substitute.

The named anti-detect products are market patterns, not candidates: they sell profile isolation,
fingerprint modification and proxy attachment. That purpose conflicts with an API-first, honest
operator-controlled model and creates policy/detection risk. Likewise, `instagrapi` uses private
mobile endpoints and its own documentation discusses login challenges/session distrust (`C16`):
**do not adopt it.** No “warm-up” sequence, action-limit evasion, artificial engagement, or
per-account proxy rotation is recommended or specified here.

No independently corroborated, compliant public playbook was found that proves unattended
operation of 10–50 synthetic-person accounts. Agency/anti-detect marketing is not an appropriate
operating baseline; prove the supported control plane on one account, then scale only the same
per-account queue/consent/approval contract.

## 4. Tool-pattern table

| Pattern / product | What it contributes | API-only or browser | Public price / licence checked 2026-09-03 | Adopt-pattern verdict |
| --- | --- | --- | --- | --- |
| Meta Business Suite | Native calendar/scheduling and operator fallback. (`C17`) | First-party UI | $0 | Reference only; use for manual exception handling, not system of record. |
| Buffer | Multi-account calendar/publishing; Buffer API and experimental metrics endpoint. (`C18`) | Official-API-backed SaaS | Free; paid from $5/channel/mo annually (R3 source) | Borrow approval/calendar UX; direct Meta metrics remain canonical. |
| Later | Calendar, auto-publish and reporting; public API is not a general self-serve publisher. (`C19`) | Official-API-backed SaaS | Plan-dependent | Do not depend on it for a control-plane API. |
| Metricool | Scheduler/API on Advanced; documented professional-account publishing. (`C20`) | Official-API-backed SaaS | Free: 1 brand/20 posts/mo; Advanced for API | Useful pilot comparator, not core. |
| Hootsuite | Calendar, inbox, analytics for many accounts. (`C21`) | Official-API-backed SaaS | From $99/mo; Standard includes 10 accounts | Pattern only; expensive for Figment’s narrow need. |
| Postiz | Self-hosted calendar, integrations and public API, including Instagram. (`C22`) | Intended official integrations | AGPL-3.0 | Lift concepts only pending legal review; AGPL makes embedding/modification a legal decision. |
| Mixpost Lite | Self-hosted Laravel scheduler/workspaces/analytics. (`C23`) | Platform integrations | MIT (Lite) | Bake-off only; verify current Reel/carousel/Story detail. |
| n8n / Make | Orchestration patterns around approved endpoints. | Depends on connected node | Commercial/self-host terms vary | Borrow queue/retry/webhook patterns; call Graph API directly. |
| Standard Playwright | Persistent per-account browser contexts for residual operator work. | Browser | Apache-2.0 (`C24`) | **Adopt**, with human gate and no stealth/evasion layer. |
| Browserless | Hosted/self-host browser sessions and persisted state. (`C25`) | Browser | Free tier; $25/mo annual Pro; commercial licence may apply to closed-source use | Optional infrastructure pattern; not needed initially. |
| Multilogin / GoLogin / AdsPower / Dolphin Anty | Isolation plus fingerprint/proxy management. (`C26`–`C29`) | Anti-detect browser | Multilogin from $11/mo; GoLogin from $9/mo; vendor plans vary | **Do not adopt**: concealment posture and avoidable risk. |
| Camoufox / “undetected” Playwright | Open-source fingerprint-evasion browser forks. (`C30`) | Anti-detect browser | MPL-2.0 for Camoufox | **Do not adopt**: open source does not make evasion compliant. |

## 5. Risk register and guardrails

| Approach | Detection / ban / compliance risk | Evidence | Mitigation / decision |
| --- | --- | --- | --- |
| Direct Graph API using approved scopes | Lowest relative operational risk; still subject to content, spam and account rules. | Official supported route (`C1`, `C2`) | Adopt; quota check, idempotency, per-account error isolation and human approval gate. |
| Persistent standard browser for a native-only exception | Moderate: a challenge can occur and a headless context is not a human device. | Meta can require video-selfie recovery/identity verification (`C11`) | Launch only after operator approval; no retries on challenge; escalate to operator. |
| Anti-detect browser, fingerprint spoofing, proxy rotation | High: designed to hide identity/automation; no official assurance it is allowed or durable. | Vendor descriptions explicitly advertise fingerprint/proxy control (`C26`–`C30`) | Do not use. Stable legitimate operation is preferable to concealment. |
| Private/unofficial API (`instagrapi`) | High: credentials/session emulation, private endpoint use, login challenges and signature revocation reported by maintainer docs. | `C16` | Prohibited in Figment. |
| Automated likes, follows, bulk comments or fake engagement | High: activity is inauthentic/spam; enforcement risk. | Meta actions against fake-engagement services (`C31`) | Policy-forbidden; do not build. |
| DM bot outside user-initiated 24h window | High: automated messaging outside window disallowed; manual human window differs. | ManyChat’s policy implementation (`C13`) | Enforce recipient-level window; human-only exception where Meta permits. |
| Disclosed AI persona/content | Legal/platform risk if disclosure absent or content deceives. | Meta API AI-label parameter (`C4`); EU Article 50 applies 2026-08-02 (`C12`) | API label + clear bio disclosure + provenance/audit. Seek counsel for EU targeting. |
| Synthetic-person identity challenge | Operationally high: a video selfie needs a real account holder and may not match persona imagery. | Meta says the video selfie confirms the person/account and may be required to regain access (`C11`) | Account owner, not persona, performs it; never fabricate or automate verification. |

### Messaging, analytics, and revenue

For DMs, build only a reply assistant on top of the official messaging endpoint/webhooks. A user
interaction opens the 24-hour automated window; after that, suppress automation and queue a
human response if the allowed Human Agent path applies (`C13`, checked 2026-09-03). ManyChat is
a pattern reference for consent/window state, not a licence to send campaigns.

For analytics, retain per-account account/media insight snapshots with source metric name,
period, API version, fetch time, media ID, persona and content-batch ID. Attribute traffic with
a first-party redirect such as `go.example/<account>/<campaign>` carrying UTM tags and join its
click log to the published media ID. Join paid-platform revenue only from a supported export or
webhook on a consented, lawful basis; report attributed versus merely correlated revenue
separately. Short.io and Bitly both document link-level click reporting (`C15`, 2026-09-03).

## 6. Claims and source register

| ID | Claim | Source URL | Source date / checked | Confidence |
| --- | --- | --- | --- | --- |
| C1 | Meta’s current collection distinguishes Facebook Login (linked Page required) from Instagram Login; both target professional Business/Creator accounts and list their scopes/access modes. | [Meta Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) | live collection, checked 2026-09-03 | High |
| C2 | Publishing supports images, Reels/videos and carousels; public media hosting, 100 posts/24h and quota endpoint are documented. | [Meta Publish Content](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672) | live collection, checked 2026-09-03 | High |
| C3 | Standard access is for accounts an app owns/manages; Advanced is needed for accounts it does not own/manage. | [Meta API collection—messaging requirements](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672) | live collection, checked 2026-09-03 | High |
| C4 | `is_ai_generated` was added at container creation; carousel disclosure belongs on the parent. | [Instagram Platform release note mirror](https://releasebot.io/updates/meta/instagram-platform) | 2026-06-22; checked 2026-09-03 | Medium—verify in exact API version before launch |
| C5 | Account/media insights and compatible metric/request surfaces are documented in Meta’s live collection. | [Meta Insights requests](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) | live collection, checked 2026-09-03 | High |
| C10 | Instagram’s help describes loss/recovery of linked email or phone, not a unique-email/phone-per-account rule. | [Instagram Help Centre](https://www.facebook.com/help/instagram/358911864194456?locale=en_GB) | live help page, checked 2026-09-03 | Medium |
| C11 | Video selfie is a live identity/recovery mechanism, may take up to two business days, and may be necessary to regain access. | [Instagram Help Centre](https://www.facebook.com/help/1053588012132894/) | live help page, checked 2026-09-03 | High |
| C12 | EU AI Act Article 50 transparency obligations apply from 2026-08-02; guidance covers generated content/deepfakes. | [European Commission guidance](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations) | 2026-08-06 update; checked 2026-09-03 | High |
| C13 | Automated Instagram messaging is limited to a 24-hour window after contact interaction; ManyChat suppresses messages outside it and describes a manual 7-day path. | [ManyChat messaging windows](https://help.manychat.com/hc/en-us/articles/23358636027932-Understanding-messaging-windows) | 2026-08-27; checked 2026-09-03 | Medium—vendor summary of Meta policy |
| C14 | Library audio is unavailable in one published Meta Business Suite user report; official collection does not document stickers/collabs/trial reels as Content Publishing features. | [Practitioner report](https://www.reddit.com/r/FacebookAds/comments/1o3l3uk/) | 2025 report; checked 2026-09-03 | Low for absence claims; acceptance-test each feature |
| C15 | Short.io documents link/domain statistics; Bitly documents link click series/summaries. | [Short.io API FAQ](https://docs.short.io/articles/api-reference/Technical%20questions/how-to-use-the-short.io-api) · [Bitly metrics tutorial](https://dev.bitly.com/docs/tutorials/retrieve-metrics/) | live docs, checked 2026-09-03 | High |
| C16 | instagrapi documentation says inconsistent device/session/IP history can trigger rate limiting or challenges and describes fresh credential login. | [instagrapi best practices](https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/best-practices.md) | live repo, checked 2026-09-03 | High for library behaviour/risk signal |
| C17 | Meta’s Business Suite video demonstrates scheduling Facebook/Instagram feed posts and Stories. | [Meta for Business video](https://www.youtube.com/watch?v=PQjvbXyMhkM) | 2022-09-09; checked 2026-09-03 | Medium—product surface can change |
| C18 | Buffer documents API access/pricing; R3 captured the current Instagram publishing scope. | [Buffer API](https://support.buffer.com/en-us/articles/what-is-buffers-api-GtIYIQilz5) · [pricing](https://buffer.com/pricing) | live pages, checked 2026-09-03 | Medium |
| C19 | Later’s public page describes Instagram scheduling; pricing is plan-based. | [Later scheduler](https://later.com/instagram-scheduler/) · [pricing](https://later.com/pricing) | live pages, checked 2026-09-03 | Medium |
| C20 | Metricool documents Instagram scheduling and says API access is on Advanced plans. | [Instagram publishing](https://help.metricool.com/schedule-and-post-on-instagram-6b6q5) · [plans/API](https://help.metricool.com/plans-add-ons-and-api-access-explained-xux1u) | live help pages, checked 2026-09-03 | Medium |
| C21 | Hootsuite lists multi-account scheduling, inbox/analytics and prices starting at $99/mo. | [Hootsuite plans](https://www.hootsuite.com/plans) | live pricing, checked 2026-09-03 | High |
| C22 | Postiz documents a public API and Instagram integration; its repository is AGPL-3.0. | [Postiz API](https://docs.postiz.com/public-api/introduction) · [repository](https://github.com/gitroomhq/postiz-app) | live docs/repo, checked 2026-09-03 | High |
| C23 | Mixpost Lite is an MIT-licensed self-hosted social management repository. | [Mixpost repository](https://github.com/inovector/mixpost) | live repo, checked 2026-09-03 | High |
| C24 | Playwright is Apache-2.0. | [Playwright repository](https://github.com/microsoft/playwright) | live repo, checked 2026-09-03 | High |
| C25 | Browserless supports Playwright/Puppeteer, persisted sessions, a free tier and paid plans; commercial licensing caveat is documented. | [pricing](https://www.browserless.io/pricing) · [repository](https://github.com/browserless/browserless) | live pages, checked 2026-09-03 | High |
| C26 | Multilogin sells cloud/local profiles and proxy traffic; Pro starts $11/mo monthly. | [Multilogin pricing](https://multilogin.com/pricing) | live pricing, checked 2026-09-03 | High |
| C27 | GoLogin defines profiles as separate fingerprints/cookies/history/settings, offers proxy options and lists paid plans from $9/mo. | [GoLogin FAQ](https://gologin.com/faq/) · [pricing](https://support.gologin.com/en/articles/14617029-pricing) | 2026 pricing/help, checked 2026-09-03 | High |
| C28 | AdsPower markets browser profiles that mimic fingerprint parameters and configure proxies. | [AdsPower pricing](https://www.adspower.com/pricing) | live pricing, checked 2026-09-03 | High |
| C29 | Dolphin Anty markets fingerprint spoofing/browser profiles; its free tier supplies 10 profiles. | [Dolphin tariff update](https://dolphin-anty.com/blog/en/dolphin-anty-changes-to-free-and-base-tariffs/) | 2026 update, checked 2026-09-03 | Medium |
| C30 | Camoufox is MPL-2.0 and explicitly markets anti-detection/fingerprint injection with Playwright compatibility. | [Camoufox repository](https://github.com/daijro/camoufox) | live repo, checked 2026-09-03 | High |
| C31 | Meta has taken legal action against services selling fake Instagram engagement and identifies that activity as Terms/Policy violating. | [Meta announcement](https://about.fb.com/news/2020/10/taking-action-against-fake-engagement-and-ad-scams/) | 2020-10-22; checked 2026-09-03 | High |

## Decision

Build the shared-app, per-account OAuth/insights/publish contract first and test it with one
operator-provisioned Business account. Prove container creation, AI label, quota query, publish,
and a daily insights snapshot. Do not buy accounts, SIMs, proxies, anti-detect browsers or a
scheduler until that supported test passes and an operator selects a residual-native workflow.
