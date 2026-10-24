export interface TicketRow {
  id: string;
  code: string;
  passenger_firebase_uid?: string;
  route_id: string;
  tariff_id?: string;
  vehicle_type: string;
  fare_etb: number | string;
  status: string;
  issued_at: string;
  expires_at: string;
  used_at?: string | null;
  used_by_uid?: string | null;
  verified_vehicle_id?: string | null;
}

export interface TariffRow {
  id: string;
  route_id: string;
  vehicle_type: string;
  fare_etb: number | string;
  effective_from: string;
  effective_to: string | null;
  source_reference: string | null;
  approved_by: string | null;
  created_by?: string | null;
}

export interface StationSummary {
  id: string;
  name: string;
  name_am: string | null;
}

export interface RouteSummary {
  id: string;
  from: StationSummary | null;
  to: StationSummary | null;
}

export function selectActiveTariff<T extends {
  effective_from: string;
  effective_to: string | null;
}>(tariffs: readonly T[], date: string): T | null {
  return (
    tariffs
      .filter(
        (tariff) =>
          tariff.effective_from <= date &&
          (!tariff.effective_to || tariff.effective_to > date),
      )
      .sort((left, right) =>
        right.effective_from.localeCompare(left.effective_from)
      )[0] ?? null
  );
}

export function isOfficialTariff(tariff: {
  source_reference: string | null;
  approved_by: string | null;
}): boolean {
  return Boolean(tariff.source_reference?.trim() && tariff.approved_by?.trim());
}

export function tariffLabel(tariff: {
  source_reference: string | null;
  approved_by: string | null;
}): 'Official tariff' | 'Tariff pending approval' {
  return isOfficialTariff(tariff)
    ? 'Official tariff'
    : 'Tariff pending approval';
}

export function effectiveStatus(ticket: TicketRow): string {
  if (
    ticket.status === 'pending_payment' &&
    new Date(ticket.expires_at).getTime() <= Date.now()
  ) {
    return 'expired';
  }
  return ticket.status;
}

export function ticketPayload(ticket: TicketRow): Record<string, unknown> {
  return {
    id: ticket.id,
    code: ticket.code,
    route_id: ticket.route_id,
    vehicle_type: ticket.vehicle_type,
    fare_etb: Number(ticket.fare_etb),
    status: effectiveStatus(ticket),
    issued_at: ticket.issued_at,
    expires_at: ticket.expires_at,
    used_at: ticket.used_at ?? null,
    verified_vehicle_id: ticket.verified_vehicle_id ?? null,
  };
}
