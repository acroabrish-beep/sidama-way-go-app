# Phase A0 — Schema Comparison (read-only)

**Date:** 2026-10-22  
**Source:** Live Supabase PostgREST OpenAPI schema (column names only; no rows read or printed).  
**Fallback note:** The local backend was not running on `localhost:3000`, and
`/api/debug-schema` is admin-token protected and only introspects `users`.
Live column metadata was therefore read through PostgREST's read-only OpenAPI
description. No SQL, DDL, or writes were executed.

## Real columns observed

### `routes`
`id, name, description, route_number, operator_id, start_location, end_location, distance_km, estimated_time_minutes, fare_price, status, created_at, updated_at`

> Differs from `schema.sql` (`start_point`, `end_point`, `waypoints`, `fare`).
> The station system does not use this table.

### `tickets` (legacy citizen/trip tickets)
`id, trip_id, citizen_id, route_id, ticket_code, qr_code, price, status, issue_date, validity_date, created_at`

> Differs from `schema.sql` (`user_id`, `seat_number`, `issued_at`, `expires_at`).
> Left untouched. The station system uses new `st_tickets`.

### `vehicles`
`id, owner_id, registration_number, vehicle_type, manufacturer, year, capacity, current_location, current_route_id, status, created_at, updated_at`

> Differs from `schema.sql` (`plate_number`, `type`, `driver_id`, `route_id`).
> Reused read-only by `st_queue` via `vehicle_id`; no column changes proposed.

### `drivers`
`id, user_id, vehicle_id, license_number, license_expiry, rating, status, total_earnings, total_rides, current_location, created_at, updated_at`

> Not present in `schema.sql`. The live table is the authoritative driver ↔
> vehicle assignment. Reused read-only by queue check-in, verification, and
> driver vehicle listing.

### `users`
`id, firebase_uid, first_name, last_name, full_name, email, phone, photo, avatar_url, address, city, role, user_type, language, department, status, is_approved, is_active, wallet_balance, membership_number, unread_notifications, created_at, last_login, updated_at`

> Differs from `schema.sql` (no `deleted_at`; extra identity/profile columns).
> No changes proposed.

### Related tables present
`route_stops`, `trips`, `taxi_orders`, `roles`, `user_roles`, `gps_locations`.

### Station tables
`st_stations`, `st_routes`, `st_tariffs`, `st_queue`, `st_tickets`, `st_payments`,
`st_audit`, `st_rate_limits` are **not deployed yet**. They are created by:

- `public/supabase/migrations/2026_10_station_tickets.sql`
- `public/supabase/migrations/2026_10_station_tickets_operations.sql`

## Reuse decision

- **Vehicles:** reuse `vehicles.id` as `st_queue.vehicle_id` and
  `st_tickets.verified_vehicle_id`. Read `registration_number`,
  `vehicle_type`, and `status`.
- **Drivers:** reuse `drivers.user_id` (→ `users.id` via `users.firebase_uid`)
  and `drivers.vehicle_id` for assignment checks. No new driver table.
- **Tariffs/stations/routes/tickets/payments/audit:** new `st_` tables so the
  legacy `routes`/`tickets` tables are untouched.
- **Identity:** Firebase UID is stored on station rows; `users.role` remains the
  role source of truth.

## Risk

The live schema differs from `schema.sql` in multiple places. Migration files
must be reviewed and applied by an operator against staging first. No migration
was applied in this phase.
