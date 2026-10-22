import assert from 'node:assert/strict';
import {
  normalizeRole,
  resolveSelfServiceRole,
  SELF_SERVICE_ROLES,
} from '../src/lib/auth/role-policy.ts';

const cases = [
  // [requested, existing/fallback, expected]
  ['admin', 'citizen', 'citizen'],           // new citizen cannot self-promote
  ['superAdmin', 'citizen', 'citizen'],      // enum name cannot self-promote
  ['businessAdmin', 'citizen', 'business'],  // app business role maps to business
  ['taxi_driver', 'citizen', 'taxi_driver'], // driver self-service allowed
  ['citizen', 'admin', 'admin'],             // admin is never downgraded by client
  ['admin', 'admin', 'admin'],               // admin stays admin
  ['business', 'admin', 'admin'],            // no downgrade of privileged account
  ['taxi', 'citizen', 'citizen'],            // taxi admin cannot be self-assigned
  ['tourism', 'citizen', 'citizen'],         // tourism admin cannot be self-assigned
  ['', 'citizen', 'citizen'],
];

for (const [requested, fallback, expected] of cases) {
  const actual = resolveSelfServiceRole(requested, fallback);
  assert.equal(
    actual,
    expected,
    `resolveSelfServiceRole(${JSON.stringify(requested)}, ${JSON.stringify(fallback)})`,
  );
}

assert.ok(SELF_SERVICE_ROLES.has('citizen'));
assert.ok(!SELF_SERVICE_ROLES.has('admin'));
assert.equal(normalizeRole('business'), 'business');
assert.equal(normalizeRole('businessAdmin'), 'business');
assert.equal(normalizeRole('superAdmin'), 'admin');
assert.equal(normalizeRole('taxiAdmin'), 'taxi');
assert.equal(normalizeRole('newTerminalAdmin'), 'new_terminal');

console.log(`PASS: ${cases.length + 7} role-policy assertions`);
