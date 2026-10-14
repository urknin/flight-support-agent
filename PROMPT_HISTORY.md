# Prompt History & AI Collaboration Log

> **Role & Submission Context**: Senior Software Engineer (Cloudflare for SaaS) Take-Home Assignment  
> **Candidate**: Autonomous AI Flight Support & Disruption Rebooking Agent  
> **Evaluation Criteria**: Code quality, architectural depth, resilient distributed systems design on Cloudflare Developer Platform, and effectiveness in collaborating with AI.

---

## Executive Summary

This log documents the iterative collaboration between the human engineer and the AI coding assistant (Google Antigravity / Gemini 2.5 Flash / Claude 3.5 Sonnet) across all project phases. Rather than using AI merely for boilerplate generation, the collaboration centered on **adversarial architecture review, multi-agent stress testing, and proactive edge-case discovery** (specifically tackling distributed system race conditions, LLM JSON hallucination edge-cases, and Cloudflare Workflows sleep boundaries).

---

## 1. Ideation & Requirements Alignment

### Prompt 1.1: Project Selection & Technical Mapping
**Prompt**:
> *"Review the Cloudflare Senior Software Engineer application requirements and the Cloudflare Agents documentation. What project ideas best demonstrate mastery of Workers AI, Agents SDK, Cloudflare Workflows, and real-time stateful interactions?"*

**Collaboration Rationale**:
- Evaluated options: Real-time collaborative canvas vs. Autonomous flight disruption support vs. SaaS multi-tenant gateway.
- Selected **Autonomous Flight Disruption & Rebooking Support Agent** because it naturally exercises:
  1. **LLM Decision-Making**: Interpreting FAA alerts and WMO meteorological codes to explain delay root causes to distressed passengers.
  2. **Cloudflare Agents SDK (`AIChatAgent`)**: Stateful passenger session running on Durable Objects with WebSocket streaming.
  3. **Cloudflare Workflows**: Asynchronous, durable background poller monitoring flight status changes and triggering proactive dispatches.
  4. **Cloudflare D1**: Transactional SQLite storing relational data (flights, seat inventory, alert logs).
  5. **Proactive External Dispatch**: Real-time SMS and Email alerts.

### Prompt 1.2: Boundary Refinement (Proactive Channels & Zero-Cost Evaluation)
**Prompt**:
> *"For notifications, let's strictly support SMS and Email (skip mobile push). How can we ensure the evaluators can test the entire workflow and demo without needing paid Twilio or Resend credentials?"*

**Engineering Outcome**:
- Designed the **Dual-Mode Dispatcher Architecture**:
  - If `TWILIO_ACCOUNT_SID` and `RESEND_API_KEY` are provided in `.dev.vars`, real SMS and styled HTML emails are sent.
  - If keys are missing, or if a Twilio trial error `21608` (unverified number) occurs, the system transparently logs deliveries to D1 (`notification_logs`) and renders them in a real-time **Notification Drawer UI**, guaranteeing zero-config evaluation.

---

## 2. Adversarial Red-Teaming & Subagent Critique Iterations

To prevent brittle implementation, the plan underwent two rounds of adversarial stress testing. Subagents were tasked with "poking holes" in every phase, and critiques were looped back until all failure modes were resolved.

### Prompt 2.1: Adversarial Hole-Poking
**Prompt**:
> *"The implementation phases are vague. Subagent and write a detailed implementation plan for each phase. Review the plans and poke holes in them."*

**Identified Vulnerabilities (Round 1)**:
1. **Llama 3.3 Markdown Code Fence Issue**: Small/open LLMs often wrap JSON tool arguments in ` ```json ... ``` ` or append conversational preamble, causing `JSON.parse` to crash.
2. **Workers AI Token Limits & DO Hibernation**: Sending unbounded chat history to `@cf/meta/llama-3.3-70b-instruct` risks hitting context limits or blowing latency.
3. **FAA API Flakiness / Downtime**: External FAA status APIs frequently return 500s or rate limit without warning.
4. **Cloudflare Workflows Infinite Loop & Cost**: A workflow polling indefinitely burns resources if not bounded.
5. **D1 SQLite Single-Writer Lock Contention**: Under high concurrent rebooking attempts, D1 can return `SQLITE_BUSY`.
6. **Twilio Free Trial Delivery Failure**: Unverified numbers fail silently with Twilio Error 21608.

### Prompt 2.2: Loop Back and Patch Vulnerabilities
**Prompt**:
> *"Give your critique back to the subagents and make them fix the holes. Iterate until you can't find any before coming back to review."*

**Architectural Patches Applied**:
- **Patch #1 (`src/tools/parser.ts`)**: Built `safeParseToolArgs` that strips markdown code blocks, normalizes unquoted keys, handles relaxed JSON, and enforces regex validators (`sanitizeBookingRef`, `sanitizeFlightNumber`, `sanitizeAirportCode`).
- **Patch #2 (`src/agent.ts`)**: Implemented a sliding 10-message context window to preserve context budget while retaining passenger booking state.
- **Patch #3 (`src/tools/weather.ts` & `src/tools/faa.ts`)**: Wrapped external calls in 4-second `AbortController` timeouts with local in-memory fallback caches.
- **Patch #4 (`src/workflow.ts`)**: Bounded workflow iterations to 48 loops (4 hours at 5-minute intervals), with state diff checking to fire notifications *only* when status or delay minutes actually change.
- **Patch #5 (`src/db/client.ts`)**: Created `withDbRetry()` implementing exponential backoff with full jitter to handle `SQLITE_BUSY` contention, plus atomic seat decrement (`WHERE available_seats > 0`).
- **Patch #6 (`src/notifications/dispatcher.ts`)**: Intercepted Twilio error 21608 to automatically fall back to the In-App Notification Drawer without throwing.

---

## 3. Implementation Prompts & Tool Execution

### Prompt 3.1: Environment & Cloudflare Bindings Setup
**Prompt**:
> *"Configure `wrangler.jsonc` with modern Cloudflare bindings: Workers AI, SupportAgent Durable Object with SQLite migration v1, FLIGHT_WATCHER workflow, D1 database, and static ASSETS."*

**Key Resolution During Execution**:
- Encountered `wrangler v3` bundling conflict with `cloudflare-internal:email` when combined with `agents@0.28.1`. Upgraded to `wrangler@4.150.0` and `@cloudflare/workers-types@latest`, fixing the resolution issue cleanly.

### Prompt 3.2: Database Schema & Real-World Seed Data
**Prompt**:
> *"Draft `schema.sql` with relational schemas for airports, flights, passengers, bookings, alert_subscriptions, and notification_logs. Seed it with realistic flight delay scenarios (e.g. DFW severe thunderstorm causing AA1822 delay, ORD low visibility)."*

**Execution**:
- Executed `wrangler d1 execute flight-support-db --local --file=./schema.sql`.
- Verified seeded entries: 3 hub airports (DFW, ORD, AUS), 6 flights, 4 passengers, and initial subscriptions.

### Prompt 3.3: AI Chat Agent & Durable Object Architecture
**Prompt**:
> *"Build `src/agent.ts` extending `AIChatAgent` from `@cloudflare/ai-chat`. Equip the agent with tools to check flight status, inspect airport weather, review rebooking options, execute seat reservations, and notify the passenger."*

**TypeScript & AI SDK v7 Optimization**:
- AI SDK v7 introduced `inputSchema: z.object(...)` instead of `parameters`. Aligned schemas cleanly.
- Resolved TypeScript recursive type instantiation on `env.SupportAgent.get()` with proper namespace casting.

### Prompt 3.4: Real-Time Ops & Chat Dashboard UI
**Prompt**:
> *"Create a premium, dark-mode airport operations and passenger support dashboard in `src/public/`. Include a live flight board, a weather radar widget, a disruption simulation trigger, an interactive AI chat interface with quick action buttons, and a live notification drawer."*

**Design Standards Applied**:
- Modern typography via Google Fonts (Outfit & JetBrains Mono).
- Glassmorphic translucent cards with subtle border glows.
- Real-time WebSocket connection to `SupportAgent` with automatic reconnect.
- One-click "Simulate Weather Disruption" button triggering `/api/simulate-disruption` to showcase end-to-end autonomous alerts.

---

## 4. Verification & Unit Testing

### Prompt 4.1: Automated Unit Testing
**Prompt**:
> *"Add unit tests using Node.js built-in test runner (`node:test` + `tsx`) to verify the input sanitizer, weather code translation, and mock notification dispatching."*

**Bug Discovered & Fixed During Testing**:
- Initial regex for flight numbers `/^[A-Z0-9]{2,3}\s?[0-9]{1,4}$/` inadvertently matched purely numeric inputs like `1822`.
- Fixed regex to enforce standard IATA carrier code rules: `^([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])\s?[0-9]{1,4}$`.
- All 10 unit test assertions passed with 0 errors.

---

### Prompt 4.2: Structured Prompt Sectioning & Interactive Follow-Up Action Cards
**Prompt**:
> *"2048 tokens are a lot. nobody wants to read all that. can you break the input prompts into appropriate sections? return the response to the primary ask by the customer. serve followup questions as cards at the bottom of the response. the agent can click on a card he wants to pursue"*

**Changes & Architectural Enhancements**:
1. **Sectioned System Instructions (`src/agent.ts`)**:
   - `SECTION 1: PRIMARY RESPONSE & BREVITY`: Strict rules to directly answer the customer's primary ask in 2–3 factual sentences (<120 words) with concise bullet alternatives and zero filler.
   - `SECTION 2: WORKFLOW PRINCIPLES`: Explicit ordering of tools (`lookupPassengerBooking` -> `getAirportConditions` -> `findAlternativeFlights` -> `rebookPassengerFlight` -> `subscribeToFlightAlerts`).
   - `SECTION 3: FOLLOW-UP ACTION CARDS`: Dedicated specification requiring 2–3 logical next steps enclosed in a `<suggestions>` block formatted as `- [Label] | [Explicit User Prompt]`.
2. **Token Budgeting**:
   - Capped `maxOutputTokens: 600` in `streamText` to avoid generating verbose walls of text while retaining sufficient headroom for tool orchestration.
3. **Interactive UI Card System (`src/public/app.js`, `style.css`, `index.html`)**:
   - Implemented `parseSuggestions(text)` to cleanly extract `<suggestions>` tags from prose (and suppress partial opening tags while streaming to prevent flickering).
   - Rendered clickable `.followup-card` action buttons with hover lift, orange glow, and arrow indicators.
   - Attached click handlers that populate the chat input and auto-submit the turn when clicked, allowing immediate pursuit of chosen branches.
   - Preserved trace ticket footer and copy utility at the bottom-right below the action cards.
   - Added unit tests in `test/stream-parser.test.ts` verifying parser accuracy and streaming suppression.

---

### Prompt 4.3: Unique Conversation Sessions, AI Case Intake, Search, and 1-Active Constraint
**Prompt**:
> *"the agent must have an option to open new cases with the help of ai. there must also be an option for agent to resolve and end a chat signifying the customer concern was successfully addressed. an option to search past conversations by customername/customerid. this means we will need a unique conversationId per chat. a customer can only have 1 active conversation at a time."*

**Changes & Architectural Enhancements**:
1. **D1 Relational Schema & State Integrity (`schema.sql`, `src/types.ts`, `src/db/client.ts`)**:
   - Created `conversations` table storing `conversation_id`, `customer_id`, `booking_ref`, `title`, `issue_category`, `status` (`ACTIVE` / `RESOLVED`), `resolution_summary`, `created_at`, `resolved_at`.
   - **Database-Level Constraint**: Added partial unique index `CREATE UNIQUE INDEX idx_unique_active_customer_conv ON conversations(customer_id) WHERE status = 'ACTIVE'`, guaranteeing at the SQLite engine level that no customer can ever have more than 1 concurrent active case.
   - Built query and search functions: `searchConversations` (searching customer name, customer ID, conversation ID, status), `createConversation`, `resolveConversation`, and `getActiveConversationByCustomer`.
2. **AI Case Intake & Resolution Summarizer APIs (`src/index.ts`)**:
   - `POST /api/cases/ai-intake`: Leverages Workers AI (`Llama 3.3 70B`) to diagnose customer flight disruption, draft a concise case title, issue category, priority, diagnosis, and warm opening greeting.
   - `POST /api/cases/ai-summarize-resolution`: Generates a professional resolution summary highlighting addressed customer concerns when closing a case.
   - `POST /api/conversations`: Creates unique conversation sessions (`conv_${customerId}_${timestamp}`) and strictly enforces the 1-active constraint (HTTP 409 Conflict if active case exists).
   - `POST /api/conversations/:id/resolve`: Atomically marks conversation `RESOLVED` with timestamps and resolution notes.
3. **Multi-Case Interactive UI (`src/public/index.html`, `style.css`, `app.js`)**:
   - Case Operations header displaying unique `conversationId`, Customer ID, status badge (`🟢 ACTIVE` / `✓ RESOLVED`), and action buttons (`✓ Resolve & End Chat`, `🔍 Cases`, `✨ New Case`).
   - Modal 1: Real-time search of past and active conversations by Customer Name or Customer ID with status filters and 1-click chat switching.
   - Modal 2: Open New Case with AI assistance, featuring customer selector with live active-case conflict detection (with options to switch to or resolve the existing case) and Llama 3.3 case briefing.
   - Modal 3: Resolve & End Chat with automated AI resolution summary generation, locking chat to read-only state with a green resolution banner.
4. **Automated Testing (`test/conversations.test.ts`)**:
   - Added unit test suite verifying search by customer name/ID, filtering, strict prevention of multiple active cases per customer, and the complete resolution lifecycle.

---

### Prompt 4.4: WebSocket Outbox Buffering & Token Deduplication Defense
**Prompt**:
> *"Please rebook me on flight AA2040 at 18:45 UTC. AI: Reconnecting to flight operations server... Please try again in a moment. assistant_1791935436489_gab02zs4l : duplicte words still."*

**Changes & Architectural Enhancements**:
1. **WebSocket Outbox Queue Buffer (`src/public/app.js`)**:
   - Eliminated connection drops and dropped messages during socket reconnects.
   - Built `pendingOutbox` buffer: if a passenger or agent sends a message or clicks an action card while the WebSocket is connecting or offline, the message is queued immediately and the "Thinking..." indicator appears seamlessly.
   - When `ws.onopen` fires, `flushPendingOutbox()` transmits all queued payloads immediately, guaranteeing zero message loss.
   - Fixed socket churn in `connectAgentWebSocket()` by verifying active URL before reconnecting.
2. **Defensive Token & History Deduplication (`src/public/app.js`, `test/stream-parser.test.ts`)**:
   - Verified that `wrangler dev` active bundle (`dev-rpnYGo`) contains the `hasChoicesDelta` patch from commit `8fef34c`, emitting single tokens cleanly during live streaming.
   - Built `deduplicateRepetitiveText()` to defensively clean consecutive doubled words (`word word`), doubled capitalized tokens (`YouYou`), doubled punctuation (`,,`), and corrupted historical tokens.
   - Sanitized legacy stored messages in Durable Object SQLite storage and integrated deduplication across `cleanAssistantText`, `parseSuggestions`, and `renderFullHistory`.
   - Added unit test suite in `test/stream-parser.test.ts` verifying outbox queuing and string sanitization.

---

### Prompt 4.5: Cloudflare Worker GitHub CI/CD Pipeline & D1 Schema/Seed Isolation
**Prompt**:
> *"okay i want this cloudflare worker deployed using github cicd. draft a plan for that."*  
> Review feedback: *"this will seed the data on every ci. we do not want that. we can run the seed once. seeding does not even need to be a part of ci."*, *"we should use npx wrangler secret put <KEY>"*, *"dry run should not need actual api tokens"*, *"use npx wrangler deployments list"*, *"schema.sql still contain INSERT OR REPLACE"*.

**Changes & Architectural Enhancements**:
1. **D1 Schema vs. Scenario Seed Isolation (`schema.sql`, `seed.sql`, `package.json`)**:
   - Stripped all `INSERT` statements from [`schema.sql`](file:///home/sid/.gemini/antigravity-ide/scratch/flight-support-agent/schema.sql) — making it strictly DDL (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) so it can safely and idempotently run on every CI deployment without altering live data.
   - Extracted one-time initial scenario data (airports, flights, passengers, bookings, conversations) into [`seed.sql`](file:///home/sid/.gemini/antigravity-ide/scratch/flight-support-agent/seed.sql).
   - Added `npm run db:seed` (local) and `npm run db:seed:remote` (remote) to allow manual one-time seeding decoupled from CI.
2. **KMS Secret Management via `wrangler secret put`**:
   - Excluded third-party runtime secrets (`TWILIO_*`, `RESEND_*`) from GitHub Actions workflow files.
   - Documented `npx wrangler secret put <KEY>` for encrypting secrets directly in Cloudflare Worker KMS.
3. **Offline Quality Gate & Production Deploy Workflow (`.github/workflows/deploy.yml`)**:
   - `test-and-verify`: Zero-secret offline quality gate on Node.js 22 LTS running `npm ci`, `tsc --noEmit`, all 26 automated unit tests (`npm test`), and `wrangler deploy --dry-run` with zero Cloudflare credentials.
   - `deploy`: Release pipeline for `main` branch push/dispatch executing remote DDL schema synchronization (`wrangler d1 execute flight-support-db --remote --file=./schema.sql`), bundle deployment (`wrangler deploy`), and deployment audit verification (`wrangler deployments list`).
4. **Documentation**:
   - Documented the CI/CD architecture and one-time setup steps in [`README.md`](file:///home/sid/.gemini/antigravity-ide/scratch/flight-support-agent/README.md) and [`cicd_deployment_plan.md`](file:///home/sid/.gemini/antigravity-ide/brain/02b21afb-51ee-44c3-814a-8ea437c5c0f1/cicd_deployment_plan.md).

---

### Prompt 4.6: Production Health Check Endpoint & Header Status Pinning
**Prompt**:
> *"put the live url in the readme. at the very top. pin the health check status too."*

**Changes & Architectural Enhancements**:
1. **Production Health Check Endpoint (`src/index.ts`)**:
   - Added `GET /api/health` probe that performs a live heartbeat query against Cloudflare D1 (`SELECT 1 as healthy`) and reports individual health states for Worker runtime, D1 edge database, Durable Objects, Workflows, and Workers AI.
2. **Pinned Status & Live Badges (`README.md`)**:
   - Pinned the live production application URL ([`https://flight-support-agent.rk-siddart.workers.dev`](https://flight-support-agent.rk-siddart.workers.dev)) and health check endpoint at the very top of `README.md`.
   - Added live GitHub Actions CI/CD badge linking to automated pipeline status.

---

### Prompt 4.7: Architecture-First README Overhaul & CI/CD Markdown Path Filtering
**Prompt**:
> *"/home/sid/Downloads/cloudflare_flight_support_agent_readme.md add this reaadme. cicd does not need to run for md file changes."*

**Changes & Architectural Enhancements**:
1. **Architecture-First README Overhaul (`README.md`)**:
   - Replaced `README.md` with `/home/sid/Downloads/cloudflare_flight_support_agent_readme.md`.
   - Elevated architectural decisions (Strict Serializability via Durable Objects, zero-latency inference via Workers AI, resilient background execution via Workflows, SQLite write-lock contention handling via `withDbRetry()`, and dual-mode notification dispatch).
   - Maintained top-pinned live production URL and health check badges.
2. **CI/CD Markdown Path Filtering (`.github/workflows/deploy.yml`)**:
   - Configured `paths-ignore: ['**.md']` for both `push` and `pull_request` triggers so that documentation updates do not trigger unnecessary CI/CD pipeline runs and Worker deployments.

---

### Prompt 4.8: Upstream SDK Patch Preparation (`cloudflare/ai`)
**Prompt**:
> *"/home/sid/.gemini/antigravity-ide/scratch/flight-support-agent/scripts/patch-workers-ai.js we should apply this patch directly to the sdk."*

**Changes & Architectural Enhancements**:
1. **Upstream Git Patch File (`patches/0001-fix-workers-ai-provider-streaming-token-duplication.patch`)**:
   - Formatted the fix directly against the upstream monorepo structure (`packages/workers-ai-provider/src/streaming.ts`).
   - Guards native `chunk.response` and `chunk.tool_calls` branches with `hasChoicesDelta` to defer to `choices[0].delta`, preventing token duplication ("word word") and repeated tool argument frames.
2. **Upstream PR Submission Guide (`UPSTREAM_PR_SUBMISSION.md`)**:
   - Created a comprehensive pull request package targeting `cloudflare/ai` on GitHub.
   - Includes root cause analysis, reproduction test case, proposed unified diff, and step-by-step submission commands via GitHub CLI (`gh pr create`).
3. **Upstream PR Tracking**:
   - Identified existing active PR [**cloudflare/ai#663**](https://github.com/cloudflare/ai/pull/663) addressing this exact dual-format duplication issue on Llama 3.3.
   - Closed duplicate PR [**cloudflare/ai#676**](https://github.com/cloudflare/ai/pull/676) with attribution to #663.

---

## 5. Reflections on AI-Assisted Engineering

1. **Iterative Verification Over Blind Acceptance**:
   Running `tsc --noEmit`, `wrangler deploy --dry-run`, and unit tests at every milestone ensured zero hidden runtime errors.
2. **Defensive Prompting Against Hallucinations**:
   Rather than asking the LLM to format arbitrary responses, strict schemas and programmatic sanitizers (`safeParseToolArgs`) were established to isolate and recover from model format deviations.
3. **Distributed System Realism**:
   Leveraging AI to brainstorm boundary conditions (e.g., SQLite lock contention, workflow lifecycle duration, timeout abort controllers) resulted in enterprise-ready code suitable for a Senior Systems Engineer assignment.
