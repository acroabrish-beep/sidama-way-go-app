import { HttpError } from './http.ts';

export type VehicleType = 'taxi' | 'bajaj' | 'minibus';

export interface TicketQrPayload {
  id: string;
  code: string;
  routeId: string;
  vehicleType: VehicleType;
  fareEtb: number;
  exp: number;
  nonce: string;
  kid: string;
}

export type QrVerification =
  | { valid: true; payload: TicketQrPayload }
  | {
      valid: false;
      reason: 'malformed' | 'unknown_kid' | 'bad_signature' | 'expired';
    };

const VEHICLE_TYPES = new Set<string>(['taxi', 'bajaj', 'minibus']);
const TICKET_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TICKET_CODE_PATTERN =
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function hasPayloadShape(value: unknown): value is TicketQrPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.id === 'string' &&
    typeof payload.code === 'string' &&
    typeof payload.routeId === 'string' &&
    VEHICLE_TYPES.has(String(payload.vehicleType)) &&
    typeof payload.fareEtb === 'number' &&
    Number.isFinite(payload.fareEtb) &&
    typeof payload.exp === 'number' &&
    Number.isInteger(payload.exp) &&
    typeof payload.nonce === 'string' &&
    typeof payload.kid === 'string' &&
    payload.kid.length > 0
  );
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signTicketQr(
  payload: Omit<TicketQrPayload, 'kid'> & { kid?: string },
  keyId: string,
  secret: string,
): Promise<string> {
  if (!secret || !keyId) {
    throw new HttpError(
      503,
      'qr_not_configured',
      'Ticket signing is not configured',
    );
  }
  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ ...payload, kid: keyId }),
    ),
  );
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyTicketQr(
  token: string,
  secretsByKid: Readonly<Record<string, string>>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<QrVerification> {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };

  const [encodedPayload, encodedSignature] = parts;
  const payloadBytes = base64UrlToBytes(encodedPayload);
  const signatureBytes = base64UrlToBytes(encodedSignature);
  if (!payloadBytes || !signatureBytes) {
    return { valid: false, reason: 'malformed' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (!hasPayloadShape(payload)) return { valid: false, reason: 'malformed' };

  const secret = secretsByKid[payload.kid];
  if (!secret) return { valid: false, reason: 'unknown_kid' };

  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(encodedPayload),
    );
    if (!valid) return { valid: false, reason: 'bad_signature' };
  } catch {
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
    } catch {
      throw new HttpError(
        503,
        'qr_not_configured',
        'Ticket signing is not configured',
      );
    }
  }
  if (
    typeof previousKeys !== 'object' ||
    previousKeys === null ||
    Array.isArray(previousKeys)
  ) {
    throw new HttpError(
      503,
      'qr_not_configured',
      'Ticket signing is not configured',
    );
  }

  const keys: Record<string, string> = {};
  for (const [keyId, secret] of Object.entries(
    previousKeys as Record<string, unknown>,
  )) {
    if (keyId && typeof secret === 'string' && secret) keys[keyId] = secret;
  }
  keys[currentKeyId] = currentSecret;
  return keys;
}

export function loadSigningKeys(
  readEnv: (key: string) => string | undefined,
): { keys: Record<string, string>; currentKeyId: string } {
  const currentKeyId = readEnv('QR_SIGNING_KID')?.trim() || 'current';
  const currentSecret = readEnv('QR_SIGNING_SECRET')?.trim() ?? '';
  const keys = parseQrSigningKeys(
    currentKeyId,
    currentSecret,
    readEnv('QR_SIGNING_PREVIOUS_KEYS')?.trim() ?? '',
  );
  if (!keys[currentKeyId]) {
    throw new HttpError(
      503,
      'qr_not_configured',
      'Ticket signing is not configured',
    );
  }
  return { keys, currentKeyId };
}

export function generateTicketCode(length = 8): string {
  if (!Number.isInteger(length) || length < 4 || length > 16) {
    throw new Error('Ticket code length must be between 4 and 16');
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = '';
  // The alphabet has 32 characters, so every byte maps without modulo bias.
  for (const byte of bytes) {
    code += TICKET_CODE_ALPHABET[byte % TICKET_CODE_ALPHABET.length];
  }
  return code;
}

export function isTicketCode(value: string): boolean {
  return TICKET_CODE_PATTERN.test(value);
}
