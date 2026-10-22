-- Station ticketing schema. This file is intentionally not applied by the app.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS st_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_am text,
  lat double precision,
  lng double precision,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT st_stations_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS st_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_station_id uuid NOT NULL REFERENCES st_stations(id),
  to_station_id uuid NOT NULL REFERENCES st_stations(id),
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT st_routes_distinct_stations CHECK (from_station_id <> to_station_id),
  CONSTRAINT st_routes_station_pair_unique UNIQUE (from_station_id, to_station_id)
);

CREATE TABLE IF NOT EXISTS st_tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES st_routes(id),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('taxi', 'bajaj', 'minibus')),
  fare_etb numeric(12, 2) NOT NULL CHECK (fare_etb > 0),
  effective_from date NOT NULL,
  effective_to date,
  source_reference text NOT NULL,
  approved_by text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT st_tariffs_valid_period CHECK (effective_to IS NULL OR effective_to > effective_from)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'st_tariffs_no_overlapping_periods'
      AND conrelid = 'st_tariffs'::regclass
  ) THEN
    ALTER TABLE st_tariffs
      ADD CONSTRAINT st_tariffs_no_overlapping_periods
      EXCLUDE USING gist (
        route_id WITH =,
        vehicle_type WITH =,
        daterange(effective_from, effective_to, '[)') WITH &&
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION st_prevent_tariff_history_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.effective_to IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.route_id IS DISTINCT FROM OLD.route_id
    OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
    OR NEW.fare_etb IS DISTINCT FROM OLD.fare_etb
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Tariff history is immutable; only an open period may be closed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS st_tariffs_history_immutable ON st_tariffs;
CREATE TRIGGER st_tariffs_history_immutable
  BEFORE UPDATE ON st_tariffs
  FOR EACH ROW EXECUTE FUNCTION st_prevent_tariff_history_rewrite();

CREATE TABLE IF NOT EXISTS st_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES st_stations(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('taxi', 'bajaj', 'minibus')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'boarding', 'departed', 'removed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS st_queue_one_active_vehicle
  ON st_queue (vehicle_id)
  WHERE status IN ('waiting', 'boarding');
CREATE INDEX IF NOT EXISTS st_queue_fifo
  ON st_queue (station_id, vehicle_type, checked_in_at, id)
  WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS st_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  passenger_firebase_uid text NOT NULL,
  route_id uuid NOT NULL REFERENCES st_routes(id),
  tariff_id uuid NOT NULL REFERENCES st_tariffs(id),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('taxi', 'bajaj', 'minibus')),
  fare_etb numeric(12, 2) NOT NULL CHECK (fare_etb > 0),
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'used', 'expired', 'cancelled', 'refunded')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_uid text,
  verified_vehicle_id uuid REFERENCES vehicles(id)
);

CREATE INDEX IF NOT EXISTS st_tickets_passenger_issued
  ON st_tickets (passenger_firebase_uid, issued_at DESC);
CREATE INDEX IF NOT EXISTS st_tickets_status_expiry
  ON st_tickets (status, expires_at);

CREATE TABLE IF NOT EXISTS st_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES st_tickets(id),
  provider text NOT NULL,
  provider_ref text,
  amount_etb numeric(12, 2) NOT NULL CHECK (amount_etb > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  idempotency_key text NOT NULL UNIQUE,
  raw_callback jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS st_payments_provider_ref_unique
  ON st_payments (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS st_payments_ticket_created
  ON st_payments (ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS st_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS st_audit_entity_at
  ON st_audit (entity, entity_id, at DESC);

ALTER TABLE st_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS st_service_role_all ON st_stations;
CREATE POLICY st_service_role_all ON st_stations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS st_service_role_all ON st_routes;
CREATE POLICY st_service_role_all ON st_routes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS st_service_role_all ON st_tariffs;
CREATE POLICY st_service_role_all ON st_tariffs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS st_service_role_all ON st_queue;
CREATE POLICY st_service_role_all ON st_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS st_service_role_all ON st_tickets;
CREATE POLICY st_service_role_all ON st_tickets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS st_service_role_all ON st_payments;
CREATE POLICY st_service_role_all ON st_payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS st_service_role_all ON st_audit;
CREATE POLICY st_service_role_all ON st_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);
