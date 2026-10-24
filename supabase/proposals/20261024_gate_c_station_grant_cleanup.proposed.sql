-- Gate C follow-up - APPLIED to eolmukwhzuvscworgwwx ("sidaama way go")
-- on 2026-10-24 after explicit approval.
--
-- Finding: the applied RLS proposal granted column-level SELECT privileges,
-- but Supabase's default privileges had already granted table-level ALL to
-- anon and authenticated on the newly created st_* tables. RLS still blocks
-- writes (there are no write policies for those roles), and anon currently
-- reads zero rows. However, the column restrictions in the approved proposal
-- are not actually enforced for authenticated reads (for example,
-- st_queue.vehicle_id is readable despite the proposal saying it is not).
--
-- This script revokes the broad table grants and restores only the intended
-- authenticated SELECT columns. No write privilege is granted to anon or
-- authenticated. service_role is untouched because the Edge Functions rely on
-- it and it bypasses RLS.
--
-- Apply only after explicit approval:
--   supabase db query --linked --file supabase/proposals/20261024_gate_c_station_grant_cleanup.proposed.sql

begin;

revoke all on public.st_stations, public.st_routes, public.st_tariffs,
  public.st_tickets, public.st_payments, public.st_queue
from anon, authenticated;

grant select (
  id, name, name_am, lat, lng, active
) on public.st_stations to authenticated;

grant select (
  id, from_station_id, to_station_id, active
) on public.st_routes to authenticated;

grant select (
  id, route_id, vehicle_type, fare_etb, effective_from, effective_to,
  source_reference, approved_by
) on public.st_tariffs to authenticated;

grant select (
  id, code, passenger_firebase_uid, route_id, tariff_id, vehicle_type,
  fare_etb, status, issued_at, expires_at, used_at, verified_vehicle_id
) on public.st_tickets to authenticated;

grant select (
  ticket_id, provider, provider_ref, amount_etb, status, verified_at, created_at
) on public.st_payments to authenticated;

grant select (
  station_id, vehicle_type, status
) on public.st_queue to authenticated;

commit;

-- Expected after applying: only SELECT rows for authenticated, nothing for anon.
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'st_stations', 'st_routes', 'st_tariffs',
    'st_tickets', 'st_payments', 'st_queue'
  )
  and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;
