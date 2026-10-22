import { NextResponse } from 'next/server';
import { requireStationUser, STATION_ADMIN_ROLES } from '@/lib/station/server';

type Row = Record<string, unknown>;

async function readAllPages(
  fetchPage: (start: number, end: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const result: Row[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const page = await fetchPage(start, start + pageSize - 1);
    if (page.error) throw new Error('Station metrics query failed');
    const rows = page.data ?? [];
    result.push(...rows);
    if (rows.length < pageSize) return result;
  }
}

function countSince(rows: Row[], since: number, statuses: readonly string[]): number {
  return rows.filter((row) => {
    const issuedAt = Date.parse(String(row.issued_at));
    return issuedAt >= since && statuses.includes(String(row.status));
  }).length;
}

export async function GET(request: Request) {
  const authorization = await requireStationUser(request, STATION_ADMIN_ROLES);
  if (!authorization.ok) return authorization.response;

  try {
    const now = new Date();
    const nowMs = now.getTime();
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const sevenDaysAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000;
    const twentyFourHoursAgo = nowMs - 24 * 60 * 60 * 1000;

    const [tickets, payments, queueResult, driversResult] = await Promise.all([
      readAllPages(async (start, end) =>
        await authorization.db
          .from('st_tickets')
          .select('id, route_id, issued_at, status, fare_etb')
          .gte('issued_at', new Date(thirtyDaysAgo).toISOString())
          .order('issued_at', { ascending: true })
          .range(start, end),
      ),
      readAllPages(async (start, end) =>
        await authorization.db
          .from('st_payments')
          .select('id, ticket_id, provider_ref, amount_etb, status, created_at')
          .gte('created_at', new Date(thirtyDaysAgo).toISOString())
          .order('created_at', { ascending: false })
          .range(start, end),
      ),
      authorization.db
        .from('st_queue')
        .select('station_id, vehicle_type, status')
        .in('status', ['waiting', 'boarding']),
      authorization.db
        .from('drivers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
    ]);

    if (queueResult.error || driversResult.error) {
      return NextResponse.json({ error: 'Unable to load taxi metrics' }, { status: 503 });
    }

    const soldStatuses = ['paid', 'used'];
    const sold30d = tickets.filter((ticket) => soldStatuses.includes(String(ticket.status)));
    const paidPayments = payments.filter((payment) => payment.status === 'paid');
    const revenueSince = (since: number) => paidPayments
      .filter((payment) => Date.parse(String(payment.created_at)) >= since)
      .reduce((sum, payment) => sum + Number(payment.amount_etb), 0);

    const hours = Array.from({ length: 24 }, (_, index) => {
      const start = new Date(nowMs - (23 - index) * 60 * 60 * 1000);
      start.setUTCMinutes(0, 0, 0);
      const hourStart = start.getTime();
      const hourEnd = hourStart + 60 * 60 * 1000;
      return {
        hour: start.toISOString(),
        tickets: tickets.filter((ticket) => {
          const issuedAt = Date.parse(String(ticket.issued_at));
          return issuedAt >= hourStart && issuedAt < hourEnd && soldStatuses.includes(String(ticket.status));
        }).length,
      };
    });

    const routeCounts = new Map<string, number>();
    for (const ticket of sold30d) {
      const routeId = String(ticket.route_id);
      routeCounts.set(routeId, (routeCounts.get(routeId) ?? 0) + 1);
    }
    const topRouteIds = [...routeCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10);
    const { data: routes, error: routesError } = topRouteIds.length
      ? await authorization.db
          .from('st_routes')
          .select('id, from_station_id, to_station_id')
          .in('id', topRouteIds.map(([id]) => id))
      : { data: [], error: null };
    if (routesError) return NextResponse.json({ error: 'Unable to load route metrics' }, { status: 503 });

    const stationIds = [...new Set((routes ?? []).flatMap((route) => [route.from_station_id, route.to_station_id]))];
    const { data: stations, error: stationsError } = stationIds.length
      ? await authorization.db.from('st_stations').select('id, name').in('id', stationIds)
      : { data: [], error: null };
    if (stationsError) return NextResponse.json({ error: 'Unable to load station metrics' }, { status: 503 });

    const stationNames = new Map((stations ?? []).map((station) => [station.id, station.name]));
    const routesById = new Map((routes ?? []).map((route) => [route.id, route]));
    const topRoutes = topRouteIds.flatMap(([id, count]) => {
      const route = routesById.get(id);
      if (!route) return [];
      return [{
        routeId: route.id,
        from: stationNames.get(route.from_station_id) ?? null,
        to: stationNames.get(route.to_station_id) ?? null,
        tickets: count,
      }];
    });

    const queueCounts = new Map<string, number>();
    for (const entry of queueResult.data ?? []) {
      const key = `${entry.station_id}:${entry.vehicle_type}`;
      queueCounts.set(key, (queueCounts.get(key) ?? 0) + 1);
    }
    const queueStationIds = [...new Set((queueResult.data ?? []).map((entry) => entry.station_id))];
    const { data: queueStations, error: queueStationsError } = queueStationIds.length
      ? await authorization.db.from('st_stations').select('id, name').in('id', queueStationIds)
      : { data: [], error: null };
    if (queueStationsError) return NextResponse.json({ error: 'Unable to load queue metrics' }, { status: 503 });

    const queueStationNames = new Map((queueStations ?? []).map((station) => [station.id, station.name]));
    const liveQueue = [...queueCounts.entries()].map(([key, count]) => {
      const [stationId, vehicleType] = key.split(':');
      return { stationId, station: queueStationNames.get(stationId) ?? null, vehicleType, count };
    });

    const reconciliationPayments = payments.slice(0, 100);
    const ticketIds = [...new Set(reconciliationPayments.map((payment) => String(payment.ticket_id)))];
    const { data: reconciliationTickets, error: reconciliationError } = ticketIds.length
      ? await authorization.db
          .from('st_tickets')
          .select('id, code, status, fare_etb')
          .in('id', ticketIds)
      : { data: [], error: null };
    if (reconciliationError) {
      return NextResponse.json({ error: 'Unable to load payment reconciliation' }, { status: 503 });
    }
    const ticketsById = new Map((reconciliationTickets ?? []).map((ticket) => [ticket.id, ticket]));
    const reconciliation = reconciliationPayments.map((payment) => {
      const ticket = ticketsById.get(payment.ticket_id);
      const amountMismatch = ticket !== undefined && Number(ticket.fare_etb) !== Number(payment.amount_etb);
      const statusMismatch = payment.status === 'paid' && ticket?.status !== 'paid' && ticket?.status !== 'used';
      return {
        paymentId: payment.id,
        providerRef: payment.provider_ref,
        paymentStatus: payment.status,
        paymentAmountEtb: payment.amount_etb,
        ticketCode: ticket?.code ?? null,
        ticketStatus: ticket?.status ?? null,
        ticketFareEtb: ticket?.fare_etb ?? null,
        mismatch: !ticket || amountMismatch || statusMismatch,
      };
    });

    return NextResponse.json({
      generatedAt: now.toISOString(),
      ticketsSold: {
        today: countSince(tickets, dayStart, soldStatuses),
        days7: countSince(tickets, sevenDaysAgo, soldStatuses),
        days30: countSince(tickets, thirtyDaysAgo, soldStatuses),
      },
      paidRevenueEtb: {
        today: revenueSince(dayStart),
        days7: revenueSince(sevenDaysAgo),
        days30: revenueSince(thirtyDaysAgo),
      },
      verificationRate: sold30d.length > 0
        ? sold30d.filter((ticket) => ticket.status === 'used').length / sold30d.length
        : null,
      expiredTickets: tickets.filter((ticket) => ticket.status === 'expired').length,
      liveQueue,
      activeDrivers: driversResult.count ?? 0,
      ticketsPerHour: hours.filter((hour) => Date.parse(hour.hour) >= twentyFourHoursAgo),
      topRoutes,
      reconciliation,
    });
  } catch {
    return NextResponse.json({ error: 'Unable to calculate taxi metrics' }, { status: 503 });
  }
}