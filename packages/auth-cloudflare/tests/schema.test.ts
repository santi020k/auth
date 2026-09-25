import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { checkOwnerAuthSchema } from "../src/schema.js";

const canonicalSchemaPath = fileURLToPath(new URL("../../schema/d1.sql", import.meta.url));
let databaseSequence = 0;

async function canonicalSchema(): Promise<string> {
  return readFile(canonicalSchemaPath, "utf8");
}

async function createDatabase(): Promise<{ database: D1Database; miniflare: Miniflare }> {
  databaseSequence += 1;
  const bindingName = `auth-schema-test-${databaseSequence}`;
  const miniflare = new Miniflare({
    workers: [
      {
        config: {
          compatibilityDate: "2026-09-24",
          env: { AUTH_DB: { name: bindingName, type: "d1" } },
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                contents: "export default { fetch() { return new Response('unused'); } };",
                type: "esm",
              },
            },
            modulesRoot: fileURLToPath(new URL(".", import.meta.url)),
          },
          name: bindingName,
        },
      },
    ],
  });
  return { database: await miniflare.getD1Database("AUTH_DB"), miniflare };
}

async function applySql(database: D1Database, sql: string): Promise<void> {
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await database.batch(statements.map((statement) => database.prepare(statement)));
}

void describe("checkOwnerAuthSchema", () => {
  void it("accepts the canonical D1 schema", async () => {
    const { database, miniflare } = await createDatabase();
    try {
      await applySql(database, await canonicalSchema());
      assert.deepEqual(await checkOwnerAuthSchema(database), { findings: [], ok: true });
    } finally {
      await miniflare.dispose();
    }
  });

  void it("reports missing tables, columns, and indexes", async () => {
    const { database, miniflare } = await createDatabase();
    try {
      const incompleteSchema = (await canonicalSchema())
        .replace('  "image" TEXT,\n', "")
        .replace('CREATE INDEX "session_userId_idx" ON "session" ("userId");\n', "")
        .replace(
          /CREATE TABLE "rateLimit" \(\n[ ]{2}"id" TEXT PRIMARY KEY NOT NULL,\n[ ]{2}"key" TEXT NOT NULL UNIQUE,\n[ ]{2}"count" INTEGER NOT NULL,\n[ ]{2}"lastRequest" INTEGER NOT NULL\n\);\n/u,
          "",
        );
      await applySql(database, incompleteSchema);

      assert.deepEqual(await checkOwnerAuthSchema(database), {
        findings: [
          { column: "image", kind: "missing_column", table: "user" },
          { columns: ["userId"], index: "session_userId_idx", kind: "missing_index", table: "session" },
          { kind: "missing_table", table: "rateLimit" },
        ],
        ok: false,
      });
    } finally {
      await miniflare.dispose();
    }
  });

  void it("allows consumer-owned tables, columns, and indexes", async () => {
    const { database, miniflare } = await createDatabase();
    try {
      await applySql(database, await canonicalSchema());
      await applySql(
        database,
        `
          ALTER TABLE "user" ADD COLUMN "consumerMetadata" TEXT;
          CREATE TABLE "consumer_settings" ("id" TEXT PRIMARY KEY NOT NULL);
          CREATE INDEX "consumer_user_email_idx" ON "user" ("email");
        `,
      );

      assert.deepEqual(await checkOwnerAuthSchema(database), { findings: [], ok: true });
    } finally {
      await miniflare.dispose();
    }
  });
});
