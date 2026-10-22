import { NextResponse } from 'next/server';
import { requireStationUser } from '@/lib/station/server';

export async function GET(request: Request) {
  const authorization = await requireStationUser(request);
  if (!authorization.ok) return authorization.response;

  const { data, error } = await authorization.db
    .from('st_stations')
    .select('id, name, name_am, lat, lng')
    .eq('active', true)
    .order('name');

  if (error) {
    return NextResponse.json({ error: 'Unable to load stations' }, { status: 503 });
  }

  return NextResponse.json({ stations: data ?? [] });
}