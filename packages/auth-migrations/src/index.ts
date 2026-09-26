const PREFIX_PATTERN = /^[a-z][a-z0-9_]{0,30}$/u;

export interface AuthTableNames {
  account: string;
  passkey: string;
  rateLimit: string;
  session: string;
  user: string;
  verification: string;
}

export interface AuthMigrationOptions {
  tablePrefix?: string;
}

export interface AuthSchemaCompatibilityOptions extends AuthMigrationOptions {
  /**
   * Latest auth migration version recorded by the consuming application.
   * Consumers own this value and its migration journal; this package never
   * creates or mutates a version table.
   */
  appliedVersion?: number;
}

export function normalizeAuthTablePrefix(value: string | undefined): string {
  if (value === undefined || value === "") return "";
  if (!PREFIX_PATTERN.test(value)) throw new Error("auth_table_prefix_invalid");
  return `${value}_`;
}

export function resolveAuthTableNames(tablePrefix?: string): AuthTableNames {
  const prefix = normalizeAuthTablePrefix(tablePrefix);
  return {
    account: `${prefix}account`,
    passkey: `${prefix}passkey`,
    rateLimit: `${prefix}rateLimit`,
    session: `${prefix}session`,
    user: `${prefix}user`,
    verification: `${prefix}verification`,
  };
}

function quote(identifier: string): string {
  return `"${identifier}"`;
}

export function createAuthD1Migration(options: AuthMigrationOptions = {}): string {
  const table = resolveAuthTableNames(options.tablePrefix);
  const user = quote(table.user);
  const session = quote(table.session);
  const account = quote(table.account);
  const verification = quote(table.verification);
  const passkey = quote(table.passkey);
  const rateLimit = quote(table.rateLimit);

  return `CREATE TABLE ${user} (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE ${session} (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES ${user}("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "expiresAt" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "${table.session}_userId_idx" ON ${session} ("userId");

CREATE TABLE ${account} (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES ${user}("id") ON DELETE CASCADE,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "accessTokenExpiresAt" INTEGER,
  "refreshTokenExpiresAt" INTEGER,
  "scope" TEXT,
  "idToken" TEXT,
  "password" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "${table.account}_userId_idx" ON ${account} ("userId");

CREATE TABLE ${verification} (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "${table.verification}_identifier_idx" ON ${verification} ("identifier");

CREATE TABLE ${passkey} (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES ${user}("id") ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL UNIQUE,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL,
  "transports" TEXT,
  "createdAt" INTEGER,
  "aaguid" TEXT
);
CREATE INDEX "${table.passkey}_userId_idx" ON ${passkey} ("userId");

CREATE TABLE ${rateLimit} (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);
`;
}

export const AUTH_D1_MIGRATION = createAuthD1Migration();

export interface AuthSchemaMigrationStep {
  readonly description: string;
  sql(options?: AuthMigrationOptions): string;
  readonly version: number;
}

/**
 * Ordered, additive schema history. Each entry's `sql` returns only the
 * statements introduced at that version, so upgrade planning can concatenate
 * a contiguous range without replaying already-applied statements. Version 1
 * is the full base schema because no earlier version exists yet.
 */
export const AUTH_SCHEMA_MIGRATIONS: readonly AuthSchemaMigrationStep[] = [
  {
    description: "Create the base Better Auth schema (user, session, account, verification, passkey, rateLimit).",
    sql: createAuthD1Migration,
    version: 1,
  },
];

export const AUTH_SCHEMA_VERSION = AUTH_SCHEMA_MIGRATIONS.length;

export interface AuthSchemaUpgradePlan {
  readonly fromVersion: number;
  readonly sql: string;
  readonly steps: readonly AuthSchemaMigrationStep[];
  readonly toVersion: number;
}

function requireSchemaVersion(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > AUTH_SCHEMA_VERSION) {
    throw new Error(code);
  }
  return value;
}

/**
 * Plans the additive statements needed to bring a database from
 * `fromVersion` to `toVersion` (defaults to the latest known version). This
 * never inspects or mutates a real database; the caller applies the returned
 * SQL through its own app-owned migration process.
 */
export function planAuthSchemaUpgrade(
  fromVersion: number,
  toVersion: number = AUTH_SCHEMA_VERSION,
  options: AuthMigrationOptions = {},
): AuthSchemaUpgradePlan {
  const from = requireSchemaVersion(fromVersion, "auth_migration_from_version_invalid");
  const to = requireSchemaVersion(toVersion, "auth_migration_to_version_invalid");
  if (from > to) throw new Error("auth_migration_version_range_invalid");

  const steps = AUTH_SCHEMA_MIGRATIONS.filter((step) => step.version > from && step.version <= to);
  return {
    fromVersion: from,
    sql: steps.map((step) => step.sql(options)).join("\n"),
    steps,
    toVersion: to,
  };
}

export interface AuthSchemaIncompatibility {
  status: "incompatible";
  appliedVersion?: number;
  latestVersion: number;
  missingTables: readonly string[];
  reason: "partial-schema" | "schema-newer-than-library" | "version-without-schema" | "version-zero-with-schema";
  tables: AuthTableNames;
  unexpectedTables: readonly string[];
}

export interface AuthSchemaNotInitialized {
  status: "not-initialized";
  latestVersion: number;
  tables: AuthTableNames;
}

export interface AuthSchemaUpgradeRequired {
  status: "upgrade-required";
  appliedVersion: number;
  latestVersion: number;
  plan: AuthSchemaUpgradePlan;
  tables: AuthTableNames;
}

export interface AuthSchemaUpToDate {
  status: "up-to-date";
  appliedVersion: number;
  latestVersion: number;
  tables: AuthTableNames;
}

export interface AuthSchemaVersionUnknown {
  status: "version-unknown";
  latestVersion: number;
  tables: AuthTableNames;
}

export type AuthSchemaCompatibility =
  | AuthSchemaIncompatibility
  | AuthSchemaNotInitialized
  | AuthSchemaUpgradeRequired
  | AuthSchemaUpToDate
  | AuthSchemaVersionUnknown;

function requireAppliedVersion(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("auth_migration_applied_version_invalid");
  return value;
}

function checkAbsentSchema(
  appliedVersion: number | undefined,
  missingTables: readonly string[],
  tables: AuthTableNames,
  unexpectedTables: readonly string[],
): AuthSchemaCompatibility {
  if (appliedVersion === undefined || appliedVersion === 0) {
    return { status: "not-initialized", latestVersion: AUTH_SCHEMA_VERSION, tables };
  }
  return {
    status: "incompatible",
    appliedVersion,
    latestVersion: AUTH_SCHEMA_VERSION,
    missingTables,
    reason: "version-without-schema",
    tables,
    unexpectedTables,
  };
}

function checkCompleteSchema(
  appliedVersion: number | undefined,
  options: AuthSchemaCompatibilityOptions,
  tables: AuthTableNames,
): AuthSchemaCompatibility {
  if (appliedVersion === undefined) {
    return { status: "version-unknown", latestVersion: AUTH_SCHEMA_VERSION, tables };
  }
  if (appliedVersion === 0 || appliedVersion > AUTH_SCHEMA_VERSION) {
    return {
      status: "incompatible",
      appliedVersion,
      latestVersion: AUTH_SCHEMA_VERSION,
      missingTables: [],
      reason: appliedVersion === 0 ? "version-zero-with-schema" : "schema-newer-than-library",
      tables,
      unexpectedTables: [],
    };
  }
  if (appliedVersion < AUTH_SCHEMA_VERSION) {
    return {
      status: "upgrade-required",
      appliedVersion,
      latestVersion: AUTH_SCHEMA_VERSION,
      plan: planAuthSchemaUpgrade(appliedVersion, AUTH_SCHEMA_VERSION, options),
      tables,
    };
  }
  return { status: "up-to-date", appliedVersion, latestVersion: AUTH_SCHEMA_VERSION, tables };
}

/**
 * Compares an already-introspected list of table names (the caller's own,
 * trusted read of `sqlite_master` or equivalent) and optional app-owned
 * migration version against this package. It never connects to a database.
 * A complete table set without `appliedVersion` is deliberately reported as
 * `version-unknown`, because table names cannot prove that later additive
 * column or index migrations were applied.
 */
export function checkAuthSchemaCompatibility(
  existingTables: readonly string[],
  options: AuthSchemaCompatibilityOptions = {},
): AuthSchemaCompatibility {
  const appliedVersion = requireAppliedVersion(options.appliedVersion);
  const tables = resolveAuthTableNames(options.tablePrefix);
  const expected: readonly string[] = [
    tables.account,
    tables.passkey,
    tables.rateLimit,
    tables.session,
    tables.user,
    tables.verification,
  ];
  const expectedSet = new Set(expected);
  const existingSet = new Set(existingTables);
  const missingTables = expected.filter((table) => !existingSet.has(table));
  const prefix = normalizeAuthTablePrefix(options.tablePrefix);
  const unexpectedTables = prefix
    ? existingTables.filter((table) => table.startsWith(prefix) && !expectedSet.has(table))
    : [];

  if (missingTables.length === expected.length) {
    return checkAbsentSchema(appliedVersion, missingTables, tables, unexpectedTables);
  }

  if (missingTables.length > 0 || unexpectedTables.length > 0) {
    return {
      status: "incompatible",
      ...(appliedVersion === undefined ? {} : { appliedVersion }),
      latestVersion: AUTH_SCHEMA_VERSION,
      missingTables,
      reason: "partial-schema",
      tables,
      unexpectedTables,
    };
  }

  return checkCompleteSchema(appliedVersion, options, tables);
}
