import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TicketQrPayload {
  id: string;
  code: string;
  routeId: string;
  vehicleType: 'taxi' | 'bajaj' | 'minibus';
  fareEtb: number;
  exp: number;
  nonce: string;
  kid: string;
}

export type QrVerification =
  | { valid: true; payload: TicketQrPayload }
  | { valid: false; reason: 'malformed' | 'unknown_kid' | 'bad_signature' | 'expired' };

function hasPayloadShape(value: unknown): value is TicketQrPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.id === 'string' &&
    typeof payload.code === 'string' &&
    typeof payload.routeId === 'string' &&
    ['taxi', 'bajaj', 'minibus'].includes(String(payload.vehicleType)) &&
    typeof payload.fareEtb === 'number' &&
    Number.isFinite(payload.fareEtb) &&
    typeof payload.exp === 'number' &&
    Number.isInteger(payload.exp) &&
    typeof payload.nonce === 'string' &&
    typeof payload.kid === 'string' &&
    payload.kid.length > 0
  );
}

export function signTicketQr(
  payload: Omit<TicketQrPayload, 'kid'> & { kid?: string },
  keyId: string,
  secret: string,
): string {
  if (!secret || !keyId) throw new Error('QR signing configuration is incomplete');
  const encodedPayload = Buffer.from(JSON.stringify({ ...payload, kid: keyId })).toString('base64url');
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyTicketQr(
  token: string,
  secretsByKid: Readonly<Record<string, string>>,
  nowSeconds = Math.floor(Date.now() / 1000),
): QrVerification {
  const [encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedPayload || !encodedSignature || extra !== undefined) {
    return { valid: false, reason: 'malformed' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return { valid: false, reason: 'malformed' };
    }
    throw error;
  }
  if (!hasPayloadShape(payload)) return { valid: false, reason: 'malformed' };

  const secret = secretsByKid[payload.kid];
  if (!secret) return { valid: false, reason: 'unknown_kid' };

  const expectedSignature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest();
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, 'base64url');
  } catch (error) {
    if (error instanceof TypeError) return { valid: false, reason: 'bad_signature' };
    throw error;
  }
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return { valid: false, reason: 'bad_signature' };
  }

  if (payload.exp <= nowSeconds) return { valid: false, reason: 'expired' };
  return { valid: true, payload };
}

export function parseQrSigningKeys(
  currentKeyId: string,
  currentSecret: string,
  previousKeysJson: string,
): Record<string, string> {
  if (!currentKeyId || !currentSecret) return {};
  let previousKeys: unknown = {};
  if (previousKeysJson) {
    try {
      previousKeys = JSON.parse(previousKeysJson);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('QR_SIGNING_PREVIOUS_KEYS must be valid JSON');
      throw error;
    }
  }
  if (typeof previousKeys !== 'object' || previousKeys === null || Array.isArray(previousKeys)) {
    throw new Error('QR_SIGNING_PREVIOUS_KEYS must be a JSON object');
  }
  const keys = previousKeys as Record<string, unknown>;
  const validPreviousKeys = Object.fromEntries(
    Object.entries(keys).filter(([keyId, secret]) => keyId && typeof secret === 'string' && secret),
  ) as Record<string, string>;
  return { ...validPreviousKeys, [currentKeyId]: currentSecret };
}