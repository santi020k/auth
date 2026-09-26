const CREDENTIAL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SUBJECT_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/u;
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)+$/u;
const TOKEN_PATTERN = /^sma_([a-z0-9]+(?:[._-][a-z0-9]+)*)_([A-Za-z0-9_-]{43})$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_CREDENTIALS = 100;
const MAXIMUM_SCOPES = 50;

export interface MachineCredentialRecord {
  createdAt: string;
  credentialId: string;
  expiresAt: string;
  name: string;
  notBefore?: string;
  revokedAt?: string;
  scopes: string[];
  subject: string;
  tokenHash: string;
}

export interface MachinePrincipal {
  credentialId: string;
  name: string;
  scopes: readonly string[];
  subject: string;
}

export interface CreateMachineCredentialOptions {
  credentialId: string;
  expiresAt: string;
  name: string;
  notBefore?: string;
  now?: number;
  scopes: readonly string[];
  subject: string;
}

export interface CreatedMachineCredential {
  record: MachineCredentialRecord;
  token: string;
}

export type MachineAuthRejectionReason =
  | "credential_expired"
  | "credential_not_active"
  | "credential_revoked"
  | "digest_mismatch"
  | "token_invalid"
  | "unknown_credential";

export type MachineAuthEvent =
  | { credentialId: string; reason: MachineAuthRejectionReason; type: "machine_auth_rejected" }
  | { credentialId: string; subject: string; type: "machine_auth_succeeded" };

export type MachineAuthEventListener = (event: MachineAuthEvent) => Promise<void> | void;

export interface ResolveMachineBearerOptions {
  now?: number;
  onSecurityEvent?: MachineAuthEventListener;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, maximumLength: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > maximumLength) {
    throw new Error("machine_auth_credentials_invalid");
  }
  return value;
}

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

function timestamp(record: Record<string, unknown>, key: string, required: true): string;
function timestamp(record: Record<string, unknown>, key: string, required: false): string | undefined;
function timestamp(record: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const value = record[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !validTimestamp(value)) throw new Error("machine_auth_credentials_invalid");
  return value;
}

function credentialScopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_SCOPES) {
    throw new Error("machine_auth_credentials_invalid");
  }
  const scopes = value.map((scope) => {
    if (typeof scope !== "string" || !SCOPE_PATTERN.test(scope)) throw new Error("machine_auth_credentials_invalid");
    return scope;
  });
  if (new Set(scopes).size !== scopes.length) throw new Error("machine_auth_credentials_invalid");
  return scopes;
}

function validLifecycle(
  createdAt: string,
  expiresAt: string,
  notBefore: string | undefined,
  revokedAt: string | undefined,
): boolean {
  const created = Date.parse(createdAt);
  const expires = Date.parse(expiresAt);
  if (created >= expires) return false;
  if (notBefore !== undefined && (Date.parse(notBefore) < created || Date.parse(notBefore) >= expires)) return false;
  return revokedAt === undefined || Date.parse(revokedAt) >= created;
}

function parseRecord(value: unknown): MachineCredentialRecord {
  if (!isRecord(value)) throw new Error("machine_auth_credentials_invalid");
  const credentialId = requiredString(value, "credentialId", 80);
  const name = requiredString(value, "name", 120);
  const subject = requiredString(value, "subject", 200);
  const tokenHash = requiredString(value, "tokenHash", 71);
  const createdAt = timestamp(value, "createdAt", true);
  const expiresAt = timestamp(value, "expiresAt", true);
  const notBefore = timestamp(value, "notBefore", false);
  const revokedAt = timestamp(value, "revokedAt", false);
  if (
    !CREDENTIAL_ID_PATTERN.test(credentialId) ||
    !SUBJECT_PATTERN.test(subject) ||
    !HASH_PATTERN.test(tokenHash) ||
    !validLifecycle(createdAt, expiresAt, notBefore, revokedAt)
  ) {
    throw new Error("machine_auth_credentials_invalid");
  }
  const scopes = credentialScopes(value.scopes);
  return {
    createdAt,
    credentialId,
    expiresAt,
    name,
    ...(notBefore ? { notBefore } : {}),
    ...(revokedAt ? { revokedAt } : {}),
    scopes,
    subject,
    tokenHash,
  };
}

/** Parses bounded server-side credential metadata. Raw bearer tokens must never be stored in this value. */
export function parseMachineCredentials(value: string | undefined): MachineCredentialRecord[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("machine_auth_credentials_invalid");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAXIMUM_CREDENTIALS) {
    throw new Error("machine_auth_credentials_invalid");
  }
  const records = parsed.map(parseRecord);
  if (new Set(records.map((record) => record.credentialId)).size !== records.length) {
    throw new Error("machine_auth_credentials_invalid");
  }
  return records;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function hashMachineToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function bearerToken(request: Request): { credentialId: string; token: string } | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  const match = TOKEN_PATTERN.exec(token);
  return match?.[1] ? { credentialId: match[1], token } : null;
}

async function emitSecurityEvent(
  listener: MachineAuthEventListener | undefined,
  event: MachineAuthEvent,
): Promise<void> {
  if (!listener) return;
  try {
    await listener(event);
  } catch {
    // Consumer observability must never change authentication behavior.
  }
}

function lifecycleRejection(record: MachineCredentialRecord, now: number): MachineAuthRejectionReason | null {
  if (record.revokedAt) return "credential_revoked";
  if (record.notBefore && Date.parse(record.notBefore) > now) return "credential_not_active";
  if (Date.parse(record.expiresAt) <= now) return "credential_expired";
  return null;
}

/** Resolves a scoped machine principal from a high-entropy bearer token. */
export async function resolveMachineBearer(
  request: Request,
  credentials: readonly MachineCredentialRecord[],
  options: ResolveMachineBearerOptions = {},
): Promise<MachinePrincipal | null> {
  const now = options.now ?? Date.now();
  const candidate = bearerToken(request);
  if (!candidate || !Number.isFinite(now)) {
    await emitSecurityEvent(options.onSecurityEvent, {
      credentialId: candidate?.credentialId ?? "unknown",
      reason: "token_invalid",
      type: "machine_auth_rejected",
    });
    return null;
  }
  const record = credentials.find(({ credentialId }) => credentialId === candidate.credentialId);
  if (!record) {
    await emitSecurityEvent(options.onSecurityEvent, {
      credentialId: candidate.credentialId,
      reason: "unknown_credential",
      type: "machine_auth_rejected",
    });
    return null;
  }
  const rejectionReason = lifecycleRejection(record, now);
  if (rejectionReason) {
    await emitSecurityEvent(options.onSecurityEvent, {
      credentialId: record.credentialId,
      reason: rejectionReason,
      type: "machine_auth_rejected",
    });
    return null;
  }
  const tokenHash = await hashMachineToken(candidate.token);
  if (!safeEqual(record.tokenHash, tokenHash)) {
    await emitSecurityEvent(options.onSecurityEvent, {
      credentialId: record.credentialId,
      reason: "digest_mismatch",
      type: "machine_auth_rejected",
    });
    return null;
  }
  await emitSecurityEvent(options.onSecurityEvent, {
    credentialId: record.credentialId,
    subject: record.subject,
    type: "machine_auth_succeeded",
  });
  return { credentialId: record.credentialId, name: record.name, scopes: record.scopes, subject: record.subject };
}

export function machineHasScopes(principal: MachinePrincipal, requiredScopes: readonly string[]): boolean {
  return requiredScopes.length > 0 && requiredScopes.every((scope) => principal.scopes.includes(scope));
}

export function assertMachineScopes(principal: MachinePrincipal, requiredScopes: readonly string[]): void {
  if (!machineHasScopes(principal, requiredScopes)) throw new Error("machine_auth_scope_required");
}

/** Creates a credential once. Persist only `record` on the server and deliver `token` to the client secret store. */
export async function createMachineCredential(
  options: CreateMachineCredentialOptions,
): Promise<CreatedMachineCredential> {
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("machine_auth_credentials_invalid");
  const createdAt = new Date(now).toISOString();
  const metadata = parseRecord({
    createdAt,
    credentialId: options.credentialId,
    expiresAt: options.expiresAt,
    name: options.name,
    ...(options.notBefore ? { notBefore: options.notBefore } : {}),
    scopes: [...options.scopes],
    subject: options.subject,
    tokenHash: `sha256:${"0".repeat(64)}`,
  });
  if (Date.parse(metadata.expiresAt) <= now) throw new Error("machine_auth_credentials_invalid");
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const token = `sma_${metadata.credentialId}_${bytesToBase64Url(secret)}`;
  return { record: { ...metadata, tokenHash: await hashMachineToken(token) }, token };
}
