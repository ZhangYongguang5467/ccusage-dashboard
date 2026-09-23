#!/usr/bin/env node
// Aggregate Claude Code usage from ~/.claude/projects/**/*.jsonl
// Output: per-project x per-day x per-model cost/tokens, hourly heatmap, sessions.
// Pricing: LiteLLM model_prices_and_context_window.json (same source ccusage uses).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const HOME = os.homedir();
const ROOTS = [
  process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects') : null,
  path.join(HOME, '.claude', 'projects'),
  path.join(HOME, '.config', 'claude', 'projects'),
].filter(Boolean).filter((p) => fs.existsSync(p));

const OUT_DIR = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'www', 'data');
const PRICING_CACHE = path.join(OUT_DIR, 'pricing.json');
const PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

// ---------- pricing ----------
async function loadPricing(maxAge = 24 * 3600e3) {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(PRICING_CACHE, 'utf8')); } catch {}
  const fresh = cached && Date.now() - (cached._fetchedAt || 0) < maxAge;
  if (fresh) return cached;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(PRICING_URL, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    json._fetchedAt = Date.now();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(PRICING_CACHE, JSON.stringify(json));
    return json;
  } catch (e) {
    console.error('pricing fetch failed, using cache:', e.message);
    if (cached) return cached;
    return {};
  }
}

const priceMemo = new Map();
function findPrice(pricing, model) {
  if (priceMemo.has(model)) return priceMemo.get(model);
  const candidates = [model, `anthropic/${model}`, `claude-3-5-${model}`, `anthropic/claude-3-5-${model}`];
  let p = null;
  for (const c of candidates) if (pricing[c]) { p = pricing[c]; break; }
  if (!p) {
    // fuzzy: key contains model name and is an anthropic model
    const lower = model.toLowerCase();
    for (const [k, v] of Object.entries(pricing)) {
      if (k.toLowerCase().includes(lower) && (v.litellm_provider === 'anthropic' || k.startsWith('claude'))) { p = v; break; }
    }
  }
  const out = p ? {
    input: p.input_cost_per_token || 0,
    output: p.output_cost_per_token || 0,
    cacheCreate: p.cache_creation_input_token_cost || 0,
    cacheCreate1h: p.cache_creation_input_token_cost_above_1hr || p.cache_creation_input_token_cost || 0,
    cacheRead: p.cache_read_input_token_cost || 0,
    found: true,
  } : { input: 0, output: 0, cacheCreate: 0, cacheCreate1h: 0, cacheRead: 0, found: false };
  priceMemo.set(model, out);
  return out;
}

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
function localDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function cwdDisplay(cwd) {
  if (!cwd) return null;
  return cwd.startsWith(HOME) ? '~' + cwd.slice(HOME.length) : cwd;
}
function add(obj, k, v) { obj[k] = (obj[k] || 0) + v; }

// accumulators
const projects = new Map(); // id -> {...}
const dailyByProject = new Map(); // `${date}|${pid}` -> {cost,tokens}
const dailyByModel = new Map(); // `${date}|${model}` -> {...}
const models = new Map(); // model -> {cost,tokens,...}
const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ cost: 0, msgs: 0 })));
const sessions = new Map(); // sid -> {...}
const dailyActivity = new Map(); // date -> {sessions:Set, msgs, output}
const entries = new Map(); // `${message.id}:${requestId}` -> one API response
const toolIds = new Set();
const taskList = []; // one per task: a user prompt and every assistant turn before the next one
let tasks = [];
const unknownModels = new Set();
let totals = { cost: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, msgs: 0, files: 0, lines: 0 };

// Pass 1: collect API responses. One response is logged as several lines (one per content block) sharing the same
// id; the usage on the earlier lines is a streaming snapshot, so keep the copy with the most output tokens.
async function readFile(pid, file, sid) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  // A task opens on a user prompt and closes on the next one (or at end of file)
  let task = null;
  for await (const line of rl) {
    if (!line) continue;
    totals.lines++;
    if (!line.includes('"usage"')) {
      if (task) {
        if (line.includes('"is_error":true')) { task.e++; continue; }
        if (line.includes('compact_boundary')) { task.k++; continue; }
      }
      if (!line.includes('"type":"user"') || line.includes('"tool_result"')) continue;
      let ou; try { ou = JSON.parse(line); } catch { continue; }
      if (ou.isMeta || ou.isSidechain || ou.type !== 'user') continue;
      const uc = ou.message?.content;
      if (!(typeof uc === 'string' || (Array.isArray(uc) && uc.some((b) => b?.type === 'text')))) continue;
      const uts = new Date(ou.timestamp || 0);
      if (isNaN(uts)) continue;
      task = { pid, d: localDate(uts), m: 0, t: 0, f: new Set(), c: 0, k: 0, e: 0, x: 0, cost: 0, tok: 0, t0: uts.getTime(), end: 0 };
      taskList.push(task);
      continue;
    }
    let o; try { o = JSON.parse(line); } catch { continue; }
    const m = o.message; if (!m || !m.usage) continue;
    const model = m.model; if (!model || model === '<synthetic>') continue;
    const ts = new Date(o.timestamp || 0);
    if (isNaN(ts)) continue;
    // each line carries its own blocks, so tools are counted per line, once per tool_use id (resumed sessions repeat them)
    if (task && Array.isArray(m.content)) for (const b of m.content) {
      if (!b || b.type !== 'tool_use' || (b.id && toolIds.has(b.id))) continue;
      if (b.id) toolIds.add(b.id);
      task.t++; const fp = b.input?.file_path || b.input?.notebook_path; if (fp) task.f.add(fp);
    }
    const key = m.id && o.requestId ? m.id + ':' + o.requestId : entries.size + ':' + file;
    const prev = entries.get(key);
    if (!prev) entries.set(key, { pid, sid, ts, model, u: m.usage, costUSD: o.costUSD, cwd: o.cwd, task, xhigh: o.effort === 'xhigh' || o.perTurnEffort === 'xhigh' });
    else if ((m.usage.output_tokens || 0) > (prev.u.output_tokens || 0)) { prev.u = m.usage; if (o.costUSD != null) prev.costUSD = o.costUSD; }
  }
  totals.files++;
}

// Pass 2: price each response once and add it to every view
function tally(pricing) {
  for (const { pid, sid, ts, model, u, costUSD, cwd, task, xhigh } of entries.values()) {
    const inp = u.input_tokens || 0, out = u.output_tokens || 0;
    const cc = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
    const cc1h = u.cache_creation?.ephemeral_1h_input_tokens || 0;
    const price = findPrice(pricing, model);
    if (!price.found) unknownModels.add(model);
    const cost = (costUSD != null) ? costUSD :
      inp * price.input + out * price.output + (cc - cc1h) * price.cacheCreate + cc1h * price.cacheCreate1h + cr * price.cacheRead;
    const date = localDate(ts);
    const tokens = inp + out + cc + cr;

    // project
    let P = projects.get(pid);
    if (!P) { P = { id: pid, cwd: null, cost: 0, tokens: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, msgs: 0, sessions: new Set(), first: date, last: ts.toISOString(), models: {} , _cwd: new Map() }; projects.set(pid, P); }
    P.cost += cost; P.tokens += tokens; P.input += inp; P.output += out; P.cacheCreate += cc; P.cacheRead += cr; P.msgs++;
    P.sessions.add(sid);
    if (date < P.first) P.first = date;
    if (ts.toISOString() > P.last) P.last = ts.toISOString();
    add(P.models, model, cost);
    if (cwd) P._cwd.set(cwd, (P._cwd.get(cwd) || 0) + 1);

    // daily by project
    const k1 = date + '|' + pid; const d1 = dailyByProject.get(k1) || { date, project: pid, cost: 0, tokens: 0, msgs: 0 };
    d1.cost += cost; d1.tokens += tokens; d1.msgs++; dailyByProject.set(k1, d1);
    // daily by model
    const k2 = date + '|' + model; const d2 = dailyByModel.get(k2) || { date, model, cost: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, msgs: 0 };
    d2.cost += cost; d2.input += inp; d2.output += out; d2.cacheCreate += cc; d2.cacheRead += cr; d2.msgs++; dailyByModel.set(k2, d2);
    // model totals
    const M = models.get(model) || { model, cost: 0, tokens: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, msgs: 0 };
    M.cost += cost; M.tokens += tokens; M.input += inp; M.output += out; M.cacheCreate += cc; M.cacheRead += cr; M.msgs++; models.set(model, M);
    // daily activity
    const DA = dailyActivity.get(date) || { date, sessions: new Set(), msgs: 0, output: 0, cost: 0 };
    DA.sessions.add(sid); DA.msgs++; DA.output += out; DA.cost += cost; dailyActivity.set(date, DA);
    // heatmap (local weekday/hour)
    const h = heat[ts.getDay()][ts.getHours()]; h.cost += cost; h.msgs++;
    // session
    const S = sessions.get(sid) || { id: sid, project: pid, cost: 0, tokens: 0, msgs: 0, first: ts.toISOString(), last: ts.toISOString(), models: new Set() };
    S.cost += cost; S.tokens += tokens; S.msgs++; S.models.add(model);
    if (ts.toISOString() < S.first) S.first = ts.toISOString();
    if (ts.toISOString() > S.last) S.last = ts.toISOString();
    sessions.set(sid, S);

    totals.cost += cost; totals.input += inp; totals.output += out; totals.cacheCreate += cc; totals.cacheRead += cr; totals.msgs++;

    // task-level counters
    if (task) {
      task.m++; task.cost += cost; task.tok += tokens;
      if (ts.getTime() > task.end) task.end = ts.getTime();
      const ctx = inp + cc + cr; if (ctx > task.c) task.c = ctx;
      if (xhigh) task.x++;
    }
  }
  tasks = taskList.filter((t) => t.m > 0).map((t) => [t.d, t.pid, t.m, t.t, t.f.size, t.c, t.k, t.e, t.x, +t.cost.toFixed(3), t.tok, t.end ? Math.round((t.end - t.t0) / 1000) : 0]);
}

// Transcripts in a project dir as [file, sessionId]; subagent logs live under <sid>/subagents/ (workflow agents
// one level deeper, in workflows/<run>/) and count toward their parent session
function listFiles(pdir) {
  const out = [];
  const walk = (dir, sid) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push([path.join(dir, e.name), sid]);
      else if (e.isDirectory()) walk(path.join(dir, e.name), sid);
    }
  };
  for (const e of fs.readdirSync(pdir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.jsonl')) out.push([path.join(pdir, e.name), path.basename(e.name, '.jsonl')]);
    else if (e.isDirectory() && fs.existsSync(path.join(pdir, e.name, 'subagents'))) walk(path.join(pdir, e.name, 'subagents'), e.name);
  }
  return out;
}

// Model ids used in recent logs (last 2 days), read cheaply from the file tails
function preScanModels() {
  const out = new Set(), since = Date.now() - 2 * 86400e3;
  for (const root of ROOTS) for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pdir = path.join(root, dir.name);
    for (const [fp] of listFiles(pdir)) {
      const st = fs.statSync(fp);
      if (st.mtimeMs < since) continue;
      const n = Math.min(st.size, 256 * 1024), buf = Buffer.alloc(n), fd = fs.openSync(fp, 'r');
      fs.readSync(fd, buf, 0, n, st.size - n); fs.closeSync(fd);
      for (const m of buf.toString('utf8').matchAll(/"model":"([^"]+)"/g)) if (m[1] !== '<synthetic>') out.add(m[1]);
    }
  }
  return [...out];
}

async function main() {
  const t0 = Date.now();
  // A model missing from an hour-old cache is likely newer than the cache: refetch before pricing it at $0
  let pricing = await loadPricing();
  if (preScanModels().some((m) => !findPrice(pricing, m).found)) { pricing = await loadPricing(3600e3); priceMemo.clear(); }
  for (const root of ROOTS) {
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const pdir = path.join(root, dir.name);
      for (const [fp, sid] of listFiles(pdir)) await readFile(dir.name, fp, sid);
    }
  }
  tally(pricing);
  const projOut = [...projects.values()].map((P) => {
    let best = null, bestN = -1;
    for (const [c, n] of P._cwd) if (n > bestN) { best = c; bestN = n; }
    const name = cwdDisplay(best) || P.id;
    return { id: P.id, name, cwd: best, cost: P.cost, tokens: P.tokens, input: P.input, output: P.output, cacheCreate: P.cacheCreate, cacheRead: P.cacheRead, msgs: P.msgs, sessions: P.sessions.size, first: P.first, last: P.last, models: P.models };
  }).sort((a, b) => b.cost - a.cost);
  const nameOf = Object.fromEntries(projOut.map((p) => [p.id, p.name]));
  const projIdx = Object.fromEntries(projOut.map((p, i) => [p.id, i]));
  const sessOut = [...sessions.values()].map((S) => ({ ...S, models: [...S.models], projectName: nameOf[S.project] || S.project }))
    .sort((a, b) => b.last.localeCompare(a.last)).slice(0, 3000);
  const out = {
    generatedAt: new Date().toISOString(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tookMs: Date.now() - t0,
    roots: ROOTS,
    pricingFetchedAt: pricing._fetchedAt ? new Date(pricing._fetchedAt).toISOString() : null,
    unknownModels: [...unknownModels],
    totals: { ...totals, sessions: sessions.size, projects: projects.size },
    dailyActivity: [...dailyActivity.values()].map((d) => ({ date: d.date, sessions: d.sessions.size, msgs: d.msgs, output: d.output, cost: d.cost })).sort((a, b) => a.date.localeCompare(b.date)),
    projects: projOut,
    models: [...models.values()].sort((a, b) => b.cost - a.cost),
    dailyByProject: [...dailyByProject.values()].sort((a, b) => a.date.localeCompare(b.date)),
    dailyByModel: [...dailyByModel.values()].sort((a, b) => a.date.localeCompare(b.date)),
    heatmap: heat,
    sessions: sessOut,
    taskCols: ['date', 'proj', 'turns', 'tools', 'files', 'ctx', 'compacts', 'errors', 'xhigh', 'cost', 'tokens', 'sec'],
    tasks: tasks.sort((a, b) => a[0].localeCompare(b[0])).map((t) => { t[1] = projIdx[t[1]] ?? -1; return t; }),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = path.join(OUT_DIR, '.projects.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, path.join(OUT_DIR, 'projects.json'));
  console.error(`aggregate: ${totals.files} files, ${totals.msgs} msgs, $${totals.cost.toFixed(2)}, ${out.tookMs}ms, unknown models: ${out.unknownModels.join(',') || 'none'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
