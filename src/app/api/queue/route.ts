import { NextResponse } from 'next/server';
import { requireStationUser } from '@/lib/station/server';

const VEHICLE_TYPES = ['taxi', 'bajaj', 'minibus'] as const;

export async function GET(request: Request) {
  const authorization = await requireStationUser(request);
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  const stationId = url.searchParams.get('stationId');
  const vehicleId = url.searchParams.get('vehicleId');
  if (!stationId) return NextResponse.json({ error: 'stationId is required' }, { status: 400 });

  let myEntry: {
    queueId: string;
    vehicleId: string;
    vehicleType: string;
    checkedInAt: string;
    position: number;
  } | null = null;
  if (vehicleId) {
    const { data: assignment, error: assignmentError } = await authorization.db
      .from('drivers')
      .select('id')
      .eq('user_id', authorization.caller.uid)
      .eq('vehicle_id', vehicleId)
      .limit(1)
      .maybeSingle();
    if (assignmentError) {
      return NextResponse.json({ error: 'Unable to verify the assigned vehicle' }, { status: 503 });
    }
    if (!assignment) {
      return NextResponse.json({ error: 'Vehicle is not assigned to you' }, { status: 403 });
    }
    const { data: ownEntries, error: ownError } = await authorization.db
      .from('st_queue')
      .select('id, vehicle_id, vehicle_type, checked_in_at')
      .eq('station_id', stationId)
      .eq('vehicle_id', vehicleId)
      .eq('status', 'waiting')
      .order('checked_in_at')
      .order('id')
      .limit(1);
    if (ownError) return NextResponse.json({ error: 'Unable to load your queue entry' }, { status: 503 });
    const ownEntry = ownEntries?.[0];
    if (ownEntry) {
      const { count, error: positionError } = await authorization.db
        .from('st_queue')
        .select('id', { count: 'exact', head: true })
        .eq('station_id', stationId)
        .eq('status', 'waiting')
        .lte('checked_in_at', ownEntry.checked_in_at);
      if (positionError) {
        return NextResponse.json({ error: 'Unable to load your queue position' }, { status: 503 });
      }
      myEntry = {
        queueId: ownEntry.id,
        vehicleId: ownEntry.vehicle_id,
        vehicleType: ownEntry.vehicle_type,
        checkedInAt: ownEntry.checked_in_at,
        position: Math.max(count ?? 1, 1),
      };
    }
  }

  const { data: entries, error } = await authorization.db
    .from('st_queue')
    .select('id, vehicle_id, vehicle_type, checked_in_at')
    .eq('station_id', stationId)
    .eq('status', 'waiting')
    .order('checked_in_at')
    .order('id')
    .limit(100);
  if (error) return NextResponse.json({ error: 'Unable to load queue' }, { status: 503 });

  const vehicleIds = [...new Set((entries ?? []).map((entry) => entry.vehicle_id))];
  const { data: vehicles, error: vehiclesError } = vehicleIds.length
    ? await authorization.db
        .from('vehicles')
        .select('id, registration_number')
        .in('id', vehicleIds)
    : { data: [], error: null };
  if (vehiclesError) return NextResponse.json({ error: 'Unable to load queue vehicles' }, { status: 503 });

  const registrations = new Map((vehicles ?? []).map((vehicle) => [vehicle.id, vehicle.registration_number]));
  const counts = Object.fromEntries(VEHICLE_TYPES.map((type) => [type, 0]));
  for (const entry of entries ?? []) {
    if (entry.vehicle_type in counts) counts[entry.vehicle_type as keyof typeof counts] += 1;
  }

  return NextResponse.json({
    stationId,
    counts,
    myEntry,
    nextWaitingVehicles: (entries ?? []).slice(0, 10).map((entry) => ({
      queueId: entry.id,
      vehicleId: entry.vehicle_id,
      registrationNumber: registrations.get(entry.vehicle_id) ?? null,
      vehicleType: entry.vehicle_type,
      checkedInAt: entry.checked_in_at,
    })),
  });
}