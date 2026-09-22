# ccusage-dashboard

English · [简体中文](README.md)

A self-hosted dashboard for your local Claude Code usage: tokens and estimated cost broken down by day, project, model and task. Bilingual UI (English / 简体中文), follows your system light/dark theme.

Static page + a cron job that regenerates JSON; nginx only serves files. No backend process, no build step.

![screenshot](docs/screenshot-en.png)

> The screenshot uses anonymized demo data.

```
.
├── bin/aggregate.mjs    # scans ~/.claude/projects/**/*.jsonl, aggregates by project×date×model + task segmentation
├── bin/refresh.sh       # cron every 5 min: ccusage JSON + aggregate.mjs -> www/data/
├── bin/install-nginx.sh # renders the nginx site and enables it (needs sudo)
├── nginx/*.template     # site template, __ROOT__ / __PORT__ filled in at install time
├── www/index.html       # the whole page (Chart.js, no build)
└── www/data/*.json      # generated data, never committed
```

## Install

```bash
npm i                                  # pins ccusage@20 locally
( crontab -l 2>/dev/null; echo "*/5 * * * * $PWD/bin/refresh.sh >/dev/null 2>&1" ) | crontab -
bin/refresh.sh                         # generate data once (~12s)
sudo PORT=8090 bin/install-nginx.sh    # render + enable the nginx site
curl -s http://127.0.0.1:8090/healthz
```

No absolute paths are baked in: `install-nginx.sh` renders `nginx/ccusage-dashboard.conf` (gitignored) from the repo's real location, and both `refresh.sh` and `aggregate.mjs` resolve paths from the script location.

For remote access use an SSH tunnel rather than opening a firewall port — the page shows project paths and cost:

```bash
gcloud compute ssh <instance> --zone <zone> -- -N -L 8090:localhost:8090
```

## What's on the page

- **KPI cards** — all follow the `1D / 7D / 30D / 90D / ALL` range picker: cost, billing windows, busiest day, tokens, requests, sessions, active projects, task complexity
- **Daily cost · by model** — stacked bars + 7-day average, each bar labelled with that day's cost and tokens
- **Project cost & requests** — two series, requests read off the top axis
- **Daily cost by project** / **Billing window history** (last 12 five-hour windows)
- **Daily activity** / **Activity heatmap** (weekday × hour)
- **Current 5-hour billing window** — from ccusage blocks, to compare against Max/Pro limits
- **Projects** / **Recent sessions** tables

Three buttons top right: `文 / EN` switches language, `◐` switches theme, `↻` re-fetches. Both choices persist in localStorage; `?lang=en` and `?theme=dark` also work.

## How the numbers are computed

- Cost = tokens × public LiteLLM prices (input / output / 5m cache write / 1h cache write / cache read priced separately). The price table is fetched every 24h into `www/data/pricing.json`. **These are estimates — subscription plans are not billed this way.**
- Deduplication matches ccusage (`message.id + requestId`), `<synthetic>` is skipped.
- Days are cut in your local timezone.
- **Tasks**: one user prompt through every turn before the next one. Each task records turns, tool calls, files touched, peak context, context compactions, tool errors, xhigh turns, duration, cost and tokens.
  - A *real task* has at least 1 tool call or ≥3 turns — short chit-chat would otherwise drag every median to 0.
  - A *heavy task* compacted its context, made ≥20 tool calls, or reached ≥500K context.
- Billing windows come from ccusage blocks, which **include other agents on the machine** (codex / kimi …), so the window total is larger than the Claude Code cost on this page.
- The footer reconciles this page against ccusage.

## Project display names

To give a project a nicer label, drop it in `www/data/aliases.json` (gitignored, so it never reaches the repo):

```json
{ "-home-me-work-some-repo": "nicer name" }
```

The key is the project id — the cwd with `/` replaced by `-`.

## Operating it

```bash
bin/refresh.sh                 # refresh now
node bin/aggregate.mjs         # re-aggregate only (skips ccusage, ~5s)
tail logs/refresh.log
crontab -l | grep ccusage      # */5 * * * *
npm i ccusage@20               # upgrade ccusage (stay on 20.x)
```

## Note

`www/data/` is gitignored: it contains absolute project paths, task-level detail and your hostname. Don't commit generated data.

## License

MIT
