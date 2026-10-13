import { routeAgentRequest } from "agents";
import { Env, FlightStatus, ConversationStatus, IssueCategory } from "./types";
import { SupportAgent } from "./agent";
import { FlightWatcherWorkflow } from "./workflow";
import {
  getBookingDetails,
  getNotificationLogs,
  updateFlightStatus,
  getConversationById,
  getActiveConversationByCustomer,
  searchConversations,
  createConversation,
  resolveConversation,
  getAllPassengers,
} from "./db/client";
import { getAirportWeather } from "./tools/weather";
import { getFAAAirportStatus } from "./tools/faa";
import { dispatchAlert } from "./notifications/dispatcher";

// Export Durable Object and Workflow entrypoints for Cloudflare runtime
export { SupportAgent, FlightWatcherWorkflow };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Route Agent WebSocket connections (support both kebab-case and PascalCase URLs)
    let agentReq = request;
    if (url.pathname.includes("/agents/SupportAgent/")) {
      const rewrittenUrl = new URL(request.url);
      rewrittenUrl.pathname = rewrittenUrl.pathname.replace("/agents/SupportAgent/", "/agents/support-agent/");
      agentReq = new Request(rewrittenUrl.toString(), request);
    }

    const agentResponse = await routeAgentRequest(agentReq, env);
    if (agentResponse) {
      return agentResponse;
    }

    // 2. REST API Routes for Dashboard & Demonstration
    if (url.pathname.startsWith("/api/")) {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
      };

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // GET /api/passengers
      if (url.pathname === "/api/passengers") {
        const passengers = await getAllPassengers(env.DB);
        return new Response(JSON.stringify(passengers), { headers: corsHeaders });
      }

      // GET /api/conversations (search by customer name, customer ID, conversation ID, status)
      if (url.pathname === "/api/conversations" && request.method === "GET") {
        const query = url.searchParams.get("query") || undefined;
        const status = (url.searchParams.get("status") as ConversationStatus | "ALL") || undefined;
        const customerId = url.searchParams.get("customerId") || undefined;
        const conversations = await searchConversations(env.DB, { query, status, customerId });
        return new Response(JSON.stringify({ conversations }), { headers: corsHeaders });
      }

      // POST /api/conversations (create new case, enforce 1 active conversation per customer)
      if (url.pathname === "/api/conversations" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const customerId = (body.customerId || "").trim();
        const bookingRef = body.bookingRef ? body.bookingRef.trim().toUpperCase() : null;
        const title = (body.title || "Flight Disruption Support Case").trim();
        const issueCategory: IssueCategory = body.issueCategory || "WEATHER_DELAY";

        if (!customerId) {
          return new Response(JSON.stringify({ error: "customerId is required" }), {
            status: 400,
            headers: corsHeaders,
          });
        }

        const convId = `conv_${customerId.toLowerCase().replace(/[^a-z0-9]/g, "")}_${Date.now()}`;
        const result = await createConversation(env.DB, {
          conversationId: convId,
          customerId,
          bookingRef,
          title,
          issueCategory,
        });

        if (!result.success) {
          return new Response(
            JSON.stringify({
              error: result.error,
              activeConversation: result.conversation,
            }),
            {
              status: 409,
              headers: corsHeaders,
            }
          );
        }

        return new Response(JSON.stringify({ success: true, conversation: result.conversation }), {
          status: 201,
          headers: corsHeaders,
        });
      }

      // POST /api/conversations/:id/resolve (resolve and end chat)
      if (url.pathname.match(/^\/api\/conversations\/[^/]+\/resolve$/) && request.method === "POST") {
        const id = url.pathname.split("/")[3];
        const body: any = await request.json().catch(() => ({}));
        const summary = body.resolutionSummary;

        const result = await resolveConversation(env.DB, id, summary);
        if (!result.success) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 400,
            headers: corsHeaders,
          });
        }

        // Notify DO session if connected
        try {
          const agentNs = env.SupportAgent as any;
          const agentId = agentNs.idFromName(id);
          const agentStub = agentNs.get(agentId);
          await agentStub.notifyPassenger({
            title: "Case Resolved & Closed",
            body: `This support conversation has been resolved. Resolution: ${result.updated?.resolution_summary}`,
            newStatus: "RESOLVED",
          });
        } catch (e) {
          // Expected if not currently active
        }

        return new Response(JSON.stringify({ success: true, conversation: result.updated }), {
          headers: corsHeaders,
        });
      }

      // GET /api/conversations/:id (fetch single conversation details)
      if (
        url.pathname.startsWith("/api/conversations/") &&
        !url.pathname.includes("/resolve") &&
        request.method === "GET"
      ) {
        const id = url.pathname.replace("/api/conversations/", "").trim();
        const conversation = await getConversationById(env.DB, id);
        if (!conversation) {
          return new Response(JSON.stringify({ error: "Conversation not found" }), {
            status: 404,
            headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify(conversation), { headers: corsHeaders });
      }

      // POST /api/cases/ai-intake (Generate AI pre-briefing, category, and opening greeting)
      if (url.pathname === "/api/cases/ai-intake" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const customerId = (body.customerId || "P-101").trim();
        const bookingRef = body.bookingRef ? body.bookingRef.trim().toUpperCase() : undefined;
        const issueDesc = body.issueDescription || "Severe weather delay rebooking";

        // Check 1-active-conversation rule upfront
        const active = await getActiveConversationByCustomer(env.DB, customerId);
        if (active) {
          return new Response(
            JSON.stringify({
              error: `Customer ${active.customer_name} (${customerId}) already has an active conversation: "${active.title}" (${active.conversation_id}). A customer can only have 1 active conversation at a time.`,
              activeConversation: active,
            }),
            { status: 409, headers: corsHeaders }
          );
        }

        // Fetch customer profile and booking
        const passenger = (await env.DB.prepare("SELECT * FROM passengers WHERE passenger_id = ?").bind(customerId).first()) as any;
        const booking = bookingRef ? await getBookingDetails(env.DB, bookingRef) : null;

        try {
          const prompt = `You are a Senior Airline Customer Support Intake Coordinator.
Create a structured case brief for a passenger experiencing travel disruption:
- Customer: ${passenger?.name || "Passenger"} (ID: ${customerId})
- Booking Ref: ${booking?.booking_ref || bookingRef || "SKY-8842"}
- Scheduled Flight: ${booking?.flight_number || "AA1822"} (${booking?.origin_code || "DFW"} to ${booking?.dest_code || "ORD"})
- Flight Status: ${booking?.flight_status || "DELAYED"} (Reason: ${booking?.delay_reason || "Severe Thunderstorms / FAA Ground Stop"})
- Passenger Request: ${issueDesc}

Respond strictly in valid JSON with no markdown backticks:
{
  "title": "<Concise 5 to 7 word case title>",
  "issueCategory": "WEATHER_DELAY",
  "priority": "HIGH",
  "aiDiagnosis": "<2-sentence diagnostic summarizing passenger disruption and actionable recommendation>",
  "openingMessage": "<Warm, factual, 2-sentence opening greeting stating how the agent will assist>",
  "suggestedActions": [
    "Rebook on AA2040 (18:45 UTC)",
    "Check DFW Storm Radar",
    "Set Up SMS Disruption Alerts"
  ]
}`;

          const aiRes: any = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
            prompt,
            max_tokens: 350,
          });

          let parsed = null;
          if (aiRes && aiRes.response) {
            try {
              const clean = aiRes.response.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
              parsed = JSON.parse(clean);
            } catch {
              // Regex fallback
            }
          }

          if (!parsed) {
            parsed = {
              title: `${booking?.flight_number || "AA1822"} Weather Disruption Support`,
              issueCategory: "WEATHER_DELAY",
              priority: "HIGH",
              aiDiagnosis: `Passenger ${passenger?.name || "Alex Mercer"} is impacted by the 180-min thunderstorm delay on ${booking?.flight_number || "AA1822"}. Immediate rebooking onto AA2040 (8 open seats) is recommended.`,
              openingMessage: `Hello ${passenger?.name ? passenger.name.split(" ")[0] : "Alex"}, I have opened your support case regarding flight ${booking?.flight_number || "AA1822"}. How can I assist you with rebooking or checking alternative flights?`,
              suggestedActions: [
                "Rebook to AA2040 (18:45 UTC)",
                "Check DFW Storm Radar",
                "Set Up SMS Delay Alerts",
              ],
            };
          }

          return new Response(
            JSON.stringify({
              success: true,
              customerId,
              customerName: passenger?.name || "Alex Mercer",
              bookingRef: booking?.booking_ref || bookingRef || "SKY-8842",
              flightNumber: booking?.flight_number || "AA1822",
              ...parsed,
            }),
            { headers: corsHeaders }
          );
        } catch (aiErr: any) {
          console.warn("[AI Intake Fallback]:", aiErr?.message);
          return new Response(
            JSON.stringify({
              success: true,
              customerId,
              customerName: passenger?.name || "Alex Mercer",
              bookingRef: booking?.booking_ref || bookingRef || "SKY-8842",
              flightNumber: booking?.flight_number || "AA1822",
              title: `${booking?.flight_number || "AA1822"} Disruption Case`,
              issueCategory: "WEATHER_DELAY",
              priority: "HIGH",
              aiDiagnosis: `Passenger is delayed due to convective storms at DFW. Open seats confirmed on AA2040.`,
              openingMessage: `Hello ${passenger?.name ? passenger.name.split(" ")[0] : "Alex"}, I have opened your support case regarding flight ${booking?.flight_number || "AA1822"}. How can I assist you today?`,
              suggestedActions: [
                "Rebook to AA2040 (18:45 UTC)",
                "Check DFW Storm Radar",
                "Set Up SMS Delay Alerts",
              ],
            }),
            { headers: corsHeaders }
          );
        }
      }

      // POST /api/cases/ai-summarize-resolution (Generate AI resolution summary)
      if (url.pathname === "/api/cases/ai-summarize-resolution" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const convId = body.conversationId;
        const conv = convId ? await getConversationById(env.DB, convId) : null;

        try {
          const prompt = `You are a Senior Airline Customer Support Operations Manager.
Write a concise, professional 1-to-2 sentence resolution summary for closing this customer case:
- Customer: ${conv?.customer_name || "Alex Mercer"} (Booking: ${conv?.booking_ref || "SKY-8842"})
- Case: ${conv?.title || "Flight Weather Delay Assistance"}
- Flight: ${conv?.flight_number || "AA1822"} (Status: ${conv?.flight_status || "DELAYED"})
- Additional notes: ${body.notes || "Addressed passenger concerns and provided travel solutions."}

Return strictly the 1-2 sentence resolution summary with no quotes or preamble.`;

          const aiRes: any = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
            prompt,
            max_tokens: 150,
          });

          const summary =
            aiRes && aiRes.response
              ? aiRes.response.trim().replace(/^["']|["']$/g, "")
              : `Customer concern regarding flight ${conv?.flight_number || "AA1822"} was fully addressed. Alternative flight availability confirmed and proactive notification preferences updated.`;

          return new Response(JSON.stringify({ success: true, summary }), { headers: corsHeaders });
        } catch {
          const fallbackSummary = `Customer inquiry regarding flight ${conv?.flight_number || "AA1822"} was fully addressed. Alternative options reviewed and disruption alerts configured.`;
          return new Response(JSON.stringify({ success: true, summary: fallbackSummary }), { headers: corsHeaders });
        }
      }

      // GET /api/booking/:ref
      if (url.pathname.startsWith("/api/booking/")) {
        const ref = url.pathname.replace("/api/booking/", "").toUpperCase();
        const booking = await getBookingDetails(env.DB, ref);
        if (!booking) {
          return new Response(JSON.stringify({ error: "Booking not found" }), {
            status: 404,
            headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify(booking), { headers: corsHeaders });
      }

      // GET /api/flights
      if (url.pathname === "/api/flights") {
        const flights = await env.DB.prepare("SELECT * FROM flights ORDER BY scheduled_departure ASC").all();
        return new Response(JSON.stringify(flights.results || []), { headers: corsHeaders });
      }

      // GET /api/weather/:code
      if (url.pathname.startsWith("/api/weather/")) {
        const code = url.pathname.replace("/api/weather/", "").toUpperCase();
        const [weather, faa] = await Promise.all([
          getAirportWeather(code),
          getFAAAirportStatus(code),
        ]);
        return new Response(JSON.stringify({ weather, faa }), { headers: corsHeaders });
      }

      // GET /api/notifications/:ref
      if (url.pathname.startsWith("/api/notifications/")) {
        const ref = url.pathname.replace("/api/notifications/", "").toUpperCase();
        const logs = await getNotificationLogs(env.DB, ref);
        return new Response(JSON.stringify(logs), { headers: corsHeaders });
      }

      // POST /api/simulate-disruption
      // Enables reviewers to toggle severe weather and flight delays on demand
      if (url.pathname === "/api/simulate-disruption" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const flightNumber = body.flightNumber || "AA1822";
        const status: FlightStatus = body.status || "DELAYED";
        const reason = body.reason || "Severe Convective Weather / FAA Ground Delay Program at DFW";

        await updateFlightStatus(env.DB, flightNumber, status, reason);

        // Also trigger proactive notification to passenger if subscribed
        const subs = await env.DB
          .prepare("SELECT * FROM alert_subscriptions WHERE booking_ref = 'SKY-8842'")
          .all<any>();

        const channelsToNotify = (subs.results && subs.results.length > 0)
          ? subs.results
          : [
              { channel: "sms", recipient: "+15125550199" },
              { channel: "email", recipient: "alex.mercer@example.com" }
            ];

        for (const sub of channelsToNotify) {
          await dispatchAlert(
            env,
            "SKY-8842",
            sub.channel,
            sub.recipient,
            `Flight Alert: ${flightNumber} ${status}`,
            `Adverse Weather Update: Flight ${flightNumber} is now ${status}. Reason: ${reason}. Open support chat to view alternative flight options.`
          );
        }

        // Push into the Durable Object session if active
        try {
          const agentNs = env.SupportAgent as any;
          const agentId = agentNs.idFromName("conv_p101_active");
          const agentStub = agentNs.get(agentId);
          await agentStub.notifyPassenger({
            title: `Flight Alert: ${flightNumber} ${status}`,
            body: `Adverse Weather Update: Flight ${flightNumber} is now ${status}. Reason: ${reason}.`,
            newStatus: status,
          });
        } catch (e) {
          console.warn("[SimulateDisruption] Agent push error:", e);
        }

        return new Response(
          JSON.stringify({
            success: true,
            flightNumber,
            status,
            reason,
            notified: channelsToNotify.length > 0,
          }),
          { headers: corsHeaders }
        );
      }

      return new Response(JSON.stringify({ error: "Endpoint not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    // 3. Fallback to Static Asset serving (Frontend SPA)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
