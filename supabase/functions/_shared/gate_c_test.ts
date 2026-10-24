import {
  effectiveStatus,
  isOfficialTariff,
  selectActiveTariff,
  ticketPayload,
  type TariffRow,
  type TicketRow,
} from './domain.ts';
import { HttpError } from './http.ts';
import {
  generateTicketCode,
  isTicketCode,
  signTicketQr,
  verifyTicketQr,
} from './qr.ts';
import {
  parsePurchaseInput,
  parseTicketId,
  parseVerifyInput,
} from './validation.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${message}: expected ${right}, received ${left}`);
  }
}

function assertHttpError(fn: () => unknown, status: number, message: string) {
  try {
    fn();
  } catch (error) {
    assert(error instanceof HttpError, `${message}: not an HttpError`);
    assertEquals(error.status, status, `${message}: status`);
    return;
  }
  throw new Error(`${message}: expected an HttpError`);
}

const ROUTE_ID = '6c1f4c2e-1a52-4f1e-9d0e-3b7f1c2a4d5e';
const VEHICLE_ID = '0f3a8b2c-5d4e-4f6a-8b9c-1d2e3f4a5b6c';
const TICKET_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

const currentPayload = {
  id: TICKET_ID,
  code: 'ABCD2345',
  routeId: ROUTE_ID,
  vehicleType: 'taxi' as const,
  fareEtb: 25,
  exp: 2_000_000_000,
  nonce: 'nonce-1',
};

Deno.test('QR signs and verifies a payload', async () => {
  const token = await signTicketQr(currentPayload, 'current', 'secret-one');
  const result = await verifyTicketQr(
    token,
    { current: 'secret-one' },
    currentPayload.exp - 10,
  );
  assert(result.valid, 'expected a valid QR');
  assertEquals(result.payload, { ...currentPayload, kid: 'current' }, 'payload');
});

Deno.test('QR rejects a tampered signature', async () => {
  const token = await signTicketQr(currentPayload, 'current', 'secret-one');
  const [payload, signature] = token.split('.');
  const tampered = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
  const result = await verifyTicketQr(
    `${payload}.${tampered}`,
    { current: 'secret-one' },
    currentPayload.exp - 10,
  );
  assert(!result.valid && result.reason === 'bad_signature', 'bad signature');
});

Deno.test('QR verifies the signature before rejecting an expired token', async () => {
  const token = await signTicketQr(currentPayload, 'current', 'secret-one');
  const valid = await verifyTicketQr(
    token,
    { current: 'secret-one' },
    currentPayload.exp + 1,
  );
  assert(!valid.valid && valid.reason === 'expired', 'expired');

  const [payload, signature] = token.split('.');
  const tampered = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
  const bad = await verifyTicketQr(
    `${payload}.${tampered}`,
    { current: 'secret-one' },
    currentPayload.exp + 1,
  );
  assert(!bad.valid && bad.reason === 'bad_signature', 'signature checked first');
});

Deno.test('QR supports key rotation and rejects unknown keys', async () => {
  const token = await signTicketQr(currentPayload, 'old', 'secret-old');
  const rotated = await verifyTicketQr(
    token,
    { old: 'secret-old', current: 'secret-new' },
    currentPayload.exp - 10,
  );
  assert(rotated.valid, 'previous key should verify');

  const unknown = await verifyTicketQr(token, { current: 'secret-new' });
  assert(!unknown.valid && unknown.reason === 'unknown_kid', 'unknown kid');
});

Deno.test('QR rejects malformed tokens', async () => {
  for (const token of ['', 'one-part', 'a.b.c', '!!!.???']) {
    const result = await verifyTicketQr(token, { current: 'secret-one' });
    assert(!result.valid && result.reason === 'malformed', `malformed: ${token}`);
  }
});

Deno.test('ticket codes avoid ambiguous characters', () => {
  for (let index = 0; index < 50; index += 1) {
    const code = generateTicketCode();
    assertEquals(code.length, 8, 'code length');
    assert(isTicketCode(code), `valid code: ${code}`);
    assert(!/[01OI]/.test(code), `ambiguous character in ${code}`);
  }
  assert(!isTicketCode('ABCD234O'), 'letter O must be rejected');
  assert(!isTicketCode('ABCD2341'), 'digit 1 must be rejected');
});

Deno.test('purchase input accepts a valid request and defaults the idempotency key', () => {
  const input = parsePurchaseInput({
    routeId: ROUTE_ID,
    vehicleType: 'minibus',
  });
  assertEquals(input.routeId, ROUTE_ID, 'route');
  assertEquals(input.vehicleType, 'minibus', 'vehicle type');
  assert(input.idempotencyKey.length > 0, 'generated idempotency key');

  const explicit = parsePurchaseInput({
    routeId: ROUTE_ID,
    vehicleType: 'taxi',
    idempotencyKey: 'app-12345678',
  });
  assertEquals(explicit.idempotencyKey, 'app-12345678', 'explicit key');
});

Deno.test('purchase input rejects invalid values', () => {
  assertHttpError(
    () => parsePurchaseInput({ routeId: 'not-a-uuid', vehicleType: 'taxi' }),
    400,
    'non-uuid route',
  );
  assertHttpError(
    () => parsePurchaseInput({ routeId: ROUTE_ID, vehicleType: 'bus' }),
    400,
    'unsupported vehicle',
  );
  assertHttpError(
    () =>
      parsePurchaseInput({
        routeId: ROUTE_ID,
        vehicleType: 'taxi',
        idempotencyKey: 'x',
      }),
    400,
    'short idempotency key',
  );
});

Deno.test('verify input requires exactly one credential and a UUID vehicle', () => {
  const byQr = parseVerifyInput({ vehicleId: VEHICLE_ID, qrToken: 'payload.sig' });
  assertEquals(byQr.qrToken, 'payload.sig', 'qr token');

  const byCode = parseVerifyInput({ vehicleId: VEHICLE_ID, code: 'abcd2345' });
  assertEquals(byCode.code, 'ABCD2345', 'normalized code');

  assertHttpError(
    () => parseVerifyInput({ vehicleId: VEHICLE_ID }),
    400,
    'missing credential',
  );
  assertHttpError(
    () => parseVerifyInput({ vehicleId: VEHICLE_ID, qrToken: 'a.b', code: 'ABCD2345' }),
    400,
    'both credentials',
  );
  assertHttpError(
    () => parseVerifyInput({ vehicleId: 'vehicle', qrToken: 'a.b' }),
    400,
    'non-uuid vehicle',
  );
});

Deno.test('ticket id input requires a UUID', () => {
  assertEquals(parseTicketId({ ticketId: TICKET_ID }), TICKET_ID, 'ticket id');
  assertHttpError(() => parseTicketId({ ticketId: '1' }), 400, 'bad ticket id');
});

Deno.test('active tariff selection matches the backend rules', () => {
  const tariffs: TariffRow[] = [
    {
      id: 'old',
      route_id: ROUTE_ID,
      vehicle_type: 'taxi',
      fare_etb: 20,
      effective_from: '2026-01-01',
      effective_to: '2026-06-01',
      source_reference: 'ref',
      approved_by: 'authority',
    },
    {
      id: 'current',
      route_id: ROUTE_ID,
      vehicle_type: 'taxi',
      fare_etb: 25,
      effective_from: '2026-06-01',
      effective_to: null,
      source_reference: 'ref',
      approved_by: 'authority',
    },
  ];
  assertEquals(selectActiveTariff(tariffs, '2026-01-01')?.id, 'old', 'old');
  assertEquals(selectActiveTariff(tariffs, '2026-06-01')?.id, 'current', 'current');
  assertEquals(selectActiveTariff(tariffs, '2025-12-31'), null, 'before');
});

Deno.test('official tariff and effective status follow the schema', () => {
  assert(
    isOfficialTariff({ source_reference: ' proclamation ', approved_by: ' authority ' }),
    'official tariff',
  );
  assert(
    !isOfficialTariff({ source_reference: '  ', approved_by: 'authority' }),
    'blank source reference',
  );

  const base: TicketRow = {
    id: TICKET_ID,
    code: 'ABCD2345',
    route_id: ROUTE_ID,
    vehicle_type: 'taxi',
    fare_etb: '25.50',
    status: 'pending_payment',
    issued_at: '2026-10-24T10:00:00.000Z',
    expires_at: '2026-10-24T10:15:00.000Z',
  };
  assertEquals(effectiveStatus(base), 'expired', 'past pending ticket');
  assertEquals(
    effectiveStatus({ ...base, expires_at: '2999-01-01T00:00:00.000Z' }),
    'pending_payment',
    'live pending ticket',
  );
  assertEquals(ticketPayload(base).fare_etb, 25.5, 'fare number');
});
