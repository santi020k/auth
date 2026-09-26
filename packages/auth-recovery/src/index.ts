const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_CHARACTERS = 20;
const CODE_GROUP_SIZE = 5;
const DEFAULT_CODE_COUNT = 10;
const MAX_CODE_COUNT = 50;
const MINIMUM_PEPPER_BYTES = 32;
const DIGEST_PREFIX = "v1.";
const DIGEST_DOMAIN = "santi020k-auth-recovery:v1";
const NORMALIZABLE_SEPARATORS = new Set(["\t", "\n", "\r", " ", "-"]);

export interface RecoveryCodeDigestRecord {
  digest: string;
}

export interface ConsumeRecoveryCodeInput extends RecoveryCodeDigestRecord {
  subject: string;
}

export interface ReplaceRecoveryCodesInput {
  records: readonly RecoveryCodeDigestRecord[];
  subject: string;
}

/**
 * Storage is implemented and owned by each consumer. The atomic consume method
 * must match an unused digest and mark/delete it in one transaction so two
 * concurrent requests cannot both succeed. Replacement policy, auditing,
 * authorization, and recovery approval remain consumer responsibilities.
 */
export interface RecoveryCodeStore {
  consumeRecoveryCodeAtomically(input: ConsumeRecoveryCodeInput): Promise<boolean>;
  replaceRecoveryCodes(input: ReplaceRecoveryCodesInput): Promise<void>;
}

export interface RecoveryCodeCryptoOptions {
  crypto?: Crypto;
}

export interface IssueRecoveryCodesOptions extends RecoveryCodeCryptoOptions {
  count?: number;
  pepper: string | Uint8Array;
  store: RecoveryCodeStore;
  subject: string;
}

export interface ConsumeRecoveryCodeOptions extends RecoveryCodeCryptoOptions {
  code: string;
  pepper: string | Uint8Array;
  store: RecoveryCodeStore;
  subject: string;
}

export interface DigestRecoveryCodeOptions extends RecoveryCodeCryptoOptions {
  code: string;
  pepper: string | Uint8Array;
  subject: string;
}

function resolveCrypto(value: Crypto | undefined): Crypto {
  return value ?? globalThis.crypto;
}

function includesControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
}

function normalizeSubject(value: string): string {
  if (value !== value.trim() || value.length === 0 || value.length > 256 || includesControlCharacter(value)) {
    throw new Error("auth_recovery_subject_invalid");
  }
  return value;
}

function pepperBytes(value: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(typeof value === "string" ? new TextEncoder().encode(value) : value);
  if (bytes.byteLength < MINIMUM_PEPPER_BYTES) throw new Error("auth_recovery_pepper_too_short");
  return bytes;
}

function requireCodeCount(value: number | undefined): number {
  const count = value ?? DEFAULT_CODE_COUNT;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CODE_COUNT) {
    throw new Error("auth_recovery_code_count_invalid");
  }
  return count;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function formatCode(canonical: string): string {
  const groups: string[] = [];
  for (let offset = 0; offset < canonical.length; offset += CODE_GROUP_SIZE) {
    groups.push(canonical.slice(offset, offset + CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

/** Accepts ASCII case, spaces, and hyphens; rejects ambiguous or lookalike characters. */
export function normalizeRecoveryCode(value: string): string {
  let normalized = "";
  for (const character of value) {
    if (NORMALIZABLE_SEPARATORS.has(character)) continue;
    if (character.charCodeAt(0) > 127) throw new Error("auth_recovery_code_invalid");
    normalized += character.toUpperCase();
  }
  if (normalized.length !== CODE_CHARACTERS) throw new Error("auth_recovery_code_invalid");
  for (const character of normalized) {
    if (!CODE_ALPHABET.includes(character)) throw new Error("auth_recovery_code_invalid");
  }
  return normalized;
}

/** Generates a 20-character code with approximately 99 bits of unbiased entropy. */
export function generateRecoveryCode(options: RecoveryCodeCryptoOptions = {}): string {
  const cryptoImplementation = resolveCrypto(options.crypto);
  const maximumUnbiasedByte = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let canonical = "";
  while (canonical.length < CODE_CHARACTERS) {
    const random = cryptoImplementation.getRandomValues(new Uint8Array(CODE_CHARACTERS));
    for (const byte of random) {
      if (byte >= maximumUnbiasedByte) continue;
      canonical += CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length);
      if (canonical.length === CODE_CHARACTERS) break;
    }
  }
  return formatCode(canonical);
}

/** Returns a deterministic, versioned HMAC digest scoped to both pepper and stable subject ID. */
export async function digestRecoveryCode(options: DigestRecoveryCodeOptions): Promise<string> {
  const cryptoImplementation = resolveCrypto(options.crypto);
  const subject = normalizeSubject(options.subject);
  const code = normalizeRecoveryCode(options.code);
  const key = await cryptoImplementation.subtle.importKey(
    "raw",
    pepperBytes(options.pepper),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const message = new TextEncoder().encode(`${DIGEST_DOMAIN}\u0000${subject}\u0000${code}`);
  const signature = await cryptoImplementation.subtle.sign("HMAC", key, message);
  return `${DIGEST_PREFIX}${encodeBase64Url(new Uint8Array(signature))}`;
}

/**
 * Replaces the consumer-owned digest set, then returns the new plaintext codes.
 * Plaintext is never passed to storage and cannot be retrieved through this API.
 */
export async function issueRecoveryCodes(options: IssueRecoveryCodesOptions): Promise<readonly string[]> {
  const count = requireCodeCount(options.count);
  const subject = normalizeSubject(options.subject);
  const cryptoImplementation = resolveCrypto(options.crypto);
  const issued = new Set<string>();
  while (issued.size < count) issued.add(generateRecoveryCode({ crypto: cryptoImplementation }));
  const codes = [...issued];
  const records = await Promise.all(
    codes.map(async (code) => ({
      digest: await digestRecoveryCode({ code, crypto: cryptoImplementation, pepper: options.pepper, subject }),
    })),
  );
  await options.store.replaceRecoveryCodes({ records, subject });
  return codes;
}

/** Digests a candidate and delegates its single-use decision to the store's atomic consume operation. */
export async function consumeRecoveryCode(options: ConsumeRecoveryCodeOptions): Promise<boolean> {
  const subject = normalizeSubject(options.subject);
  pepperBytes(options.pepper);
  const cryptoImplementation = resolveCrypto(options.crypto);
  let code: string;
  try {
    code = normalizeRecoveryCode(options.code);
  } catch {
    return false;
  }
  const digest = await digestRecoveryCode({ code, crypto: cryptoImplementation, pepper: options.pepper, subject });
  return options.store.consumeRecoveryCodeAtomically({ digest, subject });
}
