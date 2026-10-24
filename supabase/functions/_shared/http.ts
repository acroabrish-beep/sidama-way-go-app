export const MAX_BODY_BYTES = 16 * 1024;

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse({ error: message, code }, status);
}

export function preflightResponse(): Response {
  return new Response('ok', { headers: CORS_HEADERS });
}

export function requirePost(request: Request): Response | null {
  if (request.method === 'POST') return null;
  return errorResponse(405, 'method_not_allowed', 'Method not allowed.');
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function readJsonBody(request: Request): Promise<unknown> {
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

export function handleError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  logLabel: string,
): Response {
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.code, error.message);
  }
  console.error(`${logLabel}: unexpected error`, {
    name: error instanceof Error ? error.name : 'unknown',
  });
  return errorResponse(500, fallbackCode, fallbackMessage);
}
