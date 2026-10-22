import { parse } from 'csv-parse/sync';
import { NextResponse } from 'next/server';
import { writeStationAudit } from '@/lib/station/audit';
import { requireStationUser, STATION_ADMIN_ROLES } from '@/lib/station/server';

type CsvRow = Record<string, string>;
type StationRow = { name: string; name_am: string | null; lat: number | null; lng: number | null };
type RouteRow = { from_station: string; to_station: string };
type TariffRow = {
  from_station: string;
  to_station: string;
  vehicle_type: string;
  fare_etb: number;
  effective_from: string;
  effective_to: string;
  source_reference: string;
  approved_by: string;
};

const VEHICLE_TYPES = new Set(['taxi', 'bajaj', 'minibus']);
const MAX_CSV_BYTES = 2 * 1024 * 1024;

function parseRows(
  name: string,
  source: unknown,
  requiredHeaders: readonly string[],
  errors: string[],
): CsvRow[] {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_CSV_BYTES) {
    errors.push(`${name}: CSV is missing or exceeds the 2 MB limit`);
    return [];
  }
  try {
    const rows = parse(source, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    }) as CsvRow[];
    if (!rows.length) errors.push(`${name}: no rows found`);
    const headers = Object.keys(rows[0] ?? {});
    for (const header of requiredHeaders) {
      if (!headers.includes(header)) errors.push(`${name}: required column '${header}' is missing`);
    }
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid CSV syntax';
    errors.push(`${name}: ${message}`);
    return [];
  }
}

function parseOptionalNumber(value: string | undefined, min: number, max: number): number | null | undefined {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function routeKey(from: string, to: string): string {
  return `${from.trim().toLocaleLowerCase()}\u0000${to.trim().toLocaleLowerCase()}`;
}

function overlaps(startA: string, endA: string | null, startB: string, endB: string | null): boolean {
  return (!endA || startB < endA) && (!endB || startA < endB);
}

export async function POST(request: Request) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;

  if (Number(request.headers.get('content-length') ?? 0) > 7 * MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'Import request exceeds the size limit' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    throw error;
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Import payload is required' }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  const commit = values.commit === true;
  const errors: string[] = [];
  const stationRows = parseRows('stations', values.stationsCsv, ['name'], errors);
  const routeRows = parseRows('routes', values.routesCsv, ['from_station', 'to_station'], errors);
  const tariffRows = parseRows(
    'tariffs',
    values.tariffsCsv,
    ['from_station', 'to_station', 'vehicle_type', 'fare_etb', 'effective_from', 'effective_to', 'source_reference', 'approved_by'],
    errors,
  );

  const stations: StationRow[] = [];
  const seenStationNames = new Set<string>();
  for (const [index, row] of stationRows.entries()) {
    const name = row.name?.trim();
    if (!name) {
      errors.push(`stations row ${index + 2}: name is required`);
      continue;
    }
    const key = name.toLocaleLowerCase();
    if (seenStationNames.has(key)) errors.push(`stations row ${index + 2}: duplicate station name '${name}'`);
    seenStationNames.add(key);
    const lat = parseOptionalNumber(row.lat, -90, 90);
    const lng = parseOptionalNumber(row.lng, -180, 180);
    if (lat === undefined || lng === undefined) {
      errors.push(`stations row ${index + 2}: latitude/longitude is outside its valid range`);
      continue;
    }
    stations.push({ name, name_am: row.name_am?.trim() || null, lat, lng });
  }

  const routes: RouteRow[] = [];
  const seenRoutes = new Set<string>();
  for (const [index, row] of routeRows.entries()) {
    const from = row.from_station?.trim();
    const to = row.to_station?.trim();
    if (!from || !to || from.toLocaleLowerCase() === to.toLocaleLowerCase()) {
      errors.push(`routes row ${index + 2}: distinct from_station and to_station are required`);
      continue;
    }
    const key = routeKey(from, to);
    if (seenRoutes.has(key)) errors.push(`routes row ${index + 2}: duplicate route '${from} -> ${to}'`);
    seenRoutes.add(key);
    routes.push({ from_station: from, to_station: to });
  }

  const tariffs: TariffRow[] = [];
  const tariffGroups = new Map<string, Array<{ start: string; end: string | null }>>();
  for (const [index, row] of tariffRows.entries()) {
    const from = row.from_station?.trim();
    const to = row.to_station?.trim();
    const fareEtb = Number(row.fare_etb);
    const start = row.effective_from?.trim();
    const end = row.effective_to?.trim() ?? '';
    if (!from || !to || !VEHICLE_TYPES.has(row.vehicle_type)) {
      errors.push(`tariffs row ${index + 2}: route stations and a supported vehicle_type are required`);
      continue;
    }
    if (!Number.isFinite(fareEtb) || fareEtb <= 0) {
      errors.push(`tariffs row ${index + 2}: fare_etb must be greater than zero`);
      continue;
    }
    if (!isIsoDate(start) || (end && (!isIsoDate(end) || end <= start))) {
      errors.push(`tariffs row ${index + 2}: invalid effective date range`);
      continue;
    }
    if (!row.source_reference?.trim()) {
      errors.push(`tariffs row ${index + 2}: source_reference is required`);
      continue;
    }
    if (!row.approved_by?.trim()) {
      errors.push(`tariffs row ${index + 2}: approved_by (approving authority) is required`);
      continue;
    }
    const key = `${routeKey(from, to)}\u0000${row.vehicle_type}`;
    const periods = tariffGroups.get(key) ?? [];
    if (periods.some((period) => overlaps(start, end || null, period.start, period.end))) {
      errors.push(`tariffs row ${index + 2}: date range overlaps another imported tariff`);
    }
    periods.push({ start, end: end || null });
    tariffGroups.set(key, periods);
    tariffs.push({
      from_station: from,
      to_station: to,
      vehicle_type: row.vehicle_type,
      fare_etb: fareEtb,
      effective_from: start,
      effective_to: end,
      source_reference: row.source_reference.trim(),
      approved_by: row.approved_by.trim(),
    });
  }

  const { data: existingStations, error: stationError } = await authorization.db
    .from('st_stations')
    .select('id, name');
  if (stationError) return NextResponse.json({ error: 'Unable to validate existing stations' }, { status: 503 });
  const allStationNames = new Set([
    ...(existingStations ?? []).map((station) => station.name.toLocaleLowerCase()),
    ...stations.map((station) => station.name.toLocaleLowerCase()),
  ]);
  for (const [index, route] of routes.entries()) {
    if (!allStationNames.has(route.from_station.toLocaleLowerCase()) || !allStationNames.has(route.to_station.toLocaleLowerCase())) {
      errors.push(`routes row ${index + 2}: station name does not exist in the import or catalog`);
    }
  }

  const { data: existingRoutes, error: routeError } = await authorization.db
    .from('st_routes')
    .select('id, from_station_id, to_station_id');
  if (routeError) return NextResponse.json({ error: 'Unable to validate existing routes' }, { status: 503 });
  const stationNamesById = new Map((existingStations ?? []).map((station) => [station.id, station.name.toLocaleLowerCase()]));
  const existingRouteIds = new Map<string, string>();
  for (const route of existingRoutes ?? []) {
    const from = stationNamesById.get(route.from_station_id);
    const to = stationNamesById.get(route.to_station_id);
    if (from && to) existingRouteIds.set(routeKey(from, to), route.id);
  }
  const availableRouteKeys = new Set([...existingRouteIds.keys(), ...routes.map((route) => routeKey(route.from_station, route.to_station))]);
  for (const [index, tariff] of tariffs.entries()) {
    if (!availableRouteKeys.has(routeKey(tariff.from_station, tariff.to_station))) {
      errors.push(`tariffs row ${index + 2}: route does not exist in the import or catalog`);
    }
  }

  const { data: existingTariffs, error: tariffsError } = await authorization.db
    .from('st_tariffs')
    .select('route_id, vehicle_type, effective_from, effective_to');
  if (tariffsError) return NextResponse.json({ error: 'Unable to validate existing tariffs' }, { status: 503 });
  for (const tariff of tariffs) {
    const routeId = existingRouteIds.get(routeKey(tariff.from_station, tariff.to_station));
    if (!routeId) continue;
    const key = `${routeKey(tariff.from_station, tariff.to_station)}\u0000${tariff.vehicle_type}`;
    const imported = tariffGroups.get(key) ?? [];
    const currentPeriod = imported.find((period) => period.start === tariff.effective_from && period.end === (tariff.effective_to || null));
    const overlapsExisting = (existingTariffs ?? []).some((existing) =>
      existing.route_id === routeId &&
      existing.vehicle_type === tariff.vehicle_type &&
      currentPeriod !== undefined &&
      overlaps(currentPeriod.start, currentPeriod.end, existing.effective_from, existing.effective_to),
    );
    if (overlapsExisting) errors.push(`tariffs: imported period overlaps existing history for '${tariff.from_station} -> ${tariff.to_station}'`);
  }

  try {
    await writeStationAudit(
      authorization.db,
      authorization.caller.uid,
      commit ? 'catalog_import_requested' : 'catalog_import_previewed',
      'catalog_import',
      'pending',
      { stationRows: stations.length, routeRows: routes.length, tariffRows: tariffs.length, valid: errors.length === 0 },
    );
  } catch {
    return NextResponse.json({ error: 'Unable to record catalog import audit event' }, { status: 503 });
  }

  if (errors.length) {
    return NextResponse.json({ valid: false, committed: false, errors }, { status: 422 });
  }

  if (!commit) {
    return NextResponse.json({
      valid: true,
      committed: false,
      preview: { stations, routes, tariffs },
      summary: { stations: stations.length, routes: routes.length, tariffs: tariffs.length },
    });
  }

  const { data, error } = await authorization.db.rpc('st_import_catalog', {
    p_stations: stations,
    p_routes: routes,
    p_tariffs: tariffs,
    p_actor_uid: authorization.caller.uid,
  });
  if (error) {
    return NextResponse.json({ error: 'Catalog import rolled back; no catalog rows were committed' }, { status: 409 });
  }
  return NextResponse.json({ valid: true, committed: true, result: data });
}