import {
  decodeProtectedHeader,
  importX509,
  jwtVerify,
  type JWTPayload,
} from 'npm:jose@5.9.6';
import { HttpError, readBearerToken } from './http.ts';

const FIREBASE_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const NETWORK_TIMEOUT_MS = 10_000;

export type FirebaseClaims = JWTPayload & {
  email?: string;
  email_verified?: boolean;
  role?: string;
};

type CertCache = {
  certs: Record<string, string>;
  expiresAt: number;
};

let certCache: CertCache | null = null;

function readProjectIdFromServiceAccount(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const projectId = (parsed as Record<string, unknown>).project_id;
    return typeof projectId === 'string' && projectId.trim()
      ? projectId.trim()
      : null;
  } catch {
    return null;
  }
}

export function readFirebaseProjectId(
  readEnv: (key: string) => string | undefined,
): string {
  const direct = readEnv('FIREBASE_PROJECT_ID')?.trim();
  if (direct) return direct;

  const fromServiceAccount = readProjectIdFromServiceAccount(
    readEnv('FIREBASE_SERVICE_ACCOUNT_JSON'),
  );
  if (fromServiceAccount) return fromServiceAccount;

  throw new HttpError(
    503,
    'auth_not_configured',
    'Authentication is not configured.',
  );
}

async function fetchCerts(): Promise<Response> {
  try {
    return await fetch(FIREBASE_CERT_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(
      503,
      'auth_unavailable',
      'Authentication is temporarily unavailable.',
    );
  }
}

function cacheMaxAge(header: string | null): number {
  const match = header?.match(/max-age=(\d+)/i);
  const seconds = match ? Number(match[1]) : 3600;
  if (!Number.isFinite(seconds)) return 3600;
  return Math.min(Math.max(seconds, 60), 43_200);
}

async function loadFirebaseCerts(
  forceRefresh = false,
): Promise<Record<string, string>> {
  if (!forceRefresh && certCache !== null && certCache.expiresAt > Date.now()) {
    return certCache.certs;
  }

  const response = await fetchCerts();
  if (!response.ok) {
    throw new HttpError(
      503,
      'auth_unavailable',
      'Authentication is temporarily unavailable.',
    );
  }

  const certs = (await response.json()) as Record<string, string>;
  const maxAge = cacheMaxAge(response.headers.get('cache-control'));
  certCache = {
    certs,
    expiresAt: Date.now() + maxAge * 1000 - 60_000,
  };
  return certs;
}

export async function verifyFirebaseToken(
  idToken: string,
  projectId: string,
): Promise<FirebaseClaims> {
  let keyId: string;
  try {
    const header = decodeProtectedHeader(idToken);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      throw new Error('unsupported token header');
    }
    keyId = header.kid;
  } catch {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }

  let certs = await loadFirebaseCerts();
  if (!certs[keyId]) {
    certs = await loadFirebaseCerts(true);
  }
  const certificate = certs[keyId];
  if (!certificate) {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }

  try {
    const key = await importX509(certificate, 'RS256');
    const { payload } = await jwtVerify(idToken, key, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      clockTolerance: 60,
    });

    if (
      typeof payload.sub !== 'string' ||
      payload.sub.trim() === '' ||
      typeof payload.auth_time !== 'number'
    ) {
      throw new Error('incomplete Firebase claims');
    }

    return payload as FirebaseClaims;
  } catch {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }
}

export async function authenticateRequest(
  request: Request,
  readEnv: (key: string) => string | undefined,
): Promise<{ uid: string; claims: FirebaseClaims }> {
  const idToken = readBearerToken(request);
  if (!idToken) {
    throw new HttpError(401, 'missing_token', 'Sign in to continue.');
  }

  const projectId = readFirebaseProjectId(readEnv);
  const claims = await verifyFirebaseToken(idToken, projectId);
  const uid = claims.sub;
  if (!uid) {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }
  return { uid, claims };
}
