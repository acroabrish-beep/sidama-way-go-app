-- Rollback-only verification for Phase 2 hotels/tourism RLS.
-- Everything below runs inside a transaction that is rolled back at the end,
-- so no reservation, hotel, room, or site row persists.
begin;

select set_config('test.citizen_uid', (
  select firebase_uid from public.users
  where role = 'citizen' and firebase_uid is not null
    and status = 'active' and coalesce(is_active, true)
  order by created_at limit 1
), true);
select set_config('test.citizen2_uid', (
  select firebase_uid from public.users
  where role = 'citizen' and firebase_uid is not null
    and status = 'active' and coalesce(is_active, true)
  order by created_at desc limit 1
), true);
select set_config('test.staff_uid', (
  select firebase_uid from public.users
  where role = 'admin' and firebase_uid is not null
    and status = 'active' and coalesce(is_active, true)
  order by created_at limit 1
), true);
select set_config('test.results', '[]', true);

select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '00_privileges',
    'anon_can_select_hotels', has_table_privilege('anon', 'public.hotels', 'SELECT'),
    'authenticated_can_insert_hotels', has_table_privilege('authenticated', 'public.hotels', 'INSERT'),
    'authenticated_can_update_reservations', has_table_privilege('authenticated', 'public.hotel_reservations', 'UPDATE'),
    'seeded_reservation_rows', (select count(id) from public.hotel_reservations)
  ))::text,
  true);

-- ---------------------------------------------------------------------------
-- Citizen
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.citizen_uid'), 'role', 'authenticated'
)::text, true);

select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '01_citizen_reads',
    'hotels', (select count(id) from public.hotels),
    'rooms', (select count(id) from public.hotel_rooms),
    'sites', (select count(id) from public.tourist_sites),
    'tourism_staff', app_private.is_tourism_staff(),
    'hotel_staff', app_private.is_hotel_staff()
  ))::text,
  true);

with created as (
  insert into public.hotel_reservations (
    hotel_id, room_id, guest_name, guest_phone, check_in, check_out, guests
  ) values (
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'Phase 2 RLS test guest',
    '+251900000000',
    current_date + 30,
    current_date + 32,
    2
  )
  returning booking_code, room_number, total_amount, currency, status
)
select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '02_citizen_booking',
    'booking', (select to_jsonb(c) from created c)
  ))::text,
  true);

select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '03_citizen_own_rows',
    'reservations', (select count(id) from public.hotel_reservations)
  ))::text,
  true);

with attempted as (
  update public.hotel_reservations
     set status = 'confirmed'
   where guest_name = 'Phase 2 RLS test guest'
  returning id
)
select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '04_citizen_confirm_attempt',
    'rows_updated', (select count(*) from attempted),
    'confirmed_now', (select count(id) from public.hotel_reservations where status = 'confirmed')
  ))::text,
  true);

do $$
declare
  v_inserted boolean := false;
begin
  begin
    insert into public.hotels (name, city)
    values ('Citizen must not insert this hotel', 'Hawassa');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;

  perform set_config('test.results',
    (current_setting('test.results')::jsonb || jsonb_build_object(
      'step', '05_citizen_hotel_insert',
      'inserted', v_inserted
    ))::text,
    true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Second citizen
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.citizen2_uid'), 'role', 'authenticated'
)::text, true);

select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '06_second_citizen_rows',
    'reservations', (select count(id) from public.hotel_reservations)
  ))::text,
  true);

-- ---------------------------------------------------------------------------
-- Staff (live role `admin`)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.staff_uid'), 'role', 'authenticated'
)::text, true);

select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '07_staff_helpers',
    'hotel_staff', app_private.is_hotel_staff(),
    'tourism_staff', app_private.is_tourism_staff(),
    'reservations_visible', (select count(id) from public.hotel_reservations)
  ))::text,
  true);

with decided as (
  update public.hotel_reservations
     set status = 'confirmed'
   where guest_name = 'Phase 2 RLS test guest'
  returning status, decided_at
)
select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '08_staff_confirm',
    'decided', (select to_jsonb(d) from decided d)
  ))::text,
  true);

with new_hotel as (
  insert into public.hotels (name, city, star_rating)
  values ('Phase 2 RLS test hotel', 'Hawassa', 3)
  returning id
)
select set_config('test.new_hotel_id', (select id::text from new_hotel), true);

with new_room as (
  insert into public.hotel_rooms (hotel_id, room_number, room_type, capacity, nightly_rate)
  values (current_setting('test.new_hotel_id')::uuid, 'T1', 'Test Room', 2, 1000)
  returning hotel_id, room_number, nightly_rate
)
select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '09_staff_hotel_room_insert',
    'hotel_id', current_setting('test.new_hotel_id'),
    'room', (select to_jsonb(r) from new_room r)
  ))::text,
  true);

with added as (
  insert into public.tourist_sites (name, category, location, address)
  values (
    'Phase 2 RLS test site',
    'natural',
    'SRID=4326;POINT(38.48 7.05)'::geography,
    'Hawassa'
  )
  returning id, name
)
select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '10_staff_site_insert',
    'site', (select to_jsonb(a) from added a)
  ))::text,
  true);

with removed as (
  delete from public.tourist_sites
   where name = 'Phase 2 RLS test site'
  returning id
)
select set_config('test.results',
  (current_setting('test.results')::jsonb || jsonb_build_object(
    'step', '11_staff_site_delete',
    'deleted', (select count(*) from removed)
  ))::text,
  true);

-- ---------------------------------------------------------------------------
-- Summary, then roll back everything
-- ---------------------------------------------------------------------------
reset role;

select status,
       decided_at is not null as decision_recorded,
       decided_by_firebase_uid = current_setting('test.staff_uid') as decided_by_staff
from public.hotel_reservations
where guest_name = 'Phase 2 RLS test guest';

select jsonb_pretty(current_setting('test.results')::jsonb) as verification;

rollback;
