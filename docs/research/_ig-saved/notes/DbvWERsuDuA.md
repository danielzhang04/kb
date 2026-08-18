# DbvWERsuDuA — Claude-built lead-gen (repo + prompt)
- post: https://www.instagram.com/p/DbvWERsuDuA/ | author: @Liam Johnston | published: 20260807 | duration: 45s

## What's demonstrated
A talking-head creator demos using Claude Code to drive `ScrapeGraphAI/Scrapegraph-ai`, an open-source Python web-scraping library, to build a leads spreadsheet from scratch. The video shows (1) the real GitHub repo page with live star/fork counts, (2) a mocked-up Claude Code terminal running a natural-language command (`claude "find plumbing business owners"`) that reports discrete pipeline steps (web search, crawl, extract, write to Google Sheets), (3) a resulting Google Sheets-style "Leads" table populating with company/owner/email rows, (4) a cost comparison graphic against Apify, and (5) a "have it save that workflow and run it every morning" recurring-schedule mockup (7:00 AM daily, Mon–Fri toggles) with the row count climbing across days.

## Concrete mechanism
The claimed workflow: copy the GitHub repo link (`https://github.com/ScrapeGraphAI/Scrapegraph-ai`), paste it into Claude Code and say "install this" — the mocked terminal shows `cloning Scrapegraph-ai` then `pip install scrapegraphai` completing. Then issue a plain-language instruction (`claude "find plumbing business owners"`), and the tool chains: web search → crawl 6 directory sources → extract company/owner/email fields → write results to Google Sheets. The video frames this as Claude Code using the ScrapeGraphAI library as a callable tool to do the actual scraping/extraction, with Claude orchestrating the multi-step pipeline and writing output to a spreadsheet. A second graphic claims it can be scheduled as a recurring daily workflow (7:00 AM, selectable weekdays) that keeps appending fresh rows to the same sheet over time.

## Named tools / repos / models / APIs
- `ScrapeGraphAI/Scrapegraph-ai` — GitHub repo, name and full URL both directly legible on-screen (`github.com/ScrapeGraphAI/Scrapegraph-ai`) [frame, 00:03-00:08, 00:24-00:27]
- `pip install scrapegraphai` — install command shown in mocked terminal [frame, 00:27]
- Claude Code — terminal branded `claude-code`, command shown as `claude "find plumbing business owners"` [frame, 00:09-00:17, 00:26-00:27]
- Apify — named as a comparison/competitor cost baseline, not itself demonstrated [frame, 00:19-00:23; audio 00:21-00:24]
- Google Sheets — destination for scraped leads, shown as a "Leads" table UI (not a raw Sheets screenshot, but styled to resemble one) [frame throughout]

## Specific claim / result
Repo stats shown climbing in the graphic: 0 → 24,659 → 28,505 → 28,999 stars, "MIT license," "2,838 forks," "Python" [frame, 00:04-00:07] (voiceover separately states "almost 29,000 stars"). Pipeline run graphic reports: "web search · 6 directory sources," "crawl · 3,412 companies," "extract · company, owner, email," "write · Google Sheets," final result "2,418 rows" [frame, 00:13-00:16]. Cost-comparison graphic: ScrapeGraphAI shown at "$0.00 / company" versus Apify at "$0.004/company" (running totals shown climbing from $3.63 to $9.67 across several hundred to ~2,400 companies) [frame, 00:18-00:23]. Scheduled-run mockup shows the Leads row count climbing across a week: 2,418 → 4,836 → 7,251 → 9,684 → 12,102 rows as Mon through Fri toggle on [frame, 00:33-00:38].

## Novel / buildable moments (with timestamps)
- 00:09-00:13: Natural-language scraping command pattern (`claude "find plumbing business owners"`) that triggers a defined pipeline (search → crawl → extract → write) — a reusable prompt shape for any Claude-driven data-collection tool.
- 00:13-00:16: The pipeline's step-by-step progress log (web search → crawl → extract → write, each with a checkmark and count) is a clean UX pattern worth adopting for any long-running agent task in a dev dashboard.
- 00:18-00:23: Explicit $/company cost accounting comparing a free local-model scrape against a paid API (Apify) — useful framing if building a cost-transparency feature for scraping/agent tools.
- 00:34-00:38: The "schedule this workflow to run daily and keep appending" concept, with a lightweight day-of-week toggle UI, is a simple, buildable automation-scheduling pattern.

## Transcript highlights
- 00:00-00:03 — "Claude can now scrape thousands of leads for your business for free."
- 00:03-00:08 — "The tool is called ScrapeGraph API. It's completely open source and has almost 29,000 stars on GitHub."
- 00:08-00:12 — "It lets Claude search the web or crawl through directories with thousands of companies."
- 00:18-00:21 — "It runs on your computer and you can even use local models."
- 00:21-00:24 — "So you're not paying Appify for every new company that it scrapes."
- 00:25-00:28 — "Copy the repo link, paste it into Claude, and just say it install this."
- 00:28-00:33 — "Now watch, I just tell it to find me specific business owners, and the sheet starts filling up on autopilot."
- 00:33-00:38 — "Have it save that workflow and run it every morning, and fresh leads keep landing in your sheet on autopilot."

## Reliability
Moderately substantive: the repo name and full URL are directly legible on-screen (not gated behind the comment CTA), and the repo is real and independently identifiable. However, the "demo" itself (terminal output, sheet filling, scheduling UI) is entirely a stylized motion-graphic mockup, not a real screen capture of Claude Code actually running — so the specific numbers (3,412 companies crawled, 2,418 rows, cost deltas vs. Apify) are illustrative claims, not verified results. Still ends with a "comment LEADS and I'll send you... the exact prompt" gate for the actual prompt text, meaning the one part of the workflow not shown on-screen (the precise prompt wording) is withheld.
