# R3 — Posting + metrics automation survey

Researched 2026-08-31. Scope: disclosed-AI personas; operator-owned accounts and tokens; official APIs only.

## 1. Meta Graph API: publishing

Use the [Instagram Platform Content Publishing API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672), not UI automation. The basic flow is: host the asset at a public HTTPS URL, create an `/{ig-user-id}/media` container, poll its status when video is involved, then call `/{ig-user-id}/media_publish`. Containers are ephemeral, so create them near the scheduled publish time rather than at batch-generation time.

| Format | Official API support | Important limits |
| --- | --- | --- |
| Single photo feed post | Yes (JPEG) | Publicly reachable source URL required. |
| Single video | Yes, as a `REELS` container | Third-party API treats a single video as a Reel. |
| Reel | Yes | Video processing is asynchronous; poll status before publish. |
| Carousel | Yes: image, video, or mixed, up to 10 child containers | Counts as one API-published post. |
| Story | Yes, **Business accounts only** on the Facebook Login route | No interactive/sticker/link composition surface; use the native app when those are needed. |

Requirements: an Instagram Professional account (Business or Creator; never a consumer/personal account), a Meta app and OAuth token. The newer Instagram Login path can avoid a linked Facebook Page for much of the surface; the Facebook Login path requires Page linkage. Publishing needs `instagram_business_basic` + `instagram_business_content_publish` on Instagram Login (or the corresponding legacy/Facebook Login permissions). Standard access is appropriate for accounts the operator administers; serving other people’s accounts requires the applicable Advanced Access/App Review. The current Meta-maintained collection documents those modes, scopes, and the Business-only Story restriction. [Meta’s collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-1ff01566-3509-48bd-a0f4-8571a91ccfdf)

Token handling: treat tokens as renewable runtime secrets, not repo configuration. Long-lived user tokens commonly expire in about 60 days; refresh before expiry and surface token-health failures to the operator. Do not design unattended posting around a manually copied token.

Quota: Meta’s current publishing guide says **100 API-published posts per rolling 24 hours**, with a carousel counted once, and exposes `GET /content_publishing_limit` for the account’s actual usage. Some secondary scheduler documentation still says 50, so the implementation should query that endpoint and enforce its returned quota rather than hard-code either number. [Meta publishing guide](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672)

## 2. Meta Insights API

Pull on a schedule from `/{ig-user-id}/insights` (account) and `/{ig-media-id}/insights` (media), persist normalized daily snapshots, and retain the original metric name/version alongside each value. Available metrics depend on media product type and API version; request only the compatible set.

| Surface | Useful official metrics |
| --- | --- |
| Account | `reach`, `follower_count`, `profile_views`, `profile_links_taps`/website clicks, `accounts_engaged`, `total_interactions`, `likes`, `comments`, `shares`, `saves`, `replies`, `views`, follows/unfollows, audience demographics. |
| Media (feed/carousel/Reel) | `reach`, `likes`, `comments`, `shares`, `saved`, `total_interactions`; Reels additionally expose `plays`/`views`, replay and total-play counters, average watch time, total watch time, follows and profile activity/visits where supported. |
| Stories | Reach/views, replies and navigation-style measures where available; it is short-lived data, not a durable reporting source. |

Account insights support period/granularity choices including day, week, 28-day, month, lifetime, and total-over-range; media measures are generally lifetime values. Meta’s current request collection is the live metric allowlist and includes the account and media sets above. [Meta Insights requests](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-1ff01566-3509-48bd-a0f4-8571a91ccfdf)

Operationally, poll daily and again at 24–48 hours after a publish; organic insights can lag and media history is available for up to two years. Story metrics are available only while the story window is open (24 hours), so capture them hourly or at least before expiry. Do not infer paid performance from this API; it is organic reporting. [API limitations captured from Meta’s reference](https://pkg.go.dev/github.com/qcserestipy/instagram-api-go-client/pkg/sdk/v24.0/media/client/insights)

## 3. Open-source schedulers to lift

- **[Postiz](https://github.com/gitroomhq/postiz-app)** — strongest lift candidate if a self-hosted scheduling UI is needed. It has Instagram (Facebook-linked and standalone) provider settings, public API/OAuth, Node SDK, n8n node, post-published webhooks, analytics and Docker deployment. Its documented public API supports cloud or self-hosted base URLs and a configurable self-host rate limit. It is currently AGPL-3.0, so obtain legal review before modifying/embedding it in a proprietary service. Maintenance is active: 35.3k stars, main commits on 2026-08-30, latest release v2.23.0, and 149 open issues / 111 open PRs when checked; that is high activity, but also a meaningful triage surface. [API docs](https://docs.postiz.com/public-api/introduction) · [commit history](https://github.com/gitroomhq/postiz-app/commits/main) · [releases](https://github.com/gitroomhq/postiz-app/releases)

- **[Mixpost Lite](https://github.com/inovector/mixpost)** — MIT-licensed Laravel self-hosted scheduler with publishing, calendar/workspaces and platform analytics. The public repo is explicitly the Lite edition; advanced/enterprise capabilities are commercial, so verify the exact Instagram format and API depth in a bake-off before choosing it for Reels/carousels/Stories. Maintenance is moderate rather than continuous: 3.6k stars, latest main commit/release 2026-03-16, 29 issues / 6 PRs at check time. [repository](https://github.com/inovector/mixpost) · [release history](https://github.com/inovector/mixpost/releases)

Postiz is worth lifting for its scheduling/UI/API layer, but keep the Figment metric warehouse and attribution logic independent; that makes a later scheduler swap inexpensive.

## 4. SaaS schedulers

| Service | Automation/API | Instagram depth | Price/access signal |
| --- | --- | --- | --- |
| **[Buffer](https://support.buffer.com/en-us/articles/what-is-buffers-api-GtIYIQilz5)** | Current GraphQL API on all plans; create/schedule posts. Its post-metrics API is explicitly experimental and unsuitable as the reporting system of record. | Auto/notification publishing for posts, Reels and Stories; carousel limits/features differ from native IG. | Free includes API key (3,000 requests/month); paid per channel, currently from $5/month annually. [pricing](https://buffer.com/pricing) |
| **[Later](https://later.com/instagram-scheduler/?rd=1)** | Later’s documented API is a Later Influence reporting API, not a general self-serve publishing API; evaluate enterprise access separately. | Auto-publishes feed images, carousels and Reels; Stories and analytics included, with personal accounts notification-only. | Product plan and post limits are shown on its live pricing page; request commercial/API terms if programmatic publishing is a requirement. [plans](https://later.com/pricing) |
| **[Metricool](https://help.metricool.com/schedule-and-post-on-instagram-6b6q5)** | REST scheduler endpoint/API is on Advanced plans; MCP is present even on the free plan. | Auto-publishes posts, Reels, Trial Reels and Stories for professional accounts; unsupported Story links/stickers and some audio go to notification publishing. | Free: one brand, 20 posts/month and 30 days analytics; Advanced adds its API. [plan/API matrix](https://help.metricool.com/plans-add-ons-and-api-access-explained-xux1u) |

Use a SaaS scheduler only when its approval/calendar workflow is the product requirement. For Figment’s metrics and per-door attribution, none replaces direct Meta pulls plus a first-party warehouse.

## 5. MCP / agent connectors

No Meta-maintained Instagram MCP server was found. Existing servers are community wrappers around the official Graph API, so assess them as source code—not as a new platform authorization boundary.

- **[Instagram MCP by IvanBBaev](https://github.com/IvanBBaev/instagram-mcp)**: TypeScript, local-only, official Graph endpoints, broad publish/insight/comment surface, with CI/tests claimed; not published to npm. Best maturity signal among reviewed connectors, but still an unaffiliated pre-release.
- **[instagram-mcp by adelaidasofia](https://github.com/adelaidasofia/instagram-mcp)**: Python/FastMCP, 29 tools including publishing, insights and quota, MIT, but only 1 star and 0 issues—small adoption despite thoughtful security claims.
- **Postiz MCP**: bundled with the much larger Postiz scheduler; useful for agent-driven scheduling, but it adds the scheduler as an intermediary rather than exposing raw Meta semantics.
- **Metricool MCP**: a vendor connector; convenient for managed scheduling, but the API/analytics remain vendor-mediated and plan-gated.

For the first test account, direct Graph API behind a narrow internal tool is lower risk and easier to observe. Add an MCP wrapper only after the publish/metrics contract is stable; require preview-by-default and an explicit human approval to execute a post.

## 6. Link / funnel attribution

Give every persona-door a stable short URL (for example, `go.example/door-a`) and record: persona, asset/batch, IG media ID, destination, UTM fields, created time, and short-link ID. Keep this mapping in Figment, not only at the shortener.

- **[Short.io](https://docs.short.io/articles/api-reference/Technical%20questions/how-to-use-the-short.io-api)** supports link creation/management plus link- and domain-level statistics, including click totals by link ID. API access is documented for every plan.
- **[Bitly](https://dev.bitly.com/docs/tutorials/retrieve-metrics/)** offers individual-link click series and summaries, plus paid-plan location/device facets; available history/range depends on subscription.
- A link-in-bio hub can provide page/click views (Later Link in Bio is one example), but retain per-door shortlinks anyway: Instagram caption links are not a dependable click surface and Story links/stickers are not fully automatable through the third-party API.

## TikTok (secondary)

TikTok’s official **Content Posting API** supports Direct Post and Upload-as-draft. Direct posting requires the user-approved `video.publish` scope, creator-info query/consent UI, and a client audit; unaudited clients are restricted to private visibility. It now supports photos as well as video, offers publish-status polling/webhooks, and the video-init endpoint is limited to six requests per user token per minute. This is a viable second connector but should not delay Instagram. [TikTok overview](https://developers.tiktok.com/products/content-posting-api) · [Direct Post requirements](https://developers.tiktok.com/docs/en/content-posting-api-get-started) · [reference](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)

## NOT RECOMMENDED — unofficial/private Instagram APIs

`instagrapi`-class clients can emulate the consumer app to log in, upload/publish and scrape data beyond the official surface. They operate outside the operator-approved Graph API OAuth route, commonly require username/password, cookies or device/session emulation, and are routinely described by their maintainers/users as ban-risk. They are not needed for the supported formats above and should not be used in Figment. Keep the private-API decision, if ever raised, as an explicit Daniel-level risk exception—not an implementation path.

## Recommended automation architecture

Use Meta Graph API directly for Instagram publishing and Insights, with a small queue worker that creates containers just-in-time, polls video status, checks the live publishing-limit endpoint, and writes idempotent publish/metric snapshots to a Figment warehouse. This keeps official OAuth, raw media IDs and source metrics under operator control; layer a scheduler UI only when a human-calendar workflow proves valuable.

- **Content store/CDN:** signed upload workflow that yields a public HTTPS fetch URL at publish time.
- **Publish service:** Meta OAuth token-health monitor; queue, idempotency key, container/status/publish state machine, manual-approval gate.
- **Metrics service:** daily account/media polling plus a Story capture job before expiry; immutable raw response and normalized facts.
- **Attribution:** Short.io custom-domain per-door links with UTM parameters; join click series to media ID/batch/persona.
- **Operator UI:** use Postiz for a self-hosted calendar/API/webhook layer only after legal review, or Buffer/Metricool for a managed pilot.

**Fallback:** if Meta App Review or token maintenance blocks a multi-account build, use Buffer or Metricool to publish from the operator’s connected professional test account while the direct Insights + short-link collector remains first-party; for unsupported Story composition, issue an operator notification with prepared media/copy for native posting.
