-- Read-only projection of tourist_sites exposing the PostGIS point as
-- latitude/longitude. PostgREST returns a bare geography column as EWKB hex,
-- which the Flutter client cannot use directly.
--
-- security_invoker keeps the caller's RLS and column privileges in force.

begin;

create or replace view public.tourist_sites_with_location
with (security_invoker = true)
as
select
  s.id,
  s.name,
  s.description,
  s.category,
  public.st_y(s.location::public.geometry) as latitude,
  public.st_x(s.location::public.geometry) as longitude,
  s.address,
  s.opening_hours,
  s.website,
  s.phone,
  s.entrance_fee,
  s.rating,
  s.reviews_count,
  s.images_urls,
  s.verified,
  s.created_at,
  s.updated_at
from public.tourist_sites s;

grant select on public.tourist_sites_with_location to authenticated;

commit;

notify pgrst, 'reload schema';
