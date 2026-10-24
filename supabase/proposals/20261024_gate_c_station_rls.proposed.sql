-- Gate C proposed change - NOT APPLIED.
-- Target project: eolmukwhzuvscworgwwx ("sidaama way go").
--
-- Purpose: allow the Flutter app to read the station catalog, the caller's own
-- tickets and payments, and waiting-queue counts directly through PostgREST.
-- All writes and every privileged operation stay server-side in the
-- purchase-ticket / verify-ticket / ticket-qr Edge Functions.
--
-- Prerequisites, both currently unapplied:
--   1. public/supabase/migrations/2026_10_station_tickets.sql
--   2. public/supabase/migrations/2026_10_station_tickets_operations.sql
--   3. Supabase third-party auth trusts Firebase project bekan-automotive-solution
--      and the Firebase ID token carries role=authenticated.
--
-- Review notes:
--   * auth.jwt()->>'sub' is the Firebase UID under the third-party auth bridge.
--   * st_audit and st_rate_limits remain service-role only.
--   * No INSERT/UPDATE/DELETE grant is proposed for any st_* table.
--   * st_queue is readable only for waiting rows, and vehicle_id is not granted.
--   * st_stations / st_routes / st_tariffs are readable in full so historical
--     tickets still resolve after a station or route is deactivated.

BEGIN;

-- Catalog data needed by the station list, destination picker and quote.
CREATE POLICY st_stations_authenticated_read ON public.st_stations
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY st_routes_authenticated_read ON public.st_routes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY st_tariffs_authenticated_read ON public.st_tariffs
  FOR SELECT TO authenticated
  USING (true);

-- A passenger may only read their own tickets. The UUID remains unguessable,
-- but the policy is the actual boundary.
CREATE POLICY st_tickets_own_read ON public.st_tickets
  FOR SELECT TO authenticated
  USING (passenger_firebase_uid = auth.jwt() ->> 'sub');

-- A payment is readable only through the caller's own ticket.
CREATE POLICY st_payments_own_read ON public.st_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.st_tickets ticket
      WHERE ticket.id = st_payments.ticket_id
        AND ticket.passenger_firebase_uid = auth.jwt() ->> 'sub'
    )
  );

-- Destination cards show how many vehicles are waiting. Only waiting rows are
-- visible, and vehicle_id / checked_in_at are not granted.
CREATE POLICY st_queue_waiting_read ON public.st_queue
  FOR SELECT TO authenticated
  USING (status = 'waiting');

REVOKE ALL ON public.st_audit FROM anon, authenticated;
REVOKE ALL ON public.st_rate_limits FROM anon, authenticated;

GRANT SELECT (
  id, name, name_am, lat, lng, active
) ON public.st_stations TO authenticated;

GRANT SELECT (
  id, from_station_id, to_station_id, active
) ON public.st_routes TO authenticated;

GRANT SELECT (
  id, route_id, vehicle_type, fare_etb, effective_from, effective_to,
  source_reference, approved_by
) ON public.st_tariffs TO authenticated;

GRANT SELECT (
  id, code, passenger_firebase_uid, route_id, tariff_id, vehicle_type,
  fare_etb, status, issued_at, expires_at, used_at, verified_vehicle_id
) ON public.st_tickets TO authenticated;

GRANT SELECT (
  ticket_id, provider, provider_ref, amount_etb, status, verified_at, created_at
) ON public.st_payments TO authenticated;

GRANT SELECT (
  station_id, vehicle_type, status
) ON public.st_queue TO authenticated;

COMMIT;

-- Verification after applying (run separately):
--   SELECT policyname, tablename, cmd, roles
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'st_stations', 'st_routes', 'st_tariffs',
--       'st_tickets', 'st_payments', 'st_queue'
--     )
--   ORDER BY tablename, policyname;
--
--   SELECT table_name, privilege_type, column_name
--   FROM information_schema.column_privileges
--   WHERE grantee = 'authenticated'
--     AND table_schema = 'public'
--     AND table_name IN (
--       'st_stations', 'st_routes', 'st_tariffs',
--       'st_tickets', 'st_payments', 'st_queue'
--     )
--   ORDER BY table_name, column_name;
--
-- Rollback:
--   BEGIN;
--   DROP POLICY IF EXISTS st_stations_authenticated_read ON public.st_stations;
--   DROP POLICY IF EXISTS st_routes_authenticated_read ON public.st_routes;
--   DROP POLICY IF EXISTS st_tariffs_authenticated_read ON public.st_tariffs;
--   DROP POLICY IF EXISTS st_tickets_own_read ON public.st_tickets;
--   DROP POLICY IF EXISTS st_payments_own_read ON public.st_payments;
--   DROP POLICY IF EXISTS st_queue_waiting_read ON public.st_queue;
--   REVOKE SELECT ON public.st_stations FROM authenticated;
--   REVOKE SELECT ON public.st_routes FROM authenticated;
--   REVOKE SELECT ON public.st_tariffs FROM authenticated;
--   REVOKE SELECT ON public.st_tickets FROM authenticated;
--   REVOKE SELECT ON public.st_payments FROM authenticated;
--   REVOKE SELECT ON public.st_queue FROM authenticated;
--   COMMIT;
