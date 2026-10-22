import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateTicketCode,
  isTicketCode,
} from '../../src/lib/station/ticket-code.ts';

test('ticket codes use the unambiguous alphabet and the expected length', () => {
  for (let index = 0; index < 200; index += 1) {
    const code = generateTicketCode();
    assert.equal(code.length, 8);
    assert.equal(isTicketCode(code), true);
    assert.doesNotMatch(code, /[01IO]/);
  }
});

test('ticket code validation rejects ambiguous, short, and lowercase codes', () => {
  assert.equal(isTicketCode('ABCD2345'), true);
  assert.equal(isTicketCode('ABCD234'), false);
  assert.equal(isTicketCode('ABCD234O'), false);
  assert.equal(isTicketCode('abcd2345'), false);
  assert.equal(isTicketCode('ABCD-2345'), false);
});
