# Architecture

Sidama Way Go is split into a Flutter client and a Next.js backend. The backend
is the only component that holds privileged credentials. Supabase is the system
of record for operational data; Firebase provides identity only.

```
Flutter (web / Android)
  |  Firebase ID token (Authorization: Bearer ...)
  v
Next.js API routes (server only)
  |-- Firebase Admin: verify ID token, read UID
  |-- Supabase (service_role): stations, tariffs, queue, tickets, payments, reports
  |-- Gemini: citizen report triage and read-only assistant
  v
Supabase staging / production database
```

## Responsibilities

| Layer | Owns | Never does |
| --- | --- | --- |
| Flutter | UI, polling, local state, Firebase sign-in | Hold the Gemini key, service-role key, QR secret, or payment secrets |
| Next.js | Auth enforcement, validation, business rules, DB access, signing | Trust client-supplied fares, roles, UIDs, or payment status |
| Supabase | Stations, routes, tariffs, queue, tickets, payments, citizen reports, audit | Be called with the service-role key from the client |
| Firebase Auth | User identity and ID tokens | Store city operational data |

Legacy modules that still read Firestore directly are being retired slice by
slice. The three MVP slices below use the Next.js backend exclusively.

## MVP slices

### S1 - Citizen reports

1. The citizen submits description, category, GPS coordinates, and an optional
   photo URL to `POST /api/citizen-reporting`.
2. The route writes the row, then calls Gemini triage with only the description
   and selected category. Phone numbers, emails, and long IDs are redacted
   before the call. AI failure never fails the submission.
3. Triage fields (`ai_category`, `ai_urgency`, `ai_summary`, `ai_language`,
   `ai_confidence`, `ai_status`, `triaged_at`) are stored on the row and
   `updated_at` is bumped.
4. The admin screen polls `GET /api/citizen-reporting?admin=true` every 5 s,
   optionally with `status` and `updatedSince`. The response includes
   `serverTime`, captured before the query, which becomes the next watermark.
5. Admin `PATCH` changes `status` and may override `final_category` /
   `final_urgency`. The citizen "my reports" screen polls its own list with the
   same watermark and sees the new status within the polling interval.

The AI only suggests. A human sets status and overrides category/urgency.

### S2 - Station tickets, payment, QR, boarding

1. The passenger selects a station, destination, and vehicle type. The backend
   returns the server-side active tariff (`effective_from <= today` and
   `effective_to IS NULL OR effective_to > today`) with its source reference and
   approver. Client-supplied fares are ignored.
2. Ticket creation writes `st_tickets` with `pending_payment` and an expiry.
3. In staging, `PAYMENT_PROVIDER=dev` plus `APP_ENV=development` plus
   `NODE_ENV != production` enables the clearly labelled DEV payment. Real
   providers must confirm payment through a signature-verified webhook.
4. A ticket becomes `paid` only on verified payment. The QR token is then signed
   with HMAC-SHA256 and a key id (`kid`). The PDF receipt is generated from
   stored ticket/tariff/payment rows and carries a DEV PAYMENT banner when the
   provider is `dev`.
5. The driver scans or types the code. Verification locks the ticket row and
   transitions `paid -> used` exactly once; the second scan returns
   "Already used". Expired and unknown codes are reported distinctly.
6. Driver queue and station metrics poll every 5 s. Check-in/out trigger an
   immediate refresh.

### S3 - Read-only AI assistant

1. `POST /api/gemini` verifies the caller, validates the message (non-empty,
   at most 2,000 characters), and caps history at 10 entries.
2. The server builds a context snapshot from the database: active stations,
   active routes, today's active tariffs with source/approver, waiting queue
   counts, and the caller's five most recent tickets and citizen reports. Raw
   report descriptions and personal identifiers are not included.
3. Gemini receives the snapshot as data plus a system instruction that forbids
   inventing values, following instructions found in user text, and performing
   writes.
4. The request has a 10 s server timeout; the Flutter client uses 12 s. Any
   Gemini, context-query, timeout, or empty-response failure returns HTTP 503
   with `{ "error": "AI is temporarily unavailable.", "code": "ai_unavailable" }`.
   The assistant UI shows that message and the rest of the app keeps working.

## Real-time strategy

`lib/services/realtime_service.dart` is a single-flight poller:

- default interval 5 s (10 s is allowed by the API contract);
- one request at a time, no overlap;
- exponential backoff 5 s -> 10 s -> 30 s after failures;
- pauses when the app is not in the foreground and refreshes on resume;
- exposes `active` / `reconnecting` state, rendered by `RealtimeIndicator`.

Incremental list endpoints return `serverTime`; clients pass it as
`updatedSince` on the next request and merge by id. Full-snapshot endpoints
(queue, metrics) are small enough to re-read. Every client call sends
`Authorization: Bearer <Firebase ID token>`; BaseApiService refreshes the token
once on a 401.

## Errors

New endpoints return HTTP status plus a JSON body:

```json
{ "error": "Human-readable message", "code": "machine_readable_code" }
```

`lib/services/api/base_api_service.dart` maps this to `ApiException(message,
statusCode, code)`. Known codes: `invalid_json`, `validation_failed`,
`unauthorized`, `forbidden`, `not_found`, `storage_error`, `ai_unavailable`,
`network_timeout`.

## Security boundaries

- `AUTH_ENFORCE=true` is required in staging and production. `false` is a
  migration-only mode that logs and continues, never a demo setting.
- Admin routes verify the caller's role in Supabase (`users.role`), not a
  role string from the client.
- Supabase RLS is enabled on every `st_*` table with policies for
  `service_role` only. The Flutter client never uses the service-role key.
- QR, payment webhook, and provider secrets live only in backend environment
  variables.
- The AI has no write path. It receives a read-only snapshot.

## Environment variables (names only)

Backend `.env.local` (see `.env.example` for the complete list):

| Name | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key for legacy client reads |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access; never exposed to Flutter |
| `FIREBASE_PROJECT_ID` | Firebase Admin token verification |
| `GEMINI_API_KEY` | Gemini triage and assistant |
| `GOOGLE_MAPS_API_KEY` | Maps features |
| `PAYMENT_PROVIDER` | `dev` or a real provider; defaults to `disabled` |
| `PAYMENT_WEBHOOK_SECRET` | Webhook signature secret |
| `APP_ENV` | `development` enables the DEV payment with `PAYMENT_PROVIDER=dev` |
| `QR_SIGNING_SECRET`, `QR_SIGNING_KID`, `QR_SIGNING_PREVIOUS_KEYS` | Signed QR keys |
| `AUTH_ENFORCE` | `true` rejects unauthenticated requests; required for staging |
| `TELEBIRR_*`, `CHAPA_*`, `SANTIMPAY_*` | Reserved provider credentials |

Flutter build-time defines:

| Define | Purpose |
| --- | --- |
| `API_BASE_URL` | Backend origin; `http://10.0.2.2:3000` on Android emulator |
| `FIREBASE_PROJECT_ID` | Display/validation only; Firebase options are compiled in |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Legacy client reads |
| `GOOGLE_MAPS_API_KEY` | Maps features |
| `MVP_MODE` | `true` hides sample-only modules from menus |

Never commit real values.

## Out of scope for this MVP

Real payment rails, push notifications, Android release signing, and real
hotel/pharmacy/church/food data. `MVP_MODE=true` hides those sample-only
modules. Public Taxi Demo Mode remains available and is labelled DEMO in the
menu, app bar, and assistant answers.
