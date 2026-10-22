// AI layer for ReRoute.
// Uses Google Gemini when GEMINI_API_KEY is set. If the key is missing, the network is down,
// or the model returns something invalid, it falls back to a built-in offline writer so the
// demo never breaks. Guardrail: the AI may only pick from plans the agent already proved feasible.

const { fmt, hm: clock, ms, rupees } = require('./agent');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const KEY = () => process.env.GEMINI_API_KEY;
const hm = (s) => clock(ms(s));
// Kannada and Hindi say the part of the day instead of AM/PM: "ಬೆಳಿಗ್ಗೆ 6:15", "सुबह 6:15"
const DAY_PARTS = { kn: ['ಬೆಳಿಗ್ಗೆ', 'ಮಧ್ಯಾಹ್ನ', 'ಸಂಜೆ', 'ರಾತ್ರಿ'], hi: ['सुबह', 'दोपहर', 'शाम', 'रात'] };
function indicTime(s, lang) {
  const h = +s.slice(11, 13);
  const part = h >= 4 && h < 12 ? 0 : h < 16 ? 1 : h < 20 ? 2 : 3;
  return `${DAY_PARTS[lang][h >= 4 ? part : 3]} ${h % 12 || 12}:${s.slice(14, 16)}`;
}

function aiStatus() {
  return KEY() ? { mode: 'gemini', model: MODEL } : { mode: 'offline', model: 'built-in rules' };
}

// Retries busy-server errors (429/5xx) within one 20 s budget, then gives up so the caller falls back to offline
async function callGemini(prompt) {
  const deadline = Date.now() + 20000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await callGeminiOnce(prompt, deadline - Date.now());
    } catch (err) {
      const busy = /HTTP (429|5\d\d)/.test(err.message);
      const pause = 700 * attempt;
      if (!busy || attempt >= 4 || Date.now() + pause + 3000 > deadline) throw err;
      console.warn(`[ai] Gemini busy, retrying (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, pause));
    }
  }
}

async function callGeminiOnce(prompt, timeoutMs) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
          // Gemini 3 thinks by default: ~11 s per call. Low thinking is ~4 s and plenty for explaining fixed numbers
          ...(MODEL.startsWith('gemini-3') && { thinkingConfig: { thinkingLevel: 'low' } }),
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    return JSON.parse(text.replace(/^```json\s*|```\s*$/g, ''));
  } finally {
    clearTimeout(timer);
  }
}

// Compact facts for the model, so it reasons over real numbers only
function planFacts(p) {
  return {
    id: p.id,
    title: p.title,
    mode: p.mode,
    depart: p.depart,
    arrive: p.arrive,
    reachVenue: p.venueAt,
    minutesSpareBeforeWedding: p.bufferMin,
    comfortOutOf5: p.comfort,
    netExtraCostINR: p.cost.net,
    fareINR: p.cost.fare,
    refundINR: p.cost.refund,
    extras: p.cost.extras,
    warnings: p.warnings,
    agentScore: p.score,
    actions: p.actions.map((a) => a.text),
  };
}

// ---------- 1. Explain and double-check the ranked plans ----------
async function explainPlans(result, traveller) {
  const { scenario, constraints: c, plans, rejected } = result;
  if (!plans.length) {
    return {
      source: 'agent',
      summary: 'None of the alternatives fit all your limits. Try raising the budget or allowing a later arrival.',
      reasons: {},
      recommendedId: null,
    };
  }

  if (KEY()) {
    const prompt = `You are ReRoute, an AI travel disruption recovery agent for travellers in India.
A disruption happened. A deterministic engine has already computed every price and timing below; never change or invent numbers.

Traveller: ${traveller.name}, trip purpose: ${traveller.purpose}.
Disruption: ${scenario.headline} (${scenario.cause}).
Traveller constraints: max extra spend ${c.extraBudget} INR after refunds, must reach Mangaluru by ${c.arriveBy}, priority "${c.priority}".
Traveller's own note (may be empty): "${c.notes || ''}"

Feasible plans (already ranked by the engine):
${JSON.stringify(plans.map(planFacts), null, 1)}

Ruled-out options and why:
${JSON.stringify(rejected.map((r) => ({ title: r.title, why: r.reasons })), null, 1)}

Tasks:
1. Pick the single best plan id for this traveller, considering their priority AND their note (e.g. "travelling with my mother" or "I get motion sick"). Keep the engine's top pick unless the note gives a clear reason to change.
2. For each feasible plan, write one plain-English sentence (max 30 words) on why someone would choose it and its main trade-off.
3. Write a 2-sentence summary for the traveller: what broke, and what you recommend.

Return JSON only: {"recommendedId": string, "summary": string, "reasons": {"<planId>": string}}`;
    try {
      const out = await callGemini(prompt);
      const ids = new Set(plans.map((p) => p.id));
      if (!out || typeof out.summary !== 'string') throw new Error('Bad shape');
      return {
        source: 'gemini',
        model: MODEL,
        summary: out.summary,
        reasons: out.reasons || {},
        // Guardrail: AI can only choose a plan the engine proved feasible
        recommendedId: ids.has(out.recommendedId) ? out.recommendedId : result.recommendedId,
        overrode: ids.has(out.recommendedId) && out.recommendedId !== result.recommendedId,
      };
    } catch (e) {
      console.warn('[ai] Gemini explain failed, using offline writer:', e.message);
    }
  }
  return offlineExplain(result);
}

function offlineExplain(result) {
  const { scenario, plans } = result;
  const best = plans[0];
  const reasons = {};
  const cheapest = [...plans].sort((a, b) => a.cost.net - b.cost.net)[0];
  const comfiest = [...plans].sort((a, b) => b.comfort - a.comfort)[0];
  for (const p of plans) {
    const money = p.cost.net <= 0 ? `saves you ${rupees(-p.cost.net)} after the refund` : `costs ${rupees(p.cost.net)} extra after the refund`;
    let why;
    if (p === best) why = `Best overall balance for your priority: ${money}, and you reach the venue with ${p.bufferMin} min to spare.`;
    else if (p === cheapest) why = `Cheapest option: ${money}.`;
    else if (p === comfiest) why = `Most comfortable (${p.comfort}/5), but ${money}.`;
    else why = `Solid backup: ${money}, ${p.bufferMin} min to spare.`;
    reasons[p.id] = why.trim();
  }
  return {
    source: 'offline',
    summary: `${scenario.headline}, which puts the rest of your trip at risk. I recommend ${best.title}: it fits your budget and gets you to the wedding on time.`,
    reasons,
    recommendedId: best.id,
  };
}

// ---------- 2. Messages after the traveller approves a plan ----------
async function draftMessages(result, plan, traveller) {
  const { scenario } = result;
  if (KEY()) {
    const prompt = `You are ReRoute, a travel recovery agent. The traveller ${traveller.name} approved this recovery plan after: ${scenario.headline}.
Plan facts (do not change any number or time):
${JSON.stringify(planFacts(plan), null, 1)}
Refund rule: ${scenario.refund.how}. Original booking reference: ${scenario.bookingId === 'TRN' ? 'PNR 452 187 9330, Train 16511, 24 Oct 2026' : 'Hotel Sea Breeze Residency, booking HSB-77812, 25 Oct 2026'}.

Write:
1. notification: a short phone notification (max 35 words) telling the traveller the new plan and the first thing to do, in three versions: English ("en"), Kannada in Kannada script ("kn"), Hindi in Devanagari ("hi"). Write times in 12-hour format: "9:30 PM" in English; in Kannada and Hindi use the part-of-day word instead of AM/PM, like "ರಾತ್ರಿ 9:30" and "रात 9:30 बजे".
2. refundRequest: a polite, formal refund request message (60-100 words) the traveller can send, signed "${traveller.name}".
3. providerMessage: a short message (max 40 words) to the hotel or cab company about the change in timing or address.

Return JSON only: {"notification":{"en":string,"kn":string,"hi":string},"refundRequest":string,"providerMessage":string}`;
    try {
      const out = await callGemini(prompt);
      if (!out?.notification?.en || !out.refundRequest) throw new Error('Bad shape');
      return { source: 'gemini', model: MODEL, ...out };
    } catch (e) {
      console.warn('[ai] Gemini messages failed, using offline writer:', e.message);
    }
  }
  return offlineMessages(result, plan, traveller);
}

function offlineMessages(result, plan, traveller) {
  const { scenario } = result;
  const isHotel = plan.mode === 'hotel';
  const first = plan.actions[0].text;
  const when = plan.depart ? hm(plan.depart) : '';
  const name = plan.title.split(' (')[0];

  const en = isHotel
    ? `Your hotel cancelled. New stay: ${name}. Book it now, your cab is updated and your train is unchanged.`
    : `${scenario.headline}. New plan: ${name}, leaves at ${when}. Book it now, your hotel and cab are adjusted.`;
  const kn = isHotel
    ? `ನಿಮ್ಮ ಹೋಟೆಲ್ ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ. ಹೊಸ ವಸತಿ: ${name}. ಈಗಲೇ ಬುಕ್ ಮಾಡಿ. ನಿಮ್ಮ ಕ್ಯಾಬ್ ಬದಲಾಯಿಸಲಾಗಿದೆ.`
    : `ನಿಮ್ಮ ರೈಲು ${scenario.kind === 'cancel' ? 'ರದ್ದಾಗಿದೆ' : 'ತಡವಾಗಿದೆ'}. ಹೊಸ ಯೋಜನೆ: ${name}, ${plan.depart ? indicTime(plan.depart, 'kn') : ''}ಕ್ಕೆ ಹೊರಡುತ್ತದೆ. ಈಗಲೇ ಬುಕ್ ಮಾಡಿ.`;
  const hi = isHotel
    ? `आपकी होटल बुकिंग रद्द हो गई है। नया होटल: ${name}। अभी बुक करें, आपकी कैब अपडेट कर दी गई है।`
    : `आपकी ट्रेन ${scenario.kind === 'cancel' ? 'रद्द हो गई है' : 'देरी से चल रही है'}। नया प्लान: ${name}, ${plan.depart ? indicTime(plan.depart, 'hi') : ''} बजे निकलेगी। अभी बुक करें।`;

  const refundRequest = isHotel
    ? `Dear Hotel Sea Breeze Residency team,\n\nMy booking HSB-77812 for 25 October 2026 was cancelled by the property due to overbooking. As the cancellation was not made by me, I request a full refund of ${rupees(plan.cost.refund)} to my original payment method.\n\nPlease confirm the refund reference at your earliest convenience.\n\nThank you,\n${traveller.name}`
    : `Dear IRCTC Support,\n\nMy ticket PNR 452 187 9330 on Train 16511 (KSR Bengaluru to Mangaluru Central) for 24 October 2026 was ${scenario.kind === 'cancel' ? 'cancelled by the railways' : 'delayed by more than 3 hours, so I am not travelling'}. I request a full fare refund of ${rupees(plan.cost.refund)} to my original payment method${scenario.kind === 'delay' ? ' under the TDR rules' : ''}.\n\nPlease share the refund reference number.\n\nThank you,\n${traveller.name}`;

  const cabChange = plan.actions.find((a) => /cab/i.test(a.text) && a.type === 'notify');
  const hotelChange = plan.actions.find((a) => /hotel/i.test(a.text) && a.type === 'notify');
  const providerMessage = cabChange
    ? `Hello Coastal Cabs, booking CAB-3391 for ${traveller.name} on 25 Oct: ${cabChange.text.replace(/^Move cab pickup/, 'please move the pickup').replace(/^Change cab: /, 'please ').replace(/^Update cab pickup address/, 'please update the pickup address')}. Thank you.`
    : hotelChange
    ? `Hello Hotel Sea Breeze, booking HSB-77812 for ${traveller.name}: ${
        /^Extend/.test(hotelChange.text)
          ? `please extend my booking to include tonight, 24 Oct. I will arrive at ${(hotelChange.text.match(/arriving (\d\d:\d\d)/) || [])[1]}.`
          : `my train was ${scenario.kind === 'cancel' ? 'cancelled' : 'delayed'}, so I will check in at ${(hotelChange.text.match(/at (\d{1,2}:\d\d [AP]M)/) || [])[1]} instead of 7:00 AM. Please hold my room.`
      } Thank you.`
    : `No message needed: your hotel and cab timings stay the same.`;

  return { source: 'offline', notification: { en, kn, hi }, refundRequest, providerMessage, firstStep: first };
}

module.exports = { aiStatus, explainPlans, draftMessages };
