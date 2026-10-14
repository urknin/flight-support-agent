-- ============================================================================
-- Flight Disruption & Rebooking AI Support Agent — Database Schema
-- Cloudflare D1 (SQLite at the Edge)
-- ============================================================================

-- Airports Reference Data
CREATE TABLE IF NOT EXISTS airports (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  timezone TEXT NOT NULL
);

-- Flights Schedule & Live Operations
CREATE TABLE IF NOT EXISTS flights (
  flight_number TEXT PRIMARY KEY,
  airline TEXT NOT NULL,
  origin_code TEXT NOT NULL REFERENCES airports(code),
  dest_code TEXT NOT NULL REFERENCES airports(code),
  scheduled_departure TEXT NOT NULL, -- ISO-8601 UTC
  actual_departure TEXT NOT NULL,    -- ISO-8601 UTC
  status TEXT NOT NULL CHECK (status IN ('ON_TIME', 'DELAYED', 'CANCELLED')),
  delay_reason TEXT,
  available_seats INTEGER NOT NULL CHECK (available_seats >= 0)
);

-- Passenger Profiles
CREATE TABLE IF NOT EXISTS passengers (
  passenger_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL
);

-- Active Passenger Bookings
CREATE TABLE IF NOT EXISTS bookings (
  booking_ref TEXT PRIMARY KEY CHECK (booking_ref GLOB '[A-Z][A-Z][A-Z]-[0-9][0-9][0-9][0-9]'),
  passenger_id TEXT NOT NULL REFERENCES passengers(passenger_id),
  flight_number TEXT NOT NULL REFERENCES flights(flight_number),
  seat TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'REBOOKED', 'CANCELLED')),
  updated_at TEXT NOT NULL           -- ISO-8601 UTC
);

-- Background Watcher Subscriptions
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id TEXT PRIMARY KEY,
  booking_ref TEXT NOT NULL REFERENCES bookings(booking_ref),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  recipient TEXT NOT NULL,
  last_notified_status TEXT NOT NULL,
  created_at TEXT NOT NULL           -- ISO-8601 UTC
);

-- Notification Audit & Mock Delivery Logs
CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  booking_ref TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,             -- ISO-8601 UTC
  delivery_status TEXT NOT NULL      -- 'DELIVERED', 'MOCK_LOGGED', 'FALLBACK_DRAWER'
);

-- Create Indexes for performance
-- Case Conversations History & Unique Active State Tracking
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES passengers(passenger_id),
  booking_ref TEXT REFERENCES bookings(booking_ref),
  title TEXT NOT NULL,
  issue_category TEXT NOT NULL CHECK (issue_category IN ('WEATHER_DELAY', 'REBOOKING', 'CANCELLATION', 'BAGGAGE', 'GENERAL')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RESOLVED')),
  resolution_summary TEXT,
  created_at TEXT NOT NULL,           -- ISO-8601 UTC
  resolved_at TEXT                    -- ISO-8601 UTC
);

-- Indexes for lightning fast customer search & status lookups
CREATE INDEX IF NOT EXISTS idx_flights_route ON flights(origin_code, dest_code, status);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger ON bookings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_alert_subs_booking ON alert_subscriptions(booking_ref);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_booking ON conversations(booking_ref);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);

-- Database-enforced rule: A customer can only have 1 active conversation at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_customer_conv ON conversations(customer_id) WHERE status = 'ACTIVE';


