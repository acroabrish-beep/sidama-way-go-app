# Demo Readiness

Last updated: 2026-10-23. This table is the honest status of the MVP demo. It
distinguishes code that is implemented and verified from behaviour that still
needs a live staging run with operator credentials.

## Slice status

| Slice | Status | Real vs simulated | Blocked by |
| --- | --- | --- | --- |
| S1 Citizen reports | Implemented. Backend and Flutter gates pass. Manual acceptance not yet executed twice. | Real: report storage, Gemini triage (category, urgency, English summary, language), admin list/filter/status/override, citizen incremental polling. Staging stations and tariffs are TEST ONLY fixtures. | Operator staging Firebase test users and a populated staging Supabase; UI timing runs |
| S2 Station tickets | Implemented. Backend and Flutter gates pass. Manual acceptance not yet executed twice. | Real: server tariff lookup, ticket lifecycle, HMAC-signed QR, one-time verification, queue and metrics. Simulated on purpose: money via the DEV provider, labelled DEV PAYMENT in the UI and PDF. | Operator staging DB with migrations + TEST ONLY fixture; driver/passenger test accounts |
| S3 AI assistant | Implemented. Backend and Flutter gates pass. Live model answers not yet verified against staging. | Real: DB context snapshot, Gemini call, 10 s server / 12 s client timeout, typed `ai_unavailable`. No hardcoded city answers and no write path. | Operator Gemini key and signed-in staging user to exercise the assistant |

## Automated verification

| Gate | Result | Notes |
| --- | --- | --- |
| Backend `npx tsc --noEmit` | Pass (exit 0) | 2026-10-23 |
| Backend `npm test` | Pass, 31/31 | 2026-10-23 |
| Backend `npm run build` | Pass (exit 0) | 2026-10-23 |
| Flutter `flutter analyze` | 0 errors, 0 warnings, 157 info-level lints | Info lints are pre-existing across legacy files; all files touched for S1-S3 and MVP_MODE report zero issues |
| Flutter `flutter test` | Pass, 56/56 | 2026-10-23 |
| Flutter `flutter build web` | Pass (exit 0) | Built with `MVP_MODE=true`, `API_BASE_URL=http://localhost:3000` |
| Flutter `flutter build apk --debug` | Pass (exit 0) | Built with `MVP_MODE=true`, `API_BASE_URL=http://10.0.2.2:3000`; `build/app/outputs/flutter-apk/app-debug.apk` |

## Auth and error-contract probes

With the local backend running against the configured staging environment and
`AUTH_ENFORCE=true`, unauthenticated and invalid-token requests were rejected:

| Probe | Result |
| --- | --- |
| `POST /api/gemini` no token | 401 `{ "error": "...", "code": "unauthorized" }` |
| `POST /api/gemini` invalid token | 401 `{ "error": "...", "code": "unauthorized" }` |
| `POST /api/citizen-reporting` no token | 401 `{ ..., "code": "unauthorized" }` |
| `GET /api/citizen-reporting?admin=true` no token | 401 `{ ..., "code": "unauthorized" }` |
| `GET /api/stations` no token | 401 (station guard) |

Authenticated flows were not exercised because no staging Firebase user
credentials were available to the agent.

## Manual acceptance

The acceptance script is in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md), section 3. It
must be run twice end to end. It has **not** been executed by the coding agent
because it needs a signed-in Firebase user on the staging project, the staging
Supabase data, and interactive UI/timing checks. Until it is run, treat the
10-second visibility claims as design guarantees backed by 5-second polling and
verified API contracts, not as observed timings.

| Run | S1 | S2 | S3 | Notes |
| --- | --- | --- | --- | --- |
| 1 | Not run | Not run | Not run | Requires operator staging setup |
| 2 | Not run | Not run | Not run | Requires operator staging setup |

## Contract audit (mismatches found and fixed)

The client/server contracts were checked before fixing. Mismatches 1-5 were
corrected; 6 remains out of scope.

1. Ticket detail tariff JSON omitted `route_id` and `vehicle_type`, which the
   Flutter `TariffInfo.fromJson` requires. Fixed in `GET /api/tickets/[id]`.
2. Code-based verification responses omitted `issued_at`, which the Flutter
   verification card displays. Fixed in `src/lib/station/verify.ts`.
3. The Super Admin "Citizen Reports" screen still used Firestore CRUD while the
   backend owned the data. Rewired to `GET/PATCH /api/citizen-reporting`.
4. Report list endpoints had no incremental watermark. Added `updatedSince`
   plus a `serverTime` captured before the query.
5. The assistant used legacy city tables and hardcoded facts, had no timeout,
   and returned generic errors. Rewritten to use `st_*` context, a read-only
   prompt, a 10 s timeout, and `ai_unavailable`.
6. `security_service.dart` calls `/api/security/audit`, which does not exist in
   the backend. Out of scope for these three slices; the call failure is logged
   by the client and does not affect S1-S3.

## Known limitations and uncertainties

- Staging connectivity, Firebase users, and the Gemini key were not exercised by
  the agent. The backend environment file contains values, but no live calls
  were made with a real ID token.
- The DEV payment is intentionally not a payment rail. It is gated by
  `PAYMENT_PROVIDER=dev`, `APP_ENV=development`, and `NODE_ENV != production`,
  and every UI/PDF surface labels it.
- Real payment providers, push notifications, release signing, and real
  hotel/pharmacy/church/food data remain out of scope.
- Amharic and Sidaamu Afoo answer quality depends on Gemini; Sidaamu Afoo is a
  very low-resource language. The AI has no fallback that fabricates data.
- Legacy Firestore-backed modules still exist behind `MVP_MODE=false`; only
  menu hiding is implemented, not data migration.
- `demo-reset.sql` and `staging-test-data.sql` are manual staging helpers. They
  have not been run by the agent, per the mission rule against running SQL.
