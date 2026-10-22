// ReRoute frontend (no framework, no build step)
const $ = (s, el = document) => el.querySelector(s);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (msTime) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : msTime));

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const time = (iso) => {
  const h = +iso.slice(11, 13);
  return `${h % 12 || 12}:${iso.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}`;
};
const day = (iso) => {
  const d = new Date(iso + ':00Z');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} Oct`;
};
const rupees = (n) => '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l-2-4M15 21l2-4"/><circle cx="9" cy="14" r=".5"/><circle cx="15" cy="14" r=".5"/></svg>',
  bus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M7 18v3M17 18v3"/><circle cx="8" cy="14.5" r=".5"/><circle cx="16" cy="14.5" r=".5"/></svg>',
  flight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5 3 11l1.5-1.5 7.5 1L17 5.5a2 2 0 0 1 3 3l-5 5 1 7.5-1.5 1.5-2.5-7.5-3 3V21l-1.5 1-1-3.5L3 17.5 4 16h3z"/></svg>',
  hotel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20V6M3 13h18v7M21 13a4 4 0 0 0-4-4h-6v4"/><circle cx="7" cy="10" r="2"/></svg>',
  cab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14v-5l-2-5H7l-2 5zM5 12h14M7 17v2M17 17v2"/><circle cx="8" cy="14.5" r=".5"/><circle cx="16" cy="14.5" r=".5"/></svg>',
  event: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/></svg>',
};
ICONS.taxi = ICONS.cab;

const state = { boot: null, result: null, approved: null, running: false };

// ---------- Trip route ----------
function renderRoute(items) {
  const route = $('#route');
  route.innerHTML = items
    .map((it, i) => {
      const gap = i > 0 && items[i - 1].at.slice(0, 10) !== it.at.slice(0, 10) && it.at.slice(0, 10) === '2026-10-26';
      const tag = it.tag ? `<span class="tag tag-${it.tag}">${it.tag === 'new' ? 'New' : it.tag === 'changed' ? 'Changed' : 'Cancelled'}</span>` : '';
      return `<li class="stop${gap ? ' gap-before' : ''}" data-id="${it.id || ''}" data-status="${it.status || ''}">
        <div class="stop-time">${time(it.at)}<small>${day(it.at)}</small></div>
        <div class="stop-track"><span class="stop-dot"></span></div>
        <div class="stop-body">
          <h4>${esc(it.title)}${tag}</h4>
          <p class="meta">${esc(it.meta || '')}</p>
          <p class="stop-note">${esc(it.note || '')}</p>
        </div>
      </li>`;
    })
    .join('');
}

function originalRoute() {
  return state.boot.bookings.map((b) => ({ id: b.id, at: b.start, title: b.title, meta: `${b.detail}. ${b.ref}` }));
}

async function playCascade(impacts) {
  // The disruption first, then the knock-on effects one by one down the line
  const order = ['disrupted', 'affected', 'watch', 'ok'];
  const ids = Object.keys(impacts).sort((a, b) => order.indexOf(impacts[a].status) - order.indexOf(impacts[b].status));
  const rank = (id) => state.boot.bookings.findIndex((b) => b.id === id);
  ids.sort((a, b) => order.indexOf(impacts[a].status) - order.indexOf(impacts[b].status) || rank(a) - rank(b));
  for (const id of ids) {
    const li = $(`.stop[data-id="${id}"]`);
    if (!li) continue;
    li.dataset.status = impacts[id].status;
    $('.stop-note', li).textContent = impacts[id].note;
    await wait(impacts[id].status === 'ok' ? 150 : 420);
  }
}

// ---------- Limits ----------
function readConstraints() {
  return {
    extraBudget: Number($('#budget').value),
    arriveBy: $('#arriveBy').value,
    priority: document.querySelector('input[name="priority"]:checked').value,
    notes: $('#notes').value.trim(),
  };
}

// ---------- Agent run ----------
async function run() {
  if (state.running) return;
  state.running = true;
  state.approved = null;
  const btn = $('#runBtn');
  btn.disabled = true;
  btn.textContent = 'Agent working…';

  const scenarioId = $('#scenario').value;
  const scenario = state.boot.scenarios.find((s) => s.id === scenarioId);
  renderRoute(originalRoute());

  const stage = $('#stage');
  stage.innerHTML = `
    <div class="alert" role="alert">
      <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>
      <div><h3>${esc(scenario.headline)}</h3><p id="alertCause">Alert received. The agent has started.</p></div>
    </div>
    <h3 class="section-title">What the agent is doing</h3>
    <ol class="trace" id="trace">
      ${['Detect the disruption', 'Trace the knock-on effects', 'Search alternatives', 'Check them against his limits', 'Rank the options', 'Explain and recommend'].map((t) => `<li class="pending"><div class="t-title">${t}</div><div class="t-detail"></div></li>`).join('')}
    </ol>
    <div id="results"></div>`;

  let result;
  try {
    const req = fetch('/api/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId, constraints: readConstraints() }),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'The agent could not finish.');
      return j;
    });
    // Mark step 1 as running while the request is in flight
    const steps = [...document.querySelectorAll('#trace li')];
    steps[0].className = 'running';
    result = await req;
    state.result = result;
    $('#alertCause').textContent = `Cause: ${result.scenario.cause}. Alert received at ${time(result.scenario.at)}, ${day(result.scenario.at)}.`;

    for (let i = 0; i < steps.length; i++) {
      const t = result.trace[i];
      steps[i].className = 'running';
      await wait(380);
      if (t) {
        $('.t-title', steps[i]).textContent = t.title;
        $('.t-detail', steps[i]).textContent = t.detail;
      }
      steps[i].className = 'done';
      if (i === 1) await playCascade(result.impacts);
      if (steps[i + 1]) steps[i + 1].className = 'running';
    }
    renderPlans(result);
  } catch (e) {
    $('#results').innerHTML = `<div class="nofit">${esc(e.message)} Check that the server is running, then try again.</div>`;
  } finally {
    state.running = false;
    btn.disabled = false;
    btn.textContent = 'Simulate disruption';
    loadAudit();
  }
}

// Count numbers up, like a ticker
function tick(el, target, render) {
  if (reduceMotion) return void (el.innerHTML = render(target));
  const start = performance.now(), dur = 900;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.innerHTML = render(Math.round(target * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Spotlight that follows the cursor across plan cards
document.addEventListener('pointermove', (e) => {
  const card = e.target.closest && e.target.closest('.plan');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${e.clientX - r.left}px`);
  card.style.setProperty('--my', `${e.clientY - r.top}px`);
});

function comfortDots(n) {
  return `<span class="dots" aria-label="${n} out of 5">${'●'.repeat(n)}<i>${'●'.repeat(5 - n)}</i></span>`;
}

function renderPlans(result) {
  const { plans, rejected, ai } = result;
  const box = $('#results');
  const summary = `<div class="summary">${esc(ai.summary)}<small>${ai.source === 'gemini' ? `Written by ${esc(ai.model)}. Prices and times are checked by the agent, not guessed by the AI.` : 'Offline mode: built-in rules wrote this. Add a Gemini key for live AI reasoning.'}</small></div>`;

  if (!plans.length) {
    box.innerHTML = summary + `<div class="nofit">No alternative fits all of his limits. Raise the budget or allow a later arrival, then run the agent again.</div>` + ruledOut(rejected);
    return;
  }

  box.innerHTML = summary + `<h3 class="section-title">Recovery plans for Sathvik to choose from</h3><div class="plans" id="plans"></div>` + ruledOut(rejected);
  const grid = $('#plans');
  const ordered = [...plans].sort((a, b) => (b.id === ai.recommendedId) - (a.id === ai.recommendedId));

  for (const p of ordered) {
    const node = $('#tplPlan').content.firstElementChild.cloneNode(true);
    const rec = p.id === ai.recommendedId;
    node.dataset.id = p.id;
    if (rec) {
      node.classList.add('recommended');
      $('.plan-flag', node).textContent = ai.overrode ? 'AI pick, based on your note' : 'Recommended';
    }
    $('.mode-icon', node).innerHTML = ICONS[p.mode] || ICONS.event;
    $('.plan-title', node).textContent = p.title;
    $('.plan-route', node).textContent = p.depart
      ? `Leaves ${time(p.depart)} ${day(p.depart)}, arrives ${time(p.arrive)} ${day(p.arrive)}`
      : `${p.rating} rated, ${p.availability}`;
    tick($('.s-cost', node), p.cost.net, (v) => (p.cost.net <= 0 ? `<span class="saving">Saves ${rupees(v)}</span>` : rupees(v)));
    $('.s-venue', node).innerHTML = `${time(p.venueAt)}<small>${p.bufferMin} min spare</small>`;
    $('.s-comfort', node).innerHTML = comfortDots(p.comfort);
    $('.plan-why', node).textContent = ai.reasons[p.id] || '';
    $('.plan-warn', node).innerHTML = p.warnings.map((w) => `<li>${esc(w)}</li>`).join('');

    const rows = [[p.mode === 'hotel' ? 'New room' : 'New ticket', rupees(p.cost.fare)], ...p.cost.extras.map((e) => [e.label, '+ ' + rupees(e.amount)])];
    if (p.cost.refund) rows.push(['Refund on the broken booking', '− ' + rupees(p.cost.refund)]);
    $('.breakdown', node).innerHTML =
      rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`).join('') +
      `<tr class="total"><td>${p.cost.net <= 0 ? 'He saves' : 'Extra he pays'}</td><td>${rupees(p.cost.net)}</td></tr>`;
    $('.plan-actions', node).innerHTML = p.actions.map((a) => `<li>${esc(a.text)}</li>`).join('');
    $('.approve', node).addEventListener('click', () => approve(p.id));
    grid.appendChild(node);
  }
}

function ruledOut(rejected) {
  if (!rejected.length) return '';
  return `<details class="ruled"><summary>${rejected.length} options ruled out, and why</summary><ul>${rejected
    .map((r) => `<li><strong>${esc(r.title)}</strong><span>${r.reasons.map(esc).join('. ')}</span></li>`)
    .join('')}</ul></details>`;
}

// ---------- Approval (human in the loop) ----------
async function approve(planId) {
  const buttons = document.querySelectorAll('.approve');
  buttons.forEach((b) => (b.disabled = true));
  const chosen = $(`.plan[data-id="${planId}"] .approve`);
  chosen.textContent = 'Preparing messages…';
  try {
    const r = await fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: state.result.scenario.id, constraints: readConstraints(), planId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    state.approved = j;
    document.querySelectorAll('.plan').forEach((el) => el.classList.toggle('dimmed', el.dataset.id !== planId));
    chosen.textContent = 'Approved';
    renderConfirmation(j);
    renderRoute(
      j.plan.itinerary.map((it) => ({
        at: it.at,
        title: it.title,
        status: it.status,
        tag: ['new', 'changed', 'cancelled'].includes(it.status) ? it.status : '',
        note: it.detail,
      }))
    );
  } catch (e) {
    chosen.textContent = 'Approve this plan';
    buttons.forEach((b) => (b.disabled = false));
    alertInline(e.message);
  } finally {
    loadAudit();
  }
}

function alertInline(msg) {
  const d = document.createElement('div');
  d.className = 'nofit';
  d.textContent = msg;
  $('#results').prepend(d);
}

function renderConfirmation({ plan, messages }) {
  const el = document.createElement('section');
  el.className = 'confirm';
  el.id = 'confirm';
  const n = messages.notification;
  el.innerHTML = `
    <div class="confirm-head">
      <h3>New plan approved</h3>
      <button class="btn btn-ghost btn-sm" type="button" id="resetBtn">Start over</button>
    </div>
    <p class="sub">The trip on the left now shows the new itinerary. Here is what Sathvik needs to do, in order.</p>
    <ul class="todo">
      ${plan.actions
        .map((a, i) => `<li><input type="checkbox" id="todo${i}" ${a.type === 'none' ? 'checked' : ''} /><label for="todo${i}"><span><b class="kind kind-${a.type}">${{ book: 'Book', refund: 'Refund', notify: 'Update', none: 'No action' }[a.type]}</b>${esc(a.text)}</span></label></li>`)
        .join('')}
    </ul>
    <div class="msgs">
      <div class="msg">
        <h4>Phone alert, in his language</h4>
        <div class="lang-tabs" role="tablist">
          <button role="tab" aria-selected="true" data-lang="en">English</button>
          <button role="tab" aria-selected="false" data-lang="kn" class="indic">ಕನ್ನಡ</button>
          <button role="tab" aria-selected="false" data-lang="hi" class="indic">हिंदी</button>
        </div>
        <div class="phone"><b>ReRoute, now</b><span id="notifText">${esc(n.en)}</span></div>
      </div>
      <div class="msg">
        <h4>Message to the hotel or cab</h4>
        <pre>${esc(messages.providerMessage)}</pre>
        <div class="msg-foot"><span>Drafted for him to send</span><button class="btn btn-ghost btn-sm copy" data-copy="providerMessage" type="button">Copy</button></div>
      </div>
      <div class="msg wide">
        <h4>Refund request, ready to send</h4>
        <pre>${esc(messages.refundRequest)}</pre>
        <div class="msg-foot"><span>${messages.source === 'gemini' ? 'Drafted by Gemini' : 'Drafted offline'}</span><button class="btn btn-ghost btn-sm copy" data-copy="refundRequest" type="button">Copy</button></div>
      </div>
    </div>`;
  $('#results').appendChild(el);

  el.querySelectorAll('.lang-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('.lang-tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
      const t = $('#notifText', el);
      t.textContent = n[b.dataset.lang];
      t.classList.toggle('indic', b.dataset.lang !== 'en');
      t.style.fontFamily = b.dataset.lang !== 'en' ? 'var(--font-indic)' : '';
    })
  );
  el.querySelectorAll('.copy').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(messages[b.dataset.copy]);
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Select and copy';
      }
      setTimeout(() => (b.textContent = 'Copy'), 1600);
    })
  );
  el.querySelectorAll('.todo input').forEach((cb) => {
    const sync = () => cb.closest('li').classList.toggle('done', cb.checked);
    cb.addEventListener('change', sync);
    sync();
  });
  $('#resetBtn', el).addEventListener('click', reset);
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function reset() {
  state.result = null;
  state.approved = null;
  renderRoute(originalRoute());
  $('#stage').innerHTML = `<div class="empty"><p class="empty-title">All bookings are on track.</p><p>Pick a disruption and simulate it to run the agent again.</p></div>`;
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

// ---------- Activity log ----------
async function loadAudit() {
  try {
    const log = await (await fetch('/api/audit')).json();
    $('#auditList').innerHTML = log.length
      ? log.map((e) => `<li>${new Date(e.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}: ${esc(e.event === 'approve' ? 'Traveller approval. ' : 'Agent run. ')}${esc(e.detail)}</li>`).join('')
      : '<li>No activity yet.</li>';
  } catch {}
}

// ---------- Opening scene ----------
async function flip(el, text) {
  const chars = 'ABCDEFGHIJKLMNOPRSTUVWXYZ';
  if (reduceMotion) return void (el.textContent = text);
  for (let k = 0; k < 7; k++) {
    el.textContent = text.split('').map((c, i) => (c === ' ' || i < k - 2 ? c : chars[(Math.random() * chars.length) | 0])).join('');
    await wait(55);
  }
  el.textContent = text;
}
let boardPlaying = false;
async function playBoard(delay = 3000) {
  if (boardPlaying) return;
  boardPlaying = true;
  await wait(delay);
  $('#dbClock').textContent = '5:30 PM';
  const rows = [...document.querySelectorAll('#dbRows li')];
  for (const li of rows) {
    if (li.dataset.tone === 'calm') continue;
    await flip($('b', li), li.dataset.final);
    li.classList.add(li.dataset.tone);
    if (li.dataset.tone === 'red') { li.classList.add('blink'); await wait(900); }
    else await wait(260);
  }
  $('#heroRun').classList.add('ready');
  boardPlaying = false;
}

// Clicking the board resets it to "all on track" and plays the cancellation again (handy for demo recordings)
function replayBoard() {
  if (boardPlaying) return;
  $('#dbClock').textContent = '5:29 PM';
  for (const li of document.querySelectorAll('#dbRows li')) {
    li.classList.remove('red', 'amber', 'blink');
    $('b', li).textContent = li.dataset.tone === 'red' ? 'On time' : 'On track';
  }
  playBoard(1500);
}

// Mesh-gradient background, ported from 21st.dev "Shader Hero" to plain WebGL in ReRoute colours
function heroShader() {
  const canvas = $('#heroShader');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) return;
  const frag = `precision mediump float;
uniform vec2 r; uniform float t;
void main() {
  vec2 uv = gl_FragCoord.xy / r;
  float a = r.x / r.y;
  vec2 p = vec2(uv.x * a, uv.y);
  vec2 q = p + 0.12 * vec2(sin(p.y * 3.0 + t * 0.4), cos(p.x * 2.5 - t * 0.3));
  vec2 c1 = vec2(a * 0.18 + 0.15 * sin(t * 0.21), 0.8 + 0.1 * cos(t * 0.17));
  vec2 c2 = vec2(a * 0.78 + 0.12 * cos(t * 0.19), 0.62 + 0.12 * sin(t * 0.23));
  vec2 c3 = vec2(a * 0.55 + 0.2 * sin(t * 0.13), 0.08 + 0.08 * cos(t * 0.29));
  float w1 = exp(-3.0 * dot(q - c1, q - c1));
  float w2 = exp(-4.0 * dot(q - c2, q - c2));
  float w3 = exp(-5.0 * dot(q - c3, q - c3));
  vec3 col = vec3(0.027, 0.047, 0.094);
  col += vec3(0.31, 0.486, 0.94) * w1 * 0.5;
  col += vec3(1.0, 0.76, 0.1) * w2 * 0.28;
  col += vec3(1.0, 0.35, 0.31) * w3 * 0.22;
  float f = fract((w1 + w2 + w3) * 9.0 - t * 0.05);
  col += vec3(0.06) * smoothstep(0.0, 0.04, f) * smoothstep(0.1, 0.05, f);
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.025;
  col = mix(col, vec3(0.027, 0.047, 0.094), smoothstep(0.35, 0.0, uv.y) * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(prog, 'r');
  const uT = gl.getUniformLocation(prog, 't');

  // Render at half resolution: the gradient is soft, so nobody can tell
  const size = () => {
    canvas.width = Math.max(1, canvas.clientWidth >> 1);
    canvas.height = Math.max(1, canvas.clientHeight >> 1);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uR, canvas.width, canvas.height);
  };
  const draw = (now) => {
    gl.uniform1f(uT, 8 + now / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  size();
  window.addEventListener('resize', () => { size(); if (reduceMotion) draw(0); });
  canvas.classList.add('on');
  if (reduceMotion) return draw(0);

  let visible = true, raf = 0;
  const loop = (now) => { draw(now); raf = visible ? requestAnimationFrame(loop) : 0; };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(loop);
  }).observe(canvas);
  raf = requestAnimationFrame(loop);
}

// Staggered word reveal for the hero title
function splitTitle() {
  if (reduceMotion) return;
  const h = $('#heroTitle');
  const words = h.textContent.trim().split(' ');
  h.setAttribute('aria-label', h.textContent.trim());
  h.innerHTML = words.map((w, i) => `<span class="w" aria-hidden="true" style="--i:${i}">${esc(w)}${i < words.length - 1 ? ' ' : ''}</span>`).join('');
  h.classList.add('split');
}

// "How the agent works" slides, ported from 21st.dev "Feature Carousel"
function howCarousel() {
  const chips = [...document.querySelectorAll('#howChips button')];
  const cards = [...document.querySelectorAll('#howStage .how-card')];
  const n = cards.length;
  let cur = 0, paused = false;
  const show = (i) => {
    cur = (i + n) % n;
    chips.forEach((b, k) => {
      let d = k - cur;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
      b.style.setProperty('--d', d);
      b.style.setProperty('--ad', Math.abs(d));
      b.classList.toggle('on', d === 0);
      b.setAttribute('aria-pressed', d === 0);
    });
    cards.forEach((c, k) => {
      const d = (k - cur + n) % n;
      c.className = 'how-card' + (d === 0 ? ' on' : d === 1 ? ' next' : d === n - 1 ? ' prev' : '');
      c.setAttribute('aria-hidden', d !== 0);
    });
  };
  chips.forEach((b) => b.addEventListener('click', () => show(+b.dataset.i)));
  const frame = $('.how-frame');
  frame.addEventListener('mouseenter', () => (paused = true));
  frame.addEventListener('mouseleave', () => (paused = false));
  frame.addEventListener('focusin', () => (paused = true));
  frame.addEventListener('focusout', () => (paused = false));
  show(0);
  if (!reduceMotion) setInterval(() => { if (!paused && !document.hidden) show(cur + 1); }, 3500);
}

// ---------- Boot ----------
async function boot() {
  try {
    state.boot = await (await fetch('/api/state')).json();
  } catch {
    $('#stage').innerHTML = '<div class="nofit">Could not reach the ReRoute server. Start it with "node server.js" and reload this page.</div>';
    return;
  }
  $('#scenario').innerHTML = state.boot.scenarios.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  renderRoute(originalRoute());

  const budget = $('#budget');
  const sync = () => ($('#budgetOut').textContent = rupees(budget.value));
  budget.addEventListener('input', sync);
  sync();
  $('#runBtn').addEventListener('click', run);
  $('#heroRun').addEventListener('click', () => {
    $('#scenario').value = 'train-cancelled';
    $('#app').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    setTimeout(run, reduceMotion ? 0 : 500);
  });
  loadAudit();
}
splitTitle();
heroShader();
howCarousel();
playBoard();
$('.dboard').addEventListener('click', replayBoard);
boot();
