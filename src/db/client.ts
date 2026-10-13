import { BookingWithDetails, Flight, AlertSubscription, NotificationLog, FlightStatus } from "../types";

/**
 * Execute a database operation with exponential backoff and randomized jitter
 * to handle SQLite lock contention (SQLITE_BUSY) gracefully in edge environments.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 50
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err: any) {
      attempt++;
      const isSqliteBusy =
        err?.message?.includes("SQLITE_BUSY") ||
        err?.message?.includes("database is locked");
      if (isSqliteBusy && attempt <= maxRetries) {
        const jitter = Math.random() * 50;
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Fetch full booking details including passenger and flight info
 */
export async function getBookingDetails(
  db: D1Database,
  bookingRef: string
): Promise<BookingWithDetails | null> {
  return withDbRetry(async () => {
    const query = `
      SELECT 
        b.booking_ref,
        b.passenger_id,
        b.flight_number,
        b.seat,
        b.status,
        b.updated_at,
        p.name AS passenger_name,
        p.email AS passenger_email,
        p.phone AS passenger_phone,
        f.airline,
        f.origin_code,
        f.dest_code,
        orig.city AS origin_city,
        dest.city AS dest_city,
        f.scheduled_departure,
        f.actual_departure,
        f.status AS flight_status,
        f.delay_reason,
        f.available_seats
      FROM bookings b
      JOIN passengers p ON b.passenger_id = p.passenger_id
      JOIN flights f ON b.flight_number = f.flight_number
      JOIN airports orig ON f.origin_code = orig.code
      JOIN airports dest ON f.dest_code = dest.code
      WHERE b.booking_ref = ?
      LIMIT 1;
    `;
    return (await db.prepare(query).bind(bookingRef).first()) as BookingWithDetails | null;
  });
}

/**
 * Look up flight by flight number
 */
export async function getFlight(
  db: D1Database,
  flightNumber: string
): Promise<Flight | null> {
  return withDbRetry(async () => {
    return (await db
      .prepare("SELECT * FROM flights WHERE flight_number = ? LIMIT 1")
      .bind(flightNumber)
      .first()) as Flight | null;
  });
}

/**
 * Find viable alternative flights between origin and destination with available seats
 */
export async function getAlternativeFlights(
  db: D1Database,
  originCode: string,
  destCode: string
): Promise<Flight[]> {
  return withDbRetry(async () => {
    const query = `
      SELECT * FROM flights
      WHERE origin_code = ? 
        AND dest_code = ?
        AND status != 'CANCELLED'
        AND available_seats > 0
      ORDER BY scheduled_departure ASC
      LIMIT 5;
    `;
    const res = await db.prepare(query).bind(originCode, destCode).all();
    return (res.results || []) as unknown as Flight[];
  });
}

/**
 * Atomic seat rebooking:
 * 1. Checks that target flight has available seats
 * 2. Conditionally decrements target flight seat count
 * 3. Increments previous flight seat count
 * 4. Updates booking record to REBOOKED with new flight and updated timestamp
 */
export async function rebookFlightAtomic(
  db: D1Database,
  bookingRef: string,
  newFlightNumber: string
): Promise<{ success: boolean; error?: string; updatedBooking?: BookingWithDetails }> {
  return withDbRetry(async () => {
    const current = await getBookingDetails(db, bookingRef);
    if (!current) {
      return { success: false, error: `Booking ${bookingRef} not found.` };
    }

    if (current.flight_number === newFlightNumber) {
      return { success: false, error: `Already booked on flight ${newFlightNumber}.` };
    }

    const targetFlight = await getFlight(db, newFlightNumber);
    if (!targetFlight) {
      return { success: false, error: `Target flight ${newFlightNumber} does not exist.` };
    }

    if (targetFlight.available_seats <= 0) {
      return { success: false, error: `Flight ${newFlightNumber} has no available seats.` };
    }

    // Execute atomic conditional seat claim
    const seatClaimResult = await db
      .prepare(
        "UPDATE flights SET available_seats = available_seats - 1 WHERE flight_number = ? AND available_seats > 0"
      )
      .bind(newFlightNumber)
      .run();

    if (!seatClaimResult.meta.changes || seatClaimResult.meta.changes === 0) {
      return { success: false, error: `Seat claim race condition: flight ${newFlightNumber} just sold out.` };
    }

    // Release seat on previous flight
    await db
      .prepare(
        "UPDATE flights SET available_seats = available_seats + 1 WHERE flight_number = ?"
      )
      .bind(current.flight_number)
      .run();

    // Update booking record
    const now = new Date().toISOString();
    await db
      .prepare(
        "UPDATE bookings SET flight_number = ?, status = 'REBOOKED', updated_at = ? WHERE booking_ref = ?"
      )
      .bind(newFlightNumber, now, bookingRef)
      .run();

    const updated = await getBookingDetails(db, bookingRef);
    return { success: true, updatedBooking: updated ?? undefined };
  });
}

/**
 * Register alert subscription for background flight watcher
 */
export async function registerAlertSubscription(
  db: D1Database,
  bookingRef: string,
  channel: "sms" | "email",
  recipient: string,
  currentStatus: string
): Promise<AlertSubscription> {
  return withDbRetry(async () => {
    const id = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO alert_subscriptions (id, booking_ref, channel, recipient, last_notified_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, bookingRef, channel, recipient, currentStatus, now)
      .run();

    return {
      id,
      booking_ref: bookingRef,
      channel,
      recipient,
      last_notified_status: currentStatus,
      created_at: now,
    };
  });
}

/**
 * Record notification log
 */
export async function logNotification(
  db: D1Database,
  log: Omit<NotificationLog, "id" | "sent_at">
): Promise<NotificationLog> {
  return withDbRetry(async () => {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO notification_logs (id, booking_ref, channel, recipient, title, body, sent_at, delivery_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        log.booking_ref,
        log.channel,
        log.recipient,
        log.title,
        log.body,
        now,
        log.delivery_status
      )
      .run();

    return {
      id,
      ...log,
      sent_at: now,
    };
  });
}

/**
 * Retrieve notification history for a booking
 */
export async function getNotificationLogs(
  db: D1Database,
  bookingRef: string
): Promise<NotificationLog[]> {
  return withDbRetry(async () => {
    const res = await db
      .prepare("SELECT * FROM notification_logs WHERE booking_ref = ? ORDER BY sent_at DESC LIMIT 10")
      .bind(bookingRef)
      .all();
    return (res.results || []) as unknown as NotificationLog[];
  });
}

/**
 * Update flight status (used by disruption simulator toolbar)
 */
export async function updateFlightStatus(
  db: D1Database,
  flightNumber: string,
  status: FlightStatus,
  delayReason?: string
): Promise<void> {
  return withDbRetry(async () => {
    await db
      .prepare("UPDATE flights SET status = ?, delay_reason = ? WHERE flight_number = ?")
      .bind(status, delayReason ?? null, flightNumber)
      .run();
  });
}
