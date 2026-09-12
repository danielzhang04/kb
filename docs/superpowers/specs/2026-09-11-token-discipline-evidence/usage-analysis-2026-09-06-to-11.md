# Token burn diagnosis: Claude Code + Codex, 2026-09-06 -> 2026-09-11

All costs are an ESTIMATED weighting to compare runtimes/sessions, not a real subscription bill
(subscription usage isn't metered in dollars). Rates used are listed in Schema notes.

## A. Per day, per runtime

### A1. Claude Code -- tokens + weighted cost by day (all model classes combined)

| Day | Input | Cache-create | Cache-read | Output | Turns (msgs) | Weighted cost |
|---|---:|---:|---:|---:|---:|---:|
| 2026-09-06 | 110.2k | 20.59M | 739.09M | 1.80M | 3268 | $1,076.30 |
| 2026-09-07 | 157.4k | 46.09M | 1182.79M | 2.70M | 6089 | $1,295.17 |
| 2026-09-08 | 25.4k | 10.14M | 212.76M | 1.31M | 1458 | $592.89 |
| 2026-09-09 | 6.6k | 4.87M | 78.04M | 294.7k | 573 | $230.51 |
| 2026-09-10 | 3.4k | 7.47M | 83.11M | 1.50M | 1715 | $266.10 |
| 2026-09-11 | 17.1k | 25.38M | 347.83M | 4.22M | 4689 | $897.44 |
| **TOTAL** | 320.1k | 114.54M | 2643.63M | 11.82M | 17792 | **$4,358.42** |

### A2. Claude Code -- weighted cost by day x model class

| Day | default | fable | haiku | opus | sonnet |
|---|---:|---:|---:|---:|---:|
| 2026-09-06 | - | $499.22 | - | $438.33 | $138.75 |
| 2026-09-07 | $0.00 | $818.30 | - | $89.90 | $386.97 |
| 2026-09-08 | - | $341.55 | - | $247.48 | $3.86 |
| 2026-09-09 | $0.00 | $142.79 | - | $87.72 | - |
| 2026-09-10 | $0.00 | - | - | $238.35 | $27.75 |
| 2026-09-11 | $0.00 | $191.06 | $0.88 | $605.22 | $100.28 |

### A3. Codex -- tokens + weighted cost by day (cumulative session totals attributed to session-start day)

| Day | Input (of which cached) | Output (of which reasoning) | Turns | Sessions | Weighted cost |
|---|---:|---:|---:|---:|---:|
| 2026-09-06 | 180.05M (173.06M) | 748.7k (270.8k) | 63 | 32 | $124.38 |
| 2026-09-07 | 23.64M (22.57M) | 157.8k (69.1k) | 10 | 10 | $17.02 |
| 2026-09-08 | 2208.19M (2144.20M) | 8.19M (2.79M) | 682 | 64 | $1,502.03 |
| 2026-09-09 | 1292.99M (1240.97M) | 3.97M (1.13M) | 502 | 63 | $880.37 |
| 2026-09-10 | 149.79M (146.87M) | 501.5k (143.9k) | 45 | 9 | $100.46 |
| 2026-09-11 | 431.98M (413.99M) | 1.66M (635.5k) | 480 | 16 | $297.87 |
| **TOTAL** | 4286.64M (4141.66M) | 15.24M (5.04M) | 1782 | 194 | **$2,922.12** |

## B. Top 15 Claude Code sessions by weighted cost (top-level session + its subagents)

| Session (short) | Project dir | Top model | Turns | Subagents (models) | Input | Cache-create | Cache-read | Output | Cache-read share | Avg ctx/turn | Cost |
|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| d270c80a | C--Users-danie-kb | claude-fable-5-1 | 718 | 15 (claude-opus-5, claude-sonnet-5) | 111.2k | 17.22M | 591.66M | 1.37M | 97% | 540.6k **[>200k]** | $1,108.32 |
| 89bf433c | C--Users-danie-kb | claude-fable-5-1 | 559 | 35 (claude-opus-5, claude-sonnet-5) | 151.6k | 29.77M | 1212.72M | 2.64M | 97% | 500.3k **[>200k]** | $1,085.17 |
| d1fe8583 | C--Users-danie | claude-fable-5-1 | 472 | 24 (claude-opus-5) | 14.2k | 7.76M | 220.48M | 1.09M | 96% | 257.2k **[>200k]** | $558.33 |
| 87f62e0a | C--Users-danie-kb | claude-fable-5-1 | 371 | 24 (claude-haiku-4-5-20251001, claude-opus-5, claude-sonnet-5) | 10.6k | 8.68M | 215.04M | 900.9k | 96% | 234.8k **[>200k]** | $316.31 |
| 4dd42e67 | C--Users-danie-kb | claude-fable-5-1 | 93 | 3 (claude-opus-5, claude-sonnet-5) | 12.8k | 2.41M | 105.48M | 160.3k | 98% | 881.9k **[>200k]** | $200.81 |
| 2131d999 | C--Users-danie | claude-fable-5-1 | 210 | 5 (claude-opus-5) | 4.5k | 1.08M | 33.42M | 146.5k | 96% | 137.7k | $81.47 |
| 5a4f7a96 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 200 | 0 (-) | 408 | 842.7k | 12.08M | 298.2k | 91% | 60.4k | $56.29 |
| 7a5b2f09 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 125 | 0 (-) | 254 | 873.4k | 5.57M | 185.1k | 84% | 44.5k | $38.61 |
| c7147f34 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 164 | 0 (-) | 330 | 586.6k | 8.01M | 152.4k | 92% | 48.8k | $34.45 |
| 9464402e | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 90 | 0 (-) | 182 | 962.6k | 4.11M | 84.8k | 80% | 45.7k | $30.57 |
| c04dba33 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 151 | 0 (-) | 302 | 453.7k | 7.41M | 115.8k | 93% | 49.1k | $28.31 |
| 8236926b | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 110 | 0 (-) | 230 | 360.5k | 5.19M | 159.7k | 91% | 47.1k | $26.52 |
| 259e7e75 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 90 | 0 (-) | 186 | 282.0k | 6.22M | 142.6k | 94% | 69.2k | $25.33 |
| 6454606a | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 113 | 0 (-) | 234 | 475.8k | 4.84M | 115.4k | 89% | 42.8k | $24.84 |
| e0e168ba | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 69 | 0 (-) | 142 | 478.8k | 2.51M | 150.7k | 80% | 36.4k | $24.04 |

Sessions with avg context/turn > 200k across the whole window: **5** (top 15 above marks them inline; full window count includes sessions outside the top 15).

## C. Attribution of total weighted cost

### C1. Top-level session turns vs subagent turns (Claude only; Codex has no subagent concept here)
| Bucket | Weighted cost | Share of Claude total |
|---|---:|---:|
| Top-level session turns | $2,982.46 | 68.4% |
| Subagent turns | $1,375.96 | 31.6% |

### C2. By model
| Model class | Runtime | Weighted cost | Share of grand total |
|---|---|---:|---:|
| fable | claude | $1,992.93 | 27.4% |
| opus | claude | $1,706.99 | 23.4% |
| gpt-6-astra | codex | $927.39 | 12.7% |
| gpt-5.6-sol | codex | $922.89 | 12.7% |
| gpt-5.6-terra | codex | $776.27 | 10.7% |
| sonnet | claude | $657.62 | 9.0% |
| codex-auto-review | codex | $266.55 | 3.7% |
| gpt-5.6-luna | codex | $29.03 | 0.4% |
| haiku | claude | $0.88 | 0.0% |
| default | claude | $0.00 | 0.0% |
| unknown | codex | $0.00 | 0.0% |
| **TOTAL** | | **$7,280.54** | 100.0% |

### C3. Cache-read vs everything else
| Bucket | Weighted cost | Share |
|---|---:|---:|
| Cache-read (10%/50% discounted re-reads) | $5,113.63 | 70.2% |
| Everything else (fresh input + cache-create + output) | $2,166.91 | 29.8% |

**Single largest driver:** `fable` on claude at $1,992.93 (27.4% of the $7,280.54 window total).

## D. Context bloat: top 5 sessions (by weighted cost)

### d270c80a (C--Users-danie-kb) -- $1,108.32

Tool-result bytes by tool name:
| Tool | Bytes | Approx share of tool-result bytes |
|---|---:|---:|
| Bash | 1,752,430 | 52% |
| Read | 1,437,581 | 43% |
| WebSearch | 47,129 | 1% |
| mcp__chrome-devtools__evaluate_script | 37,393 | 1% |
| Edit | 24,863 | 1% |
| mcp__chrome-devtools__navigate_page | 22,648 | 1% |
| Agent | 16,980 | 1% |
| Monitor | 9,405 | 0% |
| Grep | 7,389 | 0% |
| Write | 6,172 | 0% |
| mcp__chrome-devtools__new_page | 3,575 | 0% |
| mcp__google-workspace__search_gmail_messages | 3,517 | 0% |

Largest 5 individual tool results:
| Bytes | Tool | First 80 chars |
|---:|---|---|
| 223,023 | Read | [{"type": "text", "text": "PDF file read: C:\\Users\\danie\\AppData\\Local\\kb-p |
| 222,993 | Read | [{"type": "text", "text": "PDF file read: C:\\Users\\danie\\Downloads\\Networkin |
| 115,713 | Read | [{"type": "text", "text": "PDF file read: C:\\Users\\danie\\OneDrive\\Documents\ |
| 58,623 | Read | 1	# Prospecting + Outreach — Design Spec r3 2	 3	Date: 2026-09-03 · Branch: `cla |
| 57,026 | Read | 1	# Prospecting P8 — Affinity (fit-first selection and copy doctrine) 2	 3	Date: |

**6 individual tool result(s) > 50 KB** in this session (largest: 223,023 bytes, `Read`).

### 89bf433c (C--Users-danie-kb) -- $1,085.17

Tool-result bytes by tool name:
| Tool | Bytes | Approx share of tool-result bytes |
|---|---:|---:|
| Read | 9,762,587 | 74% |
| Bash | 3,065,619 | 23% |
| WebSearch | 191,974 | 1% |
| Edit | 87,488 | 1% |
| Grep | 60,076 | 0% |
| Agent | 39,620 | 0% |
| WebFetch | 24,739 | 0% |
| Write | 12,702 | 0% |
| PowerShell | 8,343 | 0% |
| Monitor | 1,882 | 0% |
| SendMessage | 1,763 | 0% |
| TaskStop | 1,636 | 0% |

Largest 5 individual tool results:
| Bytes | Tool | First 80 chars |
|---:|---|---|
| 668,481 | Read | [{"type": "image", "source": {"type": "base64", "data": "/9j/4AAQSkZJRgABAgAAAQA |
| 650,045 | Read | [{"type": "image", "source": {"type": "base64", "data": "/9j/4AAQSkZJRgABAgAAAQA |
| 639,665 | Read | [{"type": "image", "source": {"type": "base64", "data": "/9j/4AAQSkZJRgABAgAAAQA |
| 551,301 | Read | [{"type": "image", "source": {"type": "base64", "data": "/9j/4AAQSkZJRgABAgAAAQA |
| 533,865 | Read | [{"type": "image", "source": {"type": "base64", "data": "/9j/4AAQSkZJRgABAgAAAQA |

**17 individual tool result(s) > 50 KB** in this session (largest: 668,481 bytes, `Read`).

### d1fe8583 (C--Users-danie) -- $558.33

Tool-result bytes by tool name:
| Tool | Bytes | Approx share of tool-result bytes |
|---|---:|---:|
| mcp__plugin_claude-video-vision_claude-video-vision__video_watch | 2,150,833 | 51% |
| Read | 827,308 | 19% |
| Bash | 720,598 | 17% |
| mcp__plugin_claude-video-vision_claude-video-vision__video_detail | 336,539 | 8% |
| WebSearch | 36,819 | 1% |
| mcp__chrome-devtools__take_snapshot | 33,513 | 1% |
| Agent | 27,096 | 1% |
| mcp__chrome-devtools__evaluate_script | 22,619 | 1% |
| WebFetch | 18,863 | 0% |
| Write | 17,026 | 0% |
| mcp__chrome-devtools__close_page | 15,360 | 0% |
| Edit | 15,296 | 0% |

Largest 5 individual tool results:
| Bytes | Tool | First 80 chars |
|---:|---|---|
| 2,150,833 | mcp__plugin_claude-video-vision_claude-video-vision__video_watch | [{"type": "text", "text": "## Session Manifest\n{\n  \"video_hash\": \"959ea6174 |
| 336,539 | mcp__plugin_claude-video-vision_claude-video-vision__video_detail | [{"type": "text", "text": "## Session Manifest\n{\n  \"video_hash\": \"959ea6174 |
| 184,280 | Read | [{"type": "image", "source": {"type": "base64", "data": "iVBORw0KGgoAAAANSUhEUgA |
| 50,365 | Read | 1	Python for Data Analysis, 3E - 2  Python Language Basics, IPython, and Jupyter |
| 42,613 | Read | 1	What Every Programmer Absolutely, Positively Needs to Know About Encodings and |

**3 individual tool result(s) > 50 KB** in this session (largest: 2,150,833 bytes, `mcp__plugin_claude-video-vision_claude-video-vision__video_watch`).

### 87f62e0a (C--Users-danie-kb) -- $316.31

Tool-result bytes by tool name:
| Tool | Bytes | Approx share of tool-result bytes |
|---|---:|---:|
| Read | 1,224,484 | 48% |
| Bash | 1,175,718 | 46% |
| WebFetch | 44,739 | 2% |
| WebSearch | 35,168 | 1% |
| Agent | 27,168 | 1% |
| Edit | 15,374 | 1% |
| Write | 7,904 | 0% |
| SendMessage | 1,962 | 0% |
| TaskCreate | 464 | 0% |
| ToolSearch | 325 | 0% |
| Skill | 182 | 0% |
| TaskUpdate | 154 | 0% |

Largest 5 individual tool results:
| Bytes | Tool | First 80 chars |
|---:|---|---|
| 51,684 | Read | 1	# Review package: 3ae6348a..076a4370 2	 3	## Commits 4	076a4370 fix(scripts):  |
| 42,426 | Read | 1	# Token burn diagnosis: Claude Code + Codex, 2026-09-06 -> 2026-09-11 2	 3	All |
| 41,611 | WebFetch | > ## Documentation Index > Fetch the complete documentation index at: https://co |
| 36,703 | Read | 1	# Review package: 264f1130..afb73435 2	 3	## Commits 4	afb73435 chore(hooks):  |
| 31,106 | Read | 1	# Proposal: spawn context-load + model-verify hooks — SubagentStart + PreToolU |

**1 individual tool result(s) > 50 KB** in this session (largest: 51,684 bytes, `Read`).

### 4dd42e67 (C--Users-danie-kb) -- $200.81

Tool-result bytes by tool name:
| Tool | Bytes | Approx share of tool-result bytes |
|---|---:|---:|
| Bash | 276,243 | 98% |
| Agent | 2,264 | 1% |
| SendMessage | 651 | 0% |
| Write | 445 | 0% |
| PowerShell | 355 | 0% |
| Monitor | 209 | 0% |
| TaskUpdate | 156 | 0% |
| TaskCreate | 153 | 0% |
| Edit | 96 | 0% |

Largest 5 individual tool results:
| Bytes | Tool | First 80 chars |
|---:|---|---|
| 17,914 | Bash |  M dashboard/server/control/launch.test.ts  M dashboard/server/control/launch.ts |
| 17,601 | Bash |       : attemptByRef.get(turnOwnerStage?.currentAttemptRef ?? '');     const que |
| 15,368 | Bash | 2026-09-06T19:03:48+00:00 kb node[671367]: [attempt-session] control=iteration-t |
| 12,607 | Bash |   validateIterationDurability(     bundle.stages, bundle.attempts, bundle.sessio |
| 11,532 | Bash | == attempts (logicalGeneration != null) == {'attemptRef': 'attempt-1b60ef2b-2a63 |

## E. Delegation pattern (boss/orchestrator sessions)

Sessions with a Fable/Opus top-level model and >= 3 subagents:

| Session | Project | Top model | Subagents | Parent cost | Children cost | Parent share |
|---|---|---|---:|---:|---:|---:|
| d270c80a | C--Users-danie-kb | claude-fable-5-1 | 15 | $726.24 | $382.08 | 66% |
| 89bf433c | C--Users-danie-kb | claude-fable-5-1 | 35 | $562.89 | $522.28 | 52% |
| d1fe8583 | C--Users-danie | claude-fable-5-1 | 24 | $285.07 | $273.26 | 51% |
| 87f62e0a | C--Users-danie-kb | claude-fable-5-1 | 24 | $191.06 | $125.25 | 60% |
| 4dd42e67 | C--Users-danie-kb | claude-fable-5-1 | 3 | $148.68 | $52.12 | 74% |
| 2131d999 | C--Users-danie | claude-fable-5-1 | 5 | $60.55 | $20.91 | 74% |

Across these 6 boss-style sessions: parent turns = $1,974.50 (59%), subagent turns = $1,375.91 (41%) of $3,350.40 combined.

Long sessions (>=20 turns) with NO subagents that did heavy tool work themselves (>200KB raw tool-result bytes):

| Session | Project | Model | Turns | Tool-result bytes | Cost |
|---|---|---|---:|---:|---:|
| 9464402e | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 90 | 526,773 | $30.57 |
| 7bc70471 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 67 | 523,413 | $22.64 |
| 26762c07 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 50 | 516,115 | $23.57 |
| 5a4f7a96 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 200 | 261,399 | $56.29 |
| 632e65c2 | C--Users-danie-kb--private-codex-worktrees-kb | claude-sonnet-5 | 163 | 252,980 | $5.58 |
| d9f0d614 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 35 | 248,735 | $7.40 |
| 35a19997 | C--Users-danie-kb--private-codex-worktrees-kb | claude-sonnet-5 | 206 | 247,483 | $7.12 |
| f4988f20 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 46 | 230,959 | $9.40 |
| 48939310 | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 40 | 229,337 | $12.39 |
| 26e7675f | C--Users-danie-kb--private-codex-worktrees-kb | claude-opus-5 | 30 | 222,316 | $11.22 |

## F. Codex sessions

### F1. Summary by model x reasoning effort x dispatch mode
| Model | Effort | Mode | Sessions | Total tokens | Weighted cost |
|---|---|---|---:|---:|---:|
| gpt-6-astra | high | interactive | 24 | 1383.30M | $927.39 |
| gpt-5.6-sol | high | interactive | 52 | 1264.77M | $854.06 |
| gpt-5.6-terra | high | interactive | 30 | 1055.67M | $716.50 |
| codex-auto-review | low | interactive | 45 | 367.88M | $266.55 |
| gpt-5.6-sol | medium | interactive | 2 | 103.24M | $68.83 |
| gpt-5.6-terra | high | dispatched | 27 | 53.93M | $38.99 |
| gpt-5.6-terra | medium | interactive | 4 | 30.53M | $20.77 |
| gpt-5.6-luna | high | interactive | 6 | 26.40M | $17.95 |
| gpt-5.6-luna | medium | interactive | 2 | 15.95M | $10.91 |
| gpt-5.6-luna | low | interactive | 1 | 201.6k | $0.17 |
| unknown | unknown | interactive | 1 | 0 | $0.00 |

### F2. Top 15 Codex sessions by total tokens
| Session (short) | cwd | Model | Effort | Mode | Turns | Input (cached) | Output (reasoning) | Total tokens | Cost |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| 01a08320 | ~\kb | gpt-6-astra | high | interactive | 16 | 293.07M (288.58M) | 995.9k (435.0k) | 294.06M | $195.93 |
| 01a07f16 | ~\kb | gpt-6-astra | high | interactive | 25 | 285.04M (280.44M) | 930.9k (370.5k) | 285.98M | $190.34 |
| 01a07f15 | ~\kb | gpt-6-astra | high | interactive | 23 | 265.98M (260.85M) | 1.04M (389.4k) | 267.02M | $179.87 |
| 01a08320 | ~\kb | gpt-5.6-sol | high | interactive | 14 | 160.61M (158.03M) | 636.8k (196.5k) | 161.25M | $108.36 |
| 01a07f16 | ~\kb | gpt-5.6-terra | high | interactive | 67 | 157.59M (153.81M) | 555.9k (138.1k) | 158.15M | $106.42 |
| 01a07f16 | ~\kb | gpt-5.6-terra | high | interactive | 53 | 149.54M (145.92M) | 525.1k (153.2k) | 150.07M | $100.97 |
| 01a07f16 | ~\kb | gpt-5.6-terra | high | interactive | 41 | 149.23M (146.06M) | 638.4k (174.8k) | 149.87M | $101.64 |
| 01a07f16 | ~\kb | gpt-5.6-terra | high | interactive | 37 | 148.48M (145.26M) | 595.9k (187.5k) | 149.08M | $100.77 |
| 01a08320 | ~\kb | gpt-5.6-sol | high | interactive | 10 | 143.11M (140.55M) | 471.3k (139.6k) | 143.58M | $95.76 |
| 01a08320 | ~\kb | gpt-6-astra | high | interactive | 52 | 140.14M (137.83M) | 303.3k (94.1k) | 140.45M | $92.07 |
| 01a08ea5 | ~\kb | gpt-6-astra | high | interactive | 4 | 118.19M (115.26M) | 424.8k (145.7k) | 118.62M | $79.95 |
| 01a07f16 | ~\kb | gpt-5.6-sol | high | interactive | 34 | 107.03M (104.69M) | 356.2k (104.0k) | 107.39M | $71.92 |
| 01a08e9b | ~\kb | gpt-6-astra | high | interactive | 3 | 105.40M (103.18M) | 429.4k (142.4k) | 105.83M | $71.56 |
| 01a07f15 | ~\kb | gpt-5.6-sol | high | interactive | 49 | 103.43M (101.12M) | 281.7k (86.5k) | 103.71M | $68.90 |
| 01a08e9b | ~\kb | gpt-6-astra | high | interactive | 5 | 97.45M (94.31M) | 494.2k (205.0k) | 97.95M | $67.81 |

## G. Compaction events

Sessions with >=1 compaction event: **27** (of 335 sessions with any activity in window)

| Session | Project | Compaction events | Max ctx/turn seen |
|---|---|---:|---:|
| 26762c07 | C--Users-danie-kb--private-codex-worktrees-kb | 4 | 76.7k |
| 7bc70471 | C--Users-danie-kb--private-codex-worktrees-kb | 4 | 74.3k |
| 9464402e | C--Users-danie-kb--private-codex-worktrees-kb | 4 | 81.2k |
| 35a19997 | C--Users-danie-kb--private-codex-worktrees-kb | 3 | 81.5k |
| 5a4f7a96 | C--Users-danie-kb--private-codex-worktrees-kb | 2 | 103.2k |
| 632e65c2 | C--Users-danie-kb--private-codex-worktrees-kb | 2 | 81.1k |
| 6454606a | C--Users-danie-kb--private-codex-worktrees-kb | 2 | 78.6k |
| 7a5b2f09 | C--Users-danie-kb--private-codex-worktrees-kb | 2 | 76.8k |
| b36bad01 | C--Users-danie-kb--private-codex-worktrees-kb | 2 | 73.9k |
| c04dba33 | C--Users-danie-kb--private-codex-worktrees-kb | 2 | 77.8k |
| c7147f34 | C--Users-danie-kb--private-codex-worktrees-kb | 2 | 79.4k |
| 08b441f7 | C--Users-danie-kb--private-codex-worktrees-kb | 1 | 78.8k |
| 0adcebbb | C--Users-danie-kb--private-codex-worktrees-kb | 1 | 77.2k |
| 1b33edea | C--Users-danie-kb--private-codex-worktrees-kb | 1 | 76.4k |
| 23c21272 | C--Users-danie-kb--private-codex-worktrees-kb | 1 | 62.6k |

Sessions that ran with a turn context > 300k WITHOUT any detected compaction: **5**

| Session | Project | Max ctx/turn seen |
|---|---|---:|
| 4dd42e67 | C--Users-danie-kb | 930.9k |
| d270c80a | C--Users-danie-kb | 798.2k |
| 89bf433c | C--Users-danie-kb | 736.9k |
| d1fe8583 | C--Users-danie | 470.8k |
| 87f62e0a | C--Users-danie-kb | 390.5k |

## Top 5 drivers (ranked by weighted cost, with evidence)

1. Claude session d270c80a (C--Users-danie-kb, top model claude-fable-5-1, 15 subagents) -- $1,108.32, 610.36M tokens, cache-read share 97%.
2. Claude session 89bf433c (C--Users-danie-kb, top model claude-fable-5-1, 35 subagents) -- $1,085.17, 1245.28M tokens, cache-read share 97%.
3. Claude session d1fe8583 (C--Users-danie, top model claude-fable-5-1, 24 subagents) -- $558.33, 229.35M tokens, cache-read share 96%.
4. Claude session 87f62e0a (C--Users-danie-kb, top model claude-fable-5-1, 24 subagents) -- $316.31, 224.63M tokens, cache-read share 96%.
5. Claude session 4dd42e67 (C--Users-danie-kb, top model claude-fable-5-1, 3 subagents) -- $200.81, 108.06M tokens, cache-read share 98%.

## Notable patterns (manual follow-up on the automated tables above)

**Codex has its own "boss" pattern, not just Claude.** The top 3 Codex sessions by tokens (F2: `01a08320`,
`01a07f16`, `01a07f15`, all `gpt-6-astra`/high effort) each show `total_token_usage` growing smoothly across
2,000-3,200 individual `token_count` events per session (traced directly from the rollout JSONL, e.g. session
`01a08320` hit 3,159 token_count events climbing from 17k to 294M cumulative tokens, ~90% of it cached-context
re-sends), spanning multiple `cwd`s (`kb`, `kb/_private/codex-worktrees/boss-remote-context-20260908`,
`kb/_private/codex-worktrees/prospecting-e2e-20260908`) inside ONE rollout file -- i.e. a long agentic loop
(likely threaded across several `codex --follow-up` continuations, consistent with the known
`codex-followup-loses-cwd.md` lesson) that never compacted its context. Same failure mode as the Claude Fable
boss sessions in table B (unbounded context regrowth, no compaction), just cheaper per-token here because
Codex's cached-input discount (est. 50%) is steeper than Claude's cache-read discount is generous (est. 10% of
a much higher per-token Fable/Opus price) -- so the Claude version of this failure mode costs far more per
token burned.

**The single busiest project dir is an automated queue, not a human terminal.**
`C--Users-danie-kb--private-codex-worktrees-kb-vm-overhaul-resume-20260907` contributed 132 Claude Code
transcripts, ALL in-window (see Schema notes dir table) -- more distinct sessions than any other project dir.
Reading one at random (`6d20d59d...`) shows its first real event is a `queue-operation enqueue` whose content
begins: "The root terminal assigns you, a Claude Opus subagent under its repository codex-worker identity, the
read-only design review in C:/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-ops-20260907/queue/...".
These are fleet-dispatched, queue-driven review workers spawned by an automated control loop (not Daniel typing
into a terminal). Individually cheap (table E's solo-heavy list shows most of them in the $5-60 range), but
there are 132 of them in six days from this one dispatcher alone -- volume, not any single session, is the
driver here, and it is NOT visible anywhere in kb's own ledgers (see Schema notes).

