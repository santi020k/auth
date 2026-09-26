const CREDENTIAL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SUBJECT_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/u;
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)+$/u;
const TOKEN_PATTERN = /^sma_([a-z0-9]+(?:[._-][a-z0-9]+)*)_([A-Za-z0-9_-]{43})$/u;

export interface MachineCredentialRecord {
  credentialId: string;
  expiresAt?: string;
  name: string;
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
  expiresAt?: string;
  name: string;
  scopes: readonly string[];
  subject: string;
}

export interface CreatedMachineCredential {
  record: MachineCredentialRecord;
  token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error("machine_auth_credentials_invalid");
  }
  return value;
}

function validExpiry(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

function credentialScopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("machine_auth_credentials_invalid");
  const scopes = value.map((scope) => {
    if (typeof scope !== "string" || !SCOPE_PATTERN.test(scope)) throw new Error("machine_auth_credentials_invalid");
    return scope;
  });
  if (new Set(scopes).size !== scopes.length) throw new Error("machine_auth_credentials_invalid");
  return scopes;
}

function optionalExpiry(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !validExpiry(value)) throw new Error("machine_auth_credentials_invalid");
  return value;
}

function parseRecord(value: unknown): MachineCredentialRecord {
  if (!isRecord(value)) throw new Error("machine_auth_credentials_invalid");
  const credentialId = requiredString(value, "credentialId");
  const name = requiredString(value, "name");
  const subject = requiredString(value, "subject");
  const tokenHash = requiredString(value, "tokenHash");
  if (
    !CREDENTIAL_ID_PATTERN.test(credentialId) ||
    !SUBJECT_PATTERN.test(subject) ||
    !/^sha256:[a-f0-9]{64}$/u.test(tokenHash)
  ) {
    throw new Error("machine_auth_credentials_invalid");
  }
  const scopes = credentialScopes(value.scopes);
  const expiresAt = optionalExpiry(value.expiresAt);
  return { credentialId, ...(expiresAt ? { expiresAt } : {}), name, scopes, subject, tokenHash };
}

/** Parses server-side credential metadata. Raw bearer tokens must never be stored in this value. */
export function parseMachineCredentials(value: string | undefined): MachineCredentialRecord[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("machine_auth_credentials_invalid");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("machine_auth_credentials_invalid");
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

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

/** Resolves a scoped machine principal from a high-entropy bearer token. */
export async function resolveMachineBearer(
  request: Request,
  credentials: readonly MachineCredentialRecord[],
  now: number = Date.now(),
): Promise<MachinePrincipal | null> {
  const token = bearerToken(request);
  if (!token || !Number.isFinite(now)) return null;
  const credentialId = TOKEN_PATTERN.exec(token)?.[1];
  if (!credentialId) return null;
  const record = credentials.find((candidate) => candidate.credentialId === credentialId);
  if (!record || (record.expiresAt && Date.parse(record.expiresAt) <= now)) return null;
  const tokenHash = await hashMachineToken(token);
  if (!safeEqual(record.tokenHash, tokenHash)) return null;
  return { credentialId: record.credentialId, name: record.name, scopes: record.scopes, subject: record.subject };
}

export function machineHasScopes(principal: MachinePrincipal, requiredScopes: readonly string[]): boolean {
  return requiredScopes.every((scope) => principal.scopes.includes(scope));
}

export function assertMachineScopes(principal: MachinePrincipal, requiredScopes: readonly string[]): void {
  if (!machineHasScopes(principal, requiredScopes)) throw new Error("machine_auth_scope_required");
}

/** Creates a credential once. Persist only `record` on the server and deliver `token` to the client secret store. */
export async function createMachineCredential(
  options: CreateMachineCredentialOptions,
): Promise<CreatedMachineCredential> {
  const metadata = parseRecord({
    credentialId: options.credentialId,
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    name: options.name,
    scopes: [...options.scopes],
    subject: options.subject,
    tokenHash: `sha256:${"0".repeat(64)}`,
  });
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const token = `sma_${metadata.credentialId}_${bytesToBase64Url(secret)}`;
  return { record: { ...metadata, tokenHash: await hashMachineToken(token) }, token };
}
