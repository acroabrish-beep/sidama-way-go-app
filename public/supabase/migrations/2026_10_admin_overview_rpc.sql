-- Phase 4: Super Admin overview RPC (additive).
--
-- Replaces GET /api/admin/overview with a SECURITY DEFINER function that
-- returns the same payload plus hotel reservation and SOS incident totals.
-- Only an active super_admin/admin (including the legacy `admin` role) may
-- execute it. All counts come from live tables; no values are invented.

begin;

create or replace function public.get_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if not exists (
    select 1
    from public.users u
    where u.firebase_uid = app_private.current_firebase_uid()
      and lower(coalesce(u.status, 'active')) = 'active'
      and coalesce(u.is_active, true)
      and lower(regexp_replace(coalesce(u.role, ''), '[^a-zA-Z]', '', 'g'))
          in ('superadmin', 'admin')
  ) then
    raise exception 'Administrator access is required'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generatedAt', v_now,
    'usersTotal', (
      select count(*) from public.users
    ),
    'citizenReportsTotal', (
      select count(*) from public.citizen_reports
    ),
    'citizenReportsPending', (
      select count(*) from public.citizen_reports
      where status = 'pending'
    ),
    'ticketsTotal', (
      select count(*) from public.st_tickets
    ),
    'ticketsPaid', (
      select count(*) from public.st_tickets
      where status in ('paid', 'used')
    ),
    'paidRevenueEtb', (
      select round(coalesce(sum(amount_etb), 0), 2)
      from public.st_payments
      where status = 'paid' and amount_etb >= 0
    ),
    'queueWaiting', (
      select count(*) from public.st_queue
      where status = 'waiting'
    ),
    'activeDrivers', (
      select count(*) from public.drivers
      where status = 'active'
    ),
    'hotelReservationsTotal', (
      select count(*) from public.hotel_reservations
    ),
    'sosIncidentsTotal', (
      select count(*) from public.emergency_incidents
    ),
    'revenueByDay', (
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(g.day, 'YYYY-MM-DD'),
          'amountEtb', round(
            coalesce(
              (
                select sum(p.amount_etb)
                from public.st_payments p
                where p.status = 'paid'
                  and p.amount_etb >= 0
                  and p.created_at >= g.day at time zone 'UTC'
                  and p.created_at < (g.day + interval '1 day') at time zone 'UTC'
              ),
              0
            ),
            2
          )
        )
        order by g.day
      )
      from generate_series(
        (v_now at time zone 'UTC')::date - interval '6 days',
        (v_now at time zone 'UTC')::date,
        interval '1 day'
      ) as g(day)
    ),
    'latestReports', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id::text,
            'category', coalesce(
              nullif(r.final_category::text, ''),
              nullif(r.category::text, ''),
              'other'
            ),
            'status', coalesce(nullif(r.status::text, ''), 'pending'),
            'urgency', coalesce(
              nullif(r.final_urgency::text, ''),
              nullif(r.ai_urgency::text, '')
            ),
            'description', case
              when btrim(coalesce(r.description, '')) <> ''
                then left(btrim(r.description), 240)
              else null
            end,
            'createdAt', r.created_at
          )
          order by r.created_at desc nulls last
        )
        from (
          select id, category, final_category, status, ai_urgency,
                 final_urgency, description, created_at
          from public.citizen_reports
          order by created_at desc nulls last
          limit 5
        ) r
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.get_admin_overview() from public;
revoke all on function public.get_admin_overview() from anon;
grant execute on function public.get_admin_overview() to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
