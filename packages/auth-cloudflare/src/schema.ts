import type { D1Database } from "@cloudflare/workers-types";

interface RequiredTable {
  columns: readonly string[];
  indexes: readonly RequiredIndex[];
  name: string;
  primaryKey: readonly string[];
  uniqueConstraints: readonly (readonly string[])[];
}

interface RequiredIndex {
  columns: readonly string[];
  name: string;
}

interface SchemaObjectRow {
  name: string;
  tableName: string;
}

interface TableInfoRow {
  name: string;
  pk: number;
}

interface IndexInfoRow {
  name: string;
  seqno: number;
}

interface IndexListRow {
  name: string;
  partial: number;
  unique: number;
}

export type OwnerAuthSchemaFinding =
  | { kind: "missing_table"; table: string }
  | { column: string; kind: "missing_column"; table: string }
  | { columns: readonly string[]; index: string; kind: "missing_index"; table: string }
  | { columns: readonly string[]; kind: "missing_primary_key"; table: string }
  | { columns: readonly string[]; kind: "missing_unique_constraint"; table: string };

export interface OwnerAuthSchemaCheck {
  findings: OwnerAuthSchemaFinding[];
  ok: boolean;
}

const REQUIRED_TABLES: readonly RequiredTable[] = [
  {
    columns: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
    indexes: [],
    name: "user",
    primaryKey: ["id"],
    uniqueConstraints: [["email"]],
  },
  {
    columns: ["id", "userId", "token", "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt"],
    indexes: [{ columns: ["userId"], name: "session_userId_idx" }],
    name: "session",
    primaryKey: ["id"],
    uniqueConstraints: [["token"]],
  },
  {
    columns: [
      "id",
      "userId",
      "accountId",
      "providerId",
      "accessToken",
      "refreshToken",
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
      "scope",
      "idToken",
      "password",
      "createdAt",
      "updatedAt",
    ],
    indexes: [{ columns: ["userId"], name: "account_userId_idx" }],
    name: "account",
    primaryKey: ["id"],
    uniqueConstraints: [],
  },
  {
    columns: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
    indexes: [{ columns: ["identifier"], name: "verification_identifier_idx" }],
    name: "verification",
    primaryKey: ["id"],
    uniqueConstraints: [],
  },
  {
    columns: [
      "id",
      "name",
      "publicKey",
      "userId",
      "credentialID",
      "counter",
      "deviceType",
      "backedUp",
      "transports",
      "createdAt",
      "aaguid",
    ],
    indexes: [{ columns: ["userId"], name: "passkey_userId_idx" }],
    name: "passkey",
    primaryKey: ["id"],
    uniqueConstraints: [["credentialID"]],
  },
  {
    columns: ["id", "key", "count", "lastRequest"],
    indexes: [],
    name: "rateLimit",
    primaryKey: ["id"],
    uniqueConstraints: [["key"]],
  },
];

function quotedIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sameColumns(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((column, index) => column === expected[index]);
}

async function checkKeyConstraints(
  database: D1Database,
  table: RequiredTable,
  tableInfo: readonly TableInfoRow[],
): Promise<OwnerAuthSchemaFinding[]> {
  const findings: OwnerAuthSchemaFinding[] = [];
  const primaryKey = tableInfo
    .filter((column) => column.pk > 0)
    .toSorted((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  if (!sameColumns(primaryKey, table.primaryKey)) {
    findings.push({ columns: table.primaryKey, kind: "missing_primary_key", table: table.name });
  }

  const indexList = await database.prepare(`PRAGMA index_list(${quotedIdentifier(table.name)})`).all<IndexListRow>();
  const uniqueIndexes = await Promise.all(
    indexList.results
      .filter((index) => index.unique === 1 && index.partial === 0)
      .map(async (index) => {
        const indexInfo = await database
          .prepare(`PRAGMA index_info(${quotedIdentifier(index.name)})`)
          .all<IndexInfoRow>();
        return indexInfo.results.toSorted((left, right) => left.seqno - right.seqno).map((row) => row.name);
      }),
  );
  for (const uniqueConstraint of table.uniqueConstraints) {
    if (!uniqueIndexes.some((columns) => sameColumns(columns, uniqueConstraint))) {
      findings.push({ columns: uniqueConstraint, kind: "missing_unique_constraint", table: table.name });
    }
  }

  return findings;
}

export async function checkOwnerAuthSchema(database: D1Database): Promise<OwnerAuthSchemaCheck> {
  const objects = await database
    .prepare(
      "SELECT name, tbl_name AS tableName FROM sqlite_schema WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'",
    )
    .all<SchemaObjectRow>();
  const tableNames = new Set(
    objects.results.filter((object) => object.name === object.tableName).map((object) => object.name),
  );
  const indexes = new Map(
    objects.results
      .filter((object) => object.name !== object.tableName)
      .map((object) => [object.name, object.tableName]),
  );
  const findings: OwnerAuthSchemaFinding[] = [];

  for (const table of REQUIRED_TABLES) {
    if (!tableNames.has(table.name)) {
      findings.push({ kind: "missing_table", table: table.name });
      continue;
    }

    const tableInfo = await database.prepare(`PRAGMA table_info(${quotedIdentifier(table.name)})`).all<TableInfoRow>();
    const columnNames = new Set(tableInfo.results.map((column) => column.name));
    for (const column of table.columns) {
      if (!columnNames.has(column)) findings.push({ column, kind: "missing_column", table: table.name });
    }

    findings.push(...(await checkKeyConstraints(database, table, tableInfo.results)));

    for (const index of table.indexes) {
      let matches = indexes.get(index.name) === table.name;
      if (matches) {
        const indexInfo = await database
          .prepare(`PRAGMA index_info(${quotedIdentifier(index.name)})`)
          .all<IndexInfoRow>();
        const columns = indexInfo.results.toSorted((left, right) => left.seqno - right.seqno).map((row) => row.name);
        matches = sameColumns(columns, index.columns);
      }
      if (!matches) {
        findings.push({ columns: index.columns, index: index.name, kind: "missing_index", table: table.name });
      }
    }
  }

  return { findings, ok: findings.length === 0 };
}
