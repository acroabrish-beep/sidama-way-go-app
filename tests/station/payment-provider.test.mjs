import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPaymentProvider,
  PaymentsNotConfiguredError,
  signDevelopmentPaymentEvent,
} from '../../src/lib/station/payment-provider.ts';

test('payments are disabled by default and return the required configuration error', async () => {
  const provider = createPaymentProvider({ provider: 'disabled', appEnv: 'development', webhookSecret: '' });
  await assert.rejects(provider.createSession({ ticketId: 't1', amountEtb: 20, idempotencyKey: 'i1' }), PaymentsNotConfiguredError);
});

test('development payment is rejected outside development', () => {
  assert.throws(
    () => createPaymentProvider({ provider: 'dev', appEnv: 'production', webhookSecret: 'test-secret' }),
    PaymentsNotConfiguredError,
  );
});

test('development event uses the same signature verification contract', async () => {
  const provider = createPaymentProvider({ provider: 'dev', appEnv: 'development', webhookSecret: 'test-secret' });
  const event = { providerRef: 'ref-1', ticketId: 'ticket-1', amountEtb: 20, status: 'paid' };
  const signed = signDevelopmentPaymentEvent(event, 'test-secret');
  assert.deepEqual(provider.verifyWebhook(signed.body, signed.signature), event);
  assert.equal(provider.verifyWebhook(signed.body, 'bad-signature'), null);
});