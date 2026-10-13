import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeParseToolArgs, sanitizeBookingRef, sanitizeFlightNumber, sanitizeAirportCode } from '../src/tools/parser.js';
import { translateWmoCode } from '../src/tools/weather.js';
import { dispatchAlert } from '../src/notifications/dispatcher.js';

describe('Parser & Input Validation Tools', () => {
  it('validates booking reference format (e.g. SKY-8842)', () => {
    assert.equal(sanitizeBookingRef('SKY-8842'), 'SKY-8842');
    assert.equal(sanitizeBookingRef('sky-8842'), 'SKY-8842'); // upper-cased
    assert.throws(() => sanitizeBookingRef('BK10012'));
    assert.throws(() => sanitizeBookingRef('SKY 8842'));
    assert.throws(() => sanitizeBookingRef('INVALID'));
  });

  it('validates flight number format', () => {
    assert.equal(sanitizeFlightNumber('AA1822'), 'AA1822');
    assert.equal(sanitizeFlightNumber('UA 2040'), 'UA2040');
    assert.equal(sanitizeFlightNumber('DL912'), 'DL912');
    assert.throws(() => sanitizeFlightNumber('1822'));
    assert.throws(() => sanitizeFlightNumber('A'));
  });

  it('validates airport code format', () => {
    assert.equal(sanitizeAirportCode('DFW'), 'DFW');
    assert.equal(sanitizeAirportCode('ord'), 'ORD');
    assert.throws(() => sanitizeAirportCode('DALLAS'));
    assert.throws(() => sanitizeAirportCode('DF'));
  });

  it('safely parses clean JSON strings', () => {
    const raw = '{"bookingRef": "BK1001"}';
    const parsed = safeParseToolArgs<{ bookingRef: string }>(raw);
    assert.equal(parsed.bookingRef, 'BK1001');
  });

  it('strips markdown code blocks and trims trailing noise before parsing', () => {
    const raw = '```json\n{"flightNumber": "AA1822", "airport": "DFW"}\n```';
    const parsed = safeParseToolArgs<{ flightNumber: string; airport: string }>(raw);
    assert.equal(parsed.flightNumber, 'AA1822');
    assert.equal(parsed.airport, 'DFW');
  });

  it('handles objects passed directly', () => {
    const input = { bookingRef: 'BK1002' };
    const parsed = safeParseToolArgs(input);
    assert.deepEqual(parsed, input);
  });
});

describe('Weather Translation Tools', () => {
  it('translates severe thunderstorm WMO code correctly', () => {
    const res = translateWmoCode(95);
    assert.match(res.description.toLowerCase(), /thunderstorm/);
    assert.equal(res.severity, 'SEVERE');
    assert.equal(res.isHazard, true);
  });

  it('translates blizzard/heavy snow code correctly', () => {
    const res = translateWmoCode(75);
    assert.match(res.description.toLowerCase(), /snow/);
    assert.equal(res.severity, 'SEVERE');
    assert.equal(res.isHazard, true);
  });

  it('returns normal for clear skies WMO code', () => {
    const res = translateWmoCode(1);
    assert.equal(res.severity, 'NORMAL');
    assert.equal(res.isHazard, false);
  });
});

describe('Notification Dispatcher (Dual-Mode / Mock Fallback)', () => {
  it('falls back to mock drawer storage when Twilio / Resend are not configured', async () => {
    const mockEnv: any = {
      DB: {
        prepare: () => ({
          bind: () => ({
            run: async () => ({ success: true })
          })
        })
      }
    };

    const smsRes = await dispatchAlert(
      mockEnv,
      'BK1001',
      'sms',
      '+15551234567',
      'Flight Disruption Notice',
      'Your flight AA1822 is delayed.'
    );

    assert.equal(smsRes.success, true);
    assert.equal(smsRes.mode, 'MOCK');
    assert.equal(smsRes.channel, 'sms');

    const emailRes = await dispatchAlert(
      mockEnv,
      'BK1001',
      'email',
      'passenger@example.com',
      'Flight Disruption Notice',
      'Your flight AA1822 is delayed.'
    );

    assert.equal(emailRes.success, true);
    assert.equal(emailRes.mode, 'MOCK');
    assert.equal(emailRes.channel, 'email');
  });
});
