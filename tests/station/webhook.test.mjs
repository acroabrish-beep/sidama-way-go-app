import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPaymentProvider,
  signDevelopmentPaymentEvent,
} from '../../src/lib/station/payment-provider.ts';

const event = {
  providerRef: 'ref-1',
  ticketId: 'ticket-1',
  amountEtb: 20,
  status: 'paid',
};

function devProvider() {
  return createPaymentProvider({
    provider: 'dev',
    appEnv: 'development',
    nodeEnv: 'test',
    webhookSecret: 'test-secret',
  });
}

test('a valid webhook signature is accepted', () => {
  const signed = signDevelopmentPaymentEvent(event, 'test-secret');
  assert.deepEqual(devProvider().verifyWebhook(signed.body, signed.signature), event);
});

test('a bad webhook signature is rejected', () => {
  const signed = signDevelopmentPaymentEvent(event, 'test-secret');
  assert.equal(devProvider().verifyWebhook(signed.body, '00'.repeat(32)), null);
});

test('a tampered webhook payload is rejected', () => {
  const signed = signDevelopmentPaymentEvent(event, 'test-secret');
  const tampered = signed.body.replace('"amountEtb":20', '"amountEtb":21');
  assert.notEqual(tampered, signed.body);
  assert.equal(devProvider().verifyWebhook(tampered, signed.signature), null);
});

test('the dev provider names its signature header explicitly', () => {
  assert.equal(devProvider().webhookSignatureHeader, 'x-payment-signature');
});
