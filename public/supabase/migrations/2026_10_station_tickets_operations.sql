CREATE TABLE IF NOT EXISTS st_rate_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0)
);

ALTER TABLE st_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS st_service_role_all ON st_rate_limits;
CREATE POLICY st_service_role_all ON st_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION st_consume_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  current_hits integer;
BEGIN
  INSERT INTO st_rate_limits (key_hash, window_started_at, hits)
  VALUES (p_key_hash, now(), 1)
  ON CONFLICT (key_hash) DO UPDATE
  SET window_started_at = CASE
        WHEN st_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now()
          THEN now()
        ELSE st_rate_limits.window_started_at
      END,
      hits = CASE
        WHEN st_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now()
          THEN 1
        ELSE st_rate_limits.hits + 1
      END
  RETURNING hits INTO current_hits;

  RETURN current_hits <= p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION st_create_tariff_version(
  p_route_id uuid,
  p_vehicle_type text,
  p_fare_etb numeric,
  p_effective_from date,
  p_source_reference text,
  p_approved_by text,
  p_created_by text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  previous_tariff st_tariffs%ROWTYPE;
  created_tariff_id uuid;
BEGIN
  IF p_fare_etb <= 0 OR btrim(p_source_reference) = '' OR btrim(p_approved_by) = '' THEN
    RAISE EXCEPTION 'Fare, source reference, and approving authority are required';
  END IF;
  IF btrim(COALESCE(p_created_by, '')) = '' THEN
    RAISE EXCEPTION 'Tariff creator is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_route_id::text || ':' || p_vehicle_type));

  SELECT * INTO previous_tariff
  FROM st_tariffs
  WHERE route_id = p_route_id
    AND vehicle_type = p_vehicle_type
    AND effective_to IS NULL
  ORDER BY effective_from DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF p_effective_from <= previous_tariff.effective_from THEN
      RAISE EXCEPTION 'New tariff must start after the current tariff';
    END IF;
    UPDATE st_tariffs
    SET effective_to = p_effective_from
    WHERE id = previous_tariff.id;
  END IF;

  INSERT INTO st_tariffs (
    route_id, vehicle_type, fare_etb, effective_from, source_reference,
    approved_by, created_by
  ) VALUES (
    p_route_id, p_vehicle_type, p_fare_etb, p_effective_from,
    btrim(p_source_reference), btrim(p_approved_by), p_created_by
  )
  RETURNING id INTO created_tariff_id;

  INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
  VALUES (
    p_created_by,
    'tariff_version_created',
    'tariff',
    created_tariff_id::text,
    jsonb_build_object('route_id', p_route_id, 'vehicle_type', p_vehicle_type)
  );

  RETURN created_tariff_id;
END;
$$;

CREATE OR REPLACE FUNCTION st_queue_check_in(
  p_station_id uuid,
  p_vehicle_id uuid,
  p_vehicle_type text,
  p_actor_uid text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  queue_entry_id uuid;
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE firebase_uid = p_actor_uid;
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM drivers
    JOIN vehicles ON vehicles.id = drivers.vehicle_id
    WHERE drivers.user_id = v_user_id
      AND drivers.vehicle_id = p_vehicle_id
      AND vehicles.vehicle_type = p_vehicle_type
  ) THEN
    RAISE EXCEPTION 'Vehicle is not assigned to this driver';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM st_stations WHERE id = p_station_id AND active = true) THEN
    RAISE EXCEPTION 'Station is not active';
  END IF;

  INSERT INTO st_queue (station_id, vehicle_id, vehicle_type)
  VALUES (p_station_id, p_vehicle_id, p_vehicle_type)
  RETURNING id INTO queue_entry_id;

  INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
  VALUES (
    p_actor_uid,
    'queue_check_in',
    'queue',
    queue_entry_id::text,
    jsonb_build_object('station_id', p_station_id, 'vehicle_id', p_vehicle_id)
  );

  RETURN queue_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION st_queue_check_out(
  p_vehicle_id uuid,
  p_actor_uid text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  queue_entry st_queue%ROWTYPE;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE firebase_uid = p_actor_uid;
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM drivers WHERE drivers.user_id = v_user_id AND vehicle_id = p_vehicle_id
  ) THEN
    RAISE EXCEPTION 'Vehicle is not assigned to this driver';
  END IF;

  SELECT * INTO queue_entry FROM st_queue
  WHERE vehicle_id = p_vehicle_id AND status IN ('waiting', 'boarding')
  ORDER BY checked_in_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE st_queue SET status = 'removed' WHERE id = queue_entry.id;
  INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
  VALUES (
    p_actor_uid,
    'queue_check_out',
    'queue',
    queue_entry.id::text,
    jsonb_build_object('vehicle_id', p_vehicle_id)
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION st_apply_payment_event(
  p_ticket_id uuid,
  p_provider text,
  p_provider_ref text,
  p_amount_etb numeric,
  p_status text,
  p_raw_callback jsonb
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  payment st_payments%ROWTYPE;
  ticket st_tickets%ROWTYPE;
BEGIN
  IF p_status NOT IN ('paid', 'failed') THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_invalid',
      'ticket',
      p_ticket_id::text,
      jsonb_build_object('reason', 'unsupported_status')
    );
    RETURN 'invalid';
  END IF;

  -- A processed payment is identified by the provider reference. Pending
  -- payments intentionally have a NULL provider reference so the first
  -- verified callback is not mistaken for a replay.
  SELECT * INTO payment FROM st_payments
  WHERE provider = p_provider AND provider_ref = p_provider_ref
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_already_processed',
      'ticket',
      payment.ticket_id::text,
      jsonb_build_object('provider_ref', p_provider_ref)
    );
    RETURN 'already_processed';
  END IF;

  SELECT * INTO payment FROM st_payments
  WHERE ticket_id = p_ticket_id AND provider = p_provider AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_invalid',
      'ticket',
      p_ticket_id::text,
      jsonb_build_object('reason', 'no_pending_payment')
    );
    RETURN 'invalid';
  END IF;

  IF payment.amount_etb <> p_amount_etb THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_amount_mismatch',
      'ticket',
      p_ticket_id::text,
      jsonb_build_object(
        'expected_amount_etb', payment.amount_etb,
        'received_amount_etb', p_amount_etb,
        'provider_ref', p_provider_ref
      )
    );
    RETURN 'amount_mismatch';
  END IF;

  SELECT * INTO ticket FROM st_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_invalid',
      'ticket',
      p_ticket_id::text,
      jsonb_build_object('reason', 'ticket_not_found')
    );
    RETURN 'invalid';
  END IF;

  IF ticket.fare_etb <> p_amount_etb THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_amount_mismatch',
      'ticket',
      ticket.id::text,
      jsonb_build_object(
        'expected_amount_etb', ticket.fare_etb,
        'received_amount_etb', p_amount_etb,
        'provider_ref', p_provider_ref
      )
    );
    RETURN 'amount_mismatch';
  END IF;

  IF ticket.status <> 'pending_payment' THEN
    IF ticket.status = 'paid' THEN
      INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
      VALUES (
        'payment:' || p_provider,
        'payment_already_processed',
        'ticket',
        ticket.id::text,
        jsonb_build_object('provider_ref', p_provider_ref, 'ticket_status', ticket.status)
      );
      RETURN 'already_processed';
    END IF;
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_invalid',
      'ticket',
      ticket.id::text,
      jsonb_build_object('reason', 'ticket_status', 'ticket_status', ticket.status)
    );
    RETURN 'invalid';
  END IF;

  IF ticket.expires_at <= now() THEN
    UPDATE st_tickets SET status = 'expired' WHERE id = ticket.id;
    UPDATE st_payments
    SET provider_ref = p_provider_ref, status = 'failed', raw_callback = p_raw_callback,
        verified_at = now()
    WHERE id = payment.id;
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_expired',
      'ticket',
      ticket.id::text,
      jsonb_build_object('provider_ref', p_provider_ref)
    );
    RETURN 'expired';
  END IF;

  UPDATE st_payments
  SET provider_ref = p_provider_ref,
      status = p_status,
      raw_callback = p_raw_callback,
      verified_at = now()
  WHERE id = payment.id;

  IF p_status = 'failed' THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      'payment:' || p_provider,
      'payment_failed',
      'ticket',
      ticket.id::text,
      jsonb_build_object('provider_ref', p_provider_ref)
    );
    RETURN 'failed';
  END IF;

  -- Paid tickets remain valid beyond the 15-minute payment window. The
  -- vehicle is still bound only when the driver scans the ticket.
  UPDATE st_tickets
  SET status = 'paid',
      expires_at = GREATEST(expires_at, now() + interval '24 hours')
  WHERE id = ticket.id;

  INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
  VALUES (
    'payment:' || p_provider,
    'payment_paid',
    'ticket',
    ticket.id::text,
    jsonb_build_object('provider_ref', p_provider_ref, 'amount_etb', p_amount_etb)
  );

  RETURN 'paid';
END;
$$;

CREATE OR REPLACE FUNCTION st_verify_ticket_once(
  p_ticket_id uuid,
  p_actor_uid text,
  p_vehicle_id uuid
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ticket st_tickets%ROWTYPE;
  v_user_id uuid;
  v_vehicle_type text;
BEGIN
  SELECT * INTO ticket FROM st_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (p_actor_uid, 'ticket_verify_invalid', 'ticket', p_ticket_id::text, '{}'::jsonb);
    RETURN 'invalid';
  END IF;

  IF ticket.status = 'used' THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (p_actor_uid, 'ticket_verify_already_used', 'ticket', ticket.id::text, '{}'::jsonb);
    RETURN 'already_used';
  END IF;

  IF ticket.status = 'expired' OR ticket.expires_at <= now() THEN
    UPDATE st_tickets SET status = 'expired' WHERE id = ticket.id;
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (p_actor_uid, 'ticket_verify_expired', 'ticket', ticket.id::text, '{}'::jsonb);
    RETURN 'expired';
  END IF;

  IF ticket.status <> 'paid' THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (p_actor_uid, 'ticket_verify_invalid', 'ticket', ticket.id::text, '{}'::jsonb);
    RETURN 'invalid';
  END IF;

  SELECT id INTO v_user_id FROM users WHERE firebase_uid = p_actor_uid;
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM drivers WHERE drivers.user_id = v_user_id AND vehicle_id = p_vehicle_id
  ) THEN
    RAISE EXCEPTION 'Vehicle is not assigned to this driver';
  END IF;

  SELECT vehicle_type INTO v_vehicle_type FROM vehicles WHERE id = p_vehicle_id;
  IF v_vehicle_type IS NULL OR v_vehicle_type <> ticket.vehicle_type THEN
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      p_actor_uid,
      'ticket_verify_wrong_vehicle_type',
      'ticket',
      ticket.id::text,
      jsonb_build_object(
        'ticket_vehicle_type', ticket.vehicle_type,
        'vehicle_type', v_vehicle_type
      )
    );
    RETURN 'invalid';
  END IF;

  UPDATE st_tickets
  SET status = 'used', used_at = now(), used_by_uid = p_actor_uid,
      verified_vehicle_id = p_vehicle_id
  WHERE id = ticket.id;
  INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
  VALUES (
    p_actor_uid,
    'ticket_verify_valid',
    'ticket',
    ticket.id::text,
    jsonb_build_object('vehicle_id', p_vehicle_id)
  );
  RETURN 'valid';
END;
$$;

CREATE OR REPLACE FUNCTION st_import_catalog(
  p_stations jsonb,
  p_routes jsonb,
  p_tariffs jsonb,
  p_actor_uid text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  station_row jsonb;
  route_row jsonb;
  tariff_row jsonb;
  from_station uuid;
  to_station uuid;
  route_identifier uuid;
  tariff_identifier uuid;
  station_count integer := 0;
  route_count integer := 0;
  tariff_count integer := 0;
BEGIN
  IF jsonb_typeof(p_stations) <> 'array'
    OR jsonb_typeof(p_routes) <> 'array'
    OR jsonb_typeof(p_tariffs) <> 'array'
  THEN
    RAISE EXCEPTION 'Catalog import payload must contain arrays';
  END IF;

  FOR station_row IN SELECT value FROM jsonb_array_elements(p_stations)
  LOOP
    SELECT id INTO from_station FROM st_stations
    WHERE name = station_row->>'name'
    ORDER BY id
    LIMIT 1;
    IF from_station IS NULL THEN
      INSERT INTO st_stations (name, name_am, lat, lng, active)
      VALUES (
        station_row->>'name',
        NULLIF(station_row->>'name_am', ''),
        NULLIF(station_row->>'lat', '')::double precision,
        NULLIF(station_row->>'lng', '')::double precision,
        true
      )
      RETURNING id INTO from_station;
      station_count := station_count + 1;
      INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
      VALUES (p_actor_uid, 'station_imported', 'station', from_station::text, jsonb_build_object('name', station_row->>'name'));
    END IF;
    from_station := NULL;
  END LOOP;

  FOR route_row IN SELECT value FROM jsonb_array_elements(p_routes)
  LOOP
    SELECT id INTO from_station FROM st_stations WHERE name = route_row->>'from_station' ORDER BY id LIMIT 1;
    SELECT id INTO to_station FROM st_stations WHERE name = route_row->>'to_station' ORDER BY id LIMIT 1;
    IF from_station IS NULL OR to_station IS NULL THEN
      RAISE EXCEPTION 'Route references an unknown station';
    END IF;
    INSERT INTO st_routes (from_station_id, to_station_id, active)
    VALUES (from_station, to_station, true)
    ON CONFLICT (from_station_id, to_station_id) DO UPDATE SET active = true
    RETURNING id INTO route_identifier;
    route_count := route_count + 1;
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      p_actor_uid,
      'route_imported',
      'route',
      route_identifier::text,
      jsonb_build_object('from_station_id', from_station, 'to_station_id', to_station)
    );
    from_station := NULL;
    to_station := NULL;
  END LOOP;

  FOR tariff_row IN SELECT value FROM jsonb_array_elements(p_tariffs)
  LOOP
    SELECT r.id INTO route_identifier
    FROM st_routes r
    JOIN st_stations source_station ON source_station.id = r.from_station_id
    JOIN st_stations destination_station ON destination_station.id = r.to_station_id
    WHERE source_station.name = tariff_row->>'from_station'
      AND destination_station.name = tariff_row->>'to_station'
    ORDER BY r.id
    LIMIT 1;
    IF route_identifier IS NULL THEN
      RAISE EXCEPTION 'Tariff references an unknown route';
    END IF;
    IF btrim(COALESCE(tariff_row->>'source_reference', '')) = '' THEN
      RAISE EXCEPTION 'Tariff source reference is required';
    END IF;
    IF btrim(COALESCE(tariff_row->>'approved_by', '')) = '' THEN
      RAISE EXCEPTION 'Tariff approving authority is required';
    END IF;
    IF btrim(COALESCE(p_actor_uid, '')) = '' THEN
      RAISE EXCEPTION 'Tariff creator is required';
    END IF;
    INSERT INTO st_tariffs (
      route_id, vehicle_type, fare_etb, effective_from, effective_to,
      source_reference, approved_by, created_by
    ) VALUES (
      route_identifier,
      tariff_row->>'vehicle_type',
      (tariff_row->>'fare_etb')::numeric,
      (tariff_row->>'effective_from')::date,
      NULLIF(tariff_row->>'effective_to', '')::date,
      btrim(tariff_row->>'source_reference'),
      btrim(tariff_row->>'approved_by'),
      p_actor_uid
    )
    RETURNING id INTO tariff_identifier;
    tariff_count := tariff_count + 1;
    INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
    VALUES (
      p_actor_uid,
      'tariff_imported',
      'tariff',
      tariff_identifier::text,
      jsonb_build_object('route_id', route_identifier, 'vehicle_type', tariff_row->>'vehicle_type')
    );
    tariff_identifier := NULL;
    route_identifier := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'stationsCreated', station_count,
    'routesImported', route_count,
    'tariffsCreated', tariff_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION st_create_pending_ticket(
  p_code text,
  p_passenger_uid text,
  p_route_id uuid,
  p_tariff_id uuid,
  p_vehicle_type text,
  p_fare_etb numeric,
  p_expires_at timestamptz,
  p_provider text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing_payment st_payments%ROWTYPE;
  ticket_identifier uuid;
  selected_fare numeric;
BEGIN
  SELECT * INTO existing_payment
  FROM st_payments
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM st_tickets
      WHERE id = existing_payment.ticket_id
        AND passenger_firebase_uid = p_passenger_uid
    ) THEN
      RAISE EXCEPTION 'Idempotency key is not available';
    END IF;
    RETURN jsonb_build_object(
      'ticket_id', existing_payment.ticket_id,
      'payment_id', existing_payment.id,
      'provider_ref', existing_payment.provider_ref,
      'idempotency_key', p_idempotency_key,
      'idempotent_replay', true
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM st_routes WHERE id = p_route_id AND active = true
  ) THEN
    RAISE EXCEPTION 'Route is not active';
  END IF;

  SELECT fare_etb INTO selected_fare
  FROM st_tariffs
  WHERE id = p_tariff_id
    AND route_id = p_route_id
    AND vehicle_type = p_vehicle_type
    AND effective_from <= CURRENT_DATE
    AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
  FOR SHARE;
  IF selected_fare IS NULL OR selected_fare <> p_fare_etb THEN
    RAISE EXCEPTION 'Active tariff changed; request a fresh quote';
  END IF;
  IF p_expires_at <= now() OR p_expires_at > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'Invalid pending ticket expiration';
  END IF;

  INSERT INTO st_tickets (
    code, passenger_firebase_uid, route_id, tariff_id, vehicle_type,
    fare_etb, status, expires_at
  ) VALUES (
    p_code, p_passenger_uid, p_route_id, p_tariff_id, p_vehicle_type,
    selected_fare, 'pending_payment', p_expires_at
  )
  RETURNING id INTO ticket_identifier;

  INSERT INTO st_payments (
    ticket_id, provider, provider_ref, amount_etb, status, idempotency_key
  ) VALUES (
    ticket_identifier, p_provider, NULL, selected_fare, 'pending', p_idempotency_key
  )
  RETURNING id INTO existing_payment.id;

  INSERT INTO st_audit (actor_uid, action, entity, entity_id, details)
  VALUES (
    p_passenger_uid,
    'ticket_created',
    'ticket',
    ticket_identifier::text,
    jsonb_build_object('route_id', p_route_id, 'vehicle_type', p_vehicle_type, 'fare_etb', selected_fare)
  );

  RETURN jsonb_build_object(
    'ticket_id', ticket_identifier,
    'payment_id', existing_payment.id,
    'provider_ref', NULL,
    'idempotency_key', p_idempotency_key,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION st_consume_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION st_create_tariff_version(uuid, text, numeric, date, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION st_queue_check_in(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION st_queue_check_out(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION st_apply_payment_event(uuid, text, text, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION st_verify_ticket_once(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION st_import_catalog(jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION st_create_pending_ticket(text, text, uuid, uuid, text, numeric, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION st_consume_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION st_create_tariff_version(uuid, text, numeric, date, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION st_queue_check_in(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION st_queue_check_out(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION st_apply_payment_event(uuid, text, text, numeric, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION st_verify_ticket_once(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION st_import_catalog(jsonb, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION st_create_pending_ticket(text, text, uuid, uuid, text, numeric, timestamptz, text, text) TO service_role;