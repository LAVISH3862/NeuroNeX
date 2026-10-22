// ReRoute recovery agent.
// The agent runs a fixed pipeline: detect -> cascade -> search -> filter -> rank.
// All money and time math is deterministic so the AI can never invent a price or a timing.
// The language model (see ai.js) then explains, re-checks and writes messages on top of these facts.

const data = require('./data');

const MIN = 60 * 1000;
const ms = (s) => Date.parse(s + ':00+05:30');
const iso = (t) => new Date(t + 330 * MIN).toISOString().slice(0, 16);
const roundUp5 = (t) => Math.ceil(t / (5 * MIN)) * 5 * MIN;

// 12-hour clock for display, e.g. 8:00 PM
function hm(t) {
  const d = new Date(t + 330 * MIN);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmt(t) {
  const d = new Date(t + 330 * MIN);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return `${hm(t)} ${day} ${d.getUTCDate()} Oct`;
}
const rupees = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

const byId = (id) => data.bookings.find((b) => b.id === id);

// Read simple preferences out of the traveller's free-text note.
function parseNotes(notes = '') {
  const n = notes.toLowerCase();
  const avoid = new Set();
  const neg = '(no|avoid|avoiding|not|don\'t|dont|hate|without|skip)';
  const rx = (w) => new RegExp(`${neg}\\s+(any\\s+|a\\s+|the\\s+|taking\\s+|want\\s+|like\\s+)?${w}`);
  if (rx('bus').test(n)) avoid.add('bus');
  if (rx('(flight|fly|flying|plane)').test(n)) avoid.add('flight');
  if (rx('(taxi|road trip|driving)').test(n)) avoid.add('taxi');
  if (rx('(train|trains)').test(n)) avoid.add('train');
  return { avoid };
}

// ---------- Step 2: cascade detection ----------
function detectCascade(scenario) {
  const d = byId(scenario.bookingId);
  const impacts = {};
  for (const b of data.bookings) impacts[b.id] = { status: 'ok', note: 'Not affected' };

  if (d.id === 'TRN') {
    const lostArrival = scenario.kind === 'cancel' ? null : ms(d.end) + scenario.delayMin * MIN;
    impacts.TRN = {
      status: 'disrupted',
      note: scenario.kind === 'cancel' ? 'Cancelled' : `Now arrives ${fmt(lostArrival)}`,
    };
    impacts.HTL = {
      status: 'affected',
      note: lostArrival
        ? `Early check-in at 7:00 AM will be missed (you reach about ${hm(lostArrival + 30 * MIN)})`
        : 'No way to reach the 7:00 AM early check-in',
    };
    impacts.CAB = {
      status: 'affected',
      note: lostArrival
        ? 'Pickup at 9:15 AM from the hotel will be missed'
        : 'Pickup from the hotel at 9:15 AM depends on you being there',
    };
    const venue = lostArrival ? lostArrival + 75 * MIN : null;
    impacts.EVT = {
      status: 'affected',
      note: venue ? `Even a direct cab reaches Udupi at ${hm(venue)}, after the 11:00 AM muhurtham` : 'At risk: no confirmed way to reach Udupi',
    };
  } else if (d.id === 'HTL') {
    impacts.HTL = { status: 'disrupted', note: 'Room cancelled' };
    impacts.CAB = { status: 'affected', note: 'Pickup address no longer valid' };
    impacts.EVT = { status: 'watch', note: 'Safe if a new room and pickup are fixed before 9:15 AM' };
  }
  impacts.RET = { status: 'ok', note: 'Return flight on 26 Oct is not affected' };
  return impacts;
}

// ---------- Step 4: evaluate one transport alternative ----------
function evalTransport(opt, scenario, c, prefs) {
  const now = ms(scenario.at);
  const hotel = byId('HTL');
  const cab = byId('CAB');
  const evt = byId('EVT');
  const dep = ms(opt.dep);
  const arr = ms(opt.arr);
  const reasons = [];
  const warnings = [];

  if (dep < now + 60 * MIN) reasons.push(`Leaves at ${hm(dep)}, not enough time to reach ${opt.from}`);
  if (!opt.confirmed) reasons.push(`Seat not confirmed (${opt.availability})`);
  if (arr > ms(c.arriveBy)) reasons.push(`Arrives ${fmt(arr)}, after your ${hm(ms(c.arriveBy))} limit`);
  const MODE_WORD = { bus: 'buses', flight: 'flights', train: 'trains', taxi: 'long taxi rides' };
  if (prefs.avoid.has(opt.mode)) reasons.push(`You asked to avoid ${MODE_WORD[opt.mode]}`);

  // Ripple through the hotel and cab
  const transfer = (opt.mode === 'flight' ? 45 : 30) * MIN;
  const atHotel = arr + transfer;
  const checkin = ms(hotel.start);
  const extras = [];
  const actions = [];
  const itinerary = [];

  let roomFrom = Math.max(atHotel, checkin);
  let hotelStatus = 'unchanged';
  let hotelDetail = 'Check-in 7:00 AM as booked';
  if (atHotel < checkin - 3 * 60 * MIN) {
    extras.push({ label: 'Extra hotel night (arrive tonight)', amount: hotel.price });
    roomFrom = atHotel;
    hotelStatus = 'changed';
    hotelDetail = `Add tonight's stay, check in at ${hm(atHotel)}`;
    actions.push({ type: 'notify', text: `Extend Hotel Sea Breeze booking to include tonight, arriving ${hm(atHotel)} (${rupees(hotel.price)})` });
  } else if (atHotel > checkin + 15 * MIN) {
    hotelStatus = 'changed';
    hotelDetail = `Late check-in at ${hm(atHotel)}`;
    actions.push({ type: 'notify', text: `Tell the hotel you will check in at ${hm(atHotel)} instead of 7:00 AM (no charge)` });
  } else if (atHotel < checkin) {
    hotelDetail = `Reach at ${hm(atHotel)}, room ready at 7:00 AM`;
  }

  const readyForCab = roomFrom + 60 * MIN; // time to freshen up
  let pickup = ms(cab.start);
  let cabStatus = 'unchanged';
  if (readyForCab > pickup) {
    pickup = roundUp5(readyForCab);
    cabStatus = 'changed';
    actions.push({ type: 'notify', text: `Move cab pickup from 9:15 AM to ${hm(pickup)}` });
  }
  const venueAt = pickup + cab.durationMin * MIN;
  const buffer = Math.round((ms(evt.start) - venueAt) / MIN);
  if (buffer < 15) reasons.push(`Reaches the wedding at ${hm(venueAt)}, too close to the 11:00 AM muhurtham`);

  const refund = opt.isStay ? 0 : scenario.refund.amount;
  const extraCost = extras.reduce((s, e) => s + e.amount, 0);
  const net = opt.price + extraCost - refund;
  if (net > c.extraBudget) reasons.push(`Costs ${rupees(net)} extra after refund, over your ${rupees(c.extraBudget)} limit`);

  if (opt.mode === 'bus' && opt.comfort <= 2) warnings.push('Seater bus, less rest before the wedding');
  if (extras.length) warnings.push('Needs an extra hotel night');
  if (buffer >= 15 && buffer < 25) warnings.push(`Only ${buffer} min spare before the muhurtham`);

  if (!opt.isStay) {
    actions.unshift({ type: 'book', text: `Book ${opt.title}, departs ${fmt(dep)} from ${opt.from} (${rupees(opt.price)})` });
    actions.splice(1, 0, { type: 'refund', text: `Train refund of ${rupees(refund)}: ${scenario.refund.how}` });
  }
  if (cabStatus === 'unchanged') actions.push({ type: 'none', text: 'Keep the cab at 9:15 AM, no change needed' });
  actions.push({ type: 'none', text: 'Return flight on 26 Oct stays as booked' });

  if (!opt.isStay) itinerary.push({ at: data.bookings[0].start, title: 'Train 16511', status: 'cancelled', detail: `Refund ${rupees(refund)}` });
  itinerary.push({ at: opt.dep, title: opt.title, status: opt.isStay ? 'changed' : 'new', detail: `${opt.from} ${hm(dep)} to ${opt.to} ${hm(arr)}` });
  itinerary.push({ at: iso(roomFrom), title: 'Hotel Sea Breeze Residency', status: hotelStatus, detail: hotelDetail });
  itinerary.push({ at: iso(pickup), title: 'Cab to Udupi', status: cabStatus, detail: `Pickup ${hm(pickup)}, reach venue ${hm(venueAt)}` });
  itinerary.push({ at: evt.start, title: 'Wedding muhurtham', status: 'unchanged', detail: `${buffer} min to spare` });
  itinerary.push({ at: byId('RET').start, title: 'Return flight IX 2793', status: 'unchanged', detail: 'No change' });

  return {
    id: 'P-' + opt.id,
    optionId: opt.id,
    mode: opt.mode,
    title: opt.title,
    feasible: reasons.length === 0,
    reasons,
    warnings,
    depart: opt.dep,
    arrive: opt.arr,
    venueAt: iso(venueAt),
    bufferMin: buffer,
    slackMin: Math.round((ms(c.arriveBy) - arr) / MIN),
    comfort: opt.comfort,
    availability: opt.availability,
    cost: { fare: opt.price, extras, refund, net },
    actions,
    itinerary,
  };
}

// ---------- Step 4 (hotel variant) ----------
function evalHotel(opt, scenario, c) {
  const train = byId('TRN');
  const cab = byId('CAB');
  const evt = byId('EVT');
  const arr = ms(train.end);
  const reasons = [];
  const warnings = [];
  const actions = [];
  const itinerary = [];
  const refund = scenario.refund.amount;
  const net = opt.price - refund;

  let pickup, venueAt, cabDetail, comfort = opt.comfort, roomDetail;
  if (opt.city === 'Udupi') {
    // Smart re-route: take the cab straight from the station to Udupi
    pickup = roundUp5(arr + 10 * MIN);
    const atHotel = pickup + cab.durationMin * MIN;
    venueAt = atHotel + 65 * MIN; // freshen up, then a 5 min walk to the venue
    cabDetail = `Pickup at Mangaluru Central ${hm(pickup)}, drop at Udupi Bay Stay ${hm(atHotel)}`;
    roomDetail = `Check in ${hm(atHotel)}, 5 min walk to the venue`;
    actions.push({ type: 'notify', text: `Change cab: pick up at Mangaluru Central at ${hm(pickup)} and drop at Udupi Bay Stay (same fare)` });
  } else {
    const atHotel = arr + 30 * MIN;
    pickup = ms(cab.start);
    venueAt = pickup + cab.durationMin * MIN;
    cabDetail = `Pickup ${hm(pickup)} from the new hotel`;
    roomDetail = opt.earlyCheckin ? `Early check-in at ${hm(atHotel)}` : `Reach ${hm(atHotel)}, room only from 12:00 PM`;
    actions.push({ type: 'notify', text: `Update cab pickup address to ${opt.title.split(',')[0]} (time stays 9:15 AM)` });
    if (!opt.earlyCheckin) {
      warnings.push('No early check-in: you would freshen up in the lobby');
      comfort = 1;
    }
  }
  const buffer = Math.round((ms(evt.start) - venueAt) / MIN);
  if (net > c.extraBudget) reasons.push(`Costs ${rupees(net)} extra after refund, over your ${rupees(c.extraBudget)} limit`);

  actions.unshift({ type: 'book', text: `Book ${opt.title} for 25 Oct (${rupees(opt.price)}, ${opt.availability})` });
  actions.splice(1, 0, { type: 'refund', text: `Hotel refund of ${rupees(refund)}: ${scenario.refund.how}` });
  actions.push({ type: 'none', text: 'Train 16511 and the return flight stay as booked' });

  itinerary.push({ at: train.start, title: 'Train 16511', status: 'unchanged', detail: 'Arrives Mangaluru Central 6:40 AM' });
  itinerary.push({ at: '2026-10-25T07:00', title: 'Hotel Sea Breeze Residency', status: 'cancelled', detail: `Refund ${rupees(refund)}` });
  itinerary.push({ at: '2026-10-25T07:10', title: opt.title, status: 'new', detail: roomDetail });
  itinerary.push({ at: iso(pickup), title: 'Cab', status: 'changed', detail: cabDetail });
  itinerary.push({ at: evt.start, title: 'Wedding muhurtham', status: 'unchanged', detail: `${buffer} min to spare` });
  itinerary.push({ at: byId('RET').start, title: 'Return flight IX 2793', status: 'unchanged', detail: 'No change' });

  return {
    id: 'P-' + opt.id,
    optionId: opt.id,
    mode: 'hotel',
    title: opt.title,
    feasible: reasons.length === 0,
    reasons,
    warnings,
    depart: null,
    arrive: null,
    venueAt: iso(venueAt),
    bufferMin: buffer,
    slackMin: buffer,
    comfort,
    rating: opt.rating,
    availability: opt.availability,
    cost: { fare: opt.price, extras: [], refund, net },
    actions,
    itinerary,
  };
}

// ---------- Step 5: rank ----------
const WEIGHTS = {
  cheapest: { cost: 0.8, time: 0.1, comfort: 0.1 },
  fastest: { cost: 0.15, time: 0.7, comfort: 0.15 },
  comfort: { cost: 0.1, time: 0.1, comfort: 0.8 },
  balanced: { cost: 0.4, time: 0.3, comfort: 0.3 },
};

function rank(plans, priority, budget) {
  const w = WEIGHTS[priority] || WEIGHTS.balanced;
  const costs = plans.map((p) => p.cost.net);
  const slacks = plans.map((p) => Math.min(p.slackMin, 180));
  // Spread is at least the budget, so a ₹300 difference does not look like a huge gap
  const norm = (v, arr, invert, minSpread) => {
    const lo = Math.min(...arr), hi = Math.max(...arr);
    const spread = Math.max(hi - lo, minSpread);
    if (!spread) return 1;
    const x = (v - lo) / spread;
    return invert ? 1 - x : x;
  };
  for (const p of plans) {
    p.scores = {
      cost: norm(p.cost.net, costs, true, budget),
      time: norm(Math.min(p.slackMin, 180), slacks, false, 240),
      comfort: p.comfort / 5,
    };
    p.score = Math.round(100 * (w.cost * p.scores.cost + w.time * p.scores.time + w.comfort * p.scores.comfort));
  }
  return plans.sort((a, b) => b.score - a.score);
}

// ---------- Full pipeline ----------
function runAgent(scenarioId, constraints = {}) {
  const scenario = data.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error('Unknown scenario: ' + scenarioId);
  const c = { ...data.defaultConstraints, ...constraints };
  c.extraBudget = Number(c.extraBudget);
  const prefs = parseNotes(c.notes);
  const disrupted = byId(scenario.bookingId);
  const trace = [];

  trace.push({
    key: 'detect',
    title: 'Detected the disruption',
    detail: `${scenario.headline}. Cause: ${scenario.cause}.`,
  });

  const impacts = detectCascade(scenario);
  const affected = Object.entries(impacts).filter(([, v]) => v.status !== 'ok');
  trace.push({
    key: 'cascade',
    title: `Traced the knock-on effects: ${affected.length - 1} more ${affected.length - 1 === 1 ? 'booking' : 'bookings'} at risk`,
    detail: affected.map(([id, v]) => `${byId(id).title.split(',')[0]}: ${v.note}`).join('\n'),
  });

  let pool, evaluated;
  if (disrupted.type === 'hotel') {
    pool = data.hotelOptions;
    evaluated = pool.map((o) => evalHotel(o, scenario, c));
  } else {
    pool = [...data.transportOptions];
    if (scenario.kind === 'delay') {
      pool.unshift({
        id: 'STAY',
        isStay: true,
        mode: 'train',
        title: 'Stay on the delayed Train 16511',
        from: 'KSR Bengaluru',
        to: 'Mangaluru Central',
        dep: iso(ms(disrupted.start) + scenario.delayMin * MIN),
        arr: iso(ms(disrupted.end) + scenario.delayMin * MIN),
        price: 0,
        comfort: 3,
        availability: 'Already booked',
        confirmed: true,
      });
    }
    evaluated = pool.map((o) => evalTransport(o, scenario, c, prefs));
  }
  const modes = [...new Set(pool.map((o) => o.mode || 'hotel'))];
  trace.push({
    key: 'search',
    title: `Searched ${pool.length} alternatives`,
    detail: disrupted.type === 'hotel' ? 'Hotels in Mangaluru and Udupi with rooms for 25 Oct' : `Across ${modes.join(', ')} for Bengaluru to Mangaluru tonight`,
  });

  const feasible = evaluated.filter((p) => p.feasible);
  const rejected = evaluated.filter((p) => !p.feasible);
  const notesLine = prefs.avoid.size ? ` Also honoured your note: no ${[...prefs.avoid].map((m) => ({ bus: 'buses', flight: 'flights', train: 'trains', taxi: 'long taxi rides' }[m])).join(' or ')}.` : '';
  trace.push({
    key: 'filter',
    title: `Checked each against your limits: ${feasible.length} fit, ${rejected.length} ruled out`,
    detail: `Budget ${rupees(c.extraBudget)} extra after refunds, reach Mangaluru by ${fmt(ms(c.arriveBy))}, and reach the wedding 15 min before 11:00 AM.${notesLine}`,
  });

  rank(feasible, c.priority, c.extraBudget);
  trace.push({
    key: 'rank',
    title: `Ranked the options for "${c.priority}"`,
    detail: feasible.length ? feasible.map((p) => `${p.title}: ${p.score}/100`).join('\n') : 'No option fits all your limits.',
  });

  return {
    scenario,
    constraints: c,
    impacts,
    trace,
    plans: feasible.slice(0, 3),
    rejected,
    recommendedId: feasible[0]?.id || null,
  };
}

module.exports = { runAgent, fmt, hm, ms, rupees };
