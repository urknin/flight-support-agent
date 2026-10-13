/**
 * Safe Tool Calling Argument Parser & Sanitizer
 * Solves Hole #1: Llama 3.3 wrapping JSON in markdown fences or returning malformed payloads.
 */
export function safeParseToolArgs<T = Record<string, any>>(raw: any): T {
  if (typeof raw === "object" && raw !== null) {
    return raw as T;
  }

  if (typeof raw !== "string") {
    return {} as T;
  }

  let cleaned = raw.trim();

  // Strip markdown code fences if present (e.g. ```json { ... } ``` or ``` { ... } ```)
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  // Remove potential leading/trailing quotes
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    try {
      cleaned = JSON.parse(cleaned);
    } catch {
      // Keep cleaned as is
    }
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    // Attempt lax JSON cleanup (remove trailing commas)
    try {
      const relaxed = cleaned.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(relaxed) as T;
    } catch {
      console.error(`[ToolParser] Failed to parse tool arguments: "${raw}"`);
      return {} as T;
    }
  }
}

/**
 * Sanitize and validate 6-character booking references (e.g. SKY-8842)
 * Solves Hole #11: Input validation & SQL/Prompt Injection Defense
 */
export function sanitizeBookingRef(input: string): string {
  const match = input.trim().toUpperCase().match(/^[A-Z]{3}-[0-9]{4}$/);
  if (!match) {
    throw new Error(`Invalid booking reference "${input}". Format must be 3 uppercase letters, a hyphen, and 4 digits (e.g. SKY-8842).`);
  }
  return match[0];
}

/**
 * Sanitize flight number (e.g. AA1822, UA450, DL1102)
 */
export function sanitizeFlightNumber(input: string): string {
  const match = input.trim().toUpperCase().match(/^([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])\s?[0-9]{1,4}$/);
  if (!match) {
    throw new Error(`Invalid flight number "${input}". Format must be airline code and number (e.g. AA1822).`);
  }
  return match[0].replace(/\s+/g, "");
}

/**
 * Sanitize 3-letter IATA airport code (e.g. DFW, ORD, AUS)
 */
export function sanitizeAirportCode(input: string): string {
  const match = input.trim().toUpperCase().match(/^[A-Z]{3}$/);
  if (!match) {
    throw new Error(`Invalid airport code "${input}". Must be a 3-letter IATA code (e.g. DFW).`);
  }
  return match[0];
}
