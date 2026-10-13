// ============================================================================
// Core Data Models & TypeScript Definitions
// ============================================================================

export interface Airport {
  code: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  timezone: string;
}

export type FlightStatus = "ON_TIME" | "DELAYED" | "CANCELLED";

export interface Flight {
  flight_number: string;
  airline: string;
  origin_code: string;
  dest_code: string;
  scheduled_departure: string; // ISO-8601 UTC
  actual_departure: string;    // ISO-8601 UTC
  status: FlightStatus;
  delay_reason?: string | null;
  available_seats: number;
}

export interface Passenger {
  passenger_id: string;
  name: string;
  email: string;
  phone: string;
}

export type BookingStatus = "CONFIRMED" | "REBOOKED" | "CANCELLED";

export interface Booking {
  booking_ref: string;
  passenger_id: string;
  flight_number: string;
  seat: string;
  status: BookingStatus;
  updated_at: string;
}

export interface BookingWithDetails extends Booking {
  passenger_name: string;
  passenger_email: string;
  passenger_phone: string;
  airline: string;
  origin_code: string;
  dest_code: string;
  origin_city: string;
  dest_city: string;
  scheduled_departure: string;
  actual_departure: string;
  flight_status: FlightStatus;
  delay_reason?: string | null;
  available_seats: number;
}

export type NotificationChannel = "sms" | "email";

export interface AlertSubscription {
  id: string;
  booking_ref: string;
  channel: NotificationChannel;
  recipient: string;
  last_notified_status: string;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  booking_ref: string;
  channel: NotificationChannel;
  recipient: string;
  title: string;
  body: string;
  sent_at: string;
  delivery_status: "DELIVERED" | "MOCK_LOGGED" | "FALLBACK_DRAWER";
}

// ============================================================================
// Case & Conversation Lifecycle Models
// ============================================================================

export type ConversationStatus = "ACTIVE" | "RESOLVED";

export type IssueCategory =
  | "WEATHER_DELAY"
  | "REBOOKING"
  | "CANCELLATION"
  | "BAGGAGE"
  | "GENERAL";

export interface Conversation {
  conversation_id: string;
  customer_id: string;
  booking_ref?: string | null;
  title: string;
  issue_category: IssueCategory;
  status: ConversationStatus;
  resolution_summary?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface ConversationWithDetails extends Conversation {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  flight_number?: string | null;
  flight_status?: FlightStatus | null;
  airline?: string | null;
  origin_city?: string | null;
  dest_city?: string | null;
}

// ============================================================================
// External API Response Models
// ============================================================================

export interface WeatherCondition {
  airportCode: string;
  cityName: string;
  temperatureC: number;
  relativeHumidity: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  weatherCode: number;
  weatherDescription: string;
  visibilityMeters?: number;
  severity: "NORMAL" | "CAUTION" | "SEVERE";
  isAviationHazard: boolean;
}

export interface FAAAirportDelay {
  airportCode: string;
  hasGroundStop: boolean;
  groundStopReason?: string;
  hasGroundDelayProgram: boolean;
  gdpReason?: string;
  avgDelayMinutes?: number;
  closureStatus?: string;
  source: "LIVE_FAA" | "CACHED_FALLBACK";
}

// ============================================================================
// Workflow & Notification Types
// ============================================================================

export interface WatcherPayload {
  bookingRef: string;
  flightNumber: string;
  originCode: string;
}

export interface DispatchNotificationResult {
  success: boolean;
  channel: NotificationChannel;
  recipient: string;
  mode: "LIVE" | "MOCK" | "FALLBACK";
  error?: string;
}

// ============================================================================
// Cloudflare Environment Bindings
// ============================================================================

export interface Env {
  AI: any;
  DB: D1Database;
  SupportAgent: DurableObjectNamespace<any>;
  FLIGHT_WATCHER: Workflow<WatcherPayload>;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  RESEND_API_KEY?: string;
  ENVIRONMENT?: string;
  ASSETS?: Fetcher;
}
