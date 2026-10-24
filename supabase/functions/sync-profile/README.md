# sync-profile Edge Function

Gate A identity bridge for the Flutter app:

1. Verifies the caller's Firebase ID token (signature, issuer, audience, expiry).
2. Rejects disabled or revoked Firebase sessions.
3. Provisions or links the caller's `public.users` row through the existing
   service-role-only `public.sync_user_profile(...)` RPC.
4. Ensures the Firebase custom claim `role = "authenticated"` required by
   Supabase third-party Firebase authentication and RLS.
5. Returns the caller's profile and whether the client must force-refresh its
   Firebase ID token.

## Why an Edge Function

`sync_user_profile` is callable only by `service_role`. New Firebase users have
no `public.users` row, and every RLS policy requires an active profile. The
Edge Function keeps the service-role key and Firebase service-account key
server-side.

It requires a database with a service-role-only `public.sync_user_profile(...)`
RPC and safe `public.users` RLS. The reviewed reconciliation in
`../../proposals/20261024_gate_b_legacy_reconciliation.proposed.sql` was
applied to the linked project on 2026-10-24 and supplies both for the legacy
schema. Applying that file anywhere else requires the same preflight and
approval.

## Deployment record

Deployed 2026-10-24 to Supabase project `eolmukwhzuvscworgwwx` as ACTIVE
version 1 with `--no-verify-jwt`, after explicit approval. The
`FIREBASE_SERVICE_ACCOUNT_JSON` secret was set in Supabase from the
`bekan-automotive-solution` service-account key; no key material is stored in
this repository or the Flutter app.

Real-token verification against the deployed function passed 21/21 checks: a
new Firebase user with no role claim was provisioned in `public.users`, the
function set `role = "authenticated"`, the refreshed Firebase token was
accepted by PostgREST, a second call was idempotent, and unauthenticated,
wrong-method, malformed-body, and oversized-body requests were rejected.
Database counts after cleanup matched the baseline (17 users, 1 report).

Not yet exercised: the Flutter app calling this function on a device or
emulator. The client code and its unit tests exist, but deployment verification
used a standalone script. Redeploying or deploying to another project still
requires explicit approval.

## Required secrets

Set these as Supabase Edge Function secrets. Never commit them or put them in
the Flutter app.

- `FIREBASE_SERVICE_ACCOUNT_JSON` — full service-account JSON, preferred.
  It must contain `project_id`, `client_email`, and `private_key`.

Alternatively:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` — PEM contents; literal `\n` is accepted.
- `FIREBASE_PRIVATE_KEY_ID` — optional.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the Supabase
Edge Function runtime and must not be set manually.

The same Firebase project used by the Flutter app must issue the service
account. The service account needs permission to read users and update custom
claims in Firebase Authentication (Firebase Admin / Identity Toolkit).

## Deploy

The gateway must not try to validate the Firebase token as a Supabase JWT.
Disable gateway JWT verification for this function only:

```bash
supabase functions deploy sync-profile --no-verify-jwt
```

The function performs its own Firebase verification and rejects requests
without a valid token. Do not change this to `verify_jwt = true` unless
Supabase's third-party Firebase auth integration is confirmed to accept the
same token at the gateway.

Set secrets from an untracked local env file:

```bash
supabase secrets set --env-file supabase/functions/.env.sync-profile
```

Do not commit that file. Keep the deployment approval separate from code
changes.

## Contract

`POST /functions/v1/sync-profile`

Headers:

- `Authorization: Bearer <Firebase ID token>`
- `apikey: <Supabase publishable/anon key>`
- `Content-Type: application/json`

Body (all optional; identity never comes from the body):

```json
{
  "fullName": "Abebe Bekele",
  "phone": "+2519...",
  "language": "en"
}
```

Success:

```json
{
  "user": {
    "id": "uuid",
    "firebase_uid": "firebase-uid",
    "email": "user@example.com",
    "full_name": "Abebe Bekele",
    "phone": "+2519...",
    "avatar_url": null,
    "role": "citizen",
    "status": "active",
    "language": "en",
    "department": null,
    "last_login_at": "...",
    "created_at": "...",
    "updated_at": "..."
  },
  "supabaseRoleClaim": "ready",
  "tokenRefreshRequired": false
}
```

If `tokenRefreshRequired` is true, the client must call
`FirebaseAuth.currentUser.getIdToken(true)` before making Supabase requests.

Error responses use `{ "error": "safe message", "code": "machine_code" }` and
never include tokens, credentials, SQL, or internal error details.

## Verification limits

Static type-checking is not proof of deployment. This function must be tested
with a real Firebase ID token against the deployed function before any feature
is reported as working.
