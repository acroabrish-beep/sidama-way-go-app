import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signTicketQr, verifyTicketQr } from '../../src/lib/station/qr.ts';

const payload = {
  id: 'ticket-1',
  code: 'ABC234',
  routeId: 'route-1',
  vehicleType: 'taxi',
  fareEtb: 22,
  exp: 2_000_000_000,
  nonce: 'random-nonce',
};

test('QR signature verifies with the matching key id', () => {
  const token = signTicketQr(payload, 'key-1', 'test-secret');
  const result = verifyTicketQr(token, { 'key-1': 'test-secret' }, 1_900_000_000);
  assert.equal(result.valid, true);
});

test('QR payload tampering is rejected', () => {
  const token = signTicketQr(payload, 'key-1', 'test-secret');
  const [encoded, signature] = token.split('.');
  const tampered = `${Buffer.from(encoded, 'base64url').toString('utf8').replace('22', '23')}`;
  const tamperedToken = `${Buffer.from(tampered).toString('base64url')}.${signature}`;
  assert.deepEqual(verifyTicketQr(tamperedToken, { 'key-1': 'test-secret' }, 1_900_000_000), {
    valid: false,
    reason: 'bad_signature',
  });
});

test('QR with an unknown key id is rejected', () => {
  const token = signTicketQr(payload, 'retired-key', 'old-secret');
  assert.deepEqual(verifyTicketQr(token, { 'key-1': 'test-secret' }, 1_900_000_000), {
    valid: false,
    reason: 'unknown_kid',
  });
});