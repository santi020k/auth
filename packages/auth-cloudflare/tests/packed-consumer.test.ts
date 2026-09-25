import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface PackResult {
  filename: string;
}

function commandError(error: unknown): Error {
  if (typeof error === "object" && error !== null) {
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    if (stderr || stdout) return new Error([stderr, stdout].filter(Boolean).join("\n"), { cause: error });
  }
  return error instanceof Error ? error : new Error("packed_consumer_command_failed");
}

function packResult(value: unknown): PackResult {
  if (typeof value !== "object" || value === null || !("filename" in value) || typeof value.filename !== "string") {
    throw new Error("packed_consumer_metadata_invalid");
  }
  return { filename: value.filename };
}

void describe("packed package consumer", () => {
  void it("installs and typechecks every public subpath without monorepo-only type dependencies", async () => {
    const packageDirectory = process.cwd();
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "auth-cloudflare-consumer-"));
    try {
      const { stdout } = await execFileAsync("pnpm", ["pack", "--pack-destination", temporaryDirectory, "--json"], {
        cwd: packageDirectory,
      });
      const metadata = packResult(JSON.parse(stdout) as unknown);
      const tarballPath = resolve(temporaryDirectory, metadata.filename);
      assert.ok((await readFile(tarballPath)).byteLength > 0);

      await writeFile(
        resolve(temporaryDirectory, "package.json"),
        JSON.stringify({ name: "auth-cloudflare-clean-consumer", private: true, type: "module" }),
      );
      await execFileAsync(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath, "hono@4.13.9"],
        { cwd: temporaryDirectory },
      );
      assert.ok(
        (await readFile(resolve(temporaryDirectory, "node_modules/@cloudflare/workers-types/package.json")))
          .byteLength > 0,
      );
      await writeFile(
        resolve(temporaryDirectory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: "ES2023",
          },
          include: ["consumer.ts"],
        }),
      );
      await writeFile(
        resolve(temporaryDirectory, "consumer.ts"),
        `import { createOwnerAuth, type OwnerAuthOptions } from "@santi020k/auth-cloudflare";
import { createOwnerAuthClient } from "@santi020k/auth-cloudflare/client";
import { createOwnerAuthMiddleware } from "@santi020k/auth-cloudflare/hono";
import { checkOwnerAuthSchema } from "@santi020k/auth-cloudflare/schema";

declare const options: OwnerAuthOptions;
const auth = createOwnerAuth(options);
void createOwnerAuthClient({ authServerURL: "https://auth.example.com" });
void createOwnerAuthMiddleware(auth);
void checkOwnerAuthSchema(options.database);
`,
      );
      try {
        await execFileAsync(resolve(packageDirectory, "node_modules/.bin/tsc"), ["--project", "tsconfig.json"], {
          cwd: temporaryDirectory,
        });
      } catch (error: unknown) {
        throw commandError(error);
      }
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
