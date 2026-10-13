// ============================================================================
// Database Seed Script & SQL Generator
// Seeds realistic flight disruption data (DFW / ORD Severe Thunderstorms)
// ============================================================================

export const SEED_SQL = `
-- Clean up existing seed data
DELETE FROM notification_logs;
DELETE FROM alert_subscriptions;
DELETE FROM bookings;
DELETE FROM passengers;
DELETE FROM flights;
DELETE FROM airports;

-- 1. Airports Reference Data
INSERT INTO airports (code, name, city, lat, lon, timezone) VALUES
  ('DFW', 'Dallas/Fort Worth International', 'Dallas', 32.8998, -97.0403, 'America/Chicago'),
  ('ORD', 'Chicago O''Hare International', 'Chicago', 41.9742, -87.9073, 'America/Chicago'),
  ('MDW', 'Chicago Midway International', 'Chicago', 41.7868, -87.7522, 'America/Chicago'),
  ('AUS', 'Austin-Bergstrom International', 'Austin', 30.1975, -97.6664, 'America/Chicago'),
  ('JFK', 'John F. Kennedy International', 'New York', 40.6413, -73.7781, 'America/New_York'),
  ('SFO', 'San Francisco International', 'San Francisco', 37.6213, -122.3790, 'America/Los_Angeles'),
  ('LAX', 'Los Angeles International', 'Los Angeles', 33.9416, -118.4085, 'America/Los_Angeles');

-- 2. Flights Schedule & Disruption Scenario
-- Scenario: Severe thunderstorm front over Texas & Midwest causing FAA ground delay at DFW/ORD
INSERT INTO flights (flight_number, airline, origin_code, dest_code, scheduled_departure, actual_departure, status, delay_reason, available_seats) VALUES
  ('AA1822', 'American Airlines', 'DFW', 'ORD', '2026-10-14T14:30:00Z', '2026-10-14T17:15:00Z', 'DELAYED', 'Severe convective thunderstorms and FAA Ground Delay Program at DFW', 0),
  ('AA2040', 'American Airlines', 'DFW', 'ORD', '2026-10-14T18:45:00Z', '2026-10-14T18:45:00Z', 'ON_TIME', NULL, 8),
  ('AA912',  'American Airlines', 'DFW', 'MDW', '2026-10-14T17:30:00Z', '2026-10-14T17:30:00Z', 'ON_TIME', NULL, 5),
  ('AA3301', 'American Airlines', 'DFW', 'ORD', '2026-10-15T08:00:00Z', '2026-10-15T08:00:00Z', 'ON_TIME', NULL, 24),
  ('UA450',  'United Airlines',   'ORD', 'SFO', '2026-10-14T16:00:00Z', '2026-10-14T16:00:00Z', 'ON_TIME', NULL, 12),
  ('DL1102', 'Delta Air Lines',    'AUS', 'JFK', '2026-10-14T15:15:00Z', '2026-10-14T15:15:00Z', 'ON_TIME', NULL, 6);

-- 3. Passenger Profiles
INSERT INTO passengers (passenger_id, name, email, phone) VALUES
  ('P-101', 'Alex Mercer', 'alex.mercer@example.com', '+15125550199'),
  ('P-102', 'Elena Rostova', 'elena.rostova@example.com', '+14155550244');

-- 4. Active Bookings
INSERT INTO bookings (booking_ref, passenger_id, flight_number, seat, status, updated_at) VALUES
  ('SKY-8842', 'P-101', 'AA1822', '14B', 'CONFIRMED', '2026-10-13T12:00:00Z'),
  ('SKY-1904', 'P-102', 'UA450',  '03A', 'CONFIRMED', '2026-10-13T10:00:00Z');
`;
