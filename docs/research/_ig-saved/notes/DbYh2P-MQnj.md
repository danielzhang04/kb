# DbYh2P-MQnj — A team of 137 AI agents
- post: https://www.instagram.com/p/DbYh2P-MQnj/ | author: @Ahmed Alassafi | published: 20260729 | duration: 49s

## What's demonstrated
A screen recording (filmed off a curved LG monitor, not a raw screen capture) of a real interactive web app called **SkillTree** (URL visible: `skilltree.altari.ai/map`), pitched as a visual map of "137 AI agents" organized into 7 company departments. The presenter clicks through the map: department-level radial view → individual-agent-node view → per-skill detail card, plus a "Company Knowledge Base" onboarding doc.

## Dashboard / UI-UX observed
This is the strongest visual reference of the 5 reels — a genuinely coherent, well-designed product UI, captured across multiple zoom levels:

**Top-level MAP view** [0:02, 0:11, 0:15, 0:45-0:48]: a radial/constellation diagram on a dark navy background. Seven department clusters are arranged around a central dense particle cloud (the "company brain"): SALES, DEALS, MARKETING, OPERATIONS, INTELLIGENCE, CUSTOMER, BACK OFFICE. Each department is a colored ring icon (Sales=magenta/pink, Deals=hot pink, Marketing=purple, Operations=teal, Intelligence=blue, Customer=pink, Back Office=yellow/gold) with a tree of white dot nodes branching outward, connected by thin lines, small red dots marking sub-branch points. A top nav bar offers tabs: **MAP / DASHBOARDS / CHART**. Department labels carry a one-line subtitle (e.g. Sales: "targeting · outreach · sequencing"; Back Office: "money in · books · office · people").

**Department zoom view** [0:09-0:10, 0:24-0:30]: clicking a department (or department node) zooms the constellation to fill the screen; individual agent-job nodes become visible as labeled circular icons with a connecting line tree, e.g. under Sales: "Lead Sourcing Manager," "Web & Maps Scraping," "List Building," "Social Mining," "Database Mining," with a "START HERE" node marking the entry point. Under Marketing: "Creative Strategist," "Hook Writing," "Script Writing," "Caption Writing." Nodes have small red dots (status indicators, likely "live/needs setup").

**Skill/job detail card** [0:33-0:44]: clicking an individual node opens a right-side or modal detail panel over the map, browser chrome visible confirming this is a real web app at `skilltree.altari.ai/map`. Example: "Cold Email Drafting" (tagged FULLY AUTONOMOUS · Sales · Outreach Writing) with structured sections:
  - one-line description
  - "1 runnable skill file · yours to download" + "Take it ↓" button
  - BREAKS INTO: chip tags (sequence-writer, subject-line-generator, spintax-builder)
  - BUILDS ON: chip tags (ICP Definition, Personalization Research)
  - WHAT IT REPLACES: prose ("A $60-80k/year SDR's core output — or a $2-4k/month agency retainer that sends the same template to everyone")
  - THE LADDER: three-row autonomy table — Human-led / Human-assisted / Fully autonomous, each with a one-sentence description of what that tier looks like
  - THE HUMAN: prose describing the human's approval role
  - BUILD NOTES: prose tips
  - TAKE THE SKILL: named downloadable skill (e.g. "Cold Email Copywriter")
  - YOUR STATUS: a 3-state progress bar (Not started / In development / Live)
  - "NEED HELP BUILDING THIS?" button
  A second example, "LinkedIn Outreach Specialist" [0:33], additionally shows a **SKILL.MD / COPY INSTALL COMMAND / COPY / DOWNLOAD** tab row, a REQUIRED API KEYS table (key name, "where to get it" URL, `.env` variable name — e.g. HeyReach → `HEYREACH_API_KEY`), a CONFIGURATION section describing a `knowledge/` folder convention (`knowledge/company.md`, `knowledge/offer.md`, `knowledge/voice.md`), a HOW TO RUN section with example natural-language invocation prompts, and an AGENT INSTRUCTIONS section showing the literal system-prompt block the agent runs on.

**"Company Knowledge Base" / Node Zero page** [0:13-0:14]: a separate reference doc titled "NODE ZERO — Company Knowledge Base (BEFORE EVERYTHING)" explaining a shared context layer every agent reads/writes: WHAT LIVES IN IT (`company.md`, `offer.md`, `voice.md`, `clients/`, `meetings/`, `playbooks/`, `STATE.md`), WHAT IT REPLACES, THE LADDER (same 3-tier autonomy framing as above), THE HUMAN, BUILD NOTES, TAKE THE SKILL, YOUR STATUS tracker, and a "NEED HELP BUILDING THIS?" CTA — i.e. the same card template used for individual skills is reused for the foundational knowledge-base skill.

## Concrete mechanism
The product is a browsable "org chart as skill tree": departments → individual agent jobs → individual downloadable skill files, each skill file annotated with what it replaces, what it depends on/breaks into, and a 3-tier autonomy ladder (human-led / human-assisted / fully autonomous) so the user can pick their own automation depth. A separate "Node Zero" knowledge-base skill is positioned as the prerequisite every other skill reads from.

## Named tools / repos / models / APIs
- SkillTree — product name, URL `skilltree.altari.ai/map` [frame, 0:34]
- HeyReach — named integration with required `HEYREACH_API_KEY` env var [frame, 0:33]
- Specific named skills shown: Cold Email Drafting / Cold Email Copywriter, LinkedIn Outreach Specialist, Lead Sourcing Manager, Web & Maps Scraping, List Building, Social Mining, Database Mining, Creative Strategist / Hook Writing / Script Writing / Caption Writing, Data Enrichment Specialist / Email Verification / Contact Enrichment / Account Enrichment / Fit Scoring, LinkedIn Messaging — all [frame]

## Specific claim / result
"137 AI agents run an entire company... AI can already do every single one of these jobs today" [audio, 0:00-0:29]. This is a marketing claim about job coverage, not a benchmark; the product itself (SkillTree) is real and browsable, but "AI can already do every single one" is asserted, not demonstrated on-screen.

## Novel / buildable moments (with timestamps)
- [0:00-0:11] The radial department constellation as an org-map IA — a strong alternative to a flat sidebar/list for browsing a large agent/skill catalog; department color-coding + particle "brain" center is a distinctive, reusable visual motif.
- [0:24-0:29] Zoom-to-department → individual labeled agent nodes with a "START HERE" entry marker — good pattern for onboarding users into a big automation catalog without overwhelming them.
- [0:33-0:44] The skill detail card template (BREAKS INTO / BUILDS ON / WHAT IT REPLACES / THE LADDER / THE HUMAN / BUILD NOTES / YOUR STATUS) is a directly reusable spec format for documenting any of our own kb skills or agents — it forces explicit statement of dependency graph, autonomy tier, and replacement value.
- [0:33] REQUIRED API KEYS table with direct "where to get it" links + literal env var name — a clean, minimal pattern for skill-level credential documentation.

## Transcript highlights
- "This is what it looks like when 137 AI agents run an entire company, seven departments and it's not just a crazy visual. It's a live map with working agents that you can actually click into and use." [0:00-0:11]
- "And right in the center we have the company brain, complete AI knowledge base." [0:11-0:15]
- "Each job has a real skill that you can actually open and run, not just the concept." [0:29-0:34]
- "There's a complete breakdown of what each of these replaces, the order to build them in, and it grades itself. Human-led, human-assisted, or fully autonomous." [0:34-0:42]

## Reliability
More substantive than the typical lead-magnet reel: the app (skilltree.altari.ai) is real and shown running with actual UI chrome (browser bar, tab title), not an animated mockup. The "137 agents run a company" framing is inflated marketing language, but the underlying artifact — a documented, autonomy-tiered, dependency-mapped skill catalog with a consistent detail-card template — is a solid UI/IA reference worth reusing for any internal agent-catalog or skill-marketplace build.
