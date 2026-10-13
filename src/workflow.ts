import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { Env, WatcherPayload } from "./types";
import { getAirportWeather } from "./tools/weather";
import { getFAAAirportStatus } from "./tools/faa";
import { dispatchAlert } from "./notifications/dispatcher";
import { getFlight, getBookingDetails } from "./db/client";

/**
 * Cloudflare Workflow: FlightWatcherWorkflow
 * Background autonomous flight & weather disruption monitor.
 * Executes resilient multi-step polling with zero-cost sleep cycles.
 */
export class FlightWatcherWorkflow extends WorkflowEntrypoint<Env, WatcherPayload> {
  async run(event: WorkflowEvent<WatcherPayload>, step: WorkflowStep) {
    const { bookingRef, flightNumber, originCode } = event.payload;

    let isTerminal = false;
    let cycles = 0;
    const MAX_CYCLES = 48; // Bounded loop: 48 * 10min = 8 hours max (Solves Hole #2)

    while (!isTerminal && cycles < MAX_CYCLES) {
      cycles++;

      // 1. Zero-cost hibernation sleep (10 minutes)
      await step.sleep(`sleep-cycle-${cycles}`, "10 minutes");

      // 2. Fetch live flight, weather, and air traffic data
      const currentConditions = await step.do(`check-conditions-${cycles}`, async () => {
        const [flight, weather, faa] = await Promise.all([
          getFlight(this.env.DB, flightNumber),
          getAirportWeather(originCode),
          getFAAAirportStatus(originCode),
        ]);
        return { flight, weather, faa };
      });

      if (!currentConditions.flight) {
        break; // Flight was deleted or completed
      }

      const { flight, weather, faa } = currentConditions;

      // 3. Evaluate Status Diff
      const diffResult = await step.do(`evaluate-diff-${cycles}`, async () => {
        const subscription = await this.env.DB
          .prepare("SELECT * FROM alert_subscriptions WHERE booking_ref = ? ORDER BY created_at DESC LIMIT 1")
          .bind(bookingRef)
          .first<{ channel: "sms" | "email"; recipient: string; last_notified_status: string }>();

        if (!subscription) {
          return { shouldNotify: false };
        }

        const statusChanged = subscription.last_notified_status !== flight.status;
        const groundStopTriggered = faa.hasGroundStop && !subscription.last_notified_status.includes("GROUND_STOP");

        return {
          shouldNotify: statusChanged || groundStopTriggered,
          subscription,
          newStatusDescriptor: faa.hasGroundStop ? `DELAYED_GROUND_STOP` : flight.status,
        };
      });

      // 4. Proactive AI Outreach & Multi-Channel Dispatch
      if (diffResult.shouldNotify && diffResult.subscription) {
        await step.do(`dispatch-alert-${cycles}`, async () => {
          const { subscription, newStatusDescriptor } = diffResult;
          const booking = await getBookingDetails(this.env.DB, bookingRef);

          const title = `Flight Alert: ${flightNumber} ${flight.status}`;
          let body = `Your flight ${flightNumber} departing ${originCode} is currently marked as ${flight.status}.`;

          if (faa.hasGroundStop) {
            body += ` The FAA has issued a Ground Stop at ${originCode} due to ${faa.groundStopReason ?? "severe convective weather"}.`;
          } else if (flight.delay_reason) {
            body += ` Delay Reason: ${flight.delay_reason}.`;
          }

          body += ` Weather at ${originCode}: ${weather.weatherDescription}, wind gusts up to ${weather.windGustsKmh} km/h.`;
          body += ` Please open your support chat to view automated rebooking options.`;

          // Dispatch SMS / Email / Mock
          await dispatchAlert(
            this.env,
            bookingRef,
            subscription.channel,
            subscription.recipient,
            title,
            body
          );

          // Update Durable Object Agent Session
          try {
            const agentNs = this.env.SupportAgent as any;
            const agentId = agentNs.idFromName(bookingRef);
            const agentStub = agentNs.get(agentId);
            await agentStub.notifyPassenger({
              title,
              body,
              newStatus: flight.status,
            });
          } catch (agentErr: any) {
            console.warn(`[Workflow DO notify] ${agentErr?.message}`);
          }

          // Update last notified status in D1
          await this.env.DB
            .prepare("UPDATE alert_subscriptions SET last_notified_status = ? WHERE booking_ref = ?")
            .bind(newStatusDescriptor, bookingRef)
            .run();
        });
      }

      // Terminal conditions
      if (flight.status === "CANCELLED" || flight.status === "ON_TIME" && cycles > 24) {
        isTerminal = true;
      }
    }
  }
}
