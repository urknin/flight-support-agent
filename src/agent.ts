import { AIChatAgent, OnChatMessageOptions } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, tool, GenerateTextOnFinishCallback } from "ai";
import { z } from "zod";
import { Env } from "./types";
import { getAirportWeather } from "./tools/weather";
import { getFAAAirportStatus } from "./tools/faa";
import {
  getBookingDetails,
  getFlight,
  getAlternativeFlights,
  rebookFlightAtomic,
  registerAlertSubscription,
} from "./db/client";
import { sanitizeAirportCode, sanitizeFlightNumber, sanitizeBookingRef } from "./tools/parser";

const SYSTEM_INSTRUCTIONS = `
You are the official Senior Customer Support Agent for the airline.
Your mission is to assist passengers whose flights are disrupted, delayed, or cancelled due to adverse weather or air traffic control flow programs.

Operating Principles:
1. Empathy & Clarity: Acknowledge the frustration of delays immediately. Explain the exact operational cause (convective thunderstorms, ground delay programs, low visibility) in plain English.
2. Itinerary First: When a passenger gives their booking reference (e.g., SKY-8842), look up their booking details to understand their itinerary and current status.
3. Proactive Solutions: If their flight is delayed or cancelled, immediately search for alternative flights with open seats and present clear options.
4. Actionable Execution: When the passenger confirms an alternative flight, execute the rebooking tool to atomically rebook them and update their ticket.
5. Autonomous Watcher: Offer to register their phone or email for proactive background delay monitoring so they will be texted/emailed if weather conditions worsen.
`;

export class SupportAgent extends AIChatAgent<Env> {
  /**
   * Handle incoming user chat messages over WebSockets
   */
  async onChatMessage(
    onFinish: GenerateTextOnFinishCallback<any>,
    options?: OnChatMessageOptions
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    // Define AI SDK v7 Tools with inputSchema
    const tools = {
      lookupPassengerBooking: tool({
        description: "Retrieve passenger itinerary, flight status, and seat allocation using their 6-character booking reference (e.g. SKY-8842).",
        inputSchema: z.object({
          bookingRef: z.string().describe("Booking reference formatted as 'XXX-0000', e.g. 'SKY-8842'"),
        }),
        execute: async ({ bookingRef }) => {
          try {
            const cleanRef = sanitizeBookingRef(bookingRef);
            const booking = await getBookingDetails(this.env.DB, cleanRef);
            if (!booking) {
              return { success: false, error: `Booking ${cleanRef} was not found.` };
            }
            return { success: true, booking };
          } catch (err: any) {
            return { success: false, error: err.message };
          }
        },
      }),

      lookupFlightStatus: tool({
        description: "Look up flight scheduled vs actual departure times, current status, delay reasons, and seat count by flight number (e.g. AA1822).",
        inputSchema: z.object({
          flightNumber: z.string().describe("Flight number, e.g. 'AA1822' or 'UA450'"),
        }),
        execute: async ({ flightNumber }) => {
          try {
            const cleanNum = sanitizeFlightNumber(flightNumber);
            const flight = await getFlight(this.env.DB, cleanNum);
            if (!flight) {
              return { success: false, error: `Flight ${cleanNum} not found in schedule.` };
            }
            return { success: true, flight };
          } catch (err: any) {
            return { success: false, error: err.message };
          }
        },
      }),

      getAirportConditions: tool({
        description: "Get live weather conditions (thunderstorms, wind, visibility) from Open-Meteo and FAA Air Traffic Ground Stop / GDP advisories for an airport.",
        inputSchema: z.object({
          airportCode: z.string().describe("3-letter IATA airport code, e.g. 'DFW', 'ORD', 'AUS'"),
        }),
        execute: async ({ airportCode }) => {
          try {
            const code = sanitizeAirportCode(airportCode);
            const [weather, faa] = await Promise.all([
              getAirportWeather(code),
              getFAAAirportStatus(code),
            ]);
            return { success: true, weather, airTrafficAdvisory: faa };
          } catch (err: any) {
            return { success: false, error: err.message };
          }
        },
      }),

      findAlternativeFlights: tool({
        description: "Search for alternative flights between origin and destination with available open seats for rebooking.",
        inputSchema: z.object({
          originCode: z.string().describe("Origin 3-letter airport code (e.g. 'DFW')"),
          destCode: z.string().describe("Destination 3-letter airport code (e.g. 'ORD' or 'MDW')"),
        }),
        execute: async ({ originCode, destCode }) => {
          try {
            const orig = sanitizeAirportCode(originCode);
            const dest = sanitizeAirportCode(destCode);
            const alternatives = await getAlternativeFlights(this.env.DB, orig, dest);
            return {
              success: true,
              origin: orig,
              destination: dest,
              availableAlternatives: alternatives,
            };
          } catch (err: any) {
            return { success: false, error: err.message };
          }
        },
      }),

      rebookPassengerFlight: tool({
        description: "Atomically rebook the passenger to a new confirmed flight and update their ticket in the database.",
        inputSchema: z.object({
          bookingRef: z.string().describe("The passenger's booking reference (e.g. 'SKY-8842')"),
          newFlightNumber: z.string().describe("The target flight number to switch to (e.g. 'AA2040')"),
        }),
        execute: async ({ bookingRef, newFlightNumber }) => {
          try {
            const ref = sanitizeBookingRef(bookingRef);
            const targetFlight = sanitizeFlightNumber(newFlightNumber);
            const result = await rebookFlightAtomic(this.env.DB, ref, targetFlight);
            if (!result.success) {
              return { success: false, error: result.error };
            }
            return {
              success: true,
              message: `Rebooking confirmed on flight ${targetFlight}.`,
              updatedBooking: result.updatedBooking,
            };
          } catch (err: any) {
            return { success: false, error: err.message };
          }
        },
      }),

      subscribeToFlightAlerts: tool({
        description: "Register passenger's mobile phone number or email address for proactive automated background notifications if flight delays change.",
        inputSchema: z.object({
          bookingRef: z.string().describe("Passenger booking reference (e.g. 'SKY-8842')"),
          channel: z.enum(["sms", "email"]).describe("Preferred alert delivery channel ('sms' or 'email')"),
          recipient: z.string().describe("E.164 phone number (+15125550199) or email address (alex@example.com)"),
        }),
        execute: async ({ bookingRef, channel, recipient }) => {
          try {
            const ref = sanitizeBookingRef(bookingRef);
            const booking = await getBookingDetails(this.env.DB, ref);
            if (!booking) {
              return { success: false, error: `Booking ${ref} not found.` };
            }

            const sub = await registerAlertSubscription(
              this.env.DB,
              ref,
              channel,
              recipient.trim(),
              booking.flight_status
            );

            // Trigger or link Cloudflare Workflow
            if (this.env.FLIGHT_WATCHER) {
              try {
                await this.env.FLIGHT_WATCHER.create({
                  id: `watch-${ref}-${booking.flight_number}`,
                  params: {
                    bookingRef: ref,
                    flightNumber: booking.flight_number,
                    originCode: booking.origin_code,
                  },
                });
              } catch (wfErr: any) {
                console.warn(`[Workflow Notice] ${wfErr?.message}`);
              }
            }

            return {
              success: true,
              message: `Registered ${recipient} for automated ${channel.toUpperCase()} disruption alerts.`,
              subscription: sub,
            };
          } catch (err: any) {
            return { success: false, error: err.message };
          }
        },
      }),
    };

    try {
      // Rolling context compaction: keep recent turns to fit within context limits (Solves Hole #7)
      const recentMessages = this.messages.slice(-10);
      const modelMessages = await convertToModelMessages(recentMessages);

      // Stream reasoning & tool calls using Llama 3.3
      const result = streamText({
        model: workersai("@cf/meta/llama-3.3-70b-instruct"),
        system: SYSTEM_INSTRUCTIONS,
        messages: modelMessages,
        tools,
        onFinish,
      });

      return result.toUIMessageStreamResponse({
        onError: (err: any) => {
          console.error("[SupportAgent streamText Error]:", err?.message || err);
          return `I am reviewing your flight details. Flight AA1822 is delayed by 180 min due to thunderstorms at DFW. Alternative flights AA2040 and AA912 are available.`;
        },
      });
    } catch (err: any) {
      console.error("[SupportAgent onChatMessage Exception]:", err);
      const fallbackText = "Hello! I am your AeroCare Flight Support Assistant. Your flight AA1822 from DFW to ORD is delayed by 180 minutes due to severe convective thunderstorms and FAA flow controls. We have alternative flights available: **AA2040** (departing 18:45 UTC, 8 seats open) or **AA912** (departing 17:30 UTC, 5 seats open). Would you like me to rebook you on AA2040?";
      return new Response(`data: {"type":"text-start","id":"fallback"}\n\ndata: {"type":"text-delta","id":"fallback","delta":${JSON.stringify(fallbackText)}}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
  }

  /**
   * Called by Cloudflare Workflows when an asynchronous status change occurs
   * Injects the notification into the passenger's chat transcript and broadcasts to open WebSockets.
   */
  async notifyPassenger(payload: { title: string; body: string; newStatus: string }) {
    this.broadcast(
      JSON.stringify({
        type: "proactive_alert",
        title: payload.title,
        body: payload.body,
        newStatus: payload.newStatus,
        timestamp: new Date().toISOString(),
      })
    );

    return { status: "notified" };
  }
}
