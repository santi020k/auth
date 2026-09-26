import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  AUTH_SCHEMA_VERSION,
  type AuthMigrationOptions,
  checkAuthSchemaCompatibility,
  planAuthSchemaUpgrade,
} from "./index.js";

export interface CliIO {
  readStdin(): Promise<string>;
  stderr(text: string): void;
  stdout(text: string): void;
  writeFile(path: string, contents: string): Promise<void>;
}

const USAGE = `Usage: auth-migrations <command> [options]

Commands:
  generate [--prefix <prefix>] [--version <n>] [--out <file>]
      Print the schema as of the given version (default: latest, ${String(AUTH_SCHEMA_VERSION)}) as D1 SQL.

  plan --from <version> [--to <version>] [--prefix <prefix>] [--out <file>]
      Print the additive SQL needed to upgrade between two schema versions.

  check [--tables <comma-separated-table-names>] [--prefix <prefix>] [--version <n>]
      Compare an already-introspected table list against the expected schema
      and the app-owned applied migration version. Reads table names from stdin
      (comma- or newline-separated) when --tables is omitted. Without --version,
      a complete table set reports "version-unknown" and cannot pass the gate.

This command never connects to a database. It only prints SQL and reports; it
never applies, mutates, or inspects a live database itself.
`;

function parseTableList(value: string): string[] {
  return value
    .split(/[,\n]/u)
    .map((table) => table.trim())
    .filter(Boolean);
}

function parseVersion(value: string, code: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(code);
  return Number.parseInt(value, 10);
}

async function emit(io: CliIO, sql: string, out: string | undefined): Promise<void> {
  const text = sql.endsWith("\n") ? sql : `${sql}\n`;
  if (out) {
    await io.writeFile(out, text);
    return;
  }
  io.stdout(text);
}

async function runGenerate(argv: readonly string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { out: { type: "string" }, prefix: { type: "string" }, version: { type: "string" } },
    strict: true,
  });
  const toVersion =
    values.version === undefined
      ? AUTH_SCHEMA_VERSION
      : parseVersion(values.version, "auth_migrations_cli_version_invalid");
  const plan = planAuthSchemaUpgrade(0, toVersion, { tablePrefix: values.prefix ?? "" });
  await emit(io, plan.sql, values.out);
  return 0;
}

async function runPlan(argv: readonly string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      from: { type: "string" },
      out: { type: "string" },
      prefix: { type: "string" },
      to: { type: "string" },
    },
    strict: true,
  });
  if (values.from === undefined) throw new Error("auth_migrations_cli_from_required");
  const fromVersion = parseVersion(values.from, "auth_migrations_cli_from_invalid");
  const toVersion = values.to === undefined ? undefined : parseVersion(values.to, "auth_migrations_cli_to_invalid");
  const plan = planAuthSchemaUpgrade(fromVersion, toVersion, { tablePrefix: values.prefix ?? "" });
  if (plan.steps.length === 0) {
    io.stderr(`Already at version ${String(plan.toVersion)}; nothing to apply.\n`);
    return 0;
  }
  await emit(io, plan.sql, values.out);
  return 0;
}

async function runCheck(argv: readonly string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      prefix: { type: "string" },
      tables: { type: "string" },
      version: { type: "string" },
    },
    strict: true,
  });
  const raw = values.tables ?? (await io.readStdin());
  const options = {
    ...(values.version === undefined
      ? {}
      : { appliedVersion: parseVersion(values.version, "auth_migrations_cli_version_invalid") }),
    tablePrefix: values.prefix ?? "",
  } satisfies AuthMigrationOptions & { appliedVersion?: number };
  const report = checkAuthSchemaCompatibility(parseTableList(raw), options);
  io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === "up-to-date" ? 0 : 1;
}

export async function runAuthMigrationsCli(argv: readonly string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "generate":
        return await runGenerate(rest, io);
      case "plan":
        return await runPlan(rest, io);
      case "check":
        return await runCheck(rest, io);
      case undefined:
      case "--help":
      case "-h":
        io.stdout(USAGE);
        return 0;
      default:
        io.stderr(USAGE);
        return 1;
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export const nodeCliIO: CliIO = {
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  stdout: (text) => {
    process.stdout.write(text);
  },
  writeFile: async (path, contents) => {
    await writeFile(path, contents, "utf8");
  },
};
