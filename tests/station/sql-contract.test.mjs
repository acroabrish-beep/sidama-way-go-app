import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(
  new URL('../../public/supabase/migrations/2026_10_station_tickets.sql', import.meta.url),
  'utf8',
);
const operations = readFileSync(
  new URL(
    '../../public/supabase/migrations/2026_10_station_tickets_operations.sql',
    import.meta.url,
  ),
  'utf8',
);

// These are static contract checks. They prove the migrations contain the
// required locking, uniqueness, and immutability primitives. Live concurrent
// behaviour still needs to be exercised against a staging database.
test('tickets are unique by code and payments are unique by idempotency key', () => {
  assert.match(schema, /code text NOT NULL UNIQUE/);
  assert.match(schema, /idempotency_key text NOT NULL UNIQUE/);
  assert.match(schema, /st_payments_provider_ref_unique/);
});

test('tariff history is immutable and periods cannot overlap', () => {
  assert.match(schema, /EXCLUDE USING gist/);
  assert.match(schema, /st_prevent_tariff_history_rewrite/);
  assert.match(schema, /Tariff history is immutable/);
});

test('pending payments start without a provider reference', () => {
  assert.match(
    operations,
    /ticket_identifier, p_provider, NULL, selected_fare, 'pending', p_idempotency_key/,
  );
});

test('ticket creation re-reads the server tariff instead of trusting a client amount', () => {
  assert.match(
    operations,
    /SELECT fare_etb INTO selected_fare[\s\S]*IF selected_fare IS NULL OR selected_fare <> p_fare_etb/,
  );
});

test('verification locks the ticket row and marks it used exactly once', () => {
  assert.match(operations, /st_verify_ticket_once/);
  assert.match(operations, /SELECT \* INTO ticket FROM st_tickets WHERE id = p_ticket_id FOR UPDATE/);
  assert.match(operations, /SET status = 'used'/);
});

test('payment processing is idempotent and rejects amount mismatches', () => {
  assert.match(operations, /st_apply_payment_event/);
  assert.match(operations, /payment_already_processed/);
  assert.match(operations, /amount_mismatch/);
  assert.match(operations, /raw_callback/);
});

test('the queue has one active entry per vehicle and a FIFO index', () => {
  assert.match(schema, /st_queue_one_active_vehicle/);
  assert.match(schema, /st_queue_fifo/);
});

test('ticket creation does not accept a fare from the request body', () => {
  const route = readFileSync(
    new URL('../../src/app/api/tickets/route.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(route, /values\.(fare|fareEtb|amount)/);
  assert.match(route, /p_fare_etb: Number\(tariff\.fare_etb\)/);
});
