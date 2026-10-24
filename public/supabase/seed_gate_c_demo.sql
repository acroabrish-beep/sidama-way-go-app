-- Gate C demo catalog. NOT applied automatically by deploy.
-- Applied manually to eolmukwhzuvscworgwwx on 2026-10-24.
--
-- Creates two clearly-named demo stations, one route, and one active official
-- taxi tariff. Safe to re-run: existing rows are reused and an existing active
-- tariff is not duplicated.
--
-- Apply with:
--   supabase db query --linked --file public/supabase/seed_gate_c_demo.sql

begin;

with from_station as (
  insert into public.st_stations (name, name_am, lat, lng, active)
  values ('DEMO Hawassa Main', 'የሙከራ ሃዋሳ ዋና', 7.0621, 38.4763, true)
  on conflict (name) do update
    set active = true, lat = excluded.lat, lng = excluded.lng
  returning id
), to_station as (
  insert into public.st_stations (name, name_am, lat, lng, active)
  values ('DEMO Hawassa Tabor', 'የሙከራ ሃዋሳ ታቦር', 7.0500, 38.5000, true)
  on conflict (name) do update
    set active = true, lat = excluded.lat, lng = excluded.lng
  returning id
), demo_route as (
  insert into public.st_routes (from_station_id, to_station_id, active)
  select from_station.id, to_station.id, true
  from from_station
  cross join to_station
  on conflict (from_station_id, to_station_id) do update
    set active = true
  returning id
)
insert into public.st_tariffs (
  route_id,
  vehicle_type,
  fare_etb,
  effective_from,
  effective_to,
  source_reference,
  approved_by,
  created_by
)
select
  demo_route.id,
  'taxi',
  25.00,
  current_date - 1,
  null,
  'DEMO-TARIFF-2026-01',
  'Demo Transport Office',
  'gate-c-seed'
from demo_route
where not exists (
  select 1
  from public.st_tariffs existing
  where existing.route_id = demo_route.id
    and existing.vehicle_type = 'taxi'
    and existing.effective_from <= current_date
    and (existing.effective_to is null or existing.effective_to > current_date)
);

commit;

select
  route.id as route_id,
  from_station.name as from_station,
  to_station.name as to_station,
  tariff.vehicle_type,
  tariff.fare_etb,
  tariff.effective_from,
  tariff.effective_to,
  tariff.source_reference,
  tariff.approved_by,
  case
    when btrim(tariff.source_reference) <> ''
      and btrim(tariff.approved_by) <> ''
      then 'Official tariff'
    else 'Tariff pending approval'
  end as label
from public.st_routes route
join public.st_stations from_station on from_station.id = route.from_station_id
join public.st_stations to_station on to_station.id = route.to_station_id
join public.st_tariffs tariff on tariff.route_id = route.id
where from_station.name = 'DEMO Hawassa Main'
  and to_station.name = 'DEMO Hawassa Tabor'
order by tariff.effective_from desc;
