// ReRoute server: zero dependencies, runs with plain `node server.js`.
const http = require('http');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (so no npm install is needed)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const data = require('./src/data');
const { runAgent } = require('./src/agent');
const { aiStatus, explainPlans, draftMessages } = require('./src/ai');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// Every agent decision and every human approval is logged (shown in the app)
const auditLog = [];
const audit = (event, detail) => {
  const entry = { time: new Date().toISOString(), event, detail };
  auditLog.unshift(entry);
  auditLog.length = Math.min(auditLog.length, 50);
  console.log(`[audit] ${event}: ${detail}`);
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
  });
}

const routes = {
  'GET /api/state': async () => ({
    traveller: data.traveller,
    now: data.NOW,
    bookings: data.bookings,
    scenarios: data.scenarios.map(({ id, label, headline }) => ({ id, label, headline })),
    defaults: data.defaultConstraints,
    ai: aiStatus(),
  }),

  // Run the agent: detect -> cascade -> search -> filter -> rank -> AI explanation
  'POST /api/recover': async (body) => {
    const result = runAgent(body.scenarioId, body.constraints);
    const ai = await explainPlans(result, data.traveller);
    result.trace.push({
      key: 'reason',
      title: ai.source === 'gemini' ? `AI reviewed the plans (${ai.model})` : 'Wrote the recommendation (offline mode)',
      detail: ai.overrode
        ? 'The AI changed the top pick based on your note. It can only choose from plans that passed every check.'
        : ai.recommendedId
        ? `Picked ${result.plans.find((p) => p.id === ai.recommendedId).title} and explained the trade-off of each plan, so Sathvik can decide.`
        : 'No plan fits every limit, so nothing to recommend.',
    });
    audit('recover', `${body.scenarioId}: ${result.plans.length} plans, recommended ${ai.recommendedId || 'none'} (${ai.source})`);
    return { ...result, ai };
  },

  // Human in the loop: nothing changes until the traveller approves a plan
  'POST /api/approve': async (body) => {
    const result = runAgent(body.scenarioId, body.constraints);
    const plan = result.plans.find((p) => p.id === body.planId) || result.rejected.find((p) => p.id === body.planId);
    if (!plan) throw Object.assign(new Error('That plan is no longer available. Run the agent again.'), { status: 404 });
    if (!plan.feasible) throw Object.assign(new Error('That plan breaks your limits, so it cannot be approved.'), { status: 400 });
    const messages = await draftMessages(result, plan, data.traveller);
    audit('approve', `Traveller approved ${plan.title}`);
    return { plan, messages, scenario: result.scenario };
  },

  'GET /api/audit': async () => auditLog,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;

  if (routes[key]) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(res, 200, await routes[key](body));
    } catch (e) {
      send(res, e.status || 500, { error: e.message });
    }
    return;
  }

  // Static files
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  const ai = aiStatus();
  console.log(`\n  ReRoute is running at http://localhost:${PORT}`);
  console.log(`  AI mode: ${ai.mode === 'gemini' ? `Gemini (${ai.model})` : 'offline (add GEMINI_API_KEY to .env for live AI)'}\n`);
});
