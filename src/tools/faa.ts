import { FAAAirportDelay } from "../types";

// Cached fallback advisory for demonstration resilience
const FAA_CACHE: Record<string, FAAAirportDelay> = {
  DFW: {
    airportCode: "DFW",
    hasGroundStop: true,
    groundStopReason: "Severe Convective Weather / Thunderstorm Line",
    hasGroundDelayProgram: true,
    gdpReason: "Thunderstorms / Traffic Management Program",
    avgDelayMinutes: 165,
    source: "CACHED_FALLBACK",
  },
  ORD: {
    airportCode: "ORD",
    hasGroundStop: false,
    hasGroundDelayProgram: true,
    gdpReason: "Volume / Low Ceilings & Convective Flow",
    avgDelayMinutes: 52,
    source: "CACHED_FALLBACK",
  },
};

/**
 * Fetch official FAA National Airspace System (NAS) status information.
 * Tracks Ground Stops, Ground Delay Programs (GDP), and airport delay reasons.
 */
export async function getFAAAirportStatus(airportCode: string): Promise<FAAAirportDelay> {
  const code = airportCode.trim().toUpperCase();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const url = "https://nasstatus.faa.gov/api/airport-status-information";
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CloudflareFlightSupportAgent/1.0",
        "Accept": "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`FAA API returned HTTP ${response.status}`);
    }

    const data: any = await response.json();
    let hasGroundStop = false;
    let groundStopReason: string | undefined;
    let hasGDP = false;
    let gdpReason: string | undefined;
    let avgDelayMinutes: number | undefined;

    // Parse Ground Stops array
    if (Array.isArray(data.groundStop)) {
      const gs = data.groundStop.find(
        (item: any) =>
          item.arpt === code || item.airport === code || item.ident === code
      );
      if (gs) {
        hasGroundStop = true;
        groundStopReason = gs.reason ?? gs.remarks ?? "Traffic Management Ground Stop";
      }
    }

    // Parse Ground Delay Programs (GDP)
    if (Array.isArray(data.groundDelay)) {
      const gd = data.groundDelay.find(
        (item: any) =>
          item.arpt === code || item.airport === code || item.ident === code
      );
      if (gd) {
        hasGDP = true;
        gdpReason = gd.reason ?? "Air Traffic Flow Management Delay";
        avgDelayMinutes = Number(gd.avgDelay) || 45;
      }
    }

    // Parse general airport closures / delays
    if (Array.isArray(data.generalArrivalDelay)) {
      const ad = data.generalArrivalDelay.find(
        (item: any) => item.arpt === code || item.airport === code
      );
      if (ad) {
        avgDelayMinutes = Math.max(avgDelayMinutes ?? 0, Number(ad.avgDelay) || 30);
      }
    }

    const result: FAAAirportDelay = {
      airportCode: code,
      hasGroundStop,
      groundStopReason,
      hasGroundDelayProgram: hasGDP,
      gdpReason,
      avgDelayMinutes,
      source: "LIVE_FAA",
    };

    // If FAA is active, update cache
    if (hasGroundStop || hasGDP) {
      FAA_CACHE[code] = result;
    }

    return result;
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[FAA API] Query failed for ${code} (${err?.message}), falling back to cached advisory.`);

    if (FAA_CACHE[code]) {
      return FAA_CACHE[code];
    }

    return {
      airportCode: code,
      hasGroundStop: false,
      hasGroundDelayProgram: false,
      source: "CACHED_FALLBACK",
    };
  }
}
