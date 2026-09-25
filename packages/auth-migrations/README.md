# `@santi020k/auth-migrations`

Generates the reviewed SQLite/D1 schema used by the auth packages. Migrations remain application-owned: generate the SQL,
review it, save it in the consumer repository, and apply it through that repository's migration workflow.

```ts
import { createAuthD1Migration } from "@santi020k/auth-migrations";

const sql = createAuthD1Migration({ tablePrefix: "planner_v2" });
```

The optional prefix changes every table, foreign-key reference, and index. Use the identical prefix in
`@santi020k/auth-cloudflare`; changing it after deployment starts a different identity store rather than migrating data.

## Schema versioning and upgrade planning

`AUTH_SCHEMA_MIGRATIONS` is the ordered, additive history of the schema; `AUTH_SCHEMA_VERSION` is the latest known
version (`1` today, since only the base schema exists). `planAuthSchemaUpgrade` concatenates the additive SQL between
two versions without connecting to a database:

```ts
import { planAuthSchemaUpgrade } from "@santi020k/auth-migrations";

const plan = planAuthSchemaUpgrade(0, undefined, { tablePrefix: "planner_v2" });
// plan.sql: statements introduced by every version after 0 up to the latest
// plan.steps: the AuthSchemaMigrationStep entries that contributed those statements
```

Requesting the same version on both ends (for example, an application already at the latest version) returns an empty
plan (`steps: []`, `sql: ""`) instead of an error, so a caller can always apply `plan.sql` unconditionally.

`checkAuthSchemaCompatibility` compares an already-introspected table list (the caller's own trusted read of
`sqlite_master` or equivalent) and the consumer's app-owned applied migration version against this package, without
ever opening a database connection itself:

```ts
import { checkAuthSchemaCompatibility } from "@santi020k/auth-migrations";

const existingTables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map(
  (row) => row.name,
);
const report = checkAuthSchemaCompatibility(existingTables, {
  appliedVersion: 1, // read from the consumer's migration journal
  tablePrefix: "planner_v2",
});
// report.status: "up-to-date" | "upgrade-required" | "not-initialized" |
//                "version-unknown" | "incompatible"
```

When `appliedVersion` is behind, the `"upgrade-required"` result includes the additive `plan` to review and copy into
the consumer's next migration. Omitting `appliedVersion` can validate table presence but deliberately reports
`"version-unknown"` instead of claiming the schema is current. `unexpectedTables` (present on an `"incompatible"`
result) is only populated when a table prefix is set; without a prefix there is no safe way to distinguish a leftover
auth table from the consumer's own application tables.

## CLI

`auth-migrations` is a safe, non-mutating command line tool: it only prints SQL or a JSON report to stdout (or a file
with `--out`) and never opens a network or database connection itself.

```sh
auth-migrations generate --prefix planner_v2 --out migrations/0001_auth.sql
auth-migrations plan --from 0 --to 1 --prefix planner_v2
auth-migrations check --tables "$(cat table-names.txt)" --prefix planner_v2 --version 1
```

`check` reads table names from stdin (comma- or newline-separated) when `--tables` is omitted, so it can sit at the end
of a pipeline built from the consumer's own trusted database tooling, for example:

```sh
wrangler d1 execute planner_db --command "SELECT name FROM sqlite_master WHERE type='table'" --json \
  | jq -r '.[0].results[].name' \
  | auth-migrations check --prefix planner_v2 --version 1
```

Supply `--version` from the consuming application's migration journal, not from untrusted request data. `check` exits
`0` only when both the schema shape and version are `"up-to-date"`, so it can gate a deploy step without the CLI ever
touching the database directly.
