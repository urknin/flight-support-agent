import { routeAgentRequest } from "agents";
import { Env, FlightStatus } from "./types";
import { SupportAgent } from "./agent";
import { FlightWatcherWorkflow } from "./workflow";
import { getBookingDetails, getNotificationLogs, updateFlightStatus } from "./db/client";
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
          const agentId = agentNs.idFromName("SKY-8842");
          const agentStub = agentNs.get(agentId);
          await agentStub.notifyPassenger({
            title: `Flight Alert: ${flightNumber} ${status}`,
            body: `Adverse Weather Update: Flight ${flightNumber} is now ${status}. Reason: ${reason}.`,
            newStatus: status,
          });
        } catch (e) {
          console.warn("[SimulateDisruption] Agent push error (expected if not yet connected):", e);
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
