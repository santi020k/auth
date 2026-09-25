import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type CliIO, runAuthMigrationsCli } from "../src/cli-lib.js";
import { AUTH_D1_MIGRATION, createAuthD1Migration } from "../src/index.js";

function fakeIO(stdin = ""): CliIO & { files: Map<string, string>; stderrText: string[]; stdoutText: string[] } {
  return {
    files: new Map(),
    readStdin: () => Promise.resolve(stdin),
    stderrText: [],
    stderr(text) {
      this.stderrText.push(text);
    },
    stdoutText: [],
    stdout(text) {
      this.stdoutText.push(text);
    },
    writeFile(path, contents) {
      this.files.set(path, contents);
      return Promise.resolve();
    },
  };
}

void describe("auth-migrations CLI", () => {
  void it("prints usage and exits 0 for no arguments or --help", async () => {
    const io = fakeIO();
    assert.equal(await runAuthMigrationsCli([], io), 0);
    assert.match(io.stdoutText.join(""), /Usage: auth-migrations/u);

    const helpIO = fakeIO();
    assert.equal(await runAuthMigrationsCli(["--help"], helpIO), 0);
    assert.match(helpIO.stdoutText.join(""), /Usage: auth-migrations/u);
  });

  void it("prints usage to stderr and exits 1 for an unknown command", async () => {
    const io = fakeIO();
    assert.equal(await runAuthMigrationsCli(["bogus"], io), 1);
    assert.match(io.stderrText.join(""), /Usage: auth-migrations/u);
    assert.deepEqual(io.stdoutText, []);
  });

  void it("generates the default schema to stdout", async () => {
    const io = fakeIO();
    assert.equal(await runAuthMigrationsCli(["generate"], io), 0);
    assert.equal(io.stdoutText.join(""), AUTH_D1_MIGRATION);
  });

  void it("generates a prefixed schema and writes it to a file when --out is given", async () => {
    const io = fakeIO();
    assert.equal(await runAuthMigrationsCli(["generate", "--prefix", "demo", "--out", "out.sql"], io), 0);
    assert.deepEqual(io.stdoutText, []);
    assert.equal(io.files.get("out.sql"), createAuthD1Migration({ tablePrefix: "demo" }));
  });

  void it("rejects an unknown schema version for generate", async () => {
    const io = fakeIO();
    assert.equal(await runAuthMigrationsCli(["generate", "--version", "99"], io), 1);
    assert.match(io.stderrText.join(""), /auth_migration_to_version_invalid/u);
  });

  void it("plans an upgrade and reports when nothing needs to apply", async () => {
    const io = fakeIO();
    assert.equal(await runAuthMigrationsCli(["plan", "--from", "0"], io), 0);
    assert.equal(io.stdoutText.join(""), AUTH_D1_MIGRATION);

    const noop = fakeIO();
    assert.equal(await runAuthMigrationsCli(["plan", "--from", "1", "--to", "1"], noop), 0);
    assert.deepEqual(noop.stdoutText, []);
    assert.match(noop.stderrText.join(""), /Already at version 1/u);
  });

  void it("requires --from for plan", async () => {
    const io = fakeIO();
    assert.equal(await runAuthMigrationsCli(["plan"], io), 1);
    assert.match(io.stderrText.join(""), /auth_migrations_cli_from_required/u);
  });

  void it("checks compatibility from --tables and exits non-zero when not up-to-date", async () => {
    const io = fakeIO();
    assert.equal(await runAuthMigrationsCli(["check", "--tables", ""], io), 1);
    assert.match(io.stdoutText.join(""), /"not-initialized"/u);

    const upToDate = fakeIO();
    const tables = "user,session,account,verification,passkey,rateLimit";
    assert.equal(await runAuthMigrationsCli(["check", "--tables", tables, "--version", "1"], upToDate), 0);
    assert.match(upToDate.stdoutText.join(""), /"up-to-date"/u);
  });

  void it("reads table names from stdin when --tables is omitted", async () => {
    const io = fakeIO("user\nsession\naccount\nverification\npasskey\nrateLimit\n");
    assert.equal(await runAuthMigrationsCli(["check", "--version", "1"], io), 0);
    assert.match(io.stdoutText.join(""), /"up-to-date"/u);
  });

  void it("does not pass a complete table set without the applied version", async () => {
    const io = fakeIO();
    const tables = "user,session,account,verification,passkey,rateLimit";
    assert.equal(await runAuthMigrationsCli(["check", "--tables", tables], io), 1);
    assert.match(io.stdoutText.join(""), /"version-unknown"/u);
  });
});
