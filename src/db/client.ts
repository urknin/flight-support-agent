import {
  BookingWithDetails,
  Flight,
  AlertSubscription,
  NotificationLog,
  FlightStatus,
  Conversation,
  ConversationWithDetails,
  ConversationStatus,
  IssueCategory,
} from "../types";

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

/**
 * Common SELECT query projecting conversation and full passenger / flight details
 */
const CONVERSATION_DETAILS_SQL = `
  SELECT 
    c.conversation_id,
    c.customer_id,
    c.booking_ref,
    c.title,
    c.issue_category,
    c.status,
    c.resolution_summary,
    c.created_at,
    c.resolved_at,
    p.name AS customer_name,
    p.email AS customer_email,
    p.phone AS customer_phone,
    b.flight_number,
    f.airline,
    orig.city AS origin_city,
    dest.city AS dest_city,
    f.status AS flight_status
  FROM conversations c
  JOIN passengers p ON c.customer_id = p.passenger_id
  LEFT JOIN bookings b ON c.booking_ref = b.booking_ref
  LEFT JOIN flights f ON b.flight_number = f.flight_number
  LEFT JOIN airports orig ON f.origin_code = orig.code
  LEFT JOIN airports dest ON f.dest_code = dest.code
`;

/**
 * Fetch a conversation by unique conversationId with joined customer & flight details
 */
export async function getConversationById(
  db: D1Database,
  conversationId: string
): Promise<ConversationWithDetails | null> {
  return withDbRetry(async () => {
    const query = `${CONVERSATION_DETAILS_SQL} WHERE c.conversation_id = ? LIMIT 1;`;
    return (await db.prepare(query).bind(conversationId).first()) as ConversationWithDetails | null;
  });
}

/**
 * Look up any currently ACTIVE conversation for a specific customer.
 * Enforces the business rule: a customer can only have 1 active conversation at a time.
 */
export async function getActiveConversationByCustomer(
  db: D1Database,
  customerId: string
): Promise<ConversationWithDetails | null> {
  return withDbRetry(async () => {
    const query = `${CONVERSATION_DETAILS_SQL} WHERE c.customer_id = ? AND c.status = 'ACTIVE' LIMIT 1;`;
    return (await db.prepare(query).bind(customerId).first()) as ConversationWithDetails | null;
  });
}

/**
 * Search past and active conversations by Customer Name, Customer ID, Conversation ID, or Booking Ref.
 * Also supports filtering by status (ACTIVE / RESOLVED / ALL).
 */
export async function searchConversations(
  db: D1Database,
  options: {
    query?: string;
    status?: ConversationStatus | "ALL";
    customerId?: string;
    limit?: number;
  } = {}
): Promise<ConversationWithDetails[]> {
  return withDbRetry(async () => {
    const limit = options.limit || 30;
    const whereClauses: string[] = [];
    const binds: any[] = [];

    if (options.customerId) {
      whereClauses.push("c.customer_id = ?");
      binds.push(options.customerId);
    }

    if (options.status && options.status !== "ALL") {
      whereClauses.push("c.status = ?");
      binds.push(options.status);
    }

    if (options.query && options.query.trim()) {
      const q = `%${options.query.trim().toLowerCase()}%`;
      whereClauses.push(
        "(LOWER(p.name) LIKE ? OR LOWER(p.passenger_id) LIKE ? OR LOWER(c.conversation_id) LIKE ? OR LOWER(c.booking_ref) LIKE ? OR LOWER(c.title) LIKE ?)"
      );
      binds.push(q, q, q, q, q);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const sql = `
      ${CONVERSATION_DETAILS_SQL}
      ${whereStr}
      ORDER BY c.created_at DESC
      LIMIT ?;
    `;
    binds.push(limit);

    const res = await db.prepare(sql).bind(...binds).all();
    return (res.results || []) as unknown as ConversationWithDetails[];
  });
}

/**
 * Open a new case conversation for a customer.
 * Strictly verifies the 1-active-conversation constraint before inserting.
 */
export async function createConversation(
  db: D1Database,
  data: {
    conversationId: string;
    customerId: string;
    bookingRef?: string | null;
    title: string;
    issueCategory: IssueCategory;
  }
): Promise<{ success: boolean; conversation?: ConversationWithDetails; error?: string }> {
  return withDbRetry(async () => {
    // 1. Enforce: a customer can only have 1 active conversation at a time
    const existingActive = await getActiveConversationByCustomer(db, data.customerId);
    if (existingActive) {
      return {
        success: false,
        error: `Customer ${existingActive.customer_name} (${data.customerId}) already has an active conversation: "${existingActive.title}" (${existingActive.conversation_id}). A customer can only have 1 active conversation at a time. Please resolve the existing conversation before opening a new case.`,
        conversation: existingActive,
      };
    }

    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO conversations (conversation_id, customer_id, booking_ref, title, issue_category, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`
      )
      .bind(
        data.conversationId,
        data.customerId,
        data.bookingRef ?? null,
        data.title,
        data.issueCategory,
        now
      )
      .run();

    const created = await getConversationById(db, data.conversationId);
    return { success: true, conversation: created ?? undefined };
  });
}

/**
 * Resolve and end an active conversation, signifying customer concern was successfully addressed.
 */
export async function resolveConversation(
  db: D1Database,
  conversationId: string,
  resolutionSummary?: string | null
): Promise<{ success: boolean; updated?: ConversationWithDetails; error?: string }> {
  return withDbRetry(async () => {
    const existing = await getConversationById(db, conversationId);
    if (!existing) {
      return { success: false, error: `Conversation ${conversationId} does not exist.` };
    }

    const now = new Date().toISOString();
    const finalSummary =
      resolutionSummary && resolutionSummary.trim()
        ? resolutionSummary.trim()
        : "Customer inquiry and flight assistance successfully resolved by agent.";

    await db
      .prepare(
        `UPDATE conversations 
         SET status = 'RESOLVED', resolved_at = ?, resolution_summary = ? 
         WHERE conversation_id = ?`
      )
      .bind(now, finalSummary, conversationId)
      .run();

    const updated = await getConversationById(db, conversationId);
    return { success: true, updated: updated ?? undefined };
  });
}

/**
 * Fetch all passenger profiles with their active bookings and active conversation state
 */
export async function getAllPassengers(
  db: D1Database
): Promise<
  Array<{
    passenger_id: string;
    name: string;
    email: string;
    phone: string;
    booking_ref: string | null;
    flight_number: string | null;
    active_conversation_id: string | null;
  }>
> {
  return withDbRetry(async () => {
    const query = `
      SELECT 
        p.passenger_id, 
        p.name, 
        p.email, 
        p.phone, 
        b.booking_ref, 
        b.flight_number,
        (SELECT conversation_id FROM conversations WHERE customer_id = p.passenger_id AND status = 'ACTIVE' LIMIT 1) AS active_conversation_id
      FROM passengers p
      LEFT JOIN bookings b ON p.passenger_id = b.passenger_id
      ORDER BY p.name ASC;
    `;
    const res = await db.prepare(query).all();
    return (res.results || []) as any[];
  });
}
