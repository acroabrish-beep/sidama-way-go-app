import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createPaymentProvider,
  PaymentsNotConfiguredError,
  signDevelopmentPaymentEvent,
} from '../../src/lib/station/payment-provider.ts';

test('payments are disabled by default and return the required configuration error', async () => {
  const provider = createPaymentProvider({
    provider: 'disabled',
    appEnv: 'development',
    nodeEnv: 'development',
    webhookSecret: '',
  });
  await assert.rejects(provider.createSession({ ticketId: 't1', amountEtb: 20, idempotencyKey: 'i1' }), PaymentsNotConfiguredError);
});

test('APP_ENV defaults to production when unset', () => {
  const source = readFileSync(
    new URL('../../src/lib/config/env.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /appEnv:\s*process\.env\.APP_ENV \|\| 'production'/);
});

test('development payment is rejected unless APP_ENV and NODE_ENV both allow it', () => {
  for (const config of [
    { appEnv: 'production', nodeEnv: 'development' },
    { appEnv: 'staging', nodeEnv: 'development' },
    { appEnv: 'development', nodeEnv: 'production' },
    { appEnv: 'unset', nodeEnv: 'development' },
  ]) {
    assert.throws(
      () => createPaymentProvider({ provider: 'dev', webhookSecret: 'test-secret', ...config }),
      PaymentsNotConfiguredError,
      JSON.stringify(config),
    );
  }
  const provider = createPaymentProvider({
    provider: 'dev',
    appEnv: 'development',
    nodeEnv: 'test',
    webhookSecret: 'test-secret',
  });
  assert.equal(provider.name, 'dev');
});

test('development event uses the same signature verification contract', async () => {
  const provider = createPaymentProvider({
    provider: 'dev',
    appEnv: 'development',
    nodeEnv: 'development',
    webhookSecret: 'test-secret',
  });
  const event = { providerRef: 'ref-1', ticketId: 'ticket-1', amountEtb: 20, status: 'paid' };
  const signed = signDevelopmentPaymentEvent(event, 'test-secret');
  assert.deepEqual(provider.verifyWebhook(signed.body, signed.signature), event);
  assert.equal(provider.verifyWebhook(signed.body, 'bad-signature'), null);
});