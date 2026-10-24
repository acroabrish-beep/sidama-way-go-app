export type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
};

export type ProfileInput = {
  fullName?: string;
  phone?: string;
  language?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_account', `${field} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, 'invalid_account', `${field} is too long.`);
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseProfileInput(value: unknown): ProfileInput {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new HttpError(400, 'invalid_account', 'Invalid account payload.');
  }

  return {
    fullName: optionalText(value.fullName, 'fullName', 120),
    phone: optionalText(value.phone, 'phone', 32),
    language: optionalText(value.language, 'language', 8),
  };
}

export function normalizePrivateKey(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

export function parseServiceAccount(
  readEnv: (key: string) => string | undefined,
): ServiceAccount | null {
  const rawJson = readEnv('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
  if (rawJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new HttpError(
        503,
        'auth_not_configured',
        'Account setup is not configured.',
      );
    }
    if (!isRecord(parsed)) {
      throw new HttpError(
        503,
        'auth_not_configured',
        'Account setup is not configured.',
      );
    }
    return buildServiceAccount(parsed);
  }

  const projectId = readEnv('FIREBASE_PROJECT_ID')?.trim();
  const clientEmail = readEnv('FIREBASE_CLIENT_EMAIL')?.trim();
  const privateKey = readEnv('FIREBASE_PRIVATE_KEY');

  if (!projectId || !clientEmail || !privateKey) return null;

  return buildServiceAccount({
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    private_key_id: readEnv('FIREBASE_PRIVATE_KEY_ID'),
  });
}

function buildServiceAccount(value: Record<string, unknown>): ServiceAccount {
  const projectId =
    typeof value.project_id === 'string' ? value.project_id.trim() : '';
  const clientEmail =
    typeof value.client_email === 'string' ? value.client_email.trim() : '';
  const privateKey =
    typeof value.private_key === 'string' ? value.private_key : '';
  const privateKeyId =
    typeof value.private_key_id === 'string'
      ? value.private_key_id.trim()
      : undefined;

  if (!projectId || !clientEmail || !privateKey.includes('PRIVATE KEY')) {
    throw new HttpError(
      503,
      'auth_not_configured',
      'Account setup is not configured.',
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
    privateKeyId: privateKeyId || undefined,
  };
}

export function mergeAuthenticatedRole(
  customClaims: Record<string, unknown>,
): Record<string, unknown> {
  return { ...customClaims, role: 'authenticated' };
}

export function parseCustomClaims(
  raw: string | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function safeUser(row: Record<string, unknown>): Record<string, unknown> {
  const fields = [
    'id',
    'firebase_uid',
    'email',
    'full_name',
    'phone',
    'avatar_url',
    'role',
    'status',
    'language',
    'department',
    'last_login',
    'last_login_at',
    'created_at',
    'updated_at',
  ] as const;

  const user: Record<string, unknown> = {};
  for (const field of fields) {
    if (row[field] !== undefined) user[field] = row[field];
  }
  return user;
}
