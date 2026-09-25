import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  AUTH_D1_MIGRATION,
  AUTH_SCHEMA_MIGRATIONS,
  AUTH_SCHEMA_VERSION,
  checkAuthSchemaCompatibility,
  createAuthD1Migration,
  normalizeAuthTablePrefix,
  planAuthSchemaUpgrade,
  resolveAuthTableNames,
} from "../src/index.js";

void describe("auth D1 migrations", () => {
  void it("generates the reviewed default schema", () => {
    assert.match(AUTH_D1_MIGRATION, /CREATE TABLE "user"/u);
    assert.match(AUTH_D1_MIGRATION, /REFERENCES "user"\("id"\) ON DELETE CASCADE/u);
    assert.match(AUTH_D1_MIGRATION, /CREATE TABLE "passkey"/u);
    assert.match(AUTH_D1_MIGRATION, /CREATE TABLE "rateLimit"/u);
    assert.equal(createAuthD1Migration(), AUTH_D1_MIGRATION);
  });

  void it("keeps the playground's app-owned migration aligned with the generator", () => {
    const playgroundMigration = readFileSync(
      resolve(process.cwd(), "../../apps/playground/migrations/0001_auth.sql"),
      "utf8",
    );
    assert.ok(playgroundMigration.startsWith(AUTH_D1_MIGRATION));
  });

  void it("prefixes every model, reference, and index for collision isolation", () => {
    const sql = createAuthD1Migration({ tablePrefix: "planner_v2" });
    for (const table of Object.values(resolveAuthTableNames("planner_v2"))) {
      assert.match(sql, new RegExp(`CREATE TABLE "${table}"`, "u"));
    }
    assert.match(sql, /REFERENCES "planner_v2_user"\("id"\)/u);
    assert.match(sql, /"planner_v2_session_userId_idx"/u);
  });

  void it("rejects prefixes that cannot be safely quoted or maintained", () => {
    assert.equal(normalizeAuthTablePrefix(undefined), "");
    assert.equal(normalizeAuthTablePrefix("auth2"), "auth2_");
    for (const value of ["Auth", "two words", "dash-prefix", "1auth", "x".repeat(32)]) {
      assert.throws(() => normalizeAuthTablePrefix(value), /auth_table_prefix_invalid/u);
    }
  });
});

void describe("schema versioning and upgrade planning", () => {
  void it("tracks one schema version today, matching the migration history length", () => {
    assert.equal(AUTH_SCHEMA_VERSION, 1);
    assert.equal(AUTH_SCHEMA_MIGRATIONS.length, 1);
    assert.equal(AUTH_SCHEMA_MIGRATIONS[0]?.version, 1);
  });

  void it("plans the full base schema when upgrading from version zero", () => {
    const plan = planAuthSchemaUpgrade(0);
    assert.equal(plan.fromVersion, 0);
    assert.equal(plan.toVersion, AUTH_SCHEMA_VERSION);
    assert.equal(plan.sql, AUTH_D1_MIGRATION);
    assert.equal(plan.steps.length, 1);
  });

  void it("applies a table prefix consistently through the upgrade plan", () => {
    const plan = planAuthSchemaUpgrade(0, undefined, { tablePrefix: "planner_v2" });
    assert.equal(plan.sql, createAuthD1Migration({ tablePrefix: "planner_v2" }));
  });

  void it("returns no steps and empty SQL when already at the target version", () => {
    const plan = planAuthSchemaUpgrade(AUTH_SCHEMA_VERSION, AUTH_SCHEMA_VERSION);
    assert.deepEqual(plan.steps, []);
    assert.equal(plan.sql, "");
  });

  void it("rejects an invalid or out-of-range version", () => {
    assert.throws(() => planAuthSchemaUpgrade(-1), /auth_migration_from_version_invalid/u);
    assert.throws(() => planAuthSchemaUpgrade(1.5), /auth_migration_from_version_invalid/u);
    assert.throws(() => planAuthSchemaUpgrade(0, AUTH_SCHEMA_VERSION + 1), /auth_migration_to_version_invalid/u);
    assert.throws(() => planAuthSchemaUpgrade(1, 0), /auth_migration_version_range_invalid/u);
  });
});

void describe("schema compatibility checks", () => {
  void it("reports not-initialized when none of the expected tables exist", () => {
    const result = checkAuthSchemaCompatibility([]);
    assert.equal(result.status, "not-initialized");
  });

  void it("reports up-to-date when every expected table is present", () => {
    const tables: readonly string[] = Object.values(resolveAuthTableNames());
    const result = checkAuthSchemaCompatibility([...tables, "unrelated_app_table"], { appliedVersion: 1 });
    assert.equal(result.status, "up-to-date");
  });

  void it("reports incompatible with the missing tables when some but not all exist", () => {
    const result = checkAuthSchemaCompatibility(["user", "session"]);
    assert.equal(result.status, "incompatible");
    assert.deepEqual([...result.missingTables].sort(), ["account", "passkey", "rateLimit", "verification"].sort());
  });

  void it("flags unexpected prefixed tables only when a prefix isolates the namespace", () => {
    const tables: readonly string[] = Object.values(resolveAuthTableNames("demo"));
    const result = checkAuthSchemaCompatibility([...tables, "demo_leftover"], {
      appliedVersion: 1,
      tablePrefix: "demo",
    });
    assert.equal(result.status, "incompatible");
    assert.deepEqual(result.unexpectedTables, ["demo_leftover"]);

    const partial = checkAuthSchemaCompatibility(["demo_user", "demo_leftover"], { tablePrefix: "demo" });
    assert.equal(partial.status, "incompatible");
    assert.deepEqual(partial.unexpectedTables, ["demo_leftover"]);
  });

  void it("never guesses unexpected tables without a prefix to scope the namespace", () => {
    const result = checkAuthSchemaCompatibility(["user", "session", "some_other_app_table"]);
    assert.equal(result.status, "incompatible");
    assert.deepEqual(result.unexpectedTables, []);
  });

  void it("does not claim a complete table set is current without the app-owned version", () => {
    const tables: readonly string[] = Object.values(resolveAuthTableNames());
    assert.equal(checkAuthSchemaCompatibility(tables).status, "version-unknown");
  });

  void it("rejects version state that contradicts the observed tables", () => {
    const tables: readonly string[] = Object.values(resolveAuthTableNames());
    const zeroWithSchema = checkAuthSchemaCompatibility(tables, { appliedVersion: 0 });
    assert.equal(zeroWithSchema.status, "incompatible");
    assert.equal(zeroWithSchema.reason, "version-zero-with-schema");

    const future = checkAuthSchemaCompatibility(tables, { appliedVersion: AUTH_SCHEMA_VERSION + 1 });
    assert.equal(future.status, "incompatible");
    assert.equal(future.reason, "schema-newer-than-library");

    const versionWithoutSchema = checkAuthSchemaCompatibility([], { appliedVersion: 1 });
    assert.equal(versionWithoutSchema.status, "incompatible");
    assert.equal(versionWithoutSchema.reason, "version-without-schema");
  });

  void it("rejects malformed applied versions", () => {
    assert.throws(
      () => checkAuthSchemaCompatibility([], { appliedVersion: -1 }),
      /auth_migration_applied_version_invalid/u,
    );
  });
});
