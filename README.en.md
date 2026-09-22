# ccusage-dashboard

English · [简体中文](README.md)

A local dashboard for Claude Code usage: tokens and estimated cost by day, project, model and task. A cron job aggregates the transcripts in `~/.claude/projects` every 5 minutes; a single static page shows them. English / 中文, light / dark, nothing leaves the machine.

![screenshot](docs/screenshot-en.png)

<sub>Screenshot uses anonymized demo data</sub>

## Quick start

Needs Node.js ≥ 18. On Linux with nginx the site is served by nginx; otherwise (including macOS) by the built-in server.

```bash
git clone https://github.com/ZhangYongguang5467/ccusage-dashboard.git
cd ccusage-dashboard
bin/dash install      # deps + data + cron + server; sudo only for the nginx step
```

Open <http://localhost:8090/>. Port taken, or want another one: `PORT=8091 bin/dash install`.

If `ccusage` can't be installed (e.g. the npm registry returns 403), install still completes; only the billing-window panels are unavailable until it is.

## Commands

| Command | What it does |
|---|---|
| `bin/dash status` | Server, cron and data freshness |
| `bin/dash stop` / `start` / `restart` | Stop / start the server and cron; data is kept |
| `bin/dash refresh` | Regenerate the data now |
| `bin/dash uninstall` | Stop and delete data / logs / node_modules |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8090` | Listen port |
| `SERVER` | auto | `nginx` or `node` |
| `HOST` | `127.0.0.1` | Bind address of the built-in server |

- Project aliases: `www/data/aliases.json`, e.g. `{ "-home-me-work-repo": "nicer name" }`; the key is the cwd with `/` replaced by `-`
- URL params: `?lang=en|zh`, `?theme=dark|light`
- Remote access: use an SSH tunnel (`ssh -L 8090:localhost:8090 <host>`); the page shows project paths and cost, don't expose the port

## Metrics

- **Cost**: tokens × public LiteLLM prices, with input / output / cache write / cache read priced separately. Estimates only — subscription plans are not billed this way
- **Dedup**: same as ccusage (`message.id + requestId`)
- **Tasks**: one user prompt through every turn before the next. A *real task* has ≥1 tool call or ≥3 turns; a *heavy task* compacted its context, made ≥20 tool calls, or reached ≥500K context
- **Billing windows**: from ccusage blocks, which include other agents on the machine (codex, kimi, …), so their total exceeds the Claude Code cost shown here
- Days follow the local timezone; the footer reconciles against ccusage

## Privacy

Only local files are read and no usage data is uploaded; the single outbound request fetches the LiteLLM price table once every 24h. `www/data/` contains project paths and the hostname and is gitignored.

## License

MIT
