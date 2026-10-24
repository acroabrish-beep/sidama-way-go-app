import {
  HttpError,
  mergeAuthenticatedRole,
  parseCustomClaims,
  parseProfileInput,
  parseServiceAccount,
  safeUser,
} from './core.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof HttpError)) {
      throw new Error(`expected HttpError, got ${String(error)}`);
    }
    assert(error.status === status, `expected status ${status}`);
    assert(error.code === code, `expected code ${code}`);
    return;
  }
  throw new Error('expected function to throw');
}

Deno.test('parseProfileInput accepts and trims known fields', () => {
  const input = parseProfileInput({
    fullName: '  Ada  ',
    phone: ' 0911 ',
    language: ' am ',
    role: 'super_admin',
  });
  assert(input.fullName === 'Ada', 'fullName trimmed');
  assert(input.phone === '0911', 'phone trimmed');
  assert(input.language === 'am', 'language trimmed');
  assert(!('role' in input), 'unknown fields are ignored');
});

Deno.test('parseProfileInput rejects invalid payloads', () => {
  assertThrows(
    () => parseProfileInput({ fullName: 42 }),
    400,
    'invalid_account',
  );
  assertThrows(
    () => parseProfileInput({ fullName: 'x'.repeat(121) }),
    400,
    'invalid_account',
  );
  assertThrows(() => parseProfileInput([]), 400, 'invalid_account');
});

Deno.test('parseServiceAccount returns null when unconfigured', () => {
  const account = parseServiceAccount(() => undefined);
  assert(account === null, 'no service account');
});

Deno.test('parseServiceAccount parses JSON and normalizes the key', () => {
  const account = parseServiceAccount(
    (key) =>
      key === 'FIREBASE_SERVICE_ACCOUNT_JSON'
        ? JSON.stringify({
          project_id: 'demo-project',
          client_email: 'service@demo-project.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
          private_key_id: 'key-1',
        })
        : undefined,
  );
  assert(account !== null, 'account parsed');
  assert(account?.projectId === 'demo-project', 'project id');
  assert(
    account?.privateKey.includes('\n') === true,
    'escaped newlines normalized',
  );
  assert(account?.privateKeyId === 'key-1', 'key id');
});

Deno.test('parseServiceAccount rejects malformed configuration', () => {
  assertThrows(
    () => parseServiceAccount((key) => key === 'FIREBASE_SERVICE_ACCOUNT_JSON' ? '{' : undefined),
    503,
    'auth_not_configured',
  );
  assertThrows(
    () =>
      parseServiceAccount((key) =>
        key === 'FIREBASE_SERVICE_ACCOUNT_JSON'
          ? JSON.stringify({ project_id: 'p', client_email: 'e' })
          : undefined
      ),
    503,
    'auth_not_configured',
  );
});

Deno.test('mergeAuthenticatedRole preserves existing claims', () => {
  const merged = mergeAuthenticatedRole({ tenant: 'hawassa', role: 'admin' });
  assert(merged.role === 'authenticated', 'role overwritten');
  assert(merged.tenant === 'hawassa', 'other claims preserved');
});

Deno.test('parseCustomClaims ignores malformed JSON', () => {
  assert(Object.keys(parseCustomClaims(undefined)).length === 0, 'empty');
  assert(Object.keys(parseCustomClaims('not-json')).length === 0, 'invalid');
  assert(parseCustomClaims('{"tenant":"hawassa"}').tenant === 'hawassa', 'parsed');
});

Deno.test('safeUser only returns allowlisted profile fields', () => {
  const user = safeUser({
    id: 'uuid',
    firebase_uid: 'uid',
    role: 'citizen',
    status: 'active',
    private_key: 'secret',
    password_hash: 'secret',
  });
  assert(user.id === 'uuid', 'id kept');
  assert(user.firebase_uid === 'uid', 'uid kept');
  assert(!('private_key' in user), 'private key dropped');
  assert(!('password_hash' in user), 'hash dropped');
});
