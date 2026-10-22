# Sidama Way Go - Backend

Next.js API and business logic for the Sidama Way Go MVP. The Flutter client
never holds privileged credentials: Firebase provides identity, Supabase is the
system of record, and this service is the only component that talks to both
plus Gemini.

## MVP slices

| Slice | What works | Main routes |
| --- | --- | --- |
| S1 Citizen reports | Submit report, Gemini triage (category, urgency, English summary, language), admin list/filter/status/override, citizen sees status within 10 s | `POST/GET/PATCH /api/citizen-reporting` |
| S2 Station tickets | Server-side tariffs, DEV payment, signed QR, PDF receipt data, one-time boarding verification, live queue/metrics | `/api/stations`, `/api/tariffs/quote`, `/api/tickets`, `/api/tickets/verify`, `/api/payments/*`, `/api/queue/*` |
| S3 AI assistant | Read-only answers from a live DB snapshot (stations, active tariffs, queue, caller's tickets/reports), 10 s timeout | `POST /api/gemini` |

Errors use HTTP status plus `{ "error": "...", "code": "..." }`. Auth is a
Firebase ID token in `Authorization: Bearer ...`; admin routes also verify the
caller's role in Supabase. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local setup

1. Copy `.env.example` to `.env.local` and fill in the staging values. Never
   commit `.env.local` or paste real values into documentation.
2. Install and run:

```bash
npm install
npm run dev
```

The API listens on `http://localhost:3000` by default.

### Environment

All names are listed in `.env.example`. The demo depends on:

- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
- `FIREBASE_PROJECT_ID`;
- `GEMINI_API_KEY`;
- `AUTH_ENFORCE=true`;
- `PAYMENT_PROVIDER=dev`, `APP_ENV=development` (staging only);
- `QR_SIGNING_SECRET`, `QR_SIGNING_KID`.

The dev payment provider is additionally gated by `NODE_ENV != production`.
Real providers must confirm payments through a signature-verified webhook; a
client can never mark a ticket paid.

## Database

Migrations live in `public/supabase/migrations/` and are applied manually by an
operator. They are not run by the app.

Staging helpers (never migrations, never run against production):

- `scripts/staging-test-data.sql` - creates TEST ONLY stations, a route, and
  tariffs for rehearsals.
- `scripts/demo-reset.sql` - deletes only rows linked to the TEST ONLY fixture.

## Gates

Run before committing:

```bash
npx tsc --noEmit
npm test
npm run build
```

## Demo and operations

- [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) - setup, acceptance script,
  failure drills, reset.
- [docs/DEMO_READINESS.md](docs/DEMO_READINESS.md) - what is real, what is
  simulated, and current verification status.
- [docs/RESPONSIBLE_AI.md](docs/RESPONSIBLE_AI.md) - triage and assistant data
  handling and limitations.

## Out of scope for this MVP

Real payment rails, push notifications, release signing, and real
hotel/pharmacy/church/food data.
