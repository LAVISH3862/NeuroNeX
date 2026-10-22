# ReRoute

**An AI agent for travel disruption recovery.** When one booking breaks, ReRoute finds everything else it breaks, searches alternatives within the traveller's limits, and builds a new itinerary the traveller approves.

Built for DevHack, Synergia '26, problem statement **PS 4.1: AI Agent for Travel Disruption Recovery**.

## The problem

A cancelled train is never just a cancelled train. Sathvik is travelling from Bengaluru to Mangaluru for a wedding in Udupi. His train is cancelled at 5:30 PM. Now his early hotel check-in, his cab to the venue and the wedding itself are all at risk, and he has to fix each one by hand, across different apps, at a railway station.

Existing tools like TripIt alert you and list alternate flights, but they look at one booking at a time and leave the rebooking to you.

## What ReRoute does

1. **Detects** the disruption (simulated: cancellation, delay or hotel overbooking)
2. **Traces the knock-on effects** through the trip: train, then hotel, then cab, then the event
3. **Searches alternatives** across bus, train, flight and taxi (or hotels)
4. **Checks every option against the traveller's limits**: extra budget after refunds, latest arrival time, reaching the event on time, and his own notes ("avoid buses")
5. **Ranks** the options for his priority: balanced, cheapest, earliest or comfort
6. **Explains** each plan with AI (Google Gemini)
7. **Waits for his approval**, then shows the new itinerary, a to-do list, a refund request, a message to the hotel or cab, and a phone alert in English, Kannada and Hindi

## What makes it different

- **Whole-trip recovery**, not single-ticket rebooking
- **Refund-aware budgeting**: the refund from the broken booking is counted, so a ₹3,900 flight can still fit a ₹3,000 budget
- **Hybrid AI design**: all prices and times are computed by deterministic code; the AI explains and writes but can never invent a number, and it can only recommend a plan that passed every check
- **Human in the loop**: nothing changes until the traveller approves (unlike airline systems that rebook people without asking)
- **Transparent**: every ruled-out option shows why, and every run and approval is logged
- **Inclusive**: alerts in Kannada and Hindi, high-legibility font, works on mobile, works offline without an API key

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. There are no packages to install.

```bash
node server.js
```

Open http://localhost:3000

### Turn on live AI (optional)

1. Get a free API key at https://aistudio.google.com/apikey
2. Copy `.env.example` to `.env`
3. Paste the key after `GEMINI_API_KEY=`
4. Restart the server. The header will show "AI live".

Without a key, ReRoute runs in offline mode with built-in explanations, so the demo always works.

## Demo script

1. Choose **Train cancelled** and press **Simulate disruption**
2. Watch the trip on the left: the break spreads from the train to the hotel, cab and wedding, while the return flight stays safe
3. Read the agent's six steps, then compare the three plans
4. Open **options ruled out, and why**
5. Change "What matters most" to **Comfort** and run again: the pick changes to the morning flight
6. Type "avoid buses" in the notes and run again
7. **Approve** a plan: see the new itinerary, to-do list, refund request and the Kannada alert

## Project structure

```
server.js          HTTP server and API routes (no dependencies)
src/data.js        Simulated bookings, disruptions and alternatives
src/agent.js       The agent: detect, cascade, search, filter, rank
src/ai.js          Gemini integration with offline fallback and guardrails
public/            Frontend (HTML, CSS, JavaScript)
```

### API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/state` | Trip, bookings, scenarios, AI status |
| POST | `/api/recover` | Runs the agent. Body: `{ scenarioId, constraints }` |
| POST | `/api/approve` | Traveller approves a plan. Body: `{ scenarioId, constraints, planId }` |
| GET | `/api/audit` | Activity log |

## Next steps

- Live data: IRCTC, KSRTC and airline APIs, plus email parsing to import bookings automatically
- One-tap rebooking through partner APIs
- WhatsApp and SMS alerts for travellers without smartphones
- Predicting disruptions from weather and rail delay patterns

## Note

All bookings, schedules and prices in this prototype are simulated for demonstration.
