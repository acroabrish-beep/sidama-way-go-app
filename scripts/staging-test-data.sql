-- ============================================================================
-- TEST ONLY - STAGING DATABASE ONLY - NEVER RUN IN PRODUCTION
-- ============================================================================
-- This is NOT a migration. It inserts clearly labelled fake-looking test data
-- into a separate staging Supabase project so operators can exercise the
-- station ticket flow before real city data is imported.
--
-- It creates:
--   * 2 stations (names prefixed TEST ONLY)
--   * 1 route pair (Station A -> Station B)
--   * 3 tariff rows (taxi, bajaj, minibus) with source_reference 'TEST ONLY'
--
-- Every value is test data. None of it may be copied into production or used
-- as an official tariff. Apply the st_ migrations to staging first.
--
-- Re-running is intended to be safe: stations/routes are upserted by their
-- natural keys and TEST ONLY tariffs are skipped when they already exist.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  station_a uuid;
  station_b uuid;
  route_ab uuid;
BEGIN
  INSERT INTO st_stations (name, name_am, lat, lng, active)
  VALUES ('TEST ONLY - Staging Station A', NULL, NULL, NULL, true)
  ON CONFLICT (name) DO UPDATE SET active = true
  RETURNING id INTO station_a;

  INSERT INTO st_stations (name, name_am, lat, lng, active)
  VALUES ('TEST ONLY - Staging Station B', NULL, NULL, NULL, true)
  ON CONFLICT (name) DO UPDATE SET active = true
  RETURNING id INTO station_b;

  INSERT INTO st_routes (from_station_id, to_station_id, active)
  VALUES (station_a, station_b, true)
  ON CONFLICT (from_station_id, to_station_id) DO UPDATE SET active = true
  RETURNING id INTO route_ab;

  INSERT INTO st_tariffs (
    route_id, vehicle_type, fare_etb, effective_from, effective_to,
    source_reference, approved_by, created_by
  )
  SELECT
    route_ab,
    test_tariff.vehicle_type,
    test_tariff.fare_etb,
    CURRENT_DATE,
    NULL,
    'TEST ONLY',
    'TEST ONLY - Staging Approver',
    'TEST ONLY - Staging Admin'
  FROM (
    VALUES
      ('taxi', 25.00::numeric),
      ('bajaj', 15.00::numeric),
      ('minibus', 10.00::numeric)
  ) AS test_tariff(vehicle_type, fare_etb)
  WHERE NOT EXISTS (
    SELECT 1
    FROM st_tariffs existing
    WHERE existing.route_id = route_ab
      AND existing.vehicle_type = test_tariff.vehicle_type
      AND existing.source_reference = 'TEST ONLY'
  );
END;
$$;

COMMIT;
