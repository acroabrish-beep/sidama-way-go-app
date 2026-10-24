import {
  decodeProtectedHeader,
  importPKCS8,
  importX509,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from 'npm:jose@5.9.6';
import {
  createClient,
  type SupabaseClient,
} from 'npm:@supabase/supabase-js@2.112.3';
import {
  HttpError,
  mergeAuthenticatedRole,
  parseCustomClaims,
  parseProfileInput,
  parseServiceAccount,
  safeUser,
  type ProfileInput,
  type ServiceAccount,
} from './core.ts';

const FIREBASE_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDENTITY_TOOLKIT_SCOPE =
  'https://www.googleapis.com/auth/identitytoolkit';
const MAX_BODY_BYTES = 16 * 1024;
const NETWORK_TIMEOUT_MS = 10_000;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type FirebaseClaims = JWTPayload & {
  email?: string;
  email_verified?: boolean;
  role?: string;
};

type IdentityUser = {
  localId?: string;
  disabled?: boolean;
  validSince?: string;
  customAttributes?: string;
};

type CertCache = {
  certs: Record<string, string>;
  expiresAt: number;
};

let certCache: CertCache | null = null;
let googleTokenCache:
  | { cacheKey: string; token: string; expiresAt: number }
  | null = null;
let adminClient: SupabaseClient | null = null;

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse({ error: message, code }, status);
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'Request is too large.');
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'Request is too large.');
  }
  if (text.trim() === '') return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Invalid request body.');
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = NETWORK_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
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

async function loadFirebaseCerts(forceRefresh = false): Promise<Record<string, string>> {
  if (
    !forceRefresh &&
    certCache !== null &&
    certCache.expiresAt > Date.now()
  ) {
    return certCache.certs;
  }

  const response = await fetchWithTimeout(FIREBASE_CERT_URL, {
    headers: { Accept: 'application/json' },
  });
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

async function verifyFirebaseToken(
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

async function getGoogleAccessToken(
  serviceAccount: ServiceAccount,
): Promise<string> {
  const cacheKey = `${serviceAccount.clientEmail}:${serviceAccount.projectId}`;
  if (
    googleTokenCache !== null &&
    googleTokenCache.cacheKey === cacheKey &&
    googleTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return googleTokenCache.token;
  }

  let assertion: string;
  try {
    const key = await importPKCS8(serviceAccount.privateKey, 'RS256');
    assertion = await new SignJWT({ scope: IDENTITY_TOOLKIT_SCOPE })
      .setProtectedHeader({
        alg: 'RS256',
        ...(serviceAccount.privateKeyId
          ? { kid: serviceAccount.privateKeyId }
          : {}),
      })
      .setIssuer(serviceAccount.clientEmail)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
  } catch {
    throw new HttpError(
      503,
      'auth_not_configured',
      'Account setup is not configured.',
    );
  }

  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    throw new HttpError(
      503,
      'auth_unavailable',
      'Authentication is temporarily unavailable.',
    );
  }

  const data = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new HttpError(
      503,
      'auth_unavailable',
      'Authentication is temporarily unavailable.',
    );
  }

  const expiresIn =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
      ? data.expires_in
      : 3600;
  googleTokenCache = {
    cacheKey,
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  };
  return data.access_token;
}

async function lookupFirebaseUser(
  serviceAccount: ServiceAccount,
  uid: string,
  accessToken: string,
): Promise<IdentityUser> {
  const response = await fetchWithTimeout(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.projectId)}/accounts:lookup`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: [uid] }),
    },
  );

  if (!response.ok) {
    throw new HttpError(
      502,
      'auth_lookup_failed',
      'Authentication is temporarily unavailable.',
    );
  }

  const data = (await response.json()) as { users?: IdentityUser[] };
  const user = data.users?.[0];
  if (!user) {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }
  return user;
}

async function updateCustomClaims(
  serviceAccount: ServiceAccount,
  uid: string,
  customClaims: Record<string, unknown>,
  accessToken: string,
): Promise<void> {
  const response = await fetchWithTimeout(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.projectId)}/accounts:update`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localId: uid,
        customAttributes: JSON.stringify(customClaims),
      }),
    },
  );

  if (!response.ok) {
    throw new HttpError(
      502,
      'auth_claim_failed',
      'Account setup is temporarily unavailable.',
    );
  }
}

function getAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !serviceRoleKey) {
    throw new HttpError(
      503,
      'service_not_configured',
      'Account setup is unavailable.',
    );
  }

  adminClient ??= createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

function mapSyncError(code: string | undefined): HttpError {
  switch (code) {
    case '42501':
      return new HttpError(
        403,
        'email_verification_required',
        'Verify your email before linking this account.',
      );
    case '23505':
      return new HttpError(
        409,
        'email_already_linked',
        'This email is already linked to another account.',
      );
    case '22023':
      return new HttpError(400, 'invalid_account', 'Invalid account data.');
    case 'PGRST202':
      return new HttpError(
        503,
        'schema_not_ready',
        'Database schema is not ready.',
      );
    default:
      return new HttpError(503, 'sync_failed', 'Unable to sync account.');
  }
}

async function syncProfile(
  uid: string,
  claims: FirebaseClaims,
  input: ProfileInput,
): Promise<Record<string, unknown>> {
  const email = typeof claims.email === 'string' ? claims.email : null;
  const emailVerified = claims.email_verified === true;

  const { data, error } = await getAdminClient().rpc('sync_user_profile', {
    p_firebase_uid: uid,
    p_email: email,
    p_email_verified: emailVerified,
    p_full_name: input.fullName ?? null,
    p_phone: input.phone ?? null,
    p_language: input.language ?? null,
  });

  if (error) {
    console.error('sync-profile: profile RPC failed', {
      code: error.code ?? 'unknown',
    });
    throw mapSyncError(error.code);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new HttpError(503, 'sync_failed', 'Unable to sync account.');
  }

  return row as Record<string, unknown>;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Method not allowed.');
  }

  try {
    const idToken = readBearerToken(request);
    if (!idToken) {
      throw new HttpError(401, 'missing_token', 'Sign in to continue.');
    }

    const serviceAccount = parseServiceAccount((key) => Deno.env.get(key));
    if (!serviceAccount) {
      throw new HttpError(
        503,
        'auth_not_configured',
        'Account setup is not configured.',
      );
    }

    const claims = await verifyFirebaseToken(
      idToken,
      serviceAccount.projectId,
    );
    const uid = claims.sub;
    if (!uid) {
      throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
    }

    const input = parseProfileInput(await readJsonBody(request));
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const identityUser = await lookupFirebaseUser(
      serviceAccount,
      uid,
      accessToken,
    );

    if (identityUser.disabled === true) {
      throw new HttpError(401, 'account_disabled', 'This account is disabled.');
    }

    const validSince = Number(identityUser.validSince ?? 0);
    const authTime = Number(claims.auth_time ?? 0);
    if (
      Number.isFinite(validSince) &&
      Number.isFinite(authTime) &&
      validSince > authTime
    ) {
      throw new HttpError(
        401,
        'session_revoked',
        'Your session has expired. Please sign in again.',
      );
    }

    const profile = await syncProfile(uid, claims, input);
    if (profile.status !== 'active') {
      throw new HttpError(403, 'account_inactive', 'This account is not active.');
    }

    let roleClaimState: 'ready' | 'updated' = 'ready';
    if (claims.role !== 'authenticated') {
      const customClaims = parseCustomClaims(identityUser.customAttributes);
      if (customClaims.role !== 'authenticated') {
        await updateCustomClaims(
          serviceAccount,
          uid,
          mergeAuthenticatedRole(customClaims),
          accessToken,
        );
      }
      roleClaimState = 'updated';
    }

    return jsonResponse({
      user: safeUser(profile),
      supabaseRoleClaim: roleClaimState,
      tokenRefreshRequired: roleClaimState === 'updated',
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.status, error.code, error.message);
    }
    console.error('sync-profile: unexpected error', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return errorResponse(500, 'internal_error', 'Unable to sync account.');
  }
});
