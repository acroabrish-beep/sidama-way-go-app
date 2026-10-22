import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function source(path) {
  return readFileSync(new URL(`../../src/app/api/${path}`, import.meta.url), 'utf8');
}

test('all station read endpoints require a verified caller', () => {
  for (const path of [
    'stations/route.ts',
    'stations/[id]/destinations/route.ts',
    'tariffs/quote/route.ts',
    'queue/route.ts',
    'station/vehicles/route.ts',
    'tickets/route.ts',
    'tickets/[id]/route.ts',
  ]) {
    assert.match(source(path), /requireStationUser\(/, path);
  }
});

test('ticket verification is restricted to station operators', () => {
  assert.match(
    source('tickets/verify/route.ts'),
    /STATION_OPERATOR_ROLES/,
  );
  assert.match(
    source('tickets/verify-code/route.ts'),
    /STATION_OPERATOR_ROLES/,
  );
});

test('admin station, route, tariff, import, and metrics endpoints require an admin role', () => {
  for (const path of [
    'admin/stations/route.ts',
    'admin/stations/[id]/route.ts',
    'admin/routes/route.ts',
    'admin/routes/[id]/route.ts',
    'admin/tariffs/route.ts',
    'admin/import/route.ts',
    'admin/taxi/metrics/route.ts',
  ]) {
    assert.match(source(path), /STATION_ADMIN_ROLES/, path);
  }
});

test('payment webhooks verify a provider signature instead of a Firebase token', () => {
  const webhook = source('payments/webhook/[provider]/route.ts');
  assert.match(webhook, /processPaymentWebhook/);
  assert.doesNotMatch(webhook, /requireStationUser/);
});
