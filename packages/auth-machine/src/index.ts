const CREDENTIAL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SUBJECT_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/u;
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)+$/u;
const TOKEN_PATTERN = /^sma_([a-z0-9]+(?:[._-][a-z0-9]+)*)_([A-Za-z0-9_-]{43})$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_CREDENTIALS = 100;
const MAXIMUM_SCOPES = 50;
const MAXIMUM_SCOPE_LENGTH = 120;
const MAXIMUM_CREDENTIAL_ID_LENGTH = 80;
const MAXIMUM_MACHINE_TOKEN_LENGTH = 4 + MAXIMUM_CREDENTIAL_ID_LENGTH + 1 + 43;
const MAXIMUM_AUTHORIZATION_LENGTH = "Bearer ".length + MAXIMUM_MACHINE_TOKEN_LENGTH;

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
  entropySource?: MachineEntropySource;
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

export type MachineEntropySource = (length: number) => Uint8Array;

export type MachineCredentialResolver = (
  credentialId: string,
) => MachineCredentialRecord | null | Promise<MachineCredentialRecord | null>;

export type MachineCredentialSource = readonly MachineCredentialRecord[] | MachineCredentialResolver;

export type MachineAuthRejectionReason =
  | "credential_expired"
  | "credential_not_active"
  | "credential_revoked"
  | "credential_resolution_failed"
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
    if (typeof scope !== "string" || scope.length > MAXIMUM_SCOPE_LENGTH || !SCOPE_PATTERN.test(scope)) {
      throw new Error("machine_auth_credentials_invalid");
    }
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
  const credentialId = requiredString(value, "credentialId", MAXIMUM_CREDENTIAL_ID_LENGTH);
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
  if (!authorization?.startsWith("Bearer ") || authorization.length > MAXIMUM_AUTHORIZATION_LENGTH) {
    return null;
  }
  const token = authorization.slice("Bearer ".length);
  if (token.length > MAXIMUM_MACHINE_TOKEN_LENGTH) return null;
  const match = TOKEN_PATTERN.exec(token);
  const credentialId = match?.[1];
  return credentialId && credentialId.length <= MAXIMUM_CREDENTIAL_ID_LENGTH ? { credentialId, token } : null;
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
  if (record.revokedAt && Date.parse(record.revokedAt) <= now) return "credential_revoked";
  if (record.notBefore && Date.parse(record.notBefore) > now) return "credential_not_active";
  if (Date.parse(record.expiresAt) <= now) return "credential_expired";
  return null;
}

async function findCredential(
  credentials: MachineCredentialSource,
  credentialId: string,
): Promise<MachineCredentialRecord | null> {
  if (typeof credentials === "function") {
    const resolved = await credentials(credentialId);
    if (resolved === null) return null;
    const record = parseRecord(resolved);
    if (record.credentialId !== credentialId) throw new Error("machine_auth_credentials_invalid");
    return record;
  }
  const matching = credentials.filter((credential) => credential.credentialId === credentialId);
  if (matching.length > 1) throw new Error("machine_auth_credentials_invalid");
  return matching[0] ? parseRecord(matching[0]) : null;
}

function authenticationTime(value: number | undefined): number {
  return value ?? Date.now();
}

/** Resolves a scoped machine principal from a high-entropy bearer token. */
export async function resolveMachineBearer(
  request: Request,
  credentials: MachineCredentialSource,
  options: ResolveMachineBearerOptions = {},
): Promise<MachinePrincipal | null> {
  const candidate = bearerToken(request);
  if (!candidate) {
    await emitSecurityEvent(options.onSecurityEvent, {
      credentialId: "unknown",
      reason: "token_invalid",
      type: "machine_auth_rejected",
    });
    return null;
  }
  const now = authenticationTime(options.now);
  if (!Number.isFinite(now)) {
    await emitSecurityEvent(options.onSecurityEvent, {
      credentialId: candidate.credentialId,
      reason: "token_invalid",
      type: "machine_auth_rejected",
    });
    return null;
  }
  let record: MachineCredentialRecord | null;
  try {
    record = await findCredential(credentials, candidate.credentialId);
  } catch {
    await emitSecurityEvent(options.onSecurityEvent, {
      credentialId: candidate.credentialId,
      reason: "credential_resolution_failed",
      type: "machine_auth_rejected",
    });
    return null;
  }
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

function randomBytes(length: number, entropySource: MachineEntropySource | undefined): Uint8Array {
  const bytes = entropySource ? entropySource(length) : crypto.getRandomValues(new Uint8Array(length));
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new Error("machine_auth_entropy_invalid");
  }
  return bytes;
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
  const secret = randomBytes(32, options.entropySource);
  const token = `sma_${metadata.credentialId}_${bytesToBase64Url(secret)}`;
  return { record: { ...metadata, tokenHash: await hashMachineToken(token) }, token };
}

export interface MachineCredentialInventoryItem {
  createdAt: string;
  credentialId: string;
  expiresAt: string;
  name: string;
  notBefore?: string;
  revokedAt?: string;
  scopes: readonly string[];
  subject: string;
}

/** Returns validated metadata that is safe to expose in consumer-owned operator tooling. */
export function listMachineCredentialInventory(
  credentials: readonly MachineCredentialRecord[],
): MachineCredentialInventoryItem[] {
  return credentials.map((credential) => {
    const { tokenHash: _tokenHash, ...metadata } = parseRecord(credential);
    return metadata;
  });
}

export interface RevokeMachineCredentialOptions {
  now?: number;
}

/** Marks a credential as revoked without deleting its audit-relevant metadata. */
export function revokeMachineCredential(
  credential: MachineCredentialRecord,
  options: RevokeMachineCredentialOptions = {},
): MachineCredentialRecord {
  const record = parseRecord(credential);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || now < Date.parse(record.createdAt)) {
    throw new Error("machine_auth_credentials_invalid");
  }
  if (record.revokedAt && Date.parse(record.revokedAt) <= now) return record;
  return parseRecord({ ...record, revokedAt: new Date(now).toISOString() });
}

export interface RotateMachineCredentialOptions {
  entropySource?: MachineEntropySource;
  expiresAt: string;
  name?: string;
  newCredentialId: string;
  notBefore?: string;
  now?: number;
  retirePreviousAt: string;
  scopes?: readonly string[];
  subject?: string;
}

export interface RotatedMachineCredential {
  previousRecord: MachineCredentialRecord;
  replacement: CreatedMachineCredential;
}

function replacementOptions(
  current: MachineCredentialRecord,
  options: RotateMachineCredentialOptions,
  now: number,
): CreateMachineCredentialOptions {
  const replacement: CreateMachineCredentialOptions = {
    credentialId: options.newCredentialId,
    expiresAt: options.expiresAt,
    name: options.name ?? current.name,
    now,
    scopes: options.scopes ?? current.scopes,
    subject: options.subject ?? current.subject,
  };
  if (options.entropySource) replacement.entropySource = options.entropySource;
  if (options.notBefore) replacement.notBefore = options.notBefore;
  return replacement;
}

/**
 * Creates a replacement credential and explicitly schedules retirement of the previous record.
 * The replacement token is returned once and must be delivered through a consumer-owned secret store.
 */
export async function rotateMachineCredential(
  credential: MachineCredentialRecord,
  options: RotateMachineCredentialOptions,
): Promise<RotatedMachineCredential> {
  const current = parseRecord(credential);
  if (current.revokedAt || options.newCredentialId === current.credentialId) {
    throw new Error("machine_auth_credentials_invalid");
  }
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || !validTimestamp(options.retirePreviousAt)) {
    throw new Error("machine_auth_credentials_invalid");
  }
  const retirement = Date.parse(options.retirePreviousAt);
  if (retirement < now || retirement < Date.parse(current.createdAt)) {
    throw new Error("machine_auth_credentials_invalid");
  }
  const previousRecord = parseRecord({ ...current, revokedAt: options.retirePreviousAt });
  const replacement = await createMachineCredential(replacementOptions(current, options, now));
  return { previousRecord, replacement };
}
