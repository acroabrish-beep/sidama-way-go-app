-- Phase 2: hotels, rooms, and reservations on top of the live tourist_sites
-- table. Additive only: no existing table, policy, or grant is dropped or
-- narrowed.
--
-- Firebase ID tokens reach PostgREST as the database role `authenticated`, so
-- staff writes are gated by app_private helpers that read the caller's live
-- public.users row. Signing in alone is never enough.
--
-- Not in scope here: tour packages, guides, operators, bookings, contract
-- rides, events, reviews, airport pickups, and emergency contacts. The tourism
-- dashboards show an explicit "not migrated" panel for those domains.

begin;

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

create or replace function app_private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.firebase_uid = app_private.current_firebase_uid()
      and lower(coalesce(u.status, 'active')) = 'active'
      and coalesce(u.is_active, true)
  )
$$;

create or replace function app_private.is_tourism_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.firebase_uid = app_private.current_firebase_uid()
      and lower(coalesce(u.status, 'active')) = 'active'
      and coalesce(u.is_active, true)
      and lower(regexp_replace(coalesce(u.role, ''), '[^a-zA-Z]', '', 'g'))
          in ('superadmin', 'cityadmin', 'tourismadmin', 'admin')
  )
$$;

create or replace function app_private.is_hotel_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.firebase_uid = app_private.current_firebase_uid()
      and lower(coalesce(u.status, 'active')) = 'active'
      and coalesce(u.is_active, true)
      and lower(regexp_replace(coalesce(u.role, ''), '[^a-zA-Z]', '', 'g'))
          in ('superadmin', 'cityadmin', 'hoteladmin', 'admin')
  )
$$;

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.is_active_user()
  from public, anon, authenticated;
revoke all on function app_private.is_tourism_staff()
  from public, anon, authenticated;
revoke all on function app_private.is_hotel_staff()
  from public, anon, authenticated;
revoke all on function app_private.touch_updated_at()
  from public, anon, authenticated;

grant execute on function app_private.is_active_user() to authenticated;
grant execute on function app_private.is_tourism_staff() to authenticated;
grant execute on function app_private.is_hotel_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Hotels
-- ---------------------------------------------------------------------------

create table if not exists public.hotels (
  id uuid primary key default gen_random_uuid(),
  owner_firebase_uid text not null
    default app_private.current_firebase_uid(),
  name text not null,
  description text,
  address text,
  city text not null default 'Hawassa',
  phone text,
  latitude double precision,
  longitude double precision,
  star_rating smallint,
  image_urls text[],
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotels_name_length
    check (char_length(btrim(name)) between 2 and 160),
  constraint hotels_city_not_blank
    check (btrim(city) <> ''),
  constraint hotels_status_check
    check (status in ('draft', 'published', 'archived')),
  constraint hotels_star_rating_range
    check (star_rating is null or star_rating between 1 and 5),
  constraint hotels_latitude_range
    check (latitude is null or latitude between -90 and 90),
  constraint hotels_longitude_range
    check (longitude is null or longitude between -180 and 180),
  constraint hotels_location_pair
    check ((latitude is null) = (longitude is null)),
  constraint hotels_phone_length
    check (phone is null or char_length(btrim(phone)) between 5 and 40)
);

create index if not exists hotels_status_city_idx
  on public.hotels (status, city);
create index if not exists hotels_owner_idx
  on public.hotels (owner_firebase_uid);

-- Defined after public.hotels so SQL-function body validation can resolve it.

create or replace function app_private.can_read_hotel(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hotels h
    where h.id = p_hotel_id
      and (
        h.status = 'published'
        or h.owner_firebase_uid = app_private.current_firebase_uid()
        or app_private.is_hotel_staff()
        or app_private.is_tourism_staff()
      )
  )
$$;

create or replace function app_private.can_manage_hotel(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hotels h
    where h.id = p_hotel_id
      and (
        h.owner_firebase_uid = app_private.current_firebase_uid()
        or app_private.is_hotel_staff()
      )
  )
$$;

revoke all on function app_private.can_read_hotel(uuid)
  from public, anon, authenticated;
revoke all on function app_private.can_manage_hotel(uuid)
  from public, anon, authenticated;
grant execute on function app_private.can_read_hotel(uuid) to authenticated;
grant execute on function app_private.can_manage_hotel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hotel rooms
-- ---------------------------------------------------------------------------

create table if not exists public.hotel_rooms (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  room_number text not null,
  room_type text not null,
  capacity smallint not null default 1,
  nightly_rate numeric(12, 2) not null,
  currency text not null default 'ETB',
  status text not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_rooms_number_length
    check (char_length(btrim(room_number)) between 1 and 20),
  constraint hotel_rooms_type_length
    check (char_length(btrim(room_type)) between 2 and 80),
  constraint hotel_rooms_capacity_positive
    check (capacity > 0),
  constraint hotel_rooms_rate_non_negative
    check (nightly_rate >= 0),
  constraint hotel_rooms_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint hotel_rooms_status_check
    check (status in ('available', 'occupied', 'maintenance', 'inactive')),
  constraint hotel_rooms_hotel_number_unique
    unique (hotel_id, room_number),
  constraint hotel_rooms_id_hotel_unique
    unique (id, hotel_id)
);

create index if not exists hotel_rooms_hotel_status_idx
  on public.hotel_rooms (hotel_id, status);

-- ---------------------------------------------------------------------------
-- 4. Hotel reservations
-- ---------------------------------------------------------------------------

create table if not exists public.hotel_reservations (
  id uuid primary key default gen_random_uuid(),
  booking_code text not null unique
    default ('SWG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  hotel_id uuid not null references public.hotels (id) on delete restrict,
  room_id uuid not null,
  hotel_name text not null,
  room_number text not null,
  room_type text not null,
  guest_firebase_uid text not null
    default app_private.current_firebase_uid(),
  guest_name text not null,
  guest_phone text,
  check_in date not null,
  check_out date not null,
  guests smallint not null default 1,
  total_amount numeric(12, 2) not null default 0,
  currency text not null default 'ETB',
  status text not null default 'pending',
  decided_at timestamptz,
  decided_by_firebase_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_reservations_room_hotel_fk
    foreign key (room_id, hotel_id)
    references public.hotel_rooms (id, hotel_id) on delete restrict,
  constraint hotel_reservations_dates
    check (check_out > check_in),
  constraint hotel_reservations_guests_positive
    check (guests > 0),
  constraint hotel_reservations_total_non_negative
    check (total_amount >= 0),
  constraint hotel_reservations_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint hotel_reservations_guest_name_length
    check (char_length(btrim(guest_name)) between 2 and 120),
  constraint hotel_reservations_guest_phone_length
    check (guest_phone is null or char_length(btrim(guest_phone)) between 5 and 40),
  constraint hotel_reservations_status_check
    check (status in (
      'pending', 'confirmed', 'rejected', 'cancelled',
      'checked_in', 'checked_out', 'no_show'
    )),
  constraint hotel_reservations_decision_check
    check (
      (status = 'pending'
        and decided_at is null
        and decided_by_firebase_uid is null)
      or
      (status <> 'pending'
        and decided_at is not null
        and decided_by_firebase_uid is not null)
    )
);

create index if not exists hotel_reservations_guest_idx
  on public.hotel_reservations (guest_firebase_uid, check_in desc);
create index if not exists hotel_reservations_hotel_idx
  on public.hotel_reservations (hotel_id, check_in);
create index if not exists hotel_reservations_status_idx
  on public.hotel_reservations (status);

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

create or replace function app_private.set_hotel_reservation_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric(12, 2);
  v_currency text;
  v_room_status text;
  v_hotel_name text;
  v_room_number text;
  v_room_type text;
begin
  select r.nightly_rate, r.currency, r.status,
         h.name, r.room_number, r.room_type
    into v_rate, v_currency, v_room_status,
         v_hotel_name, v_room_number, v_room_type
  from public.hotel_rooms r
  join public.hotels h on h.id = r.hotel_id
  where r.id = new.room_id
    and r.hotel_id = new.hotel_id;

  if not found then
    raise exception 'room does not belong to the selected hotel'
      using errcode = '23503';
  end if;

  if v_room_status <> 'available' then
    raise exception 'room is not available for booking'
      using errcode = '23514';
  end if;

  new.hotel_name := v_hotel_name;
  new.room_number := v_room_number;
  new.room_type := v_room_type;
  new.total_amount := v_rate * (new.check_out - new.check_in);
  new.currency := v_currency;
  return new;
end;
$$;

create or replace function app_private.decide_hotel_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'reservation is already decided'
        using errcode = '23514';
    end if;
    if new.status not in ('confirmed', 'rejected', 'cancelled') then
      raise exception 'status must be confirmed, rejected, or cancelled'
        using errcode = '23514';
    end if;
    new.decided_at := now();
    new.decided_by_firebase_uid := app_private.current_firebase_uid();
  else
    new.decided_at := old.decided_at;
    new.decided_by_firebase_uid := old.decided_by_firebase_uid;
  end if;
  return new;
end;
$$;

revoke all on function app_private.set_hotel_reservation_amount()
  from public, anon, authenticated;
revoke all on function app_private.decide_hotel_reservation()
  from public, anon, authenticated;

drop trigger if exists hotels_touch_updated_at on public.hotels;
create trigger hotels_touch_updated_at
before update on public.hotels
for each row execute function app_private.touch_updated_at();

drop trigger if exists hotel_rooms_touch_updated_at on public.hotel_rooms;
create trigger hotel_rooms_touch_updated_at
before update on public.hotel_rooms
for each row execute function app_private.touch_updated_at();

drop trigger if exists hotel_reservations_touch_updated_at
  on public.hotel_reservations;
create trigger hotel_reservations_touch_updated_at
before update on public.hotel_reservations
for each row execute function app_private.touch_updated_at();

drop trigger if exists hotel_reservations_set_amount
  on public.hotel_reservations;
create trigger hotel_reservations_set_amount
before insert or update of room_id, hotel_id, check_in, check_out
on public.hotel_reservations
for each row execute function app_private.set_hotel_reservation_amount();

drop trigger if exists hotel_reservations_decide
  on public.hotel_reservations;
create trigger hotel_reservations_decide
before update on public.hotel_reservations
for each row execute function app_private.decide_hotel_reservation();

-- ---------------------------------------------------------------------------
-- 6. RLS and grants
-- ---------------------------------------------------------------------------

alter table public.hotels enable row level security;
alter table public.hotel_rooms enable row level security;
alter table public.hotel_reservations enable row level security;

revoke all on table public.hotels from public, anon, authenticated;
revoke all on table public.hotel_rooms from public, anon, authenticated;
revoke all on table public.hotel_reservations from public, anon, authenticated;

grant all on table public.hotels to service_role;
grant all on table public.hotel_rooms to service_role;
grant all on table public.hotel_reservations to service_role;

grant select (
  id, name, description, address, city, phone, latitude, longitude,
  star_rating, image_urls, status, created_at, updated_at
) on table public.hotels to authenticated;

grant insert (
  name, description, address, city, phone, latitude, longitude,
  star_rating, image_urls, status
) on table public.hotels to authenticated;

grant update (
  name, description, address, city, phone, latitude, longitude,
  star_rating, image_urls, status
) on table public.hotels to authenticated;

grant select on table public.hotel_rooms to authenticated;
grant insert (
  hotel_id, room_number, room_type, capacity, nightly_rate, currency, status
) on table public.hotel_rooms to authenticated;
grant update (
  hotel_id, room_number, room_type, capacity, nightly_rate, currency, status
) on table public.hotel_rooms to authenticated;

grant select (
  id, booking_code, hotel_id, room_id, hotel_name, room_number, room_type,
  guest_name, guest_phone, check_in, check_out, guests, total_amount,
  currency, status, decided_at, created_at, updated_at
) on table public.hotel_reservations to authenticated;

grant insert (
  hotel_id, room_id, guest_name, guest_phone, check_in, check_out, guests
) on table public.hotel_reservations to authenticated;

grant update (status) on table public.hotel_reservations to authenticated;

drop policy if exists hotels_select on public.hotels;
create policy hotels_select
on public.hotels
for select
to authenticated
using (
  app_private.is_active_user()
  and (
    status = 'published'
    or owner_firebase_uid = app_private.current_firebase_uid()
    or app_private.is_hotel_staff()
    or app_private.is_tourism_staff()
  )
);

drop policy if exists hotels_insert on public.hotels;
create policy hotels_insert
on public.hotels
for insert
to authenticated
with check (
  app_private.is_hotel_staff()
  and owner_firebase_uid = app_private.current_firebase_uid()
);

drop policy if exists hotels_update on public.hotels;
create policy hotels_update
on public.hotels
for update
to authenticated
using (
  owner_firebase_uid = app_private.current_firebase_uid()
  or app_private.is_hotel_staff()
)
with check (
  owner_firebase_uid = app_private.current_firebase_uid()
  or app_private.is_hotel_staff()
);

drop policy if exists hotel_rooms_select on public.hotel_rooms;
create policy hotel_rooms_select
on public.hotel_rooms
for select
to authenticated
using (
  app_private.is_active_user()
  and app_private.can_read_hotel(hotel_id)
);

drop policy if exists hotel_rooms_insert on public.hotel_rooms;
create policy hotel_rooms_insert
on public.hotel_rooms
for insert
to authenticated
with check (app_private.can_manage_hotel(hotel_id));

drop policy if exists hotel_rooms_update on public.hotel_rooms;
create policy hotel_rooms_update
on public.hotel_rooms
for update
to authenticated
using (app_private.can_manage_hotel(hotel_id))
with check (app_private.can_manage_hotel(hotel_id));

drop policy if exists hotel_reservations_select
  on public.hotel_reservations;
create policy hotel_reservations_select
on public.hotel_reservations
for select
to authenticated
using (
  guest_firebase_uid = app_private.current_firebase_uid()
  or app_private.can_manage_hotel(hotel_id)
);

drop policy if exists hotel_reservations_insert
  on public.hotel_reservations;
create policy hotel_reservations_insert
on public.hotel_reservations
for insert
to authenticated
with check (
  guest_firebase_uid = app_private.current_firebase_uid()
  and status = 'pending'
  and decided_at is null
  and decided_by_firebase_uid is null
  and app_private.can_read_hotel(hotel_id)
);

drop policy if exists hotel_reservations_update_staff
  on public.hotel_reservations;
create policy hotel_reservations_update_staff
on public.hotel_reservations
for update
to authenticated
using (app_private.can_manage_hotel(hotel_id))
with check (app_private.can_manage_hotel(hotel_id));

-- No DELETE policies: physical deletion is denied to every client role.

-- ---------------------------------------------------------------------------
-- 7. tourist_sites staff writes
-- ---------------------------------------------------------------------------
-- The live table only had a public SELECT policy and an INSERT policy keyed
-- on the JWT role `admin`, which Firebase tokens never carry. Add staff-scoped
-- policies without dropping the existing ones; permissive policies OR.

drop policy if exists tourist_sites_insert_staff on public.tourist_sites;
create policy tourist_sites_insert_staff
on public.tourist_sites
for insert
to authenticated
with check (app_private.is_tourism_staff());

drop policy if exists tourist_sites_update_staff on public.tourist_sites;
create policy tourist_sites_update_staff
on public.tourist_sites
for update
to authenticated
using (app_private.is_tourism_staff())
with check (app_private.is_tourism_staff());

drop policy if exists tourist_sites_delete_staff on public.tourist_sites;
create policy tourist_sites_delete_staff
on public.tourist_sites
for delete
to authenticated
using (app_private.is_tourism_staff());

grant delete on table public.tourist_sites to authenticated;

drop trigger if exists tourist_sites_touch_updated_at on public.tourist_sites;
create trigger tourist_sites_touch_updated_at
before update on public.tourist_sites
for each row execute function app_private.touch_updated_at();

commit;

notify pgrst, 'reload schema';
