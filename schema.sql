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
CREATE INDEX IF NOT EXISTS idx_flights_route ON flights(origin_code, dest_code, status);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger ON bookings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_alert_subs_booking ON alert_subscriptions(booking_ref);

-- ============================================================================
-- Realistic Disruption Scenario Seed Data (DFW & ORD Severe Thunderstorms)
-- ============================================================================

INSERT OR REPLACE INTO airports (code, name, city, lat, lon, timezone) VALUES
  ('DFW', 'Dallas/Fort Worth International', 'Dallas', 32.8998, -97.0403, 'America/Chicago'),
  ('ORD', 'Chicago O''Hare International', 'Chicago', 41.9742, -87.9073, 'America/Chicago'),
  ('MDW', 'Chicago Midway International', 'Chicago', 41.7868, -87.7522, 'America/Chicago'),
  ('AUS', 'Austin-Bergstrom International', 'Austin', 30.1975, -97.6664, 'America/Chicago'),
  ('JFK', 'John F. Kennedy International', 'New York', 40.6413, -73.7781, 'America/New_York'),
  ('SFO', 'San Francisco International', 'San Francisco', 37.6213, -122.3790, 'America/Los_Angeles'),
  ('LAX', 'Los Angeles International', 'Los Angeles', 33.9416, -118.4085, 'America/Los_Angeles');

INSERT OR REPLACE INTO flights (flight_number, airline, origin_code, dest_code, scheduled_departure, actual_departure, status, delay_reason, available_seats) VALUES
  ('AA1822', 'American Airlines', 'DFW', 'ORD', '2026-10-14T14:30:00Z', '2026-10-14T17:15:00Z', 'DELAYED', 'Severe convective thunderstorms and FAA Ground Delay Program at DFW', 0),
  ('AA2040', 'American Airlines', 'DFW', 'ORD', '2026-10-14T18:45:00Z', '2026-10-14T18:45:00Z', 'ON_TIME', NULL, 8),
  ('AA912',  'American Airlines', 'DFW', 'MDW', '2026-10-14T17:30:00Z', '2026-10-14T17:30:00Z', 'ON_TIME', NULL, 5),
  ('AA3301', 'American Airlines', 'DFW', 'ORD', '2026-10-15T08:00:00Z', '2026-10-15T08:00:00Z', 'ON_TIME', NULL, 24),
  ('UA450',  'United Airlines',   'ORD', 'SFO', '2026-10-14T16:00:00Z', '2026-10-14T16:00:00Z', 'ON_TIME', NULL, 12),
  ('DL1102', 'Delta Air Lines',    'AUS', 'JFK', '2026-10-14T15:15:00Z', '2026-10-14T15:15:00Z', 'ON_TIME', NULL, 6);

INSERT OR REPLACE INTO passengers (passenger_id, name, email, phone) VALUES
  ('P-101', 'Alex Mercer', 'alex.mercer@example.com', '+15125550199'),
  ('P-102', 'Elena Rostova', 'elena.rostova@example.com', '+14155550244');

INSERT OR REPLACE INTO bookings (booking_ref, passenger_id, flight_number, seat, status, updated_at) VALUES
  ('SKY-8842', 'P-101', 'AA1822', '14B', 'CONFIRMED', '2026-10-13T12:00:00Z'),
  ('SKY-1904', 'P-102', 'UA450',  '03A', 'CONFIRMED', '2026-10-13T10:00:00Z');

INSERT OR REPLACE INTO alert_subscriptions (id, booking_ref, channel, recipient, last_notified_status, created_at) VALUES
  ('SUB-001', 'SKY-8842', 'sms', '+15125550199', 'INITIAL', '2026-10-13T12:00:00Z'),
  ('SUB-002', 'SKY-8842', 'email', 'alex.mercer@example.com', 'INITIAL', '2026-10-13T12:00:00Z');


