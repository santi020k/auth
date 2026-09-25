import type { D1Database } from "@cloudflare/workers-types";

interface RequiredTable {
  columns: readonly string[];
  indexes: readonly RequiredIndex[];
  name: string;
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
}

interface IndexInfoRow {
  name: string;
  seqno: number;
}

export type OwnerAuthSchemaFinding =
  | { kind: "missing_table"; table: string }
  | { column: string; kind: "missing_column"; table: string }
  | { columns: readonly string[]; index: string; kind: "missing_index"; table: string };

export interface OwnerAuthSchemaCheck {
  findings: OwnerAuthSchemaFinding[];
  ok: boolean;
}

const REQUIRED_TABLES: readonly RequiredTable[] = [
  {
    columns: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
    indexes: [],
    name: "user",
  },
  {
    columns: ["id", "userId", "token", "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt"],
    indexes: [{ columns: ["userId"], name: "session_userId_idx" }],
    name: "session",
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
  },
  {
    columns: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
    indexes: [{ columns: ["identifier"], name: "verification_identifier_idx" }],
    name: "verification",
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
  },
  {
    columns: ["id", "key", "count", "lastRequest"],
    indexes: [],
    name: "rateLimit",
  },
];

function quotedIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sameColumns(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((column, index) => column === expected[index]);
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
