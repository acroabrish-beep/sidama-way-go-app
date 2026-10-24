import { HttpError } from './http.ts';
import type { VehicleType } from './qr.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VEHICLE_TYPES = new Set<string>(['taxi', 'bajaj', 'minibus']);
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{8,100}$/;
const MAX_QR_TOKEN_LENGTH = 2048;
const MAX_CODE_LENGTH = 32;

export interface PurchaseInput {
  routeId: string;
  vehicleType: VehicleType;
  idempotencyKey: string;
}

export interface VerifyInput {
  vehicleId: string;
  qrToken?: string;
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new HttpError(400, 'invalid_request', `${field} must be a UUID.`);
  }
  return value.trim();
}

export function parsePurchaseInput(body: unknown): PurchaseInput {
  if (!isRecord(body)) {
    throw new HttpError(
      400,
      'invalid_request',
      'routeId and a supported vehicleType are required.',
    );
  }

  const routeId = requireUuid(body.routeId, 'routeId');
  if (
    typeof body.vehicleType !== 'string' ||
    !VEHICLE_TYPES.has(body.vehicleType)
  ) {
    throw new HttpError(
      400,
      'invalid_request',
      'routeId and a supported vehicleType are required.',
    );
  }

  let idempotencyKey: string;
  if (body.idempotencyKey === undefined || body.idempotencyKey === null) {
    idempotencyKey = crypto.randomUUID();
  } else if (
    typeof body.idempotencyKey === 'string' &&
    IDEMPOTENCY_PATTERN.test(body.idempotencyKey)
  ) {
    idempotencyKey = body.idempotencyKey;
  } else {
    throw new HttpError(400, 'invalid_request', 'Invalid idempotencyKey.');
  }

  return {
    routeId,
    vehicleType: body.vehicleType as VehicleType,
    idempotencyKey,
  };
}

export function parseVerifyInput(body: unknown): VerifyInput {
  if (!isRecord(body)) {
    throw new HttpError(
      400,
      'invalid_request',
      'vehicleId and either qrToken or code are required.',
    );
  }

  const vehicleId = requireUuid(body.vehicleId, 'vehicleId');
  const hasQr = typeof body.qrToken === 'string' && body.qrToken.trim() !== '';
  const hasCode = typeof body.code === 'string' && body.code.trim() !== '';

  if (hasQr === hasCode) {
    throw new HttpError(
      400,
      'invalid_request',
      'Provide exactly one of qrToken or code.',
    );
  }

  if (hasQr) {
    const qrToken = (body.qrToken as string).trim();
    if (qrToken.length > MAX_QR_TOKEN_LENGTH) {
      throw new HttpError(400, 'invalid_request', 'qrToken is too long.');
    }
    return { vehicleId, qrToken };
  }

  const code = (body.code as string).trim().toUpperCase();
  if (!code || code.length > MAX_CODE_LENGTH) {
    throw new HttpError(400, 'invalid_request', 'code is invalid.');
  }
  return { vehicleId, code };
}

export function parseTicketId(body: unknown): string {
  if (!isRecord(body)) {
    throw new HttpError(400, 'invalid_request', 'ticketId is required.');
  }
  return requireUuid(body.ticketId, 'ticketId');
}
