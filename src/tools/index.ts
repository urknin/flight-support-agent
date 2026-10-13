import { getAirportWeather } from "./weather";
import { getFAAAirportStatus } from "./faa";
import {
  getBookingDetails,
  getFlight,
  getAlternativeFlights,
  rebookFlightAtomic,
  registerAlertSubscription,
} from "../db/client";
import {
  sanitizeAirportCode,
  sanitizeFlightNumber,
  sanitizeBookingRef,
  safeParseToolArgs,
} from "./parser";
import { Env } from "../types";

// ============================================================================
// Tool JSON Schema Definitions (For Workers AI / Llama 3.3)
// ============================================================================

export const AGENT_TOOLS_SCHEMA = [
  {
    name: "getAirportConditions",
    description: "Fetch live weather (wind, thunderstorms, visibility) and FAA Ground Delay / Ground Stop advisories for an airport.",
    parameters: {
      type: "object",
      properties: {
        airportCode: {
          type: "string",
          description: "3-letter IATA airport code, e.g. 'DFW', 'ORD', 'AUS'.",
        },
      },
      required: ["airportCode"],
    },
  },
  {
    name: "lookupFlightStatus",
    description: "Look up real-time flight departure time, status (ON_TIME, DELAYED, CANCELLED), gate delay reason, and seat availability.",
    parameters: {
      type: "object",
      properties: {
        flightNumber: {
          type: "string",
          description: "Flight number, e.g. 'AA1822', 'UA450'.",
        },
      },
      required: ["flightNumber"],
    },
  },
  {
    name: "lookupPassengerBooking",
    description: "Retrieve a passenger's active flight booking, passenger name, seat number, and flight schedule using their 6-character booking reference.",
    parameters: {
      type: "object",
      properties: {
        bookingRef: {
          type: "string",
          description: "Booking reference format 'XXX-0000', e.g. 'SKY-8842'.",
        },
      },
      required: ["bookingRef"],
    },
  },
  {
    name: "findAlternativeFlights",
    description: "Search for alternative flights between origin and destination with confirmed open seats for passenger rebooking.",
    parameters: {
      type: "object",
      properties: {
        originCode: {
          type: "string",
          description: "Origin airport code, e.g. 'DFW'.",
        },
        destCode: {
          type: "string",
          description: "Destination airport code, e.g. 'ORD' or 'MDW'.",
        },
      },
      required: ["originCode", "destCode"],
    },
  },
  {
    name: "rebookPassengerFlight",
    description: "Atomically rebook a passenger from their disrupted flight to a new alternative flight with an available seat.",
    parameters: {
      type: "object",
      properties: {
        bookingRef: {
          type: "string",
          description: "Booking reference, e.g. 'SKY-8842'.",
        },
        newFlightNumber: {
          type: "string",
          description: "The new target flight number with open seats, e.g. 'AA2040'.",
        },
      },
      required: ["bookingRef", "newFlightNumber"],
    },
  },
  {
    name: "subscribeToFlightAlerts",
    description: "Register the passenger for automated background status change notifications via SMS or Email if adverse weather delays escalate.",
    parameters: {
      type: "object",
      properties: {
        bookingRef: {
          type: "string",
          description: "Booking reference, e.g. 'SKY-8842'.",
        },
        channel: {
          type: "string",
          enum: ["sms", "email"],
          description: "Notification channel preference ('sms' or 'email').",
        },
        recipient: {
          type: "string",
          description: "Mobile phone number (+15125550199) or email address (alex@example.com).",
        },
      },
      required: ["bookingRef", "channel", "recipient"],
    },
  },
];

// ============================================================================
// Tool Execution Dispatcher
// ============================================================================

export async function executeTool(
  toolName: string,
  rawArgs: any,
  env: Env
): Promise<{ success: boolean; data?: any; error?: string }> {
  const args = safeParseToolArgs<any>(rawArgs);

  try {
    switch (toolName) {
      case "getAirportConditions": {
        const airportCode = sanitizeAirportCode(args.airportCode);
        const [weather, faa] = await Promise.all([
          getAirportWeather(airportCode),
          getFAAAirportStatus(airportCode),
        ]);
        return {
          success: true,
          data: {
            airport: airportCode,
            weather: {
              temperatureC: weather.temperatureC,
              windSpeedKmh: weather.windSpeedKmh,
              windGustsKmh: weather.windGustsKmh,
              condition: weather.weatherDescription,
              severity: weather.severity,
              isAviationHazard: weather.isAviationHazard,
            },
            faaAirTrafficControl: {
              groundStop: faa.hasGroundStop,
              groundStopReason: faa.groundStopReason,
              groundDelayProgram: faa.hasGroundDelayProgram,
              gdpReason: faa.gdpReason,
              averageDelayMinutes: faa.avgDelayMinutes,
              dataFeedSource: faa.source,
            },
          },
        };
      }

      case "lookupFlightStatus": {
        const flightNumber = sanitizeFlightNumber(args.flightNumber);
        const flight = await getFlight(env.DB, flightNumber);
        if (!flight) {
          return { success: false, error: `Flight ${flightNumber} not found in schedule.` };
        }
        return { success: true, data: flight };
      }

      case "lookupPassengerBooking": {
        const bookingRef = sanitizeBookingRef(args.bookingRef);
        const booking = await getBookingDetails(env.DB, bookingRef);
        if (!booking) {
          return { success: false, error: `Booking ${bookingRef} not found.` };
        }
        return { success: true, data: booking };
      }

      case "findAlternativeFlights": {
        const originCode = sanitizeAirportCode(args.originCode);
        const destCode = sanitizeAirportCode(args.destCode);
        const alternatives = await getAlternativeFlights(env.DB, originCode, destCode);
        return {
          success: true,
          data: {
            origin: originCode,
            destination: destCode,
            count: alternatives.length,
            flights: alternatives,
          },
        };
      }

      case "rebookPassengerFlight": {
        const bookingRef = sanitizeBookingRef(args.bookingRef);
        const newFlightNumber = sanitizeFlightNumber(args.newFlightNumber);
        const result = await rebookFlightAtomic(env.DB, bookingRef, newFlightNumber);
        if (!result.success) {
          return { success: false, error: result.error };
        }
        return {
          success: true,
          data: {
            message: `Successfully rebooked booking ${bookingRef} to flight ${newFlightNumber}.`,
            booking: result.updatedBooking,
          },
        };
      }

      case "subscribeToFlightAlerts": {
        const bookingRef = sanitizeBookingRef(args.bookingRef);
        const channel = args.channel === "sms" ? "sms" : "email";
        const recipient = String(args.recipient).trim();

        const booking = await getBookingDetails(env.DB, bookingRef);
        if (!booking) {
          return { success: false, error: `Booking ${bookingRef} not found.` };
        }

        const sub = await registerAlertSubscription(
          env.DB,
          bookingRef,
          channel,
          recipient,
          booking.flight_status
        );

        // Deduplicated Workflow creation
        try {
          if (env.FLIGHT_WATCHER) {
            await env.FLIGHT_WATCHER.create({
              id: `watch-${bookingRef}-${booking.flight_number}`,
              params: {
                bookingRef,
                flightNumber: booking.flight_number,
                originCode: booking.origin_code,
              },
            });
          }
        } catch (wfErr: any) {
          console.warn(`[Workflow] Trigger notice: ${wfErr?.message}`);
        }

        return {
          success: true,
          data: {
            message: `Subscribed ${recipient} to proactive ${channel.toUpperCase()} alerts for flight ${booking.flight_number}.`,
            subscription: sub,
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool "${toolName}".` };
    }
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Tool execution failed." };
  }
}
