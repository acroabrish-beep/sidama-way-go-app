import { NextResponse } from 'next/server';
import {
  requireStationUser,
  STATION_OPERATOR_ROLES,
} from '@/lib/station/server';

const STATION_VEHICLE_TYPES = new Set(['taxi', 'bajaj', 'minibus']);

export async function GET(request: Request) {
  const authorization = await requireStationUser(
    request,
    STATION_OPERATOR_ROLES,
  );
  if (!authorization.ok) return authorization.response;

  const { data: user, error: userError } = await authorization.db
    .from('users')
    .select('id')
    .eq('firebase_uid', authorization.caller.uid)
    .maybeSingle();
  if (userError) {
    return NextResponse.json(
      { error: 'Unable to load the driver account' },
      { status: 503 },
    );
  }
  if (!user) {
    return NextResponse.json({ error: 'Driver account not found' }, { status: 403 });
  }

  const { data: assignments, error: assignmentError } = await authorization.db
    .from('drivers')
    .select('vehicle_id')
    .eq('user_id', user.id);
  if (assignmentError) {
    return NextResponse.json(
      { error: 'Unable to load driver assignments' },
      { status: 503 },
    );
  }

  const vehicleIds = [
    ...new Set(
      (assignments ?? [])
        .map((assignment) => assignment.vehicle_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  if (!vehicleIds.length) return NextResponse.json({ vehicles: [] });

  const { data: vehicles, error: vehicleError } = await authorization.db
    .from('vehicles')
    .select('id, registration_number, vehicle_type, status')
    .in('id', vehicleIds)
    .order('registration_number');
  if (vehicleError) {
    return NextResponse.json(
      { error: 'Unable to load assigned vehicles' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    vehicles: (vehicles ?? []).filter((vehicle) =>
      STATION_VEHICLE_TYPES.has(String(vehicle.vehicle_type)),
    ),
  });
}
