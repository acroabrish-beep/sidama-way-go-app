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

test('approved_by is the approving authority and created_by is the verified admin', () => {
  const tariffRoute = readFileSync(
    new URL('../../src/app/api/admin/tariffs/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(tariffRoute, /approvedBy/);
  assert.match(tariffRoute, /p_approved_by: approvedBy/);
  assert.match(tariffRoute, /p_created_by: authorization\.caller\.uid/);
  assert.doesNotMatch(tariffRoute, /p_approved_by: authorization\.caller\.uid/);

  const importRoute = readFileSync(
    new URL('../../src/app/api/admin/import/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(importRoute, /approved_by: row\.approved_by\.trim\(\)/);
  assert.doesNotMatch(importRoute, /approved_by.*caller\.uid/);

  assert.match(schema, /created_by text NOT NULL/);
  assert.match(operations, /btrim\(tariff_row->>'approved_by'\),\s*p_actor_uid/);
  assert.doesNotMatch(operations, /p_actor_uid,\s*p_actor_uid/);
  assert.match(operations, /Tariff approving authority is required/);
});

test('every st_ table has RLS enabled and no anon/authenticated policy', () => {
  const combined = `${schema}\n${operations}`;
  for (const table of [
    'st_stations',
    'st_routes',
    'st_tariffs',
    'st_queue',
    'st_tickets',
    'st_payments',
    'st_audit',
    'st_rate_limits',
  ]) {
    assert.match(
      combined,
      new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`),
      table,
    );
  }
  assert.doesNotMatch(
    combined,
    /CREATE POLICY[^;]*TO\s+(anon|authenticated)\b/,
  );
});

test('st_ functions are executable only by service_role with a fixed search_path', () => {
  const combined = `${schema}\n${operations}`;
  const signatures = [
    'st_prevent_tariff_history_rewrite()',
    'st_consume_rate_limit(text, integer, integer)',
    'st_create_tariff_version(uuid, text, numeric, date, text, text, text)',
    'st_queue_check_in(uuid, uuid, text, text)',
    'st_queue_check_out(uuid, text)',
    'st_apply_payment_event(uuid, text, text, numeric, text, jsonb)',
    'st_verify_ticket_once(uuid, text, uuid)',
    'st_import_catalog(jsonb, jsonb, jsonb, text)',
    'st_create_pending_ticket(text, text, uuid, uuid, text, numeric, timestamptz, text, text)',
  ];
  for (const signature of signatures) {
    assert.ok(
      combined.includes(
        `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`,
      ),
      `missing revoke for ${signature}`,
    );
    assert.ok(
      combined.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`),
      `missing grant for ${signature}`,
    );
  }
  assert.equal((combined.match(/SET search_path = public/g) ?? []).length, signatures.length);
  assert.doesNotMatch(combined, /SECURITY DEFINER/);
});
