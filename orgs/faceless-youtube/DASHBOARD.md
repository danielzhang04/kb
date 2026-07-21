# Analytics dashboard

The single, always-current analytics dashboard for every channel in this project — the visible face of
the pipeline's learning loop. It is produced by the `analytics-reporter` skill:
`analytics/<channel>/rollup.json` files → one self-contained `analytics/dashboard.html` (rebuilt on
every cycle by `build_dashboard.py`) → published as ONE Claude artifact at a **stable URL**.

## URL

**URL: (pending first publish)**

The orchestrator fills this line in the first time it publishes the dashboard artifact, then keeps
republishing the rebuilt HTML to that **same** artifact URL on every cycle (pass the URL to the
Artifact tool so it updates in place — never mint a new one). One dashboard, one link, always current.

## What it shows

- A tab per channel (CSS-only tabs — no JavaScript).
- Per video: views, watch time, avg view duration, subscribers gained, an inline-SVG retention curve,
  and an impressions-CTR bar.

## Freshness

YouTube Analytics lags ~24-48h, so the dashboard is current **as of the last `pull_analytics.py` run's
`--date`** — that is the correct fidelity, not staleness. See
`.claude/skills/analytics-reporter/SKILL.md` for the run procedure and the keep-last-good failure rule
(a failed pull never blanks the dashboard).
