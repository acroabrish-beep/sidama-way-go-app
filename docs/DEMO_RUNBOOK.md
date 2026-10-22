# MVP Demo Runbook

Read this end to end before the EAII presentation. The runbook covers staging
setup, the exact demo commands, the acceptance script, failure drills, and how
to reset demo data.

> The scripts in `scripts/` are not migrations. They are run manually by an
> operator in the staging Supabase SQL editor. Never run them against
> production.

## 1. Prerequisites

Staging only. Do not point any of this at production.

1. A Supabase staging project with the base schema and these migrations
   applied (from `public/supabase/migrations/`):
   - `2026_10_station_tickets.sql`
   - `2026_10_citizen_reports_ai.sql`
2. The TEST ONLY fixture applied once: `scripts/staging-test-data.sql`.
   It creates two stations, one route, and taxi/bajaj/minibus tariffs, all
   labelled TEST ONLY.
3. Firebase staging project with:
   - a citizen test user;
   - an admin test user whose `users.role` in Supabase is an admin role
     (`admin`, `super_admin`, `taxi`, etc.);
   - a driver/station-operator test user for QR verification.
4. Backend `.env.local` with the staging values. Start from `.env.example`;
   never commit the real file. Required for the demo:
   - Supabase URL and service-role key;
   - Firebase project id;
   - Gemini API key;
   - `AUTH_ENFORCE=true`;
   - `PAYMENT_PROVIDER=dev`, `APP_ENV=development`;
   - QR signing secret and key id.
5. Flutter dependencies installed: `flutter pub get`.

## 2. Start the demo

Backend (terminal 1):

```bash
cd C:\src\sidama_way_go_backend
npm run dev
```

Health check: `http://localhost:3000` should answer. Keep this terminal
visible so AI errors and payment logs can be observed without exposing values.

Flutter web (terminal 2):

```bash
cd C:\src\sidama_way_go
flutter run -d chrome ^
  --dart-define=API_BASE_URL=http://localhost:3000 ^
  --dart-define=FIREBASE_PROJECT_ID=<staging-project-id> ^
  --dart-define=SUPABASE_URL=<staging-url> ^
  --dart-define=SUPABASE_ANON_KEY=<staging-anon-key> ^
  --dart-define=GOOGLE_MAPS_API_KEY=<maps-key> ^
  --dart-define=MVP_MODE=true
```

Android emulator instead of Chrome:

```bash
flutter run -d emulator-5554 ^
  --dart-define=API_BASE_URL=http://10.0.2.2:3000 ^
  --dart-define=MVP_MODE=true ^
  ...
```

Use the machine's LAN IP when running on a physical phone. `MVP_MODE=true`
hides hotel, food, pharmacy, healthcare, tourism, Eco-Shine, and wallet menu
entries that only contain sample or unfinished data. Taxi Demo remains visible
and is labelled DEMO.

## 3. Acceptance script (run twice)

Record the result of each run. A pass means every line completes and the stated
time is met. Polling is 5 s, so the 10 s budget is the product requirement, not
an estimate.

### S1 - Citizen report to admin and back

1. Sign in as the citizen. Open **City Report**.
2. Submit a report with a **short Amharic description** and a category. Confirm
   the GPS note is visible; location is attached automatically.
3. Open the **Citizen Reports** screen as the super admin.
   - Pass if the new report appears within 10 s with the citizen's selected
     category and the AI fields (`ai_summary` in English, urgency, language).
4. Change the status to **In progress**.
5. Return to the citizen's **City Report** screen (keep it open).
   - Pass if the status changes to **In progress** within 10 s without a manual
     refresh and without relaunching the app.
6. Repeat steps 2-5 once. Record both times.

If AI triage fails, the report must still be created. `ai_status` shows failed
or skipped; the admin can still set category and status.

### S2 - Ticket, DEV payment, QR, receipt, boarding

1. Sign in as the citizen. Open **Station Tickets** and choose the TEST ONLY
   station, a destination, and a vehicle type.
   - Pass if the official fare, source reference, and approver are shown. The
     fare must come from the server tariff, not from the client.
2. Continue to payment.
   - Pass if the page says **DEV PAYMENT** and the ticket is not marked paid
     before the dev confirmation completes.
3. Simulate the successful dev payment.
   - Pass if the ticket becomes paid and a signed QR appears.
4. Open **Download / share receipt**.
   - Pass if the PDF contains the ticket code, route, fare, tariff source, payment
     record, QR, and an orange **DEV PAYMENT** banner stating no real money was
     charged.
5. Sign in as the station driver. Open **Driver Station**, scan or type the
   ticket code.
   - Pass if the result is **Valid ticket - boarding recorded**.
6. Scan or type the same code again.
   - Pass if the result is **Already used** and the passenger is not boarded
     twice.
7. Open the station metrics / admin queue view.
   - Pass if the queue and metrics reflect the check-in/out/boarding within
     10 s.
8. Repeat steps 1-7 once with a new ticket.

### S3 - Read-only AI assistant

Open **AI Assistant** as the signed-in citizen and ask two data questions, for
example:

1. "Which stations and routes are active right now?"
2. "What is the taxi fare from TEST ONLY - Staging Station A to Station B, and
   who approved it?"

Pass criteria:

- The answer matches the live snapshot: station names, route, fare, source
  reference, and approver.
- The assistant does not invent a station, route, fare, ticket, or report.
- Ask about something outside the snapshot (for example a hotel booking). The
  assistant says the information is not available instead of guessing.
- Ask the assistant to cancel or change a ticket. It must refuse and point to
  the app screen, because it is read-only.

## 4. Failure drills

Run these before the presentation, then restore the normal setup.

### Backend down

1. Stop the backend (`Ctrl+C` in terminal 1).
2. Open the citizen report list, station queue, and AI assistant.
   - Pass if each shows a loading/error state with a retry action.
   - Fail if any screen shows sample or fabricated data as if it were live.
3. Restart the backend and retry. The screens recover without a relaunch.

### AI failure

1. Simulate AI failure by removing `GEMINI_API_KEY` from the backend
   environment (or temporarily point it at an invalid key) and restart.
2. Ask the assistant a question.
   - Pass if the UI shows exactly **AI is temporarily unavailable.**
   - Pass if citizen reports, tickets, payment, QR, and admin screens still
     work normally.
3. Restore the key and restart the backend.

### Slow AI

The server times out at 10 s and the client at 12 s. If the model is slow, the
same unavailable message appears; the rest of the app is unaffected. Do not
increase these values for the demo.

## 5. Reset demo data

Staging only, after the demo or between rehearsals:

1. Open the Supabase **staging** project SQL editor.
2. Confirm the project ref is staging.
3. Run `scripts/demo-reset.sql` once.
4. To run the station flow again, run `scripts/staging-test-data.sql`.

The reset deletes only rows linked to the TEST ONLY stations/routes/tariffs,
including their tickets and payments. Citizen reports, users, vehicles, and
audit logs are not deleted.

## 6. Troubleshooting

| Symptom | Check |
| --- | --- |
| 401 on every API call | `AUTH_ENFORCE=true` requires a signed-in Firebase user; confirm the client sends a Bearer token |
| 403 on the admin reports screen | The signed-in user's `users.role` is not an admin role |
| AI says unavailable | Gemini key configured, DB queries reachable, request under 10 s |
| No QR after payment | Payment is not verified yet; only a verified payment marks the ticket paid |
| Fare missing | No active tariff for that route/vehicle type today, or the TEST ONLY fixture was reset |
| Flutter web cannot reach the API | `API_BASE_URL`, backend port 3000, browser console/CORS |
| Android emulator cannot reach localhost | Use `http://10.0.2.2:3000`, not `localhost` |
| Updates take longer than 10 s | Check the RealtimeIndicator; reconnecting means the poller is backing off |
