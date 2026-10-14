-- ============================================================================
-- Flight Disruption & Rebooking AI Support Agent — Initial Seed Data
-- One-time scenario initialization (DFW & ORD Severe Thunderstorms)
-- NOT run in CI/CD pipeline
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
  ('P-102', 'Elena Rostova', 'elena.rostova@example.com', '+14155550244'),
  ('P-103', 'Marcus Vance', 'marcus.vance@example.com', '+13125550388'),
  ('P-104', 'Sarah Chen', 'sarah.chen@example.com', '+12125550477');

INSERT OR REPLACE INTO bookings (booking_ref, passenger_id, flight_number, seat, status, updated_at) VALUES
  ('SKY-8842', 'P-101', 'AA1822', '14B', 'CONFIRMED', '2026-10-13T12:00:00Z'),
  ('SKY-1904', 'P-102', 'UA450',  '03A', 'CONFIRMED', '2026-10-13T10:00:00Z'),
  ('SKY-3301', 'P-103', 'AA3301', '18C', 'CONFIRMED', '2026-10-13T11:00:00Z'),
  ('SKY-1102', 'P-104', 'DL1102', '08D', 'CONFIRMED', '2026-10-13T09:30:00Z');

INSERT OR REPLACE INTO alert_subscriptions (id, booking_ref, channel, recipient, last_notified_status, created_at) VALUES
  ('SUB-001', 'SKY-8842', 'sms', '+15125550199', 'INITIAL', '2026-10-13T12:00:00Z'),
  ('SUB-002', 'SKY-8842', 'email', 'alex.mercer@example.com', 'INITIAL', '2026-10-13T12:00:00Z');

-- Initial Active & Historical Resolved Case Conversations
INSERT OR REPLACE INTO conversations (conversation_id, customer_id, booking_ref, title, issue_category, status, resolution_summary, created_at, resolved_at) VALUES
  ('conv_p101_active', 'P-101', 'SKY-8842', 'Flight AA1822 Severe Storm Delay Rebooking', 'WEATHER_DELAY', 'ACTIVE', NULL, '2026-10-13T13:00:00Z', NULL),
  ('conv_p101_past_01', 'P-101', 'SKY-8842', 'Checked Baggage Allowance & Sports Equipment Inquiry', 'BAGGAGE', 'RESOLVED', 'Provided passenger with oversized baggage fee waivers and checked bag size limits for ski equipment.', '2026-09-12T08:30:00Z', '2026-09-12T08:45:00Z'),
  ('conv_p102_past_01', 'P-102', 'SKY-1904', 'Flight UA450 Preferred Seat Selection', 'REBOOKING', 'RESOLVED', 'Passenger confirmed and assigned to window seat 03A on flight UA450 from ORD to SFO.', '2026-10-10T14:15:00Z', '2026-10-10T14:28:00Z'),
  ('conv_p103_past_01', 'P-103', 'SKY-3301', 'Special Inflight Meal Dietary Request', 'GENERAL', 'RESOLVED', 'Recorded gluten-free dietary meal request for passenger on flight AA3301.', '2026-10-11T09:00:00Z', '2026-10-11T09:12:00Z');
