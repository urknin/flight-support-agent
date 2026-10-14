# 🛫 Cloudflare Autonomous Flight Support & Disruption Agent

> 🌐 **Live Production App:** [https://flight-support-agent.rk-siddart.workers.dev](https://flight-support-agent.rk-siddart.workers.dev)  
> 🩺 **Live Health Check:** [`https://flight-support-agent.rk-siddart.workers.dev/api/health`](https://flight-support-agent.rk-siddart.workers.dev/api/health) — `{"status":"healthy","services":{"worker":"online","d1":"connected"}}`  
> 📦 **GitHub Repository:** [https://github.com/urknin/flight-support-agent](https://github.com/urknin/flight-support-agent)  
> 🚦 **CI/CD Pipeline:** [![CI/CD Pipeline](https://github.com/urknin/flight-support-agent/actions/workflows/deploy.yml/badge.svg)](https://github.com/urknin/flight-support-agent/actions/workflows/deploy.yml)

An autonomous, AI-powered customer support and rebooking agent built on the **Cloudflare Developer Platform** for the **Senior Software Engineer (Cloudflare for SaaS)** assignment.

Powered by **Cloudflare Agents SDK**, **Workers AI (Llama 3.3 70B)**, **Cloudflare Workflows**, **Durable Objects**, and **D1 Database**.

---

## 🌟 Architecture Overview

```
                                      +---------------------------------------------+
                                      |          Cloudflare Developer Platform      |
                                      |                                             |
   +-------------------+              |  +--------------------+                     |
   |                   |  WebSocket   |  |   SupportAgent     | <---> [Workers AI]  |
   | Passenger Browser | <=========>  |  |  (Durable Object)  |       (Llama 3.3)   |
   |  (Ops Dashboard)  |              |  +---------+----------+                     |
   |                   |  HTTP REST   |            |                                |
   +-------------------+ -----------> |  +---------v----------+  Atomic Decr        |
            ^                         |  |   Cloudflare D1    | <===========+       |
            |                         |  | (SQLite Database)  |             |       |
            | Notification Drawer     |  +---------^----------+             |       |
            | (Fallback / Demo)       |            |                        |       |
            |                         |  +---------+----------+             |       |
   +--------+----------+              |  | FlightWatcher      |             |       |
   |  Proactive Alerts | <----------- |  | Workflow (Engine)  |             |       |
   | (SMS / Email)     |  Twilio/     |  +---------+----------+             |       |
   +-------------------+  Resend      +------------|------------------------+-------+
                                                   | Polling (Open-Meteo & FAA)
                                                   v
                                      +------------------------+
                                      | Free External APIs     |
                                      | - Open-Meteo (Weather) |
                                      | - FAA NAS Status       |
                                      +------------------------+
```

### Cloudflare Stack Alignment

| Cloudflare Primitive | Implementation in Project | Key Value Delivered |
| :--- | :--- | :--- |
| **Workers AI** | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Zero-latency inference on Cloudflare's edge; tool calling for airport weather, seat lookups, and rebooking. |
| **Agents SDK** | `AIChatAgent` on Durable Objects | Persistent per-passenger WebSocket sessions, conversational memory, and bi-directional push. |
| **Cloudflare Workflows** | `FlightWatcherWorkflow` | Bounded, state-diff-driven background watcher with durable sleep steps and automatic retry. |
| **Cloudflare D1** | `flight-support-db` (SQLite) | Relational storage for flights, seat inventories, passenger profiles, and delivery audit logs. |
| **Cloudflare Assets** | Static Dashboard in `src/public/` | Zero-configuration single-page app serving airport ops board, weather radar, and chat UI. |

---

## 🚀 Key Features

1. **Autonomous Disruption Detection**:
   - `FlightWatcherWorkflow` continuously monitors flights and hub weather (DFW, ORD).
   - Translates WMO meteorological codes (e.g. Code 95 = Severe Convective Thunderstorm) into human-intelligible root cause summaries.
   - Computes state diffs and only triggers alerts when flight status or delay times change.

2. **Stateful Rebooking Chat Agent**:
   - `SupportAgent` runs on Durable Objects with WebSocket streaming.
   - Enforces a rolling 10-turn context window to conserve LLM tokens and eliminate hallucinations.
   - Programmatic sanitization (`safeParseToolArgs`) strips stray markdown code blocks from small-model tool calls.

3. **Dual-Mode Proactive Dispatch (SMS & Email)**:
   - **Live Mode**: If `TWILIO_ACCOUNT_SID` and `RESEND_API_KEY` are provided, real SMS and responsive HTML emails are dispatched.
   - **Zero-Config Evaluation Mode**: When running without third-party API keys (or on trial accounts with unverified numbers), alerts are transparently routed to the **In-App Notification Drawer** in the dashboard. Evaluators never get blocked.

4. **Concurrency & Fault Tolerance**:
   - `withDbRetry()`: Exponential backoff with full jitter to handle SQLite single-writer lock contention (`SQLITE_BUSY`).
   - Atomic seat decrement (`UPDATE flights SET available_seats = available_seats - 1 WHERE available_seats > 0`) to prevent overbooking races.
   - 4-second `AbortController` timeouts on external weather and FAA queries with local fallback caches.

---

## 🛠️ Getting Started

### Prerequisites
- Node.js `v20+` or `v22+` (tested with Node `v22.22.1` & npm `10.9.4`)
- Wrangler CLI (`v4.150.0` or higher, included in `devDependencies`)

### 1. Installation

```bash
git clone <repo-url> flight-support-agent
cd flight-support-agent
npm install
```

### 2. Initialize Local D1 Database

Run the schema migration to create the relational tables and seed test flight disruptions:

```bash
npm run db:init
```

This creates the local SQLite database in `.wrangler/state/` with 3 airports (DFW, ORD, AUS), 6 flights, and test passenger bookings (e.g. `SKY-8842` for Alice Johnson on `AA1822`).

### 3. Run Automated Tests

Run the built-in Node test suite verifying input validation, weather translation, and mock dispatchers:

```bash
npm test
npm run typecheck
```

### 4. Start Local Development Server

```bash
npm run dev
```

Visit **`http://localhost:8787`** in your browser.

---

## 🚀 Automated CI/CD Pipeline (GitHub Actions)

This project features a fully automated edge deployment pipeline in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

- **Offline Quality Gate (`test-and-verify`)**: Triggered on every pull request and push. Executes completely offline without credentials: runs `npm ci`, strict TypeScript typechecking (`tsc --noEmit`), 26 automated unit tests across 5 suites (`npm test`), and offline bundle verification (`wrangler deploy --dry-run`).
- **Production Edge Release (`deploy`)**: Triggered on pushes to `main`. Executes idempotent DDL schema migrations against Cloudflare D1 (`schema.sql`), deploys the Worker, Durable Objects, Workflows, and static assets via `wrangler deploy`, and verifies deployment status via `wrangler deployments list`.

---

## 🎮 Interactive Live Demo Walkthrough

> 💡 **Instant Evaluation:** You can experience the complete system directly on the live production deployment at **[https://flight-support-agent.rk-siddart.workers.dev](https://flight-support-agent.rk-siddart.workers.dev)** (or locally at `http://localhost:8787`).

### Scenario: Severe Thunderstorms at DFW Delaying Flight AA1822

1. **Open the Dashboard**:
   - Navigate to **[https://flight-support-agent.rk-siddart.workers.dev](https://flight-support-agent.rk-siddart.workers.dev)**.
   - The left pane displays the **Live Flight Operations Board** (`AA1822` to Chicago ORD, `AA2040`, `UA450`, etc.) powered by Cloudflare D1.
   - The **Airport Weather Radar** displays live aviation weather conditions dynamically fetched from Open-Meteo.

2. **Trigger a Disruption**:
   - Click the orange **"Simulate Weather Disruption"** button in the header (or run `curl -X POST https://flight-support-agent.rk-siddart.workers.dev/api/simulate-disruption`).
   - `AA1822` status immediately updates to `DELAYED (+180 min)` with root cause: *"Severe Convective Thunderstorms at DFW"*.

3. **Observe Autonomous Multi-Channel Dispatch**:
   - Open the **Notification Drawer** at the bottom right.
   - Observe the automated SMS and Email alerts dispatched for passenger **Alex Mercer** (`SKY-8842`), providing immediate rebooking options.

4. **Engage with the AI Rebooking Assistant**:
   - In the right-hand **AI Passenger Assistant** panel, passenger Alex Mercer's active case session (`conv_p101_active`) is loaded.
   - The assistant reviews the storm delay, presents flight alternatives (`AA2040` at 18:45 UTC, `AA912`, or next-morning options), and renders interactive suggestion cards.
   - Click the **"Rebook on flight AA2040 at 18:45 UTC"** suggestion card or type: *"Can you rebook me on flight AA2040?"*
   - The agent calls `rebook_flight`, atomically decrements available seats in D1, updates the booking to `REBOOKED`, and confirms the itinerary without human intervention.

5. **Multi-Case Intake & Resolution Lifecycle**:
   - Click **`✓ Resolve & End Chat`** in the case header. Workers AI generates an automated resolution summary and transitions the conversation to a read-only `RESOLVED` state.
   - Click **`✨ New Case`** to open an AI-assisted case intake with live customer conflict prevention (1 active case per customer rule), or click **`🔍 Cases`** to search past conversations by Customer Name (`Alex Mercer`) or Customer ID (`P-101`).

---

## 📂 Project Structure

```
flight-support-agent/
├── package.json               # Dependencies & scripts (agents, ai v7, workers-ai-provider, wrangler)
├── tsconfig.json              # TypeScript strict configuration
├── wrangler.jsonc             # Cloudflare bindings (AI, Durable Object, Workflow, D1, Assets)
├── schema.sql                 # D1 relational schema (pure DDL tables & indexes, idempotent for CI)
├── seed.sql                   # One-time scenario seed data (airports, flights, bookings, cases)
├── PROMPT_HISTORY.md          # Mandatory AI collaboration & prompt log
├── README.md                  # System documentation & evaluation guide
├── src/
│   ├── types.ts               # Domain types, D1 models, Cloudflare Env interface
│   ├── index.ts               # Worker entrypoint, REST API router, routeAgentRequest
│   ├── agent.ts               # SupportAgent (AIChatAgent on Durable Objects)
│   ├── workflow.ts            # FlightWatcherWorkflow background monitor
│   ├── db/
│   │   └── client.ts          # D1 queries with withDbRetry() jitter & atomic seat decr
│   ├── tools/
│   │   ├── index.ts           # Tool registry & execution router
│   │   ├── weather.ts         # Open-Meteo API client & WMO hazard translator
│   │   ├── faa.ts             # FAA NAS status API client
│   │   └── parser.ts          # safeParseToolArgs & input sanitizers
│   ├── notifications/
│   │   ├── dispatcher.ts      # Multi-channel safe dispatcher (Live + Mock drawer)
│   │   ├── twilio.ts          # Twilio SMS client with Error 21608 handling
│   │   └── resend.ts          # Resend Email client
│   └── public/                # Ops & Passenger Dashboard UI
│       ├── index.html         # Semantic dark-mode layout
│       ├── style.css          # Glassmorphic airport operations styling
│       └── app.js             # WebSocket client & dashboard controller
└── test/                      # 26 automated unit tests across 5 test suites (node:test)
```

---

## 🔒 Security & Reliability Considerations

- **SQL Injection Defense**: All D1 database queries use parameterized prepared statements (`db.prepare(...).bind(...)`).
- **Prompt Injection Defense**: Inputs are strictly validated through regex guards before reaching LLM tool parameters.
- **Fail-Safe External Calls**: All external HTTP calls feature 4-second timeouts and automatic fallback to cached aviation conditions.
- **Zero Credentials Required**: Evaluators can run and test every single feature locally without external accounts or billing.
